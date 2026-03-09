import { entityExists, hasComponent, query, getRelationTargets, addComponent, removeComponent } from "bitecs";
import type { World } from "./world";
import { Room } from "./components";
import { LocatedIn } from "./relations";

/**
 * Returns the direct container for an entity, if any.
 * `LocatedIn` is exclusive, so this is at most one container.
 */
export function getDirectContainer(world: World, eid: number): number | undefined {
  if (!entityExists(world, eid)) return undefined;
  const targets = getRelationTargets(world, eid, LocatedIn);
  return targets[0];
}

/**
 * Walk the `LocatedIn` chain until we find a `Room` entity.
 * Returns undefined if the entity is not ultimately located in a room.
 */
export function getRoomForEntity(world: World, eid: number, maxDepth: number = 32): number | undefined {
  let current = eid;

  for (let depth = 0; depth < maxDepth; depth++) {
    const container = getDirectContainer(world, current);
    if (container === undefined) return undefined;
    if (!entityExists(world, container)) return undefined;

    if (hasComponent(world, container, Room)) return container;
    current = container;
  }

  return undefined;
}

/**
 * List direct children located in a container (room, bag, drawer, agent, etc.).
 * This does not traverse into nested containers.
 */
export function listDirectContents(world: World, containerEid: number): number[] {
  if (!entityExists(world, containerEid)) return [];
  return Array.from(query(world, [LocatedIn(containerEid)]));
}

/**
 * Set an entity's direct container.
 * `LocatedIn` is exclusive, so this removes any prior LocatedIn relation(s) first.
 */
export function setLocatedIn(world: World, eid: number, containerEid: number | undefined): void {
  if (!entityExists(world, eid)) return;

  const currentTargets = getRelationTargets(world, eid, LocatedIn);
  for (const t of currentTargets) {
    removeComponent(world, eid, LocatedIn(t));
  }

  if (containerEid === undefined) return;
  if (!entityExists(world, containerEid)) return;
  addComponent(world, eid, LocatedIn(containerEid));
}
