import { addComponent, addEntity, getRelationTargets } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, LastAction, Plan, Schedule } from "../../ecs/components";
import { HasGoal, HasPlan, HasSchedule } from "../../ecs/relations";
import { createSystemRegistry, registerSystem, runSystems, type SystemDefinition } from "../../ecs/dynamic-systems";
import { createDayPlanActivationSystem, createDayPlanPreplannerSystem, createScheduledActivityGoalSystem, createScheduledActivityTemplatePlannerSystem } from "../scheduled-activity-systems";
import { evaluateGoalSuccessContract } from "../goal-evaluation-system";
import { setLocatedIn } from "../../ecs/location";
import { jest } from "@jest/globals";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { readStampedSimulationTime } from "../../ecs/temporal-age";
import { expireStaleGoals, resetAutonomousGoals } from "../../cognition/autonomous-goals";
import { createGoalCleanupSystem } from "../builtin-systems";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { readGoalInactivityBudget } from "../../cognition/goal-inactivity-budget";

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(1_800_000_000_000); resetAutonomousGoals(); });
afterEach(() => jest.useRealTimers());

function fixture() {
  const world = createArgosWorld("Scheduled work truth"); initializePrefabs(world); world.time.simulationHour = 13;
  const room = createRoomEntity(world, { name: "Studio" });
  const actor = createAgentEntity(world, { name: "Ada", role: "writer", systemPrompt: "Choose your work.", roomId: room });
  const schedule = addEntity(world); addComponent(world, schedule, Schedule); addComponent(world, actor, HasSchedule(schedule));
  Schedule.activities[schedule] = JSON.stringify([{ name: "afternoon work", startHour: 13, duration: 4, location: "Studio", priority: 5 }]);
  const run = (system: SystemDefinition) => { const registry = createSystemRegistry(); registerSystem(registry, system);
    runSystems(world, registry, world.time.tick + 1, 500); expect(registry.errors).toEqual([]); };
  const goals = () => getRelationTargets(world, actor, HasGoal).filter(g => Goal.kind[g] === "scheduled_activity");
  return { world, actor, schedule, run, goals };
}
test("being in the scheduled room does not discard an unperformed work intention", () => {
  const f = fixture(); f.run(createScheduledActivityGoalSystem());
  expect(f.goals()).toHaveLength(1);
  const goal = f.goals()[0];
  expect(Goal.status[goal]).toBe("active");
  expect(evaluateGoalSuccessContract(f.world, f.actor, goal).satisfied).toBe(false);
});
test("powering on a computer or another arbitrary interaction does not finish four hours of work", () => {
  const f = fixture(); f.run(createDayPlanPreplannerSystem()); f.run(createDayPlanActivationSystem());
  const goal = f.goals()[0]; expect(goal).toBeDefined();
  addComponent(f.world, f.actor, LastAction);
  LastAction.type[f.actor] = "interact"; LastAction.target[f.actor] = "Laptop";
  LastAction.content[f.actor] = "power_on"; LastAction.success[f.actor] = true; LastAction.timestamp[f.actor] = Date.now() + 1;
  expect(evaluateGoalSuccessContract(f.world, f.actor, goal).satisfied).toBe(false);
  expect(JSON.stringify(JSON.parse(Goal.successJson[goal]))).toContain("productive_time");
});
test.each(["discovered", "queued", "queued-current"])("%s work survives the real inactivity cleaner until its bounded attempt ends", path => {
  const f = fixture();
  if (path !== "discovered") f.run(createDayPlanPreplannerSystem());
  f.run(path === "queued" ? createDayPlanActivationSystem() : createScheduledActivityGoalSystem());
  const goal = f.goals()[0];
  const budget = 4 * 3600_000 + 180_000;
  expect(Goal.deadline[goal] - Goal.createdAt[goal]).toBe(budget);
  const originalRoom = JSON.parse(Goal.paramsJson[goal]).roomName;
  const elsewhere = createRoomEntity(f.world, { name: "Street" }); setLocatedIn(f.world, f.actor, elsewhere);
  // Wall time is frozen; this is lived simulation time, not provider latency.
  advanceSimulationTime(f.world, f.world.time.tick + 1, 120_001);
  expect(expireStaleGoals(f.world, f.actor)).toBe(0);
  f.run(createScheduledActivityGoalSystem());
  expect(f.goals()).toEqual([goal]); expect(JSON.parse(Goal.paramsJson[goal]).roomName).toBe(originalRoom);
  advanceSimulationTime(f.world, f.world.time.tick + 1, budget - 120_002);
  expect(expireStaleGoals(f.world, f.actor)).toBe(0);
  expect(Goal.status[goal]).toBe("active"); expect(Goal.progress[goal]).toBe(0);
  expect(evaluateGoalSuccessContract(f.world, f.actor, goal).satisfied).toBe(false);
  advanceSimulationTime(f.world, f.world.time.tick + 1, 1);
  f.run(createGoalCleanupSystem());
  expect(Goal.status[goal]).toBe("failed"); // Deadline is still an upper bound, never success.
});

