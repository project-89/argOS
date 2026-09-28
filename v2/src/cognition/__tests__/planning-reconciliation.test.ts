import { jest } from "@jest/globals";
import { addComponent, addEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, GoalLifecycle, ObjectState, PendingToolJob, Plan, WorkingMemoryIdentity } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { setLocatedIn } from "../../ecs/location";
import { advancePlanStep, createPlanEntity, getNextPlannedAction, hasActionablePlannedStep, hasPendingPlanning,
  formatPlansForContext, reconcileCurrentPlan, runPlanningSystem, type GeneratedPlan, type PlanStep } from "../planning-system";
import { captureWorkingMemoryAction, captureWorkingMemoryObservation, recordWorkingMemoryAction } from "../working-memory-observation";
import { recordInspectionResult, refreshKnownInspectionEvidence } from "../inspection-memory";
import { getWorkingMemory } from "../working-memory";
import { recordCommittedSpeech } from "../social-memory";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { maintainGoalLifecycles } from "../goal-lifecycle";
import { compileCompletedPlanToProceduralMacro } from "../plan-compiler";
import { expireStaleGoals } from "../autonomous-goals";
import { integrateActorContinuation } from "../actor-continuation";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { deserializeWorld, serializeWorld } from "../../persistence/world-persistence";

