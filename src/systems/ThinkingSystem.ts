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
  extractExperiences,
  Experience,
  ExtractExperiencesState,
} from "../llm/agent-llm";
import { logger } from "../utils/logger";
import { createSystem, SystemConfig } from "./System";
import { createVisualStimulus } from "../utils/stimulus-utils";
import { EventCategory } from "../types";

// Helper to find agent's current room
function findAgentRoom(world: World, agentId: number): number | null {
  const rooms = query(world, [Room]).filter((roomId) =>
    hasComponent(world, agentId, OccupiesRoom(roomId))
  );
  return rooms[0] || null;
}

// Stage 1: Gather current perceptions from room
function gatherRoomPerceptions(world: World, eid: number, roomId: string) {
  const stimuli = query(world, [Stimulus]);
  return stimuli
    .filter((sid) => Stimulus.roomId[sid] === roomId)
    .filter((sid) => Stimulus.sourceEntity[sid] !== eid)
    .map((sid) => ({
      type: Stimulus.type[sid],
      sourceEntity: Stimulus.sourceEntity[sid],
      source: Stimulus.source[sid],
      content: Stimulus.content[sid] ? JSON.parse(Stimulus.content[sid]) : {},
      timestamp: Stimulus.timestamp[sid],
      roomId: Stimulus.roomId[sid],
    }));
}

// Stage 2: Process perceptions into narrative
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

