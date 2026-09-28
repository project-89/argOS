/**
 * Autonomous Goal Generation — Phase 3.1
 *
 * Existing background personal review handles newly appraised experiences and
 * unrepresented undertakings even while routine goals remain. Ordinary bounded
 * agenda review can also consider a coexisting intention based on:
 *   - Aspirations (long-term wants)
 *   - Needs (hunger, energy, social, comfort)
 *   - Recent memories and observations
 *   - Social context (who's nearby, impressions)
 *   - Available affordances in the current location
 *
 * The generated goal enters the existing goal/planning system.
 * When completed, the action sequence compiles into a skill via goal-learning.ts.
 *
 * This is the key piece that makes agents PROACTIVE instead of reactive.
 */

import { getSimulationTimeSnapshot, hasSimulationClock, readSimulationTime } from "../ecs/simulation-time";
import { getStampedSimulationTime, readStampedSimulationTime, stampSimulationTime } from "../ecs/temporal-age";
import { readGoalAttemptActivity } from "./goal-attempt";
import { readGoalInactivityBudget } from "./goal-inactivity-budget";
import { retireGoalPlans } from "./plan-state";
import { generateText, Output } from "ai";
import { hasComponent, getRelationTargets, entityExists } from "bitecs";
import { agentModel } from "../llm/config";
import { extractJSON } from "../llm/json-extract";
import type { World } from "../ecs/world";
import {
  Name, Agent, Goal, Needs, Perception, Description,
  LastAction, BehaviorPolicy, Plan, WorkingMemoryIdentity, GoalLifecycle,
} from "../ecs/components";
import { HasGoal, HasPerception, HasPlan } from "../ecs/relations";
import { getRoomForEntity } from "../ecs/location";
import { getCharacterContext, getLocalOpportunityContext, formatCharacterContext } from "./character-context";
import { formatOngoingActivity } from "./ongoing-activity";
import { getActiveGoals } from "./cognition-system";
import { prepareGeneratedIntention, commitPreparedIntention, formatGoalLifecycleContext, isStandingIntention,
  requestIntentionReconsideration, unsettledIntentionCount, MAX_SELF_DIRECTED_INTENTIONS } from "./goal-lifecycle";
import { getAvailableAffordances } from "../world/affordance-availability";
import { getAgentVisibleEntities, getAgentWorldCapabilities } from "./world-capabilities";
import { getAgentSensoryFingerprint } from "./sensory-system";
import { assertSimulationTaskActive, getSimulationTaskSignal } from "../runtime/task-scope";
import { chronicle } from "./simulation-chronicle";
import { formatWorkingMemoryContext, getWorkingMemoryRevision } from "./working-memory";
import { coordinationPlanningContext, prepareCoordinationReviews, isPreparedCoordinationCurrent, commitPreparedCoordinationReviews,
  formatCoordinationContext, getCoordinationRevision } from "./coordination-memory";
import { deferredGoalReviewTime, prepareInitialGoalDeferral } from "./goal-pursuit";
import { formatWorldTimeForContext, getGoalBiases, getClockState } from "../systems/world-clock";
import { getPersonalConcerns, personalConcernContext } from "./personal-concerns";
import { getPrivateCommunications } from "./communication-memory";
import { snapshotAffect } from "./affect-state";
import { getCommittedEvents } from "../runtime/committed-events";
import { emotionalLifeBasis, formatEmotionalLife } from "./emotional-life";
import { formatNarrativeMemory, getIdentityAnchors } from "./narrative-memory";
import { personalReviewResponseSchema, parsePersonalReviewResponse, personalReviewOutputError,
  personalReviewFinishReason, type PersonalReviewOutputDiagnostic } from "./personal-review-response";

// =============================================================================
// TYPES
// =============================================================================

export interface GeneratedGoal {
  description: string;
  motivation: string;
  priority: number;       // 1-10
  completionId?: string;
  supportsGoalId?: number;
  /** Personal-review proposal only: source-bound reconsideration, not an appointment. */
  followUp?: { undertakingId: string; reviewAtSimMs?: number; reason?: string };
  kind: "explore" | "social" | "craft" | "acquire" | "improve" | "survive" | "custom";
  firstAction?: {
    type: string;
    target?: string;
    content?: string;
  };
}

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Minimum ticks between goal generation attempts per agent */
const GOAL_COOLDOWN_TICKS = 5;
const GOAL_COOLDOWN_MS = 5_000;
const GOAL_FAILURE_BACKOFF_MS = 5_000;
/** Stable no-op reviews back off to 120s; meaningful new owned evidence or a
 * newly appraised concern can reopen earlier under the existing 5s cooldown. */
const NO_NEW_GOAL_REVIEW_MS = 30_000;
const NO_NEW_GOAL = Symbol("No new goal is needed");

/** Max active goals per agent before we stop generating new ones */
// Standing motivations and scheduled activities also occupy slots; leave room
// for the character's own new intentions.
const MAX_ACTIVE_GOALS = 4;

interface AutonomousWorldState {
  lastGoalTick: Map<number, number>;
  lastGoalSimMs: Map<number, number>;
  retryAfterMs: Map<number, number>;
  /** Transport/format retries only; never a simulated deadline or a handled receipt. */
  reviewOutputFailures: Map<number, { revision: string; count: number; untilWallMs: number }>;
  quietReview: Map<number, { until: number; revision: string; noGoalCount: number }>;
  lastOrdinaryReview: Map<number, { at: number; revision: string }>;
  reviewedConcerns: Map<number, string>;
  progress: Map<number, {
    agentEid: number;
    identity: string;
    value: number;
    activityAt: number;
    planSteps: Map<number, number>;
  }>;
  inFlight: Set<number>;
  tick?: number;
}
let worldStates = new WeakMap<World, AutonomousWorldState>();
function autonomousState(world: World): AutonomousWorldState {
  let state = worldStates.get(world);
  if (!state) { state = { lastGoalTick: new Map(), lastGoalSimMs: new Map(), retryAfterMs: new Map(), reviewOutputFailures: new Map(), quietReview: new Map(), lastOrdinaryReview: new Map(), reviewedConcerns: new Map(), progress: new Map(), inFlight: new Set() }; worldStates.set(world, state); }
  return state;
}
/** Legacy callers can advance without a world; native runtimes use their own clock. */
let currentTick = 0;

