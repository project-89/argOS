import { jest } from "@jest/globals";
import { addComponent, entityExists, getRelationTargets, hasComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../prefabs";
import { Description, ObjectState, Removed, WorkingMemoryIdentity } from "../components";
import { LocatedIn, OccupiedBy, SittingOn, SleepingOn } from "../relations";
import { getRoomForEntity, setLocatedIn } from "../location";
import { createSystemRegistry } from "../dynamic-systems";
import { ObjectManager } from "../../world/object-manager";
import { executeActions } from "../../cognition/cognition-system";
import { advanceSimulationTimeline, clearSimulationTimeline } from "../../runtime/simulation-timeline";
import { connectRoomRoute, disconnectRoomRoute, enableRoomRouteTopology } from "../../runtime/room-routes";
import { getCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { readObjectStateAge } from "../../world/object-state-time";

const worlds: ReturnType<typeof createArgosWorld>[] = [];
beforeEach(() => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Seating regressions must remain offline"));
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  for (const world of worlds.splice(0)) { clearSimulationTimeline(world); stopCommittedEvents(world); }
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
});
function fixture() {
  const world = createArgosWorld("Seating departure"); worlds.push(world); initializePrefabs(world);
  world.meta.aiEnabled = false; world.meta.timedActions = true;
  const cafe = createRoomEntity(world, { name: "Cafe" }), courtyard = createRoomEntity(world, { name: "Courtyard" });
  const actor = createAgentEntity(world, { name: "Ada", role: "visitor", systemPrompt: "fixture", roomId: cafe });
  const objects = new ObjectManager(world), chair = objects.spawn("chair", { name: "Dry chair", containedIn: cafe })!;
  const registry = createSystemRegistry(); enableRoomRouteTopology(world); connectRoomRoute(world, cafe, courtyard);
  const advance = (ms: number) => advanceSimulationTimeline(world, ms, { integrate: () => {} });
  const move = (target = "Courtyard") => executeActions(world, [{ eid: actor, action: { type: "move", target } }], registry);
  executeActions(world, [{ eid: actor, action: { type: "interact", target: "Dry chair", content: "sit" } }], registry);
  advance(1000);
  expect(getRelationTargets(world, actor, SittingOn)).toEqual([chair]);
  expect(ObjectState.current[chair]).toBe("occupied"); expect(objects.hasTrait(chair, "sittable")).toBe(false);
  return { world, cafe, courtyard, actor, chair, objects, registry, advance, move };
}

test("native timed departure frees the exact chair only at successful movement commit", () => {
  const f = fixture(), chairKey = WorkingMemoryIdentity.id[f.chair];
  const otherSeat = f.objects.spawn("chair", { name: "Someone else's chair", state: "occupied", containedIn: f.cafe })!;
  f.move(); f.advance(2999);
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.cafe);
  expect(getRelationTargets(f.world, f.actor, SittingOn)).toEqual([f.chair]);
  expect(ObjectState.current[f.chair]).toBe("occupied");
  f.advance(1);
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.courtyard);
  expect(getRelationTargets(f.world, f.actor, SittingOn)).toEqual([]);
  expect(WorkingMemoryIdentity.id[f.chair]).toBe(chairKey);
  expect(ObjectState.current[f.chair]).toBe("empty");
  expect(ObjectState.previous[f.chair]).toBe("occupied");
  expect(f.objects.hasTrait(f.chair, "sittable")).toBe(true);
  expect(Description.value[f.chair]).toBe("The chair sits empty.");
  expect(readObjectStateAge(f.world, f.chair)).toBe(0);
  expect(ObjectState.current[otherSeat]).toBe("occupied");
  expect(getCommittedEvents(f.world).events.some(e => e.action === "move" && e.status === "succeeded")).toBe(true);

  const nextActor = createAgentEntity(f.world, { name: "Bea", role: "visitor", systemPrompt: "fixture", roomId: f.cafe });
  executeActions(f.world, [{ eid: nextActor, action: { type: "interact", target: "Dry chair", content: "sit" } }], f.registry);
  f.advance(999);
  expect(getRelationTargets(f.world, nextActor, SittingOn)).toEqual([]);
  expect(ObjectState.current[f.chair]).toBe("empty");
  f.advance(1);
  expect(getRelationTargets(f.world, nextActor, SittingOn)).toEqual([f.chair]);
  expect(getRelationTargets(f.world, f.actor, SittingOn)).toEqual([]);
  expect(ObjectState.current[f.chair]).toBe("occupied");
  expect(f.objects.hasTrait(f.chair, "sittable")).toBe(false);
});

