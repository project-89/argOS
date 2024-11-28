import { World } from "../types/bitecs";
import { query } from "bitecs";
import {
  Agent,
  Action,
  Memory,
  Room,
  Perception,
} from "../components/agent/Agent";
import { logger } from "../utils/logger";

// Available tools
const AVAILABLE_TOOLS = [
  {
    name: "speak",
    description: "Speak to others in the same room",
    parameters: ["message"],
  },
  {
    name: "examine",
    description: "Examine something or someone more closely",
    parameters: ["target"],
  },
  // Add more tools as needed
];

// System for handling agent actions and tool usage
export const ActionSystem = async (world: World) => {
  const agents = query(world, [Agent, Action]);

  logger.system("Processing actions...");
  logger.system(`Processing ${agents.length} agents`);

  for (const eid of agents) {
    if (!Agent.active[eid]) continue;

    logger.agent(eid, `Processing actions for ${Agent.name[eid]}`);

    // Initialize available tools if not set
    if (!Action.availableTools[eid]) {
      Action.availableTools[eid] = AVAILABLE_TOOLS;
    }

    // Process pending actions
    const pendingAction = Action.pendingAction[eid];
    if (!pendingAction) continue;

    logger.agent(eid, `Processing action: ${pendingAction.tool}`);

    // Handle different action types
    switch (pendingAction.tool) {
      case "speak": {
        const roomId = findAgentRoom(world, eid);
        if (roomId !== null) {
          const message = pendingAction.parameters.message;
          const occupants = Room.occupants[roomId];

          // Log the speech
          logger.agent(eid, `Says: ${message}`);

          // Create speech stimulus for all agents in the room
          occupants.forEach((occupantId) => {
            Perception.currentStimuli[occupantId] =
              Perception.currentStimuli[occupantId] || [];
            Perception.currentStimuli[occupantId].push({
              type: "speech",
              source: eid,
              data: {
                name: Agent.name[eid],
                role: Agent.role[eid],
                appearance: Agent.appearance[eid],
                message,
                location: {
                  roomId: Room.id[roomId],
                  roomName: Room.name[roomId],
                },
              },
            });
            Perception.lastProcessedTime[occupantId] = Date.now();

            // Also create an experience memory
            if (occupantId === eid) {
              // Speaker's memory
              addExperience(occupantId, "speech", `I said: "${message}"`);
            } else {
              // Listener's memory
              addExperience(
                occupantId,
                "speech",
                `${Agent.name[eid]} said: "${message}"`
              );
            }
          });
        }
        break;
      }

      case "examine": {
        // Handle examination action
        const target = pendingAction.parameters.target;
        logger.agent(eid, `Examining: ${target}`);
        addExperience(eid, "observation", `I examined ${target} closely.`);
        break;
      }
    }

    // Clear pending action
    Action.pendingAction[eid] = null;
    Action.lastActionTime[eid] = Date.now();
  }

  return world;
};

// Helper function to find which room an agent is in
function findAgentRoom(world: World, agentId: number): number | null {
  const rooms = query(world, [Room]);
  for (const roomId of rooms) {
    if (Room.occupants[roomId]?.includes(agentId)) {
      return roomId;
    }
  }
  return null;
}

// Helper function to add an experience to agent's memory
function addExperience(agentId: number, type: string, content: string) {
  Memory.experiences[agentId] = Memory.experiences[agentId] || [];
  Memory.experiences[agentId].push({
    type,
    content,
    timestamp: Date.now(),
  });
}
