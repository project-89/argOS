/** Operator/supervisor telemetry, not ECS state, public events or repair authority.
 * A completed wrapper says nothing about errors swallowed by its child systems. */
import type { World } from "../ecs/world";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedSource } from "./committed-events";

type FastCallback = { name: string };
type Lifecycle = "created" | "running" | "paused" | "stopped";
type ExecutionStatus = "unobserved" | "passing" | "failing";
export interface FastSystemExecutionHealth {
  id: string;
  name: string;
  status: ExecutionStatus;
  attempts: number;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastAttemptTick: number | null;
  lastSuccessTick: number | null;
  lastFailureTick: number | null;
  lastFailureSimMs: number | null;
  lastFailureAt: number | null;
  /** Closed classification only. Raw exception messages can contain private data. */
  lastErrorKind: string | null;
  lastDurationMs: number;
  maxDurationMs: number;
}
export interface FastRuntimeHealthSnapshot {
  runtimeId: string;
  run: number;
  sourceId: string | null;
  sourceCurrent: boolean;
  lifecycle: Lifecycle;
  status: ExecutionStatus;
  observedAt: number;
  observedAtSimMs: number;
  totalSystems: number;
  omittedSystems: number;
  totalFailures: number;
  failingSystems: number;
  unobservedSystems: number;
  systems: FastSystemExecutionHealth[];
}

const MAX_SYSTEMS = 16;
const MAX_RETAINED_STOPPED = 4;
const MAX_REPORTED_RUNTIMES = 4;
const sessions = new WeakMap<World, Array<FastRuntimeHealth | FastRuntimeHealthSnapshot>>();
const errorKind = (error: unknown): string => {
  // Never invoke a thrown object's getters/stringifier or expose its message to
  // author prompts. Detailed exceptions remain in the existing operator log.
  try {
    if (error instanceof SyntaxError) return "SyntaxError";
    if (error instanceof TypeError) return "TypeError";
    if (error instanceof RangeError) return "RangeError";
    if (error instanceof ReferenceError) return "ReferenceError";
    if (error instanceof Error) return "Error";
  } catch { /* hostile thrown proxy */ }
  return "ThrownValue";
};

/** One monitor per native runtime; each restart begins a distinct execution run.
 * Storage is bounded per registered callback, not per tick/error. */
export class FastRuntimeHealth {
  private records = new Map<FastCallback, FastSystemExecutionHealth>();
  private run = 0;
  private sourceId: string | null = null;
  private startedAtSimMs = 0;
  private lifecycle: Lifecycle = "created";

  constructor(private world: World, private runtimeId: string) {}

  register(system: FastCallback): void {
    this.records.set(system, {
      id: this.records.get(system)?.id ?? `${this.runtimeId}/callback:${this.records.size + 1}`, name: system.name.slice(0, 120),
      status: "unobserved", attempts: 0, successes: 0, failures: 0, consecutiveFailures: 0,
      lastAttemptTick: null, lastSuccessTick: null, lastFailureTick: null,
      lastFailureSimMs: null, lastFailureAt: null, lastErrorKind: null,
      lastDurationMs: 0, maxDurationMs: 0,
    });
  }

  start(): void {
    const current = (sessions.get(this.world) ?? []).filter(session => session !== this);
    // Preserve bounded prior-run evidence before resetting counters for a fresh
    // execution epoch. A restart is not retrospective recovery.
    if (this.run > 0) current.push({ ...this.snapshot(), lifecycle: "stopped" });
    this.run++;
    this.sourceId = getCommittedSource(this.world).sourceId;
    this.startedAtSimMs = readSimulationTime(this.world);
    this.lifecycle = "running";
    for (const system of this.records.keys()) this.register(system);
    current.push(this);
    sessions.set(this.world, current);
    this.pruneStopped();
  }

  pause(): void { this.lifecycle = "paused"; }
  resume(): void { this.lifecycle = "running"; }
  stop(): void { this.lifecycle = "stopped"; this.pruneStopped(); }

  private pruneStopped(): void {
    const current = sessions.get(this.world) ?? [];
    const stopped = current.filter(session => {
      if (session instanceof FastRuntimeHealth) return session.lifecycle === "stopped";
      return session.lifecycle === "stopped";
    });
    const remove = new Set(stopped.slice(0, Math.max(0, stopped.length - MAX_RETAINED_STOPPED)));
    sessions.set(this.world, current.filter(session => !remove.has(session)));
  }

