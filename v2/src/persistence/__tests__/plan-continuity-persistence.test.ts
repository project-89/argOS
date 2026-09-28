import { jest } from "@jest/globals";
import { addComponent, addEntity, getRelationTargets } from "bitecs";
import { createArgosWorld, type World } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, GoalLifecycle, Plan, ReflectionState, Schedule, ToolResult, WorkingMemoryIdentity } from "../../ecs/components";
import { HasGoal, HasPlan, HasReflectionState, HasSchedule, HasToolResult } from "../../ecs/relations";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { createIntentGoal, executeActions } from "../../cognition/cognition-system";
import { createPlanEntity, getAgentPlans, getNextPlannedAction, getPlanForGoal } from "../../cognition/planning-system";
import { getSocialDialogue, recordCommittedSpeech } from "../../cognition/social-memory";
import { getSchedule, initializeSchedule } from "../../cognition/schedule-system";
import { getReflectionState, initializeReflectionState } from "../../cognition/reflection-system";
import { setGoalContract } from "../../cognition/goal-contract";
import { evaluateGoalSuccessContract } from "../../systems/goal-evaluation-system";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { deserializeWorld, serializeWorld, type SerializedWorld } from "../world-persistence";

function fixture() {
  const world = createArgosWorld("Plan source"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Common Room" });
  const mara = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "Private Mara", roomId: room });
  const ivo = createAgentEntity(world, { name: "Ivo", role: "resident", systemPrompt: "Private Ivo", roomId: room });
  const goal = createIntentGoal(world, mara, "Inspect the room before deciding", 5);
  const registry = createSystemRegistry();
  const save = () => JSON.parse(JSON.stringify(serializeWorld(world, registry))) as SerializedWorld;
  return { world, room, mara, ivo, goal, registry, save };
}

function restore(data: SerializedWorld) {
  const world = createArgosWorld("Restored"); initializePrefabs(world);
  for (let i = 0; i < 12; i++) addEntity(world);
  const registry = createSystemRegistry();
  return { world, registry, ...deserializeWorld(world, registry, data) };
}

function plan(world: World, actor: number, goal: number, social = false) {
  return createPlanEntity(world, actor, goal, { goalDescription: Goal.description[goal],
    estimatedCompletion: "short", potentialObstacles: [], steps: social ? [
      { description: "Ask what Ivo needs", actionType: "speak", target: "Ivo", content: "What do you need?" },
    ] : [
      { description: "Look around", actionType: "observe", target: "Common Room" },
      { description: "Check a different question about the room", actionType: "observe", target: "Common Room", content: "Which exits are unobstructed?" },
    ] });
}

beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline persistence tests")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test("route origins survive entity remapping as stable room identities", () => {
  const f = fixture();
  const id = createPlanEntity(f.world, f.mara, f.goal, { goalDescription: "Walk through the room", estimatedCompletion: "short", potentialObstacles: [], steps: [
    { description: "Return here", actionType: "move", target: "Common Room" },
  ] });
  const origin = Plan.routeRoomKey[id];
  expect(origin).toBeTruthy();
  const restored = restore(f.save());
  const room = restored.oldToNewId.get(f.room)!;
  expect(room).not.toBe(f.room);
  expect(Plan.routeRoomKey[restored.oldToNewId.get(id)!]).toBe(origin);
  expect(WorkingMemoryIdentity.id[room]).toBe(origin);
});

test("a legacy saved plan does not acquire a route origin during restoration", () => {
  const f = fixture(), id = plan(f.world, f.mara, f.goal);
  const saved = f.save();
  delete saved.entities.find(entity => entity.id === id)!.components.Plan.routeRoomKey;
  const restored = restore(saved);
  expect(Plan.routeRoomKey[restored.oldToNewId.get(id)!]).toBeUndefined();
});

