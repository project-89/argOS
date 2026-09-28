/**
 * Extended Reasoning System
 *
 * Enables agents to perform multi-step reasoning within a single cognitive cycle
 * for complex tasks. Instead of: Think → Act → Wait → Think → Act...
 * Allows: Think → Think → Think → Research → Think → Conclude → Act
 *
 * Key features:
 * - Chain-of-thought reasoning with persistent scratchpad
 * - Tool calls during reasoning (research, calculation, etc.)
 * - Self-monitoring for reasoning quality
 * - Automatic depth limiting to prevent infinite loops
 * - Result synthesis into actionable conclusions
 */

import { agentModel, reasoningModel } from "../llm/config";
import { generateText, generateObject, tool } from "ai";
import { z } from "zod";
import type { World } from "../ecs/world";
import { getSimulationTaskSignal } from "../runtime/task-scope";
import type { AgentMemoryStore } from "./enhanced-memory";
import {
  addToWorkingMemory,
  getWorkingMemoryForTask,
  formatWorkingMemoryForPrompt,
  addSemanticMemory,
  addProceduralMemory,
  clearWorkingMemory,
} from "./enhanced-memory";

// =============================================================================
// TYPES
// =============================================================================

export interface ReasoningTask {
  id: string;
  agentEid: number;
  type: "research" | "problem_solving" | "planning" | "analysis" | "decision";
  question: string;
  context: string;
  constraints?: string[];
  deadline?: number; // Max time in ms
  maxSteps?: number; // Max reasoning steps
}

export interface ReasoningStep {
  stepNumber: number;
  type: "think" | "search" | "calculate" | "recall" | "hypothesize" | "evaluate" | "conclude";
  content: string;
  confidence: number;
  sources?: string[];
  timestamp: number;
}

export interface ReasoningResult {
  taskId: string;
  success: boolean;
  conclusion: string;
  confidence: number;
  steps: ReasoningStep[];
  findings: string[];
  uncertainties: string[];
  suggestedActions: string[];
  timeElapsed: number;
  tokensUsed: number;
}

export interface ReasoningConfig {
  maxSteps: number;
  /** Hard cap across reasoning, tool, reflection, synthesis, and action calls. */
  maxModelCalls: number;
  maxTimeMs: number;
  minConfidenceToStop: number;
  enableToolUse: boolean;
  enableSelfReflection: boolean;
  model: "flash" | "pro";
}

const DEFAULT_CONFIG: ReasoningConfig = {
  // This faculty is intended for a reserved subconscious lane. Keep one job
  // bounded so it yields capacity to planning, reflection, and other actors.
  maxSteps: 4,
  maxModelCalls: 6,
  maxTimeMs: 15000,
  minConfidenceToStop: 0.8,
  enableToolUse: true,
  enableSelfReflection: true,
  model: "flash",
};

interface ReasoningRuntime {
  signal: AbortSignal;
  parentSignal?: AbortSignal;
  deadlineSignal: AbortSignal;
  model: typeof agentModel;
  modelCalls: number;
  maxModelCalls: number;
  claimModelCall(): void;
}

function createReasoningRuntime(cfg: ReasoningConfig, maxTimeMs: number): ReasoningRuntime {
  const parentSignal = getSimulationTaskSignal();
  const deadlineSignal = AbortSignal.timeout(Math.max(1, maxTimeMs));
  const signal = parentSignal ? AbortSignal.any([parentSignal, deadlineSignal]) : deadlineSignal;
  const runtime: ReasoningRuntime = {
    signal,
    parentSignal,
    deadlineSignal,
    model: cfg.model === "pro" ? reasoningModel : agentModel,
    modelCalls: 0,
    maxModelCalls: Math.max(1, Math.min(20, Math.floor(cfg.maxModelCalls))),
    claimModelCall() {
      signal.throwIfAborted();
      if (runtime.modelCalls >= runtime.maxModelCalls) throw new Error("extended reasoning model-call budget exhausted");
      runtime.modelCalls++;
    },
  };
  return runtime;
}

