import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createRoomEntity, createAgentEntity } = await import("../../ecs/prefabs");
const { agentThink, getAgentThoughts } = await import("../agent-mind");
const { runCognitionCycle, createIntentGoal } = await import("../cognition-system");
const { runAgentSubconscious, hasSubconsciousWork } = await import("../subconscious-system");
const { initializeReflectionState, maybeReflect, hasPendingReflection } = await import("../reflection-system");
const { addMemory, getAgentMemories } = await import("../knowledge-graph");
const { runPlanningSystem } = await import("../planning-system");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { Agent, Goal, ReflectionState, Memory } = await import("../../ecs/components");
const { HasGoal, HasPlan } = await import("../../ecs/relations");
const { getRelationTargets, removeEntity } = await import("bitecs");
const { withSimulationTask } = await import("../../runtime/task-scope");
const { captureWorkingMemoryObservation } = await import("../working-memory-observation");

function fixture(withGoal = false) {
  const world = createArgosWorld("Subconscious pressure"); world.meta.aiEnabled = true;
  initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" });
  const actor = createAgentEntity(world, { name: "Mara", role: "keeper", systemPrompt: "Reason from what you perceive.", roomId: room });
  if (withGoal) createIntentGoal(world, actor, "Investigate the workshop", 7);
  return { world, room, actor };
}
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const decision = { text: JSON.stringify({ innerThought: "I can look while I think this through.", action: { type: "observe", target: "Workshop" } }) };
const insight = { text: JSON.stringify({ insights: [{ insight: "I tend to rush when startled; I should check my observations.", importance: 7.5, category: "self", relatedMemories: ["The alarm"] }], questionsRaised: [], emotionalSummary: "Alert" }) };
const historicalInsight = (memoryId: number) => {
  const result = JSON.parse(insight.text);
  result.insights[0].temporalScope = "historical"; result.insights[0].sourceIds = [`memory:${memoryId}`];
  return { text: JSON.stringify(result) };
};
let oldKey: string | undefined;
beforeEach(() => { oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only"; generate.mockReset(); });
afterEach(() => { if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey; });

test("a goal-less foreground decision makes one short decision call, never an autonomous planning call", async () => {
  const f = fixture(); generate.mockResolvedValue(decision);
  expect(await agentThink(f.world, f.actor)).toEqual({ type: "observe", target: "Workshop", foregroundDecisionId: expect.stringMatching(/^foreground:/) });
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0][0].maxOutputTokens).toBeLessThanOrEqual(1800);
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toHaveLength(0);
});

test("default cognition cycle does not await or create multi-step plans", async () => {
  const f = fixture(true); generate.mockResolvedValue(decision);
  await runCognitionCycle(f.world, createSystemRegistry(), { tick: 3, agentEids: [f.actor] });
  expect(generate).toHaveBeenCalledTimes(1);
  expect(getRelationTargets(f.world, f.actor, HasPlan)).toHaveLength(0);
});

test("held subconscious goal formation does not block an immediate decision and is single-flight", async () => {
  const f = fixture(); const slow = deferred<{ text: string }>();
  // Both requests begin from an actually sensed scene. Foreground sensing must
  // not be the first observation to contradict an empty background baseline.
  captureWorkingMemoryObservation(f.world, f.actor);
  generate.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(decision);
  expect(hasSubconsciousWork(f.world, f.actor, { enableReflection: false })).toBe(true);
  const background = runAgentSubconscious(f.world, f.actor, { enableReflection: false });
  await runAgentSubconscious(f.world, f.actor, { enableReflection: false });
  expect(generate).toHaveBeenCalledTimes(1);
  try {
    expect((await agentThink(f.world, f.actor)).type).toBe("observe");
    expect(getRelationTargets(f.world, f.actor, HasGoal)).toHaveLength(0);
  } finally {
    slow.resolve({ text: JSON.stringify({ description: "Inspect the workshop", motivation: "I want to understand it", priority: 5, kind: "explore" }) });
    await background;
  }
  expect(generate).toHaveBeenCalledTimes(2);
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toHaveLength(1);
});

test("held multi-step planning does not block foreground action selection", async () => {
  const f = fixture(true); const slow = deferred<any>(); generate.mockResolvedValue(decision);
  const background = runPlanningSystem(f.world, { agentEids: [f.actor], background: true, focusActiveGoal: true, planGenerator: () => slow.promise });
  try {
    expect((await agentThink(f.world, f.actor)).type).toBe("observe");
    expect(getRelationTargets(f.world, f.actor, HasPlan)).toHaveLength(0);
  } finally {
    slow.resolve({ goalDescription: "Investigate", estimatedCompletion: "short", potentialObstacles: [], steps: [{ description: "Look", actionType: "observe", target: "Workshop" }] });
    await background;
  }
  expect(getRelationTargets(f.world, f.actor, HasPlan)).toHaveLength(1);
});

function reflectionFixture() {
  const f = fixture(true); const state = initializeReflectionState(f.world, f.actor, 10);
  const memory = addMemory(f.world, f.actor, { content: "The alarm startled me.", type: "episodic", importance: 1, emotionalValence: -0.5, timestamp: Date.now() });
  return { ...f, state, memory };
}

