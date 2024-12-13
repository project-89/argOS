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
  world: World,
  runtime: SimulationRuntime
) {
  // Get recent perceptions with timing info
  const recentPerceptions = (Memory.perceptions[eid] || []).filter(
    (p: {
      timestamp: number;
      content: string;
    }): p is { timestamp: number; content: string } =>
      p &&
      typeof p === "object" &&
      "timestamp" in p &&
      "content" in p &&
      typeof p.content === "string"
  );

  // Calculate time since last perception
  const lastPerceptionTime =
    recentPerceptions.length > 0
      ? recentPerceptions[recentPerceptions.length - 1].timestamp
      : Date.now();
  const timeSinceLastPerception = Date.now() - lastPerceptionTime;

  // Create narrative with timing information
  const recentPerceptionsNarrative = recentPerceptions
    .slice(-30)
    .map((p: typeof recentPerceptions) => {
      const timeAgo = Date.now() - p.timestamp;
      // Add categories and better formatting
      return `[${new Date(
        p.timestamp
      ).toLocaleTimeString()}] <${getExperienceType(p)}> ${p.content}`;
    })
    .join("\n");

  // Get last action result if any
  const lastActionResult = Action.lastActionResult?.[eid];
  const lastActionTime = Action.lastActionTime?.[eid];

  // Add action result to narrative if recent
  let actionResultNarrative = "";
  if (lastActionResult && Date.now() - lastActionTime < 5000) {
    actionResultNarrative = `\nLast Action Result: ${lastActionResult.result}`;
  }

  // Get current experiences
  const currentExperiences = Memory.experiences[eid] || [];

  const agentState: ProcessStimulusState = {
    name: Agent.name[eid],
    role: Agent.role[eid],
    systemPrompt: Agent.systemPrompt[eid],
    recentPerceptions: recentPerceptionsNarrative + actionResultNarrative,
    timeSinceLastPerception,
    currentTimestamp: Date.now(),
    lastAction: lastActionResult,
    conversationState: {
      lastSpeaker: findLastSpeaker(currentExperiences),
      lastSpeechTime: findLastSpeechTime(currentExperiences),
      greetingMade: hasGreeted(currentExperiences),
      unansweredQuestions: countUnansweredQuestions(currentExperiences),
      engagementLevel: calculateEngagementLevel(currentExperiences),
      attemptsSinceResponse: countAttemptsSinceResponse(currentExperiences),
    },
    stimulus: perceptions.map((p) => ({
      type: p.type,
      source: p.sourceEntity,
      data: p.content,
      timestamp: p.timestamp || Date.now(),
    })),
  };

  const newPerception = await processStimulus(agentState);

  logger.agent(
    eid,
    `Processed stimuli into perception: ${newPerception}`,
    Agent.name[eid]
  );

  // emit new perceptions
  runtime.eventBus.emitAgentEvent(
    eid,
    "perception",
    "perception",
    newPerception
  );

  return newPerception;
}

// Add helper to categorize experiences
function getExperienceType(perception: any) {
  if (perception.content.includes("said:")) return "SPEECH";
  if (perception.content.includes("thought about:")) return "THOUGHT";
  if (perception.content.includes("waited for:")) return "ACTION";
  return "OBSERVATION";
}

