/** Canonical generic-interaction access, extracted from native NPC dispatch.
 * Package-owned executors retain their own capabilities and admission checks. */
import { entityExists } from "bitecs";
import type { World } from "../ecs/world";
import { getDirectContainer, listDirectContents } from "../ecs/location";
import { isPublicContainerOpen } from "../cognition/world-capabilities";
import { isEntityPresent } from "../ecs/entity-presence";

function isDescendantContainedIn(world: World, containerEid: number, targetEid: number, maxNodes = 256): boolean {
  if (containerEid === targetEid) return true;
  const visited = new Set<number>(), stack = [containerEid];
  while (stack.length > 0 && visited.size < maxNodes) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const child of listDirectContents(world, current)) {
      if (!entityExists(world, child)) continue;
      if (child === targetEid) return true;
      stack.push(child);
    }
  }
  return false;
}

export function isAccessibleViaOpenContainer(world: World, roomEid: number | undefined, targetEid: number, maxDepth = 32): boolean {
  if (roomEid === undefined || !isEntityPresent(world,roomEid) || !isEntityPresent(world,targetEid)) return false;
  let current = targetEid;
  for (let depth = 0; depth < maxDepth; depth++) {
    const container = getDirectContainer(world, current);
    if (container === undefined) return false;
    if (container === roomEid) return true;
    if (!isPublicContainerOpen(world, container)) return false;
    current = container;
  }
  return false;
}

export function isInteractTargetAccessible(world: World, actorEid: number, roomEid: number | undefined, targetEid: number): boolean {
  if(!isEntityPresent(world,actorEid)||!isEntityPresent(world,targetEid))return false;
  if (roomEid !== undefined && targetEid === roomEid) return false;
  if (roomEid !== undefined && getDirectContainer(world, targetEid) === roomEid) return true;
  if (isAccessibleViaOpenContainer(world, roomEid, targetEid)) return true;
  return isDescendantContainedIn(world, actorEid, targetEid);
}
