/** A small coordination ledger, not a shared omniscient task board.
 *
 * Semantic reviews interpret already-spoken words and personally owned evidence.
 * Executor outcomes and verified goal contracts alone establish work progress.
 * A private discovery never becomes someone else's knowledge until they actually
 * hear the corresponding report. None of these operations chooses an action. */
import { addComponent, entityExists, getRelationTargets, hasComponent, query } from "bitecs";
import { randomUUID } from "node:crypto";
import type { World } from "../ecs/world";
import { Agent, CoordinationMemory, Goal, WorkingMemoryIdentity } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { computeGoalSignature, type GoalKind } from "./goal-contract";
import { getSocialDialogue, getSocialExchanges, type SocialDialogueTurn } from "./social-memory";
import { getPrivateCommunications, isPrivateCommunicationReceipt, type PrivateCommunicationReceipt } from "./communication-memory";
type CoordinationSource = SocialDialogueTurn | PrivateCommunicationReceipt;
import { getWorkingMemory, readWorkingMemory, workingMemoryEntityRef, type WorkingMemoryFact, type WorkingMemoryReceipt } from "./working-memory";
import { actorKnowsGoalCondition, copyActorGoalCondition, type ActorGoalCondition } from "./actor-goal-evidence";
import { consumeWorkingMemoryObservation, type WorkingMemoryObservationSnapshot } from "./working-memory-observation";
import { getPreparedIntentionGoalRef, isStandingIntention, type PreparedGeneratedIntention } from "./goal-lifecycle";

export type CoordinationLocalStatus = "not_started" | "in_progress" | "blocked" | "verified_done" | "released";
export type CoordinationReportedStatus = "not_started" | "in_progress" | "blocked" | "completed" | "released";
export interface CoordinationGoalRef { ownerKey: string; goalKey: string; signature: string; createdAt: number }
/** A concrete undertaking episode, independent of any broader supporting goal. */
export interface CoordinationWorkRef { ownerKey: string; itemId: string; generation: string }
export interface CoordinationActionCompletion {
  type: "action"; actionType: string; target: string; content?: string;
}
export interface CoordinationStoredCompletion extends CoordinationActionCompletion { targetKey: string }
export interface CoordinationEvidence {
  id: string; atMs: number; kind: "receipt" | "executor_result" | "goal_verdict" | "choice";
  summary: string;
  receipt?: WorkingMemoryReceipt;
}
export interface CoordinationItem {
  /** The original committed speech identity; retransmission cannot create work. */
  id: string; task: string; ownerKey: string; speaker: string; own: boolean;
  undertaking: CoordinationSource;
  /** Missing only in old saves; allocated lazily at an explicit capture boundary. */
  generation?: string;
  goal?: CoordinationGoalRef;
  /** Absence in legacy data means supports, never an implicit completion proof. */
  goalRelation?: "supports" | "fulfills";
  completion?: CoordinationStoredCompletion;
  /** Tracking ending is bookkeeping, not the actor withdrawing a promise. */
  goalTracking?: { status: "ended"; atMs: number };
  /** Engine-private retained gate, deliberately omitted from cognitive context
   * and listener copies. Only subsequent owned evidence can discharge it. */
  pendingGoalProof?: { condition: ActorGoalCondition; afterMs: number };
  localStatus?: CoordinationLocalStatus;
  localReason?: string;
  localEvidence?: CoordinationEvidence[];
  localVersion?: number;
  localUpdatedAt?: number;
  lastReported: { status: CoordinationReportedStatus; speech: CoordinationSource; localVersion?: number };
  lastAction?: { sourceId: string; atMs: number; sequence: number };
  updatedAt: number;
}
export interface ActorCoordinationMemory { items: CoordinationItem[]; revision: number }
export interface PreparedCoordinationReviews { readonly id: string }
type CoordinationDraft = { world: World; eid: number; before: string; speechBefore: string; items: CoordinationItem[];
  publications: Array<{ item: CoordinationItem; undertaking: boolean }>; changed: number; consumed: boolean;
  prospectiveGoal?: CoordinationGoalRef };
const coordinationDrafts = new WeakMap<PreparedCoordinationReviews, CoordinationDraft>();
export type CoordinationReview =
  | { kind: "undertake"; speechId: string; task: string; goalId?: number | "new"; goalRelation?: "supports" | "fulfills"; completion?: CoordinationActionCompletion }
  | { kind: "link"; id: string; goalId?: number | "new"; goalRelation?: "supports" | "fulfills"; completion?: CoordinationActionCompletion }
  | { kind: "blocked"; id: string; reason: string; evidenceIds: string[] }
  | { kind: "release"; id: string; reason: string }
  | { kind: "report"; id: string; speechId: string; status: CoordinationReportedStatus };
export interface CoordinationActionIssuance {
  workRef: CoordinationWorkRef; sourceId: string; issuedAt: number;
  actionType: string; target?: string; targetKey?: string; content?: string;
  /** Actor-local issuance order prevents replay after a newer terminal result. */
  sequence: number;
}
export const COORDINATION_LIMITS = { items: 24, reviews: 3, evidence: 4 } as const;
const localStatuses = new Set(["not_started", "in_progress", "blocked", "verified_done", "released"]);
const reportedStatuses = new Set(["not_started", "in_progress", "blocked", "completed", "released"]);
const terminalGoals = new Set(["completed", "retired", "expired", "failed"]);
const workActions = new Set(["move", "pickup", "drop", "give", "use", "interact", "attack", "observe", "examine"]);
const issuanceClocks = new WeakMap<World, Map<string, number>>();
const text = (s: unknown, limit = 300): s is string => typeof s === "string" && s.trim().length > 0 && s.length <= limit;
const time = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const count = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;
const actor = (world: World, eid: number) => entityExists(world, eid) && hasComponent(world, eid, Agent);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const ownerKey = (world: World, eid: number) => actor(world, eid) && hasComponent(world, eid, WorkingMemoryIdentity)
  && text(WorkingMemoryIdentity.id[eid]) ? WorkingMemoryIdentity.id[eid] : undefined;
