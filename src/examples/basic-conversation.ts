import { createWorld } from "bitecs";
import { createAgent } from "../utils/agent-factory";
import { startConversation } from "../utils/conversation-factory";
import { logger } from "../utils/logger";
import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { Conversation } from "../components/conversation/Conversation";

async function main() {
  logger.system("Starting simulation...");

  const world = createWorld();
  logger.system("World created");

  // Create two agents
  const agent1 = createAgent(world, {
    name: "Alice",
    role: "Curious Explorer",
    systemPrompt:
      "You are a friendly and curious individual who loves learning about others.",
    initialGoals: ["Learn about others"],
    initialEmotionalState: "curious",
  });

  const agent2 = createAgent(world, {
    name: "Sage",
    role: "Wise Mentor",
    systemPrompt: "You are a wise mentor who enjoys sharing knowledge.",
    initialGoals: ["Share wisdom"],
    initialEmotionalState: "serene",
  });

  // Start a conversation
  const conversationId = startConversation(
    world,
    [agent1, agent2],
    "Getting to know each other"
  );

  // Add initial message to kick things off
  Conversation.messages[conversationId] = [
    "System: The conversation begins. Alice and Sage meet for the first time in a quiet garden.",
  ];

  // Create and start runtime
  const runtime = new SimulationRuntime(world, { updateInterval: 2000 });
  await runtime.start();
}

main().catch(console.error);
