import { query } from "bitecs";
import { Agent, AgentCommunication } from "../components/agent/Agent";
import { Conversation } from "../components/conversation/Conversation";
import { generateResponse, formatConversationHistory } from "../llm/agent-llm";
import { logger } from "../utils/logger";
import { World } from "../types/bitecs";

export const ConversationSystem = async (world: World) => {
  const activeConversations = query(world, [Conversation]);

  for (const cid of activeConversations) {
    if (!Conversation.active[cid]) continue;

    const participants = Conversation.participants[cid];
    const messages = Conversation.messages[cid];

    // For each participant that needs to respond
    for (const aid of participants) {
      // Check if it's this agent's turn to respond
      if (shouldRespond(world, aid, cid)) {
        try {
          const response = await generateResponse(
            world,
            aid,
            Agent.systemPrompt[aid],
            AgentCommunication.context[aid],
            formatConversationHistory(messages)
          );

          // Add the response to conversation and log it
          const agentName = Agent.name[aid];
          logger.agent(aid, `${agentName}: ${response}`);

          // Store the message
          messages.push(`${agentName}: ${response}`);

          // Update agent's context with their response
          AgentCommunication.context[
            aid
          ] = `${AgentCommunication.context[aid]}\nJust said: ${response}`;
          AgentCommunication.lastResponse[aid] = response;

          // Update conversation state
          updateConversationState(world, cid);
        } catch (error) {
          logger.error(`Error in conversation for agent ${aid}: ${error}`);
        }
      }
    }
  }

  return world;
};

function shouldRespond(
  world: World,
  agentId: number,
  conversationId: number
): boolean {
  const messages = Conversation.messages[conversationId];
  if (!messages || messages.length === 0) return true;

  const lastMessage = messages[messages.length - 1];
  const lastSpeaker = getLastSpeaker(world, lastMessage);
  return lastSpeaker !== agentId;
}

function getLastSpeaker(world: World, message: string): number {
  if (!message) return -1;
  // Look for name pattern: "Name: message"
  const match = message.match(/^([^:]+):/);
  if (!match) return -1;

  const speakerName = match[1].trim();

  // Find agent ID by name
  const entities = query(world, [Agent]);
  for (const eid of entities) {
    if (Agent.name[eid] === speakerName) {
      return eid;
    }
  }
  return -1;
}

function getAgentName(world: World, agentId: number): string {
  return Agent.name[agentId] || `Agent${agentId}`;
}

function updateConversationState(world: World, conversationId: number): void {
  // Implementation here...
}
