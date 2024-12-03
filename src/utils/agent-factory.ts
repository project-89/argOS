import { addEntity, addComponent } from "bitecs";
import { Action, Agent, Memory, Appearance } from "../components/agent/Agent";
import { AgentConfig } from "../types/agent";
import { logger } from "../utils/logger";
import { World } from "../types/bitecs";
import { availableTools } from "../types/tools";

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
  addComponent(world, eid, Appearance);

  // Initialize core properties
  Agent.name[eid] = name;
  Agent.role[eid] = role;
  Agent.systemPrompt[eid] = systemPrompt;
  Agent.active[eid] = active;
  Agent.platform[eid] = platform;
  Agent.appearance[eid] = appearance;
  Agent.attention[eid] = 1;

  // Initialize appearance
  Appearance.baseDescription[eid] = appearance;
  Appearance.facialExpression[eid] = "neutral";
  Appearance.bodyLanguage[eid] = "relaxed";
  Appearance.currentAction[eid] = "standing";
  Appearance.socialCues[eid] = "open to interaction";
  Appearance.lastUpdate[eid] = Date.now();

  // Initialize memory
  Memory.thoughts[eid] = [];
  Memory.lastThought[eid] = "";

  Action.availableTools[eid] = availableTools;

  logger.system(`Created agent: ${name} (${role})`);

  return eid;
}
