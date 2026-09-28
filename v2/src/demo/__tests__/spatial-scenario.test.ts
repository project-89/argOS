import { validateSpatialScenario, spatialAgentConfig, type SpatialScenarioDefinition } from "../spatial-scenario";
import { INITIAL_SPATIAL_BLUEPRINT, SPATIAL_WORLD_BOUNDS } from "../spatial-catalog";

function fixture(): SpatialScenarioDefinition {
  return {
    id: "test-neighborhood", title: "A small place", blueprint: structuredClone(INITIAL_SPATIAL_BLUEPRINT),
    bounds: { ...SPATIAL_WORLD_BOUNDS }, maxWorldEntities: 200,
    residents: INITIAL_SPATIAL_BLUEPRINT.spawns.map(s => ({ id: s.id, name: s.name, role: "resident",
      startRoomId: s.roomId, startRoom: "Apartment", homeRoomId: "apartment", assetId: s.assetId,
      aspirations: ["Know my neighbors"], appearance: { age: "adult" }, needs: { hunger: 40, energy: 75 },
      initialGoal: { description: "Find somewhere comfortable to sit", priority: 5 },
      ...(s.id === "mara" ? { phoneId: "maras-phone", phoneContact: { name: "Alex", description: "Keep in touch", memory: "Alex helped me move here." } } : {}) })),
  };
}

test("scenario preflight returns detached complete data, not an alternate controller", () => {
  const original = fixture(), value = validateSpatialScenario(original);
  value.residents[0].aspirations[0] = "Changed"; value.blueprint.rooms[0].description = "Changed";
  expect(original.residents[0].aspirations).toEqual(["Know my neighbors"]);
  expect(original.blueprint.rooms[0].description).not.toBe("Changed");
  expect(spatialAgentConfig(original.residents[0])).toEqual({ name: "Mara", role: "resident", startRoom: "Apartment",
    description: undefined, systemPrompt: undefined, past: undefined });
});

test("explicit town navigation resolution admits bounded land without changing the legacy default", () => {
  const legacy = fixture();
  expect(validateSpatialScenario(legacy).navigationCellSize).toBeUndefined();
  const larger = fixture(); larger.bounds = { minX: 0, minY: 0, maxX: 48, maxY: 36 };
  expect(() => validateSpatialScenario(larger)).toThrow("bounded spatial grid");
  larger.navigationCellSize = .5;
  expect(validateSpatialScenario(larger).navigationCellSize).toBe(.5);
  expect(validateSpatialScenario(larger).bounds).toEqual(larger.bounds);
});

test("building presentation is bound to a native indoor footprint and its real front entrance", () => {
  const value = fixture(), house = value.blueprint.rooms[0];
  house.environment = "indoor";
  house.building = { style: "cottage", wallColor: "#e1c5a0", roofColor: "#786258", front: "south" };
  expect(validateSpatialScenario(value).blueprint.rooms[0].building).toEqual(house.building);
  house.building.front = "north";
  expect(() => validateSpatialScenario(value)).toThrow("real installed entrance");
  house.building.front = "south"; house.environment = "outdoor";
  expect(() => validateSpatialScenario(value)).toThrow("indoor native footprint");
});

test("a passage admitted on the fine grid cannot silently strand actors on a coarse grid", () => {
  const value = fixture();
  value.blueprint.walls.push(
    { id: "fine-gap-left", roomId: "apartment", position: { x: 1.5, y: 4.5 }, halfWidth: 1.5, halfDepth: .08, height: 2.5 },
    { id: "fine-gap-right", roomId: "apartment", position: { x: 5.8, y: 4.5 }, halfWidth: 2.2, halfDepth: .08, height: 2.5 },
  );
  expect(() => validateSpatialScenario(value)).not.toThrow();
  value.navigationCellSize = .5;
  expect(() => validateSpatialScenario(value)).toThrow("selected navigation resolution");
});

test.each([
  ["missing resident", (v: SpatialScenarioDefinition) => { v.residents.pop(); }],
  ["duplicate resident", (v: SpatialScenarioDefinition) => { v.residents[1] = v.residents[0]; }],
  ["unmatched start", (v: SpatialScenarioDefinition) => { v.residents[0].startRoom = "Imagined town"; }],
  ["unmatched mesh", (v: SpatialScenarioDefinition) => { v.residents[0].assetId = "actor-ivo"; }],
  ["unmatched home", (v: SpatialScenarioDefinition) => { v.residents[0].homeRoomId = "unbuilt-house"; }],
  ["unknown phone", (v: SpatialScenarioDefinition) => { v.residents[0].phoneId = "unbuilt-phone"; }],
  ["shared phone", (v: SpatialScenarioDefinition) => { v.residents[1].phoneId = "maras-phone"; }],
  ["relationship without device", (v: SpatialScenarioDefinition) => { delete v.residents[0].phoneId; }],
  ["nonfinite need", (v: SpatialScenarioDefinition) => { v.residents[0].needs.energy = NaN; }],
  ["out of range need", (v: SpatialScenarioDefinition) => { v.residents[0].needs.hunger = 101; }],
  ["no aspirations", (v: SpatialScenarioDefinition) => { v.residents[0].aspirations = []; }],
  ["empty intention", (v: SpatialScenarioDefinition) => { v.residents[0].initialGoal.description = " "; }],
  ["ambiguous target name", (v: SpatialScenarioDefinition) => { v.blueprint.props[0].name = "mara"; }],
  ["out of bounds room", (v: SpatialScenarioDefinition) => { v.bounds.maxX = 7; }],
  ["excess navigation cost", (v: SpatialScenarioDefinition) => { v.bounds.maxX = 128; v.bounds.maxY = 128; }],
  ["unsupported navigation resolution", (v: SpatialScenarioDefinition) => { v.navigationCellSize = 2 as .5; }],
  ["oversized coarse grid", (v: SpatialScenarioDefinition) => { v.navigationCellSize = .5; v.bounds.maxX = 128; v.bounds.maxY = 128; }],
  ["unbounded construction", (v: SpatialScenarioDefinition) => { v.maxWorldEntities = Infinity; }],
  ["insufficient seed budget", (v: SpatialScenarioDefinition) => { v.maxWorldEntities = 5; }],
] as const)("invalid %s is rejected without native allocation", (_name, mutate) => {
  const value = fixture(); mutate(value); expect(() => validateSpatialScenario(value)).toThrow();
});
