import { jest } from "@jest/globals";
import { addComponent, addEntity, getRelationTargets, removeEntity, entityExists } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, GoalLifecycle, Schedule, ScheduleLedger, WorkingMemoryIdentity, Plan, PendingToolJob } from "../../ecs/components";
import { HasGoal, HasSchedule, HasPlan } from "../../ecs/relations";
import { setLocatedIn } from "../../ecs/location";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { createSystemRegistry, registerSystem, runSystems, type SystemDefinition } from "../../ecs/dynamic-systems";
import { createDayPlanActivationSystem, createDayPlanPreplannerSystem, createScheduledActivityGoalSystem } from "../scheduled-activity-systems";
import { captureGoalReviewContext, prepareGoalReview, resumeDeferredGoals } from "../../cognition/goal-pursuit";
import { startCommittedEvents } from "../../runtime/committed-events";
import { workingMemoryEntityRef } from "../../cognition/working-memory";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { lookupScheduleOccurrence, scheduledGoalOccurrence, SCHEDULE_OCCURRENCE_LIMIT } from "../../cognition/schedule-occurrences";
import { getActivityForHour } from "../../cognition/schedule-system";
import { evaluateGoalSuccessContract } from "../goal-evaluation-system";
import { createGoalCleanupSystem } from "../builtin-systems";
import { bindSupportingGoal, retireGoalDependents } from "../../cognition/goal-dependents";

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(1_800_000_000_000); });
afterEach(() => jest.useRealTimers());
function fixture(interruptible = true, startAway = false) {
  const world = createArgosWorld("Schedule choice"); initializePrefabs(world); world.time.simulationHour = 13;
  startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Studio" });
  const street = createRoomEntity(world, { name: "Street" });
  const actor = createAgentEntity(world, { name: "Ada", role: "writer", systemPrompt: "Choose what matters.", roomId: startAway ? street : room });
  workingMemoryEntityRef(world, actor);
  const schedule = addEntity(world); addComponent(world, schedule, Schedule); addComponent(world, actor, HasSchedule(schedule));
  Schedule.activities[schedule] = JSON.stringify([{ name: "afternoon work", startHour: 13, duration: 4, priority: 5, interruptible, ...(startAway ? { location: "Studio" } : {}) }]);
  const run = (system: SystemDefinition) => runIn(world, system);
  const goals = () => getRelationTargets(world, actor, HasGoal).filter(g => Goal.kind[g] === "scheduled_activity");
  run(createScheduledActivityGoalSystem());
  return { world, room, street, actor, schedule, run, goals, goal: goals()[0] };
}
function runIn(world: ReturnType<typeof createArgosWorld>, system: SystemDefinition) {
  const registry = createSystemRegistry(); registerSystem(registry, { ...system, frequency: 0 });
  runSystems(world, registry, world.time.tick + 1, 500); expect(registry.errors).toEqual([]);
}
function release(f: ReturnType<typeof fixture>) {
  return prepareGoalReview(captureGoalReviewContext(f.world, f.actor), {
    goalId: f.goal, disposition: "release", reason: "I am choosing to keep my dinner commitment instead.",
  });
}
test("real actor release preserves physical proof and is not countermanded after moving or collection", () => {
  const f = fixture(); const proof = Goal.successJson[f.goal];
  expect(release(f)?.commit()).toBe(true);
  expect(Goal.status[f.goal]).toBe("retired"); expect(Goal.progress[f.goal]).toBe(0);
  expect(Goal.successJson[f.goal]).toBe(proof);
  setLocatedIn(f.world, f.actor, f.street);
  f.run(createScheduledActivityGoalSystem()); f.run(createDayPlanPreplannerSystem());
  expect(f.goals()).toEqual([f.goal]);
  f.run(createGoalCleanupSystem());
  advanceSimulationTime(f.world, 1, 60_000); f.run(createGoalCleanupSystem());
  expect(entityExists(f.world, f.goal)).toBe(false);
  f.run(createScheduledActivityGoalSystem()); f.run(createDayPlanPreplannerSystem());
  expect(f.goals()).toHaveLength(0);
});
test("real deferral remains one intention, resumes on lived time, and keeps its original deadline", () => {
  const f = fixture(); const deadline = Goal.deadline[f.goal];
  const draft = prepareGoalReview(captureGoalReviewContext(f.world, f.actor), {
    goalId: f.goal, disposition: "defer", reason: "First I want to check this message.", afterSeconds: 20, wake: { kind: "review" },
  });
  expect(draft?.commit()).toBe(true);
  setLocatedIn(f.world, f.actor, f.street); f.run(createScheduledActivityGoalSystem());
  expect(f.goals()).toEqual([f.goal]); expect(Goal.status[f.goal]).toBe("paused");
  jest.setSystemTime(Date.now() + 86_400_000); expect(resumeDeferredGoals(f.world, f.actor)).toBe(0);
  advanceSimulationTime(f.world, 1, 20_000); expect(resumeDeferredGoals(f.world, f.actor)).toBe(1);
  expect(Goal.deadline[f.goal]).toBe(deadline); expect(Goal.progress[f.goal]).toBe(0);
});
test.each(["completed", "failed", "expired", "retired"])("%s occurrence stays consumed after its goal is collected and the world is restored", status => {
  const f = fixture(); Goal.status[f.goal] = status; removeEntity(f.world, f.goal);
  const saved = JSON.parse(JSON.stringify(serializeWorld(f.world, createSystemRegistry())));
  const restored = createArgosWorld(); addEntity(restored);
  const ids = deserializeWorld(restored, createSystemRegistry(), saved).oldToNewId;
  const actor = ids.get(f.actor)!;
  runIn(restored, createScheduledActivityGoalSystem()); runIn(restored, createDayPlanPreplannerSystem());
  expect(getRelationTargets(restored, actor, HasGoal).filter(g => Goal.kind[g] === "scheduled_activity")).toHaveLength(0);
});
test("a new simulation day admits a new occurrence, not another copy of yesterday's task", () => {
  const f = fixture(); Goal.status[f.goal] = "retired";
  advanceSimulationTime(f.world, 1, 86_400_000);
  f.run(createDayPlanPreplannerSystem()); f.run(createDayPlanActivationSystem()); f.run(createScheduledActivityGoalSystem());
  expect(f.goals()).toHaveLength(2);
  expect(f.goals().filter(g => Goal.status[g] === "active")).toHaveLength(1);
});
test("changing source schedule invalidates an in-flight release", () => {
  const f = fixture(); const draft = release(f); expect(draft).toBeDefined();
  Schedule.activities[f.schedule] = JSON.stringify([{ name: "night work", startHour: 20, duration: 1, priority: 5, interruptible: true }]);
  expect(draft!.commit()).toBe(false); expect(Goal.status[f.goal]).toBe("active");
});
test("an explicitly noninterruptible schedule does not get discretionary review authority", () => {
  const f = fixture(false); expect(release(f)).toBeUndefined();
  expect(Goal.status[f.goal]).toBe("active");
});

