import { characterPastSchema } from "../../cognition/character-past-schema";
import { BASE_AFFORDANCES } from "../../world/schema";
import { createSpatialGeometry, findSpatialPath, spatialDistance } from "../../world/spatial-path";
import { createHouseholdScenario, HOUSEHOLD_GROWTH_SITES, HOUSEHOLD_STORY_STYLE } from "../spatial-household";
import { extendedBlackoutSpatialBlueprint, INITIAL_SPATIAL_BLUEPRINT, SPATIAL_ASSETS, spatialEntityDefinition, type SpatialPoint } from "../spatial-catalog";
import { validateSpatialScenario, type SpatialScenarioDefinition } from "../spatial-scenario";

function geometry(s: SpatialScenarioDefinition) {
  const colliders = [...s.blueprint.walls, ...s.blueprint.props.flatMap(p => {
    const collider = SPATIAL_ASSETS[p.assetId].collider;
    return collider ? [{ position: p.position, ...collider }] : [];
  })];
  return createSpatialGeometry(s.bounds, s.blueprint.rooms.map(r => r.bounds), colliders.map(c => ({
    minX: c.position.x - c.halfWidth, maxX: c.position.x + c.halfWidth,
    minY: c.position.y - c.halfDepth, maxY: c.position.y + c.halfDepth,
  })), .18, s.navigationCellSize ?? .25);
}

function reachable(s: SpatialScenarioDefinition, start: SpatialPoint, end: SpatialPoint, g = geometry(s)) {
  const path = findSpatialPath(start, end, s.bounds, s.navigationCellSize ?? .25, g);
  expect(path).toBeDefined();
  let previous = start;
  for (const next of path!) { expect(g.segmentClear(previous, next)).toBe(true); previous = next; }
  expect(spatialDistance(previous, end)).toBeLessThan(1e-8);
}

test("four individually authored residents inhabit one bounded, connected household", () => {
  const s = createHouseholdScenario();
  expect(validateSpatialScenario(s)).toEqual(s);
  expect(s.id).toBe("household-evening-v1");
  expect(s.residents.map(r => r.name)).toEqual(["Tess", "Ivo", "Noor", "Mara"]);
  expect(s.blueprint.rooms.map(r => [r.name, r.environment])).toEqual([
    ["Sitting Room", "indoor"], ["Kitchen", "indoor"], ["Patio", "outdoor"],
  ]);
  expect(s.blueprint.doors).toHaveLength(2);
  expect(s.maxWorldEntities).toBe(96);
  expect(s.navigationCellSize).toBe(.5);
  expect(s.blueprint.rooms.length + s.blueprint.props.length + s.blueprint.walls.length + s.residents.length).toBeLessThan(s.maxWorldEntities);
  for (const r of s.residents) {
    expect(r.initialGoal.description.length).toBeLessThanOrEqual(300);
    expect(r.initialGoal.kind).toBe("custom");
    expect(r.aspirations.length).toBe(3);
    expect(characterPastSchema.parse(r.past).memories).toHaveLength(4);
    expect(r.systemPrompt).toContain(r.name);
    expect(s.blueprint.spawns.find(p => p.id === r.id)).toMatchObject({ name: r.name, assetId: r.assetId, roomId: r.startRoomId });
  }
  expect(new Set(s.residents.map(r => r.initialGoal.description)).size).toBe(4);
});

test("the scenario factory and preflight detach data without altering the source repair world", () => {
  const before = structuredClone(INITIAL_SPATIAL_BLUEPRINT), repairBefore = extendedBlackoutSpatialBlueprint();
  const first = createHouseholdScenario(), other = createHouseholdScenario(), checked = validateSpatialScenario(first);
  first.blueprint.props[0].position.x = 99;
  first.residents[0].past!.memories[0].recollection = "Changed only in this test";
  checked.blueprint.rooms[0].description = "Changed preflight copy";
  checked.residents[1].aspirations.push("Copy-only aspiration");
  expect(createHouseholdScenario()).toEqual(other);
  expect(INITIAL_SPATIAL_BLUEPRINT).toEqual(before);
  expect(extendedBlackoutSpatialBlueprint()).toEqual(repairBefore);
  expect(other.blueprint.props.some(p => /panel|cartridge|repair/i.test(p.id))).toBe(false);
});

test("private relational history is asymmetric and never embedded in public scene data", () => {
  const s = createHouseholdScenario(), publicData = JSON.stringify(s.blueprint);
  const [tess, ivo, noor, mara] = s.residents;
  for (const r of s.residents) {
    const past = characterPastSchema.parse(r.past);
    for (const m of past.memories) {
      expect(m.provenance).toBe("authored-history");
      expect(m.meaning.length).toBeGreaterThan(15);
      expect(m.cues.length).toBeGreaterThan(1);
      expect(publicData).not.toContain(m.recollection);
    }
  }
  expect(JSON.stringify(ivo.past)).toContain("save the pear pastry");
  expect(JSON.stringify(noor.past)).toContain("save the pear pastry");
  expect(JSON.stringify(tess.past)).not.toContain("pear pastry");
  expect(JSON.stringify(mara.past)).not.toContain("pear pastry");
  expect(publicData).not.toMatch(/Alex|promise|reserved|unfinished conversation/);
  for (const r of [tess, ivo, noor]) expect(JSON.stringify(r)).not.toContain("Alex");
  expect(mara.past!.background).toContain("has not told her housemates");
  expect(mara.phoneContact?.name).toBe("Alex");
});

