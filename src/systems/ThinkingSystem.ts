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
import { SimulationRuntime } from "../runtime/SimulationRuntime";

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
  // Get recent perceptions from memory, ensuring we have valid perception objects
  type Perception = { timestamp: number; content: string };
  const recentPerceptions = (Memory.perceptions[eid] || []).filter(
    (p: any): p is Perception =>
      p &&
      typeof p === "object" &&
      "timestamp" in p &&
      "content" in p &&
      typeof p.timestamp === "number" &&
      typeof p.content === "string"
  );

  // Deduplicate recent perceptions based on content and close timestamps
  const deduplicatedPerceptions = recentPerceptions.reduce(
    (acc: Perception[], curr: Perception) => {
      const isDuplicate = acc.some(
        (p: Perception) =>
          p.content === curr.content ||
          (p.content.includes(curr.content) &&
            Math.abs(p.timestamp - curr.timestamp) < 15000) // Increased to 15 seconds and improved matching
      );
      if (!isDuplicate) {
        acc.push(curr);
      }
      return acc;
    },
    [] as typeof recentPerceptions
  );

  const recentPerceptionsNarrative = deduplicatedPerceptions
    .slice(-10) // Keep last 10 unique perceptions
    .map((p: Perception) => p.content)
    .join("\n");

  // Filter out perceptions that are too close to recent ones
  const filteredNewPerceptions = perceptions.filter((newP) => {
    // Skip filtering visual stimuli - always let them through
    if (newP.type === "VISUAL") return true;

    const isDuplicate = deduplicatedPerceptions.some((p: Perception) => {
      // Only exact matches for speech/action
      const contentMatch =
        typeof p.content === "string" &&
        typeof newP.content === "string" &&
        p.content === newP.content;

      // Special handling for speech and actions
      const isConversationalAction =
        newP.type === "SPEECH" || newP.type === "ACTION";

      // Allow alternating speech/action patterns even if content is similar
      const isAlternatingPattern =
        isConversationalAction &&
        deduplicatedPerceptions.length > 0 &&
        deduplicatedPerceptions[deduplicatedPerceptions.length - 1].type !==
          newP.type;

      // Compare against perception's own timestamp
      const isRecent = Math.abs(p.timestamp - newP.timestamp) < 15000;

      return contentMatch && isRecent && !isAlternatingPattern;
    });
    return !isDuplicate;
  });

  const agentState: ProcessStimulusState = {
    name: Agent.name[eid],
    role: Agent.role[eid],
    systemPrompt: Agent.systemPrompt[eid],
    recentPerceptions: recentPerceptionsNarrative,
    stimulus: filteredNewPerceptions.map((p) => ({
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
  logger.debug(`Generating thought for ${Agent.name[eid]}`);

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
    availableTools: runtime.getActionManager().getAvailableTools(),
  };

  const thought = await generateThought(agentState);

  logger.agent(eid, `Thought: ${thought.thought}`, Agent.name[eid]);

  // Emit thought event
  runtime.eventBus.emitAgentEvent(eid, "thought", "thought", thought.thought);

  return thought;
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

  // Keep more thoughts in history since we have a large context window
  // Only deduplicate exact matches that are very recent (within last 5 seconds)
  const updatedThoughts = [...currentThoughts];
  if (
    thought.thought !== lastThought ||
    (updatedThoughts.length > 0 && Date.now() - Memory.lastUpdate[eid] > 5000)
  ) {
    updatedThoughts.push(thought.thought);
  }

  // Keep up to 100 recent thoughts instead of just 10
  const recentThoughts = updatedThoughts.slice(-100);

  // Deduplicate experiences by content and timestamp, preserving chronological order
  const uniqueExperiences = [...currentExperiences];
  const seenExperiences = new Set();

  newExperiences.forEach((exp) => {
    const key = `${exp.type}:${exp.content}`;
    if (!seenExperiences.has(key)) {
      const isDuplicate = uniqueExperiences.some(
        (existing) =>
          existing.type === exp.type &&
          existing.content === exp.content &&
          Math.abs(existing.timestamp - exp.timestamp) < 15000 // Within 15 seconds
      );

      // Special handling for speech and actions
      const isConversationalAction =
        exp.type === "speech" || exp.type === "action";
      const shouldAdd =
        !isDuplicate ||
        (isConversationalAction &&
          uniqueExperiences.length > 0 &&
          uniqueExperiences[uniqueExperiences.length - 1].type !== exp.type);

      if (shouldAdd) {
        uniqueExperiences.push(exp);
        seenExperiences.add(key);
      }
    }
  });

  // Sort experiences chronologically
  uniqueExperiences.sort((a, b) => a.timestamp - b.timestamp);

  // Keep more perceptions in memory, only deduplicating exact matches
  const updatedPerceptions =
    perceptions !== lastPerception
      ? [
          ...currentPerceptionsList,
          {
            timestamp: Date.now(),
            content: perceptions,
          },
        ]
      : currentPerceptionsList;

  // Keep up to 50 recent perceptions
  const recentPerceptions = updatedPerceptions.slice(-50);

  setComponent(world, eid, Memory, {
    lastThought: thought.thought,
    thoughts: recentThoughts,
    perceptions: recentPerceptions,
    experiences: uniqueExperiences,
    lastUpdate: Date.now(),
  });
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
  appearance: Record<string, string>,
  runtime: SimulationRuntime
) {
  // Always update the component state
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

  // Create visual stimulus for immediate appearance change
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

  // Emit appearance event
  runtime.eventBus.emitAgentEvent(eid, "appearance", "appearance", {
    description: appearance.description || Appearance.description[eid],
    facialExpression:
      appearance.facialExpression || Appearance.facialExpression[eid],
    bodyLanguage: appearance.bodyLanguage || Appearance.bodyLanguage[eid],
    currentAction: appearance.currentAction || Appearance.currentAction[eid],
    socialCues: appearance.socialCues || Appearance.socialCues[eid],
    lastUpdate: Date.now(),
  });
}

// New Stage: Extract experiences from perceptions
async function extractPerceptionExperiences(
  eid: number,
  perceptions: any[],
  world: World,
  runtime: SimulationRuntime
): Promise<Experience[]> {
  const currentExperiences = Memory.experiences[eid] || [];

  // Filter out perceptions that would create duplicate experiences
  const filteredPerceptions = perceptions.filter((p) => {
    const potentialContent = p.content?.toString() || "";
    return !currentExperiences.some(
      (exp: Experience) =>
        exp.content.includes(potentialContent) &&
        Math.abs(exp.timestamp - Date.now()) < 5000
    );
  });

  if (filteredPerceptions.length === 0) {
    return [];
  }

  const agentState: ExtractExperiencesState = {
    name: Agent.name[eid],
    role: Agent.role[eid],
    systemPrompt: Agent.systemPrompt[eid],
    recentExperiences: currentExperiences.filter((exp: Experience) =>
      ["thought", "speech", "action", "observation"].includes(exp.type)
    ) as Experience[],
    timestamp: Date.now(),
    stimulus: filteredPerceptions.map((p) => ({
      type: p.type,
      source: p.sourceEntity,
      data: p.content,
    })),
  };

  const experiences = await extractExperiences(agentState);

  experiences.forEach((exp: Experience) => {
    runtime.eventBus.emitAgentEvent(
      eid,
      "experience",
      exp.type as EventCategory,
      exp
    );
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

      // Emit experience events
      const newExperiences = await extractPerceptionExperiences(
        eid,
        currentPerceptions,
        world,
        runtime
      );

      // Stage 3: Generate thought based on state
      const thought = await generateAgentThought(
        world,
        eid,
        perceptions,
        currentPerceptions,
        runtime
      );

      // Stage 4: Update agent memory
      updateAgentMemory(world, eid, thought, perceptions, newExperiences);

      // Stage 5: Handle agent actions
      handleAgentAction(world, eid, thought);

      // Stage 6: Update agent appearance
      if (thought.appearance) {
        updateAgentAppearance(
          world,
          eid,
          agentRoom,
          thought.appearance,
          runtime
        );
      }

      // Initialize available tools if not set
      if (!Action.availableTools[eid]) {
        setComponent(world, eid, Action, {
          availableTools: runtime.getActionManager().getAvailableTools(),
          pendingAction: Action.pendingAction[eid],
          lastActionTime: Action.lastActionTime[eid],
        });
      }
    }

    return world;
  }
);
