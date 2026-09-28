import { addComponent, getAllEntities, getRelationTargets, hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializeRegistry } from "../../ecs/component-registry";
import { Name, ObjectState, ObjectType, PhysicalObject, Position, Removed, WorkingMemoryIdentity } from "../../ecs/components";
import { SittingOn } from "../../ecs/relations";
import { getRoomForEntity } from "../../ecs/location";
import { workingMemoryEntityRef } from "../../cognition/working-memory";
import { startCommittedEvents, stopCommittedEvents, publishCommittedEvent } from "../../runtime/committed-events";
import { configureWorldConstructionBudget, getWorldConstructionStatus } from "../../runtime/world-construction-budget";
import { materializeApprovedEntity, type MaterializedEntitySpec } from "../../engineering/entity-materialization";
import { createSpatialWorld } from "../../world/spatial-world";
import { executeAffordance } from "../../world/effect-executor";
import { worldSchema } from "../../world/schema";
import { createSpatialGeometry, findSpatialPath } from "../../world/spatial-path";
import { SPATIAL_ASSETS } from "../spatial-catalog";
import { createSpatialTownGrowth, createTownGrowthGeometry, createTownGrowthReachability, type TownGrowthSnapshot, type TownGrowthAddition, type TownGrowthSite } from "../spatial-town-growth";
import { TOWN_SPATIAL_BLUEPRINT, TOWN_WORLD_BOUNDS } from "../spatial-town";

function fixture(options: { commit?: (eid: number, addition: TownGrowthAddition) => void; sites?: TownGrowthSite[] } = {}) {
  const world = createArgosWorld("Town addition"); initializeRegistry(world); startCommittedEvents(world);
  const bounds = { minX: 0, minY: 0, maxX: 12, maxY: 10 };
  const room = materializeApprovedEntity(world, { name: "Garden", description: "Outdoor garden", type: "room", components: [{ name: "Position", values: { x: 1, y: 1 } }] });
  const actor = materializeApprovedEntity(world, { name: "Mara", description: "Resident", type: "agent", roomEid: room,
    components: [{ name: "Position", values: { x: 2, y: 2 } }] });
  const table = materializeApprovedEntity(world, { name: "Old table", description: "Existing table", type: "object", roomEid: room,
    components: [{ name: "ObjectType", values: { typeId: "table" } }, { name: "Position", values: { x: 5, y: 5 } }] });
  const ref = (eid: number) => ({ eid, key: workingMemoryEntityRef(world, eid)!.key });
  const view: TownGrowthSnapshot = { rooms: [{ ...ref(room), bounds, entry: { x: 1, y: 1 } }],
    props: [{ ...ref(table), collider: SPATIAL_ASSETS.table.collider, anchors: [{ x: 0, y: 1 }] }], actors: [ref(actor)] };
  const spatial = createSpatialWorld(world, { bounds, cellSize: .5, actorRadius: .18 });
  spatial.registerRoom(room, { bounds, entry: { x: 1, y: 1 } }); spatial.registerObstacle(table, SPATIAL_ASSETS.table.collider!);
  spatial.registerTarget(table, { anchors: [{ x: 0, y: 1 }] });
  const sites: TownGrowthSite[] = options.sites ?? [[3, 7], [6, 7], [9, 7], [9, 3], [6, 2]].map(([x, y], i) => ({
    id: `site-${i + 1}`, roomEid: room, position: { x, y }, anchors: [{ x: 0, y: 1 }], allowedAssets: ["chair", "table", "plant", "lamp"],
  }));
  let ready = true;
  const growth = createSpatialTownGrowth({ world, spatial, bounds, cellSize: .5, sites, ready: () => ready,
    snapshot: () => view, reservedNames: ["Eaten pastry", "Removed lamp"], commit: (eid, addition) => {
      view.props.push({ ...ref(eid), collider: SPATIAL_ASSETS[addition.assetId].collider, anchors: addition.anchors });
      options.commit?.(eid, addition);
    } });
  const spec = (site = "site-1", name = "New garden chair", assetId = "chair"): MaterializedEntitySpec => ({ name, description: "An additional place to sit.", type: "object", roomEid: room,
    components: [{ name: "ObjectType", values: { typeId: SPATIAL_ASSETS[assetId]?.objectType ?? "object" } }, { name: "SpatialPlacement", values: { assetId, siteId: site } }] });
  return { world, room, actor, table, spatial, growth, view, sites, spec, setReady: (value: boolean) => { ready = value; } };
}