test("a partially executed plan resumes at the saved cursor under remapped actor/goal ownership", () => {
  const f = fixture();
  recordCommittedSpeech(f.world, f.ivo, "The window is open.", "Mara", Date.now());
  const id = plan(f.world, f.mara, f.goal);
  executeActions(f.world, [{ eid: f.mara, action: { type: "observe", target: "Common Room" } }], f.registry);
  expect(Plan.currentStep[id]).toBe(1);
  const heard = Plan.heardDialogueId[id];
  const dialogue = getSocialDialogue(f.world, f.mara);
  const restored = restore(f.save());
  const actor = restored.oldToNewId.get(f.mara)!;
  const goal = restored.oldToNewId.get(f.goal)!;
  const resumed = restored.oldToNewId.get(id)!;
  expect(goal).not.toBe(f.goal);
  expect(getRelationTargets(restored.world, actor, HasGoal)).toEqual([goal]);
  expect(getAgentPlans(restored.world, actor)).toEqual([resumed]);
  expect(getPlanForGoal(restored.world, actor, goal)).toBe(resumed);
  expect(Plan.goalEid[resumed]).toBe(goal);
  expect(Plan.currentStep[resumed]).toBe(1);
  expect(Plan.status[resumed]).toBe("active");
  expect(Plan.heardDialogueId[resumed]).toBe(heard);
  expect(getSocialDialogue(restored.world, actor)).toEqual(dialogue);
  expect(getNextPlannedAction(restored.world, actor)).toMatchObject({ currentStep: 1, planEid: resumed, goalEid: goal });
  executeActions(restored.world, [{ eid: actor, action: { type: "observe", target: "Common Room", content: "Which exits are unobstructed?" } }], restored.registry);
  expect(Plan.status[resumed]).toBe("completed");
  expect(Goal.status[goal]).toBe("active"); // Plan exhaustion is not objective proof.
  expect(Goal.progress[goal]).toBe(0); // Nor does it measure 90% of an open-ended objective.
});

test("restored social plans use saved heard evidence and retire after a new actual reply", () => {
  const f = fixture();
  recordCommittedSpeech(f.world, f.ivo, "Hello, Mara.", "Mara", Date.now());
  const id = plan(f.world, f.mara, f.goal, true);
  const restored = restore(f.save());
  const actor = restored.oldToNewId.get(f.mara)!;
  const other = restored.oldToNewId.get(f.ivo)!;
  const resumed = restored.oldToNewId.get(id)!;
  expect(getNextPlannedAction(restored.world, actor)?.actionType).toBe("speak");
  recordCommittedSpeech(restored.world, other, "I need the cloth.", "Mara", Date.now() + 1);
  expect(getNextPlannedAction(restored.world, actor)).toBeNull();
  expect(Plan.status[resumed]).toBe("failed");
  expect(Goal.status[restored.oldToNewId.get(f.goal)!]).toBe("active");
});

test.each(["active", "completed", "failed", "paused", "retired", "awaiting_evidence"])("loading preserves a valid owned plan's %s status without executing it", status => {
  const f = fixture(); const id = plan(f.world, f.mara, f.goal);
  Plan.status[id] = status; Plan.currentStep[id] = 1;
  const saved = f.save(); const restored = restore(saved);
  const resumed = restored.oldToNewId.get(id)!;
  expect(Plan.status[resumed]).toBe(status);
  expect(Plan.currentStep[resumed]).toBe(1);
  expect(getRelationTargets(restored.world, restored.oldToNewId.get(f.mara)!, HasPlan)).toEqual([resumed]);
  expect(Goal.status[restored.oldToNewId.get(f.goal)!]).toBe("active");
});

