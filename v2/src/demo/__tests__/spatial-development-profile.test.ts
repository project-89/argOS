import { jest } from "@jest/globals";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "bitecs";
import { SpatialDemo } from "../spatial-demo";
import { Goal } from "../../ecs/components";
import { getCodingDaemon } from "../../engineering/coding-daemon";
import { materializeApprovedEntity } from "../../engineering/entity-materialization";
import { getSpiritSystemState } from "../../spirits/spirit-system";
import { getActiveSpirits } from "../../spirits/spirit-registry";
import { getAgentWorldCapabilities } from "../../cognition/world-capabilities";
import { DEVELOPMENT_EVOLUTION_CONFIG } from "../spatial-town-life";
const demos: SpatialDemo[] = [];
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Development profile tests are offline"));
  jest.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { for (const demo of demos.splice(0)) demo.stop(); expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
async function fixture(live = false) {
  const directory = await mkdtemp(join(tmpdir(), "argos-development-profile-"));
  const demo = await SpatialDemo.create({ scenario: "town", evolving: true, story: "coastal-mystery", live,
    development: { directory }, automaticClock: false, seconds: 1800 }); demos.push(demo); return demo;
}
test("development activates managed engineering and seven existing spirits without starting a model", async () => {
  const demo = await fixture(true), view = demo.snapshot(), daemon = getCodingDaemon(demo.sim.world)!;
  expect(view.development).toMatchObject({ enabled: true, available: false, busy: false, jobs: [], messages: [], limits: { maxBuildJobs: 8, maxRequests: 32 } });
  expect(view.limits.seconds).toBe(1800); expect(view.running).toBe(false);
  expect(daemon.getStatus().admissionBudget).toMatchObject({ limit: 8, used: 0, remaining: 8 });
  expect(getActiveSpirits(getSpiritSystemState(demo.sim.world)!.registry).map(s => s.definition.name).sort())
    .toEqual(["The Arbiter", "The Crafter", "The Narrator", "The Steward", "The Tinker", "The Watcher", "The Weaver"]);
  expect(DEVELOPMENT_EVOLUTION_CONFIG).toMatchObject({ enabledStages: ["architect", "proposals", "artificer"], allowedProposalTypes: ["entity", "system"] });
  const spirits = getSpiritSystemState(demo.sim.world)!;
  const tinker = [...spirits.registry.spirits.values()].find(s => s.definition.name === "The Tinker")! as any;
  expect(tinker.artificerConfig.autoFixEnabled).toBe(true);
  expect(tinker.artificerConfig.ignoreSystems).toContain("SpatialEmbodiment");
  expect(demo.townLife!.weather.view().remainingChanges).toBe(36);
});
test("no unrequested generic phone agenda is seeded into authored residents", async () => {
  const demo = await fixture();
  const goals = [...query(demo.sim.world, [Goal])].map(id => Goal.description[id]);
  expect(goals).not.toContain("Stay reachable while choosing how to spend my time.");
  expect(demo.snapshot().actors.filter(a => a.canText)).toHaveLength(10);
});
test("development source projection starts and revokes with the world; catalog additions join it", async () => {
  const demo = await fixture(), inputs = demo.developmentInputs!;
  expect(inputs.snapshotTargets()).toHaveLength(0);
  await demo.start(); expect(inputs.snapshotTargets().length).toBeGreaterThan(10);
  const eid = materializeApprovedEntity(demo.sim.world, { name: "Development garden specimen", description: "A newly planted ornamental specimen.", type: "object",
    roomEid: demo.byId.get("town-garden"), components: [{ name: "SpatialPlacement", values: { assetId: "plant", siteId: "garden-detail" } }] });
  inputs.syncInputs(); expect(inputs.permits(eid)).toBe(true);
  expect(demo.snapshot().entities.find(e => e.id === eid)?.asset).toBe("plant");
  expect(demo.snapshot().townLife!.changes.some(r => r.status === "applied")).toBe(true);
  demo.stop(); expect(inputs.permits(eid)).toBe(false);
  expect(demo.snapshot().development).toMatchObject({ available: false, status: "Stopped · outcomes retained" });
});
test("expanded weather still commits through its native source, timing and room gates", async () => {
  const demo = await fixture(); await demo.start();
  const weather = demo.townLife!.weather, outside = demo.byId.get("common-square")!, inside = demo.byId.get("town-cafe")!;
  expect(weather.set("rain", inside).status).toBe("rejected");
  expect(weather.set("rain", outside).status).toBe("applied");
  expect(weather.set("clear", outside).status).toBe("rejected");
  demo.advance(30_000); expect(weather.set("clear", outside).status).toBe("applied");
  expect(weather.view().remainingChanges).toBe(34);
  expect(demo.snapshot().weather?.condition).toBe("cloudy"); // Other outdoor room retained its initial weather.
  demo.stop(); expect(weather.set("rain", outside).status).toBe("rejected");
});
test("native cognition action and privacy ownership remain installed", async () => {
  const demo = await fixture(); await demo.start();
  for (const actor of demo.actors) {
    const capability = getAgentWorldCapabilities(demo.sim.world, actor)!;
    expect(capability.ownsMovement).toBe(true);
    expect(capability.context?.()).not.toContain("Current operator request");
  }
  expect(() => demo.godCommand({ text: "create another house", requestId: "bad-id" })).toThrow();
  expect(demo.snapshot().development!.messages).toEqual([]);
});
test("legacy profile cannot inherit God command or managed build authority", async () => {
  const demo = await SpatialDemo.create({ scenario: "town", evolving: true, automaticClock: false }); demos.push(demo);
  expect(demo.snapshot().development).toBeUndefined(); expect(getCodingDaemon(demo.sim.world)).toBeUndefined();
  expect(() => demo.godCommand({})).toThrow("not enabled");
  await expect(SpatialDemo.create({ scenario: "town", development: { directory: "/tmp/no-development-allocation" } })).rejects.toThrow();
});
