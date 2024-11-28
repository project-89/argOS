import { World } from "../types/bitecs";
import { query } from "bitecs";
import { Agent, Memory, Room, Perception } from "../components/agent/Agent";
import { logger } from "../utils/logger";

// System for managing rooms and generating stimuli about occupants
export const RoomSystem = async (world: World) => {
  const rooms = query(world, [Room]);

  // Process each room
  for (const roomId of rooms) {
    const occupants = Room.occupants[roomId] || [];

    // Skip empty rooms
    if (occupants.length === 0) continue;

    // Generate stimuli for each occupant about other occupants
    for (const agentId of occupants) {
      // Skip inactive agents
      if (!Agent.active[agentId]) continue;

      // Generate stimuli about other agents in the room
      const stimuli = occupants
        .filter((otherId) => otherId !== agentId && Agent.active[otherId])
        .map((otherId) => ({
          type: "agent_presence",
          source: otherId,
          data: {
            name: Agent.name[otherId],
            role: Agent.role[otherId],
            appearance: Agent.appearance[otherId],
            location: {
              roomId: Room.id[roomId],
              roomName: Room.name[roomId],
            },
          },
        }));

      // Update agent's perceptions
      if (stimuli.length > 0) {
        Perception.currentStimuli[agentId] = stimuli;
        Perception.lastProcessedTime[agentId] = Date.now();

        logger.agent(
          agentId,
          `Perceiving ${stimuli.length} agents in ${Room.name[roomId]}`
        );
      }
    }
  }

  return world;
};