function canGenerateWithAI(world: World, agentEid: number): boolean {
  return world.meta.aiEnabled !== false && entityExists(world, agentEid) && hasComponent(world, agentEid, Agent) &&
    Agent.active[agentEid] === true && Boolean(String(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim());
}

/** One background opportunity per new admitted appraisal or unrepresented
 * undertaking, not per sensory refresh, progress report or model tick. Emotional
 * intensity ranks recall; it is not permission to consider a practical choice. */
function concernRevision(world: World, eid: number): string | undefined {
  const concerns = getPersonalConcerns(world, eid);
  const undertakings = coordinationPlanningContext(world, eid).filter(i => i.needsFollowUp)
    .map(i => [i.id, i.generation, i.goal]);
  return concerns.length || undertakings.length
    ? JSON.stringify([WorkingMemoryIdentity.id[eid], getCommittedEvents(world).sourceId, concerns, undertakings]) : undefined;
}
function pendingConcernReview(world: World, eid: number, state: AutonomousWorldState): string | undefined {
  const revision = concernRevision(world, eid);
  return revision && state.reviewedConcerns.get(eid) !== revision ? revision : undefined;
}
function characterReviewBasis(world: World, eid: number) {
  const { needs, ...character } = getCharacterContext(world, eid);
  // Fractional body drift does not invalidate a background interpretation.
  // Crossing a meaningful need boundary or changing owned evidence does.
  return { ...character, needs: needs && [needs.hunger >= 70, needs.energy <= 30, needs.social <= 25, needs.comfort <= 30] };
}
function personalReviewBasis(world: World, eid: number): string {
  return JSON.stringify({ owner: WorkingMemoryIdentity.id[eid], source: [getCommittedEvents(world).sourceId, getCommittedEvents(world).stopped],
    character: characterReviewBasis(world, eid),
    affect: snapshotAffect(world, eid), concerns: getPersonalConcerns(world, eid),
    undertakings: coordinationPlanningContext(world, eid),
    correspondence: getPrivateCommunications(world, eid),
    goals: getRelationTargets(world, eid, HasGoal).filter(g => hasComponent(world, g, Goal))
      .map(g => [g, WorkingMemoryIdentity.id[g], Goal.createdAt[g], Goal.description[g], Goal.status[g], Goal.priority[g], Goal.successJson[g],
        GoalLifecycle.reason[g], GoalLifecycle.deferredJson[g], GoalLifecycle.reviewRevision[g],
        hasComponent(world, g, GoalLifecycle) ? [GoalLifecycle.persistence[g], GoalLifecycle.source[g]] : null]) });
}
function personalReviewPrompt(world: World, eid: number) {
  return { system: `Something just happened to this character, or someone is waiting on them. Does it make them want to do something? Think like the character: what they now want to find out, fix, confront, hide, protect, confess or chase. Their secrets and fears count as much as their duties. An intention can sit beside existing ones; don't duplicate one they already hold. A standing motivation (like staying close to someone) is a longing, not yet a plan. Choose only for this character — another person's request is not an agreement. Propose an intention, not a script of actions or lines.

Return one complete JSON object:
- No distinct intention (including keeping your plans or declining): {"goal":null}. No other fields; this creates no follow-up or timer.
- A chosen intention: {"goal":"concise intention, <=300 characters","motivation":"why, <=400 characters","priority":6,"kind":"custom"}. Use custom for a practical inquiry or other exploratory purpose, and social for an interpersonal intention. Choose an integer priority from 1 to 10. No firstAction, physical completion condition, or parent goal.
- For a social intention following a listed undertaking needing follow-up, add "followUp":{"undertakingId":"exact listed ID"}. followUp is an object, never a string, and is available only with kind social.
- To reconsider that chosen intention later, put both reviewAtSimMs and reason INSIDE followUp: {"undertakingId":"exact listed ID","reviewAtSimMs":123000,"reason":"why this source supports reviewing then"}. The number shown is an example, not a suggested time. Use absolute elapsed simulation milliseconds grounded in original.atSimMs and the words, no more than one simulated day after the source. Omit both time and reason if uncertain or acting on it now.`,
    user: JSON.stringify({ character: getCharacterContext(world, eid), opportunities: getLocalOpportunityContext(world, eid),
      time: getSimulationTimeSnapshot(world), personalExperiences: personalConcernContext(world, eid), currentAffect: snapshotAffect(world, eid),
      undertakings: coordinationPlanningContext(world, eid).map(i => ({ ...i, sourceAgeSeconds:
        typeof i.original.atSimMs === "number" && Number.isFinite(i.original.atSimMs) && i.original.atSimMs >= 0 && i.original.atSimMs <= readSimulationTime(world)
          ? Math.floor((readSimulationTime(world) - i.original.atSimMs) / 1000) : null })),
      personallyReadOrSent: getPrivateCommunications(world, eid).slice(-6),
      existingIntentions: getRelationTargets(world, eid, HasGoal).filter(g => hasComponent(world, g, Goal))
        .map(g => ({ description: Goal.description[g], priority: Goal.priority[g], status: Goal.status[g], reason: GoalLifecycle.reason[g] || "",
          persistence: isStandingIntention(world, g) ? "standing" : "episodic",
          source: hasComponent(world, g, GoalLifecycle) ? GoalLifecycle.source[g] || null : null,
          reviewAtSimMs: deferredGoalReviewTime(world, eid, g) })) }) };
}

function goalContextRevision(world: World, agentEid: number): string {
  const salient = new Set(["attention", "danger", "speech", "directed_speech", "intent", "action_failed", "daemon_challenge"]);
  return JSON.stringify({
    character: characterReviewBasis(world, agentEid),
    workingMemory: getWorkingMemoryRevision(world, agentEid),
    coordination: getCoordinationRevision(world, agentEid),
    room: getRoomForEntity(world, agentEid),
    visible: getAgentVisibleEntities(world, agentEid).map(target => [target, Name.value[target],
      getAvailableAffordances(world, agentEid, target).map(a => a.name).sort()]),
    goals: getActiveGoals(world, agentEid).map(goal => [goal.eid, goal.description, goal.priority, Goal.successJson[goal.eid]]),
    attention: getRelationTargets(world, agentEid, HasPerception).filter(eid => hasComponent(world, eid, Perception) && salient.has(Perception.type[eid]))
      .map(eid => [eid, Perception.timestamp[eid], Perception.content[eid]]),
  });
}

/** A deliberate no-op is successful background work, not a provider failure.
 * Clocks, duplicate sensory refreshes and fractional need drift are not new
 * reasons to revisit it. Actual local/owned context can reopen deliberation. */
function quietGoalContextRevision(world: World, agentEid: number): string {
  const salient = new Set(["attention", "danger", "speech", "directed_speech", "intent", "action_failed", "daemon_challenge", "daemon_whisper"]);
  const attention = getRelationTargets(world, agentEid, HasPerception)
    .filter(eid => hasComponent(world, eid, Perception) && salient.has(Perception.type[eid]))
    .map(eid => JSON.stringify([Perception.type[eid], Perception.source[eid], Perception.content[eid]]));
  return JSON.stringify({
    character: characterReviewBasis(world, agentEid),
    workingMemory: getWorkingMemoryRevision(world, agentEid),
    coordination: getCoordinationRevision(world, agentEid),
    senses: getAgentSensoryFingerprint(world, agentEid),
    worldContext: getAgentWorldCapabilities(world, agentEid)?.context() || "",
    goals: getRelationTargets(world, agentEid, HasGoal).filter(g => hasComponent(world, g, Goal))
      .map(g => [g, Goal.description[g], Goal.status[g], Goal.priority[g], Goal.successJson[g]]),
    attention: [...new Set(attention)].sort(),
    needs: hasComponent(world, agentEid, Needs)
      ? [Needs.hunger[agentEid] >= 70, Needs.energy[agentEid] <= 30, Needs.social[agentEid] <= 25, Needs.comfort[agentEid] <= 30] : [],
  });
}

function waitingForQuietReview(world: World, agentEid: number, state: AutonomousWorldState): boolean {
  const quiet = state.quietReview.get(agentEid);
  return !!quiet && readSimulationTime(world) < quiet.until && quiet.revision === quietGoalContextRevision(world, agentEid);
}

/** Thinking about another concern need not wait for motor work to end. While
 * an agenda is occupied, ordinary review is bounded; newly appraised concerns
 * retain their existing faster source-bound personal review lane. */
function occupiedAgendaCooldown(world: World, eid: number, state: AutonomousWorldState): boolean {
  const previous = state.lastOrdinaryReview.get(eid);
  return !!previous && getActiveGoals(world, eid).length > 0
    && readSimulationTime(world) - previous.at < NO_NEW_GOAL_REVIEW_MS
    && previous.revision === quietGoalContextRevision(world, eid);
}

function goalCooldownActive(world: World, eid: number, state: AutonomousWorldState): boolean {
  return hasSimulationClock(world)
    ? readSimulationTime(world) - (state.lastGoalSimMs.get(eid) ?? -Infinity) < GOAL_COOLDOWN_MS
    : (state.tick ?? currentTick) - (state.lastGoalTick.get(eid) ?? -Infinity) < GOAL_COOLDOWN_TICKS;
}
function waitingForReviewOutputRetry(state: AutonomousWorldState, eid: number, revision: string | undefined): boolean {
  const failure = state.reviewOutputFailures.get(eid);
  return !!revision && failure?.revision === revision && Date.now() < failure.untilWallMs;
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * Attempt to generate an autonomous goal for an agent.
 * The existing subconscious lane schedules this using shouldGenerateGoal.
 *
 * Returns a GeneratedGoal if successful, null if skipped or failed.
 */
export async function generateAutonomousGoal(
  world: World,
  agentEid: number,
  options: { generateText?: typeof generateText } = {},
): Promise<GeneratedGoal | null> {
  if (!canGenerateWithAI(world, agentEid)) return null;
  assertSimulationTaskActive();
  const state = autonomousState(world);
  const personalReview = pendingConcernReview(world, agentEid, state);
  // Check cooldown
  const tick = state.tick ?? currentTick;
  if (state.inFlight.has(agentEid) || goalCooldownActive(world, agentEid, state) || Date.now() < (state.retryAfterMs.get(agentEid) || 0)
    || waitingForReviewOutputRetry(state, agentEid, personalReview)
    || !personalReview && (waitingForQuietReview(world, agentEid, state) || occupiedAgendaCooldown(world, agentEid, state))) return null;

  // Check active goal count
  const activeGoals = getActiveGoals(world, agentEid);
  if (activeGoals.length >= MAX_ACTIVE_GOALS + (personalReview ? 2 : 0)) return null;

  state.lastGoalTick.set(agentEid, tick);
  state.lastGoalSimMs.set(agentEid, readSimulationTime(world));

  const prompt = personalReview ? personalReviewPrompt(world, agentEid) : buildGoalGenerationPrompt(world, agentEid, activeGoals);
  if (!prompt) { state.retryAfterMs.set(agentEid, Date.now() + GOAL_FAILURE_BACKOFF_MS); return null; }
  prompt.user += `\n${formatOngoingActivity(world, agentEid)}`;
  const narrative = world.meta.narrativeMind === true, innerBasis = emotionalLifeBasis(world, agentEid);
  const identityBasis = JSON.stringify(getIdentityAnchors(world, agentEid));
  if (narrative) {
    prompt.system += "\nFeelings are fuel: turn them into something the character would actually go and do (\"get Leon alone and ask him straight\", not \"process my anxiety\"). Return {\"goal\":null} only if nothing new pulls at them.";
    prompt.user += `\n${formatEmotionalLife(world, agentEid)}\n${formatNarrativeMemory(world, agentEid)}`;
  }
  const revision = personalReview ? personalReviewBasis(world, agentEid) : goalContextRevision(world, agentEid);
  const quietRevision = quietGoalContextRevision(world, agentEid);
  state.inFlight.add(agentEid);
  let admitted = false;
  let deliberateNoGoal = false;
  let reviewOutcome: "admitted" | "no_goal" | "discarded" | "invalid_json" | "invalid_schema" | "invalid_proposal" | "cancelled" | "timeout" | "provider_or_commit_error" = "provider_or_commit_error";
  let outputMetadata: PersonalReviewOutputDiagnostic = {};
  // Chronicle is process-global. Preserve the request's originating lifetime,
  // never attribute a late outcome to a replacement actor or restarted stream.
  const reviewOrigin = personalReview ? { actorEid: agentEid, actorKey: WorkingMemoryIdentity.id[agentEid],
    sourceId: getCommittedEvents(world).sourceId, requestedAtSimMs: readSimulationTime(world) } : undefined;
  const parentSignal = getSimulationTaskSignal();
  const deadline = AbortSignal.timeout(10_000);

  try {
    const signal = parentSignal ? AbortSignal.any([parentSignal, deadline]) : deadline;
    const result = await (options.generateText || generateText)({
      model: agentModel,
      abortSignal: signal,
      maxOutputTokens: 900,
      maxRetries: 0,
      ...(personalReview ? { output: Output.object({ schema: personalReviewResponseSchema }) } : {}),
      providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
      temperature: 0.5, // Between creative (1.0) and deterministic (0.3)
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    });
    signal.throwIfAborted();
    assertSimulationTaskActive();
    if (!canGenerateWithAI(world, agentEid) || getCommittedEvents(world).stopped
      || JSON.stringify(getIdentityAnchors(world, agentEid)) !== identityBasis
      || (world.meta.narrativeMind === true) !== narrative || narrative && emotionalLifeBasis(world, agentEid) !== innerBasis
      || (personalReview ? personalReviewBasis(world, agentEid) : goalContextRevision(world, agentEid)) !== revision) { reviewOutcome = "discarded"; return null; }

    let parsed: GeneratedGoal | typeof NO_NEW_GOAL | null;
    if (personalReview) {
      const response = parsePersonalReviewResponse(result.text);
      outputMetadata = { ...response.metadata, finishReason: personalReviewFinishReason(result.finishReason) };
      if (!response.success) { reviewOutcome = response.reason; return null; }
      const value = response.value;
      parsed = value.goal === null ? NO_NEW_GOAL : { description: value.goal, motivation: value.motivation,
        priority: value.priority, kind: value.kind, ...(value.kind === "social" && value.followUp ? { followUp: value.followUp } : {}) };
    } else parsed = parseGoalResponse(result.text);
    reviewOutcome = "invalid_proposal";
    if (!parsed) return null;
    if (parsed === NO_NEW_GOAL) { deliberateNoGoal = true; reviewOutcome = "no_goal"; return null; }
    if (personalReview && (!["social", "custom"].includes(parsed.kind) || parsed.completionId !== undefined || parsed.firstAction !== undefined || parsed.supportsGoalId !== undefined)) return null;
    const followUp = parsed.followUp;
    if (followUp && (!personalReview || parsed.kind !== "social")) return null;
    const undertaking = followUp && coordinationPlanningContext(world, agentEid).find(i => i.id === followUp.undertakingId && i.needsFollowUp);
    const sourceAt = undertaking?.original.atSimMs;
    if (followUp && (!undertaking || followUp.reviewAtSimMs !== undefined && (typeof sourceAt !== "number" || !Number.isFinite(sourceAt) || sourceAt < 0
      || sourceAt > readSimulationTime(world) || followUp.reviewAtSimMs < sourceAt
      || followUp.reviewAtSimMs > sourceAt + 86_400_000))) return null;

    // Preflight all effects; no await or package callback between these commits.
    const intention = prepareGeneratedIntention(world, agentEid, parsed, "autonomous");
    if (!intention) return null;
    const link = followUp && prepareCoordinationReviews(world, agentEid,
      [{ kind: "link", id: followUp.undertakingId, goalId: "new", goalRelation: "supports" }], { newIntention: intention });
    if (followUp && (!link || !isPreparedCoordinationCurrent(world, agentEid, link))) return null;
    const defer = followUp?.reviewAtSimMs !== undefined && followUp.reviewAtSimMs > readSimulationTime(world)
      ? prepareInitialGoalDeferral(world, agentEid, intention, { untilSimMs: followUp.reviewAtSimMs, reason: followUp.reason! }) : undefined;
    if (followUp?.reviewAtSimMs !== undefined && followUp.reviewAtSimMs > readSimulationTime(world) && !defer?.current()) return null;
    const goalEid = commitPreparedIntention(world, agentEid, intention);
    if (goalEid === null) return null;
    if (link && !commitPreparedCoordinationReviews(world, agentEid, link)) throw new Error("Preflighted undertaking link failed");
    if (defer && !defer.commit(goalEid)) throw new Error("Preflighted initial goal deferral failed");
    admitted = true;
    reviewOutcome = "admitted";

    const agentName = String(Name.value[agentEid] || agentEid);
    console.log(`[AutonomousGoal] ${agentName} sets goal: "${parsed.description}" (${parsed.kind}, priority ${parsed.priority})`);
    console.log(`  Motivation: ${parsed.motivation}`);

    chronicle.record("autonomous_goal", {
      agent: agentName,
      goal: parsed.description,
      kind: parsed.kind,
      priority: parsed.priority,
      motivation: parsed.motivation,
      activeGoalCount: activeGoals.length + 1,
    });

    return parsed;
  } catch (err) {
    if (personalReview) {
      const invalidOutput = personalReviewOutputError(err);
      if (parentSignal?.aborted) reviewOutcome = "cancelled";
      else if (deadline.aborted) reviewOutcome = "timeout";
      else if (invalidOutput) { reviewOutcome = invalidOutput.reason; outputMetadata = invalidOutput.metadata; }
      else reviewOutcome = "provider_or_commit_error";
      // Raw SDK errors may include private text, credentials or provider traces.
      console.warn(`[AutonomousGoal] Personal review failed for agent ${agentEid}: ${reviewOutcome}`);
    } else console.warn(`[AutonomousGoal] Failed for agent ${agentEid}:`, (err as Error).message);
    return null;
  } finally {
    state.inFlight.delete(agentEid);
    let formatFailures = 0, retryDelayMs = admitted || deliberateNoGoal ? 0 : GOAL_FAILURE_BACKOFF_MS;
    if (personalReview) {
      if (admitted || deliberateNoGoal) state.reviewOutputFailures.delete(agentEid);
      else if ((reviewOutcome === "invalid_json" || reviewOutcome === "invalid_schema")
        && concernRevision(world, agentEid) === personalReview && !getCommittedEvents(world).stopped) {
        const previous = state.reviewOutputFailures.get(agentEid);
        formatFailures = Math.min(32, (previous?.revision === personalReview ? previous.count : 0) + 1);
        retryDelayMs = Math.min(30_000, GOAL_FAILURE_BACKOFF_MS * 2 ** Math.min(formatFailures - 1, 3));
        state.reviewOutputFailures.set(agentEid, { revision: personalReview, count: formatFailures, untilWallMs: Date.now() + retryDelayMs });
      }
    }
    if (admitted || deliberateNoGoal) state.retryAfterMs.delete(agentEid);
    else state.retryAfterMs.set(agentEid, Date.now() + GOAL_FAILURE_BACKOFF_MS);
    // Our own link changes which undertakings are unrepresented. Acknowledge
    // that result too, or the unchanged appraisal would immediately run again.
    // One bounded review considers the whole supplied batch, not one per tick.
    if (personalReview && (admitted || deliberateNoGoal)) state.reviewedConcerns.set(agentEid, concernRevision(world, agentEid) ?? personalReview);
    if (!personalReview && (admitted || deliberateNoGoal)) state.lastOrdinaryReview.set(agentEid,
      { at: readSimulationTime(world), revision: admitted ? quietGoalContextRevision(world, agentEid) : quietRevision });
    if (deliberateNoGoal) {
      const previous = state.quietReview.get(agentEid);
      const noGoalCount = Math.min(3, (previous?.revision === quietRevision ? previous.noGoalCount : 0) + 1);
      state.quietReview.set(agentEid, { until: readSimulationTime(world) + NO_NEW_GOAL_REVIEW_MS * 2 ** (noGoalCount - 1),
        revision: quietRevision, noGoalCount });
    } else state.quietReview.delete(agentEid);
    if (personalReview) {
      try { chronicle.record("personal_review_result", { ...reviewOrigin,
        atSimMs: getCommittedEvents(world).sourceId === reviewOrigin?.sourceId ? readSimulationTime(world) : null,
        outcome: reviewOutcome, ...outputMetadata, formatFailures, retryDelayMs }); } catch { /* Diagnostics cannot change admission. */ }
    }
  }
}

// =============================================================================
// PROMPT BUILDING
// =============================================================================

interface GoalPrompt {
  system: string;
  user: string;
}

function buildGoalGenerationPrompt(
  world: World,
  agentEid: number,
  activeGoals: Array<{ eid: number; description: string; priority: number }>,
): GoalPrompt | null {
  const name = String(Name.value[agentEid] || "").trim();
  if (!name) return null;

  // Last action
  const lastType = LastAction.type[agentEid] || "";
  const lastTarget = LastAction.target[agentEid] || "";
  const lastSuccess = LastAction.success[agentEid];
  const lastActionStr = lastType
    ? `${lastType}${lastTarget ? " → " + lastTarget : ""} (${lastSuccess ? "succeeded" : "failed"})`
    : "none";

  const system = `You are ${name}'s background goal-forming process.

What does this character want to go and do next? Draw on who they are — their desires, fears, secrets, relationships and unfinished business — as well as their needs and what's around them. Good intentions create movement and contact: seek someone out, find something out, protect or hide something, settle a score, make amends, chase a hunch. A new intention can coexist with current work. The optional firstAction is a suggestion for later planning.`;

  const activeGoalsSection = activeGoals.length > 0
    ? `CURRENT GOALS (standing motivations guide choices; episodic intentions are already chosen work):\n${activeGoals.map(g => `- [ID ${g.eid}, P${g.priority}, ${isStandingIntention(world, g.eid) ? "standing motivation" : "episodic intention"}] ${g.description}`).join("\n")}`
    : "CURRENT GOALS: None.";

  // Time of day and world events
  const timeContext = formatWorldTimeForContext(world);
  const biases = getGoalBiases(world);
  const biasHints = Object.entries(biases)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, v]) => `${kind} (${v > 1 ? "strongly" : "slightly"} favored)`)
    .join(", ");

  const user = `${formatWorkingMemoryContext(world, agentEid)}
${formatCoordinationContext(world, agentEid)}
${formatCharacterContext(world, agentEid)}

${activeGoalsSection}
${formatGoalLifecycleContext(world, agentEid)}
RECENT GOAL OUTCOMES:
${getRelationTargets(world, agentEid, HasGoal).filter(g => hasComponent(world, g, Goal) && Goal.status[g] !== "active").slice(-6).map(g => `- ${Goal.status[g]}: ${Goal.description[g]}`).join("\n") || "None."}
${timeContext}

LOCAL OPPORTUNITIES:
${JSON.stringify(getLocalOpportunityContext(world, agentEid))}
LAST ACTION: ${lastActionStr}

${biasHints ? `TIME-OF-DAY TENDENCIES: ${biasHints}\n` : ""}
What does ${name} want to do next? Weigh urgency against what they're already doing and don't duplicate an active goal. Prefer intentions with a person, place or object at their heart.

For a listed completionId, use that outcome's exact description as the goal. Omit completionId for broader intentions. supportsGoalId may link a subgoal to one of your active goals. If nothing new pulls at them, return {"goal":null}.
Respond with JSON only (completionId and supportsGoalId are optional):
{
  "goal": "Short description of the goal (e.g., 'find food at the market')",
  "motivation": "Why this goal matters right now (1 sentence)",
  "priority": <1-10, where 10 is life-or-death>,
  "kind": "<explore|social|craft|acquire|improve|survive|custom>",
  "completionId": "listed criterion ID, or omit",
  "supportsGoalId": <active parent goal ID, or omit>,
  "firstAction": {
    "type": "<move|speak|interact|observe>",
    "target": "optional target name",
    "content": "optional content"
  }
}`;

  return { system, user };
}

