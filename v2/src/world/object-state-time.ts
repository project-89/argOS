/** Native state-episode age, stored with the existing ECS temporal metadata.
 * No ticking controller and no wall-time fallback for an unknown physical age. */
import { hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { ObjectState } from "../ecs/components";
import { isEntityPresent } from "../ecs/entity-presence";
import { readSimulationTime } from "../ecs/simulation-time";
import { getStampedSimulationTime, stampSimulationTime } from "../ecs/temporal-age";

export function stampObjectStateTime(world: World, eid: number, previousState?: string): void {
  if (!hasComponent(world, eid, ObjectState)) return;
  const state = ObjectState.current[eid];
  if (!state) return;
  // Reasserting a state is not a new episode. A real stale -> fresh transition
  // does start a new episode, even if the name appeared earlier in its history.
  if (previousState === state && getStampedSimulationTime(world, eid, "ObjectState.current", 0, state) !== undefined) return;
  stampSimulationTime(world, eid, "ObjectState.current", 0, readSimulationTime(world), state);
}

export function readObjectStateAge(world: World, eid: number): number | undefined {
  if (!isEntityPresent(world, eid) || !hasComponent(world, eid, ObjectState)) return;
  const at = getStampedSimulationTime(world, eid, "ObjectState.current", 0, ObjectState.current[eid]);
  const now = readSimulationTime(world);
  return at !== undefined && at >= 0 && Number.isFinite(now) && now >= at ? now - at : undefined;
}