const ownsStore = (world: World, eid: number) => ownerKey(world, eid) !== undefined && hasComponent(world, eid, CoordinationMemory)
  && CoordinationMemory.ownerKey[eid] === ownerKey(world, eid);
function validSpeech(t: any): t is CoordinationSource {
  if (t?.medium === "text") return isPrivateCommunicationReceipt(t);
  return !!t && text(t.id) && time(t.atMs) && text(t.speaker) && text(t.content, 2000) && text(t.room)
    && typeof t.own === "boolean" && (t.target === undefined || text(t.target));
}
function validRef(r: any): r is CoordinationGoalRef {
  return !!r && text(r.ownerKey) && text(r.goalKey) && text(r.signature) && time(r.createdAt);
}
function validWorkRef(r: any): r is CoordinationWorkRef {
  return !!r && text(r.ownerKey) && text(r.itemId) && text(r.generation);
}
function validCompletion(c: any): c is CoordinationActionCompletion {
  // Giving identifies both recipient and item. Until both actual identities
  // travel with the executor receipt, it can show progress but not completion.
  return !!c && c.type === "action" && workActions.has(c.actionType) && c.actionType !== "give" && text(c.target)
    && (c.content === undefined || text(c.content, 2000));
}
function validEvidence(e: any): e is CoordinationEvidence {
  if (!e || !text(e.id) || !time(e.atMs) || !text(e.summary, 1000)
    || !["receipt", "executor_result", "goal_verdict", "choice"].includes(e.kind)) return false;
  if (e.kind !== "receipt") return e.receipt === undefined;
  const r = e.receipt;
  return !!r && r.id === e.id && time(r.atMs) && text(r.summary, 1000)
    && ["action", "observation"].includes(r.kind) && ["own_action", "witnessed_action", "visible_observation", "own_observation"].includes(r.provenance)
    && Array.isArray(r.facts) && r.facts.length <= 32 && r.facts.every((f: any) => !!f && text(f.subject)
      && ["location", "state", "possession"].includes(f.predicate) && text(f.value)
      && (f.slot === undefined || text(f.slot, 100)) && (f.subjectLabel === undefined || text(f.subjectLabel))
      && (f.valueLabel === undefined || text(f.valueLabel)));
}
function validItem(i: any, observerKey: string): i is CoordinationItem {
  if (!i || !text(i.id) || !text(i.task) || !text(i.ownerKey) || !text(i.speaker) || typeof i.own !== "boolean"
    || !validSpeech(i.undertaking) || i.id !== i.undertaking.id || i.speaker !== i.undertaking.speaker
    || i.undertaking.own !== i.own || !time(i.updatedAt)
    || !i.lastReported || !reportedStatuses.has(i.lastReported.status) || !validSpeech(i.lastReported.speech)
    || i.lastReported.speech.own !== i.own
    || i.lastReported.speech.atMs < i.undertaking.atMs) return false;
  if (!i.own) return i.ownerKey !== observerKey && i.goal === undefined && i.localStatus === undefined
    && i.generation === undefined && i.goalRelation === undefined && i.completion === undefined
    && i.goalTracking === undefined && i.pendingGoalProof === undefined
    && i.localReason === undefined && i.localEvidence === undefined && i.localVersion === undefined && i.localUpdatedAt === undefined
    && i.lastAction === undefined && i.lastReported.localVersion === undefined;
  return i.ownerKey === observerKey && localStatuses.has(i.localStatus) && text(i.localReason, 1000)
    && count(i.localVersion) && time(i.localUpdatedAt) && Array.isArray(i.localEvidence)
    && i.localEvidence.length <= COORDINATION_LIMITS.evidence && i.localEvidence.every(validEvidence)
    && (i.generation === undefined || text(i.generation))
    && (i.goalRelation === undefined || ["supports", "fulfills"].includes(i.goalRelation))
    && (i.goalRelation !== "fulfills" || i.goal !== undefined)
    && (i.completion === undefined || validCompletion(i.completion) && text(i.completion.targetKey))
    && (i.goal === undefined || validRef(i.goal) && i.goal.ownerKey === observerKey)
    && (i.goalTracking === undefined || i.goal !== undefined && i.goalTracking?.status === "ended" && time(i.goalTracking.atMs))
    && (i.pendingGoalProof === undefined || i.goal !== undefined && time(i.pendingGoalProof?.afterMs)
      && i.pendingGoalProof.afterMs >= i.goal.createdAt && !!copyActorGoalCondition(i.pendingGoalProof.condition)
      && equal(copyActorGoalCondition(i.pendingGoalProof.condition), i.pendingGoalProof.condition))
    && (i.lastReported.localVersion === undefined || count(i.lastReported.localVersion) && i.lastReported.localVersion <= i.localVersion)
    && (i.lastAction === undefined || text(i.lastAction.sourceId) && time(i.lastAction.atMs) && count(i.lastAction.sequence));
}
/** Pure and detached, including malformed or legacy checkpoints. */
export function getCoordinationMemory(world: World, eid: number): ActorCoordinationMemory {
  if (!ownsStore(world, eid)) return { items: [], revision: 0 };
  let raw: unknown; try { raw = JSON.parse(CoordinationMemory.itemsJson[eid] || "[]"); } catch { raw = []; }
  const seen = new Set<string>();
  const items = (Array.isArray(raw) ? raw : []).filter(i => validItem(i, ownerKey(world, eid)!) && !seen.has(i.id) && seen.add(i.id))
    .sort((a, b) => a.undertaking.atMs - b.undertaking.atMs || a.id.localeCompare(b.id)).slice(-COORDINATION_LIMITS.items);
  return { items, revision: getCoordinationRevision(world, eid) };
}
/** Constant-time actor-owned revision probe. Scheduling must not deserialize the
 * bounded evidence ledger just to find out whether anything changed. */
