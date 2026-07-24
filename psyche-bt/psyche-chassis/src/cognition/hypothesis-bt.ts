/**
 * Hypothesis-BT — BT-native hypothesis management.
 *
 * Instead of running an expensive 8-channel Bayesian update every turn,
 * observation patterns compile into BT branches that update hypotheses
 * directly at BT evaluation speed (O(1), ~0.017ms).
 *
 * ============================================================================
 * THE PARADIGM
 * ============================================================================
 *
 * Traditional (Nanobot CC):
 *   Every turn → LLM analyzes 8 channels → updates hypotheses → expensive ($)
 *
 * BT-Native (Psyche Chassis):
 *   1. First encounters: LLM observes → compiles observation pattern into BT branch
 *   2. Recognized patterns: BT matches → updates hypothesis directly → free
 *   3. Novel patterns: escalate to LLM → compile new observation branch → learns
 *
 * The 8 observation channels from CC become condition libraries that the
 * BT can compile observation branches INTO. We start with the existing
 * Psyche-BT hypothesis structure and add channels incrementally.
 *
 * ============================================================================
 * OBSERVATION CHANNELS (incremental addition)
 * ============================================================================
 *
 * Phase 1 (Current):
 *   - Emotional state detection (from analysis handler)
 *   - Topic recognition (from analysis handler)
 *   - Entity tracking (from analysis handler)
 *
 * Phase 2 (Next):
 *   - Energy patterns (high/low/fluctuating engagement)
 *   - Framing choices (how they describe situations)
 *   - Avoidance patterns (topics they steer away from)
 *
 * Phase 3 (Future):
 *   - Narrative structure (how they tell stories)
 *   - Identity positioning (how they define themselves)
 *   - Tension detection (unresolved internal conflicts)
 *   - Precision vs vagueness (communication style signals)
 *
 * Each channel is a sub-tree within the main BT. As patterns are compiled,
 * the sub-tree grows. The immune system prevents bad hypothesis updates.
 */

import type { PersonModel, Hypothesis } from "../ecs/types.js";
import type { BehaviorNode, ConditionOp } from "../bt/types.js";

// =============================================================================
// HYPOTHESIS OBSERVATION — compiled observation patterns
// =============================================================================

/**
 * A compiled observation pattern that updates a hypothesis.
 * When the conditions match, the hypothesis is updated without LLM calls.
 */
export interface ObservationPattern {
  /** Unique ID */
  id: string;
  /** Which observation channel this belongs to */
  channel: ObservationChannel;
  /** Conditions that trigger this observation */
  conditions: ConditionOp[];
  /** What hypothesis domain to update */
  targetDomain: string;
  /** Direction of update (+/- confidence) */
  confidenceDelta: number;
  /** Evidence description template */
  evidenceTemplate: string;
  /** How many times this pattern has fired */
  activations: number;
  /** Success rate of this pattern's predictions */
  accuracy: number;
}

export type ObservationChannel =
  | "emotional_state"    // Phase 1
  | "topic_recognition"  // Phase 1
  | "entity_tracking"    // Phase 1
  | "energy_patterns"    // Phase 2
  | "framing_choices"    // Phase 2
  | "avoidance_patterns" // Phase 2
  | "narrative_structure" // Phase 3
  | "identity_positioning" // Phase 3
  | "tension_detection"    // Phase 3
  | "precision_vagueness"; // Phase 3

// =============================================================================
// HYPOTHESIS ACTIONS — BT-executable hypothesis operations
// =============================================================================

/**
 * Update a hypothesis based on a compiled observation.
 * This is the BT-speed replacement for expensive LLM analysis.
 *
 * Confidence clamping rules (from CC's epistemic humility):
 *   - Max increment: +0.10 per activation
 *   - Max confidence: 0.90 (never fully certain)
 *   - Min evidence: 3 items for confidence > 0.6
 *   - Decay: -0.005 per turn without supporting evidence
 */
