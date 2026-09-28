/** Actor-owned encounter continuity for the existing foreground controller.
 * Actual completed speech opens an encounter; reading a prompt never does.
 * The runtime cursor is intentionally ephemeral across restore. Durable
 * dialogue, contribution purposes and personal closures live in SocialMemory. */
import { entityExists, hasComponent } from "bitecs";
import { createHash, randomUUID } from "node:crypto";
import type { World } from "../ecs/world";
import { Agent, Goal, Name, WorkingMemoryIdentity } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { snapshotActorContinuation } from "./actor-continuation";
import { snapshotOngoingActivity } from "./ongoing-activity";
import { getCompletedContributions, getSocialDialogue, recordPersonalSocialClosure, consumeActivitySpeechReceipt, type SocialDialogueTurn } from "./social-memory";
import { workingMemoryEntityRef } from "./working-memory";
import { snapshotAttentionSignals } from "./unresolved-attention";
import { snapshotActivitySituation, activitySituationBasis, type ActivitySituation } from "./activity-situation";
import { getCoordinationGoalRef } from "./coordination-memory";

type Disposition = "continue" | "pause" | "close";
type Outcome = "met" | "sustained" | "unresolved" | "changed";
type IntentionOutcome = "advanced" | "sustained" | "unchanged" | "blocked";
interface IntentionAssessment { outcome: IntentionOutcome; reason: string; }
interface AssessedIntention { id: number; key: string; description: string; }
/** Actor-authored interpretations, not additional evidence or execution rights.
 * Retaining a short sequence prevents each review from hiding earlier reasons
 * for continuing. It shares the encounter's owner/source/restore lifetime. */
interface ReviewRecord { atSimMs: number; disposition: Disposition; reason: string;
  expectedProgress?: string; assessedExpectation?: string; previousOutcome?: Outcome;
  previousAssessment?: string; evidenceIds: string[];
  assessedIntention?: AssessedIntention; intentionAssessment?: IntentionAssessment; }
const REVIEW_HISTORY_LIMIT = 3;
const copyReview = (row: ReviewRecord): ReviewRecord => ({ ...row, evidenceIds: [...row.evidenceIds],
  ...(row.assessedIntention ? { assessedIntention: { ...row.assessedIntention } } : {}),
  ...(row.intentionAssessment ? { intentionAssessment: { ...row.intentionAssessment } } : {}) });
interface ActivityState { id: string; owner: string; source: string | null; key: string; persona: string; activityKey?: string;
  startedAtSimMs: number; sinceSimMs: number; observedTurns: Set<string>; baselineTurns: Set<string>;
  reviewCount: number; status: "active" | "paused" | "closed";
  expectedProgress?: string; reason?: string; previousOutcome?: Outcome; evidenceIds?: string[];
  assessedExpectation?: string; previousAssessment?: string; recentReviews: ReviewRecord[]; }
const states = new WeakMap<World, Map<number, ActivityState>>();
function basis(world: World, eid: number) {
  const source = getCommittedEvents(world), room = getRoomForEntity(world, eid);
  if (source.stopped || !entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid]
    || !hasComponent(world, eid, WorkingMemoryIdentity) || !WorkingMemoryIdentity.id[eid]
    || room === undefined || !entityExists(world, room)) return;
  const activity = snapshotOngoingActivity(world, eid);
  return { owner: WorkingMemoryIdentity.id[eid], source: source.sourceId,
    activityKey: activity?.status === "active" && !activity.needsRevalidation
      ? JSON.stringify([activity.id, activity.goalKey, activity.definition]) : undefined,
    key: hasComponent(world, room, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[room] : undefined,
    persona: JSON.stringify([Name.value[eid], Agent.role[eid], Agent.systemPrompt[eid]]) };
}
function matches(state: ActivityState, b: ReturnType<typeof basis>): boolean {
  return !!b && !!b.key && state.owner === b.owner && state.source === b.source && state.persona === b.persona
    && (state.key === b.key || !!state.activityKey && state.activityKey === b.activityKey);
}
/** Completed-speech producer hook, after the actor-owned receipt is stored.
 * Heard-only silence cannot manufacture an activity or consent to engage. */
