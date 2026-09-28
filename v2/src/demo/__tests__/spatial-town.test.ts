import { TOWN_NAVIGATION_CELL_SIZE, TOWN_RESIDENTS, TOWN_SPATIAL_BLUEPRINT, TOWN_WORLD_BOUNDS } from "../spatial-town";
import { SPATIAL_ASSETS, spatialEntityDefinition, validateSpatialBlueprint, type SpatialPoint } from "../spatial-catalog";
import { characterPastSchema } from "../../cognition/character-past-schema";
import { BASE_AFFORDANCES, worldSchema } from "../../world/schema";
import { createSpatialGeometry, findSpatialPath, spatialDistance } from "../../world/spatial-path";

function geometry() {
  const colliders = [...TOWN_SPATIAL_BLUEPRINT.walls, ...TOWN_SPATIAL_BLUEPRINT.props.flatMap(p => {
    const collider = SPATIAL_ASSETS[p.assetId].collider;
    return collider ? [{ position: p.position, ...collider }] : [];
  })];
  return createSpatialGeometry(TOWN_WORLD_BOUNDS, TOWN_SPATIAL_BLUEPRINT.rooms.map(r => r.bounds), colliders.map(c => ({
    minX: c.position.x - c.halfWidth, maxX: c.position.x + c.halfWidth,
    minY: c.position.y - c.halfDepth, maxY: c.position.y + c.halfDepth,
  })), .18, TOWN_NAVIGATION_CELL_SIZE);
}
function checkedPath(start: SpatialPoint, end: SpatialPoint, g: ReturnType<typeof geometry>) {
  const path = findSpatialPath(start, end, TOWN_WORLD_BOUNDS, TOWN_NAVIGATION_CELL_SIZE, g);
  expect(path).toBeDefined();
  let previous = start;
  for (const p of path!) { expect(g.segmentClear(previous, p)).toBe(true); previous = p; }
  expect(spatialDistance(previous, end)).toBeLessThan(1e-8);
}

test("the bounded authored seed contains four homes, four shared places and ten distinct residents", () => {
  expect(validateSpatialBlueprint(TOWN_SPATIAL_BLUEPRINT)).toEqual(TOWN_SPATIAL_BLUEPRINT);
  expect(TOWN_SPATIAL_BLUEPRINT.author).toBe("operator");
  expect(TOWN_SPATIAL_BLUEPRINT.rooms).toHaveLength(8);
  expect(TOWN_SPATIAL_BLUEPRINT.rooms.filter(r => r.id.endsWith("-house"))).toHaveLength(4);
  expect(TOWN_SPATIAL_BLUEPRINT.rooms.map(r => r.name)).toEqual(expect.arrayContaining(["Common Square", "Corner Cafe", "Shared Workshop", "Community Garden"]));
  expect(TOWN_RESIDENTS).toHaveLength(10);
  expect(new Set(TOWN_RESIDENTS.map(r => r.id)).size).toBe(10);
  expect(new Set(TOWN_RESIDENTS.map(r => r.name)).size).toBe(10);
  expect(TOWN_SPATIAL_BLUEPRINT.spawns).toHaveLength(10);
  expect(TOWN_SPATIAL_BLUEPRINT.rooms.length + TOWN_SPATIAL_BLUEPRINT.props.length + TOWN_SPATIAL_BLUEPRINT.walls.length + TOWN_RESIDENTS.length).toBe(137);
  expect(TOWN_NAVIGATION_CELL_SIZE).toBe(.5);
  const cells = (Math.floor((TOWN_WORLD_BOUNDS.maxX - TOWN_WORLD_BOUNDS.minX) / TOWN_NAVIGATION_CELL_SIZE) + 1)
    * (Math.floor((TOWN_WORLD_BOUNDS.maxY - TOWN_WORLD_BOUNDS.minY) / TOWN_NAVIGATION_CELL_SIZE) + 1);
  expect(cells).toBe(7081); expect(cells).toBeLessThanOrEqual(10000);
  for (const room of TOWN_SPATIAL_BLUEPRINT.rooms) {
    expect(room.bounds.minX).toBeGreaterThanOrEqual(TOWN_WORLD_BOUNDS.minX);
    expect(room.bounds.minY).toBeGreaterThanOrEqual(TOWN_WORLD_BOUNDS.minY);
    expect(room.bounds.maxX).toBeLessThanOrEqual(TOWN_WORLD_BOUNDS.maxX);
    expect(room.bounds.maxY).toBeLessThanOrEqual(TOWN_WORLD_BOUNDS.maxY);
  }
});

