import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { Memory, WorkingMemory, ReflectionState } = await import("../../ecs/components");
const { addMemory, getAgentMemories } = await import("../knowledge-graph");
const { recordWorkingMemoryEvidence, getWorkingMemory } = await import("../working-memory");
const { generateReflection, initializeReflectionState, maybeReflect } = await import("../reflection-system");

const response = { text: JSON.stringify({ insights: [{ insight: "I learned something useful from the record.", importance: 6, category: "self", relatedMemories: ["The record"] }], questionsRaised: [], emotionalSummary: "Attentive" }) };
function fixture() {
  const world = createArgosWorld("Reflection source selection"); world.meta.aiEnabled = true; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Study" });
  const actor = createAgentEntity(world, { name: "Ada", role: "researcher", systemPrompt: "Observe carefully.", roomId: room });
  const other = createAgentEntity(world, { name: "Lin", role: "researcher", systemPrompt: "Observe carefully.", roomId: room });
  const state = initializeReflectionState(world, actor, 1);
  const at = Date.now();
  const remember = (content: string, importance: number, timestamp: number, who = actor, type: "episodic" | "semantic" = "episodic") => addMemory(world, who, { content, importance, timestamp, type, emotionalValence: 0 });
  for (let n = 0; n < 24; n++) remember("The requested operation could not proceed.", .9, at + n);
  for (let n = 0; n < 12; n++) remember(`A remembered interpretation ${n}.`, .9, at + n, actor, "semantic");
  const significant = remember("A significant older encounter.", 1, at - 60_000);
  const read = remember("The written instruction was WEST THEN NORTH.", .2, at + 25);
  remember("Lin alone knows the private phrase.", 1, at + 30, other);
  recordWorkingMemoryEvidence(world, actor, { id: "physical-read", kind: "action", provenance: "own_action", atMs: at + 25,
    summary: "The written instruction was WEST THEN NORTH.", succeeded: true, facts: [] });
  recordWorkingMemoryEvidence(world, other, { id: "private-other-read", kind: "action", provenance: "own_action", atMs: at + 25,
    summary: "PRIVATE OTHER ACTOR SOURCE.", succeeded: true, facts: [] });
  return { world, actor, state, significant, read };
}
beforeEach(() => { generate.mockReset(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Reflection tests are offline")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("one reflection request receives diverse original sources without another actor's memory", async () => {
  const f = fixture(); generate.mockResolvedValue(response);
  const history = getAgentMemories(f.world, f.actor).map(id => [id, Memory.content[id], Memory.importance[id], Memory.timestamp[id]]);
  await generateReflection(f.world, f.actor);
  expect(generate).toHaveBeenCalledTimes(1);
  const context = generate.mock.calls[0][0].system;
  const selected = context.split("SELECTED EXPERIENCES")[1].split("Physical receipts establish")[0];
  expect(selected).toContain(`memory ${f.read}; episodic; remembered, not independently verified; importance=0.2;`);
  expect(selected).toContain(`memory ${f.significant};`);
  expect(selected).toContain('physical receipt "physical-read"; own_action; action succeeded;');
  expect(selected.match(/The requested operation could not proceed\./g)).toHaveLength(1);
  expect((selected.match(/^\d+\. /gm) || []).length).toBeLessThanOrEqual(20);
  expect(context).not.toContain("PRIVATE OTHER ACTOR SOURCE");
  expect(context).not.toContain("Lin alone knows the private phrase");
  expect(getAgentMemories(f.world, f.actor).map(id => [id, Memory.content[id], Memory.importance[id], Memory.timestamp[id]])).toEqual(history);
});

test.each(["receipt removed", "memory type changed", "memory importance changed"])("selected-source guards survive retrieval changes: %s", async change => {
  const f = fixture(); ReflectionState.importanceAccum[f.state] = 100;
  let finish!: (value: typeof response) => void;
  generate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const reflecting = maybeReflect(f.world, f.actor);
  expect(generate).toHaveBeenCalledTimes(1);
  if (change === "receipt removed") WorkingMemory.receiptsJson[f.actor] = JSON.stringify(getWorkingMemory(f.world, f.actor).receipts.filter(r => r.id !== "physical-read"));
  else if (change === "memory type changed") Memory.type[f.read] = "semantic";
  else Memory.importance[f.read] = .95;
  finish(response);
  expect(await reflecting).toBe(false);
  expect(ReflectionState.reflectionCount[f.state]).toBe(0);
});
