import { jest } from "@jest/globals";
import { addComponent, addEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, ObjectState, Plan } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { setLocatedIn } from "../../ecs/location";
import { advancePlanStep, createPlanEntity, formatPlansForContext, getNextPlannedAction, hasActionablePlannedStep,
  runPlanningSystem, getPlanForGoal, type GeneratedPlan, type PlanStep } from "../planning-system";
import { captureWorkingMemoryAction, captureWorkingMemoryObservation, recordWorkingMemoryAction } from "../working-memory-observation";
import { getWorkingMemory } from "../working-memory";
import { recordCommittedSpeech } from "../social-memory";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { compileCompletedPlanToProceduralMacro, compileSuccessfulGoalActionsToProceduralMacro } from "../plan-compiler";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { recordInspectionResult } from "../inspection-memory";
import { deserializeWorld, serializeWorld } from "../../persistence/world-persistence";

function fixture() {
  const world = createArgosWorld("Evidence boundaries"); initializePrefabs(world); world.meta.aiEnabled = true;
  const room = createRoomEntity(world, { name: "Room" }), remote = createRoomEntity(world, { name: "Remote" });
  const actor = createAgentEntity(world, { name: "Aster", role: "resident", systemPrompt: "Reason from evidence.", roomId: room });
  const other = createAgentEntity(world, { name: "Fern", role: "resident", systemPrompt: "Be helpful.", roomId: room });
  const lamp = createObjectEntity(world, { name: "Signal lamp", roomId: room, portable: false });
  ObjectState.current[lamp] = "dark";
  const goal = addEntity(world); addComponent(world, goal, Goal); addComponent(world, actor, HasGoal(goal));
  Goal.description[goal] = "Prepare Signal lamp"; Goal.kind[goal] = "custom"; Goal.status[goal] = "active";
  Goal.priority[goal] = 5; Goal.progress[goal] = 0; Goal.createdAt[goal] = Date.now(); Goal.paramsJson[goal] = "{}";
  Goal.successJson[goal] = JSON.stringify({ type: "custom", description: "No automatic criterion" });
  registerAgentWorldCapabilities(world, actor, { context: () => "", ready: () => true, busy: () => false, execute: () => false,
    affordances: target => target === lamp ? [{ name: "light", description: "Light lamp", requires: [] }] : [] });
  captureWorkingMemoryObservation(world, actor);
  const proposal = (steps: PlanStep[]): GeneratedPlan => ({ goalDescription: Goal.description[goal], steps, estimatedCompletion: "short", potentialObstacles: [] });
  const create = (steps: PlanStep[]) => createPlanEntity(world, actor, goal, proposal(steps));
  return { world, room, remote, actor, other, lamp, goal, proposal, create };
}
const physicalWait: PlanStep = { description: "Wait for the visible signal", actionType: "wait",
  waitUntil: { kind: "physical_fact", subject: "Signal lamp", predicate: "state", slot: "ObjectState.current", equals: "lit" } };
const next: PlanStep = { description: "Now decide the next move", actionType: "think", content: "Consider my options." };
const light: PlanStep = { description: "Light the signal", actionType: "interact", target: "Signal lamp", content: "light" };
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(100_000); jest.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test("pending physical evidence retains its cursor without issuing waits or exposing successors", () => {
  const f = fixture(), id = f.create([physicalWait, next]);
  const before = Plan.steps[id];
  expect(hasActionablePlannedStep(f.world, f.actor)).toBe(false); expect(Plan.steps[id]).toBe(before);
  for (let i = 0; i < 4; i++) {
    expect(getNextPlannedAction(f.world, f.actor)).toBeNull();
    expect(advancePlanStep(id, { world: f.world, agentEid: f.actor })).toBe(false);
    expect(Plan.currentStep[id]).toBe(0); expect(Plan.status[id]).toBe("active");
  }
  expect(formatPlansForContext(f.world, f.actor)).not.toContain(next.description);
  expect(Goal.progress[f.goal]).toBe(0);
});

