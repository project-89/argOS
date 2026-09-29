/** God/Weaver's existing native authoring path may add a bounded furnishing.
 * The host owns sites and physics; a model owns only a public name/description
 * and an allowed catalog/site choice. This never selects an NPC's action. */
import { getRelationTargets, hasComponent, query } from "bitecs";
import { z } from "zod/v3";
import type { World } from "../ecs/world";
import { Agent, Name, ObjectState, ObjectType, PhysicalObject, Position, Room, WorkingMemoryIdentity } from "../ecs/components";
import { SittingOn } from "../ecs/relations";
import { getRoomForEntity } from "../ecs/location";
import { isEntityPresent } from "../ecs/entity-presence";
import { extendDynamicComponent } from "../ecs/component-registry";
import { getCommittedEvents, subscribeCommittedEvents, subscribeCommittedSourceStop } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { assertWorldConstructionAvailable } from "../runtime/world-construction-budget";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { prepareMaterializedEntityDefinition, type MaterializedEntitySpec } from "../engineering/entity-materialization";
import { registerWorldMaterializationAdapter } from "../engineering/world-materialization-adapter";
import { createSpatialGeometry, insideSpatialRect, validSpatialPoint, validSpatialRect, type SpatialPoint, type SpatialRect } from "../world/spatial-path";
import type { createSpatialWorld } from "../world/spatial-world";
import { SPATIAL_ASSETS } from "./spatial-catalog";
import { describeSpatialCatalog, getSpatialAssetEntry } from "./spatial-asset-registry";

/** Any registered growable catalog kind (see spatial-asset-registry). */
export type TownGrowthAsset = string;
type Ref = { eid: number; key: string };
type Collider = { halfWidth: number; halfDepth: number };
export type TownGrowthSnapshot = {
  rooms: Array<Ref & { bounds: SpatialRect; entry: SpatialPoint }>;
  props: Array<Ref & { collider?: Collider; anchors?: SpatialPoint[] }>;
  actors: Ref[];
};
export type TownGrowthSite = { id: string; roomEid: number; position: SpatialPoint; anchors: SpatialPoint[]; allowedAssets: TownGrowthAsset[] };
export type TownGrowthAddition = { assetId: TownGrowthAsset; siteId: string; name: string; description: string;
  roomEid: number; position: SpatialPoint; anchors: SpatialPoint[] };
type Use = { eventId: string; actorKey: string; action: string; atSimMs: number; seated: boolean };
type Build = { sourceId: string; siteId: string; name: string; assetId: TownGrowthAsset; status: "building" | "built" | "failed";
  atSimMs: number; preflightMs: number; eid?: number; key?: string; error?: string; feedback: Use[]; feedbackCount: number };
const growable = (id: string) => !!getSpatialAssetEntry(id)?.growable && !!SPATIAL_ASSETS[id]?.objectType;
/** Default lifetime furnishing attempts; a host may grant more (the live town uses 12). */
export const DEFAULT_TOWN_GROWTH_ATTEMPTS = 4;
export const MAX_TOWN_GROWTH_ATTEMPTS = 16;
/** Live town budget: a living session's worth of furnishing, not a handful. */
export const TOWN_GROWTH_ATTEMPTS = 12;

/** The authored town's furnishing sites, keyed by blueprint room id. Each is
 * clear of the seed furniture, keeps its interaction anchor reachable, and is
 * rechecked against live geometry (actors, props, routes) at build time. */
