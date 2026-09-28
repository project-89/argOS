import { jest } from "@jest/globals";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addComponent, addEntity, hasComponent } from "bitecs";
import { Name } from "../../ecs/components";
import { initializeRegistry, getComponent, getRegistryEntry } from "../../ecs/component-registry";
import { createArgosWorld } from "../../ecs/world";
import { createSystemRegistry, runSystems } from "../../ecs/dynamic-systems";
import { startCommittedEvents } from "../../runtime/committed-events";
import { CodingDaemon, type CodingDaemonConfig } from "../coding-daemon";
import type { Scalar } from "../contracts";

type ValuePolicy = (component: string, field: string, value: Scalar) => boolean;
const bounded: ValuePolicy = (_component, _field, value) => typeof value === "boolean"
  || typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
const names = ["BoundedSurface", "BoundedDust"];

async function packageFiles(directory: string, defaults: number[]) {
  await mkdir(path.join(directory, "components"), { recursive: true });
  await mkdir(path.join(directory, "systems"), { recursive: true });
  const systems = [], tests = [];
  for (let index = 0; index < defaults.length; index++) {
    const component = names[index], system = `${component}System`;
    await writeFile(path.join(directory, `components/${component}.json`), JSON.stringify({ name: component,
      description: "Public numeric and boolean output", fields: { amount: { type: "number", default: defaults[index] },
        ready: { type: "boolean", default: false } } }));
    await writeFile(path.join(directory, `systems/${system}.ts`), `export function run(ctx:any) {
      for (const id of ctx.query("Name")) { ctx.attach(id,"${component}");
        const amount = ctx.get(id,"Name","value") === "excessive" ? 1000001 : Math.min(100,ctx.get(id,"${component}","amount")+1);
        ctx.set(id,"${component}","amount",amount); ctx.set(id,"${component}","ready",true); }
    }`);
    systems.push({ name: system, description: "Apply bounded environmental values", file: `systems/${system}.ts`, frequency: 1,
      reads: ["Name", component], writes: [`${component}.amount`, `${component}.ready`] });
    tests.push(...[0, 100].map(amount => ({ name: `${component} ${amount}`, system,
      entities: [{ id: 1, components: { Name: { value: "fixture" }, [component]: { amount, ready: true } } }], ticks: 1, deltaMs: 1000,
      expect: [{ entity: 1, component, field: "amount", equals: Math.min(100, amount + 1) }] })));
  }
  await writeFile(path.join(directory, "release.json"), JSON.stringify({ version: 1,
    components: defaults.map((_value, index) => `components/${names[index]}.json`), systems, tests }));
}

async function fixture(options: { policy?: ValuePolicy; omit?: boolean; defaults?: number[] } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "argos-value-policy-"));
  const world = createArgosWorld("Bounded environmental output"); initializeRegistry(world); startCommittedEvents(world);
  const first = addEntity(world), second = addEntity(world);
  for (const id of [first, second]) { addComponent(world, id, Name); Name.value[id] = "public fixture"; }
  const registry = createSystemRegistry();
  const config = { directory, ...(options.omit ? {} : { permitsValue: options.policy ?? bounded }) } as CodingDaemonConfig;
  const daemon = new CodingDaemon(world, registry, config, input => packageFiles(input.directory, options.defaults ?? [0]));
  await daemon.initialize();
  const prepare = async () => { daemon.enqueue({ source: "operator", instruction: "Update public environmental state" }); await daemon.pump(); };
  const activate = async () => { await prepare(); daemon.commitReady(1); };
  const calculate = async () => { runSystems(world, registry, 1, 1000); await daemon.settle(); };
  const finish = async () => { daemon.stop(); await daemon.settle(); await daemon.flush(); };
  return { directory, world, first, second, registry, daemon, prepare, activate, calculate, finish };
}

