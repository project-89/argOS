/**
 * Swarm Agent — The standalone Swarm-BT agent.
 *
 * This IS the agent. Not a wrapper around an LLM — a recursive swarm
 * that plans, executes, and learns via BT compilation.
 *
 * Architecture:
 *   1. BT Check    — compiled solution? Execute free.
 *   2. Swarm Plan  — N Flash Lite instances independently plan.
 *                    Converge on approach. No convergence? Flash fallback.
 *   3. Swarm Exec  — Execute plan step-by-step. Each step can:
 *                    - Use tools directly
 *                    - Spawn micro-swarm for reasoning
 *                    - Recursively decompose into sub-tasks
 *   4. Compile     — Successful execution → BT branch.
 *                    Next time: direct execution, no swarm needed.
 *
 * The agent improves with every task. The first time a task type is seen,
 * the swarm explores. The second time, the BT handles it.
 */

import { ai, RUNTIME_MODEL, REASONING_MODEL } from "../models/config.js";
import { registerAgentTools, AGENT_TOOL_PROMPT } from "./agent-tools.js";
import { swarmPlan, flashPlan } from "./swarm-planner.js";
import { executePlan } from "./swarm-executor.js";
import { executeTool } from "../tools/registry.js";
import type { SwarmPlan } from "./swarm-planner.js";
import type { ExecutionResult } from "./swarm-executor.js";

// =============================================================================
// TYPES
// =============================================================================

export interface AgentConfig {
  /** Number of planning swarm instances (default 5) */
  planSwarmSize: number;
  /** Convergence threshold for planning (default 3) */
  planConvergence: number;
  /** Number of execution micro-swarm instances (default 3) */
  execSwarmSize: number;
  /** Max recursive decomposition depth (default 2) */
  maxDepth: number;
  /** Whether to use Flash fallback (default true) */
  allowFlashFallback: boolean;
  /** Whether to try single-shot before planning (for simple tasks) */
  trySingleShot: boolean;
  /** Model for swarm instances */
  swarmModel: string;
  /** Model for Flash fallback */
  flashModel: string;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  planSwarmSize: 5,
  planConvergence: 3,
  execSwarmSize: 3,
  maxDepth: 2,
  allowFlashFallback: true,
  trySingleShot: true,
  swarmModel: RUNTIME_MODEL,
  flashModel: REASONING_MODEL,
};

export interface AgentResult {
  /** The final answer */
  answer: string;
  /** How the answer was produced */
  source: "single_shot" | "swarm_converged" | "flash_fallback" | "error";
  /** The plan that was executed (if any) */
  plan: SwarmPlan | null;
  /** Execution details */
  execution: ExecutionResult | null;
  /** Total LLM calls */
  totalLlmCalls: number;
  /** Total tool calls */
  totalToolCalls: number;
  /** Elapsed time */
  elapsedMs: number;
  /** Whether Flash was used */
  usedFlash: boolean;
  /** Swarm convergence info */
  convergence: {
    attempted: boolean;
    converged: boolean;
    agreementCount: number;
    totalInstances: number;
    clusterCount: number;
  };
}

// =============================================================================
// AGENT EXECUTION
// =============================================================================

import { evaluateBT } from "../bt/evaluator.js";
import { swarmOrchestratorTree } from "./orchestrator-tree.js";
import { registerSwarmNodes } from "../bt/swarm-nodes.js";

let swarmNodesRegistered = false;
let toolsRegistered = false;

/**
 * Run the Swarm-BT agent on a task.
 *
 * This is the main entry point. It uses the Behavior Tree orchestrator
 * to decide how to handle the task (Single Shot, Swarm Plan, or Flash Fallback).
 */
export async function runAgent(
  task: string,
  context: string = "",
  config: Partial<AgentConfig> = {},
): Promise<AgentResult> {
  const cfg = { ...DEFAULT_AGENT_CONFIG, ...config };
  const start = Date.now();

  // Ensure tools and swarm nodes are registered
  if (!toolsRegistered) {
    registerAgentTools();
    toolsRegistered = true;
  }
  if (!swarmNodesRegistered) {
    registerSwarmNodes();
    swarmNodesRegistered = true;
  }

  // Initialize blackboard for state passing
  const blackboard: Record<string, any> = {
    task,
    context,
    config: cfg,
  };

  // Mock person model for BT signature (not used by swarm nodes)
  const mockModel: any = {
    id: "system",
    lore: [],
    hypotheses: [],
    conversationState: {},
  };

  console.log(`\n🧠 [Agent] Ticking Swarm Orchestrator Tree for task: "${task.slice(0, 60)}..."`);

  // Tick the tree!
  const btResult = await evaluateBT(swarmOrchestratorTree, mockModel, task, blackboard);

  // Extract results from blackboard
  const plan = blackboard.plan || null;
  const execution = blackboard.executionResult || null;
  const convergence = blackboard.convergence || { attempted: false, converged: false, agreementCount: 0, totalInstances: 0, clusterCount: 0 };

  let source: AgentResult["source"] = "swarm_converged";
  if (blackboard.finalAnswer) {
    source = "swarm_converged";
  } else if (btResult.kind === "escalate") {
    // Fallback triggered
    console.log("⚠️ [Agent] BT escalated to Flash fallback.");
    const fallbackResult = await runFlashBaseline(task, context);
    return {
      ...fallbackResult,
      source: "flash_fallback",
      elapsedMs: Date.now() - start,
    };
  }

  return {
    answer: blackboard.finalAnswer || "I was unable to solve this task.",
    source,
    plan,
    execution,
    totalLlmCalls: (blackboard.convergence?.totalInstances || 0) + (blackboard.executionResult?.totalLlmCalls || 0),
    totalToolCalls: blackboard.executionResult?.totalToolCalls || 0,
    elapsedMs: Date.now() - start,
    usedFlash: false,
    convergence: {
      attempted: convergence.attempted || false,
      converged: convergence.converged || false,
      agreementCount: convergence.agreementCount || 0,
      totalInstances: convergence.totalInstances || 0,
      clusterCount: convergence.clusterCount || 0,
    },
  };
}