test("approved native object construction installs real spatial movement and sitting, not a decorative success", () => {
  const f = fixture(), before = getWorldConstructionStatus(f.world).admitted;
  const eid = materializeApprovedEntity(f.world, f.spec());
  expect(getWorldConstructionStatus(f.world).admitted).toBe(before + 1);
  expect(getRoomForEntity(f.world, eid)).toBe(f.room); expect(ObjectType.typeId[eid]).toBe("chair");
  expect(PhysicalObject.portable[eid]).toBe(false); expect(f.spatial.canReach(f.actor, eid)).toBe(true);
  expect(f.spatial.requestApproach(f.actor, eid).ok).toBe(true);
  f.world.time.elapsed = 10000; f.spatial.advance(); expect(f.spatial.isAtTarget(f.actor, eid)).toBe(true);
  const result = executeAffordance("sit", { world: f.world, actorEid: f.actor, targetEid: eid, worldSchema, registry: { byName: new Map(), byId: new Map() } });
  expect(result.success).toBe(true); expect(ObjectState.current[eid]).toBe("occupied");
  expect(getRelationTargets(f.world, f.actor, SittingOn)).toContain(eid);
  expect(f.growth.inspect().builds[0]).toMatchObject({ eid, status: "built", feedbackCount: 0 });
  const receipt = publishCommittedEvent(f.world, { executionId: "actual-sit", kind: "action", actorId: f.actor, roomId: f.room, targetId: eid,
    action: "interact", status: "succeeded", startedAtSimMs: 10000, completedAtSimMs: 10000 });
  expect(f.growth.inspect().builds[0].feedback).toEqual([{ eventId: receipt.id, actorKey: workingMemoryEntityRef(f.world, f.actor)!.key, action: "interact", atSimMs: 10000, seated: true }]);
  f.growth.dispose();
});

test.each(["food", "room", "actor", "position", "trait", "badType", "extraPlacement", "unknownSite", "wrongRoom", "duplicateComponent"])("rejects unsupported %s before any allocation", mode => {
  const f = fixture(), spec: any = f.spec(), before = [...getAllEntities(f.world)];
  if (mode === "food") spec.components[1].values.assetId = "food";
  if (mode === "room" || mode === "actor") spec.type = mode === "room" ? "room" : "agent";
  if (mode === "position") spec.components.push({ name: "Position", values: { x: 3, y: 4 } });
  if (mode === "trait") spec.components.push({ name: "Traits", values: { active: '["edible"]' } });
  if (mode === "badType") spec.components[0].values.typeId = "food_item";
  if (mode === "extraPlacement") spec.components[1].values.x = 3;
  if (mode === "unknownSite") spec.components[1].values.siteId = "invented";
  if (mode === "wrongRoom") spec.roomEid = f.actor;
  if (mode === "duplicateComponent") spec.components = [spec.components[1], spec.components[1]];
  expect(() => materializeApprovedEntity(f.world, spec)).toThrow();
  expect([...getAllEntities(f.world)]).toEqual(before); expect(f.growth.inspect()).toMatchObject({ attempts: 0, rejected: 1 }); f.growth.dispose();
});

test.each(["Eaten pastry", "Removed lamp", "Old table"])("does not recreate protected identity %s", name => {
  const f = fixture(); if (name === "Old table") addComponent(f.world, f.table, Removed);
  const before = [...getAllEntities(f.world)]; expect(() => materializeApprovedEntity(f.world, f.spec("site-1", name))).toThrow(/replace/);
  expect([...getAllEntities(f.world)]).toEqual(before); f.growth.dispose();
});