export function getCoordinationRevision(world: World, eid: number): number {
  return ownsStore(world, eid) && count(CoordinationMemory.revision[eid]) ? CoordinationMemory.revision[eid] : 0;
}
function write(world: World, eid: number, items: CoordinationItem[]): boolean {
  const key = ownerKey(world, eid) || workingMemoryEntityRef(world, eid)?.key;
  if (!key) return false;
  const previous = getCoordinationMemory(world, eid);
  const next = items.sort((a, b) => a.undertaking.atMs - b.undertaking.atMs || a.id.localeCompare(b.id)).slice(-COORDINATION_LIMITS.items);
  if (equal(previous.items, next)) return false;
  if (!hasComponent(world, eid, CoordinationMemory)) addComponent(world, eid, CoordinationMemory);
  CoordinationMemory.ownerKey[eid] = key;
  CoordinationMemory.itemsJson[eid] = JSON.stringify(next);
  CoordinationMemory.revision[eid] = previous.revision + 1;
  return true;
}
function ownedGoals(world: World, eid: number): number[] {
  return getRelationTargets(world, eid, HasGoal).filter(g => entityExists(world, g) && hasComponent(world, g, Goal));
}
function goalSignature(goal: number): string | undefined {
  try {
    if (!text(Goal.kind[goal])) return;
    const params = JSON.parse(Goal.paramsJson[goal] || "{}"), success = JSON.parse(Goal.successJson[goal] || "null");
    if (!params || typeof params !== "object" || Array.isArray(params) || !success || typeof success !== "object") return;
    return computeGoalSignature({ version: 1, kind: Goal.kind[goal] as GoalKind, params, success });
  } catch { return; }
}
/** Pure goal identity lookup; signatures are recomputed without updating Goal. */
export function getCoordinationGoalRef(world: World, eid: number, goalId: number): CoordinationGoalRef | undefined {
  const key = ownerKey(world, eid), goals = ownedGoals(world, eid);
  if (!key || !Number.isSafeInteger(goalId) || !goals.includes(goalId) || !time(Goal.createdAt[goalId])
    || !hasComponent(world, goalId, WorkingMemoryIdentity) || !text(WorkingMemoryIdentity.id[goalId])) return;
  const goalKey = WorkingMemoryIdentity.id[goalId];
  const signature = goalSignature(goalId); if (!signature) return;
  if (goals.filter(g => hasComponent(world, g, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[g] === goalKey).length !== 1) return;
  return { ownerKey: key, goalKey, signature, createdAt: Goal.createdAt[goalId] };
}
/** Capture only for an explicitly matched plan/goal at actual issuance. */
export function captureCoordinationGoal(world: World, eid: number, goalId: number): CoordinationGoalRef | undefined {
  assertSimulationTaskActive();
  if (!actor(world, eid) || !ownedGoals(world, eid).includes(goalId)) return;
  workingMemoryEntityRef(world, eid);
  // Goals need no Name component. The durable identity belongs to the concrete
  // episode, so a same-contract replacement in the same millisecond is distinct.
  if (!hasComponent(world, goalId, WorkingMemoryIdentity)) {
    addComponent(world, goalId, WorkingMemoryIdentity); WorkingMemoryIdentity.id[goalId] = `goal:${randomUUID()}`;
  } else if (!text(WorkingMemoryIdentity.id[goalId])) WorkingMemoryIdentity.id[goalId] = `goal:${randomUUID()}`;
  const ref = getCoordinationGoalRef(world, eid, goalId);
  return ref ? Object.freeze(ref) : undefined;
}
/** Explicit work identity. Goal priority, a matching goal or similar prose never
 * selects work on the actor's behalf. Ordinary progress preserves this identity. */
export function captureCoordinationWork(world: World, eid: number, itemId: string): CoordinationWorkRef | undefined {
  assertSimulationTaskActive();
  const memory = getCoordinationMemory(world, eid);
  const item = memory.items.find(i => i.id === itemId && i.own && !["verified_done", "released"].includes(i.localStatus || ""));
  if (!item) return;
  if (!item.generation) {
    item.generation = `work:${randomUUID()}`;
    write(world, eid, memory.items);
  }
  return Object.freeze({ ownerKey: item.ownerKey, itemId: item.id, generation: item.generation });
}
/** Resolve only previously admitted personal evidence, including known remote
 * objects. This declares a future objective, not current action availability. */
function knownTargetKey(world: World, eid: number, target: string): string | undefined {
  const memory = getWorkingMemory(world, eid), matches = new Set<string>();
  for (const fact of [...memory.facts, ...memory.receipts.flatMap(receipt => receipt.facts)]) {
    if (fact.subject === target || fact.subjectLabel === target) matches.add(fact.subject);
    if (["location", "possession"].includes(fact.predicate) && (fact.value === target || fact.valueLabel === target)) matches.add(fact.value);
  }
  return matches.size === 1 ? [...matches][0] : undefined;
}
function completionDeclaration(world: World, eid: number, input: unknown): CoordinationStoredCompletion | undefined {
  if (!validCompletion(input)) return;
  const targetKey = knownTargetKey(world, eid, input.target); if (!targetKey) return;
  return { type: "action", actionType: input.actionType, target: input.target, targetKey,
    ...(input.content === undefined ? {} : { content: input.content }) };
}
/** Capture one explicitly selected undertaking immediately before execution.
 * The supporting goal may have ended; it is not the identity of this work. */
export function captureCoordinationAction(world: World, eid: number, workRef: CoordinationWorkRef,
  action: { type: string; target?: string; content?: string }): CoordinationActionIssuance | undefined {
  assertSimulationTaskActive();
  if (!validWorkRef(workRef) || workRef.ownerKey !== ownerKey(world, eid) || !action || !workActions.has(action.type)
    || action.target !== undefined && !text(action.target) || action.content !== undefined && !text(action.content, 2000)) return;
  const memory = getCoordinationMemory(world, eid);
  const item = memory.items.find(i => i.own && i.id === workRef.itemId && i.generation === workRef.generation
    && !["verified_done", "released"].includes(i.localStatus || ""));
  if (!item) return;
  let clocks = issuanceClocks.get(world); if (!clocks) { clocks = new Map(); issuanceClocks.set(world, clocks); }
  const sequence = Math.max(clocks.get(workRef.ownerKey) || 0, ...memory.items.map(i => i.lastAction?.sequence || 0)) + 1;
  clocks.set(workRef.ownerKey, sequence);
  const targetKey = action.target === undefined ? undefined : knownTargetKey(world, eid, action.target);
  return Object.freeze({ workRef: Object.freeze({ ...workRef }), sourceId: `coordination-action:${randomUUID()}`, issuedAt: Date.now(), actionType: action.type,
    ...(action.target === undefined ? {} : { target: action.target }), ...(targetKey === undefined ? {} : { targetKey }),
    ...(action.content === undefined ? {} : { content: action.content }), sequence });
}
function resolveGoal(world: World, eid: number, ref: CoordinationGoalRef): number | undefined {
  if (ownerKey(world, eid) !== ref.ownerKey) return;
  const matches = ownedGoals(world, eid).filter(g => hasComponent(world, g, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[g] === ref.goalKey
    && Goal.createdAt[g] === ref.createdAt && goalSignature(g) === ref.signature);
  return matches.length === 1 ? matches[0] : undefined;
}
/** Private planning projection, not a request to execute or a shared agreement.
 * Resolve actual owned goal identity, even before bookkeeping reconciliation.
 * Deferred episodic work is still represented. A standing motive can support
 * an undertaking but does not choose its concrete follow-through. Ending a
 * preparatory goal is not ending the undertaking. No keyword matching or
 * wall-time conversion. */
export function coordinationPlanningContext(world: World, eid: number) {
  return getCoordinationMemory(world, eid).items.filter(item => item.own
    && !["verified_done", "released"].includes(item.localStatus || "")).map(item => {
    const goal = item.goal && resolveGoal(world, eid, item.goal);
    const represented = goal !== undefined && !isStandingIntention(world, goal)
      && ["active", "paused", "queued", "pending"].includes(Goal.status[goal]);
    return { id: item.id, generation: item.generation, task: item.task, original: item.undertaking,
      localStatus: item.localStatus, lastReported: item.lastReported, goal: item.goal,
      linkedIntention: goal === undefined ? null : { id: goal, description: Goal.description[goal], status: Goal.status[goal] },
      needsFollowUp: !represented };
  });
}
function speech(world: World, eid: number): CoordinationSource[] {
  return [...getSocialDialogue(world, eid), ...getSocialExchanges(world, eid).flatMap(e => [e.question, e.response]), ...getPrivateCommunications(world, eid)];
}
function laterSpeech(world: World, eid: number, source: CoordinationSource, prior: CoordinationSource): boolean {
  if (source.id === prior.id || source.atMs < prior.atMs) return false;
  if (source.atMs > prior.atMs) return true;
  // Several real turns may share Date.now. The admitted dialogue order is the
  // only proof of which came later; arbitrary UUID sorting would invent order.
  const bothTexts = "medium" in source && "medium" in prior;
  const turns = bothTexts ? getPrivateCommunications(world, eid) : getSocialDialogue(world, eid), previousIndex = turns.findIndex(t => t.id === prior.id);
  return previousIndex >= 0 && turns.findIndex(t => t.id === source.id) > previousIndex;
}
function localChange(item: CoordinationItem, status: CoordinationLocalStatus, reason: string, evidence: CoordinationEvidence[], atMs: number): boolean {
  if (item.localStatus === status && item.localReason === reason && equal(item.localEvidence, evidence)) return false;
  item.localStatus = status; item.localReason = reason; item.localEvidence = copy(evidence);
  item.localVersion = (item.localVersion || 0) + 1; item.localUpdatedAt = atMs; item.updatedAt = Math.max(item.updatedAt, atMs);
  return true;
}
function heardCopy(item: CoordinationItem, undertaking: CoordinationSource, report = item.lastReported.speech): CoordinationItem {
  // The speaker's semantic task label may contain private motives or details
  // omitted from the utterance. Only the actual heard words cross this boundary.
  return { id: item.id, task: undertaking.content.slice(0, 300), ownerKey: item.ownerKey, speaker: item.speaker, own: false,
    undertaking: copy(undertaking), lastReported: { status: item.lastReported.status, speech: { ...copy(report), own: false } }, updatedAt: report.atMs };
}
function publish(world: World, speakerEid: number, item: CoordinationItem, isUndertaking: boolean): void {
  const source = isUndertaking ? item.undertaking : item.lastReported.speech;
  // Private correspondence is never broadcast through room-listener accounts.
  if ("medium" in source && source.medium === "text") return;
  for (const observer of query(world, [Agent])) {
    if (observer === speakerEid) continue;
    const heard = speech(world, observer).find(t => t.id === source.id && !t.own && t.atMs === source.atMs
      && t.speaker === source.speaker && t.content === source.content && t.room === source.room && t.target === source.target);
    if (!heard) continue;
    const memory = getCoordinationMemory(world, observer), old = memory.items.find(i => i.id === item.id);
    if (isUndertaking) {
      if (old || memory.items.length >= COORDINATION_LIMITS.items && item.undertaking.atMs <= memory.items[0].undertaking.atMs) continue;
      write(world, observer, [...memory.items, heardCopy(item, heard)]);
    } else if (old && !old.own && old.ownerKey === item.ownerKey && heard.atMs >= old.lastReported.speech.atMs
      && heard.id !== old.lastReported.speech.id) {
      old.lastReported = { status: item.lastReported.status, speech: copy(heard) }; old.updatedAt = heard.atMs;
      write(world, observer, memory.items);
    }
  }
}
/** Semantic interpretations use actual owned sources. No model-supplied result
 * can establish physical completion or rewrite someone else's work account. */
export function prepareCoordinationReviews(world: World, eid: number, input: unknown,
  options: { newGoalId?: number; newIntention?: PreparedGeneratedIntention | null } = {}): PreparedCoordinationReviews | undefined {
  assertSimulationTaskActive();
  if (!actor(world, eid) || !Array.isArray(input) || input.length > COORDINATION_LIMITS.reviews) return;
  const initial = getCoordinationMemory(world, eid);
  let staged = copy(initial.items);
  const publications: CoordinationDraft["publications"] = [];
  const stage = (items: CoordinationItem[]) => {
    const next = items.sort((a, b) => a.undertaking.atMs - b.undertaking.atMs || a.id.localeCompare(b.id)).slice(-COORDINATION_LIMITS.items);
    if (equal(staged, next)) return false;
    staged = copy(next); return true;
  };
  const prospectiveGoal = options.newIntention ? getPreparedIntentionGoalRef(world, eid, options.newIntention) : undefined;
  let changed = 0;
  for (const r of input) {
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const memory = { items: copy(staged) }, now = Date.now();
    const currentSpeech = speech(world, eid);
    const requestedGoal = r.goalId === "new" ? options.newGoalId : r.goalId;
    const link = () => {
      if (r.goalId === "new" && prospectiveGoal) return prospectiveGoal;
      if (!Number.isSafeInteger(requestedGoal) || terminalGoals.has(Goal.status[requestedGoal])) return;
      return getCoordinationGoalRef(world, eid, requestedGoal);
    };
    if (["undertake", "link"].includes(r.kind) && r.goalRelation !== undefined && !["supports", "fulfills"].includes(r.goalRelation)) continue;
    if (r.kind === "undertake") {
      if (!text(r.speechId) || !text(r.task) || memory.items.some(i => i.id === r.speechId)) continue;
      const source = currentSpeech.find(t => t.id === r.speechId && t.own); if (!source) continue;
      if (memory.items.length >= COORDINATION_LIMITS.items && source.atMs <= memory.items[0].undertaking.atMs) continue;
      const key = ownerKey(world, eid); if (!key) continue;
      const goal = r.goalId === undefined ? undefined : link(); if (r.goalId !== undefined && !goal) continue;
      const goalRelation = r.goalRelation || "supports";
      if (goalRelation === "fulfills" && !goal) continue;
      const completion = r.completion === undefined ? undefined : completionDeclaration(world, eid, r.completion);
      if (r.completion !== undefined && !completion) continue;
      const item: CoordinationItem = { id: source.id, task: r.task.trim(), ownerKey: key, speaker: source.speaker, own: true,
        undertaking: copy(source), generation: `work:${randomUUID()}`, ...(goal ? { goal } : {}), goalRelation,
        ...(completion ? { completion } : {}), localStatus: "not_started", localReason: "Undertaken in communication; no attributed execution recorded yet.",
        localEvidence: [], localVersion: 0, localUpdatedAt: source.atMs,
        lastReported: { status: "not_started", speech: copy(source), localVersion: 0 }, updatedAt: now };
      if (stage([...memory.items, item])) { changed++; publications.push({ item: copy(item), undertaking: true }); }
      continue;
    }
    if (!text(r.id)) continue;
    const item = memory.items.find(i => i.id === r.id && i.own); if (!item) continue;
    if (r.kind === "report") {
      if (!text(r.speechId) || !reportedStatuses.has(r.status)) continue;
      const source = currentSpeech.find(t => t.id === r.speechId && t.own && t.atMs >= item.undertaking.atMs
        && t.id !== item.undertaking.id && t.atMs >= item.lastReported.speech.atMs);
      if (!source || !laterSpeech(world, eid, source, item.lastReported.speech)) continue;
      const equivalent = item.localStatus === "verified_done" ? "completed" : item.localStatus;
      item.lastReported = { status: r.status, speech: copy(source),
        ...(r.status === equivalent && source.atMs >= (item.localUpdatedAt || 0) ? { localVersion: item.localVersion } : {}) };
      item.updatedAt = Math.max(item.updatedAt, source.atMs);
      if (stage(memory.items)) { changed++; publications.push({ item: copy(item), undertaking: false }); }
      continue;
    }
    if (["verified_done", "released"].includes(item.localStatus || "")) continue;
    if (r.kind === "link") {
      if (r.goalId === undefined && r.goalRelation === undefined && r.completion === undefined) continue;
      const goal = r.goalId === undefined ? item.goal : link(); if (r.goalId !== undefined && !goal) continue;
      const goalRelation = r.goalRelation ?? item.goalRelation ?? "supports";
      if (goalRelation === "fulfills" && !goal) continue;
      const completion = r.completion === undefined ? item.completion : completionDeclaration(world, eid, r.completion);
      if (r.completion !== undefined && !completion) continue;
      if (equal(item.goal, goal) && (item.goalRelation || "supports") === goalRelation && equal(item.completion, completion)) continue;
      item.goal = goal; item.goalRelation = goalRelation; item.completion = completion; item.updatedAt = now;
      item.generation = `work:${randomUUID()}`;
      delete item.goalTracking; delete item.pendingGoalProof;
      if (item.localStatus === "blocked") localChange(item, "not_started", "A new owned work declaration provides another approach; no step on it has executed yet.", [], now);
      if (stage(memory.items)) changed++;
    } else if (r.kind === "blocked") {
      if (!text(r.reason, 600) || !Array.isArray(r.evidenceIds) || !r.evidenceIds.length || r.evidenceIds.length > COORDINATION_LIMITS.evidence
        || !r.evidenceIds.every((id: unknown) => text(id)) || new Set(r.evidenceIds).size !== r.evidenceIds.length) continue;
      const owned = getWorkingMemory(world, eid).receipts;
      const receipts = r.evidenceIds.map((id: string) => owned.find(e => e.id === id && e.atMs >= item.undertaking.atMs)) as Array<WorkingMemoryReceipt | undefined>;
      if (receipts.some(e => !e)) continue;
      const evidence = receipts.map<CoordinationEvidence>(e => ({ id: e!.id, atMs: e!.atMs, kind: "receipt", summary: e!.summary, receipt: copy(e!) }))
        .sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id));
      if (localChange(item, "blocked", r.reason.trim(), evidence, Math.max(...evidence.map(e => e.atMs))) && stage(memory.items)) changed++;
    } else if (r.kind === "release" && text(r.reason, 600)) {
      if (localChange(item, "released", r.reason.trim(), [{ id: `choice:${item.id}`, atMs: now, kind: "choice", summary: r.reason.trim() }], now)
        && stage(memory.items)) changed++;
    }
  }
  // Empty/invalid/identical reviews carry no cognitive effects and must not add
  // an otherwise irrelevant whole-dialogue dependency to a physical command.
  if (!changed) return;
  const token = Object.freeze({ id: `coordination-draft:${randomUUID()}` });
  coordinationDrafts.set(token, { world, eid, before: JSON.stringify(initial), speechBefore: JSON.stringify(speech(world, eid)),
    items: staged, publications, changed, consumed: false, prospectiveGoal });
  return token;
}
export function getPreparedCoordinationWork(world: World, eid: number, token: PreparedCoordinationReviews | undefined, itemId: string): CoordinationWorkRef | undefined {
  const draft = token && coordinationDrafts.get(token);
  if (!draft || draft.world !== world || draft.eid !== eid || draft.consumed) return;
  const item = draft.items.find(i => i.id === itemId && i.own && i.generation && !["verified_done", "released"].includes(i.localStatus || ""));
  return item ? Object.freeze({ ownerKey: item.ownerKey, itemId: item.id, generation: item.generation! }) : undefined;
}
export function isPreparedCoordinationCurrent(world: World, eid: number, token: PreparedCoordinationReviews): boolean {
  const draft = coordinationDrafts.get(token);
  return !!draft && draft.world === world && draft.eid === eid && !draft.consumed && actor(world, eid)
    && JSON.stringify(getCoordinationMemory(world, eid)) === draft.before && JSON.stringify(speech(world, eid)) === draft.speechBefore;
}
/** Publish only after all bindings have been preflighted. Preparation never
 * writes this actor's ledger or transmits a report into another actor's memory. */