// =============================================================================
// SINGLE-SHOT — for simple tasks that don't need planning
// =============================================================================

/**
 * Try to solve the task with a single micro-swarm (no planning phase).
 * Returns null if the task seems too complex for single-shot.
 */
async function trySingleShot(
  task: string,
  context: string,
  config: AgentConfig,
): Promise<{ answer: string; llmCalls: number; toolCalls: number } | null> {
  const prompt = `You are a helpful assistant. Answer the following task directly.
If the task is complex and requires multiple steps, respond EXACTLY with: "NEEDS_PLANNING"
If you can answer directly, give your answer.

${context ? `Context:\n${context}\n` : ""}
${AGENT_TOOL_PROMPT}

Task: ${task}`;

  // Spawn micro-swarm for single-shot
  const attempts = await Promise.all(
    Array.from({ length: config.execSwarmSize }, async () => {
      try {
        const response = await ai.models.generateContent({
          model: config.swarmModel,
          contents: prompt,
          config: { temperature: 0.5 + (Math.random() * 0.5), maxOutputTokens: 2000 },
        });
        return response.text ?? "";
      } catch {
        return "";
      }
    })
  );

  const valid = attempts.filter(a => a.length > 0);
  if (valid.length === 0) return null;

  // Check if any instance says NEEDS_PLANNING
  const needsPlanning = valid.some(a => a.includes("NEEDS_PLANNING"));
  if (needsPlanning) return null;

  // Check for tool calls in any response
  let toolCalls = 0;
  for (const attempt of valid) {
    const toolCall = extractToolCall(attempt);
    if (toolCall) {
      const result = await executeTool(toolCall.tool, toolCall.params);
      toolCalls++;
      if (result.success) {
        return { answer: result.output, llmCalls: valid.length, toolCalls };
      }
    }
  }

  // Find the most representative response (convergence)
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < valid.length; i++) {
    let score = 0;
    for (let j = 0; j < valid.length; j++) {
      if (i !== j) score += textSimilarity(valid[i], valid[j]);
    }
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }

  return { answer: valid[bestIdx], llmCalls: valid.length, toolCalls };
}

// =============================================================================
// HELPERS
// =============================================================================

function extractToolCall(text: string): { tool: string; params: Record<string, string> } | null {
  const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      if (parsed.tool && typeof parsed.tool === "string") {
        return { tool: parsed.tool, params: parsed.params || {} };
      }
    } catch { /* not valid JSON */ }
  }
  return null;
}

function textSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  let overlap = 0;
  for (const w of wordsA) if (wordsB.has(w)) overlap++;
  const union = wordsA.size + wordsB.size - overlap;
  return union > 0 ? overlap / union : 0;
}

// =============================================================================
// CONVENIENCE — run three agent configurations for benchmarking
// =============================================================================

/**
 * Run a single Flash instance (baseline) — standard ReAct agent.
 */
export async function runFlashBaseline(
  task: string,
  context: string = "",
): Promise<AgentResult> {
  const start = Date.now();
  registerAgentTools();

  const prompt = `You are a helpful assistant. Solve the following task.

${context ? `Context:\n${context}\n` : ""}
${AGENT_TOOL_PROMPT}

Task: ${task}

Think step by step and provide your answer.`;

  let answer = "";
  let toolCalls = 0;
  let llmCalls = 0;

  // ReAct loop: LLM → tool → LLM → tool → ... → final answer
  let currentPrompt = prompt;
  for (let i = 0; i < 5; i++) { // max 5 iterations
    llmCalls++;
    try {
      const response = await ai.models.generateContent({
        model: REASONING_MODEL,
        contents: currentPrompt,
        config: { temperature: 0.3, maxOutputTokens: 3000 },
      });
      const text = response.text ?? "";

      const toolCall = extractToolCall(text);
      if (toolCall) {
        toolCalls++;
        const result = await executeTool(toolCall.tool, toolCall.params);
        currentPrompt += `\n\nTool result (${toolCall.tool}): ${result.success ? result.output : result.error}\n\nContinue solving the task based on this result.`;
      } else {
        answer = text;
        break;
      }
    } catch {
      answer = "Error: Flash baseline failed";
      break;
    }
  }

  return {
    answer,
    source: "flash_fallback",
    plan: null,
    execution: null,
    totalLlmCalls: llmCalls,
    totalToolCalls: toolCalls,
    elapsedMs: Date.now() - start,
    usedFlash: true,
    convergence: { attempted: false, converged: false, agreementCount: 0, totalInstances: 0, clusterCount: 0 },
  };
}