export function recordActivitySpeech(world: World, eid: number, turn: SocialDialogueTurn): void {
  assertSimulationTaskActive();
  if (!consumeActivitySpeechReceipt(world, eid, turn)) return;
  const owned = getSocialDialogue(world, eid).find(row => row.id === turn.id);
  if (!owned || JSON.stringify(owned) !== JSON.stringify(turn) || getCommittedEvents(world).stopped) return;
  workingMemoryEntityRef(world, eid);
  const room = getRoomForEntity(world, eid); if (room !== undefined) workingMemoryEntityRef(world, room);
  const b = basis(world, eid); if (!b?.key) return;
  let rows = states.get(world), state = rows?.get(eid);
  const now = readSimulationTime(world);
  // A real heard receipt remains personal evidence through a detour. Retaining
  // it does not transplant/open the encounter: capture still requires matches().
  const heardDuringDetour = !turn.own && state && state.owner === b.owner && state.source === b.source
    && state.persona === b.persona && state.status !== "closed" && now >= state.sinceSimMs;
  if (!heardDuringDetour && (!state || !matches(state, b) || state.status === "closed" || now < state.sinceSimMs)) {
    if (!turn.own) return;
    if (!rows) { rows = new Map(); states.set(world, rows); }
    state = { ...b, key: b.key, id: `engagement:${randomUUID()}`, startedAtSimMs: now, sinceSimMs: now,
      observedTurns: new Set(), baselineTurns: new Set(), reviewCount: 0, status: "active", recentReviews: [] };
    rows.set(eid, state);
  }
  if (!state) return;
  if (state.status === "paused" && turn.own) state.status = "active";
  state.observedTurns.add(turn.id);
  if (state.observedTurns.size > 64) state.observedTurns = new Set([...state.observedTurns].slice(-48));
}
function evidenceWindow(world: World, eid: number, state: ActivityState) {
  const turns = getSocialDialogue(world, eid).filter(turn => state.observedTurns.has(turn.id));
  const fresh = turns.filter(turn => !state.baselineTurns.has(turn.id));
  const purposes = new Map(getCompletedContributions(world, eid).map(c => [c.turn.id, c.purpose]));
  const contributions = fresh.filter(turn => turn.own).map(turn => ({ speechId: turn.id, content: turn.content,
    ...(purposes.has(turn.id) ? { purpose: purposes.get(turn.id)! } : {}) }));
  return { turns, fresh, contributions };
}
// A lively exchange should be allowed to run. Check in occasionally so a
// conversation that has stopped serving anyone can end, not every few turns.
const due = (world: World, state: ActivityState, n: number, elapsed: number) => state.status === "active"
  && (world.meta.activityReviewCadence === "strict" ? n >= 2 && (n >= 4 || elapsed >= 20_000) : n >= 5 && (n >= 8 || elapsed >= 75_000));
type Evidence = { episodeId: string; elapsedSimMs: number; encounterElapsedSimMs: number; reviewCount: number; purpose?: string; previousExpectedProgress?: string;
  situation: ActivitySituation;
  recentReviews: ReviewRecord[];
  previousReview?: { reason?: string; previousOutcome?: Outcome; evidenceIds?: string[];
    assessedExpectation?: string; previousAssessment?: string };
  goal?: AssessedIntention & { progressEstimate: number };
  contributions: ReturnType<typeof evidenceWindow>["contributions"];
  dialogue: Array<{ speechId: string; own: boolean; speaker: string; content: string; room: string; atSimMs?: number }>;
  unresolvedSignals: Array<{ id: string; source: string; status: string; ageSimMs: number; reason?: string }> };
export type ActivityReviewContext = Readonly<{ evidence: Readonly<Evidence>; observedAtSimMs: number }>;
type Issuance = { world: World; eid: number; state: ActivityState; roomKey: string; revision: number; turns: SocialDialogueTurn[]; turnIds: string[]; situationBasis: string; goalBasis?: string };
const issuances = new WeakMap<ActivityReviewContext, Issuance>();
/** Actor-owned current intention, never borrowed from the interlocutor or
 * selected by parsing prose. Its identity/contract bind only this assessment. */