test("a replaced source retires an old deferred occurrence rather than resurrecting its plan", () => {
  const f = fixture(); const draft = prepareGoalReview(captureGoalReviewContext(f.world, f.actor), {
    goalId: f.goal, disposition: "defer", reason: "Wait for a message.", afterSeconds: 20, wake: { kind: "review" },
  });
  expect(draft?.commit()).toBe(true); removeEntity(f.world, f.schedule);
  advanceSimulationTime(f.world, 1, 20_000); expect(resumeDeferredGoals(f.world, f.actor)).toBe(0);
  expect(Goal.status[f.goal]).toBe("retired"); expect(Goal.progress[f.goal]).toBe(0);
});
test.each(["actor", "goal", "contract", "permission"])("a stale %s cannot authorize a prepared release", kind => {
  const f = fixture(), draft = release(f)!; expect(draft).toBeDefined();
  if (kind === "actor") WorkingMemoryIdentity.id[f.actor] = "replacement-actor";
  if (kind === "goal") WorkingMemoryIdentity.id[f.goal] = "replacement-goal";
  if (kind === "contract") Goal.paramsJson[f.goal] = "{}";
  if (kind === "permission") Schedule.activities[f.schedule] = Schedule.activities[f.schedule].replace('"interruptible":true', '"interruptible":false');
  expect(draft.commit()).toBe(false); expect(Goal.status[f.goal]).toBe("active");
});
test("new source on the same day gets its own occurrence; old queued source cannot activate", () => {
  const f = fixture(); f.run(createDayPlanPreplannerSystem());
  Goal.status[f.goal] = "queued";
  const replacement = addEntity(f.world); addComponent(f.world, replacement, Schedule);
  Schedule.activities[replacement] = Schedule.activities[f.schedule];
  removeEntity(f.world, f.schedule); addComponent(f.world, f.actor, HasSchedule(replacement));
  f.run(createDayPlanPreplannerSystem()); f.run(createDayPlanActivationSystem());
  expect(f.goals()).toHaveLength(2); expect(Goal.status[f.goal]).toBe("retired");
  expect(f.goals().filter(g => Goal.status[g] === "active")).toHaveLength(1);
});
test("a completed room visit is not presumed to complete a newly scheduled leisure activity", () => {
  const f = fixture(); Schedule.activities[f.schedule] = JSON.stringify([{ name: "leisure", startHour: 13, duration: 1, priority: 5, interruptible: true }]);
  f.run(createScheduledActivityGoalSystem());
  const leisure = f.goals().find(g => JSON.parse(Goal.paramsJson[g]).activityType === "leisure_block")!;
  expect(leisure).toBeDefined(); expect(Goal.status[leisure]).toBe("active");
  expect(evaluateGoalSuccessContract(f.world, f.actor, leisure).satisfied).toBe(false);
});
test("overnight occurrence is not duplicated at midnight, and tomorrow's slot is not activated early", () => {
  const f = fixture(); removeEntity(f.world, f.goal);
  f.world.time.simulationHour = 23;
  Schedule.activities[f.schedule] = JSON.stringify([{ name: "night work", startHour: 22, duration: 4, priority: 5, interruptible: true }]);
  f.run(createScheduledActivityGoalSystem()); const night = f.goals()[0];
  advanceSimulationTime(f.world, 1, 2 * 3600_000);
  f.run(createDayPlanPreplannerSystem()); f.run(createDayPlanActivationSystem()); f.run(createScheduledActivityGoalSystem());
  expect(f.goals()).toHaveLength(2);
  expect(Goal.status[night]).toBe("active");
  expect(f.goals().filter(g => Goal.status[g] === "queued")).toHaveLength(1);
});
test("a missed queued occurrence cannot activate on the next day", () => {
  const f = fixture(); Goal.status[f.goal] = "queued";
  advanceSimulationTime(f.world, 1, 86_400_000); f.run(createDayPlanActivationSystem());
  expect(Goal.status[f.goal]).toBe("expired"); expect(Goal.progress[f.goal]).toBe(0);
});
test.each(["not-json", "{}", '[{"key":"tampered"}]'])("corrupt ledger %s fails closed without creating goals or review permission", raw => {
  const f = fixture(); ScheduleLedger.recordsJson[f.actor] = raw;
  expect(release(f)).toBeUndefined();
  setLocatedIn(f.world, f.actor, f.street); f.run(createScheduledActivityGoalSystem()); f.run(createDayPlanPreplannerSystem());
  expect(f.goals()).toEqual([f.goal]); expect(ScheduleLedger.recordsJson[f.actor]).toBe(raw);
});
test("occurrence readers are read-only and capacity cannot evict today's consumed admission", () => {
  const f = fixture(); const first = JSON.parse(ScheduleLedger.recordsJson[f.actor])[0];
  const rows = Array.from({ length: SCHEDULE_OCCURRENCE_LIMIT }, (_, index) => {
    const activity = { ...JSON.parse(first.activity), name: `work ${index}` };
    return { ...first, activity: JSON.stringify(activity), key: JSON.stringify([first.scheduleKey, first.day, activity]), goalKey: `goal:${index}` };
  });
  ScheduleLedger.recordsJson[f.actor] = JSON.stringify(rows);
  const before = ScheduleLedger.recordsJson[f.actor];
  expect(scheduledGoalOccurrence(f.world, f.actor, f.goal)).toBeUndefined();
  expect(lookupScheduleOccurrence(f.world, f.actor, f.schedule, JSON.parse(Schedule.activities[f.schedule])[0], 1).state).toBe("blocked");
  expect(ScheduleLedger.recordsJson[f.actor]).toBe(before);
});
test("a full-day slot is discoverable at any hour and its next occurrence is distinct", () => {
  const f = fixture(); Schedule.activities[f.schedule] = JSON.stringify([{ name: "on-call work", startHour: 8, duration: 24, priority: 5, interruptible: true }]);
  expect(getActivityForHour(f.schedule, 13)?.name).toBe("on-call work");
  f.run(createScheduledActivityGoalSystem()); expect(f.goals()).toHaveLength(2);
  advanceSimulationTime(f.world, 1, 86_400_000); f.run(createScheduledActivityGoalSystem()); expect(f.goals()).toHaveLength(3);
});