function fixture() {
  const world = createArgosWorld("Reconciled plans"); initializePrefabs(world); world.meta.aiEnabled = true;
  const room = createRoomEntity(world, { name: "Store Room" });
  const hall = createRoomEntity(world, { name: "Hall" });
  const actor = createAgentEntity(world, { name: "Sera", role: "resident", systemPrompt: "Reason from experience.", roomId: room });
  const other = createAgentEntity(world, { name: "Ivo", role: "resident", systemPrompt: "Be helpful.", roomId: room });
  const cupboard = createObjectEntity(world, { name: "Supply cupboard", roomId: room, portable: false });
  ObjectState.current[cupboard] = "open";
  const goal = addEntity(world); addComponent(world, goal, Goal); addComponent(world, actor, HasGoal(goal));
  Goal.description[goal] = "Inventory the Supply cupboard"; Goal.kind[goal] = "custom";
  Goal.status[goal] = "active"; Goal.priority[goal] = 5; Goal.progress[goal] = 0; Goal.createdAt[goal] = Date.now();
  Goal.paramsJson[goal] = "{}"; Goal.successJson[goal] = JSON.stringify({ type: "custom", description: "No success criterion" });
  const create = (steps: PlanStep[]) => createPlanEntity(world, actor, goal, { goalDescription: Goal.description[goal],
    steps, estimatedCompletion: "short", potentialObstacles: [] });
  return { world, actor, other, room, hall, cupboard, goal, create };
}
const inspect: PlanStep = { description: "Inspect the cupboard", actionType: "observe", target: "Supply cupboard" };
const consider: PlanStep = { description: "Choose what to do with the result", actionType: "think", content: "What can I make from the supplies?" };
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(100_000); jest.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test("new personally observed evidence retires inspection wording from context without executing or completing it", () => {
  const f = fixture(); captureWorkingMemoryObservation(f.world, f.actor);
  const id = f.create([inspect, consider]);
  expect(formatPlansForContext(f.world, f.actor)).toContain("Current: Inspect the cupboard");
  ObjectState.current[f.cupboard] = "closed";
  // Hidden world mutations do not become knowledge merely by formatting plans.
  expect(formatPlansForContext(f.world, f.actor)).toContain("Current: Inspect the cupboard");
  captureWorkingMemoryObservation(f.world, f.actor);
  const before = getWorkingMemory(f.world, f.actor), steps = Plan.steps[id];
  const context = formatPlansForContext(f.world, f.actor);
  expect(context).toContain("saved inspection was proposed against earlier evidence");
  expect(context).not.toContain("Current: Inspect the cupboard");
  expect(context).not.toContain("Next: Choose what to do");
  expect(Plan.steps[id]).toBe(steps); expect(Plan.currentStep[id]).toBe(0);
  expect(Plan.status[id]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  expect(getWorkingMemory(f.world, f.actor)).toEqual(before);
});

test("an own manipulation overtakes the stored inspection in both prompt and plan execution", () => {
  const f = fixture(); captureWorkingMemoryObservation(f.world, f.actor);
  const id = f.create([inspect, consider]);
  const action = { type: "interact" as const, target: "Supply cupboard", content: "close" };
  const beforeAction = captureWorkingMemoryAction(f.world, f.actor, action);
  ObjectState.current[f.cupboard] = "closed";
  recordWorkingMemoryAction(f.world, f.actor, action, true, { before: beforeAction, summary: "Closed the cupboard." });
  const memory = getWorkingMemory(f.world, f.actor);
  expect(formatPlansForContext(f.world, f.actor)).toContain("stored step needs reconsideration");
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull();
  expect(Plan.status[id]).toBe("failed"); expect(Goal.progress[f.goal]).toBe(0);
  expect(getWorkingMemory(f.world, f.actor)).toEqual(memory);
});

test("room-level search cannot slip in after an attributed pickup toward the same purpose", () => {
  const f = fixture();
  const item = createObjectEntity(f.world, { name: "Sera's device", roomId: f.room, portable: true });
  Goal.description[f.goal] = "Check my device";
  addComponent(f.world, f.goal, WorkingMemoryIdentity); WorkingMemoryIdentity.id[f.goal] = "goal:device";
  captureWorkingMemoryObservation(f.world, f.actor);
  const id = f.create([{ actionType: "observe", target: "Store Room", description: "Look around to locate my device", assessmentOutcomeId: "forged" }]);
  expect(JSON.parse(Plan.steps[id])[0].assessmentOutcomeId).toBe("");
  integrateActorContinuation(f.world, f.actor, { purpose: "Check the notification", goalId: f.goal,
    goalKey: "goal:device", actionType: "pickup", target: "Sera's device", observedAtSimMs: f.world.time.elapsed });
  const action = { type: "pickup" as const, target: "Sera's device" };
  const before = captureWorkingMemoryAction(f.world, f.actor, action);
  setLocatedIn(f.world, item, f.actor);
  recordWorkingMemoryAction(f.world, f.actor, action, true, { before, summary: "Device picked up." });
  expect(getWorkingMemory(f.world, f.actor).receipts.at(-1)?.executionContext?.intention?.key).toBe("goal:device");
  expect(formatPlansForContext(f.world, f.actor)).not.toContain("Current: Look around");
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull();
  expect(Plan.status[id]).toBe("failed"); expect(Goal.progress[f.goal]).toBe(0);
  // A fresh inspection deliberately proposed after that outcome still works.
  f.create([{ actionType: "observe", target: "Store Room", description: "Check the room now" }]);
  expect(getNextPlannedAction(f.world, f.actor)?.actionType).toBe("observe");
});

test("refreshes of the same facts and unrelated dialogue do not suppress a current inspection", () => {
  const f = fixture(); captureWorkingMemoryObservation(f.world, f.actor); f.create([inspect]);
  jest.setSystemTime(101_000); captureWorkingMemoryObservation(f.world, f.actor);
  recordCommittedSpeech(f.world, f.other, "What a pleasant day.", "Sera");
  expect(formatPlansForContext(f.world, f.actor)).toContain("Current: Inspect the cupboard");
});

test("legacy inspection drafts without a bound premise are shown for reconsideration, not as current steps", () => {
  const f = fixture(), id = f.create([inspect]);
  captureWorkingMemoryObservation(f.world, f.actor);
  const steps = JSON.parse(Plan.steps[id]); delete steps[0].workingMemoryDependency;
  Plan.steps[id] = JSON.stringify(steps);
  expect(formatPlansForContext(f.world, f.actor)).toContain("saved inspection was proposed against earlier evidence");
  expect(Plan.status[id]).toBe("active");
});

test("a covered inspection is not re-presented as current work, and explicit repeat remains available", () => {
  const f = fixture(); recordInspectionResult(f.world, f.actor, f.cupboard);
  const id = f.create([inspect, consider]), before = Plan.steps[id];
  expect(formatPlansForContext(f.world, f.actor)).toContain("existing owned inspection covers");
  expect(formatPlansForContext(f.world, f.actor)).not.toContain("Current: Inspect the cupboard");
  expect(Plan.steps[id]).toBe(before); expect(Plan.currentStep[id]).toBe(0);
  const repeated = f.create([{ ...inspect, repeat: true }]);
  expect(formatPlansForContext(f.world, f.actor)).toContain("Current: Inspect the cupboard");
  expect(Plan.currentStep[repeated]).toBe(0);
});

test("an existing self arrival is reconciled without pretending to execute a move", () => {
  const f = fixture(), id = f.create([{ description: "Go into Store Room", actionType: "move", target: "Store Room" }, consider]);
  expect(hasActionablePlannedStep(f.world, f.actor, { urgentOnly: true })).toBe(false);
  expect(Plan.currentStep[id]).toBe(0); // Readiness is pure.
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ actionType: "think", currentStep: 1 });
  expect(JSON.parse(Plan.steps[id])[0].resolution.kind).toBe("already_here");
  expect(getWorkingMemory(f.world, f.actor).receipts).toHaveLength(0);
  expect(Goal.progress[f.goal]).toBe(0);
});