test.each(["actor", "collider", "anchor", "staleRoom", "staleActor", "budget", "notReady"])("native %s change is rechecked before allocation", change => {
  const f = fixture();
  if (change === "actor") { Position.x[f.actor] = 3; Position.y[f.actor] = 7; }
  if (change === "collider") { Position.x[f.table] = 3; Position.y[f.table] = 7; }
  if (change === "anchor") f.view.props[0].anchors = [{ x: -2, y: 2 }];
  if (change === "staleRoom") WorkingMemoryIdentity.id[f.room] = "replacement-room";
  if (change === "staleActor") WorkingMemoryIdentity.id[f.actor] = "replacement-actor";
  if (change === "budget") configureWorldConstructionBudget(f.world, getWorldConstructionStatus(f.world).admitted);
  if (change === "notReady") f.setReady(false);
  const before = [...getAllEntities(f.world)]; expect(() => materializeApprovedEntity(f.world, f.spec())).toThrow();
  expect([...getAllEntities(f.world)]).toEqual(before); expect(f.growth.inspect().attempts).toBe(0); f.growth.dispose();
});

test("only four lifetime builds are allowed and attempted sites cannot be reused", () => {
  const f = fixture();
  for (let i = 1; i <= 4; i++) materializeApprovedEntity(f.world, f.spec(`site-${i}`, `Chair ${i}`));
  expect(() => materializeApprovedEntity(f.world, f.spec("site-1", "Repeat"))).toThrow(/attempted/);
  expect(() => materializeApprovedEntity(f.world, f.spec("site-5", "Fifth"))).toThrow(/budget/);
  expect(f.growth.inspect()).toMatchObject({ attempts: 4, available: [] }); f.growth.dispose();
});

test("a post-allocation adoption failure retains native evidence and burns the site without retry", () => {
  const f = fixture({ commit: () => { throw Error("Renderer adoption failed after mutation"); } });
  const before = getWorldConstructionStatus(f.world).admitted;
  expect(() => materializeApprovedEntity(f.world, f.spec())).toThrow(/adoption failed/);
  const row = f.growth.inspect().builds[0]; expect(row).toMatchObject({ status: "failed", name: "New garden chair" });
  expect(row.eid).toBeDefined(); expect(hasComponent(f.world, row.eid!, PhysicalObject)).toBe(true);
  expect(Name.value[row.eid!]).toBe(row.name); expect(getWorldConstructionStatus(f.world).admitted).toBe(before + 1);
  expect(() => materializeApprovedEntity(f.world, f.spec())).toThrow(/attempted/); f.growth.dispose();
});

test.each(["source", "oldActor"])("reentrant %s change during adoption retains failed partial work", kind => {
  let f: ReturnType<typeof fixture>;
  f = fixture({ commit: () => { if (kind === "source") stopCommittedEvents(f.world); else Position.x[f.actor] += .5; } });
  expect(() => materializeApprovedEntity(f.world, f.spec())).toThrow();
  const row = f.growth.inspect().builds[0]; expect(row.status).toBe("failed"); expect(row.eid).toBeDefined();
  expect(hasComponent(f.world, row.eid!, PhysicalObject)).toBe(true); expect(row.feedbackCount).toBe(0); f.growth.dispose();
});

test.each(["stop", "restart", "dispose"])("%s invalidates growth and does not restore unrestricted native creation", lifecycle => {
  const f = fixture(); if (lifecycle === "dispose") f.growth.dispose(); else stopCommittedEvents(f.world);
  if (lifecycle === "restart") startCommittedEvents(f.world);
  expect(() => materializeApprovedEntity(f.world, f.spec())).toThrow(/no longer current/);
  expect(f.growth.inspect()).toMatchObject({ current: false, available: [] }); f.growth.dispose();
});

test("feedback excludes pending, failed, unrelated actions and private speech; inspection is detached", () => {
  const f = fixture(), eid = materializeApprovedEntity(f.world, f.spec());
  for (const status of ["pending", "failed"] as const) publishCommittedEvent(f.world, { executionId: status, kind: "action", actorId: f.actor, roomId: f.room, targetId: eid, action: "interact", status });
  publishCommittedEvent(f.world, { executionId: "speech", kind: "speech", actorId: f.actor, roomId: f.room, targetId: eid, action: "speak", status: "succeeded", text: "PRIVATE unrelated content" });
  expect(f.growth.inspect().builds[0].feedbackCount).toBe(0);
  const view = f.growth.inspect(); view.builds[0].name = "Changed";
  expect(f.growth.inspect().builds[0].name).toBe("New garden chair");
  expect(JSON.stringify(f.growth.inspect())).not.toContain("PRIVATE"); f.growth.dispose();
});

