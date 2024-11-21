import { createWorld } from "bitecs";
import { createAgent } from "../utils/agent-factory";
import { ConversationSystem } from "../systems/ConversationSystem";
import { startConversation } from "../utils/conversation-factory";
import { logger } from "../utils/logger";

async function main() {
  logger.system("Starting simulation...");

  // Create world
  const world = createWorld();
  logger.system("World created");

  // Create two agents with more detailed initialization
  const agent1 = createAgent(world, {
    name: "Alice",
    role: "Curious Explorer",
    systemPrompt:
      "You are a friendly and curious individual who loves learning about others. You ask thoughtful questions and share your own experiences enthusiastically.",
    initialGoals: ["Learn about others", "Share experiences"],
    initialEmotionalState: "excited",
  });

  const agent2 = createAgent(world, {
    name: "Sage",
    role: "Wise Mentor",
    systemPrompt:
      "You are a wise mentor who enjoys sharing knowledge and experiences. You provide thoughtful insights while remaining humble and encouraging others to discover their own wisdom.",
    initialGoals: ["Share wisdom", "Guide others"],
    initialEmotionalState: "serene",
  });

  logger.system(`Created agents: ${agent1}, ${agent2}`);

  // Start a conversation between them
  const conversationId = startConversation(
    world,
    [agent1, agent2],
    "Getting to know each other"
  );
  logger.conversation(`Started conversation: ${conversationId}`);

  // Run simulation
  async function update() {
    try {
      await ConversationSystem(world);
      setTimeout(update, 1000);
    } catch (error) {
      logger.error(`Error in update loop: ${error}`);
    }
  }

  await update();
}

// Run the simulation
main().catch((error) => logger.error(error));
