import { query, setComponent, addEntity, addComponent, World } from "bitecs";
import { Agent, Action, Room, OccupiesRoom, Memory } from "../components";
import { logger } from "../utils/logger";
import { createSystem, SystemConfig } from "./System";
import { getAgentRoom } from "../utils/queries";
import { ActionResult } from "../types/actions";
import { Experience } from "../llm/agent-llm";

// Helper to get or create private room for agent
async function getOrCreatePrivateRoom(world: World, eid: number, runtime: any) {
  const privateRoomId = `private_${eid}`;
  const agentName = Agent.name[eid];

  // Check if private room exists
  const rooms = query(world, [Room]);
  const privateRoom = rooms.find((rid) => Room.id[rid] === privateRoomId);

  if (privateRoom) {
    logger.agent(eid, "Using existing private room", agentName);
    return privateRoom;
  }

  // Create new private room
  const roomEid = addEntity(world);
  addComponent(world, roomEid, Room);

  setComponent(world, roomEid, Room, {
    id: privateRoomId,
    name: `${agentName}'s Private Space`,
    description: `Private space for ${agentName}'s independent activities`,
    type: "private",
  });

  logger.agent(eid, "Created new private room", agentName);
  return roomEid;
}

// System for handling agent actions and tool usage
export const ActionSystem = createSystem<SystemConfig>(
  (runtime) => async (world: World) => {
    const agents = query(world, [Agent, Action]);
    logger.system("ActionSystem", `Processing ${agents.length} agents`);

    for (const eid of agents) {
      if (!Agent.active[eid]) continue;

      const agentName = Agent.name[eid];

      // Initialize available tools if not set
      if (!Action.availableTools[eid]) {
        logger.agent(eid, "Initializing available tools", agentName);
        setComponent(world, eid, Action, {
          availableTools: runtime.getActionManager().getAvailableTools(),
          pendingAction: Action.pendingAction[eid],
          lastActionTime: Action.lastActionTime[eid],
        });
      }

      // Process pending actions
      const pendingAction = Action.pendingAction[eid];
      if (!pendingAction) continue;

      let roomEid = getAgentRoom(world, eid);

      if (!roomEid) {
        logger.agent(
          eid,
          `No room found - required for action: ${pendingAction.tool}`,
          agentName
        );
        continue;
      }

      logger.agent(
        eid,
        `Executing action: ${pendingAction.tool} with params: ${JSON.stringify(
          pendingAction.parameters
        )}`,
        agentName
      );

      // Emit action event to appropriate room context
      runtime.eventBus.emitRoomEvent(
        roomEid,
        "action",
        {
          action: pendingAction.tool,
          reason: pendingAction.parameters.reason || "Taking action",
          parameters: pendingAction.parameters,
          agentName,
          context: "room",
        },
        String(eid)
      );

      // Execute the action
      const result = await runtime
        .getActionManager()
        .executeAction(
          pendingAction.tool,
          eid,
          pendingAction.parameters,
          runtime
        );

      logger.agent(
        eid,
        `Action completed: ${pendingAction.tool}\nParameters: ${JSON.stringify(
          pendingAction.parameters,
          null,
          2
        )}\nResult: ${result.message}`,
        agentName
      );

      // Broadcast action result to room
      runtime.eventBus.emitRoomEvent(
        roomEid,
        "action",
        {
          action: pendingAction.tool,
          parameters: pendingAction.parameters,
          result: result.message,
          success: result.success,
          agentName,
          context: "room",
          timestamp: Date.now(),
        },
        String(eid)
      );

      // Store full result in Action component
      setComponent(world, eid, Action, {
        pendingAction: null,
        lastActionTime: Date.now(),
        lastActionResult: result,
        availableTools: Action.availableTools[eid],
      });

      const experienceMessage = `${pendingAction.tool}: ${result.message}`;
      const experience: Experience = {
        type: "action",
        content: experienceMessage,
        timestamp: result.timestamp,
      };

      const oldExperiences = Memory.experiences[eid] || [];
      const newExperiences = [...oldExperiences, experience];

      setComponent(world, eid, Memory, {
        experiences: newExperiences,
      });

      // Emit action experience event
      runtime.eventBus.emitAgentEvent(eid, "experience", "action", experience);
      logger.agent(eid, "Action cycle completed", agentName);
    }

    return world;
  }
);