export function commitPreparedCoordinationReviews(world: World, eid: number, token: PreparedCoordinationReviews): number {
  assertSimulationTaskActive();
  if (!isPreparedCoordinationCurrent(world, eid, token)) return 0;
  const draft = coordinationDrafts.get(token)!;
  if (draft.prospectiveGoal && !ownedGoals(world, eid).some(g => equal(getCoordinationGoalRef(world, eid, g), draft.prospectiveGoal))) return 0;
  draft.consumed = true;
  if (!draft.changed || !write(world, eid, draft.items)) return 0;
  for (const publication of draft.publications) publish(world, eid, publication.item, publication.undertaking);
  return draft.changed;
}
export function applyCoordinationReviews(world: World, eid: number, input: unknown, options: { newGoalId?: number } = {}): number {
  assertSimulationTaskActive();
  if (!actor(world, eid) || !Array.isArray(input) || input.length > COORDINATION_LIMITS.reviews) return 0;
  // Legacy explicit callers retain their issuance-time identity migration. The
  // pure prepare API requires identities already issued with the model context.
  workingMemoryEntityRef(world, eid);
  for (const r of input) if (r && typeof r === "object" && ["undertake", "link"].includes(r.kind)) {
    const goal = r.goalId === "new" ? options.newGoalId : r.goalId;
    if (Number.isSafeInteger(goal)) captureCoordinationGoal(world, eid, goal);
  }
  const prepared = prepareCoordinationReviews(world, eid, input, options);
  return prepared ? commitPreparedCoordinationReviews(world, eid, prepared) : 0;
}

