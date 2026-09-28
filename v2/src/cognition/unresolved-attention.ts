/** A remembered signal is neither unread content nor an order. Only trusted
 * delivery/resolution boundaries can add/remove one; cognition may explicitly
 * consider/defer it. Presentation alone never claims consideration or action. */
import { randomUUID } from "node:crypto";
import { addComponent, entityExists, hasComponent, query } from "bitecs";
import { Agent, Attention, WorkingMemoryIdentity } from "../ecs/components";
import type { World } from "../ecs/world";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents, startCommittedEvents } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { workingMemoryEntityRef } from "./working-memory";
import { getSocialDialogue } from "./social-memory";

const LIMIT = 16, REVISIT_MS = 30_000;
interface AttentionReviewMemory {
  consideredAtSimMs: number; status: "considered" | "deferred";
  reason: string; reconsiderAtSimMs: number;
}
export interface AttentionSignal {
  id: string; source: string; signalKey: string; content: string;
  observedAtSimMs: number; lastObservedAtSimMs: number;
  status: "unreviewed" | "considered" | "deferred";
  lastPresentedAtSimMs?: number; consideredAtSimMs?: number;
  /** Revisit attached to an explicit review (chosen duration for deferral,
   * default interval for consideration), never advanced merely by display. */
  reconsiderAtSimMs?: number; reason?: string;
  /** Engine backoff for re-presenting a due cue, not another actor decision. */
  nextPresentationAtSimMs?: number;
  reviewRevision?: number;
  /** Bounded autobiographical choices, not queued actions or wake authority.
   * Keep the earliest retained choice and the two most recent predecessors. */
  previousReviews?: AttentionReviewMemory[];
  /** Recall frontier for every explicit review, including timeout-only waits.
   * This is not permission to wake early or execute anything. */
  reviewContext?: { sourceId: string; ownerKey: string; afterSimMs: number; baselineIds: string[] };
  /** Personally heard evidence can end a chosen deferral early. The timeout
   * remains the fallback; neither branch decides what the actor does next. */
  wake?: { kind: "heard_evidence"; sourceId: string; ownerKey: string; afterSimMs: number; baselineIds: string[] };
}
export interface AttentionResolution {
  signalId: string; source: string; firstObservedAtSimMs: number; resolvedAtSimMs: number;
}
function owner(world: World, eid: number): string | undefined {
  return entityExists(world, eid) && hasComponent(world, eid, Agent) && Agent.active[eid]
    && hasComponent(world, eid, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[eid] || undefined;
}
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;
function validWake(w: AttentionSignal["wake"]): boolean {
  return w === undefined || !!w && w.kind === "heard_evidence" && typeof w.sourceId === "string"
    && typeof w.ownerKey === "string" && finite(w.afterSimMs) && Array.isArray(w.baselineIds)
    && w.baselineIds.length <= 48 && w.baselineIds.every(id => typeof id === "string" && id.length <= 100);
}
function validReviewMemory(x: AttentionSignal): boolean {
  if (x.previousReviews === undefined) return true; // Legacy cues have no invented history.
  return Array.isArray(x.previousReviews) && x.previousReviews.length <= 3
    && x.previousReviews.length < (x.reviewRevision ?? 0)
    && x.previousReviews.every((r, i, rows) => !!r
      && Object.keys(r).every(k => ["consideredAtSimMs", "status", "reason", "reconsiderAtSimMs"].includes(k))
      && finite(r.consideredAtSimMs) && finite(r.reconsiderAtSimMs) && r.reconsiderAtSimMs >= r.consideredAtSimMs
      && finite(x.consideredAtSimMs) && r.consideredAtSimMs <= x.consideredAtSimMs
      && r.consideredAtSimMs >= (i ? rows[i - 1].consideredAtSimMs : x.observedAtSimMs)
      && ["considered", "deferred"].includes(r.status) && typeof r.reason === "string" && r.reason.length <= 300);
}
function valid(x: AttentionSignal): boolean {
  return !!x && typeof x.id === "string" && x.id.length <= 80
    && typeof x.signalKey === "string" && x.signalKey.length > 0 && x.signalKey.length <= 256
    && typeof x.source === "string" && x.source.length <= 256
    && typeof x.content === "string" && x.content.length <= 1600
    && finite(x.observedAtSimMs) && finite(x.lastObservedAtSimMs)
    && ["unreviewed", "considered", "deferred"].includes(x.status)
    && [x.lastPresentedAtSimMs, x.consideredAtSimMs, x.reconsiderAtSimMs, x.nextPresentationAtSimMs].every(t => t === undefined || finite(t))
    && (x.reviewRevision === undefined || Number.isSafeInteger(x.reviewRevision) && x.reviewRevision >= 0)
    && (x.reason === undefined || typeof x.reason === "string" && x.reason.length <= 300) && validWake(x.wake) && validReviewMemory(x)
    && (x.reviewContext === undefined || validWake({ ...x.reviewContext, kind: "heard_evidence" }));
}
export function snapshotAttentionSignals(world: World, eid: number): AttentionSignal[] {
  const key = owner(world, eid);
  if (!key || !hasComponent(world, eid, Attention) || Attention.ownerKey[eid] !== key) return [];
  try {
    const rows = JSON.parse(Attention.signalsJson[eid]);
    return Array.isArray(rows) ? rows.filter(valid).slice(-LIMIT) : [];
  } catch { return []; }
}
/** A receipt records the trusted resolver boundary, not a model's consideration
 * or inference that a cue was handled. Missing legacy data means no receipt.
 * Epoch-bound chronology cannot borrow a prior run's completion. */
export function snapshotAttentionResolutions(world: World, eid: number): AttentionResolution[] {
  const key = owner(world, eid), tape = getCommittedEvents(world), now = readSimulationTime(world);
  if (!key || !hasComponent(world, eid, Attention) || Attention.ownerKey[eid] !== key
    || tape.stopped || !tape.sourceId || !finite(now)) return [];
  try {
    const saved = JSON.parse(Attention.resolutionsJson[eid] || "null");
    if (!saved || saved.ownerKey !== key || saved.sourceEpoch !== tape.sourceId || !Array.isArray(saved.receipts)) return [];
    return saved.receipts.filter((row: AttentionResolution) => row && typeof row.signalId === "string" && row.signalId.startsWith("attention:")
      && row.signalId.length <= 80 && typeof row.source === "string" && row.source.length <= 256
      && finite(row.firstObservedAtSimMs) && finite(row.resolvedAtSimMs)
      && row.firstObservedAtSimMs <= row.resolvedAtSimMs && row.resolvedAtSimMs <= now).slice(-LIMIT)
      .map(({ signalId, source, firstObservedAtSimMs, resolvedAtSimMs }: AttentionResolution) => ({ signalId, source, firstObservedAtSimMs, resolvedAtSimMs }));
  } catch { return []; }
}
function save(world: World, eid: number, rows: AttentionSignal[]): boolean {
  assertSimulationTaskActive();
  const key = owner(world, eid); if (!key || getCommittedEvents(world).stopped) return false;
  addComponent(world, eid, Attention);
  if (Attention.ownerKey[eid] !== key) { Attention.droppedSignals[eid] = 0; Attention.resolutionsJson[eid] = ""; }
  Attention.ownerKey[eid] = key;
  Attention.signalsJson[eid] = JSON.stringify(rows.slice(-LIMIT));
  return true;
}
export function recordAttentionSignal(world: World, eid: number, input: { source: string; signalKey: string; content: string }): boolean {
  assertSimulationTaskActive();
  if (!entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid] || getCommittedEvents(world).stopped) return false;
  workingMemoryEntityRef(world, eid);
  const rows = snapshotAttentionSignals(world, eid), now = readSimulationTime(world);
  const previous = rows.find(x => x.source === input.source && x.signalKey === input.signalKey);
  // A periodic emission is evidence that it persists, not a new consideration
  // trigger. It cannot erase an explicit deferral or rewrite the original cue.
  if (previous) { previous.lastObservedAtSimMs = now; return save(world, eid, rows); }
  const row: AttentionSignal = { ...input, id: `attention:${randomUUID()}`, observedAtSimMs: now,
    lastObservedAtSimMs: now, status: "unreviewed" };
  if (!valid(row)) return false;
  const dropped = rows.length >= LIMIT;
  const saved = save(world, eid, [...rows, row]);
  if (saved && dropped) Attention.droppedSignals[eid] = (Attention.droppedSignals[eid] || 0) + 1;
  return saved;
}
export function resolveAttentionSignal(world: World, eid: number, signal: { source: string; signalKey: string }): boolean {
  assertSimulationTaskActive();
  const key = owner(world, eid), tape = getCommittedEvents(world), now = readSimulationTime(world);
  if (!key || tape.stopped || !finite(now)) return false;
  const rows = snapshotAttentionSignals(world, eid), resolved = rows.find(x => x.source === signal.source && x.signalKey === signal.signalKey);
  if (!resolved || resolved.observedAtSimMs > resolved.lastObservedAtSimMs || resolved.lastObservedAtSimMs > now) return false;
  const receipts = snapshotAttentionResolutions(world, eid);
  const sourceEpoch = tape.sourceId ?? startCommittedEvents(world);
  if (!save(world, eid, rows.filter(x => x.id !== resolved.id))) return false;
  Attention.resolutionsJson[eid] = JSON.stringify({ ownerKey: key, sourceEpoch, receipts: [...receipts,
    { signalId: resolved.id, source: resolved.source, firstObservedAtSimMs: resolved.observedAtSimMs, resolvedAtSimMs: now }].slice(-LIMIT) });
  return true;
}
function firstHeardEvidence(world: World, eid: number, row: AttentionSignal, now: number) {
  const w = row.wake, tape = getCommittedEvents(world);
  if (!w || tape.stopped || row.status !== "deferred" || w.sourceId !== tape.sourceId
    || w.ownerKey !== owner(world, eid) || now < w.afterSimMs) return;
  return getSocialDialogue(world, eid).filter(turn => !turn.own && !w.baselineIds.includes(turn.id)
    && finite(turn.atSimMs) && turn.atSimMs >= w.afterSimMs && turn.atSimMs <= now)
    .sort((a, b) => a.atSimMs! - b.atSimMs! || a.id.localeCompare(b.id))[0];
}
function heardEvidenceDue(world: World, eid: number, row: AttentionSignal, now: number): boolean {
  return !!firstHeardEvidence(world, eid, row, now);
}
function reviewContinuity(row: AttentionSignal) {
  return { priorReviews: row.reviewRevision ?? 0,
    previousReviews: row.previousReviews ?? [],
    omittedPreviousReviews: Math.max(0, (row.reviewRevision ?? 0) - 1 - (row.previousReviews?.length ?? 0)) };
}
function presentationDue(world: World, eid: number, row: AttentionSignal, now: number): boolean {
  return finite(now) && row.observedAtSimMs <= row.lastObservedAtSimMs && row.lastObservedAtSimMs <= now
    && (row.reconsiderAtSimMs === undefined || now >= row.reconsiderAtSimMs || heardEvidenceDue(world, eid, row, now))
    && (row.nextPresentationAtSimMs === undefined || now >= row.nextPresentationAtSimMs);
}
export function hasDueAttentionSignal(world: World, eid: number): boolean {
  const now = readSimulationTime(world);
  return !getCommittedEvents(world).stopped && snapshotAttentionSignals(world, eid).some(x => presentationDue(world, eid, x, now));
}
/** A due cue belongs to the current decision, not only the long memory appendix.
 * This read-only projection requests a review, never an action or resolution.
 * Preserve explicit deferral and presentation backoff; offer at most one cue. */
