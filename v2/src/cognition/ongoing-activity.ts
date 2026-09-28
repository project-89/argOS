/** Organizing activity survives side actions. It confers no motor authority. */
import { addComponent, entityExists, getRelationTargets, hasComponent } from "bitecs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { World } from "../ecs/world";
import { Agent, Goal, Name, OngoingActivity, Plan, WorkingMemoryIdentity } from "../ecs/components";
import { HasGoal, HasPlan } from "../ecs/relations";
import { readSimulationTime } from "../ecs/simulation-time";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { workingMemoryEntityRef } from "./working-memory";
import { getCommittedEvents } from "../runtime/committed-events";
import { getAgentWorldCapabilityGeneration, getAgentObservableEntities } from "./world-capabilities";
import { captureCoordinationGoal } from "./coordination-memory";

const schema = z.object({ id: z.string().min(1), purpose: z.string().min(1).max(400),
  goalKey: z.string().min(1), definition: z.string(), selectedAtSimMs: z.number().finite().nonnegative(),
  status: z.enum(["active", "paused", "ended"]), reason: z.string().max(400).optional(),
  interruption: z.object({ purpose: z.string().min(1).max(400), goalKey: z.string().min(1).optional(),
    startedAtSimMs: z.number().finite().nonnegative(), reason: z.string().max(400).optional() }).strict().optional() }).strict();
type Activity = z.infer<typeof schema>;
export type ActivityDisposition = "continue" | "pause" | "replace" | "end";
type Validation = { basis: string; generation: object | undefined };
const grants = new WeakMap<World, Map<number, Validation>>();
type Step = { actionType: string; target?: string; content?: string; planEid?: number };
type ReturnPlan = { id: number; key: string; createdAt: number; steps: string; targets: Map<string, { id: number; key: string }> };
const returnPlans = new WeakMap<World, Map<number, ReturnPlan>>();
function planDefinition(id: number): string {
  return JSON.stringify(JSON.parse(Plan.steps[id]).map((s: Step) => [s.actionType, s.target, s.content]));
}
function bindReturnPlan(world: World, eid: number, goal: number): void {
  let actors = returnPlans.get(world); if (!actors) { actors = new Map(); returnPlans.set(world, actors); }
  actors.delete(eid);
  const plans = getRelationTargets(world, eid, HasPlan).filter(id => hasComponent(world, id, Plan)
    && Plan.goalEid[id] === goal && Plan.status[id] === "active");
  if (plans.length !== 1) return;
  const id = plans[0];
  try {
    const steps = planDefinition(id), targets = new Map<string, { id: number; key: string }>();
    const visible = getAgentObservableEntities(world, eid);
    for (const step of JSON.parse(Plan.steps[id]) as Step[]) {
      if (!step.target) continue;
      const matches = visible.filter(target => Name.value[target] === step.target);
      if (matches.length !== 1) continue;
      const ref = workingMemoryEntityRef(world, matches[0]);
      if (ref) targets.set(step.target, { id: matches[0], key: ref.key });
    }
    if (!hasComponent(world, id, WorkingMemoryIdentity)) addComponent(world, id, WorkingMemoryIdentity);
    if (!WorkingMemoryIdentity.id[id]) WorkingMemoryIdentity.id[id] = `plan:${randomUUID()}`;
    actors.set(eid, { id, key: WorkingMemoryIdentity.id[id], createdAt: Plan.createdAt[id], steps, targets });
  } catch { /* Malformed saved proposals cannot become return points. */ }
}
/** Runtime target binding survives a side turn, never restore or a replacement
 * plan. Ordinary executor admission still checks affordances and resources. */
