import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { withSimulationTask } from "../../runtime/task-scope";
import { setSpiritRegistryActive } from "../spirit-cycle-scope";
import { createSpiritRegistry, createSpirit, getSpiritsNeedingObservation,
  getSpiritObservationTiming, markSpiritObservationCompleted } from "../spirit-registry";

function fixture(managed = true) {
  const world = createArgosWorld("Observation clocks"), registry = createSpiritRegistry(world);
  startCommittedEvents(world); setSpiritRegistryActive(registry, true);
  const spirit = createSpirit(registry, { name: "Clock observer", domain: "narrative", rank: "archangel",
    model: "flash", systemPrompt: "Observe native outcomes.", observationInterval: 25_000 });
  if (managed) advanceSimulationTime(world, 1, 1000);
  const advance = (delta: number) => advanceSimulationTime(world, world.time.tick + 1, delta);
  const due = () => getSpiritsNeedingObservation(registry).includes(spirit);
  return { world, registry, spirit, advance, due, complete: () => markSpiritObservationCompleted(registry, spirit) };
}
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date("2026-09-27T12:00:00Z"));
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("No providers in observation-clock tests"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.useRealTimers(); jest.restoreAllMocks(); });

test("first managed observation is explicit; accelerated simulation determines next due time", () => {
  const f = fixture();
  expect(getSpiritObservationTiming(f.registry, f.spirit)).toMatchObject({ clock: "simulation", firstObservation: true, due: true });
  expect(f.complete()).toBe(true); const wall = f.spirit.lastObservationTime;
  f.advance(24_999); expect(f.due()).toBe(false);
  f.advance(1); expect(f.due()).toBe(true);
  expect(f.spirit.lastObservationTime).toBe(wall);
  expect(getSpiritObservationTiming(f.registry, f.spirit)).toMatchObject({ lastObservationSimMs: 1000, nextDueAtSimMs: 26_000 });
});

test("paused simulation does not age through wall jumps; resume waits remaining simulation duration", () => {
  const f = fixture(); f.complete(); f.advance(10_000);
  jest.setSystemTime(new Date("2027-01-01T12:00:00Z")); expect(f.due()).toBe(false);
  jest.setSystemTime(new Date("2025-01-01T12:00:00Z")); expect(f.due()).toBe(false);
  f.advance(15_000); expect(f.due()).toBe(true);
});

test.each(["source", "registry", "rewind", "replacement"])("%s boundary requires a fresh observation instead of inheriting stale completion", change => {
  const f = fixture(); f.complete(); expect(f.due()).toBe(false);
  if (change === "source") { stopCommittedEvents(f.world); expect(f.due()).toBe(false); startCommittedEvents(f.world); }
  if (change === "registry") {
    setSpiritRegistryActive(f.registry, false); expect(f.due()).toBe(false); expect(f.complete()).toBe(false);
    setSpiritRegistryActive(f.registry, true);
  }
  if (change === "rewind") f.world.time.elapsed = 0;
  if (change === "replacement") {
    const replacement = { ...f.spirit }; f.registry.spirits.set(replacement.eid, replacement);
    expect(getSpiritObservationTiming(f.registry, replacement)).toMatchObject({ firstObservation: true, due: true });
    expect(f.complete()).toBe(false); return;
  }
  expect(f.due()).toBe(true); expect(f.complete()).toBe(true); expect(f.due()).toBe(false);
});

test("specialist sentinel never becomes a first generic observation", () => {
  const f = fixture(); f.spirit.definition.observationInterval = Number.MAX_SAFE_INTEGER;
  expect(f.due()).toBe(false); f.advance(3_600_000); expect(f.due()).toBe(false);
});

test("unmanaged worlds explicitly retain legacy wall cadence; serialized wall marks are not simulation marks", () => {
  const f = fixture(false); f.complete(); expect(f.due()).toBe(false);
  expect(getSpiritObservationTiming(f.registry, f.spirit).clock).toBe("legacy_wall");
  jest.setSystemTime(Date.now() + 25_000); expect(f.due()).toBe(true);
  f.complete(); f.advance(1000);
  expect(getSpiritObservationTiming(f.registry, f.spirit)).toMatchObject({ clock: "simulation", firstObservation: true, due: true });
});

test("stopped or cancelled work cannot write a completion timestamp", async () => {
  const f = fixture(), controller = new AbortController(); controller.abort(Error("stopped"));
  await expect(withSimulationTask(controller.signal, async () => f.complete())).rejects.toThrow("stopped");
  expect(f.spirit.lastObservationTime).toBe(0);
  stopCommittedEvents(f.world); expect(f.complete()).toBe(false); expect(f.spirit.lastObservationTime).toBe(0);
});
