/**
 * Swarm Planner — Divergent planning via swarm convergence.
 *
 * Given a task, spawns N Flash Lite instances that each independently
 * produce a plan (list of steps). Plans are clustered by structural
 * similarity. The converged plan is returned, or "needs escalation"
 * if no convergence.
 *
 * This is the "thinking" layer of the Swarm-BT agent. The swarm's
 * collective intelligence replaces single-model chain-of-thought.
 */

import { ai, RUNTIME_MODEL, REASONING_MODEL } from "../models/config.js";
import { AGENT_TOOL_PROMPT } from "./agent-tools.js";

// =============================================================================
// TYPES
// =============================================================================

export interface PlanStep {
  /** Step number (1-indexed) */
  stepNumber: number;
  /** What to do in this step */
  description: string;
  /** Which tool to use (if any) */
  tool?: string;
  /** Tool parameters (if any) */
  toolParams?: Record<string, string>;
  /** Expected output of this step */
  expectedOutput?: string;
  /** Is this step complex enough to need sub-decomposition? */
  needsDecomposition?: boolean;
}

export interface SwarmPlan {
  /** The overall goal */
  goal: string;
  /** Ordered list of steps */
  steps: PlanStep[];
  /** The approach strategy that generated this plan */
  approach: string;
  /** Raw reasoning from the instance */
  reasoning: string;
}

export interface PlanConvergenceResult {
  /** The converged plan (if convergence achieved) */
  plan: SwarmPlan | null;
  /** Did the swarm converge? */
  converged: boolean;
  /** Number of instances that agreed */
  agreementCount: number;
  /** Total instances spawned */
  totalInstances: number;
  /** Number of distinct plan clusters */
  clusterCount: number;
  /** All generated plans (for debugging) */
  allPlans: SwarmPlan[];
  /** Elapsed time */
  elapsedMs: number;
}

// =============================================================================
// PLANNING APPROACH STRATEGIES
// =============================================================================

const PLANNING_APPROACHES = [
  {
    name: "systematic",
    hint: "Break the task into clear, ordered steps. Be thorough and methodical.",
  },
  {
    name: "minimal",
    hint: "Find the simplest possible approach. Minimize the number of steps.",
  },
  {
    name: "tool_first",
    hint: "Think about which tools would help. Design the plan around tool usage.",
  },
  {
    name: "decompose",
    hint: "If the task is complex, break it into independent sub-tasks first.",
  },
  {
    name: "verify",
    hint: "Include verification steps. How will you check your work?",
  },
];

// =============================================================================
// SWARM PLANNING
// =============================================================================

/**
 * Spawn N Flash Lite instances to independently plan a task.
 * Returns the converged plan or null if no convergence.
 */
export async function swarmPlan(
  task: string,
  context: string = "",
  config: {
    instanceCount?: number;
    convergenceThreshold?: number;
    model?: string;
  } = {},
): Promise<PlanConvergenceResult> {
  const instanceCount = config.instanceCount ?? 5;
  const threshold = config.convergenceThreshold ?? 3;
  const model = config.model ?? RUNTIME_MODEL;
  const start = Date.now();

  // Select approach strategies
  const approaches = [];
  for (let i = 0; i < instanceCount; i++) {
    approaches.push(PLANNING_APPROACHES[i % PLANNING_APPROACHES.length]);
  }

  // Spawn all instances in parallel
  const planPromises = approaches.map(async (approach) => {
    try {
      return await generatePlan(task, context, approach, model);
    } catch {
      return null;
    }
  });

  const rawPlans = await Promise.all(planPromises);
  const plans = rawPlans.filter((p): p is SwarmPlan => p !== null && p.steps.length > 0);

  if (plans.length === 0) {
    return {
      plan: null,
      converged: false,
      agreementCount: 0,
      totalInstances: instanceCount,
      clusterCount: 0,
      allPlans: [],
      elapsedMs: Date.now() - start,
    };
  }

  // Cluster plans by structural similarity
  const clusters = clusterPlans(plans);
  clusters.sort((a, b) => b.length - a.length);

  const winningCluster = clusters[0];
  const converged = winningCluster.length >= threshold;

  // Pick the most representative plan from the winning cluster
  const bestPlan = converged ? selectBestPlan(winningCluster) : null;

  return {
    plan: bestPlan,
    converged,
    agreementCount: winningCluster.length,
    totalInstances: instanceCount,
    clusterCount: clusters.length,
    allPlans: plans,
    elapsedMs: Date.now() - start,
  };
}

/**
 * Escalate to Flash for planning when the swarm can't converge.
 */
export async function flashPlan(
  task: string,
  context: string = "",
): Promise<SwarmPlan | null> {
  return generatePlan(task, context, { name: "flash_escalation", hint: "Think carefully and thoroughly." }, REASONING_MODEL);
}

// =============================================================================
// PLAN GENERATION (single instance)
// =============================================================================

