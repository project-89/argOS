/** Actor-selected evidence waits. Background plans cannot choose these tokens. */
import { randomUUID } from "node:crypto";
import { entityExists, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { getRoomForEntity } from "../ecs/location";
import { Agent, Name, WorkingMemoryIdentity } from "../ecs/components";
import { getCommittedEvents } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { readSimulationTime } from "../ecs/simulation-time";
import { captureWorkingMemoryObservation } from "./working-memory-observation";
import { captureActorWaitPlan } from "./planning-system";
import { snapshotActorContinuation } from "./actor-continuation";
import { getAgentObservableEntities, getAgentWorldCapabilityGeneration } from "./world-capabilities";
import { getWorkingMemory } from "./working-memory";
import { getKnownObservableConditions } from "./planning-observable-conditions";
import { PLAN_WAIT_SCHEMA_ERRORS } from "./plan-wait-schema";
import { groundPlanEvidenceCondition, issuePlanEvidenceBarrier, discardPlanEvidenceBarrier,
  getPlanEvidenceBarrierTiming, evaluatePlanEvidenceBarrier, type PlanEvidenceBarrierResult, type PlanWaitUntil, type PlanEvidenceBarrierToken, type PlanWaitIssue } from "./plan-evidence-barrier";

export type ActorWaitIssue = PlanWaitIssue | "non_wait_action" | "listening_conflict" | "context_unavailable";
const WAIT_ISSUE_FEEDBACK: Record<ActorWaitIssue, string> = {
  ...PLAN_WAIT_SCHEMA_ERRORS,
  unsupported_schema: "waitUntil must use a supported typed condition and timeout range, without additional fields or conjunctions.",
  unobserved_subject_or_slot: "The wait subject and slot do not identify one personally observed physical field. Use an offered condition, or omit waitUntil; a described future event is not a registered condition.",
  unavailable_contract: "The selected physical field has no currently accessible observed contract. Reconsider from the current offered conditions.",
  invalid_value: "The requested state is not an allowed value of the observed field. Use its offered values; do not invent a state.",
  composed_prose: "This object has typed observable fields. Use one of those fields, not its composed display description, as a wait condition.",
  non_wait_action: "waitUntil is only supported on action.type=wait. Omit it from other actions.",
  listening_conflict: "Choose either listeningTo or waitUntil on a wait action, not both.",
  context_unavailable: "The actor or physical target is no longer eligible for this wait. Reconsider using the current local context.",
};
export function actorWaitIssueFeedback(issue: ActorWaitIssue): string { return WAIT_ISSUE_FEEDBACK[issue]; }
export function copyActorWaitIssue(value: unknown): ActorWaitIssue | undefined {
  return typeof value === "string" && Object.hasOwn(WAIT_ISSUE_FEEDBACK, value) ? value as ActorWaitIssue : undefined;
}

function basis(world: World, eid: number, condition: PlanWaitUntil, includeEvidence = true) {
  const tape = getCommittedEvents(world);
  if (tape.stopped || !entityExists(world, eid) || !hasComponent(world, eid, Agent)
    || !Agent.active[eid] || !hasComponent(world, eid, WorkingMemoryIdentity)) return;
  // Sensing also exposes declared fields on this actor and its current room.
  // Match that observed scope; neither an adjacent nor remembered remote room
  // is an eligible current target merely because it remains in memory.
  const room = getRoomForEntity(world, eid);
  const targets = condition.kind === "physical_fact" ? [...new Set([eid, ...(room === undefined ? [] : [room]), ...getAgentObservableEntities(world, eid)])]
    .filter(id => hasComponent(world, id, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[id] === condition.subject) : [];
  if (condition.kind === "physical_fact" && targets.length !== 1) return;
  return JSON.stringify([tape.sourceId, WorkingMemoryIdentity.id[eid], Name.value[eid], Agent.role[eid], Agent.systemPrompt[eid],
    targets.map(id => [id, WorkingMemoryIdentity.id[id], Name.value[id]]),
    includeEvidence && condition.kind === "physical_fact" ? [getKnownObservableConditions(world, eid).filter(f => f.subject === condition.subject),
      getWorkingMemory(world, eid).facts.filter(f => f.subject === condition.subject && f.predicate === condition.predicate && f.slot === condition.slot)
        .map(f => [f.value, f.sourceId])] : null]);
}
export function prepareActorWait(world: World, eid: number, raw: unknown) {
  const result = prepareActorWaitChecked(world, eid, raw);
  return "issueCode" in result ? undefined : result.prepared;
}
/** Same admission as prepareActorWait, but retain a fixed diagnostic code. */
export function prepareActorWaitChecked(world: World, eid: number, raw: unknown) {
  const grounded = groundPlanEvidenceCondition(world, eid, raw);
  if ("issue" in grounded) return { issueCode: grounded.issueCode };
  const condition = structuredClone(grounded.condition), original = basis(world, eid, condition);
  if (original === undefined) return { issueCode: "context_unavailable" as const };
  const generation = getAgentWorldCapabilityGeneration(world, eid);
  const identity = basis(world, eid, condition, false);
  const ownerCurrent = () => identity !== undefined && basis(world, eid, condition, false) === identity
    && getAgentWorldCapabilityGeneration(world, eid) === generation;
  return { prepared: { condition, ownerCurrent, current: () => ownerCurrent() && basis(world, eid, condition) === original
    && getAgentWorldCapabilityGeneration(world, eid) === generation
    && !("issue" in groundPlanEvidenceCondition(world, eid, condition)) } };
}
type Choice = { condition: PlanWaitUntil; token: PlanEvidenceBarrierToken; scope: string;
  current: () => boolean; ownerCurrent: () => boolean; goalKey?: string; resolution?: PlanEvidenceBarrierResult; resolvedAtSimMs?: number;
  selectionRevision?: number;
  creditPlan?: (result: PlanEvidenceBarrierResult) => boolean };
const choices = new WeakMap<World, Map<number, Choice>>();
/** Opaque receipt created at dispatch, not inferred from action labels at completion. */
export type ActorWaitOutcomeAuthority = Readonly<{ id: string }>;
type OutcomeAuthority = { world: World; eid: number; selected: boolean; epoch: number; owner: string;
  selection: string; action: string; finished: boolean };
const outcomeAuthorities = new WeakMap<ActorWaitOutcomeAuthority, OutcomeAuthority>();
const choiceEpochs = new WeakMap<World, Map<number, number>>();
function nextChoiceEpoch(world: World, eid: number): number {
  let rows = choiceEpochs.get(world); if (!rows) { rows = new Map(); choiceEpochs.set(world, rows); }
  const epoch = (rows.get(eid) || 0) + 1; rows.set(eid, epoch); return epoch;
}
function outcomeOwner(world: World, eid: number): string {
  return JSON.stringify([getCommittedEvents(world).sourceId, getCommittedEvents(world).stopped,
    entityExists(world, eid) && hasComponent(world, eid, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[eid] : null,
    Agent.active[eid], Name.value[eid], Agent.role[eid], Agent.systemPrompt[eid], getAgentWorldCapabilityGeneration(world, eid)]);
}
function selectionIdentity(world: World, eid: number): string {
  const focus = snapshotActorContinuation(world, eid);
  return JSON.stringify(focus ? [focus.revision, focus.purpose, focus.actionType, focus.target, focus.goalKey,
    focus.integratedAtSimMs, focus.observedAtSimMs] : null);
}
function outcomeAction(action: { type: string; waitUntil?: PlanWaitUntil }): string {
  return JSON.stringify([action.type, action.waitUntil ?? null]);
}
/** selected is supplied only after the executor validates an opaque foreground
 * issuance. Native plan work and late callbacks do not constitute a new choice. */
export function captureActorWaitOutcomeAuthority(world: World, eid: number, action: { type: string; waitUntil?: PlanWaitUntil }, selected: boolean): ActorWaitOutcomeAuthority {
  assertSimulationTaskActive();
  const epoch = selected ? nextChoiceEpoch(world, eid) : choiceEpochs.get(world)?.get(eid) || 0;
  if (selected) {
    const prior = choices.get(world)?.get(eid);
    // Re-selecting the same condition may renew plan binding, not its deadline.
    if (action.type !== "wait" || !action.waitUntil || !prior || JSON.stringify(prior.condition) !== JSON.stringify(action.waitUntil)) clear(world, eid);
  }
  const token = Object.freeze({ id: randomUUID() });
  outcomeAuthorities.set(token, { world, eid, selected, epoch, owner: outcomeOwner(world, eid),
    selection: selectionIdentity(world, eid), action: outcomeAction(action), finished: false });
  return token;
}
function clear(world: World, eid: number) {
  const prior = choices.get(world)?.get(eid);
  if (prior) discardPlanEvidenceBarrier(world, eid, prior.token, prior.scope);
  choices.get(world)?.delete(eid);
}
/** Call at acknowledged execution, not while parsing or drafting an action. */
export function recordActorWait(world: World, eid: number, action: { type: string; waitUntil?: PlanWaitUntil },
  outcome: { succeeded: boolean; pending: boolean; now?: number; waitAuthority?: ActorWaitOutcomeAuthority }) {
  assertSimulationTaskActive();
  if (outcome.waitAuthority !== undefined) {
    const authority = outcomeAuthorities.get(outcome.waitAuthority);
    if (!authority || authority.world !== world || authority.eid !== eid || !authority.selected || authority.finished
      || authority.epoch !== choiceEpochs.get(world)?.get(eid) || authority.owner !== outcomeOwner(world, eid)
      || authority.selection !== selectionIdentity(world, eid) || authority.action !== outcomeAction(action)) return;
    if (outcome.pending) return;
    authority.finished = true;
    // A new non-wait choice already cancelled at admission. Its later result
    // must never cancel a wait chosen in the meantime.
    if (action.type !== "wait") return;
  } else {
    // Compatibility for explicit low-level choice writers. All production
    // executor paths carry dispatch authority, including incidental work.
    nextChoiceEpoch(world, eid);
  }
  if (action.type !== "wait" || !action.waitUntil || !outcome.succeeded || outcome.pending) { clear(world, eid); return; }
  const prepared = prepareActorWait(world, eid, action.waitUntil);
  if (!prepared) { clear(world, eid); return; }
  const prior = choices.get(world)?.get(eid), focus = snapshotActorContinuation(world, eid), goalKey = focus?.goalKey;
  const timing = prior && getPlanEvidenceBarrierTiming(world, eid, prior.token, prior.scope, { nowMs: outcome.now });
  if (prior?.current() && prior.goalKey === goalKey && JSON.stringify(prior.condition) === JSON.stringify(prepared.condition)
    && timing && !timing.clockInvalid && timing.nowMs < timing.deadlineMs) {
    if (prior.selectionRevision !== focus?.revision) {
      prior.creditPlan = captureActorWaitPlan(world, eid, prepared.condition, prior.scope);
      prior.selectionRevision = focus?.revision;
    }
    return;
  }
  clear(world, eid);
  const scope = `actor-wait:${randomUUID()}`;
  const creditPlan = captureActorWaitPlan(world, eid, prepared.condition, scope);
  const token = issuePlanEvidenceBarrier(world, eid, prepared.condition, scope, outcome.now); if (!token) return;
  // Only execution may sample new evidence. Readiness probes never consume
  // observations or infer success from an old matching memory.
  const resolution = prepared.condition.kind === "physical_fact"
    ? evaluatePlanEvidenceBarrier(world, eid, token, scope, { nowMs: outcome.now,
      observation: captureWorkingMemoryObservation(world, eid) }) : undefined;
  const refreshed = prepared.ownerCurrent() ? prepareActorWait(world, eid, prepared.condition) : undefined;
  if (!refreshed) { discardPlanEvidenceBarrier(world, eid, token, scope); return; }
  if (resolution?.status === "satisfied") creditPlan?.(resolution);
  let rows = choices.get(world); if (!rows) { rows = new Map(); choices.set(world, rows); }
  rows.set(eid, { ...refreshed, token, scope, goalKey, creditPlan, selectionRevision: focus?.revision,
    ...(resolution && resolution.status !== "waiting" ? { resolution, resolvedAtSimMs: readSimulationTime(world) } : {}) });
}
/** Foreground control boundary, never an idle/readiness probe. Only newly
 * verified evidence can settle and credit the captured wait episode. */
export function settleActorWait(world: World, eid: number): void {
  assertSimulationTaskActive();
  const row = choices.get(world)?.get(eid); if (!row || row.resolution) return;
  if (!row.ownerCurrent() || row.goalKey !== snapshotActorContinuation(world, eid)?.goalKey) { clear(world, eid); return; }
  const resolution = evaluatePlanEvidenceBarrier(world, eid, row.token, row.scope, {
    ...(row.condition.kind === "physical_fact" ? { observation: captureWorkingMemoryObservation(world, eid) } : {}) });
  const refreshed = row.ownerCurrent() ? prepareActorWait(world, eid, row.condition) : undefined;
  if (!refreshed) { clear(world, eid); return; }
  Object.assign(row, refreshed);
  if (resolution.status !== "waiting") {
    row.resolution = resolution; row.resolvedAtSimMs = readSimulationTime(world);
    if (resolution.status === "satisfied") row.creditPlan?.(resolution);
  }
}
/** Pure scheduling view. Expiry requests reconsideration, never goal success. */
export function getActorWaitTiming(world: World, eid: number, nowMs?: number) {
  const row = choices.get(world)?.get(eid); if (!row) return;
  if (!row.current() || row.goalKey !== snapshotActorContinuation(world, eid)?.goalKey) return { invalid: true as const };
  if (row.resolution) return { invalid: false as const, resolved: true as const, deadlineMs: row.resolvedAtSimMs!,
    nowMs: readSimulationTime(world), clock: "simulation" as const, clockInvalid: readSimulationTime(world) < row.resolvedAtSimMs! };
  const timing = getPlanEvidenceBarrierTiming(world, eid, row.token, row.scope, { nowMs });
  return timing ? { invalid: false as const, resolved: false as const, ...timing } : { invalid: true as const };
}
export function snapshotActorWait(world: World, eid: number) {
  const timing = getActorWaitTiming(world, eid), row = choices.get(world)?.get(eid);
  if (!row || !timing || timing.invalid) return;
  return { condition: structuredClone(row.condition), deadlineSimMs: timing.clock === "simulation" ? timing.deadlineMs : undefined,
    reconsiderationDue: timing.resolved || timing.clockInvalid || timing.nowMs >= timing.deadlineMs,
    ...(row.resolution ? { evidenceResult: structuredClone(row.resolution) } : {}) };
}
export function formatActorWait(world: World, eid: number): string {
  const value = snapshotActorWait(world, eid);
  return value ? `YOUR CHOSEN WAIT: ${JSON.stringify(value)}\nThis is your selected condition, not a guarantee that an event will occur. A due deadline asks you to reconsider; it does not prove the condition happened.` : "";
}
