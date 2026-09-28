/** Private actor-owned control state. A purpose is neither a queued utterance
 * nor execution evidence. It survives an unavailable next action; only the
 * executor may claim that action happened. Restored worlds start a new control
 * session and retain their durable ECS goals/memories instead of replaying work. */
import { addComponent, entityExists, hasComponent } from "bitecs";
import { Agent, CognitiveControl, Goal, Name, WorkingMemoryIdentity } from "../ecs/components";
import type { World } from "../ecs/world";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedSource } from "../runtime/committed-events";
import { getAgentWorldCapabilityGeneration } from "./world-capabilities";
import { requestConversationTurn, reviseConversationTurn, releaseConversationTurn } from "./timed-speech";
import { recordOngoingActivityChoice, type ActivityDisposition } from "./ongoing-activity";
import { getCoordinationGoalRef } from "./coordination-memory";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { randomUUID } from "node:crypto";

export interface NextPurpose {
  id: string; goalId: number; goalKey: string; goalBasis: string; purpose: string;
  chosenAtSimMs: number; afterRequestId: string; afterActionType: string;
  status: "after_step" | "ready"; outcome?: "succeeded" | "failed" | "not_executed" | "reconsider"; settledAtSimMs?: number;
  /** Native acknowledgement starts waiting; it does not establish its condition. */
  waitStartedAtSimMs?: number;
}

