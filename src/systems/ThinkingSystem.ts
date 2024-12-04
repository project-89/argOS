import { World } from "../types/bitecs";
import {
  addComponent,
  addEntity,
  query,
  setComponent,
  hasComponent,
} from "bitecs";
import {
  Agent,
  Memory,
  Perception,
  Action,
  Stimulus,
  Appearance,
  Room,
  OccupiesRoom,
} from "../components/agent/Agent";
import {
  generateThought,
  processStimulus,
  ProcessStimulusState,
  AgentState,
} from "../llm/agent-llm";
import { logger } from "../utils/logger";
import { createSystem, SystemConfig } from "./System";
import { createVisualStimulus } from "../utils/stimulus-utils";

// Helper to find agent's current room
function findAgentRoom(world: World, agentId: number): number | null {
  const rooms = query(world, [Room]).filter((roomId) =>
    hasComponent(world, agentId, OccupiesRoom(roomId))
  );
  return rooms[0] || null;
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
  // Update appearance component using setComponent
  setComponent(world, eid, Appearance, {
    baseDescription: Appearance.baseDescription[eid],
    facialExpression:
      appearance.facialExpression || Appearance.facialExpression[eid],
    bodyLanguage: appearance.bodyLanguage || Appearance.bodyLanguage[eid],
    currentAction: appearance.currentAction || Appearance.currentAction[eid],
    socialCues: appearance.socialCues || Appearance.socialCues[eid],
    lastUpdate: Date.now(),
  });

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
      if (!Agent.active[eid]) {
        logger.system(`Agent ${Agent.name[eid]} is not active, skipping`);
        continue;
      }

      const agentName = Agent.name[eid];
      logger.system(
        `Processing thoughts for ${agentName} (active: ${Agent.active[eid]})`
      );

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
        `${agentName} has ${currentPerceptions.length} perceptions in room ${Room.name[agentRoom]}`
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

      // Get current memory state
      const currentThoughts = Memory.thoughts[eid] || [];
      const currentPerceptionsList = Memory.perceptions[eid] || [];
      const currentExperiences = Memory.experiences[eid] || [];

      // Only add new thought if it's different from the last one
      const lastThought = Memory.lastThought[eid];
      const shouldAddThought = thought.thought !== lastThought;

      // Only add new perception if it's different from the last one
      const lastPerception =
        currentPerceptionsList[currentPerceptionsList.length - 1]?.content;
      const shouldAddPerception = perceptions !== lastPerception;

      // Update memory with new thought using setComponent
      setComponent(world, eid, Memory, {
        lastThought: thought.thought,
        thoughts: shouldAddThought
          ? [...currentThoughts, thought.thought]
          : currentThoughts,
        perceptions: shouldAddPerception
          ? [
              ...currentPerceptionsList,
              {
                timestamp: Date.now(),
                content: perceptions,
              },
            ]
          : currentPerceptionsList,
        experiences: currentExperiences,
      });

      // Log memory state for debugging
      logger.system(`Memory state for ${agentName}:
        Thoughts: ${currentThoughts.length + (shouldAddThought ? 1 : 0)}
        Perceptions: ${
          currentPerceptionsList.length + (shouldAddPerception ? 1 : 0)
        }
        Experiences: ${currentExperiences.length}
      `);

      runtime.emit("agentThought", eid, thought);

      // Queue action for ActionSystem
      if (thought.action) {
        logger.system(`${agentName} queued action: ${thought.action.tool}`);
        setComponent(world, eid, Action, {
          pendingAction: thought.action,
          lastActionTime: Action.lastActionTime[eid],
          availableTools: Action.availableTools[eid],
        });
      }

      // Update appearance if provided
      if (thought.appearance) {
        const agentRoom = findAgentRoom(world, eid);
        if (agentRoom) {
          setComponent(world, eid, Appearance, {
            baseDescription: Appearance.baseDescription[eid],
            facialExpression:
              thought.appearance.facialExpression ||
              Appearance.facialExpression[eid],
            bodyLanguage:
              thought.appearance.bodyLanguage || Appearance.bodyLanguage[eid],
            currentAction:
              thought.appearance.currentAction || Appearance.currentAction[eid],
            socialCues:
              thought.appearance.socialCues || Appearance.socialCues[eid],
            lastUpdate: Date.now(),
          });
          emitAppearanceStimulus(world, eid, agentRoom, thought.appearance);
        }
      }
    }

    return world;
  }
);
