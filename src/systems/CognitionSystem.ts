import { World } from "../types/bitecs";
import { query } from "bitecs";
import { Agent, Memory, Perception, Action } from "../components/agent/Agent";
import { generateThought } from "../llm/agent-llm";
import { logger } from "../utils/logger";

// System for handling agent's internal thought process
export const ThinkingSystem = async (world: World) => {
  const agents = query(world, [Agent, Memory]);

  logger.system(`ThinkingSystem starting...`);
  logger.system(`Found ${agents.length} agents`);

  // Process each agent's thoughts sequentially
  for (const eid of agents) {
    // Only think if agent is active
    if (!Agent.active[eid]) continue;

    // Get thought history or initialize empty
    Memory.thoughts[eid] = Memory.thoughts[eid] || [];
    Memory.experiences[eid] = Memory.experiences[eid] || [];

    // Prepare agent state with current perceptions and experiences
    const agentState = {
      name: Agent.name[eid],
      role: Agent.role[eid],
      systemPrompt: Agent.systemPrompt[eid],
      thoughtHistory: Memory.thoughts[eid],
      perceptions: Perception.currentStimuli[eid] || [],
      experiences: Memory.experiences[eid] || [],
      availableTools: Action.availableTools[eid] || [],
    };

    // Generate a new thought and potential action
    const response = await generateThought(agentState);
    logger.agent(eid, `Thought: ${response.thought}`);

    // Store the thought
    Memory.lastThought[eid] = response.thought;
    Memory.thoughts[eid].push(response.thought);

    // If the agent decided to take an action, queue it
    if (response.action) {
      logger.agent(eid, `Queuing action: ${response.action.tool}`);
      Action.pendingAction[eid] = response.action;
    }

    // Keep thought history at a reasonable size (last 10 thoughts)
    if (Memory.thoughts[eid].length > 100) {
      Memory.thoughts[eid].shift();
    }
  }

  return world;
};
