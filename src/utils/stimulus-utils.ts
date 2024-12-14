import { World, addEntity, addComponent, set } from "bitecs";
import {
  Agent,
  Room,
  Stimulus,
  StimulusInRoom,
  StimulusSource,
} from "../components/agent/Agent";
import { findRoomByStringId } from "./queries";
import { STIMULUS_DECAY, DEFAULT_DECAY_BY_TYPE } from "./stimulus-constants";

// Base types for all stimuli
export type StimulusType =
  | "VISUAL"
  | "AUDITORY"
  | "COGNITIVE"
  | "TECHNICAL"
  | "ENVIRONMENTAL";

interface BaseStimulus {
  sourceEntity: number;
  roomId: string;
  decay?: number;
  source?: string;
}

function createStimulus(
  world: World,
  type: StimulusType,
  options: BaseStimulus,
  content: Record<string, any>
) {
  const { sourceEntity, roomId, source = "AGENT" } = options;
  const roomEntity = findRoomByStringId(world, roomId);
  if (!roomEntity) return;

  const decay = options.decay ?? DEFAULT_DECAY_BY_TYPE[type];
  const stimulusEntity = addEntity(world);

  // Serialize stimulus content
  const stimulusContent = JSON.stringify({
    name:
      source === "ROOM" ? Room.name[sourceEntity] : Agent.name[sourceEntity],
    role: source === "ROOM" ? "ROOM" : Agent.role[sourceEntity],
    timestamp: Date.now(),
    category: getStimulusCategory(type),
    ...content,
    metadata: {
      sourceName:
        source === "ROOM" ? Room.name[sourceEntity] : Agent.name[sourceEntity],
      sourceRole: source === "ROOM" ? "ROOM" : Agent.role[sourceEntity],
      roomName: Room.name[roomEntity],
      decay,
      ...content.metadata,
    },
  });

  // Add stimulus component with serialized content
  addComponent(
    world,
    stimulusEntity,
    set(Stimulus, {
      type,
      sourceEntity,
      source,
      timestamp: Date.now(),
      decay,
      content: stimulusContent,
      roomId,
    })
  );

  // Add relations
  addComponent(world, stimulusEntity, StimulusInRoom(roomEntity));
  addComponent(world, stimulusEntity, StimulusSource(sourceEntity));

  return stimulusEntity;
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
  options: BaseStimulus & {
    appearance?: boolean;
    data: Record<string, any>;
    context?: Record<string, any>;
  }
) {
  const roomEntity = findRoomByStringId(world, options.roomId);
  if (!roomEntity) return;

  const content = {
    ...(options.appearance
      ? { appearance: Agent.appearance[options.sourceEntity] }
      : {}),
    ...options.data,
    context: options.context,
    location: {
      roomId: options.roomId,
      roomName: Room.name[roomEntity],
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
  options: BaseStimulus & {
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
  options: BaseStimulus & {
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
