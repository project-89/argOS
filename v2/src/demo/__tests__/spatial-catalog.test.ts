import { jest } from "@jest/globals";
import { INITIAL_SPATIAL_BLUEPRINT, CAFE_SPATIAL_BLUEPRINT, SPATIAL_ASSETS, SPATIAL_WORLD_BOUNDS,
  blackoutSpatialBlueprint, extendedBlackoutSpatialBlueprint, spatialEntityDefinition, validateSpatialBlueprint, type SpatialBlueprint, type SpatialPoint } from "../spatial-catalog";
import { installOperatorCafe } from "../spatial-growth";
import { createArgosWorld } from "../../ecs/world";
import { ObjectType } from "../../ecs/components";
import { materializeApprovedEntity } from "../../engineering/entity-materialization";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { configureWorldConstructionBudget } from "../../runtime/world-construction-budget";
import { initializeRegistry } from "../../ecs/component-registry";
import { initializePrefabs } from "../../ecs/prefabs";
import { workingMemoryEntityRef } from "../../cognition/working-memory";
import { createSpatialGeometry, findSpatialPath, spatialDistance } from "../../world/spatial-path";

test("the furnished apartment and adjacent cafe are connected, walkable authored data", () => {
  expect(validateSpatialBlueprint(INITIAL_SPATIAL_BLUEPRINT)).toEqual(INITIAL_SPATIAL_BLUEPRINT);
  expect(validateSpatialBlueprint(CAFE_SPATIAL_BLUEPRINT, INITIAL_SPATIAL_BLUEPRINT.rooms)).toEqual(CAFE_SPATIAL_BLUEPRINT);
  expect(INITIAL_SPATIAL_BLUEPRINT.spawns.map(s => s.name)).toEqual(["Mara", "Ivo"]);
});

test("native object schemas, not visual models, supply behavior", () => {
  const phone = INITIAL_SPATIAL_BLUEPRINT.props.find(p => p.id === "maras-phone")!;
  expect(spatialEntityDefinition(phone).components).toContainEqual({ name: "ObjectType", values: { typeId: "smartphone" } });
  expect(SPATIAL_ASSETS.phone.affordances).not.toContain("read_phone");
  expect(SPATIAL_ASSETS.sofa.affordances).not.toContain("sit");
  expect(SPATIAL_ASSETS.chair.objectType).toBe("chair");
  expect(SPATIAL_ASSETS.food.objectType).toBe("food_item");
});

test("the extended blackout is three connected real rooms inside the existing world bounds", () => {
  const blueprint = extendedBlackoutSpatialBlueprint();
  expect(validateSpatialBlueprint(blueprint)).toEqual(blueprint);
  expect(blueprint.rooms.map(r => r.name)).toEqual(["Apartment", "Utility room", "Storeroom"]);
  for (const room of blueprint.rooms) {
    expect(room.bounds.minX).toBeGreaterThanOrEqual(SPATIAL_WORLD_BOUNDS.minX);
    expect(room.bounds.minY).toBeGreaterThanOrEqual(SPATIAL_WORLD_BOUNDS.minY);
    expect(room.bounds.maxX).toBeLessThanOrEqual(SPATIAL_WORLD_BOUNDS.maxX);
    expect(room.bounds.maxY).toBeLessThanOrEqual(SPATIAL_WORLD_BOUNDS.maxY);
  }
  expect(blueprint.doors.map(d => [d.from, d.to])).toEqual([["apartment", "utility"], ["utility", "storeroom"]]);
  expect(blueprint.author).toBe("operator");
});

test("extended blackout keeps original puzzle and actor identities but separates remote evidence spatially", () => {
  const compact = blackoutSpatialBlueprint(), extended = extendedBlackoutSpatialBlueprint();
  expect(extended.spawns).toEqual(compact.spawns);
  expect(extended.props.map(p => p.id)).toEqual(expect.arrayContaining(compact.props.map(p => p.id)));
  const byId = new Map(extended.props.map(p => [p.id, p]));
  for (const id of ["apartment-table", "maras-phone", "apartment-lamp"]) expect(byId.get(id)!.roomId).toBe("apartment");
  expect(byId.get("lighting-panel")!.roomId).toBe("utility");
  for (const id of ["supply-box", "amber-cartridge", "blue-cartridge"]) expect(byId.get(id)!.roomId).toBe("storeroom");
  expect(spatialEntityDefinition(byId.get("supply-box")!).components).toContainEqual({ name: "ObjectState", values: { current: "closed" } });
  expect(extended.rooms[0].description).not.toMatch(/cartridge|specification|supplies|fault.*[AB]/);
  for (const p of extended.props) {
    const definition = spatialEntityDefinition(p);
    expect(definition.type).toBe("object");
    expect(definition.components).toContainEqual({ name: "ObjectType", values: { typeId: SPATIAL_ASSETS[p.assetId].objectType } });
  }
});

