/** Trusted host projection at the native construction boundary. This is not
 * approval authority: existing proposal/God admission must still precede it. */
import type { World } from "../ecs/world";
import type { MaterializedEntitySpec } from "./entity-materialization";
import { getCommittedEvents } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";

export type NativeMaterialize = (spec: MaterializedEntitySpec) => number;
export interface WorldMaterializationAdapter {
  materialize(spec: MaterializedEntitySpec, nativeCreate: NativeMaterialize): number;
  /** Public host catalog only; never an admission or a private actor view. */
  describe?(): string;
}
type Registration = { sourceId: string; adapter: WorldMaterializationAdapter; disposed: boolean; busy: boolean };
const registrations = new WeakMap<World, Registration>();

export function describeWorldMaterialization(world: World): string {
  const row = registrations.get(world), source = getCommittedEvents(world);
  if (!row || row.disposed || source.stopped || source.sourceId !== row.sourceId || !row.adapter.describe) return "";
  const value = row.adapter.describe();
  if (typeof value !== "string" || value.length > 16000) throw Error("World construction catalog is invalid or unbounded");
  // A description callback cannot revive a stopped/replaced registration.
  const after = getCommittedEvents(world);
  return !row.disposed && registrations.get(world) === row && !after.stopped && after.sourceId === row.sourceId ? value : "";
}

export function registerWorldMaterializationAdapter(world: World, adapter: WorldMaterializationAdapter): () => void {
  assertSimulationTaskActive();
  const source = getCommittedEvents(world), previous = registrations.get(world);
  if (!source.sourceId || source.stopped) throw Error("Materialization adapter requires an active existing source");
  if (previous && !previous.disposed) throw Error("A world materialization adapter is already registered");
  const row: Registration = { sourceId: source.sourceId, adapter, disposed: false, busy: false };
  registrations.set(world, row);
  // Keep a deny tombstone: disposing a restrictive host does not silently grant
  // unrestricted native creation to callers retaining that world reference.
  return () => { row.disposed = true; };
}

export function withWorldMaterializationAdapter(world: World, spec: MaterializedEntitySpec, nativeCreate: NativeMaterialize): number {
  const row = registrations.get(world);
  if (!row) return nativeCreate(spec);
  const current = () => {
    assertSimulationTaskActive();
    const source = getCommittedEvents(world);
    if (row.disposed || registrations.get(world) !== row || source.stopped || source.sourceId !== row.sourceId)
      throw Error("World materialization adapter is no longer current");
  };
  current();
  if (row.busy) throw Error("Reentrant materialization is not allowed");
  row.busy = true;
  let open = true, used = false, nativeId: number | undefined;
  try {
    const result = row.adapter.materialize(structuredClone(spec), derived => {
      current();
      if (!open || used) throw Error("Native materialization callback is single-use and synchronous");
      used = true;
      nativeId = nativeCreate(derived);
      // Return the real allocation to the trusted host even if a synchronous
      // constructor observer stopped the source. It must retain that partial
      // work; the host and this outer boundary still reject stale completion.
      return nativeId;
    });
    current();
    if (!used || !Number.isSafeInteger(nativeId) || result !== nativeId)
      throw Error("Adapter result must be its actual native entity binding");
    return result;
  } finally { open = false; row.busy = false; }
}
