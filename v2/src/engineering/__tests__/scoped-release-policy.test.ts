import { describe, expect, test } from "@jest/globals";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addComponent, addEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Name } from "../../ecs/components";
import { initializeRegistry, getComponent, extendDynamicComponent } from "../../ecs/component-registry";
import { createSystemRegistry, runSystems } from "../../ecs/dynamic-systems";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { CodingDaemon, type CodingDaemonConfig } from "../coding-daemon";
import type { SystemBuilder } from "../builders";
import type { PreparedRelease } from "../release";

type Variant = "allowed" | "wider reads" | "wider writes" | "extra component";
async function packageFiles(directory: string, variant: Variant = "allowed") {
  await mkdir(join(directory, "components"), { recursive: true });
  await mkdir(join(directory, "systems"), { recursive: true });
  const fields = { value: { type: "number", default: 0 }, ...(variant === "wider writes" ? { other: { type: "number", default: 0 } } : {}) };
  await writeFile(join(directory, "components/ScopedWetness.json"), JSON.stringify({ name: "ScopedWetness", description: "Surface state", fields }));
  if (variant === "extra component") await writeFile(join(directory, "components/ExtraWeather.json"), JSON.stringify({
    name: "ExtraWeather", description: "Outside granted schema", fields: { amount: { type: "number", default: 0 } },
  }));
  await writeFile(join(directory, "systems/ScopedRain.ts"), `export function run(ctx:any):void {
    for(const id of ctx.query("Name")){ctx.attach(id,"ScopedWetness");ctx.set(id,"ScopedWetness","value",Math.min(100,ctx.get(id,"ScopedWetness","value")+ctx.deltaMs/1000));}
  }`);
  await writeFile(join(directory, "release.json"), JSON.stringify({ version: 1,
    components: ["components/ScopedWetness.json", ...(variant === "extra component" ? ["components/ExtraWeather.json"] : [])],
    systems: [{ name: "ScopedRain", description: "Bounded rate", file: "systems/ScopedRain.ts", frequency: 1,
      reads: ["Name", "ScopedWetness", ...(variant === "wider reads" ? ["Description"] : [])],
      writes: ["ScopedWetness.value", ...(variant === "wider writes" ? ["ScopedWetness.other"] : [])] }],
    tests: [0, 100].map(value => ({ name: `start ${value}`, system: "ScopedRain", entities: [{ id: 1,
      components: { Name: { value: "fixture" }, ScopedWetness: { value } } }], ticks: 1, deltaMs: 1000,
      expect: [{ entity: 1, component: "ScopedWetness", field: "value", equals: Math.min(100, value + 1) }] })),
  }));
}

function exactPolicy(release: PreparedRelease) {
  const spec = release.manifest.systems[0];
  if (release.manifest.systems.length !== 1 || spec.name !== "ScopedRain") throw Error("Policy system scope");
  if (JSON.stringify(spec.reads) !== JSON.stringify(["Name", "ScopedWetness"])) throw Error("Policy read scope");
  if (JSON.stringify(spec.writes) !== JSON.stringify(["ScopedWetness.value"])) throw Error("Policy write scope");
  if (release.components.length !== 1 || release.components[0].name !== "ScopedWetness"
    || JSON.stringify(release.components[0].fields) !== JSON.stringify({ value: { type: "number", default: 0 } }))
    throw Error("Policy schema scope");
}
async function fixture(builder: SystemBuilder = ({ directory }) => packageFiles(directory), config: Partial<CodingDaemonConfig> = {}) {
  const directory = config.directory ?? await mkdtemp(join(tmpdir(), "argos-release-scope-"));
  const world = createArgosWorld("Scoped release"); initializeRegistry(world);
  const id = addEntity(world); addComponent(world, id, Name); Name.value[id] = "Surface";
  const registry = createSystemRegistry();
  const daemon = new CodingDaemon(world, registry, { directory, validateRelease: exactPolicy, ...config }, builder);
  await daemon.initialize();
  return { directory, world, id, registry, daemon };
}