test("fixed passages have no open/close affordance, collider or invented native door behavior", () => {
  const blueprint = extendedBlackoutSpatialBlueprint();
  expect(SPATIAL_ASSETS.passage).toMatchObject({ objectType: "object", initialState: "normal", affordances: ["examine"] });
  expect(SPATIAL_ASSETS.passage.collider).toBeUndefined();
  for (const link of blueprint.doors) {
    const p = blueprint.props.find(p => p.id === link.propId)!;
    expect(p.assetId).toBe("passage");
    expect(spatialEntityDefinition(p).components).toContainEqual({ name: "ObjectType", values: { typeId: "object" } });
    expect(spatialEntityDefinition(p).components).toContainEqual({ name: "ObjectState", values: { current: "normal" } });
  }
});

function blueprintGeometry(blueprint: SpatialBlueprint) {
  const colliders = [...blueprint.walls, ...blueprint.props.flatMap(p => {
    const collider = SPATIAL_ASSETS[p.assetId].collider;
    return collider ? [{ position: p.position, ...collider }] : [];
  })];
  return createSpatialGeometry(SPATIAL_WORLD_BOUNDS, blueprint.rooms.map(r => r.bounds), colliders.map(c => ({
    minX: c.position.x - c.halfWidth, maxX: c.position.x + c.halfWidth,
    minY: c.position.y - c.halfDepth, maxY: c.position.y + c.halfDepth,
  })), .18, .25);
}
function anchor(blueprint: SpatialBlueprint, id: string) {
  const p = blueprint.props.find(p => p.id === id)!;
  return { x: p.position.x + p.interactionAnchors[0].x, y: p.position.y + p.interactionAnchors[0].y };
}
function checkedPath(blueprint: SpatialBlueprint, start: SpatialPoint, end: SpatialPoint) {
  const geometry = blueprintGeometry(blueprint);
  const path = findSpatialPath(start, end, SPATIAL_WORLD_BOUNDS, .25, geometry);
  expect(path).toBeDefined();
  let previous = start, length = 0;
  for (const point of path!) { expect(geometry.segmentClear(previous, point)).toBe(true); length += spatialDistance(previous, point); previous = point; }
  expect(previous).toEqual(end);
  return length;
}

test("native continuous geometry reaches panel and stock through longer collision-free routes in both directions", () => {
  const compact = blackoutSpatialBlueprint(), extended = extendedBlackoutSpatialBlueprint();
  const compactTrip = checkedPath(compact, compact.spawns[0].position, anchor(compact, "lighting-panel"));
  const outbound = checkedPath(extended, extended.spawns[0].position, anchor(extended, "lighting-panel"));
  expect(outbound).toBeGreaterThan(compactTrip + 5);
  const supplyTrip = checkedPath(extended, anchor(extended, "lighting-panel"), anchor(extended, "supply-box"));
  expect(supplyTrip).toBeGreaterThan(8);
  checkedPath(extended, anchor(extended, "supply-box"), anchor(extended, "lighting-panel"));
  checkedPath(extended, anchor(extended, "lighting-panel"), anchor(extended, "apartment-lamp"));
  for (const room of extended.rooms) checkedPath(extended, extended.spawns[0].position, room.entry);
});

test("sealing either physical passage fails the all-anchor structural preflight", () => {
  for (const id of ["apartment-utility", "utility-storeroom"]) {
    const blueprint = extendedBlackoutSpatialBlueprint(), link = blueprint.doors.find(d => d.id === id)!;
    blueprint.walls.push({ id: "sealed-passage", roomId: link.from, position: { ...link.position },
      halfWidth: link.axis === "x" ? .08 : 1, halfDepth: link.axis === "x" ? 1 : .08, height: 2.5 });
    expect(() => validateSpatialBlueprint(blueprint)).toThrow(/blocked|unreachable/);
  }
});