test("each resident supplies native-schema private history, purpose, aspirations, needs and a real spawn", () => {
  for (const resident of TOWN_RESIDENTS) {
    expect(resident.role.trim().length).toBeGreaterThan(0);
    expect(resident.personality!.trim().length).toBeGreaterThan(20);
    expect(resident.systemPrompt).toContain(resident.name);
    const past = characterPastSchema.parse(resident.past);
    expect(past.background.length).toBeGreaterThan(30);
    expect(past.memories.every(m => m.provenance === "authored-history")).toBe(true);
    expect(resident.aspirations.length).toBeGreaterThanOrEqual(2);
    expect(resident.appearance.clothing).toBeTruthy();
    expect(resident.needs.hunger).toBeGreaterThanOrEqual(30); expect(resident.needs.hunger).toBeLessThanOrEqual(65);
    expect(resident.needs.energy).toBeGreaterThanOrEqual(60); expect(resident.needs.energy).toBeLessThanOrEqual(90);
    expect(resident.initialGoal).toMatchObject({ kind: "custom", priority: 5 });
    expect(resident.initialGoal.description.length).toBeGreaterThan(15);
    expect(TOWN_SPATIAL_BLUEPRINT.rooms.find(r => r.id === resident.startRoomId)?.name).toBe(resident.startRoom);
    expect(TOWN_SPATIAL_BLUEPRINT.rooms.some(r => r.id === resident.homeRoomId)).toBe(true);
    expect(TOWN_SPATIAL_BLUEPRINT.spawns.find(s => s.id === resident.id)).toMatchObject({ name: resident.name, roomId: resident.startRoomId, assetId: resident.assetId });
    // Public authored geometry is not a projection of a resident's memories.
    for (const memory of past.memories) expect(JSON.stringify(TOWN_SPATIAL_BLUEPRINT)).not.toContain(memory.recollection);
  }
});

test("physical phones have exact owners and only explicitly authored contacts add communication motivation", () => {
  expect(TOWN_SPATIAL_BLUEPRINT.props.filter(p => p.assetId === "phone")).toHaveLength(10);
  for (const resident of TOWN_RESIDENTS) {
    const phone = TOWN_SPATIAL_BLUEPRINT.props.find(p => p.id === resident.phoneId)!;
    expect(phone).toMatchObject({ assetId: "phone", name: `${resident.name}'s phone`, roomId: resident.homeRoomId });
    expect(phone.supportedBy).toBe(`${resident.homeRoomId}-table`);
    expect(phone.elevation).toBeGreaterThan(0);
  }
  expect(TOWN_RESIDENTS.filter(r => r.phoneContact).map(r => [r.name, r.phoneContact!.name])).toEqual([
    ["Mara", "Alex"], ["Ivo", "Nadia"], ["Noor", "Anika"],
  ]);
  expect(new Set(TOWN_RESIDENTS.filter(r => r.phoneContact).map(r => r.phoneContact!.memory)).size).toBe(3);
  expect(SPATIAL_ASSETS.phone.affordances).not.toContain("read_phone"); // Native host must bind the service.
});

test("shared places use current native affordances and finite food, not pretend commerce or production", () => {
  const food = TOWN_SPATIAL_BLUEPRINT.props.filter(p => p.assetId === "food");
  expect(food).toHaveLength(4); expect(food.every(p => p.roomId === "town-cafe")).toBe(true);
  const declared = new Set<string>();
  for (const prop of TOWN_SPATIAL_BLUEPRINT.props) {
    const asset = SPATIAL_ASSETS[prop.assetId], definition = spatialEntityDefinition(prop);
    expect(worldSchema.getObjectType(asset.objectType!)).toBeDefined();
    expect(definition.type).toBe("object");
    expect(definition.components).toContainEqual({ name: "ObjectType", values: { typeId: asset.objectType } });
    for (const affordance of asset.affordances) { expect(BASE_AFFORDANCES[affordance]).toBeDefined(); declared.add(affordance); }
  }
  for (const unsupported of ["cook", "craft", "farm", "water", "harvest", "buy", "sell", "pay"]) expect(declared.has(unsupported)).toBe(false);
  expect(TOWN_SPATIAL_BLUEPRINT.props.find(p => p.id === "workshop-box")!.name).toContain("Empty");
  expect(TOWN_SPATIAL_BLUEPRINT.props.filter(p => p.roomId === "town-garden").every(p => ["plant", "tree", "chair", "passage"].includes(p.assetId))).toBe(true);
});

test("homes and shared buildings are detached around a real outdoor common, not adjoining apartment rooms", () => {
  const homes = TOWN_SPATIAL_BLUEPRINT.rooms.filter(r => r.id.endsWith("-house")).sort((a, b) => a.bounds.minX - b.bounds.minX);
  for (const [index, home] of homes.entries()) {
    expect(home.environment).toBe("indoor");
    expect(home.bounds.maxX - home.bounds.minX).toBe(7);
    expect(home.bounds.maxY - home.bounds.minY).toBe(6);
    if (index) expect(home.bounds.minX - homes[index - 1].bounds.maxX).toBeGreaterThanOrEqual(5);
  }
  const cafe = TOWN_SPATIAL_BLUEPRINT.rooms.find(r => r.id === "town-cafe")!;
  const workshop = TOWN_SPATIAL_BLUEPRINT.rooms.find(r => r.id === "town-workshop")!;
  expect(workshop.bounds.minX - cafe.bounds.maxX).toBe(4);
  const outside = TOWN_SPATIAL_BLUEPRINT.rooms.filter(r => r.environment === "outdoor");
  expect(outside.map(r => r.id)).toEqual(["common-square", "town-garden"]);
  expect(outside[0].bounds.maxY - outside[0].bounds.minY).toBe(18);
  const area = (room: typeof homes[number]) => (room.bounds.maxX - room.bounds.minX) * (room.bounds.maxY - room.bounds.minY);
  expect(outside.reduce((sum, room) => sum + area(room), 0) / TOWN_SPATIAL_BLUEPRINT.rooms.reduce((sum, room) => sum + area(room), 0)).toBeGreaterThan(.75);
  expect(TOWN_SPATIAL_BLUEPRINT.walls.some(w => w.roomId === "town-garden")).toBe(false);
});

