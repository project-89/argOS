import { query } from "bitecs";
import { World } from "../types/bitecs";
import { Agent, AgentCognition } from "../components/agent/Agent";
import { logger } from "../utils/logger";
import { Stimulus } from "../types/cognitive";
import { Conversation } from "../components/conversation/Conversation";

export const PerceptionSystem = async (world: World) => {
  // Query for entities with perception-related components
  const perceivers = query(world, [Agent, AgentCognition]);

  for (const eid of perceivers) {
    if (!Agent.active[eid]) continue;

    try {
      // For now, just handle conversation messages as stimuli
      const messages = getUnprocessedMessages(world, eid);

      for (const message of messages) {
        // Log perception of message
        logger.agent(eid, `👂 Perceiving message: ${message}`);

        // Mark message as processed
        markMessageProcessed(world, eid, message);

        // Store in short-term memory
        AgentCognition.memory[eid].push(`Heard: ${message}`);
      }
    } catch (error) {
      logger.error(`Error in perception processing for agent ${eid}: ${error}`);
    }
  }

  return world;
};

function getUnprocessedMessages(world: World, agentId: number): string[] {
  // For now, just get messages from conversations this agent is part of
  const conversations = query(world, [Conversation]);
  const messages: string[] = [];

  for (const cid of conversations) {
    if (!Conversation.active[cid]) continue;

    const participants = Conversation.participants[cid];
    if (!participants.includes(agentId)) continue;

    // Get only new messages
    const lastProcessed = AgentCognition.memory[agentId].length;
    const newMessages = Conversation.messages[cid].slice(lastProcessed);
    messages.push(...newMessages);
  }

  return messages;
}

function markMessageProcessed(
  world: World,
  agentId: number,
  message: string
): void {
  // For now, just storing in memory marks it as processed
  // We can make this more sophisticated later
}
