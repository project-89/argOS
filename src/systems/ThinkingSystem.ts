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

interface ThinkingSystemConfig extends SystemConfig {
  actionInterface?: {
    getAvailableTools: () => Array<{
      name: string;
      description: string;
      parameters: string[];
      schema: any;
    }>;
  };
}

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

export const ThinkingSystem = createSystem((runtime: SimulationRuntime) => {
  return async (world: World) => {
    const agents = query(world, [Agent]);
    const stimuli = query(world, [Stimulus]);

    for (const eid of agents) {
      if (!Agent.active[eid]) continue;

      // Get agent's perceptions
      const agentRoom = findAgentRoom(world, eid);
      if (!agentRoom) continue;

      const roomId = Room.id[agentRoom];
      const perceptions = stimuli
        .filter((sid) => Stimulus.roomId[sid] === roomId)
        .map((sid) => ({
          type: Stimulus.type[sid],
          sourceEntity: Stimulus.sourceEntity[sid],
          source: Stimulus.source[sid],
          content: JSON.parse(Stimulus.content[sid]),
          timestamp: Stimulus.timestamp[sid],
          roomId: Stimulus.roomId[sid],
        }));

      // Process perceptions
      const processedPerceptions = await processPerceptions(
        eid,
        perceptions,
        world
      );

      // Emit perception event
      runtime.emit("agentThought", eid, {
        type: "PERCEPTION",
        data: processedPerceptions,
        actionType: "THOUGHT",
      });

      // Generate thought
      const thought = await generateThought({
        name: Agent.name[eid],
        role: Agent.role[eid],
        systemPrompt: Agent.systemPrompt[eid],
        thoughtHistory: Memory.thoughts[eid] || [],
        perceptions: {
          narrative: processedPerceptions,
          raw: perceptions.map((p) => ({
            type: p.type,
            source: p.sourceEntity,
            data: p.content,
          })),
        },
        experiences: Memory.experiences[eid] || [],
        availableTools: runtime.getAvailableTools(),
      });

      // Emit thought event
      runtime.emit("agentThought", eid, {
        type: "THOUGHT",
        data: thought,
        actionType: "THOUGHT",
      });

      // Execute action if one was generated
      if (thought.action) {
        await runtime.executeAction(
          thought.action.tool,
          eid,
          thought.action.parameters
        );
      }
    }

    return world;
  };
});
