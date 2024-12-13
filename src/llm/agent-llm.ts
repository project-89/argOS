import { generateText } from "ai";
import {
  geminiFlashModel,
  gemini2FlashModel,
  geminiProModel,
} from "../config/ai-config";
import { GENERATE_THOUGHT, PROCESS_STIMULUS } from "../templates";
import { zodToJsonSchema } from "zod-to-json-schema";
import { EXTRACT_EXPERIENCES } from "../templates/process-stimulus";
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
  conversationState: {
    lastSpeaker: string;
    lastSpeechTime: number;
    greetingMade: boolean;
    unansweredQuestions: number;
    engagementLevel: "none" | "minimal" | "active";
    attemptsSinceResponse: number;
  };
  availableTools: Array<{
    name: string;
    description: string;
    parameters: string[];
    schema: any;
  }>;
}

/**
 * Core LLM call with consistent error handling and system prompt
 */
async function callLLM(prompt: string, systemPrompt: string): Promise<string> {
  try {
    const { text } = await generateText({
      model: gemini2FlashModel,
      // model: geminiProModel,
      // model: geminiFlashModel,
      prompt,
      system: systemPrompt,
    });
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
  const startTime = Date.now();
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

    // Log prompt
    llmLogger.logPrompt(agentId, prompt, state.systemPrompt);

    // Get LLM response
    const text = await callLLM(prompt, state.systemPrompt);
    const latency = Date.now() - startTime;
    llmLogger.logResponse(agentId, text, latency);

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
  conversationState: {
    lastSpeaker: string;
    lastSpeechTime: number;
    greetingMade: boolean;
    unansweredQuestions: number;
    engagementLevel: "none" | "minimal" | "active";
    attemptsSinceResponse: number;
  };
  stimulus: Array<{
    type: string;
    source: number;
    data: any;
    timestamp: number;
  }>;
}

export async function processStimulus(
  state: ProcessStimulusState
): Promise<string> {
  const startTime = Date.now();
  const agentId = state.name; // Using name as ID for now

  try {
    const prompt = composeFromTemplate(PROCESS_STIMULUS, {
      ...state,
      stimulus: JSON.stringify(state.stimulus, null, 2),
    });

    // Log prompt
    llmLogger.logPrompt(agentId, prompt, state.systemPrompt);

    // Get LLM response
    const text = await callLLM(prompt, state.systemPrompt);
    const latency = Date.now() - startTime;
    llmLogger.logResponse(agentId, text, latency);

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
  role: string;
  systemPrompt: string;
  recentExperiences: Experience[];
  timestamp: number;
  stimulus: {
    type: string;
    source: number;
    data: any;
  }[];
}

function isValidExperience(exp: any): exp is Experience {
  return (
    exp &&
    typeof exp === "object" &&
    ["speech", "action", "observation", "thought"].includes(exp.type) &&
    typeof exp.content === "string" &&
    typeof exp.timestamp === "number"
  );
}

function cleanAndParseJSON(text: string): Experience[] {
  // Remove JSON code block markers
  const jsonContent = text.replace(/```json\n|\n```/g, "").trim();

  try {
    const parsed = JSON.parse(jsonContent);
    if (!Array.isArray(parsed.experiences)) {
      throw new Error("Expected experiences array");
    }

    return parsed.experiences
      .map((exp: Experience) => (isValidExperience(exp) ? exp : null))
      .filter((exp: Experience): exp is Experience => exp !== null);
  } catch (e: unknown) {
    const error = e as Error;
    logger.error(`Failed to parse experiences: ${error.message}`);
    return [];
  }
}

export async function extractExperiences(
  state: ExtractExperiencesState
): Promise<Experience[]> {
  try {
    // Compose and log prompt using EXTRACT_EXPERIENCES template
    const prompt = composeFromTemplate(EXTRACT_EXPERIENCES, {
      ...state,
      recentExperiences: JSON.stringify(state.recentExperiences, null, 2),
      stimulus: JSON.stringify(state.stimulus, null, 2),
    });

    const text = await callLLM(prompt, state.systemPrompt);
    return cleanAndParseJSON(text);
  } catch (error) {
    logger.error(`Failed to extract experiences: ${error}`);
    return [];
  }
}