// =============================================================================
// RESPONSE PARSING
// =============================================================================

function parseGoalResponse(text: string): GeneratedGoal | typeof NO_NEW_GOAL | null {
  try {
    const raw = extractJSON(text);
    if (!raw) return null;
    const json = typeof raw === "string" ? JSON.parse(raw) : raw;
    const followUp = json?.followUp;
    if (followUp !== undefined && (!followUp || typeof followUp !== "object" || Array.isArray(followUp)
      || Object.keys(followUp).some(k => !["undertakingId", "reviewAtSimMs", "reason"].includes(k))
      || typeof followUp.undertakingId !== "string" || !followUp.undertakingId.trim() || followUp.undertakingId.length > 300
      || (followUp.reviewAtSimMs === undefined ? followUp.reason !== undefined
        : !Number.isSafeInteger(followUp.reviewAtSimMs) || followUp.reviewAtSimMs < 0
          || typeof followUp.reason !== "string" || !followUp.reason.trim() || followUp.reason.length > 400)
      || json.goal === null)) return null;
    if (json && typeof json === "object" && !Array.isArray(json) && json.goal === null && json.description === undefined) return NO_NEW_GOAL;

    const goal = String(json.goal || json.description || "").trim();
    if (!goal || goal.length < 3) return null;

    const motivation = String(json.motivation || json.reason || json.why || "").trim();
    const priority = Math.min(10, Math.max(1, Number(json.priority) || 5));
    const kind = validateKind(String(json.kind || json.type || "custom"));

    let firstAction: GeneratedGoal["firstAction"] | undefined;
    if (json.firstAction && typeof json.firstAction === "object") {
      const fa = json.firstAction;
      const actionType = String(fa.type || fa.actionType || fa.action_type || "").trim();
      if (actionType) {
        firstAction = {
          type: actionType,
          target: fa.target ? String(fa.target).trim() : undefined,
          content: fa.content ? String(fa.content).trim() : undefined,
        };
      }
    }

    return {
      description: goal,
      motivation,
      priority,
      ...(typeof json.completionId === "string" ? { completionId: json.completionId } : {}),
      ...(Number.isSafeInteger(json.supportsGoalId) ? { supportsGoalId: json.supportsGoalId } : {}),
      ...(followUp === undefined ? {} : { followUp: { ...followUp } }),
      kind,
      firstAction,
    };
  } catch {
    return null;
  }
}

