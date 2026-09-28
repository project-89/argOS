import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createRoomEntity, createAgentEntity, createObjectEntity } = await import("../../ecs/prefabs");
const { createEntityRegistry } = await import("../../ecs/tools");
const { Mind } = await import("../../ecs/components");
const { createPersonalIntention } = await import("../../cognition/goal-lifecycle");
const { addThought, buildAgentContext } = await import("../../cognition/agent-mind");
const { startCommittedEvents, publishCommittedEvent } = await import("../../runtime/committed-events");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { createSpiritRegistry, createSpirit } = await import("../spirit-registry");
const { runSpiritCognition, collectEcsSnapshot } = await import("../spirit-cognition");
const { subscribeNarratorProse } = await import("../narrator-spirit");

beforeEach(() => {
  generate.mockReset().mockResolvedValue({ text: "{}" });
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("No providers in narrator input tests"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

function fixture() {
  const world = createArgosWorld("Narrator author view"); initializePrefabs(world); startCommittedEvents(world);
  advanceSimulationTime(world, 1, 12_000);
  const room = createRoomEntity(world, { name: "Workshop", description: "A shared room overlooking the common." });
  const actor = createAgentEntity(world, { name: "Ada", role: "neighbor", systemPrompt: "PRIVATE_BIOGRAPHY", roomId: room });
  const peer = createAgentEntity(world, { name: "Bo", role: "neighbor", systemPrompt: "An independent person.", roomId: room });
  Mind.focus[actor] = "PRIVATE_FOCUS"; Mind.arousal[actor] = 0.95;
  createPersonalIntention(world, actor, "PRIVATE_UNSPOKEN_INTENTION", 6);
  addThought(world, actor, { content: "PRIVATE_INNER_MONOLOGUE", type: "reasoning" });
  createObjectEntity(world, { name: "Marked box", description: "VISIBLE_PAINT_AND_CUTS", roomId: room });
  const entities = createEntityRegistry(), registry = createSpiritRegistry(world);
  const spirit = createSpirit(registry, { name: "The Narrator", domain: "narrative", rank: "archangel",
    model: "flash", systemPrompt: "Tell a gripping story.", observationInterval: 25_000 });
  return { world, room, actor, peer, entities, registry, spirit,
    run: () => runSpiritCognition(spirit, world, entities, registry) };
}
const prompt = () => generate.mock.calls.at(-1)![0].prompt as string;

test("the author sees every resident's inner life and the public record, and none of it reaches another resident", async () => {
  const f = fixture();
  publishCommittedEvent(f.world, { executionId: "a-claim", kind: "speech", action: "speak", actorId: f.actor,
    roomId: f.room, status: "succeeded", text: "Someone forced the box open, I think." });
  const snapshot = collectEcsSnapshot(f.world, f.entities);
  expect(snapshot.agents[0]).toMatchObject({ focus: "PRIVATE_FOCUS", mood: "agitated", recentThoughts: ["PRIVATE_INNER_MONOLOGUE"] });
  generate.mockResolvedValueOnce({ text: JSON.stringify({ thoughts: "Ada is rattled.",
    whispers: [{ resident: "Ada", impulse: "You know those cuts weren't yours. Look again.", kind: "reflect" }] }) });
  const output = await f.run();
  expect(prompt()).toContain("=== THE CAST — author's eyes only ===");
  for (const secret of ["PRIVATE_BIOGRAPHY", "PRIVATE_UNSPOKEN_INTENTION", "PRIVATE_INNER_MONOLOGUE"]) expect(prompt()).toContain(secret);
  expect(prompt()).toContain('Ada (Workshop) says: "Someone forced the box open, I think."');
  expect(prompt()).toMatch(/Ada — neighbor\. At Workshop with Bo/);
  expect(output.interventions[0]).toMatchObject({ type: "inject_stimulus", result: "accepted", nudgeKind: "reflect" });
  // Author omniscience is not resident knowledge: nothing from the dossier or whisper reaches Bo.
  const peerContext = buildAgentContext(f.world, f.peer);
  for (const text of ["PRIVATE_BIOGRAPHY", "PRIVATE_UNSPOKEN_INTENTION", "PRIVATE_INNER_MONOLOGUE", "weren't yours"]) expect(peerContext).not.toContain(text);
});

test("craft guidance replaces prohibitions; the prompt carries powers and a compact citation catalog", async () => {
  const f = fixture(); await f.run();
  expect(prompt()).not.toMatch(/valid choice|no quota|not proof|not evidence of progress|intervention quota|stagnation verdict/i);
  expect(prompt()).toContain("=== WHAT YOU CAN DO ===");
  expect(prompt()).toMatch(/whispers — up to two/);
  const evidence = JSON.parse(prompt().match(/ISSUED_INTERVENTION_EVIDENCE:\n([^\n]+)/)![1]);
  expect(evidence.records).toContainEqual(expect.objectContaining({ id: expect.stringMatching(/^observation:/), kind: "object_description", subject: "Marked box" }));
  expect(evidence.records).toContainEqual(expect.objectContaining({ kind: "place", subject: "Workshop" }));
  // The description is shown once, in THE WORLD NOW, not duplicated in the catalog.
  expect(prompt().split("VISIBLE_PAINT_AND_CUTS")).toHaveLength(2);
  expect(prompt()).not.toContain("OBJECTS IN WORLD:");
  expect(generate.mock.calls.at(-1)![0].system).toContain("Live ECS state is authoritative");
});

test("the story ledger and the author's last reasoning are fed back, and prose reaches the story feed", async () => {
  const f = fixture(), feed: string[] = [];
  const stop = subscribeNarratorProse(f.world, entry => feed.push(`${entry.atSimMs}:${entry.text}`));
  generate.mockResolvedValueOnce({ text: JSON.stringify({
    thoughts: "REASONING_ONE: plant the box, then let Ada doubt herself.",
    storyProse: "Ada says the box was forced, and nobody meets her eye.",
    ledger: { tensionNow: 0.35, tensionTarget: 0.5, phase: "rising", plan: "PLAN_KNOCKS_TONIGHT",
      questions: [{ question: "Who forced the box?", status: "open" }],
      threads: [{ name: "The forced box", status: "rising", participants: ["Ada"], next: "a knock at Rook House" }],
      foreshadowing: [{ detail: "pale paint in the cut", status: "planted" }] } }) });
  await f.run();
  expect(feed).toEqual(["12000:Ada says the box was forced, and nobody meets her eye."]);
  expect(f.spirit.narrativeState).toMatchObject({ tension: 0.35, currentPhase: "rising" });
  await f.run();
  for (const text of ["REASONING_ONE", "PLAN_KNOCKS_TONIGHT", "[open] Who forced the box?", "The forced box [rising] (Ada) next: a knock at Rook House",
    "pale paint in the cut [planted]", "Ada says the box was forced"]) expect(prompt()).toContain(text);
  expect(prompt()).toContain("Tension now 35%; your target 50%");
  stop();
});

test("requests to God are high priority with their data intact", async () => {
  const f = fixture();
  generate.mockResolvedValueOnce({ text: JSON.stringify({ requests: [
    { type: "create_event", target: "Workshop", action: "A letter is pushed under the door", reason: "Ada needs a push" }] }) });
  const output = await f.run();
  expect(output.reports).toEqual([expect.objectContaining({ priority: "high", subject: "[NARRATIVE_DIRECTIVE:create_event] Workshop",
    data: expect.objectContaining({ source: "narrative_directive", directiveType: "create_event", action: "A letter is pushed under the door" }) })]);
  expect(f.spirit.narrativeState!.ledger!.moves.at(-1)).toMatchObject({ kind: "request:create_event", result: "sent to God" });
});
