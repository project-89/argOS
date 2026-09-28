import { jest } from "@jest/globals";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addComponent, addEntity, entityExists, hasComponent } from "bitecs";
import { Name, WorkingMemoryIdentity } from "../../ecs/components";
import { initializeRegistry, getComponent } from "../../ecs/component-registry";
import { createArgosWorld } from "../../ecs/world";
import { createSystemRegistry, runSystems } from "../../ecs/dynamic-systems";
import { startCommittedEvents, stopCommittedEvents, getCommittedEvents } from "../../runtime/committed-events";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { CodingDaemon, type CodingDaemonConfig } from "../coding-daemon";
import { ManagedSystemWorker } from "../system-sandbox";

async function packageFiles(directory: string, paired = false) {
  await mkdir(path.join(directory, "components"), { recursive: true }); await mkdir(path.join(directory, "systems"), { recursive: true });
  await writeFile(path.join(directory, "components/ScopedWeathering.json"), JSON.stringify({ name: "ScopedWeathering", description: "Public surface weathering",
    fields: { amount: { type: "number", default: 0 } } }));
  await writeFile(path.join(directory, "systems/ScopedWeatheringSystem.ts"), `export function run(ctx:any) {
    for (const id of ctx.query("Name")) { ctx.attach(id,"ScopedWeathering");
      ctx.set(id,"ScopedWeathering","amount",Math.min(100,ctx.get(id,"ScopedWeathering","amount")+1)); }
  }`);
  await writeFile(path.join(directory, "release.json"), JSON.stringify({ version: 1, components: ["components/ScopedWeathering.json"], systems: [
    { name: "ScopedWeatheringSystem", description: "Weather admitted surfaces", file: "systems/ScopedWeatheringSystem.ts", frequency: 1,
      reads: ["Name", "ScopedWeathering"], writes: ["ScopedWeathering.amount"] },
  ], tests: [0, 100].map(amount => ({ name: `Weathering ${amount}`, system: "ScopedWeatheringSystem",
    entities: [{ id: 1, components: { Name: { value: "fixture" }, ScopedWeathering: { amount } } }], ticks: 1, deltaMs: 1000,
    expect: [{ entity: 1, component: "ScopedWeathering", field: "amount", equals: Math.min(100, amount + 1) }] })) }));
  if (paired) {
    for (const filename of ["components/ScopedWeathering.json", "systems/ScopedWeatheringSystem.ts"]) {
      await writeFile(path.join(directory, filename.replaceAll("ScopedWeathering", "ScopedDust")),
        (await readFile(path.join(directory, filename), "utf8")).replaceAll("ScopedWeathering", "ScopedDust"));
    }
    const manifest = JSON.parse(await readFile(path.join(directory, "release.json"), "utf8"));
    const second = JSON.parse(JSON.stringify(manifest).replaceAll("ScopedWeathering", "ScopedDust").replaceAll("Weathering ", "Dust "));
    manifest.components.push(...second.components); manifest.systems.push(...second.systems); manifest.tests.push(...second.tests);
    await writeFile(path.join(directory, "release.json"), JSON.stringify(manifest));
  }
}
type Policy = NonNullable<CodingDaemonConfig["permitsEntity"]>;
async function fixture(unrestricted = false, override?: Policy, paired = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "argos-entity-scope-"));
  const world = createArgosWorld("Scoped environmental systems"); initializeRegistry(world); startCommittedEvents(world);
  const keys = new Map<number, string>();
  const create = (name: string, permitted: boolean) => {
    const id = addEntity(world); addComponent(world, id, Name); Name.value[id] = name;
    addComponent(world, id, WorkingMemoryIdentity); WorkingMemoryIdentity.id[id] = `entity:${name}`;
    if (permitted) keys.set(id, WorkingMemoryIdentity.id[id]); return id;
  };
  const first = create("public bench", true), second = create("public gate", true), excluded = create("HIDDEN_OUT_OF_SCOPE_LABEL", false);
  const sourceId = getCommittedEvents(world).sourceId;
  const permitsEntity: Policy = id => getCommittedEvents(world).sourceId === sourceId && !getCommittedEvents(world).stopped
    && entityExists(world, id) && hasComponent(world, id, WorkingMemoryIdentity) && keys.has(id) && keys.get(id) === WorkingMemoryIdentity.id[id];
  let context = "";
  const registry = createSystemRegistry(), daemon = new CodingDaemon(world, registry, { directory,
    ...(unrestricted ? {} : { permitsEntity: override ?? permitsEntity }) }, async input => { context = input.context; await packageFiles(input.directory, paired); });
  await daemon.initialize();
  const activate = async () => { daemon.enqueue({ source: "operator", instruction: "Weather admitted public surfaces" }); await daemon.pump(); daemon.commitReady(1); };
  const finish = async () => { daemon.stop(); await daemon.settle(); await daemon.flush(); };
  return { world, directory, registry, daemon, first, second, excluded, keys, permitsEntity, activate, finish, context: () => context };
}
beforeEach(() => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline entity-scope regression"));
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("host policy filters both builder context and worker read snapshots", async () => {
  const f = await fixture();
  try {
    await f.activate();
    expect(f.context()).toContain("public bench"); expect(f.context()).not.toContain("HIDDEN_OUT_OF_SCOPE_LABEL");
    const status = f.daemon.getStatus(); expect(status.activeSystems[0].writes).toEqual(["ScopedWeathering.amount"]);
    status.activeSystems[0].writes.push("Unadmitted.field");
    expect(f.daemon.getStatus().activeSystems[0].writes).toEqual(["ScopedWeathering.amount"]);
    const run = jest.spyOn(ManagedSystemWorker.prototype, "run");
    runSystems(f.world, f.registry, 1, 1000); await f.daemon.settle(); f.daemon.commitReady(2);
    expect(run.mock.calls[0][1].map(row => row.id)).toEqual([f.first, f.second]);
    const component = getComponent("ScopedWeathering");
    expect(component.amount[f.first]).toBe(1); expect(component.amount[f.second]).toBe(1);
    expect(hasComponent(f.world, f.excluded, component)).toBe(false);
    expect(f.daemon.getStatus().runtime[0]).toMatchObject({ commits: 1, changedCommits: 1, failures: 0 });
  } finally { await f.finish(); }
});

test("no hook preserves the existing non-spatial whole-world behavior", async () => {
  const f = await fixture(true);
  try {
    await f.activate(); expect(f.context()).toContain("HIDDEN_OUT_OF_SCOPE_LABEL");
    runSystems(f.world, f.registry, 1, 1000); await f.daemon.settle(); f.daemon.commitReady(2);
    expect(getComponent("ScopedWeathering").amount[f.excluded]).toBe(1);
  } finally { await f.finish(); }
});

test.each(["revoked member", "replaced identity", "new source", "stopped source"])("%s rejects the complete pending mutation batch without partial writes", async change => {
  const f = await fixture();
  try {
    await f.activate(); runSystems(f.world, f.registry, 1, 1000); await f.daemon.settle();
    if (change === "revoked member") f.keys.delete(f.second);
    if (change === "replaced identity") WorkingMemoryIdentity.id[f.second] = "replacement:same-numeric-id";
    if (change === "new source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
    if (change === "stopped source") stopCommittedEvents(f.world);
    f.daemon.commitReady(2);
    const component = getComponent("ScopedWeathering");
    expect(hasComponent(f.world, f.first, component)).toBe(false); expect(hasComponent(f.world, f.second, component)).toBe(false);
    expect(hasComponent(f.world, f.excluded, component)).toBe(false);
    expect(f.daemon.getStatus().runtime[0]).toMatchObject({ commits: 0, changedCommits: 0, staleResults: 1 });
  } finally { await f.finish(); }
});

test("an out-of-scope output cannot commit even the first valid mutation in that batch", async () => {
  const f = await fixture();
  try {
    await f.activate();
    // Defense-in-depth at the host commit boundary: ordinary workers also
    // validate identity/membership, but an opaque result is not authority.
    jest.spyOn(ManagedSystemWorker.prototype, "run").mockImplementationOnce(async (_spec, before) => before.map((row, index) => ({
      id: index === 1 ? f.excluded : row.id, components: { ...row.components, ScopedWeathering: { amount: 1 } },
    })));
    runSystems(f.world, f.registry, 1, 1000); await f.daemon.settle(); f.daemon.commitReady(2);
    const component = getComponent("ScopedWeathering");
    for (const id of [f.first, f.second, f.excluded]) expect(hasComponent(f.world, id, component)).toBe(false);
    expect(f.daemon.getStatus().runtime[0]?.commits).toBe(0);
  } finally { await f.finish(); }
});

test("scope revoked by an earlier commit is rechecked for the entire later batch at the same boundary", async () => {
  const f = await fixture(false, undefined, true);
  try {
    await f.activate();
    const committed: string[] = [], originalPush = f.registry.events.push.bind(f.registry.events);
    jest.spyOn(f.registry.events, "push").mockImplementation((...events) => {
      for (const event of events) if (event.type === "managed_system_changed") {
        committed.push(event.data.system); f.keys.delete(f.second);
      }
      return originalPush(...events);
    });
    runSystems(f.world, f.registry, 1, 1000); await f.daemon.settle(); f.daemon.commitReady(2);
    expect(committed).toHaveLength(1);
    const applied = committed[0].replace("System", ""), rejected = applied === "ScopedWeathering" ? "ScopedDust" : "ScopedWeathering";
    for (const id of [f.first, f.second]) {
      expect(getComponent(applied).amount[id]).toBe(1); expect(hasComponent(f.world, id, getComponent(rejected))).toBe(false);
    }
    expect(f.daemon.getStatus().runtime.filter(row => row.commits === 1)).toHaveLength(1);
    expect(f.daemon.getStatus().runtime.filter(row => row.staleResults === 1 && row.commits === 0)).toHaveLength(1);
  } finally { await f.finish(); }
});

test("accepted-history restoration uses the new host entity scope, never a serialized grant", async () => {
  const original = await fixture(true); let saved: ReturnType<typeof serializeWorld>;
  try { await original.activate(); saved = serializeWorld(original.world, original.registry); } finally { await original.finish(); }
  const world = createArgosWorld("Restored scoped world"); initializeRegistry(world);
  const registry = createSystemRegistry(), { oldToNewId } = deserializeWorld(world, registry, saved!, { strictSystems: true });
  startCommittedEvents(world);
  const first = oldToNewId.get(original.first)!, second = oldToNewId.get(original.second)!, excluded = oldToNewId.get(original.excluded)!;
  let builds = 0;
  const daemon = new CodingDaemon(world, registry, { directory: original.directory, permitsEntity: id => id === second }, async () => { builds++; });
  try {
    await daemon.initialize(); expect(builds).toBe(0);
    runSystems(world, registry, 1, 1000); await daemon.settle(); daemon.commitReady(2);
    const component = getComponent("ScopedWeathering");
    expect(component.amount[second]).toBe(1);
    expect(hasComponent(world, first, component)).toBe(false); expect(hasComponent(world, excluded, component)).toBe(false);
  } finally { daemon.stop(); await daemon.settle(); await daemon.flush(); }
});

test.each(["async", "undefined", "truthy string", "throws"])("a %s entity policy fails closed before passing any world context to the builder", async variant => {
  const invalid = variant === "async" ? (() => Promise.resolve(true)) : variant === "undefined" ? (() => undefined)
    : variant === "truthy string" ? (() => "yes") : (() => { throw new Error("Scope unavailable"); });
  const f = await fixture(false, invalid as unknown as Policy);
  try {
    await f.activate(); expect(f.context()).toBe("");
    expect(f.daemon.getStatus().jobs[0].status).toBe("rejected");
    expect(f.registry.systems.has("ScopedWeatheringSystem")).toBe(false);
  } finally { await f.finish(); }
});
