import { jest } from "@jest/globals";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest, type Server } from "node:http";
import { hasComponent } from "bitecs";
import { SpatialDemo } from "../spatial-demo";
import { createSpatialDemoApp } from "../spatial-server";
import { createTownScenario } from "../spatial-town-fixtures";
import { TOWN_EVOLUTION_CONFIG } from "../spatial-town-life";
import { createSpatialWeatherMechanicRequest, assertSpatialWeatherMechanicRelease,
  SPATIAL_WEATHER_EXPOSURE, SPATIAL_WETNESS, SPATIAL_WEATHER_MECHANIC_SYSTEM } from "../spatial-weather-mechanic";
import { CodingDaemon, getCodingDaemon } from "../../engineering/coding-daemon";
import { createArgosWorld } from "../../ecs/world";
import { initializeRegistry, extendDynamicComponent, getComponent } from "../../ecs/component-registry";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { WorkingMemoryIdentity } from "../../ecs/components";
import { getRoomForEntity } from "../../ecs/location";
import { getAgentWorldCapabilities, getObservedStateFields } from "../../cognition/world-capabilities";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { getSpiritSystemState } from "../../spirits/spirit-system";
import type { DynamicSpiritState } from "../../spirits/spirit-factory";

const demos: SpatialDemo[] = [];
const servers: Array<{ server: Server; receiver: Awaited<ReturnType<typeof createSpatialDemoApp>> }> = [];
const token = "0123456789abcdef0123456789abcdef0123456789abcdef";
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Offline weather integration")); });
afterEach(async () => {
  for (const entry of servers.splice(0)) {
    await entry.receiver.stop(); entry.server.closeAllConnections(); await new Promise<void>(resolve => entry.server.close(() => resolve()));
  }
  for (const demo of demos.splice(0)) { demo.stop(); await getCodingDaemon(demo.sim.world)?.flush(); }
  expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli();
});
async function fixture(options: { enabled?: boolean; live?: boolean; directory?: string } = {}) {
  const directory = options.directory ?? await mkdtemp(join(tmpdir(), "argos-weather-integration-"));
  const demo = await SpatialDemo.create({ scenario: "town", evolving: true, live: options.live ?? false, automaticClock: false,
    ...(options.enabled !== false ? { weatherMechanic: { directory } } : {}) });
  demos.push(demo);
  // Never start a real coding process in an offline fixture. Accepted-store
  // tests below use explicit human-authored test code, not a model substitute.
  const daemon = getCodingDaemon(demo.sim.world); if (daemon) jest.spyOn(daemon, "start").mockImplementation(() => {});
  return { demo, daemon, directory };
}

/** Validated human-authored fixture used solely to test accepted-release
 * restoration and native integration. This is NOT generation evidence. */
async function acceptedFixtureStore() {
  const directory = await mkdtemp(join(tmpdir(), "argos-weather-accepted-fixture-"));
  const world = createArgosWorld("Weather fixture seeder"); initializeRegistry(world);
  extendDynamicComponent({ name: SPATIAL_WEATHER_EXPOSURE, description: "Host projection fixture", properties: {
    eligible: "boolean", rainRate: "number", dryRate: "number", ownerKey: "string", sourceKey: "string",
  } });
  const request = createSpatialWeatherMechanicRequest("offline-test-fixture");
  const daemon = new CodingDaemon(world, createSystemRegistry(), { directory, validateRelease: assertSpatialWeatherMechanicRelease }, async ({ directory: candidate }) => {
    await mkdir(join(candidate, "components"), { recursive: true }); await mkdir(join(candidate, "systems"), { recursive: true });
    await writeFile(join(candidate, "components/SpatialWetness.json"), JSON.stringify({ name: SPATIAL_WETNESS,
      description: "Test fixture only", fields: { value: { type: "number", default: 0 } } }));
    await writeFile(join(candidate, "systems/SpatialRainWetness.ts"), `export function run(ctx:any):void {
      for(const id of ctx.query("SpatialRainExposure")){
        if(ctx.get(id,"SpatialRainExposure","eligible")!==true)continue;
        const rain=ctx.get(id,"SpatialRainExposure","rainRate"),dry=ctx.get(id,"SpatialRainExposure","dryRate");
        if(typeof rain!=="number"||typeof dry!=="number"||rain<0||dry<0)continue;
        ctx.attach(id,"SpatialWetness");
        ctx.set(id,"SpatialWetness","value",Math.max(0,Math.min(1,ctx.get(id,"SpatialWetness","value")+(rain-dry)*ctx.deltaMs/1000)));
      }
    }`);
    await writeFile(join(candidate, "release.json"), JSON.stringify({ version: 1, components: ["components/SpatialWetness.json"],
      systems: [{ name: SPATIAL_WEATHER_MECHANIC_SYSTEM, description: "Human-authored test fixture", file: "systems/SpatialRainWetness.ts",
        frequency: 1, reads: [SPATIAL_WEATHER_EXPOSURE, SPATIAL_WETNESS], writes: ["SpatialWetness.value"] }], tests: request.acceptance }));
  });
  try {
    await daemon.initialize(); daemon.enqueue(request); await daemon.pump(); daemon.commitReady(1);
    expect(daemon.getStatus().jobs[0].status).toBe("active");
  } finally { daemon.stop(); await daemon.flush(); }
  return directory;
}
function publicScene(server: Server) {
  const address = server.address(); if (!address || typeof address === "string") throw Error("Local test server unavailable");
  return new Promise<any>((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port: address.port, path: "/api/scene", headers: { authorization: `Bearer ${token}` } }, response => {
      let text = ""; response.on("data", part => { text += part; }); response.on("end", () => resolve(JSON.parse(text)));
    }); request.on("error", reject); request.end();
  });
}

