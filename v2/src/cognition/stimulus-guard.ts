import type { World } from "../ecs/world";
import { entityExists, hasComponent } from "bitecs";
import { Agent, WorkingMemoryIdentity } from "../ecs/components";
import { getCommittedEvents, startCommittedEvents } from "../runtime/committed-events";
import { workingMemoryEntityRef } from "./working-memory";

/** Runtime-only lineage survives trusted normalization/requeueing, not model JSON. */
const guards = new WeakMap<object, { world: World; bound: boolean; current(event: object): boolean }>();
export function bindStimulusGuard(event: object, world: World, current: () => boolean): void {
  const previous = guards.get(event);
  guards.set(event, { world, bound: previous?.bound ?? false,
    current: copy => (!previous || previous.world === world && previous.current(copy)) && current() });
}
/** Admission is a real signal boundary. Read-only probes must never call this. */
export function bindStimulusLifetime(event: { targetEid: number }, world: World): boolean {
  const previous = guards.get(event);
  if (previous && (previous.world !== world || !isStimulusCurrent(event, world))) return false;
  if (previous?.bound) return true;
  const eid = event.targetEid, source = getCommittedEvents(world);
  if (source.stopped || !entityExists(world, eid) || !hasComponent(world, eid, Agent) || Agent.active[eid] === false) return false;
  const owner = workingMemoryEntityRef(world, eid)?.key;
  if (!owner) return false;
  const sourceId = source.sourceId ?? startCommittedEvents(world);
  guards.set(event, { world, bound: true, current: copy => {
    const current = getCommittedEvents(world);
    return (copy as { targetEid?: number }).targetEid === eid && !current.stopped && current.sourceId === sourceId
      && entityExists(world, eid) && hasComponent(world, eid, Agent) && Agent.active[eid] !== false
      && hasComponent(world, eid, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[eid] === owner
      && (!previous || previous.current(copy));
  } });
  return true;
}
export function hasStimulusLifetime(event: object): boolean { return guards.get(event)?.bound === true; }
export function inheritStimulusGuard<T extends object>(source: object, copy: T): T {
  const guard = guards.get(source); if (guard) guards.set(copy, guard);
  return copy;
}
export function stimulusWorld(event: object): World | undefined { return guards.get(event)?.world; }
export function isStimulusCurrent(event: object, world?: World): boolean {
  const guard = guards.get(event);
  try { return !guard || (!world || guard.world === world) && guard.current(event); } catch { return false; }
}
