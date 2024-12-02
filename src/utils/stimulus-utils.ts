import { World } from "../types/bitecs";
import { addComponent, addEntity } from "bitecs";
import { Agent, Stimulus } from "../components/agent/Agent";
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
  // Use provided decay or default for the stimulus type
  const decay = options.decay ?? DEFAULT_DECAY_BY_TYPE[type];

  const stimulus = addEntity(world);
  addComponent(world, stimulus, Stimulus);

  Stimulus.type[stimulus] = type;
  Stimulus.sourceEntity[stimulus] = sourceEntity;
  Stimulus.source[stimulus] = "AGENT";
  Stimulus.content[stimulus] = JSON.stringify({
    name: Agent.name[sourceEntity],
    role: Agent.role[sourceEntity],
    ...content,
  });
  Stimulus.timestamp[stimulus] = Date.now();
  Stimulus.roomId[stimulus] = roomId;
  Stimulus.decay[stimulus] = decay;

  return stimulus;
}

/**
 * Creates a visual stimulus for an action
 */
export function createVisualStimulus(
  world: World,
  options: BaseStimulusOptions & {
    appearance?: boolean; // Whether to include appearance data
    data: Record<string, any>;
  }
) {
  const content = {
    ...(options.appearance
      ? { appearance: Agent.appearance[options.sourceEntity] }
      : {}),
    ...options.data,
    location: { roomId: options.roomId },
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
  }
) {
  const content = {
    cognitiveState: {
      activity: options.activity,
      focus: options.focus,
      intensity: options.intensity || "moderate",
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
  }
) {
  const content = {
    speech: options.message,
    tone: options.tone,
  };

  return createStimulus(world, "AUDITORY", options, content);
}