function validateKind(kind: string): GeneratedGoal["kind"] {
  const valid: GeneratedGoal["kind"][] = ["explore", "social", "craft", "acquire", "improve", "survive", "custom"];
  const normalized = kind.toLowerCase().trim();
  return valid.includes(normalized as any) ? (normalized as GeneratedGoal["kind"]) : "custom";
}

// =============================================================================
// DETERMINISTIC ASPIRATION GENERATION
// =============================================================================

/**
 * Generate aspirations for an agent based on their role/identity via LLM.
 * Called at agent creation or simulation start.
 */
export async function generateAspirations(
  world: World,
  agentEid: number,
  options: { generateText?: typeof generateText } = {},
): Promise<string[]> {
  if (!entityExists(world, agentEid) || !hasComponent(world, agentEid, Agent) || !Agent.active[agentEid]) return [];
  const name = String(Name.value[agentEid] || "").trim();
  const role = String(Agent.role[agentEid] || "").trim();
  const desc = String(Description.value[agentEid] || "").trim();
  if (!name || !role) return [];
  if (!canGenerateWithAI(world, agentEid)) return generateDeterministicAspirations(role);
  const revision = JSON.stringify([name, role, desc, Agent.systemPrompt[agentEid]]);

  try {
    assertSimulationTaskActive();
    const deadline = AbortSignal.timeout(10_000);
    const parent = getSimulationTaskSignal();
    const signal = parent ? AbortSignal.any([parent, deadline]) : deadline;
    const result = await (options.generateText || generateText)({
      model: agentModel,
      abortSignal: signal,
      maxOutputTokens: 900,
      maxRetries: 0,
      providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: `You generate character aspirations for simulation agents. Aspirations are long-term dreams and goals that define what a character wants from life.`,
        },
        {
          role: "user",
          content: `Generate 3-5 aspirations for this character:

Name: ${name}
Role: ${role}
Description: ${desc}
Character background: ${String(Agent.systemPrompt[agentEid] || "").trim()}

Suggest distinct long-term interests that fit this character's established identity. Interests may extend beyond their occupation.

Respond with JSON only:
{ "aspirations": ["aspiration 1", "aspiration 2", "aspiration 3"] }`,
        },
      ],
    });
    signal.throwIfAborted();
    assertSimulationTaskActive();
    if (!canGenerateWithAI(world, agentEid) || JSON.stringify([Name.value[agentEid], Agent.role[agentEid], Description.value[agentEid], Agent.systemPrompt[agentEid]]) !== revision) return [];

    const raw = extractJSON(result.text);
    if (!raw) return [];
    const json = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!json?.aspirations || !Array.isArray(json.aspirations)) return [];

    const aspirations = json.aspirations
      .map((a: any) => String(a).trim())
      .filter((a: string) => a.length > 3)
      .slice(0, 5);

    return aspirations;
  } catch (err) {
    console.warn(`[AutonomousGoal] Failed to generate aspirations for ${name}:`, (err as Error).message);
    return [];
  }
}

