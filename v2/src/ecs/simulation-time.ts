import type { World } from "./world";

const managedClocks = new WeakSet<World>();
const DAY_MS = 86_400_000;

export interface SimulationTimeSnapshot {
  readonly tick: number;
  readonly elapsedMs: number;
  readonly deltaMs: number;
  readonly hour: number;
  readonly day: number;
  readonly phase: string;
}

/** Authoritative elapsed in-world milliseconds, never a wall-clock timestamp. */
export function readSimulationTime(world: World): number {
  return world.time.elapsed;
}

/** Whether this world has been stepped through the authoritative clock. */
export function hasSimulationClock(world: World): boolean {
  return managedClocks.has(world);
}

export function validateSimulationDelta(deltaMs: number): number {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    throw new RangeError("Simulation delta must be a finite, non-negative number of milliseconds");
  }
  return deltaMs;
}

export function validateTimeScale(timeScale: number): number {
  if (!Number.isFinite(timeScale) || timeScale <= 0) {
    throw new RangeError("Simulation timeScale must be finite and greater than zero; use pause to stop time");
  }
  return timeScale;
}

export function simulationDayPhase(hour: number): string {
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 12) return "morning";
  if (hour >= 12 && hour < 14) return "midday";
  if (hour >= 14 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 21) return "evening";
  return "night";
}

/** Calendar display only. Never advances time or rounds into a future minute. */
export function formatSimulationHour(hour: number): string {
  if (!Number.isFinite(hour) || hour < 0 || hour >= 24) return "unknown";
  const minutes = Math.min(1439, Math.floor(hour * 60 + 1e-9));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * Commit exactly one deterministic clock step. The caller supplies an already
 * scaled in-world delta: model latency and renderer latency must not enter it.
 * Validation precedes every mutation, including the tick counter.
 */
export function advanceSimulationTime(world: World, tick: number, deltaMs: number): void {
  validateSimulationDelta(deltaMs);
  if (!Number.isSafeInteger(tick) || tick <= world.time.tick) {
    throw new RangeError("Simulation tick must be a safe integer greater than the current tick");
  }
  const elapsed = readSimulationTime(world) + deltaMs;
  const calendarMs = world.time.simulationHour * 3_600_000 + deltaMs;
  const day = world.time.simulationDay + Math.floor(calendarMs / DAY_MS);
  if (!Number.isFinite(elapsed) || !Number.isFinite(calendarMs) || !Number.isSafeInteger(day)) {
    throw new RangeError("Simulation clock overflow");
  }
  world.time.tick = tick;
  world.time.delta = deltaMs;
  world.time.elapsed = elapsed;
  world.time.simulationHour = (calendarMs % DAY_MS) / 3_600_000;
  world.time.simulationDay = day;
  world.time.timeOfDay = simulationDayPhase(world.time.simulationHour);
  managedClocks.add(world);
}

/** Internal clock transaction for a shared timeline's exact sub-tick boundaries.
 * The public advanceSimulationTime still rejects duplicate ticks. A frame may
 * split one logical tick into several monotonic physical segments, then expose
 * the total committed delta when closed. */
export function beginSimulationTimeFrame(world: World, tick: number) {
  const start = readSimulationTime(world);
  advanceSimulationTime(world, tick, 0);
  let closed = false;
  return {
    advance(deltaMs: number) {
      if (closed || world.time.tick !== tick) throw new Error("Simulation clock frame is no longer current");
      validateSimulationDelta(deltaMs);
      const elapsed = readSimulationTime(world) + deltaMs;
      const calendarMs = world.time.simulationHour * 3_600_000 + deltaMs;
      const day = world.time.simulationDay + Math.floor(calendarMs / DAY_MS);
      if (!Number.isFinite(elapsed) || !Number.isFinite(calendarMs) || !Number.isSafeInteger(day)) throw new RangeError("Simulation clock overflow");
      world.time.elapsed = elapsed; world.time.delta = deltaMs;
      world.time.simulationHour = (calendarMs % DAY_MS) / 3_600_000;
      world.time.simulationDay = day; world.time.timeOfDay = simulationDayPhase(world.time.simulationHour);
    },
    close() { if (!closed) { world.time.delta = readSimulationTime(world) - start; closed = true; } },
  };
}

/** Snapshot suitable for recording/projection; timestamps elsewhere remain wall time. */
export function getSimulationTimeSnapshot(world: World): SimulationTimeSnapshot {
  return Object.freeze({
    tick: world.time.tick,
    elapsedMs: world.time.elapsed,
    deltaMs: world.time.delta,
    hour: world.time.simulationHour,
    day: world.time.simulationDay,
    phase: world.time.timeOfDay,
  });
}
