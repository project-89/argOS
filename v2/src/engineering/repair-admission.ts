/** A repair is a replacement of an already admitted contract, not a new build
 * capability. This host-only envelope is never accepted from model/file JSON. */
import { randomUUID } from "node:crypto";
import type { World } from "../ecs/world";
import type { SystemRegistry } from "../ecs/dynamic-systems";
import { getRegistryWorld } from "../ecs/component-registry";
import { getCommittedEvents } from "../runtime/committed-events";
import { getSimulationTaskSignal } from "../runtime/task-scope";
import type { ComponentSpec, SystemSpec } from "./contracts";
import type { PreparedRelease } from "./release";
import { canonicalBuildJson } from "./build-work-identity";

export function captureRepairAdmission(world: World, registry: SystemRegistry,
  specs: readonly SystemSpec[], components: readonly ComponentSpec[], ownerCurrent: () => boolean) {
  const source = getCommittedEvents(world), signal = getSimulationTaskSignal(), elapsed = world.time.elapsed;
  if (!source.sourceId || source.stopped || signal?.aborted) throw Error("Repair requires a current simulation source/task");
  const expected = specs.map(spec => {
    const system = registry.systems.get(spec.name);
    return { name: spec.name, system, code: system?.code, fn: system?.compiledFn,
      release: canonicalBuildJson(system?.managedRelease ?? null), active: system?.active,
      frequency: system?.frequency };
  });
  const contracts = structuredClone(specs), schemas = structuredClone(components);
  const current = () => {
    const now = getCommittedEvents(world);
    return getRegistryWorld()===world && !signal?.aborted && !now.stopped && now.sourceId === source.sourceId
      && world.time.elapsed >= elapsed && ownerCurrent() && expected.every(row => {
        const system = registry.systems.get(row.name);
        return system === row.system && system?.code === row.code && system?.compiledFn === row.fn
          && system?.active === row.active && system?.frequency === row.frequency
          && canonicalBuildJson(system?.managedRelease ?? null) === row.release;
      });
  };
  return { key: `repair:${randomUUID()}`, current,
    causalKeys: expected.map(row => `repair:${source.sourceId}:${row.name}:${row.release}`),
    systems: contracts.map(spec => spec.name),
    validate(release: PreparedRelease) {
      if (!current()) throw Error("Repair target/source/task changed");
      if (release.manifest.systems.length !== contracts.length) throw Error("Repair cannot add or omit target systems");
      for (const incoming of release.manifest.systems) {
        const allowed = contracts.find(spec => spec.name === incoming.name);
        if (!allowed || incoming.frequency !== allowed.frequency
          || canonicalBuildJson([...incoming.reads].sort()) !== canonicalBuildJson([...allowed.reads].sort())
          || canonicalBuildJson([...incoming.writes].sort()) !== canonicalBuildJson([...allowed.writes].sort()))
          throw Error(`Repair changed admitted system/read/write/frequency scope: ${incoming.name}`);
      }
      for (const incoming of release.components) {
        const allowed = schemas.find(spec => spec.name === incoming.name);
        if (!allowed || canonicalBuildJson(incoming.fields) !== canonicalBuildJson(allowed.fields))
          throw Error(`Repair cannot introduce or alter schema: ${incoming.name}`);
      }
    },
    contract: { systems: contracts, components: schemas },
  };
}
export type RepairAdmission = ReturnType<typeof captureRepairAdmission>;