async function generatePlan(
  task: string,
  context: string,
  approach: { name: string; hint: string },
  model: string,
): Promise<SwarmPlan | null> {
  const prompt = `You are a task planner. Given a task, create a concrete plan as a list of steps.

${approach.hint}

${context ? `Context:\n${context}\n` : ""}
${AGENT_TOOL_PROMPT}

Task: ${task}

Respond with a JSON object:
\`\`\`json
{
  "reasoning": "Your analysis of the task and approach",
  "steps": [
    {
      "stepNumber": 1,
      "description": "What to do",
      "tool": "tool_name_if_needed",
      "toolParams": {"param": "value"},
      "expectedOutput": "What this step should produce"
    }
  ]
}
\`\`\`

Keep plans focused. Use tools when they help. Each step should be concrete and executable.`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0.8 + (Math.random() * 0.4), // 0.8-1.2 for diversity
        maxOutputTokens: 2000,
      },
    });

    const text = response.text ?? "";
    const parsed = extractJSON(text);

    if (!parsed || !Array.isArray(parsed.steps)) return null;

    return {
      goal: task,
      steps: parsed.steps.map((s: any, i: number) => ({
        stepNumber: s.stepNumber ?? i + 1,
        description: s.description ?? "",
        tool: s.tool,
        toolParams: s.toolParams,
        expectedOutput: s.expectedOutput,
        needsDecomposition: s.needsDecomposition,
      })),
      approach: approach.name,
      reasoning: parsed.reasoning ?? "",
    };
  } catch {
    return null;
  }
}

// =============================================================================
// PLAN CLUSTERING
// =============================================================================

function clusterPlans(plans: SwarmPlan[]): SwarmPlan[][] {
  // Simple agglomerative clustering on plan structure similarity
  let clusters: SwarmPlan[][] = plans.map(p => [p]);

  let merged = true;
  while (merged) {
    merged = false;
    let bestSim = -1;
    let bestI = -1;
    let bestJ = -1;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const sim = avgClusterPlanSimilarity(clusters[i], clusters[j]);
        if (sim > bestSim) {
          bestSim = sim;
          bestI = i;
          bestJ = j;
        }
      }
    }

    // Merge if similarity > 0.3
    if (bestSim >= 0.3 && bestI >= 0 && bestJ >= 0) {
      clusters[bestI] = [...clusters[bestI], ...clusters[bestJ]];
      clusters.splice(bestJ, 1);
      merged = true;
    }
  }

  return clusters;
}

function planSimilarity(a: SwarmPlan, b: SwarmPlan): number {
  // 1. Step count similarity (40%)
  const maxSteps = Math.max(a.steps.length, b.steps.length);
  const minSteps = Math.min(a.steps.length, b.steps.length);
  const stepCountSim = maxSteps > 0 ? minSteps / maxSteps : 1;

  // 2. Tool sequence similarity (40%)
  const toolsA = a.steps.filter(s => s.tool).map(s => s.tool!);
  const toolsB = b.steps.filter(s => s.tool).map(s => s.tool!);
  const toolSetA = new Set(toolsA);
  const toolSetB = new Set(toolsB);
  let toolIntersection = 0;
  for (const t of toolSetA) if (toolSetB.has(t)) toolIntersection++;
  const toolUnion = toolSetA.size + toolSetB.size - toolIntersection;
  const toolSim = toolUnion > 0 ? toolIntersection / toolUnion : (toolsA.length === 0 && toolsB.length === 0 ? 1 : 0);

  // 3. Description keyword overlap (20%)
  const wordsA = new Set(a.steps.flatMap(s => s.description.toLowerCase().split(/\s+/).filter(w => w.length > 3)));
  const wordsB = new Set(b.steps.flatMap(s => s.description.toLowerCase().split(/\s+/).filter(w => w.length > 3)));
  let wordOverlap = 0;
  for (const w of wordsA) if (wordsB.has(w)) wordOverlap++;
  const wordUnion = wordsA.size + wordsB.size - wordOverlap;
  const wordSim = wordUnion > 0 ? wordOverlap / wordUnion : 0;

  return stepCountSim * 0.4 + toolSim * 0.4 + wordSim * 0.2;
}

function avgClusterPlanSimilarity(a: SwarmPlan[], b: SwarmPlan[]): number {
  let total = 0;
  let count = 0;
  for (const ai of a) {
    for (const bi of b) {
      total += planSimilarity(ai, bi);
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

function selectBestPlan(cluster: SwarmPlan[]): SwarmPlan {
  // Pick the plan most similar to all others in the cluster (centroid)
  if (cluster.length === 1) return cluster[0];
  let bestIdx = 0;
  let bestAvg = -1;
  for (let i = 0; i < cluster.length; i++) {
    let total = 0;
    for (let j = 0; j < cluster.length; j++) {
      if (i !== j) total += planSimilarity(cluster[i], cluster[j]);
    }
    const avg = total / (cluster.length - 1);
    if (avg > bestAvg) { bestAvg = avg; bestIdx = i; }
  }
  return cluster[bestIdx];
}

// =============================================================================
// JSON EXTRACTION
// =============================================================================

function extractJSON(text: string): any {
  // Try to find JSON in code blocks first
  const blockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (blockMatch) {
    try { return JSON.parse(blockMatch[1].trim()); } catch { /* fall through */ }
  }
  // Try to find raw JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }
  }
  return null;
}