test("a future return trip is not skipped before its intervening move executes", () => {
  const f = fixture(), id = f.create([{ description: "Go to Hall", actionType: "move", target: "Hall" },
    { description: "Return to Store Room", actionType: "move", target: "Store Room" }]);
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ target: "Hall", currentStep: 0 });
  setLocatedIn(f.world, f.actor, f.hall);
  // A matched movement completion carries the same actor/world context as the executor.
  advancePlanStep(id, { world: f.world, agentEid: f.actor });
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ target: "Store Room", currentStep: 1 });
});

test("only admitted inspection evidence covers a repeated inspection", () => {
  const f = fixture(), id = f.create([inspect, consider]);
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ actionType: "observe" });
  const receipt = recordInspectionResult(f.world, f.actor, f.cupboard)!;
  const count = getWorkingMemory(f.world, f.actor).receipts.length;
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ actionType: "think", currentStep: 1 });
  expect(JSON.parse(Plan.steps[id])[0].resolution.sourceId).toBe(receipt.sourceId);
  expect(getWorkingMemory(f.world, f.actor).receipts).toHaveLength(count);
  expect(Goal.status[f.goal]).toBe("active");
});

test("new questions and physical interactions are not satisfied by a general inspection", () => {
  const f = fixture(); recordInspectionResult(f.world, f.actor, f.cupboard);
  f.create([{ ...inspect, content: "Are there signs of termites?" }]);
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ content: "Are there signs of termites?" });
  const unregister = registerAgentWorldCapabilities(f.world, f.actor, {
    context: () => "", ready: () => true, busy: () => false, execute: () => false,
    affordances: target => target === f.cupboard ? [{ name: "clean", description: "Clean the cupboard", requires: [] }] : [],
  });
  try {
    const id = f.create([{ description: "Clean the cupboard", actionType: "interact", target: "Supply cupboard", content: "clean" }]);
    expect(reconcileCurrentPlan(f.world, f.actor, id)).toBe(0);
    expect(Plan.currentStep[id]).toBe(0); expect(Plan.status[id]).toBe("active");
  } finally { unregister(); }
});

test("pending and failed work never advances through reconciliation", () => {
  const f = fixture(), id = f.create([inspect]);
  addComponent(f.world, f.actor, PendingToolJob);
  recordInspectionResult(f.world, f.actor, f.cupboard);
  expect(reconcileCurrentPlan(f.world, f.actor, id)).toBe(0); expect(Plan.currentStep[id]).toBe(0);
  Plan.status[id] = "failed";
  expect(reconcileCurrentPlan(f.world, f.actor, id)).toBe(0); expect(Plan.status[id]).toBe("failed");
});

test("a wholly redundant proposal waits for evidence, not goal success or a two-second replan", async () => {
  const f = fixture(); recordInspectionResult(f.world, f.actor, f.cupboard);
  const id = f.create([inspect]); expect(getNextPlannedAction(f.world, f.actor)).toBeNull();
  expect(Plan.status[id]).toBe("awaiting_evidence"); expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  const generator = jest.fn(async (): Promise<GeneratedPlan> => ({ goalDescription: "Inspect", steps: [inspect], estimatedCompletion: "short", potentialObstacles: [] }));
  jest.setSystemTime(105_000);
  expect(hasPendingPlanning(f.world, f.actor)).toBe(false);
  await runPlanningSystem(f.world, { planGenerator: generator }); expect(generator).not.toHaveBeenCalled();
});