test.each(["cancelled", "route_closed", "destination_removed"])("%s timed departure leaves seating unchanged", kind => {
  const f = fixture(); f.move();
  if (kind === "cancelled") clearSimulationTimeline(f.world);
  if (kind === "route_closed") disconnectRoomRoute(f.world, f.cafe, f.courtyard);
  if (kind === "destination_removed") addComponent(f.world, f.courtyard, Removed);
  f.advance(3000);
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.cafe);
  expect(getRelationTargets(f.world, f.actor, SittingOn)).toEqual([f.chair]);
  expect(ObjectState.current[f.chair]).toBe("occupied");
  expect(f.objects.hasTrait(f.chair, "sittable")).toBe(false);
  expect(getCommittedEvents(f.world).events.some(e => e.action === "move" && e.status === "succeeded")).toBe(false);
});

test("same-room move and identical container assignment do not stand the actor up", () => {
  const f = fixture(); f.move("Cafe"); f.advance(3000); setLocatedIn(f.world, f.actor, f.cafe);
  expect(getRelationTargets(f.world, f.actor, SittingOn)).toEqual([f.chair]);
  expect(ObjectState.current[f.chair]).toBe("occupied");
});

test("an invalid container cannot commit relocation or release the actor's seat", () => {
  const f = fixture(); removeEntity(f.world, f.courtyard);
  setLocatedIn(f.world, f.actor, f.courtyard);
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.cafe);
  expect(getRelationTargets(f.world, f.actor, SittingOn)).toEqual([f.chair]);
  expect(ObjectState.current[f.chair]).toBe("occupied");
});

test("moving an enclosing platform keeps its actor and chair together without ejecting them", () => {
  const f = fixture(), platform = f.objects.spawn("object", { name: "Platform", containedIn: f.cafe })!;
  setLocatedIn(f.world, f.actor, platform); setLocatedIn(f.world, f.chair, platform);
  setLocatedIn(f.world, platform, f.courtyard);
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.courtyard);
  expect(getRoomForEntity(f.world, f.chair)).toBe(f.courtyard);
  expect(getRelationTargets(f.world, f.actor, SittingOn)).toEqual([f.chair]);
  expect(ObjectState.current[f.chair]).toBe("occupied");
});

test("detaching the actor from the physical room is a real departure", () => {
  const f = fixture(); setLocatedIn(f.world, f.actor, undefined);
  expect(getRoomForEntity(f.world, f.actor)).toBeUndefined();
  expect(getRelationTargets(f.world, f.actor, SittingOn)).toEqual([]);
  expect(ObjectState.current[f.chair]).toBe("empty");
});

test.each(["seated", "sleeping", "explicit"])("departure does not free another %s occupant's seat", kind => {
  const f = fixture(), other = createAgentEntity(f.world, { name: "Bea", role: "visitor", systemPrompt: "fixture", roomId: f.cafe });
  // A deliberately inconsistent multi-occupancy fixture must fail conservatively
  // rather than letting one departing actor release someone else's occupation.
  if (kind === "seated") addComponent(f.world, other, SittingOn(f.chair));
  if (kind === "sleeping") addComponent(f.world, other, SleepingOn(f.chair));
  if (kind === "explicit") addComponent(f.world, f.chair, OccupiedBy(other));
  f.move(); f.advance(3000);
  expect(getRelationTargets(f.world, f.actor, SittingOn)).toEqual([]);
  expect(ObjectState.current[f.chair]).toBe("occupied");
  if (kind === "seated") expect(hasComponent(f.world, other, SittingOn(f.chair))).toBe(true);
  if (kind === "sleeping") expect(hasComponent(f.world, other, SleepingOn(f.chair))).toBe(true);
  if (kind === "explicit") expect(hasComponent(f.world, f.chair, OccupiedBy(other))).toBe(true);
});

