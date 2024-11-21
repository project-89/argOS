import { addEntity, addComponent } from "bitecs";
import {
  Agent,
  AgentCommunication,
  AgentCognition,
} from "../components/agent/Agent";
import { AgentConfig } from "../types/agent";
import { logger } from "../utils/logger";
import { World } from "../types/bitecs";

export function createAgent(world: World, config: AgentConfig) {
  const {
    name,
    role,
    systemPrompt,
    platform = "default",
    initialGoals = [],
    initialContext = "Just initialized",
    initialEmotionalState = "neutral",
  } = config;

  const eid = addEntity(world);

  // Add core agent components
  addComponent(world, eid, Agent);
  addComponent(world, eid, AgentCommunication);
  addComponent(world, eid, AgentCognition);

  // Initialize core properties
  Agent.name[eid] = name;
  Agent.role[eid] = role;
  Agent.systemPrompt[eid] = systemPrompt;
  Agent.active[eid] = 1;
  Agent.platform[eid] = platform;

  // Initialize communication
  AgentCommunication.context[eid] = initialContext;
  AgentCommunication.messageHistory[eid] = [];
  AgentCommunication.lastResponse[eid] = "";
  AgentCommunication.currentConversation[eid] = 0;

  // Initialize cognitive state
  AgentCognition.goals[eid] = initialGoals;
  AgentCognition.memory[eid] = [];
  AgentCognition.attention[eid] = 1;
  AgentCognition.emotionalState[eid] = initialEmotionalState;

  logger.system(`Created agent: ${name} (${role})`);

  return eid;
}
