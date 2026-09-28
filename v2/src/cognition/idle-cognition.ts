/** Event-driven foreground pacing, not a simulation pause.
 *
 * Successful quiet actions yield the foreground model slot until something the
 * actor can perceive changes or a bounded reconsideration deadline arrives.
 * Physics, needs, planning, reflection and world-building keep their own clocks.
 * This runtime-only ledger deliberately starts fresh when a world is restored.
 */
import { entityExists, getRelationTargets, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { readSimulationTime } from "../ecs/simulation-time";
import { Agent, CognitiveControl, Goal, Health, InCombat, Needs, Plan, SocialMemory, WorkingMemoryIdentity, Name, Perception } from "../ecs/components";
import { HasGoal, HasPlan, HasPerception } from "../ecs/relations";
import type { AgentAction } from "./agent-mind";
import { settleNextPurpose, hasNextPurposeReview } from "./actor-continuation";
import { getAgentSensoryFingerprint } from "./sensory-system";
import { isResting } from "./rest-state";
import { getWorkingMemory, getWorkingMemoryRevision } from "./working-memory";
import { getCurrentStep, getPlanForGoal, hasActionablePlannedStep } from "./planning-system";
import { getCoordinationMemory, getCoordinationRevision, hasCoordinationCommunicationGap } from "./coordination-memory";
import { copyPlanWaitUntil, getPlanEvidenceBarrierTiming } from "./plan-evidence-barrier";
import { getObservedStateFields, getAgentWorldCapabilities } from "./world-capabilities";
import { isSpeaking, getSpeakingActivity, readLocalSpeechOpportunity } from "./timed-speech";
import { getSocialDialogue, getSocialSpeechFragments, readHeardSpeechProgress, type HeardSpeechNotice } from "./social-memory";
import { isSimulationResourceBusy } from "../runtime/simulation-timeline";
import { getCommittedSource } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { recordWaitExperience } from "./wait-experience";
import { getActorWaitTiming, recordActorWait, actorWaitIssueFeedback, type ActorWaitIssue, type ActorWaitOutcomeAuthority } from "./actor-wait";
import { cognitionController, situatedPlanGoal } from "./decision-policy";
import type { ForegroundRejectionReason, ForegroundSchemaField } from "./foreground-action-admission";
import { activityReviewIssueFeedback } from "./activity-review";

const REJECTION_DELAYS_MS = [1000, 2000, 5000, 10000, 30000] as const;
type RejectionBasis = { owner: string; source: string; signature: string; wake: number; atSimMs: number };
type RejectionRecovery = { basis: RejectionBasis; attempts: number; nextSimMs: number; reason: ForegroundRejectionReason; field?: ForegroundSchemaField; issue?: ActorWaitIssue };
const rejectionRecovery = new WeakMap<World, Map<number, RejectionRecovery>>();
const recoveryWakes = new WeakMap<World, Map<number, number>>();
const consumedRejections = new WeakSet<RejectionBasis>();
export function captureForegroundRejectionBasis(world: World, eid: number): RejectionBasis | undefined {
  const tape = getCommittedSource(world);
  if (!tape.sourceId || tape.stopped || !entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid]
    || !hasComponent(world, eid, WorkingMemoryIdentity)) return;
  return { owner: WorkingMemoryIdentity.id[eid], source: tape.sourceId, atSimMs: readSimulationTime(world),
    wake: recoveryWakes.get(world)?.get(eid) || 0,
    signature: JSON.stringify([cognitionSignature(world, eid), hasCriticalNeed(world, eid), Name.value[eid], Agent.role[eid], Agent.systemPrompt[eid],
      getRelationTargets(world, eid, HasPerception).filter(id => hasComponent(world, id, Perception)
        && ["attention", "danger", "directed_speech", "speech", "speech_fragment", "daemon_whisper", "daemon_challenge", "intent", "action_failed"].includes(Perception.type[id]))
        .map(id => [id, Perception.timestamp[id], Perception.type[id]])]) };
}
function rejectionBasisCurrent(world: World, eid: number, basis: RejectionBasis): boolean {
  const current = captureForegroundRejectionBasis(world, eid);
  return !!current && current.atSimMs >= basis.atSimMs && current.owner === basis.owner && current.source === basis.source
    && current.wake === basis.wake && current.signature === basis.signature;
}
export function recordForegroundRejection(world: World, eid: number, basis: RejectionBasis | undefined,
  reason: ForegroundRejectionReason, field?: ForegroundSchemaField, issue?: ActorWaitIssue): void {
  assertSimulationTaskActive();
  if (!basis || consumedRejections.has(basis) || reason === "cancelled" || !rejectionBasisCurrent(world, eid, basis)) return;
  consumedRejections.add(basis);
  let rows = rejectionRecovery.get(world); if (!rows) { rows = new Map(); rejectionRecovery.set(world, rows); }
  const previous = rows.get(eid);
  const attempts = Math.min(REJECTION_DELAYS_MS.length, (previous && rejectionBasisCurrent(world, eid, previous.basis) ? previous.attempts : 0) + 1);
  rows.set(eid, { basis, attempts, reason, field, issue, nextSimMs: readSimulationTime(world) + REJECTION_DELAYS_MS[attempts - 1] });
}
export function formatForegroundRejectionRecovery(world: World, eid: number): string {
  const row = rejectionRecovery.get(world)?.get(eid);
  if (!row || !rejectionBasisCurrent(world, eid, row.basis)) return "";
  const feedback = row.field === "goalReview.reason"
    ? "Every goalReview disposition requires a nonblank reason of at most 400 characters. Supply your reason if you still choose that review, or omit goalReview. No intention was changed."
    : row.field === "control.nextPurpose"
      ? "For a ready chosen next purpose, include control.nextPurposeReview with its exact listed id, your disposition (take or cancel), and a nonblank reason. Taking it also requires its goalId, even if your proposed action already serves that goal. A new nextPurpose cannot replace an existing one. Reconsider using the current chosen-next-purpose block; no follow-up was consumed."
    : row.issue ? actorWaitIssueFeedback(row.issue) : activityReviewIssueFeedback(row.field) ?? "Use the offered action types and fields; omit optional fields that do not apply.";
  return `YOUR LAST REPLY COULD NOT BE USED: ${row.reason}${row.field ? ` at ${row.field}` : ""}.\nNothing from it took effect. ${feedback}`;
}

