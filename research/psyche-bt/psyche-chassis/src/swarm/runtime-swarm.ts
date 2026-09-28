/**
 * Runtime Swarm — Spawn-at-point-of-failure.
 *
 * When Flash Lite can't handle a task (BT escalates, no compiled plan matches),
 * instead of calling an expensive model, spawn N Flash Lite instances that each
 * try a different approach. Converge on the best result. Deliver immediately.
 * Record the trace so the nightly trainer can compile it.
 *
 * This replaces the expensive model in most cases:
 *   - 10 Flash Lite calls ≈ cost of 1 Flash call, 1/40th of Pro
 *   - Convergence = quality signal (no judge model needed)
 *   - Successful traces compile into plans for next time
 *
 * Architecture:
 *   1. SPAWN    — Create N independent attempts with varied prompts
 *   2. EXECUTE  — Each attempt generates a response (and optionally tool calls)
 *   3. CONVERGE — Find the dominant response cluster
 *   4. DELIVER  — Return the centroid response from the winning cluster
 *   5. RECORD   — Store the trace for compilation
 *
 * The "varied prompts" are the divergence mechanism. Each instance gets a
 * different approach hint (e.g., "be concise", "ask clarifying questions",
 * "break the problem into steps", "focus on the emotional aspect").
 * This ensures genuine exploration, not N identical attempts.
 */

import type { PersonModel } from "../ecs/types.js";
import type { AgentAction } from "../bt/types.js";
import type { TracedStep } from "../compiler/plan-compiler.js";

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface RuntimeSwarmConfig {
  /** Number of instances to spawn (default 8) */
  instanceCount: number;
  /** Minimum instances that must agree for convergence (default 3) */
  convergenceThreshold: number;
  /** Similarity threshold for grouping responses (0-1, default 0.3) */
  similarityThreshold: number;
  /** Whether to attempt tool calls in swarm instances */
  allowToolCalls: boolean;
  /** Max time per instance (ms) */
  timeoutMs: number;
}

export const DEFAULT_RUNTIME_SWARM_CONFIG: RuntimeSwarmConfig = {
  instanceCount: 8,
  convergenceThreshold: 3,
  similarityThreshold: 0.15,
  allowToolCalls: true,
  timeoutMs: 10000,
};

// =============================================================================
// APPROACH STRATEGIES — the divergence mechanism
// =============================================================================

/**
 * Different approach hints that create genuine variation.
 * Each instance gets a different lens on the same problem.
 */
const APPROACH_STRATEGIES = [
  {
    name: "direct",
    hint: "Give a direct, concise answer. Get to the point immediately.",
  },
  {
    name: "analytical",
    hint: "Break the problem into parts. Analyze each component systematically.",
  },
  {
    name: "empathetic",
    hint: "Focus on understanding the user's underlying need. Address the emotional context.",
  },
  {
    name: "action_oriented",
    hint: "Focus on concrete next steps. What should the user DO right now?",
  },
  {
    name: "creative",
    hint: "Think laterally. Consider unconventional approaches to the problem.",
  },
  {
    name: "cautious",
    hint: "Consider what could go wrong. Address risks and edge cases.",
  },
  {
    name: "tool_focused",
    hint: "Think about what tools could help solve this. Draft a step-by-step tool workflow.",
  },
  {
    name: "contextual",
    hint: "Draw heavily on what you know about this person. Reference their history and preferences.",
  },
  {
    name: "decomposition",
    hint: "The task might be too complex for one step. Break it into smaller sub-tasks.",
  },
  {
    name: "pattern_matching",
    hint: "Think about similar problems you've solved before. Apply known patterns.",
  },
];

// =============================================================================
// SWARM TYPES
// =============================================================================

/** A single swarm instance's attempt at solving the problem. */
export interface SwarmAttempt {
  /** Which approach strategy was used */
  approach: string;
  /** The generated response */
  response: string;
  /** Reasoning behind the response */
  reasoning: string;
  /** Tool calls made (if any) */
  toolCalls: TracedStep[];
  /** The action (for compilation) */
  action: AgentAction;
  /** Elapsed time (ms) */
  elapsedMs: number;
  /** Did this attempt succeed (tool calls worked, response generated)? */
  success: boolean;
}

