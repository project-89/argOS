import { jest } from "@jest/globals";
import { entityExists, hasComponent } from "bitecs";
import { SpatialDemo } from "../spatial-demo";
import { TOWN_RESIDENTS, TOWN_SPATIAL_BLUEPRINT } from "../spatial-town";
import { Agent, Needs, Perception, PhysicalObject, Position, WorkingMemoryIdentity } from "../../ecs/components";
import { getDirectContainer, getRoomForEntity } from "../../ecs/location";
import { getAspirations } from "../../cognition/goal-learning";
import { getAgentPerceptions } from "../../cognition/agent-mind";
import { getPrivateCommunications } from "../../cognition/communication-memory";
import { getCommittedEvents } from "../../runtime/committed-events";

// These are operator-directed mechanics checks, not evidence of autonomous town
// behavior or crowd avoidance. Keep worlds sequential: ECS arrays are shared.
let d: SpatialDemo | undefined;
beforeEach(async () => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Town runtime checks are offline"));
  d = await SpatialDemo.create({ scenario: "town", live: false, automaticClock: false });
});
afterEach(() => {
  d?.stop(); d = undefined;
  expect(globalThis.fetch).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});
const demo = () => d!;
const actor = (name: string) => demo().snapshot().actors.find(a => a.name === name)!;
const room = (id: string) => demo().snapshot().rooms.find(r => r.id === demo().byId.get(id))!;
const prop = (id: string) => demo().snapshot().entities.find(e => e.id === demo().byId.get(id))!;
const position = (id: number) => ({ x: Position.x[id], y: Position.y[id] });
const livePhysicalIdentity = (id: number, key: string) => entityExists(demo().sim.world, id)
  && hasComponent(demo().sim.world, id, PhysicalObject)
  && hasComponent(demo().sim.world, id, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[id] === key;
const movementEvents = () => getCommittedEvents(demo().sim.world).events.filter(e => e.kind === "action" && e.action === "move");
// The larger authored footprint changes distance, not the simulated walking
// rate. This is a finite motor deadline, not an autonomous behavior gate.
const advanceJourneys = (actors: readonly number[], maxMs = 60_000) => {
  for (let elapsed = 0; elapsed < maxMs && actors.some(id => demo().spatial.busy(id)); elapsed += 100) demo().advance(100);
  expect(actors.every(id => !demo().spatial.busy(id))).toBe(true);
};

test("authored town wires ten distinct native residents, eight rooms, needs and aspirations", async () => {
  const state = demo().snapshot(), world = demo().sim.world;
  expect(state.actors).toHaveLength(10); expect(demo().actors).toHaveLength(10);
  expect(state.rooms).toHaveLength(8); expect(state.rooms).toHaveLength(TOWN_SPATIAL_BLUEPRINT.rooms.length);
  const publicKeys = [...state.actors, ...state.rooms].map(e => e.key);
  expect(new Set(publicKeys).size).toBe(publicKeys.length);
  expect(state).toMatchObject({ mode: "manual", scenario: { id: "town" }, limits: { ai: false, autonomousGrowth: false } });
  for (const resident of TOWN_RESIDENTS) {
    const a = actor(resident.name), spawn = TOWN_SPATIAL_BLUEPRINT.spawns.find(s => s.id === resident.id)!;
    expect(entityExists(world, a.id) && hasComponent(world, a.id, Agent)).toBe(true);
    expect(Agent.active[a.id]).toBe(true);
    expect(WorkingMemoryIdentity.id[a.id]).toBe(a.key);
    expect(a.needs).toEqual(resident.needs);
    expect(a.canText).toBe(!!resident.phoneId);
    expect(getAspirations(world, a.id)).toEqual(resident.aspirations);
    expect(getRoomForEntity(world, a.id)).toBe(demo().byId.get(resident.startRoomId));
    expect(position(a.id)).toEqual(spawn.position);
    expect(a.goals?.some(g => g.description === resident.initialGoal.description)).toBe(true);
  }
  await demo().start();
  const initial = demo().actors.map(id => ({ id, ...position(id), room: getRoomForEntity(world, id) }));
  demo().advance(1000);
  expect(demo().actors.map(id => ({ id, ...position(id), room: getRoomForEntity(world, id) }))).toEqual(initial);
  expect(getCommittedEvents(world).events.filter(e => e.status === "succeeded")).toHaveLength(0);
});

test("a shared-place trip crosses actual outdoor entrances without teleporting", async () => {
  await demo().start();
  const a = actor("Mara"), destination = room("town-cafe"), world = demo().sim.world;
  const start = position(a.id), sourceRoom = getRoomForEntity(world, a.id), visited = new Set([sourceRoom]);
  demo().dispatch(a.key, "move", destination.key);
  expect(position(a.id)).toEqual(start);
  expect(getRoomForEntity(world, a.id)).toBe(sourceRoom);
  expect(movementEvents().filter(e => e.status === "succeeded")).toHaveLength(0);
  demo().advance(100);
  expect(position(a.id)).not.toEqual(start);
  expect(Math.hypot(Position.x[a.id] - start.x, Position.y[a.id] - start.y)).toBeLessThanOrEqual(.125 + 1e-8);
  expect(getRoomForEntity(world, a.id)).toBe(sourceRoom);
  expect(demo().spatial.busy(a.id)).toBe(true);
  const crossings: Array<{ from: number | undefined; to: number | undefined; before: ReturnType<typeof position>; after: ReturnType<typeof position> }> = [];
  for (let step = 0; step < 600 && demo().spatial.busy(a.id); step++) {
    const before = position(a.id), from = getRoomForEntity(world, a.id);
    demo().advance(100);
    const after = position(a.id), to = getRoomForEntity(world, a.id);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThanOrEqual(.125 + 1e-8);
    visited.add(to);
    if (from !== to) crossings.push({ from, to, before, after });
  }
  expect(visited).toContain(demo().byId.get("common-square"));
  expect(getRoomForEntity(world, a.id)).toBe(destination.id);
  expect(demo().spatial.isAtTarget(a.id, destination.id)).toBe(true);
  const completed = movementEvents().filter(e => e.actorKey === a.key && e.status === "succeeded");
  expect(completed).toHaveLength(1);
  expect(completed[0]).toMatchObject({ sourceId: demo().sourceId, targetKey: destination.key, roomId: destination.id });
  expect(completed[0].completedAtSimMs!).toBeGreaterThan(completed[0].startedAtSimMs!);
  expect(crossings.map(c => c.to)).toEqual([demo().byId.get("common-square"), destination.id]);
  expect(TOWN_SPATIAL_BLUEPRINT.rooms.find(r => r.id === "common-square")?.environment).toBe("outdoor");
  for (const crossing of crossings) {
    const door = TOWN_SPATIAL_BLUEPRINT.doors.find(door =>
      demo().byId.get(door.from) === crossing.from && demo().byId.get(door.to) === crossing.to
      || demo().byId.get(door.to) === crossing.from && demo().byId.get(door.from) === crossing.to)!;
    expect(door).toBeDefined();
    const axis = door.axis, lateral = axis === "x" ? "y" : "x";
    const span = crossing.after[axis] - crossing.before[axis];
    expect(Math.abs(span)).toBeGreaterThan(0);
    const fraction = (door.position[axis] - crossing.before[axis]) / span;
    expect(fraction).toBeGreaterThanOrEqual(-1e-8); expect(fraction).toBeLessThanOrEqual(1 + 1e-8);
    const crossedAt = crossing.before[lateral] + fraction * (crossing.after[lateral] - crossing.before[lateral]);
    expect(Math.abs(crossedAt - door.position[lateral])).toBeLessThanOrEqual(door.width / 2 + 1e-8);
  }
  // Re-entering a home is native travel too, not restoring its authored spawn.
  demo().dispatch(a.key, "move", room("willow-house").key);
  const atCafe = position(a.id); expect(getRoomForEntity(world, a.id)).toBe(destination.id);
  demo().advance(100);
  expect(Math.hypot(Position.x[a.id] - atCafe.x, Position.y[a.id] - atCafe.y)).toBeLessThanOrEqual(.125 + 1e-8);
  advanceJourneys([a.id]);
  expect(getRoomForEntity(world, a.id)).toBe(sourceRoom);
  expect(demo().spatial.isAtTarget(a.id, sourceRoom!)).toBe(true);
  expect(movementEvents().filter(e => e.actorKey === a.key && e.status === "succeeded")).toHaveLength(2);
});

test("two residents competing for the last finite pastry cannot duplicate consumption", async () => {
  await demo().start();
  const world = demo().sim.world, cafe = room("town-cafe");
  const food = [1, 2, 3, 4].map(n => prop(`cafe-pastry-${n}`));
  expect(demo().snapshot().entities.filter(e => e.asset === "food")).toHaveLength(4);
  const firstDiners = [actor("Ada"), actor("Ivo"), actor("Eli")];
  for (const diner of firstDiners) demo().dispatch(diner.key, "move", cafe.key);
  advanceJourneys(firstDiners.map(a => a.id));
  for (const [i, diner] of firstDiners.entries()) {
    expect(getRoomForEntity(world, diner.id)).toBe(cafe.id);
    demo().dispatch(diner.key, "interact", food[i].key, "eat");
  }
  demo().advance(20_000);
  expect(food.slice(0, 3).every(f => !livePhysicalIdentity(f.id, f.key))).toBe(true);
  const last = food[3]; expect(livePhysicalIdentity(last.id, last.key)).toBe(true);
  // This is a custody race, not permission for two bodies to share one slot.
  // Author opposite sides of the table so both physical approaches can finish
  // before the native eat timers race over the same finite portion.
  demo().spatial.registerTarget(last.id, { anchors: [{ x: 0, y: 1 }, { x: 0, y: -1 }] });
  const contenders = [actor("Tess"), actor("Ivo")], hunger = contenders.map(a => Needs.hunger[a.id]);
  for (const diner of contenders) demo().dispatch(diner.key, "interact", last.key, "eat");
  const admitted = getCommittedEvents(world).events.filter(e => e.targetKey === last.key && e.status === "pending");
  expect(admitted).toHaveLength(2);
  demo().advance(100);
  expect(livePhysicalIdentity(last.id, last.key)).toBe(true);
  expect(contenders.every((a, i) => Needs.hunger[a.id] >= hunger[i])).toBe(true);
  demo().advance(20_000);
  expect(food.every(f => !livePhysicalIdentity(f.id, f.key))).toBe(true);
  expect(demo().snapshot().entities.filter(e => e.asset === "food")).toHaveLength(0);
  const outcomes = getCommittedEvents(world).events.filter(e => e.targetKey === last.key && e.status !== "pending");
  expect(outcomes.filter(e => e.status === "succeeded")).toHaveLength(1);
  expect(outcomes.filter(e => e.status === "failed")).toHaveLength(1);
  const fed = contenders.filter((a, i) => Needs.hunger[a.id] < hunger[i] - 20);
  expect(fed).toHaveLength(1);
  expect(outcomes.find(e => e.status === "succeeded")?.actorKey).toBe(fed[0].key);
  demo().advance(12_000);
  expect(food.every(f => !livePhysicalIdentity(f.id, f.key))).toBe(true);
  expect(demo().snapshot().entities.filter(e => e.asset === "food")).toHaveLength(0);
  expect(getCommittedEvents(world).events.filter(e => e.targetKey === last.key && e.status === "succeeded")).toHaveLength(1);
});

test("ten simultaneous native routes keep identities, source and completion times intact", async () => {
  await demo().start();
  const destinations = ["common-square", "town-cafe", "town-workshop", "town-garden"].map(room);
  const trips = demo().snapshot().actors.map((a, i) => ({ actor: a,
    target: destinations.slice(i % destinations.length).concat(destinations.slice(0, i % destinations.length))
      .find(r => r.id !== getRoomForEntity(demo().sim.world, a.id))! }));
  for (const trip of trips) demo().dispatch(trip.actor.key, "move", trip.target.key);
  expect(movementEvents().filter(e => e.status === "pending")).toHaveLength(10);
  expect(demo().actors.filter(id => demo().spatial.busy(id))).toHaveLength(10);
  advanceJourneys(trips.map(t => t.actor.id));
  const completed = movementEvents().filter(e => e.status === "succeeded");
  expect(completed).toHaveLength(10);
  expect(new Set(completed.map(e => e.executionId)).size).toBe(10);
  expect(movementEvents().filter(e => e.status === "failed")).toHaveLength(0);
  for (const trip of trips) {
    expect(getRoomForEntity(demo().sim.world, trip.actor.id)).toBe(trip.target.id);
    const event = completed.find(e => e.actorKey === trip.actor.key)!;
    expect(event).toMatchObject({ sourceId: demo().sourceId, actorId: trip.actor.id, targetKey: trip.target.key, roomKey: trip.target.key });
    expect(event.completedAtSimMs!).toBeGreaterThan(event.startedAtSimMs!);
    expect(event.completedAtSimMs!).toBeLessThanOrEqual(demo().atSimMs);
    expect(WorkingMemoryIdentity.id[trip.actor.id]).toBe(trip.actor.key);
    expect(demo().spatial.busy(trip.actor.id)).toBe(false);
  }
});

test("a private phone message remains unread and absent from remote cognition and public output", async () => {
  await demo().start();
  const owner = actor("Mara"), local = actor("Ivo"), remote = actor("Bea"), world = demo().sim.world;
  const secret = "TOWN_PRIVATE_MESSAGE_8237", messageId = demo().text(owner.key, secret);
  const perception = (id: number) => getAgentPerceptions(world, id).map(p => Perception.content[p]).join("\n");
  expect(perception(local.id)).toContain("Mara's phone makes its familiar double vibration");
  expect(perception(remote.id)).not.toContain("Mara's phone makes its familiar double vibration");
  expect(actor("Mara")).toMatchObject({ unread: 1, messages: [expect.objectContaining({ id: messageId, text: secret, status: "delivered" })] });
  for (const a of demo().snapshot().actors) {
    expect(getPrivateCommunications(world, a.id)).toHaveLength(0);
    expect(perception(a.id)).not.toContain(secret);
    if (a.id !== owner.id) expect(a.messages).toHaveLength(0);
  }
  const publicProjection = () => { const state = demo().snapshot(); return JSON.stringify({ rooms: state.rooms,
    entities: state.entities, events: state.events, cues: state.cues, committed: getCommittedEvents(world).events }); };
  expect(publicProjection()).not.toContain(secret);
  demo().advance(13_000);
  expect(actor("Mara").unread).toBe(1);
  expect(getPrivateCommunications(world, remote.id)).toHaveLength(0);
  expect(publicProjection()).not.toContain(secret);
  const phone = prop("mara-phone");
  demo().dispatch(owner.key, "pickup", phone.key); demo().advance(20_000);
  expect(getDirectContainer(world, phone.id)).toBe(owner.id);
  demo().dispatch(owner.key, "interact", phone.key, "read_phone"); demo().advance(1200);
  expect(actor("Mara").unread).toBe(0);
  expect(getPrivateCommunications(world, owner.id).some(row => row.content.includes(secret))).toBe(true);
  expect(getPrivateCommunications(world, remote.id)).toHaveLength(0);
  expect(perception(remote.id)).not.toContain(secret);
  expect(publicProjection()).not.toContain(secret);
});

test("town growth stays gated before and after startup without substituting an authored expansion", async () => {
  const physicalKeys = () => demo().snapshot().entities.map(e => e.key).sort();
  const initial = physicalKeys(), initialRooms = demo().snapshot().rooms;
  expect(() => demo().grow()).toThrow(/Start the world first/);
  await demo().start();
  expect(() => demo().grow()).toThrow(/construction is gated/);
  demo().advance(1000);
  expect(() => demo().grow()).toThrow(/construction is gated/);
  expect(physicalKeys()).toEqual(initial);
  expect(demo().snapshot().rooms).toEqual(initialRooms);
  expect(demo().snapshot()).toMatchObject({ growth: { status: "gated" }, limits: { autonomousGrowth: false } });
});

test("stopping the source cancels pending journeys without late arrivals or successful receipts", async () => {
  await demo().start();
  const movers = [actor("Mara"), actor("Ivo")], target = room("town-garden"), world = demo().sim.world;
  for (const a of movers) demo().dispatch(a.key, "move", target.key);
  demo().advance(100);
  expect(movers.every(a => demo().spatial.busy(a.id))).toBe(true);
  const locations = movers.map(a => ({ id: a.id, ...position(a.id), room: getRoomForEntity(world, a.id) }));
  demo().stop();
  expect(movers.every(a => !demo().spatial.busy(a.id))).toBe(true);
  expect(getCommittedEvents(world).stopped).toBe(true);
  expect(movementEvents().filter(e => e.status === "succeeded")).toHaveLength(0);
  expect(movementEvents().filter(e => e.status === "failed")).toHaveLength(2);
  expect(movementEvents().every(e => e.sourceId === demo().sourceId)).toBe(true);
  expect(() => demo().advance(40_000)).toThrow(/active non-live session/);
  expect(demo().spatial.requestMove(movers[0].id, target.id).ok).toBe(false);
  expect(movers.map(a => ({ id: a.id, ...position(a.id), room: getRoomForEntity(world, a.id) }))).toEqual(locations);
  expect(movementEvents().filter(e => e.status === "succeeded")).toHaveLength(0);
});
