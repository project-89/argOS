/** Generated intentions have a lifecycle; finishing a plan is never world proof. */
import { addComponent, addEntity, entityExists, getRelationTargets, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Goal, GoalLifecycle, Name, Needs, ObjectState, ObjectType, Plan, WorkDocument, WorkingMemoryIdentity } from "../ecs/components";
import { randomUUID } from "node:crypto";
import { HasGoal, HasPlan } from "../ecs/relations";
import { getRoomForEntity } from "../ecs/location";
import { getAgentVisibleEntities, getAgentWorldCapabilities } from "./world-capabilities";
import { computeGoalSignature, ensureGoalSignature, setGoalContract, type GoalKind, type GoalSuccessV1 } from "./goal-contract";
import { evaluateCurrentStateCondition } from "../systems/goal-evaluation-system";
import { worldSchema } from "../world/schema";
import { isStructuralGeometry } from "../world/structural-geometry";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { readSimulationTime } from "../ecs/simulation-time";
import { simulationAge, simulationDeadlinePassed, stampGoalTiming, stampSimulationTime } from "../ecs/temporal-age";
import { retireGoalPlans } from "./plan-state";
import { readGoalInactivityBudget } from "./goal-inactivity-budget";
import { invalidateGoalActivityExecution } from "./ongoing-activity";
import { getCommittedEvents } from "../runtime/committed-events";
import { chronicle } from "./simulation-chronicle";
import { snapshotActorContinuation, updateActorContinuation } from "./actor-continuation";

export interface GoalCompletionOption { id: string; description: string; success: GoalSuccessV1 }
export interface GeneratedIntention {
  description: string; priority: number; kind?: string; completionId?: string; supportsGoalId?: number;
}
export interface PreparedGeneratedIntention { readonly id: string }
type IntentionSource = "foreground" | "autonomous" | "personal";
export type IntentionPersistence = "episodic" | "standing";
type IntentionDraft = { world: World; eid: number; proposal: GeneratedIntention; source: IntentionSource;
  now: number; description: string; parent?: number; success: GoalSuccessV1; verified: boolean;
  params: Record<string, unknown>;
  signature: string; goalKey: string; basis: string; consumed: boolean };
const intentionDrafts = new WeakMap<PreparedGeneratedIntention, IntentionDraft>();
const intentionBasis = (world: World, eid: number) => JSON.stringify([Agent.active[eid], WorkingMemoryIdentity.id[eid],
  ownedGoals(world, eid).map(g => [g, WorkingMemoryIdentity.id[g], Goal.description[g], Goal.priority[g], Goal.status[g], Goal.createdAt[g],
    Goal.kind[g], Goal.paramsJson[g], Goal.successJson[g], GoalLifecycle.settledAt[g], GoalLifecycle.reviewRevision[g]])]);
