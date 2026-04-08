/**
 * Tree Maintenance — Pruning, deduplication, and health tracking.
 *
 * Without maintenance, the BT accumulates branches forever:
 *   - Stale branches (compiled months ago, never fire)
 *   - Conflicting branches (same conditions, different strategies)
 *   - Low-quality branches (fire but users reject the result)
 *
 * Maintenance runs as part of the nightly training cycle:
 *   1. DEDUPLICATE — when N branches have identical conditions, keep the best
 *   2. PRUNE — remove branches that haven't fired in N days or have poor success rates
 *   3. COMPACT — remove chance nodes from old branches (legacy cleanup)
 *
 * The result: a clean, non-conflicting tree that converges on ONE strategy
 * per condition set — the one the swarm agreed on.
 */

import type { BehaviorNode, ConditionOp } from "../bt/types.js";
import type { PersonModel } from "../ecs/types.js";
import { countNodes } from "../bt/evaluator.js";

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface MaintenanceConfig {
  /** Remove branches not used in this many days */
  maxUnusedDays: number;
  /** Remove branches with success rate below this */
  minSuccessRate: number;
  /** Minimum executions before judging success rate */
  minExecutionsForJudgment: number;
  /** Remove duplicate conditions (keep highest quality) */
  deduplicate: boolean;
  /** Remove chance nodes from compiled branches */
  removeChanceNodes: boolean;
}

export const DEFAULT_MAINTENANCE_CONFIG: MaintenanceConfig = {
  maxUnusedDays: 30,
  minSuccessRate: 0.3,
  minExecutionsForJudgment: 5,
  deduplicate: true,
  removeChanceNodes: true,
};

export interface MaintenanceResult {
  beforeNodes: number;
  afterNodes: number;
  pruned: number;
  deduplicated: number;
  chanceNodesRemoved: number;
  branchesRetained: number;
}

// =============================================================================
// BRANCH HEALTH TRACKING
// =============================================================================

/** Track per-branch execution stats. Keyed by condition fingerprint. */
const branchHealth = new Map<string, {
  executions: number;
  successes: number;
  lastUsed: number;
  compiledAt: number;
}>();

/**
 * Record that a branch fired. Call this from the conversation engine
 * when a compiled branch (not bootstrap) produces a result.
 */
export function recordBranchExecution(conditionFingerprint: string, success: boolean): void {
  const health = branchHealth.get(conditionFingerprint) || {
    executions: 0,
    successes: 0,
    lastUsed: 0,
    compiledAt: Date.now(),
  };
  health.executions++;
  if (success) health.successes++;
  health.lastUsed = Date.now();
  branchHealth.set(conditionFingerprint, health);
}

/**
 * Get the health stats for a branch.
 */
export function getBranchHealth(fingerprint: string): { executions: number; successRate: number; daysSinceUsed: number } | null {
  const health = branchHealth.get(fingerprint);
  if (!health) return null;
  return {
    executions: health.executions,
    successRate: health.executions > 0 ? health.successes / health.executions : 0,
    daysSinceUsed: (Date.now() - health.lastUsed) / (1000 * 60 * 60 * 24),
  };
}

// =============================================================================
// CONDITION FINGERPRINTING
// =============================================================================

/**
 * Create a stable fingerprint for a branch's condition set.
 * Used for deduplication and health tracking.
 */
export function fingerprintBranch(node: BehaviorNode): string {
  const conditions = extractConditions(node);
  return conditions
    .map(c => conditionKey(c))
    .sort()
    .join("|");
}

function extractConditions(node: BehaviorNode): ConditionOp[] {
  if (node.type === "condition") return [node.op];
  if (node.type === "sequence") return node.children.flatMap(c => extractConditions(c));
  return [];
}

function conditionKey(op: ConditionOp): string {
  switch (op.type) {
    case "person_topic": return `topic:${op.topic}`;
    case "person_state": return `state:${op.state}`;
    case "message_includes": return `msg:${op.includes}`;
    case "entity_known": return `entity:${op.name}`;
    case "hypothesis_above": return `hyp:${op.domain}>${op.confidence}`;
    case "memory_contains": return `mem:${op.query}`;
    case "intention_active": return `intent:${op.domain}`;
    case "chance": return `chance:${op.p}`;
    default: return op.type;
  }
}

// =============================================================================
// TREE MAINTENANCE
// =============================================================================

/**
 * Run full maintenance on a person's behavior tree.
 * Deduplicates, prunes stale/low-quality branches, removes chance nodes.
 */
