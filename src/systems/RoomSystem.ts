import { World, query } from "bitecs";
import { Agent, Room, Appearance } from "../components";
import { logger } from "../utils/logger";
import { createSystem, SystemConfig } from "./System";
import { getRoomOccupants } from "../utils/queries";
import { createVisualStimulus } from "../factories/stimulusFactory";
import { StimulusSource as StimulusSourceEnum } from "../types/stimulus";
import {
  addStimulusToRoom,
  setStimulusSource,
  StimulusInRoom,
} from "../components/relationships/stimulus";

export const RoomSystem = createSystem<SystemConfig>(
  (runtime) => async (world: World) => {
    const rooms = query(world, [Room]);

    // Process each room
    for (const roomId of rooms) {
      const occupants = getRoomOccupants(world, roomId);
      const roomStringId = Room.id[roomId] || String(roomId);

      // Skip empty rooms
      if (occupants.length === 0) continue;

      // Generate visual stimuli for each occupant's appearance
      for (const agentId of occupants) {
        // Skip inactive agents
        if (!Agent.active[agentId]) continue;

        const appearance = {
          baseDescription: Appearance.baseDescription[agentId],
          facialExpression: Appearance.facialExpression[agentId],
          bodyLanguage: Appearance.bodyLanguage[agentId],
          currentAction: Appearance.currentAction[agentId],
          socialCues: Appearance.socialCues[agentId],
        };

        logger.debug(
          `Creating appearance stimulus for agent ${agentId}:`,
          appearance
        );

        // Create appearance stimulus
        const stimulusId = createVisualStimulus(
          world,
          agentId,
          `${appearance.baseDescription} ${
            appearance.currentAction || ""
          }`.trim(),
          {
            metadata: {
              appearance,
              isUser: Agent.name[agentId] === "User",
            },
            source: StimulusSourceEnum.ROOM,
            decay: 0,
          }
        );

        logger.debug(
          `Created appearance stimulus ${stimulusId} for agent ${agentId}`
        );

        // Add relationships
        if (stimulusId) {
          // Add to room with high intensity for appearance stimuli
          addStimulusToRoom(world, stimulusId, roomId, 1.0, {
            type: "appearance",
            agentId,
          });

          // Set agent as source
          setStimulusSource(world, stimulusId, agentId, 1.0, {
            type: "appearance",
          });

          logger.debug(
            `Added stimulus ${stimulusId} relationships for agent ${agentId} in room ${roomId}`
          );
        }
      }

      // Create room ambient stimulus
      const ambientStimulusId = createVisualStimulus(
        world,
        roomId,
        `${Room.name[roomId]}: ${Room.description[roomId]}`,
        {
          metadata: {
            type: "ROOM_AMBIENCE",
            category: "Observation",
          },
          source: StimulusSourceEnum.ROOM,
          decay: 0,
        }
      );

      // Add room relationship for ambient stimulus
      if (ambientStimulusId) {
        addStimulusToRoom(world, ambientStimulusId, roomId, 0.5, {
          type: "ambient",
          permanent: true,
        });
      }
    }

    return world;
  }
);