function assessmentGoal(world: World, eid: number, goal: number | undefined) {
  if (goal === undefined || !["active", "in_progress"].includes(Goal.status[goal])) return;
  const ref = getCoordinationGoalRef(world, eid, goal); if (!ref) return;
  return { target: { id: goal, key: ref.goalKey, description: Goal.description[goal], progressEstimate: Goal.progress[goal] || 0 },
    basis: JSON.stringify([ref, Goal.description[goal], Goal.status[goal], Goal.paramsJson[goal], Goal.successJson[goal]]) };
}
export function captureActivityReview(world: World, eid: number): ActivityReviewContext | undefined {
  assertSimulationTaskActive();
  const current = basis(world, eid), state = states.get(world)?.get(eid), now = readSimulationTime(world);
  if (!state || !matches(state, current) || now < state.sinceSimMs) return;
  const window = evidenceWindow(world, eid, state), elapsed = now - state.sinceSimMs;
  if (!due(world, state, window.contributions.length, elapsed)) return;
  // Exact completed receipts only: never inferred replies, private thoughts,
  // partial words, or the utterance currently being proposed.
  const selectedIds = new Set([...window.fresh.filter(turn => turn.own).slice(-6), ...window.fresh.filter(turn => !turn.own).slice(-6)].map(turn => turn.id));
  const turns = structuredClone(window.fresh.filter(turn => selectedIds.has(turn.id)));
  const purpose = snapshotActorContinuation(world, eid), situation = snapshotActivitySituation(world, eid);
  const organizing = situation.organizingActivity;
  const goal = assessmentGoal(world, eid, organizing?.status === "active" && !organizing.needsRevalidation
    ? organizing.intention?.id ?? purpose?.goalId : purpose?.goalId);
  const evidence: Evidence = { episodeId: state.id, elapsedSimMs: elapsed, purpose: purpose?.purpose, situation,
    encounterElapsedSimMs: now - state.startedAtSimMs, reviewCount: state.reviewCount,
    previousExpectedProgress: state.expectedProgress, recentReviews: state.recentReviews.map(copyReview),
    ...(state.reviewCount ? { previousReview: { reason: state.reason, previousOutcome: state.previousOutcome,
      assessedExpectation: state.assessedExpectation, previousAssessment: state.previousAssessment, evidenceIds: [...state.evidenceIds || []] } } : {}),
    ...(goal ? { goal: goal.target } : {}),
    contributions: window.contributions.slice(-6), dialogue: turns.map(turn => ({ speechId: turn.id, own: turn.own, speaker: turn.speaker,
      content: turn.content, room: turn.room, ...(turn.atSimMs === undefined ? {} : { atSimMs: turn.atSimMs }) })),
    unresolvedSignals: snapshotAttentionSignals(world, eid).map(signal => ({ id: signal.id, source: signal.source, status: signal.status,
      ageSimMs: now - signal.observedAtSimMs, ...(signal.reason ? { reason: signal.reason } : {}) })) };
  for (const row of [...evidence.contributions, ...evidence.dialogue, ...evidence.unresolvedSignals]) Object.freeze(row);
  Object.freeze(evidence.contributions); Object.freeze(evidence.dialogue); Object.freeze(evidence.unresolvedSignals);
  if (evidence.goal) Object.freeze(evidence.goal);
  if (evidence.previousReview) { if (evidence.previousReview.evidenceIds) Object.freeze(evidence.previousReview.evidenceIds); Object.freeze(evidence.previousReview); }
  const freeze = (value: object) => { for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child); Object.freeze(value); };
  freeze(situation);
  freeze(evidence.recentReviews);
  const context = Object.freeze({ evidence: Object.freeze(evidence), observedAtSimMs: now });
  issuances.set(context, { world, eid, state, roomKey: current!.key!, revision: state.reviewCount, turns, turnIds: window.turns.map(turn => turn.id), situationBasis: activitySituationBasis(situation), goalBasis: goal?.basis });
  return context;
}
export function formatActivityReview(context: ActivityReviewContext | undefined): string {
  return context ? `CONVERSATION CHECK-IN — you've been at this exchange a while. Is it still worth it?
This reply must include control.activityReview. Evidence you can cite:
${JSON.stringify(context.evidence)}
Keep going if it's getting you somewhere — information, closeness, a fight worth having, a secret coming out, simply company you want. Pause or close it if it has gone flat or something else matters more now; you can leave the concern unresolved and turn to another. Earlier check-ins (recentReviews) are your own past reads of it.
${context.evidence.goal ? `Also say how it's going for your intention ${JSON.stringify(context.evidence.goal.description)} with intentionAssessment: outcome "advanced" (closer to it) | "sustained" (keeping up something it wants) | "unchanged" | "blocked" (missing something specific) and a reason. Getting the answer you wanted in conversation isn't the same as progress on your intention.\n` : "You have no current intention to assess; omit intentionAssessment.\n"}Shape: control.activityReview = {"disposition":"continue|pause|close" (pick one),"reason":"one line, ≤400 chars","evidenceIds":[1–6 IDs from above, including at least one of your own completed lines]${context.evidence.goal ? ',"intentionAssessment":{"outcome":"...","reason":"..."}' : ""}${context.evidence.previousExpectedProgress ? ',"previousOutcome":"met|sustained|unresolved|changed","previousAssessment":"did you get what you hoped for last time?"' : ""},"expectedProgress":"what continuing can get you (omit for close)"}. Omit fields that don't apply rather than sending null.` : "";
}
/** Operator-only reference audit. Fingerprints preserve repeated invalid IDs
 * without storing arbitrary model strings, speech, private reasons or prompts.
 * This never issues evidence, repairs a citation or changes admission. */
