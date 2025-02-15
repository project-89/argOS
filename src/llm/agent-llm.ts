import { generateText } from "ai";
import {
  geminiFlashModel,
  gemini2FlashModel,
  geminiProModel,
  haikuModel,
  // claude35SonnetModel,
} from "../config/ai-config";
import { EXTRACT_EXPERIENCES, PROCESS_STIMULUS } from "../templates";
import { GENERATE_PLAN } from "../templates/generate-plan";
import { zodToJsonSchema } from "zod-to-json-schema";
import { llmLogger } from "../utils/llm-logger";
import { logger } from "../utils/logger";
import { parseJSON } from "../utils/json";
import { GENERATE_THOUGHT_SIMPLE } from "../templates/generate-thought";
import { World, addComponent, query, hasComponent } from "bitecs";
import {
  Agent,
  GoalType,
  Memory,
  Perception,
  SinglePlanType,
  WorkingMemory,
  ProcessingState,
  ProcessingMode,
  ActionResultType,
} from "../components";
import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { GENERATE_GOALS } from "../templates/generate-goals";
import {
  EVALUATE_GOAL_PROGRESS,
  GoalEvaluation,
} from "../templates/evaluate-goal-progress";
import { DETECT_SIGNIFICANT_CHANGES } from "../templates/detect-significant-changes";
import { StimulusData } from "../types/stimulus";
import { AgentState } from "../types";
import { EVALUATE_TASK_PROGRESS } from "../templates/evaluate-task-progress";
import { EVALUATE_PLAN_MODIFICATIONS } from "../templates/evaluate-plan-modifications";
import { EXTRACT_EXPERIENCES_SIMPLE } from "../templates/extract-experiences";
import PROCESS_PERCEPTIONS from "../templates/process-perceptions";

export interface ThoughtResponse {
  thought: string;
  action?: {
    tool: string;
    parameters: Record<string, any>;
    reasoning: string;
  };
  appearance?: {
    description?: string;
    facialExpression?: string;
    bodyLanguage?: string;
    currentAction?: string;
    socialCues?: string;
  };
}

/**
 * Core LLM call with consistent error handling and system prompt
 */
async function callLLM(
  prompt: string,
  systemPrompt: string,
  agentId: string
): Promise<string> {
  try {
    llmLogger.logPrompt(agentId, prompt, systemPrompt);
    const startTime = Date.now();

    const { text } = await generateText({
      // model: haikuModel,
      // model: claude35SonnetModel,
      model: gemini2FlashModel,
      // model: geminiProModel,
      // model: geminiFlashModel,
      temperature: 0.7,
      prompt,
      system: systemPrompt,
    });

    llmLogger.logResponse(agentId, text, Date.now() - startTime);

    return text || "";
  } catch (error) {
    console.error("LLM call failed:", error);
    throw error; // Let caller handle specific fallbacks
  }
}

/**
 * Template composer with type checking
 */
export function composeFromTemplate(
  template: string,
  state: Record<string, any>
): string {
  return template.replace(/\{([^}]+)\}/g, (match, path) => {
    const value = path
      .split(".")
      .reduce((obj: Record<string, any>, key: string) => obj?.[key], state);
    if (typeof value === "object") {
      return JSON.stringify(value, null, 2);
    }
    return value ?? match;
  });
}