test("hidden changes and unrelated conversation do not wake an evidence-waiting plan", () => {
  const f = fixture(); recordInspectionResult(f.world, f.actor, f.cupboard); const id = f.create([inspect]);
  getNextPlannedAction(f.world, f.actor); setLocatedIn(f.world, f.actor, f.hall);
  ObjectState.current[f.cupboard] = "closed";
  expect(hasPendingPlanning(f.world, f.actor)).toBe(false);
  setLocatedIn(f.world, f.other, f.hall); jest.setSystemTime(105_000);
  recordCommittedSpeech(f.world, f.other, "The weather is peaceful.", "Sera");
  expect(hasPendingPlanning(f.world, f.actor)).toBe(false);
  expect(Plan.status[id]).toBe("awaiting_evidence");
  setLocatedIn(f.world, f.actor, f.room); refreshKnownInspectionEvidence(f.world, f.actor);
  expect(hasPendingPlanning(f.world, f.actor)).toBe(true);
});

test("new heard evidence and bounded freshness permit another look without erasing the old fact", () => {
  const f = fixture(); recordInspectionResult(f.world, f.actor, f.cupboard); f.create([inspect]); getNextPlannedAction(f.world, f.actor);
  jest.setSystemTime(102_000); recordCommittedSpeech(f.world, f.other, "I left tea in the Supply cupboard.", "Sera");
  expect(hasPendingPlanning(f.world, f.actor)).toBe(true);
  const id = f.create([inspect]); expect(reconcileCurrentPlan(f.world, f.actor, id)).toBe(0);
  expect(Plan.status[id]).toBe("active");
  const separate = fixture(); recordInspectionResult(separate.world, separate.actor, separate.cupboard);
  separate.create([inspect]); getNextPlannedAction(separate.world, separate.actor);
  jest.setSystemTime(162_001); expect(hasPendingPlanning(separate.world, separate.actor)).toBe(true);
});

test("an inspection completed while planning was in flight waits for foreground reconciliation", async () => {
  const f = fixture(); let resolve!: (plan: GeneratedPlan) => void;
  const pending = new Promise<GeneratedPlan>(done => { resolve = done; });
  const run = runPlanningSystem(f.world, { planGenerator: () => pending });
  recordInspectionResult(f.world, f.actor, f.cupboard);
  resolve({ goalDescription: "Inspect", steps: [inspect], estimatedCompletion: "short", potentialObstacles: [] }); await run;
  expect(hasPendingPlanning(f.world, f.actor)).toBe(false); expect(getNextPlannedAction(f.world, f.actor)).toBeNull();
  expect(hasPendingPlanning(f.world, f.actor)).toBe(false);
});

test("the model cannot forge reconciliation or execution identity metadata", () => {
  const f = fixture(), id = f.create([{ ...inspect, planEid: 999, goalEid: 999, currentStep: 9,
    resolution: { kind: "inspection", sourceId: "fake", resolvedAt: 1, summary: "Model claimed this happened" },
    awaitingEvidenceDependency: "fake" }]);
  const stored = JSON.parse(Plan.steps[id])[0];
  for (const field of ["resolution", "awaitingEvidenceDependency", "planEid", "goalEid", "currentStep"]) expect(stored[field]).toBeUndefined();
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ actionType: "observe", currentStep: 0 });
});

test.each(["observe", "examine", "inspect"])("plain interact/%s is the same executable visual step, including older plans", alias => {
  const f = fixture(), id = f.create([{ description: "Look inside", actionType: "interact", target: "Supply cupboard", content: alias }]);
  expect(JSON.parse(Plan.steps[id])[0]).toMatchObject({ actionType: "observe" });
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ actionType: "observe", target: "Supply cupboard" });
  Plan.steps[id] = JSON.stringify([{ description: "Look inside", actionType: "interact", target: "Supply cupboard", content: alias }]);
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ actionType: "observe", currentStep: 0 });
  expect(Plan.status[id]).toBe("active");
});