/**
 * Generate deterministic aspirations from role keywords (no LLM needed).
 * Used for testing and as a fallback.
 */
export function generateDeterministicAspirations(role: string): string[] {
  const r = role.toLowerCase();

  const roleAspirations: Record<string, string[]> = {
    blacksmith: [
      "Master the art of forging legendary weapons",
      "Build a larger, better-equipped forge",
      "Earn the respect of the village through my craft",
    ],
    innkeeper: [
      "Make my inn the most popular gathering place",
      "Collect stories from every traveler who passes through",
      "Save enough coin to expand the inn",
    ],
    farmer: [
      "Grow the finest crops in the region",
      "Own a larger plot of fertile land",
      "Provide for my family through good harvests",
    ],
    merchant: [
      "Build a profitable trade network",
      "Acquire rare and valuable goods",
      "Become the wealthiest trader in the village",
    ],
    monk: [
      "Achieve inner peace through meditation and study",
      "Help others find wisdom and guidance",
      "Preserve and copy important texts",
    ],
    guard: [
      "Keep the village safe from all threats",
      "Become captain of the guard",
      "Master combat techniques",
    ],
    scholar: [
      "Uncover ancient knowledge",
      "Write a comprehensive history of the region",
      "Teach the next generation",
    ],
    healer: [
      "Learn to cure every ailment known",
      "Gather rare medicinal herbs",
      "Establish a proper healing house",
    ],
  };

  // Try exact match first, then partial
  if (roleAspirations[r]) return roleAspirations[r];

  for (const [key, aspirations] of Object.entries(roleAspirations)) {
    if (r.includes(key) || key.includes(r)) return aspirations;
  }

  // Generic fallback
  return [
    "Find purpose and meaning in daily work",
    "Build lasting friendships with others",
    "Improve skills and knowledge over time",
  ];
}