// Quiet choices back off, but a still character is revisited soon enough to
// notice the room changing around them.
const QUIET_DELAYS_MS = [2_000, 4_000, 7_000, 12_000, 20_000] as const;
const QUIET_ACTIONS = new Set(["wait", "rest", "observe", "think", "reflect"]);
type ListeningActivity = { executionIds: string[]; untilSimMs: number; explicit?: boolean };
type IdleState = { signature: string; quietDecisions: number; nextCheckAtMs: number; lastRecordedAtMs: number; listening?: ListeningActivity;
  clock: "simulation" | "explicit"; owner: string; source: string | null; atSimMs: number };
const idleByWorld = new WeakMap<World, Map<number, IdleState>>();
function ownedIdleState(world: World, eid: number): IdleState | undefined {
  const state = idleByWorld.get(world)?.get(eid), tape = getCommittedSource(world);
  return state && !tape.stopped && entityExists(world, eid)
    && hasComponent(world, eid, Agent) && Agent.active[eid]
    && state.source === tape.sourceId
    && state.owner === (hasComponent(world, eid, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[eid] || "" : "")
    && readSimulationTime(world) >= state.atSimMs ? state : undefined;
}
type SpeechDeferral = { owner: string; startedAtSimMs: number; untilSimMs: number };
const speechDeferrals = new WeakMap<World, Map<number, SpeechDeferral>>();
type MemorySignature = { owner: string; workingRevision: number; coordinationRevision: number; signature: string };
const memorySignatures = new WeakMap<World, Map<number, MemorySignature>>();
export type ForegroundStateField = "senses" | "dialogue" | "memory" | "publicFields" | "goals" | "plans";
export type ForegroundWakeCause = "explicit" | "stimulus" | "goal_resumed" | "decision_rejected" | "decision_superseded" | "execution_outcome" | "continuation_revision";
type Wake = { cause: ForegroundWakeCause; stimulusType?: string };
type ReadinessDiagnostics = { owner: string; source: string | null; atSimMs: number; wake?: Wake;
  admissions: number; counts: Partial<Record<ForegroundCognitionReadiness["reason"], number>>;
  lastAdmission?: ForegroundCognitionReadiness & { atSimMs: number } };
const readinessDiagnostics = new WeakMap<World, Map<number, ReadinessDiagnostics>>();

function diagnosticState(world: World, eid: number, create = false): ReadinessDiagnostics | undefined {
  const tape = getCommittedSource(world), now = readSimulationTime(world);
  if (tape.stopped || !entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid]) return;
  const owner = hasComponent(world, eid, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[eid] || "" : "";
  let rows = readinessDiagnostics.get(world), state = rows?.get(eid);
  if (state && (state.owner !== owner || state.source !== tape.sourceId || now < state.atSimMs)) state = undefined;
  if (!state && create) {
    if (!rows) { rows = new Map(); readinessDiagnostics.set(world, rows); }
    state = { owner, source: tape.sourceId, atSimMs: now, admissions: 0, counts: {} }; rows.set(eid, state);
  }
  return state;
}

export interface ForegroundReadinessOptions {
  /** Optional isolated/test deadline clock. Runtime uses simulation elapsed ms. */
  now?: number;
  /** Must be filtered through this actor's senses, not every queued world event. */
  hasPendingStimuli?: boolean;
  /** Fresh queued input must be delivered even while old unintegrated cues remain. */
  hasQueuedStimuli?: boolean;
  /** A previously considered cue's deadline, not a newly perceived event. */
  hasDueAttention?: boolean;
}
export interface ForegroundCognitionReadiness {
  ready: boolean;
  reason: "inactive" | "speaking" | "occupied" | "speech_floor" | "first_decision" | "new_stimulus" | "critical_need" | "actionable_plan" | "state_changed" | "idle_deadline" | "evidence_deadline" | "quiet" | "rejection_backoff";
  quietDecisions: number;
  nextCheckAtMs: number | null;
  /** Typed causes only; no raw perception, message or private memory content. */
  changedFields?: ForegroundStateField[];
  wake?: Wake;
  listening?: ListeningActivity;
}

/** Record actual dispatch, not each scheduler readiness probe. */
export function recordForegroundCognitionAdmission(world: World, eid: number, readiness: ForegroundCognitionReadiness): void {
  if (!readiness.ready) return;
  const state = diagnosticState(world, eid, true); if (!state) return;
  state.atSimMs = readSimulationTime(world); state.admissions++;
  state.counts[readiness.reason] = (state.counts[readiness.reason] || 0) + 1;
  state.lastAdmission = structuredClone({ ...readiness, atSimMs: state.atSimMs });
  state.wake = undefined;
}
export function snapshotForegroundCognitionDiagnostics(world: World, eid: number) {
  const state = diagnosticState(world, eid); if (!state) return;
  return structuredClone({ admissions: state.admissions, counts: state.counts,
    lastAdmission: state.lastAdmission, pendingWake: state.wake });
}

function ownedGoals(world: World, eid: number): number[] {
  return getRelationTargets(world, eid, HasGoal).filter(id => entityExists(world, id) && hasComponent(world, id, Goal)).sort((a, b) => a - b);
}
function ownedPlans(world: World, eid: number, goals: readonly number[]): number[] {
  return getRelationTargets(world, eid, HasPlan).filter(id => entityExists(world, id) && hasComponent(world, id, Plan)
    && goals.includes(Plan.goalEid[id])).sort((a, b) => a - b);
}

/** Revisions are cheap invalidation hints, not semantic changes themselves.
 * Cache the bounded projection until a ledger revision actually changes. */
function memorySignature(world: World, eid: number): string {
  const owner = hasComponent(world, eid, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[eid] || "" : "";
  const workingRevision = getWorkingMemoryRevision(world, eid), coordinationRevision = getCoordinationRevision(world, eid);
  let rows = memorySignatures.get(world); if (!rows) { rows = new Map(); memorySignatures.set(world, rows); }
  const previous = rows.get(eid);
  if (previous?.owner === owner && previous.workingRevision === workingRevision && previous.coordinationRevision === coordinationRevision) return previous.signature;
  const facts = getWorkingMemory(world, eid).facts.filter(f => !["Inspection.basis", "Inspection.question"].includes(f.slot || ""))
    .map(f => [f.subject, f.subjectLabel, f.predicate, f.slot, f.value, f.valueLabel])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const coordination = getCoordinationMemory(world, eid).items.map(item => [item.id, item.task, item.ownerKey, item.own,
    item.goal?.goalKey, item.goalRelation, item.completion, item.localStatus, item.localReason,
    item.lastReported.status, item.lastReported.speech.id, hasCoordinationCommunicationGap(item)])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const signature = JSON.stringify({ facts, coordination });
  rows.set(eid, { owner, workingRevision, coordinationRevision, signature });
  return signature;
}

function planIntent(planEid: number): unknown {
  try {
    const steps = JSON.parse(Plan.steps[planEid] || "[]"); if (!Array.isArray(steps)) return ["invalid", steps];
    return steps.slice(Plan.currentStep[planEid] || 0).map(step => [step?.actionType, step?.target, step?.content,
      step?.waitUntil === undefined ? undefined : copyPlanWaitUntil(step.waitUntil) ?? step.waitUntil, step?.repeat]);
  } catch { return ["invalid", Plan.steps[planEid]]; }
}

const TERMINAL_GOAL_STATUSES = new Set(["completed", "failed", "retired", "expired"]);
function cognitionSignature(world: World, eid: number, listening?: ListeningActivity): string {
  // Closing live work changes the signature once. Subsequent archive edits or
  // retention cleanup are not new intentions. Keep paused/queued and unknown
  // statuses visible so this is not an active-only agenda or a novelty filter.
  const goals = ownedGoals(world, eid).filter(id => !TERMINAL_GOAL_STATUSES.has(Goal.status[id]));
  // Continuous progress estimates and timestamps are bookkeeping, not a fresh
  // reason to regenerate the same thought. Contracts and actual steps matter.
  return JSON.stringify({
    senses: getAgentSensoryFingerprint(world, eid),
    dialogue: listening?.explicit ? {
      turns: getSocialDialogue(world, eid).map(turn => turn.id),
      fragments: getSocialSpeechFragments(world, eid).map(fragment => [fragment.id,
        listening.executionIds.includes(fragment.executionId) ? fragment.boundaryToken ?? fragment.notifiedToken : fragment.notifiedToken]),
    } : hasComponent(world, eid, SocialMemory) ? SocialMemory.revision[eid] || 0 : 0,
    memory: memorySignature(world, eid),
    // Deliberately public typed indicators can change without changing their
    // composed display prose. Peeking this catalog does not create evidence.
    publicFields: getObservedStateFields(world, eid).map(f => [f.subject, f.slot, f.type, f.allowedValues, f.value]),
    goals: goals.map(id => [id, hasComponent(world, id, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[id] : null,
      Goal.createdAt[id], Goal.status[id], Goal.kind[id], Goal.description[id], Goal.priority[id], Goal.paramsJson[id], Goal.successJson[id]]),
    // New executable intent matters; archived plans, generated step IDs, wait
    // tokens, proof timestamps and equivalent background rewrites do not.
    plans: ownedPlans(world, eid, goals).filter(id => ["active", "awaiting_evidence"].includes(Plan.status[id]))
      .map(id => [Plan.goalEid[id], Plan.status[id], planIntent(id)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  });
}

function hasCriticalNeed(world: World, eid: number): boolean {
  if (hasComponent(world, eid, Needs) && ((Needs.hunger[eid] ?? 0) >= 85 || ((Needs.energy[eid] ?? 100) <= 15 && !isResting(world, eid))
    || (Needs.comfort[eid] ?? 100) <= 15)) return true;
  if (hasComponent(world, eid, Health) && Health.max[eid] > 0 && Health.current[eid] / Health.max[eid] <= 0.25) return true;
  return hasComponent(world, eid, InCombat) && InCombat.targetEid[eid] >= 0;
}

function hasActionablePlan(world: World, eid: number): boolean {
  return hasActionablePlannedStep(world, eid, { urgentOnly: true });
}

/** Read-only admission probe; safe both before enqueue and again at dispatch.
 * Package physical readiness is still a separate, authoritative gate. */
export function isForegroundActorAvailable(world: World, eid: number): boolean {
  const capabilities = getAgentWorldCapabilities(world, eid);
  // Physical occupation does not switch off perception or deliberation. New
  // evidence can justify voluntarily stopping speech even while holding/walking.
  // Readiness below still prevents a quiet busy actor from thinking in a loop;
  // none of this frees body/voice resources or bypasses executor admission.
  return capabilities?.ready() !== false || capabilities.busy() || isSpeaking(world, eid)
    || isSimulationResourceBusy(world, eid, "body");
}
export function getForegroundCognitionReadiness(world: World, eid: number, options: ForegroundReadinessOptions = {}): ForegroundCognitionReadiness {
  const state = ownedIdleState(world, eid);
  const result = (ready: boolean, reason: ForegroundCognitionReadiness["reason"]): ForegroundCognitionReadiness => ({
    ready, reason, quietDecisions: state?.quietDecisions || 0, nextCheckAtMs: state?.nextCheckAtMs ?? null,
    ...(diagnosticState(world, eid)?.wake ? { wake: { ...diagnosticState(world, eid)!.wake! } } : {}),
    ...(state?.listening ? { listening: { ...state.listening, executionIds: [...state.listening.executionIds] } } : {}),
  });
  if (!entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid]) return result(false, "inactive");
  const recovery = rejectionRecovery.get(world)?.get(eid);
  if (recovery && !options.hasQueuedStimuli && rejectionBasisCurrent(world, eid, recovery.basis) && readSimulationTime(world) < recovery.nextSimMs)
    return { ...result(false, "rejection_backoff"), nextCheckAtMs: recovery.nextSimMs };
  const voiceBusy = isSpeaking(world, eid);
  const bodyBusy = isSimulationResourceBusy(world, eid, "body") || getAgentWorldCapabilities(world, eid)?.busy() === true;
  if (options.hasPendingStimuli) return result(true, "new_stimulus");
  if (hasCriticalNeed(world, eid)) return result(true, "critical_need");
  if (voiceBusy && bodyBusy) return result(false, "occupied");
  if (voiceBusy || bodyBusy) return result(false, voiceBusy ? "speaking" : "occupied");
  if (options.hasDueAttention) return result(true, "evidence_deadline");
  const deferred = speechDeferrals.get(world)?.get(eid), simNow = readSimulationTime(world);
  if (deferred && hasComponent(world, eid, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[eid] === deferred.owner
    && simNow >= deferred.startedAtSimMs && simNow < deferred.untilSimMs) {
    // Declining conversational overlap must not stall a real physical plan.
    // This is a pure probe, not getNextPlannedAction's mutating reconciliation.
    const goal = cognitionController(world) === "situated" ? situatedPlanGoal(world, eid)
      : ownedGoals(world, eid).filter(id => Goal.status[id] === "active")
      .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0))[0];
    const plan = goal === undefined ? undefined : getPlanForGoal(world, eid, goal);
    const step = plan === undefined ? null : getCurrentStep(plan);
    if (step && !["speak", "wait", "think", "reflect", "rest", "plan", "remember"].includes(step.actionType)
      && hasActionablePlannedStep(world, eid)) return result(true, "actionable_plan");
    return { ...result(false, "speech_floor"), nextCheckAtMs: deferred.untilSimMs };
  }
  if (!state) return result(true, "first_decision");
  if (hasActionablePlan(world, eid)) return result(true, "actionable_plan");
  const signature = cognitionSignature(world, eid, state.listening);
  if (state.signature !== signature) {
    const before = JSON.parse(state.signature), after = JSON.parse(signature);
    const changedFields = (Object.keys(after) as ForegroundStateField[]).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    return { ...result(true, "state_changed"), changedFields };
  }
  // The voice may stop or leave earshot before its estimated end. A chosen
  // listening wait is tied to that actual execution, not an unbreakable timer.
  if (state.listening && !currentHeardSpeech(world, eid).some(row => state.listening!.executionIds.includes(row.executionId))) {
    return { ...result(true, "state_changed"), changedFields: ["dialogue"] };
  }
  const chosenWait = getActorWaitTiming(world, eid, options.now);
  if (chosenWait) {
    if (chosenWait.invalid) return result(true, "state_changed");
    if (chosenWait.resolved) return result(true, "state_changed");
    const due = chosenWait.clockInvalid || chosenWait.nowMs >= chosenWait.deadlineMs;
    return { ...result(due, due ? "evidence_deadline" : "quiet"), nextCheckAtMs: chosenWait.deadlineMs };
  }
  // An explicit evidence wait has its own bounded deadline. It is not a reason
  // to regenerate "I should keep waiting" on every ordinary quiet backoff.
  const activeGoal = ownedGoals(world, eid).filter(id => Goal.status[id] === "active")
    .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0))[0];
  const plan = activeGoal === undefined ? undefined : getPlanForGoal(world, eid, activeGoal);
  const step = plan !== undefined && Plan.status[plan] === "active" ? getCurrentStep(plan) : null;
  // A planner's predicate is not the meaning of an actor-authored ordinary
  // wait—even when both mention the same goal. Legacy plan-only actors retain
  // their barrier pacing; actor control needs an explicitly chosen condition.
  if (!hasComponent(world, eid, CognitiveControl) && step?.actionType === "wait" && step.evidenceBarrier && step.evidenceScope) {
    const timing = getPlanEvidenceBarrierTiming(world, eid, step.evidenceBarrier, step.evidenceScope, { nowMs: options.now });
    if (!timing) return result(true, "state_changed"); // Invalid token needs owner reconsideration, not silence.
    return { ...result(timing.clockInvalid || timing.nowMs >= timing.deadlineMs,
      timing.clockInvalid || timing.nowMs >= timing.deadlineMs ? "evidence_deadline" : "quiet"), nextCheckAtMs: timing.deadlineMs };
  }
  const now = options.now ?? (state.clock === "simulation" ? readSimulationTime(world) : Date.now());
  // A caller that resets its simulation clock should not inherit a future wait.
  if (now < state.lastRecordedAtMs || now >= state.nextCheckAtMs) return result(true, "idle_deadline");
  return result(false, "quiet");
}

export function isForegroundCognitionReady(world: World, eid: number, options: ForegroundReadinessOptions = {}): boolean {
  return getForegroundCognitionReadiness(world, eid, options).ready;
}

/** Explicit meaningful input (operator intent, heard speech, new failure, etc.).
 * Do not call for repeated ambient refreshes or an idle action's own receipt. */
export function wakeForegroundCognition(world: World, eid: number, wake: Wake = { cause: "explicit" }): void {
  assertSimulationTaskActive();
  if (wake.cause !== "decision_rejected") {
    rejectionRecovery.get(world)?.delete(eid);
    let rows = recoveryWakes.get(world); if (!rows) { rows = new Map(); recoveryWakes.set(world, rows); }
    rows.set(eid, (rows.get(eid) || 0) + 1);
  }
  const diagnostics = diagnosticState(world, eid, true);
  if (diagnostics) diagnostics.wake = { ...wake };
  idleByWorld.get(world)?.delete(eid);
  speechDeferrals.get(world)?.delete(eid);
}

/** Only an already heard, still audible execution can anchor listening. The
 * caller never receives a script suffix or uses a remote speaker as evidence. */
function currentHeardSpeech(world: World, eid: number) {
  const known = new Set(getSocialSpeechFragments(world, eid).filter(row => !row.own).map(row => row.executionId));
  const floor = readLocalSpeechOpportunity(world, eid);
  return floor.reason === "another_speaker" ? floor.speakerIds.flatMap(speaker => {
    const voice = getSpeakingActivity(world, speaker);
    return voice && known.has(voice.executionId) ? [{ executionId: voice.executionId, speaker,
      end: voice.expectedEndSimMs }] : [];
  }) : [];
}

/** Only execution identities of speech already heard in this actor's current
 * audible floor. No future words or planned duration appear in the action menu. */
export function getListeningActivities(world: World, eid: number): Array<{ executionId: string; speakerId: number }> {
  if (getCommittedSource(world).stopped || !entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid]) return [];
  return currentHeardSpeech(world, eid).map(row => ({ executionId: row.executionId, speakerId: row.speaker }));
}