/** Trusted executor admission. A supporting goal is never action attribution.
 * Completion needs the exact declared action and the executor's actual target
 * identity; a matching label or semantic summary cannot substitute for it. */
export function recordCoordinationAction(world: World, eid: number, issuance: CoordinationActionIssuance,
  outcome: { succeeded: boolean; pending?: boolean; atMs?: number; summary?: string; targetKey?: string }): number {
  assertSimulationTaskActive();
  if (!actor(world, eid) || !issuance || !validWorkRef(issuance.workRef) || issuance.workRef.ownerKey !== ownerKey(world, eid)
    || !text(issuance.sourceId) || !time(issuance.issuedAt) || !count(issuance.sequence) || issuance.sequence < 1
    || issuance.target !== undefined && !text(issuance.target) || issuance.targetKey !== undefined && !text(issuance.targetKey)
    || issuance.content !== undefined && !text(issuance.content, 2000)
    || !workActions.has(issuance.actionType) || outcome?.pending || typeof outcome?.succeeded !== "boolean") return 0;
  const atMs = outcome.atMs ?? Date.now();
  if (!time(atMs) || atMs < issuance.issuedAt) return 0;
  const memory = getCoordinationMemory(world, eid); let changed = 0;
  for (const item of memory.items) {
    if (!item.own || item.id !== issuance.workRef.itemId || item.generation !== issuance.workRef.generation || ["verified_done", "released"].includes(item.localStatus || "")
      || issuance.issuedAt < item.undertaking.atMs || item.lastAction && (item.lastAction.sourceId === issuance.sourceId || atMs < item.lastAction.atMs
        || issuance.sequence <= item.lastAction.sequence)) continue;
    const summary = (outcome.summary?.trim() || `${issuance.actionType}${issuance.target ? ` ${issuance.target}` : ""} ${outcome.succeeded ? "committed" : "failed"}.`).slice(0, 1000);
    const evidence: CoordinationEvidence[] = [{ id: issuance.sourceId, atMs, kind: "executor_result", summary }];
    const completion = item.completion;
    const done = outcome.succeeded && completion !== undefined && completion.actionType === issuance.actionType
      && completion.content === issuance.content && completion.targetKey === issuance.targetKey && completion.targetKey === outcome.targetKey;
    localChange(item, done ? "verified_done" : outcome.succeeded ? "in_progress" : "blocked", done
      ? "Your explicitly attributed action committed on the known target and met this undertaking's declared completion criterion."
      : outcome.succeeded ? "An attributed step committed; this does not prove the whole undertaking is complete." : summary, evidence, atMs);
    if (done) delete item.pendingGoalProof;
    item.lastAction = { sourceId: issuance.sourceId, atMs, sequence: issuance.sequence }; changed++;
  }
  if (changed) write(world, eid, memory.items);
  return changed;
}