test.each(["missing_goal", "missing_plan", "foreign_owner", "legacy_no_link", "missing_heard", "missing_addressee"])(
  "invalid or incomplete saved plan context fails closed: %s", failure => {
    const f = fixture();
    const id = plan(f.world, f.mara, f.goal, true);
    // A same-name substitute is never a replacement for a saved identity.
    const unrelated = createIntentGoal(f.world, f.ivo, Goal.description[f.goal], 1);
    const saved = f.save();
    const owner = saved.entities.find(entity => entity.id === f.mara)!;
    if (failure === "missing_goal") saved.entities = saved.entities.filter(entity => entity.id !== f.goal);
    if (failure === "missing_plan") saved.entities = saved.entities.filter(entity => entity.id !== id);
    if (failure === "foreign_owner") {
      owner.relations = owner.relations.filter(relation => relation.type !== "HasGoal");
      owner.relations.push({ type: "HasGoal", targetId: unrelated, targetName: "unrelated" });
    }
    if (failure === "legacy_no_link") owner.relations = owner.relations.filter(relation => relation.type !== "HasPlan");
    if (failure === "missing_heard") delete saved.entities.find(entity => entity.id === id)!.components.Plan.heardDialogueId;
    if (failure === "missing_addressee") saved.entities = saved.entities.filter(entity => entity.id !== f.ivo);
    const restored = restore(saved);
    const actor = restored.oldToNewId.get(f.mara)!;
    expect(getNextPlannedAction(restored.world, actor)).toBeNull();
    if (["missing_goal", "missing_plan", "foreign_owner", "legacy_no_link"].includes(failure)) {
      expect(getRelationTargets(restored.world, actor, HasPlan)).toEqual([]);
    } else {
      expect(Plan.status[restored.oldToNewId.get(id)!]).toBe("failed");
    }
    if (failure === "missing_goal") {
      expect(Plan.goalEid[restored.oldToNewId.get(id)!]).toBe(-1);
      expect(Plan.status[restored.oldToNewId.get(id)!]).toBe("failed");
    }
    expect(Goal.status[restored.oldToNewId.get(unrelated)!]).toBe("active");
  });

test("daily schedules, reflection accumulation and simulation time remain attached to the original actor", () => {
  const f = fixture();
  Object.assign(f.world.time, { tick: 403, elapsed: 87_000, delta: 500, simulationDay: 9, simulationHour: 22.5, timeOfDay: "night" });
  const schedule = initializeSchedule(f.world, f.mara, [{ name: "reading", startHour: 22, duration: 2, priority: 3, interruptible: true }], 0.4);
  Schedule.currentActivity[schedule] = "reading";
  Schedule.nextTransition[schedule] = 24;
  const reflection = initializeReflectionState(f.world, f.mara, 80);
  ReflectionState.importanceAccum[reflection] = 47;
  ReflectionState.reflectionCount[reflection] = 3;
  ReflectionState.insights[reflection] = '["Ivo follows through on promises."]';
  const restored = restore(f.save());
  const actor = restored.oldToNewId.get(f.mara)!;
  const other = restored.oldToNewId.get(f.ivo)!;
  expect(getSchedule(restored.world, actor)).toBe(restored.oldToNewId.get(schedule));
  expect(Schedule.plannedDay[getSchedule(restored.world, actor)!]).toBe(9);
  expect(Schedule.currentActivity[getSchedule(restored.world, actor)!]).toBe("reading");
  expect(getReflectionState(restored.world, actor)).toBe(restored.oldToNewId.get(reflection));
  expect(ReflectionState.importanceAccum[getReflectionState(restored.world, actor)!]).toBe(47);
  expect(ReflectionState.insights[getReflectionState(restored.world, actor)!]).toContain("follows through");
  expect(getRelationTargets(restored.world, other, HasSchedule)).toEqual([]);
  expect(getRelationTargets(restored.world, other, HasReflectionState)).toEqual([]);
  expect(restored.world.time).toEqual({ tick: 403, elapsed: 87_000, delta: 0, simulationDay: 9, simulationHour: 22.5, timeOfDay: "night" });
});

