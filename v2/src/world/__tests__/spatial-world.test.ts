import { jest } from "@jest/globals";
import { addComponent, getRelationTargets, removeEntity, removeComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Agent, ObjectState, Position, Removed, WorkingMemoryIdentity } from "../../ecs/components";
import { getRoomForEntity, setLocatedIn } from "../../ecs/location";
import { SittingOn } from "../../ecs/relations";
import { workingMemoryEntityRef } from "../../cognition/working-memory";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { getCommittedEvents, startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { withSimulationTask } from "../../runtime/task-scope";
import { ObjectManager } from "../object-manager";
import { executeAffordance } from "../effect-executor";
import { worldSchema } from "../schema";
import { createSpatialWorld, type SpatialOutcome } from "../spatial-world";

const adapters: ReturnType<typeof createSpatialWorld>[] = [];
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Spatial tests stay offline")); jest.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { for (const adapter of adapters.splice(0)) adapter.dispose(); expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

function fixture() {
  const world = createArgosWorld("Spatial floor"); initializePrefabs(world); startCommittedEvents(world);
  const first = createRoomEntity(world, { name: "Apartment" }), second = createRoomEntity(world, { name: "Street" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Choose freely", roomId: first });
  const objects = new ObjectManager(world);
  const at = (eid: number, x: number, y: number) => {
    addComponent(world, eid, Position); Position.x[eid] = x; Position.y[eid] = y; Position.z[eid] = 0;
    workingMemoryEntityRef(world, eid); return eid;
  };
  at(first, 3, 3); at(second, 9, 3); at(actor, 2, 3);
  const spatial = createSpatialWorld(world, { bounds: { minX: 0, minY: 0, maxX: 12, maxY: 6 }, speed: 1, cellSize: 0.5, actorRadius: 0.2 });
  adapters.push(spatial);
  spatial.registerRoom(first, { bounds: { minX: 0, minY: 0, maxX: 6, maxY: 6 }, entry: { x: 2, y: 3 } });
  spatial.registerRoom(second, { bounds: { minX: 6, minY: 0, maxX: 12, maxY: 6 }, entry: { x: 10, y: 3 } });
  const obstacle = (name: string, x: number, y: number, halfWidth: number, halfDepth: number) => {
    const eid = at(objects.spawn("object", { name, containedIn: first })!, x, y);
    spatial.registerObstacle(eid, { halfWidth, halfDepth }); return eid;
  };
  // A real wall: only the y=2..4 doorway can connect the two rooms.
  obstacle("North wall", 6, 1, 0.1, 1); obstacle("South wall", 6, 5, 0.1, 1);
  const advance = (ms: number) => { advanceSimulationTime(world, world.time.tick + 1, ms); spatial.advance(); };
  const outcomes: SpatialOutcome[] = [];
  return { world, actor, first, second, objects, at, spatial, obstacle, advance, outcomes, done: (outcome: SpatialOutcome) => outcomes.push(outcome) };
}

test("request does not teleport; source-time movement crosses the real doorway before reporting arrival", () => {
  const f = fixture(); const admission = f.spatial.requestMove(f.actor, f.second, f.done);
  expect(admission).toMatchObject({ ok: true, estimatedMs: 8000 });
  expect(Position.x[f.actor]).toBe(2); expect(getRoomForEntity(f.world, f.actor)).toBe(f.first);
  f.advance(3900); expect(Position.x[f.actor]).toBeCloseTo(5.9); expect(getRoomForEntity(f.world, f.actor)).toBe(f.first);
  expect(f.outcomes).toEqual([]);
  f.advance(200); expect(Position.x[f.actor]).toBeCloseTo(6.1); expect(getRoomForEntity(f.world, f.actor)).toBe(f.second);
  expect(f.outcomes).toEqual([]);
  f.advance(3900); expect(Position.x[f.actor]).toBeCloseTo(10);
  expect(f.outcomes).toEqual([expect.objectContaining({ status: "arrived", reportable: true, completedAtSimMs: 8000 })]);
  f.advance(1000); expect(f.outcomes).toHaveLength(1); expect(getCommittedEvents(f.world).events).toEqual([]);
});

test("simultaneous room arrivals reserve distinct native endpoints and only finish at their selected anchor", () => {
  const f = fixture(), other = f.at(createAgentEntity(f.world, { name: "Bea", role: "visitor", systemPrompt: "Choose", roomId: f.first }), 2, 4);
  expect(f.spatial.requestMove(f.actor, f.second, f.done).ok).toBe(true);
  expect(f.spatial.requestMove(other, f.second, f.done).ok).toBe(true);
  f.advance(7000);
  // The canonical path passes through other room-arrival alternatives. Those
  // coordinates cannot complete this request before its own exact endpoint.
  expect(Position.x[f.actor]).toBeCloseTo(9);
  expect(f.spatial.isAtTarget(f.actor, f.second)).toBe(false);
  f.advance(3000);
  expect(f.outcomes).toHaveLength(2); expect(f.outcomes.every(row => row.status === "arrived")).toBe(true);
  expect(Math.hypot(Position.x[f.actor] - Position.x[other], Position.y[f.actor] - Position.y[other])).toBeGreaterThanOrEqual(.4);
  for (const actor of [f.actor, other]) {
    expect(getRoomForEntity(f.world, actor)).toBe(f.second); expect(f.spatial.isAtTarget(actor, f.second)).toBe(true);
    expect(f.spatial.busy(actor)).toBe(false);
  }
  f.advance(1000); expect(f.outcomes).toHaveLength(2);
});

test.each([true, false])("an existing body reserves physical space even when cognition active=%s", active => {
  const f = fixture(), resident = f.at(createAgentEntity(f.world, { name: "Resident", role: "resident", systemPrompt: "Choose", roomId: f.second }), 10, 3);
  Agent.active[resident] = active;
  expect(f.spatial.movementTargets(f.actor)).toEqual([f.second]);
  expect(f.spatial.requestMove(f.actor, f.second, f.done).ok).toBe(true); f.advance(12000);
  expect(f.outcomes[0]?.status).toBe("arrived");
  expect(Math.hypot(Position.x[f.actor] - 10, Position.y[f.actor] - 3)).toBeGreaterThanOrEqual(.4);
  expect(f.spatial.isAtTarget(f.actor, f.second)).toBe(true);
});

function sharedApproach() {
  const f = fixture(), other = f.at(createAgentEntity(f.world, { name: "Bea", role: "visitor", systemPrompt: "Choose", roomId: f.first }), 2, 4);
  const target = f.at(f.objects.spawn("object", { name: "Desk", containedIn: f.first })!, 5, 3);
  f.spatial.registerTarget(target, { anchors: [{ x: -.5, y: 0 }], reach: .1 });
  return { ...f, other, target };
}

test("one interaction anchor cannot be double booked and cancellation immediately releases its reservation", () => {
  const f = sharedApproach();
  expect(f.spatial.requestApproach(f.actor, f.target, f.done).ok).toBe(true);
  expect(f.spatial.canReach(f.other, f.target)).toBe(true); // Availability is admission, not permanent reachability.
  expect(f.spatial.requestApproach(f.other, f.target, f.done)).toEqual({ ok: false, reason: "no_reachable_anchor" });
  expect(f.spatial.cancel(f.actor)).toBe(true);
  expect(f.spatial.requestApproach(f.other, f.target, f.done).ok).toBe(true); f.advance(5000);
  expect(f.outcomes.map(row => row.status)).toEqual(["cancelled", "arrived"]);
  expect(Position.x[f.other]).toBeCloseTo(4.5); expect(Position.y[f.other]).toBeCloseTo(3);
  expect(f.spatial.requestApproach(f.actor, f.target).ok).toBe(false); // Completed work releases its claim, not its body.
  expect(f.spatial.requestMove(f.other, f.second).ok).toBe(true); f.advance(1000);
  expect(f.spatial.requestApproach(f.actor, f.target).ok).toBe(true);
});

test("authored interaction anchors admit separate bodies but never invent extra anchors", () => {
  const f = sharedApproach(), third = f.at(createAgentEntity(f.world, { name: "Cai", role: "visitor", systemPrompt: "Choose", roomId: f.first }), 2, 2);
  f.spatial.registerTarget(f.target, { anchors: [{ x: -.5, y: 0 }, { x: -.5, y: 1 }], reach: .1 });
  expect(f.spatial.requestApproach(f.actor, f.target, f.done).ok).toBe(true);
  expect(f.spatial.requestApproach(f.other, f.target, f.done).ok).toBe(true);
  expect(f.spatial.requestApproach(third, f.target).ok).toBe(false); f.advance(5000);
  expect(f.outcomes.map(row => row.status)).toEqual(["arrived", "arrived"]);
  expect(Position.x[f.actor]).toBeCloseTo(4.5); expect(Position.y[f.actor]).toBeCloseTo(3);
  expect(Position.x[f.other]).toBeCloseTo(4.5); expect(Position.y[f.other]).toBeCloseTo(4);
});

test("overlapping anchors conflict across different target identities", () => {
  const f = sharedApproach(), target = f.at(f.objects.spawn("object", { name: "Desk lamp", containedIn: f.first })!, 4.5, 3);
  f.spatial.registerTarget(target, { anchors: [{ x: 0, y: 0 }] });
  expect(f.spatial.requestApproach(f.actor, f.target).ok).toBe(true);
  expect(f.spatial.requestApproach(f.other, target).ok).toBe(false);
});

test("a body remaining at a reserved arrival expires a bounded hold without stacking or claiming success", () => {
  const f = sharedApproach(); expect(f.spatial.requestApproach(f.actor, f.target, f.done).ok).toBe(true);
  f.advance(500); f.at(f.other, 4.5, 3); f.advance(5000);
  expect(f.spatial.busy(f.actor)).toBe(true); expect(f.outcomes).toEqual([]);
  expect(Position.x[f.actor]).toBeLessThanOrEqual(4.1);
  const held = Position.x[f.actor];
  for (let i = 0; i < 10; i++) f.spatial.advance(); // Wall-time polling cannot expire a source-time wait.
  expect(f.spatial.busy(f.actor)).toBe(true);
  f.advance(5000);
  expect(Position.x[f.actor]).toBe(held); expect(f.spatial.busy(f.actor)).toBe(false);
  expect(f.outcomes).toEqual([expect.objectContaining({ status: "failed", reason: "arrival_occupied" })]);
  f.advance(5000); expect(f.outcomes).toHaveLength(1);
});

test("a passerby at the destination neither fails a distant trip nor banks travel while the final approach is held", () => {
  const f = sharedApproach(); expect(f.spatial.requestApproach(f.actor, f.target, f.done).ok).toBe(true);
  f.at(f.other, 4.5, 3);
  f.advance(500); expect(Position.x[f.actor]).toBeCloseTo(2.5); expect(f.spatial.busy(f.actor)).toBe(true);
  f.advance(2000); const held = Position.x[f.actor];
  expect(held).toBeLessThanOrEqual(4.1); expect(f.outcomes).toEqual([]);
  f.advance(1000); expect(Position.x[f.actor]).toBe(held);
  f.at(f.other, 4.5, 4); f.advance(100);
  expect(Position.x[f.actor] - held).toBeCloseTo(.1); expect(f.outcomes).toEqual([]);
  f.advance(1000); expect(f.outcomes[0]?.status).toBe("arrived");
  expect(Position.x[f.actor]).toBeCloseTo(4.5);
});

test("one native traveler can cross another's reserved endpoint while its owner is still distant", () => {
  const f = fixture(); f.at(f.actor, 1, 3);
  const other = f.at(createAgentEntity(f.world, { name: "Bea", role: "visitor", systemPrompt: "Choose", roomId: f.second }), 8, 3);
  const target = f.at(f.objects.spawn("object", { name: "Bench", containedIn: f.second })!, 11, 4);
  f.spatial.registerTarget(target, { anchors: [{ x: 0, y: -1 }] });
  expect(f.spatial.requestMove(f.actor, f.second, f.done).ok).toBe(true);
  expect(f.spatial.requestApproach(other, target, f.done).ok).toBe(true);
  for (let i = 0; i < 20; i++) f.advance(100);
  expect(Position.x[other]).toBeCloseTo(10); expect(f.spatial.busy(f.actor)).toBe(true);
  expect(f.outcomes).toEqual([]);
  for (let i = 0; i < 80; i++) f.advance(100);
  expect(f.outcomes.map(row => row.status)).toEqual(["arrived", "arrived"]);
  expect(Position.x[f.actor]).toBeCloseTo(10); expect(Position.x[other]).toBeCloseTo(11);
});

test("cancelling a held final approach immediately releases the destination claim", () => {
  const f = sharedApproach(); expect(f.spatial.requestApproach(f.actor, f.target, f.done).ok).toBe(true);
  f.at(f.other, 4.5, 3); f.advance(3000); expect(f.spatial.busy(f.actor)).toBe(true);
  expect(f.spatial.cancel(f.actor)).toBe(true);
  expect(f.spatial.requestApproach(f.other, f.target, f.done).ok).toBe(true); f.advance(0);
  expect(f.outcomes.map(row => row.status)).toEqual(["cancelled", "arrived"]);
});

test("a cancelled task releases its reservation before the next advancement", async () => {
  const f = sharedApproach(), controller = new AbortController();
  await withSimulationTask(controller.signal, async () => { expect(f.spatial.requestApproach(f.actor, f.target, f.done).ok).toBe(true); });
  controller.abort();
  expect(f.spatial.requestApproach(f.other, f.target, f.done).ok).toBe(true); f.advance(5000);
  expect(f.outcomes).toEqual([expect.objectContaining({ status: "failed", reportable: false }), expect.objectContaining({ status: "arrived", reportable: true })]);
});

test("removed bodies and superseded work cannot hold an interaction reservation", () => {
  const f = sharedApproach(); expect(f.spatial.requestApproach(f.actor, f.target, f.done).ok).toBe(true);
  addComponent(f.world, f.actor, Removed);
  expect(f.spatial.requestApproach(f.other, f.target, f.done).ok).toBe(true); f.advance(5000);
  expect(f.outcomes.map(row => row.status)).toEqual(["failed", "arrived"]);
});

test("source cleanup retires reservations and a fresh adapter does not inherit them", () => {
  const f = sharedApproach(); expect(f.spatial.requestApproach(f.actor, f.target, f.done).ok).toBe(true);
  stopCommittedEvents(f.world); expect(f.spatial.busy(f.actor)).toBe(false); startCommittedEvents(f.world);
  const fresh = createSpatialWorld(f.world, { bounds: { minX: 0, minY: 0, maxX: 6, maxY: 6 }, speed: 1 }); adapters.push(fresh);
  fresh.registerRoom(f.first, { bounds: { minX: 0, minY: 0, maxX: 6, maxY: 6 } });
  fresh.registerTarget(f.target, { anchors: [{ x: -.5, y: 0 }] });
  expect(fresh.requestApproach(f.other, f.target, f.done).ok).toBe(true);
  advanceSimulationTime(f.world, f.world.time.tick + 1, 5000); fresh.advance();
  expect(f.outcomes).toEqual([expect.objectContaining({ status: "cancelled", reportable: false }), expect.objectContaining({ status: "arrived", reportable: true })]);
});

test("blocked/invalid targets fail admission and never free a chair or change position", () => {
  const f = fixture(); f.obstacle("Closed doorway", 6, 3, 0.1, 1);
  expect(f.spatial.canReach(f.actor, f.second)).toBe(false);
  expect(f.spatial.movementTargets(f.actor)).toEqual([]);
  expect(f.spatial.requestMove(f.actor, f.second, f.done)).toMatchObject({ ok: false });
  expect(f.spatial.requestMove(f.actor, 99999, f.done)).toEqual({ ok: false, reason: "invalid_room" });
  expect(f.spatial.busy(f.actor)).toBe(false); expect(Position.x[f.actor]).toBe(2); expect(f.outcomes).toEqual([]);
});

test("deterministic obstacle detour stays collision-free and ends at the same exact anchor", () => {
  const f = fixture(); f.obstacle("Large table", 4, 3, 0.7, 0.7);
  const admission = f.spatial.requestMove(f.actor, f.second, f.done);
  expect(admission.ok).toBe(true); if (admission.ok) expect(admission.estimatedMs).toBeGreaterThan(8000);
  const positions: number[][] = [];
  for (let i = 0; i < 150 && f.spatial.busy(f.actor); i++) {
    f.advance(100); const x = Position.x[f.actor], y = Position.y[f.actor]; positions.push([x, y]);
    expect(x >= 3.1 && x <= 4.9 && y >= 2.1 && y <= 3.9).toBe(false);
  }
  expect(positions.some(([, y]) => y < 2.1 || y > 3.9)).toBe(true);
  expect(f.outcomes[0]?.status).toBe("arrived"); expect(Position.x[f.actor]).toBeCloseTo(10); expect(Position.y[f.actor]).toBeCloseTo(3);
});

test.each([1000, 5000])("cancellation at %sms preserves reached position and truthful room, and cannot later complete", elapsed => {
  const f = fixture(); f.spatial.requestMove(f.actor, f.second, f.done); f.advance(elapsed);
  const x = Position.x[f.actor]; expect(f.spatial.cancel(f.actor)).toBe(true); expect(f.spatial.cancel(f.actor)).toBe(false);
  f.advance(20000); expect(Position.x[f.actor]).toBe(x);
  expect(getRoomForEntity(f.world, f.actor)).toBe(elapsed < 4000 ? f.first : f.second);
  expect(f.outcomes).toEqual([expect.objectContaining({ status: "cancelled", reportable: true })]);
});

test("new obstacle crossing the existing route halts instead of teleporting or silently replanning", () => {
  const f = fixture(); f.spatial.requestMove(f.actor, f.second, f.done); f.advance(1000);
  f.obstacle("New barrier", 4, 3, 0.3, 2.7); f.advance(10000);
  expect(Position.x[f.actor]).toBeLessThan(3.5); expect(getRoomForEntity(f.world, f.actor)).toBe(f.first);
  expect(f.outcomes[0]).toMatchObject({ status: "failed", reason: "path_blocked" });
});

test("native door opening removes its collider and closing blocks an already admitted crossing", () => {
  const f = fixture(), door = f.obstacle("Door", 6, 3, 0.1, 1);
  expect(f.spatial.requestMove(f.actor, f.second).ok).toBe(false);
  expect(f.spatial.unregisterObstacle(door)).toBe(true); expect(f.spatial.unregisterObstacle(door)).toBe(false);
  expect(f.spatial.requestMove(f.actor, f.second, f.done).ok).toBe(true); f.advance(1000);
  f.spatial.registerObstacle(door, { halfWidth: 0.1, halfDepth: 1 }); f.advance(10000);
  expect(Position.x[f.actor]).toBeLessThan(5.7); expect(getRoomForEntity(f.world, f.actor)).toBe(f.first);
  expect(f.outcomes[0]).toMatchObject({ status: "failed", reason: "path_blocked" });
});

test("obstacle removal rejects stale identity and stopped-source authoring", () => {
  const f = fixture(), door = f.obstacle("Door", 6, 3, 0.1, 1);
  WorkingMemoryIdentity.id[door] = "replacement";
  expect(f.spatial.unregisterObstacle(door)).toBe(false);
  f.spatial.registerObstacle(door, { halfWidth: 0.1, halfDepth: 1 });
  stopCommittedEvents(f.world); expect(f.spatial.unregisterObstacle(door)).toBe(false);
});

test.each(["moved", "removed", "identity", "room", "anchors"])("approach cannot execute against a %s target", change => {
  const f = fixture(), target = f.at(f.objects.spawn("object", { name: "Phone", containedIn: f.first })!, 5, 3);
  f.spatial.registerTarget(target, { anchors: [{ x: -0.5, y: 0 }] });
  expect(f.spatial.requestApproach(f.actor, target, f.done).ok).toBe(true); f.advance(500);
  if (change === "moved") Position.y[target] += 0.1;
  if (change === "removed") addComponent(f.world, target, Removed);
  if (change === "identity") WorkingMemoryIdentity.id[target] = "replacement";
  if (change === "room") setLocatedIn(f.world, target, f.second);
  if (change === "anchors") f.spatial.registerTarget(target, { anchors: [{ x: 0, y: 1 }] });
  f.advance(5000); expect(Position.x[f.actor]).toBeCloseTo(2.5);
  expect(f.outcomes[0]).toMatchObject({ status: "failed", reason: "target_changed" });
});

test.each(["identity", "position", "location"])("external actor %s replacement revokes motion without overwriting new state", change => {
  const f = fixture(); f.spatial.requestMove(f.actor, f.second, f.done);
  if (change === "identity") WorkingMemoryIdentity.id[f.actor] = "new-actor";
  if (change === "position") Position.x[f.actor] = 1;
  if (change === "location") setLocatedIn(f.world, f.actor, f.second);
  f.advance(10000); expect(Position.x[f.actor]).toBe(change === "position" ? 1 : 2);
  expect(f.outcomes[0]).toMatchObject({ status: "failed", reportable: change !== "identity" });
});

test("deleted target numeric slot reuse cannot inherit the old target or collider identity", () => {
  const f = fixture(), target = f.at(f.objects.spawn("object", { name: "Phone", containedIn: f.first })!, 5, 3);
  f.spatial.registerTarget(target, { anchors: [{ x: -0.5, y: 0 }] }); f.spatial.requestApproach(f.actor, target, f.done);
  removeEntity(f.world, target);
  const replacement = f.at(f.objects.spawn("object", { name: "Other phone", containedIn: f.first })!, 5, 3);
  expect(replacement).toBe(target); f.advance(3000);
  expect(f.outcomes[0]).toMatchObject({ status: "failed", reason: "target_changed" });
  expect(f.spatial.canReach(f.actor, replacement)).toBe(false);
});

test("source stop cancels once; source restart cannot revive old adapter authority", () => {
  const f = fixture(); f.spatial.requestMove(f.actor, f.second, f.done); stopCommittedEvents(f.world);
  expect(f.outcomes[0]).toMatchObject({ status: "cancelled", reportable: false });
  startCommittedEvents(f.world); f.advance(10000);
  expect(f.spatial.requestMove(f.actor, f.second).ok).toBe(false); expect(Position.x[f.actor]).toBe(2); expect(f.outcomes).toHaveLength(1);
});

test("cancelled native task cannot advance its admitted movement", async () => {
  const f = fixture(), controller = new AbortController();
  await withSimulationTask(controller.signal, async () => { expect(f.spatial.requestMove(f.actor, f.second, f.done).ok).toBe(true); });
  controller.abort(); f.advance(10000); expect(Position.x[f.actor]).toBe(2); expect(f.outcomes[0]?.status).toBe("failed");
  expect(f.outcomes[0]?.reportable).toBe(false);
});

test("disposal revokes movement even inside an aborted task without granting action authority", async () => {
  const f = fixture(), controller = new AbortController();
  await withSimulationTask(controller.signal, async () => {
    expect(f.spatial.requestMove(f.actor, f.second, f.done).ok).toBe(true);
    controller.abort();
    expect(() => f.spatial.dispose()).not.toThrow();
    expect(() => f.spatial.requestMove(f.actor, f.second)).toThrow();
    expect(() => f.spatial.advance()).toThrow();
  });
  expect(f.spatial.busy(f.actor)).toBe(false);
  expect(Position.x[f.actor]).toBe(2); expect(getRoomForEntity(f.world, f.actor)).toBe(f.first);
  expect(f.outcomes).toEqual([expect.objectContaining({ status: "cancelled", reason: "adapter_disposed", reportable: false })]);
  f.spatial.dispose(); f.advance(10000);
  expect(f.outcomes).toHaveLength(1); expect(Position.x[f.actor]).toBe(2);
});

test("time cannot advance ahead of the engine; zero-delta polling and wall time cannot move the actor", () => {
  const f = fixture(); f.spatial.requestMove(f.actor, f.second, f.done);
  expect(() => f.spatial.advance(10000)).toThrow("committed world time");
  for (let i = 0; i < 20; i++) f.spatial.advance();
  expect(Position.x[f.actor]).toBe(2); expect(f.outcomes).toEqual([]);
});

test("interaction anchors stop beside a collider; reach checks are physical, not shared-room proximity", () => {
  const f = fixture(), target = f.at(f.objects.spawn("chair", { name: "Chair", containedIn: f.first })!, 4, 3);
  f.spatial.registerObstacle(target, { halfWidth: 0.4, halfDepth: 0.4 });
  f.spatial.registerTarget(target, { anchors: [{ x: -0.8, y: 0 }], reach: 0.15 });
  expect(f.spatial.isAtTarget(f.actor, target)).toBe(false);
  expect(f.spatial.requestApproach(f.actor, target, f.done).ok).toBe(true); f.advance(1200);
  expect(Position.x[f.actor]).toBeCloseTo(3.2); expect(f.spatial.isAtTarget(f.actor, target)).toBe(true);
  expect(f.outcomes[0]?.status).toBe("arrived");
});

test("native seating is retained until real movement, then another actor can occupy that chair", () => {
  const f = fixture(), chair = f.at(f.objects.spawn("chair", { name: "Chair", containedIn: f.first })!, 2.8, 3);
  f.spatial.registerTarget(chair, { anchors: [{ x: -0.8, y: 0 }] });
  const sit = (actor: number) => executeAffordance("sit", { world: f.world, actorEid: actor, targetEid: chair, worldSchema,
    registry: { byId: new Map(), byName: new Map() } });
  expect(sit(f.actor).success).toBe(true); expect(ObjectState.current[chair]).toBe("occupied");
  f.spatial.requestMove(f.actor, f.first, f.done); f.advance(0); // Already at room anchor: no displacement.
  expect(getRelationTargets(f.world, f.actor, SittingOn)).toEqual([chair]);
  f.spatial.requestMove(f.actor, f.second, f.done); f.spatial.cancel(f.actor);
  expect(getRelationTargets(f.world, f.actor, SittingOn)).toEqual([chair]);
  f.spatial.requestMove(f.actor, f.second, f.done); f.advance(100);
  expect(getRelationTargets(f.world, f.actor, SittingOn)).toEqual([]); expect(ObjectState.current[chair]).toBe("empty");
  const other = f.at(createAgentEntity(f.world, { name: "Bea", role: "visitor", systemPrompt: "Choose", roomId: f.first }), 2, 3);
  expect(f.spatial.isAtTarget(other, chair)).toBe(true); expect(sit(other).success).toBe(true);
  expect(getRelationTargets(f.world, other, SittingOn)).toEqual([chair]); expect(ObjectState.current[chair]).toBe("occupied");
});

function seatedAtCenter() {
  const f = fixture(), chair = f.at(f.objects.spawn("chair", { name: "Physical chair", containedIn: f.first })!, 3, 3);
  f.spatial.registerObstacle(chair, { halfWidth: 0.3, halfDepth: 0.3 });
  f.spatial.registerTarget(chair, { anchors: [{ x: 0, y: 0 }] });
  expect(executeAffordance("sit", { world: f.world, actorEid: f.actor, targetEid: chair, worldSchema,
    registry: { byId: new Map(), byName: new Map() } }).success).toBe(true);
  f.at(f.actor, 3, 3); // The native sit has committed the seated body position.
  return { ...f, chair };
}

test.each(["same_room", "other_room"])("a seated body leaves its own collider through actual %s locomotion", mode => {
  const f = seatedAtCenter(), target = mode === "same_room" ? f.first : f.second;
  expect(f.spatial.requestMove(f.actor, target, f.done).ok).toBe(true);
  expect(getRelationTargets(f.world, f.actor, SittingOn)).toEqual([f.chair]);
  f.advance(100); expect(getRelationTargets(f.world, f.actor, SittingOn)).toEqual([]);
  expect(ObjectState.current[f.chair]).toBe("empty");
  f.advance(10000); expect(f.outcomes[0]?.status).toBe("arrived");
  expect(getRoomForEntity(f.world, f.actor)).toBe(target);
  expect(Position.x[f.actor]).toBeCloseTo(mode === "same_room" ? 2 : 10);
});

test("cancelled mid-seat egress can resume leaving, but another actor cannot inherit the exemption", () => {
  const f = seatedAtCenter(); f.spatial.requestMove(f.actor, f.second, f.done); f.advance(100); f.spatial.cancel(f.actor);
  expect(Position.x[f.actor]).toBeCloseTo(3.1); expect(ObjectState.current[f.chair]).toBe("empty");
  const other = f.at(createAgentEntity(f.world, { name: "Bea", role: "visitor", systemPrompt: "Choose", roomId: f.first }), 2, 3);
  expect(f.spatial.requestApproach(other, f.chair).ok).toBe(false);
  expect(f.spatial.requestMove(f.actor, f.second, f.done).ok).toBe(true); f.advance(10000);
  expect(f.outcomes.map(row => row.status)).toEqual(["cancelled", "arrived"]);
  // Once outside, raw relocation into a collider cannot revive the old grant.
  setLocatedIn(f.world, f.actor, f.first); f.at(f.actor, 3, 3);
  expect(f.spatial.requestMove(f.actor, f.second).ok).toBe(false);
});

test.each(["actor", "seat", "moved_seat"])("a cancelled seat egress never survives %s replacement", change => {
  const f = seatedAtCenter(); f.spatial.requestMove(f.actor, f.second); f.advance(100); f.spatial.cancel(f.actor);
  if (change === "actor") WorkingMemoryIdentity.id[f.actor] = "replacement-actor";
  if (change === "seat") {
    removeEntity(f.world, f.chair);
    const replacement = f.at(f.objects.spawn("chair", { name: "Other chair", containedIn: f.first })!, 3, 3);
    expect(replacement).toBe(f.chair); f.spatial.registerObstacle(replacement, { halfWidth: .3, halfDepth: .3 });
  }
  if (change === "moved_seat") Position.x[f.chair] += .05;
  expect(f.spatial.requestMove(f.actor, f.second).ok).toBe(false);
  expect(Position.x[f.actor]).toBeCloseTo(3.1);
});

test("registration and read probes do not create missing identities or accept unbounded geometry", () => {
  const f = fixture(); removeComponent(f.world, f.actor, WorkingMemoryIdentity);
  expect(f.spatial.canReach(f.actor, f.second)).toBe(false);
  expect(() => f.spatial.registerTarget(f.actor, { anchors: [{ x: 0, y: 0 }] })).toThrow("identity");
  expect(() => createSpatialWorld(f.world, { bounds: { minX: 0, minY: 0, maxX: 1e8, maxY: 1e8 } })).toThrow("unbounded");
});

test("an absent narrow strip of floor cannot be crossed even by a long direct step", () => {
  const f = fixture();
  f.spatial.registerRoom(f.second, { bounds: { minX: 6.01, minY: 0, maxX: 12, maxY: 6 }, entry: { x: 10, y: 3 } });
  expect(f.spatial.canReach(f.actor, f.second)).toBe(false);
});

test("a live collider with a corrupt position blocks admission rather than disappearing", () => {
  const f = fixture(), wall = f.obstacle("Door shutter", 6, 3, 0.1, 1);
  Position.x[wall] = NaN;
  expect(f.spatial.requestMove(f.actor, f.second).ok).toBe(false);
});

test("room geometry must be explicitly reinstalled after its ECS transform changes", () => {
  const f = fixture(); f.spatial.requestMove(f.actor, f.second, f.done);
  Position.x[f.second] += 1; f.advance(1000);
  expect(f.outcomes[0]?.status).toBe("failed"); expect(Position.x[f.actor]).toBe(2);
});

test("a boundary anchor cannot claim arrival in a room the actor has not entered", () => {
  const f = fixture();
  f.spatial.registerRoom(f.second, { bounds: { minX: 6, minY: 0, maxX: 12, maxY: 6 }, entry: { x: 6, y: 3 } });
  expect(f.spatial.requestMove(f.actor, f.second).ok).toBe(false);
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.first);
});

test("one throwing completion cannot strand another actor or replay a completed operation", () => {
  const f = fixture(), other = f.at(createAgentEntity(f.world, { name: "Bea", role: "visitor", systemPrompt: "Choose", roomId: f.second }), 10, 3);
  f.spatial.requestMove(f.actor, f.first, () => { throw Error("Consumer failure"); });
  f.spatial.requestMove(other, f.second, f.done);
  expect(() => f.advance(0)).toThrow("callback failed");
  expect(f.spatial.busy(f.actor)).toBe(false); expect(f.spatial.busy(other)).toBe(false);
  expect(f.outcomes).toHaveLength(1); f.advance(0); expect(f.outcomes).toHaveLength(1);
});

test("source stop clears every actor even if a cancellation consumer throws", () => {
  const f = fixture(), other = f.at(createAgentEntity(f.world, { name: "Bea", role: "visitor", systemPrompt: "Choose", roomId: f.first }), 2, 3);
  f.spatial.requestMove(f.actor, f.second, () => { throw Error("Consumer failure"); });
  f.spatial.requestMove(other, f.second, f.done); stopCommittedEvents(f.world);
  expect(f.spatial.busy(f.actor)).toBe(false); expect(f.spatial.busy(other)).toBe(false);
  expect(f.outcomes).toEqual([expect.objectContaining({ status: "cancelled", reportable: false })]);
});

test("a prior completion callback cannot grant a later callback authority after stopping the source", () => {
  const f = fixture(), other = f.at(createAgentEntity(f.world, { name: "Bea", role: "visitor", systemPrompt: "Choose", roomId: f.second }), 10, 3);
  f.spatial.requestMove(f.actor, f.first, () => stopCommittedEvents(f.world));
  f.spatial.requestMove(other, f.second, f.done); f.advance(0);
  expect(f.outcomes).toEqual([expect.objectContaining({ status: "arrived", reportable: false })]);
});

test("cached destination menus are detached, and native closing/opening invalidates both positive and negative results", () => {
  const f = fixture();
  const menu = f.spatial.movementTargets(f.actor); expect(menu).toEqual([f.second]);
  menu.length = 0; expect(f.spatial.movementTargets(f.actor)).toEqual([f.second]);
  const door = f.obstacle("Cached doorway", 6, 3, .1, 1);
  expect(f.spatial.movementTargets(f.actor)).toEqual([]);
  expect(f.spatial.requestMove(f.actor, f.second).ok).toBe(false);
  expect(f.spatial.unregisterObstacle(door)).toBe(true);
  expect(f.spatial.movementTargets(f.actor)).toEqual([f.second]);
  expect(f.spatial.requestMove(f.actor, f.second).ok).toBe(true);
  f.spatial.registerObstacle(door, { halfWidth: .1, halfDepth: 1 });
  f.advance(10000); expect(Position.x[f.actor]).toBeLessThan(5.7);
});

test("cached geometry observes raw ECS obstacle transforms, corruption and identity replacement without a registration hook", () => {
  const f = fixture(), door = f.obstacle("Moving shutter", 6, 10, .1, 1);
  expect(f.spatial.movementTargets(f.actor)).toEqual([f.second]);
  Position.y[door] = 3;
  expect(f.spatial.movementTargets(f.actor)).toEqual([]);
  Position.y[door] = 10;
  expect(f.spatial.movementTargets(f.actor)).toEqual([f.second]);
  Position.x[door] = NaN;
  expect(f.spatial.movementTargets(f.actor)).toEqual([]);
  Position.x[door] = 6; Position.y[door] = 3;
  WorkingMemoryIdentity.id[door] = "a-different-physical-object";
  expect(f.spatial.movementTargets(f.actor)).toEqual([f.second]); // Retired collider is not inherited.
  f.spatial.registerObstacle(door, { halfWidth: .1, halfDepth: 1 });
  expect(f.spatial.movementTargets(f.actor)).toEqual([]);
  addComponent(f.world, door, Removed);
  expect(f.spatial.movementTargets(f.actor)).toEqual([f.second]);
});

test("cached destinations cannot survive room entry changes or missing room geometry", () => {
  const f = fixture(); expect(f.spatial.movementTargets(f.actor)).toEqual([f.second]);
  f.spatial.registerRoom(f.second, { bounds: { minX: 6, minY: 0, maxX: 12, maxY: 6 }, entry: { x: 6, y: 1 } });
  expect(f.spatial.movementTargets(f.actor)).toEqual([]); // Entry is inside the wall.
  f.spatial.registerRoom(f.second, { bounds: { minX: 6, minY: 0, maxX: 12, maxY: 6 }, entry: { x: 10, y: 3 } });
  expect(f.spatial.movementTargets(f.actor)).toEqual([f.second]);
  Position.x[f.second] += 1;
  expect(f.spatial.movementTargets(f.actor)).toEqual([]);
});

test("cached menus still validate the live actor, exact physical position, and source", () => {
  const f = fixture(); expect(f.spatial.movementTargets(f.actor)).toEqual([f.second]);
  Agent.active[f.actor] = false; expect(f.spatial.movementTargets(f.actor)).toEqual([]);
  Agent.active[f.actor] = true;
  Position.x[f.actor] = 6; Position.y[f.actor] = 1;
  expect(f.spatial.movementTargets(f.actor)).toEqual([]);
  f.at(f.actor, 2, 3); expect(f.spatial.movementTargets(f.actor)).toEqual([f.second]);
  stopCommittedEvents(f.world); startCommittedEvents(f.world);
  expect(f.spatial.movementTargets(f.actor)).toEqual([]);
});

test("cached seat-egress geometry does not grant an exemption to another actor or an unseated relocation", () => {
  const f = seatedAtCenter();
  expect(f.spatial.movementTargets(f.actor)).toEqual([f.second]);
  const other = f.at(createAgentEntity(f.world, { name: "Unseated neighbor", role: "resident", systemPrompt: "Choose", roomId: f.first }), 3, 3);
  expect(f.spatial.movementTargets(other)).toEqual([]);
  expect(f.spatial.requestMove(f.actor, f.second).ok).toBe(true);
  f.advance(2000); f.spatial.cancel(f.actor);
  expect(f.spatial.movementTargets(f.actor)).toEqual([f.second]);
  f.at(f.actor, 3, 3);
  expect(f.spatial.movementTargets(f.actor)).toEqual([]);
});
