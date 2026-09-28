/** Process-isolated library entry point. IPC carries values, never live ECS refs. */
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { ArgosSimulation, SimulationConfig, SimulationStats } from "../index";
import type { SerializedWorld } from "../persistence/world-persistence";
import type { ComponentDefinition } from "../ecs/dynamic-components";
import { validateSimulationSnapshot } from "../persistence/simulation-snapshot";
import type { SystemHealthReport } from "../ecs/dynamic-systems";

export interface SimulationHostHealth {
  pid: number;
  stats: SimulationStats;
  systems: SystemHealthReport[];
  totalSystems: number;
  truncated: boolean;
}

export interface SimulationHostSnapshot {
  pid: number; stats: SimulationStats; world: SerializedWorld;
  runtime: { godEid: number; godTick: number; indexedEntities: Array<[string, number]> };
}
export interface SimulationHost {
  getCodingStatus(): Promise<ReturnType<ArgosSimulation["getCodingStatus"]>>;
  requestSystemBuild(request: Parameters<ArgosSimulation["requestSystemBuild"]>[0]): Promise<ReturnType<ArgosSimulation["requestSystemBuild"]>>;
  health(): Promise<SimulationHostHealth>;
  snapshot(): Promise<SimulationHostSnapshot>;
  step(deltaMs?: number): Promise<SimulationHostSnapshot>;
  start(): Promise<void>;
  pause(): Promise<void>;
  stimulate(agent: string, content: string, type?: string): Promise<void>;
  defineComponent(definition: ComponentDefinition): Promise<void>;
  attachComponent(entityName: string, component: string, values: Record<string, unknown>): Promise<void>;
  reset(config: SimulationConfig): Promise<SimulationHostSnapshot>;
  restore(snapshot: SerializedWorld): Promise<SimulationHostSnapshot>;
  close(): Promise<void>;
}
const MAX_BYTES = 8 * 1024 * 1024;
function validateMessage(value: unknown) {
  const encoded = JSON.stringify(value, (_key, entry) => {
    if (["function", "symbol", "bigint"].includes(typeof entry) || typeof entry === "number" && !Number.isFinite(entry))
      throw new Error("Simulation host inputs must be finite JSON values, not callbacks or live objects");
    return entry;
  });
  if (!encoded || Buffer.byteLength(encoded) > MAX_BYTES) throw new Error("Simulation host message exceeds its bounded IPC limit");
  return JSON.parse(encoded);
}
class WorkerConnection {
  readonly process: ChildProcess;
  private next = 0;
  private ended = false;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  readonly ready: Promise<void>;
  readonly exited: Promise<void>;
  constructor() {
    const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
    this.process = fork(fileURLToPath(new URL(`./simulation-host-worker.${extension}`, import.meta.url)), [], {
      execArgv: ["--import", createRequire(import.meta.url).resolve("tsx")], env: { ...process.env, ARGOS_PROCESS_WORLD_HOST: "1" },
      stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "json",
    });
    this.exited = new Promise(resolve => this.process.once("exit", () => resolve()));
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error("Simulation worker startup timed out")); this.process.kill("SIGKILL"); }, 30_000);
      this.process.on("message", (message: any) => {
        if (message?.ready === true) { clearTimeout(timer); resolve(); return; }
        const row = this.pending.get(message?.id); if (!row) return;
        this.pending.delete(message.id); clearTimeout(row.timer);
        if (message.ok === true) row.resolve(message.value); else row.reject(new Error(String(message.error ?? "Worker command failed")));
      });
      const fail = (error: Error) => { clearTimeout(timer); reject(error); this.fail(error); };
      this.process.once("error", fail);
      this.process.once("exit", (code, signal) => fail(new Error(`Simulation worker exited (${signal ?? code})`)));
    });
  }
  private fail(error: Error) {
    this.ended = true;
    for (const row of this.pending.values()) { clearTimeout(row.timer); row.reject(error); }
    this.pending.clear();
  }
  async call(method: string, args: unknown[] = []): Promise<any> {
    const values = validateMessage(args); await this.ready;
    if (this.ended || !this.process.connected) throw new Error("Simulation worker is closed");
    if (this.pending.size >= 32) throw new Error("Simulation worker request queue is full");
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // A timeout is uncertain execution, never permission to retry a mutation.
        this.fail(new Error("Simulation worker command timed out; worker terminated to fence uncertain work"));
        this.process.kill("SIGKILL");
      }, 60_000);
      this.pending.set(id, { resolve, reject, timer });
      this.process.send({ id, method, args: values }, error => { if (error) { this.fail(error); this.process.kill("SIGKILL"); } });
    });
  }
  async close() {
    if (this.process.exitCode !== null || this.process.signalCode !== null) return;
    this.fail(new Error("Simulation worker closed"));
    this.process.kill("SIGTERM");
    const timer = setTimeout(() => this.process.kill("SIGKILL"), 5000);
    try { await this.exited; } finally { clearTimeout(timer); }
  }
}

