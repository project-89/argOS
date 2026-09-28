import { jest } from "@jest/globals";
import type { DaemonObservation } from "../agent-daemon";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createRoomEntity, createAgentEntity } = await import("../../ecs/prefabs");
const { getRoomForEntity } = await import("../../ecs/location");
const { createEntityRegistry } = await import("../../ecs/tools");
const { drainPendingStimuli } = await import("../../cognition/stimulus-queue");
const { createDaemonRegistry, createDaemonForAgent, whisperToAgent, whisperChallenge, queueNarrativeNudge, processPendingNudges } = await import("../agent-daemon");
const { createSpiritRegistry, createSpirit } = await import("../spirit-registry");
const { runSpiritCognition } = await import("../spirit-cognition");
const { collectEcsSnapshot } = await import("../spirit-cognition");
const { addEntity, addComponent } = await import("bitecs");
const { Name, Description, PhysicalObject, ObjectState, CommunicationMemory, Health, Mind } = await import("../../ecs/components");
const { createPersonalIntention } = await import("../../cognition/goal-lifecycle");
const { setLocatedIn } = await import("../../ecs/location");

function fixture() {
  const world = createArgosWorld("Advisory spirits"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Hall" });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "Interested in the world.", roomId: room });
  addComponent(world, actor, Health); Health.current[actor] = 90; Mind.arousal[actor] = 0.55;
  createPersonalIntention(world, actor, "Consider inspecting the observatory", 5);
  const registry = createDaemonRegistry();
  const daemon = createDaemonForAgent(registry, world, actor)!;
  const observation: DaemonObservation = {
    agentName: "Mara", timestamp: Date.now(), previousState: null,
    currentState: { timestamp: Date.now(), room: "Hall", arousal: 0.5, focus: "inspect", mode: "reactive", active: true, goalCount: 0, thoughtCount: 0, stuckTicks: 0 },
    concerns: [{ type: "confusion", severity: "low", description: "Mara's last inspection found no new detail." }],
    growthOpportunities: [{ type: "ready_for_challenge", description: "Mara expressed interest in the observatory.", suggestedChallenge: "", urgency: "low" }],
    achievements: [],
  };
  return { world, room, actor, registry, daemon, observation };
}

beforeEach(() => {
  generate.mockReset(); drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No live calls in advisory prompt tests"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test.each(["guidance", "challenge"])("%s may contribute no whisper without mutating the actor", async kind => {
  const f = fixture(); generate.mockResolvedValue({ text: "" });
  const result = kind === "guidance"
    ? await whisperToAgent(f.world, f.daemon, f.observation, true)
    : await whisperChallenge(f.world, f.daemon, f.observation, f.registry, true);
  expect(result).toBeNull(); expect(drainPendingStimuli()).toEqual([]);
  expect(f.daemon.whisperCount).toBe(0); expect(getRoomForEntity(f.world, f.actor)).toBe(f.room);
  const prompt = generate.mock.calls[0][0].prompt;
  expect(prompt).toContain(kind === "guidance" ? f.observation.concerns[0].description : f.observation.growthOpportunities[0].description);
  expect(prompt).toContain("empty string");
  expect(prompt).not.toMatch(/stirs jealousy|won't let them rest|Makes them feel the need|push growth/);
});

test("a generated intuition is only a cognitive stimulus, not a movement action", async () => {
  const f = fixture(); generate.mockResolvedValue({ text: "Would a closer look help?" });
  await whisperToAgent(f.world, f.daemon, f.observation, true);
  expect(drainPendingStimuli()).toEqual([{ targetEid: f.actor, type: "daemon_whisper", modality: "cognitive", content: "Would a closer look help?", source: "inner_voice", intensity: 0.3, timestamp: expect.any(Number) }]);
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.room);
});

test("nudge wrappers propose options without asserting a changed priority or arrival", () => {
  const f = fixture();
  queueNarrativeNudge(f.registry, "Mara", { type: "change_goal", action: "Inspect the observatory", reason: "A possibility", source: "narrator", priority: "normal" });
  queueNarrativeNudge(f.registry, "Mara", { type: "arrive", action: "Check the landing", reason: "A possibility", source: "narrator", priority: "normal" });
  const whispers = processPendingNudges(f.daemon, f.world);
  expect(whispers).toHaveLength(2);
  expect(whispers[0].content).toContain("Consider whether this fits your priorities");
  expect(whispers[1].content).toContain("A possibility for your journey");
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.room);
});