test("requesting or editing the extended variant does not alter the compact baseline", () => {
  const initial = structuredClone(INITIAL_SPATIAL_BLUEPRINT), compact = blackoutSpatialBlueprint();
  const extended = extendedBlackoutSpatialBlueprint();
  extended.rooms[0].description = "Edited variant"; extended.spawns[0].position.x = 7;
  extended.props.find(p => p.id === "lighting-panel")!.description = "Edited variant panel";
  expect(INITIAL_SPATIAL_BLUEPRINT).toEqual(initial);
  expect(blackoutSpatialBlueprint()).toEqual(compact);
  expect(blackoutSpatialBlueprint().rooms.map(r => r.name)).toEqual(["Apartment", "Street"]);
  expect(blackoutSpatialBlueprint().props.find(p => p.id === "lighting-panel")!.roomId).toBe("apartment");
});

test.each([
  ["unknown asset", (b: typeof INITIAL_SPATIAL_BLUEPRINT) => { b.props[0].assetId = "invented-mesh"; }],
  ["unknown native state", (b: typeof INITIAL_SPATIAL_BLUEPRINT) => { b.props[0].state = "magically-healing"; }],
  ["nonfinite position", (b: typeof INITIAL_SPATIAL_BLUEPRINT) => { b.props[0].position.x = Number.NaN; }],
  ["out of room", (b: typeof INITIAL_SPATIAL_BLUEPRINT) => { b.props[0].position.x = 100; }],
  ["collider outside room", (b: typeof INITIAL_SPATIAL_BLUEPRINT) => { b.props[0].position.x = .2; }],
  ["duplicate identity", (b: typeof INITIAL_SPATIAL_BLUEPRINT) => { b.props[0].id = b.rooms[0].id; }],
  ["blocked actor spawn", (b: typeof INITIAL_SPATIAL_BLUEPRINT) => { b.spawns[0].position = { ...b.props[0].position }; }],
  ["blocked interaction anchor", (b: typeof INITIAL_SPATIAL_BLUEPRINT) => { b.props[1].interactionAnchors = [{ x: 0, y: 0 }]; }],
  ["dangling door", (b: typeof INITIAL_SPATIAL_BLUEPRINT) => { b.doors[0].to = "missing-room"; }],
  ["misaligned door", (b: typeof INITIAL_SPATIAL_BLUEPRINT) => { b.doors[0].position.x = 7; }],
  ["disconnected room", (b: typeof INITIAL_SPATIAL_BLUEPRINT) => { b.doors = []; }],
  ["false support", (b: typeof INITIAL_SPATIAL_BLUEPRINT) => { b.props.find(p => p.id === "maras-phone")!.supportedBy = "apartment-chair"; }],
  ["sealed doorway", (b: typeof INITIAL_SPATIAL_BLUEPRINT) => { b.walls.push({ id: "sealed-wall", roomId: "apartment", position: { x: 4, y: 7 }, halfWidth: 1, halfDepth: .08, height: 2.5 }); }],
  ["unreachable partition", (b: typeof INITIAL_SPATIAL_BLUEPRINT) => { b.walls.push({ id: "partition", roomId: "apartment", position: { x: 4, y: 4.5 }, halfWidth: 4, halfDepth: .08, height: 2.5 }); }],
  ["misrepresented author", (b: typeof INITIAL_SPATIAL_BLUEPRINT) => { (b as { author: string }).author = "autonomous-spirit"; }],
] as const)("rejects %s before a caller may commit ECS work", (_name, change) => {
  const b = structuredClone(INITIAL_SPATIAL_BLUEPRINT), commit = jest.fn(); change(b);
  expect(() => { const ready = validateSpatialBlueprint(b); commit(ready); }).toThrow();
  expect(commit).not.toHaveBeenCalled();
});

test("cafe cannot be installed in a disconnected or overlapping floor plan", () => {
  expect(() => validateSpatialBlueprint(CAFE_SPATIAL_BLUEPRINT)).toThrow();
  const rooms = structuredClone(INITIAL_SPATIAL_BLUEPRINT.rooms); rooms[1].bounds.maxX = 9;
  expect(() => validateSpatialBlueprint(CAFE_SPATIAL_BLUEPRINT, rooms)).toThrow("overlap");
});

test("validated data does not alias author input", () => {
  const validated = validateSpatialBlueprint(INITIAL_SPATIAL_BLUEPRINT);
  validated.props[0].position.x = 99;
  expect(INITIAL_SPATIAL_BLUEPRINT.props[0].position.x).toBe(2);
});

