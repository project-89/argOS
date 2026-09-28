/**
 * Swarm Runner Types — Multi-instance parallel learning + species tree synthesis.
 *
 * ============================================================================
 * ARCHITECTURE
 * ============================================================================
 *
 * The swarm runner implements COLLECTIVE LEARNING: N independent agent instances
 * each learn from varied conversation tasks, then their compiled BT branches are
 * harvested, clustered by similarity, and merged into a SPECIES TREE — a
 * collective bootstrap that encodes patterns discovered across the entire swarm.
 *
 * Pipeline:
 *   1. GENERATE   — Create N conversation variants from seed templates
 *   2. SPAWN      — Run N PersonModel instances through their variants
 *   3. HARVEST    — Extract compiled branches from all instance trees
 *   4. CLUSTER    — Group similar branches by condition/intent/topic overlap
 *   5. MERGE      — Build species tree from convergent clusters
 *   6. EVALUATE   — Benchmark species tree vs individuals vs bootstrap-only
 *
 * Why this works:
 *   - Each instance explores a different region of the conversation space
 *   - The immune system filters bad patterns per-instance
 *   - Cross-instance convergence is a SECOND quality signal: if 8/10 instances
 *     independently compile a "stress + work → acknowledge + prioritize" pattern,
 *     that's strong evidence it's a good pattern
 *   - The species tree inherits the best of all instances while discarding noise
 *
 * ============================================================================
 * HYPOTHESES (testable predictions)
 * ============================================================================
 *
 * H1: CONVERGENCE — Independent instances facing similar tasks will independently
 *     compile similar strategies. Measured by: avg cluster size > 1.5 for N=10.
 *
 * H2: SPECIES IMPROVEMENT — The species tree will have lower escalation rate on
 *     the benchmark than any single instance's tree. Measured by: species
 *     escalation rate < mean(individual escalation rates).
 *
 * H3: DIVERSITY — The species tree will handle more benchmark categories without
 *     escalation than any individual tree. Measured by: species category coverage
 *     >= max(individual category coverages).
 *
 * H4: QUALITY FILTER — Patterns compiled by multiple instances (high convergence)
 *     will have higher quality scores than singleton patterns. Measured by:
 *     mean quality of converged patterns > mean quality of singletons.
 *
 * H5: DIMINISHING RETURNS — Doubling instances from N to 2N yields less than
 *     double the improvement. Measured by: delta(escalation) from N=5→10 >
 *     delta(escalation) from N=10→20.
 *
 * ============================================================================
 */

import type { BehaviorNode, ConditionOp, ResponseStrategy, CompiledBranch } from "../bt/types.js";
import type { PersonModel } from "../ecs/types.js";

// =============================================================================
// TASK GENERATION
// =============================================================================

/** A multi-turn conversation script for one instance to execute. */
export interface ConversationScript {
  id: string;
  category: string;
  messages: string[];
  /** Human-readable description of what this variant explores */
  description: string;
}

/** Configuration for generating task variants. */
export interface TaskGenConfig {
  /** Number of variants to generate */
  count: number;
  /** Turns per conversation */
  turnsPerConversation: number;
  /** Categories to include (empty = all) */
  categories?: string[];
  /** Random seed for reproducibility */
  seed?: number;
}

// =============================================================================
// SWARM EXECUTION
// =============================================================================

/** Configuration for a swarm run. */
export interface SwarmConfig {
  /** Number of parallel instances */
  instanceCount: number;
  /** Turns per instance conversation */
  turnsPerInstance: number;
  /** Categories to include */
  categories?: string[];
  /** Concurrency limit (sequential if 1) */
  concurrency: number;
  /** Random seed */
  seed?: number;
}

/** Result from a single instance's learning session. */
export interface InstanceResult {
  instanceId: string;
  model: PersonModel;
  /** Conversation messages processed */
  turnsProcessed: number;
  /** How many escalations occurred */
  escalations: number;
  /** How many branches the immune system compiled */
  compiledCount: number;
  /** Total nodes in the final tree */
  treeNodes: number;
  /** Elapsed wall time (ms) */
  elapsedMs: number;
}

/** Aggregate result from the entire swarm. */
export interface SwarmResult {
  config: SwarmConfig;
  instances: InstanceResult[];
  totalBranches: number;
  totalEscalations: number;
  totalTurns: number;
  elapsedMs: number;
}

// =============================================================================
// BRANCH HARVESTING
// =============================================================================