export function updateHypothesis(
  model: PersonModel,
  domain: string,
  confidenceDelta: number,
  evidence: string,
): void {
  // Clamp delta to prevent overconfidence
  const clampedDelta = Math.max(-0.15, Math.min(0.10, confidenceDelta));

  const existing = model.hypotheses.find(h => h.domain === domain);

  if (existing) {
    existing.confidence = Math.max(0, Math.min(0.9, existing.confidence + clampedDelta));
    existing.evidence.push(evidence);
    existing.lastUpdated = Date.now();

    // Evidence requirement: can't exceed 0.6 without 3+ evidence items
    if (existing.evidence.length < 3 && existing.confidence > 0.6) {
      existing.confidence = 0.6;
    }
  } else if (clampedDelta > 0) {
    // Create new hypothesis
    model.hypotheses.push({
      id: `hyp_${domain}_${Date.now()}`,
      domain,
      content: evidence,
      confidence: Math.min(0.3, clampedDelta), // Start low for new hypotheses
      evidence: [evidence],
      lastUpdated: Date.now(),
      source: "observation",
    });
  }
}

/**
 * Decay hypotheses that haven't been reinforced recently.
 * Called during heartbeat/dreaming cycles.
 */
export function decayHypotheses(model: PersonModel, decayRate: number = 0.005): void {
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;

  for (const hyp of model.hypotheses) {
    const daysSinceUpdate = (now - hyp.lastUpdated) / ONE_DAY;
    if (daysSinceUpdate > 1) {
      hyp.confidence = Math.max(0, hyp.confidence - (decayRate * daysSinceUpdate));
    }
  }

  // Prune dead hypotheses (confidence ≈ 0)
  model.hypotheses = model.hypotheses.filter(h => h.confidence > 0.01);
}

/**
 * Build the observation sub-tree for hypothesis management.
 * Returns a BT selector node containing all compiled observation patterns.
 */
export function buildObservationTree(patterns: ObservationPattern[]): BehaviorNode {
  if (patterns.length === 0) {
    return { type: "noop" };
  }

  const branches: BehaviorNode[] = patterns.map(pattern => ({
    type: "sequence" as const,
    children: [
      ...pattern.conditions.map(op => ({
        type: "condition" as const,
        op,
      })),
      {
        type: "strategy" as const,
        strategy: {
          intent: "observe",
          approach: `Update ${pattern.targetDomain} (${pattern.confidenceDelta > 0 ? "+" : ""}${pattern.confidenceDelta})`,
          tone: "analytical",
          constraints: [`domain:${pattern.targetDomain}`, `delta:${pattern.confidenceDelta}`],
          contextKeys: [] as string[],
        },
      },
    ],
  }));

  return {
    type: "selector",
    children: branches,
  };
}

// =============================================================================
// BOOTSTRAP OBSERVATION PATTERNS — hand-authored starting points
// =============================================================================

/**
 * Default observation patterns that the system starts with.
 * These will be supplemented and eventually replaced by compiled patterns.
 */
export function getBootstrapObservationPatterns(): ObservationPattern[] {
  return [
    {
      id: "obs_stress_work",
      channel: "emotional_state",
      conditions: [
        { type: "person_state", state: "stressed" },
        { type: "person_topic", topic: "work" },
      ],
      targetDomain: "stress_pattern",
      confidenceDelta: 0.08,
      evidenceTemplate: "Stressed about work: {message_summary}",
      activations: 0,
      accuracy: 0,
    },
    {
      id: "obs_excited_creative",
      channel: "emotional_state",
      conditions: [
        { type: "person_state", state: "excited" },
        { type: "person_topic", topic: "creative" },
      ],
      targetDomain: "creative_energy",
      confidenceDelta: 0.06,
      evidenceTemplate: "Excited about creative work: {message_summary}",
      activations: 0,
      accuracy: 0,
    },
    {
      id: "obs_recurring_topic",
      channel: "topic_recognition",
      conditions: [
        { type: "always" },
      ],
      targetDomain: "primary_interests",
      confidenceDelta: 0.03,
      evidenceTemplate: "Discussed {topic} again",
      activations: 0,
      accuracy: 0,
    },
  ];
}