  execute(system: FastCallback, tick: number, work: () => void): void {
    if (!this.records.has(system)) this.register(system);
    const record = this.records.get(system)!;
    const began = performance.now();
    record.attempts++;
    record.lastAttemptTick = tick;
    try {
      work();
      record.successes++;
      record.consecutiveFailures = 0;
      record.lastSuccessTick = tick;
      record.status = "passing";
    } catch (error) {
      record.failures++;
      record.consecutiveFailures++;
      record.lastFailureTick = tick;
      record.lastFailureSimMs = readSimulationTime(this.world);
      record.lastFailureAt = Date.now();
      record.lastErrorKind = errorKind(error);
      record.status = "failing";
      throw error;
    } finally {
      record.lastDurationMs = Math.max(0, performance.now() - began);
      record.maxDurationMs = Math.max(record.maxDurationMs, record.lastDurationMs);
    }
  }

  snapshot(): FastRuntimeHealthSnapshot {
    const source = getCommittedSource(this.world);
    const records = [...this.records.values()];
    const failingSystems = records.filter(record => record.status === "failing").length;
    const unobservedSystems = records.filter(record => record.status === "unobserved").length;
    // Show failures first without silently dropping them from the aggregate.
    const order = { failing: 0, unobserved: 1, passing: 2 };
    records.sort((a, b) => order[a.status] - order[b.status]);
    return {
      runtimeId: this.runtimeId, run: this.run, sourceId: this.sourceId,
      sourceCurrent: !source.stopped && source.sourceId === this.sourceId
        && readSimulationTime(this.world) >= this.startedAtSimMs,
      lifecycle: this.lifecycle,
      status: failingSystems ? "failing" : !records.length || unobservedSystems ? "unobserved" : "passing",
      observedAt: Date.now(), observedAtSimMs: readSimulationTime(this.world),
      totalSystems: records.length, omittedSystems: Math.max(0, records.length - MAX_SYSTEMS),
      totalFailures: records.reduce((sum, record) => sum + record.failures, 0),
      failingSystems, unobservedSystems,
      systems: records.slice(0, MAX_SYSTEMS).map(record => ({ ...record })),
    };
  }
}

/** Includes bounded stopped history, labels source freshness, and does not let a
 * second runtime or truncated detail hide active failures in the aggregate. */
export function getWorldRuntimeHealth(world: World) {
  const source = getCommittedSource(world);
  const runtimes = (sessions.get(world) ?? []).map(session => session instanceof FastRuntimeHealth ? session.snapshot() : {
    ...session,
    sourceCurrent: !source.stopped && source.sourceId === session.sourceId
      && readSimulationTime(world) >= session.observedAtSimMs,
    systems: session.systems.map(system => ({ ...system })),
  });
  const active = runtimes.filter(runtime => runtime.sourceCurrent
    && (runtime.lifecycle === "running" || runtime.lifecycle === "paused"));
  const staleActiveRuntimes = runtimes.filter(runtime => !runtime.sourceCurrent
    && (runtime.lifecycle === "running" || runtime.lifecycle === "paused")).length;
  const failingSystems = active.reduce((sum, runtime) => sum + runtime.failingSystems, 0);
  const rank = (runtime: FastRuntimeHealthSnapshot) => active.includes(runtime) ? runtime.failingSystems ? 0 : 1 : 2;
  runtimes.reverse().sort((a, b) => rank(a) - rank(b));
  return {
    observedAt: Date.now(), sourceId: source.sourceId, sourceStopped: source.stopped,
    status: (failingSystems ? "failing" : !active.length ? "unobserved"
      : active.some(runtime => runtime.status === "unobserved") ? "unobserved" : "passing") as ExecutionStatus,
    requiresRuntimeReview: failingSystems > 0 || staleActiveRuntimes > 0 || active.length > 1,
    activeRuntimes: active.length, staleActiveRuntimes, failingSystems,
    totalRuntimes: runtimes.length, omittedRuntimes: Math.max(0, runtimes.length - MAX_REPORTED_RUNTIMES),
    runtimes: runtimes.slice(0, MAX_REPORTED_RUNTIMES),
  };
}

export function formatWorldRuntimeHealth(world: World): string {
  return "NATIVE FAST-LOOP HEALTH (operator-only observations; separate from generated-system health; "
    + "passing means the callback returned, not that its child systems or NPC behavior succeeded; "
    + "stopped/stale runs are history, not current execution; inspect current evidence before repair, "
    + "never synthesize a replacement native controller):\n" + JSON.stringify(getWorldRuntimeHealth(world));
}
