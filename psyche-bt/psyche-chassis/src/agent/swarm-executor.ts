/**
 * Swarm Executor — Step-by-step plan execution with recursive decomposition.
 *
 * Given a converged plan from swarm-planner, executes each step:
 *   1. Check if BT has a compiled solution for this step type
 *   2. If not, spawn a micro-swarm for the step
 *   3. If step needs a tool, execute the tool
 *   4. If step is too complex, recursively decompose via swarm
 *   5. Track success/failure per step, re-plan on failure
 *
 * The executor is the "hands" — it turns plans into actions and results.
 */

import { ai, RUNTIME_MODEL } from "../models/config.js";
import { executeTool } from "../tools/registry.js";
import type { ToolResult } from "../tools/registry.js";
import { AGENT_TOOL_PROMPT } from "./agent-tools.js";
import { swarmPlan, flashPlan } from "./swarm-planner.js";
import type { SwarmPlan, PlanStep } from "./swarm-planner.js";
import {
  createSwarmContext,
  addPlanningContext,
  addStepResult,
  recordTaskOutcome,
  assembleContext,
  buildStepPrompt,
} from "./swarm-context.js";

// =============================================================================
// TYPES
// =============================================================================

export interface StepResult {
  step: PlanStep;
  success: boolean;
  output: string;
  toolResults: ToolResult[];
  /** If this step was decomposed into sub-steps */
  subSteps?: StepResult[];
  /** LLM calls used for this step */
  llmCalls: number;
  elapsedMs: number;
}

export interface ExecutionResult {
  /** Overall success */
  success: boolean;
  /** Final answer/output */
  finalAnswer: string;
  /** Results per step */
  stepResults: StepResult[];
  /** Total LLM calls across all steps */
  totalLlmCalls: number;
  /** Total tool calls */
  totalToolCalls: number;
  /** Elapsed time */
  elapsedMs: number;
  /** Whether Flash was used (escalation) */
  usedFlash: boolean;
  /** The plan that was executed */
  plan: SwarmPlan;
}

export interface ExecutionConfig {
  /** Max recursion depth for sub-decomposition (default 2) */
  maxDepth: number;
  /** Swarm size for step execution (default 3) */
  stepSwarmSize: number;
  /** Convergence threshold for step swarm (default 2) */
  stepConvergence: number;
  /** Model to use for step execution */
  model: string;
}

const DEFAULT_EXEC_CONFIG: ExecutionConfig = {
  maxDepth: 2,
  stepSwarmSize: 3,
  stepConvergence: 2,
  model: RUNTIME_MODEL,
};

// =============================================================================
// PLAN EXECUTION
// =============================================================================

/**
 * Execute a converged plan step-by-step.
 *
 * Each step can:
 *   - Use a tool directly (if the plan specifies one)
 *   - Spawn a micro-swarm for reasoning
 *   - Recursively decompose into sub-steps
 *
 * Context flows through using SwarmContext:
 *   - Planning reasoning feeds into execution
 *   - Step results accumulate for later steps
 *   - Task outcomes are recorded to working memory
 */
export async function executePlan(
  plan: SwarmPlan,
  context: string = "",
  config: Partial<ExecutionConfig> = {},
): Promise<ExecutionResult> {
  const cfg = { ...DEFAULT_EXEC_CONFIG, ...config };
  const start = Date.now();
  const stepResults: StepResult[] = [];
  let totalLlmCalls = 0;
  let totalToolCalls = 0;
  let usedFlash = false;

  // Build structured context
  const ctx = createSwarmContext(plan.goal);
  if (plan.reasoning) {
    addPlanningContext(ctx, plan.reasoning, plan.approach);
  }

  for (const step of plan.steps) {
    const stepStart = Date.now();
    // Build context string with all accumulated step results
    const stepContext = assembleContext(ctx);
    let result: StepResult;

    if (step.tool) {
      // Direct tool execution
      result = await executeToolStep(step, stepContext, cfg);
    } else if (step.needsDecomposition && cfg.maxDepth > 0) {
      // Recursive decomposition
      result = await executeDecomposedStep(step, stepContext, cfg);
    } else {
      // Reasoning step — use micro-swarm
      result = await executeReasoningStep(step, stepContext, cfg);
    }

    result.elapsedMs = Date.now() - stepStart;
    stepResults.push(result);
    totalLlmCalls += result.llmCalls;
    totalToolCalls += result.toolResults.length;

    // Record step result into structured context
    addStepResult(
      ctx,
      step.stepNumber,
      step.description,
      result.output,
      result.success,
      result.toolResults.map(t => t.success ? "✓" : "✗"),
    );
  }

  // Synthesize final answer from all step results
  const finalAnswer = await synthesizeFinalAnswer(plan, stepResults, cfg.model);
  totalLlmCalls += 1; // synthesis call

  // Record outcome to working memory
  const success = stepResults.some(r => r.success);
  recordTaskOutcome(
    plan.goal,
    success ? "success" : "failure",
    success
      ? `Used ${plan.approach} approach with ${plan.steps.length} steps`
      : `Failed with ${plan.approach} approach`,
  );

  return {
    success,
    finalAnswer,
    stepResults,
    totalLlmCalls,
    totalToolCalls,
    elapsedMs: Date.now() - start,
    usedFlash,
    plan,
  };
}

// =============================================================================
// STEP EXECUTION STRATEGIES
// =============================================================================

/**
 * Execute a step that requires a tool call.
 */
