/** Host policy for world construction, not a cap on internal cognition entities.
 * Normal authoring paths share this allocator. Raw trusted host ECS writes are
 * not a sandbox; managed generated systems cannot allocate entities at all. */
import { addEntity } from "bitecs";
import type { World } from "../ecs/world";
import { assertSimulationTaskActive } from "./task-scope";

const kinds = ["agent", "room", "object", "stimulus_source", "entity"] as const;
export type WorldConstructionKind = typeof kinds[number];
type Counts = Record<WorldConstructionKind, number>;
export type WorldConstructionSnapshot = { limit: number; admitted: number; byKind: Counts };
type State = { limit: number | null; admitted: number; byKind: Counts; historyKnown: boolean };
const budgets = new WeakMap<World, State>();
const integer = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
function state(world: World): State {
  let value = budgets.get(world);
  if (!value) { value = { limit: null, admitted: 0, byKind: { agent: 0, room: 0, object: 0, stimulus_source: 0, entity: 0 }, historyKnown: true }; budgets.set(world, value); }
  return value;
}
export function configureWorldConstructionBudget(world: World, limit: number): void {
  if (!integer(limit)) throw new Error("World construction budget must be a non-negative safe integer");
  const value = state(world);
  if (!value.historyKnown) throw new Error("Cannot bound a restored world without construction history");
  if (value.limit !== null && value.limit !== limit) throw new Error("World construction budget cannot be replaced during a run");
  if (limit < value.admitted) throw new Error("World construction budget is below already admitted construction");
  value.limit = limit;
}
/** Preflight only, not a reservation or transaction. Call again at allocation. */
export function assertWorldConstructionAvailable(world: World, count = 1): void {
  assertSimulationTaskActive();
  if (!integer(count)) throw new Error("World construction count must be a non-negative safe integer");
  const value = state(world);
  if (value.limit !== null && count > value.limit - value.admitted)
    throw new Error(`World construction budget exhausted (${value.admitted}/${value.limit} admissions)`);
  if (count > Number.MAX_SAFE_INTEGER - value.admitted) throw new Error("World construction counter exhausted");
}
export function allocateWorldEntity(world: World, kind: WorldConstructionKind): number {
  if (!kinds.includes(kind)) throw new Error("Unknown world construction kind");
  assertWorldConstructionAvailable(world);
  const value = state(world);
  // Reserve before allocation/initialization can invoke reentrant observers.
  // Failed initialization and later deletion do not refund construction work.
  value.admitted++; value.byKind[kind]++;
  return addEntity(world);
}
export function getWorldConstructionStatus(world: World) {
  const value = state(world);
  return { limit: value.limit, admitted: value.admitted,
    remaining: value.limit === null ? null : value.limit - value.admitted, byKind: { ...value.byKind }, historyKnown: value.historyKnown };
}
export function snapshotWorldConstructionBudget(world: World): WorldConstructionSnapshot | undefined {
  const value = state(world);
  return value.limit === null ? undefined : { limit: value.limit, admitted: value.admitted, byKind: { ...value.byKind } };
}
/** Restore counters, never infer historical admissions from today's live objects.
 * Import into an already constructed world is deliberately unsupported. */
export function restoreWorldConstructionBudget(world: World, saved: WorldConstructionSnapshot | undefined): void {
  const value = state(world);
  if (saved === undefined) {
    if (value.limit !== null) throw new Error("Snapshot lacks world construction budget history");
    value.historyKnown = false; return;
  }
  if (!saved || !integer(saved.limit) || !integer(saved.admitted) || saved.admitted > saved.limit || !saved.byKind
    || Object.keys(saved).some(key => !["limit", "admitted", "byKind"].includes(key))
    || Object.keys(saved.byKind).length !== kinds.length || kinds.some(kind => !integer(saved.byKind[kind]))
    || kinds.reduce((sum, kind) => sum + saved.byKind[kind], 0) !== saved.admitted)
    throw new Error("Invalid world construction budget history");
  if (value.admitted > 0 || value.limit !== null && value.limit !== saved.limit)
    throw new Error("Cannot merge or replace a bounded world's construction history");
  budgets.set(world, { limit: saved.limit, admitted: saved.admitted, byKind: { ...saved.byKind }, historyKnown: true });
}
