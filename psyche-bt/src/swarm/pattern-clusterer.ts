/**
 * Pattern Clusterer — Groups similar harvested branches by semantic similarity.
 *
 * Similarity is computed from three signals:
 *   1. Condition overlap — Jaccard similarity of condition type+value pairs
 *   2. Intent similarity — Token overlap between intent labels
 *   3. Topic overlap — Jaccard similarity of topic sets
 *
 * Agglomerative clustering: start with each branch as its own cluster,
 * merge the two most similar clusters until no pair exceeds the threshold.
 *
 * Cross-instance convergence: clusters where branches come from DIFFERENT
 * instances are especially valuable — they represent independently discovered
 * patterns, which is strong evidence of a genuinely useful strategy.
 */

import type { HarvestedBranch, BranchCluster, SimilarityScore, ClusterConfig, ClusterResult } from "./types.js";
import type { ConditionOp } from "../bt/types.js";

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

export const DEFAULT_CLUSTER_CONFIG: ClusterConfig = {
  similarityThreshold: 0.35,
  minClusterSize: 1,
  weights: {
    condition: 0.4,
    intent: 0.35,
    topic: 0.25,
  },
};

// =============================================================================
// SIMILARITY COMPUTATION
// =============================================================================

/**
 * Compute similarity between two harvested branches.
 */
export function computeSimilarity(
  a: HarvestedBranch,
  b: HarvestedBranch,
  weights = DEFAULT_CLUSTER_CONFIG.weights,
): SimilarityScore {
  const conditionOverlap = conditionJaccard(a.conditions, b.conditions);
  const intentSimilarity = intentSim(a.intent || "", b.intent || "");
  const topicOverlap = setJaccard(new Set(a.topics), new Set(b.topics));

  const total =
    conditionOverlap * weights.condition +
    intentSimilarity * weights.intent +
    topicOverlap * weights.topic;

  return {
    branchA: a.id,
    branchB: b.id,
    conditionOverlap,
    intentSimilarity,
    topicOverlap,
    total,
  };
}

/**
 * Jaccard similarity over condition fingerprints.
 * Fingerprint = "type:value" string for each condition.
 */
function conditionJaccard(a: ConditionOp[], b: ConditionOp[]): number {
  const setA = new Set(a.map(conditionFingerprint));
  const setB = new Set(b.map(conditionFingerprint));
  return setJaccard(setA, setB);
}

/**
 * Create a string fingerprint for a condition op.
 */
function conditionFingerprint(op: ConditionOp): string {
  switch (op.type) {
    case "person_topic": return `topic:${op.topic}`;
    case "person_state": return `state:${op.state}`;
    case "hypothesis_above": return `hyp_above:${op.domain}`;
    case "hypothesis_below": return `hyp_below:${op.domain}`;
    case "has_hypothesis": return `has_hyp:${op.includes}`;
    case "memory_contains": return `mem:${op.query}`;
    case "entity_known": return `entity:${op.name}`;
    case "intention_active": return `intent:${op.domain}`;
    case "message_includes": return `msg:${op.includes}`;
    case "chance": return `chance:${op.p}`;
    default: return op.type;
  }
}

/**
 * Token-level similarity between intent labels.
 * "acknowledge_stress_about_work" vs "acknowledge_stress_with_specifics" → high overlap.
 */
function intentSim(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const tokensA = new Set(a.split("_").filter(t => t.length > 0));
  const tokensB = new Set(b.split("_").filter(t => t.length > 0));
  return setJaccard(tokensA, tokensB);
}

/**
 * Jaccard similarity between two sets.
 */
function setJaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1; // Both empty = identical
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// =============================================================================
// AGGLOMERATIVE CLUSTERING
// =============================================================================

/**
 * Cluster harvested branches using agglomerative (bottom-up) clustering.
 *
 * Algorithm:
 *   1. Start: each branch is its own cluster
 *   2. Compute pairwise similarity between all cluster pairs (average linkage)
 *   3. Merge the most similar pair if above threshold
 *   4. Repeat until no pair exceeds threshold
 *
 * Returns clusters sorted by convergence score (multi-instance clusters first).
 */
