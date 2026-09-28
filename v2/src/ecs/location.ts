import { entityExists, hasComponent, query, getRelationTargets, addComponent, removeComponent } from "bitecs";
import type { World } from "./world";
import { Agent, ObjectState, ObjectType, PhysicalObject, Room } from "./components";
import { LocatedIn, OccupiedBy, SittingOn, SleepingOn } from "./relations";
import { isEntityPresent } from "./entity-presence";
import { worldSchema } from "../world/schema";
import { computeObjectTypeTraits } from "../world/object-type-traits";
import { transitionObjectState } from "../world/object-state";

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
  // An invalid destination is not a committed departure. In particular, do not
  // strand the actor or release their furniture while rejecting a stale target.
  if (containerEid !== undefined && !entityExists(world, containerEid)) return;

  const currentTargets = getRelationTargets(world, eid, LocatedIn);
  if (currentTargets.length === 1 && currentTargets[0] === containerEid) return;
  const previousRoom = hasComponent(world, eid, Agent) ? getRoomForEntity(world, eid) : undefined;
  for (const t of currentTargets) {
    removeComponent(world, eid, LocatedIn(t));
  }

  if (containerEid !== undefined) addComponent(world, eid, LocatedIn(containerEid));
  // This is the actual native location commit, after timed-action validation.
  // A same-room no-op, or transporting a container with its seated inhabitants,
  // does not mean that an actor has chosen to leave their chair.
  if (previousRoom !== undefined && getRoomForEntity(world, eid) !== previousRoom) releaseDepartedSeating(world, eid, previousRoom);
}

/** Native locomotion may release posture on the first actual displacement,
 * including a walk within one room. Admission alone is not a departure. */
export function releaseDepartedSeating(world: World, actor: number, previousRoom: number): void {
  for (const seat of getRelationTargets(world, actor, SittingOn)) {
    removeComponent(world, actor, SittingOn(seat));
    // Release only this departing actor's bookkeeping edge, even if the exact
    // seat has since moved or broken. This does not authorize changing its state.
    if (!entityExists(world, seat)) continue;
    if (hasComponent(world, seat, OccupiedBy(actor))) removeComponent(world, seat, OccupiedBy(actor));
    // A stale posture cannot grant authority over a removed/moved/replaced prop.
    // bitECS deletes incoming relation edges when the target entity is removed.
    if (!isEntityPresent(world, seat) || getRoomForEntity(world, seat) !== previousRoom
      || !hasComponent(world, seat, PhysicalObject) || !hasComponent(world, seat, ObjectType)
      || !hasComponent(world, seat, ObjectState) || ObjectState.current[seat] !== "occupied") continue;
    if (query(world, [SittingOn(seat)]).length || query(world, [SleepingOn(seat)]).length
      || getRelationTargets(world, seat, OccupiedBy).length) continue;
    const definition = worldSchema.getObjectType(ObjectType.typeId[seat]);
    if (!definition) continue;
    const available = [ObjectState.previous[seat], definition.defaultState].find(state => state && state !== "occupied"
      && definition.states[state] && computeObjectTypeTraits(definition, state).includes("sittable"));
    if (available) transitionObjectState(world, seat, available, { world, worldSchema }, "location:seat_departure");
  }
}
