import {
  World,
  addEntity,
  removeEntity,
  EntityId,
  addComponent,
  set,
} from "bitecs";
import { Stimulus } from "../components";
import { logger } from "../utils/logger";
import { StimulusType, StimulusSource, StimulusData } from "../types/stimulus";
import {
  MAX_CONTENT_LENGTH,
  MAX_INTENSITY,
  MIN_INTENSITY,
  STIMULUS_PRIORITIES,
} from "../constants/stimulus";
import { setStimulusSource } from "../components/relationships/stimulus";

/**
 * Validates stimulus data before creation
 */
function validateStimulusData(data: Partial<StimulusData>): string | null {
  if (!data.type || !Object.values(StimulusType).includes(data.type)) {
    return `Invalid stimulus type: ${data.type}`;
  }

  if (!data.source || !Object.values(StimulusSource).includes(data.source)) {
    return `Invalid source type: ${data.source}`;
  }

  if (data.content && data.content.length > MAX_CONTENT_LENGTH) {
    return "Content exceeds maximum length";
  }

  if (
    data.intensity !== undefined &&
    (data.intensity < MIN_INTENSITY || data.intensity > MAX_INTENSITY)
  ) {
    return `Intensity must be between ${MIN_INTENSITY} and ${MAX_INTENSITY}`;
  }

  return null;
}

/**
 * Creates a new stimulus entity in the world
 */
export function createStimulus(
  world: World,
  data: Partial<StimulusData>
): number | null {
  const validationError = validateStimulusData(data);
  if (validationError) {
    logger.error(`Failed to create stimulus: ${validationError}`, data);
    return null;
  }

  const eid = addEntity(world);
  logger.debug(`Creating stimulus entity ${eid}`, data);

  try {
    // Validate JSON content
    const content = data.content || "{}";
    JSON.parse(content);

    // Add stimulus component with validated data
    const componentData = {
      type: data.type!,
      source: data.source!,
      timestamp: Date.now(),
      content,
      subtype: data.subtype || "",
      intensity: data.intensity || 1,
      private: data.private || false,
      decay: data.decay ?? 1,
      priority: data.priority || STIMULUS_PRIORITIES[data.type!],
      metadata: data.metadata,
      perceived: false,
    };

    logger.debug(`Adding stimulus component to entity ${eid}:`, componentData);

    // Add component with values
    addComponent(world, eid, set(Stimulus, componentData));

    // Verify component was added
    logger.debug(`Verifying stimulus component for ${eid}:`, {
      type: Stimulus.type[eid],
      source: Stimulus.source[eid],
      content: Stimulus.content[eid],
      timestamp: Stimulus.timestamp[eid],
    });

    return eid;
  } catch (e) {
    logger.error("Error creating stimulus:", e);
    removeEntity(world, eid);
    return null;
  }
}

/**
 * Helper function to create visual stimulus
 */
export function createVisualStimulus(
  world: World,
  sourceEntity: EntityId,
  description: string,
  options: Partial<StimulusData> = {}
): number | null {
  const stimulusId = createStimulus(world, {
    type: StimulusType.VISUAL,
    source: StimulusSource.AGENT,
    content: JSON.stringify({
      data: { description },
      metadata: options.metadata,
    }),
    ...options,
  });

  if (stimulusId && sourceEntity) {
    setStimulusSource(world, stimulusId, sourceEntity, 1.0, {
      type: "visual",
    });
  }

  return stimulusId;
}

/**
 * Helper function to create auditory stimulus
 */
export function createAuditoryStimulus(
  world: World,
  sourceEntity: EntityId,
  description: string,
  options: Partial<StimulusData> = {}
): number | null {
  const stimulusId = createStimulus(world, {
    type: StimulusType.AUDITORY,
    source: StimulusSource.AGENT,
    content: JSON.stringify({
      data: { description },
      metadata: options.metadata,
    }),
    ...options,
  });

  if (stimulusId && sourceEntity) {
    setStimulusSource(world, stimulusId, sourceEntity, 1.0, {
      type: "auditory",
    });
  }

  return stimulusId;
}

/**
 * Helper function to create cognitive stimulus
 */
export function createCognitiveStimulus(
  world: World,
  sourceEntity: EntityId,
  description: string,
  details: any,
  options: Partial<StimulusData> = {}
): number | null {
  const stimulusId = createStimulus(world, {
    type: StimulusType.COGNITIVE,
    source: StimulusSource.SELF,
    content: JSON.stringify({
      data: { description, details },
      metadata: { ...options.metadata, sourceEntity },
    }),
    ...options,
  });

  if (stimulusId && sourceEntity) {
    setStimulusSource(world, stimulusId, sourceEntity, 1.0, {
      type: "cognitive",
      isSelf: true,
    });
  }

  return stimulusId;
}

/**
 * Helper function to create environmental stimulus
 */
export function createEnvironmentalStimulus(
  world: World,
  description: string,
  details: any,
  sourceEntity: EntityId = 0,
  options: Partial<StimulusData> = {}
): number | null {
  const stimulusId = createStimulus(world, {
    type: StimulusType.ENVIRONMENTAL,
    source: StimulusSource.SYSTEM,
    content: JSON.stringify({
      data: { description, details },
      metadata: options.metadata,
    }),
    ...options,
  });

  if (stimulusId && sourceEntity) {
    setStimulusSource(world, stimulusId, sourceEntity, 0.5, {
      type: "environmental",
    });
  }

  return stimulusId;
}

/**
 * Helper function to create technical stimulus
 */
export function createTechnicalStimulus(
  world: World,
  sourceEntity: EntityId,
  description: string,
  details: any,
  options: Partial<StimulusData> = {}
): number | null {
  const stimulusId = createStimulus(world, {
    type: StimulusType.TECHNICAL,
    source: StimulusSource.SYSTEM,
    content: JSON.stringify({
      data: { description, details },
      metadata: options.metadata,
    }),
    ...options,
  });

  if (stimulusId && sourceEntity) {
    setStimulusSource(world, stimulusId, sourceEntity, 0.8, {
      type: "technical",
    });
  }

  return stimulusId;
}