/** A cluster of similar attempts. */
export interface AttemptCluster {
  /** Attempts in this cluster */
  attempts: SwarmAttempt[];
  /** The centroid attempt (most representative) */
  centroid: SwarmAttempt;
  /** Average similarity within the cluster */
  cohesion: number;
  /** Dominant approach name */
  dominantApproach: string;
}

/** Result of the runtime swarm. */
export interface RuntimeSwarmResult {
  /** The winning response */
  response: string;
  /** The reasoning */
  reasoning: string;
  /** The action (for compilation) */
  action: AgentAction;
  /** Tool calls from the winning attempt */
  toolCalls: TracedStep[];
  /** Did the swarm converge? */
  converged: boolean;
  /** Size of the winning cluster */
  convergenceSize: number;
  /** Total instances spawned */
  instanceCount: number;
  /** Number of distinct clusters formed */
  clusterCount: number;
  /** Which approach won */
  winningApproach: string;
  /** Elapsed time (ms) */
  elapsedMs: number;
}

// =============================================================================
// RUNTIME SWARM EXECUTION
// =============================================================================

/** Handler type — the function that generates a response for one attempt. */
export type SwarmInstanceHandler = (
  userMessage: string,
  model: PersonModel,
  approachHint: string,
) => Promise<{
  response: string;
  reasoning: string;
  action: AgentAction;
  toolCalls?: TracedStep[];
}>;

let swarmHandler: SwarmInstanceHandler | null = null;

/** Set the handler that each swarm instance uses to generate responses. */
export function setSwarmHandler(handler: SwarmInstanceHandler): void {
  swarmHandler = handler;
}

/**
 * Execute the runtime swarm: spawn N instances, converge, deliver.
 *
 * @param userMessage The user's request that couldn't be handled by the BT
 * @param model The person model (shared context, not mutated)
 * @param config Swarm configuration
 */
export async function executeRuntimeSwarm(
  userMessage: string,
  model: PersonModel,
  config: RuntimeSwarmConfig = DEFAULT_RUNTIME_SWARM_CONFIG,
): Promise<RuntimeSwarmResult> {
  if (!swarmHandler) {
    return {
      response: "I'm not sure how to help with that yet.",
      reasoning: "No swarm handler configured",
      action: { type: "respond", content: "I'm not sure how to help with that yet." },
      toolCalls: [],
      converged: false,
      convergenceSize: 0,
      instanceCount: 0,
      clusterCount: 0,
      winningApproach: "none",
      elapsedMs: 0,
    };
  }

  const start = Date.now();

  // 1. SPAWN — generate N attempts with varied approaches
  const approaches = selectApproaches(config.instanceCount);

  // Run all instances in PARALLEL — this is the whole point of the swarm
  const attemptPromises = approaches.map(async (approach) => {
    const attemptStart = Date.now();
    try {
      const result = await swarmHandler!(userMessage, model, approach.hint);
      return {
        approach: approach.name,
        response: result.response,
        reasoning: result.reasoning,
        toolCalls: result.toolCalls || [],
        action: result.action,
        elapsedMs: Date.now() - attemptStart,
        success: true,
      } as SwarmAttempt;
    } catch {
      return {
        approach: approach.name,
        response: "",
        reasoning: "",
        toolCalls: [],
        action: { type: "respond" as const, content: "" },
        elapsedMs: Date.now() - attemptStart,
        success: false,
      } as SwarmAttempt;
    }
  });

  const attempts = await Promise.all(attemptPromises);

  // Filter to successful attempts
  const successful = attempts.filter(a => a.success && a.response.length > 0);
  if (successful.length === 0) {
    return {
      response: "I tried several approaches but couldn't find a good answer. Can you rephrase or give me more context?",
      reasoning: "All swarm instances failed",
      action: { type: "respond", content: "I tried several approaches but couldn't find a good answer." },
      toolCalls: [],
      converged: false,
      convergenceSize: 0,
      instanceCount: attempts.length,
      clusterCount: 0,
      winningApproach: "none",
      elapsedMs: Date.now() - start,
    };
  }

  // 2. CONVERGE — cluster similar responses
  const clusters = clusterAttempts(successful, config.similarityThreshold);

  // Sort by cluster size (largest = most convergent)
  clusters.sort((a, b) => b.attempts.length - a.attempts.length);

  const winner = clusters[0];
  const converged = winner.attempts.length >= config.convergenceThreshold;

  return {
    response: winner.centroid.response,
    reasoning: winner.centroid.reasoning,
    action: winner.centroid.action,
    toolCalls: winner.centroid.toolCalls,
    converged,
    convergenceSize: winner.attempts.length,
    instanceCount: attempts.length,
    clusterCount: clusters.length,
    winningApproach: winner.dominantApproach,
    elapsedMs: Date.now() - start,
  };
}

