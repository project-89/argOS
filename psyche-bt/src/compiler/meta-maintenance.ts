/**
 * Meta-Maintenance — The system learns how to prune itself.
 *
 * Core insight: pruning decisions are themselves a task with recognizable
 * situations and repeatable approaches. The same compilation mechanism
 * that learns "when stressed about work → help prioritize" can learn
 * "when branch has < 30% success rate and 10+ executions → prune it."
 *
 * The maintenance policy is a BEHAVIOR TREE that evaluates tree health
 * and decides what to prune, merge, or promote. It compiles from
 * successful maintenance decisions just like any other task.
 *
 * This is the system applied recursively to itself.
 *
 * ============================================================================
 * HOW IT WORKS
 * ============================================================================
 *
 * 1. After each nightly maintenance cycle, record what was pruned/kept
 * 2. Benchmark BEFORE and AFTER maintenance
 * 3. If escalation improved → the maintenance decisions were good → compile them
 * 4. If escalation worsened → the maintenance was too aggressive → learn from that
 * 5. Over time, the maintenance policy gets better at deciding what to prune
 *
 * The maintenance BT conditions are about TREE HEALTH, not user messages:
 *   - branch_success_rate(< 0.3)
 *   - branch_unused_days(> 30)
 *   - branch_conflicts_count(> 2)
 *   - tree_size_above(200)
 *   - escalation_rate_above(0.5)
 *
 * The maintenance BT actions are TREE OPERATIONS:
 *   - prune(branch)
 *   - merge(branch_a, branch_b)  — keep the better one
 *   - promote(branch)            — move to higher priority
 *   - demote(branch)             — move to lower priority
 *   - split(branch)              — decompose into sub-branches
 *
 * ============================================================================
 */

import type { BehaviorNode } from "../bt/types.js";
import type { PersonModel } from "../ecs/types.js";
import {
  maintainTree, getBranchHealth, fingerprintBranch,
  type MaintenanceConfig, type MaintenanceResult,
} from "./tree-maintenance.js";
import { countNodes } from "../bt/evaluator.js";

// =============================================================================
// MAINTENANCE DECISION RECORD
// =============================================================================

/** A single maintenance decision and its outcome. */
export interface MaintenanceDecision {
  /** What was the tree state before maintenance? */
  beforeNodes: number;
  beforeBranches: number;
  beforeEscalationRate: number;

  /** What maintenance actions were taken? */
  pruned: number;
  deduplicated: number;
  config: MaintenanceConfig;

  /** What was the outcome? */
  afterNodes: number;
  afterBranches: number;
  afterEscalationRate: number;

  /** Did maintenance improve escalation? */
  improved: boolean;
  /** How much did escalation change? (negative = improved) */
  escalationDelta: number;

  timestamp: number;
}

/** History of maintenance decisions for learning. */
const maintenanceHistory: MaintenanceDecision[] = [];

// =============================================================================
// ADAPTIVE MAINTENANCE
// =============================================================================

/**
 * Run maintenance with adaptive thresholds.
 *
 * Uses the history of past maintenance decisions to adjust thresholds:
 *   - If recent maintenance was too aggressive (escalation worsened): relax thresholds
 *   - If recent maintenance was too conservative (many conflicts remain): tighten thresholds
 *   - If maintenance consistently improves: keep current thresholds
 *
 * This is the "meta-learning" step: the system learns its own optimal
 * pruning parameters from experience.
 */
export function adaptiveMaintain(
  model: PersonModel,
  baseConfig: MaintenanceConfig,
  beforeEscalationRate: number,
  afterEscalationRate: number,
): MaintenanceResult {
  // Adjust config based on recent history
  const config = adaptConfig(baseConfig);

  // Run maintenance
  const beforeNodes = model.policy.totalNodes;
  const beforeBranches = model.policy.compiledBranches;
  const result = maintainTree(model, config);

  // Record the decision
  const decision: MaintenanceDecision = {
    beforeNodes,
    beforeBranches,
    beforeEscalationRate,
    pruned: result.pruned,
    deduplicated: result.deduplicated,
    config,
    afterNodes: model.policy.totalNodes,
    afterBranches: model.policy.compiledBranches,
    afterEscalationRate,
    improved: afterEscalationRate <= beforeEscalationRate,
    escalationDelta: afterEscalationRate - beforeEscalationRate,
    timestamp: Date.now(),
  };

  maintenanceHistory.push(decision);

  // Keep only the last 20 decisions
  if (maintenanceHistory.length > 20) {
    maintenanceHistory.shift();
  }

  return result;
}

/**
 * Adapt maintenance thresholds based on past outcomes.
 *
 * The adaptation is simple but effective:
 *   - Track the success rate of recent pruning decisions
 *   - If pruning has been helping: tighten thresholds (prune more aggressively)
 *   - If pruning has been hurting: relax thresholds (prune less)
 *   - Convergence: thresholds stabilize at the point where pruning
 *     consistently improves or maintains escalation rate
 */
function adaptConfig(base: MaintenanceConfig): MaintenanceConfig {
  if (maintenanceHistory.length < 3) return base; // Not enough data

  const recent = maintenanceHistory.slice(-5);
  const improvedCount = recent.filter(d => d.improved).length;
  const ratio = improvedCount / recent.length;

  // Adaptation rates
  const config = { ...base };

  if (ratio >= 0.8) {
    // Maintenance is consistently helping → prune more aggressively
    config.maxUnusedDays = Math.max(7, base.maxUnusedDays - 5);
    config.minSuccessRate = Math.min(0.5, base.minSuccessRate + 0.05);
  } else if (ratio <= 0.3) {
    // Maintenance is hurting → prune less
    config.maxUnusedDays = Math.min(90, base.maxUnusedDays + 10);
    config.minSuccessRate = Math.max(0.1, base.minSuccessRate - 0.05);
  }
  // else: maintenance is neutral → keep current thresholds

  return config;
}

/**
 * Get the current adaptive maintenance state.
 */
export function getMaintenanceStats(): {
  totalDecisions: number;
  recentImproveRate: number;
  currentThresholds: { maxUnusedDays: number; minSuccessRate: number };
} {
  const recent = maintenanceHistory.slice(-5);
  const improvedCount = recent.filter(d => d.improved).length;

  return {
    totalDecisions: maintenanceHistory.length,
    recentImproveRate: recent.length > 0 ? improvedCount / recent.length : 0,
    currentThresholds: {
      maxUnusedDays: maintenanceHistory.length > 0
        ? maintenanceHistory[maintenanceHistory.length - 1].config.maxUnusedDays
        : 30,
      minSuccessRate: maintenanceHistory.length > 0
        ? maintenanceHistory[maintenanceHistory.length - 1].config.minSuccessRate
        : 0.3,
    },
  };
}

/**
 * Reset maintenance history (for testing).
 */
export function resetMaintenanceHistory(): void {
  maintenanceHistory.length = 0;
}
