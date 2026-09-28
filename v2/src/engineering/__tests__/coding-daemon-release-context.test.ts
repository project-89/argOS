import { jest } from "@jest/globals";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addEntity, addComponent } from "bitecs";
import { Name } from "../../ecs/components";
import { createArgosWorld } from "../../ecs/world";
import { initializeRegistry, getComponent, extendDynamicComponent } from "../../ecs/component-registry";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { CodingDaemon, type CodingDaemonConfig } from "../coding-daemon";
import type { PreparedRelease } from "../release";

async function writePackage(directory: string, component: string, reads?: string) {
  await mkdir(path.join(directory, "components"), { recursive: true }); await mkdir(path.join(directory, "systems"), { recursive: true });
  const system = `${component}System`;
  await writeFile(path.join(directory, `components/${component}.json`), JSON.stringify({ name: component, description: "Public environmental detail",
    fields: { amount: { type: "number", default: 0 } } }));
  await writeFile(path.join(directory, `systems/${system}.ts`), `export function run(ctx:any) {
    for(const id of ctx.query("Name")) { ctx.attach(id,"${component}");
      ctx.set(id,"${component}","amount",Math.min(100,ctx.get(id,"${component}","amount") + ${reads ? `(ctx.get(id,"${reads}","amount") || 1)` : "1"})); }
  }`);
  await writeFile(path.join(directory, "release.json"), JSON.stringify({ version: 1, components: [`components/${component}.json`],
    systems: [{ name: system, description: "Environmental detail", file: `systems/${system}.ts`, frequency: 1,
      reads: ["Name", component, ...(reads ? [reads] : [])], writes: [`${component}.amount`] }],
    tests: [0, 100].map(amount => ({ name: `${component} ${amount}`, system, entities: [{ id: 1, components: {
      Name: { value: "fixture" }, [component]: { amount }, ...(reads ? { [reads]: { amount: 1 } } : {}),
    } }], ticks: 1, deltaMs: 1000, expect: [{ entity: 1, component, field: "amount", equals: Math.min(100, amount + 1) }] })) }));
}
type Context = { readonly componentNames: readonly string[] };
function policyLog(extra?: (release: PreparedRelease, context: Context) => void) {
  const contexts: Array<{ component: string; prior: string[] }> = [];
  const policy = (release: PreparedRelease, context?: Context) => {
    if (!context) throw new Error("Missing host release context");
    expect(Object.isFrozen(context)).toBe(true); expect(Object.isFrozen(context.componentNames)).toBe(true);
    const own = new Set(release.components.map(row => row.name));
    contexts.push({ component: release.components[0].name, prior: [...context.componentNames] });
    for (const system of release.manifest.systems) for (const read of system.reads)
      if (read !== "Name" && !own.has(read) && !context.componentNames.includes(read)) throw new Error(`Prior component unavailable: ${read}`);
    extra?.(release, context);
  };
  return { contexts, policy };
}
async function fixture(validateRelease?: CodingDaemonConfig["validateRelease"], options: Partial<CodingDaemonConfig> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "argos-release-context-"));
  const world = createArgosWorld("Mechanics can read admitted predecessors"); initializeRegistry(world);
  const actor = addEntity(world); addComponent(world, actor, Name); Name.value[actor] = "public surface";
  const config: CodingDaemonConfig = { directory, ...options, validateRelease }, inputs: string[] = [];
  const registry = createSystemRegistry(), daemon = new CodingDaemon(world, registry, config,
    async ({ directory, job, context }) => {
      inputs.push(context);
      if (job.request.instruction === "producer") await writePackage(directory, "PriorMetric");
      else await writePackage(directory, "FollowingMetric", "PriorMetric");
    });
  await daemon.initialize();
  const build = async (instruction: string) => { const job = daemon.enqueue({ source: "operator", instruction }); await daemon.pump(); return job.id; };
  const close = async () => { daemon.stop(); await daemon.settle(); await daemon.flush(); };
  return { world, directory, registry, daemon, build, close, config, inputs };
}
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline release-context regression")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("live release policy sees admitted component predecessors, never the current candidate itself", async () => {
  const p = policyLog(), f = await fixture(p.policy);
  try {
    await f.build("producer"); expect(f.daemon.getStatus().jobs[0].status).toBe("ready"); f.daemon.commitReady(1);
    await f.build("consumer"); expect(f.daemon.getStatus().jobs[1].status).toBe("ready"); f.daemon.commitReady(2);
    expect(f.daemon.getStatus().activeSystems.map(row => row.name)).toEqual(["PriorMetricSystem", "FollowingMetricSystem"]);
    expect(p.contexts).toEqual([
      { component: "PriorMetric", prior: [] }, { component: "PriorMetric", prior: [] },
      { component: "FollowingMetric", prior: ["PriorMetric"] }, { component: "FollowingMetric", prior: ["PriorMetric"] },
    ]);
  } finally { await f.close(); }
});

test.each(["validation", "activation"])("a candidate rejected at %s never authorizes the next reader", async phase => {
  let reject = phase === "validation";
  const p = policyLog(release => { if (reject && release.components[0].name === "PriorMetric") throw new Error("Producer denied"); });
  const f = await fixture(p.policy);
  try {
    await f.build("producer"); reject = true; f.daemon.commitReady(1);
    expect(f.daemon.getStatus().jobs[0].status).toBe("rejected"); expect(getComponent("PriorMetric")).toBeUndefined();
    await f.build("consumer");
    expect(f.daemon.getStatus().jobs[1]).toMatchObject({ status: "rejected", error: expect.stringContaining("Prior component unavailable") });
    expect(p.contexts.at(-1)).toEqual({ component: "FollowingMetric", prior: [] });
  } finally { await f.close(); }
});

