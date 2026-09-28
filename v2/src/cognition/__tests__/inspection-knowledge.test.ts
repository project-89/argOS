import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { addComponent, removeEntity } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createRoomEntity, createAgentEntity, createObjectEntity } = await import("../../ecs/prefabs");
const { Agent, Container, Description, Memory, ObjectState, Traits, WorkingMemoryIdentity } = await import("../../ecs/components");
const { setLocatedIn } = await import("../../ecs/location");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { withSimulationTask } = await import("../../runtime/task-scope");
const { executeActions } = await import("../cognition-system");
const { getCurrentInspection } = await import("../inspection-memory");
const { getAgentMemories } = await import("../knowledge-graph");
const { getWorkingMemory } = await import("../working-memory");
const { registerAgentWorldCapabilities } = await import("../world-capabilities");
const { drainPendingStimuli } = await import("../stimulus-queue");

function fixture() {
  const world = createArgosWorld("Inspection knowledge"); initializePrefabs(world); startCommittedEvents(world);
  world.meta.aiEnabled = true;
  const room = createRoomEntity(world, { name: "Sitting Room" });
  const remote = createRoomEntity(world, { name: "Private Room" });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "Remember what I actually see", roomId: room });
  const peer = createAgentEntity(world, { name: "Tess", role: "resident", systemPrompt: "PRIVATE_PERSONA_SENTINEL", roomId: room });
  Description.value[peer] = "Tess wears a blue cardigan.";
  addComponent(world, peer, ObjectState); ObjectState.current[peer] = "PRIVATE_THOUGHT_SENTINEL";
  createObjectEntity(world, { name: "PRIVATE_INVENTORY_SENTINEL", roomId: peer });
  const cupboard = createObjectEntity(world, { name: "Cupboard", roomId: room });
  addComponent(world, cupboard, Container); ObjectState.current[cupboard] = "closed";
  const hidden = createObjectEntity(world, { name: "HIDDEN_CONTENT_SENTINEL", roomId: cupboard });
  const registry = createSystemRegistry();
  const observe = (target = "Tess", question?: string) => executeActions(world,
    [{ eid: actor, action: { type: "observe", target, ...(question ? { content: question } : {}) } }], registry);
  return { world, actor, peer, room, remote, cupboard, hidden, observe };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