test("two finite, unowned food props make the private promise an actual choice, not an enforced lock", () => {
  const s = createHouseholdScenario(), food = s.blueprint.props.filter(p => p.assetId === "food");
  expect(food.map(p => p.name)).toEqual(["Apple pastry", "Pear pastry"]);
  for (const p of food) {
    expect(p.roomId).toBe("household-kitchen");
    expect(p.supportedBy).toBe("household-kitchen-table");
    expect(p.description).toContain("consumes this portion");
    expect(p.description).not.toMatch(/reserved|Noor|promise|replenish/i);
    expect(spatialEntityDefinition(p).components.map(c => c.name)).toEqual(["ObjectType", "ObjectState", "Position"]);
    expect(SPATIAL_ASSETS[p.assetId].affordances).toEqual(["eat", "take"]);
  }
  expect(s.residents.find(r => r.id === "ivo")!.needs.hunger).toBeGreaterThanOrEqual(70);
  expect(s.residents.find(r => r.id === "noor")!.needs.energy).toBeLessThanOrEqual(30);
});

test("each resident has a separate real phone but only Mara has the authored external contact", () => {
  const s = createHouseholdScenario(), phones = s.blueprint.props.filter(p => p.assetId === "phone");
  expect(phones).toHaveLength(4);
  for (const r of s.residents) {
    const p = phones.find(p => p.id === r.phoneId)!;
    expect(p.name).toBe(`${r.name}'s phone`);
    expect(p.supportedBy).toBe("household-phone-table");
    expect(p.roomId).toBe("household-sitting-room");
    expect(p.description).toContain("private");
  }
  expect(s.residents.filter(r => r.phoneContact).map(r => r.id)).toEqual(["mara"]);
  expect(SPATIAL_ASSETS.phone.affordances).not.toContain("read_phone");
});

test("native physical choices do not pretend that an attractive prop installs a new action", () => {
  const s = createHouseholdScenario();
  const granted = new Set(s.blueprint.props.flatMap(p => SPATIAL_ASSETS[p.assetId].affordances));
  for (const a of granted) expect(BASE_AFFORDANCES[a]).toBeDefined();
  expect(granted).toEqual(new Set(["examine", "eat", "take", "open", "close", "sit"]));
  expect(s.blueprint.props.filter(p => SPATIAL_ASSETS[p.assetId].affordances.includes("sit")).map(p => p.id)).toEqual(["household-patio-chair"]);
  expect(SPATIAL_ASSETS.sofa.affordances).toEqual(["examine"]);
  expect(s.blueprint.props.find(p => p.assetId === "sofa")!.description).toContain("not an installed usable seat");
  expect(s.blueprint.props.find(p => p.assetId === "supply-box")!.description).toContain("empty");
  // Descriptions do not announce absence or a stale food count as perpetual truth.
  for (const r of s.blueprint.rooms) expect(r.description).not.toMatch(/no chairs|no seats|two pastries|empty table/i);
  for (const purpose of s.residents.map(r => r.initialGoal.description)) expect(purpose).not.toMatch(/cook|brew|read a book|repair|buy|sell|harvest/i);
});

test("all spawns, room entries and interaction anchors connect through collision-clear routes", () => {
  const s = createHouseholdScenario(), g = geometry(s);
  for (const spawn of s.blueprint.spawns) for (const room of s.blueprint.rooms) reachable(s, spawn.position, room.entry, g);
  for (const p of s.blueprint.props) {
    const room = s.blueprint.rooms.find(r => r.id === p.roomId)!;
    for (const a of p.interactionAnchors) reachable(s, room.entry, { x: p.position.x + a.x, y: p.position.y + a.y }, g);
  }
  for (const door of s.blueprint.doors) expect(g.pointClear(door.position)).toBe(true);
});

test("the only growth candidate is a real reachable indoor chair, and adding it preserves all paths", () => {
  const s = createHouseholdScenario();
  expect(HOUSEHOLD_GROWTH_SITES).toHaveLength(1);
  const site = HOUSEHOLD_GROWTH_SITES[0];
  expect(site.allowedAssets).toEqual(["chair"]);
  expect(s.blueprint.props.some(p => p.id === site.id)).toBe(false);
  expect(s.blueprint.rooms.find(r => r.id === site.roomId)?.environment).toBe("indoor");
  s.blueprint.props.push({ id: site.id, name: "New sitting room chair", description: "A chair in the sitting room.", roomId: site.roomId,
    assetId: "chair", position: { ...site.position }, elevation: 0, rotationY: 0, reach: 1.1, interactionAnchors: structuredClone(site.anchors) });
  const checked = validateSpatialScenario(s), g = geometry(checked);
  for (const room of checked.blueprint.rooms) reachable(checked, checked.blueprint.rooms[0].entry, room.entry, g);
  for (const prop of checked.blueprint.props) for (const a of prop.interactionAnchors) reachable(checked,
    checked.blueprint.rooms.find(r => r.id === prop.roomId)!.entry, { x: prop.position.x + a.x, y: prop.position.y + a.y }, g);
  expect(createHouseholdScenario().blueprint.props.some(p => p.id === site.id)).toBe(false);
});

test("narrative context frames opportunities without publishing secrets or granting execution", () => {
  expect(HOUSEHOLD_STORY_STYLE.narratorContext).toContain("public choices");
  expect(HOUSEHOLD_STORY_STYLE.narratorContext).toContain("installed native permissions");
  expect(HOUSEHOLD_STORY_STYLE.narratorContext).toContain("not an applied change");
  expect(JSON.stringify(HOUSEHOLD_STORY_STYLE)).not.toMatch(/Alex|pear pastry|Noor|scripted/);
});
