/** Bind a delayed authoring proposal to the physical places actually observed.
 * A continuing goal can survive travel; its proposed route cannot silently retarget
 * a removed/replaced room or a newly installed movement policy. */
import { entityExists, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Name, Removed, Room, WorkingMemoryIdentity } from "../ecs/components";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { getCommittedEvents } from "../runtime/committed-events";
import { getRoomRouteTopologyGeneration, isRoomRouteTopologyCurrent } from "../runtime/room-routes";
import { readSimulationTime } from "../ecs/simulation-time";
import { getSimulationTaskSignal } from "../runtime/task-scope";
import { materializationRoomDependencies, type MaterializedEntitySpec } from "./entity-materialization";
import type { EntityBlueprint } from "./place-materialization";
import { worldSchema } from "../world/schema";

export function captureEntityMaterializationScope(world: World, observedEntities: readonly number[]) {
  const sourceId = getCommittedEvents(world).sourceId, at = readSimulationTime(world), signal = getSimulationTaskSignal();
  const topology = getRoomRouteTopologyGeneration(world);
  const objectTypes=new Map(worldSchema.getAllObjectTypeIds().map(id=>[id,JSON.stringify(worldSchema.getObjectType(id))]));
  const rooms = new Map(observedEntities.filter(eid => hasComponent(world, eid, Room) && !hasComponent(world, eid, Removed))
    .map(eid => [eid, workingMemoryEntityRef(world, eid)] as const));
  return { bind(spec: EntityBlueprint): () => boolean {
    const dependencies = materializationRoomDependencies(spec), serialized = JSON.stringify(spec);
    if (dependencies.some(eid => !rooms.get(eid))) throw new Error("Entity placement/routes must reference observed rooms");
    const entities:MaterializedEntitySpec[]=[spec,...("contents" in spec ? spec.contents.map(row=>row.entity) : [])];
    const types=entities.filter(e=>e.type === "object").map(e=>e.components.find(c=>c.name === "ObjectType")?.values.typeId).filter(t=>t!==undefined);
    if(types.some(t=>typeof t!=="string" || !objectTypes.has(t))) throw new Error("Object type must have been observed before design");
    return () => {
      const source = getCommittedEvents(world);
      return !!sourceId && !signal?.aborted && !source.stopped && source.sourceId === sourceId && readSimulationTime(world) >= at
        && JSON.stringify(spec) === serialized
        && types.every(t=>objectTypes.get(t as string) === JSON.stringify(worldSchema.getObjectType(t as string)))
        && (!spec.connectToRoomEids?.length || !!topology && getRoomRouteTopologyGeneration(world) === topology && isRoomRouteTopologyCurrent(world))
        && dependencies.every(eid => entityExists(world, eid) && hasComponent(world, eid, Room) && !hasComponent(world, eid, Removed)
          && hasComponent(world, eid, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[eid] === rooms.get(eid)!.key && Name.value[eid] === rooms.get(eid)!.label);
    };
  } };
}
