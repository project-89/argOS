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

import { google } from "@ai-sdk/google";
import { generateText, generateObject, tool } from "ai";
import { z } from "zod";
import type { World } from "../ecs/world";
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
  maxTimeMs: number;
  minConfidenceToStop: number;
  enableToolUse: boolean;
  enableSelfReflection: boolean;
  model: "flash" | "pro";
}

const DEFAULT_CONFIG: ReasoningConfig = {
  maxSteps: 10,
  maxTimeMs: 60000, // 1 minute
  minConfidenceToStop: 0.8,
  enableToolUse: true,
  enableSelfReflection: true,
  model: "flash",
};

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
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();
  const steps: ReasoningStep[] = [];
  const findings: string[] = [];
  const uncertainties: string[] = [];
  let tokensUsed = 0;

  const model = google(cfg.model === "pro" ? "gemini-2.0-flash" : "gemini-2.0-flash");

  // Initialize working memory for this task
  addToWorkingMemory(memoryStore, task.id, "note", `Starting: ${task.question}`);

  let currentConfidence = 0;
  let conclusion = "";
  let stepNumber = 0;

  // Build the reasoning tools
  const reasoningTools = buildReasoningTools(task, memoryStore, agentContext);

  // Main reasoning loop
  while (
    stepNumber < cfg.maxSteps &&
    Date.now() - startTime < cfg.maxTimeMs &&
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
      const response = await generateObject({
        model,
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
        system: `You are performing extended reasoning to answer: "${task.question}"

Your goal is to think step-by-step, using tools when needed, until you reach a confident conclusion.

Step types:
- think: Pure reasoning/analysis
- search: Look up information (from memory or tools)
- calculate: Perform a calculation
- recall: Retrieve from memory
- hypothesize: Form a hypothesis to test
- evaluate: Assess evidence for/against
- conclude: State your final answer

Be thorough but efficient. Stop when you have a confident answer.`,
      });

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
          uncertainties
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
      console.error(`[ExtendedReasoning] Error at step ${stepNumber}:`, error);
      uncertainties.push(`Error during reasoning step ${stepNumber}`);
      break;
    }
  }

  // If no conclusion reached, synthesize one from findings
  if (!conclusion && findings.length > 0) {
    conclusion = await synthesizeConclusion(model, task, findings, uncertainties);
    currentConfidence = Math.min(0.6, currentConfidence); // Lower confidence for synthesized
  }

  // Generate suggested actions from conclusion
  const suggestedActions = await generateSuggestedActions(model, task, conclusion, findings);

  // Store successful reasoning patterns as procedural memory
  if (currentConfidence >= 0.7) {
    addProceduralMemory(memoryStore, {
      skill: `Reasoning about ${task.type}`,
      context: task.question.slice(0, 100),
      steps: steps.filter(s => s.type !== "search").map(s => s.type),
      conditions: [task.type],
      successRate: currentConfidence,
    });
  }

  // Store key findings as semantic memory
  for (const finding of findings.slice(0, 5)) {
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
  return `# Extended Reasoning Task

## Your Context
${agentContext}

## Task
Type: ${task.type}
Question: ${task.question}
${task.constraints?.length ? `Constraints: ${task.constraints.join(", ")}` : ""}

## Working Memory (Your Scratchpad)
${workingMemory || "(Empty - start fresh)"}

## Previous Reasoning Steps
${previousSteps || "(This is step 1)"}

## Current Status
Step ${currentStep} of ${maxSteps} maximum.

## Instructions
Think about what you need to do next to answer the question.
- If you need information, specify a tool to use
- If you're uncertain, form a hypothesis
- If you have enough information, evaluate and conclude
- Be specific and cite your reasoning

What is your next reasoning step?`;
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
  task: ReasoningTask,
  memoryStore: AgentMemoryStore,
  agentContext: string
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
        results.push(`[Fact] ${s.content} (confidence: ${(s.confidence * 100).toFixed(0)}%)`);
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
      const model = google("gemini-2.0-flash");
      const response = await generateText({
        model,
        prompt: `Given these premises:\n${premises}\n\nWhat can be logically deduced? Be precise and show your reasoning.`,
      });
      return response.text;
    },
  });

  // Analogy finder tool
  tools.set("find_analogy", {
    name: "find_analogy",
    description: "Find analogous situations or patterns",
    execute: async (situation: string) => {
      const model = google("gemini-2.0-flash");
      const response = await generateText({
        model,
        prompt: `Find analogies for this situation that might help understand it:\n${situation}\n\nProvide 2-3 relevant analogies with explanations.`,
      });
      return response.text;
    },
  });

  // Break down complex problem
  tools.set("decompose", {
    name: "decompose",
    description: "Break down a complex problem into sub-problems",
    execute: async (problem: string) => {
      const model = google("gemini-2.0-flash");
      const response = await generateObject({
        model,
        schema: z.object({
          subproblems: z.array(z.object({
            description: z.string(),
            difficulty: z.enum(["easy", "medium", "hard"]),
            dependencies: z.array(z.string()),
          })),
        }),
        prompt: `Break this problem into smaller sub-problems:\n${problem}`,
      });
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
      const model = google("gemini-2.0-flash");
      const response = await generateObject({
        model,
        schema: z.object({
          supportingEvidence: z.array(z.string()),
          contradictingEvidence: z.array(z.string()),
          verdict: z.enum(["supported", "refuted", "insufficient_evidence"]),
          confidence: z.number(),
        }),
        prompt: `Evaluate this hypothesis based on general knowledge:\n${hypothesis}\n\nList supporting and contradicting evidence.`,
      });

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
  model: ReturnType<typeof google>,
  task: ReasoningTask,
  steps: ReasoningStep[],
  findings: string[],
  uncertainties: string[]
): Promise<{
  shouldContinue: boolean;
  confidence: number;
  redirect?: string;
  earlyConclusion?: string;
}> {
  const response = await generateObject({
    model,
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

Questions to answer:
1. Are you making progress toward answering the question?
2. Are you going in circles or being redundant?
3. Do you have enough information to conclude?
4. Should you redirect your approach?`,
  });

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
  model: ReturnType<typeof google>,
  task: ReasoningTask,
  findings: string[],
  uncertainties: string[]
): Promise<string> {
  const response = await generateText({
    model,
    prompt: `Synthesize a conclusion from these findings:

Question: ${task.question}

Findings:
${findings.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Remaining uncertainties:
${uncertainties.join("\n") || "None"}

Provide a clear, actionable conclusion that acknowledges any limitations.`,
  });

  return response.text;
}

async function generateSuggestedActions(
  model: ReturnType<typeof google>,
  task: ReasoningTask,
  conclusion: string,
  findings: string[]
): Promise<string[]> {
  const response = await generateObject({
    model,
    schema: z.object({
      actions: z.array(z.string()).describe("Concrete actions the agent should take based on the conclusion"),
    }),
    prompt: `Based on this reasoning conclusion, what actions should be taken?

Task: ${task.question}
Conclusion: ${conclusion}

Key findings:
${findings.slice(0, 5).join("\n")}

Suggest 1-3 concrete, actionable next steps.`,
  });

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
  const model = google("gemini-2.0-flash");

  const response = await generateObject({
    model,
    schema: z.object({
      reasoning: z.string(),
      answer: z.string(),
      confidence: z.number(),
    }),
    prompt: `Quick reasoning task:

Context: ${context}

Question: ${question}

Think step-by-step briefly, then provide your answer.`,
  });

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
