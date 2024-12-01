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
} from "../llm/agent-llm";
import { logger } from "../utils/logger";
import { createSystem, SystemConfig } from "./System";

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

// Helper to process stimuli into perceptions
async function processRoomStimuli(
  world: World,
  eid: number,
  roomId: number
): Promise<string> {
  const currentTime = Date.now();
  const recentTimeWindow = 5000; // Consider stimuli from last 5 seconds

  const currentStimuli = query(world, [Stimulus])
    .map((sid) => ({
      type: Stimulus.type[sid],
      sourceEntity: Stimulus.sourceEntity[sid],
      source: Stimulus.source[sid],
      content: JSON.parse(Stimulus.content[sid]),
      timestamp: Stimulus.timestamp[sid],
      roomId: Stimulus.roomId[sid],
    }))
    .filter(
      (s) =>
        s.roomId === Room.id[roomId] &&
        s.sourceEntity !== eid &&
        currentTime - s.timestamp < recentTimeWindow
    )
    .sort((a, b) => b.timestamp - a.timestamp); // Most recent first

  const agentState = {
    name: Agent.name[eid],
    role: Agent.role[eid],
    systemPrompt: Agent.systemPrompt[eid],
  };

  const narrativePerception =
    currentStimuli.length > 0
      ? await processStimulus(agentState, currentStimuli)
      : "You perceive nothing of note.";

  Memory.experiences[eid].push({
    type: "perception",
    content: narrativePerception,
    timestamp: Date.now(),
  });

  return narrativePerception;
}

// Helper to emit appearance changes as visual stimuli
function emitAppearanceStimulus(
  world: World,
  eid: number,
  roomId: number,
  appearance: Record<string, string>,
  currentTime: number
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
  Appearance.lastUpdate[eid] = currentTime;

  // Emit appearance change stimulus
  const appearanceStimulus = addEntity(world);
  addComponent(world, appearanceStimulus, Stimulus);
  Stimulus.type[appearanceStimulus] = "VISUAL";
  Stimulus.sourceEntity[appearanceStimulus] = eid;
  Stimulus.source[appearanceStimulus] = "AGENT";
  Stimulus.content[appearanceStimulus] = JSON.stringify({
    name: Agent.name[eid],
    role: Agent.role[eid],
    appearance: Agent.appearance[eid],
    ...appearance,
    location: {
      roomId: Room.id[roomId],
      roomName: Room.name[roomId],
    },
  });
  Stimulus.timestamp[appearanceStimulus] = currentTime;
  Stimulus.roomId[appearanceStimulus] = Room.id[roomId];
  Stimulus.decay[appearanceStimulus] = 1;
}

export const ThinkingSystem = createSystem<ThinkingSystemConfig>(
  (runtime, config) => async (world: World) => {
    const agents = query(world, [Agent, Memory]);
    logger.system(`ThinkingSystem starting with ${agents.length} agents`);

    // Process each agent's thoughts sequentially
    for (const eid of agents) {
      // Skip inactive agents
      if (!Agent.active[eid]) continue;

      // Ensure agent is in a room
      const roomId = findAgentRoom(world, eid);
      if (roomId === null) continue;

      // Initialize memory if needed
      Memory.thoughts[eid] = Memory.thoughts[eid] || [];
      Memory.experiences[eid] = Memory.experiences[eid] || [];

      // 1. Process current stimuli into perceptions
      const narrativePerception = await processRoomStimuli(world, eid, roomId);

      // 2. Generate thought and get response
      const agentState = {
        name: Agent.name[eid],
        role: Agent.role[eid],
        systemPrompt: Agent.systemPrompt[eid],
        thoughtHistory: Memory.thoughts[eid],
        perceptions: {
          narrative: narrativePerception,
          raw: query(world, [Stimulus])
            .map((sid) => ({
              type: Stimulus.type[sid],
              source: Stimulus.sourceEntity[sid],
              data: JSON.parse(Stimulus.content[sid]),
            }))
            .filter((s) => s.source !== eid),
        },
        experiences: Memory.experiences[eid],
        availableTools: runtime.getAvailableTools(),
      };

      // Generate thought and handle its effects
      const response = await generateThought(agentState);
      logger.agent(eid, `Thought: ${response.thought}`);
      logger.agent(eid, `Action: ${JSON.stringify(response.action)}`);
      logger.agent(eid, `Appearance: ${JSON.stringify(response.appearance)}`);

      // Store the thought
      Memory.lastThought[eid] = response.thought;
      Memory.thoughts[eid].push(response.thought);

      // Keep thought history at a reasonable size
      if (Memory.thoughts[eid].length > 100) {
        Memory.thoughts[eid].shift();
      }

      // 3. Handle appearance changes if any
      if (response.appearance) {
        emitAppearanceStimulus(
          world,
          eid,
          roomId,
          response.appearance,
          Date.now()
        );
      }

      // 4. Queue action if one was chosen
      if (response.action) {
        logger.agent(eid, `Queuing action: ${response.action.tool}`);
        Action.pendingAction[eid] = response.action;
      }
    }

    return world;
  }
);
