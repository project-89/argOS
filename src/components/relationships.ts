import { createRelation } from "bitecs";

/**
 * Relationship between a stimulus and its source entity (agent or room)
 * Used to track where a stimulus originated from, whether cognitive (from an agent)
 * or physical (from a room or other entity)
 */
export const StimulusSource = createRelation();