const terminal = new Set(["completed", "retired", "expired", "failed"]);
const ownedGoals = (world: World, eid: number) => getRelationTargets(world, eid, HasGoal).filter(g => hasComponent(world, g, Goal));
const normalized = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
export const MAX_SELF_DIRECTED_INTENTIONS = 5;
export function intentionReviewRevision(world: World, goal: number): number {
  const value = hasComponent(world, goal, GoalLifecycle) ? GoalLifecycle.reviewRevision[goal] : undefined;
  return value === undefined ? 0 : value; // Malformed counters must not silently become the initial revision.
}
export function isSelfDirectedIntention(world: World, goal: number): boolean {
  if (!entityExists(world, goal) || !hasComponent(world, goal, Goal) || !hasComponent(world, goal, GoalLifecycle)
    || !["foreground", "autonomous", "personal"].includes(GoalLifecycle.source[goal])
    || !["social", "exploratory"].includes(GoalLifecycle.mode[goal])) return false;
  try { return JSON.parse(Goal.successJson[goal]).type === "custom"; } catch { return false; }
}
export function unsettledIntentionCount(world: World, eid: number): number {
  return ownedGoals(world, eid).filter(g => isSelfDirectedIntention(world, g) && ["active", "paused"].includes(Goal.status[g])).length;
}
function reviewDefinition(goal: number): string {
  return JSON.stringify([WorkingMemoryIdentity.id[goal], Goal.createdAt[goal], Goal.description[goal], Goal.kind[goal],
    Goal.paramsJson[goal], Goal.successJson[goal], GoalLifecycle.source[goal], GoalLifecycle.mode[goal], GoalLifecycle.persistence[goal], GoalLifecycle.reviewRevision[goal]]);
}
/** Historical review evidence survives restore; issuance supplies fresh source/persona authority. */
export function pendingIntentionReview(world: World, eid: number, goal: number): { atSimMs: number; reason: string } | undefined {
  if (!isSelfDirectedIntention(world, goal) || Goal.status[goal] !== "paused" || !ownedGoals(world, eid).includes(goal)
    || !hasComponent(world, eid, WorkingMemoryIdentity) || !hasComponent(world, goal, WorkingMemoryIdentity)) return;
  const revision = intentionReviewRevision(world, goal);
  if (!Number.isSafeInteger(revision) || revision < 1) return;
  try {
    const row = JSON.parse(GoalLifecycle.reviewPendingJson[goal] || "null");
    if (row?.ownerKey && row.ownerKey === WorkingMemoryIdentity.id[eid] && row.definition === reviewDefinition(goal)
      && Number.isFinite(row.atSimMs) && row.atSimMs >= 0 && row.atSimMs <= readSimulationTime(world)
      && typeof row.reason === "string" && row.reason.length > 0 && row.reason.length <= 400)
      return { atSimMs: row.atSimMs, reason: row.reason };
  } catch { /* A malformed or replaced episode is never review authority. */ }
}
/** A stall retires execution, not the person's intention. Explicit budgets remain expiry policy. */
export function requestIntentionReconsideration(world: World, eid: number, goal: number, reason: string): boolean {
  assertSimulationTaskActive();
  if (!entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid] || getCommittedEvents(world).stopped
    || !ownedGoals(world, eid).includes(goal) || !isSelfDirectedIntention(world, goal) || isStandingIntention(world, goal)
    || Goal.status[goal] !== "active" || !WorkingMemoryIdentity.id[eid] || !WorkingMemoryIdentity.id[goal]
    || Number.isFinite(readGoalInactivityBudget(world, goal, NaN))
    || simulationDeadlinePassed(world, goal, "Goal.deadline", Goal.deadline[goal]) || !reason.trim() || reason.length > 400) return false;
  const atSimMs = readSimulationTime(world), revision = intentionReviewRevision(world, goal);
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) return false;
  GoalLifecycle.reviewRevision[goal] = revision + 1;
  Goal.status[goal] = "paused"; GoalLifecycle.reason[goal] = reason;
  GoalLifecycle.settledAt[goal] = Date.now(); stampSimulationTime(world, goal, "GoalLifecycle.settledAt", GoalLifecycle.settledAt[goal]);
  GoalLifecycle.deferredJson[goal] = "";
  GoalLifecycle.reviewPendingJson[goal] = JSON.stringify({ ownerKey: WorkingMemoryIdentity.id[eid], definition: reviewDefinition(goal), atSimMs, reason });
  retireGoalPlans(world, goal, getRelationTargets(world, eid, HasPlan));
  invalidateGoalActivityExecution(world, eid, goal);
  const continuation = snapshotActorContinuation(world, eid);
  if (continuation?.goalKey === WorkingMemoryIdentity.id[goal])
    updateActorContinuation(world, eid, continuation.revision, "needs_revision", "intention_awaiting_review");
  try { chronicle.record("intention_review_requested", { actorEid: eid, actorKey: WorkingMemoryIdentity.id[eid],
    goalKey: WorkingMemoryIdentity.id[goal], sourceId: getCommittedEvents(world).sourceId, atSimMs }); } catch { /* Operator-only diagnostic. */ }
  return true;
}
function stateCondition(node: any, depth = 0): node is GoalSuccessV1 {
  if (!node || typeof node !== "object" || depth >= 8) return false;
  if (["all_of", "any_of"].includes(node.type)) return Array.isArray(node.conditions) && node.conditions.length > 0
    && node.conditions.length <= 12 && node.conditions.every((n: unknown) => stateCondition(n, depth + 1));
  const text = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.length <= 300;
  if (node.type === "in_room") return text(node.roomName);
  if (node.type === "in_inventory") return text(node.itemName);
  if (node.type === "entity_in_room") return text(node.entityName) && text(node.roomName) && (node.uncarried === undefined || typeof node.uncarried === "boolean");
  if (node.type === "entity_component_equals") return text(node.entityName) && text(node.component) && text(node.field)
    && (["string", "boolean"].includes(typeof node.equals) || typeof node.equals === "number" && Number.isFinite(node.equals));
  if (node.type === "need_at_most" || node.type === "need_at_least") {
    const value = node.type === "need_at_most" ? node.atMost : node.atLeast;
    return ["hunger", "energy", "social", "comfort"].includes(node.need) && Number.isFinite(value) && value >= 0 && value <= 100;
  }
  return node.type === "has_trait" && text(node.trait);
}
/** Conditions come from world rules and native public state, never arbitrary model JSON. */
export function getGoalCompletionOptions(world: World, eid: number): GoalCompletionOption[] {
  const result: GoalCompletionOption[] = [];
  const add = (description: string, success: GoalSuccessV1) => {
    if (result.length >= 60 || typeof description !== "string" || !description.trim() || !stateCondition(success)) return;
    const id = computeGoalSignature({ version: 1, kind: "custom", params: {}, success });
    // A package may reuse its declaration object. Neither a prompt catalog nor
    // a prepared intention may retain a mutable alias into that package.
    if (!result.some(option => option.id === id)) result.push({ id, description, success: structuredClone(success) });
  };
  for (const goal of ownedGoals(world, eid)) {
    try { const success = JSON.parse(Goal.successJson[goal] || "null"); if (stateCondition(success)) add(Goal.description[goal], success); } catch { /* unknown contract */ }
  }
  const published = getAgentWorldCapabilities(world, eid)?.goalCompletionOptions?.();
  for (const option of Array.isArray(published) ? published.slice(0, 60) : []) {
    if (option && typeof option.description === "string" && stateCondition(option.success)) add(option.description, option.success);
  }
  const room = getRoomForEntity(world, eid);
  if (room !== undefined) add(`Be in ${Name.value[room]}`, { type: "in_room", roomName: Name.value[room] });
  for (const target of getAgentVisibleEntities(world, eid)) {
    if (!Name.value[target] || hasComponent(world, target, Agent)) continue;
    // Walls are perceptible surfaces, not automatically proposed objects to
    // occupy or empty. Explicit authored/package repair outcomes above remain.
    if (isStructuralGeometry(world, target)) continue;
    if (hasComponent(world, target, WorkDocument)) add(`Finalize ${Name.value[target]}`, {
      type: "entity_component_equals", entityName: Name.value[target], component: "WikiDoc", field: "status", equals: "finished",
    });
    if (hasComponent(world, target, ObjectState)) {
      const type = hasComponent(world, target, ObjectType) ? worldSchema.getObjectType(ObjectType.typeId[target]) : undefined;
      const current = ObjectState.current[target];
      // A package can replace a prefab's state machine (e.g. normal → dark/lit).
      // Its old generic alternatives are not achievable completion conditions.
      // Retain the observed value and explicitly published package outcomes.
      const declared = type?.states || {};
      const alternatives = Object.prototype.hasOwnProperty.call(declared, current) ? Object.keys(declared) : [];
      const states = [...new Set([current, ...alternatives])].filter(Boolean);
      for (const state of states.slice(0, 8)) add(`${Name.value[target]} is ${state}`, { type: "entity_component_equals", entityName: Name.value[target], component: "ObjectState", field: "current", equals: state });
    }
  }
  if (hasComponent(world, eid, Needs)) {
    add("Feel rested (energy at least 80)", { type: "need_at_least", need: "energy", atLeast: 80 });
    add("Be fed (hunger at most 30)", { type: "need_at_most", need: "hunger", atMost: 30 });
  }
  return result.slice(0, 60);
}
export function formatGoalLifecycleContext(world: World, eid: number): string {
  const options = getGoalCompletionOptions(world, eid);
  const recent = ownedGoals(world, eid).filter(g => hasComponent(world, g, GoalLifecycle) && terminal.has(Goal.status[g]))
    .sort((a, b) => (GoalLifecycle.settledAt[b] || 0) - (GoalLifecycle.settledAt[a] || 0)).slice(0, 5);
  return `AVAILABLE COMPLETION CONDITIONS (definitions, not observations or new goals):\n${options.map(o => `[${o.id}] ${o.description}`).join("\n") || "None listed."}
RECENT INTENTION OUTCOMES:\n${recent.map(g => `- ${Goal.status[g]}: ${Goal.description[g]}. ${GoalLifecycle.reason[g] || ""}`).join("\n") || "None."}`;
}
/** A model can choose an intention and a published criterion, not rewrite an authored objective. */
export function prepareGeneratedIntention(world: World, eid: number, proposal: GeneratedIntention, source: IntentionSource): PreparedGeneratedIntention | null {
  assertSimulationTaskActive();
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) return null;
  if (!entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid] || typeof proposal.description !== "string"
    || !proposal.description.trim() || proposal.description.length > 300 || !Number.isInteger(proposal.priority) || proposal.priority < 1 || proposal.priority > 10) return null;
  const now = Date.now(), goals = ownedGoals(world, eid), description = proposal.description.trim();
  if (goals.some(g => normalized(Goal.description[g] || "") === normalized(description)
    && (["active", "paused"].includes(Goal.status[g]) || hasComponent(world, g, GoalLifecycle)
      && simulationAge(world, g, "GoalLifecycle.settledAt", GoalLifecycle.settledAt[g] || 0) < 60_000))) return null;
  const parent = proposal.supportsGoalId;
  if (parent !== undefined && (!Number.isSafeInteger(parent) || !goals.includes(parent) || Goal.status[parent] !== "active")) return null;
  const option = proposal.completionId === undefined ? undefined : getGoalCompletionOptions(world, eid).find(o => o.id === proposal.completionId);
  if (proposal.completionId !== undefined && !option) return null;
  // A declared condition is not semantic proof of arbitrary prose. Arriving in
  // a room can support investigating a mystery without completing it. Only an
  // exact canonical outcome opts into that outcome's verification contract;
  // otherwise retain the person's whole intention and the candidate as a hint.
  const verified = !!option && normalized(description) === normalized(option.description);
  if (!verified && unsettledIntentionCount(world, eid) >= MAX_SELF_DIRECTED_INTENTIONS) return null;
  if (verified && evaluateCurrentStateCondition(world, eid, option!.success)) return null;
  const params: Record<string, unknown> = verified ? {} : { description, ...(option ? { completionHint: {
    id: option.id, description: option.description, success: structuredClone(option.success), authoritative: false,
  } } : {}) };
  const success: GoalSuccessV1 = verified ? structuredClone(option!.success)
    : { type: "custom", description: "Exploratory intention; an attempted plan does not prove success." };
  const signature = computeGoalSignature({ version: 1, kind: "custom", params, success });
  if (verified && goals.some(g => {
    if (Goal.status[g] !== "active") return false;
    try { return computeGoalSignature({ version: 1, kind: "custom", params: {}, success: JSON.parse(Goal.successJson[g]) }) === signature; }
    catch { return false; }
  })) return null;
  const token = Object.freeze({ id: `intention-draft:${randomUUID()}` });
  intentionDrafts.set(token, { world, eid, proposal: { ...proposal }, source, now, description, parent,
    success, verified, params,
    signature: computeGoalSignature({ version: 1, kind: (!verified && proposal.kind === "social" ? "social" : "custom") as GoalKind, params, success }),
    goalKey: `goal:${randomUUID()}`, basis: intentionBasis(world, eid), consumed: false });
  return token;
}
/** A private prospective identity permits work-binding validation without
 * allocating a Goal entity or admitting an intention. */
