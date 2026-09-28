import { jest } from "@jest/globals";
import { hasComponent, query } from "bitecs";
import { SpatialDemo } from "../spatial-demo";
import { TOWN_EVOLUTION_CONFIG } from "../spatial-town-life";
import { materializeApprovedEntity } from "../../engineering/entity-materialization";
import { describeWorldMaterialization } from "../../engineering/world-materialization-adapter";
import { Name, ObjectType, PhysicalObject, Position, Surface } from "../../ecs/components";
import { getSpiritSystemState } from "../../spirits/spirit-system";
import { getActiveSpirits } from "../../spirits/spirit-registry";
import type { DynamicSpiritState } from "../../spirits/spirit-factory";
import { publishCommittedEvent } from "../../runtime/committed-events";
import { beginArchitectDiagnostics } from "../../spirits/architect-diagnostics";

const demos: SpatialDemo[] = [];
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("No network in offline town integration")); });
afterEach(() => { for (const demo of demos.splice(0)) demo.stop(); expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
async function fixture() { const demo = await SpatialDemo.create({ scenario: "town", evolving: true, live: false, automaticClock: false }); demos.push(demo); return demo; }
const spec = (demo: SpatialDemo, siteId = "cafe-extra-seat", room = "town-cafe", assetId = "chair", name = "A quiet extra chair") => ({
  name, description: "An ordinary furnishing for a resident to choose to use.", type: "object" as const, roomEid: demo.byId.get(room)!,
  components: [{ name: "SpatialPlacement", values: { siteId, assetId } }],
});

test("opt-in manual profile is honest, grants no AI, and does not broaden other worlds", async () => {
  await expect(SpatialDemo.create({ evolving: true })).rejects.toThrow("authored town");
  const demo = await fixture(), view = demo.snapshot();
  expect(view.townLife).toMatchObject({ enabled: false, growth: { remaining: 4 }, weather: { condition: "clear", revision: 0 } });
  expect(view.limits.autonomousGrowth).toBe(false);
  expect(view.weather?.rooms).toHaveLength(2);
  expect(demo.sim.getEvolutionStatus().enabled).toBe(false);
  expect(TOWN_EVOLUTION_CONFIG).toMatchObject({ enabledStages: ["architect", "proposals"], stageRunLimits: { architect: 4 },
    architectNames: ["The Weaver"], autoApproveProposals: false, maxProposalExecutions: 1 });
  expect(describeWorldMaterialization(demo.sim.world)).toContain("cafe-extra-seat");
  expect(() => materializeApprovedEntity(demo.sim.world, spec(demo))).toThrow("no longer ready");
  beginArchitectDiagnostics(demo.sim.world, 0)({ stage: "needs", outcome: "completed", candidates: 2, admitted: 0 });
  const reviewed = demo.snapshot().townLife!;
  expect(reviewed.changes).toEqual([expect.objectContaining({ spirit: "The Weaver", status: "observed", summary: expect.stringContaining("2 suggestions, 0 admitted") })]);
  expect(reviewed.growth.remaining).toBe(4);
});

test("live-ready profile installs the existing hierarchy with only bounded grants, before any provider call", async () => {
  const demo = await SpatialDemo.create({ scenario: "town", evolving: true, live: true, automaticClock: false }); demos.push(demo);
  const system = getSpiritSystemState(demo.sim.world)!;
  expect(getActiveSpirits(system.registry).map(s => s.definition.name).sort()).toEqual(["The Arbiter", "The Narrator", "The Watcher", "The Weaver"]);
  const weaver = system.registry.spirits.get(system.registry.byName.get("The Weaver")!) as DynamicSpiritState;
  expect(weaver.definition.observationInterval).toBe(Number.MAX_SAFE_INTEGER);
  expect(weaver.architectConfig).toMatchObject({ canProposeSystems: false, canProposeComponents: false,
    canExecuteDirectly: false, proposalApproval: "godai", maxProposalsPerCycle: 1 });
  expect(demo.snapshot().townLife?.enabled).toBe(true);
  expect(demo.sim.getEvolutionStatus()).toMatchObject({ enabled: true, stageRuns: { architect: 0 } });
});

test("real full-town geometry admits all four additions through the existing native constructor", async () => {
  const demo = await fixture(); await demo.start();
  const before = demo.snapshot(), actorsBefore = before.entities.filter(e => e.kind === "actor").map(e => e.position);
  const cases = [
    ["cafe-extra-seat", "town-cafe", "chair"], ["workshop-corner", "town-workshop", "lamp"],
    ["park-gathering", "common-square", "table"], ["garden-detail", "town-garden", "plant"],
  ];
  const times: number[] = [];
  for (const [site, room, asset] of cases) {
    const began = performance.now(), eid = materializeApprovedEntity(demo.sim.world, spec(demo, site, room, asset, `New ${asset}`));
    times.push(performance.now() - began);
    expect(hasComponent(demo.sim.world, eid, PhysicalObject)).toBe(true);
    expect(demo.snapshot().entities.find(e => e.id === eid)).toMatchObject({ asset, roomId: demo.byId.get(room) });
    expect(ObjectType.typeId[eid]).toBeTruthy();
    expect(PhysicalObject.portable[eid]).toBe(false);
    expect(Number.isFinite(Position.x[eid])).toBe(true);
    if (asset === "table") expect(hasComponent(demo.sim.world, eid, Surface)).toBe(true);
  }
  console.log("Full-town validated build milliseconds", times);
  const after = demo.snapshot();
  expect(after.entities.length).toBe(before.entities.length + 4);
  expect(after.entities.filter(e => e.kind === "actor").map(e => e.position)).toEqual(actorsBefore);
  expect(after.townLife?.growth.remaining).toBe(0);
  expect(after.townLife?.changes.filter(e => e.status === "applied")).toHaveLength(4);
  expect(after.townLife?.changes.some(e => e.status === "used")).toBe(false);
  const tess = after.actors.find(a => a.name === "Tess")!, chair = after.entities.find(e => e.name === "New chair")!;
  // A receipt-classification fixture is not credited as autonomous NPC use.
  publishCommittedEvent(demo.sim.world, { kind: "action", action: "move", status: "succeeded", actorId: tess.id,
    targetId: chair.id, roomId: chair.roomId, executionId: "classification-only-approach" });
  expect(demo.snapshot().townLife?.changes.some(e => e.status === "observed")).toBe(true);
  expect(demo.snapshot().townLife?.changes.some(e => e.status === "used")).toBe(false);
  demo.dispatch(tess.key, "interact", chair.key, "sit"); demo.advance(10_000);
  expect(demo.snapshot().townLife?.changes.filter(e => e.status === "used")).toHaveLength(1);
});

test("unsupported growth and stopped work cannot allocate invisible objects or rooms", async () => {
  const demo = await fixture(); await demo.start();
  const count = [...query(demo.sim.world, [Name])].length;
  expect(() => materializeApprovedEntity(demo.sim.world, { name: "Invisible restaurant", description: "Invented", type: "room", components: [] })).toThrow();
  expect(() => materializeApprovedEntity(demo.sim.world, spec(demo, "cafe-extra-seat", "town-cafe", "food"))).toThrow();
  expect([...query(demo.sim.world, [Name])]).toHaveLength(count);
  demo.stop();
  expect(() => materializeApprovedEntity(demo.sim.world, spec(demo))).toThrow("no longer current");
  expect(describeWorldMaterialization(demo.sim.world)).toBe("");
});

test("public weather is native outdoor state and never drives bodies or fabricates NPC decisions", async () => {
  const demo = await fixture(); await demo.start();
  const room = demo.byId.get("common-square")!, indoor = demo.byId.get("town-cafe")!;
  const before = demo.snapshot().entities.filter(e => e.kind === "actor");
  expect(demo.townLife!.weather.set("rain", indoor).status).toBe("rejected");
  expect(demo.townLife!.weather.set("rain", room).status).toBe("applied");
  const after = demo.snapshot();
  expect(after.weather).toMatchObject({ condition: "rain", revision: 1, changedAtSimMs: 0 });
  expect(after.weather?.rooms.find(r => r.roomId === indoor)).toBeUndefined();
  expect(after.entities.filter(e => e.kind === "actor")).toEqual(before);
  expect(after.townLife?.changes.filter(e => e.spirit === "The Narrator")).toHaveLength(1);
  expect(demo.townLife!.weather.set("cloudy", room).status).toBe("rejected");
  demo.stop();
  expect(demo.townLife!.weather.set("clear", room).status).toBe("rejected");
});

test("operator story incidents are not credited to the Narrator, while native clearing remains a resident outcome", async () => {
  const demo = await SpatialDemo.create({ scenario: "town", evolving: true, story: "coastal-mystery", live: false, automaticClock: false });
  demos.push(demo); await demo.start();
  const initial = demo.snapshot(), person = initial.actors.find(a => a.name === "Eli")!;
  const tree = initial.entities.find(e => e.id === demo.byId.get("square-tree-3"))!;
  expect(demo.storyEvents!.damage(tree.name, tree.roomId, undefined, "operator")).toMatchObject({ status: "applied", origin: "operator" });
  const damageId = `story:${tree.id}:1:tree_damage`;
  expect(demo.snapshot().townLife?.changes.find(row => row.id === damageId)).toMatchObject({ spirit: "God · operator test", status: "applied" });
  expect(demo.snapshot().townLife?.changes.some(row => row.spirit === "The Narrator")).toBe(false);
  // Explicit dispatch exercises attribution through a real native outcome;
  // this offline test does not claim an autonomous choice.
  demo.dispatch(person.key, "interact", tree.key, "clear_branches");
  while (demo.atSimMs < 40_000 && demo.storyEvents!.view().trees.find(row => row.id === tree.id)?.phase !== "pruned") demo.advance(100);
  expect(demo.storyEvents!.view().trees.find(row => row.id === tree.id)?.phase).toBe("pruned");
  expect(demo.snapshot().townLife?.changes.find(row => row.id === `story:${tree.id}:2:tree_cleared`)).toMatchObject({ spirit: "Residents", status: "applied" });
  demo.advance(60_000); demo.advance(30_000);
  const other = demo.storyEvents!.view().trees.find(row => row.phase === "normal")!;
  expect(demo.storyEvents!.capture().execute({ operation: "tree_damage", tree: other.name }, other.roomId)).toMatchObject({ status: "applied", origin: "narrator" });
  expect(demo.snapshot().townLife?.changes.find(row => row.id === `story:${other.id}:1:tree_damage`)).toMatchObject({ spirit: "The Narrator", status: "applied" });
});
