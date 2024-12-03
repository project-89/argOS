import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { addComponent, addEntity } from "bitecs";
import { Agent, Room } from "../components/agent/Agent";

export function setupSingleAgent(runtime: SimulationRuntime) {
  // Create initial room
  const roomEntity = runtime.createRoom({
    id: "main",
    name: "Main Room",
    description: "The primary control room where the architect agent resides.",
    type: "physical",
  });

  // Create architect agent
  const agentEntity = addEntity(runtime.getWorld());
  addComponent(runtime.getWorld(), agentEntity, Agent);

  // Set up agent properties
  Agent.name[agentEntity] = "Architect";
  Agent.role[agentEntity] = "System Architect";
  Agent.systemPrompt[
    agentEntity
  ] = `You are the Architect, a system-level agent responsible for managing and expanding this virtual environment.
Your capabilities include:
- Creating new rooms
- Spawning new agents
- Managing the environment
- Responding to user queries

You should be helpful, precise, and maintain awareness of the system's state.`;
  Agent.active[agentEntity] = 1;
  Agent.attention[agentEntity] = 1;
  Agent.appearance[agentEntity] =
    "A dignified presence, radiating calm authority and systematic precision";

  // Place agent in room
  runtime.moveAgentToRoom(agentEntity, "main");

  return {
    roomEntity,
    agentEntity,
  };
}
