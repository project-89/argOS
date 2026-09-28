/**
 * Species Merger — Constructs a species-level bootstrap tree from clustered patterns.
 *
 * Takes the convergent clusters from the pattern clusterer and synthesizes a
 * new behavior tree that encodes the collective learning of the swarm.
 *
 * For each cluster:
 *   - If single strategy: use the centroid's branch directly
 *   - If multiple strategies: create a weighted_random node, weighted by
 *     instance count (convergence = reliability)
 *
 * The species tree preserves the original bootstrap branches (they're the proven
 * generic fallback) and inserts species-learned branches BEFORE them in the
 * selector — so personalized species patterns take priority.
 *
 * Branches are tagged with source: "species" so the immune system can track
 * their exploration rate separately.
 */

import type { BehaviorNode } from "../bt/types.js";
import type { BranchCluster, SpeciesBranch, SpeciesTree } from "./types.js";
import { createBootstrapTree } from "../bt/bootstrap.js";
import { countNodes } from "../bt/evaluator.js";

// =============================================================================
// SPECIES TREE CONSTRUCTION
// =============================================================================

/**
 * Build a species tree from clustered patterns.
 *
 * Architecture:
 *   selector [
 *     species_branch_0,        ← highest convergence first
 *     species_branch_1,
 *     ...
 *     bootstrap_branch_0,      ← original bootstrap (fallback)
 *     bootstrap_branch_1,
 *     ...
 *     llm_escalate             ← always last
 *   ]
 */
export function buildSpeciesTree(
  clusters: BranchCluster[],
  minConvergence: number = 0,
): SpeciesTree {
  const bootstrap = createBootstrapTree();
  if (bootstrap.type !== "selector") {
    throw new Error("Bootstrap tree must be a selector node");
  }

  // Filter clusters by minimum convergence
  const eligible = clusters.filter(c => c.convergenceScore > minConvergence);

  // Build species branches from clusters
  const speciesBranches: SpeciesBranch[] = [];
  const speciesNodes: BehaviorNode[] = [];

  for (const cluster of eligible) {
    const { branch, speciesBranch } = buildClusterBranch(cluster);
    speciesBranches.push(speciesBranch);
    speciesNodes.push(branch);
  }

  // Separate bootstrap children from llm_escalate
  const bootstrapChildren = bootstrap.children.filter(c => c.type !== "llm_escalate");
  const escalate = bootstrap.children.find(c => c.type === "llm_escalate")
    || { type: "llm_escalate" as const };

  // Assemble: species branches → bootstrap branches → escalate
  const tree: BehaviorNode = {
    type: "selector",
    children: [
      ...speciesNodes,
      ...bootstrapChildren,
      escalate,
    ],
  };

  return {
    tree,
    branches: speciesBranches,
    totalNodes: countNodes(tree),
    clusterCount: eligible.length,
    avgConvergence: eligible.length > 0
      ? eligible.reduce((s, c) => s + c.convergenceScore, 0) / eligible.length
      : 0,
  };
}

/**
 * Build a BT branch from a single cluster.
 *
 * Single-strategy clusters: use the centroid's branch directly.
 * Multi-strategy clusters: create weighted_random from all strategies,
 * weighted by the contributing instance count of each variant.
 */
function buildClusterBranch(cluster: BranchCluster): {
  branch: BehaviorNode;
  speciesBranch: SpeciesBranch;
} {
  // Use the centroid's conditions as the gate
  const conditions = cluster.centroid.conditions.map(op => ({
    type: "condition" as const,
    op,
  }));

  let actionNode: BehaviorNode;

  if (cluster.branches.length === 1 || allSameStrategy(cluster)) {
    // Single strategy — use centroid directly
    actionNode = extractActionNode(cluster.centroid.node);
  } else {
    // Multiple strategies — weighted random selection
    // Weight by how many instances share each strategy variant
    const variants = groupByIntent(cluster.branches);
    const choices = variants.map(group => ({
      weight: group.length,
      child: extractActionNode(group[0].node),
    }));

    actionNode = {
      type: "weighted_random",
      choices,
    };
  }

  // Wrap in sequence: conditions → action
  const branch: BehaviorNode = conditions.length > 0
    ? { type: "sequence", children: [...conditions, actionNode] }
    : actionNode;

  const speciesBranch: SpeciesBranch = {
    clusterId: cluster.id,
    node: branch,
    convergence: cluster.instanceCount,
    topics: cluster.topics,
    intent: cluster.intent,
  };

  return { branch, speciesBranch };
}

/**
 * Extract the action/strategy node from a branch (strip conditions).
 */
function extractActionNode(node: BehaviorNode): BehaviorNode {
  if (node.type === "sequence") {
    // Last non-condition child is the action
    for (let i = node.children.length - 1; i >= 0; i--) {
      if (node.children[i].type !== "condition") {
        return node.children[i];
      }
    }
  }
  // If not a sequence, return as-is
  return node;
}

/**
 * Check if all branches in a cluster have the same strategy intent.
 */
function allSameStrategy(cluster: BranchCluster): boolean {
  const intents = new Set(
    cluster.branches
      .map(b => b.intent)
      .filter(Boolean)
  );
  return intents.size <= 1;
}

/**
 * Group branches by intent label.
 * Returns groups sorted by size (largest first).
 */
function groupByIntent(branches: import("./types.js").HarvestedBranch[]): import("./types.js").HarvestedBranch[][] {
  const groups = new Map<string, import("./types.js").HarvestedBranch[]>();

  for (const branch of branches) {
    const key = branch.intent || "unknown";
    const group = groups.get(key);
    if (group) group.push(branch);
    else groups.set(key, [branch]);
  }

  return Array.from(groups.values()).sort((a, b) => b.length - a.length);
}