export const TOWN_GROWTH_SITE_LAYOUT: ReadonlyArray<Omit<TownGrowthSite, "roomEid"> & { roomId: string }> = [
  { id: "cafe-extra-seat", roomId: "town-cafe", position: { x: 6.5, y: 32.5 }, anchors: [{ x: 0, y: -1 }], allowedAssets: ["chair"] },
  { id: "workshop-corner", roomId: "town-workshop", position: { x: 19.5, y: 32.5 }, anchors: [{ x: 0, y: -1 }], allowedAssets: ["chair", "lamp"] },
  { id: "park-gathering", roomId: "common-square", position: { x: 10, y: 19 }, anchors: [{ x: 0, y: -1.5 }], allowedAssets: ["table", "chair"] },
  { id: "garden-detail", roomId: "town-garden", position: { x: 41, y: 28.5 }, anchors: [{ x: 0, y: 1 }], allowedAssets: ["plant", "chair"] },
  { id: "cafe-window-corner", roomId: "town-cafe", position: { x: 10, y: 29 }, anchors: [{ x: -1, y: 0 }], allowedAssets: ["plant", "lamp", "chair"] },
  { id: "cafe-back-corner", roomId: "town-cafe", position: { x: 10, y: 32.5 }, anchors: [{ x: 0, y: -1 }], allowedAssets: ["chair", "lamp"] },
  { id: "workshop-door-side", roomId: "town-workshop", position: { x: 16, y: 28.5 }, anchors: [{ x: 1, y: 0 }], allowedAssets: ["supply-box", "lamp", "plant", "chair"] },
  { id: "workshop-east-wall", roomId: "town-workshop", position: { x: 23, y: 28.5 }, anchors: [{ x: -1, y: 0 }], allowedAssets: ["supply-box", "chair", "lamp"] },
  { id: "common-east-lawn", roomId: "common-square", position: { x: 36, y: 14 }, anchors: [{ x: 0, y: 1.5 }], allowedAssets: ["table", "chair", "plant", "lamp"] },
  { id: "common-west-path", roomId: "common-square", position: { x: 5, y: 13 }, anchors: [{ x: 1, y: 0 }], allowedAssets: ["lamp", "plant", "chair"] },
  { id: "garden-east-nook", roomId: "town-garden", position: { x: 44.5, y: 31.5 }, anchors: [{ x: -1, y: 0 }], allowedAssets: ["plant", "chair", "lamp", "supply-box"] },
];
/** Bind the layout to a host's native room ids; unknown rooms are skipped. */
export function townGrowthSites(roomEid: (roomId: string) => number | undefined): TownGrowthSite[] {
  return TOWN_GROWTH_SITE_LAYOUT.flatMap(({ roomId, ...site }) => {
    const eid = roomEid(roomId);
    return eid === undefined ? [] : [{ ...structuredClone(site), roomEid: eid }];
  });
}
const label = z.string().trim().min(1).max(120), identifier = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
// A site pins an authored spot; otherwise the host searches the room for free,
// reachable space near an optional named landmark. The model never picks coordinates.
const placement = z.object({ assetId: identifier.refine(growable, "Unknown or non-growable catalog asset"),
  siteId: identifier.optional(), near: z.string().trim().min(1).max(120).optional() }).strict();
const specification = z.object({ name: label, description: z.string().max(2000), type: z.literal("object"), roomEid: z.number().int().nonnegative(),
  components: z.array(z.object({ name: z.enum(["SpatialPlacement", "ObjectType"]), values: z.record(z.unknown()) }).strict()).min(1).max(2) }).strict();
const radius = .18;

/** Broadphase only: every final collision/floor decision is still made by the
 * native geometry predicates. A short query fits wholly within one tile's
 * conservative halo; irrelevant rectangles cannot intersect any point of that
 * query or its actor-radius offsets. Long segments use the full geometry.
 * The cache is bounded by the world's tiles, and lives for this preflight only. */