test("background preparation neither executes another goal nor prevents the selected wait from waking", async () => {
  const f = fixture(), highPlan = f.create([physicalWait, next]);
  expect(getNextPlannedAction(f.world, f.actor, { selectedGoalId: f.goal })).toBeNull();
  const lower = addEntity(f.world); addComponent(f.world, lower, Goal); addComponent(f.world, f.actor, HasGoal(lower));
  Goal.description[lower] = "Consider another undertaking"; Goal.status[lower] = "active"; Goal.priority[lower] = 4;
  await runPlanningSystem(f.world, { agentEids: [f.actor], focusActiveGoal: true, background: true,
    planGenerator: async () => f.proposal([{ ...next, content: "A different undertaking" }]) });
  const lowerPlan = getPlanForGoal(f.world, f.actor, lower)!;
  expect(lowerPlan).toBeDefined();
  expect(Plan.status[lowerPlan]).toBe("active");
  expect(getNextPlannedAction(f.world, f.actor, { selectedGoalId: f.goal })).toBeNull();
  expect(Plan.currentStep[lowerPlan]).toBe(0);
  expect(Plan.currentStep[highPlan]).toBe(0);
  ObjectState.current[f.lamp] = "lit";
  expect(getNextPlannedAction(f.world, f.actor, { selectedGoalId: f.goal })).toMatchObject({ actionType: "think", currentStep: 1 });
  expect(Plan.currentStep[lowerPlan]).toBe(0);
  expect(Goal.progress[f.goal]).toBe(0);
});

test("fresh local sensing, not a turn count, releases a physical barrier", () => {
  const f = fixture(), id = f.create([physicalWait, next]); getNextPlannedAction(f.world, f.actor);
  const receipts = getWorkingMemory(f.world, f.actor).receipts.length;
  jest.setSystemTime(101_000); ObjectState.current[f.lamp] = "lit";
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ actionType: "think", currentStep: 1 });
  expect(JSON.parse(Plan.steps[id])[0].resolution.kind).toBe("evidence_barrier");
  expect(getWorkingMemory(f.world, f.actor).receipts.filter(r => r.kind === "action")).toHaveLength(0);
  expect(getWorkingMemory(f.world, f.actor).receipts.length).toBeGreaterThanOrEqual(receipts);
  expect(Goal.status[f.goal]).toBe("active");
});

test("an already true but locally visible condition can be sensed immediately", () => {
  const f = fixture(); ObjectState.current[f.lamp] = "lit"; f.create([physicalWait, next]);
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ actionType: "think", currentStep: 1 });
});

test("a hidden change or stale remembered match does not release the barrier", () => {
  const f = fixture(); ObjectState.current[f.lamp] = "lit"; captureWorkingMemoryObservation(f.world, f.actor);
  setLocatedIn(f.world, f.actor, f.remote); const id = f.create([physicalWait, next]);
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull(); expect(Plan.currentStep[id]).toBe(0);
  ObjectState.current[f.lamp] = "dark"; jest.setSystemTime(101_000); ObjectState.current[f.lamp] = "lit";
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull(); expect(Plan.currentStep[id]).toBe(0);
});

test("hearing even a confident claim requests fresh cognition and never releases physical successors", () => {
  const f = fixture(), id = f.create([physicalWait, next]); getNextPlannedAction(f.world, f.actor);
  jest.setSystemTime(101_000); recordCommittedSpeech(f.world, f.other, "The Signal lamp is definitely lit. Go ahead.", "Aster");
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull(); expect(Plan.status[id]).toBe("failed");
  expect(Plan.currentStep[id]).toBe(0); expect(Goal.progress[f.goal]).toBe(0);
});

test.each([undefined, { kind: "heard_evidence" as const, speaker: "Fern" }])("untyped and heard waits truncate speculative continuations (%j)", waitUntil => {
  const f = fixture(), id = f.create([{ description: "Wait until we know", actionType: "wait", waitUntil }, light]);
  expect(JSON.parse(Plan.steps[id])).toHaveLength(1);
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull();
  jest.setSystemTime(101_000); recordCommittedSpeech(f.world, f.other, "I don't know yet.", "Aster");
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull(); expect(Plan.status[id]).toBe("failed");
});

test("timeout is a failed premise requiring reconsideration, not success", () => {
  const f = fixture(), id = f.create([physicalWait, next]); getNextPlannedAction(f.world, f.actor);
  jest.setSystemTime(115_000);
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull(); expect(Plan.status[id]).toBe("active");
  advanceSimulationTime(f.world, 1, 15_000);
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull(); expect(Plan.status[id]).toBe("failed");
  expect(JSON.parse(Plan.steps[id])[0].evidenceWaitReason).toBe("timeout"); expect(Plan.currentStep[id]).toBe(0);
});

test("model-supplied barrier tokens/scopes/resolutions cannot authorize a step", () => {
  const f = fixture(), id = f.create([{ ...physicalWait, evidenceScope: "fake", evidenceBarrier: { id: "fake" }, evidenceWaitReason: "success",
    resolution: { kind: "evidence_barrier", sourceId: "fake", resolvedAt: 1, summary: "done" } }, next]);
  const step = JSON.parse(Plan.steps[id])[0];
  expect(step.evidenceScope).not.toBe("fake"); expect(step.evidenceBarrier).toBeUndefined(); expect(step.resolution).toBeUndefined();
  expect(step.evidenceWaitReason).toBeUndefined(); expect(getNextPlannedAction(f.world, f.actor)).toBeNull();
});

