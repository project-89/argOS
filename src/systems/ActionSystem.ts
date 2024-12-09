import { World } from "../types/bitecs";
import { query, setComponent, addEntity, addComponent } from "bitecs";
import { Agent, Action, Room, OccupiesRoom } from "../components/agent/Agent";
import { logger } from "../utils/logger";
import { createSystem, SystemConfig } from "./System";
import { getAgentRoom } from "../utils/queries";

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

// Helper to determine if action needs room context
function isRoomBasedAction(tool: string) {
  const ROOM_BASED_ACTIONS = ["speak", "wait"];
  return ROOM_BASED_ACTIONS.includes(tool);
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
          availableTools: runtime.getAvailableTools(),
          pendingAction: Action.pendingAction[eid],
          lastActionTime: Action.lastActionTime[eid],
        });
      }

      // Process pending actions
      const pendingAction = Action.pendingAction[eid];
      if (!pendingAction) continue;

      const agentName = Agent.name[eid];
      let roomEid;

      // Get appropriate room context
      if (isRoomBasedAction(pendingAction.tool)) {
        // For room-based actions, use current room
        roomEid = getAgentRoom(world, eid);
        if (!roomEid) {
          logger.error(
            `No room found for agent ${agentName} (${eid}) - required for ${pendingAction.tool}`
          );
          continue;
        }
      } else {
        // For private actions, use or create private room
        roomEid = await getOrCreatePrivateRoom(world, eid, runtime);
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
          context: isRoomBasedAction(pendingAction.tool) ? "room" : "private",
        },
        String(eid)
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
