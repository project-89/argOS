/**
 * Observation Aggregator
 *
 * A global observation bus where any spirit, system, or monitoring process can
 * report typed gap observations about the simulation. These observations are
 * collected, deduplicated, and prioritized by The Watcher spirit, which then
 * synthesizes them into structured proposals for The Weaver (Architect).
 *
 * This closes the self-evolution feedback loop:
 *   Spirits observe gaps → Aggregator collects → Watcher prioritizes →
 *   Architect designs → System Baker generates → World evolves
 */

// =============================================================================
// OBSERVATION TYPES
// =============================================================================

export type ObservationCategory =
  | "resource_gap"        // Missing items, depleted resources, broken supply chains
  | "interaction_failure" // Agent tried something that failed or wasn't possible
  | "behavioral_gap"     // Agents stuck, looping, or lacking abilities
  | "system_missing"     // No system handles a needed mechanic
  | "component_missing"  // Data type needed but doesn't exist
  | "rule_missing"       // No rule governs a situation that needs one
  | "narrative_gap"      // Plot thread abandoned, story stagnant
  | "social_gap"         // Agents isolated, relationships broken
  | "economic_gap"       // Trade imbalance, missing market mechanics
  | "environmental_gap"  // Room/area lacks expected features
  | "performance_issue"  // System too slow, errors, stagnation
  | "agent_distress";    // Agent stuck, confused, or in impossible state

export type ObservationSeverity = "low" | "medium" | "high" | "critical";

export interface GapObservation {
  id: string;
  timestamp: number;
  source: string;          // Spirit or system that reported this
  category: ObservationCategory;
  severity: ObservationSeverity;
  title: string;           // Short description
  detail: string;          // Full explanation
  evidence?: string[];     // Supporting data (event logs, entity names, etc.)
  suggestedFix?: string;   // What the reporter thinks should happen
  affectedEntities?: string[];  // Entity names involved
  roomContext?: string;    // Room where this was observed
  frequency?: number;      // How often this has been seen (reporter can estimate)
}

export interface AggregatedObservation extends GapObservation {
  occurrences: number;     // How many times similar observations reported
  firstSeen: number;       // Timestamp of first report
  lastSeen: number;        // Timestamp of most recent report
  reporters: string[];     // All spirits that reported this
  mergedEvidence: string[]; // Combined evidence from all reports
  priorityScore: number;   // Computed priority (0-100)
}

// =============================================================================
// AGGREGATOR STATE
// =============================================================================

interface AggregatorState {
  observations: GapObservation[];
  aggregated: Map<string, AggregatedObservation>;
  maxObservations: number;
  lastSynthesis: number;
}

let state: AggregatorState = {
  observations: [],
  aggregated: new Map(),
  maxObservations: 500,
  lastSynthesis: 0,
};

let observationIdCounter = 0;

// =============================================================================
// REPORTING API
// =============================================================================

/**
 * Report a gap observation from any spirit or system.
 * Call this whenever you notice something missing, broken, or needed.
 */
export function reportGapObservation(obs: Omit<GapObservation, "id" | "timestamp">): GapObservation {
  const observation: GapObservation = {
    ...obs,
    id: `obs_${++observationIdCounter}_${Date.now()}`,
    timestamp: Date.now(),
  };

  state.observations.push(observation);

  // Trim if over limit
  if (state.observations.length > state.maxObservations) {
    state.observations = state.observations.slice(-state.maxObservations);
  }

  // Update aggregation
  aggregateObservation(observation);

  return observation;
}

/**
 * Report a simple gap (convenience wrapper)
 */
export function reportGap(
  source: string,
  category: ObservationCategory,
  title: string,
  detail: string,
  severity: ObservationSeverity = "medium"
): void {
  reportGapObservation({ source, category, severity, title, detail });
}

// =============================================================================
// AGGREGATION
// =============================================================================

/**
 * Generate a fingerprint for deduplication.
 * Similar observations get merged into a single aggregated entry.
 */
function observationFingerprint(obs: GapObservation): string {
  // Normalize: same category + similar title = same observation
  const normalizedTitle = obs.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60);
  return `${obs.category}::${normalizedTitle}`;
}

