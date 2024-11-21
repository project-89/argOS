import { generateText } from "ai";
import { aiModel } from "../config/ai-config";
import { Agent } from "../components/agent/Agent";
import { World } from "../types/bitecs";

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