test("restored opaque tokens require reconsideration instead of acquiring authority", () => {
  const f = fixture(), id = f.create([physicalWait, next]); getNextPlannedAction(f.world, f.actor);
  const saved = JSON.parse(JSON.stringify(serializeWorld(f.world, createSystemRegistry())));
  const restored = createArgosWorld("Restored barriers"); initializePrefabs(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved);
  const actor = oldToNewId.get(f.actor)!, plan = oldToNewId.get(id)!;
  expect(getNextPlannedAction(restored, actor)).toBeNull(); expect(Plan.status[plan]).toBe("failed");
  expect(Plan.currentStep[plan]).toBe(0);
});

test("flat macro learning cannot erase conditional waits from plans or surrounding action histories", () => {
  const f = fixture(), id = f.create([physicalWait, light, next]);
  Plan.status[id] = "completed"; Goal.status[f.goal] = "completed";
  expect(compileCompletedPlanToProceduralMacro(f.world, f.actor, f.goal, id)).toMatchObject({ ok: false });
  expect(compileSuccessfulGoalActionsToProceduralMacro(f.world, f.actor, f.goal, [
    { type: "interact", target: "Signal lamp", content: "light" }, { type: "move", target: "Remote" },
  ] as any)).toMatchObject({ ok: false, reason: "evidence waits require a condition-preserving procedure format" });
});

test("a matching actual action during background generation resolves once, without rerunning or goal credit", async () => {
  const f = fixture(); let deliver!: (plan: GeneratedPlan) => void;
  const pending = new Promise<GeneratedPlan>(resolve => { deliver = resolve; });
  const running = runPlanningSystem(f.world, { agentEids: [f.actor], planGenerator: () => pending });
  const action = { type: "interact", target: "Signal lamp", content: "light" };
  const before = captureWorkingMemoryAction(f.world, f.actor, action as any);
  jest.setSystemTime(101_000); ObjectState.current[f.lamp] = "lit";
  recordWorkingMemoryAction(f.world, f.actor, action as any, true, { before });
  deliver(f.proposal([light, { ...light, description: "Deliberately signal a second time" }, next])); await running;
  const id = getPlanForGoal(f.world, f.actor, f.goal)!;
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ actionType: "interact", currentStep: 1 });
  expect(JSON.parse(Plan.steps[id])[0].resolution.kind).toBe("action_evidence");
  expect(JSON.parse(Plan.steps[id])[1].resolution).toBeUndefined(); expect(Goal.progress[f.goal]).toBe(0);
});

test("explicit repeated inspections are not silently covered from old evidence", () => {
  const f = fixture(); recordInspectionResult(f.world, f.actor, f.lamp);
  f.create([{ description: "Look again", actionType: "observe", target: "Signal lamp", repeat: true }]);
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ actionType: "observe" });
});

test("an inspection from before an evidence barrier cannot satisfy the post-barrier inspection", () => {
  const f = fixture(); ObjectState.current[f.lamp] = "lit"; recordInspectionResult(f.world, f.actor, f.lamp);
  f.create([physicalWait, { description: "Inspect after the condition", actionType: "observe", target: "Signal lamp" }]);
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ actionType: "observe", currentStep: 1 });
});

test("an earlier unconditional plan fragment cannot bypass conditional episode compilation refusal", () => {
  const f = fixture(), old = f.create([light, next]); Plan.status[old] = "completed";
  f.create([physicalWait, next]); Goal.status[f.goal] = "completed";
  expect(compileCompletedPlanToProceduralMacro(f.world, f.actor, f.goal, old)).toMatchObject({ ok: false,
    reason: "evidence waits require a condition-preserving procedure format" });
});

test("a receipt for an actually executed earlier occurrence cannot cover a later identical step", () => {
  const f = fixture(), id = f.create([light, { ...light, description: "Signal again" }, next]);
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ currentStep: 0, actionType: "interact" });
  const action = { type: "interact", target: "Signal lamp", content: "light" } as const;
  const before = captureWorkingMemoryAction(f.world, f.actor, action);
  jest.setSystemTime(101_000); ObjectState.current[f.lamp] = "lit";
  recordWorkingMemoryAction(f.world, f.actor, action, true, { before }); advancePlanStep(id);
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ currentStep: 1, actionType: "interact" });
  expect(JSON.parse(Plan.steps[id])[1].resolution).toBeUndefined();
});