function growthFixture() {
  const world = createArgosWorld("Spatial catalog test"); initializeRegistry(world); initializePrefabs(world); startCommittedEvents(world);
  const existingRoomIds = new Map(INITIAL_SPATIAL_BLUEPRINT.rooms.map(room => [room.id, materializeApprovedEntity(world,{ name: room.name, description: room.description, type: "room", components: [] })]));
  for (const eid of existingRoomIds.values()) workingMemoryEntityRef(world,eid);
  const commit = jest.fn((blueprint: typeof CAFE_SPATIAL_BLUEPRINT) => {
    const ids: Record<string,number> = {};
    for (const room of blueprint.rooms) ids[room.id] = materializeApprovedEntity(world,{ name: room.name, description: room.description, type: "room", components: [] });
    for (const prop of blueprint.props) ids[prop.id] = materializeApprovedEntity(world,{ ...spatialEntityDefinition(prop), roomEid: ids[prop.roomId] });
    for (const wall of blueprint.walls) ids[wall.id] = materializeApprovedEntity(world,{ name: wall.id, description: "An authored structural wall.", type: "object", roomEid: ids[wall.roomId], components: [
      { name: "ObjectType", values: { typeId: "structural_wall" } }, { name: "Position", values: { x: wall.position.x, y: wall.position.y } },
    ] });
    return ids;
  });
  return { world, commit, options: { existingRooms: INITIAL_SPATIAL_BLUEPRINT.rooms, existingRoomIds, commit } };
}

test("operator cafe construction is native, bounded and idempotent", () => {
  const { world, options, commit } = growthFixture();
  const first = installOperatorCafe(world, options);
  expect(first).toMatchObject({ status: "built", authority: "operator" });
  expect(installOperatorCafe(world, options)).toMatchObject({ status: "already-built", ids: first.ids });
  expect(commit).toHaveBeenCalledTimes(1);
});

test("cafe construction rejects generic props substituted for structural walls even at the correct placement", () => {
  const { world, options, commit } = growthFixture();
  const result = installOperatorCafe(world, { ...options, commit: blueprint => {
    const ids = commit(blueprint);
    for (const wall of blueprint.walls) ObjectType.typeId[ids[wall.id]] = "object";
    return ids;
  } });
  expect(result).toMatchObject({ status: "failed", error: "Cafe object binding does not match its native placement" });
});

test("invalid growth and insufficient budget do not call the native commit", () => {
  const { world, options, commit } = growthFixture();
  expect(() => installOperatorCafe(world, { ...options, existingRooms: [] })).toThrow();
  configureWorldConstructionBudget(world, 3);
  expect(() => installOperatorCafe(world, options)).toThrow(/budget/);
  expect(commit).not.toHaveBeenCalled();
});

test("stopped sources cannot build and a source stopping during commit cannot claim success", () => {
  const a = growthFixture(); stopCommittedEvents(a.world);
  expect(() => installOperatorCafe(a.world, a.options)).toThrow(/active/);
  expect(a.commit).not.toHaveBeenCalled();
  const b = growthFixture();
  const result = installOperatorCafe(b.world, { ...b.options, commit: blueprint => { const ids = b.commit(blueprint); stopCommittedEvents(b.world); return ids; } });
  expect(result).toMatchObject({ status: "failed", error: "Spatial construction source expired during commit" });
});

test("unexpected failures retain failure evidence without retrying or claiming a built room", () => {
  const { world, options } = growthFixture(), commit = jest.fn(() => { throw new Error("Native allocation fault"); });
  expect(installOperatorCafe(world, { ...options, commit })).toMatchObject({ status: "failed", error: "Native allocation fault" });
  expect(installOperatorCafe(world, { ...options, commit })).toMatchObject({ status: "failed", error: "Native allocation fault" });
  expect(commit).toHaveBeenCalledTimes(1);
});

test("made-up entity IDs are not evidence of native construction", () => {
  const { world, options } = growthFixture();
  const result = installOperatorCafe(world, { ...options, commit: blueprint => Object.fromEntries([...blueprint.rooms,...blueprint.props,...blueprint.walls].map((row,index) => [row.id,index+1000])) });
  expect(result).toMatchObject({ status: "failed", error: "Cafe room binding is not a current native room" });
});

test("missing existing room binding is rejected before allocating an expansion", () => {
  const { world, options, commit } = growthFixture();
  options.existingRoomIds.set("street",100000);
  expect(() => installOperatorCafe(world,options)).toThrow(/native room bindings/);
  expect(commit).not.toHaveBeenCalled();
});