/** Consume owned goal verdicts without treating completed plans or model claims
 * as proof. Cleanup can retain a private gate for later actual perception, but
 * cannot silently withdraw a promise or tell the actor a remote task succeeded. */
export function reconcileCoordinationGoals(world: World, eid: number, observation?: WorkingMemoryObservationSnapshot): number {
  assertSimulationTaskActive();
  if (!actor(world, eid)) return 0;
  const memory = getCoordinationMemory(world, eid); let changed = 0;
  const fresh = consumeWorkingMemoryObservation(world, eid, observation);
  // Nothing of theirs to reconcile (most people, most of the time): skip building the evidence map.
  if (!memory.items.some(item => item.own && item.goal && !["verified_done", "released"].includes(item.localStatus || ""))) return 0;
  const physical = readWorkingMemory(world, eid); // read-only: the shared parse, no copy
  const evidence = new Map<string, { atMs: number; fact?: WorkingMemoryFact }>();
  for (const fact of [...physical.facts, ...fresh]) {
    const key = JSON.stringify([fact.subject, fact.predicate, fact.slot || ""]), previous = evidence.get(key);
    if (!previous || fact.observedAt > previous.atMs) evidence.set(key, { atMs: fact.observedAt, fact });
    else if (fact.observedAt === previous.atMs && (!previous.fact || previous.fact.value !== fact.value
      || previous.fact.valueLabel !== fact.valueLabel || previous.fact.subjectLabel !== fact.subjectLabel)) {
      // A token may precede another receipt in the same synchronous pass.
      // Newer evidence wins; equal-time contradictions establish neither value.
      evidence.set(key, { atMs: fact.observedAt });
    }
  }
  const facts = [...evidence.values()].flatMap(entry => entry.fact ? [entry.fact] : []);
  for (const item of memory.items) {
    if (!item.own || !item.goal || ["verified_done", "released"].includes(item.localStatus || "")) continue;
    const goal = resolveGoal(world, eid, item.goal), now = Date.now(), before = JSON.stringify(item);
    const completed = goal !== undefined && Goal.status[goal] === "completed";
    const ended = goal === undefined || terminalGoals.has(Goal.status[goal]);
    if (ended && !item.goalTracking) item.goalTracking = { status: "ended", atMs: now };
    if (!ended) {
      // Reactivation of the same goal begins another attempt; a previously
      // retained outcome gate must not certify the new attempt retroactively.
      delete item.goalTracking; delete item.pendingGoalProof;
    } else if (goal !== undefined && !completed) delete item.pendingGoalProof;
    if (item.goalRelation !== "fulfills") delete item.pendingGoalProof;
    if (item.goalRelation === "fulfills" && completed && !item.pendingGoalProof && Goal.kind[goal!] !== "social") {
      let success: unknown; try { success = JSON.parse(Goal.successJson[goal!]); } catch { /* no supported condition */ }
      const condition = copyActorGoalCondition(success);
      // Evidence uses a fractional monotonic clock inside a wall millisecond;
      // a bare Date.now verdict would misclassify an earlier same-ms fact as
      // newer. Fence the current evidence account, then wait at most one normal
      // perception frame for a still-visible condition to confirm the outcome.
      // A stale remote matching fact cannot cross this fence by timestamp alone.
      if (condition) item.pendingGoalProof = { condition, afterMs: Math.max(now, item.goal.createdAt, physical.evidenceFloorMs,
        ...physical.facts.map(f => f.observedAt), ...physical.receipts.map(r => r.atMs), ...fresh.map(f => f.observedAt)) + 0.001 };
    }
    const proof = item.pendingGoalProof;
    if (proof && actorKnowsGoalCondition(world, eid, proof.condition, proof.afterMs, facts)) {
      const summary = "The linked goal's retained engine verdict is now supported by your own state or physical evidence of its native condition.";
      localChange(item, "verified_done", summary, [{ id: `goal-verdict:${item.goal.goalKey}`, atMs: now, kind: "goal_verdict", summary }], now);
      delete item.pendingGoalProof;
    }
    if (before !== JSON.stringify(item)) { item.updatedAt = Math.max(item.updatedAt, now); changed++; }
  }
  if (changed) write(world, eid, memory.items);
  return changed;
}

