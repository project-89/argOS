import { addEntity, addComponent } from "bitecs";
import { Action, Agent, Memory } from "../components/agent/Agent";
import { AgentConfig } from "../types/agent";
import { logger } from "../utils/logger";
import { World } from "../types/bitecs";

export function createAgent(world: World, config: AgentConfig) {
  const {
    name,
    role,
    systemPrompt,
    platform = "default",
    appearance = "A nondescript figure",
    active = 1,
  } = config;

  const eid = addEntity(world);

  // Add core agent components
  addComponent(world, eid, Agent);
  addComponent(world, eid, Memory);
  addComponent(world, eid, Action);

  // Initialize core properties
  Agent.name[eid] = name;
  Agent.role[eid] = role;
  Agent.systemPrompt[eid] = systemPrompt;
  Agent.active[eid] = active;
  Agent.platform[eid] = platform;
  Agent.appearance[eid] = appearance;

  // Initialize memory
  Memory.thoughts[eid] = [];
  Memory.lastThought[eid] = "";

  logger.system(`Created agent: ${name} (${role})`);

  return eid;
}