/** A compiled branch extracted from an instance's tree, with provenance. */
export interface HarvestedBranch {
  /** Unique ID */
  id: string;
  /** Which instance compiled this */
  sourceInstance: string;
  /** The BT node (sequence of conditions + strategy) */
  node: BehaviorNode;
  /** Extracted conditions for clustering */
  conditions: ConditionOp[];
  /** The strategy (if present) */
  strategy?: ResponseStrategy;
  /** Topic tags from conditions */
  topics: string[];
  /** Emotional state from conditions */
  emotionalState?: string;
  /** Intent label from strategy */
  intent?: string;
}

/** Result of the harvest phase. */
export interface HarvestResult {
  branches: HarvestedBranch[];
  /** How many instances contributed branches */
  contributingInstances: number;
  /** Branches per instance (mean) */
  avgBranchesPerInstance: number;
}

// =============================================================================
// CLUSTERING
// =============================================================================

/** A cluster of similar branches from across instances. */
export interface BranchCluster {
  /** Cluster ID */
  id: string;
  /** All branches in this cluster */
  branches: HarvestedBranch[];
  /** How many distinct instances contributed to this cluster */
  instanceCount: number;
  /** Centroid: the most representative branch */
  centroid: HarvestedBranch;
  /** Average pairwise similarity within the cluster */
  cohesion: number;
  /** Dominant topic(s) across cluster members */
  topics: string[];
  /** Dominant intent across cluster members */
  intent: string;
  /** Dominant emotional state */
  emotionalState?: string;
  /** Convergence score: instanceCount / totalInstances */
  convergenceScore: number;
}

/** Pairwise similarity between two branches. */
export interface SimilarityScore {
  branchA: string;
  branchB: string;
  conditionOverlap: number;  // Jaccard of condition types+values
  intentSimilarity: number;  // String similarity of intent labels
  topicOverlap: number;      // Jaccard of topic sets
  total: number;             // Weighted average
}

/** Configuration for clustering. */
export interface ClusterConfig {
  /** Minimum similarity to merge two branches (0-1) */
  similarityThreshold: number;
  /** Minimum cluster size to include in species tree */
  minClusterSize: number;
  /** Weights for similarity components */
  weights: {
    condition: number;
    intent: number;
    topic: number;
  };
}

/** Result of the clustering phase. */
export interface ClusterResult {
  clusters: BranchCluster[];
  /** Singleton branches (not clustered) */
  singletons: HarvestedBranch[];
  /** Average cluster size */
  avgClusterSize: number;
  /** Fraction of branches that clustered (vs singleton) */
  clusteringRate: number;
  /** Number of clusters with branches from 2+ instances */
  convergentClusters: number;
}

// =============================================================================
// SPECIES TREE
// =============================================================================

/** A species-level branch synthesized from a cluster. */
export interface SpeciesBranch {
  /** Source cluster */
  clusterId: string;
  /** The merged BT node */
  node: BehaviorNode;
  /** How many instances converged on this pattern */
  convergence: number;
  /** Topics covered */
  topics: string[];
  /** Intent */
  intent: string;
}

/** The species tree + metadata. */
export interface SpeciesTree {
  /** The behavior tree root */
  tree: BehaviorNode;
  /** Individual species branches that were merged in */
  branches: SpeciesBranch[];
  /** Total nodes */
  totalNodes: number;
  /** How many clusters contributed */
  clusterCount: number;
  /** Mean convergence across branches */
  avgConvergence: number;
}

// =============================================================================
// EVALUATION
// =============================================================================

/** Comparative evaluation results. */
export interface SwarmEvaluation {
  /** Species tree benchmark */
  speciesEscalationRate: number;
  speciesCategoryCoverage: number;
  speciesTreeNodes: number;

  /** Bootstrap-only benchmark */
  bootstrapEscalationRate: number;
  bootstrapCategoryCoverage: number;

  /** Individual instance benchmarks */
  individualEscalationRates: number[];
  individualCategoryCoverages: number[];
  bestIndividualEscalation: number;
  meanIndividualEscalation: number;

  /** Hypothesis verdicts */
  hypotheses: {
    H1_convergence: { pass: boolean; metric: string; value: number };
    H2_speciesImprovement: { pass: boolean; metric: string; value: number };
    H3_diversity: { pass: boolean; metric: string; value: number };
    H4_qualityFilter: { pass: boolean; metric: string; value: number };
    H5_diminishingReturns: { pass: boolean; metric: string; value: number } | null;
  };

  /** Swarm metadata */
  instanceCount: number;
  totalBranchesHarvested: number;
  clustersFormed: number;
  convergentClusters: number;
  elapsedMs: number;
}