/** Creates an isolated runtime; AI/tool permissions remain explicit config.
 * Reset is destructive for this host only; export snapshot().world beforehand.
 * Native package snapshots require explicit package reattachment support. */
export async function createSimulationHost(config: SimulationConfig): Promise<SimulationHost> {
  config = validateMessage(config);
  if (config.restoreSnapshot !== undefined) validateSimulationSnapshot(config.restoreSnapshot);
  let worker = new WorkerConnection(), replacement: WorkerConnection | undefined;
  let closed = false, replacing = false, currentConfig = config;
  try { await worker.call("initialize", [config]); } catch (error) { await worker.close(); throw error; }
  const call = (method: string, args: unknown[] = []) => {
    if (closed || replacing) return Promise.reject(new Error("Simulation host is closed or resetting"));
    return worker.call(method, args);
  };
  const host: SimulationHost = {
    getCodingStatus: () => call("getCodingStatus"),
    requestSystemBuild: request => call("requestSystemBuild", [request]),
    health: () => call("health"),
    snapshot: () => call("snapshot"), step: delta => call("step", [delta]),
    start: () => call("start"), pause: () => call("pause"),
    stimulate: (agent, content, type) => call("stimulate", [agent, content, type]),
    defineComponent: definition => call("defineComponent", [definition]),
    attachComponent: (name, component, values) => call("attachComponent", [name, component, values]),
    async reset(nextConfig) {
      nextConfig = validateMessage(nextConfig);
      if (nextConfig.restoreSnapshot !== undefined) validateSimulationSnapshot(nextConfig.restoreSnapshot);
      if (closed || replacing) throw new Error("Simulation host is closed or resetting");
      replacing = true;
      let candidate: WorkerConnection | undefined;
      try {
        candidate = replacement = new WorkerConnection();
        await candidate.call("initialize", [nextConfig]);
        if (closed) throw new Error("Simulation host closed during reset");
        // Export successfully before retiring the current process. A bad
        // snapshot/system never destroys the last usable runtime.
        const result = await candidate.call("snapshot");
        await worker.close();
        if (closed) throw new Error("Simulation host closed during reset");
        worker = candidate;
        currentConfig = nextConfig;
        return result;
      } catch (error) { await candidate?.close(); throw error; }
      finally { replacing = false; replacement = undefined; }
    },
    async restore(snapshot) {
      validateSimulationSnapshot(snapshot);
      // Keep runtime permissions/settings, not original genesis/setup/seeding.
      return host.reset({ ...currentConfig, restoreSnapshot: snapshot, rooms: undefined, agents: undefined, objects: undefined,
        genesis: undefined, useGodCommand: undefined, setupCommand: undefined, generateSchedules: false });
    },
    async close() { closed = true; await Promise.all([worker.close(), replacement?.close()]); },
  };
  return host;
}
