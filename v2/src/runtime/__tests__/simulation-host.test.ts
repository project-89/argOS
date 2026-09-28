import { createSimulationHost, type SimulationHost, type SimulationHostSnapshot } from "../simulation-host";
import type { SimulationConfig } from "../../index";
import { execFileSync } from "node:child_process";
import { mkdtemp, copyFile, chmod } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const hosts: SimulationHost[] = [];
const config = (name: string): SimulationConfig => ({ name, enableAI: false, enableServer: false, preset: "minimal",
  enableSpirits: false, evolution: false, codingDaemons: false, godAutopilot: false,
  rooms: [{ name: "Study" }], objects: [{ name: "Shared name", room: "Study", portable: true }] });
async function create(name: string) { const host = await createSimulationHost(config(name)); hosts.push(host); return host; }
const entity = (snapshot: SimulationHostSnapshot) => snapshot.world.entities.find(e => e.components.Name?.value === "Shared name")!;
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.close())); });

test("managed release activates inside the host while ticks continue, without a model", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "argos-host-build-"));
  const executable = path.join(directory, "builder.cjs");
  await copyFile(path.resolve("src/runtime/__tests__/fixtures/managed-builder.cjs"), executable);
  await chmod(executable, 0o700);
  const previous = process.env.ARGOS_CODEX_BIN;
  let host: SimulationHost;
  try {
    process.env.ARGOS_CODEX_BIN = executable;
    host = await createSimulationHost({ ...config("Managed host"), codingDaemons: { backend: "codex", directory, timeoutMs: 15000 } });
    hosts.push(host);
  } finally {
    if (previous === undefined) delete process.env.ARGOS_CODEX_BIN; else process.env.ARGOS_CODEX_BIN = previous;
  }
  const initial = await host.snapshot();
  await expect(createSimulationHost({ ...config("Colliding host"), codingDaemons: { directory } })).rejects.toThrow(/already owned/);
  await expect(host.reset({ ...config("Same store reset"), codingDaemons: { directory } })).rejects.toThrow(/already owned/);
  expect((await host.snapshot()).pid).toBe(initial.pid);
  const job = await host.requestSystemBuild({ source: "operator fixture", instruction: "Create the counter mechanic" });
  let status;
  for (let i = 0; i < 100; i++) {
    await host.step(100);
    status = await host.getCodingStatus();
    if (status?.jobs.find(row => row.id === job.id)?.status === "active") break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  expect(status?.jobs.find(row => row.id === job.id)?.status).toBe("active");
  await host.attachComponent("Shared name", "HostCounter", { value: 0 });
  let current = await host.snapshot();
  for (let i = 0; i < 50 && entity(current).components.HostCounter.value === 0; i++) {
    await new Promise(resolve => setTimeout(resolve, 20)); current = await host.step(100);
  }
  expect(current.pid).toBe(initial.pid);
  expect(current.stats.tick).toBeGreaterThan(initial.stats.tick);
  expect(entity(current).components.HostCounter.value).toBeGreaterThan(0);
  expect((await host.getCodingStatus())?.runtime.find(row => row.name === "Count")?.commits).toBeGreaterThan(0);
  const rejected = await host.requestSystemBuild({ source: "operator fixture", instruction: "Replace the counter with an incompatible candidate",
    acceptance: [{ name: "required replacement behavior", system: "Count", entities: [{ id: 1, components: { HostCounter: { value: 0 } } }],
      ticks: 1, deltaMs: 1000, expect: [{ entity: 1, component: "HostCounter", field: "value", equals: 100 }] }] });
  for (let i = 0; i < 100; i++) {
    current = await host.step(100); status = await host.getCodingStatus();
    if (status?.jobs.find(row => row.id === rejected.id)?.status === "rejected") break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  expect(status?.jobs.find(row => row.id === rejected.id)).toMatchObject({ status: "rejected", error: expect.any(String) });
  expect(status?.activeSystems.find(row => row.name === "Count")).toMatchObject({ jobId: job.id, active: true });
  expect(current.pid).toBe(initial.pid);
  // Rejection must not merely preserve metadata: the old worker still commits.
  const valueAfterRejection = entity(current).components.HostCounter.value;
  for (let i = 0; i < 50 && entity(current).components.HostCounter.value <= valueAfterRejection; i++) {
    await new Promise(resolve => setTimeout(resolve, 20)); current = await host.step(100);
  }
  expect(entity(current).components.HostCounter.value).toBeGreaterThan(valueAfterRejection);
  const savedManagedWorld = (await host.snapshot()).world;
  await host.close();
  const reopened = await createSimulationHost({ ...config("Reopened store"), codingDaemons: { directory } });
  hosts.push(reopened);
  expect((await reopened.getCodingStatus())?.activeSystems.find(row => row.name === "Count")?.active).toBe(true);
  await reopened.close();
  await expect(createSimulationHost({ ...config("Disabled managed restore"), restoreSnapshot: savedManagedWorld }))
    .rejects.toThrow(/caller-enabled codingDaemons/);
  const emptyStore = await mkdtemp(path.join(os.tmpdir(), "argos-host-empty-store-"));
  await expect(createSimulationHost({ ...config("Missing managed release"), restoreSnapshot: savedManagedWorld,
    codingDaemons: { directory: emptyStore } })).rejects.toThrow(/release unavailable/);
  const tampered = structuredClone(savedManagedWorld);
  tampered.systems.find(system => system.name === "Count")!.code = 'throw new Error("Do not execute snapshot module");';
  await expect(createSimulationHost({ ...config("Altered managed source"), restoreSnapshot: tampered,
    codingDaemons: { directory } })).rejects.toThrow(/snapshot\/store mismatch/);
  const restored = await createSimulationHost({ ...config("Restored managed world"), restoreSnapshot: savedManagedWorld,
    codingDaemons: { directory } });
  hosts.push(restored);
  const beforeResume = await restored.snapshot();
  expect(entity(beforeResume).components.HostCounter.value).toBe(entity({ ...beforeResume, world: savedManagedWorld }).components.HostCounter.value);
  let afterResume = beforeResume;
  for (let i = 0; i < 50 && entity(afterResume).components.HostCounter.value === entity(beforeResume).components.HostCounter.value; i++) {
    await new Promise(resolve => setTimeout(resolve, 20)); afterResume = await restored.step(100);
  }
  expect(entity(afterResume).components.HostCounter.value).toBeGreaterThan(entity(beforeResume).components.HostCounter.value);
  expect((await restored.getCodingStatus())?.activeSystems.find(row => row.name === "Count")?.active).toBe(true);
}, 45_000);

