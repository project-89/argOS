/**
 * Standard decay values for different types of stimuli
 */
export const STIMULUS_DECAY = {
  IMMEDIATE: 1, // Visual observations, immediate effects
  SHORT: 2, // Speech, basic cognitive processing
  EXTENDED: 3, // Deep cognitive processing, significant events
  PERSISTENT: 4, // (Future) Long-lasting or permanent effects
} as const;

/**
 * Default decay values for each stimulus type
 */
export const DEFAULT_DECAY_BY_TYPE = {
  VISUAL: STIMULUS_DECAY.IMMEDIATE,
  AUDITORY: STIMULUS_DECAY.SHORT, // Speech needs time to be processed
  COGNITIVE: STIMULUS_DECAY.SHORT, // Thinking effects linger
  TECHNICAL: STIMULUS_DECAY.SHORT, // Code/technical observations need processing
  ENVIRONMENTAL: STIMULUS_DECAY.IMMEDIATE,
} as const;