export function clusterBranches(
  branches: HarvestedBranch[],
  totalInstances: number,
  config: ClusterConfig = DEFAULT_CLUSTER_CONFIG,
): ClusterResult {
  if (branches.length === 0) {
    return { clusters: [], singletons: [], avgClusterSize: 0, clusteringRate: 0, convergentClusters: 0 };
  }

  // Initialize: each branch is its own cluster
  let clusters: HarvestedBranch[][] = branches.map(b => [b]);

  // Precompute pairwise similarities
  const simCache = new Map<string, number>();
  for (let i = 0; i < branches.length; i++) {
    for (let j = i + 1; j < branches.length; j++) {
      const sim = computeSimilarity(branches[i], branches[j], config.weights);
      simCache.set(`${i}:${j}`, sim.total);
    }
  }

  // Track which original indices belong to which cluster
  let clusterIndices: number[][] = branches.map((_, i) => [i]);

  // Merge loop
  let merged = true;
  while (merged) {
    merged = false;
    let bestSim = -1;
    let bestI = -1;
    let bestJ = -1;

    // Find the most similar pair of clusters (average linkage)
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const avgSim = averageLinkage(clusterIndices[i], clusterIndices[j], simCache);
        if (avgSim > bestSim) {
          bestSim = avgSim;
          bestI = i;
          bestJ = j;
        }
      }
    }

    // Merge if above threshold
    if (bestSim >= config.similarityThreshold && bestI >= 0 && bestJ >= 0) {
      // Merge j into i
      clusters[bestI] = [...clusters[bestI], ...clusters[bestJ]];
      clusterIndices[bestI] = [...clusterIndices[bestI], ...clusterIndices[bestJ]];

      // Remove j
      clusters.splice(bestJ, 1);
      clusterIndices.splice(bestJ, 1);

      merged = true;
    }
  }

  // Build cluster objects
  const result: BranchCluster[] = [];
  const singletons: HarvestedBranch[] = [];

  for (let i = 0; i < clusters.length; i++) {
    const members = clusters[i];
    if (members.length < config.minClusterSize) {
      singletons.push(...members);
      continue;
    }

    const instanceIds = new Set(members.map(b => b.sourceInstance));
    const allTopics = members.flatMap(b => b.topics);
    const topicCounts = countOccurrences(allTopics);
    const dominantTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t]) => t);

    const allIntents = members.map(b => b.intent).filter(Boolean) as string[];
    const intentCounts = countOccurrences(allIntents);
    const dominantIntent = Object.entries(intentCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";

    const allEmotions = members.map(b => b.emotionalState).filter(Boolean) as string[];
    const emotionCounts = countOccurrences(allEmotions);
    const dominantEmotion = Object.entries(emotionCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0];

    // Centroid: branch closest to all others (highest average similarity)
    const centroid = findCentroid(members, config.weights);

    // Cohesion: average pairwise similarity within cluster
    const cohesion = members.length > 1
      ? avgPairwiseSimilarity(members, config.weights)
      : 1.0;

    result.push({
      id: `cluster_${i}`,
      branches: members,
      instanceCount: instanceIds.size,
      centroid,
      cohesion,
      topics: dominantTopics,
      intent: dominantIntent,
      emotionalState: dominantEmotion,
      convergenceScore: instanceIds.size / totalInstances,
    });
  }

  // Sort by convergence (multi-instance clusters first)
  result.sort((a, b) => b.convergenceScore - a.convergenceScore);

  const totalClustered = result.reduce((s, c) => s + c.branches.length, 0);
  const convergentClusters = result.filter(c => c.instanceCount > 1).length;

  return {
    clusters: result,
    singletons,
    avgClusterSize: result.length > 0
      ? totalClustered / result.length
      : 0,
    clusteringRate: branches.length > 0
      ? totalClustered / branches.length
      : 0,
    convergentClusters,
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function averageLinkage(
  indicesA: number[],
  indicesB: number[],
  simCache: Map<string, number>,
): number {
  let total = 0;
  let count = 0;
  for (const a of indicesA) {
    for (const b of indicesB) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      total += simCache.get(key) ?? 0;
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

function findCentroid(
  members: HarvestedBranch[],
  weights: ClusterConfig["weights"],
): HarvestedBranch {
  if (members.length === 1) return members[0];

  let bestIdx = 0;
  let bestAvg = -1;

  for (let i = 0; i < members.length; i++) {
    let total = 0;
    for (let j = 0; j < members.length; j++) {
      if (i === j) continue;
      total += computeSimilarity(members[i], members[j], weights).total;
    }
    const avg = total / (members.length - 1);
    if (avg > bestAvg) {
      bestAvg = avg;
      bestIdx = i;
    }
  }

  return members[bestIdx];
}

function avgPairwiseSimilarity(
  members: HarvestedBranch[],
  weights: ClusterConfig["weights"],
): number {
  let total = 0;
  let count = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      total += computeSimilarity(members[i], members[j], weights).total;
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

function countOccurrences(arr: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of arr) {
    counts[item] = (counts[item] || 0) + 1;
  }
  return counts;
}
