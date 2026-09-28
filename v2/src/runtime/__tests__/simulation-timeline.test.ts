import { createArgosWorld } from "../../ecs/world";
import { readSimulationTime } from "../../ecs/simulation-time";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { advanceSimulationTimeline, clearSimulationTimeline, getSimulationBoundary, isSimulationResourceBusy,
  registerSimulationDeadlineProvider, reserveSimulationResources, releaseSimulationResources,
  scheduleSimulationEvent, subscribeSimulationBoundaries } from "../simulation-timeline";

function fixture() {
  const world = createArgosWorld(); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Hall" });
  const eid = createAgentEntity(world, { name: "Ada", role: "person", systemPrompt: "test", roomId: room });
  return { world, eid };
}

test("body and voice reserve independently but two body operations cannot overlap", () => {
  const { world, eid } = fixture();
  expect(reserveSimulationResources(world, eid, "walk", ["body"])).toBe(true);
  expect(reserveSimulationResources(world, eid, "talk", ["voice"])).toBe(true);
  expect(reserveSimulationResources(world, eid, "pickup", ["body"])).toBe(false);
  releaseSimulationResources(world, eid, "walk");
  expect(isSimulationResourceBusy(world, eid, "voice")).toBe(true);
  expect(reserveSimulationResources(world, eid, "pickup", ["body"])).toBe(true);
  clearSimulationTimeline(world);
  expect(isSimulationResourceBusy(world, eid, "body")).toBe(false);
  expect(isSimulationResourceBusy(world, eid, "voice")).toBe(false);
});

test("physical completion precedes same-time speech regardless of insertion order; observers see the committed result", () => {
  const { world } = fixture(), tape: string[] = [], boundaries: number[] = [];
  let inRoom = false;
  scheduleSimulationEvent(world, { atSimMs: 1000, phase: "speech", run: () => tape.push(inRoom ? "heard" : "missed") });
  scheduleSimulationEvent(world, { atSimMs: 1000, phase: "physical", run: () => { inRoom = true; tape.push("arrived"); } });
  subscribeSimulationBoundaries(world, boundary => { boundaries.push(boundary.atSimMs); if (boundary.atSimMs === 1000) expect(tape).toEqual(["arrived", "heard"]); });
  const deltas: number[] = [];
  advanceSimulationTimeline(world, 8000, { integrate: dt => deltas.push(dt) });
  expect(tape).toEqual(["arrived", "heard"]); expect(deltas).toEqual([1000, 7000]);
  expect(boundaries).toEqual([1000, 8000]);
  expect(world.time).toMatchObject({ tick: 1, delta: 8000, elapsed: 8000 });
});

test("external work deadlines partition a coarse frame without replaying or double-advancing time", () => {
  const { world } = fixture(), times: number[] = [];
  let deadline: number | undefined = 1250;
  registerSimulationDeadlineProvider(world, () => deadline);
  advanceSimulationTimeline(world, 5000, { integrate: () => {
    times.push(readSimulationTime(world)); if (readSimulationTime(world) === deadline) deadline = undefined;
  } });
  expect(times).toEqual([1250, 5000]);
  expect(getSimulationBoundary(world)).toMatchObject({ sequence: 2, tick: 1, atSimMs: 5000 });
  expect(getSimulationBoundary(world)).toEqual(getSimulationBoundary(world));
});

test("stop inside a due callback invalidates the frame and every later event", () => {
  const { world } = fixture(), tape: string[] = [];
  scheduleSimulationEvent(world, { atSimMs: 1000, run: () => { tape.push("stop"); clearSimulationTimeline(world); } });
  scheduleSimulationEvent(world, { atSimMs: 1000, run: () => tape.push("bad"), cancel: () => tape.push("cancelled") });
  advanceSimulationTimeline(world, 8000, { integrate: () => {} });
  expect(tape).toEqual(["stop", "cancelled"]); expect(readSimulationTime(world)).toBe(1000);
  advanceSimulationTimeline(world, 1000, { integrate: () => {} });
  expect(tape).toEqual(["stop", "cancelled"]);
});

test("invalid and nested advances cannot mutate the authoritative clock", () => {
  const { world } = fixture();
  for (const delta of [-1, NaN, Infinity]) expect(() => advanceSimulationTimeline(world, delta, { integrate: () => {} })).toThrow();
  expect(world.time.tick).toBe(0); expect(readSimulationTime(world)).toBe(0);
  advanceSimulationTimeline(world, 1000, { integrate: () => {
    expect(() => advanceSimulationTimeline(world, 100, { integrate: () => {} })).toThrow("recursively");
  } });
  expect(readSimulationTime(world)).toBe(1000); expect(world.time.tick).toBe(1);
});

test("shutdown publishes cancellation as a final zero-time boundary before forgetting its observers", () => {
  const { world } = fixture(), tape: string[] = [];
  scheduleSimulationEvent(world, { atSimMs: 5000, run: () => tape.push("never"), cancel: () => tape.push("cancelled") });
  advanceSimulationTimeline(world, 1000, { integrate: () => {} });
  const previous = getSimulationBoundary(world);
  subscribeSimulationBoundaries(world, boundary => {
    expect(tape).toEqual(["cancelled"]);
    expect(boundary).toEqual({ ...previous, sequence: previous.sequence + 1, deltaMs: 0 });
    tape.push("observed");
  });
  clearSimulationTimeline(world); clearSimulationTimeline(world);
  expect(tape).toEqual(["cancelled", "observed"]);
  expect(readSimulationTime(world)).toBe(1000);
});
