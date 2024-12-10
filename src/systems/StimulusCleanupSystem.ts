import { World, query, removeEntity } from "bitecs";
import { Stimulus } from "../components/agent/Agent";
import { logger } from "../utils/logger";
import { createSystem } from "./System";

/**
 * System that cleans up all stimuli at the end of each engine cycle.
 * Since stimuli are immediately processed into experiences, we don't need
 * to persist them between cycles.
 */
export const StimulusCleanupSystem = createSystem(
  (runtime) => async (world: World) => {
    const stimuli = query(world, [Stimulus]);
    const cleanupCount = stimuli.length;

    logger.system(
      "StimulusCleanupSystem",
      `Cleaning up ${cleanupCount} stimuli`
    );

    // Clean up all stimuli
    for (const eid of stimuli) {
      removeEntity(world, eid);
    }

    if (cleanupCount > 0) {
      logger.system(
        "StimulusCleanupSystem",
        `Cleaned up ${cleanupCount} stimuli`
      );
    }

    return world;
  }
);