beforeEach(() => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline value-policy regression"));
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("valid numeric and boolean output commits; unchanged string input is not output", async () => {
  const f = await fixture();
  try {
    await f.activate(); await f.calculate(); f.daemon.commitReady(2);
    const component = getComponent(names[0]);
    for (const id of [f.first, f.second]) {
      expect(hasComponent(f.world, id, component)).toBe(true);
      expect(component.amount[id]).toBe(1); expect(component.ready[id]).toBe(true);
    }
    expect(f.daemon.getStatus().runtime[0]).toMatchObject({ commits: 1, changedCommits: 1, failures: 0 });
  } finally { await f.finish(); }
});

test("one invalid output rejects the entire mixed existing/new component batch and queues bounded repair", async () => {
  const f = await fixture();
  try {
    await f.activate(); const component = getComponent(names[0]);
    addComponent(f.world, f.first, component); component.amount[f.first] = 4; component.ready[f.first] = false;
    Name.value[f.second] = "excessive";
    let failureMetrics: ReturnType<typeof f.daemon.getStatus>["runtime"][number] | undefined;
    const setCount = f.registry.errorCounts.set.bind(f.registry.errorCounts);
    jest.spyOn(f.registry.errorCounts, "set").mockImplementation((name, count) => {
      failureMetrics = f.daemon.getStatus().runtime[0]; return setCount(name, count);
    });
    await f.calculate(); expect(() => f.daemon.commitReady(2)).not.toThrow();
    expect(component.amount[f.first]).toBe(4); expect(component.ready[f.first]).toBe(false);
    expect(hasComponent(f.world, f.second, component)).toBe(false);
    expect(f.daemon.getStatus().jobs[0].status).toBe("rolled_back");
    expect(f.registry.errors).toHaveLength(1);
    expect(f.registry.errorCounts.get(`${names[0]}System`)).toBe(1);
    expect(failureMetrics).toMatchObject({ attempts: 1, commits: 0, failures: 1 });
    expect(f.daemon.getStatus().jobs.filter(row => row.repairOfJobId)).toHaveLength(1);
    expect(f.registry.events.filter(row => row.type === "managed_system_changed")).toHaveLength(0);
  } finally { await f.finish(); }
});

test("current registry attachment defaults are validated even when the worker overwrites them", async () => {
  const f = await fixture();
  try {
    await f.activate(); await f.calculate();
    getRegistryEntry(names[0])!.definition!.defaults!.amount = 1_000_001;
    expect(() => f.daemon.commitReady(2)).not.toThrow();
    for (const id of [f.first, f.second]) expect(hasComponent(f.world, id, getComponent(names[0]))).toBe(false);
    expect(f.daemon.getStatus().jobs[0].status).toBe("rolled_back");
    expect(f.registry.errors).toHaveLength(1);
  } finally { await f.finish(); }
});

test.each(["policy", "attachment defaults"])("%s are rechecked at final application after another batch commits", async variant => {
  let allowPositive = true;
  const f = await fixture({ defaults: [0, 0], policy: (name, field, value) => bounded(name, field, value)
    && (allowPositive || typeof value !== "number" || value === 0) });
  try {
    await f.activate(); const committed: string[] = [], push = f.registry.events.push.bind(f.registry.events);
    jest.spyOn(f.registry.events, "push").mockImplementation((...events) => {
      for (const event of events) if (event.type === "managed_system_changed") {
        committed.push(event.data.system);
        if (variant === "policy") allowPositive = false;
        else for (const name of names) getRegistryEntry(name)!.definition!.defaults!.amount = 1_000_001;
      }
      return push(...events);
    });
    await f.calculate(); expect(() => f.daemon.commitReady(2)).not.toThrow();
    expect(committed).toHaveLength(1);
    const rejected = names.find(name => `${name}System` !== committed[0])!;
    for (const id of [f.first, f.second]) expect(hasComponent(f.world, id, getComponent(rejected))).toBe(false);
    expect(f.daemon.getStatus().jobs[0].status).toBe("rolled_back");
    expect(f.registry.errors).toHaveLength(1);
  } finally { await f.finish(); }
});

test("all release defaults pass host policy before any component schema is installed", async () => {
  const f = await fixture({ defaults: [0, 1_000_001] });
  try {
    await f.activate(); expect(f.daemon.getStatus().jobs[0].status).toBe("rejected");
    expect(getComponent(names[0])).toBeUndefined(); expect(getComponent(names[1])).toBeUndefined();
    expect(f.registry.systems.size).toBe(0);
  } finally { await f.finish(); }
});

test("ready release defaults are rechecked before activation and existing missing fields stay untouched", async () => {
  let allowed = true;
  const f = await fixture({ policy: () => allowed });
  try {
    await f.activate(); const component = getComponent(names[0]);
    addComponent(f.world, f.first, component); component.ready[f.first] = false; delete component.amount[f.first];
    await f.prepare(); expect(f.daemon.getStatus().jobs[1].status).toBe("ready");
    const previous = f.registry.systems.get(`${names[0]}System`);
    allowed = false; f.daemon.commitReady(2);
    expect(f.daemon.getStatus().jobs[1].status).toBe("rejected");
    expect(f.registry.systems.get(`${names[0]}System`)).toBe(previous);
    expect(component.amount[f.first]).toBeUndefined(); expect(component.ready[f.first]).toBe(false);
  } finally { await f.finish(); }
});

test("accepted history is revalidated under a new host value policy before restoration", async () => {
  const original = await fixture({ omit: true, defaults: [0, 1_000_001] });
  try { await original.activate(); expect(original.daemon.getStatus().jobs[0].status).toBe("active"); }
  finally { await original.finish(); }
  const world = createArgosWorld("New bounded host"); initializeRegistry(world);
  const registry = createSystemRegistry(), config = { directory: original.directory, permitsValue: bounded } as CodingDaemonConfig;
  const daemon = new CodingDaemon(world, registry, config, async () => { throw new Error("No rebuild"); });
  try {
    await expect(daemon.initialize()).rejects.toThrow(/value/i);
    expect(getComponent(names[0])).toBeUndefined(); expect(getComponent(names[1])).toBeUndefined();
    expect(registry.systems.size).toBe(0);
  } finally { daemon.stop(); await daemon.settle(); await daemon.flush(); }
});

test("omitting the host hook preserves legacy finite scalar values above the spatial bound", async () => {
  const f = await fixture({ omit: true, defaults: [1_000_001] });
  try {
    await f.activate(); Name.value[f.second] = "excessive";
    await f.calculate(); f.daemon.commitReady(2);
    expect(getComponent(names[0]).amount[f.second]).toBe(1_000_001);
    expect(f.daemon.getStatus().runtime[0]).toMatchObject({ commits: 1, failures: 0 });
  } finally { await f.finish(); }
});

test.each(["async", "undefined", "truthy", "throws"])("a %s runtime value policy rolls back without escaping commitReady", async variant => {
  const invalid = variant === "async" ? () => Promise.resolve(true) : variant === "undefined" ? () => undefined
    : variant === "truthy" ? () => "yes" : () => { throw new Error("Value policy unavailable"); };
  const policy = ((_name: string, _field: string, value: Scalar) => value === 1 ? invalid() : true) as ValuePolicy;
  const f = await fixture({ policy });
  try {
    await f.activate(); await f.calculate(); expect(() => f.daemon.commitReady(2)).not.toThrow();
    for (const id of [f.first, f.second]) expect(hasComponent(f.world, id, getComponent(names[0]))).toBe(false);
    expect(f.daemon.getStatus().jobs[0].status).toBe("rolled_back"); expect(f.registry.errors).toHaveLength(1);
  } finally { await f.finish(); }
});