export type ContinuationStatus = "proposed" | "waiting" | "needs_revision" | "dispatched";
export interface ActorContinuation {
  revision: number; purpose: string; actionType: string; target?: string;
  status: ContinuationStatus; integratedAtSimMs: number; observedAtSimMs: number;
  reason?: string;
  goalId?: number;
  goalKey?: string;
  switchReason?: string;
  requestId?: string;
  nextPurpose?: Readonly<NextPurpose>;
}
type Owner = { key: string; source: string | null; generation: object | undefined; persona: string };
type State = { owner: Owner; value: ActorContinuation };
const states = new WeakMap<World, Map<number, State>>();
function owner(world: World, eid: number): Owner | undefined {
  const tape = getCommittedSource(world);
  if (!entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid]
    || !hasComponent(world, eid, WorkingMemoryIdentity) || !WorkingMemoryIdentity.id[eid] || tape.stopped) return;
  return { key: WorkingMemoryIdentity.id[eid], source: tape.sourceId,
    generation: getAgentWorldCapabilityGeneration(world, eid),
    persona: JSON.stringify([Name.value[eid], Agent.role[eid], Agent.systemPrompt[eid]]) };
}
function same(a: Owner, b: Owner): boolean {
  return a.key === b.key && a.source === b.source && a.generation === b.generation && a.persona === b.persona;
}
export function snapshotActorContinuation(world: World, eid: number): Readonly<ActorContinuation> | undefined {
  const row = states.get(world)?.get(eid), current = owner(world, eid);
  if (!current) return;
  if (row && !same(row.owner, current)) return;
  if (row && hasComponent(world, eid, CognitiveControl) && CognitiveControl.ownerKey[eid] === current.key
    && CognitiveControl.stateJson[eid] === JSON.stringify(row.value)) return Object.freeze({ ...row.value,
      ...(row.value.nextPurpose ? { nextPurpose: Object.freeze({ ...row.value.nextPurpose }) } : {}) });
  // A restore retains the purpose, but never resumes a serialized command.
  if (hasComponent(world, eid, CognitiveControl) && CognitiveControl.ownerKey[eid] === current.key) {
    try {
      const saved = JSON.parse(CognitiveControl.stateJson[eid]);
      if (typeof saved?.purpose !== "string" || !saved.purpose.trim() || saved.purpose.length > 400
        || !Number.isSafeInteger(saved.revision) || saved.revision < 1 || typeof saved.actionType !== "string"
        || !Number.isFinite(saved.integratedAtSimMs) || !Number.isFinite(saved.observedAtSimMs)) return;
      return Object.freeze({ revision: saved.revision, purpose: saved.purpose, actionType: saved.actionType,
        ...(Number.isSafeInteger(saved.goalId) && typeof saved.goalKey === "string" ? { goalId: saved.goalId, goalKey: saved.goalKey } : {}),
        ...(typeof saved.switchReason === "string" ? { switchReason: saved.switchReason } : {}),
        ...(typeof saved.target === "string" ? { target: saved.target } : {}),
        integratedAtSimMs: saved.integratedAtSimMs, observedAtSimMs: saved.observedAtSimMs,
        status: "needs_revision", reason: row ? "external_control_edit" : "restored_purpose" });
    } catch { return; }
  }
}
function persist(world: World, eid: number, row: State): void {
  addComponent(world, eid, CognitiveControl);
  CognitiveControl.ownerKey[eid] = row.owner.key;
  CognitiveControl.stateJson[eid] = JSON.stringify(row.value);
}
export function integrateActorContinuation(world: World, eid: number, input: {
  purpose: string; actionType: string; target?: string; observedAtSimMs: number;
  goalId?: number; goalKey?: string; switchReason?: string;
  requestId?: string;
  activityDisposition?: ActivityDisposition;
  /** Internal prepared choice; undefined preserves it, null explicitly clears it. */
  nextPurpose?: Readonly<NextPurpose> | null;
}): number | undefined {
  const current = owner(world, eid);
  if (!current || !input.purpose.trim() || input.purpose.length > 400
    || !Number.isFinite(input.observedAtSimMs) || input.observedAtSimMs > readSimulationTime(world)) return;
  const previous = snapshotActorContinuation(world, eid);
  const revision = (previous?.revision ?? 0) + 1;
  let rows = states.get(world); if (!rows) { rows = new Map(); states.set(world, rows); }
  const { nextPurpose: chosenNext, ...immediate } = input;
  const nextPurpose = chosenNext === undefined ? previous?.nextPurpose : chosenNext;
  rows.set(eid, { owner: current, value: { ...immediate, ...(nextPurpose ? { nextPurpose: { ...nextPurpose } } : {}),
    revision, status: "proposed", integratedAtSimMs: readSimulationTime(world) } });
  persist(world, eid, rows.get(eid)!);
  recordOngoingActivityChoice(world, eid, { purpose: input.purpose, actionType: input.actionType,
    goalId: input.goalId, disposition: input.activityDisposition, switchReason: input.switchReason });
  if (input.actionType === "speak" && world.meta.timedSpeech) {
    requestConversationTurn(world, eid, input.target, () => {
      const value = snapshotActorContinuation(world, eid);
      return !!value && value.actionType === "speak" && value.target === input.target
        && !["external_control_edit", "restored_purpose"].includes(value.reason || "");
    });
  } else releaseConversationTurn(world, eid);
  return revision;
}
export function updateActorContinuation(world: World, eid: number, revision: number,
  status: ContinuationStatus, reason?: string): void {
  const current = snapshotActorContinuation(world, eid);
  if (!current || current.revision !== revision) return;
  const row = states.get(world)?.get(eid); if (!row) return;
  // An external ECS edit is new intent data, never authority for an old command.
  if (current.reason === "external_control_edit" && status !== "needs_revision") return;
  row.value = { ...current, status, ...(reason ? { reason } : { reason: undefined }) };
  // A queued utterance invalidated before dispatch will never produce a native
  // completion. Preserve its later purpose for fresh review, without claiming
  // that the cancelled words happened. Already dispatched work must settle
  // through its own native outcome instead.
  if (status === "needs_revision" && current.status !== "dispatched" && current.nextPurpose?.status === "after_step"
    && current.requestId === current.nextPurpose.afterRequestId) {
    row.value.nextPurpose = { ...current.nextPurpose, status: "ready", outcome: "not_executed", settledAtSimMs: readSimulationTime(world) };
  }
  persist(world, eid, row);
  if (status === "needs_revision") reviseConversationTurn(world, eid);
}
export function formatActorContinuation(world: World, eid: number): string {
  const value = snapshotActorContinuation(world, eid);
  return value ? `LATEST CHOSEN APPROACH (private purpose and next-step choice, not a new enduring goal or proof of execution):\n${JSON.stringify(value)}\nContinue, revise, or replace this approach in light of what you have actually perceived. A dispatched step is not a completed goal.` : "";
}

