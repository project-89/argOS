/** Author observations, not construction requests. An empty transit space can
 * be complete and useful; inventory counts do not diagnose a missing capability. */
import { Prefab, hasComponent, query } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Room, Name, Description, PhysicalObject, ObjectType, GodAgent, Removed } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";

export function observeRoomInventories(world: World) {
  const valid = (id: number) => ![Prefab, GodAgent, Removed].some(component => hasComponent(world, id, component));
  const rooms = [...query(world, [Room, Name])].filter(valid);
  const observations = rooms.slice(0, 60).map(roomEid => ({ roomEid, roomName: Name.value[roomEid],
    description: Description.value[roomEid] || "", objectCount: 0, occupantCount: 0 }));
  const byRoom = new Map(observations.map(row => [row.roomEid, row]));
  for (const id of query(world, [Name])) {
    if (!valid(id) || hasComponent(world, id, Room)) continue;
    const room = getRoomForEntity(world, id), row = room === undefined ? undefined : byRoom.get(room);
    if (!row) continue;
    if (hasComponent(world, id, Agent)) row.occupantCount++;
    else if (hasComponent(world, id, PhysicalObject) || hasComponent(world, id, ObjectType)) row.objectCount++;
  }
  return { rooms: observations, omittedRooms: Math.max(0, rooms.length - observations.length) };
}