test("health exposes system failures without consuming them or advancing the world", async () => {
  const host = await create("Health");
  const saved = (await host.snapshot()).world;
  saved.systems.push({ name: "BrokenProbe", description: "Health test", pseudocode: "throw",
    frequency: 1, active: true, code: 'throw new Error("deliberate health probe");' });
  await host.restore(saved);
  await host.step(250);
  const first = await host.health(), second = await host.health();
  expect(second).toEqual(first);
  expect(first.stats.tick).toBe(1);
  expect(first.truncated).toBe(false);
  expect(first.totalSystems).toBe(first.systems.length);
  expect(first.systems.find(system => system.name === "BrokenProbe")).toMatchObject({
    totalErrors: 1, consecutiveErrors: 1, lastError: expect.stringContaining("deliberate health probe"),
  });
  expect((await host.step(250)).stats.tick).toBe(2);
}, 20_000);

test("independent worker worlds retain overlapping component names, values and clocks through reset", async () => {
  const [a, b] = await Promise.all([create("A"), create("B")]);
  const definition = { name: "SharedComponent", description: "Independently authored state", properties: { value: "number" as const } };
  await Promise.all([a.defineComponent(definition), b.defineComponent(definition)]);
  await Promise.all([a.attachComponent("Shared name", definition.name, { value: 11 }), b.attachComponent("Shared name", definition.name, { value: 22 })]);
  const [a1, b1] = await Promise.all([a.step(250), b.step(750)]);
  expect(a1.pid).not.toBe(b1.pid); expect(a1.pid).not.toBe(process.pid);
  expect(a1.world.clock?.elapsed).toBe(250); expect(b1.world.clock?.elapsed).toBe(750);
  expect(entity(a1).components.SharedComponent.value).toBe(11);
  expect(entity(b1).components.SharedComponent.value).toBe(22);
  const a2 = await a.reset(config("A reset"));
  expect(a2.pid).not.toBe(a1.pid); expect(a2.stats.tick).toBe(0);
  expect(entity(a2).components.SharedComponent).toBeUndefined();
  await a.defineComponent({ ...definition, properties: { value: "string" } });
  await a.attachComponent("Shared name", definition.name, { value: "new schema" });
  expect(entity(await a.snapshot()).components.SharedComponent.value).toBe("new schema");
  const b2 = await b.snapshot();
  expect({ ...b2, world: { ...b2.world, savedAt: 0 } }).toEqual({ ...b1, world: { ...b1.world, savedAt: 0 } });
  await a.close(); await expect(a.step()).rejects.toThrow(/closed/);
  expect(entity(await b.step(250)).components.SharedComponent.value).toBe(22);
}, 30_000);

test("invalid component attachment fails explicitly and leaves the worker usable", async () => {
  const host = await create("Recovery");
  expect(await host.getCodingStatus()).toBeNull();
  await expect(host.requestSystemBuild({ source: "operator", instruction: "Add a mechanic" })).rejects.toThrow("Enable codingDaemons to request system builds");
  await expect(host.attachComponent("missing", "Name", { value: "overwrite" })).rejects.toThrow(/unambiguous/);
  expect(entity(await host.snapshot()).components.Name.value).toBe("Shared name");
  await expect(host.reset({ ...config("bad"), timeScale: NaN })).rejects.toThrow(/finite JSON/);
  expect(entity(await host.snapshot()).components.Name.value).toBe("Shared name");
}, 20_000);

