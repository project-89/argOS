import { World, query, removeEntity, setComponent } from "bitecs";
import { Stimulus } from "../components/agent/Agent";
import { logger } from "../utils/logger";
import { createSystem } from "./System";

/**
 * System that cleans up stimuli at the end of each engine cycle.
 * - Removes all stimuli that have been processed
 * - Uses decay value to determine if stimulus should persist
 * - Keeps room-generated appearance stimuli (they're regenerated each cycle)
 */
export const StimulusCleanupSystem = createSystem(
  (runtime) => async (world: World) => {
    const stimuli = query(world, [Stimulus]);
    let cleanupCount = 0;

    console.log("STIMULUS SYSTEM");

    for (const eid of stimuli) {
      // Skip if stimulus hasn't decayed yet
      if (Stimulus.decay[eid] > 0) {
        setComponent(world, eid, Stimulus, {
          ...Object.fromEntries(
            (Object.keys(Stimulus) as Array<keyof typeof Stimulus>).map(
              (key) => [key, Stimulus[key][eid]]
            )
          ),
          decay: Stimulus.decay[eid] - 1,
        });
        continue;
      }

      // Emit cleanup event before removing
      runtime.emit("log", "system", {
        message: `Cleaned up stimulus: ${
          (Stimulus.content[eid]
            ? JSON.parse(Stimulus.content[eid]).action
            : null) || "unknown"
        }`,
        actionType: "SYSTEM",
      });

      // Remove the stimulus
      removeEntity(world, eid);
      cleanupCount++;
    }

    if (cleanupCount > 0) {
      runtime.emit("log", "system", {
        message: `Cleaned up ${cleanupCount} processed stimuli`,
        actionType: "SYSTEM",
      });
    }

    return world;
  }
);
