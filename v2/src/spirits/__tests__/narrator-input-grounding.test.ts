import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createRoomEntity, createAgentEntity, createObjectEntity } = await import("../../ecs/prefabs");
const { createEntityRegistry } = await import("../../ecs/tools");
const { Mind } = await import("../../ecs/components");
const { createPersonalIntention } = await import("../../cognition/goal-lifecycle");
const { addThought } = await import("../../cognition/agent-mind");
const { startCommittedEvents, publishCommittedEvent } = await import("../../runtime/committed-events");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { createSpiritRegistry, createSpirit } = await import("../spirit-registry");
const { runSpiritCognition, collectEcsSnapshot } = await import("../spirit-cognition");

beforeEach(() => {
  generate.mockReset().mockResolvedValue({ text: "{}" });
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("No providers in narrator input tests"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

function fixture() {
  const world = createArgosWorld("Narrator public evidence"); initializePrefabs(world); startCommittedEvents(world);
  advanceSimulationTime(world, 1, 12_000);
  const room = createRoomEntity(world, { name: "Workshop", description: "A shared room overlooking the common." });
  const actor = createAgentEntity(world, { name: "Ada", role: "neighbor", systemPrompt: "PRIVATE_BIOGRAPHY", roomId: room });
  Mind.focus[actor] = "PRIVATE_FOCUS"; Mind.arousal[actor] = 0.95;
  createPersonalIntention(world, actor, "PRIVATE_UNSPOKEN_INTENTION", 6);
  addThought(world, actor, { content: "PRIVATE_INNER_MONOLOGUE", type: "reasoning" });
  createObjectEntity(world, { name: "Marked box", description: "VISIBLE_PAINT_AND_CUTS", roomId: room });
  const entities = createEntityRegistry(), registry = createSpiritRegistry(world);
  const spirit = createSpirit(registry, { name: "The Narrator", domain: "narrative", rank: "archangel",
    model: "flash", systemPrompt: "Observe actual developments.", observationInterval: 25_000 });
  return { world, room, actor, entities, registry, spirit,
    run: () => runSpiritCognition(spirit, world, entities, registry) };
}
const prompt = () => generate.mock.calls.at(-1)![0].prompt as string;

test("narration sees public presence and spoken claims, not private cognition or inferred mood", async () => {
  const f = fixture();
  publishCommittedEvent(f.world, { executionId: "a-claim", kind: "speech", action: "speak", actorId: f.actor,
    roomId: f.room, status: "succeeded", text: "Someone forced the box open, I think." });
  // The generic supervisor snapshot remains available to its existing consumers.
  const snapshot = collectEcsSnapshot(f.world, f.entities);
  expect(snapshot.agents[0]).toMatchObject({ focus: "PRIVATE_FOCUS", mood: "agitated", recentThoughts: ["PRIVATE_INNER_MONOLOGUE"] });
  await f.run();
  expect(prompt()).toContain("Ada"); expect(prompt()).toContain("Workshop");
  expect(prompt()).toContain("Someone forced the box open, I think.");
  expect(prompt()).not.toMatch(/PRIVATE_|agitated|Active goals:|Recent thoughts:|Focus:/);
  expect(prompt()).toContain("Spoken claims establish what was said, not that their contents happened");
  expect(JSON.parse(prompt().match(/COMMITTED_PUBLIC_EVENTS_SINCE_REVIEW:\n([^\n]+)/)![1]).observedAtSimMs).toBe(12_000);
});

test("one authoritative detail catalog retains exact current evidence IDs without duplicate grounding inventory", async () => {
  const f = fixture(); await f.run();
  const evidence = JSON.parse(prompt().match(/ISSUED_INTERVENTION_EVIDENCE:\n([^\n]+)/)![1]);
  expect(evidence.records).toContainEqual(expect.objectContaining({ id: expect.stringMatching(/^observation:/),
    kind: "object_description", subject: "Marked box", value: "VISIBLE_PAINT_AND_CUTS" }));
  expect(prompt().split("VISIBLE_PAINT_AND_CUTS")).toHaveLength(2);
  expect(prompt()).not.toContain("OBJECTS IN WORLD:");
  expect(prompt()).not.toContain("VALID AGENT NAMES (can mention):");
  expect(prompt()).toContain("A shared room overlooking the common.");
});

test("prior tension labels remain interpretations and the model can choose quiet without an intervention", async () => {
  const f = fixture(); f.spirit.narrativeState!.tension = 0.8; f.spirit.narrativeState!.currentPhase = "rising";
  f.spirit.observations.push({ id: "old", timestamp: Date.now(), domain: "narrative", type: "emergence",
    content: "An earlier unverified interpretation", entities: ["Ada"], significance: .9 });
  const output = await f.run();
  expect(prompt()).toContain("PRIOR SPIRIT INTERPRETATIONS (not native event receipts)");
  expect(prompt()).toContain("previous assessment, not evidence of progress");
  expect(prompt()).toContain("useful work, rest and listening");
  expect(output.interventions).toEqual([]);
});