export async function generateThought(
  state: AgentState
): Promise<ThoughtResponse> {
  const agentId = state.name;

  try {
    const prompt = composeFromTemplate(GENERATE_THOUGHT_SIMPLE, {
      ...state,
      perceptions: {
        narrative: state.perceptions.narrative,
        raw: JSON.stringify(state.perceptions.raw, null, 2),
      },
      tools: state.availableTools
        .map((t) => `${t.name}: ${t.description}`)
        .join("\n"),
      toolSchemas: JSON.stringify(
        Object.fromEntries(
          state.availableTools.map((tool) => [
            tool.name,
            tool.schema && tool.schema._def ? zodToJsonSchema(tool.schema) : {},
          ])
        ),
        null,
        2
      ),
    });

    // Get LLM response
    const text = await callLLM(prompt, state.systemPrompt, agentId);

    try {
      // Parse and validate response
      const cleanText = text.replace(/```json\n|\n```/g, "").trim();
      const response = JSON.parse(cleanText) as ThoughtResponse;

      // Validate action if present
      if (response.action) {
        const tool = state.availableTools.find(
          (t) => t.name === response.action?.tool
        );
        if (tool) {
          try {
            tool.schema.parse(response.action.parameters);
          } catch (validationError) {
            llmLogger.logError(
              agentId,
              validationError,
              "Action validation failed"
            );
            return { thought: response.thought };
          }
        }
      }

      return {
        thought:
          response.thought || "I have nothing to think about at the moment.",
        action: response.action,
        appearance: response.appearance,
      };
    } catch (parseError) {
      llmLogger.logError(
        agentId,
        parseError,
        "Failed to parse thought response"
      );
      return {
        thought: text || "I have nothing to think about at the moment.",
      };
    }
  } catch (error) {
    console.error("Error in thought generation", error);
    llmLogger.logError(agentId, error, "Error in thought generation");
    return { thought: "My mind is blank right now." };
  }
}

export interface ProcessStimulusState {
  name: string;
  role: string;
  systemPrompt: string;
  recentPerceptions: string;
  timeSinceLastPerception: number;
  currentTimestamp: number;
  lastAction?: ActionResultType;
  stimulus: StimulusData[];
  currentGoals: GoalType[];
  activePlans: SinglePlanType[];
  recentExperiences: Experience[];
  context?: {
    salientEntities: Array<{ id: number; type: string; relevance: number }>;
    roomContext: Record<string, any>;
    recentEvents: Array<{
      type: string;
      timestamp: number;
      description: string;
    }>;
    agentRole: string;
    agentPrompt: string;
    processingMode: ProcessingMode;
    stableStateCycles: number;
  };
  processingModeInstructions?: string;
  outputGuidelines?: string;
  modeSpecificAntiPatterns?: string;
  modeFocusReminder?: string;
  perceptionHistory?: string[];
}

export async function processStimulus(
  state: ProcessStimulusState
): Promise<string> {
  const agentId = state.name; // Using name as ID for now

  try {
    const prompt = composeFromTemplate(PROCESS_STIMULUS, {
      ...state,
      stimulus: JSON.stringify(state.stimulus, null, 2),
    });

    // Get LLM response
    const text = await callLLM(prompt, state.systemPrompt, agentId);

    return text || "I perceive nothing of note.";
  } catch (error) {
    llmLogger.logError(agentId, error, "Error processing stimulus");
    return "I am having trouble processing my surroundings.";
  }
}

export interface Experience {
  type: "speech" | "action" | "observation" | "thought";
  content: string;
  timestamp: number;
  category?: string;
  queries?: string[];
  data?: Record<string, any>;
}

export interface ExtractExperiencesState {
  name: string;
  agentId: string;
  role: string;
  systemPrompt: string;
  recentExperiences: Experience[];
  timestamp: number;
  perceptionSummary: string;
  perceptionContext: any[];
  stimulus: StimulusData[];
  goals: GoalType[];
}

function validateExperiences(experiences: any[]): experiences is Experience[] {
  if (!Array.isArray(experiences)) {
    logger.error("Experiences validation failed: not an array", {
      experiences,
    });
    return false;
  }

  return experiences.every((exp) => {
    if (!exp || typeof exp !== "object") {
      logger.error("Experience validation failed: not an object", { exp });
      return false;
    }

    const validType = ["speech", "action", "observation", "thought"].includes(
      exp.type
    );
    const validContent =
      typeof exp.content === "string" && exp.content.length > 0;
    const validTimestamp =
      typeof exp.timestamp === "number" && exp.timestamp > 0;

    if (!validType || !validContent || !validTimestamp) {
      logger.error("Experience validation failed", {
        exp,
        validType,
        validContent,
        validTimestamp,
      });
      return false;
    }

    return true;
  });
}

