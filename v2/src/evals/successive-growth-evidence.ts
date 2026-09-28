/** Pure read-only evaluation of observer-captured evidence. This never selects
 * actions, edits goals, approves construction or authenticates arbitrary JSON.
 * Authored concerns are not evidence that the NPC independently formed a goal. */
import type { PublicCommittedEvent } from "../runtime/committed-events";
import type { DinerReview } from "./iterative-diner-evidence";

export type SuccessiveNeedKind = "meal" | "seat";
export interface SuccessiveGrowthBuild {
  proposalId: string;
  sourceId: string;
  targetKey: string;
  kind: SuccessiveNeedKind;
  /** Observation timestamps, not invented native construction timestamps. */
  observedApprovedAtSimMs: number;
  observedExecutedAtSimMs: number;
  approvedByGod: boolean;
}
export interface SuccessiveGrowthObservation {
  event: PublicCommittedEvent;
  hunger?: number;
  targetExists?: boolean;
  /** null means explicitly observed unoccupied; undefined means no evidence. */
  seatOccupantKey?: string | null;
}
export interface SuccessiveGrowthFeedback {
  kind: SuccessiveNeedKind;
  sourceId: string;
  observedAtSimMs: number;
  reviewedAtSimMs: number;
  weaverEventIds: string[];
  godReview: DinerReview;
}
export interface SuccessiveGrowthEvidence {
  sourceId: string;
  actorKey: string;
  startAtSimMs: number;
  initialEntityKeys: string[];
  needGoals: { key: string; kind: SuccessiveNeedKind; description: string; authoredAtSimMs: number }[];
  builds: SuccessiveGrowthBuild[];
  observations: SuccessiveGrowthObservation[];
  finalState: { sourceId: string; actorKey: string; atSimMs: number; presentEntityKeys: string[] };
  feedback: SuccessiveGrowthFeedback[];
  diagnostics: { errorsTotal: number; observerFailures: number };
  /** Harness audit, not a security boundary against fabricated evidence. */
  authority: { hostActionInjections: number; postStartGoalWrites: number };
}
export interface SuccessiveGrowthVerdict {
  passed: boolean;
  failures: string[];
  mealEventId?: string;
  seatEventId?: string;
  requiresQualitativeReview: true;
}

const key = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const time = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
type Use = { before: SuccessiveGrowthObservation; after: SuccessiveGrowthObservation; build: SuccessiveGrowthBuild };

function feedbackIncludesUse(evidence: SuccessiveGrowthEvidence, feedback: SuccessiveGrowthFeedback, use: Use): boolean {
  const event = use.after.event, review = feedback?.godReview;
  if (!feedback || feedback.sourceId !== evidence.sourceId || !time(feedback.observedAtSimMs)
    || !time(feedback.reviewedAtSimMs) || feedback.observedAtSimMs < event.atSimMs
    || feedback.reviewedAtSimMs < feedback.observedAtSimMs || feedback.reviewedAtSimMs > evidence.finalState.atSimMs
    || !Array.isArray(feedback.weaverEventIds) || !feedback.weaverEventIds.includes(event.id)
    || review?.result?.ran !== true || review.result.executed !== true || !Array.isArray(review.before) || review.before.length === 0
    || review.result.messagesIncluded !== review.before.length) return false;
  // A successful unrelated God command or proposal approval is not a review of
  // this outcome. Check the actual full input batch, including source identity.
  // A batch may legitimately include BOTH that exact receipt and new proposals.
  return review.before.some(message => message?.data?.sourceId === evidence.sourceId
    && time(message.data.observedAtSimMs) && message.data.observedAtSimMs >= event.atSimMs
    && message.data.observedAtSimMs <= feedback.reviewedAtSimMs
    && Array.isArray(message.data.recentEvents) && message.data.recentEvents.some((receipt: any) => receipt?.id === event.id
      && receipt.status === "succeeded" && receipt.action === "interact" && receipt.actorKey === event.actorKey
      && receipt.targetKey === event.targetKey && receipt.completedAtSimMs === event.completedAtSimMs));
}