test("the isolated worker contract rejects a second raw world construction", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    'import {createArgosWorld} from "./src/ecs/world.ts";createArgosWorld("A");try{createArgosWorld("B");process.exit(2)}catch(e){console.log(e.message)}'],
    { cwd: process.cwd(), env: { ...process.env, ARGOS_PROCESS_WORLD_HOST: "1" }, encoding: "utf8", timeout: 10000 });
  expect(output).toContain("one world");
});

test("two restored workers continue clocks, lookups and authored systems without reseeding", async () => {
  const [a, b] = await Promise.all([create("A saved"), create("B saved")]);
  const definition = { name: "RestoredCounter", description: "Independent authored counter", properties: { value: "number" as const } };
  await Promise.all([a.defineComponent(definition), b.defineComponent(definition)]);
  await a.attachComponent("Shared name", definition.name, { value: 10 });
  await b.attachComponent("Shared name", definition.name, { value: 90 });
  const [beforeA, beforeB] = await Promise.all([a.step(250), b.step(750)]);
  const savedA = beforeA.world, savedB = beforeB.world;
  const schemaA = savedA.schema as any;
  schemaA.affordances.private_update = { name: "private_update", requires: [], requiresFreshDecision: true };
  schemaA.runtimeAffordances.private_update = schemaA.affordances.private_update;
  schemaA.traits.push("restored_only_in_A");
  // Deliberately force ID remapping rather than succeeding through equal slots.
  for (const row of savedA.entities) {
    row.id += 1000;
    for (const relation of row.relations) relation.targetId += 1000;
  }
  for (const saved of [savedA, savedB]) saved.systems.push({ name: "AuthoredCounter", description: "One count per committed tick", pseudocode: "increment", frequency: 1, active: true,
    code: "for (const eid of ctx.query(world, [RestoredCounter])) RestoredCounter.value[eid] += 1;" });
  const [restoredA, restoredB] = await Promise.all([a.restore(savedA), b.restore(savedB)]);
  expect(restoredA.pid).not.toBe(beforeA.pid); expect(restoredB.pid).not.toBe(beforeB.pid);
  expect(entity(restoredA).id).not.toBe(entity({ ...beforeA, world: savedA }).id);
  expect(entity(restoredA).components.RestoredCounter.value).toBe(10);
  expect(restoredA.world.schema).toEqual(savedA.schema);
  expect(JSON.stringify(restoredB.world.schema)).not.toContain("restored_only_in_A");
  for (const [saved, restored] of [[savedA, restoredA], [savedB, restoredB]] as const) {
    expect(restored.world.entities).toHaveLength(saved.entities.length);
    const gods = restored.world.entities.filter(e => e.components.GodAgent);
    expect(gods).toHaveLength(1); expect(gods[0].id).toBe(restored.runtime.godEid);
    expect(restored.runtime.godTick).toBe(saved.tick); expect(restored.stats.tick).toBe(saved.tick);
    expect(restored.runtime.indexedEntities).toContainEqual(["Shared name", entity(restored).id]);
    expect(restored.world.clock).toEqual(saved.clock);
  }
  const nextA = await a.step(100);
  expect(nextA.world.clock?.elapsed).toBe(350); expect(nextA.stats.tick).toBe(2);
  expect(entity(nextA).components.RestoredCounter.value).toBe(11);
  expect(entity(await b.snapshot()).components.RestoredCounter.value).toBe(90);
  expect(entity(await b.step(200)).components.RestoredCounter.value).toBe(91);
  await a.defineComponent({ name: "AfterRestore", description: "New world growth", properties: { note: "string" } });
  await a.attachComponent("Shared name", "AfterRestore", { note: "continues" });
  expect(entity(await a.snapshot()).components.AfterRestore.note).toBe("continues");
  expect(entity(await b.snapshot()).components.AfterRestore).toBeUndefined();
}, 30_000);

test("invalid restore envelope is rejected before discarding the current worker", async () => {
  const host = await create("Keep me"), before = await host.snapshot();
  await expect(host.restore(undefined as any)).rejects.toThrow(/Invalid simulation snapshot/);
  await expect(host.restore({ ...before.world, runtimePackages: ["native-agent-world-capabilities"] })).rejects.toThrow(/requires native package reattachment/);
  await expect(host.restore({ ...before.world, entities: [] })).rejects.toThrow(/exactly one God/);
  await expect(host.restore({ ...before.world, entities: [...before.world.entities, before.world.entities[0]] })).rejects.toThrow(/duplicate/);
  await expect(host.restore({ ...before.world, clock: { ...before.world.clock!, tick: before.world.tick + 1 } })).rejects.toThrow(/disagrees/);
  expect((await host.snapshot()).pid).toBe(before.pid);
});

test("a system compile failure in the candidate preserves the current host", async () => {
  const host = await create("Still usable"), before = await host.step(250);
  const invalid = structuredClone(before.world);
  invalid.systems.push({ name: "InvalidRestoredSystem", description: "Rejected candidate", pseudocode: "", frequency: 1, active: true, code: "if (" });
  await expect(host.restore(invalid)).rejects.toThrow(/Could not restore system/);
  const after = await host.step(250);
  expect(after.pid).toBe(before.pid); expect(after.world.clock?.elapsed).toBe(500);
});
