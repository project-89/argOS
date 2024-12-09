import { generateText } from "ai";
import { geminiFlashModel } from "../config/ai-config";
import { GENERATE_THOUGHT, PROCESS_STIMULUS } from "../templates";
import { zodToJsonSchema } from "zod-to-json-schema";
import { EXTRACT_EXPERIENCES } from "../templates/process-stimulus";

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
}

/**
 * Core LLM call with consistent error handling and system prompt
 */
async function callLLM(prompt: string, systemPrompt: string): Promise<string> {
  try {
    const { text } = await generateText({
      model: geminiFlashModel,
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
    const prompt = composeFromTemplate(GENERATE_THOUGHT, {
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
    const text = await callLLM(prompt, state.systemPrompt);

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
            console.error(
              "Action parameters failed schema validation:",
              validationError
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
      console.error("Error parsing thought response:", parseError);
      return {
        thought: text || "I have nothing to think about at the moment.",
      };
    }
  } catch (error) {
    console.error("Error in thought generation:", error);
    return { thought: "My mind is blank right now." };
  }
}

export interface ProcessStimulusState {
  systemPrompt: string;
  name: string;
  role: string;
  stimulus: Array<{
    type: string;
    source: number;
    data: any;
  }>;
}

export async function processStimulus(
  state: ProcessStimulusState
): Promise<string> {
  try {
    const prompt = composeFromTemplate(PROCESS_STIMULUS, {
      ...state,
      stimulus: JSON.stringify(state.stimulus, null, 2),
    });

    const text = await callLLM(prompt, state.systemPrompt);
    return text || "I perceive nothing of note.";
  } catch (error) {
    console.error("Error processing stimulus:", error);
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

export async function extractExperiences(
  state: ExtractExperiencesState
): Promise<Experience[]> {
  try {
    const prompt = composeFromTemplate(EXTRACT_EXPERIENCES, {
      ...state,
      recentExperiences: JSON.stringify(state.recentExperiences, null, 2),
      stimulus: JSON.stringify(state.stimulus, null, 2),
    });

    const text = await callLLM(prompt, state.systemPrompt);

    // Parse and validate experiences
    const experiences = text
      .split("\n")
      .reduce((acc: any[], line: string) => {
        try {
          // Clean up markdown and other formatting
          const cleanLine = line.replace(/^```json\s*|\s*```$/g, "").trim();
          if (!cleanLine || cleanLine.startsWith("#")) return acc;

          // Try parsing as complete JSON object first
          try {
            const exp = JSON.parse(cleanLine);
            if (isValidExperience(exp)) {
              acc.push(exp);
            }
            return acc;
          } catch {
            // If not complete JSON, collect lines until we have a complete object
            acc.push(cleanLine);

            // Try parsing accumulated lines as JSON
            const joined = acc.join("");
            if (joined.includes("}")) {
              try {
                const exp = JSON.parse(joined);
                if (isValidExperience(exp)) {
                  return [exp];
                }
              } catch {}
            }
          }
          return acc;
        } catch (e) {
          console.error("Failed to parse experience line:", line);
          return acc;
        }
      }, [])
      .filter((exp): exp is Experience => isValidExperience(exp));

    return experiences;
  } catch (e) {
    console.error("Failed to extract experiences:", e);
    return [];
  }
}

function isValidExperience(exp: any): exp is Experience {
  return (
    typeof exp === "object" &&
    ["speech", "action", "observation", "thought"].includes(exp.type) &&
    typeof exp.content === "string" &&
    typeof exp.timestamp === "number"
  );
}
