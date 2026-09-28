/** Source-bound public input projection for managed world development. No
 * worker sees native component stores or receives mutation authority from it. */
import { hasComponent, removeComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, ObjectState, Room, Traits, WorkingMemoryIdentity } from "../ecs/components";
import { attachToEntity, extendDynamicComponent, getComponent } from "../ecs/component-registry";
import { isEntityPresent } from "../ecs/entity-presence";
import { getDirectContainer, getRoomForEntity } from "../ecs/location";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents, subscribeCommittedSourceStop } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { isPublicContainerOpen } from "../cognition/world-capabilities";
import { SPATIAL_DEVELOPMENT_INPUT, SPATIAL_DEVELOPMENT_LIMITS } from "./spatial-development-policy";
import type { SpatialWeatherCondition } from "./spatial-weather";

export type SpatialDevelopmentTarget = Readonly<{ id: number; key: string; kind: "resident" | "object"; asset: string }>;
export type SpatialDevelopmentRoom = Readonly<{ id: number; key: string; outdoor: boolean }>;
export type SpatialDevelopmentPublicInput = {
  eligible: boolean; ownerKey: string; sourceKey: string; kind: "resident" | "object"; asset: string;
  roomKey: string; outdoors: boolean; weather: SpatialWeatherCondition | "sheltered"; publicState: string;
};
const FIELDS = { eligible: "boolean", ownerKey: "string", sourceKey: "string", kind: "string", asset: "string",
  roomKey: "string", outdoors: "boolean", weather: "string", publicState: "string" } as const;
const WEATHER = new Set(["clear", "cloudy", "rain"]);
export function registerSpatialDevelopmentInputSchema(): void {
  extendDynamicComponent({ name: SPATIAL_DEVELOPMENT_INPUT,
    description: "Host-owned public physical development inputs; no resident cognition or execution authority", properties: FIELDS });
}