export function hasCoordinationCommunicationGap(item: CoordinationItem): boolean {
  if (!item.own || item.localVersion === item.lastReported.localVersion) return false;
  // Starting ordinary work need not trigger a running commentary. A material
  // interruption, completion, withdrawal or recovery is the useful difference.
  if (item.localStatus === "in_progress" && ["not_started", "in_progress"].includes(item.lastReported.status)) return false;
  if (item.localStatus === "not_started" && item.lastReported.status === "not_started") return false;
  return true;
}
/** Exact source identities are deliberately retained here for evidence reviews.
 * Only this actor's dialogue and receipts are consulted, never another ledger. */
export function formatCoordinationContext(world: World, eid: number, options: { actionReceiptsShown?: readonly string[] } = {}): string {
  const { items } = getCoordinationMemory(world, eid);
  const own = items.filter(i => i.own).slice(-8), heard = items.filter(i => !i.own).slice(-6);
  const sources = [...getSocialDialogue(world, eid), ...getPrivateCommunications(world, eid)].filter(t => t.own)
    .sort((a, b) => a.atMs - b.atMs).slice(-6);
  const receipts = getWorkingMemory(world, eid).receipts.slice(-8);
  // Only the composite formatter supplies exact IDs printed with their complete
  // receipts elsewhere in this same prompt. Standalone consumers remain complete.
  const shown = new Set(options.actionReceiptsShown ?? []);
  // A task summary may omit conditions such as "soon" or "after you call".
  // Keep the actual undertaking available independently of the recent-source window.
  const originalWords = (i: CoordinationItem) => {
    const source = i.undertaking;
    const at = source.atSimMs === undefined ? "" : ` at simulation ${source.atSimMs}ms`;
    return `Original ${"medium" in source ? "private text" : "spoken words"} to ${JSON.stringify(source.target)}${at}: ${JSON.stringify(source.content)}.`;
  };
  const report = (i: CoordinationItem) => i.lastReported.speech.id === i.undertaking.id
    ? `undertaking announced; no later progress report [${i.lastReported.speech.id}]`
    : `${i.lastReported.status} [${i.lastReported.speech.id}]`;
  const criterion = (i: CoordinationItem) => i.completion
    ? ` Completion criterion: successful ${i.completion.actionType} on ${JSON.stringify(i.completion.target)}${i.completion.content === undefined ? "" : ` with exact content ${JSON.stringify(i.completion.content)}`}.`
    : i.goal && i.goalRelation === "fulfills" ? " Completion criterion: the explicitly fulfilling goal, verified by your own evidence."
    : i.goal ? " The linked goal supports this undertaking; finishing that broader goal does not establish this work is complete." : "";
  return `PROMISES AND SHARED PLANS:
YOUR UNDERTAKINGS:
${own.map(i => `- [${i.id}] ${JSON.stringify(i.task)}: ${i.localStatus === "not_started" ? "not started as far as you know" : i.localStatus}. ${i.localReason}${criterion(i)}${i.goalTracking && i.localStatus !== "verified_done" && i.localStatus !== "released" ? " The linked intention is no longer active; its tracking ending does not establish success or your withdrawal. The undertaking remains yours unless you release it; you can link another intention." : ""}\n  ${originalWords(i)}\n  Last told others: ${report(i)}.${hasCoordinationCommunicationGap(i) ? " COMMUNICATION GAP: your private account differs from the account you last communicated. You may clarify, ask for help, renegotiate or continue independently." : ""}`).join("\n") || "None recorded."}
HEARD UNDERTAKINGS (attributed words, not private progress or physical proof):
${heard.map(i => `- ${i.speaker}: ${JSON.stringify(i.task)}. Last reported ${report(i)}: ${JSON.stringify(i.lastReported.speech.content)}`).join("\n") || "None recorded."}
OWN COMMUNICATION SOURCES FOR OPTIONAL REVIEWS (already spoken or personally sent; texts are not audible):
${sources.map(t => `[${t.id}] ${"medium" in t ? `text to ${JSON.stringify(t.target)} (sent): ` : "spoken: "}${JSON.stringify(t.content)}`).join("\n") || "None."}
OWN PHYSICAL EVIDENCE SOURCES FOR OPTIONAL BLOCKER REVIEWS:
${receipts.map(r => r.kind === "action" && shown.has(r.id) ? `[${r.id}] See RECENT ACTION RECEIPTS above.`
  : `[${r.id}] ${r.provenance}${r.kind === "action" ? r.succeeded ? "; committed" : "; failed" : ""}: ${JSON.stringify(r.summary)}`).join("\n") || "None."}`;
}
