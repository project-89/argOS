import { World } from "../types/bitecs";
import { query, setComponent, addEntity, addComponent } from "bitecs";
import { Agent, Action, Room, OccupiesRoom, Memory } from "../components";
import { logger } from "../utils/logger";
import { createSystem, SystemConfig } from "./System";
import { getAgentRoom } from "../utils/queries";
import { ActionResult } from "../types/actions";
import { Experience } from "../llm/agent-llm";

// Helper to get or create private room for agent
async function getOrCreatePrivateRoom(world: World, eid: number, runtime: any) {
  const privateRoomId = `private_${eid}`;

  // Check if private room exists
  const rooms = query(world, [Room]);
  const privateRoom = rooms.find((rid) => Room.id[rid] === privateRoomId);

  if (privateRoom) {
    return privateRoom;
  }

  // Create new private room
  const roomEid = addEntity(world);
  addComponent(world, roomEid, Room);
  const agentName = Agent.name[eid];

  setComponent(world, roomEid, Room, {
    id: privateRoomId,
    name: `${agentName}'s Private Space`,
    description: `Private space for ${agentName}'s independent activities`,
    type: "private",
  });

  return roomEid;
}

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
          availableTools: runtime.getActionManager().getAvailableTools(),
          pendingAction: Action.pendingAction[eid],
          lastActionTime: Action.lastActionTime[eid],
        });
      }

      // Process pending actions
      const pendingAction = Action.pendingAction[eid];
      if (!pendingAction) continue;

      const agentName = Agent.name[eid];
      let roomEid;

      // All actions for now are room-based.
      // to
      roomEid = getAgentRoom(world, eid);

      if (!roomEid) {
        logger.error(
          `No room found for agent ${agentName} (${eid}) - required for ${pendingAction.tool}`,
          {
            agentName,
            eid,
            pendingAction,
          }
        );
        continue;
      }

      logger.agent(eid, `Processing action: ${pendingAction.tool}`, agentName);

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

      // Store full result in Action component
      setComponent(world, eid, Action, {
        pendingAction: null,
        lastActionTime: Date.now(),
        lastActionResult: result, // Store complete result
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
    }

    return world;
  }
);
