/** One physical timeline: merge authored deadlines and integration boundaries.
 * Wall time never enters this scheduler. Bodies and voices are separate actor
 * resources; sharing a clock does not mean serializing every kind of activity. */
import { entityExists, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, WorkingMemoryIdentity } from "../ecs/components";
import { beginSimulationTimeFrame, readSimulationTime, validateSimulationDelta } from "../ecs/simulation-time";
import { workingMemoryEntityRef } from "../cognition/working-memory";

export type SimulationResource = "body" | "voice";
/** A deliberately closed public motion vocabulary, never raw command text. */
export const PUBLIC_PHYSICAL_OPERATIONS = ["inspecting", "reading", "typing", "eating", "pouring", "drinking", "picking_up", "putting_down", "handing_over", "installing", "opening", "closing", "switching", "wearing", "removing", "repairing", "drying", "pumping", "calibrating"] as const;
export type PublicPhysicalOperation = typeof PUBLIC_PHYSICAL_OPERATIONS[number];
export interface SimulationBodyActivity { kind: "moving" | "holding" | "operating"; operation?: PublicPhysicalOperation; targetEid?: number }
export interface SimulationBoundary { sequence: number; tick: number; atSimMs: number; deltaMs: number }
type Event = { id: number; atSimMs: number; phase: "physical" | "speech"; run(): void; cancel?(): void };
type Reservation = { executionId: string; actorKey: string; resources: SimulationResource[]; activity?: SimulationBodyActivity; targetKey?: string };
type Timeline = { sequence: number; nextId: number; advancing: boolean; events: Map<number, Event>;
  providers: Set<() => number | undefined>; listeners: Set<(boundary: SimulationBoundary) => void>;
  reservations: Map<number, Map<string, Reservation>> };
