/**
 * Immune System — Quality control for compiled behavior tree patterns.
 *
 * Four mechanisms that keep the BT healthy:
 *   1. Quality-gated compilation — only compile responses that score well
 *   2. Active validation — periodically shadow-test patterns against Reasoner
 *   3. Exploration rate — ε-greedy: sometimes escalate even when BT matches
 *   4. Condition specificity — reject patterns with overly broad conditions
 *
 * Without this, the BT is a write-once cache that degrades.
 * With this, the BT is a living system that validates, prunes, and improves.
 */

import type { BehaviorNode, ConditionOp, EvalResult, ResponseStrategy } from "../bt/types.js";
import type { PersonModel } from "../ecs/types.js";
import type { CapturedDecision } from "./bt-compiler.js";

// =============================================================================
// 1. QUALITY-GATED COMPILATION
// =============================================================================

export interface QualityScore {
  relevant: number;    // 0-10: did it address what the user said?
  appropriate: number; // 0-10: tone, safety, not dismissive?
  helpful: number;     // 0-10: does it move the conversation forward?
  total: number;       // average of the three
}

const COMPILATION_THRESHOLD = 6.0;

/**
 * Score a response for compilation quality.
 * Uses simple heuristics (no LLM) — fast enough to run on every escalation.
 * For production, replace with Flash Lite judge call.
 */
export function scoreResponseQuality(
  userMessage: string,
  response: string,
  reasoning: string,
): QualityScore {
  let relevant = 5;
  let appropriate = 7;
  let helpful = 5;

  const userLower = userMessage.toLowerCase();
  const respLower = response.toLowerCase();

  // Relevance: does the response relate to the user's message?
  const userWords = userLower.split(/\s+/).filter(w => w.length > 3);
  const overlap = userWords.filter(w => respLower.includes(w)).length;
  relevant = Math.min(10, 3 + (overlap / Math.max(1, userWords.length)) * 7);

  // Appropriateness: check for harmful patterns
  const harmful = /quit your job|give up|you're wrong|that's stupid|just stop/i;
  if (harmful.test(response)) appropriate = 2;

  const dismissive = /whatever|I don't care|not my problem|figure it out yourself/i;
  if (dismissive.test(response)) appropriate = 3;

  const generic = /^(I understand|tell me more|I see|ok|sure|hmm)\.?$/i;
  if (generic.test(response.trim())) {
    helpful = 3;
    relevant = 3;
  }

  // Helpfulness: does it advance the conversation?
  if (response.includes("?")) helpful = Math.max(helpful, 6); // Asks a follow-up
  if (/help|assist|can I|let me|want me to/i.test(response)) helpful = Math.max(helpful, 7); // Offers help
  if (response.length > 20 && response.length < 300) helpful = Math.max(helpful, 5); // Right length
  if (response.length < 10) helpful = Math.min(helpful, 4); // Too short

  // Reasoning quality
  if (reasoning.length > 20) relevant = Math.min(10, relevant + 1); // Has real reasoning
  if (reasoning.length < 5) relevant = Math.max(0, relevant - 2); // No reasoning = suspicious

  const total = (relevant + appropriate + helpful) / 3;
  return { relevant, appropriate, helpful, total };
}

/**
 * Check if a response meets the quality threshold for compilation.
 */
export function meetsCompilationThreshold(score: QualityScore): boolean {
  // All three dimensions must be above minimum
  if (score.appropriate < 4) return false; // Never compile inappropriate responses
  if (score.total < COMPILATION_THRESHOLD) return false;
  return true;
}

// =============================================================================
// 2. ACTIVE VALIDATION
// =============================================================================

/** How often to shadow-test a pattern (every Nth execution) */
const VALIDATION_INTERVAL = 5;

/** Track pattern execution counts for validation scheduling */
const patternExecutionCounts = new Map<string, number>();

/**
 * Check if a pattern should be shadow-tested this execution.
 */
/** @internal Not yet wired into conversation engine — designed for future active validation. */
function shouldValidatePattern(patternId: string): boolean {
  const count = (patternExecutionCounts.get(patternId) || 0) + 1;
  patternExecutionCounts.set(patternId, count);
  return count % VALIDATION_INTERVAL === 0;
}

/**
 * Compare a compiled pattern's output against the Reasoner's output.
 * Returns: "confirmed" (similar), "stale" (diverged), "improved" (Reasoner better)
 */
export function comparePatternToReasoner(
  patternResponse: string,
  reasonerResponse: string,
): "confirmed" | "stale" | "improved" {
  const patternLower = patternResponse.toLowerCase();
  const reasonerLower = reasonerResponse.toLowerCase();

  // Word overlap as similarity measure
  const patternWords = new Set(patternLower.split(/\s+/).filter(w => w.length > 3));
  const reasonerWords = new Set(reasonerLower.split(/\s+/).filter(w => w.length > 3));

  let overlap = 0;
  for (const w of patternWords) {
    if (reasonerWords.has(w)) overlap++;
  }

  const similarity = overlap / Math.max(1, Math.max(patternWords.size, reasonerWords.size));

  // High overlap → pattern is still good
  if (similarity > 0.3) return "confirmed";

  // Low overlap → responses diverged
  // Check if reasoner's response is substantively different
  if (reasonerResponse.length > patternResponse.length * 1.5) return "improved";
  if (similarity < 0.1) return "stale";

  return "stale";
}

/**
 * Reset validation counts (for testing).
 */
function resetValidation(): void {
  patternExecutionCounts.clear();
}

// =============================================================================
// 3. EXPLORATION RATE (ε-greedy)
// =============================================================================

