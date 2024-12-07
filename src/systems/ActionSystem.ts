import { World } from "../types/bitecs";
import { query, setComponent } from "bitecs";
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
        setComponent(world, eid, Action, {
          availableTools: runtime.getAvailableTools(),
          pendingAction: Action.pendingAction[eid],
          lastActionTime: Action.lastActionTime[eid],
        });
      }

      // Process pending actions
      const pendingAction = Action.pendingAction[eid];
      if (!pendingAction) continue;

      logger.agent(eid, `Processing action: ${pendingAction.tool}`);

      // Emit action event
      runtime.eventBus.emitAgentEvent(
        eid,
        "action",
        "action",
        pendingAction.tool
      );

      // Execute the action
      await runtime.executeAction(
        pendingAction.tool,
        eid,
        pendingAction.parameters
      );

      // Clear pending action and update last action time
      setComponent(world, eid, Action, {
        pendingAction: null,
        lastActionTime: Date.now(),
        availableTools: Action.availableTools[eid],
      });
    }

    return world;
  }
);