test("weather coding is explicit: ordinary town has no daemon and opt-in starts with one unspent slot", async () => {
  const ordinary = await fixture({ enabled: false }); expect(ordinary.demo.sim.getCodingStatus()).toBeNull(); expect(ordinary.demo.weatherMechanic).toBeUndefined(); ordinary.demo.stop();
  const { demo, daemon } = await fixture();
  expect(demo.running).toBe(false); expect(demo.weatherMechanic).toBeDefined();
  expect(daemon!.config.maxTotalJobs).toBe(1); expect(daemon!.config.maxQueue).toBe(1);
  expect(daemon!.config.validateRelease).toBe(assertSpatialWeatherMechanicRelease);
  expect(demo.sim.getCodingStatus()).toMatchObject({ jobs: [], admissionBudget: { limit: 1, used: 0, remaining: 1 } });
});

test("generated weather rejects unsupported profiles before starting work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "argos-weather-invalid-profile-"));
  await expect(SpatialDemo.create({ weatherMechanic: { directory } })).rejects.toThrow(/Generated weather/);
  await expect(SpatialDemo.create({ scenario: "town", weatherMechanic: { directory } })).rejects.toThrow(/Generated weather/);
  await expect(SpatialDemo.create({ scenario: "town", evolving: true, weatherMechanic: { directory: " " } })).rejects.toThrow(/Generated weather/);
  await expect(SpatialDemo.create({ scenario: "town", evolving: true, world: createTownScenario(), weatherMechanic: { directory } })).rejects.toThrow(/authored town/);
});

test("live-ready Weaver may review mechanics without authority to execute new system proposals", async () => {
  const { demo } = await fixture({ live: true });
  const spirits = getSpiritSystemState(demo.sim.world)!;
  const weaver = [...spirits.registry.spirits.values()].find(row => row.definition.name === "The Weaver") as DynamicSpiritState;
  expect(weaver.architectConfig).toMatchObject({ canProposeSystems: true, canProposeComponents: false, canProposeRules: false,
    canExecuteDirectly: false, proposalApproval: "godai", maxProposalsPerCycle: 1 });
  expect(weaver.definition.canBakeSystems).toBe(false);
  // This exact exported profile is passed to the town's coordinator; enabling
  // design review does not widen the executor's proposal-type allowlist.
  expect(TOWN_EVOLUTION_CONFIG.allowedProposalTypes).toEqual(["entity"]);
  expect(demo.sim.getEvolutionStatus().stageRuns.architect).toBe(0); expect(demo.sim.getCodingStatus()!.jobs).toEqual([]);
});