test("scheduled inactivity policy and its original remaining time survive remapped save/restore", () => {
  const f = fixture(); f.run(createScheduledActivityGoalSystem()); const original = f.goals()[0];
  advanceSimulationTime(f.world, 1, 120_001); expect(expireStaleGoals(f.world, f.actor)).toBe(0);
  const saved = JSON.parse(JSON.stringify(serializeWorld(f.world, createSystemRegistry())));
  jest.setSystemTime(Date.now() + 30 * 86_400_000);
  const restored = createArgosWorld(); addEntity(restored);
  const ids = deserializeWorld(restored, createSystemRegistry(), saved).oldToNewId;
  const goal = ids.get(original)!, actor = ids.get(f.actor)!;
  expect(readGoalInactivityBudget(restored, goal, 120_000)).toBe(4 * 3600_000 + 180_000);
  expect(expireStaleGoals(restored, actor)).toBe(0);
  advanceSimulationTime(restored, restored.time.tick + 1, 4 * 3600_000 + 180_001 - restored.time.elapsed);
  expect(expireStaleGoals(restored, actor)).toBe(1);
  expect(Goal.status[goal]).toBe("expired"); expect(Goal.progress[goal]).toBe(0);
});

test.each(["discovered", "queued", "queued-current"])("%s late activation stamps the final duration from activation, not the world epoch", path => {
  const f = fixture();
  if (path !== "discovered") f.run(createDayPlanPreplannerSystem());
  advanceSimulationTime(f.world, 1, 90_000);
  f.run(path === "queued" ? createDayPlanActivationSystem() : createScheduledActivityGoalSystem());
  const goal = f.goals()[0];
  expect(readStampedSimulationTime(f.world, goal, "Goal.createdAt", Goal.createdAt[goal])).toBe(90_000);
  expect(readStampedSimulationTime(f.world, goal, "Goal.deadline", Goal.deadline[goal])).toBe(90_000 + 4 * 3600_000 + 180_000);
});

test("preplanning after current-activity admission does not duplicate the same active work slot", () => {
  const f = fixture(); f.run(createScheduledActivityGoalSystem()); f.run(createDayPlanPreplannerSystem()); f.run(createDayPlanActivationSystem());
  expect(f.goals()).toHaveLength(1);
});

test.each(["active", "paused"])("walking to another room cannot clone an existing %s scheduled work slot", status => {
  const f = fixture();
  Schedule.activities[f.schedule] = JSON.stringify([{ name: "afternoon work", startHour: 13, duration: 4, priority: 5 }]);
  f.run(createScheduledActivityGoalSystem()); const original = f.goals()[0]; Goal.status[original] = status;
  const otherRoom = createRoomEntity(f.world, { name: "Kitchen" }); setLocatedIn(f.world, f.actor, otherRoom);
  f.run(createScheduledActivityGoalSystem());
  expect(f.goals()).toEqual([original]); expect(Goal.status[original]).toBe(status);
  expect(JSON.parse(Goal.paramsJson[original]).roomName).toBe("Studio");
});

test("missing productive work does not generate repeated observe-yourself work plans", () => {
  const f = fixture(); f.run(createScheduledActivityGoalSystem());
  for (let i = 0; i < 4; i++) {
    f.run(createScheduledActivityTemplatePlannerSystem());
    for (const id of getRelationTargets(f.world, f.actor, HasPlan)) Plan.status[id] = "failed";
  }
  expect(getRelationTargets(f.world, f.actor, HasPlan)).toHaveLength(0);
  expect(Goal.status[f.goals()[0]]).toBe("active");
});

test("a legacy saved room-plus-interaction work contract no longer accepts power-on as completion", () => {
  const f = fixture(); f.run(createDayPlanPreplannerSystem()); f.run(createDayPlanActivationSystem());
  const goal = f.goals()[0];
  const legacy = JSON.stringify({ type: "all_of", conditions: [
    { type: "in_room", roomName: "Studio" }, { type: "did_action_type", actionType: "interact" },
  ] });
  Goal.successJson[goal] = legacy;
  addComponent(f.world, f.actor, LastAction);
  LastAction.type[f.actor] = "interact"; LastAction.target[f.actor] = "Laptop";
  LastAction.content[f.actor] = "power_on"; LastAction.success[f.actor] = true; LastAction.timestamp[f.actor] = Date.now() + 1;
  expect(evaluateGoalSuccessContract(f.world, f.actor, goal).satisfied).toBe(false);
  expect(Goal.successJson[goal]).toBe(legacy); // Evaluation does not mutate historical contracts.
});