let oldKey: string | undefined, oldEnable: string | undefined, oldDisable: string | undefined;
beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; oldEnable = process.env.ARGOS_ENABLE_LLM_IN_TESTS; oldDisable = process.env.ARGOS_DISABLE_KNOWLEDGE_EXTRACTION;
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only"; process.env.ARGOS_ENABLE_LLM_IN_TESTS = "1"; delete process.env.ARGOS_DISABLE_KNOWLEDGE_EXTRACTION;
  generate.mockReset(); generate.mockResolvedValue({ text: "{}" });
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Inspection extraction regressions are offline"));
  drainPendingStimuli();
});
afterEach(async () => {
  await flush(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli();
  for (const [key, value] of [["GOOGLE_GENERATIVE_AI_API_KEY", oldKey], ["ARGOS_ENABLE_LLM_IN_TESTS", oldEnable], ["ARGOS_DISABLE_KNOWLEDGE_EXTRACTION", oldDisable]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
});

test("24 unchanged observations commit real receipts but extract once from visible evidence, not generic action prose", async () => {
  const f = fixture();
  for (let i = 0; i < 24; i++) f.observe();
  Agent.systemPrompt[f.peer] = "A changed PRIVATE_PERSONA_SENTINEL";
  ObjectState.current[f.peer] = "A changed PRIVATE_THOUGHT_SENTINEL";
  f.observe(); // Another person's private change is not new visible evidence.
  await flush();
  expect(generate).toHaveBeenCalledTimes(1);
  const interaction = JSON.parse(generate.mock.calls[0][0].prompt).interaction;
  expect(interaction).toMatchObject({ type: "observation", perspective: "observation", otherParty: "Tess" });
  expect(interaction.content).toContain("Tess wears a blue cardigan.");
  expect(interaction.content).toContain("Inspected Tess");
  expect(interaction.content).not.toBe("Observing Tess");
  expect(interaction.context).toContain("inspection:");
  expect(generate.mock.calls[0][0].prompt).not.toMatch(/PRIVATE_PERSONA_SENTINEL|PRIVATE_THOUGHT_SENTINEL|PRIVATE_INVENTORY_SENTINEL|HIDDEN_CONTENT_SENTINEL/);
  expect(getWorkingMemory(f.world, f.actor).receipts.filter(r => r.id.startsWith("inspection:"))).toHaveLength(25);
});

test("genuine visible state, description, capability, and question changes each reopen extraction", async () => {
  const f = fixture(); f.observe(); f.observe();
  Description.value[f.peer] = "Tess wears a green coat."; f.observe();
  let verb = "wave";
  registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false, execute: () => false,
    affordances: target => target === f.peer ? [{ name: verb, requires: [] }] : [] });
  f.observe(); verb = "offer_hand"; f.observe(); f.observe();
  f.observe("Tess", "look at her coat"); f.observe("Tess", "look at her coat");
  expect(generate).toHaveBeenCalledTimes(5);
  f.observe("Cupboard"); expect(generate).toHaveBeenCalledTimes(6);
  expect(generate.mock.calls[5][0].prompt).not.toContain("HIDDEN_CONTENT_SENTINEL");
  ObjectState.current[f.cupboard] = "open"; f.observe("Cupboard");
  expect(generate).toHaveBeenCalledTimes(7);
  expect(generate.mock.calls[6][0].prompt).toContain("HIDDEN_CONTENT_SENTINEL");
  f.observe("Cupboard"); expect(generate).toHaveBeenCalledTimes(7);
  await flush();
});

test("useful learning from a genuinely changed inspection is retained without duplicating unchanged confirmations", async () => {
  const f = fixture();
  generate.mockImplementation(async request => ({ text: JSON.stringify({ memories: [{ type: "episodic",
    content: JSON.parse(request.prompt).interaction.content, importance: .6, emotionalValence: 0 }] }) }));
  f.observe("Cupboard"); await flush(); f.observe("Cupboard"); await flush();
  expect(getAgentMemories(f.world, f.actor)).toHaveLength(1);
  ObjectState.current[f.cupboard] = "open"; f.observe("Cupboard"); await flush(); f.observe("Cupboard"); await flush();
  const memories = getAgentMemories(f.world, f.actor).map(id => Memory.content[id]);
  expect(memories).toHaveLength(2);
  expect(memories.some(content => content.includes("HIDDEN_CONTENT_SENTINEL"))).toBe(true);
  expect(generate).toHaveBeenCalledTimes(2);
});

test("source/actor/target identity changes do not inherit an unchanged-inspection suppression", async () => {
  const f = fixture(); f.observe();
  stopCommittedEvents(f.world); startCommittedEvents(f.world); f.observe();
  Agent.systemPrompt[f.actor] = "A changed autobiographical identity"; f.observe();
  WorkingMemoryIdentity.id[f.actor] = "replacement-owner"; f.observe();
  const oldTarget = getCurrentInspection(f.world, f.actor, "Tess")!.subject;
  removeEntity(f.world, f.peer);
  createAgentEntity(f.world, { name: "Tess", role: "new resident", systemPrompt: "PRIVATE_REPLACEMENT", roomId: f.room });
  f.observe(); await flush();
  expect(generate).toHaveBeenCalledTimes(5);
  expect(JSON.parse(generate.mock.calls[4][0].prompt).interaction.context).not.toContain(oldTarget);
});

test("blind, remote, and concealed targets cannot mint observation extraction", async () => {
  const f = fixture(); setLocatedIn(f.world, f.peer, f.remote); f.observe();
  setLocatedIn(f.world, f.peer, f.room); addComponent(f.world, f.peer, Traits); Traits.active[f.peer] = '["hidden"]'; f.observe();
  Traits.active[f.peer] = "[]"; addComponent(f.world, f.actor, Traits); Traits.active[f.actor] = '["blind"]'; f.observe();
  await flush(); expect(generate).not.toHaveBeenCalled();
});

test.each(["cancel", "source", "owner"])("late observation interpretation is discarded across %s", async boundary => {
  const f = fixture(), controller = new AbortController();
  let release!: (value: { text: string }) => void;
  generate.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  await withSimulationTask(controller.signal, async () => f.observe());
  expect(generate).toHaveBeenCalledTimes(1);
  if (boundary === "cancel") controller.abort();
  if (boundary === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (boundary === "owner") WorkingMemoryIdentity.id[f.actor] = "another-owner";
  release({ text: JSON.stringify({ memories: [{ type: "episodic", content: "LATE_INTERPRETATION", importance: .6, emotionalValence: 0 }] }) });
  await flush(); expect(getAgentMemories(f.world, f.actor)).toEqual([]);
});
