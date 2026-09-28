/** One deliberately authored operator expansion, not autonomous spirit growth.
 * Preflight is atomic; an unexpected failure during native commit is recorded,
 * not rolled back, relabelled successful, or automatically retried. */
import type { World } from "../ecs/world";
import { entityExists, hasComponent } from "bitecs";
import { Name, ObjectType, PhysicalObject, Position, Removed, Room, WorkingMemoryIdentity } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { getCommittedEvents } from "../runtime/committed-events";
import { assertWorldConstructionAvailable } from "../runtime/world-construction-budget";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { prepareMaterializedEntityDefinition } from "../engineering/entity-materialization";
import { CAFE_SPATIAL_BLUEPRINT, SPATIAL_ASSETS, spatialEntityDefinition, validateSpatialBlueprint, type SpatialBlueprint, type SpatialRoom } from "./spatial-catalog";

export type SpatialCafeBuildResult = {
  status: "built" | "already-built" | "failed";
  sourceId: string; blueprintId: string; authority: "operator";
  ids?: Record<string, number>; error?: string;
};
type RecordState = { sourceId: string; status: "building" | "built" | "failed"; result?: SpatialCafeBuildResult };
const installations = new WeakMap<World, RecordState>();

/** The host supplies the native synchronous commit so this data module does not
 * invent a second ECS constructor. It must use native allocation and record all
 * IDs, including walls. No awaited model work or user callbacks belong inside.
 * The host also registers spatial colliders and binds native room routes. */
export function installOperatorCafe(world: World, options: {
  existingRooms: readonly SpatialRoom[];
  existingRoomIds: ReadonlyMap<string, number>;
  commit: (blueprint: SpatialBlueprint, current: () => boolean) => Record<string, number>;
}): SpatialCafeBuildResult {
  assertSimulationTaskActive();
  const source = getCommittedEvents(world);
  if (!source.sourceId || source.stopped) throw new Error("Spatial construction requires an active existing source");
  const old = installations.get(world);
  if (old?.sourceId === source.sourceId) {
    if (old.status === "building") throw new Error("Cafe construction is already in progress");
    return { ...structuredClone(old.result!), ...(old.status === "built" ? { status: "already-built" as const } : {}) };
  }
  const blueprint = validateSpatialBlueprint(CAFE_SPATIAL_BLUEPRINT, options.existingRooms);
  const dependencies = options.existingRooms.map(room => {
    const eid = options.existingRoomIds.get(room.id);
    if (eid === undefined || !entityExists(world,eid) || !hasComponent(world,eid,Room) || hasComponent(world,eid,Removed)
      || Name.value[eid] !== room.name || !hasComponent(world,eid,WorkingMemoryIdentity) || !WorkingMemoryIdentity.id[eid]) throw new Error("Cafe connection requires current native room bindings");
    return { eid, name: room.name, key: WorkingMemoryIdentity.id[eid] };
  });
  // All native definition checks precede both recording an attempt and mutation.
  for (const room of blueprint.rooms) prepareMaterializedEntityDefinition({ name: room.name, description: room.description, type: "room", components: [] });
  for (const prop of blueprint.props) prepareMaterializedEntityDefinition(spatialEntityDefinition(prop));
  for (const wall of blueprint.walls) prepareMaterializedEntityDefinition({ name: wall.id, description: "An authored structural wall.", type: "object", components: [{ name: "ObjectType", values: { typeId: "structural_wall" } }] });
  assertWorldConstructionAvailable(world, blueprint.rooms.length + blueprint.props.length + blueprint.walls.length);
  const sourceId = source.sourceId;
  const current = () => {
    const now = getCommittedEvents(world);
    return !now.stopped && now.sourceId === sourceId && dependencies.every(room => entityExists(world,room.eid)
      && hasComponent(world,room.eid,Room) && !hasComponent(world,room.eid,Removed) && Name.value[room.eid] === room.name
      && hasComponent(world,room.eid,WorkingMemoryIdentity) && WorkingMemoryIdentity.id[room.eid] === room.key);
  };
  const entry: RecordState = { sourceId, status: "building" };
  installations.set(world, entry);
  const result: SpatialCafeBuildResult = { status: "failed", sourceId, blueprintId: blueprint.id, authority: "operator" };
  try {
    if (!current()) throw new Error("Spatial construction source expired");
    const ids = options.commit(blueprint, current);
    const expected = [...blueprint.rooms, ...blueprint.props, ...blueprint.walls].map(r => r.id);
    if (!ids || expected.some(id => !Number.isSafeInteger(ids[id]) || ids[id] < 0) || Object.keys(ids).length !== expected.length || new Set(Object.values(ids)).size !== expected.length)
      throw new Error("Native cafe commit did not return exact distinct entity bindings");
    result.ids = { ...ids };
    for (const room of blueprint.rooms) {
      const eid = ids[room.id];
      if (!entityExists(world,eid) || !hasComponent(world,eid,Room) || hasComponent(world,eid,Removed) || Name.value[eid] !== room.name) throw new Error("Cafe room binding is not a current native room");
    }
    for (const item of [...blueprint.props, ...blueprint.walls]) {
      const eid = ids[item.id], type = "assetId" in item ? SPATIAL_ASSETS[item.assetId].objectType : "structural_wall", name = "name" in item ? item.name : item.id;
      if (!entityExists(world,eid) || !hasComponent(world,eid,PhysicalObject) || hasComponent(world,eid,Removed) || Name.value[eid] !== name
        || !hasComponent(world,eid,ObjectType) || ObjectType.typeId[eid] !== type || !hasComponent(world,eid,Position)
        || Position.x[eid] !== item.position.x || Position.y[eid] !== item.position.y || getRoomForEntity(world,eid) !== ids[item.roomId])
        throw new Error("Cafe object binding does not match its native placement");
    }
    if (!current()) throw new Error("Spatial construction source expired during commit");
    result.status = "built"; entry.status = "built";
  } catch (error) {
    entry.status = "failed"; result.error = error instanceof Error ? error.message.slice(0,500) : String(error).slice(0,500);
  }
  entry.result = structuredClone(result);
  return result;
}