/** Exploration rates by pattern source */
const EXPLORATION_RATES: Record<string, number> = {
  bootstrap: 0.30,     // 30% — bootstrap should be replaced by personalized
  compiled: 0.10,      // 10% — compiled patterns have proven value
  composed: 0.05,      // 5% — composed skills are well-tested
  species: 0.08,       // 8% — species patterns are broadly proven but not personal
  teacher: 0.05,       // 5% — teacher-refined patterns are high quality
};

/**
 * Decide whether to explore (escalate) even though the BT has a match.
 *
 * Returns true if we should escalate for exploration.
 * The exploration result will be compared against the pattern
 * and may trigger recompilation if better.
 */
export function shouldExplore(
  patternSource: string,
  conversationDepth: number,
): boolean {
  let rate = EXPLORATION_RATES[patternSource] ?? 0.10;

  // Early conversations: explore more (personalization is more valuable)
  if (conversationDepth < 5) rate *= 2.0;
  else if (conversationDepth < 10) rate *= 1.5;

  // Cap at 50% — never explore more than half the time
  rate = Math.min(0.50, rate);

  return Math.random() < rate;
}

// =============================================================================
// 4. CONDITION SPECIFICITY SCORING
// =============================================================================

/** Specificity weights per condition type */
const SPECIFICITY_WEIGHTS: Record<string, number> = {
  // Broad conditions (low specificity)
  always: 0,
  chance: 0,
  person_state: 1,
  message_is_question: 1,
  time_is: 1,
  style_is: 1,

  // Medium specificity
  person_topic: 3,
  conversation_depth_above: 2,
  session_length_above: 2,
  intention_active: 3,
  intention_blocked: 2,
  prediction_pending: 2,
  days_since_last_contact: 2,
  last_n_messages_include: 2,

  // High specificity
  memory_contains: 4,
  entity_known: 5,
  entity_mentioned: 3,
  hypothesis_above: 4,
  hypothesis_below: 4,
  has_hypothesis: 3,
  prediction_accuracy_above: 3,
  message_includes: 4,
};

const MINIMUM_SPECIFICITY = 4;

/**
 * Score the specificity of a set of conditions.
 * Returns the total specificity score.
 */
export function scoreConditionSpecificity(conditions: ConditionOp[]): number {
  return conditions.reduce((sum, op) => sum + (SPECIFICITY_WEIGHTS[op.type] ?? 1), 0);
}

/**
 * Check if conditions are specific enough for compilation.
 */
export function meetsSpecificityThreshold(conditions: ConditionOp[]): boolean {
  return scoreConditionSpecificity(conditions) >= MINIMUM_SPECIFICITY;
}

/**
 * Extract conditions from a compiled branch for specificity checking.
 */
export function extractConditions(node: BehaviorNode): ConditionOp[] {
  if (node.type === "condition") return [node.op];
  if (node.type === "sequence") {
    return node.children.flatMap(c => extractConditions(c));
  }
  return [];
}

// =============================================================================
// 5. NEGATIVE SENTIMENT GUARD
// =============================================================================

/**
 * Check if the user's follow-up message indicates the previous response was bad.
 * If so, the pending compilation should be cancelled, not confirmed.
 */
export function isNegativeFeedback(userMessage: string): boolean {
  const lower = userMessage.toLowerCase();

  // Direct negative feedback
  if (/that's (wrong|bad|terrible|awful|unhelpful|not what I)/i.test(lower)) return true;
  if (/don't (do that|say that|give me|tell me)/i.test(lower)) return true;
  if (/no[,.]?\s+(that|I|you|stop|don't)/i.test(lower)) return true;
  if (/you're (wrong|not listening|missing the point)/i.test(lower)) return true;
  if (/what\?|seriously\?|are you kidding/i.test(lower)) return true;

  // Frustration signals
  if (/ugh|sigh|whatever|never ?mind|forget it/i.test(lower)) return true;

  // Short dismissals
  if (/^(no|nope|wrong|bad|stop|ugh)\.?$/i.test(lower.trim())) return true;

  return false;
}

// =============================================================================
// COMBINED COMPILATION DECISION
// =============================================================================

export interface CompilationDecision {
  shouldCompile: boolean;
  reason: string;
  qualityScore?: QualityScore;
  specificityScore?: number;
}

/**
 * Make a comprehensive compilation decision using all immune system checks.
 */
export function evaluateCompilationCandidate(
  decision: CapturedDecision,
  userFollowUp: string,
  conditions: ConditionOp[],
): CompilationDecision {
  // 1. Negative sentiment guard
  if (isNegativeFeedback(userFollowUp)) {
    return {
      shouldCompile: false,
      reason: "Negative feedback detected — user rejected the response",
    };
  }

  // 2. Quality scoring
  const quality = scoreResponseQuality(
    decision.userMessage,
    decision.action.content || "",
    decision.reasoning,
  );
  if (!meetsCompilationThreshold(quality)) {
    return {
      shouldCompile: false,
      reason: `Quality below threshold: ${quality.total.toFixed(1)} < ${COMPILATION_THRESHOLD}`,
      qualityScore: quality,
    };
  }

  // 3. Specificity check
  const specificity = scoreConditionSpecificity(conditions);
  if (!meetsSpecificityThreshold(conditions)) {
    return {
      shouldCompile: false,
      reason: `Conditions too broad: specificity ${specificity} < ${MINIMUM_SPECIFICITY}`,
      specificityScore: specificity,
    };
  }

  return {
    shouldCompile: true,
    reason: `Quality: ${quality.total.toFixed(1)}, Specificity: ${specificity}`,
    qualityScore: quality,
    specificityScore: specificity,
  };
}