describe("host-scoped generated release admission", () => {
  test("valid candidate is checked after tests and again at activation, then runs", async () => {
    let checks = 0;
    const f = await fixture(undefined, { validateRelease: release => { checks++; exactPolicy(release); } });
    try {
      f.daemon.enqueue({ source: "The Weaver", instruction: "One surface mechanic" }); await f.daemon.pump();
      expect(checks).toBe(1); expect(f.daemon.getStatus().jobs[0].status).toBe("ready");
      expect(getComponent("ScopedWetness")).toBeUndefined();
      f.daemon.commitReady(1); expect(checks).toBe(2);
      runSystems(f.world, f.registry, 2, 1000); await f.daemon.settle(); f.daemon.commitReady(2);
      expect(f.daemon.getStatus().jobs[0].status).toBe("active");
      expect(getComponent("ScopedWetness").value[f.id]).toBe(1);
    } finally { f.daemon.stop(); await f.daemon.flush(); }
  });

  test.each<Variant>(["wider reads", "wider writes", "extra component"])("rejects %s before registering any schema or system", async variant => {
    const f = await fixture(({ directory }) => packageFiles(directory, variant));
    try {
      f.daemon.enqueue({ source: "The Weaver", instruction: "One surface mechanic" }); await f.daemon.pump(); f.daemon.commitReady(1);
      expect(f.daemon.getStatus().jobs[0]).toMatchObject({ status: "rejected", error: expect.stringContaining("Policy") });
      expect(f.registry.systems.size).toBe(0); expect(getComponent("ScopedWetness")).toBeUndefined();
      expect(getComponent("ExtraWeather")).toBeUndefined();
    } finally { f.daemon.stop(); await f.daemon.flush(); }
  });

  test("revocation between validation and commit cannot activate a ready candidate", async () => {
    let granted = true;
    const f = await fixture(undefined, { validateRelease: release => { if (!granted) throw Error("Policy revoked"); exactPolicy(release); } });
    try {
      f.daemon.enqueue({ source: "The Weaver", instruction: "One mechanic" }); await f.daemon.pump();
      expect(f.daemon.getStatus().jobs[0].status).toBe("ready"); granted = false; f.daemon.commitReady(1);
      expect(f.daemon.getStatus().jobs[0]).toMatchObject({ status: "rejected", error: expect.stringContaining("Policy revoked") });
      expect(f.registry.systems.size).toBe(0); expect(getComponent("ScopedWetness")).toBeUndefined();
    } finally { f.daemon.stop(); await f.daemon.flush(); }
  });

  test("async policy is not treated as synchronous acceptance", async () => {
    const f = await fixture(undefined, { validateRelease: async () => {} });
    try {
      f.daemon.enqueue({ source: "The Weaver", instruction: "One mechanic" }); await f.daemon.pump(); f.daemon.commitReady(1);
      expect(f.daemon.getStatus().jobs[0]).toMatchObject({ status: "rejected", error: expect.stringContaining("synchronously") });
      expect(f.registry.systems.size).toBe(0); expect(getComponent("ScopedWetness")).toBeUndefined();
    } finally { f.daemon.stop(); await f.daemon.flush(); }
  });

  test("model build JSON cannot replace or disable the host policy", async () => {
    const f = await fixture();
    try {
      expect(() => f.daemon.enqueue({ source: "The Weaver", instruction: "One mechanic", validateRelease: null } as any)).toThrow();
      expect(() => f.daemon.enqueue({ source: "The Weaver", instruction: "One mechanic", beforeCommit: null } as any)).toThrow();
      expect(() => f.daemon.enqueue({ source: "The Weaver", instruction: "One mechanic", initializeInputs: null } as any)).toThrow();
      expect(f.daemon.getStatus().jobs).toHaveLength(0);
    } finally { f.daemon.stop(); await f.daemon.flush(); }
  });

  test("host projection precedes optimistic worker freshness checks", async () => {
    let project = () => {};
    const f = await fixture(undefined, { beforeCommit: () => project() });
    try {
      f.daemon.enqueue({ source: "The Weaver", instruction: "One mechanic" }); await f.daemon.pump(); f.daemon.commitReady(1);
      runSystems(f.world, f.registry, 2, 1000); await f.daemon.settle();
      project = () => { Name.value[f.id] = "Changed input after worker snapshot"; };
      f.daemon.commitReady(2);
      expect(getComponent("ScopedWetness").value[f.id]).toBeUndefined();
      expect(f.daemon.getStatus().runtime[0].staleResults).toBe(1);
      project = () => {};
      runSystems(f.world, f.registry, 3, 1000); await f.daemon.settle(); f.daemon.commitReady(3);
      // The rejected invocation did not consume elapsed simulation time.
      expect(getComponent("ScopedWetness").value[f.id]).toBe(2);
    } finally { f.daemon.stop(); await f.daemon.flush(); }
  });

  test("host projection failure admits neither a ready release nor a pending worker effect", async () => {
    let fail = true;
    const f = await fixture(undefined, { beforeCommit: () => { if (fail) throw Error("Projection unavailable"); } });
    try {
      f.daemon.enqueue({ source: "The Weaver", instruction: "One mechanic" }); await f.daemon.pump();
      expect(() => f.daemon.commitReady(1)).toThrow("Projection unavailable");
      expect(f.registry.systems.size).toBe(0); expect(getComponent("ScopedWetness")).toBeUndefined();
      expect(f.daemon.getStatus().jobs[0].status).toBe("ready");
      fail = false; f.daemon.commitReady(1);
      runSystems(f.world, f.registry, 2, 1000); await f.daemon.settle();
      fail = true; expect(() => f.daemon.commitReady(2)).toThrow("Projection unavailable");
      expect(getComponent("ScopedWetness").value[f.id]).toBeUndefined();
      fail = false; f.daemon.commitReady(2); expect(getComponent("ScopedWetness").value[f.id]).toBe(1);
    } finally { f.daemon.stop(); await f.daemon.flush(); }
  });

  test("async host projection is rejected before pending work is applied", async () => {
    const f = await fixture(undefined, { beforeCommit: async () => {} });
    try {
      f.daemon.enqueue({ source: "The Weaver", instruction: "One mechanic" }); await f.daemon.pump();
      expect(() => f.daemon.commitReady(1)).toThrow("synchronously");
      expect(f.registry.systems.size).toBe(0); expect(getComponent("ScopedWetness")).toBeUndefined();
    } finally { f.daemon.stop(); await f.daemon.flush(); }
  });

  test.each([false, true])("previously accepted history requires the new host grant before restoration (snapshot %s)", async withSnapshot => {
    const first = await fixture();
    first.daemon.enqueue({ source: "The Weaver", instruction: "One mechanic" }); await first.daemon.pump(); first.daemon.commitReady(1);
    const snapshot = serializeWorld(first.world, first.registry); first.daemon.stop(); await first.daemon.flush();
    const world = createArgosWorld("New host"); initializeRegistry(world); const registry = createSystemRegistry();
    if (withSnapshot) deserializeWorld(world, registry, snapshot, { strictSystems: true });
    const prior = registry.systems.get("ScopedRain"), priorComponent = getComponent("ScopedWetness");
    const restored = new CodingDaemon(world, registry, { directory: first.directory, validateRelease: () => { throw Error("New host denies prior scope"); } },
      async () => { throw Error("Never rebuild during restoration"); });
    try {
      await expect(restored.initialize()).rejects.toThrow("New host denies prior scope");
      expect(registry.systems.get("ScopedRain")).toBe(prior); expect(getComponent("ScopedWetness")).toBe(priorComponent);
      if (prior) { expect(prior.compiledFn).toBeUndefined(); expect(prior.managedRestorePending).toBeDefined(); }
      expect(restored.getStatus().activeSystems).toEqual([]);
    } finally { restored.stop(); await restored.flush(); }
  });

  test("accepted history is checked at preparation and commit under an unchanged host grant", async () => {
    const first = await fixture();
    first.daemon.enqueue({ source: "The Weaver", instruction: "One mechanic" }); await first.daemon.pump(); first.daemon.commitReady(1);
    first.daemon.stop(); await first.daemon.flush(); let checks = 0;
    const restored = await fixture(async () => { throw Error("No build during restore"); }, {
      directory: first.directory, validateRelease: release => { checks++; exactPolicy(release); },
    });
    try { expect(checks).toBe(2); expect(restored.registry.systems.get("ScopedRain")?.active).toBe(true); }
    finally { restored.daemon.stop(); await restored.daemon.flush(); }
  });

  test("a rejected later release cannot partially restore earlier permitted history", async () => {
    let variant: Variant = "allowed";
    const first = await fixture(({ directory }) => packageFiles(directory, variant), { validateRelease: undefined });
    first.daemon.enqueue({ source: "Host", instruction: "First accepted release" }); await first.daemon.pump(); first.daemon.commitReady(1);
    variant = "wider reads";
    first.daemon.enqueue({ source: "Host", instruction: "Replacement with broader previous authority" }); await first.daemon.pump(); first.daemon.commitReady(2);
    expect(first.daemon.getStatus().jobs.map(job => job.status)).toEqual(["active", "active"]);
    first.daemon.stop(); await first.daemon.flush();
    const world = createArgosWorld("Constrained restore"); initializeRegistry(world); const registry = createSystemRegistry();
    const restored = new CodingDaemon(world, registry, { directory: first.directory, validateRelease: exactPolicy });
    try {
      await expect(restored.initialize()).rejects.toThrow("Policy read scope");
      expect(registry.systems.size).toBe(0); expect(getComponent("ScopedWetness")).toBeUndefined();
      expect(restored.getStatus().activeSystems).toEqual([]);
    } finally { restored.stop(); await restored.flush(); }
  });

  test("host input schemas initialize before accepted history validation and only once on successful initialization", async () => {
    const first = await fixture();
    first.daemon.enqueue({ source: "The Weaver", instruction: "One mechanic" }); await first.daemon.pump(); first.daemon.commitReady(1);
    first.daemon.stop(); await first.daemon.flush(); let initializations = 0;
    const restored = await fixture(async () => { throw Error("No rebuild during restore"); }, {
      directory: first.directory,
      initializeInputs: () => { initializations++; extendDynamicComponent({ name: "ScopedHostInput", description: "Native fixture input", properties: { exposed: "boolean" } }); },
      validateRelease: release => { expect(getComponent("ScopedHostInput")).toBeDefined(); exactPolicy(release); },
    });
    try {
      expect(initializations).toBe(1); expect(restored.registry.systems.get("ScopedRain")?.active).toBe(true);
      await restored.daemon.initialize(); expect(initializations).toBe(1);
    } finally { restored.daemon.stop(); await restored.daemon.flush(); }
  });

  test("asynchronous native input initialization fails before release replay", async () => {
    const world = createArgosWorld("Async schema denied"); initializeRegistry(world); const registry = createSystemRegistry();
    const daemon = new CodingDaemon(world, registry, { directory: await mkdtemp(join(tmpdir(), "argos-async-input-test-")), initializeInputs: async () => {} });
    try { await expect(daemon.initialize()).rejects.toThrow("synchronously"); expect(registry.systems.size).toBe(0); }
    finally { daemon.stop(); await daemon.flush(); }
  });
});