test("narrative repetition context permits silence and does not turn intended movement into arrival", async () => {
  const f = fixture();
  const spirits = createSpiritRegistry(f.world);
  const spirit = createSpirit(spirits, { name: "Observer", domain: "narrative", rank: "archangel", model: "flash", systemPrompt: "Observe actual events.", observationInterval: 1000 });
  spirit.narrativeState!.recentProse = ["Mara heads toward the staircase."];
  generate.mockResolvedValue({ text: JSON.stringify({ thoughts: "No new change.", observations: [], storyProse: "" }) });
  const output = await runSpiritCognition(spirit, f.world, createEntityRegistry(), spirits);
  const { system, prompt } = generate.mock.calls[0][0];
  expect(system).toContain("Live ECS state is authoritative");
  expect(prompt).toContain("Mara heads toward the staircase.");
  expect(prompt).toContain("Movement intent is not evidence of arrival");
  expect(prompt).toContain("leave storyProse empty");
  expect(prompt).not.toMatch(/Emma arrives|Write something NEW|describe the PROGRESSION/);
  expect(output.interventions).toEqual([]); expect(getRoomForEntity(f.world, f.actor)).toBe(f.room);
});

test("spirit prompts follow current physical state and appearance without private component dumps", async () => {
  const f = fixture(), prop = addEntity(f.world), entities = createEntityRegistry();
  for (const component of [Name, Description, PhysicalObject, ObjectState, CommunicationMemory]) addComponent(f.world, prop, component);
  Name.value[prop] = "Irrigation tap"; setLocatedIn(f.world, prop, f.room);
  ObjectState.current[prop] = "open"; Description.value[prop] = "Water flows through the irrigation tap.";
  CommunicationMemory.receiptsJson[prop] = "PRIVATE_MESSAGE_NOT_FOR_SPIRITS";
  const spirits = createSpiritRegistry(f.world);
  const spirit = createSpirit(spirits, { name: "Observer", domain: "narrative", rank: "archangel", model: "flash", systemPrompt: "Observe actual events.", observationInterval: 1000 });
  generate.mockResolvedValue({ text: JSON.stringify({ thoughts: "", observations: [], storyProse: "" }) });
  const before = collectEcsSnapshot(f.world, entities);
  await runSpiritCognition(spirit, f.world, entities, spirits);
  ObjectState.current[prop] = "closed"; Description.value[prop] = "The irrigation tap is closed; flow has stopped.";
  const after = collectEcsSnapshot(f.world, entities);
  await runSpiritCognition(spirit, f.world, entities, spirits);
  const placement = (snapshot: typeof before) => snapshot.rooms.find(room => room.eid === f.room)?.objectPlacements?.find(object => object.eid === prop);
  expect(placement(before)).toMatchObject({ state: "open", description: "Water flows through the irrigation tap." });
  expect(placement(after)).toMatchObject({ state: "closed", description: "The irrigation tap is closed; flow has stopped." });
  const firstPrompt = generate.mock.calls[0][0].prompt, secondPrompt = generate.mock.calls[1][0].prompt;
  const issued = (prompt: string) => JSON.parse(prompt.match(/ISSUED_INTERVENTION_EVIDENCE:\n([^\n]+)/)![1]).records;
  expect(issued(firstPrompt)).toContainEqual(expect.objectContaining({ kind: "object_state", subject: "Irrigation tap", value: "open" }));
  expect(firstPrompt).toContain("Water flows through the irrigation tap.");
  expect(issued(secondPrompt)).toContainEqual(expect.objectContaining({ kind: "object_state", subject: "Irrigation tap", value: "closed" }));
  expect(secondPrompt).toContain("The irrigation tap is closed; flow has stopped.");
  expect(secondPrompt).not.toContain("Water flows through the irrigation tap.");
  for (const value of [JSON.stringify(before), JSON.stringify(after), firstPrompt, secondPrompt]) expect(value).not.toContain("PRIVATE_MESSAGE_NOT_FOR_SPIRITS");
});
