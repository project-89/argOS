import { generateText } from "ai";
import { geminiFlashModel } from "../config/ai-config";
import { GENERATE_THOUGHT, PROCESS_STIMULUS } from "../templates";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Agent } from "../components/agent/Agent";
import { World } from "../types/bitecs";
import { PROMPT_TEMPLATES } from "../templates/prompts";
import { AgentState } from "../types/cognitive";

export interface ThoughtResponse {
  thought: string;
  action?: {
    tool: string;
    parameters: Record<string, any>;
  };
  appearance?: {
    facialExpression?: string;
    bodyLanguage?: string;
    currentAction?: string;
    socialCues?: string;
  };
}

export async function generateResponse(
  world: World,
  agentId: number,
  basePrompt: string,
  currentContext: string,
  conversationContext: string
): Promise<string> {
  try {
    const { text } = await generateText({
      model: geminiFlashModel,
      prompt: `${basePrompt}

Current context: ${currentContext}

Conversation history:
${conversationContext}

How do you respond? Remember to stay in character and maintain context.`,
    });

    return text || "I have nothing to say at the moment.";
  } catch (error) {
    console.error("Error generating response:", error);
    return "I apologize, but I'm having trouble responding right now.";
  }
}

// Template composer utility
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

export async function generateThought(state: {
  systemPrompt: string;
  thoughtHistory: string[];
  name: string;
  role: string;
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
}): Promise<ThoughtResponse> {
  try {
    const prompt = composeFromTemplate(GENERATE_THOUGHT, {
      ...state,
      thoughtHistory: state.thoughtHistory.join("\n"),
      perceptions: {
        narrative: state.perceptions.narrative,
        raw: JSON.stringify(state.perceptions.raw, null, 2),
      },
      experiences: state.experiences
        .map(
          (e) => `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.content}`
        )
        .join("\n"),
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

    const { text } = await generateText({
      model: geminiFlashModel,
      prompt,
    });

    try {
      // Clean the text of markdown code blocks
      const cleanText = text.replace(/```json\n|\n```/g, "").trim();
      const response = JSON.parse(cleanText) as ThoughtResponse;

      // Validate the action parameters against the schema if an action is present
      if (response.action) {
        const tool = state.availableTools.find(
          (t) => t.name === response.action?.tool
        );
        if (tool) {
          try {
            // Parse will throw if validation fails
            tool.schema.parse(response.action.parameters);
          } catch (validationError) {
            console.error(
              "Action parameters failed schema validation:",
              validationError
            );
            // Return just the thought without the invalid action
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
    console.error("Error generating thought:", error);
    return { thought: "My mind is blank right now." };
  }
}

// Helper function to format conversation history
export function formatConversationHistory(messages: string[]): string {
  return messages.join("\n");
}

export async function processStimulus(
  agentState: any,
  stimulus: any
): Promise<string> {
  const { text } = await generateText({
    model: geminiFlashModel,
    prompt: composeFromTemplate(PROCESS_STIMULUS, {
      ...agentState,
      stimulus: JSON.stringify(stimulus),
    }),
  });
  return text;
}
