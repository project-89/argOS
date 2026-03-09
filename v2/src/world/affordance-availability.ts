import type { World } from "../ecs/world";
import { canUseAffordance } from "./effect-executor";
import { worldSchema, type AffordanceDefinition } from "./schema";

/**
 * Returns affordances that are actually usable by `actorEid` on `targetEid` right now.
 *
 * Intentionally lives outside `src/cognition/*` to avoid circular imports:
 * - `cognition-system.ts` imports `builtin-systems.ts`
 * - `builtin-systems.ts` registers actions with `ActionRegistry`
 * - `ActionRegistry` should remain importable without pulling in cognition runtime.
 */
export function getAvailableAffordances(
  world: World,
  actorEid: number,
  targetEid: number
): AffordanceDefinition[] {
  const available: AffordanceDefinition[] = [];

  for (const affordance of worldSchema.getAllAffordances()) {
    const check = canUseAffordance(world, affordance, actorEid, targetEid);
    if (check.available) available.push(affordance);
  }

  return available;
}