function aggregateObservation(obs: GapObservation): void {
  const key = observationFingerprint(obs);
  const existing = state.aggregated.get(key);

  if (existing) {
    existing.occurrences++;
    existing.lastSeen = obs.timestamp;
    if (!existing.reporters.includes(obs.source)) {
      existing.reporters.push(obs.source);
    }
    if (obs.evidence) {
      for (const e of obs.evidence) {
        if (!existing.mergedEvidence.includes(e)) {
          existing.mergedEvidence.push(e);
        }
      }
    }
    // Severity escalates — keep the highest
    const severityRank: Record<ObservationSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };
    if (severityRank[obs.severity] > severityRank[existing.severity]) {
      existing.severity = obs.severity;
    }
    // Update suggested fix if new one is more specific
    if (obs.suggestedFix && (!existing.suggestedFix || obs.suggestedFix.length > existing.suggestedFix.length)) {
      existing.suggestedFix = obs.suggestedFix;
    }
    existing.priorityScore = computePriority(existing);
  } else {
    const aggregated: AggregatedObservation = {
      ...obs,
      occurrences: 1,
      firstSeen: obs.timestamp,
      lastSeen: obs.timestamp,
      reporters: [obs.source],
      mergedEvidence: obs.evidence ? [...obs.evidence] : [],
      priorityScore: 0,
    };
    aggregated.priorityScore = computePriority(aggregated);
    state.aggregated.set(key, aggregated);
  }
}

/**
 * Compute priority score (0-100) based on severity, frequency, recency, and reporter diversity.
 */
function computePriority(obs: AggregatedObservation): number {
  const severityWeight: Record<ObservationSeverity, number> = {
    low: 10, medium: 30, high: 60, critical: 90,
  };

  let score = severityWeight[obs.severity];

  // Frequency bonus: more occurrences = higher priority (diminishing returns)
  score += Math.min(20, obs.occurrences * 3);

  // Multi-reporter bonus: if multiple spirits notice the same thing, it's important
  score += Math.min(15, (obs.reporters.length - 1) * 5);

  // Recency bonus: recent observations score higher
  const ageMs = Date.now() - obs.lastSeen;
  const ageMinutes = ageMs / 60000;
  if (ageMinutes < 1) score += 10;
  else if (ageMinutes < 5) score += 5;
  else if (ageMinutes > 30) score -= 10;

  return Math.max(0, Math.min(100, score));
}

// =============================================================================
// QUERY API (used by The Watcher)
// =============================================================================

/**
 * Get all aggregated observations, sorted by priority (highest first)
 */
export function getTopObservations(limit: number = 20): AggregatedObservation[] {
  // Recompute priorities (accounts for aging)
  for (const obs of state.aggregated.values()) {
    obs.priorityScore = computePriority(obs);
  }

  return Array.from(state.aggregated.values())
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, limit);
}

/**
 * Get observations by category
 */
export function getObservationsByCategory(category: ObservationCategory): AggregatedObservation[] {
  return Array.from(state.aggregated.values())
    .filter(o => o.category === category)
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

/**
 * Get recent raw observations (not aggregated)
 */
export function getRecentObservations(limit: number = 50): GapObservation[] {
  return state.observations.slice(-limit);
}

/**
 * Get a summary string for logging/debugging
 */
export function getObservationSummary(): string {
  const total = state.observations.length;
  const aggregated = state.aggregated.size;
  const top = getTopObservations(5);

  const lines = [
    `Observations: ${total} raw, ${aggregated} aggregated`,
  ];

  if (top.length > 0) {
    lines.push("Top priorities:");
    for (const obs of top) {
      lines.push(`  [${obs.priorityScore}] ${obs.severity.toUpperCase()} ${obs.category}: ${obs.title} (${obs.occurrences}x, ${obs.reporters.length} reporters)`);
    }
  }

  return lines.join("\n");
}

/**
 * Mark an observation as addressed (remove from aggregated)
 */
export function dismissObservation(key: string): boolean {
  // Find by title match
  for (const [k, obs] of state.aggregated) {
    if (k === key || obs.title === key || obs.id === key) {
      state.aggregated.delete(k);
      return true;
    }
  }
  return false;
}

/**
 * Clear all observations that are older than maxAgeMs
 */
export function pruneStaleObservations(maxAgeMs: number = 600000): number {
  const cutoff = Date.now() - maxAgeMs;
  let pruned = 0;

  for (const [key, obs] of state.aggregated) {
    if (obs.lastSeen < cutoff) {
      state.aggregated.delete(key);
      pruned++;
    }
  }

  // Also trim raw observations
  const rawBefore = state.observations.length;
  state.observations = state.observations.filter(o => o.timestamp >= cutoff);
  pruned += rawBefore - state.observations.length;

  return pruned;
}

/**
 * Get last synthesis timestamp
 */
export function getLastSynthesisTime(): number {
  return state.lastSynthesis;
}

/**
 * Update last synthesis timestamp
 */
export function markSynthesisComplete(): void {
  state.lastSynthesis = Date.now();
}

/**
 * Reset aggregator state (for testing)
 */
export function resetAggregator(): void {
  state = {
    observations: [],
    aggregated: new Map(),
    maxObservations: 500,
    lastSynthesis: 0,
  };
  observationIdCounter = 0;
}