test("buildings have individual exteriors facing their real native entrances", () => {
  const buildings = TOWN_SPATIAL_BLUEPRINT.rooms.filter(r => r.building);
  expect(buildings).toHaveLength(6);
  const homes = buildings.filter(r => r.building!.style === "cottage");
  expect(new Set(homes.map(r => r.building!.wallColor)).size).toBe(4);
  expect(new Set(homes.map(r => r.building!.roofColor)).size).toBe(4);
  expect(buildings.map(r => r.building!.style)).toEqual(["cottage", "cottage", "cottage", "cottage", "cafe", "workshop"]);
  for (const room of buildings) {
    const link = TOWN_SPATIAL_BLUEPRINT.doors.find(d => d.from === room.id)!;
    expect(link).toBeDefined();
    expect(link.position.y).toBe(room.building!.front === "south" ? room.bounds.maxY : room.bounds.minY);
    expect(link.position.x).toBe((room.bounds.minX + room.bounds.maxX) / 2);
    expect(geometry().pointClear(link.position)).toBe(true);
  }
});

test("twenty-six trees have authoritative solid trunks and native examine-only behavior", () => {
  const trees = TOWN_SPATIAL_BLUEPRINT.props.filter(p => p.assetId === "tree"), g = geometry();
  expect(trees).toHaveLength(26);
  expect(SPATIAL_ASSETS.tree).toMatchObject({ objectType: "object", affordances: ["examine"], collider: { halfWidth: .3, halfDepth: .3 } });
  for (const tree of trees) {
    expect(g.pointClear(tree.position)).toBe(false);
    const anchor = tree.interactionAnchors[0];
    expect(g.pointClear({ x: tree.position.x + anchor.x, y: tree.position.y + anchor.y })).toBe(true);
    expect(spatialEntityDefinition(tree).components).toContainEqual({ name: "ObjectType", values: { typeId: "object" } });
  }
});

test("decorative land between cottages is not silently granted walking authority", () => {
  const g = geometry();
  expect(g.pointClear({ x: 12, y: 6 })).toBe(false);
  expect(g.pointClear({ x: 13, y: 30 })).toBe(false);
  expect(g.pointClear({ x: 12, y: 18 })).toBe(true);
  expect(g.pointClear({ x: 24, y: 18 })).toBe(true);
});

test("every place connects through an open physical passage, without an invented shared-door latch", () => {
  expect(TOWN_SPATIAL_BLUEPRINT.doors).toHaveLength(7);
  for (const link of TOWN_SPATIAL_BLUEPRINT.doors) {
    expect([link.from, link.to]).toContain("common-square");
    expect(TOWN_SPATIAL_BLUEPRINT.props.find(p => p.id === link.propId)?.assetId).toBe("passage");
  }
  expect(SPATIAL_ASSETS.passage.affordances).toEqual(["examine"]);
  expect(SPATIAL_ASSETS.passage.collider).toBeUndefined();
});

test.each(TOWN_SPATIAL_BLUEPRINT.spawns)("$name can physically walk from the authored spawn to every room entry", spawn => {
  const g = geometry();
  for (const room of TOWN_SPATIAL_BLUEPRINT.rooms) checkedPath(spawn.position, room.entry, g);
});

test.each(TOWN_SPATIAL_BLUEPRINT.rooms)("all $name interaction anchors are continuously reachable from the local entry", room => {
  const g = geometry();
  for (const prop of TOWN_SPATIAL_BLUEPRINT.props.filter(p => p.roomId === room.id)) {
    for (const a of prop.interactionAnchors) checkedPath(room.entry, { x: prop.position.x + a.x, y: prop.position.y + a.y }, g);
  }
});

test("closing a house's only architectural opening fails preflight without mutating seed data", () => {
  const copy = structuredClone(TOWN_SPATIAL_BLUEPRINT), link = copy.doors[0];
  copy.walls.push({ id: "sealed-home", roomId: link.from, position: { ...link.position }, halfWidth: 1, halfDepth: .08, height: 2.5 });
  expect(() => validateSpatialBlueprint(copy)).toThrow(/blocked|unreachable/);
  expect(TOWN_SPATIAL_BLUEPRINT.walls.some(w => w.id === "sealed-home")).toBe(false);
});
