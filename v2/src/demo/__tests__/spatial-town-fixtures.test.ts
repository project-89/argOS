import { jest } from "@jest/globals";
import { createTownScenario } from "../spatial-town-fixtures";
import { validateSpatialScenario } from "../spatial-scenario";
import { TOWN_RESIDENTS, TOWN_SPATIAL_BLUEPRINT } from "../spatial-town";
import { SpatialDemo } from "../spatial-demo";
import { Description } from "../../ecs/components";
import { materializeApprovedEntity } from "../../engineering/entity-materialization";
import { gatherArchitectContext } from "../../spirits/architect-spirit";
import { getAgentWorldCapabilities } from "../../cognition/world-capabilities";

test("need fixture changes only authored circumstances and detaches the ordinary town", () => {
  const baseline = createTownScenario(), fixture = createTownScenario("cafe-seat-need");
  expect(validateSpatialScenario(fixture)).toEqual(fixture);
  expect(fixture.residents).toHaveLength(10);
  expect(fixture.blueprint.spawns).toEqual(baseline.blueprint.spawns);
  expect(fixture.blueprint.props).toEqual(baseline.blueprint.props.filter(p => !["cafe-seat-1", "cafe-seat-2"].includes(p.id)));
  expect(fixture.blueprint.props.some(p => p.roomId === "town-cafe" && p.assetId === "chair")).toBe(false);
  expect(fixture.blueprint.props.some(p => p.roomId !== "town-cafe" && p.assetId === "chair")).toBe(true);
  const tess = fixture.residents.find(r => r.id === "tess")!;
  expect(tess.initialGoal.description).toContain("seated break");
  expect(tess.initialObservation).toContain("no chairs here");
  expect(tess.systemPrompt).toBe(baseline.residents.find(r => r.id === "tess")!.systemPrompt);
  expect(fixture.residents.filter(r => r.id !== "tess")).toEqual(baseline.residents.filter(r => r.id !== "tess"));
  expect(JSON.stringify(tess)).not.toMatch(/cafe-extra-seat|SpatialPlacement|Weaver|God|must sit|wait until/);
  fixture.blueprint.rooms[0].name = "Mutated only in check";
  tess.aspirations.length = 0;
  expect(createTownScenario().blueprint).toEqual(TOWN_SPATIAL_BLUEPRINT);
  expect(createTownScenario().residents).toEqual(TOWN_RESIDENTS);
  expect(createTownScenario()).toEqual(baseline);
});

test("fixture installs the same native town host with no prebuilt addition or extra authority", async () => {
  const fetchSpy = jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("No network in fixture verification"));
  let demo: SpatialDemo | undefined;
  try {
    await expect(SpatialDemo.create({ townFixture: "cafe-seat-need" })).rejects.toThrow("Town fixtures");
    await expect(SpatialDemo.create({ scenario: "town", townFixture: "cafe-seat-need", world: createTownScenario() })).rejects.toThrow("Town fixtures");
    demo = await SpatialDemo.create({ scenario: "town", townFixture: "cafe-seat-need", evolving: true, live: false, automaticClock: false });
    const snapshot = demo.snapshot();
    expect(snapshot.actors).toHaveLength(10);
    expect(demo.byId.has("cafe-seat-1")).toBe(false);
    expect(demo.byId.has("cafe-seat-2")).toBe(false);
    const inspection = demo.townLife!.inspectGrowth();
    expect(inspection.builds).toEqual([]);
    expect(inspection.attempts).toBe(0);
    expect(inspection.available).toContain("cafe-extra-seat");
    inspection.available.length = 0;
    expect(demo.townLife!.inspectGrowth().available).toContain("cafe-extra-seat");
    expect(demo.sim.getEvolutionStatus().enabled).toBe(false);
    expect(snapshot.limits.autonomousGrowth).toBe(false);
    // Rooms are projected separately, not counted twice as visible entities.
    const seed = createTownScenario("cafe-seat-need").blueprint;
    expect(snapshot.entities).toHaveLength(seed.props.length + seed.walls.length + seed.spawns.length);
    expect(snapshot.rooms).toHaveLength(seed.rooms.length);
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally { demo?.stop(); fetchSpy.mockRestore(); }
});

test("cafe setting stays durable after native construction while opening observations remain historical", async () => {
  const fetchSpy = jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("No network in setting verification"));
  let demo: SpatialDemo | undefined;
  try {
    const fixture = createTownScenario("cafe-seat-need");
    const initialObservation = fixture.residents.find(r => r.id === "tess")!.initialObservation;
    expect(initialObservation).toContain("no chairs here");
    demo = await SpatialDemo.create({ scenario: "town", townFixture: "cafe-seat-need", evolving: true, live: false, automaticClock: false });
    await demo.start();
    const world = demo.sim.world, cafe = demo.byId.get("town-cafe")!;
    const description = Description.value[cafe];
    const before = await gatherArchitectContext(world, demo.sim.god.systemRegistry);
    const initialCount = before.roomInventory!.rooms.find(r => r.roomEid === cafe)!.objectCount;
    const chair = materializeApprovedEntity(world, { name: "Additional cafe chair", description: "A place to sit.", type: "object", roomEid: cafe,
      components: [{ name: "SpatialPlacement", values: { siteId: "cafe-extra-seat", assetId: "chair" } }] });
    const after = await gatherArchitectContext(world, demo.sim.god.systemRegistry);
    const current = after.roomInventory!.rooms.find(r => r.roomEid === cafe)!;
    expect(current.objectCount).toBe(initialCount + 1);
    expect(current.description).toBe(description);
    expect(current.description).not.toMatch(/no chairs|not been furnished|four ready-to-eat|two tables/i);
    expect(after.setting.entities.find(e => e.eid === cafe)?.description).toBe(description);
    const tess = demo.snapshot().actors.find(a => a.name === "Tess")!;
    expect(getAgentWorldCapabilities(world, tess.id)!.context()).toContain("Additional cafe chair");
    expect(demo.snapshot().entities.find(e => e.id === chair)).toMatchObject({ asset: "chair", roomId: cafe });
    // Do not rewrite the person's historical starting observation to claim
    // they knew the future chair. Fresh native perception supplies the change.
    expect(createTownScenario("cafe-seat-need").residents.find(r => r.id === "tess")!.initialObservation).toBe(initialObservation);
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally { demo?.stop(); fetchSpy.mockRestore(); }
});
