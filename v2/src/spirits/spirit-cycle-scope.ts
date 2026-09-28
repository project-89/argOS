import { entityExists, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { GodAgent, Name, Removed, WorkingMemoryIdentity } from "../ecs/components";
import { readSimulationTime } from "../ecs/simulation-time";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { getCommittedEvents } from "../runtime/committed-events";
import { getSimulationTaskSignal } from "../runtime/task-scope";
import type { SpiritRegistry } from "./spirit-registry";
import type { SpiritState } from "./types";

const cycles = new WeakMap<World, WeakMap<SpiritState, object>>();
const registryLifetimes = new WeakMap<SpiritRegistry, { active: boolean }>();

/** Lifecycle authority for managed spirit systems. Standalone registries keep
 * their existing source-based lifetime; each managed stop/start invalidates
 * pending work and advisory receipts, even without restarting the world. */
export function setSpiritRegistryActive(registry: SpiritRegistry, active: boolean): void {
  if (registryLifetimes.get(registry)?.active === active) return;
  registryLifetimes.set(registry, { active });
}

export function captureSpiritRegistryLifetime(registry: SpiritRegistry): () => boolean {
  const lifetime = registryLifetimes.get(registry);
  return () => registryLifetimes.get(registry) === lifetime && lifetime?.active !== false;
}

/** Source validity also outlives inference in accepted advisory receipts.
 * Starting a newer cycle must not alone cancel previously accepted advice. */
export function captureSpiritSourceScope(world: World, spirit: SpiritState, registry: SpiritRegistry): () => boolean {
  const source = getCommittedEvents(world), issuedAt = readSimulationTime(world), signal = getSimulationTaskSignal();
  const lifetimeCurrent = captureSpiritRegistryLifetime(registry);
  const eid = spirit.eid, definition = spirit.definition, configuration = JSON.stringify(definition);
  return () => {
    try {
      const now = readSimulationTime(world), live = getCommittedEvents(world);
      return lifetimeCurrent()
        && !signal?.aborted && !source.stopped && !live.stopped && live.sourceId === source.sourceId
        && Number.isFinite(now) && Number.isFinite(issuedAt) && now >= issuedAt && registry.world === world
        && entityExists(world, eid) && !hasComponent(world, eid, Removed)
        && spirit.eid === eid && registry.spirits.get(eid) === spirit
        && spirit.definition === definition && JSON.stringify(spirit.definition) === configuration;
    } catch { return false; }
  };
}

/** Capture actual producer, source epoch, cycle order and destination before
 * inference. No delayed result may resolve a new supervisor by a reused ID. */
export function captureSpiritCycleScope(world: World, spirit: SpiritState, registry: SpiritRegistry) {
  let active = cycles.get(world); if (!active) { active = new WeakMap(); cycles.set(world, active); }
  const token = {}; active.set(spirit, token);
  const sourceCurrent = captureSpiritSourceScope(world, spirit, registry);
  const destination = spirit.superiorEid ?? registry.godAgentEid;
  const isGodDestination = destination !== undefined && registry.godAgentEid === destination;
  const superior = destination === undefined ? undefined : registry.spirits.get(destination);
  const superiorCurrent = superior ? captureSpiritSourceScope(world, superior, registry) : undefined;
  const godRef = destination === undefined || superior ? undefined : workingMemoryEntityRef(world, destination);
  const destinationCurrent = () => {
    if ((spirit.superiorEid ?? registry.godAgentEid) !== destination
      || (destination !== undefined && registry.godAgentEid === destination) !== isGodDestination) return false;
    if (destination === undefined) return true;
    if (superior) return !!superiorCurrent?.();
    return !!godRef && entityExists(world, destination) && !hasComponent(world, destination, Removed)
      && hasComponent(world, destination, GodAgent) && hasComponent(world, destination, Name)
      && Name.value[destination] === godRef.label && hasComponent(world, destination, WorkingMemoryIdentity)
      && WorkingMemoryIdentity.id[destination] === godRef.key && !registry.spirits.has(destination);
  };
  return {
    sourceCurrent, destination,
    isCurrent: () => {
      try { return active!.get(spirit) === token && sourceCurrent() && destinationCurrent(); }
      catch { return false; }
    },
  };
}