test("releasing scheduled work also retires its navigation draft, not an independent intention", () => {
  const f = fixture(true, true);
  const navigation = getRelationTargets(f.world, f.actor, HasGoal).find(g => Goal.kind[g] === "move_to_room")!;
  expect(navigation).toBeDefined();
  const independent = addEntity(f.world); addComponent(f.world, independent, Goal); addComponent(f.world, f.actor, HasGoal(independent));
  Goal.description[independent] = "Check my phone"; Goal.status[independent] = "active";
  expect(release(f)?.commit()).toBe(true);
  expect(Goal.status[navigation]).toBe("retired"); expect(Goal.status[independent]).toBe("active");
});

test("retiring a purpose cascades only through its owned drafts and leaves physical job state untouched", () => {
  const f = fixture(true, true);
  const navigation = getRelationTargets(f.world, f.actor, HasGoal).find(g => Goal.kind[g] === "move_to_room")!;
  const child = addEntity(f.world); addComponent(f.world, child, Goal); addComponent(f.world, f.actor, HasGoal(child));
  Goal.description[child] = "Find the route"; Goal.status[child] = "active"; Goal.createdAt[child] = Date.now();
  bindSupportingGoal(f.world, f.actor, child, navigation);
  const plan = addEntity(f.world); addComponent(f.world, plan, Plan); addComponent(f.world, f.actor, HasPlan(plan));
  Plan.goalEid[plan] = child; Plan.status[plan] = "awaiting_evidence"; Plan.currentStep[plan] = 2;
  addComponent(f.world, f.actor, PendingToolJob); PendingToolJob.jobId[f.actor] = "running-physical-job";
  expect(release(f)?.commit()).toBe(true);
  expect(Goal.status[child]).toBe("retired"); expect(Plan.status[plan]).toBe("retired");
  expect(Plan.currentStep[plan]).toBe(2); expect(PendingToolJob.jobId[f.actor]).toBe("running-physical-job");
});
test("a stale supporting edge cannot retire an unrelated replacement episode", () => {
  const f = fixture(true, true);
  const navigation = getRelationTargets(f.world, f.actor, HasGoal).find(g => Goal.kind[g] === "move_to_room")!;
  Goal.createdAt[f.goal] += 1;
  expect(retireGoalDependents(f.world, f.actor, f.goal, "old decision")).toBe(0);
  expect(Goal.status[navigation]).toBe("active");
});

test("ledger retention is bounded by occurrence day, without removing an overnight carryover", () => {
  const f = fixture(); const first = JSON.parse(ScheduleLedger.recordsJson[f.actor])[0];
  advanceSimulationTime(f.world, 1, 86_400_000);
  f.run(createScheduledActivityGoalSystem());
  expect(JSON.parse(ScheduleLedger.recordsJson[f.actor]).some(r => r.key === first.key)).toBe(true);
  advanceSimulationTime(f.world, 2, 86_400_000);
  f.run(createScheduledActivityGoalSystem());
  const records = JSON.parse(ScheduleLedger.recordsJson[f.actor]);
  expect(records.some(r => r.key === first.key)).toBe(false); expect(records).toHaveLength(2);
});
