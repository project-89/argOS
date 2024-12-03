import { World } from "../types/bitecs";
import { addComponent, addEntity, query } from "bitecs";
import {
  Agent,
  Memory,
  Perception,
  Action,
  Stimulus,
  Appearance,
  Room,
} from "../components/agent/Agent";
import {
  generateThought,
  processStimulus,
  ThoughtResponse,
  ProcessStimulusState,
  AgentState,
} from "../llm/agent-llm";
import { logger } from "../utils/logger";
import { createSystem, SystemConfig } from "./System";
import { createVisualStimulus } from "../utils/stimulus-utils";
import { SimulationRuntime } from "../runtime/SimulationRuntime";

// Helper to find agent's current room
function findAgentRoom(world: World, agentId: number): number | null {
  const rooms = query(world, [Room]);
  for (const roomId of rooms) {
    if (Room.occupants[roomId]?.includes(agentId)) {
      return roomId;
    }
  }
  return null;
}

// Helper to process perceptions
async function processPerceptions(
  eid: number,
  perceptions: any[],
  world: World
) {
  const agentState: ProcessStimulusState = {
    name: Agent.name[eid],
    role: Agent.role[eid],
    systemPrompt: Agent.systemPrompt[eid],
    stimulus: perceptions.map((p) => ({
      type: p.type,
      source: p.sourceEntity,
      data: p.content,
    })),
  };

  return await processStimulus(agentState);
}

// Helper to emit appearance changes as visual stimuli
function emitAppearanceStimulus(
  world: World,
  eid: number,
  roomId: number,
  appearance: Record<string, string>
) {
  // Update appearance component
  Object.entries(appearance).forEach(([key, value]) => {
    if (value && typeof value === "string") {
      switch (key) {
        case "facialExpression":
          Appearance.facialExpression[eid] = value;
          break;
        case "bodyLanguage":
          Appearance.bodyLanguage[eid] = value;
          break;
        case "currentAction":
          Appearance.currentAction[eid] = value;
          break;
        case "socialCues":
          Appearance.socialCues[eid] = value;
          break;
      }
    }
  });
  Appearance.lastUpdate[eid] = Date.now();

  // Create visual stimulus for appearance change
  createVisualStimulus(world, {
    sourceEntity: eid,
    roomId: Room.id[roomId],
    appearance: true,
    data: {
      ...appearance,
      location: {
        roomId: Room.id[roomId],
        roomName: Room.name[roomId],
      },
    },
  });
}

export const ThinkingSystem = createSystem<SystemConfig>(
  (runtime) => async (world: World) => {
    const agents = query(world, [Agent, Memory]);
    logger.system(`ThinkingSystem processing ${agents.length} agents`);

    for (const eid of agents) {
      if (!Agent.active[eid]) continue;

      const agentName = Agent.name[eid];
      logger.system(`Processing thoughts for ${agentName}`);

      // Get perceptions from current room
      const agentRoom = findAgentRoom(world, eid);
      if (!agentRoom) {
        logger.system(`No room found for ${agentName}`);
        continue;
      }

      const stimuli = query(world, [Stimulus]);
      const roomId = Room.id[agentRoom];
      const currentPerceptions = stimuli
        .filter((sid) => Stimulus.roomId[sid] === roomId)
        .map((sid) => ({
          type: Stimulus.type[sid],
          sourceEntity: Stimulus.sourceEntity[sid],
          source: Stimulus.source[sid],
          content: Stimulus.content[sid]
            ? JSON.parse(Stimulus.content[sid])
            : {},
          timestamp: Stimulus.timestamp[sid],
          roomId: Stimulus.roomId[sid],
        }));

      logger.system(
        `${agentName} has ${currentPerceptions.length} perceptions`
      );

      // Process perceptions into narrative
      const perceptions = await processPerceptions(
        eid,
        currentPerceptions,
        world
      );

      logger.system(`${agentName} processed perceptions: ${perceptions}`);

      // Generate thought based on perceptions
      const agentState: AgentState = {
        name: agentName,
        role: Agent.role[eid],
        systemPrompt: Agent.systemPrompt[eid],
        thoughtHistory: Memory.thoughts[eid] || [],
        perceptions: {
          narrative: perceptions,
          raw: currentPerceptions.map((p) => ({
            type: p.type,
            source: p.sourceEntity,
            data: p.content,
          })),
        },
        experiences: Memory.experiences[eid] || [],
        availableTools: runtime.getAvailableTools(),
      };

      logger.system(`Generating thought for ${agentName}`);
      const thought = await generateThought(agentState);
      logger.system(`${agentName} generated thought: ${thought.thought}`);

      // Update memory with new thought
      Memory.lastThought[eid] = thought.thought;
      Memory.thoughts[eid] = [...(Memory.thoughts[eid] || []), thought.thought];
      Memory.perceptions[eid] = [
        ...(Memory.perceptions[eid] || []),
        ...perceptions,
      ];
      runtime.emit("agentThought", eid, thought);

      // Queue action for ActionSystem instead of executing immediately
      if (thought.action) {
        logger.system(`${agentName} queued action: ${thought.action.tool}`);
        Action.pendingAction[eid] = thought.action;
      }

      // Update appearance and create visual stimulus if provided
      if (thought.appearance) {
        const agentRoom = findAgentRoom(world, eid);
        if (agentRoom) {
          emitAppearanceStimulus(world, eid, agentRoom, thought.appearance);
        }
      }
    }

    return world;
  }
);