export async function extractExperiences(
  state: ExtractExperiencesState
): Promise<Experience[]> {
  try {
    logger.debug("Extracting experiences from state:", {
      agentName: state.name,
      stimuliCount: state.stimulus.length,
      recentExperiencesCount: state.recentExperiences.length,
    });

    // trim down the number of experiences to 20
    const recentExperiences = state.recentExperiences.slice(0, 20);

    const prompt = composeFromTemplate(EXTRACT_EXPERIENCES_SIMPLE, {
      ...state,
      recentExperiences: JSON.stringify(recentExperiences, null, 2),
      stimulus: JSON.stringify(state.stimulus, null, 2),
      perceptionSummary: state.perceptionSummary,
    });

    const text = await callLLM(prompt, state.systemPrompt, state.agentId);
    const parsed = parseJSON<{ experiences: any[] }>(text);

    // Validate experiences
    if (!validateExperiences(parsed.experiences)) {
      throw new Error("Invalid experiences format");
    }

    logger.debug("Extracted experiences:", {
      count: parsed.experiences.length,
      types: parsed.experiences.map((e) => e.type),
    });

    return parsed.experiences;
  } catch (error) {
    logger.error(`Failed to extract experiences:`, error);
    return [];
  }
}

export interface GenerateGoalsState {
  name: string;
  role: string;
  systemPrompt: string;
  agentId: string;
  currentGoals: any[];
  recentExperiences: any[];
  perceptionSummary: string;
  perceptionContext: string;
}

export interface EvaluateGoalState {
  name: string;
  systemPrompt: string;
  agentId: string;
  goalDescription: string;
  goalType: string;
  successCriteria: string[];
  progressIndicators: string[];
  currentProgress: number;
  recentExperiences: any[];
  perceptionSummary: string;
  perceptionContext: string;
}

export interface DetectChangesState {
  name: string;
  role: string;
  systemPrompt: string;
  agentId: string;
  currentGoals: any[];
  recentExperiences: any[];
  perceptionSummary: string;
  perceptionContext: string;
}

export async function generateGoals(state: GenerateGoalsState) {
  try {
    logger.debug("Generating goals for agent:", {
      agentName: state.name,
      currentGoalsCount: state.currentGoals.length,
      recentExperiencesCount: state.recentExperiences.length,
    });

    const prompt = composeFromTemplate(GENERATE_GOALS, {
      ...state,
      currentGoals: JSON.stringify(state.currentGoals, null, 2),
      recentExperiences: JSON.stringify(state.recentExperiences, null, 2),
    });

    const text = await callLLM(prompt, state.systemPrompt, state.agentId);
    const parsed = parseJSON<{ goals: any[] }>(text);

    logger.debug("Generated goals:", {
      count: parsed.goals.length,
      types: parsed.goals.map((g) => g.type),
    });

    return parsed.goals;
  } catch (error) {
    logger.error(`Failed to generate goals:`, error);
    return [];
  }
}

export async function evaluateGoalProgress(
  state: EvaluateGoalState
): Promise<GoalEvaluation["evaluation"]> {
  try {
    logger.debug("Evaluating goal progress:", {
      agentName: state.name,
      goalDescription: state.goalDescription,
      currentProgress: state.currentProgress,
    });

    const prompt = composeFromTemplate(EVALUATE_GOAL_PROGRESS, {
      ...state,
      successCriteria: JSON.stringify(state.successCriteria, null, 2),
      progressIndicators: JSON.stringify(state.progressIndicators, null, 2),
      recentExperiences: JSON.stringify(state.recentExperiences, null, 2),
    });

    const text = await callLLM(prompt, state.systemPrompt, state.agentId);
    const parsed = parseJSON<GoalEvaluation>(text);

    logger.debug("Goal evaluation:", {
      complete: parsed.evaluation.complete,
      progress: parsed.evaluation.progress,
      criteriaMetCount: parsed.evaluation.criteria_met.length,
    });

    return parsed.evaluation;
  } catch (error) {
    logger.error(`Failed to evaluate goal progress:`, error);
    return {
      complete: false,
      progress: 0,
      criteria_met: [],
      criteria_partial: [],
      criteria_blocked: [],
      recent_advancements: [],
      blockers: [],
      next_steps: [],
    };
  }
}