export function createSpatialDevelopmentInputs(options: {
  world: World; targets: readonly SpatialDevelopmentTarget[]; rooms: readonly SpatialDevelopmentRoom[];
  weather(): readonly { id: number; key: string; condition: SpatialWeatherCondition }[];
  running(): boolean;
}) {
  assertSimulationTaskActive();
  const { world } = options, source = getCommittedEvents(world), sourceId = source.sourceId ?? "", createdAt = readSimulationTime(world);
  const targets = options.targets.map(target => ({ ...target })), rooms = options.rooms.map(room => ({ ...room }));
  const present = (ref: { id: number; key: string }) => isEntityPresent(world, ref.id)
    && hasComponent(world, ref.id, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[ref.id] === ref.key;
  const validTarget = (target: SpatialDevelopmentTarget) => present(target)
    && (target.kind === "resident" ? hasComponent(world, target.id, Agent) && Agent.active[target.id] === true
      : !hasComponent(world, target.id, Agent) && !hasComponent(world, target.id, Room));
  const validRoom = (room: SpatialDevelopmentRoom) => present(room) && hasComponent(world, room.id, Room);
  if (!sourceId || source.stopped || !Number.isFinite(createdAt) || createdAt < 0
    || !targets.length || targets.length > SPATIAL_DEVELOPMENT_LIMITS.maxTargets || !rooms.length || rooms.length > SPATIAL_DEVELOPMENT_LIMITS.maxRooms
    || new Set(targets.map(target => target.id)).size !== targets.length || new Set(targets.map(target => target.key)).size !== targets.length
    || new Set(rooms.map(room => room.id)).size !== rooms.length || new Set(rooms.map(room => room.key)).size !== rooms.length
    || targets.some(target => !target.key || target.key.length > 500 || !["resident", "object"].includes(target.kind)
      || !/^[A-Za-z0-9_-]{1,100}$/.test(target.asset) || !validTarget(target))
    || rooms.some(room => !room.key || typeof room.outdoor !== "boolean" || !validRoom(room)))
    throw Error("Development inputs require bounded exact current targets, rooms and source");
  registerSpatialDevelopmentInputSchema();
  const input = getComponent(SPATIAL_DEVELOPMENT_INPUT)!;
  // Validate the entire installation before adding any component membership.
  for (const target of targets) if (hasComponent(world, target.id, input)
    && (input.ownerKey[target.id] !== target.key || input.sourceKey[target.id] !== sourceId))
    throw Error("Development input belongs to a different entity or source; cannot reassign it");
  for (const target of targets) attachToEntity(world, target.id, SPATIAL_DEVELOPMENT_INPUT,
    { eligible: false, ownerKey: target.key, sourceKey: sourceId, kind: target.kind, asset: target.asset,
      roomKey: "", outdoors: false, weather: "sheltered", publicState: "" });
  let closed = false;
  const current = () => !closed && options.running() && !getCommittedEvents(world).stopped
    && getCommittedEvents(world).sourceId === sourceId && Number.isFinite(readSimulationTime(world))
    && readSimulationTime(world) >= createdAt && rooms.every(validRoom);
  const owned = (target: SpatialDevelopmentTarget) => hasComponent(world, target.id, input)
    && input.ownerKey[target.id] === target.key && input.sourceKey[target.id] === sourceId;
  const hidden = (id: number) => {
    if (!hasComponent(world, id, Traits)) return false;
    try { const traits: unknown = JSON.parse(Traits.active[id] ?? "[]"); return !Array.isArray(traits)
      || traits.some(trait => typeof trait !== "string" || ["hidden", "invisible", "concealed"].includes(trait.trim().toLowerCase())); }
    catch { return true; }
  };
  function publicExterior(target: number, room: number): boolean {
    const visited = new Set<number>([target]);
    let parent = getDirectContainer(world, target);
    while (parent !== undefined && visited.size <= 16) {
      if (parent === room) return !hidden(parent);
      if (visited.has(parent) || hidden(parent) || !isPublicContainerOpen(world, parent)) return false;
      visited.add(parent); parent = getDirectContainer(world, parent);
    }
    return false;
  }
  function facts(target: SpatialDevelopmentTarget): SpatialDevelopmentPublicInput | undefined {
    if (!validTarget(target) || hidden(target.id)) return;
    const roomId = getRoomForEntity(world, target.id), room = rooms.find(row => row.id === roomId);
    if (!room || !validRoom(room) || !publicExterior(target.id, room.id)) return;
    const weather = room.outdoor ? options.weather().find(row => row.id === room.id && row.key === room.key)?.condition : "sheltered";
    if (!weather || weather !== "sheltered" && !WEATHER.has(weather)) return;
    const state = target.kind === "object" && hasComponent(world, target.id, ObjectState) ? ObjectState.current[target.id] : "";
    return { eligible: true, ownerKey: target.key, sourceKey: sourceId, kind: target.kind, asset: target.asset,
      roomKey: room.key, outdoors: room.outdoor, weather,
      publicState: typeof state === "string" && /^[A-Za-z0-9_-]{0,64}$/.test(state) ? state : "" };
  }
  function revoke(target: SpatialDevelopmentTarget) {
    // Preserve generated output and receipts. Revoke only this exact source's
    // input membership, not another source's state or a replacement's data.
    if (owned(target)) { input.eligible[target.id] = false; removeComponent(world, target.id, input); }
  }
  function close() { if (closed) return; closed = true; for (const target of targets) revoke(target); removeStop(); }
  const removeStop = subscribeCommittedSourceStop(world, close);
  function syncInputs() {
    assertSimulationTaskActive();
    if (!current()) { for (const target of targets) revoke(target); return; }
    for (const target of targets) {
      const value = facts(target);
      if (!value) { revoke(target); continue; }
      // A changed input ownership can never be overwritten by an old adapter.
      if (hasComponent(world, target.id, input) && !owned(target)) continue;
      attachToEntity(world, target.id, SPATIAL_DEVELOPMENT_INPUT, value);
    }
  }
  /** Required at worker capture AND final mutation admission. Declared read
   * sets alone are insufficient: old output membership could survive input
   * revocation, and a worker can use a literal ID instead of a query result. */
  function permits(id: number): boolean {
    const target = targets.find(row => row.id === id);
    if (!current() || !target || !owned(target) || input.eligible[id] !== true) return false;
    const value = facts(target);
    return !!value && Object.entries(value).every(([field, expected]) => input[field][id] === expected);
  }
  function snapshotTargets() {
    return targets.filter(target => permits(target.id)).map(target => ({ ...target, roomId: getRoomForEntity(world, target.id)!,
      input: { ...facts(target)! } }));
  }
  /** Trusted host only: call after a native visual/entity admission succeeds.
   * A generated proposal or numeric ID alone cannot register a new target. */
  function addTarget(target: SpatialDevelopmentTarget): boolean {
    assertSimulationTaskActive();
    if (!current() || !target.key || target.key.length > 500 || !["resident", "object"].includes(target.kind)
      || !/^[A-Za-z0-9_-]{1,100}$/.test(target.asset) || !validTarget(target))
      throw Error("New development target needs the current source and exact native identity");
    const prior = targets.find(row => row.id === target.id || row.key === target.key);
    if (prior) {
      if (prior.id === target.id && prior.key === target.key && prior.kind === target.kind && prior.asset === target.asset) return false;
      throw Error("Development target identity or asset cannot be reassigned");
    }
    if (targets.length >= SPATIAL_DEVELOPMENT_LIMITS.maxTargets) throw Error("Development target budget exhausted");
    const value = facts(target);
    if (!value || hasComponent(world, target.id, input) && !owned(target))
      throw Error("New development target must have a current public exterior and unconflicted input ownership");
    targets.push({ ...target });
    attachToEntity(world, target.id, SPATIAL_DEVELOPMENT_INPUT, value);
    return true;
  }
  return { input, sourceId, syncInputs, close, isCurrent: current, permits, snapshotTargets, addTarget };
}