// =============================================================================
// TICK MANAGEMENT
// =============================================================================

/** Call once per simulation tick to advance the cooldown counter */
export function advanceGoalTick(world?: World): void {
  if (world) {
    const state = autonomousState(world);
    state.tick = (state.tick ?? currentTick) + 1;
  } else currentTick++;
}

/** Bounded background agenda review can coexist with finite work. Review does
 * not grant execution or replace an activity; the foreground still owns choice. */
export function shouldGenerateGoal(world: World, agentEid: number): boolean {
  if (!entityExists(world, agentEid) || !hasComponent(world, agentEid, Agent) || !Agent.active[agentEid]) return false;
  const activeGoals = getActiveGoals(world, agentEid);
  const state = autonomousState(world), personalReview = pendingConcernReview(world, agentEid, state);
  if (unsettledIntentionCount(world, agentEid) >= MAX_SELF_DIRECTED_INTENTIONS) return false;
  if (activeGoals.length >= MAX_ACTIVE_GOALS + (personalReview ? 2 : 0)) return false;

  if (state.inFlight.has(agentEid) || goalCooldownActive(world, agentEid, state) || Date.now() < (state.retryAfterMs.get(agentEid) || 0)
    || waitingForReviewOutputRetry(state, agentEid, personalReview)
    || !personalReview && (waitingForQuietReview(world, agentEid, state) || occupiedAgendaCooldown(world, agentEid, state))) return false;

  return true;
}