export function formatDueAttentionReview(world: World, eid: number): string {
  const now = readSimulationTime(world);
  if (getCommittedEvents(world).stopped) return "";
  const cue = snapshotAttentionSignals(world, eid).filter(row => presentationDue(world, eid, row, now))
    .sort((a,b) => a.observedAtSimMs - b.observedAtSimMs || a.id.localeCompare(b.id))[0];
  if (!cue) return "";
  const heard = firstHeardEvidence(world, eid, cue, now);
  const context = cue.reviewContext;
  const recent = context && context.sourceId === getCommittedEvents(world).sourceId && context.ownerKey === owner(world, eid)
    && now >= context.afterSimMs ? getSocialDialogue(world, eid).filter(turn => !turn.own
      && !context.baselineIds.includes(turn.id) && finite(turn.atSimMs) && turn.atSimMs >= context.afterSimMs && turn.atSimMs <= now)
      .sort((a,b) => a.atSimMs! - b.atSimMs! || a.id.localeCompare(b.id)) : undefined;
  const shown = recent && (recent.length <= 3 ? recent : [recent[0], ...recent.slice(-2)]);
  return `Attention review due: ${JSON.stringify({ signalId: cue.id, source: cue.source, content: cue.content,
    unresolvedForSeconds: (now - cue.observedAtSimMs) / 1000, status: cue.status,
    previousReason: cue.reason, ...reviewContinuity(cue),
    ...(shown ? { heardSinceReview: shown.map(turn => ({ speechId: turn.id, atSimMs: turn.atSimMs,
      speaker: turn.speaker, content: turn.content.slice(0,500), ...(turn.content.length > 500 ? { excerpt: true } : {}) })),
      omittedHeardTurns: recent!.length - shown.length } : {}),
    ...(heard ? { revisitCause: "New completed dialogue was heard after your deferral.",
      revisitEvidence: { speechId: heard.id, atSimMs: heard.atSimMs, speaker: heard.speaker, content: heard.content } } : {}) })}\n`
    + (heard || shown ? `This is a review boundary, not proof that your reason for waiting was satisfied. Heard words are attributed claims; compare them with your earlier reason before choosing again.\n` : "")
    + `With this decision, use attentionReview to consider this cue or explicitly defer its next review. You may keep your current activity; reviewing a signal does not reveal its contents or require acting on it.\n`;
}
export function formatAttentionSignals(world: World, eid: number): string {
  const rows = snapshotAttentionSignals(world, eid), dropped = owner(world, eid) === Attention.ownerKey[eid] ? Attention.droppedSignals[eid] || 0 : 0;
  if (!rows.length && !dropped) return "";
  const now = readSimulationTime(world), resolutions = snapshotAttentionResolutions(world, eid);
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  return `UNRESOLVED EXPERIENCED SIGNALS (private historical cues; not message contents or required actions):\n`
    + rows.map(({ signalKey, nextPresentationAtSimMs, reviewRevision, previousReviews, wake, reviewContext, ...row }) => {
      if (!finite(now) || row.observedAtSimMs > row.lastObservedAtSimMs || row.lastObservedAtSimMs > now) return JSON.stringify(row);
      const prior = resolutions.filter(receipt => receipt.source === row.source && receipt.signalId !== row.id
        && receipt.resolvedAtSimMs <= row.observedAtSimMs).sort((a, b) => b.resolvedAtSimMs - a.resolvedAtSimMs)[0];
      return JSON.stringify({ ...row, ...reviewContinuity({ ...row, signalKey, reviewRevision, previousReviews }) }) + `\nCue ${row.id} remains unresolved: first observed ${seconds(now - row.observedAtSimMs)} ago; last sensed ${seconds(now - row.lastObservedAtSimMs)} ago. Consideration is ${row.status}, not a resolution.`
        + (wake ? ` Chosen revisit: new personally heard completed dialogue or the recorded timeout; checking a cue does not abandon an activity.` : "")
        + (row.reconsiderAtSimMs !== undefined && now >= row.reconsiderAtSimMs
          ? ` ${row.status === "deferred" ? "Your chosen revisit time has arrived" : "The interval since your last review has elapsed"}. Showing this cue again is not a new decision to defer it.` : "")
        + (prior ? ` A different cue ${prior.signalId} from the same named sensory source was resolved ${seconds(now - prior.resolvedAtSimMs)} ago, ${seconds(row.observedAtSimMs - prior.resolvedAtSimMs)} before this cue began. That earlier resolution did not resolve this cue. A shared source name is not proof of the same physical entity.` : "");
    }).join("\n")
    + (dropped ? `\nBounded attention history has retired ${dropped} older signals; absence is not proof they were resolved.` : "");
}
/** Issued rows form the review capability. Repeated emission may update age but
 * cannot invalidate an otherwise current consideration. Resolution/replacement
 * or an already-committed review must invalidate a late review. */
