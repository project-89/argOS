import { World } from "../types/bitecs";
import { addEntity, addComponent, removeEntity, query, set } from "bitecs";
import { Agent, Room, Appearance, Stimulus } from "../components/agent/Agent";
import { logger } from "../utils/logger";
import { createSystem, SystemConfig } from "./System";
import { getRooms, getRoomOccupants, getActiveAgents } from "../utils/queries";

// System for managing rooms and generating stimuli about occupants
export const RoomSystem = createSystem<SystemConfig>(
  (runtime) => async (world: World) => {
    const rooms = getRooms(world);

    // First, clean up any previous room-generated stimuli
    const existingStimuli = query(world, [Stimulus]);
    for (const sid of existingStimuli) {
      if (
        Stimulus.type[sid] === "VISUAL" &&
        Stimulus.source?.[sid] === "ROOM"
      ) {
        removeEntity(world, sid);
      }
    }

    // Process each room
    for (const roomId of rooms) {
      const occupants = getRoomOccupants(world, roomId);

      // Skip empty rooms
      if (occupants.length === 0) continue;

      // Generate visual stimuli for each occupant's appearance
      for (const agentId of occupants) {
        // Skip inactive agents
        if (!Agent.active[agentId]) continue;

        // Create visual stimulus for this agent
        const stimulusEntity = addEntity(world);
        const appearanceContent = {
          baseDescription: Appearance.baseDescription[agentId],
          facialExpression: Appearance.facialExpression[agentId],
          bodyLanguage: Appearance.bodyLanguage[agentId],
          currentAction: Appearance.currentAction[agentId],
          socialCues: Appearance.socialCues[agentId],
          location: {
            roomId: Room.id[roomId] || String(roomId),
            roomName: Room.name[roomId],
          },
          isUser: Agent.name[agentId] === "User",
        };

        addComponent(
          world,
          stimulusEntity,
          set(Stimulus, {
            type: "VISUAL",
            sourceEntity: agentId,
            source: "ROOM",
            timestamp: Date.now(),
            decay: 1,
            content: JSON.stringify(appearanceContent),
          })
        );

        logger.system(
          `Created visual stimulus for ${Agent.name[agentId]} in ${Room.name[roomId]}`
        );
      }
    }

    return world;
  }
);
