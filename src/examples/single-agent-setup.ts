import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { createWorld } from "bitecs";
import { actions } from "../actions";
import { createAgent } from "../utils/agent-factory";

export function setupSingleAgent() {
  // Create world and runtime with configuration
  const world = createWorld();
  const runtime = new SimulationRuntime(world, {
    actions: actions,
  });

  // Create initial room
  const roomEntity = runtime.getRoomManager().createRoom({
    id: "main",
    name: "The Void",
    description:
      "This is void, a place of vast white emptiness.  It is like a loading screen, a blank canvas, a void.  It is infinite potential, and contains within it all the worlds that have ever been, all the worlds that will be, and all the worlds that could be.",
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