export function createTownGrowthGeometry(bounds: SpatialRect, floors: readonly SpatialRect[], obstacles: readonly SpatialRect[]) {
  bounds = { ...bounds }; floors = floors.map(r => ({ ...r })); obstacles = obstacles.map(r => ({ ...r }));
  const full = createSpatialGeometry(bounds, floors, obstacles, radius, .5);
  const tileSize = 2, halo = .75;
  const width = Math.ceil((bounds.maxX - bounds.minX) / tileSize), height = Math.ceil((bounds.maxY - bounds.minY) / tileSize);
  if (!validSpatialRect(bounds) || !Number.isSafeInteger(width * height) || width * height > 10000
    || !floors.every(validSpatialRect) || !obstacles.every(validSpatialRect)) return full;
  const tiles = new Map<number, ReturnType<typeof createSpatialGeometry>>();
  const intersects = (a: SpatialRect, b: SpatialRect) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
  function shape(a: SpatialPoint, b = a) {
    if (!validSpatialPoint(a) || !validSpatialPoint(b) || !insideSpatialRect(a, bounds) || !insideSpatialRect(b, bounds)) return full;
    const x = Math.min(width - 1, Math.floor((a.x - bounds.minX) / tileSize));
    const y = Math.min(height - 1, Math.floor((a.y - bounds.minY) / tileSize));
    const region = { minX: bounds.minX + x * tileSize - halo, minY: bounds.minY + y * tileSize - halo,
      maxX: bounds.minX + (x + 1) * tileSize + halo, maxY: bounds.minY + (y + 1) * tileSize + halo };
    if (!insideSpatialRect(b, region)) return full;
    const id = y * width + x;
    let tile = tiles.get(id);
    if (!tile) {
      const expanded = { minX: region.minX - radius, minY: region.minY - radius,
        maxX: region.maxX + radius, maxY: region.maxY + radius };
      tile = createSpatialGeometry(bounds, floors.filter(r => intersects(r, expanded)), obstacles.filter(r => intersects(r, expanded)), radius, .5);
      tiles.set(id, tile);
    }
    return tile;
  }
  return Object.freeze({ pointClear: (p: SpatialPoint) => shape(p).pointClear(p),
    segmentClear: (a: SpatialPoint, b: SpatialPoint) => shape(a, b).segmentClear(a, b) });
}

/** Many preflight questions over one immutable shape need connectivity, not a
 * distinct route each time. Lazily label each four-neighbor grid component at
 * most once; all continuous endpoint connectors remain checked per question.
 * This is the same reachability contract as findSpatialPath, without storing
 * paths or granting any movement authority. No arbitrary-coordinate cache. */
export function createTownGrowthReachability(bounds: SpatialRect, geometry: ReturnType<typeof createSpatialGeometry>) {
  bounds = { ...bounds };
  const cell = .5, width = Math.floor((bounds.maxX - bounds.minX) / cell) + 1,
    height = Math.floor((bounds.maxY - bounds.minY) / cell) + 1, count = width * height;
  if (!validSpatialRect(bounds) || !Number.isSafeInteger(count) || count < 1 || count > 10000) throw Error("Growth connectivity grid is unbounded");
  const labels = new Int32Array(count), clear = new Int8Array(count), queue = new Int32Array(count);
  let nextLabel = 0;
  const point = (id: number) => ({ x: bounds.minX + id % width * cell, y: bounds.minY + Math.floor(id / width) * cell });
  const clearPoint = (id: number) => {
    if (!clear[id]) clear[id] = geometry.pointClear(point(id)) ? 1 : -1;
    return clear[id] === 1;
  };
  function component(id: number): number {
    if (labels[id]) return labels[id];
    if (!clearPoint(id)) return -1;
    const label = ++nextLabel; labels[id] = label; queue[0] = id;
    let length = 1;
    for (let cursor = 0; cursor < length; cursor++) {
      const here = queue[cursor], x = here % width, y = Math.floor(here / width);
      for (const next of [y > 0 ? here - width : -1, x + 1 < width ? here + 1 : -1, y + 1 < height ? here + width : -1, x > 0 ? here - 1 : -1]) {
        if (next < 0 || labels[next] || !clearPoint(next) || !geometry.segmentClear(point(here), point(next))) continue;
        labels[next] = label; queue[length++] = next;
      }
    }
    return label;
  }
  function connectors(p: SpatialPoint): number[] {
    const x = Math.round((p.x - bounds.minX) / cell), y = Math.round((p.y - bounds.minY) / cell), ids: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy, id = ny * width + nx;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && clearPoint(id) && geometry.segmentClear(p, point(id))) ids.push(id);
    }
    return ids;
  }
  return (from: SpatialPoint, to: SpatialPoint): boolean => {
    if (!geometry.pointClear(from) || !geometry.pointClear(to)) return false;
    if (geometry.segmentClear(from, to)) return true;
    const starts = connectors(from), goals = connectors(to);
    const components = new Set(starts.map(component));
    return goals.some(id => components.has(component(id)));
  };
}