/** Matching a trusted progress receipt does not consume it or acknowledge its
 * meaning. It remains in perception/memory for the next genuine decision. */
export function isContinuingListeningProgress(world: World, eid: number, notice: HeardSpeechNotice): boolean {
  const state = ownedIdleState(world, eid), listening = state?.listening;
  const receipt = readHeardSpeechProgress(world, eid, notice);
  return !!listening?.explicit && readSimulationTime(world) < listening.untilSimMs
    && receipt?.boundary === "progress" && listening.executionIds.includes(receipt.executionId)
    && currentHeardSpeech(world, eid).some(row => row.executionId === receipt.executionId);
}

/** Admission backpressure, not an executed wait or a cognitive decision. The
 * floor owner may speak for longer, but reconsider at most one second later;
 * fresh perceivable evidence and physical plans remain independently eligible. */
export function deferForegroundSpeech(world: World, eid: number, nextCheckAtSimMs: number): void {
  if (!entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid]
    || !hasComponent(world, eid, WorkingMemoryIdentity) || !WorkingMemoryIdentity.id[eid]
    || !Number.isFinite(nextCheckAtSimMs)) return;
  const now = readSimulationTime(world);
  if (nextCheckAtSimMs <= now) return;
  let rows = speechDeferrals.get(world); if (!rows) { rows = new Map(); speechDeferrals.set(world, rows); }
  rows.set(eid, { owner: WorkingMemoryIdentity.id[eid], startedAtSimMs: now, untilSimMs: Math.min(now + 1000, nextCheckAtSimMs) });
}