const timelines = new WeakMap<World, Timeline>();
function timeline(world: World): Timeline {
  let value = timelines.get(world);
  if (!value) { value = { sequence: 0, nextId: 0, advancing: false, events: new Map(), providers: new Set(), listeners: new Set(), reservations: new Map() }; timelines.set(world, value); }
  return value;
}
function currentActor(world: World, eid: number, key: string) {
  return entityExists(world, eid) && hasComponent(world, eid, Agent) && Agent.active[eid]
    && hasComponent(world, eid, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[eid] === key;
}
export function isSimulationResourceBusy(world: World, eid: number, resource: SimulationResource): boolean {
  return [...timelines.get(world)?.reservations.get(eid)?.values() ?? []]
    .some(row => currentActor(world, eid, row.actorKey) && row.resources.includes(resource));
}
export function reserveSimulationResources(world: World, eid: number, executionId: string, resources: SimulationResource[], options: { activity?: SimulationBodyActivity } = {}): boolean {
  if (!executionId || !entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid]
    || resources.some(resource => isSimulationResourceBusy(world, eid, resource))) return false;
  const state = timeline(world), key = workingMemoryEntityRef(world, eid)!.key;
  let rows = state.reservations.get(eid);
  if (!rows) { rows = new Map(); state.reservations.set(eid, rows); }
  for (const [id, row] of rows) if (!currentActor(world, eid, row.actorKey)) rows.delete(id);
  if (rows.has(executionId)) return false;
  const input = options.activity;
  const activity = resources.includes("body") && input && ["moving", "holding", "operating"].includes(input.kind)
    ? { kind: input.kind, ...(input.operation && PUBLIC_PHYSICAL_OPERATIONS.includes(input.operation) ? { operation: input.operation } : {}),
      ...(input.targetEid !== undefined && entityExists(world, input.targetEid) ? { targetEid: input.targetEid } : {}) } : undefined;
  rows.set(executionId, { executionId, actorKey: key, resources: [...new Set(resources)], activity,
    targetKey: activity?.targetEid === undefined ? undefined : workingMemoryEntityRef(world, activity.targetEid)?.key });
  return true;
}
export function getSimulationBodyActivity(world: World, eid: number): Readonly<SimulationBodyActivity> | undefined {
  const row = [...timelines.get(world)?.reservations.get(eid)?.values() ?? []]
    .find(row => row.activity && row.resources.includes("body") && currentActor(world, eid, row.actorKey));
  if (!row?.activity) return;
  const target = row.activity.targetEid;
  const targetCurrent = target !== undefined && entityExists(world, target)
    && hasComponent(world, target, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[target] === row.targetKey;
  return Object.freeze({ kind: row.activity.kind, ...(row.activity.operation ? { operation: row.activity.operation } : {}),
    ...(targetCurrent ? { targetEid: target } : {}) });
}
export function releaseSimulationResources(world: World, eid: number, executionId: string): void {
  timelines.get(world)?.reservations.get(eid)?.delete(executionId);
}
export function scheduleSimulationEvent(world: World, input: { atSimMs: number; phase?: "physical" | "speech"; run(): void; cancel?(): void }): () => void {
  validateSimulationDelta(input.atSimMs);
  if (input.atSimMs < readSimulationTime(world)) throw new RangeError("Cannot schedule a simulation event in the past");
  const state = timeline(world), event: Event = { ...input, id: ++state.nextId, phase: input.phase ?? "physical" };
  state.events.set(event.id, event);
  return () => { if (state.events.delete(event.id)) event.cancel?.(); };
}
export function registerSimulationDeadlineProvider(world: World, read: () => number | undefined): () => void {
  const state = timeline(world); state.providers.add(read); return () => state.providers.delete(read);
}
export function subscribeSimulationBoundaries(world: World, listener: (boundary: SimulationBoundary) => void): () => void {
  const state = timeline(world); state.listeners.add(listener); return () => state.listeners.delete(listener);
}
export function isAdvancingSimulationTimeline(world: World): boolean { return timelines.get(world)?.advancing ?? false; }
/** Pure attachment baseline; does not create a timeline or manufacture a commit. */
export function getSimulationBoundary(world: World): SimulationBoundary {
  return Object.freeze({ sequence: timelines.get(world)?.sequence ?? 0, tick: world.time.tick, atSimMs: readSimulationTime(world), deltaMs: 0 });
}

/** Integrate to every deadline, commit physical events before speech at ties,
 * then publish only the resulting committed boundary. Re-entrant advancement is
 * rejected; package integrators should only integrate while a frame is active. */
export function advanceSimulationTimeline(world: World, deltaMs: number, options: { tick?: number; integrate(deltaMs: number): void }): void {
  validateSimulationDelta(deltaMs);
  const start = readSimulationTime(world), target = start + deltaMs;
  if (!Number.isFinite(target)) throw new RangeError("Simulation timeline overflow");
  const state = timeline(world);
  if (state.advancing) throw new Error("Cannot recursively advance a simulation timeline");
  const frame = beginSimulationTimeFrame(world, options.tick ?? world.time.tick + 1);
  state.advancing = true;
  let eventsRun = 0;
  try {
    let first = true;
    while (timelines.get(world) === state && (first || readSimulationTime(world) < target || [...state.events.values()].some(event => event.atSimMs <= target))) {
      first = false;
      const now = readSimulationTime(world);
      let next = target;
      for (const event of state.events.values()) if (event.atSimMs <= next) next = Math.max(now, event.atSimMs);
      for (const provider of state.providers) {
        const deadline = provider();
        if (deadline !== undefined && Number.isFinite(deadline) && deadline > now && deadline < next) next = deadline;
      }
      const segment = next - now;
      if (segment > 0) { frame.advance(segment); options.integrate(segment); }
      if (timelines.get(world) !== state) break;
      while (true) {
        const event = [...state.events.values()].filter(row => row.atSimMs <= readSimulationTime(world))
          .sort((a, b) => a.atSimMs - b.atSimMs || (a.phase === b.phase ? 0 : a.phase === "physical" ? -1 : 1) || a.id - b.id)[0];
        if (!event) break;
        if (++eventsRun > 100_000) throw new Error("Simulation event budget exceeded (probable zero-time scheduling loop)");
        state.events.delete(event.id); event.run();
        if (timelines.get(world) !== state) break;
      }
      if (timelines.get(world) !== state) break;
      const boundary = Object.freeze({ sequence: ++state.sequence, tick: world.time.tick, atSimMs: readSimulationTime(world), deltaMs: segment });
      for (const listener of [...state.listeners]) {
        if (timelines.get(world) !== state) break;
        try { listener(boundary); } catch (error) { console.error("[SimulationTimeline] Boundary observer failed", error); }
      }
      if (readSimulationTime(world) >= target) break;
    }
  } finally { state.advancing = false; frame.close(); }
}

/** Stop/reload invalidates the in-flight frame and every future callback. */
export function clearSimulationTimeline(world: World): void {
  const state = timelines.get(world); if (!state) return;
  timelines.delete(world);
  const events = [...state.events.values()]; state.events.clear(); state.reservations.clear();
  const errors: unknown[] = [];
  for (const event of events) { try { event.cancel?.(); } catch (error) { errors.push(error); } }
  // Cancellation is an actual final world transition, even though no time
  // passes. Publish its receipts before the committed event source is sealed;
  // otherwise cameras lose the last interrupted words/action outcomes.
  const boundary = Object.freeze({ sequence: ++state.sequence, tick: world.time.tick, atSimMs: readSimulationTime(world), deltaMs: 0 });
  for (const listener of [...state.listeners]) {
    try { listener(boundary); } catch (error) { console.error("[SimulationTimeline] Final boundary observer failed", error); }
  }
  state.listeners.clear(); state.providers.clear();
  if (errors.length) throw new AggregateError(errors, "Timeline cancellation failed after clearing all scheduled work");
}
