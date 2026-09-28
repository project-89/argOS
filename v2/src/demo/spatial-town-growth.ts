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

export type TownGrowthAsset = "chair" | "table" | "plant" | "lamp";
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
const assets: TownGrowthAsset[] = ["chair", "table", "plant", "lamp"];
const label = z.string().trim().min(1).max(120), identifier = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const placement = z.object({ assetId: z.enum(["chair", "table", "plant", "lamp"]), siteId: identifier }).strict();
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
  world: World; spatial: ReturnType<typeof createSpatialWorld>; bounds: SpatialRect; cellSize: .5;
  ready: () => boolean; sites: readonly TownGrowthSite[]; snapshot: () => TownGrowthSnapshot;
  reservedNames?: readonly string[];
  /** Adopt existing native ID into renderer/host bookkeeping; never allocate. */
  commit: (eid: number, addition: TownGrowthAddition) => void;
}) {
  assertSimulationTaskActive();
  const { world, spatial } = options, source = getCommittedEvents(world), bounds = { ...options.bounds };
  if (!source.sourceId || source.stopped || !validSpatialRect(bounds) || options.cellSize !== .5
    || (Math.floor((bounds.maxX - bounds.minX) / .5) + 1) * (Math.floor((bounds.maxY - bounds.minY) / .5) + 1) > 10000)
    throw Error("Town growth requires a current source and bounded half-metre world");
  const sourceId = source.sourceId;
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
      || !site.allowedAssets.length || site.allowedAssets.some(asset => !assets.includes(asset)) || new Set(site.allowedAssets).size !== site.allowedAssets.length)
      throw Error("Town growth site must bind a real room and supported geometry");
    return { ...site, roomKey };
  });
  if (!sites.length || sites.length > 16 || new Set(sites.map(site => site.id)).size !== sites.length) throw Error("Town growth sites must be distinct and bounded");
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
    const asset = SPATIAL_ASSETS[addition.assetId], collider = asset.collider!, site = sites.find(s => s.id === addition.siteId)!;
    const room = view.rooms.find(r => r.eid === addition.roomEid);
    if (!room || room.key !== site.roomKey || !live({ eid: site.roomEid, key: site.roomKey })) throw Error("Growth site's original room is unavailable");
    const rect = (p: SpatialPoint, c: Collider) => ({ minX: p.x - c.halfWidth, minY: p.y - c.halfDepth, maxX: p.x + c.halfWidth, maxY: p.y + c.halfDepth });
    const candidate = rect(addition.position, collider);
    if (!insideSpatialRect({ x: candidate.minX, y: candidate.minY }, room.bounds) || !insideSpatialRect({ x: candidate.maxX, y: candidate.maxY }, room.bounds))
      throw Error("Growth collider leaves its native room");
    const intersects = (a: SpatialRect, b: SpatialRect) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
    const solids = view.props.filter(p => p.collider).map(p => ({ eid: p.eid, rect: rect(p.position, p.collider!) }));
    if (solids.some(row => intersects(candidate, row.rect)) || view.actors.some(actor => intersects(candidate, rect(actor.position, { halfWidth: radius, halfDepth: radius }))))
      throw Error("Growth would overlap an existing solid or actor");
    const shape = (excluded?: number) => createTownGrowthGeometry(bounds, view.rooms.map(r => r.bounds), [...solids.filter(s => s.eid !== excluded).map(s => s.rect), candidate]);
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
  const reject = (error: unknown) => {
    rejected++;
    rejections.push({ atSimMs: world.time.elapsed, reason: String(error instanceof Error ? error.message : error).slice(0, 400) });
    if (rejections.length > 32) rejections.shift();
  };
  function describe() { return `Town furnishing construction is limited to four attempts for this source. No new rooms, inhabitants, food, replacement of removed objects, or invented mechanics. Use an entity proposal with type object, the listed roomEid, public name/description, ObjectType {typeId:<matching catalog type>}, and SpatialPlacement {assetId,siteId}. No other authored components. Physics and coordinates are host-owned. Sites: ${JSON.stringify(sites.map(s => ({ id: s.id, roomEid: s.roomEid, allowedAssets: s.allowedAssets, attempted: builds.some(b => b.siteId === s.id) })))}. Catalog: ${JSON.stringify(assets.map(id => ({ assetId: id, objectType: SPATIAL_ASSETS[id].objectType, affordances: SPATIAL_ASSETS[id].affordances })))}. Construction provides an opportunity, never an NPC action or completed goal.`; }
  const unregister = registerWorldMaterializationAdapter(world, { describe, materialize(input, nativeCreate) {
    let record: Build | undefined;
    try {
      current();
      const parsed = specification.parse(input), components = parsed.components;
      if (new Set(components.map(c => c.name)).size !== components.length) throw Error("Duplicate spatial authoring component");
      const authored = placement.parse(components.find(c => c.name === "SpatialPlacement")?.values);
      const site = sites.find(s => s.id === authored.siteId);
      if (!site || site.roomEid !== parsed.roomEid || !site.allowedAssets.includes(authored.assetId)) throw Error("Unknown or incompatible town growth site");
      if (builds.some(row => row.siteId === site.id)) throw Error("Town growth site has already been attempted");
      if (attempts >= 4) throw Error("Town growth lifetime build budget exhausted");
      const asset = SPATIAL_ASSETS[authored.assetId], type = components.find(c => c.name === "ObjectType");
      if (type && (Object.keys(type.values).length !== 1 || type.values.typeId !== asset.objectType)) throw Error("Catalog, not authored components, controls native object type");
      const normalized = parsed.name.toLowerCase();
      if (names.has(normalized) || [...query(world, [Name])].some(eid => Name.value[eid]?.trim().toLowerCase() === normalized))
        throw Error("Growth cannot replace an existing, consumed or removed identity by name");
      const addition: TownGrowthAddition = { ...authored, name: parsed.name, description: parsed.description, roomEid: parsed.roomEid,
        position: { ...site.position }, anchors: site.anchors.map(p => ({ ...p })) };
      const preflightStart = performance.now(), before = validatePlacement(addition), stamp = JSON.stringify(before), preflightMs = performance.now() - preflightStart;
      const spec: MaterializedEntitySpec = { name: addition.name, description: addition.description, type: "object", roomEid: addition.roomEid, components: [
        { name: "ObjectType", values: { typeId: asset.objectType } }, { name: "ObjectState", values: { current: asset.initialState } },
        { name: "PhysicalObject", values: { portable: false } }, { name: "Position", values: { x: site.position.x, y: site.position.y, z: 0 } },
        { name: "SpatialPlacement", values: authored },
      ] };
      prepareMaterializedEntityDefinition(spec); assertWorldConstructionAvailable(world); current();
      if (JSON.stringify(scene()) !== stamp) throw Error("Town geometry changed during construction preflight");
      record = { sourceId, siteId: site.id, name: parsed.name, assetId: authored.assetId, status: "building", atSimMs: world.time.elapsed, preflightMs, feedback: [], feedbackCount: 0 };
      builds.push(record); attempts++; names.add(normalized);
      const eid = nativeCreate(spec); record.eid = eid;
      current();
      const ref = workingMemoryEntityRef(world, eid); if (!ref) throw Error("Constructed spatial object has no native identity"); record.key = ref.key;
      if (getRoomForEntity(world, eid) !== site.roomEid || ObjectType.typeId[eid] !== asset.objectType || PhysicalObject.portable[eid]
        || Position.x[eid] !== site.position.x || Position.y[eid] !== site.position.y) throw Error("Native constructor did not preserve validated spatial binding");
      // The old geometry must still match before exposing the new furnishing.
      if (JSON.stringify(scene()) !== stamp) throw Error("Town geometry changed during native allocation");
      spatial.registerObstacle(eid, asset.collider!); spatial.registerTarget(eid, { anchors: addition.anchors, reach: 1.1 });
      options.commit(eid, structuredClone(addition));
      current();
      if (!live({ eid, key: ref.key }) || getRoomForEntity(world, eid) !== site.roomEid
        || Position.x[eid] !== site.position.x || Position.y[eid] !== site.position.y) throw Error("Spatial adoption changed the constructed entity");
      const finalView = scene(), adopted = finalView.props.find(p => p.eid === eid && p.key === ref.key);
      if (!adopted || adopted.collider?.halfWidth !== asset.collider!.halfWidth || adopted.collider?.halfDepth !== asset.collider!.halfDepth
        || adopted.anchors?.length !== addition.anchors.length
        || adopted.anchors.some((a, i) => a.x !== addition.anchors[i].x || a.y !== addition.anchors[i].y)) throw Error("Host did not adopt the exact native spatial furnishing");
      if (JSON.stringify({ ...finalView, props: finalView.props.filter(p => p.eid !== eid) }) !== stamp
        || ObjectType.typeId[eid] !== asset.objectType || PhysicalObject.portable[eid]) throw Error("Town geometry changed during spatial adoption");
      record.status = "built"; return eid;
    } catch (error) { if (record) { record.status = "failed"; record.error = String(error instanceof Error ? error.message : error).slice(0, 400); } reject(error); throw error; }
  } });
  const unlisten = subscribeCommittedEvents(world, event => {
    if (disposed || event.sourceId !== sourceId || event.kind !== "action" || event.status !== "succeeded") return;
    const record = builds.find(row => row.status === "built" && row.key === event.targetKey && row.eid === event.targetId);
    if (!record || event.atSimMs < record.atSimMs || record.feedback.some(row => row.eventId === event.id)) return;
    record.feedbackCount++;
    if (record.feedback.length < 32) record.feedback.push({ eventId: event.id, actorKey: event.actorKey, action: event.action, atSimMs: event.atSimMs,
      seated: record.assetId === "chair" && getRelationTargets(world, event.actorId, SittingOn).includes(record.eid!) && ObjectState.current[record.eid!] === "occupied" });
  });
  const dispose = () => { disposed = true; unregister(); unlisten(); unstop(); };
  const unstop = subscribeCommittedSourceStop(world, () => { disposed = true; unregister(); unlisten(); });
  return {
    describe,
    inspect() { const now = getCommittedEvents(world), active = !disposed && !now.stopped && now.sourceId === sourceId; return structuredClone({ sourceId, current: active,
      limit: 4, attempts, rejected, available: active && attempts < 4 ? sites.filter(s => !builds.some(b => b.siteId === s.id)).map(s => s.id) : [], builds, rejections }); },
    dispose,
  };
}