// Stage 3: Generate thought based on state
async function generateAgentThought(
  world: World,
  eid: number,
  perceptions: string,
  currentPerceptions: any[],
  runtime: SimulationRuntime
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
    availableTools: runtime.getActionManager().getEntityTools(eid),
    conversationState: {
      lastSpeaker: findLastSpeaker(Memory.experiences[eid] || []),
      lastSpeechTime: findLastSpeechTime(Memory.experiences[eid] || []),
      greetingMade: hasGreeted(Memory.experiences[eid] || []),
      unansweredQuestions: countUnansweredQuestions(
        Memory.experiences[eid] || []
      ),
      engagementLevel: calculateEngagementLevel(Memory.experiences[eid] || []),
      attemptsSinceResponse: countAttemptsSinceResponse(
        Memory.experiences[eid] || []
      ),
    },
    lastAction: Action.lastActionResult[eid]
      ? {
          success: Action.lastActionResult[eid].success,
          message: Action.lastActionResult[eid].message,
          actionName: Action.lastActionResult[eid].actionName,
          timestamp: Action.lastActionResult[eid].timestamp,
          parameters: Action.lastActionResult[eid].parameters,
          data: Action.lastActionResult[eid].data,
        }
      : undefined,
    timeSinceLastAction: Action.lastActionTime[eid]
      ? Date.now() - Action.lastActionTime[eid]
      : undefined,
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

  // Keep up to 150 recent thoughts instead of just 10
  const recentThoughts = updatedThoughts.slice(-150);

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
          Math.abs(existing.timestamp - exp.timestamp) < 1000 // Within 1 second
      );
      if (!isDuplicate) {
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

  // Keep up to 75 recent perceptions
  const recentPerceptions = updatedPerceptions.slice(-75);

  // Track conversation state
  const conversationState: ConversationState = {
    lastSpeaker: findLastSpeaker(currentExperiences),
    lastSpeechTime: findLastSpeechTime(currentExperiences),
    greetingMade: hasGreeted(currentExperiences),
    unansweredQuestions: countUnansweredQuestions(currentExperiences),
    engagementLevel: calculateEngagementLevel(currentExperiences),
    attemptsSinceResponse: countAttemptsSinceResponse(currentExperiences),
  };

  setComponent(world, eid, Memory, {
    lastThought: thought.thought,
    thoughts: recentThoughts,
    perceptions: recentPerceptions,
    experiences: uniqueExperiences,
    lastUpdate: Date.now(),
    conversationState,
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

    // Store action intent in memory
    const actionIntent: Experience = {
      type: "action",
      content: `Decided to ${thought.action.tool}: ${JSON.stringify(
        thought.action.parameters
      )}`,
      timestamp: Date.now(),
    };

    const oldExperiences = Memory.experiences[eid] || [];
    const newExperiences = [...oldExperiences, actionIntent];

    setComponent(world, eid, Memory, {
      experiences: newExperiences,
    });

    // Store pending action
    setComponent(world, eid, Action, {
      pendingAction: thought.action,
      lastActionTime: Date.now(),
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

  const agentState: ExtractExperiencesState = {
    name: Agent.name[eid],
    role: Agent.role[eid],
    systemPrompt: Agent.systemPrompt[eid],
    recentExperiences: currentExperiences.filter((exp: any) =>
      ["thought", "speech", "action", "observation"].includes(exp.type)
    ) as Experience[],
    timestamp: Date.now(),
    stimulus: perceptions.map((p) => ({
      type: p.type,
      source: p.sourceEntity,
      data: p.content,
    })),
  };

  const experiences = await extractExperiences(agentState);

  logger.agent(
    eid,
    `Extracted ${experiences.length} experiences`,
    Agent.name[eid]
  );

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

interface ConversationState {
  lastSpeaker: string;
  lastSpeechTime: number;
  greetingMade: boolean;
  unansweredQuestions: number;
  engagementLevel: "none" | "minimal" | "active";
  attemptsSinceResponse: number;
}

function findLastSpeaker(experiences: Experience[]): string {
  const lastSpeech = [...experiences]
    .reverse()
    .find((exp) => exp.type === "speech");
  return lastSpeech?.content.split("said:")[0].trim() || "none";
}

function findLastSpeechTime(experiences: Experience[]): number {
  const lastSpeech = [...experiences]
    .reverse()
    .find((exp) => exp.type === "speech");
  return lastSpeech?.timestamp || 0;
}

function hasGreeted(experiences: Experience[]): boolean {
  return experiences.some(
    (exp) =>
      exp.type === "speech" && exp.content.toLowerCase().includes("greet")
  );
}

function countUnansweredQuestions(experiences: Experience[]): number {
  return experiences.filter(
    (exp) => exp.type === "speech" && exp.content.includes("?")
  ).length;
}

function calculateEngagementLevel(
  experiences: Experience[]
): "none" | "minimal" | "active" {
  const recentExperiences = experiences.slice(-10);
  const speechCount = recentExperiences.filter(
    (exp) => exp.type === "speech"
  ).length;
  if (speechCount > 5) return "active";
  if (speechCount > 0) return "minimal";
  return "none";
}

function countAttemptsSinceResponse(experiences: Experience[]): number {
  let count = 0;
  for (const exp of [...experiences].reverse()) {
    if (exp.type === "speech" && !exp.content.includes("I said:")) break;
    if (exp.type === "speech" && exp.content.includes("I said:")) count++;
  }
  return count;
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
        world,
        runtime
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
    }

    return world;
  }
);
