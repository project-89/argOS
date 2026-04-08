/**
 * Branch Harvester — Extracts compiled branches from instance trees.
 *
 * After the swarm runs, each instance has a behavior tree that grew from
 * the bootstrap via compilation. The harvester walks each tree, identifies
 * compiled branches (they contain strategy nodes — bootstrap uses templates),
 * extracts their conditions and metadata, and returns a flat collection
 * ready for clustering.
 *
 * Identification heuristic: compiled branches are sequence nodes containing
 * a "strategy" child. Bootstrap uses "template_response" and "weighted_random".
 */

import type { BehaviorNode, ConditionOp, ResponseStrategy } from "../bt/types.js";
import type { HarvestedBranch, HarvestResult } from "./types.js";
import type { InstanceResult } from "./types.js";
import { createBootstrapTree } from "../bt/bootstrap.js";

// =============================================================================
// HARVESTER
// =============================================================================

/**
 * Harvest compiled branches from all swarm instances.
 */
export function harvestBranches(instances: InstanceResult[]): HarvestResult {
  const branches: HarvestedBranch[] = [];
  let contributingInstances = 0;

  // Get bootstrap child count for offset calculation
  const bootstrap = createBootstrapTree();
  const bootstrapChildCount = bootstrap.type === "selector" ? bootstrap.children.length - 1 : 0;
  // bootstrap has 7 branches + 1 llm_escalate = 8 children
  // compiled branches are inserted at indices [7, 8, ..., N-2] (before last which is llm_escalate)

  for (const instance of instances) {
    const tree = instance.model.policy.tree;
    if (!tree) continue;

    const instanceBranches = extractCompiledBranches(tree, instance.instanceId, bootstrapChildCount);
    if (instanceBranches.length > 0) {
      contributingInstances++;
      branches.push(...instanceBranches);
    }
  }

  return {
    branches,
    contributingInstances,
    avgBranchesPerInstance: instances.length > 0
      ? branches.length / instances.length
      : 0,
  };
}

/**
 * Extract compiled branches from a single tree.
 * Uses two strategies:
 *   1. Position-based: compiled branches are between bootstrap and llm_escalate in root selector
 *   2. Content-based: compiled branches contain strategy nodes (bootstrap doesn't)
 */
function extractCompiledBranches(
  tree: BehaviorNode,
  instanceId: string,
  bootstrapChildCount: number,
): HarvestedBranch[] {
  if (tree.type !== "selector") return [];

  const branches: HarvestedBranch[] = [];
  const children = tree.children;

  // Strategy 1: position-based extraction
  // Children layout: [bootstrap0..6, compiled0..N, llm_escalate]
  const escalateIdx = children.findIndex(c => c.type === "llm_escalate");
  const compiledStart = bootstrapChildCount;
  const compiledEnd = escalateIdx >= 0 ? escalateIdx : children.length;

  for (let i = compiledStart; i < compiledEnd; i++) {
    const child = children[i];
    const harvested = extractBranchMetadata(child, instanceId, i);
    if (harvested) branches.push(harvested);
  }

  // Strategy 2: if position-based missed any, scan for strategy nodes everywhere
  // (This catches branches that might have been inserted at unexpected positions)
  if (branches.length === 0) {
    for (let i = 0; i < children.length; i++) {
      if (i < compiledStart || i >= compiledEnd) continue; // already checked
      const child = children[i];
      if (containsStrategy(child)) {
        const harvested = extractBranchMetadata(child, instanceId, i);
        if (harvested) branches.push(harvested);
      }
    }
  }

  return branches;
}

/**
 * Extract metadata from a single compiled branch node.
 */
function extractBranchMetadata(
  node: BehaviorNode,
  instanceId: string,
  index: number,
): HarvestedBranch | null {
  const conditions = extractConditions(node);
  const strategy = extractStrategy(node);

  // Must have either conditions or a strategy to be considered compiled
  if (conditions.length === 0 && !strategy) return null;

  // Extract topics from conditions
  const topics: string[] = [];
  let emotionalState: string | undefined;
  for (const cond of conditions) {
    if (cond.type === "person_topic") topics.push(cond.topic);
    if (cond.type === "person_state") emotionalState = cond.state;
  }

  return {
    id: `${instanceId}_branch_${index}`,
    sourceInstance: instanceId,
    node,
    conditions,
    strategy: strategy ?? undefined,
    topics,
    emotionalState,
    intent: strategy?.intent,
  };
}

/**
 * Extract all condition ops from a branch (recursively through sequences).
 */
function extractConditions(node: BehaviorNode): ConditionOp[] {
  if (node.type === "condition") return [node.op];
  if (node.type === "sequence") {
    return node.children.flatMap(c => extractConditions(c));
  }
  return [];
}

/**
 * Extract the strategy from a branch (if present).
 */
function extractStrategy(node: BehaviorNode): ResponseStrategy | null {
  if (node.type === "strategy") return node.strategy;
  if (node.type === "sequence") {
    for (const child of node.children) {
      const s = extractStrategy(child);
      if (s) return s;
    }
  }
  return null;
}

/**
 * Check if a node or its children contain a strategy node.
 */
function containsStrategy(node: BehaviorNode): boolean {
  if (node.type === "strategy") return true;
  if (node.type === "sequence") return node.children.some(c => containsStrategy(c));
  if (node.type === "selector") return node.children.some(c => containsStrategy(c));
  return false;
}