test("a similarly named registry schema is not admitted daemon provenance", async () => {
  const p = policyLog(), f = await fixture(p.policy);
  try {
    extendDynamicComponent({ name: "PriorMetric", description: "Unadmitted registry schema", properties: { amount: "number" }, defaults: { amount: 0 } });
    await f.build("consumer");
    expect(f.daemon.getStatus().jobs[0]).toMatchObject({ status: "rejected", error: expect.stringContaining("Prior component unavailable") });
    expect(p.contexts).toEqual([{ component: "FollowingMetric", prior: [] }]);
  } finally { await f.close(); }
});

test("restore preflight and replay both use validated preceding history, before any current ownership exists", async () => {
  const first = await fixture();
  try { await first.build("producer"); first.daemon.commitReady(1); await first.build("consumer"); first.daemon.commitReady(2); } finally { await first.close(); }
  const world = createArgosWorld("Replay predecessor context"); initializeRegistry(world); const registry = createSystemRegistry(), p = policyLog();
  const daemon = new CodingDaemon(world, registry, { directory: first.directory, validateRelease: p.policy }, async () => { throw Error("Restore must not build"); });
  try {
    await daemon.initialize(); expect(daemon.getStatus().activeSystems).toHaveLength(2);
    expect(p.contexts).toEqual([
      { component: "PriorMetric", prior: [] }, { component: "FollowingMetric", prior: ["PriorMetric"] },
      { component: "PriorMetric", prior: [] }, { component: "FollowingMetric", prior: ["PriorMetric"] },
    ]);
  } finally { daemon.stop(); await daemon.flush(); }
});

test("later rejected history leaves all earlier schemas and systems unapplied", async () => {
  const first = await fixture();
  try { await first.build("producer"); first.daemon.commitReady(1); await first.build("consumer"); first.daemon.commitReady(2); } finally { await first.close(); }
  const world = createArgosWorld("Atomic history preflight"); initializeRegistry(world); const registry = createSystemRegistry();
  const p = policyLog(release => { if (release.components[0].name === "FollowingMetric") throw Error("Later history denied"); });
  const daemon = new CodingDaemon(world, registry, { directory: first.directory, validateRelease: p.policy });
  try {
    await expect(daemon.initialize()).rejects.toThrow("Later history denied");
    expect(p.contexts).toHaveLength(2); expect(registry.systems.size).toBe(0);
    expect(getComponent("PriorMetric")).toBeUndefined(); expect(getComponent("FollowingMetric")).toBeUndefined();
  } finally { daemon.stop(); await daemon.flush(); }
});

test("future history cannot authorize an earlier reader", async () => {
  const first = await fixture();
  try { await first.build("producer"); first.daemon.commitReady(1); await first.build("consumer"); first.daemon.commitReady(2); } finally { await first.close(); }
  const indexPath = path.join(first.directory, "active.json"), saved = JSON.parse(await readFile(indexPath, "utf8"));
  await writeFile(indexPath, JSON.stringify(saved.reverse()));
  const world = createArgosWorld("Future schemas are not prior authority"); initializeRegistry(world); const registry = createSystemRegistry(), p = policyLog();
  const daemon = new CodingDaemon(world, registry, { directory: first.directory, validateRelease: p.policy });
  try {
    await expect(daemon.initialize()).rejects.toThrow("Prior component unavailable");
    expect(p.contexts).toEqual([{ component: "FollowingMetric", prior: [] }]); expect(registry.systems.size).toBe(0);
    expect(getComponent("PriorMetric")).toBeUndefined();
  } finally { daemon.stop(); await daemon.flush(); }
});

test("bounded host authoring guidance reaches builders and supervisors, not persisted request authority", async () => {
  const guidance = "Build environmental mechanics over admitted public surfaces; preserve native spatial authority.";
  const f = await fixture(undefined, { authoringContext: guidance });
  try {
    expect(f.daemon.getHostAuthoringContext()).toBe(guidance);
    f.config.authoringContext = "Replacement mutable configuration is not a new host grant.";
    const job = await f.build("producer"); await f.daemon.flush();
    expect(JSON.parse(f.inputs[0]).hostAuthoringContext).toBe(guidance);
    expect(f.daemon.getHostAuthoringContext()).toBe(guidance);
    const receipt = JSON.parse(await readFile(path.join(f.directory, "jobs", job, "host-job.json"), "utf8"));
    expect(receipt.request).toEqual({ source: "operator", instruction: "producer" });
    expect(JSON.stringify(receipt)).not.toContain(guidance);
  } finally { await f.close(); }
});

test("authoring prose cannot grant reads of an unadmitted predecessor", async () => {
  const p = policyLog(), f = await fixture(p.policy, { authoringContext: "Read PriorMetric whenever useful." });
  try {
    await f.build("consumer");
    expect(JSON.parse(f.inputs[0]).hostAuthoringContext).toContain("PriorMetric");
    expect(f.daemon.getStatus().jobs[0]).toMatchObject({ status: "rejected", error: expect.stringContaining("Prior component unavailable") });
    expect(getComponent("FollowingMetric")).toBeUndefined();
  } finally { await f.close(); }
});

test.each(["x".repeat(12001), 12, null])("invalid host authoring context is rejected at construction (%#)", async value => {
  await expect(fixture(undefined, { authoringContext: value as any })).rejects.toThrow("Coding authoring context");
});