export function getPreparedIntentionGoalRef(world: World, eid: number, token: PreparedGeneratedIntention | null) {
  const draft = token && intentionDrafts.get(token);
  const ownerKey = WorkingMemoryIdentity.id[eid];
  if (!draft || draft.world !== world || draft.eid !== eid || draft.consumed || !ownerKey) return;
  return Object.freeze({ ownerKey, goalKey: draft.goalKey, signature: draft.signature, createdAt: draft.now });
}
export function isPreparedIntentionCurrent(world: World, eid: number, token: PreparedGeneratedIntention): boolean {
  const draft = intentionDrafts.get(token);
  return !!draft && draft.world === world && draft.eid === eid && !draft.consumed
    && entityExists(world, eid) && hasComponent(world, eid, Agent) && intentionBasis(world, eid) === draft.basis
    && (!draft.verified || getGoalCompletionOptions(world, eid).some(option => option.id === draft.proposal.completionId));
}
/** Commit has no package callbacks or model interpretation. Prepare all related
 * effects first, then commit synchronously within the dispatch transaction. */
export function commitPreparedIntention(world: World, eid: number, token: PreparedGeneratedIntention): number | null {
  assertSimulationTaskActive();
  if (!isPreparedIntentionCurrent(world, eid, token)) return null;
  const draft = intentionDrafts.get(token)!;
  draft.consumed = true;
  const { proposal, source, now, description, parent, success, verified, params } = draft;
  const goal = addEntity(world); addComponent(world, goal, Goal); addComponent(world, goal, GoalLifecycle); addComponent(world, eid, HasGoal(goal));
  addComponent(world, goal, WorkingMemoryIdentity); WorkingMemoryIdentity.id[goal] = draft.goalKey;
  Goal.description[goal] = description; Goal.priority[goal] = proposal.priority; Goal.status[goal] = "active";
  Goal.progress[goal] = 0; Goal.createdAt[goal] = now;
  // Subjective intentions need review, not an invented appointment deadline.
  // Authored/verified deadlines and legacy saves are deliberately not migrated.
  Goal.deadline[goal] = verified ? now + 600_000 : 0;
  setGoalContract(world, goal, { version: 1, kind: "custom", params, success });
  if (!verified && proposal.kind === "social") Goal.kind[goal] = "social";
  GoalLifecycle.source[goal] = source; GoalLifecycle.mode[goal] = verified ? "verified" : proposal.kind === "social" ? "social" : "exploratory";
  GoalLifecycle.persistence[goal] = "episodic" satisfies IntentionPersistence;
  GoalLifecycle.parentGoalEid[goal] = parent ?? -1; GoalLifecycle.parentCreatedAt[goal] = parent === undefined ? 0 : Goal.createdAt[parent];
  GoalLifecycle.parentSignature[goal] = parent === undefined ? "" : ensureGoalSignature(world, parent) || "";
  GoalLifecycle.settledAt[goal] = 0; GoalLifecycle.reason[goal] = ""; GoalLifecycle.reviewAfter[goal] = now + 60_000;
  GoalLifecycle.deferredJson[goal] = ""; GoalLifecycle.reviewPendingJson[goal] = ""; GoalLifecycle.reviewRevision[goal] = 0; GoalLifecycle.resumedAt[goal] = 0;
  stampGoalTiming(world, goal);
  stampSimulationTime(world, goal, "GoalLifecycle.reviewAfter", GoalLifecycle.reviewAfter[goal], readSimulationTime(world) + 60_000);
  return goal;
}
export function createGeneratedIntention(world: World, eid: number, proposal: GeneratedIntention, source: IntentionSource): number | null {
  const prepared = prepareGeneratedIntention(world, eid, proposal, source);
  return prepared ? commitPreparedIntention(world, eid, prepared) : null;
}