export function activityReviewEvidenceDiagnostic(context: ActivityReviewContext | undefined, value: unknown) {
  if (!context || !issuances.has(context)) return undefined;
  const e = context.evidence;
  const digest = (id: string) => createHash("sha256").update(id).digest("hex");
  const row = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
  const ids = Array.isArray(row?.evidenceIds) ? row.evidenceIds : [];
  return {
    issuedSpeech: e.dialogue.map(t => ({ hash: digest(t.speechId), own: t.own })),
    issuedPhysical: e.situation.physicalOutcomes.map(t => digest(t.id)),
    citedCount: ids.length,
    cited: ids.slice(0, 6).map(id => {
      if (typeof id !== "string") return { type: typeof id };
      const speech = e.dialogue.find(t => t.speechId === id);
      return { hash: digest(id), length: id.length,
        source: speech ? speech.own ? "own_speech" : "heard_speech"
          : e.situation.physicalOutcomes.some(t => t.id === id) ? "physical_outcome"
          : e.contributions.some(t => t.speechId === id) ? "contribution_outside_dialogue"
          : e.recentReviews.some(t => t.evidenceIds.includes(id)) ? "previous_review"
          : e.unresolvedSignals.some(t => t.id === id) ? "attention_signal"
          : id === e.episodeId ? "episode"
          : id === e.goal?.key || id === String(e.goal?.id) ? "goal" : "unknown",
        // A dropped speech: prefix is distinguishable without making it valid.
        matchesSpeechWithoutPrefix: e.dialogue.some(t => t.speechId.replace(/^speech:/, "") === id),
      };
    }),
  };
}
const prose = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 400 && !/[\u0000-\u001f\u007f]/u.test(value);
export type ActivityReviewIssue = "missing" | "fields" | "disposition" | "reason" | "expectedProgress" | "evidenceIds" | "previousOutcome" | "previousAssessment" | "intentionAssessment" | "unissued_evidence" | "own_contribution";
export type ActivityReviewRejectionField = `control.activityReview.${ActivityReviewIssue}`;
/** Protocol feedback only. No raw response content or proposed behavior. */
export function activityReviewIssueFeedback(field: string | undefined): string | undefined {
  const feedback:Record<ActivityReviewIssue,string>={
    missing:"When an ACTIVITY REVIEW is issued, include control.activityReview using that request's evidence.",
    fields:"Use only disposition, reason, evidenceIds, expectedProgress, previousOutcome, previousAssessment and intentionAssessment in activityReview; omit inapplicable fields.",
    disposition:'Choose one disposition: "continue", "pause", or "close".',
    reason:"Give a nonempty single-line reason of at most 400 characters.",
    expectedProgress:'For "continue" or "pause", include single-line expectedProgress (1–400 characters). For "close", omit expectedProgress entirely, including null.',
    evidenceIds:"Use 1–6 distinct string IDs from the current activity-review evidence.",
    previousOutcome:'When a previousExpectedProgress is listed, include previousOutcome: "met", "sustained", "unresolved", or "changed". Otherwise omit it.',
    previousAssessment:"When a previousExpectedProgress is listed, include a single-line previousAssessment (1–400 characters). Otherwise omit it.",
    intentionAssessment:'When the review lists a current goal, include intentionAssessment with only outcome ("advanced", "sustained", "unchanged", or "blocked") and a single-line reason (1–400 characters). Assess that intention, separately from whether someone replied. Otherwise omit intentionAssessment.',
    unissued_evidence:"Cite speechId values from the current activity-review dialogue or IDs from its physicalOutcomes, not goal, episode, signal or proposed-action IDs.",
    own_contribution:"Include at least one speechId from a current activity-review dialogue entry marked own:true; hearing someone else is not your contribution.",
  };
  const prefix="control.activityReview.";
  return field?.startsWith(prefix) ? feedback[field.slice(prefix.length) as ActivityReviewIssue] : undefined;
}
export function prepareActivityReview(context: ActivityReviewContext, value: unknown, onStale?: () => void,
  onInvalid?: (field: ActivityReviewRejectionField) => void) {
  const invalid = (issue: ActivityReviewIssue) => { onInvalid?.(`control.activityReview.${issue}`); return undefined; };
  const issued = issuances.get(context); if (!issued) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("missing");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !["disposition", "reason", "evidenceIds", "expectedProgress", "previousOutcome", "previousAssessment", "intentionAssessment"].includes(key))) return invalid("fields");
  if (typeof row.disposition !== "string" || !["continue", "pause", "close"].includes(row.disposition)) return invalid("disposition");
  if (!prose(row.reason)) return invalid("reason");
  if (row.disposition === "close" ? row.expectedProgress !== undefined : !prose(row.expectedProgress)) return invalid("expectedProgress");
  if (!Array.isArray(row.evidenceIds) || row.evidenceIds.length < 1 || row.evidenceIds.length > 6
    || row.evidenceIds.some(id => typeof id !== "string") || new Set(row.evidenceIds).size !== row.evidenceIds.length) return invalid("evidenceIds");
  if (context.evidence.previousExpectedProgress ? typeof row.previousOutcome !== "string"
    || !["met", "sustained", "unresolved", "changed"].includes(row.previousOutcome) : row.previousOutcome !== undefined) return invalid("previousOutcome");
  if (context.evidence.previousExpectedProgress ? !prose(row.previousAssessment) : row.previousAssessment !== undefined) return invalid("previousAssessment");
  let intentionAssessment: IntentionAssessment | undefined;
  if (context.evidence.goal) {
    const value = row.intentionAssessment;
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("intentionAssessment");
    const assessment = value as Record<string, unknown>;
    if (Object.keys(assessment).some(k => !["outcome", "reason"].includes(k))
      || typeof assessment.outcome !== "string" || !["advanced", "sustained", "unchanged", "blocked"].includes(assessment.outcome)
      || !prose(assessment.reason)) return invalid("intentionAssessment");
    intentionAssessment = Object.freeze({ outcome: assessment.outcome as IntentionOutcome, reason: assessment.reason.trim() });
  } else if (row.intentionAssessment !== undefined) return invalid("intentionAssessment");
  const evidenceIds = row.evidenceIds as string[];
  const cited = issued.turns.filter(turn => evidenceIds.includes(turn.id));
  const physical = context.evidence.situation.physicalOutcomes.filter(outcome => evidenceIds.includes(outcome.id));
  if (cited.length + physical.length !== row.evidenceIds.length) return invalid("unissued_evidence");
  if (!cited.some(turn => turn.own)) return invalid("own_contribution");
  const selected = { disposition: row.disposition as Disposition, reason: row.reason.trim(), evidenceIds: [...row.evidenceIds] as string[],
    ...(intentionAssessment ? { intentionAssessment, assessedIntention: Object.freeze({ id: context.evidence.goal!.id,
      key: context.evidence.goal!.key, description: context.evidence.goal!.description }) } : {}),
    ...(row.expectedProgress !== undefined ? { expectedProgress: String(row.expectedProgress).trim() } : {}),
    ...(row.previousOutcome !== undefined ? { previousOutcome: row.previousOutcome as Outcome,
      previousAssessment: String(row.previousAssessment).trim(), assessedExpectation: context.evidence.previousExpectedProgress! } : {}) };
  Object.freeze(selected.evidenceIds);
  const current = () => {
    const { world, eid, state } = issued;
    const actual = getSocialDialogue(world, eid);
    return states.get(world)?.get(eid) === state && matches(state, basis(world, eid)) && state.status === "active"
      // Historical continuity across travel is not authority to commit a
      // review drafted in a different local scene.
      && basis(world, eid)?.key === issued.roomKey
      && state.reviewCount === issued.revision && readSimulationTime(world) >= context.observedAtSimMs
      && (!context.evidence.goal || assessmentGoal(world, eid, context.evidence.goal.id)?.basis === issued.goalBasis)
      && activitySituationBasis(snapshotActivitySituation(world, eid)) === issued.situationBasis
      && (selected.disposition === "continue" || !actual.some(turn => state.observedTurns.has(turn.id) && !issued.turnIds.includes(turn.id)))
      && cited.every(turn => actual.some(now => now.id === turn!.id && JSON.stringify(now) === JSON.stringify(turn)));
  };
  if (!current()) { onStale?.(); return; }
  let consumed = false;
  return { current: () => !consumed && current(), commit: () => {
    assertSimulationTaskActive(); if (consumed || !current()) return false;
    if (selected.disposition === "close" && !recordPersonalSocialClosure(issued.world, issued.eid, {
      description: context.evidence.purpose || "This exchange", reason: selected.reason, evidence: cited as SocialDialogueTurn[],
    })) return false;
    consumed = true;
    issued.state.recentReviews = [...issued.state.recentReviews, {
      atSimMs: context.observedAtSimMs, ...selected, evidenceIds: [...selected.evidenceIds],
    }].slice(-REVIEW_HISTORY_LIMIT);
    issued.state.baselineTurns = new Set(issued.turnIds); issued.state.sinceSimMs = context.observedAtSimMs;
    issued.state.reviewCount++; issued.state.expectedProgress = selected.expectedProgress;
    issued.state.reason = selected.reason; issued.state.previousOutcome = selected.previousOutcome; issued.state.evidenceIds = [...selected.evidenceIds];
    issued.state.previousAssessment = selected.previousAssessment; issued.state.assessedExpectation = selected.assessedExpectation;
    issued.state.status = selected.disposition === "close" ? "closed" : selected.disposition === "pause" ? "paused" : "active";
    return true;
  }, summary: Object.freeze({ episodeId: issued.state.id, ...selected, contributionIds: Object.freeze(context.evidence.contributions.map(c => c.speechId)) }) };
}
export function snapshotActivityReview(world: World, eid: number) {
  const b = basis(world, eid), state = states.get(world)?.get(eid), now = readSimulationTime(world);
  if (!state || !matches(state, b) || now < state.sinceSimMs) return;
  const elapsedSimMs = now - state.sinceSimMs, completedContributions = evidenceWindow(world, eid, state).contributions.length;
  return { episodeId: state.id, status: state.status, startedAtSimMs: state.startedAtSimMs,
    sinceSimMs: state.sinceSimMs, reviewCount: state.reviewCount, expectedProgress: state.expectedProgress, reason: state.reason,
    previousOutcome: state.previousOutcome, previousAssessment: state.previousAssessment, assessedExpectation: state.assessedExpectation,
    evidenceIds: [...state.evidenceIds || []],
    recentReviews: state.recentReviews.map(copyReview),
    elapsedSimMs, completedContributions, due: due(world, state, completedContributions, elapsedSimMs) };
}
