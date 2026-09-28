import { jest } from "@jest/globals";
const ai = await import("ai"), generate = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs } = await import("../../ecs/prefabs");
const { createSystemRegistry, registerSystem, runSystems, activateSystem, getSystemTelemetrySnapshot } = await import("../../ecs/dynamic-systems");
const { startCommittedEvents } = await import("../../runtime/committed-events");
const { createSpiritRegistry } = await import("../spirit-registry");
const { createDynamicSpirit } = await import("../spirit-factory");
const { inspectSystem, inspectAllSystems, runArtificerWithTools } = await import("../artificer-spirit");
const { createArtificerTools } = await import("../spirit-tools");
const { getTopObservations } = await import("../observation-aggregator");
function fixture(broken = true) {
  const world = createArgosWorld("Tinker native health"); initializePrefabs(world); startCommittedEvents(world);
  const registry = createSystemRegistry(), spirits = createSpiritRegistry(world);
  registerSystem(registry, { name: "FixtureCounter", description: "A public counter", pseudocode: "Increment", code: "fixture", frequency: 0,
    active: true, lastRun: 0, compiledFn: () => { if (broken) throw Error("Actual native fault"); } });
  const system = registry.systems.get("FixtureCounter")!;
  const tinker = createDynamicSpirit(spirits, { name: "The Tinker", type: "artificer", rank: "archangel", domain: "guardian" })!;
  return { world, registry, spirits, system, tinker, tick: () => runSystems(world, registry, world.time.tick++, 500) };
}
beforeEach(() => generate.mockReset());
test("the third native failure auto-disables and remains critical, not healthy", () => {
  const f = fixture(); f.tick(); expect(inspectSystem(f.registry, f.system.name)?.status).toBe("warning");
  f.tick(); f.tick(); expect(f.system.active).toBe(false);
  expect(inspectSystem(f.registry, f.system.name)).toMatchObject({ status: "critical", recommendation: "repair" });
  expect(f.registry.errors).toHaveLength(3);
});
test("listSystems cannot overwrite failed health with an active-count or erase evidence", async () => {
  const f = fixture(); f.tick(); f.tick(); f.tick(); const oldErrors = [...f.registry.errors];
  generate.mockImplementation(async input => ({ text: "", toolResults: [{ toolName: "listSystems", output: await input.tools.listSystems.execute({}) }] }));
  const report = await runArtificerWithTools(f.world, f.registry, f.spirits, f.tinker);
  expect(report).toMatchObject({ healthySystems: 0, criticalSystems: 1, repairsAttempted: [] });
  const tools = createArtificerTools(f.world, f.registry);
  await (tools.clearSystemErrors.execute as any)({ systemName: f.system.name });
  expect(f.registry.errors).toEqual(oldErrors); expect(f.registry.errorCounts.get(f.system.name)).toBe(3);
});
test("failed enable/disable tool results remain failed in reports", async () => {
  const f = fixture(false);
  generate.mockResolvedValue({ text: "", toolResults: [{ toolName: "enableSystem", output: { success: false, error: "Missing" } },
    { toolName: "disableSystem", output: { success: false, error: "Missing" } }] });
  const report = await runArtificerWithTools(f.world, f.registry, f.spirits, f.tinker);
  expect(report.repairsAttempted.map(row => row.success)).toEqual([false, false]);
});
test("native recovery invalidates old gap advice while preserving failed receipts", () => {
  const f = fixture(); f.tick(); f.tick(); f.tick(); inspectAllSystems(f.registry, [], f.world);
  expect(getTopObservations(10, f.world)).toHaveLength(1);
  f.system.compiledFn = () => {}; f.system.code = "repaired fixture"; activateSystem(f.registry, f.system.name); f.tick();
  expect(inspectSystem(f.registry, f.system.name)?.status).toBe("healthy");
  expect(getTopObservations(10, f.world)).toEqual([]); expect(f.registry.errors).toHaveLength(3);
});
test("same-named registries and replacement systems have independent telemetry", () => {
  const a = fixture(false), b = fixture(false); a.tick(); a.tick(); b.tick();
  expect(getSystemTelemetrySnapshot(a.registry)[0].runs).toBe(2); expect(getSystemTelemetrySnapshot(b.registry)[0].runs).toBe(1);
  registerSystem(a.registry, { ...a.system, compiledFn: () => {} }); expect(getSystemTelemetrySnapshot(a.registry)).toEqual([]);
});
test("successful silent repetitive systems are not defective merely for omitting logs", () => {
  const f = fixture(false); for (let n = 0; n < 20; n++) f.tick();
  expect(inspectSystem(f.registry, f.system.name)).toMatchObject({ status: "healthy", issues: [] });
  inspectAllSystems(f.registry, [], f.world); expect(getTopObservations(10, f.world)).toEqual([]);
});
test("unmanaged repair fails closed without invoking code generation", async () => {
  const f=fixture(),tools=createArtificerTools(f.world,f.registry);
  const result=await (tools.repairSystem.execute as any)({systemName:f.system.name,fixDescription:"Fix"});
  expect(result.success).toBe(false);expect(result.error).toMatch(/managed|migration/);
  expect(generate).not.toHaveBeenCalled();expect(f.system.code).toBe("fixture");
});
test("multi-step maintenance reports retain earlier queued receipts without calling them success", async () => {
  const f=fixture();
  generate.mockResolvedValue({text:"",steps:[{toolResults:[{toolName:"repairSystem",output:{systemName:f.system.name,queued:true,success:false,jobId:"job",stage:"queued"}}]},
    {toolResults:[]}],toolResults:[]});
  const report=await runArtificerWithTools(f.world,f.registry,f.spirits,f.tinker);
  expect(report.repairsAttempted).toEqual([expect.objectContaining({success:false,jobId:"job",stage:"queued",systemName:f.system.name})]);
});
test("with no generated or managed systems in scope the Tinker makes no model call", async () => {
  const f = fixture(false);
  f.tinker.artificerConfig = { ...(f.tinker.artificerConfig ?? {}), ignoreSystems: [f.system.name] } as any;
  const report = await runArtificerWithTools(f.world, f.registry, f.spirits, f.tinker);
  expect(generate).not.toHaveBeenCalled();
  expect(report).toMatchObject({ systemsInspected: 0, repairsAttempted: [], criticalSystems: 0 });
  f.tinker.artificerConfig = { ...(f.tinker.artificerConfig as any), ignoreSystems: [] };
  generate.mockResolvedValue({ text: "", toolResults: [] });
  await runArtificerWithTools(f.world, f.registry, f.spirits, f.tinker);
  expect(generate).toHaveBeenCalledTimes(1); // a system in scope is still inspected by the model
});