test("full authored town preserves every room, interaction and resident route during four furnishing preflights", () => {
  const world = createArgosWorld("Whole town growth preflight"); initializeRegistry(world); startCommittedEvents(world);
  const ids = new Map<string, number>(), blueprint = TOWN_SPATIAL_BLUEPRINT;
  const ref = (eid: number) => ({ eid, key: workingMemoryEntityRef(world, eid)!.key });
  const spatial = createSpatialWorld(world, { bounds: TOWN_WORLD_BOUNDS, cellSize: .5, actorRadius: .18 });
  const view: TownGrowthSnapshot = { rooms: [], props: [], actors: [] };
  for (const room of blueprint.rooms) {
    const eid = materializeApprovedEntity(world, { name: room.name, description: room.description, type: "room",
      components: [{ name: "Position", values: { x: room.entry.x, y: room.entry.y } }] }); ids.set(room.id, eid);
    view.rooms.push({ ...ref(eid), bounds: room.bounds, entry: room.entry }); spatial.registerRoom(eid, { bounds: room.bounds, entry: room.entry });
  }
  for (const prop of blueprint.props) {
    const asset = SPATIAL_ASSETS[prop.assetId];
    const eid = materializeApprovedEntity(world, { name: prop.name, description: prop.description, type: "object", roomEid: ids.get(prop.roomId),
      components: [{ name: "ObjectType", values: { typeId: asset.objectType } }, { name: "Position", values: { x: prop.position.x, y: prop.position.y } }] }); ids.set(prop.id, eid);
    view.props.push({ ...ref(eid), ...(asset.collider ? { collider: asset.collider } : {}), anchors: prop.interactionAnchors });
    if (asset.collider) spatial.registerObstacle(eid, asset.collider); spatial.registerTarget(eid, { anchors: prop.interactionAnchors });
  }
  for (const wall of blueprint.walls) {
    const eid = materializeApprovedEntity(world, { name: wall.id, description: "Solid wall", type: "object", roomEid: ids.get(wall.roomId),
      components: [{ name: "ObjectType", values: { typeId: "object" } }, { name: "Position", values: { x: wall.position.x, y: wall.position.y } }] });
    const collider = { halfWidth: wall.halfWidth, halfDepth: wall.halfDepth };
    view.props.push({ ...ref(eid), collider }); spatial.registerObstacle(eid, collider);
  }
  for (const spawn of blueprint.spawns) {
    const eid = materializeApprovedEntity(world, { name: spawn.name, description: "Resident", type: "agent", roomEid: ids.get(spawn.roomId),
      components: [{ name: "Position", values: { x: spawn.position.x, y: spawn.position.y } }] }); view.actors.push(ref(eid));
  }
  const roomEid = ids.get("common-square")!;
  const growth = createSpatialTownGrowth({ world, spatial, bounds: TOWN_WORLD_BOUNDS, cellSize: .5, ready: () => true,
    sites: [[24, 15], [24, 19], [28, 19], [20, 19]].map(([x, y], i) => ({ id: `park-seat-${i}`, roomEid, position: { x, y }, anchors: [{ x: 0, y: 1 }], allowedAssets: ["chair"] })), snapshot: () => view,
    commit(eid, addition) { view.props.push({ ...ref(eid), collider: SPATIAL_ASSETS.chair.collider, anchors: addition.anchors }); } });
  const timings: Array<{ preflightMs: number; totalConstructionMs: number }> = [];
  for (let i = 0; i < 4; i++) {
    const began = performance.now();
    const eid = materializeApprovedEntity(world, { name: `New park seat ${i}`, description: "A real seat facing the common", type: "object", roomEid,
      components: [{ name: "ObjectType", values: { typeId: "chair" } }, { name: "SpatialPlacement", values: { assetId: "chair", siteId: `park-seat-${i}` } }] });
    timings.push({ preflightMs: growth.inspect().builds[i].preflightMs, totalConstructionMs: performance.now() - began });
    expect(growth.inspect().builds[i]).toMatchObject({ status: "built", eid });
    expect(view.actors.every(actor => spatial.canReach(actor.eid, eid))).toBe(true);
  }
  console.info("Full town growth preflight:", { rooms: view.rooms.length, existingPropsBeforeGrowth: view.props.length - 4, actors: view.actors.length,
    timings });
  growth.dispose(); spatial.dispose();
});

