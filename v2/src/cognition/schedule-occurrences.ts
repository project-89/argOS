/** An occurrence is admitted once, independently of how its goal ends. This is
 * scheduler bookkeeping, not memory of accomplishment or an action permit. */
import { randomUUID } from "node:crypto";
import { addComponent, entityExists, getRelationTargets, hasComponent } from "bitecs";
import { Agent, Goal, GoalLifecycle, Schedule, ScheduleLedger, WorkingMemoryIdentity } from "../ecs/components";
import { HasGoal, HasPlan, HasSchedule } from "../ecs/relations";
import type { World } from "../ecs/world";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { stampSimulationTime } from "../ecs/temporal-age";
import { retireGoalDependents } from "./goal-dependents";
import { retireGoalPlans } from "./plan-state";

export const SCHEDULE_OCCURRENCE_LIMIT = 256;
type Activity = { name: string; startHour: number; duration: number; location?: string; interruptible?: boolean };
type Record = { key: string; scheduleKey: string; day: number; activity: string; goalKey: string; contract: string };
function key(world: World, eid: number): string | undefined {
  return entityExists(world, eid) && hasComponent(world, eid, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[eid] || undefined : undefined;
}
function ensureKey(world: World, eid: number): string {
  if (!key(world, eid)) { addComponent(world, eid, WorkingMemoryIdentity); WorkingMemoryIdentity.id[eid] = `entity:${randomUUID()}`; }
  return WorkingMemoryIdentity.id[eid];
}
function contract(goal: number): string {
  // Activation changes the birth/deadline, not the goal UUID or its task.
  return JSON.stringify([Goal.description[goal] || "", Goal.kind[goal] || "", Goal.paramsJson[goal] || "", Goal.successJson[goal] || ""]);
}
function activityValue(value: unknown): Activity | undefined {
  const v = value as Activity;
  if (!v || typeof v !== "object" || Array.isArray(v) || typeof v.name !== "string" || !v.name.trim() || v.name.length > 512
    || !Number.isFinite(v.startHour) || v.startHour < 0 || v.startHour >= 24
    || !Number.isFinite(v.duration) || v.duration <= 0 || v.duration > 24
    || v.location !== undefined && (typeof v.location !== "string" || v.location.length > 512)
    || v.interruptible !== undefined && typeof v.interruptible !== "boolean") return;
  return { name: v.name, startHour: v.startHour, duration: v.duration,
    location: v.location || "", interruptible: v.interruptible !== false };
}
function rows(world: World, actor: number): Record[] | undefined {
  if (!hasComponent(world, actor, ScheduleLedger) || ScheduleLedger.ownerKey[actor] !== key(world, actor)) return;
  try {
    const parsed = JSON.parse(ScheduleLedger.recordsJson[actor]);
    if (!Array.isArray(parsed) || parsed.length > SCHEDULE_OCCURRENCE_LIMIT) return;
    if (!parsed.every(r => r && typeof r === "object" && typeof r.key === "string" && r.key.length <= 4096
      && typeof r.scheduleKey === "string" && !!r.scheduleKey && r.scheduleKey.length <= 128
      && Number.isSafeInteger(r.day) && r.day >= 0 && typeof r.activity === "string" && r.activity.length <= 2048
      && typeof r.goalKey === "string" && !!r.goalKey && r.goalKey.length <= 128
      && typeof r.contract === "string" && r.contract.length <= 16_384)) return;
    if (!parsed.every(r => {
      const value = activityValue(JSON.parse(r.activity));
      return value && r.activity === JSON.stringify(value) && r.key === JSON.stringify([r.scheduleKey, r.day, value]);
    })) return;
    if (new Set(parsed.map(r => r.key)).size !== parsed.length) return;
    return parsed;
  } catch { return; }
}
function ownsSchedule(world: World, actor: number, schedule: number): boolean {
  return entityExists(world, actor) && hasComponent(world, actor, Agent)
    && entityExists(world, schedule) && hasComponent(world, schedule, Schedule)
    && getRelationTargets(world, actor, HasSchedule).includes(schedule);
}
function containsActivity(schedule: number, activity: string): boolean {
  try { const list = JSON.parse(Schedule.activities[schedule] || "[]");
    return Array.isArray(list) && list.some(v => JSON.stringify(activityValue(v)) === activity);
  } catch { return false; }
}
export function currentOccurrenceDay(world: World, value: unknown): number {
  const activity = activityValue(value);
  return world.time.simulationDay - (activity && activity.startHour + activity.duration > 24 && world.time.simulationHour < activity.startHour ? 1 : 0);
}
type Lookup = { state: "available"; key: string } | { state: "seen"; goal?: number } | { state: "blocked" };
/** Scheduler write boundary. Bound retention to yesterday/today/tomorrow; never
 * evict today's admission to make capacity for another one. Corruption fails closed. */
export function lookupScheduleOccurrence(world: World, actor: number, schedule: number, value: unknown, day: number): Lookup {
  assertSimulationTaskActive();
  const activity = activityValue(value);
  if (!activity || !ownsSchedule(world, actor, schedule) || !containsActivity(schedule, JSON.stringify(activity)) || !Number.isSafeInteger(day)
    || day < Math.max(0, world.time.simulationDay - 1) || day > world.time.simulationDay + 1) return { state: "blocked" };
  const owner = ensureKey(world, actor), source = ensureKey(world, schedule);
  if (!hasComponent(world, actor, ScheduleLedger) || ScheduleLedger.ownerKey[actor] !== owner) {
    addComponent(world, actor, ScheduleLedger); ScheduleLedger.ownerKey[actor] = owner; ScheduleLedger.recordsJson[actor] = "[]";
  }
  const saved = rows(world, actor); if (!saved) return { state: "blocked" };
  const retained = saved.filter(r => r.day >= world.time.simulationDay - 1 && r.day <= world.time.simulationDay + 1);
  if (retained.length !== saved.length) ScheduleLedger.recordsJson[actor] = JSON.stringify(retained);
  const occurrenceKey = JSON.stringify([source, day, activity]);
  const record = retained.find(r => r.key === occurrenceKey);
  if (record) {
    const matches = getRelationTargets(world, actor, HasGoal).filter(g => hasComponent(world, g, Goal)
      && key(world, g) === record.goalKey && contract(g) === record.contract);
    return { state: "seen", ...(matches.length === 1 ? { goal: matches[0] } : {}) };
  }
  return retained.length < SCHEDULE_OCCURRENCE_LIMIT ? { state: "available", key: occurrenceKey } : { state: "blocked" };
}
export function recordScheduleOccurrence(world: World, actor: number, schedule: number, value: unknown, day: number, goal: number): boolean {
  const lookup = lookupScheduleOccurrence(world, actor, schedule, value, day);
  if (lookup.state !== "available" || !hasComponent(world, goal, Goal) || Goal.kind[goal] !== "scheduled_activity"
    || contract(goal).length > 16_384 || !getRelationTargets(world, actor, HasGoal).includes(goal)) return false;
  const saved = rows(world, actor)!;
  saved.push({ key: lookup.key, scheduleKey: key(world, schedule)!, day, activity: JSON.stringify(activityValue(value)),
    goalKey: ensureKey(world, goal), contract: contract(goal) });
  ScheduleLedger.recordsJson[actor] = JSON.stringify(saved);
  // Explicit scheduler authority. Other authored physical goals gain no permission.
  addComponent(world, goal, GoalLifecycle);
  GoalLifecycle.source[goal] = "schedule"; GoalLifecycle.mode[goal] = "verified"; GoalLifecycle.persistence[goal] = "episodic";
  GoalLifecycle.parentGoalEid[goal] = -1; GoalLifecycle.parentCreatedAt[goal] = 0; GoalLifecycle.parentSignature[goal] = "";
  GoalLifecycle.settledAt[goal] = 0; GoalLifecycle.reason[goal] = ""; GoalLifecycle.reviewAfter[goal] = 0;
  GoalLifecycle.deferredJson[goal] = ""; GoalLifecycle.resumedAt[goal] = 0;
  return true;
}
/** Read-only validity used at proposal commit and queued activation. */
export function scheduledGoalOccurrence(world: World, actor: number, goal: number): { phase: "future" | "open" | "past"; interruptible: boolean } | undefined {
  if (!hasComponent(world, goal, Goal) || !getRelationTargets(world, actor, HasGoal).includes(goal)) return;
  const matching = rows(world, actor)?.filter(r => r.goalKey === key(world, goal) && r.contract === contract(goal));
  if (matching?.length !== 1) return;
  const r = matching[0];
  const sources = getRelationTargets(world, actor, HasSchedule).filter(s => hasComponent(world, s, Schedule) && key(world, s) === r.scheduleKey);
  if (sources.length !== 1 || !containsActivity(sources[0], r.activity)) return;
  let activity: Activity | undefined;
  try { activity = activityValue(JSON.parse(r.activity)); } catch { return; }
  if (!activity) return;
  const now = world.time.simulationDay * 24 + world.time.simulationHour, start = r.day * 24 + activity.startHour;
  return { phase: now < start ? "future" : now >= start + activity.duration ? "past" : "open", interruptible: activity.interruptible === true };
}

/** A replaced schedule withdraws its own drafts, not a running physical callback
 * or a newly edited goal contract. Unknown/corrupt ledger is not proof of replacement. */
export function retireReplacedScheduleOccurrences(world: World, actor: number): number {
  assertSimulationTaskActive();
  const saved = rows(world, actor); if (!saved) return 0;
  let count = 0;
  for (const goal of getRelationTargets(world, actor, HasGoal)) {
    if (!hasComponent(world, goal, Goal) || !hasComponent(world, goal, GoalLifecycle)
      || GoalLifecycle.source[goal] !== "schedule" || !["active", "queued", "paused", "pending"].includes(Goal.status[goal])
      || !saved.some(r => r.goalKey === key(world, goal) && r.contract === contract(goal))
      || scheduledGoalOccurrence(world, actor, goal)) continue;
    Goal.status[goal] = "retired"; GoalLifecycle.deferredJson[goal] = "";
    GoalLifecycle.reason[goal] = "The source schedule occurrence was replaced; this is not accomplishment.";
    GoalLifecycle.settledAt[goal] = Date.now(); stampSimulationTime(world, goal, "GoalLifecycle.settledAt", GoalLifecycle.settledAt[goal]);
    retireGoalPlans(world, goal, getRelationTargets(world, actor, HasPlan));
    retireGoalDependents(world, actor, goal, "The supporting schedule occurrence was replaced; this is not accomplishment.");
    count++;
  }
  return count;
}