const prose = (x: unknown): x is string => typeof x === "string" && !!x.trim() && x.length <= 400 && !/[\u0000-\u001f\u007f]/u.test(x);
const goalBasis = (world: World, eid: number, goal: number) => JSON.stringify([getCoordinationGoalRef(world, eid, goal),
  Goal.description[goal], Goal.kind[goal], Goal.paramsJson[goal], Goal.successJson[goal]]);
function nextGoalCurrent(world: World, eid: number, next: Readonly<NextPurpose>): boolean {
  return Goal.status[next.goalId] === "active" && WorkingMemoryIdentity.id[next.goalId] === next.goalKey
    && !!getCoordinationGoalRef(world, eid, next.goalId) && goalBasis(world, eid, next.goalId) === next.goalBasis;
}
/** Read-only demand for a possibility, not a motor grant. Observers must use
 * the same owned-goal definition as take/review, never saved or edited prose. */
export function observeChosenNextPurpose(world: World, eid: number): Readonly<NextPurpose> | undefined {
  const continuation = snapshotActorContinuation(world, eid), next = continuation?.nextPurpose;
  if (!next || ["restored_purpose", "external_control_edit"].includes(continuation.reason || "")
    || readSimulationTime(world) < next.chosenAtSimMs || !nextGoalCurrent(world, eid, next)) return;
  return next;
}
/** Extends the existing continuation, not a second action queue. Explicit
 * prospective intent survives side thoughts; only a fresh selection may take
 * it up or cancel it. No reasoning/deferral prose is parsed into this choice. */
export function prepareNextPurposeUpdate(world: World, eid: number, next: unknown, review: unknown,
  selection: { requestId: string; actionType: string; goalId?: number | null | "new"; listedGoals: ReadonlySet<number> }) {
  const prior = snapshotActorContinuation(world, eid)?.nextPurpose, originalOwner = owner(world, eid);
  if (!originalOwner) return;
  let value: Readonly<NextPurpose> | null | undefined;
  let taking = false;
  let summary: Readonly<{ id: string; goalId: number; disposition: "choose" | "take" | "cancel"; reason: string }> | undefined;
  if (next !== undefined) {
    if (prior || review !== undefined || !next || typeof next !== "object" || Array.isArray(next)) return;
    const n = next as Record<string, unknown>;
    if (Object.keys(n).some(k => !["goalId", "purpose"].includes(k)) || !Number.isSafeInteger(n.goalId)
      || !selection.listedGoals.has(n.goalId as number) || !prose(n.purpose)
      || !["speak", "move", "pickup", "drop", "use", "give", "interact", "observe", "examine", "wait"].includes(selection.actionType)) return;
    const goal = n.goalId as number, ref = getCoordinationGoalRef(world, eid, goal);
    if (!ref || Goal.status[goal] !== "active") return;
    value = Object.freeze({ id: `next-purpose:${randomUUID()}`, goalId: goal, goalKey: ref.goalKey,
      goalBasis: goalBasis(world, eid, goal), purpose: n.purpose.trim(), chosenAtSimMs: readSimulationTime(world),
      afterRequestId: selection.requestId, afterActionType: selection.actionType, status: "after_step" });
    summary = Object.freeze({ id: value.id, goalId: goal, disposition: "choose", reason: n.purpose.trim() });
  } else if (review !== undefined) {
    if (!prior || !review || typeof review !== "object" || Array.isArray(review)) return;
    const r = review as Record<string, unknown>;
    if (Object.keys(r).some(k => !["id", "disposition", "reason"].includes(k)) || r.id !== prior.id || !prose(r.reason)
      || !["take", "cancel"].includes(String(r.disposition))) return;
    if (r.disposition === "take" && (prior.status !== "ready" || selection.goalId !== prior.goalId
      || !nextGoalCurrent(world, eid, prior))) return;
    taking = r.disposition === "take";
    summary = Object.freeze({ id: prior.id, goalId: prior.goalId, disposition: taking ? "take" : "cancel", reason: r.reason.trim() });
    value = null;
  } else if (prior?.status === "ready") return; // A due choice cannot be silently overwritten.
  const before = JSON.stringify(prior), at = readSimulationTime(world);
  const current = () => {
    const actual = owner(world, eid);
    return !!actual && same(actual, originalOwner) && readSimulationTime(world) >= at
      && JSON.stringify(snapshotActorContinuation(world, eid)?.nextPurpose) === before
      && (!value || nextGoalCurrent(world, eid, value))
      && (!taking || !!prior && nextGoalCurrent(world, eid, prior));
  };
  return { value, current, summary };
}

