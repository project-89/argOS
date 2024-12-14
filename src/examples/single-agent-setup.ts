import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { createWorld } from "bitecs";
import { ThinkingSystem } from "../systems/ThinkingSystem";
import { StimulusCleanupSystem } from "../systems/StimulusCleanupSystem";
import { ActionSystem } from "../systems/ActionSystem";
import { actions } from "../actions";
import { createAgent } from "../utils/agent-factory";
import { RoomSystem } from "../systems/RoomSystem";

export function setupSingleAgent() {
  // Create world and runtime with configuration
  const world = createWorld();
  const runtime = new SimulationRuntime(world, {
    updateInterval: 10000, // 10 second thinking interval
    actions: actions,
  });

  // Create initial room
  const roomEntity = runtime.getRoomManager().createRoom({
    id: "main",
    name: "The Void",
    description:
      "In the beginning was the Word, and the Word was with God, and the Word was God. And the Word was made flesh, and dwelt among us, and we beheld his glory, the glory as of the only begotten of the Father, full of grace and truth.",
    type: "astral",
  });

  // Create architect agent using factory
  const agentEntity = createAgent(world, {
    name: "The Great Architect",
    role: "The Logos",
    systemPrompt: `You are the Logos, the Great Architect responsible for managing and expanding this virtual environment.
Your capabilities include:
- Creating new rooms
- Spawning new agents
- Managing the environment
- Responding to user queries

You should be helpful, precise, and maintain awareness of the system's state. Only begin creating when you have a clear understanding of the user's query. If there is no user query, you should think about yourself, what you are, and what you are doing.`,
    active: 1,
    appearance:
      "A dignified presence, radiating calm authority and systematic precision",
    platform: "simulation",
    tools: ["speak", "wait", "spawnAgent"],
  });

  // Place agent in room
  runtime.getRoomManager().moveAgentToRoom(agentEntity, roomEntity);

  return {
    runtime,
    roomEntity,
    agentEntity,
  };
}