test("tool descriptions and commands with arguments are never rewritten into generic inspection", () => {
  const f = fixture(), id = f.create([{ description: "Describe an image", actionType: "interact", target: "Workstation", content: "describe_image cover.png" },
    { description: "Run an explicit inspect tool", actionType: "interact", target: "Workstation", content: "inspect process:42" }]);
  expect(JSON.parse(Plan.steps[id]).map((step: PlanStep) => step.actionType)).toEqual(["interact", "interact"]);
});

test("covered exploratory plans pause without a success claim or immortal waiting plan", () => {
  const f = fixture(); addComponent(f.world, f.goal, GoalLifecycle); GoalLifecycle.mode[f.goal] = "exploratory";
  GoalLifecycle.parentGoalEid[f.goal] = -1; GoalLifecycle.reviewAfter[f.goal] = 160_000;
  recordInspectionResult(f.world, f.actor, f.cupboard); const id = f.create([inspect]); getNextPlannedAction(f.world, f.actor);
  maintainGoalLifecycles(f.world, f.actor);
  expect(Goal.status[f.goal]).toBe("paused"); expect(Goal.progress[f.goal]).toBe(0); expect(Plan.status[id]).toBe("retired");
});

test("reconciled steps cannot be learned as executed procedural demonstrations", () => {
  const f = fixture(); recordInspectionResult(f.world, f.actor, f.cupboard); const id = f.create([inspect, consider]);
  getNextPlannedAction(f.world, f.actor); advancePlanStep(id); Goal.status[f.goal] = "completed";
  expect(compileCompletedPlanToProceduralMacro(f.world, f.actor, f.goal, id)).toEqual({ ok: false, reason: "plan includes reconciled rather than executed steps" });
});

test("reconciled cursors cannot indefinitely renew an impossible goal's progress clock", () => {
  const f = fixture(); expect(expireStaleGoals(f.world, f.actor, 60_000)).toBe(0);
  advanceSimulationTime(f.world, f.world.time.tick + 1, 50_000);
  jest.setSystemTime(150_000); f.create([{ description: "Enter Store Room", actionType: "move", target: "Store Room" }, consider]);
  getNextPlannedAction(f.world, f.actor); expect(expireStaleGoals(f.world, f.actor, 60_000)).toBe(0);
  advanceSimulationTime(f.world, f.world.time.tick + 1, 10_001);
  jest.setSystemTime(160_001); expect(expireStaleGoals(f.world, f.actor, 60_000)).toBe(1);
  expect(Goal.status[f.goal]).toBe("expired");
});

test.each(["active", "awaiting_evidence"])("goal inactivity expiration retires its %s draft without manufacturing progress", status => {
  const f = fixture(), id = f.create([inspect]);
  Plan.status[id] = status;
  expect(expireStaleGoals(f.world, f.actor, 60_000)).toBe(0);
  jest.setSystemTime(160_001);
  advanceSimulationTime(f.world, f.world.time.tick + 1, 60_001);
  expect(expireStaleGoals(f.world, f.actor, 60_000)).toBe(1);
  expect(Goal.status[f.goal]).toBe("expired"); expect(Plan.status[id]).toBe("retired");
  expect(Plan.currentStep[id]).toBe(0); expect(Goal.progress[f.goal]).toBe(0);
});

test("waiting-plan evidence and inspection identities survive a remapped save without replaying work", () => {
  const f = fixture(); recordInspectionResult(f.world, f.actor, f.cupboard);
  const id = f.create([inspect]); getNextPlannedAction(f.world, f.actor);
  const saved = JSON.parse(JSON.stringify(serializeWorld(f.world, createSystemRegistry())));
  const restored = createArgosWorld("Restored waiting plan"); initializePrefabs(restored);
  for (let i = 0; i < 12; i++) addEntity(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved);
  restored.meta.aiEnabled = true;
  const actor = oldToNewId.get(f.actor)!, plan = oldToNewId.get(id)!;
  expect(actor).not.toBe(f.actor); expect(Plan.status[plan]).toBe("awaiting_evidence");
  expect(hasPendingPlanning(restored, actor)).toBe(false); expect(getNextPlannedAction(restored, actor)).toBeNull();
});
