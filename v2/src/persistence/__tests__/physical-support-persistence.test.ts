import { addComponent, addEntity, getRelationTargets, query, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Agent, Name, ObjectState, ObjectType } from "../../ecs/components";
import { LocatedIn, OccupiedBy, OnTopOf, SittingOn, SleepingOn } from "../../ecs/relations";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { getDirectContainer } from "../../ecs/location";
import { executeAffordance } from "../../world/effect-executor";
import { worldSchema } from "../../world/schema";
import { deserializeWorld, serializeWorld } from "../world-persistence";

function fixture() {
  const world = createArgosWorld("Physical support source"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Apartment" });
  const actors = [0, 1].map(() => createAgentEntity(world, { name: "Alex", role: "resident", systemPrompt: "fixture", roomId: room }));
  const chair = createObjectEntity(world, { name: "Seat", roomId: room, traits: ["sittable", "furniture"] });
  const bed = createObjectEntity(world, { name: "Seat", roomId: room, traits: ["sleepable", "furniture"] });
  ObjectType.typeId[chair] = "chair"; ObjectState.current[chair] = "empty";
  ObjectType.typeId[bed] = "bed"; ObjectState.current[bed] = "empty";
  const effect = (actorEid: number, targetEid: number, action: string) => executeAffordance(action, {
    world, actorEid, targetEid, worldSchema,
    registry: { byName: new Map([["Apartment", room]]), byId: new Map() },
  });
  return { world, room, actors, chair, bed, effect };
}
function restored(saved: ReturnType<typeof serializeWorld>) {
  const world = createArgosWorld("Physical support restored"); initializePrefabs(world);
  for (let index = 0; index < 20; index++) addEntity(world);
  return { world, ...deserializeWorld(world, createSystemRegistry(), JSON.parse(JSON.stringify(saved))) };
}

test("actual native sitting and sleeping survive actor/target ID remapping independently of room containment", () => {
  const f = fixture(); expect(f.effect(f.actors[0], f.chair, "sit").success).toBe(true);
  expect(f.effect(f.actors[1], f.bed, "sleep").success).toBe(true);
  expect(ObjectState.current[f.chair]).toBe("occupied"); expect(ObjectState.current[f.bed]).toBe("occupied");
  const saved = serializeWorld(f.world, createSystemRegistry());
  expect(saved.entities.find(e => e.id === f.actors[0])!.relations).toContainEqual({ type: "SittingOn", targetId: f.chair, targetName: "Seat" });
  expect(saved.entities.find(e => e.id === f.actors[1])!.relations).toContainEqual({ type: "SleepingOn", targetId: f.bed, targetName: "Seat" });
  const r = restored(saved), actor = r.oldToNewId.get(f.actors[0])!, sleeper = r.oldToNewId.get(f.actors[1])!;
  const chair = r.oldToNewId.get(f.chair)!, bed = r.oldToNewId.get(f.bed)!, room = r.oldToNewId.get(f.room)!;
  expect(actor).not.toBe(f.actors[0]); expect(chair).not.toBe(f.chair);
  expect(getRelationTargets(r.world, actor, SittingOn)).toEqual([chair]);
  expect(getRelationTargets(r.world, sleeper, SleepingOn)).toEqual([bed]);
  expect(getRelationTargets(r.world, actor, SleepingOn)).toEqual([]);
  expect(getRelationTargets(r.world, sleeper, SittingOn)).toEqual([]);
  expect(getDirectContainer(r.world, actor)).toBe(room); expect(getRelationTargets(r.world, chair, LocatedIn)).toEqual([room]);
  expect(ObjectState.current[chair]).toBe("occupied"); expect(ObjectState.current[bed]).toBe("occupied");
  const again = serializeWorld(r.world, createSystemRegistry());
  expect(again.entities.find(e => e.id === actor)!.relations.find(rel => rel.type === "SittingOn")!.targetId).toBe(chair);
});

test("surface support and explicitly present inverse occupancy links survive without inventing either inverse", () => {
  const f = fixture(); f.effect(f.actors[0], f.chair, "sit");
  addComponent(f.world, f.chair, OccupiedBy(f.actors[0]));
  const cup = createObjectEntity(f.world, { name: "Cup", roomId: f.room }); addComponent(f.world, cup, OnTopOf(f.bed));
  const r = restored(serializeWorld(f.world, createSystemRegistry()));
  expect(getRelationTargets(r.world, r.oldToNewId.get(f.chair)!, OccupiedBy)).toEqual([r.oldToNewId.get(f.actors[0])!]);
  expect(getRelationTargets(r.world, r.oldToNewId.get(cup)!, OnTopOf)).toEqual([r.oldToNewId.get(f.bed)!]);
  expect(getDirectContainer(r.world, r.oldToNewId.get(cup)!)).toBe(r.oldToNewId.get(f.room));
  expect(getRelationTargets(r.world, r.oldToNewId.get(f.bed)!, OccupiedBy)).toEqual([]);
});

test("dangling support and occupant targets are not rebound to a surviving entity with the same name", () => {
  const f = fixture(); f.effect(f.actors[0], f.chair, "sit"); addComponent(f.world, f.chair, OccupiedBy(f.actors[0]));
  const saved = serializeWorld(f.world, createSystemRegistry());
  // Partial recovery retains a relationship record but loses its exact target.
  const missingSupport = { ...saved, entities: saved.entities.filter(e => e.id !== f.chair) };
  const chairGone = restored(missingSupport);
  expect(getRelationTargets(chairGone.world, chairGone.oldToNewId.get(f.actors[0])!, SittingOn)).toEqual([]);
  expect(chairGone.oldToNewId.has(f.bed)).toBe(true); // Same display label is not identity.
  const missingActor = { ...saved, entities: saved.entities.filter(e => e.id !== f.actors[0]) };
  const actorGone = restored(missingActor);
  expect(getRelationTargets(actorGone.world, actorGone.oldToNewId.get(f.chair)!, OccupiedBy)).toEqual([]);
  expect(getRelationTargets(actorGone.world, actorGone.oldToNewId.get(f.actors[1])!, SittingOn)).toEqual([]);
});

test("occupied state alone never fabricates an occupant, and deleted entities are not serialized as support links", () => {
  const f = fixture(); ObjectState.current[f.chair] = "occupied";
  f.effect(f.actors[1], f.bed, "sleep"); removeEntity(f.world, f.bed);
  const saved = serializeWorld(f.world, createSystemRegistry());
  expect(saved.entities.some(e => e.id === f.bed)).toBe(false);
  expect(saved.entities.flatMap(e => e.relations).some(rel => rel.targetId === f.bed)).toBe(false);
  const r = restored(saved), chair = r.oldToNewId.get(f.chair)!;
  // Legacy incomplete evidence remains incomplete: preserve its state value,
  // but never select an arbitrary same-room actor to "explain" that state.
  expect(ObjectState.current[chair]).toBe("occupied");
  expect(getRelationTargets(r.world, chair, OccupiedBy)).toEqual([]);
  for (const actor of query(r.world, [Agent, Name])) {
    expect(getRelationTargets(r.world, actor, SittingOn)).toEqual([]);
    expect(getRelationTargets(r.world, actor, SleepingOn)).toEqual([]);
  }
});