test("an explicit occupancy relation belonging to this actor is released with their seating", () => {
  const f = fixture(); addComponent(f.world, f.chair, OccupiedBy(f.actor));
  f.move(); f.advance(3000);
  expect(getRelationTargets(f.world, f.actor, SittingOn)).toEqual([]);
  expect(getRelationTargets(f.world, f.chair, OccupiedBy)).toEqual([]);
  expect(ObjectState.current[f.chair]).toBe("empty");
});

test.each(["changed_state", "removed_seat", "seat_moved"])("departure removes stale posture without overwriting %s", kind => {
  const f = fixture();
  if (kind === "changed_state") ObjectState.current[f.chair] = "broken";
  if (kind === "removed_seat") addComponent(f.world, f.chair, Removed);
  if (kind === "seat_moved") setLocatedIn(f.world, f.chair, f.courtyard);
  const prior = ObjectState.current[f.chair]; f.move(); f.advance(3000);
  expect(getRelationTargets(f.world, f.actor, SittingOn)).toEqual([]);
  expect(ObjectState.current[f.chair]).toBe(prior);
});

test.each(["changed_state", "seat_moved"])("departure clears its own reverse occupancy on %s but preserves another sitter", kind => {
  const f = fixture(), other = createAgentEntity(f.world, { name: "Bea", role: "visitor", systemPrompt: "fixture", roomId: f.cafe });
  addComponent(f.world, f.chair, OccupiedBy(f.actor));
  addComponent(f.world, other, SittingOn(f.chair));
  expect(hasComponent(f.world, f.chair, OccupiedBy(f.actor))).toBe(true);
  if (kind === "changed_state") ObjectState.current[f.chair] = "broken";
  if (kind === "seat_moved") setLocatedIn(f.world, f.chair, f.courtyard);
  const prior = ObjectState.current[f.chair]; f.move(); f.advance(3000);
  expect(getRelationTargets(f.world, f.actor, SittingOn)).toEqual([]);
  expect(hasComponent(f.world, f.chair, OccupiedBy(f.actor))).toBe(false);
  expect(hasComponent(f.world, other, SittingOn(f.chair))).toBe(true);
  expect(ObjectState.current[f.chair]).toBe(prior);
});

test.each(["changed_state", "seat_moved"])("departure preserves someone else's exclusive reverse occupancy on %s", kind => {
  const f = fixture(), other = createAgentEntity(f.world, { name: "Bea", role: "visitor", systemPrompt: "fixture", roomId: f.cafe });
  addComponent(f.world, f.chair, OccupiedBy(other));
  if (kind === "changed_state") ObjectState.current[f.chair] = "broken";
  if (kind === "seat_moved") setLocatedIn(f.world, f.chair, f.courtyard);
  const prior = ObjectState.current[f.chair]; f.move(); f.advance(3000);
  expect(getRelationTargets(f.world, f.actor, SittingOn)).toEqual([]);
  expect(hasComponent(f.world, f.chair, OccupiedBy(other))).toBe(true);
  expect(ObjectState.current[f.chair]).toBe(prior);
});

test("deleted chair and reused numeric slot cannot release a replacement object's state", () => {
  const f = fixture(); removeEntity(f.world, f.chair);
  const replacement = f.objects.spawn("chair", { name: "Different chair", state: "occupied", containedIn: f.cafe })!;
  expect(replacement).toBe(f.chair);
  expect(entityExists(f.world, replacement)).toBe(true);
  // bitECS removes the old target's relation when the entity is deleted.
  expect(getRelationTargets(f.world, f.actor, SittingOn)).toEqual([]);
  f.move(); f.advance(3000);
  expect(ObjectState.current[replacement]).toBe("occupied");
  expect(hasComponent(f.world, replacement, LocatedIn(f.cafe))).toBe(true);
});