test("real memories feed reflection; arriving experiences survive background completion without recursive self-evidence", async () => {
  const f = reflectionFixture(); const slow = deferred<{ text: string }>(); generate.mockReturnValue(slow.promise);
  expect(ReflectionState.importanceAccum[f.state]).toBe(10);
  const background = maybeReflect(f.world, f.actor);
  expect(await maybeReflect(f.world, f.actor)).toBe(false);
  addMemory(f.world, f.actor, { content: "I checked the alarm.", type: "episodic", importance: 0.7, emotionalValence: 0, timestamp: Date.now() });
  slow.resolve(historicalInsight(f.memory)); expect(await background).toBe(true);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(ReflectionState.importanceAccum[f.state]).toBe(7);
  expect(ReflectionState.reflectionCount[f.state]).toBe(1);
  expect(getAgentMemories(f.world, f.actor).map(eid => Memory.importance[eid])).toContain(0.75);
});

test.each(["deactivated", "removed evidence", "changed evidence", "disabled AI"])("reflection discards obsolete %s work", async change => {
  const f = reflectionFixture(); const slow = deferred<{ text: string }>(); generate.mockReturnValue(slow.promise);
  const background = maybeReflect(f.world, f.actor);
  if (change === "deactivated") Agent.active[f.actor] = false;
  if (change === "removed evidence") removeEntity(f.world, f.memory);
  if (change === "changed evidence") Memory.content[f.memory] = "A different memory";
  if (change === "disabled AI") f.world.meta.aiEnabled = false;
  slow.resolve(insight);
  expect(await background).toBe(false);
  expect(ReflectionState.reflectionCount[f.state]).toBe(0);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test("stopping a simulation prevents a late reflection from mutating it", async () => {
  const f = reflectionFixture(); const slow = deferred<{ text: string }>(); generate.mockReturnValue(slow.promise);
  const abort = new AbortController();
  const background = withSimulationTask(abort.signal, () => maybeReflect(f.world, f.actor));
  abort.abort(); slow.resolve(insight);
  await expect(background).rejects.toThrow();
  expect(ReflectionState.reflectionCount[f.state]).toBe(0);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test("malformed reflection is rejected with retry backoff, not partial memory mutations", async () => {
  const f = reflectionFixture(); generate.mockResolvedValue({ text: JSON.stringify({ insights: [{ insight: "Invented certainty", importance: "high", category: "world" }] }) });
  expect(await maybeReflect(f.world, f.actor)).toBe(false);
  expect(getAgentMemories(f.world, f.actor)).toHaveLength(1);
  expect(hasPendingReflection(f.world, f.actor)).toBe(false);
});

test("a malformed reflection cannot consume accumulated experience", async () => {
  const f = reflectionFixture(); generate.mockResolvedValue({ text: '{"insights":[]}' });
  expect(await maybeReflect(f.world, f.actor)).toBe(false);
  expect(ReflectionState.importanceAccum[f.state]).toBe(10);
  expect(ReflectionState.reflectionCount[f.state]).toBe(0);
});

test("corrupt restored insight history cannot cause a partial reflection commit", async () => {
  const f = reflectionFixture(); ReflectionState.insights[f.state] = "not-json";
  generate.mockResolvedValue(insight);
  expect(await maybeReflect(f.world, f.actor)).toBe(true);
  expect(getAgentMemories(f.world, f.actor)).toHaveLength(2);
  expect(JSON.parse(ReflectionState.insights[f.state])).toHaveLength(1);
  expect(ReflectionState.reflectionCount[f.state]).toBe(1);
});

test("pruning an unused old memory while reflecting does not discard useful work", async () => {
  const f = reflectionFixture();
  for (let i = 0; i < 49; i++) addMemory(f.world, f.actor, { content: `Unimportant old memory ${i}`, type: "episodic", importance: 0.01, emotionalValence: 0, timestamp: 1 });
  const before = getAgentMemories(f.world, f.actor);
  const slow = deferred<{ text: string }>(); generate.mockReturnValue(slow.promise);
  const background = maybeReflect(f.world, f.actor);
  addMemory(f.world, f.actor, { content: "A fresh relevant observation", type: "episodic", importance: 0.8, emotionalValence: 0, timestamp: Date.now() });
  expect(before.filter(eid => !getAgentMemories(f.world, f.actor).includes(eid))).toHaveLength(1);
  slow.resolve(historicalInsight(f.memory));
  expect(await background).toBe(true);
  expect(ReflectionState.importanceAccum[f.state]).toBeCloseTo(8);
});

test("AI-disabled worlds do not launch subconscious model work even with a key and pending reflection", async () => {
  const f = reflectionFixture(); f.world.meta.aiEnabled = false;
  expect(hasSubconsciousWork(f.world, f.actor)).toBe(false);
  await runAgentSubconscious(f.world, f.actor);
  expect(await maybeReflect(f.world, f.actor)).toBe(false);
  expect(generate).not.toHaveBeenCalled();
});