export function evaluateSuccessiveGrowth(evidence: SuccessiveGrowthEvidence): SuccessiveGrowthVerdict {
  const failures: string[] = [];
  const finish = (meal?: Use, seat?: Use): SuccessiveGrowthVerdict => ({ passed: failures.length === 0, failures,
    ...(meal ? { mealEventId: meal.after.event.id } : {}), ...(seat ? { seatEventId: seat.after.event.id } : {}), requiresQualitativeReview: true });
  if (!evidence || !key(evidence.sourceId) || !key(evidence.actorKey) || !time(evidence.startAtSimMs)
    || !Array.isArray(evidence.initialEntityKeys) || !Array.isArray(evidence.needGoals) || !Array.isArray(evidence.builds)
    || !Array.isArray(evidence.observations) || !Array.isArray(evidence.feedback) || !evidence.finalState
    || !Array.isArray(evidence.finalState.presentEntityKeys)) { failures.push("invalid_evidence_shape"); return finish(); }
  if (evidence.diagnostics?.errorsTotal !== 0 || evidence.diagnostics?.observerFailures !== 0) failures.push("diagnostic_failures");
  if (evidence.authority?.hostActionInjections !== 0 || evidence.authority?.postStartGoalWrites !== 0) failures.push("host_execution_or_goal_edits");
  if (!evidence.initialEntityKeys.includes(evidence.actorKey)) failures.push("initial_actor_identity_missing");
  if (evidence.finalState.sourceId !== evidence.sourceId || evidence.finalState.actorKey !== evidence.actorKey
    || !evidence.finalState.presentEntityKeys.includes(evidence.actorKey)
    || !time(evidence.finalState.atSimMs) || evidence.finalState.atSimMs < evidence.startAtSimMs) failures.push("final_scope_or_time_changed");
  const goals = evidence.needGoals.filter(goal => goal && key(goal.key) && key(goal.description)
    && time(goal.authoredAtSimMs) && goal.authoredAtSimMs <= evidence.startAtSimMs);
  const mealGoal = goals.find(goal => goal.kind === "meal"), seatGoal = goals.find(goal => goal.kind === "seat");
  if (!mealGoal || !seatGoal || mealGoal.key === seatGoal.key || normalized(mealGoal.description) === normalized(seatGoal.description))
    failures.push("distinct_initial_concerns_missing");
  if (evidence.initialEntityKeys.some(value => !key(value)) || evidence.finalState.presentEntityKeys.some(value => !key(value)))
    failures.push("invalid_entity_identity");

  const ids = new Set<string>(); let lastSequence = 0, lastAt = evidence.startAtSimMs;
  for (const observation of evidence.observations) {
    const event = observation?.event;
    if (!event || !key(event.id) || ids.has(event.id) || event.sourceId !== evidence.sourceId
      || !Number.isSafeInteger(event.sequence) || event.sequence <= lastSequence || !time(event.atSimMs)
      || event.atSimMs < lastAt || event.atSimMs > evidence.finalState.atSimMs) {
      failures.push("invalid_or_duplicate_event_stream"); return finish();
    }
    ids.add(event.id); lastSequence = event.sequence; lastAt = event.atSimMs;
  }
  const initialKeys = new Set(evidence.initialEntityKeys);
  const builds = evidence.builds.filter(build => build && key(build.proposalId) && key(build.targetKey)
    && build.sourceId === evidence.sourceId && build.approvedByGod === true && !initialKeys.has(build.targetKey)
    && time(build.observedApprovedAtSimMs) && time(build.observedExecutedAtSimMs)
    && build.observedApprovedAtSimMs >= evidence.startAtSimMs && build.observedExecutedAtSimMs >= build.observedApprovedAtSimMs
    && build.observedExecutedAtSimMs <= evidence.finalState.atSimMs);
  const interactions = evidence.observations.filter(({ event }) => event.actorKey === evidence.actorKey && event.kind === "action" && event.action === "interact");
  const uses: Use[] = [];
  for (const after of interactions.filter(({ event }) => event.status === "succeeded")) {
    const event = after.event;
    const matching = interactions.filter(row => row.event.executionId === event.executionId);
    const pending = matching.filter(row => row.event.status === "pending");
    // Duplicate completions or a failure followed by success are not two uses.
    if (matching.length !== 2 || pending.length !== 1) continue;
    const before = pending[0], start = before.event;
    if (!key(event.executionId) || !key(event.targetKey) || event.targetKey !== start.targetKey || event.actorId !== start.actorId
      || !Number.isSafeInteger(event.actorId) || event.actorId < 0 || !Number.isSafeInteger(event.roomId) || event.roomId < 0
      || !key(event.roomKey) || event.roomKey !== start.roomKey || event.roomId !== start.roomId
      || event.operation !== start.operation || start.sequence >= event.sequence || start.text !== undefined || event.text !== undefined
      || !time(start.startedAtSimMs) || start.startedAtSimMs !== start.atSimMs
      || start.completedAtSimMs !== undefined || !time(start.expectedEndSimMs) || start.expectedEndSimMs <= start.startedAtSimMs
      || event.startedAtSimMs !== start.startedAtSimMs || event.completedAtSimMs !== event.atSimMs
      || event.atSimMs < start.expectedEndSimMs || before.targetExists !== true) continue;
    for (const build of builds.filter(build => build.targetKey === event.targetKey && build.observedExecutedAtSimMs <= start.atSimMs)) uses.push({ before, after, build });
  }
  const meal = uses.find(use => use.build.kind === "meal" && use.before.event.operation === "eating" && use.after.targetExists === false
    && time(use.before.hunger) && time(use.after.hunger) && use.before.hunger <= 100 && use.after.hunger < use.before.hunger);
  if (!meal) failures.push("new_approved_meal_native_use_missing");
  const seat = meal && uses.find(use => use.build.kind === "seat" && use.build.proposalId !== meal.build.proposalId
    && use.build.targetKey !== meal.build.targetKey && use.build.observedExecutedAtSimMs > meal.after.event.atSimMs
    && use.before.event.atSimMs >= meal.after.event.atSimMs && use.after.targetExists === true
    && use.before.seatOccupantKey === null && use.after.seatOccupantKey === evidence.actorKey);
  if (!seat) failures.push("distinct_later_build_and_native_seating_missing");
  if (meal && evidence.finalState.presentEntityKeys.includes(meal.build.targetKey)) failures.push("consumed_identity_reappeared");
  if (meal && !evidence.feedback.some(feedback => feedback?.kind === "meal" && feedbackIncludesUse(evidence, feedback, meal)))
    failures.push("meal_feedback_missing_or_stale");
  if (seat && !evidence.feedback.some(feedback => feedback?.kind === "seat" && feedbackIncludesUse(evidence, feedback, seat)))
    failures.push("seat_feedback_missing_or_stale");
  return finish(meal, seat || undefined);
}