test("local broadphase preserves exact native geometry for tile seams, tiny floor gaps, long segments and invalid points", () => {
  const bounds = { minX: -2, minY: -2, maxX: 10, maxY: 8 };
  const floors = [{ ...bounds, maxX: 3.999 }, { ...bounds, minX: 4.001 }];
  const obstacles = [{ minX: 1.82, minY: -2, maxX: 2.1, maxY: 3 }, { minX: 6, minY: 3.8, maxX: 6.05, maxY: 8 }];
  const native = createSpatialGeometry(bounds, floors, obstacles, .18, .5);
  const broad = createTownGrowthGeometry(bounds, floors, obstacles);
  const points = [{ x: NaN, y: 0 }, { x: -2.1, y: 0 }, { x: 10, y: 8 }];
  for (let x = -1.75; x < 10; x += .5) for (let y = -1.75; y < 8; y += .5) points.push({ x, y });
  for (const point of points) {
    expect(broad.pointClear(point)).toBe(native.pointClear(point));
    for (const [dx, dy] of [[0, 0], [.5, 0], [0, .5], [.51, -.49], [1.5, 1.5], [5.5, 4.3]]) {
      const other = { x: point.x + dx, y: point.y + dy };
      expect(broad.segmentClear(point, other)).toBe(native.segmentClear(point, other));
    }
  }
  // Input edits cannot corrupt already memoized tiles or future lazy tiles.
  floors[0].maxX = 10; obstacles.length = 0; bounds.maxX = 100;
  expect(broad.pointClear({ x: 2, y: 2 })).toBe(false);
  expect(broad.segmentClear({ x: 3, y: 6 }, { x: 5, y: 6 })).toBe(false);
});

test("shared growth connectivity agrees with native BFS for continuous endpoints, floor gaps and blocked components", () => {
  const bounds = { minX: 0, minY: 0, maxX: 8, maxY: 8 };
  const shapes = [
    createSpatialGeometry(bounds, [bounds], [{ minX: 3, minY: 0, maxX: 4, maxY: 6 }], .18, .5),
    createSpatialGeometry(bounds, [{ ...bounds, maxX: 3.99 }, { ...bounds, minX: 4.01 }], [], 0, .5),
    createSpatialGeometry(bounds, [bounds], [{ minX: 3, minY: 0, maxX: 4, maxY: 8 }], .18, .5),
    createSpatialGeometry(bounds, [bounds], [{ minX: 3, minY: 0, maxX: 4, maxY: 4 }, { minX: 0, minY: 4, maxX: 3, maxY: 5 }], .18, .5),
  ];
  const points = [{ x: 1.13, y: 1.04 }, { x: 6.27, y: 2.31 }, { x: 2.95, y: 6.1 }, { x: 4.25, y: 7.5 }, { x: 3.5, y: 1 }, { x: .05, y: 1 }, { x: 2, y: 7 }];
  for (const geometry of shapes) {
    const reachable = createTownGrowthReachability(bounds, geometry);
    for (const from of points) for (const to of points) expect(reachable(from, to)).toBe(findSpatialPath(from, to, bounds, .5, geometry) !== undefined);
  }
});

test("occupied-seat egress uses its own shape and never permits growth on a seated actor", () => {
  const f = fixture(); setSeat();
  function setSeat() {
    addComponent(f.world, f.actor, SittingOn(f.table)); ObjectState.current[f.table] = "occupied";
    Position.x[f.actor] = Position.x[f.table]; Position.y[f.actor] = Position.y[f.table];
  }
  expect(materializeApprovedEntity(f.world, f.spec())).toBeDefined();
  // Moving the real actor onto another candidate remains a hard overlap, not a
  // transferable seat exemption for that new object's footprint.
  Position.x[f.actor] = 6; Position.y[f.actor] = 7;
  expect(() => materializeApprovedEntity(f.world, f.spec("site-2", "Blocked chair"))).toThrow(/overlap/);
  f.growth.dispose();
});