test("only identity-bound existing residents and furniture receive exposure; rain alone does not fabricate wetness", async () => {
  const { demo } = await fixture(); const exposure = getComponent(SPATIAL_WEATHER_EXPOSURE), before = demo.snapshot();
  const eligible = before.entities.filter(entity => entity.kind === "actor" || ["chair", "table", "sofa"].includes(entity.asset));
  for (const entity of before.entities) expect(hasComponent(demo.sim.world, entity.id, exposure)).toBe(eligible.includes(entity));
  expect(eligible.length).toBeGreaterThan(10);
  await demo.start(); expect(demo.sim.getCodingStatus()!.jobs).toHaveLength(1);
  const room = demo.byId.get("common-square")!;
  expect(demo.townLife!.weather.set("rain", room).status).toBe("applied"); demo.weatherMechanic!.syncInputs();
  const outside = before.actors.find(actor => getRoomForEntity(demo.sim.world, actor.id) === room)!;
  expect(exposure.ownerKey[outside.id]).toBe(outside.key); expect(exposure.sourceKey[outside.id]).toBe(demo.sourceId);
  expect(exposure.rainRate[outside.id]).toBe(.025);
  expect(demo.weatherMechanic!.view().active).toBe(false); expect(demo.weatherMechanic!.getWetness(outside.id)).toBeUndefined();
  expect(demo.snapshot().entities.some(entity => entity.wetness !== undefined)).toBe(false);
  expect(getObservedStateFields(demo.sim.world, outside.id).some(field => field.slot === "Observable.wetness")).toBe(false);
  const context = getAgentWorldCapabilities(demo.sim.world, outside.id)!.context();
  expect(context).toContain("Raindrops touch your skin and clothing"); expect(context).toContain("damp, earthy smell");
  expect(context).not.toContain("clothes feel wet");
  const inside = before.actors.find(actor => getRoomForEntity(demo.sim.world, actor.id) === demo.byId.get("willow-house"))!;
  expect(getAgentWorldCapabilities(demo.sim.world, inside.id)!.context()).not.toContain("Raindrops touch");
  WorkingMemoryIdentity.id[outside.id] = "replacement-identity"; demo.weatherMechanic!.syncInputs();
  expect(exposure.eligible[outside.id]).toBe(false); expect(exposure.rainRate[outside.id]).toBe(0);
  demo.stop(); expect(demo.weatherMechanic!.isCurrent()).toBe(false);
  for (const entity of eligible) expect(exposure.eligible[entity.id]).toBe(false);
});

test("accepted fixture restores, integrates real wetness and projects public effects without leaking private data", async () => {
  const directory = await acceptedFixtureStore(), { demo, daemon } = await fixture({ directory });
  expect(demo.sim.getCodingStatus()!.jobs).toHaveLength(1);
  expect(demo.sim.god.systemRegistry.systems.get(SPATIAL_WEATHER_MECHANIC_SYSTEM)?.managedRelease).toBeDefined();
  await demo.start(); expect(demo.sim.getCodingStatus()!.jobs).toHaveLength(1);
  const room = demo.byId.get("common-square")!, outside = demo.snapshot().actors.find(actor => getRoomForEntity(demo.sim.world, actor.id) === room)!;
  demo.townLife!.weather.set("rain", room);
  for (let i = 0; i < 12; i++) { demo.advance(500); await daemon!.settle(); daemon!.commitReady(demo.sim.world.time.tick); }
  demo.advance(100);
  expect(demo.weatherMechanic!.getWetness(outside.id)).toBeGreaterThan(.05);
  expect(getAgentWorldCapabilities(demo.sim.world, outside.id)!.context()).toContain("clothes feel damp");
  expect(getObservedStateFields(demo.sim.world, outside.id, outside.id)).toContainEqual(expect.objectContaining({ slot: "Observable.wetness", value: "damp" }));
  expect(demo.snapshot().townLife!.changes.some(row => row.id.startsWith("wetness:") && /damp/.test(row.summary))).toBe(true);
  const contact = demo.snapshot().actors.find(actor => actor.name === "Mara")!;
  expect(getObservedStateFields(demo.sim.world, contact.id, outside.id)).toEqual([]);
  demo.text(contact.key, "PRIVATE_WEATHER_MESSAGE_904"); demo.plantThought(contact.key, "PRIVATE_WEATHER_THOUGHT_904");
  const receiver = await createSpatialDemoApp({ demo, token, directory: await mkdtemp(join(tmpdir(), "argos-weather-http-fixture-")) });
  const server = receiver.app.listen(0, "127.0.0.1"); servers.push({ receiver, server });
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const scene = await publicScene(server), encoded = JSON.stringify(scene);
  expect(scene.entities.find((entity: any) => entity.id === outside.id).wetness).toBeGreaterThan(.05);
  expect(scene.weather.condition).toBe("rain");
  for (const field of ["actors", "events", "townLife", "worldControl"]) expect(scene[field]).toBeUndefined();
  for (const secret of ["PRIVATE_WEATHER_MESSAGE_904", "PRIVATE_WEATHER_THOUGHT_904", directory, "The Weaver"]) expect(encoded).not.toContain(secret);
  const lastWetness = demo.weatherMechanic!.getWetness(outside.id); demo.stop();
  expect(demo.weatherMechanic!.view().active).toBe(false); expect(demo.weatherMechanic!.isCurrent()).toBe(false);
  expect(demo.snapshot().entities.find(entity => entity.id === outside.id)!.wetness).toBe(lastWetness);
  expect(demo.snapshot().townLife!.mechanic!.status).toBe("stopped");
});