test("append-only tool proof keeps its goal/device association, not merely its last-result cache", () => {
  const f = fixture();
  const device = createObjectEntity(f.world, { name: "Workstation", roomId: f.room });
  const otherGoal = createIntentGoal(f.world, f.mara, "A different task", 4);
  for (const goal of [f.goal, otherGoal]) setGoalContract(f.world, goal, {
    version: 1, kind: "custom", params: {}, success: { type: "tool_exit_code_equals", toolId: "terminal.run", equals: 0 },
  });
  const receipt = addEntity(f.world); addComponent(f.world, receipt, ToolResult);
  addComponent(f.world, f.mara, HasToolResult(receipt));
  Object.entries({ toolId: "terminal.run", command: "npm test", ok: true, exitCode: 0, stdout: "passed", stderr: "",
    summary: "Tests passed", timestamp: Date.now() + 1, goalEid: f.goal, deviceEid: device })
    .forEach(([field, value]) => (ToolResult as any)[field][receipt] = value);
  const saved = f.save();
  const restored = restore(saved);
  const actor = restored.oldToNewId.get(f.mara)!;
  const result = restored.oldToNewId.get(receipt)!;
  expect(getRelationTargets(restored.world, actor, HasToolResult)).toEqual([result]);
  expect(ToolResult.goalEid[result]).toBe(restored.oldToNewId.get(f.goal));
  expect(ToolResult.deviceEid[result]).toBe(restored.oldToNewId.get(device));
  expect(evaluateGoalSuccessContract(restored.world, actor, restored.oldToNewId.get(f.goal)!).satisfied).toBe(true);
  expect(evaluateGoalSuccessContract(restored.world, actor, restored.oldToNewId.get(otherGoal)!).satisfied).toBe(false);
  saved.entities = saved.entities.filter(entity => ![f.goal, device].includes(entity.id));
  const partial = restore(saved);
  const orphan = partial.oldToNewId.get(receipt)!;
  expect(ToolResult.goalEid[orphan]).toBe(-1);
  expect(ToolResult.deviceEid[orphan]).toBe(-1);
  expect(evaluateGoalSuccessContract(partial.world, partial.oldToNewId.get(f.mara)!, partial.oldToNewId.get(otherGoal)!).satisfied).toBe(false);
});

test.each(["intact", "missing", "changed"])("generated goal parent identity is remapped without inventing satisfaction: %s", state => {
  const f = fixture();
  const child = createIntentGoal(f.world, f.mara, "Ask Ivo to help with the inspection", 4);
  addComponent(f.world, child, GoalLifecycle);
  GoalLifecycle.source[child] = "foreground";
  GoalLifecycle.mode[child] = "exploratory";
  GoalLifecycle.parentGoalEid[child] = f.goal;
  GoalLifecycle.parentCreatedAt[child] = Goal.createdAt[f.goal];
  GoalLifecycle.parentSignature[child] = Goal.signature[f.goal] || "";
  GoalLifecycle.reviewAfter[child] = Date.now() + 30_000;
  const saved = f.save();
  if (state === "missing") saved.entities = saved.entities.filter(entity => entity.id !== f.goal);
  if (state === "changed") saved.entities.find(entity => entity.id === f.goal)!.components.Goal.createdAt += 1;
  const restored = restore(saved);
  const goal = restored.oldToNewId.get(child)!;
  expect(GoalLifecycle.source[goal]).toBe("foreground");
  expect(GoalLifecycle.mode[goal]).toBe("exploratory");
  if (state === "intact") {
    expect(GoalLifecycle.parentGoalEid[goal]).toBe(restored.oldToNewId.get(f.goal));
    expect(Goal.status[goal]).toBe("active");
  } else {
    expect(GoalLifecycle.parentGoalEid[goal]).toBe(-1);
    expect(Goal.status[goal]).toBe("retired");
    expect(GoalLifecycle.reason[goal]).toContain("absent or changed");
    expect(Goal.progress[goal]).not.toBe(100);
  }
});