export function maintainTree(
  model: PersonModel,
  config: MaintenanceConfig = DEFAULT_MAINTENANCE_CONFIG,
): MaintenanceResult {
  if (!model.policy.tree || model.policy.tree.type !== "selector") {
    return { beforeNodes: 0, afterNodes: 0, pruned: 0, deduplicated: 0, chanceNodesRemoved: 0, branchesRetained: 0 };
  }

  const beforeNodes = model.policy.totalNodes;
  let pruned = 0;
  let deduplicated = 0;
  let chanceNodesRemoved = 0;

  const children = [...model.policy.tree.children];
  const retained: BehaviorNode[] = [];

  // Track seen condition fingerprints for deduplication
  const seenFingerprints = new Map<string, { index: number; node: BehaviorNode }>();

  // Identify bootstrap children (first N before any compiled branches)
  // Bootstrap nodes use template_response or weighted_random, not strategy/plan
  const isBootstrap = (node: BehaviorNode): boolean => {
    if (node.type === "llm_escalate") return true;
    if (node.type !== "sequence") return false;
    return node.children.some(c =>
      c.type === "template_response" || c.type === "weighted_random"
    );
  };

  for (let i = 0; i < children.length; i++) {
    const child = children[i];

    // Always keep bootstrap and escalation nodes
    if (isBootstrap(child) || child.type === "llm_escalate") {
      retained.push(child);
      continue;
    }

    // This is a compiled branch — apply maintenance rules
    const fingerprint = fingerprintBranch(child);
    const health = getBranchHealth(fingerprint);

    // 1. REMOVE CHANCE NODES from compiled branches
    if (config.removeChanceNodes) {
      const cleaned = removeChanceFromBranch(child);
      if (cleaned !== child) {
        chanceNodesRemoved++;
        children[i] = cleaned;
      }
    }

    // 2. PRUNE stale branches
    if (health) {
      // Prune if unused too long
      if (health.daysSinceUsed > config.maxUnusedDays) {
        pruned++;
        continue; // Skip — don't retain
      }

      // Prune if poor success rate (with enough data)
      if (health.executions >= config.minExecutionsForJudgment &&
          health.successRate < config.minSuccessRate) {
        pruned++;
        continue;
      }
    }

    // 3. DEDUPLICATE — same conditions, keep the one with better health
    if (config.deduplicate && fingerprint.length > 0) {
      const existing = seenFingerprints.get(fingerprint);
      if (existing) {
        // Conflict — keep the one with better health
        const existingHealth = getBranchHealth(fingerprintBranch(existing.node));
        const thisHealth = health;

        const existingScore = existingHealth ? existingHealth.successRate * existingHealth.executions : 0;
        const thisScore = thisHealth ? thisHealth.successRate * thisHealth.executions : 0;

        if (thisScore > existingScore) {
          // Replace the existing one
          retained[existing.index] = children[i];
          seenFingerprints.set(fingerprint, { index: existing.index, node: children[i] });
        }
        // Either way, one branch was deduplicated
        deduplicated++;
        continue;
      }

      seenFingerprints.set(fingerprint, { index: retained.length, node: children[i] });
    }

    retained.push(children[i]);
  }

  // Rebuild tree
  model.policy.tree = { type: "selector", children: retained };
  model.policy.totalNodes = countNodes(model.policy.tree);
  model.policy.compiledBranches = retained.filter(c =>
    c.type !== "llm_escalate" && !isBootstrap(c)
  ).length;

  return {
    beforeNodes,
    afterNodes: model.policy.totalNodes,
    pruned,
    deduplicated,
    chanceNodesRemoved,
    branchesRetained: model.policy.compiledBranches,
  };
}

/**
 * Remove chance nodes from a compiled branch.
 * Replaces sequence([..., cond(chance(p)), ...]) with sequence([..., ...]).
 */
function removeChanceFromBranch(node: BehaviorNode): BehaviorNode {
  if (node.type !== "sequence") return node;

  const filtered = node.children.filter(c =>
    !(c.type === "condition" && c.op.type === "chance")
  );

  if (filtered.length === node.children.length) return node; // No change
  if (filtered.length === 0) return { type: "noop" };
  if (filtered.length === 1) return filtered[0];
  return { ...node, children: filtered };
}

/**
 * Reset all health tracking (for testing).
 */
export function resetBranchHealth(): void {
  branchHealth.clear();
}
