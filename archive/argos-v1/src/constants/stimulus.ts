import { StimulusType } from "../types/stimulus";

export const STIMULUS_PRIORITIES: Record<StimulusType, number> = {
  [StimulusType.VISUAL]: 3,
  [StimulusType.AUDITORY]: 4,
  [StimulusType.COGNITIVE]: 5,
  [StimulusType.TECHNICAL]: 2,
  [StimulusType.ENVIRONMENTAL]: 1,
};

export const DEFAULT_STIMULUS_DECAY = 1; // Default decay of 1 means stimulus will be cleaned up
export const MAX_STIMULUS_AGE = 30000; // 30 seconds max age as a safety net
export const MIN_STIMULUS_PRIORITY = 0;
export const MAX_STIMULUS_PRIORITY = 10;

// Stimulus processing constants
export const MAX_STIMULI_PER_TICK = 50;
export const STIMULUS_BATCH_SIZE = 10;

// Validation constants
export const MAX_CONTENT_LENGTH = 10000; // 10KB
export const MIN_INTENSITY = 0;
export const MAX_INTENSITY = 100;
