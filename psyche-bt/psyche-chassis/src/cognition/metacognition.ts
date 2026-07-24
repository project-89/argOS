/**
 * Metacognition — Self-reflection via extended meta-maintenance.
 *
 * Extends Psyche-BT's meta-maintenance (which adapts pruning thresholds)
 * to cover the full cognitive state: hypothesis accuracy, intention success,
 * learning rate, and soul overlay evolution.
 *
 * Runs on two triggers:
 *   1. Every N turns during active conversation (quick self-check)
 *   2. During dreaming/nightly cycle (deep reflection)
 */

import type { PersonModel, DomainCalibration } from "../ecs/types.js";

// =============================================================================
// REFLECTION RESULTS
// =============================================================================

export interface ReflectionResult {
  /** Domains where predictions were accurate */
  strongDomains: string[];
  /** Domains where predictions were inaccurate */
  weakDomains: string[];
  /** Hypotheses that should be reconsidered */
  staleHypotheses: string[];
  /** Intentions that were well-received */
  successfulIntentionPatterns: string[];
  /** Suggested soul overlay updates */
  soulOverlayUpdates: string[];
  /** Overall cognitive health score (0-1) */
  cognitiveHealth: number;
}

// =============================================================================
// CALIBRATION — track prediction accuracy per domain
// =============================================================================

/**
 * Record a prediction outcome and update domain calibration.
 */
export function recordPredictionOutcome(
  model: PersonModel,
  domain: string,
  correct: boolean,
): void {
  let cal = model.calibration.find(c => c.domain === domain);
  if (!cal) {
    cal = { domain, totalPredictions: 0, correctPredictions: 0, accuracy: 0, recentTrend: "stable" };
    model.calibration.push(cal);
  }

  cal.totalPredictions++;
  if (correct) cal.correctPredictions++;

  const oldAccuracy = cal.accuracy;
  cal.accuracy = cal.correctPredictions / cal.totalPredictions;

  // Trend detection
  if (cal.totalPredictions >= 5) {
    const delta = cal.accuracy - oldAccuracy;
    cal.recentTrend = delta > 0.05 ? "improving" : delta < -0.05 ? "declining" : "stable";
  }
}

// =============================================================================
// REFLECTION — periodic self-assessment
// =============================================================================

/**
 * Quick reflection (every N turns during active conversation).
 * Lightweight check: are my predictions landing?
 */
export function quickReflection(model: PersonModel): ReflectionResult {
  const strong: string[] = [];
  const weak: string[] = [];

  for (const cal of model.calibration) {
    if (cal.totalPredictions < 3) continue;
    if (cal.accuracy >= 0.7) strong.push(cal.domain);
    else if (cal.accuracy < 0.4) weak.push(cal.domain);
  }

  // Identify stale hypotheses (high confidence but no recent evidence)
  const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
  const stale = model.hypotheses
    .filter(h => h.confidence > 0.5 && (Date.now() - h.lastUpdated) > ONE_WEEK)
    .map(h => h.id);

  // Cognitive health = weighted average of calibration accuracy
  const healthScores = model.calibration
    .filter(c => c.totalPredictions >= 3)
    .map(c => c.accuracy);
  const cognitiveHealth = healthScores.length > 0
    ? healthScores.reduce((s, a) => s + a, 0) / healthScores.length
    : 0.5; // Default to 0.5 if no calibration data

  return {
    strongDomains: strong,
    weakDomains: weak,
    staleHypotheses: stale,
    successfulIntentionPatterns: [],
    soulOverlayUpdates: [],
    cognitiveHealth,
  };
}

/**
 * Deep reflection (during dreaming/nightly cycle).
 * Comprehensive analysis of what the system got right and wrong.
 */
export function deepReflection(model: PersonModel): ReflectionResult {
  const quick = quickReflection(model);

  // Analyze intention outcomes
  const completedIntentions = model.intentions.filter(i => i.status === "completed");
  const abandonedIntentions = model.intentions.filter(i => i.status === "abandoned");

  // Intentions that were completed successfully → learn from these patterns
  quick.successfulIntentionPatterns = completedIntentions.map(i => i.claim);

  // Soul overlay updates: if the system's understanding has shifted significantly,
  // suggest updates to the evolved prompt
  if (quick.weakDomains.length > 2) {
    quick.soulOverlayUpdates.push(
      `I've been less accurate in ${quick.weakDomains.join(", ")}. I should be more tentative there.`
    );
  }

  if (abandonedIntentions.length > completedIntentions.length && completedIntentions.length > 0) {
    quick.soulOverlayUpdates.push(
      `My proactive suggestions are being declined more than accepted. I should be more selective.`
    );
  }

  return quick;
}

/**
 * Adjust exploration rates per domain based on calibration.
 * Poorly calibrated domains get higher exploration (more escalation to learn).
 */
export function getExplorationRateForDomain(
  model: PersonModel,
  domain: string,
): number {
  const cal = model.calibration.find(c => c.domain === domain);
  if (!cal || cal.totalPredictions < 5) return 0.3; // High exploration for unknown domains
  if (cal.accuracy >= 0.8) return 0.05; // Low exploration for well-understood domains
  if (cal.accuracy >= 0.5) return 0.15; // Medium exploration
  return 0.25; // High exploration for poorly-understood domains
}