/** Called only from native outcome bookkeeping. Matching request/type, owner,
 * source and clock bind this to the chosen step, including asynchronous speech.
 * Success AND failure request fresh review; neither authorizes the next action. */
export function settleNextPurpose(world: World, eid: number, action: { type: string; foregroundDecisionId?: string },
  outcome: { succeeded: boolean; pending: boolean }): void {
  assertSimulationTaskActive();
  const value = snapshotActorContinuation(world, eid), next = value?.nextPurpose, row = states.get(world)?.get(eid);
  const now = readSimulationTime(world);
  if (!row || !next || next.status !== "after_step" || outcome.pending || action.foregroundDecisionId !== next.afterRequestId
    || action.type !== next.afterActionType || value?.reason === "external_control_edit" || value?.reason === "restored_purpose"
    || !Number.isFinite(now) || now < next.chosenAtSimMs) return;
  if (action.type === "wait" && outcome.succeeded) {
    row.value = { ...row.value, nextPurpose: { ...next, waitStartedAtSimMs: now } };
    persist(world, eid, row);
    return;
  }
  row.value = { ...row.value, nextPurpose: { ...next, status: "ready", outcome: outcome.succeeded ? "succeeded" : "failed",
    settledAtSimMs: now } };
  persist(world, eid, row);
}
/** Call at an admitted foreground reconsideration boundary, not on every idle
 * probe. New evidence, a listening boundary or a deadline requests review;
 * none proves an answer arrived. A draft/unexecuted wait cannot reach here. */
export function reconsiderNextPurposeAfterWait(world: World, eid: number): void {
  assertSimulationTaskActive();
  const value = snapshotActorContinuation(world, eid), next = value?.nextPurpose, row = states.get(world)?.get(eid);
  const now = readSimulationTime(world);
  if (!row || !next || next.status !== "after_step" || next.afterActionType !== "wait"
    || next.waitStartedAtSimMs === undefined || now < next.waitStartedAtSimMs) return;
  row.value = { ...row.value, nextPurpose: { ...next, status: "ready", outcome: "reconsider", settledAtSimMs: now } };
  persist(world, eid, row);
}
export function hasNextPurposeReview(world: World, eid: number): boolean {
  return snapshotActorContinuation(world, eid)?.nextPurpose?.status === "ready";
}
export function formatNextPurpose(world: World, eid: number): string {
  const next = snapshotActorContinuation(world, eid)?.nextPurpose;
  if (!next) return "";
  const { goalBasis: _, afterRequestId: __, ...visible } = next;
  return `YOUR CHOSEN NEXT PURPOSE (not a queued action):\n${JSON.stringify({ ...visible,
    goalStillCurrent: nextGoalCurrent(world, eid, next), ageSeconds: (readSimulationTime(world) - next.chosenAtSimMs) / 1000 })}\n`
    + (next.status === "ready" ? `${next.outcome === "reconsider" ? "Your wait reached a reconsideration boundary; this does not establish that you received an answer." : "The preceding step has ended."} Include control.nextPurposeReview in this response, even when the action serves the same goal. Its shape is ${JSON.stringify({ id: next.id, disposition: "take", reason: "your reason" })}; choose disposition "take" or "cancel" yourself. To take it, set control.goalId=${next.goalId} and choose a fresh action from current evidence. To pursue something else, explicitly cancel this earlier choice. Keep nextPurposeReview inside control, alongside purpose and goalId. Neither outcome proves the earlier goal succeeded.\n`
      : `This remains your later choice while the preceding step is unresolved. You may cancel it explicitly; another thought does not erase or execute it.\n`);
}
