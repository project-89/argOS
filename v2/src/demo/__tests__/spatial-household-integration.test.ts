/** Native integration checks are manual mechanics, not autonomous behavior evidence. */
import { jest } from "@jest/globals";
import { getRelationTargets, hasComponent } from "bitecs";
import { SpatialDemo } from "../spatial-demo";
import { createHouseholdScenario } from "../spatial-household";
import { createTownScenario } from "../spatial-town-fixtures";
import { Goal, GoalLifecycle, Needs, Position } from "../../ecs/components";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRoomForEntity, getDirectContainer, setLocatedIn } from "../../ecs/location";
import { HasGoal, SittingOn } from "../../ecs/relations";
import { getSpiritSystemState } from "../../spirits/spirit-system";
import { getActiveSpirits } from "../../spirits/spirit-registry";
import { describeWorldMaterialization } from "../../engineering/world-materialization-adapter";
import { materializeApprovedEntity } from "../../engineering/entity-materialization";
import type { DynamicSpiritState } from "../../spirits/spirit-factory";

const demos: SpatialDemo[] = [];
beforeEach(() => jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Offline household integration")));
afterEach(() => { for (const demo of demos.splice(0)) demo.stop(); expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
async function create(live = false) {
  const demo = await SpatialDemo.create({ scenario: "household", story: "household", evolving: true, live, automaticClock: false });
  demos.push(demo); return demo;
}
const chairSpec = (demo: SpatialDemo) => ({ name: "Indoor guest chair", description: "A chair for someone to choose to rest on.", type: "object" as const,
  roomEid: demo.byId.get("household-sitting-room")!, components: [{ name: "SpatialPlacement", values: { siteId: "household-sitting-seat", assetId: "chair" } }] });

test("household is an explicit fixed profile, not arbitrary-world execution authority", async () => {
  await expect(SpatialDemo.create({ scenario: "household", world: createHouseholdScenario() })).rejects.toThrow("substitute");
  await expect(SpatialDemo.create({ scenario: "household", evolving: true, world: createTownScenario() })).rejects.toThrow("authored");
  await expect(SpatialDemo.create({ scenario: "town", evolving: true, story: "household" })).rejects.toThrow("Story requires");
  await expect(SpatialDemo.create({ scenario: "household", evolving: true, story: "community-drama" })).rejects.toThrow("Story requires");
  await expect(SpatialDemo.create({ scenario: "household", story: "household" })).rejects.toThrow("Story requires");
  await expect(SpatialDemo.create({ scenario: "household", evolving: true, weatherMechanic: { directory: "/tmp/not-authorized" } })).rejects.toThrow("Generated weather");
});

test("four residents use existing personal intentions and fixed bounded spirit grants", async () => {
  const demo = await create(true), view = demo.snapshot();
  expect(view.scenario?.id).toBe("household"); expect(view.actors).toHaveLength(4); expect(view.rooms).toHaveLength(3);
  expect(view.townLife).toMatchObject({ enabled: true, growth: { remaining: 1 }, story: { remainingEvents: 0 } });
  expect(demo.storyEvents).toBeUndefined(); expect(demo.weatherMechanic).toBeUndefined();
  const registry = getSpiritSystemState(demo.sim.world)!.registry;
  expect(getActiveSpirits(registry).map(s => s.definition.name).sort()).toEqual(["The Arbiter", "The Narrator", "The Watcher", "The Weaver"]);
  const weaver = registry.spirits.get(registry.byName.get("The Weaver")!) as DynamicSpiritState;
  expect(weaver.architectConfig).toMatchObject({ canProposeSystems: false, canProposeRules: false, canProposeComponents: false, canExecuteDirectly: false, proposalApproval: "godai" });
  for (const actor of demo.actors) expect(getRelationTargets(demo.sim.world, actor, HasGoal).some(goal =>
    hasComponent(demo.sim.world, goal, GoalLifecycle) && GoalLifecycle.source[goal] === "personal" && GoalLifecycle.persistence[goal] === "episodic")).toBe(true);
  const profile = describeWorldMaterialization(demo.sim.world);
  expect(profile).toContain("household-sitting-seat"); expect(profile).not.toContain("cafe-extra-seat");
});

test("owning a phone is not an automatically authored communication intention", async () => {
  const demo = await create();
  for (const actor of demo.snapshot().actors) {
    const goals = getRelationTargets(demo.sim.world, actor.id, HasGoal).map(g => Goal.description[g]);
    expect(goals.some(text => /Stay connected with Alex/.test(text))).toBe(actor.name === "Mara");
    expect(goals.some(text => /Stay reachable/.test(text))).toBe(false);
  }
});

test("challenge authorizes only the existing one-job mechanic contract, not arbitrary world engineering", async () => {
  const directory = await mkdtemp(join(tmpdir(), "argos-household-mechanic-profile-"));
  const demo = await SpatialDemo.create({ scenario: "household", householdChallenge: true, evolving: true,
    story: "household", live: true, automaticClock: false, weatherMechanic: { directory } });
  demos.push(demo);
  expect(demo.snapshot().entities.filter(e => e.asset === "food")).toHaveLength(1);
  expect(demo.weatherMechanic).toBeDefined();
  expect(demo.sim.getCodingStatus()?.admissionBudget).toMatchObject({ remaining: 1 });
  expect(demo.sim.getCodingStatus()?.jobs).toHaveLength(0);
  const state = getSpiritSystemState(demo.sim.world)!;
  const weaver = state.registry.spirits.get(state.registry.byName.get("The Weaver")!) as DynamicSpiritState;
  expect(weaver.architectConfig).toMatchObject({ canProposeSystems: true, canExecuteDirectly: false,
    canProposeRules: false, canProposeComponents: false, proposalApproval: "godai" });
  await expect(SpatialDemo.create({ scenario: "town", householdChallenge: true })).rejects.toThrow("Household challenge");
});

test("one indoor chair is physically constructible and can be used without scripted goal success", async () => {
  const demo = await create(); await demo.start();
  const before = demo.snapshot(), eid = materializeApprovedEntity(demo.sim.world, chairSpec(demo));
  const chair = demo.snapshot().entities.find(e => e.id === eid)!, noor = before.actors.find(a => a.name === "Noor")!;
  expect(chair.roomId).toBe(demo.byId.get("household-sitting-room")); expect(chair.asset).toBe("chair");
  for (const roomId of ["household-kitchen", "household-sitting-room"]) {
    const room = demo.snapshot().rooms.find(r => r.id === demo.byId.get(roomId))!;
    demo.dispatch(noor.key, "move", room.key); demo.advance(30_000);
    expect(getRoomForEntity(demo.sim.world, noor.id)).toBe(room.id);
  }
  demo.dispatch(noor.key, "interact", chair.key, "sit"); demo.advance(30_000);
  expect(getRelationTargets(demo.sim.world, noor.id, SittingOn)).toContain(eid);
  expect(demo.snapshot().townLife?.growth.remaining).toBe(0);
  expect(demo.snapshot().townLife?.changes.some(c => c.status === "used")).toBe(true);
  expect(() => materializeApprovedEntity(demo.sim.world, { ...chairSpec(demo), name: "Another chair" })).toThrow();
});

test("food is finite and has a native need effect; a remembered promise is not a magic ownership lock", async () => {
  const demo = await create(); await demo.start();
  const w = demo.sim.world, noor = demo.snapshot().actors.find(a => a.name === "Noor")!;
  const food = demo.snapshot().entities.find(e => e.id === demo.byId.get("household-pear-pastry"))!;
  const kitchen = demo.snapshot().rooms.find(r => r.id === demo.byId.get("household-kitchen"))!;
  demo.dispatch(noor.key, "move", kitchen.key); demo.advance(30_000);
  expect(getRoomForEntity(w, noor.id)).toBe(kitchen.id);
  const hunger = Needs.hunger[noor.id];
  demo.dispatch(noor.key, "interact", food.key, "eat"); demo.advance(30_000);
  expect(Needs.hunger[noor.id]).toBeLessThan(hunger);
  expect(demo.snapshot().entities.some(e => e.id === food.id)).toBe(false);
  expect(demo.snapshot().entities.filter(e => e.asset === "food")).toHaveLength(1);
});

test("an occupied neighboring phone approach leaves a collision-safe alternate route", async () => {
  const demo = await create(); await demo.start();
  const w = demo.sim.world, view = demo.snapshot(), sitting = demo.byId.get("household-sitting-room")!;
  const tess = view.actors.find(a => a.name === "Tess")!, ivo = view.actors.find(a => a.name === "Ivo")!;
  const phone = view.entities.find(e => e.id === demo.byId.get("ivo-phone"))!;
  // The recorded blocking pose: separation from Ivo's old sole anchor is .35,
  // smaller than the two .18-radius bodies. Native collision remains enabled.
  Position.x[tess.id] = 3.45; Position.y[tess.id] = 4;
  setLocatedIn(w, ivo.id, sitting); Position.x[ivo.id] = 5; Position.y[ivo.id] = 5.5;
  demo.dispatch(ivo.key, "pickup", phone.key); demo.advance(30_000);
  expect(getDirectContainer(w, phone.id)).toBe(ivo.id);
  expect(Math.hypot(Position.x[tess.id] - Position.x[ivo.id], Position.y[tess.id] - Position.y[ivo.id])).toBeGreaterThanOrEqual(.36);
  expect(Position.x[tess.id]).toBe(3.45); expect(Position.y[tess.id]).toBe(4);
});

test("weather changes only the patio, cannot author a reaction, and a stopped grant cannot affect a replacement world", async () => {
  const demo = await create(); await demo.start();
  const initial = demo.snapshot().entities.filter(e => e.kind === "actor");
  expect(demo.townLife!.weather.set("rain", demo.byId.get("household-kitchen")!).status).toBe("rejected");
  expect(demo.townLife!.weather.set("rain", demo.byId.get("household-patio")!).status).toBe("applied");
  expect(demo.snapshot().weather?.condition).toBe("rain");
  expect(demo.snapshot().entities.filter(e => e.kind === "actor")).toEqual(initial);
  demo.stop();
  // The public in-process API explicitly requires sequential worlds. Concurrent
  // production worlds use process-isolated hosts, not shared component arrays.
  const other = await create(); await other.start();
  expect(demo.townLife!.weather.set("clear", demo.byId.get("household-patio")!).status).toBe("rejected");
  expect(other.snapshot().weather?.condition).toBe("clear");
});