/** Call after execution AND plan advancement, never on an uncommitted choice.
 * Failed or pending physical work stays eligible for its normal event pipeline.
 * No action receipt, goal completion or physiological recovery is fabricated. */
export function recordCognitionOutcome(world: World, eid: number, action: Pick<AgentAction, "type" | "listeningTo" | "waitUntil" | "foregroundDecisionId">, outcome: {
  succeeded: boolean; pending: boolean; now?: number; waitAuthority?: ActorWaitOutcomeAuthority;
}): void {
  assertSimulationTaskActive();
  settleNextPurpose(world, eid, action, outcome);
  recordWaitExperience(world, eid, action, outcome);
  recordActorWait(world, eid, action, outcome);
  if (outcome.succeeded) rejectionRecovery.get(world)?.delete(eid);
  if (getCommittedSource(world).stopped) return;
  if (hasNextPurposeReview(world, eid)) { wakeForegroundCognition(world, eid, { cause: "execution_outcome" }); return; }
  if (!entityExists(world, eid) || !outcome.succeeded || outcome.pending || !QUIET_ACTIONS.has(action.type)) {
    wakeForegroundCognition(world, eid, { cause: "execution_outcome" });
    return;
  }
  let actors = idleByWorld.get(world);
  if (!actors) { actors = new Map(); idleByWorld.set(world, actors); }
  const previous = ownedIdleState(world, eid), now = outcome.now ?? readSimulationTime(world);
  const heard = action.type === "wait" ? currentHeardSpeech(world, eid).filter(row => !action.listeningTo || row.executionId === action.listeningTo) : [];
  const simNow = readSimulationTime(world);
  const listening: ListeningActivity | undefined = heard.length ? { executionIds: heard.map(row => row.executionId),
    untilSimMs: Math.min(simNow + (action.listeningTo ? 30_000 : 5_000), ...heard.map(row => row.end)), ...(action.listeningTo ? { explicit: true } : {}) } : undefined;
  const signature = cognitionSignature(world, eid, listening);
  const clock = outcome.now === undefined ? "simulation" : "explicit";
  const quietDecisions = previous?.signature === signature ? previous.quietDecisions + 1 : 1;
  // A first look may reveal something actionable; permit an early reconsideration.
  let delay = action.type === "observe" && quietDecisions === 1 ? 1_000
    : QUIET_DELAYS_MS[Math.min(quietDecisions - 1, QUIET_DELAYS_MS.length - 1)];
  if (listening) delay = Math.max(0, listening.untilSimMs - simNow);
  actors.set(eid, { signature, quietDecisions, nextCheckAtMs: now + delay, lastRecordedAtMs: now, clock,
    owner: hasComponent(world, eid, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[eid] || "" : "",
    source: getCommittedSource(world).sourceId, atSimMs: simNow, ...(listening ? { listening } : {}) });
  const diagnostics = diagnosticState(world, eid); if (diagnostics) diagnostics.wake = undefined;
}