/** High-priority, bounded work within the subconscious lane, not foreground. */
export function hasPendingPersonalGoalReview(world: World, eid: number): boolean {
  return canGenerateWithAI(world, eid) && !getCommittedEvents(world).stopped
    && !!pendingConcernReview(world, eid, autonomousState(world)) && shouldGenerateGoal(world, eid);
}

/**
 * Reconsider self-chosen intentions after inactivity; expire authored budgets
 * and legacy objectives under their existing policy, not simply because old.
 * Call periodically from the simulation loop.
 * This keeps agents from getting stuck on impossible goals forever.
 *
 * @param maxAgeMs Default time without goal/plan progress (2 minutes). A goal
 * may declare its own finite, positive lived-time budget; its absolute deadline
 * and explicit actor deferral/withdrawal remain independent authorities.
 */
export function expireStaleGoals(world: World, agentEid: number, maxAgeMs: number = 2 * 60 * 1000): number {
  const goalEids = getRelationTargets(world as any, agentEid, HasGoal as any)
    .filter((gid: number) => hasComponent(world as any, gid, Goal as any))
    .filter((gid: number) => String(Goal.status[gid] || "") === "active");

  let expired = 0;
  const now = readSimulationTime(world);
  const state = autonomousState(world);
  const active = new Set(goalEids);
  for (const [goalEid, tracked] of state.progress) {
    if (tracked.agentEid === agentEid && !active.has(goalEid)) state.progress.delete(goalEid);
  }
  for (const gid of goalEids) {
    // Standing desires can compete quietly between relevant experiences; lack
    // of task progress is not failure. Explicit defer/release still applies.
    if (isStandingIntention(world, gid)) {
      state.progress.delete(gid);
      continue;
    }
    const createdAt = Goal.createdAt[gid] || 0;
    const value = Number.isFinite(Goal.progress[gid]) ? Goal.progress[gid] : 0;
    const identity = JSON.stringify([createdAt, Goal.description[gid], Goal.successJson[gid]]);
    const plans = getRelationTargets(world, agentEid, HasPlan)
      .filter(eid => hasComponent(world, eid, Plan) && Plan.goalEid[eid] === gid && ["active", "completed"].includes(Plan.status[eid]))
      .map(eid => {
        const cursor = Math.max(0, Number(Plan.currentStep[eid] || 0)) + (Plan.status[eid] === "completed" ? 1 : 0);
        let step = cursor;
        try {
          const steps = JSON.parse(Plan.steps[eid] || "[]");
          if (Array.isArray(steps)) step -= steps.slice(0, cursor).filter(candidate => candidate?.resolution).length;
        } catch { /* Old cursor evidence remains usable without inventing new steps. */ }
        return { eid, step, at: Plan.lastUpdated[eid]
          ? Math.min(now, readStampedSimulationTime(world, eid, "Plan.lastUpdated", Plan.lastUpdated[eid])) : undefined };
      })
      .filter(plan => plan.step > 0);
    let tracked = state.progress.get(gid);
    if (!tracked || tracked.identity !== identity) {
      const proofAt = plans.flatMap(plan => plan.at === undefined ? [] : [plan.at]);
      // Restored progress without a timestamp receives one bounded observation
      // window. Timestamped old progress does not receive an unearned renewal.
      const birthSim = createdAt ? readStampedSimulationTime(world, gid, "Goal.createdAt", createdAt) : now;
      const storedActivity = getStampedSimulationTime(world, gid, "Goal.activity", createdAt);
      const activityAt = proofAt.length ? Math.max(storedActivity ?? birthSim, birthSim, ...proofAt)
        : storedActivity ?? (value > 0 ? now : birthSim);
      tracked = { agentEid, identity, value, activityAt, planSteps: new Map(plans.map(plan => [plan.eid, plan.step])) };
      state.progress.set(gid, tracked);
    } else {
      if (value > tracked.value) tracked.activityAt = now;
      tracked.value = value;
      for (const plan of plans) {
        if (plan.step > (tracked.planSteps.get(plan.eid) || 0)) tracked.activityAt = Math.max(tracked.activityAt, plan.at ?? now);
        tracked.planSteps.set(plan.eid, plan.step);
      }
    }
    const attemptedAt = readGoalAttemptActivity(world, agentEid, gid);
    if (attemptedAt !== undefined) tracked.activityAt = Math.max(tracked.activityAt, attemptedAt);
    stampSimulationTime(world, gid, "Goal.activity", createdAt, tracked.activityAt);
    const inactivityBudget = readGoalInactivityBudget(world, gid, maxAgeMs);
    // Deliberately waiting is not inactivity in an executable intention. A
    // native resumption grants a bounded opportunity, not a fabricated action
    // receipt or progress update. Reads/restore cannot refresh this mark.
    const resumed = hasComponent(world, gid, GoalLifecycle)
      ? getStampedSimulationTime(world, gid, "GoalLifecycle.resumedAt", GoalLifecycle.resumedAt[gid]) : undefined;
    const reviewOpportunity = resumed !== undefined && resumed <= now ? resumed : -Infinity;
    if (now - Math.max(tracked.activityAt, reviewOpportunity) > inactivityBudget) {
      if (requestIntentionReconsideration(world, agentEid, gid,
        "No recent attributed activity on this intention. Reconsider whether to retain it, defer it or release it; inactivity is not abandonment.")) {
        state.progress.delete(gid); continue;
      }
      Goal.status[gid] = "expired";
      // Ending the intention retires runnable drafts, not a pending physical
      // callback. Its eventual receipt cannot advance an expired goal's plan.
      retireGoalPlans(world, gid, getRelationTargets(world, agentEid, HasPlan));
      state.progress.delete(gid);
      expired++;
    }
  }
  return expired;
}

// =============================================================================
// RESET (for testing)
// =============================================================================

export function resetAutonomousGoals(): void {
  worldStates = new WeakMap();
  currentTick = 0;
}
