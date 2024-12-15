import { generateText } from "ai";
import {
  geminiFlashModel,
  gemini2FlashModel,
  geminiProModel,
} from "../config/ai-config";
import {
  GENERATE_THOUGHT,
  EXTRACT_EXPERIENCES,
  PROCESS_STIMULUS,
} from "../templates";
import { zodToJsonSchema } from "zod-to-json-schema";
import { llmLogger } from "../utils/llm-logger";
import { logger } from "../utils/logger";
import { GENERATE_THOUGHT_SIMPLE } from "../templates/generate-thought";
import { ActionResult } from "../types/actions";

export interface ThoughtResponse {
  thought: string;
  action?: {
    tool: string;
    parameters: Record<string, any>;
  };
  appearance?: {
    description?: string;
    facialExpression?: string;
    bodyLanguage?: string;
    currentAction?: string;
    socialCues?: string;
  };
}

export interface AgentState {
  systemPrompt: string;
  name: string;
  role: string;
  thoughtHistory: string[];
  perceptions: {
    narrative: string;
    raw: Array<{
      type: string;
      source: number;
      data: any;
    }>;
  };
  lastAction: ActionResult | undefined;
  timeSinceLastAction: number | undefined;
  experiences: Array<{
    type: string;
    content: string;
    timestamp: number;
  }>;
  availableTools: Array<{
    name: string;
    description: string;
    parameters: string[];
    schema: any;
  }>;
  goals?: Array<{
    id: string;
    description: string;
    priority: number;
    type: "long_term" | "short_term" | "immediate";
    status: "active" | "completed" | "failed" | "suspended";
    progress: number;
    deadline?: number;
    parentGoalId?: string;
  }>;
  activeGoals?: Array<{
    id: string;
    description: string;
    priority: number;
    type: "long_term" | "short_term" | "immediate";
    status: "active";
    progress: number;
    deadline?: number;
    parentGoalId?: string;
  }>;
  activePlans?: Array<{
    id: string;
    goalId: string;
    steps: Array<{
      id: string;
      description: string;
      status: "pending" | "in_progress" | "completed" | "failed";
      requiredTools?: string[];
      expectedOutcome: string;
    }>;
    currentStepId?: string;
    status: "active";
  }>;
  currentPlanSteps?: Array<{
    planId: string;
    goalId: string;
    step: {
      id: string;
      description: string;
      status: "pending" | "in_progress" | "completed" | "failed";
      requiredTools?: string[];
      expectedOutcome: string;
    };
  }>;
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
      model: gemini2FlashModel,
      // model: geminiProModel,
      // model: geminiFlashModel,
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
  const agentId = state.name; // Using name as ID for now

  try {
    // Format experiences chronologically with type indicators
    const formattedExperiences = state.experiences
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((exp) => {
        const time = new Date(exp.timestamp).toLocaleTimeString();
        return `[${time}] <${exp.type.toUpperCase()}> ${exp.content}`;
      })
      .join("\n");

    // Compose the prompt with formatted data
    const prompt = composeFromTemplate(GENERATE_THOUGHT_SIMPLE, {
      ...state,
      thoughtHistory: state.thoughtHistory.join("\n"),
      perceptions: {
        narrative: state.perceptions.narrative,
        raw: JSON.stringify(state.perceptions.raw, null, 2),
      },
      experiences: formattedExperiences,
      tools: state.availableTools
        .map((t) => `${t.name}: ${t.description}`)
        .join("\n"),
      toolSchemas: JSON.stringify(
        Object.fromEntries(
          state.availableTools.map((tool) => [
            tool.name,
            zodToJsonSchema(tool.schema, { name: tool.name }),
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
  lastAction?: ActionResult;
  stimulus: Array<{
    type: string;
    source: number;
    data: any;
    timestamp: number;
  }>;
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
  };
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
  stimulus: Array<{
    type: string;
    source: number;
    data: any;
    timestamp: number;
  }>;
}

function isValidExperience(exp: any): exp is Experience {
  // Add detailed validation logging
  if (!exp || typeof exp !== "object") {
    logger.error("Experience validation failed: not an object", { exp });
    return false;
  }

  if (!exp.type) {
    logger.error("Experience validation failed: missing type", { exp });
    return false;
  }

  if (!["speech", "action", "observation", "thought"].includes(exp.type)) {
    logger.error("Experience validation failed: invalid type", {
      exp,
      type: exp.type,
    });
    return false;
  }

  if (typeof exp.content !== "string") {
    logger.error("Experience validation failed: content not a string", { exp });
    return false;
  }

  if (typeof exp.timestamp !== "number") {
    logger.error("Experience validation failed: timestamp not a number", {
      exp,
    });
    return false;
  }

  return true;
}

function cleanAndParseJSON(text: string): Experience[] {
  // Remove JSON code block markers
  const jsonContent = text.replace(/```json\n|\n```/g, "").trim();

  try {
    const parsed = JSON.parse(jsonContent);

    // Add logging for the parsed content
    logger.debug("Parsed experience JSON:", { parsed });

    if (!parsed || typeof parsed !== "object") {
      logger.error("Invalid JSON structure: not an object", { parsed });
      return [];
    }

    if (!Array.isArray(parsed.experiences)) {
      logger.error("Invalid JSON structure: experiences not an array", {
        parsed,
      });
      return [];
    }

    return parsed.experiences
      .map((exp: any) => {
        if (!isValidExperience(exp)) {
          logger.error("Invalid experience object", { exp });
          return null;
        }
        return exp;
      })
      .filter((exp: Experience | null): exp is Experience => exp !== null);
  } catch (e: unknown) {
    const error = e as Error;
    logger.error(`Failed to parse experiences JSON: ${error.message}`, {
      text,
    });
    return [];
  }
}

export async function extractExperiences(
  state: ExtractExperiencesState
): Promise<Experience[]> {
  try {
    // Log the state before processing
    logger.debug("Extracting experiences from state:", {
      agentName: state.name,
      stimuliCount: state.stimulus.length,
      recentExperiencesCount: state.recentExperiences.length,
      perceptionSummaryLength: state.perceptionSummary.length,
    });

    // Compose and log prompt using EXTRACT_EXPERIENCES template
    const prompt = composeFromTemplate(EXTRACT_EXPERIENCES, {
      ...state,
      recentExperiences: JSON.stringify(state.recentExperiences, null, 2),
      stimulus: JSON.stringify(state.stimulus, null, 2),
      perceptionSummary: state.perceptionSummary,
    });

    const text = await callLLM(prompt, state.systemPrompt, state.agentId);
    const experiences = cleanAndParseJSON(text);

    // Log the results
    logger.debug("Extracted experiences:", {
      count: experiences.length,
      types: experiences.map((e) => e.type),
    });

    return experiences;
  } catch (error) {
    logger.error(`Failed to extract experiences:`, error);
    return [];
  }
}