// Stage 3: Generate thought based on state
async function generateAgentThought(
  world: World,
  eid: number,
  perceptions: string,
  currentPerceptions: any[],
  runtime: any
) {
  const agentState: AgentState = {
    name: Agent.name[eid],
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

  return await generateThought(agentState);
}

// Stage 4: Update agent memory
function updateAgentMemory(
  world: World,
  eid: number,
  thought: any,
  perceptions: string,
  newExperiences: Experience[]
) {
  const currentThoughts = Memory.thoughts[eid] || [];
  const currentPerceptionsList = Memory.perceptions[eid] || [];
  const currentExperiences = Memory.experiences[eid] || [];

  const lastThought = Memory.lastThought[eid];
  const lastPerception =
    currentPerceptionsList[currentPerceptionsList.length - 1]?.content;

  const shouldAddThought = thought.thought !== lastThought;
  const shouldAddPerception = perceptions !== lastPerception;

  // Deduplicate experiences by content and timestamp
  const uniqueExperiences = [...currentExperiences];
  newExperiences.forEach((exp) => {
    const isDuplicate = uniqueExperiences.some(
      (existing) =>
        existing.content === exp.content &&
        Math.abs(existing.timestamp - exp.timestamp) < 1000 // Within 1 second
    );
    if (!isDuplicate) {
      uniqueExperiences.push(exp);
    }
  });

  // Sort experiences chronologically
  uniqueExperiences.sort((a, b) => a.timestamp - b.timestamp);

  setComponent(world, eid, Memory, {
    lastThought: thought.thought,
    thoughts: shouldAddThought
      ? [...currentThoughts, thought.thought]
      : currentThoughts,
    perceptions: shouldAddPerception
      ? [
          ...currentPerceptionsList,
          { timestamp: Date.now(), content: perceptions },
        ]
      : currentPerceptionsList,
    experiences: uniqueExperiences,
  });

  return { shouldAddThought, shouldAddPerception };
}

// Stage 5: Handle agent actions
function handleAgentAction(world: World, eid: number, thought: any) {
  if (thought.action) {
    logger.agent(
      eid,
      `I decided to take the action: ${thought.action.tool}`,
      Agent.name[eid]
    );
    setComponent(world, eid, Action, {
      pendingAction: thought.action,
      lastActionTime: Action.lastActionTime[eid],
      availableTools: Action.availableTools[eid],
    });
  }
}

// Stage 6: Update agent appearance
function updateAgentAppearance(
  world: World,
  eid: number,
  roomId: number,
  appearance: Record<string, string>
) {
  setComponent(world, eid, Appearance, {
    description: appearance.description || "",
    baseDescription: Appearance.baseDescription[eid],
    facialExpression:
      appearance.facialExpression || Appearance.facialExpression[eid],
    bodyLanguage: appearance.bodyLanguage || Appearance.bodyLanguage[eid],
    currentAction: appearance.currentAction || Appearance.currentAction[eid],
    socialCues: appearance.socialCues || Appearance.socialCues[eid],
    lastUpdate: Date.now(),
  });

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

// New Stage: Extract experiences from perceptions
async function extractPerceptionExperiences(
  eid: number,
  perceptions: any[],
  world: World
): Promise<Experience[]> {
  const agentState: ExtractExperiencesState = {
    name: Agent.name[eid],
    role: Agent.role[eid],
    systemPrompt: Agent.systemPrompt[eid],
    recentExperiences: (Memory.experiences[eid] || []) as Experience[],
    timestamp: Date.now(),
    stimulus: perceptions.map((p) => ({
      type: p.type,
      source: p.sourceEntity,
      data: p.content,
    })),
  };

  const experiences = await extractExperiences(agentState);

  // Update memory with new experiences
  const currentExperiences = Memory.experiences[eid] || [];
  setComponent(world, eid, Memory, {
    ...Memory,
    experiences: [...currentExperiences, ...experiences],
  });

  return experiences;
}

export const ThinkingSystem = createSystem<SystemConfig>(
  (runtime) => async (world: World) => {
    const agents = query(world, [Agent, Memory]);
    logger.debug(`ThinkingSystem processing ${agents.length} agents`);

    for (const eid of agents) {
      // Skip inactive agents
      if (!Agent.active[eid]) {
        logger.debug(`Agent ${Agent.name[eid]} is not active, skipping`);
        continue;
      }

      // Stage 1: Find agent's room and gather perceptions
      const agentRoom = findAgentRoom(world, eid);
      if (!agentRoom) {
        logger.debug(`No room found for ${Agent.name[eid]}`);
        continue;
      }
      const roomId = Room.id[agentRoom] || String(agentRoom);
      const currentPerceptions = gatherRoomPerceptions(world, eid, roomId);

      // Stage 2: Process perceptions into narrative
      const perceptions = await processPerceptions(
        eid,
        currentPerceptions,
        world
      );
      logger.agent(eid, `Perceiving: ${perceptions}`, Agent.name[eid]);

      // Emit perception event
      runtime.eventBus.emitAgentEvent(
        eid,
        "perception",
        "perception",
        perceptions
      );

      // Emit experience events
      const newExperiences = await extractPerceptionExperiences(
        eid,
        currentPerceptions,
        world
      );

      logger.agent(
        eid,
        `Extracted experiences: ${newExperiences}`,
        Agent.name[eid]
      );

      newExperiences.forEach((exp: Experience) => {
        runtime.eventBus.emitAgentEvent(
          eid,
          "experience",
          exp.type as EventCategory,
          exp
        );
      });

      // Stage 3: Generate thought based on state
      logger.debug(`Generating thought for ${Agent.name[eid]}`);
      const thought = await generateAgentThought(
        world,
        eid,
        perceptions,
        currentPerceptions,
        runtime
      );
      logger.agent(eid, `Thought: ${thought.thought}`, Agent.name[eid]);

      // Emit thought event
      runtime.eventBus.emitAgentEvent(
        eid,
        "thought",
        "thought",
        thought.thought
      );

      // Stage 4: Update agent memory
      const { shouldAddThought, shouldAddPerception } = updateAgentMemory(
        world,
        eid,
        thought,
        perceptions,
        newExperiences
      );

      // Stage 5: Handle agent actions
      handleAgentAction(world, eid, thought);

      // Stage 6: Update agent appearance
      if (thought.appearance) {
        updateAgentAppearance(world, eid, agentRoom, thought.appearance);
        // Emit appearance event
        runtime.eventBus.emitAgentEvent(
          eid,
          "appearance",
          "appearance",
          thought.appearance.currentAction || "No action"
        );
      }
    }

    return world;
  }
);
