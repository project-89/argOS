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
} from "../components/agent/Agent";
import { AgentConfig } from "../types/agent";
import { logger } from "../utils/logger";
import { findRoomByStringId, getAgentRoom } from "../utils/queries";
import { actions } from "../actions";

const USER_APPEARANCE =
  "A presence in the system, representing direct human interaction. Their words carry the weight of reality itself.";

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
  config: AgentConfig & { tools?: string[] }
) {
  const {
    name,
    role,
    systemPrompt,
    platform = "default",
    appearance = "A nondescript figure",
    active = 1,
    tools = ["speak", "wait"], // Default tools
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

  // make sure tools are valid
  const agentTools = Object.keys(actions).filter((tool) =>
    tools.includes(tool)
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
