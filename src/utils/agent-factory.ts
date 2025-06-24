import {
  World,
  addEntity,
  addComponent,
  set,
  setComponent,
  addComponent as addRelation,
  removeComponent,
  query,
  hasComponent,
} from "bitecs";
import {
  Action,
  Agent,
  Memory,
  Appearance,
  Room,
  OccupiesRoom,
  RecentActions,
  Perception,
  Goal,
  Plan,
  Thought,
  ActionMemory,
  WorkingMemory,
  Attention,
  ReasoningContext,
} from "../components";
import { AgentConfig } from "../types/agent";
import { logger } from "../utils/logger";
import { findRoomByStringId, getAgentRoom } from "../utils/queries";
import { actions } from "../actions";

const USER_APPEARANCE =
  "A presence in the system, representing direct human interaction.";

export interface UserConfig {
  name?: string;
  role?: string;
  appearance?: string;
}

export function createUser(world: World, config: UserConfig = {}) {
  const {
    name = "User",
    role = "Human Observer",
    appearance = USER_APPEARANCE,
  } = config;

  const eid = addEntity(world);

  // Add core agent component - minimal setup just for identification
  setComponent(world, eid, Agent, {
    name,
    role,
    systemPrompt: "", // Users don't need system prompts
    active: 1,
    platform: "human",
    appearance,
    attention: 1,
  });

  // Add appearance component - this is what other agents will perceive
  addComponent(
    world,
    eid,
    set(Appearance, {
      baseDescription: appearance,
      facialExpression: "attentive",
      bodyLanguage: "present and aware",
      currentAction: "observing",
      socialCues: "receptive to interaction",
      lastUpdate: Date.now(),
    })
  );

  logger.system(`Created user entity: ${name} (${role})`);

  return eid;
}

// Helper function to move user between rooms
export function moveUserToRoom(
  world: World,
  userEntity: number,
  roomId: string
) {
  const roomEntity = findRoomByStringId(world, roomId);
  if (!roomEntity) {
    logger.error(`Room ${roomId} not found`, { roomId });
    return;
  }

  // Remove from current room if any
  const currentRooms = query(world, [Room]).filter((eid) =>
    hasComponent(world, userEntity, OccupiesRoom(eid))
  );

  for (const currentRoom of currentRooms) {
    logger.system(`User leaving room ${Room.name[currentRoom]}`);
    removeComponent(world, userEntity, OccupiesRoom(currentRoom));
  }

  // Move to new room using OccupiesRoom relation
  addComponent(world, userEntity, OccupiesRoom(roomEntity));
  logger.system(`User entering room ${Room.name[roomEntity]}`);

  // Update appearance to show room transition
  if (hasComponent(world, userEntity, Appearance)) {
    Appearance.currentAction[userEntity] = "entered the room";
    Appearance.lastUpdate[userEntity] = Date.now();
  }
}

export function createAgent(
  world: World,
  config: AgentConfig & {
    tools?: Array<keyof typeof actions>;
    initialGoals?: string[];
  }
) {
  const {
    name,
    role,
    systemPrompt,
    platform = "default",
    appearance = "A nondescript figure",
    active = 1,
    tools = ["speak", "wait"] as Array<keyof typeof actions>, // Default tools
    initialGoals = [], // Default to empty goals
  } = config;

  const eid = addEntity(world);

  setComponent(world, eid, Agent, {
    name,
    role,
    systemPrompt,
    active,
    platform,
    appearance,
    attention: 1,
  });

  // Add appearance component
  addComponent(
    world,
    eid,
    set(Appearance, {
      baseDescription: appearance,
      facialExpression: "neutral",
      bodyLanguage: "relaxed",
      currentAction: "standing",
      socialCues: "open to interaction",
      lastUpdate: Date.now(),
    })
  );

  // Add memory component
  addComponent(
    world,
    eid,
    set(Memory, {
      thoughts: [],
      lastThought: "",
      perceptions: [],
      experiences: [],
    })
  );

  // Add recent actions component
  addComponent(world, eid, set(RecentActions, { actions: [] }));

  // Add perception component
  addComponent(
    world,
    eid,
    set(Perception, { currentStimuli: [], lastProcessedTime: 0 })
  );

  // Add goals component with initial goals if provided
  addComponent(
    world,
    eid,
    set(Goal, {
      current: initialGoals.map((description) => ({
        id: `goal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        description,
        priority: 0.5,
        type: "long_term",
        status: "active",
        progress: 0,
        success_criteria: [],
        progress_indicators: [],
        created_at: Date.now(),
      })),
      completed: [],
      lastUpdate: Date.now(),
    })
  );

  // Add plans component
  addComponent(
    world,
    eid,
    set(Plan, {
      plans: [], // All plans
      lastUpdate: Date.now(),
    })
  );

  // Add thought chain component
  addComponent(
    world,
    eid,
    set(Thought, {
      entries: [], // Thought chain entries
      lastEntryId: 0,
      lastUpdate: Date.now(),
    })
  );

  // Add action memory component
  addComponent(
    world,
    eid,
    set(ActionMemory, {
      sequences: [], // Completed action sequences
      currentSequence: undefined, // Currently executing sequence
      lastUpdate: Date.now(),
    })
  );

  // Add cognitive components for enhanced reasoning
  addComponent(
    world,
    eid,
    set(WorkingMemory, {
      items: [],
      capacity: 20,
      lastStimuliHash: undefined,
      lastSignificantChange: undefined,
      stableStateCycles: undefined,
    })
  );

  addComponent(
    world,
    eid,
    set(Attention, {
      focus_stack: [],
      capacity: 5,
      filters: {
        include_types: [],
        exclude_types: [],
        min_relevance: 0.3,
        min_urgency: 0.2,
      },
      mode: "scanning",
      history: [],
      salience_thresholds: {
        novelty: 0.5,
        relevance: 0.6,
        social: 0.7,
        threat: 0.8,
      },
      metrics: {
        focus_switches: 0,
        average_focus_duration: 0,
        missed_important: 0,
        distraction_count: 0,
      },
      last_update: Date.now(),
    })
  );

  addComponent(
    world,
    eid,
    set(ReasoningContext, {
      current_chain: [],
      reasoning_threads: [],
      quality_history: [],
      meta_observations: [],
      mode: "reactive",
      min_stages_required: 3,
      time_spent_reasoning: 0,
      last_deep_reasoning: Date.now(),
    })
  );

  // make sure tools are valid
  const agentTools = Object.keys(actions).filter((tool) =>
    tools.includes(tool as keyof typeof actions)
  );

  addComponent(
    world,
    eid,
    set(Action, {
      pendingAction: null,
      lastActionTime: Date.now(),
      availableTools: agentTools,
    })
  );

  logger.system(`Created agent: ${name} (${role}) with active=${active}`);

  return eid;
}
