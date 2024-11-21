import { generateText } from "ai";
import { aiModel } from "../config/ai-config";
import { Agent } from "../components/agent/Agent";
import { World } from "../types/bitecs";
import { PROMPT_TEMPLATES } from "../templates/prompts";
import { AgentState } from "../types/cognitive";

export async function generateResponse(
  world: World,
  agentId: number,
  basePrompt: string,
  currentContext: string,
  conversationContext: string
): Promise<string> {
  try {
    const { text } = await generateText({
      model: aiModel,
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

// Helper function to format conversation history
export function formatConversationHistory(messages: string[]): string {
  return messages.join("\n");
}

export async function generateThought(
  world: World,
  agentId: number,
  basePrompt: string,
  context: string,
  goals: string[],
  emotionalState: string
): Promise<string> {
  try {
    const { text } = await generateText({
      model: aiModel,
      prompt: `${basePrompt}

Current context:
${context}

Goals:
${goals.join("\n")}

Emotional state: ${emotionalState}

Based on your personality, goals, and current state, what are you thinking about? What's your internal monologue?
Respond in first person, as if sharing your thoughts.`,
    });

    return text || "I'm not sure what to think right now.";
  } catch (error) {
    console.error("Error generating thought:", error);
    return "My mind is clouded at the moment.";
  }
}

export async function processStimulus(
  world: World,
  agentId: number,
  agentState: AgentState,
  stimulus: any
): Promise<string> {
  const { text } = await generateText({
    model: aiModel,
    prompt: formatPrompt(PROMPT_TEMPLATES.PROCESS_STIMULUS, {
      ...agentState,
      stimulus: JSON.stringify(stimulus),
    }),
  });
  return text;
}

export async function decideAction(
  world: World,
  agentId: number,
  agentState: AgentState
): Promise<string | null> {
  const { text } = await generateText({
    model: aiModel,
    prompt: formatPrompt(PROMPT_TEMPLATES.AUTONOMOUS_ACTION, agentState),
  });
  return text;
}

function formatPrompt(template: string, values: Record<string, any>): string {
  return template.replace(
    /{(\w+)}/g,
    (match, key) => values[key]?.toString() || match
  );
}