/** Explicit authoring opt-in: a character's personal desire, not an assigned
 * objective they must satisfy. They may defer or relinquish it without claiming
 * success. No physical completion contract is accepted by this helper. */
export function createPersonalIntention(world: World, eid: number, description: string, priority: number): number | null {
  return createGeneratedIntention(world, eid, { description, priority, kind: "social" }, "personal");
}

/** Trusted authoring only: a recurring desire, not a task that must continually
 * accumulate progress. This never infers persistence from words or priorities,
 * and does not resurrect a retired desire. Generated proposals stay episodic. */
export function markStandingIntention(world: World, goal: number): void {
  assertSimulationTaskActive();
  let subjective = false;
  try { subjective = JSON.parse(Goal.successJson[goal] || "null")?.type === "custom"; } catch { /* Not a subjective intention. */ }
  if (!entityExists(world, goal) || !hasComponent(world, goal, Goal) || Goal.status[goal] !== "active"
    || Goal.kind[goal] !== "social" || !subjective
    || hasComponent(world, goal, GoalLifecycle) && GoalLifecycle.mode[goal] !== "social") {
    throw new Error("A standing intention must be an active subjective social desire.");
  }
  if (!hasComponent(world, goal, GoalLifecycle)) {
    addComponent(world, goal, GoalLifecycle);
    GoalLifecycle.source[goal] = "personal"; GoalLifecycle.mode[goal] = "social";
    GoalLifecycle.parentGoalEid[goal] = -1; GoalLifecycle.parentCreatedAt[goal] = 0; GoalLifecycle.parentSignature[goal] = "";
    GoalLifecycle.settledAt[goal] = 0; GoalLifecycle.reason[goal] = ""; GoalLifecycle.reviewAfter[goal] = 0;
    GoalLifecycle.deferredJson[goal] = ""; GoalLifecycle.resumedAt[goal] = 0;
  }
  GoalLifecycle.persistence[goal] = "standing" satisfies IntentionPersistence;
  Goal.deadline[goal] = 0;
}

