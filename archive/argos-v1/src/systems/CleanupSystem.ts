import { World, query, removeEntity } from "bitecs";
import { Cleanup } from "../components";
import { logger } from "../utils/logger";
import { createSystem } from "./System";

/**
 * System that manages stimulus lifecycle and cleanup.
 * Removes any entities that have been marked with the Cleanup tag.
 * Relationships are automatically cleaned up by bitECS due to autoRemoveSubject.
 */
export const CleanupSystem = createSystem((runtime) => async (world: World) => {
  const markedForCleanup = query(world, [Cleanup]);
  let cleanupCount = 0;

  if (markedForCleanup.length > 0) {
    logger.system(
      "CleanupSystem",
      `Found ${markedForCleanup.length} entities marked for cleanup`
    );

    for (const eid of markedForCleanup) {
      removeEntity(world, eid);
      cleanupCount++;
    }

    logger.system("CleanupSystem", `Cleaned up ${cleanupCount} entities`);
  }

  return world;
});
