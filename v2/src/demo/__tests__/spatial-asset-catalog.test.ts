import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArgosWorld } from "../../ecs/world";
import { initializeRegistry } from "../../ecs/component-registry";
import { ObjectType, PhysicalObject, Position } from "../../ecs/components";
import { getRoomForEntity } from "../../ecs/location";
import { workingMemoryEntityRef } from "../../cognition/working-memory";
import { startCommittedEvents } from "../../runtime/committed-events";
import { materializeApprovedEntity } from "../../engineering/entity-materialization";
import { createSpatialWorld } from "../../world/spatial-world";
import { SPATIAL_ASSETS } from "../spatial-catalog";
import { describeSpatialCatalog, getSpatialAssetEntry, listGrowableSpatialAssets, loadSpatialAssetCatalog, registerSpatialAsset,
  spatialAssetModel, validateSpatialAssetManifest } from "../spatial-asset-registry";
import { createSpatialTownGrowth, type TownGrowthAddition, type TownGrowthSnapshot } from "../spatial-town-growth";

const license = { source: "test fixture", license: "CC0-1.0" };
const base = { name: "Barrel", size: { x: .6, y: .9, z: .6 }, objectType: "object", affordances: ["examine"], license };
const glb = () => Buffer.concat([Buffer.from("glTF", "latin1"), Buffer.alloc(40)]);
function assetRoot() {
  const root = mkdtempSync(join(tmpdir(), "argos-assets-")); mkdirSync(join(root, "catalog")); mkdirSync(join(root, "models"));
  writeFileSync(join(root, "models", "barrel.glb"), glb()); writeFileSync(join(root, "models", "fake.glb"), "this is plainly not a model file at all");
  return root;
}

describe("manifest validation binds meshes to native behaviour", () => {
  test.each([
    ["unknown native type", { ...base, id: "t-a", objectType: "spaceship" }, /unknown native object type/],
    ["verb the type cannot do", { ...base, id: "t-b", affordances: ["sit"] }, /cannot support sit/],
    ["state the type lacks", { ...base, id: "t-c", objectType: "chair", initialState: "open", affordances: ["sit"] }, /has no state/],
    ["verb the host does not execute", { ...base, id: "t-d", affordances: ["teleport"] }, /./],
    ["portable and solid", { ...base, id: "t-e", portable: true, solid: true }, /portable items are small and never solid/],
    ["bad id", { ...base, id: "Bad Id" }, /./],
  ])("rejects %s", (_label, manifest, error) => {
    expect(() => validateSpatialAssetManifest(manifest)).toThrow(error);
    expect(SPATIAL_ASSETS[(manifest as any).id]).toBeUndefined();
  });

  test("model files must be real binary glTF inside the asset root", () => {
    const root = assetRoot();
    expect(() => validateSpatialAssetManifest({ ...base, id: "t-f", model: "models/missing.glb" }, { assetRoot: root })).toThrow(/does not exist/);
    expect(() => validateSpatialAssetManifest({ ...base, id: "t-g", model: "../../etc/passwd.glb" }, { assetRoot: root })).toThrow(/inside the asset directory/);
    expect(() => validateSpatialAssetManifest({ ...base, id: "t-h", model: "models/fake.glb" }, { assetRoot: root })).toThrow(/not a binary glTF/);
    expect(validateSpatialAssetManifest({ ...base, id: "t-i", model: "models/barrel.glb" }, { assetRoot: root }).model).toBe("models/barrel.glb");
  });

  test("seating and containers need the matching native type", () => {
    expect(() => validateSpatialAssetManifest({ ...base, id: "t-j", objectType: "chair", initialState: "empty", affordances: ["sit"] })).not.toThrow();
    expect(() => validateSpatialAssetManifest({ ...base, id: "t-k", objectType: "chest", initialState: "closed", affordances: ["open", "close", "examine"] })).not.toThrow();
    expect(() => validateSpatialAssetManifest({ ...base, id: "t-l", objectType: "table", affordances: ["open"] })).toThrow(/cannot support open/);
  });
});

test("built-ins and the shipped Kenney models are catalogued without changing native definitions", () => {
  const ids = listGrowableSpatialAssets().map(entry => entry.id);
  for (const id of ["chair", "table", "plant", "lamp", "supply-box", "sofa", "cafe-table", "bookcase", "cabinet", "rug"]) expect(ids).toContain(id);
  expect(SPATIAL_ASSETS.chair.affordances).toEqual(["sit"]);
  expect(spatialAssetModel("bookcase")).toBe("furniture/bookcaseOpen.glb");
  expect(SPATIAL_ASSETS.cabinet).toMatchObject({ objectType: "chest", affordances: ["open", "close", "examine"] });
  expect(SPATIAL_ASSETS.rug.collider).toBeUndefined(); // walkable
  expect(describeSpatialCatalog().find(row => row.assetId === "lamp")).toMatchObject({ where: "indoors" });
});