async function executeToolStep(
  step: PlanStep,
  context: string,
  config: ExecutionConfig,
): Promise<StepResult> {
  const toolResult = await executeTool(step.tool!, step.toolParams || {});
  return {
    step,
    success: toolResult.success,
    output: toolResult.success ? toolResult.output : (toolResult.error || "Tool execution failed"),
    toolResults: [toolResult],
    llmCalls: 0,
    elapsedMs: 0,
  };
}

/**
 * Execute a reasoning step via micro-swarm.
 * Spawns a small swarm to solve the step, converges on answer.
 */
async function executeReasoningStep(
  step: PlanStep,
  context: string,
  config: ExecutionConfig,
): Promise<StepResult> {
  const prompt = `Complete this step of a larger plan.

Step: ${step.description}
${step.expectedOutput ? `Expected output: ${step.expectedOutput}` : ""}

Context from previous steps:
${context}

${AGENT_TOOL_PROMPT}

Respond with your result. If you need to use a tool, output a JSON tool call.
Otherwise, give your answer directly.`;

  // Spawn micro-swarm
  const attempts = await Promise.all(
    Array.from({ length: config.stepSwarmSize }, async () => {
      try {
        const response = await ai.models.generateContent({
          model: config.model,
          contents: prompt,
          config: {
            temperature: 0.7 + (Math.random() * 0.5),
            maxOutputTokens: 2000,
          },
        });
        return response.text ?? "";
      } catch {
        return "";
      }
    })
  );

  const valid = attempts.filter(a => a.length > 0);
  if (valid.length === 0) {
    return {
      step,
      success: false,
      output: "All swarm instances failed for this step",
      toolResults: [],
      llmCalls: config.stepSwarmSize,
      elapsedMs: 0,
    };
  }

  // Check if any attempts contain tool calls
  const toolResults: ToolResult[] = [];
  let bestOutput = "";

  for (const attempt of valid) {
    const toolCall = extractToolCall(attempt);
    if (toolCall) {
      const result = await executeTool(toolCall.tool, toolCall.params);
      toolResults.push(result);
      if (result.success) {
        bestOutput = result.output;
        break; // Tool succeeded, use this result
      }
    }
  }

  // If no tool calls, pick the most common response (convergence)
  if (!bestOutput) {
    bestOutput = findMostCommonResponse(valid);
  }

  return {
    step,
    success: bestOutput.length > 0,
    output: bestOutput,
    toolResults,
    llmCalls: config.stepSwarmSize,
    elapsedMs: 0,
  };
}

/**
 * Execute a complex step by recursively decomposing it.
 */
async function executeDecomposedStep(
  step: PlanStep,
  context: string,
  config: ExecutionConfig,
): Promise<StepResult> {
  // Plan the sub-task
  const subPlanResult = await swarmPlan(
    step.description,
    context,
    { instanceCount: 3, convergenceThreshold: 2, model: config.model }
  );

  if (!subPlanResult.converged || !subPlanResult.plan) {
    // Can't decompose — try as a single reasoning step instead
    return executeReasoningStep(step, context, config);
  }

  // Execute the sub-plan with reduced depth
  const subResult = await executePlan(
    subPlanResult.plan,
    context,
    { ...config, maxDepth: config.maxDepth - 1 }
  );

  return {
    step,
    success: subResult.success,
    output: subResult.finalAnswer,
    toolResults: subResult.stepResults.flatMap(s => s.toolResults),
    subSteps: subResult.stepResults,
    llmCalls: subResult.totalLlmCalls,
    elapsedMs: 0,
  };
}

// =============================================================================
// FINAL ANSWER SYNTHESIS
// =============================================================================

async function synthesizeFinalAnswer(
  plan: SwarmPlan,
  stepResults: StepResult[],
  model: string,
): Promise<string> {
  const stepSummaries = stepResults.map((r, i) =>
    `Step ${i + 1}: ${r.step.description}\nResult: ${r.success ? r.output : `FAILED: ${r.output}`}`
  ).join("\n\n");

  const prompt = `You completed a multi-step task. Synthesize the final answer from the step results.

Task: ${plan.goal}

Step Results:
${stepSummaries}

Give a clear, complete final answer. Do NOT mention the steps or the process — just give the answer.`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: { temperature: 0.3, maxOutputTokens: 2000 },
    });
    return response.text ?? stepResults[stepResults.length - 1]?.output ?? "";
  } catch {
    // Fallback to last step's output
    return stepResults[stepResults.length - 1]?.output ?? "Unable to produce final answer";
  }
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
  // Try raw JSON
  const rawMatch = text.match(/\{"tool":\s*"[^"]+"/);
  if (rawMatch) {
    const fullMatch = text.match(/\{[^}]*"tool"[^}]*\}/);
    if (fullMatch) {
      try {
        const parsed = JSON.parse(fullMatch[0]);
        if (parsed.tool) return { tool: parsed.tool, params: parsed.params || {} };
      } catch { /* not valid */ }
    }
  }
  return null;
}

function findMostCommonResponse(responses: string[]): string {
  if (responses.length === 0) return "";
  if (responses.length === 1) return responses[0];

  // Find the response most similar to all others
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < responses.length; i++) {
    let score = 0;
    for (let j = 0; j < responses.length; j++) {
      if (i !== j) score += textSimilarity(responses[i], responses[j]);
    }
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return responses[bestIdx];
}

function textSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  let overlap = 0;
  for (const w of wordsA) if (wordsB.has(w)) overlap++;
  const union = wordsA.size + wordsB.size - overlap;
  return union > 0 ? overlap / union : 0;
}