export async function detectSignificantChanges(state: DetectChangesState) {
  try {
    logger.debug("Detecting significant changes for agent:", {
      agentName: state.name,
      currentGoalsCount: state.currentGoals.length,
      recentExperiencesCount: state.recentExperiences.length,
    });

    const prompt = composeFromTemplate(DETECT_SIGNIFICANT_CHANGES, {
      ...state,
      currentGoals: JSON.stringify(state.currentGoals, null, 2),
      recentExperiences: JSON.stringify(state.recentExperiences, null, 2),
    });

    const text = await callLLM(prompt, state.systemPrompt, state.agentId);
    const parsed = parseJSON<{ analysis: any }>(text);

    logger.debug("Change analysis:", {
      significantChange: parsed.analysis.significant_change,
      changeCount: parsed.analysis.changes.length,
      recommendation: parsed.analysis.recommendation,
    });

    return parsed.analysis;
  } catch (error) {
    logger.error(`Failed to detect significant changes:`, error);
    return {
      significant_change: false,
      changes: [],
      recommendation: "maintain_goals",
      reasoning: ["Error in change detection"],
    };
  }
}

export interface GeneratePlanState {
  name: string;
  role: string;
  systemPrompt: string;
  agentId: string;
  goal: {
    id: string;
    description: string;
    type: string;
    priority: number;
    success_criteria: string[];
    progress_indicators: string[];
  };
  currentPlans: any[];
  recentExperiences: any[];
  availableTools: Array<{
    name: string;
    description: string;
    parameters: string[];
  }>;
}

export async function generatePlan(
  state: GeneratePlanState
): Promise<SinglePlanType> {
  try {
    logger.debug("Generating plan for goal:", {
      agentName: state.name,
      goalId: state.goal.id,
      goalType: state.goal.type,
    });

    const prompt = composeFromTemplate(GENERATE_PLAN, {
      ...state,
      goal: JSON.stringify(state.goal, null, 2),
      availableTools: state.availableTools
        .map((t) => `${t.name}: ${t.description}`)
        .join("\n"),
      recentExperiences: JSON.stringify(state.recentExperiences, null, 2),
    });

    const text = await callLLM(prompt, state.systemPrompt, state.agentId);
    const parsed = parseJSON<{ plan: SinglePlanType }>(text);

    logger.debug("Generated plan:", {
      planId: parsed.plan.id,
      stepCount: parsed.plan.steps.length,
    });

    // Ensure required fields are present
    return {
      ...parsed.plan,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "active" as const,
    };
  } catch (error) {
    logger.error(`Failed to generate plan:`, error);
    throw error;
  }
}

export interface EvaluateTaskState {
  name: string;
  systemPrompt: string;
  agentId: string;
  taskDescription: string;
  expectedOutcome: string;
  recentExperiences: any[];
  recentPerception: any[];
}

export interface TaskEvaluation {
  complete: boolean;
  failed: boolean;
  reason?: string;
}

export async function evaluateTaskProgress(
  state: EvaluateTaskState
): Promise<TaskEvaluation> {
  let text = "";
  try {
    logger.debug("Evaluating task progress:", {
      agentName: state.name,
      taskDescription: state.taskDescription,
    });

    const prompt = composeFromTemplate(EVALUATE_TASK_PROGRESS, {
      ...state,
      recentExperiences: JSON.stringify(state.recentExperiences, null, 2),
    });

    text = await callLLM(prompt, state.systemPrompt, state.agentId);

    // Log the raw response for debugging
    logger.debug("Raw LLM response for task evaluation:", {
      agentName: state.name,
      taskDescription: state.taskDescription,
      response: text,
    });

    const parsed = parseJSON<{ evaluation: TaskEvaluation }>(text);

    logger.debug("Task evaluation:", {
      complete: parsed.evaluation.complete,
      failed: parsed.evaluation.failed,
      reason: parsed.evaluation.reason,
    });

    return parsed.evaluation;
  } catch (error) {
    logger.error(`Failed to evaluate task progress:`, {
      error,
      agentName: state.name,
      taskDescription: state.taskDescription,
      rawResponse: text, // Now text is accessible in catch block
    });
    return {
      complete: false,
      failed: false,
      reason: "Error evaluating task progress",
    };
  }
}