export function isStandingIntention(world: World, goal: number): boolean {
  return hasComponent(world, goal, GoalLifecycle) && GoalLifecycle.persistence[goal] === "standing";
}

export function maintainGoalLifecycles(world: World, eid: number, emit?: (type: string, data: Record<string, unknown>) => void): number {
  assertSimulationTaskActive();
  let changed = 0;
  for (const goal of ownedGoals(world, eid)) {
    if (!hasComponent(world, goal, GoalLifecycle) || !["active", "paused"].includes(Goal.status[goal])) continue;
    let status = "", reason = "";
    const parent = GoalLifecycle.parentGoalEid[goal];
    if (parent >= 0 && (!ownedGoals(world, eid).includes(parent) || !entityExists(world, parent) || Goal.createdAt[parent] !== GoalLifecycle.parentCreatedAt[goal]
      || ensureGoalSignature(world, parent) !== GoalLifecycle.parentSignature[goal] || terminal.has(Goal.status[parent]))) {
      status = "retired"; reason = "The supporting intention is no longer needed by its original parent goal; this is not independent success proof.";
    } else if (Goal.status[goal] === "active" && GoalLifecycle.mode[goal] === "exploratory") {
      const waiting = getRelationTargets(world, eid, HasPlan).some(p => hasComponent(world, p, Plan) && Plan.goalEid[p] === goal && Plan.status[p] === "awaiting_evidence");
      const working = getRelationTargets(world, eid, HasPlan).some(p => hasComponent(world, p, Plan) && Plan.goalEid[p] === goal && Plan.status[p] === "active");
      // Plans are bounded pieces of an intention: reaching a room may expose
      // the next useful action. Completion proves neither the whole goal nor
      // a reason to withdraw. Keep the existing no-new-evidence/review bounds.
      if (!getAgentWorldCapabilities(world, eid)?.busy?.() && !working && (waiting
        || simulationDeadlinePassed(world, goal, "GoalLifecycle.reviewAfter", GoalLifecycle.reviewAfter[goal]))) {
        status = "paused"; reason = waiting
          ? "Exploration paused because its new plan only repeated inspections or arrivals already covered by owned evidence. No new action or goal success is claimed. A new question or relevant evidence can justify further work."
          : "Exploration reached its review boundary without an active plan or a success criterion. Review what was learned before choosing further work; no goal success is claimed.";
      }
    }
    if (!status) continue;
    if (status === "paused" && requestIntentionReconsideration(world, eid, goal, reason)) { changed++; continue; }
    Goal.status[goal] = status; GoalLifecycle.reason[goal] = reason; GoalLifecycle.settledAt[goal] = Date.now();
    stampSimulationTime(world, goal, "GoalLifecycle.settledAt", GoalLifecycle.settledAt[goal]);
    retireGoalPlans(world, goal, getRelationTargets(world, eid, HasPlan));
    emit?.("goal_retired", { agent: Name.value[eid], goal: Goal.description[goal], status, reason }); changed++;
  }
  return changed;
}