export function prepareAttentionReview(world: World, eid: number, issued: readonly AttentionSignal[], raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some(k => !["signalId", "disposition", "reason", "afterSeconds", "wake"].includes(k))
    || typeof r.signalId !== "string" || !["consider", "defer"].includes(String(r.disposition))
    || typeof r.reason !== "string" || !r.reason.trim() || r.reason.length > 300
    || r.disposition === "defer" && (typeof r.afterSeconds !== "number" || !Number.isInteger(r.afterSeconds) || r.afterSeconds < 5 || r.afterSeconds > 120)
    || r.disposition === "consider" && r.afterSeconds !== undefined) return;
  if (r.wake !== undefined && (r.disposition !== "defer" || !r.wake || typeof r.wake !== "object"
    || Array.isArray(r.wake) || Object.keys(r.wake).length !== 1 || (r.wake as { kind?: unknown }).kind !== "heard_evidence")) return;
  const old = issued.find(x => x.id === r.signalId); if (!old) return;
  const key = owner(world, eid), tape = getCommittedEvents(world).sourceId, preparedAtSimMs = readSimulationTime(world);
  const basis = (x: AttentionSignal) => JSON.stringify([x.id, x.source, x.signalKey, x.content, x.observedAtSimMs, x.status,
    x.consideredAtSimMs, x.reason, x.reconsiderAtSimMs, x.reviewRevision ?? 0, x.wake, x.previousReviews, x.reviewContext]);
  if (r.wake && (!key || !tape)) return;
  const wake: AttentionSignal["wake"] = r.wake ? { kind: "heard_evidence", sourceId: tape!, ownerKey: key!,
    afterSimMs: preparedAtSimMs, baselineIds: getSocialDialogue(world, eid).map(t => t.id) } : undefined;
  const reviewContext = key && tape ? { sourceId: tape, ownerKey: key, afterSimMs: preparedAtSimMs,
    baselineIds: getSocialDialogue(world, eid).map(t => t.id) } : undefined;
  const signalId = old.id, issuedBasis = basis(old), reason = r.reason as string;
  const disposition = r.disposition, delayMs = disposition === "defer" ? Number(r.afterSeconds) * 1000 : REVISIT_MS;
  let consumed = false;
  const current = () => !consumed && finite(preparedAtSimMs) && finite(readSimulationTime(world)) && readSimulationTime(world) >= preparedAtSimMs
    && owner(world, eid) === key && !getCommittedEvents(world).stopped && getCommittedEvents(world).sourceId === tape
    && snapshotAttentionSignals(world, eid).some(x => x.id === signalId && basis(x) === issuedBasis
      && x.observedAtSimMs <= x.lastObservedAtSimMs && x.lastObservedAtSimMs <= readSimulationTime(world)
      && (x.consideredAtSimMs === undefined || x.consideredAtSimMs <= readSimulationTime(world)));
  return { current, commit: () => {
    assertSimulationTaskActive();
    if (!current()) return false;
    const rows = snapshotAttentionSignals(world, eid), row = rows.find(x => x.id === signalId)!;
    if ((row.reviewRevision ?? 0) >= Number.MAX_SAFE_INTEGER) return false;
    if ((row.reviewRevision ?? 0) > 0 && row.status !== "unreviewed" && finite(row.consideredAtSimMs) && finite(row.reconsiderAtSimMs) && row.reason !== undefined) {
      const history: AttentionReviewMemory[] = [...row.previousReviews ?? [], { consideredAtSimMs: row.consideredAtSimMs,
        status: row.status, reason: row.reason, reconsiderAtSimMs: row.reconsiderAtSimMs }];
      row.previousReviews = history.length <= 3 ? history : [history[0], ...history.slice(-2)];
    }
    row.status = disposition === "defer" ? "deferred" : "considered";
    row.reason = reason; row.consideredAtSimMs = readSimulationTime(world);
    row.reconsiderAtSimMs = row.consideredAtSimMs + delayMs;
    row.reviewRevision = (row.reviewRevision ?? 0) + 1;
    if (wake) row.wake = wake; else delete row.wake;
    if (reviewContext) row.reviewContext = reviewContext; else delete row.reviewContext;
    delete row.nextPresentationAtSimMs; // A chosen short revisit supersedes engine presentation backoff.
    const saved = save(world, eid, rows); if (saved) consumed = true;
    return saved;
  } };
}
/** Included in an admitted request, not necessarily consciously considered.
 * Keep it visible, while preventing a new LLM interruption every tick. */
