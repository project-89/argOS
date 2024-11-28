import { generateText } from "ai";
import { geminiFlashModel } from "../config/ai-config";
import { Agent } from "../components/agent/Agent";
import { World } from "../types/bitecs";
import { PROMPT_TEMPLATES } from "../templates/prompts";
import { AgentState } from "../types/cognitive";

interface ThoughtResponse {
  thought: string;
  action?: {
    tool: string;
    parameters: Record<string, string>;
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
  return template.replace(/\${(\w+)}/g, (_, key) => state[key] || "");
}

export async function generateThought(state: {
  systemPrompt: string;
  thoughtHistory: string[];
  name: string;
  role: string;
  perceptions: Array<{
    type: string;
    source: number;
    data: {
      name: string;
      role: string;
      appearance: string;
      location: {
        roomId: string;
        roomName: string;
      };
    };
  }>;
  experiences: Array<{
    type: string;
    content: string;
    timestamp: number;
  }>;
  availableTools: Array<{
    name: string;
    description: string;
    parameters: string[];
  }>;
}): Promise<ThoughtResponse> {
  try {
    const prompt = composeFromTemplate(
      `
\${systemPrompt}

Name: \${name}
Role: \${role}

Previous thoughts:
\${thoughtHistory}

Current environment:
\${environment}

Recent experiences:
\${experiences}

Available actions:
\${tools}

Based on your current state, generate your next thought and optionally choose an action to take.
Remember to stay in character and maintain context.

Respond with a JSON object containing:
1. A "thought" field expressing your internal monologue
2. Optionally, an "action" object if you want to do something, containing:
   - "tool": one of the available tool names
   - "parameters": an object with the required parameters for the tool

Example response:
{
  "thought": "I notice someone new has entered the room. I should greet them.",
  "action": {
    "tool": "speak",
    "parameters": {
      "message": "Hello there! Welcome to our gathering."
    }
  }
}`,
      {
        ...state,
        thoughtHistory: state.thoughtHistory.join("\n"),
        environment:
          state.perceptions.length > 0
            ? `You are in ${state.perceptions[0].data.location.roomName}. Present with you:\n` +
              state.perceptions
                .map(
                  (p) =>
                    `- ${p.data.name} (${p.data.role}): ${p.data.appearance}`
                )
                .join("\n")
            : "You are alone.",
        experiences:
          state.experiences
            .slice(-3)
            .map((e) => `- ${e.content}`)
            .join("\n") || "No recent experiences",
        tools: state.availableTools
          .map(
            (t) =>
              `- ${t.name}: ${t.description} (Parameters: ${t.parameters.join(
                ", "
              )})`
          )
          .join("\n"),
      }
    );

    const { text } = await generateText({
      model: geminiFlashModel,
      prompt,
    });

    try {
      // Clean the text of markdown code blocks
      const cleanText = text.replace(/```json\n|\n```/g, "").trim();
      const response = JSON.parse(cleanText) as ThoughtResponse;
      return {
        thought:
          response.thought || "I have nothing to think about at the moment.",
        action: response.action,
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
    prompt: composeFromTemplate(PROMPT_TEMPLATES.PROCESS_STIMULUS, {
      ...agentState,
      stimulus: JSON.stringify(stimulus),
    }),
  });
  return text;
}

export async function decideAction(agentState: any): Promise<string | null> {
  const { text } = await generateText({
    model: geminiFlashModel,
    prompt: composeFromTemplate(PROMPT_TEMPLATES.AUTONOMOUS_ACTION, agentState),
  });
  return text;
}