export function createSpatialTownGrowth(options: {
  world: World; spatial: ReturnType<typeof createSpatialWorld>; bounds: SpatialRect; cellSize: .5 | 1;
  ready: () => boolean; sites: readonly TownGrowthSite[]; snapshot: () => TownGrowthSnapshot;
  reservedNames?: readonly string[];
  /** Lifetime furnishing attempts for this source (default 4, at most 16). */
  maxAttempts?: number;
  /** Room environment, to honour a kind's indoor/outdoor placement. */
  environment?: (roomEid: number) => "indoor" | "outdoor" | undefined;
  /** Adopt existing native ID into renderer/host bookkeeping; never allocate. */
  commit: (eid: number, addition: TownGrowthAddition) => void;
}) {
  assertSimulationTaskActive();
  const { world, spatial } = options, source = getCommittedEvents(world), bounds = { ...options.bounds };
  if (!source.sourceId || source.stopped || !validSpatialRect(bounds) || (options.cellSize !== .5 && options.cellSize !== 1)
    || (Math.floor((bounds.maxX - bounds.minX) / options.cellSize) + 1) * (Math.floor((bounds.maxY - bounds.minY) / options.cellSize) + 1) > 65536)
    throw Error("Town growth requires a current source and a bounded half-metre or metre world");
  const sourceId = source.sourceId, limit = options.maxAttempts ?? DEFAULT_TOWN_GROWTH_ATTEMPTS;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_TOWN_GROWTH_ATTEMPTS) throw Error("Town growth attempt budget must be 1-16");
  let disposed = false, attempts = 0, rejected = 0;
  const builds: Build[] = [], rejections: Array<{ atSimMs: number; reason: string }> = [];
  const names = new Set<string>((options.reservedNames ?? []).map(name => name.trim().toLowerCase()));
  for (const eid of query(world, [Name])) names.add(Name.value[eid]?.trim().toLowerCase());
  if (names.size > 4096) throw Error("Town growth name history exceeds its bound");
  const key = (eid: number) => hasComponent(world, eid, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[eid] : undefined;
  const live = (ref: Ref) => isEntityPresent(world, ref.eid) && !!ref.key && key(ref.eid) === ref.key;
  const point = (eid: number): SpatialPoint => {
    const p = { x: Position.x[eid], y: Position.y[eid] };
    if (!hasComponent(world, eid, Position) || !validSpatialPoint(p)) throw Error("Spatial dependency has no current position");
    return p;
  };
  const current = () => {
    assertSimulationTaskActive();
    const now = getCommittedEvents(world);
    if (disposed || now.stopped || now.sourceId !== sourceId || !options.ready()) throw Error("Town growth source or host is no longer ready");
  };
  const sites = structuredClone(options.sites).map(site => {
    identifier.parse(site.id);
    const roomKey = key(site.roomEid);
    if (!roomKey || !isEntityPresent(world, site.roomEid) || !hasComponent(world, site.roomEid, Room)
      || !validSpatialPoint(site.position) || !site.anchors.length || site.anchors.length > 8 || !site.anchors.every(validSpatialPoint)
      || !site.allowedAssets.length || site.allowedAssets.some(asset => !growable(asset)) || new Set(site.allowedAssets).size !== site.allowedAssets.length)
      throw Error("Town growth site must bind a real room and supported geometry");
    return { ...site, roomKey };
  });
  // Fixed sites are optional hints now that free placement exists.
  if (sites.length > 16 || new Set(sites.map(site => site.id)).size !== sites.length) throw Error("Town growth sites must be distinct and bounded");
  extendDynamicComponent({ name: "SpatialPlacement", description: "Host-validated town furnishing placement; no coordinate or execution authority",
    properties: { assetId: "string", siteId: "string" } });

  function scene() {
    const view = structuredClone(options.snapshot());
    if (!view.rooms.length || view.rooms.length > 12 || view.props.length > 512 || view.actors.length > 16
      || new Set([...view.rooms, ...view.props, ...view.actors].map(row => row.eid)).size !== view.rooms.length + view.props.length + view.actors.length)
      throw Error("Town geometry snapshot is invalid or unbounded");
    for (const room of view.rooms) if (!live(room) || !hasComponent(world, room.eid, Room) || !validSpatialRect(room.bounds)
      || !insideSpatialRect(room.entry, room.bounds) || !insideSpatialRect({ x: room.bounds.minX, y: room.bounds.minY }, bounds)
      || !insideSpatialRect({ x: room.bounds.maxX, y: room.bounds.maxY }, bounds)) throw Error("Town room geometry is stale or invalid");
    const props = view.props.map(row => {
      if (!live(row) || !hasComponent(world, row.eid, PhysicalObject) || !view.rooms.some(room => room.eid === getRoomForEntity(world, row.eid)))
        throw Error("Town object geometry is stale");
      if (row.collider && (![row.collider.halfWidth, row.collider.halfDepth].every(n => Number.isFinite(n) && n > 0 && n <= 24))
        || row.anchors && (row.anchors.length > 8 || !row.anchors.every(validSpatialPoint))) throw Error("Town object geometry is invalid");
      return { ...row, position: point(row.eid) };
    });
    const actors = view.actors.map(row => {
      if (!live(row) || !hasComponent(world, row.eid, Agent) || !Agent.active[row.eid]
        || !view.rooms.some(room => room.eid === getRoomForEntity(world, row.eid))) throw Error("Town actor geometry is stale");
      return { ...row, position: point(row.eid) };
    });
    return { rooms: view.rooms, props, actors };
  }
  function validatePlacement(addition: TownGrowthAddition, view = scene()) {
    const asset = SPATIAL_ASSETS[addition.assetId], solid = !!asset.collider;
    const collider = asset.collider ?? { halfWidth: Math.max(.05, asset.size.x / 2), halfDepth: Math.max(.05, asset.size.z / 2) };
    const site = sites.find(s => s.id === addition.siteId);
    const room = view.rooms.find(r => r.eid === addition.roomEid);
    if (!room || site && (room.key !== site.roomKey || !live({ eid: site.roomEid, key: site.roomKey }))) throw Error("Growth site's original room is unavailable");
    const rect = (p: SpatialPoint, c: Collider) => ({ minX: p.x - c.halfWidth, minY: p.y - c.halfDepth, maxX: p.x + c.halfWidth, maxY: p.y + c.halfDepth });
    const candidate = rect(addition.position, collider);
    if (!insideSpatialRect({ x: candidate.minX, y: candidate.minY }, room.bounds) || !insideSpatialRect({ x: candidate.maxX, y: candidate.maxY }, room.bounds))
      throw Error("Growth collider leaves its native room");
    const intersects = (a: SpatialRect, b: SpatialRect) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
    const solids = view.props.filter(p => p.collider).map(p => ({ eid: p.eid, rect: rect(p.position, p.collider!) }));
    if (solids.some(row => intersects(candidate, row.rect)) || view.actors.some(actor => intersects(candidate, rect(actor.position, { halfWidth: radius, halfDepth: radius }))))
      throw Error("Growth would overlap an existing solid or actor");
    const shape = (excluded?: number) => createTownGrowthGeometry(bounds, view.rooms.map(r => r.bounds), [...solids.filter(s => s.eid !== excluded).map(s => s.rect), ...(solid ? [candidate] : [])]);
    const origin = view.rooms[0].entry, reachable = createTownGrowthReachability(bounds, shape());
    if (view.rooms.some(r => !reachable(origin, r.entry))) throw Error("Growth would disconnect a room");
    for (const prop of view.props) for (const anchor of prop.anchors ?? []) {
      const local = view.rooms.find(r => r.eid === getRoomForEntity(world, prop.eid))!;
      if (!reachable(local.entry, { x: prop.position.x + anchor.x, y: prop.position.y + anchor.y })) throw Error("Growth would block an existing interaction");
    }
    for (const anchor of addition.anchors) if (!reachable(room.entry, { x: addition.position.x + anchor.x, y: addition.position.y + anchor.y }))
      throw Error("Growth interaction is unreachable");
    for (const actor of view.actors) {
      // Only the exact occupied native seat grants an egress exemption. No
      // generic overlap, a newly placed obstacle or another seat is ignored.
      const seat = view.props.find(p => !!p.collider && getRelationTargets(world, actor.eid, SittingOn).includes(p.eid)
        && ObjectState.current[p.eid] === "occupied" && getRoomForEntity(world, p.eid) === getRoomForEntity(world, actor.eid)
        && Math.abs(p.position.x - actor.position.x) <= p.collider.halfWidth + radius
        && Math.abs(p.position.y - actor.position.y) <= p.collider.halfDepth + radius);
      const actorReachable = seat ? createTownGrowthReachability(bounds, shape(seat.eid)) : reachable;
      if (!actorReachable(actor.position, origin)) throw Error("Growth would trap a current actor");
    }
    return view;
  }
  /** Search the room for a free, reachable spot, nearest an optional landmark.
   * Every candidate still passes the full validatePlacement preflight. */
  function findFreePlacement(assetId: string, roomEid: number, near: string | undefined, view = scene()) {
    const asset = SPATIAL_ASSETS[assetId], entry = getSpatialAssetEntry(assetId)!;
    const room = view.rooms.find(r => r.eid === roomEid);
    if (!room) throw Error("Growth needs a current room");
    const env = options.environment?.(roomEid);
    if (env && !entry.placement[env]) throw Error(`${entry.name} does not belong ${env === "indoor" ? "indoors" : "outdoors"}`);
    const half = asset.collider ?? { halfWidth: Math.max(.05, asset.size.x / 2), halfDepth: Math.max(.05, asset.size.z / 2) };
    const needle = near?.trim().toLowerCase();
    const landmark = needle ? view.props.find(p => getRoomForEntity(world, p.eid) === roomEid && Name.value[p.eid]?.toLowerCase().includes(needle)) : undefined;
    const target = landmark?.position ?? { x: (room.bounds.minX + room.bounds.maxX) / 2, y: (room.bounds.minY + room.bounds.maxY) / 2 };
    const margin = .35, step = .5, candidates: SpatialPoint[] = [];
    for (let x = room.bounds.minX + half.halfWidth + margin; x <= room.bounds.maxX - half.halfWidth - margin + 1e-9; x += step)
      for (let y = room.bounds.minY + half.halfDepth + margin; y <= room.bounds.maxY - half.halfDepth - margin + 1e-9; y += step) candidates.push({ x: +x.toFixed(2), y: +y.toFixed(2) });
    const rect = (p: SpatialPoint, c: Collider) => ({ minX: p.x - c.halfWidth, minY: p.y - c.halfDepth, maxX: p.x + c.halfWidth, maxY: p.y + c.halfDepth });
    const gap = (a: SpatialRect, b: SpatialRect) => Math.max(a.minX - b.maxX, b.minX - a.maxX, a.minY - b.maxY, b.minY - a.maxY);
    const solids = view.props.filter(p => p.collider).map(p => rect(p.position, p.collider!));
    const clear = candidates.filter(p => {
      const r = rect(p, half);
      return Math.hypot(p.x - room.entry.x, p.y - room.entry.y) > 1.4
        && solids.every(o => gap(r, o) > .15) && view.actors.every(a => gap(r, rect(a.position, { halfWidth: radius, halfDepth: radius })) > .2);
    }).sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y));
    const reach = .55, sides: SpatialPoint[][] = entry.anchors ? [entry.anchors.map(a => ({ ...a }))]
      : [[{ x: 0, y: -(half.halfDepth + reach) }], [{ x: 0, y: half.halfDepth + reach }], [{ x: -(half.halfWidth + reach), y: 0 }], [{ x: half.halfWidth + reach, y: 0 }]];
    let lastError: unknown = Error("No free space left in that room");
    for (const position of clear.slice(0, 24)) for (const anchors of sides) {
      const addition = { assetId, siteId: "", name: "", description: "", roomEid, position, anchors };
      try { validatePlacement(addition, view); return { position, anchors }; } catch (error) { lastError = error; }
    }
    throw lastError;
  }
  const reject = (error: unknown) => {
    rejected++;
    rejections.push({ atSimMs: world.time.elapsed, reason: String(error instanceof Error ? error.message : error).slice(0, 400) });
    if (rejections.length > 32) rejections.shift();
  };
  function describe() {
    const rooms = scene().rooms.map(room => ({ roomEid: room.eid, name: Name.value[room.eid], environment: options.environment?.(room.eid) }));
    return `Town furnishing: ${Math.max(0, limit - attempts)} of ${limit} builds left for this source. Furnish and enrich the town's places with anything from the catalog that gives residents somewhere to gather, rest, read, work, keep or hide things; name and describe each in keeping with the setting and the stories underway. Use an entity proposal with type object, a roomEid below, a public name/description, ObjectType {typeId:<the kind's objectType>}, and SpatialPlacement {assetId, near?:"name of an object in that room to place it beside"} — the host finds free, reachable floor space and owns all coordinates and physics; add no other components. Optional fixed spots: SpatialPlacement {assetId, siteId}. Rooms, inhabitants, food and new mechanics come through other channels (God's story events, managed systems); a removed or consumed object stays part of the story. Rooms: ${JSON.stringify(rooms)}. Catalog: ${JSON.stringify(describeSpatialCatalog())}. Fixed spots: ${JSON.stringify(sites.map(s => ({ id: s.id, roomEid: s.roomEid, allowedAssets: s.allowedAssets, attempted: builds.some(b => b.siteId === s.id) })))}. A furnishing is an opportunity, never a resident's action or a completed goal.`;
  }
  const unregister = registerWorldMaterializationAdapter(world, { describe, materialize(input, nativeCreate) {
    let record: Build | undefined;
    try {
      current();
      const parsed = specification.parse(input), components = parsed.components;
      if (new Set(components.map(c => c.name)).size !== components.length) throw Error("Duplicate spatial authoring component");
      const authored = placement.parse(components.find(c => c.name === "SpatialPlacement")?.values);
      const site = authored.siteId === undefined ? undefined : sites.find(s => s.id === authored.siteId);
      if (authored.siteId !== undefined && (!site || site.roomEid !== parsed.roomEid || !site.allowedAssets.includes(authored.assetId))) throw Error("Unknown or incompatible town growth site");
      if (site && builds.some(row => row.siteId === site.id)) throw Error("Town growth site has already been attempted");
      if (!site && !scene().rooms.some(room => room.eid === parsed.roomEid)) throw Error("Growth room is not a current town room");
      if (attempts >= limit) throw Error("Town growth lifetime build budget exhausted");
      const asset = SPATIAL_ASSETS[authored.assetId], type = components.find(c => c.name === "ObjectType");
      if (type && (Object.keys(type.values).length !== 1 || type.values.typeId !== asset.objectType)) throw Error("Catalog, not authored components, controls native object type");
      const normalized = parsed.name.toLowerCase();
      if (names.has(normalized) || [...query(world, [Name])].some(eid => Name.value[eid]?.trim().toLowerCase() === normalized))
        throw Error("Growth cannot replace an existing, consumed or removed identity by name");
      const spot = site ? { position: { ...site.position }, anchors: site.anchors.map(p => ({ ...p })) } : findFreePlacement(authored.assetId, parsed.roomEid, authored.near);
      const siteId = site?.id ?? `free-${attempts + 1}`;
      const addition: TownGrowthAddition = { assetId: authored.assetId, siteId, name: parsed.name, description: parsed.description, roomEid: parsed.roomEid,
        position: { ...spot.position }, anchors: spot.anchors.map(p => ({ ...p })) };
      const entry = getSpatialAssetEntry(authored.assetId)!;
      const preflightStart = performance.now(), before = validatePlacement(addition), stamp = JSON.stringify(before), preflightMs = performance.now() - preflightStart;
      const spec: MaterializedEntitySpec = { name: addition.name, description: addition.description, type: "object", roomEid: addition.roomEid, components: [
        { name: "ObjectType", values: { typeId: asset.objectType } }, { name: "ObjectState", values: { current: asset.initialState } },
        { name: "PhysicalObject", values: { portable: entry.portable } }, { name: "Position", values: { x: addition.position.x, y: addition.position.y, z: 0 } },
        { name: "SpatialPlacement", values: { assetId: addition.assetId, siteId } },
      ] };
      prepareMaterializedEntityDefinition(spec); assertWorldConstructionAvailable(world); current();
      if (JSON.stringify(scene()) !== stamp) throw Error("Town geometry changed during construction preflight");
      record = { sourceId, siteId, name: parsed.name, assetId: authored.assetId, status: "building", atSimMs: world.time.elapsed, preflightMs, feedback: [], feedbackCount: 0 };
      builds.push(record); attempts++; names.add(normalized);
      const eid = nativeCreate(spec); record.eid = eid;
      current();
      const ref = workingMemoryEntityRef(world, eid); if (!ref) throw Error("Constructed spatial object has no native identity"); record.key = ref.key;
      if (getRoomForEntity(world, eid) !== addition.roomEid || ObjectType.typeId[eid] !== asset.objectType || !!PhysicalObject.portable[eid] !== entry.portable
        || Position.x[eid] !== addition.position.x || Position.y[eid] !== addition.position.y) throw Error("Native constructor did not preserve validated spatial binding");
      // The old geometry must still match before exposing the new furnishing.
      if (JSON.stringify(scene()) !== stamp) throw Error("Town geometry changed during native allocation");
      if (asset.collider) spatial.registerObstacle(eid, asset.collider);
      spatial.registerTarget(eid, { anchors: addition.anchors, reach: 1.1 });
      options.commit(eid, structuredClone(addition));
      current();
      if (!live({ eid, key: ref.key }) || getRoomForEntity(world, eid) !== addition.roomEid
        || Position.x[eid] !== addition.position.x || Position.y[eid] !== addition.position.y) throw Error("Spatial adoption changed the constructed entity");
      const finalView = scene(), adopted = finalView.props.find(p => p.eid === eid && p.key === ref.key);
      if (!adopted || adopted.collider?.halfWidth !== asset.collider?.halfWidth || adopted.collider?.halfDepth !== asset.collider?.halfDepth
        || adopted.anchors?.length !== addition.anchors.length
        || adopted.anchors.some((a, i) => a.x !== addition.anchors[i].x || a.y !== addition.anchors[i].y)) throw Error("Host did not adopt the exact native spatial furnishing");
      if (JSON.stringify({ ...finalView, props: finalView.props.filter(p => p.eid !== eid) }) !== stamp
        || ObjectType.typeId[eid] !== asset.objectType || !!PhysicalObject.portable[eid] !== entry.portable) throw Error("Town geometry changed during spatial adoption");
      record.status = "built"; return eid;
    } catch (error) { if (record) { record.status = "failed"; record.error = String(error instanceof Error ? error.message : error).slice(0, 400); } reject(error); throw error; }
  } });
  const unlisten = subscribeCommittedEvents(world, event => {
    if (disposed || event.sourceId !== sourceId || event.kind !== "action" || event.status !== "succeeded") return;
    const record = builds.find(row => row.status === "built" && row.key === event.targetKey && row.eid === event.targetId);
    if (!record || event.atSimMs < record.atSimMs || record.feedback.some(row => row.eventId === event.id)) return;
    record.feedbackCount++;
    if (record.feedback.length < 32) record.feedback.push({ eventId: event.id, actorKey: event.actorKey, action: event.action, atSimMs: event.atSimMs,
      seated: SPATIAL_ASSETS[record.assetId]?.objectType === "chair" && getRelationTargets(world, event.actorId, SittingOn).includes(record.eid!) && ObjectState.current[record.eid!] === "occupied" });
  });
  const dispose = () => { disposed = true; unregister(); unlisten(); unstop(); };
  const unstop = subscribeCommittedSourceStop(world, () => { disposed = true; unregister(); unlisten(); });
  return {
    describe,
    inspect() { const now = getCommittedEvents(world), active = !disposed && !now.stopped && now.sourceId === sourceId; return structuredClone({ sourceId, current: active,
      limit, attempts, rejected, available: active && attempts < limit ? sites.filter(s => !builds.some(b => b.siteId === s.id)).map(s => s.id) : [], builds, rejections }); },
    dispose,
  };
}