export interface EvaluatePlanModificationsState {
  name: string;
  systemPrompt: string;
  agentId: string;
  currentPlan: SinglePlanType;
  recentExperiences: any[];
  recentPerception: any[];
}

export interface PlanModificationResult {
  shouldModify: boolean;
  newTasks?: Array<{
    description: string;
    reason: string;
    insertAfter?: string; // task description to insert after, if undefined add to end
  }>;
  tasksToRemove?: Array<{
    description: string;
    reason: string;
  }>;
  tasksToReorder?: Array<{
    description: string;
    moveAfter: string;
    reason: string;
  }>;
}

export async function evaluatePlanModifications({
  name,
  systemPrompt,
  agentId,
  currentPlan,
  recentExperiences,
  recentPerception,
}: {
  name: string;
  systemPrompt: string;
  agentId: string;
  currentPlan: any;
  recentExperiences: any[];
  recentPerception: any[];
}) {
  const prompt = EVALUATE_PLAN_MODIFICATIONS.replace("${name}", name)
    .replace("${currentPlan}", JSON.stringify(currentPlan, null, 2))
    .replace("${recentExperiences}", JSON.stringify(recentExperiences, null, 2))
    .replace("${recentPerception}", JSON.stringify(recentPerception, null, 2));

  try {
    const response = await callLLM(prompt, systemPrompt, agentId);
    const result = parseJSON<{ modifications: PlanModificationResult }>(
      response
    );
    return result.modifications;
  } catch (error) {
    logger.error("Failed to evaluate plan modifications", {
      error,
      agentId,
    });
    return {
      shouldModify: false,
      newTasks: [],
      tasksToRemove: [],
      tasksToReorder: [],
    };
  }
}

export interface ProcessPerceptionsState {
  name: string;
  role: string;
  systemPrompt: string;
  currentStimuli: Array<{
    type: string;
    content: string;
    source: string;
    metadata?: Record<string, any>;
  }>;
  recentThoughtChain: Array<{
    type: "perception" | "thought" | "action" | "result";
    content: string;
    timestamp: number;
  }>;
  context: {
    roomId: string;
    roomName?: string;
    roomDescription?: string;
    currentGoals: Array<{
      id: string;
      description: string;
      type: string;
      priority: number;
      progress?: number;
    }>;
    activePlans: Array<{
      id: string;
      goalId: string;
      steps: Array<{
        id: string;
        description: string;
        status: "pending" | "active" | "completed" | "failed";
      }>;
      status: "active" | "completed" | "failed";
    }>;
  };
}

export async function processPerceptions(
  state: ProcessPerceptionsState
): Promise<{
  summary: string;
  significance: "none" | "low" | "medium" | "high";
  relatedThoughts: number[]; // IDs of related thought entries
  analysis: {
    keyObservations: string[];
    potentialImplications: string[];
    suggestedFocus?: string;
  };
}> {
  const agentId = state.name;

  try {
    const prompt = composeFromTemplate(PROCESS_PERCEPTIONS, {
      ...state,
      currentStimuli: JSON.stringify(state.currentStimuli, null, 2),
      recentThoughtChain: JSON.stringify(state.recentThoughtChain, null, 2),
    });

    const text = await callLLM(prompt, state.systemPrompt, agentId);
    const parsed = parseJSON<{
      summary: string;
      significance: "none" | "low" | "medium" | "high";
      relatedThoughts: number[];
      analysis: {
        keyObservations: string[];
        potentialImplications: string[];
        suggestedFocus?: string;
      };
    }>(text);

    logger.debug("Processed perceptions:", {
      agentName: state.name,
      significance: parsed.significance,
      observationCount: parsed.analysis.keyObservations.length,
    });

    return parsed;
  } catch (error) {
    logger.error(`Failed to process perceptions:`, error);
    return {
      summary: "I am having trouble processing my surroundings.",
      significance: "none",
      relatedThoughts: [],
      analysis: {
        keyObservations: [],
        potentialImplications: [],
      },
    };
  }
}
