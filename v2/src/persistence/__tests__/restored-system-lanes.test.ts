import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createObjectEntity } from "../../ecs/prefabs";
import { createSystemRegistry, runSystems, runAsyncSystems } from "../../ecs/dynamic-systems";
import { registryCreateComponent, attachToEntity, getComponent } from "../../ecs/component-registry";
import { serializeWorld, deserializeWorld } from "../world-persistence";

function fixture(code: string, async: boolean) {
  const world = createArgosWorld("Saved lanes"); initializePrefabs(world);
  registryCreateComponent({ name: "AsyncProbe", description: "Lane evidence", properties: { count: "number" } });
  const target = createObjectEntity(world, { name: "Probe" }); attachToEntity(world, target, "AsyncProbe", { count: 0 });
  const registry = createSystemRegistry();
  registry.systems.set("DelayedWork", { name: "DelayedWork", description: "Restore lane", pseudocode: "", frequency: 1,
    active: true, async, running: true, lastRun: Date.now(), code });
  return { target, saved: serializeWorld(world, registry) };
}
const increment = "for (const eid of ctx.query(world, [AsyncProbe])) AsyncProbe.count[eid]++;";
test("managed snapshot data stays inert and retains its release requirement through another save", () => {
  const f = fixture(increment, false);
  const provenance = { digest: "a".repeat(64), jobId: "11111111-1111-4111-8111-111111111111" };
  f.saved.systems[0].managedRelease = provenance;
  const world = createArgosWorld("Inert managed restore"); initializePrefabs(world);
  const registry = createSystemRegistry();
  const { oldToNewId } = deserializeWorld(world, registry, f.saved, { strictSystems: true });
  const system = registry.systems.get("DelayedWork")!;
  expect(system.active).toBe(false);
  expect(system.compiledFn).toBeUndefined();
  runSystems(world, registry, 1, 100);
  runAsyncSystems(world, registry, 1, 100);
  expect(getComponent("AsyncProbe")!.count[oldToNewId.get(f.target)!]).toBe(0);
  expect(serializeWorld(world, registry).systems[0]).toMatchObject({ active: true, managedRelease: provenance, code: increment });
});
test.each([false, true])("delayed restored work stays out of sync ticks (legacy=%s)", async legacy => {
  const f = fixture(`await new Promise(resolve => setTimeout(resolve, 20)); ${increment}`, true);
  expect(f.saved.systems[0].async).toBe(true);
  if (legacy) delete f.saved.systems[0].async;
  const world = createArgosWorld("Restored lane"); initializePrefabs(world); const registry = createSystemRegistry();
  const { oldToNewId } = deserializeWorld(world, registry, f.saved);
  const target = oldToNewId.get(f.target)!, probe = getComponent("AsyncProbe")!, system = registry.systems.get("DelayedWork")!;
  expect(system.async).toBe(true); expect(system.running).toBe(false);
  runSystems(world, registry, 1, 100); expect(probe.count[target]).toBe(0);
  runAsyncSystems(world, registry, 1, 100); expect(system.running).toBe(true); expect(probe.count[target]).toBe(0);
  // A second scheduler visit cannot duplicate the pending job.
  runAsyncSystems(world, registry, 2, 100);
  await new Promise(resolve => setTimeout(resolve, 60));
  expect(probe.count[target]).toBe(1); expect(system.running).toBe(false);
});

test("an explicit async lane survives even when its code contains no await", () => {
  const f = fixture(increment, true), world = createArgosWorld("Restored explicit lane"); initializePrefabs(world);
  const registry = createSystemRegistry(), { oldToNewId } = deserializeWorld(world, registry, f.saved);
  runSystems(world, registry, 1, 100);
  expect(registry.systems.get("DelayedWork")!.async).toBe(true);
  expect(getComponent("AsyncProbe")!.count[oldToNewId.get(f.target)!]).toBe(0);
});