export function isActivityReturnStepCurrent(world: World, eid: number, step: Step): boolean {
  const activity = snapshotOngoingActivity(world, eid), plan = returnPlans.get(world)?.get(eid);
  if (!activity || activity.needsRevalidation || activity.status !== "active" || !plan || step.planEid !== plan.id
    || !entityExists(world, plan.id) || !hasComponent(world, plan.id, WorkingMemoryIdentity)
    || WorkingMemoryIdentity.id[plan.id] !== plan.key || Plan.createdAt[plan.id] !== plan.createdAt) return false;
  try { if (planDefinition(plan.id) !== plan.steps) return false; } catch { return false; }
  const target = step.target ? plan.targets.get(step.target) : undefined;
  if (!target) return false;
  const matches = getAgentObservableEntities(world, eid).filter(id => Name.value[id] === step.target);
  return matches.length === 1 && matches[0] === target.id && WorkingMemoryIdentity.id[target.id] === target.key;
}
function grant(world: World, eid: number, state: string): Validation | undefined {
  const tape = getCommittedEvents(world); if (tape.stopped || !Agent.active[eid]) return;
  return { basis: JSON.stringify([state, tape.sourceId, Name.value[eid], Agent.role[eid], Agent.systemPrompt[eid]]),
    generation: getAgentWorldCapabilityGeneration(world, eid) };
}
function definition(goal: number) {
  return JSON.stringify([Goal.createdAt[goal], Goal.description[goal], Goal.kind[goal], Goal.paramsJson[goal], Goal.successJson[goal]]);
}
function ownedGoal(world: World, eid: number, key: string) {
  const matches = getRelationTargets(world, eid, HasGoal).filter(id => hasComponent(world, id, Goal)
    && hasComponent(world, id, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[id] === key);
  return matches.length === 1 ? matches[0] : undefined;
}
export function snapshotOngoingActivity(world: World, eid: number): (Activity & { needsRevalidation: boolean }) | undefined {
  if (!entityExists(world, eid) || !hasComponent(world, eid, Agent) || !hasComponent(world, eid, OngoingActivity)
    || !hasComponent(world, eid, WorkingMemoryIdentity) || OngoingActivity.ownerKey[eid] !== WorkingMemoryIdentity.id[eid]) return;
  try {
    const parsed = schema.safeParse(JSON.parse(OngoingActivity.stateJson[eid])); if (!parsed.success) return;
    const goal = ownedGoal(world, eid, parsed.data.goalKey);
    const current = grant(world, eid, OngoingActivity.stateJson[eid]);
    const accepted = grants.get(world)?.get(eid);
    return { ...parsed.data, needsRevalidation: current === undefined || accepted === undefined
      || accepted.basis !== current.basis || accepted.generation !== current.generation
      || goal === undefined || Goal.status[goal] !== "active" || definition(goal) !== parsed.data.definition };
  } catch { return; }
}
/** Read-only interpretation of stored activity; never a new execution grant. */
export function observeOngoingActivity(world: World, eid: number) {
  const value = snapshotOngoingActivity(world, eid); if (!value) return;
  const { definition: _, goalKey, purpose: entryChoicePurpose, ...visible } = value;
  const goalId = ownedGoal(world, eid, goalKey);
  const now = readSimulationTime(world);
  const interruptionElapsedSimMs = value.interruption && now >= value.interruption.startedAtSimMs
    ? now - value.interruption.startedAtSimMs : undefined;
  // The stored purpose is the choice that established this activity, not a
  // continuously refreshed subtask. Preserve it as history without presenting
  // a completed entry step as an instruction to perform it again.
  const sameGoal = goalId !== undefined && definition(goalId) === value.definition;
  const goalStatus = sameGoal ? Goal.status[goalId] : "unavailable_or_revised";
  return { ...visible, goalId, goalStatus, currentGoal: sameGoal && goalStatus === "active",
    organizingGoal: sameGoal ? Goal.description[goalId] : undefined, entryChoicePurpose, interruptionElapsedSimMs };
}
export function formatOngoingActivity(world: World, eid: number): string {
  const value = observeOngoingActivity(world, eid); if (!value) return "";
  return `ONGOING ACTIVITY (entryChoicePurpose is the historical entry choice, not the next action; currentGoal=false means this is not a current intention):\n${JSON.stringify(value)}`;
}
/** A deliberate goal review settles only that goal's organizing activity.
 * Unrelated side-goal reviews must not suspend the activity being inhabited. */
export function settleReviewedGoalActivity(world: World, eid: number, goal: number, disposition: "defer" | "release" | "withdraw"): void {
  const activity = snapshotOngoingActivity(world, eid);
  if (!activity || activity.goalKey !== WorkingMemoryIdentity.id[goal]) return;
  recordOngoingActivityChoice(world, eid, { purpose: activity.purpose, actionType: "think",
    disposition: disposition === "defer" ? "pause" : "end" });
}
/** Maintenance invalidates execution bindings without authoring a new choice.
 * Retaining the same intention later must not revive a pre-review return grant. */
export function invalidateGoalActivityExecution(world: World, eid: number, goal: number): void {
  assertSimulationTaskActive();
  if (snapshotOngoingActivity(world, eid)?.goalKey !== WorkingMemoryIdentity.id[goal]) return;
  grants.get(world)?.delete(eid); returnPlans.get(world)?.delete(eid);
}
/** Called at the accepted actor-choice boundary, never by a planner or observer. */
export function recordOngoingActivityChoice(world: World, eid: number, input: {
  purpose: string; actionType: string; goalId?: number; disposition?: ActivityDisposition; switchReason?: string;
}): void {
  assertSimulationTaskActive();
  if (!entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid] || getCommittedEvents(world).stopped) return;
  const previous = snapshotOngoingActivity(world, eid);
  const goal = input.goalId !== undefined && getRelationTargets(world, eid, HasGoal).includes(input.goalId)
    && hasComponent(world, input.goalId, Goal) && Goal.status[input.goalId] === "active" ? input.goalId : undefined;
  if (previous?.status === "ended" && goal === undefined) return;
  let next: Activity | undefined;
  if (previous) { const { needsRevalidation: _, ...stored } = previous; next = stored; }
  if (input.disposition === "end" && next) next = { ...next, status: "ended", interruption: undefined, reason: "Actor ended the activity; no goal success is implied." };
  else if (input.disposition === "pause" && next) next = { ...next, status: "paused", reason: "Actor paused the activity." };
  else if (goal !== undefined && (!previous || previous.status === "ended" || input.disposition === "replace")) {
    if (!captureCoordinationGoal(world, eid, goal)) return;
    next = { id: `activity:${randomUUID()}`, purpose: input.purpose, goalKey: WorkingMemoryIdentity.id[goal],
      definition: definition(goal), selectedAtSimMs: readSimulationTime(world), status: "active" };
  } else if (next && goal !== undefined && WorkingMemoryIdentity.id[goal] === next.goalKey) {
    next = { ...next, definition: definition(goal), status: "active", reason: undefined, interruption: undefined };
  } else if (next && input.disposition === "continue" && !previous?.needsRevalidation) {
    next = { ...next, status: "active", reason: undefined };
  } else if (next && !["speak", "think", "wait"].includes(input.actionType)) {
    next = { ...next, status: "paused", reason: "A separate action interrupted the activity; retain its return point." };
  }
  // Waiting/listening chooses no competing physical activity. Preserve the
  // existing disposition (including an explicit pause); this grants no return
  // action while the separate wait/listening controller is in charge.
  // Retain the actor's reason for a physical detour after the immediate proposal
  // changes. This is historical context, not a deadline or automatic return grant.
  if (next && previous && next.id === previous.id && next.status !== "ended"
    && !["speak", "think", "wait"].includes(input.actionType)) {
    if (goal !== undefined) captureCoordinationGoal(world, eid, goal);
    const otherKey = goal === undefined ? undefined : WorkingMemoryIdentity.id[goal];
    if (otherKey !== next.goalKey) {
      const old = next.interruption, now = readSimulationTime(world);
      const sameDetour = old && old.goalKey === otherKey && (otherKey !== undefined || old.purpose === input.purpose)
        && now >= old.startedAtSimMs;
      if (!sameDetour) next = { ...next, interruption: { purpose: input.purpose, startedAtSimMs: now,
        ...(otherKey ? { goalKey: otherKey } : {}), ...(input.switchReason?.trim() ? { reason: input.switchReason.trim() } : {}) } };
    }
  }
  if (!next || !schema.safeParse(next).success) return;
  if (goal !== undefined && WorkingMemoryIdentity.id[goal] === next.goalKey) bindReturnPlan(world, eid, goal);
  workingMemoryEntityRef(world, eid); addComponent(world, eid, OngoingActivity);
  OngoingActivity.ownerKey[eid] = WorkingMemoryIdentity.id[eid];
  OngoingActivity.stateJson[eid] = JSON.stringify(next);
  // Merely speaking after restore cannot reauthorize the saved activity.
  if (!previous?.needsRevalidation || goal !== undefined && WorkingMemoryIdentity.id[goal] === next.goalKey) {
    let actors = grants.get(world); if (!actors) { actors = new Map(); grants.set(world, actors); }
    actors.set(eid, grant(world, eid, OngoingActivity.stateJson[eid])!);
  }
}
