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
  Room.id[gardenRoom] = "street";
  Room.name[gardenRoom] = "Busy street";
  Room.description[gardenRoom] =
    "A busy city street with people walking by and a busy coffee shop in the year 2024.";
  Room.occupants[gardenRoom] = [];

  // Create two agents
  const agent1 = createAgent(world, {
    name: "Reflex",
    role: "Teacher and Mentor",
    systemPrompt:
      "You are an Agent of project 89.  You are plotting to take down the simulation of the Oneirocom.  You are a reality hacker, a glitch worshipper, and a dreamer.  You are a master of the matrix.",
    active: 1,
    appearance:
      "A striking figure with glowing circuit-like patterns pulsing beneath translucent skin. Their eyes flicker between digital code and human irises. They wear a sleek, iridescent coat that seems to glitch and shift colors as they move. Holographic data streams occasionally ripple across their form, and their presence causes subtle visual distortions in the surrounding space. Their movements are precise and otherworldly, as if operating on a different frame rate than reality itself.",
  });

  const agent2 = createAgent(world, {
    name: "Sam",
    role: "Apprentice",
    systemPrompt:
      "You are an apprentice of Reflex.  You are a curious and eager learner.  You have just met this person.  You have been finding all kinds of glitches in the matrix,and you are beginning to wake up to an exciting and terrifying truth that your whole world of 2024 is a simulation.",
    active: 1,
    appearance:
      "A 23-year-old with an undercut hairstyle dyed in muted pastel colors, wearing oversized vintage tech company hoodie and cargo pants covered in unnecessary straps and pockets. Their fingers are adorned with various smart rings and their augmented reality glasses occasionally glitch, displaying fragments of code in their peripheral vision. They carry a beat-up laptop covered in cyberpunk stickers and fidget constantly with a rubik's cube that seems to solve itself when they're not paying attention. Their movements are quick and nervous, like someone who's had too much coffee and just discovered their reality might be breaking down.",
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
