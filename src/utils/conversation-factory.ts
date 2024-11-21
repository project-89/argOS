import { addEntity, addComponent } from "bitecs";
import { Conversation } from "../components/conversation/Conversation";
import { AgentPrompt } from "../components/agent/AgentPrompt";
import { World } from "../types/bitecs";

export function startConversation(
  world: World,
  participants: number[],
  topic: string
) {
  const conversationId = addEntity(world);

  // Add conversation component
  addComponent(world, conversationId, Conversation);

  // Initialize conversation data
  Conversation.participants[conversationId] = participants;
  Conversation.messages[conversationId] = [];
  Conversation.topic[conversationId] = topic;
  Conversation.active[conversationId] = 1; // 1 for active, 0 for inactive

  // Update each participant's active conversation
  for (const participantId of participants) {
    AgentPrompt.activeConversation[participantId] = conversationId;
    AgentPrompt.currentContext[
      participantId
    ] = `In a conversation about: ${topic}`;
  }

  return conversationId;
}
