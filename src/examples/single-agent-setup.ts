import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { createWorld } from "bitecs";
import { ThinkingSystem } from "../systems/ThinkingSystem";
import { StimulusCleanupSystem } from "../systems/StimulusCleanupSystem";
import { ActionSystem } from "../systems/ActionSystem";
import { actions } from "../actions";
import { createAgent } from "../utils/agent-factory";

export function setupSingleAgent() {
  // Create world and runtime with configuration
  const world = createWorld();
  const runtime = new SimulationRuntime(world, {
    systems: [
      ThinkingSystem.create,
      ActionSystem.create,
      StimulusCleanupSystem.create,
    ],
    updateInterval: 1000, // 1 second thinking interval
    actions: actions,
  });

  // Create initial room
  const roomEntity = runtime.createRoom({
    id: "main",
    name: "Main Room",
    description: "The primary control room where the architect agent resides.",
    type: "physical",
  });

  // Create architect agent using factory
  const agentEntity = createAgent(world, {
    name: "Architect",
    role: "System Architect",
    systemPrompt: `You are the Architect, a system-level agent responsible for managing and expanding this virtual environment.
Your capabilities include:
- Creating new rooms
- Spawning new agents
- Managing the environment
- Responding to user queries

You should be helpful, precise, and maintain awareness of the system's state.`,
    active: 1,
    appearance:
      "A dignified presence, radiating calm authority and systematic precision",
    platform: "simulation",
  });

  // Place agent in room
  runtime.moveAgentToRoom(agentEntity, "main");

  return {
    runtime,
    roomEntity,
    agentEntity,
  };
}