test("a catalog directory registers valid kinds and reports, never half-registers, invalid ones", () => {
  const root = assetRoot();
  writeFileSync(join(root, "catalog", "coast.json"), JSON.stringify({ assets: [
    { ...base, id: "test-barrel", model: "models/barrel.glb", tags: ["coastal", "storage"] },
    { ...base, id: "test-broken", objectType: "spaceship" },
  ] }));
  writeFileSync(join(root, "catalog", "garbage.json"), "{ not json");
  const result = loadSpatialAssetCatalog(root);
  expect(result.registered).toEqual(["test-barrel"]);
  expect(result.rejected.map(row => row.file)).toEqual(expect.arrayContaining([expect.stringContaining("test-broken"), "garbage.json"]));
  expect(SPATIAL_ASSETS["test-barrel"]).toMatchObject({ objectType: "object", collider: { halfWidth: .3, halfDepth: .3 } });
  expect(SPATIAL_ASSETS["test-broken"]).toBeUndefined();
  expect(loadSpatialAssetCatalog(root).registered).toEqual(["test-barrel"]); // idempotent reload
  expect(() => registerSpatialAsset({ ...base, id: "test-barrel", size: { x: 1, y: 1, z: 1 } })).toThrow(/already registered/);
  expect(() => registerSpatialAsset({ ...base, id: "chair" })).toThrow();
});

function town(environment: "indoor" | "outdoor" = "indoor") {
  const world = createArgosWorld("Catalog growth"); initializeRegistry(world); startCommittedEvents(world);
  const bounds = { minX: 0, minY: 0, maxX: 12, maxY: 10 };
  const room = materializeApprovedEntity(world, { name: "Net House", description: "A workshop", type: "room", components: [{ name: "Position", values: { x: 1, y: 1 } }] });
  const actor = materializeApprovedEntity(world, { name: "Ada", description: "Resident", type: "agent", roomEid: room, components: [{ name: "Position", values: { x: 2, y: 2 } }] });
  const table = materializeApprovedEntity(world, { name: "Work table", description: "Existing table", type: "object", roomEid: room,
    components: [{ name: "ObjectType", values: { typeId: "table" } }, { name: "Position", values: { x: 8, y: 6 } }] });
  const ref = (eid: number) => ({ eid, key: workingMemoryEntityRef(world, eid)!.key });
  const view: TownGrowthSnapshot = { rooms: [{ ...ref(room), bounds, entry: { x: 1, y: 1 } }],
    props: [{ ...ref(table), collider: SPATIAL_ASSETS.table.collider, anchors: [{ x: 0, y: 1 }] }], actors: [ref(actor)] };
  const spatial = createSpatialWorld(world, { bounds, cellSize: .5, actorRadius: .18 });
  spatial.registerRoom(room, { bounds, entry: { x: 1, y: 1 } }); spatial.registerObstacle(table, SPATIAL_ASSETS.table.collider!);
  const built: TownGrowthAddition[] = [];
  const growth = createSpatialTownGrowth({ world, spatial, bounds, cellSize: .5, sites: [], ready: () => true, snapshot: () => view,
    maxAttempts: 4, environment: () => environment, commit: (eid, addition) => {
      view.props.push({ ...ref(eid), collider: SPATIAL_ASSETS[addition.assetId].collider, anchors: addition.anchors }); built.push(addition);
    } });
  const build = (assetId: string, name: string, near?: string) => materializeApprovedEntity(world, { name, description: `A ${name}.`, type: "object", roomEid: room,
    components: [{ name: "ObjectType", values: { typeId: SPATIAL_ASSETS[assetId].objectType } }, { name: "SpatialPlacement", values: { assetId, ...(near ? { near } : {}) } }] });
  return { world, room, actor, table, spatial, growth, build, built };
}

describe("free placement: any catalog kind, anywhere valid, the host owns coordinates", () => {
  test("a catalog kind builds without a fixed site, near a named landmark, and is reachable", () => {
    const f = town();
    const eid = f.build("bookcase", "Callum's record shelves", "Work table");
    expect(getRoomForEntity(f.world, eid)).toBe(f.room); expect(ObjectType.typeId[eid]).toBe("object");
    const at = { x: Position.x[eid], y: Position.y[eid] };
    expect(Math.hypot(at.x - 8, at.y - 6)).toBeLessThan(3); // beside the table, not the room centre
    expect(f.spatial.canReach(f.actor, eid)).toBe(true);
    expect(f.built[0].siteId).toMatch(/^free-/);
    expect(f.growth.inspect().builds[0]).toMatchObject({ eid, status: "built", assetId: "bookcase" });
  });

  test("successive pieces find distinct free spots and keep every earlier piece reachable", () => {
    const f = town(), ids = [f.build("cafe-table", "Card table"), f.build("chair", "Card chair", "Card table"), f.build("cabinet", "Tackle cabinet")];
    const spots = ids.map(eid => `${Position.x[eid]},${Position.y[eid]}`);
    expect(new Set(spots).size).toBe(3);
    for (const eid of ids) expect(f.spatial.canReach(f.actor, eid)).toBe(true);
  });

  test("walkable kinds are not obstacles; indoor-only kinds are refused outdoors", () => {
    const f = town();
    const rug = f.build("rug", "Braided rug");
    expect(PhysicalObject.portable[rug]).toBe(false); expect(SPATIAL_ASSETS.rug.collider).toBeUndefined();
    const outside = town("outdoor");
    expect(() => outside.build("lamp", "Reading lamp")).toThrow(/does not belong outdoors/);
    expect(outside.growth.inspect().attempts).toBe(0);
  });

  test("unknown kinds and exhausted budgets are refused before anything is built", () => {
    const f = town();
    expect(() => f.build("chair", "Throne", undefined) && materializeApprovedEntity(f.world, { name: "Nothing", description: "", type: "object", roomEid: f.room,
      components: [{ name: "SpatialPlacement", values: { assetId: "starship" } }] })).toThrow();
    for (const n of [2, 3, 4]) f.build("plant", `Fern ${n}`);
    expect(() => f.build("plant", "One too many")).toThrow(/budget exhausted/);
    expect(getSpatialAssetEntry("starship")).toBeUndefined();
  });
});