export function markAttentionSignalsPresented(world: World, eid: number, issued: readonly AttentionSignal[]): void {
  assertSimulationTaskActive();
  const rows = snapshotAttentionSignals(world, eid), now = readSimulationTime(world);
  if (!finite(now) || getCommittedEvents(world).stopped) return;
  for (const row of rows) if (issued.some(old => old.id === row.id)) {
    if (row.lastObservedAtSimMs > now || (row.lastPresentedAtSimMs ?? 0) > now) continue;
    // Only a due presentation starts engine backoff. Unrelated decisions that
    // happen to include this historical cue cannot postpone its next reminder.
    // A dialogue wake is early reconsideration, not permission for engine
    // backoff to conceal the still-future actor-chosen timeout.
    if (presentationDue(world, eid, row, now)) row.nextPresentationAtSimMs = Math.min(now + REVISIT_MS,
      row.reconsiderAtSimMs !== undefined && row.reconsiderAtSimMs > now ? row.reconsiderAtSimMs : Infinity);
    row.lastPresentedAtSimMs = now;
  }
  if (rows.length) save(world, eid, rows);
}
export function clearAttentionSignals(world: World): void {
  assertSimulationTaskActive();
  // Explicit memory clearing, not normal perception-tail pruning.
  for (const eid of query(world, [Attention, Agent])) if (owner(world, eid)) {
    // Explicit forgetting may discard historical receipts even after a source
    // stops; it creates no new experience or resolution in that stopped source.
    if (Attention.ownerKey[eid] === owner(world, eid)) Attention.resolutionsJson[eid] = "";
    if (save(world, eid, [])) Attention.droppedSignals[eid] = 0;
  }
}