function modelCallOptions(runtime: ReasoningRuntime, maxOutputTokens: number) {
  return {
    abortSignal: runtime.signal,
    maxRetries: 0,
    maxOutputTokens,
    providerOptions: {
      google: { thinkingConfig: { thinkingLevel: "low" } },
    },
  } as const;
}

// =============================================================================
// REASONING ENGINE
// =============================================================================

/**
 * Execute extended reasoning for a complex task
 */
export async function executeExtendedReasoning(
  task: ReasoningTask,
  memoryStore: AgentMemoryStore,
  agentContext: string,
  config: Partial<ReasoningConfig> = {}
): Promise<ReasoningResult> {
  const cfg: ReasoningConfig = { ...DEFAULT_CONFIG, ...config };
  cfg.maxSteps = Math.max(1, Math.min(12, Math.floor(task.maxSteps ?? cfg.maxSteps)));
  cfg.maxTimeMs = Math.max(1, Math.min(120_000, Math.floor(task.deadline ?? cfg.maxTimeMs)));
  const startTime = Date.now();
  const steps: ReasoningStep[] = [];
  const findings: string[] = [];
  const uncertainties: string[] = [];
  let tokensUsed = 0;

  const runtime = createReasoningRuntime(cfg, cfg.maxTimeMs);
  const model = runtime.model;

  // Initialize working memory for this task
  addToWorkingMemory(memoryStore, task.id, "note", `Starting: ${task.question}`);

  let currentConfidence = 0;
  let conclusion = "";
  let stepNumber = 0;

  // Build the reasoning tools
  const reasoningTools = buildReasoningTools(memoryStore, runtime);

  // Main reasoning loop
  while (
    stepNumber < cfg.maxSteps &&
    !runtime.signal.aborted &&
    runtime.modelCalls < runtime.maxModelCalls &&
    currentConfidence < cfg.minConfidenceToStop
  ) {
    stepNumber++;

    // Build prompt with current state
    const workingMemory = formatWorkingMemoryForPrompt(memoryStore, task.id);
    const previousSteps = steps.map(s =>
      `[Step ${s.stepNumber}] ${s.type.toUpperCase()}: ${s.content} (confidence: ${(s.confidence * 100).toFixed(0)}%)`
    ).join("\n");

    const prompt = buildReasoningPrompt(task, agentContext, workingMemory, previousSteps, stepNumber, cfg.maxSteps);

    try {
      // Generate next reasoning step
      runtime.claimModelCall();
      const response = await generateObject({
        model,
        ...modelCallOptions(runtime, 900),
        schema: z.object({
          stepType: z.enum(["think", "search", "calculate", "recall", "hypothesize", "evaluate", "conclude"]),
          content: z.string().describe("The reasoning content for this step"),
          confidence: z.number().min(0).max(1).describe("Confidence in this step (0-1)"),
          needsMoreInfo: z.boolean().describe("Whether more information is needed"),
          toolToUse: z.string().optional().describe("If search/calculate, which tool to use"),
          toolInput: z.string().optional().describe("Input for the tool"),
          findings: z.array(z.string()).optional().describe("New findings from this step"),
          uncertainties: z.array(z.string()).optional().describe("Remaining uncertainties"),
          isConclusion: z.boolean().describe("Whether this is a final conclusion"),
        }),
        prompt,
        system: `Investigate the question using the supplied context and available tools. Keep observations, attributed statements and hypotheses distinct; a repeated thought is not new evidence.
Choose the next useful step, with a concise explanation and any source references. Tool requests are proposals until their results return. Conclude when the evidence supports an answer or when the question cannot be resolved with the information available. State the remaining uncertainty; confidence should reflect evidence, not effort.`,
      });
      runtime.signal.throwIfAborted();

      const step: ReasoningStep = {
        stepNumber,
        type: response.object.stepType,
        content: response.object.content,
        confidence: response.object.confidence,
        timestamp: Date.now(),
      };

      steps.push(step);

      // Add to working memory
      addToWorkingMemory(
        memoryStore,
        task.id,
        response.object.isConclusion ? "conclusion" :
        response.object.stepType === "hypothesize" ? "hypothesis" :
        response.object.findings?.length ? "finding" : "note",
        response.object.content
      );

      // Collect findings and uncertainties
      if (response.object.findings) {
        findings.push(...response.object.findings);
      }
      if (response.object.uncertainties) {
        uncertainties.push(...response.object.uncertainties);
      }

      // Execute tool if requested
      if (cfg.enableToolUse && response.object.toolToUse && response.object.toolInput) {
        const toolResult = await executeReasoningTool(
          response.object.toolToUse,
          response.object.toolInput,
          reasoningTools,
          memoryStore,
          task.id
        );

        if (toolResult) {
          steps.push({
            stepNumber: stepNumber + 0.5, // Interleaved step
            type: "search",
            content: `Tool result: ${toolResult}`,
            confidence: 0.7,
            sources: [response.object.toolToUse],
            timestamp: Date.now(),
          });

          addToWorkingMemory(memoryStore, task.id, "finding", `[${response.object.toolToUse}]: ${toolResult}`);
        }
      }

      // Update confidence and conclusion
      currentConfidence = response.object.confidence;
      if (response.object.isConclusion) {
        conclusion = response.object.content;
        break;
      }

      // Self-reflection checkpoint (every 3 steps)
      if (cfg.enableSelfReflection && stepNumber % 3 === 0) {
        const reflectionResult = await performSelfReflection(
          model,
          task,
          steps,
          findings,
          uncertainties,
          runtime,
        );

        if (reflectionResult.shouldContinue === false) {
          conclusion = reflectionResult.earlyConclusion || "Unable to reach confident conclusion.";
          currentConfidence = reflectionResult.confidence;
          break;
        }

        if (reflectionResult.redirect) {
          addToWorkingMemory(memoryStore, task.id, "note", `Redirecting: ${reflectionResult.redirect}`);
        }
      }

      // Rough token estimation
      tokensUsed += prompt.length / 4 + (response.object.content?.length || 0) / 4;

    } catch (error) {
      // Simulation cancellation is authoritative: stale subconscious work must
      // never fall through and write memories after its world has stopped.
      if (runtime.parentSignal?.aborted) runtime.parentSignal.throwIfAborted();
      if (runtime.deadlineSignal.aborted) {
        uncertainties.push("Reasoning deadline reached");
        break;
      }
      console.error(`[ExtendedReasoning] Error at step ${stepNumber}:`, error);
      uncertainties.push(`Error during reasoning step ${stepNumber}`);
      break;
    }
  }

  // If no conclusion reached, synthesize one from findings
  if (!conclusion && findings.length > 0 && !runtime.signal.aborted && runtime.modelCalls < runtime.maxModelCalls) {
    try {
      conclusion = await synthesizeConclusion(model, task, findings, uncertainties, runtime);
      currentConfidence = Math.min(0.6, currentConfidence); // Lower confidence for synthesized
    } catch (error) {
      if (runtime.parentSignal?.aborted) runtime.parentSignal.throwIfAborted();
      if (!runtime.deadlineSignal.aborted) uncertainties.push(`Conclusion synthesis failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  // Suggestions are candidates for the foreground loop, never direct world
  // mutations. Skip this optional call when the job has spent its budget.
  let suggestedActions: string[] = [];
  if (conclusion && !runtime.signal.aborted && runtime.modelCalls < runtime.maxModelCalls) {
    try {
      suggestedActions = await generateSuggestedActions(model, task, conclusion, findings, runtime);
    } catch (error) {
      if (runtime.parentSignal?.aborted) runtime.parentSignal.throwIfAborted();
      if (!runtime.deadlineSignal.aborted) uncertainties.push(`Action synthesis failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  if (runtime.parentSignal?.aborted) runtime.parentSignal.throwIfAborted();
  const mayCommitLearning = !runtime.deadlineSignal.aborted;

  // Store successful reasoning patterns as procedural memory
  if (mayCommitLearning && currentConfidence >= 0.7) {
    addProceduralMemory(memoryStore, {
      skill: `Reasoning about ${task.type}`,
      context: task.question.slice(0, 100),
      steps: steps.filter(s => s.type !== "search").map(s => s.type),
      conditions: [task.type],
      successRate: currentConfidence,
    });
  }

  // Store key findings as semantic memory
  for (const finding of mayCommitLearning ? findings.slice(0, 5) : []) {
    addSemanticMemory(memoryStore, {
      category: "fact",
      subject: task.question.slice(0, 50),
      content: finding,
      confidence: currentConfidence,
      sources: [task.id],
    });
  }

  const timeElapsed = Date.now() - startTime;

  return {
    taskId: task.id,
    success: currentConfidence >= 0.5,
    conclusion,
    confidence: currentConfidence,
    steps,
    findings,
    uncertainties,
    suggestedActions,
    timeElapsed,
    tokensUsed,
  };
}

// =============================================================================
// PROMPT BUILDING
// =============================================================================

function buildReasoningPrompt(
  task: ReasoningTask,
  agentContext: string,
  workingMemory: string,
  previousSteps: string,
  currentStep: number,
  maxSteps: number
): string {
  const context = task.context && task.context !== agentContext
    ? task.context.startsWith(agentContext) ? task.context : `${agentContext}\n${task.context}`
    : agentContext;
  return `# Extended Reasoning Task

## Your Context
${context}

## Task
Type: ${task.type}
Question: ${task.question}
${task.constraints?.length ? `Constraints: ${task.constraints.join(", ")}` : ""}

${workingMemory || "Working memory: no notes yet."}

## Previous Reasoning Steps
${previousSteps || "(This is step 1)"}

## Current Status
Step ${currentStep} of ${maxSteps} maximum.

Choose the next step that could resolve a remaining uncertainty, or conclude with the limits of the available evidence.`;
}

// =============================================================================
// TOOL SYSTEM
// =============================================================================

interface ReasoningTool {
  name: string;
  description: string;
  execute: (input: string) => Promise<string>;
}

function buildReasoningTools(
  memoryStore: AgentMemoryStore,
  runtime: ReasoningRuntime,
): Map<string, ReasoningTool> {
  const tools = new Map<string, ReasoningTool>();

  // Memory recall tool
  tools.set("recall_memory", {
    name: "recall_memory",
    description: "Search your memories for relevant information",
    execute: async (query: string) => {
      const { querySemanticMemory, recallEpisodicMemories } = await import("./enhanced-memory");

      const semanticResults = querySemanticMemory(memoryStore, { keywords: query.split(" ") }, 5);
      const episodicResults = recallEpisodicMemories(memoryStore, { keywords: query.split(" ") }, 3);

      const results: string[] = [];
      for (const s of semanticResults) {
        results.push(`[Stored ${s.category}] ${s.content} (confidence: ${(s.confidence * 100).toFixed(0)}%; sources: ${s.sources.join(", ") || "unspecified"})`);
      }
      for (const e of episodicResults) {
        results.push(`[Memory] ${e.event} - ${e.myRole}`);
      }

      return results.length > 0 ? results.join("\n") : "No relevant memories found.";
    },
  });

  // Logical deduction tool
  tools.set("deduce", {
    name: "deduce",
    description: "Apply logical deduction to premises",
    execute: async (premises: string) => {
      runtime.claimModelCall();
      const response = await generateText({
        model: runtime.model,
        ...modelCallOptions(runtime, 600),
        prompt: `Given these premises:\n${premises}\n\nState only conclusions that follow, with a brief justification. Preserve conditional or uncertain premises; deduction does not verify them against the world.`,
      });
      runtime.signal.throwIfAborted();
      return response.text;
    },
  });

  // Analogy finder tool
  tools.set("find_analogy", {
    name: "find_analogy",
    description: "Find analogous situations or patterns",
    execute: async (situation: string) => {
      runtime.claimModelCall();
      const response = await generateText({
        model: runtime.model,
        ...modelCallOptions(runtime, 600),
        prompt: `Consider useful analogies for this situation:\n${situation}\n\nOffer up to three if they clarify it, and state where each comparison breaks down. An analogy suggests possibilities; it does not supply evidence about this situation. If none helps, say so.`,
      });
      runtime.signal.throwIfAborted();
      return response.text;
    },
  });

  // Break down complex problem
  tools.set("decompose", {
    name: "decompose",
    description: "Break down a complex problem into sub-problems",
    execute: async (problem: string) => {
      runtime.claimModelCall();
      const response = await generateObject({
        model: runtime.model,
        ...modelCallOptions(runtime, 700),
        schema: z.object({
          subproblems: z.array(z.object({
            description: z.string(),
            difficulty: z.enum(["easy", "medium", "hard"]),
            dependencies: z.array(z.string()),
          })),
        }),
        prompt: `Identify useful sub-problems for:\n${problem}\n\nUse only the supplied constraints. Keep unknowns explicit, and return an empty subproblems array if no decomposition is needed.`,
      });
      runtime.signal.throwIfAborted();
      return response.object.subproblems
        .map((sp, i) => `${i + 1}. ${sp.description} [${sp.difficulty}]`)
        .join("\n");
    },
  });

  // Evaluate hypothesis
  tools.set("evaluate_hypothesis", {
    name: "evaluate_hypothesis",
    description: "Evaluate evidence for and against a hypothesis",
    execute: async (hypothesis: string) => {
      runtime.claimModelCall();
      const response = await generateObject({
        model: runtime.model,
        ...modelCallOptions(runtime, 700),
        schema: z.object({
          supportingEvidence: z.array(z.string()),
          contradictingEvidence: z.array(z.string()),
          verdict: z.enum(["supported", "refuted", "insufficient_evidence"]),
          confidence: z.number(),
        }),
        prompt: `Assess this hypothesis using the evidence included with it:\n${hypothesis}\n\nKeep general plausibility separate from observed support. Cite supplied sources within the evidence strings; leave either evidence array empty when nothing supports it. Use insufficient_evidence when the hypothesis cannot be tested from this input. Do not invent observations or treat a proposed test as a result.`,
      });
      runtime.signal.throwIfAborted();

      return `Verdict: ${response.object.verdict} (${(response.object.confidence * 100).toFixed(0)}% confidence)
Supporting: ${response.object.supportingEvidence.join("; ")}
Contradicting: ${response.object.contradictingEvidence.join("; ")}`;
    },
  });

  return tools;
}

async function executeReasoningTool(
  toolName: string,
  input: string,
  tools: Map<string, ReasoningTool>,
  memoryStore: AgentMemoryStore,
  taskId: string
): Promise<string | null> {
  const tool = tools.get(toolName);
  if (!tool) {
    return `Tool "${toolName}" not found.`;
  }

  try {
    const result = await tool.execute(input);
    return result;
  } catch (error) {
    console.error(`[ExtendedReasoning] Tool ${toolName} error:`, error);
    return `Tool error: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}

// =============================================================================
// SELF-REFLECTION
// =============================================================================

async function performSelfReflection(
  model: typeof agentModel,
  task: ReasoningTask,
  steps: ReasoningStep[],
  findings: string[],
  uncertainties: string[],
  runtime: ReasoningRuntime,
): Promise<{
  shouldContinue: boolean;
  confidence: number;
  redirect?: string;
  earlyConclusion?: string;
}> {
  runtime.claimModelCall();
  const response = await generateObject({
    model,
    ...modelCallOptions(runtime, 600),
    schema: z.object({
      progressAssessment: z.string(),
      isOnTrack: z.boolean(),
      shouldContinue: z.boolean(),
      currentConfidence: z.number(),
      suggestedRedirect: z.string().optional(),
      earlyConclusion: z.string().optional(),
    }),
    prompt: `Reflect on your reasoning progress:

Task: ${task.question}

Steps taken:
${steps.map(s => `- ${s.type}: ${s.content.slice(0, 100)}...`).join("\n")}

Findings so far:
${findings.slice(0, 5).join("\n") || "None yet"}

Uncertainties:
${uncertainties.slice(0, 3).join("\n") || "None"}

Assess whether the last steps added evidence or only restated the same idea. Continue only if another available step could help. Otherwise conclude, including an unresolved or low-confidence answer when appropriate.`,
  });
  runtime.signal.throwIfAborted();

  return {
    shouldContinue: response.object.shouldContinue,
    confidence: response.object.currentConfidence,
    redirect: response.object.suggestedRedirect,
    earlyConclusion: response.object.earlyConclusion,
  };
}

// =============================================================================
// SYNTHESIS
// =============================================================================

async function synthesizeConclusion(
  model: typeof agentModel,
  task: ReasoningTask,
  findings: string[],
  uncertainties: string[],
  runtime: ReasoningRuntime,
): Promise<string> {
  runtime.claimModelCall();
  const response = await generateText({
    model,
    ...modelCallOptions(runtime, 700),
    prompt: `Synthesize a conclusion from these findings:

Question: ${task.question}

Findings:
${findings.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Remaining uncertainties:
${uncertainties.join("\n") || "None"}

State the answer supported by these findings, retaining source attribution and uncertainty. If they do not resolve the question, say what is still unknown. Do not turn a hypothesis or proposed action into an observed result.`,
  });
  runtime.signal.throwIfAborted();

  return response.text;
}

async function generateSuggestedActions(
  model: typeof agentModel,
  task: ReasoningTask,
  conclusion: string,
  findings: string[],
  runtime: ReasoningRuntime,
): Promise<string[]> {
  runtime.claimModelCall();
  const response = await generateObject({
    model,
    ...modelCallOptions(runtime, 500),
    schema: z.object({
      actions: z.array(z.string()).describe("Concrete actions the agent should take based on the conclusion"),
    }),
    prompt: `Based on this reasoning conclusion, what actions should be taken?

Task: ${task.question}
Conclusion: ${conclusion}

Key findings:
${findings.slice(0, 5).join("\n")}

Suggest up to three useful next steps supported by this context, using known capabilities. These are proposals, not completed actions. Return an empty actions array when nothing further is needed or no grounded action is available.`,
  });
  runtime.signal.throwIfAborted();

  return response.object.actions;
}

// =============================================================================
// QUICK REASONING (For simpler tasks)
// =============================================================================

/**
 * Quick reasoning for simpler tasks (1-3 steps)
 */
export async function executeQuickReasoning(
  question: string,
  context: string,
  memoryStore: AgentMemoryStore
): Promise<{ answer: string; confidence: number }> {
  const deadline = AbortSignal.timeout(8000);

  const response = await generateObject({
    model: agentModel,
    abortSignal: deadline,
    maxRetries: 0,
    maxOutputTokens: 700,
    providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
    schema: z.object({
      reasoning: z.string(),
      answer: z.string(),
      confidence: z.number(),
    }),
    prompt: `Quick reasoning task:

Context: ${context}

Question: ${question}

Give a brief explanation and answer grounded in this context. Attribute reported claims and preserve uncertainty; if the answer is not established, say so instead of inventing evidence.`,
  });
  deadline.throwIfAborted();

  // Store as semantic memory if confident
  if (response.object.confidence >= 0.7) {
    addSemanticMemory(memoryStore, {
      category: "fact",
      subject: question.slice(0, 50),
      content: response.object.answer,
      confidence: response.object.confidence,
      sources: ["quick_reasoning"],
    });
  }

  return {
    answer: response.object.answer,
    confidence: response.object.confidence,
  };
}

// =============================================================================
// TASK CREATION HELPERS
// =============================================================================

let taskIdCounter = 0;

export function createReasoningTask(
  agentEid: number,
  type: ReasoningTask["type"],
  question: string,
  context: string,
  options?: Partial<Pick<ReasoningTask, "constraints" | "deadline" | "maxSteps">>
): ReasoningTask {
  return {
    id: `reason_${++taskIdCounter}_${Date.now()}`,
    agentEid,
    type,
    question,
    context,
    ...options,
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export function getReasoningResultSummary(result: ReasoningResult): string {
  return `Reasoning Result:
- Task: ${result.taskId}
- Success: ${result.success}
- Confidence: ${(result.confidence * 100).toFixed(0)}%
- Steps: ${result.steps.length}
- Findings: ${result.findings.length}
- Time: ${(result.timeElapsed / 1000).toFixed(1)}s
- Tokens: ~${result.tokensUsed}

Conclusion: ${result.conclusion}

Suggested Actions:
${result.suggestedActions.map((a, i) => `${i + 1}. ${a}`).join("\n")}`;
}
