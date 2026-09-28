import { addComponent, addEntity, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs } from "../../ecs/prefabs";
import { createEcsTools, createEntityRegistry } from "../../ecs/tools";
import { Agent, Name } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { collectEcsSnapshot } from "../spirit-cognition";

test("spirits see quiet, relocated and carried props without mistaking them for missing entities", () => {
  const world = createArgosWorld("Physical snapshot"); initializePrefabs(world);
  const registry = createEntityRegistry(), ecs = createEcsTools(world, registry);
  const bedroom = ecs.createRoom({ name: "Bedroom" }).result.entityId;
  const landing = ecs.createRoom({ name: "Landing" }).result.entityId;
  const desk = ecs.createObject({ name: "Desk", roomName: "Bedroom" }).result.entityId;
  const phone = ecs.createObject({ name: "Mara's phone", roomName: "Bedroom" }).result.entityId;
  const mara = ecs.createAgent({ name: "Mara", role: "resident", systemPrompt: "Resident", roomName: "Landing" }).result.entityId;
  setLocatedIn(world, phone, desk);
  const rooms = () => collectEcsSnapshot(world, registry).rooms;
  expect(rooms().find(r => r.eid === bedroom)?.objectPlacements).toContainEqual(expect.objectContaining({ eid: phone, name: "Mara's phone", container: "Desk", held: false }));
  setLocatedIn(world, phone, landing);
  expect(rooms().find(r => r.eid === bedroom)?.objects).not.toContain("Mara's phone");
  expect(rooms().find(r => r.eid === landing)?.objects).toContain("Mara's phone");
  setLocatedIn(world, phone, mara);
  expect(rooms().find(r => r.eid === landing)?.objectPlacements).toContainEqual(expect.objectContaining({ eid: phone, name: "Mara's phone", container: "Mara", held: true }));
  expect(ecs.getEntityLocation({ entityName: "Mara's phone" })).toEqual({ success: true, result: {
    entityId: phone, name: "Mara's phone", container: { entityId: mara, name: "Mara" }, room: { entityId: landing, name: "Landing" }, held: true,
  } });
  setLocatedIn(world, mara, bedroom);
  expect(ecs.getEntityLocation({ entityName: "Mara's phone" }).result.room.entityId).toBe(bedroom);
  setLocatedIn(world, mara, landing);
  // Orphaned SoA values are not component membership. Recycled IDs must not hide props.
  Agent.active[phone] = false;
  expect(rooms().find(r => r.eid === landing)?.objects).toContain("Mara's phone");
  delete Agent.active[phone];
  const message = addEntity(world); addComponent(world, message, Name); Name.value[message] = "private verification message";
  setLocatedIn(world, message, phone);
  expect(JSON.stringify(rooms())).not.toContain("private verification");
  removeEntity(world, phone);
  expect(rooms().flatMap(r => r.objects)).not.toContain("Mara's phone");
  expect(ecs.getEntityLocation({ entityName: "Mara's phone" }).success).toBe(false);
});
