import { World } from "../types/bitecs";
import { addComponent, addEntity } from "bitecs";
import { Agent, Room, Stimulus } from "../components/agent/Agent";
import { STIMULUS_DECAY, DEFAULT_DECAY_BY_TYPE } from "./stimulus-constants";

// Base types for all stimuli
export type StimulusType =
  | "VISUAL"
  | "AUDITORY"
  | "COGNITIVE"
  | "TECHNICAL"
  | "ENVIRONMENTAL";

interface BaseStimulusOptions {
  sourceEntity: number;
  roomId: string;
  decay?: number;
}

// Helper to find room entity by ID
function findRoomEntity(roomId: string): number {
  return (
    Number(
      Object.keys(Room.id).find((eid) => Room.id[Number(eid)] === roomId)
    ) || 0
  );
}

/**
 * Core utility to create a basic stimulus entity
 */
export function createStimulus(
  world: World,
  type: StimulusType,
  options: BaseStimulusOptions,
  content: Record<string, any>
) {
  const { sourceEntity, roomId } = options;
  const roomEntity = findRoomEntity(roomId);
  const decay = options.decay ?? DEFAULT_DECAY_BY_TYPE[type];

  const stimulus = addEntity(world);
  addComponent(world, stimulus, Stimulus);

  Stimulus.type[stimulus] = type;
  Stimulus.sourceEntity[stimulus] = sourceEntity;
  Stimulus.source[stimulus] = "AGENT";
  Stimulus.content[stimulus] = JSON.stringify({
    name: Agent.name[sourceEntity],
    role: Agent.role[sourceEntity],
    timestamp: Date.now(),
    category: getStimulusCategory(type),
    ...content,
    metadata: {
      sourceName: Agent.name[sourceEntity],
      sourceRole: Agent.role[sourceEntity],
      roomName: Room.name[roomEntity] || "Unknown Room",
      decay,
      ...content.metadata,
    },
  });
  Stimulus.timestamp[stimulus] = Date.now();
  Stimulus.roomId[stimulus] = roomId;
  Stimulus.decay[stimulus] = decay;

  return stimulus;
}

// Helper function to get UI-friendly category
function getStimulusCategory(type: StimulusType): string {
  switch (type) {
    case "VISUAL":
      return "Observation";
    case "AUDITORY":
      return "Speech";
    case "COGNITIVE":
      return "Thought";
    case "TECHNICAL":
      return "Technical";
    case "ENVIRONMENTAL":
      return "Environment";
    default:
      return "Other";
  }
}

/**
 * Creates a visual stimulus for an action
 */
export function createVisualStimulus(
  world: World,
  options: BaseStimulusOptions & {
    appearance?: boolean;
    data: Record<string, any>;
    context?: Record<string, any>;
  }
) {
  const roomEntity = findRoomEntity(options.roomId);
  const content = {
    ...(options.appearance
      ? { appearance: Agent.appearance[options.sourceEntity] }
      : {}),
    ...options.data,
    context: options.context,
    location: {
      roomId: options.roomId,
      roomName: Room.name[roomEntity] || "Unknown Room",
    },
    metadata: {
      hasAppearance: !!options.appearance,
      roomContext: Room.description[roomEntity],
    },
  };

  return createStimulus(world, "VISUAL", options, content);
}

/**
 * Creates a cognitive stimulus
 */
export function createCognitiveStimulus(
  world: World,
  options: BaseStimulusOptions & {
    activity: string;
    focus: string;
    intensity?: "light" | "moderate" | "deep";
    context?: Record<string, any>;
  }
) {
  const content = {
    cognitiveState: {
      activity: options.activity,
      focus: options.focus,
      intensity: options.intensity || "moderate",
    },
    context: options.context,
    metadata: {
      intensity: options.intensity || "moderate",
      isDeepThought: options.intensity === "deep",
    },
  };

  // Deep thinking gets extended decay
  const decay =
    options.intensity === "deep"
      ? STIMULUS_DECAY.EXTENDED
      : DEFAULT_DECAY_BY_TYPE.COGNITIVE;

  return createStimulus(world, "COGNITIVE", { ...options, decay }, content);
}

/**
 * Creates an auditory stimulus
 */
export function createAuditoryStimulus(
  world: World,
  options: BaseStimulusOptions & {
    message: string;
    tone?: string;
    target?: number; // Target agent if directed speech
  }
) {
  const content = {
    speech: options.message,
    tone: options.tone,
    metadata: {
      isDirected: !!options.target,
      targetName: options.target ? Agent.name[options.target] : undefined,
      targetRole: options.target ? Agent.role[options.target] : undefined,
    },
  };

  return createStimulus(world, "AUDITORY", options, content);
}
