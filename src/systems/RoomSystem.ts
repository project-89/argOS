import { World } from "../types/bitecs";
import { addEntity, addComponent, removeEntity, query, set } from "bitecs";
import { Agent, Room, Appearance, Stimulus } from "../components";
import { logger } from "../utils/logger";
import { createSystem, SystemConfig } from "./System";
import { getRooms, getRoomOccupants, getActiveAgents } from "../utils/queries";
import { createVisualStimulus } from "../utils/stimulus-utils";

// Queue to hold pending stimuli between system ticks
type PendingStimulus = {
  type: string;
  sourceEntity: number;
  source: string;
  content: any;
  roomId: string;
  timestamp: number;
};

const pendingStimuliByRoom = new Map<string, PendingStimulus[]>();

// Helper to queue a stimulus for next tick
export function queueStimulus(stimulus: PendingStimulus) {
  const roomStimuli = pendingStimuliByRoom.get(stimulus.roomId) || [];
  roomStimuli.push(stimulus);
  pendingStimuliByRoom.set(stimulus.roomId, roomStimuli);
  logger.debug(
    `Queued stimulus for room ${stimulus.roomId}: ${JSON.stringify(stimulus)}`
  );
}

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
      const occupants = getRoomOccupants(world, roomId);
      const roomStringId = Room.id[roomId] || String(roomId);

      // Skip empty rooms
      if (occupants.length === 0) continue;

      // Process any pending stimuli for this room
      const pendingStimuli = pendingStimuliByRoom.get(roomStringId) || [];
      while (pendingStimuli.length > 0) {
        const stimulus = pendingStimuli.shift()!;
        const stimulusEntity = addEntity(world);

        // Handle content based on type
        let contentStr = "";
        if (stimulus.type === "AUDITORY") {
          // For auditory stimuli, we expect a structured content object
          const auditoryContent =
            typeof stimulus.content === "string"
              ? { message: stimulus.content, tone: "neutral", type: "speech" }
              : stimulus.content;

          contentStr = JSON.stringify(auditoryContent);
        } else {
          // Other types might be objects that need stringifying
          contentStr =
            typeof stimulus.content === "string"
              ? stimulus.content
              : JSON.stringify(stimulus.content);
        }

        addComponent(
          world,
          stimulusEntity,
          set(Stimulus, {
            type: stimulus.type,
            sourceEntity: stimulus.sourceEntity,
            source: stimulus.source,
            timestamp: stimulus.timestamp,
            content: contentStr,
            roomId: stimulus.roomId,
          })
        );

        logger.debug(
          `Created stimulus entity for queued stimulus: ${JSON.stringify({
            ...stimulus,
            content: contentStr,
          })}`
        );
      }

      // Clear processed stimuli
      pendingStimuliByRoom.set(roomStringId, []);

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

        // Now add the component with values
        addComponent(
          world,
          stimulusEntity,
          set(Stimulus, {
            type: "VISUAL",
            sourceEntity: agentId,
            source: "ROOM",
            timestamp: Date.now(),
            content: JSON.stringify(appearanceContent),
            roomId: Room.id[roomId] || String(roomId),
          })
        );
      }
    }

    // Generate room ambient stimuli
    for (const roomId of rooms) {
      createVisualStimulus(world, {
        sourceEntity: roomId,
        roomId: Room.id[roomId],
        source: "ROOM",
        decay: 1,
        appearance: true,
        data: {
          name: Room.name[roomId],
          timestamp: Date.now(),
          category: "Observation",
          type: "ROOM_AMBIENCE",
          description: Room.description[roomId],
        },
      });
    }

    return world;
  }
);