// =============================================================================
// CLUSTERING — find the dominant response
// =============================================================================

function clusterAttempts(
  attempts: SwarmAttempt[],
  threshold: number,
): AttemptCluster[] {
  // Agglomerative clustering on response similarity
  let clusters: SwarmAttempt[][] = attempts.map(a => [a]);

  let merged = true;
  while (merged) {
    merged = false;
    let bestSim = -1;
    let bestI = -1;
    let bestJ = -1;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const sim = avgClusterSimilarity(clusters[i], clusters[j]);
        if (sim > bestSim) {
          bestSim = sim;
          bestI = i;
          bestJ = j;
        }
      }
    }

    if (bestSim >= threshold && bestI >= 0 && bestJ >= 0) {
      clusters[bestI] = [...clusters[bestI], ...clusters[bestJ]];
      clusters.splice(bestJ, 1);
      merged = true;
    }
  }

  return clusters.map(members => {
    const centroid = findCentroid(members);
    const cohesion = members.length > 1 ? avgPairwiseSim(members) : 1.0;
    const approaches = members.map(m => m.approach);
    const approachCounts = new Map<string, number>();
    for (const a of approaches) approachCounts.set(a, (approachCounts.get(a) || 0) + 1);
    let dominant = "";
    let maxCount = 0;
    for (const [a, c] of approachCounts) {
      if (c > maxCount) { dominant = a; maxCount = c; }
    }

    return { attempts: members, centroid, cohesion, dominantApproach: dominant };
  });
}

function responseSimilarity(a: SwarmAttempt, b: SwarmAttempt): number {
  // Word overlap similarity (same as pattern clusterer)
  const wordsA = new Set(a.response.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(b.response.toLowerCase().split(/\s+/).filter(w => w.length > 3));

  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection++;
  const union = wordsA.size + wordsB.size - intersection;
  const wordSim = union > 0 ? intersection / union : 0;

  // Tool sequence similarity (if both used tools)
  let toolSim = 0;
  if (a.toolCalls.length > 0 && b.toolCalls.length > 0) {
    const toolsA = new Set(a.toolCalls.map(t => t.tool));
    const toolsB = new Set(b.toolCalls.map(t => t.tool));
    let toolIntersection = 0;
    for (const t of toolsA) if (toolsB.has(t)) toolIntersection++;
    const toolUnion = toolsA.size + toolsB.size - toolIntersection;
    toolSim = toolUnion > 0 ? toolIntersection / toolUnion : 0;
  }

  // Combined: 60% response words, 40% tool sequence
  const toolWeight = (a.toolCalls.length > 0 && b.toolCalls.length > 0) ? 0.4 : 0;
  return wordSim * (1 - toolWeight) + toolSim * toolWeight;
}

function avgClusterSimilarity(a: SwarmAttempt[], b: SwarmAttempt[]): number {
  let total = 0;
  let count = 0;
  for (const ai of a) {
    for (const bi of b) {
      total += responseSimilarity(ai, bi);
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

function findCentroid(members: SwarmAttempt[]): SwarmAttempt {
  if (members.length === 1) return members[0];
  let bestIdx = 0;
  let bestAvg = -1;
  for (let i = 0; i < members.length; i++) {
    let total = 0;
    for (let j = 0; j < members.length; j++) {
      if (i !== j) total += responseSimilarity(members[i], members[j]);
    }
    const avg = total / (members.length - 1);
    if (avg > bestAvg) { bestAvg = avg; bestIdx = i; }
  }
  return members[bestIdx];
}

function avgPairwiseSim(members: SwarmAttempt[]): number {
  let total = 0;
  let count = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      total += responseSimilarity(members[i], members[j]);
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

// =============================================================================
// APPROACH SELECTION
// =============================================================================

function selectApproaches(count: number): typeof APPROACH_STRATEGIES {
  const selected: typeof APPROACH_STRATEGIES = [];
  for (let i = 0; i < count; i++) {
    selected.push(APPROACH_STRATEGIES[i % APPROACH_STRATEGIES.length]);
  }
  return selected;
}
