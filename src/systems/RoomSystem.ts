import { World } from "../types/bitecs";
import { query, addEntity, addComponent, removeEntity } from "bitecs";
import {
  Agent,
  Memory,
  Room,
  Perception,
  Appearance,
  Stimulus,
} from "../components/agent/Agent";
import { logger } from "../utils/logger";
import { createSystem, SystemConfig } from "./System";

// System for managing rooms and generating stimuli about occupants
export const RoomSystem = createSystem<SystemConfig>(
  (runtime) => async (world: World) => {
    const rooms = query(world, [Room]);

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
      const occupants = Room.occupants[roomId] || [];

      // Skip empty rooms
      if (occupants.length === 0) continue;

      // Generate visual stimuli for each occupant's appearance
      for (const agentId of occupants) {
        // Skip inactive agents
        if (!Agent.active[agentId]) continue;

        // Create visual stimulus for this agent
        const stimulusEntity = addEntity(world);
        addComponent(world, stimulusEntity, Stimulus);

        // Set stimulus properties
        Stimulus.type[stimulusEntity] = "VISUAL";
        Stimulus.sourceEntity[stimulusEntity] = agentId;
        Stimulus.source[stimulusEntity] = "ROOM"; // Mark as room-generated
        Stimulus.timestamp[stimulusEntity] = Date.now();
        Stimulus.decay[stimulusEntity] = 1; // Only needs to last for immediate processing

        // Combine appearance details into content
        const appearanceContent = {
          baseDescription: Appearance.baseDescription[agentId],
          facialExpression: Appearance.facialExpression[agentId],
          bodyLanguage: Appearance.bodyLanguage[agentId],
          currentAction: Appearance.currentAction[agentId],
          socialCues: Appearance.socialCues[agentId],
          location: {
            roomId: Room.id[roomId],
            roomName: Room.name[roomId],
          },
        };

        Stimulus.content[stimulusEntity] = JSON.stringify(appearanceContent);

        logger.system(
          `Created visual stimulus for ${Agent.name[agentId]} in ${Room.name[roomId]}`
        );
      }
    }

    return world;
  }
);
