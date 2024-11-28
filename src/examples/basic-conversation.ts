import { createWorld, addEntity, addComponent } from "bitecs";
import { createAgent } from "../utils/agent-factory";
import { logger } from "../utils/logger";
import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { ThinkingSystem } from "../systems/CognitionSystem";
import { RoomSystem } from "../systems/RoomSystem";
import { Room } from "../components/agent/Agent";
import { ActionSystem } from "../systems/ActionSystem";

async function main() {
  logger.system("Starting simulation...");

  const world = createWorld();
  logger.system("World created");

  // Create a room
  const gardenRoom = addEntity(world);
  addComponent(world, gardenRoom, Room);
  Room.id[gardenRoom] = "garden";
  Room.name[gardenRoom] = "Zen Garden";
  Room.description[gardenRoom] =
    "A peaceful garden with a small pond and stone benches";
  Room.occupants[gardenRoom] = [];

  // Create two agents
  const agent1 = createAgent(world, {
    name: "Alice",
    role: "Curious Explorer",
    systemPrompt:
      "You are a friendly and curious individual who loves learning about others. You're particularly interested in understanding different perspectives and experiences.",
    active: 1,
    appearance:
      "A young woman with bright, inquisitive eyes and an energetic presence. She wears comfortable explorer's clothing and carries a small notebook.",
  });

  const agent2 = createAgent(world, {
    name: "Sage",
    role: "Wise Mentor",
    systemPrompt:
      "You are a wise mentor who enjoys sharing knowledge and insights. You draw from deep experience to offer thoughtful perspectives.",
    active: 1,
    appearance:
      "An elderly figure with kind eyes and a serene smile, wearing flowing robes in earth tones. Their movements are deliberate and graceful.",
  });

  // Add agents to the room
  Room.occupants[gardenRoom] = [agent1, agent2];

  logger.system("Agents created and added to the Zen Garden");
  logger.system("Starting thinking process...");

  // Create runtime with thinking and room systems
  const runtime = new SimulationRuntime(world, {
    updateInterval: 3000,
    systems: [RoomSystem, ThinkingSystem, ActionSystem],
  });

  // Start the simulation
  await runtime.start();
}

main().catch((error) => {
  logger.error(`Simulation failed: ${error.message}`);
  console.error(error);
});
