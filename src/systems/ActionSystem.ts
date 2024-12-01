import { World } from "../types/bitecs";
import { query } from "bitecs";
import { Agent, Action } from "../components/agent/Agent";
import { logger } from "../utils/logger";
import { createSystem, SystemConfig } from "./System";

// System for handling agent actions and tool usage
export const ActionSystem = createSystem<SystemConfig>(
  (runtime) => async (world: World) => {
    const agents = query(world, [Agent, Action]);
    logger.system(`Processing actions for ${agents.length} agents`);

    for (const eid of agents) {
      if (!Agent.active[eid]) continue;

      // Initialize available tools if not set
      if (!Action.availableTools[eid]) {
        Action.availableTools[eid] = runtime.getAvailableTools();
      }

      // Process pending actions
      const pendingAction = Action.pendingAction[eid];
      if (!pendingAction) continue;

      logger.agent(eid, `Processing action: ${pendingAction.tool}`);

      // Execute the action
      await runtime.executeAction(
        pendingAction.tool,
        eid,
        pendingAction.parameters
      );

      // Clear pending action
      Action.pendingAction[eid] = null;
      Action.lastActionTime[eid] = Date.now();
    }

    return world;
  }
);
