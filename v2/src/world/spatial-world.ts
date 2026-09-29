/** Authoritative single-floor locomotion over ECS Position.x/y. Presentation
 * maps these to x/z; it never supplies positions or completion receipts.
 * Geometry is explicitly installed native world data, not model coordinates.
 * In-flight work is source-scoped and intentionally never resumed from saves. */
import { entityExists, getRelationTargets, hasComponent, query } from "bitecs";
import { randomUUID } from "node:crypto";
import type { World } from "../ecs/world";
import { Agent, ObjectState, Position, Room, WorkingMemoryIdentity } from "../ecs/components";
import { SittingOn } from "../ecs/relations";
import { getRoomForEntity, releaseDepartedSeating, setLocatedIn } from "../ecs/location";
import { isEntityPresent } from "../ecs/entity-presence";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents, startCommittedEvents, subscribeCommittedSourceStop } from "../runtime/committed-events";
import { assertSimulationTaskActive, getSimulationTaskSignal } from "../runtime/task-scope";
import { createSpatialGeometry, findSpatialPath, insideSpatialRect, spatialDistance, validSpatialPoint, validSpatialRect,
  type SpatialPoint, type SpatialRect } from "./spatial-path";
export type { SpatialPoint, SpatialRect } from "./spatial-path";

export type SpatialOutcome = Readonly<{ requestId: string; actor: number; target: number; targetKey: string;
  status: "arrived" | "cancelled" | "failed"; reason: string; reportable: boolean; startedAtSimMs: number; completedAtSimMs: number }>;
export type SpatialAdmission = { ok: true; requestId: string; estimatedMs: number } | { ok: false; reason: string };
type Bound<T> = T & { key: string };
type RoomGeometry = Bound<{ bounds: SpatialRect; entry: SpatialPoint; origin: SpatialPoint }>;
type TargetGeometry = Bound<{ anchors: readonly SpatialPoint[]; reach: number }>;
type ObstacleGeometry = Bound<{ halfWidth: number; halfDepth: number }>;
type SeatEgress = { actorKey: string; seat: number; seatKey: string; collider: ObstacleGeometry; origin: SpatialPoint;
  room: number; roomKey: string; actorPosition: SpatialPoint };
type Work = { requestId: string; actor: number; actorKey: string; target: number; targetKey: string; targetRoom: number;
  roomKey: string; targetPosition: SpatialPoint; actorPosition: SpatialPoint; actorRoom: number; actorRoomKey: string;
  geometry: RoomGeometry | TargetGeometry; arrival: SpatialPoint; path: readonly SpatialPoint[]; cursor: number; startedAt: number; lastAt: number;
  moved: boolean; arrivalBlockedSince?: number; signal?: AbortSignal; onFinish?: (outcome: SpatialOutcome) => void;
  /** A transient ground-point walk: target is the destination room, arrival is the point. */
  point?: boolean };

// A transient crossing can delay a final approach, but cannot strand its action
// forever. This is native source-time congestion, not a new decision controller.
const ARRIVAL_WAIT_LIMIT_MS = 5000;

export function createSpatialWorld(world: World, options: {
  bounds: SpatialRect; cellSize?: number; speed?: number; actorRadius?: number; maxCells?: number;
}) {
  assertSimulationTaskActive();
  const bounds = Object.freeze({ ...options.bounds }), cellSize = options.cellSize ?? 0.5,
    speed = options.speed ?? 1.4, radius = options.actorRadius ?? 0.2, maxCells = options.maxCells ?? 10000;
  if (!validSpatialRect(bounds) || !Number.isFinite(cellSize) || cellSize < 0.05 || cellSize > 2
    || !Number.isFinite(speed) || speed <= 0 || speed > 10 || !Number.isFinite(radius) || radius < 0 || radius > 2
    || !Number.isSafeInteger(maxCells) || maxCells < 1 || maxCells > 65536
    || (Math.floor((bounds.maxX - bounds.minX) / cellSize) + 1) * (Math.floor((bounds.maxY - bounds.minY) / cellSize) + 1) > maxCells)
    throw new Error("Invalid or unbounded spatial world geometry");
  if (getCommittedEvents(world).stopped) throw new Error("Cannot install spatial locomotion on a stopped world");
  const installedAt = readSimulationTime(world);
  if (!Number.isFinite(installedAt) || installedAt < 0) throw new Error("Spatial world requires a finite simulation clock");
  const source = getCommittedEvents(world).sourceId ?? startCommittedEvents(world);
  const rooms = new Map<number, RoomGeometry>(), targets = new Map<number, TargetGeometry>(), obstacles = new Map<number, ObstacleGeometry>();
  const work = new Map<number, Work>(), egress = new Map<number, SeatEgress>(), callbacks: Array<() => void> = []; let stopped = false;
  type Shape = ReturnType<typeof createSpatialGeometry>;
  // Derived navigation data, never execution authority. Raw ECS writes can
  // change transforms/identity without calling this adapter, so each read
  // fingerprints the live geometry before reusing a snapshot or destination menu.
  let geometrySignature = "";
  const shapes = new Map<number | undefined, Shape>();
  const menus = new Map<number, { actorKey: string; room: number; roomKey: string; start: SpatialPoint; shape: Shape; ids: number[] }>();
  const clearNavigation = () => { geometrySignature = ""; shapes.clear(); menus.clear(); };
  const notify = () => {
    const errors: unknown[] = [];
    for (const callback of callbacks.splice(0)) { try { callback(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, "Spatial completion callback failed after physical cleanup");
  };
  const key = (eid: number) => entityExists(world, eid) && hasComponent(world, eid, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[eid] : undefined;
  const position = (eid: number): SpatialPoint | undefined => entityExists(world, eid) && hasComponent(world, eid, Position)
    && validSpatialPoint({ x: Position.x[eid], y: Position.y[eid] }) ? { x: Position.x[eid], y: Position.y[eid] } : undefined;
  const current = () => !stopped && !getCommittedEvents(world).stopped && getCommittedEvents(world).sourceId === source
    && Number.isFinite(readSimulationTime(world)) && readSimulationTime(world) >= installedAt;
  const live = (eid: number, identity?: string) => isEntityPresent(world, eid) && !!key(eid) && (identity === undefined || key(eid) === identity);
  const actorLive = (eid: number, identity?: string) => live(eid, identity) && hasComponent(world, eid, Agent) && Agent.active[eid];
  const requireIdentity = (eid: number) => {
    assertSimulationTaskActive(); if (!current() || !live(eid)) throw new Error("Spatial registration requires a current existing ECS identity");
    return key(eid)!;
  };
  const liveRoom = (eid: number) => { const row = rooms.get(eid), p = position(eid);
    return row && p && spatialDistance(p, row.origin) < 1e-8 && live(eid, row.key) && hasComponent(world, eid, Room) ? row : undefined; };
  const seatContains = (seat: SeatEgress, p: SpatialPoint) => Math.abs(p.x - seat.origin.x) <= seat.collider.halfWidth + radius
    && Math.abs(p.y - seat.origin.y) <= seat.collider.halfDepth + radius;
  const seatCurrent = (actor: number, seat: SeatEgress, p: SpatialPoint) => actorLive(actor, seat.actorKey)
    && live(seat.seat, seat.seatKey) && obstacles.get(seat.seat) === seat.collider && !!position(seat.seat)
    && spatialDistance(position(seat.seat)!, seat.origin) < 1e-8 && spatialDistance(p, seat.actorPosition) < 1e-8
    && getRoomForEntity(world, actor) === seat.room && getRoomForEntity(world, seat.seat) === seat.room && liveRoom(seat.room)?.key === seat.roomKey && seatContains(seat, p);
  function ownSeat(actor: number, p: SpatialPoint): SeatEgress | undefined {
    const prior = egress.get(actor); if (prior && seatCurrent(actor, prior, p)) return prior;
    // Read-only until native movement is admitted. An arbitrary object overlap
    // cannot create permission: this must be the actor's actual occupied seat.
    for (const seat of getRelationTargets(world, actor, SittingOn)) {
      const collider = obstacles.get(seat), origin = position(seat), room = getRoomForEntity(world, actor);
      if (!collider || !origin || room === undefined || !live(seat, collider.key) || getRoomForEntity(world, seat) !== room
        || !hasComponent(world, seat, ObjectState) || ObjectState.current[seat] !== "occupied") continue;
      const value = { actorKey: key(actor)!, seat, seatKey: collider.key, collider, origin, room, roomKey: key(room)!, actorPosition: p };
      if (seatContains(value, p)) return value;
    }
  }
  const geometry = (exit?: SeatEgress) => {
    // A corrupt live collider is not permission to walk through it. Removed or
    // replaced entities, by contrast, do not retain the old object's collider.
    const floors: SpatialRect[] = [], solids: Array<{ eid: number; rect: SpatialRect }> = [], stamp: unknown[] = [];
    let valid = true;
    for (const [eid] of rooms) {
      const row = liveRoom(eid); if (!row) continue;
      floors.push(row.bounds);
      // Entries matter for destination menus even when the floor is unchanged.
      stamp.push([eid, row.key, row.bounds, row.entry]);
    }
    for (const [eid, row] of obstacles) {
      if (!live(eid, row.key)) continue;
      const p = position(eid);
      stamp.push([eid, row.key, p ?? null, row.halfWidth, row.halfDepth]);
      if (!p) { valid = false; continue; }
      solids.push({ eid, rect: { minX: p.x - row.halfWidth, minY: p.y - row.halfDepth,
        maxX: p.x + row.halfWidth, maxY: p.y + row.halfDepth } });
    }
    const signature = JSON.stringify(stamp);
    if (signature !== geometrySignature) { shapes.clear(); menus.clear(); geometrySignature = signature; }
    const excluded = exit && obstacles.get(exit.seat) === exit.collider ? exit.seat : undefined;
    let shape = shapes.get(excluded);
    if (!shape) {
      shape = createSpatialGeometry(bounds, valid ? floors : [], solids.filter(s => s.eid !== excluded).map(s => s.rect), radius, cellSize);
      // At most nine graphs total, including the base and seat-egress variants.
      // Eviction only recomputes derived data; it cannot affect an admitted path.
      if (shapes.size >= 9) {
        const oldestSeat = [...shapes.keys()].find(id => id !== undefined);
        if (oldestSeat !== undefined) {
          const retired = shapes.get(oldestSeat); shapes.delete(oldestSeat);
          for (const [actor, menu] of menus) if (menu.shape === retired) menus.delete(actor);
        }
      }
      shapes.set(excluded, shape);
    }
    return shape;
  };
  const roomAt = (p: SpatialPoint, previous?: number) => {
    if (previous !== undefined && liveRoom(previous) && insideSpatialRect(p, rooms.get(previous)!.bounds)) return previous;
    return [...rooms.keys()].sort((a, b) => a - b).find(eid => liveRoom(eid) && insideSpatialRect(p, rooms.get(eid)!.bounds));
  };
  // A room entry is a destination area, not permission to stack every visitor
  // on one coordinate. Keep alternatives local, deterministic and bounded.
  // Object interactions still use only their explicitly authored anchors.
  function roomAnchors(entry: SpatialPoint) {
    const spacing = Math.max(cellSize, radius * 2 + .05), anchors = [entry];
    for (let ring = 1; ring <= 2; ring++) for (let y = -ring; y <= ring; y++) for (let x = -ring; x <= ring; x++) {
      if (Math.max(Math.abs(x), Math.abs(y)) === ring) anchors.push({ x: entry.x + x * spacing, y: entry.y + y * spacing });
    }
    return anchors;
  }
  function destination(target: number) {
    const room = liveRoom(target);
    if (room) return { room: target, roomKey: room.key, row: room, position: room.entry, anchors: roomAnchors(room.entry), reach: 0.05 };
    const row = targets.get(target), p = position(target), roomId = getRoomForEntity(world, target);
    if (!row || !live(target, row.key) || !p || roomId === undefined || !liveRoom(roomId)) return;
    return { room: roomId, roomKey: liveRoom(roomId)!.key, row, position: p,
      anchors: row.anchors.map(a => ({ x: p.x + a.x, y: p.y + a.y })), reach: row.reach };
  }
  /** The admitted destination is unchanged: the same live target geometry, or
   * for a point walk the same live destination room. */
  function destinationCurrent(row: Work) {
    if (row.point) return key(row.target) === row.targetKey && liveRoom(row.target)?.key === row.roomKey && rooms.get(row.target) === row.geometry;
    const goal = destination(row.target);
    return !!goal && key(row.target) === row.targetKey && goal.row === row.geometry && goal.room === row.targetRoom
      && goal.roomKey === row.roomKey && spatialDistance(goal.position, row.targetPosition) <= 1e-8;
  }
  function arrivalAvailable(actor: number, arrival: SpatialPoint) {
    const separation = Math.max(radius * 2, 1e-6);
    for (const other of query(world, [Agent, Position])) {
      // Inactive cognition does not remove the actor's physical body.
      if (other === actor || !isEntityPresent(world, other)) continue;
      const p = position(other);
      if (p && spatialDistance(p, arrival) < separation) return false;
    }
    // The work item itself owns the reservation; every existing finish/cancel/
    // source-stop path releases it. Retired work cannot reserve a replacement.
    for (const row of work.values()) {
      if (row.actor === actor || row.signal?.aborted || !actorLive(row.actor, row.actorKey)) continue;
      const p = position(row.actor);
      if (!p || spatialDistance(p, row.actorPosition) > 1e-8 || getRoomForEntity(world, row.actor) !== row.actorRoom
        || liveRoom(row.actorRoom)?.key !== row.actorRoomKey || !destinationCurrent(row)) continue;
      if (spatialDistance(row.arrival, arrival) < separation) return false;
    }
    return true;
  }
  function routingContext(actor: number) {
    const start = position(actor), room = getRoomForEntity(world, actor);
    if (!current() || !actorLive(actor) || !start || room === undefined || !liveRoom(room) || !insideSpatialRect(start, rooms.get(room)!.bounds)) return;
    const seat = ownSeat(actor, start), shape = geometry(seat);
    return { start, room, seat, shape };
  }
  function route(actor: number, target: number, context = routingContext(actor), admit = false) {
    const goal = destination(target); if (!context || !goal) return;
    const { start, room, seat, shape } = context;
    const validAnchor = (a: SpatialPoint) => insideSpatialRect(a, rooms.get(goal.room)!.bounds) && roomAt(a, room) === goal.room;
    // Never use occupancy alternatives to bypass a blocked/invalid room entry.
    // Read-only destination menus stay geometric; admission checks live bodies.
    if (liveRoom(target)) {
      if (!validAnchor(goal.position)) return;
      const path = findSpatialPath(start, goal.position, bounds, cellSize, shape);
      if (!path) return;
      if (!admit || arrivalAvailable(actor, goal.position)) return { start, goal, path,
        arrival: goal.position, length: path.reduce((sum, p, i) => sum + spatialDistance(i === 0 ? start : path[i - 1], p), 0), room, seat };
    }
    const paths = goal.anchors.filter(a => validAnchor(a) && (!admit || arrivalAvailable(actor, a)))
      .map(end => findSpatialPath(start, end, bounds, cellSize, shape)).filter((p): p is SpatialPoint[] => p !== undefined);
    const length = (path: readonly SpatialPoint[]) => path.reduce((sum, p, i) => sum + spatialDistance(i === 0 ? start : path[i - 1], p), 0);
    paths.sort((a, b) => length(a) - length(b));
    return paths[0] === undefined ? undefined : { start, goal, path: paths[0], arrival: paths[0].at(-1) ?? start, length: length(paths[0]), room, seat };
  }
  function finish(row: Work, status: SpatialOutcome["status"], reason: string) {
    if (work.get(row.actor) !== row) return;
    work.delete(row.actor);
    const outcome: SpatialOutcome = Object.freeze({ requestId: row.requestId, actor: row.actor, target: row.target, targetKey: row.targetKey,
      status, reason, reportable: current() && !row.signal?.aborted && actorLive(row.actor, row.actorKey), startedAtSimMs: row.startedAt, completedAtSimMs: readSimulationTime(world) });
    // Another actor's callback may stop/replace the world before this delivery.
    // A physical outcome remains historical, but cannot regain current authority.
    if (row.onFinish) callbacks.push(() => row.onFinish!(Object.freeze({ ...outcome,
      reportable: outcome.reportable && current() && !row.signal?.aborted && actorLive(row.actor, row.actorKey) })));
  }
  function holdArrival(row: Work, atSimMs: number) {
    row.arrivalBlockedSince ??= atSimMs;
    if (atSimMs - row.arrivalBlockedSince >= ARRIVAL_WAIT_LIMIT_MS) finish(row, "failed", "arrival_occupied");
  }
  const unsubscribe = subscribeCommittedSourceStop(world, () => {
    stopped = true; egress.clear(); clearNavigation();
    for (const row of [...work.values()]) finish(row, "cancelled", "source_stopped");
    notify();
  });
  function admissible(actor: number): SpatialAdmission | undefined {
    assertSimulationTaskActive();
    if (work.has(actor)) return { ok: false, reason: "actor_busy" };
    if (work.size >= 128) return { ok: false, reason: "spatial_capacity" };
    for (const [eid, seat] of egress) { const p = position(eid); if (!p || !seatCurrent(eid, seat, p)) egress.delete(eid); }
  }
  type Found = { start: SpatialPoint; path: readonly SpatialPoint[]; arrival: SpatialPoint; length: number; room: number; seat?: SeatEgress;
    goal: { room: number; roomKey: string; row: RoomGeometry | TargetGeometry; position: SpatialPoint } };
  function admit(actor: number, target: number, found: Found, onFinish?: (outcome: SpatialOutcome) => void, point = false): SpatialAdmission {
    if (found.seat && !egress.has(actor) && egress.size >= 128) return { ok: false, reason: "spatial_capacity" };
    if (found.seat) egress.set(actor, found.seat);
    const now = readSimulationTime(world), requestId = `spatial:${randomUUID()}`;
    work.set(actor, { requestId, actor, actorKey: key(actor)!, target, targetKey: key(target)!, targetRoom: found.goal.room,
      roomKey: found.goal.roomKey, targetPosition: found.goal.position, actorPosition: found.start, actorRoom: found.room,
      actorRoomKey: key(found.room)!, geometry: found.goal.row, arrival: found.arrival, path: found.path, cursor: 0, startedAt: now, lastAt: now,
      moved: false, signal: getSimulationTaskSignal(), onFinish, ...(point ? { point: true } : {}) });
    // Completion is always delivered by advance, including zero-length routes.
    return { ok: true, requestId, estimatedMs: found.length / speed * 1000 };
  }
  function request(actor: number, target: number, onFinish?: (outcome: SpatialOutcome) => void): SpatialAdmission {
    const refused = admissible(actor); if (refused) return refused;
    const found = route(actor, target, routingContext(actor), true); if (!found) return { ok: false, reason: "no_reachable_anchor" };
    return admit(actor, target, found, onFinish);
  }
  /** A body standing here would be clear of walls, furniture and other bodies. */
  function standable(p: SpatialPoint, shape: Shape, actor?: number) {
    if (!shape.pointClear(p) || roomAt(p) === undefined) return false;
    for (const other of query(world, [Agent, Position])) {
      if (other === actor || !isEntityPresent(world, other)) continue;
      const q = position(other); if (q && spatialDistance(q, p) < Math.max(radius * 2, 1e-6)) return false;
    }
    return true;
  }
  /** Walk to a transient ground point through the same planner, speed, collision,
   * seat egress, arrival and room-membership logic as any approach. The point
   * is not an entity; the admitted destination is the room that contains it. */
  /** Per-body walking speed (m/s), e.g. an operator's jog or run. Residents keep the default. */
  const actorSpeeds = new Map<number, number>();
  function requestWalk(actor: number, point: SpatialPoint, onFinish?: (outcome: SpatialOutcome) => void): SpatialAdmission {
    const refused = admissible(actor); if (refused) return refused;
    if (!validSpatialPoint(point) || !insideSpatialRect(point, bounds)) return { ok: false, reason: "outside_world" };
    const context = routingContext(actor); if (!context) return { ok: false, reason: "actor_not_placed" };
    const room = roomAt(point, context.room), row = room === undefined ? undefined : liveRoom(room);
    if (room === undefined || !row) return { ok: false, reason: "not_walkable" };
    if (!context.shape.pointClear(point)) return { ok: false, reason: "blocked" };
    if (!arrivalAvailable(actor, point)) return { ok: false, reason: "occupied" };
    const path = findSpatialPath(context.start, point, bounds, cellSize, context.shape);
    if (!path) return { ok: false, reason: "unreachable" };
    const length = path.reduce((sum, p, i) => sum + spatialDistance(i === 0 ? context.start : path[i - 1], p), 0);
    return admit(actor, room, { start: context.start, path, arrival: point, length, room: context.room, seat: context.seat,
      goal: { room, roomKey: row.key, row, position: point } }, onFinish, true);
  }
  return {
    registerRoom(eid: number, input: { bounds: SpatialRect; entry?: SpatialPoint }) {
      const identity = requireIdentity(eid), origin = position(eid), entry = input.entry ?? { x: (input.bounds.minX + input.bounds.maxX) / 2, y: (input.bounds.minY + input.bounds.maxY) / 2 };
      if (!origin || !hasComponent(world, eid, Room) || !validSpatialRect(input.bounds) || !validSpatialPoint(entry) || !insideSpatialRect(entry, input.bounds)
        || !insideSpatialRect({ x: input.bounds.minX, y: input.bounds.minY }, bounds) || !insideSpatialRect({ x: input.bounds.maxX, y: input.bounds.maxY }, bounds)
        || !rooms.has(eid) && rooms.size >= 64) throw new Error("Invalid spatial room");
      rooms.set(eid, { key: identity, bounds: Object.freeze({ ...input.bounds }), entry: Object.freeze({ ...entry }), origin });
    },
    registerObstacle(eid: number, input: { halfWidth: number; halfDepth: number }) {
      const identity = requireIdentity(eid);
      if (!position(eid) || !Number.isFinite(input.halfWidth) || !Number.isFinite(input.halfDepth) || input.halfWidth <= 0 || input.halfDepth <= 0
        || !obstacles.has(eid) && obstacles.size >= 256) throw new Error("Invalid spatial obstacle");
      obstacles.set(eid, { key: identity, halfWidth: input.halfWidth, halfDepth: input.halfDepth });
    },
    /** Native open/close transitions may remove this exact live door's collider.
     * A source/identity mismatch cannot edit a replacement registration. */
    unregisterObstacle(eid: number): boolean {
      assertSimulationTaskActive(); const row = obstacles.get(eid);
      return current() && !!row && live(eid, row.key) && obstacles.delete(eid);
    },
    registerTarget(eid: number, input: { anchors: readonly SpatialPoint[]; reach?: number }) {
      const identity = requireIdentity(eid), reach = input.reach ?? 0.25;
      if (!position(eid) || !Array.isArray(input.anchors) || input.anchors.length < 1 || input.anchors.length > 8 || !input.anchors.every(validSpatialPoint)
        || !Number.isFinite(reach) || reach < 0.01 || reach > 2 || !targets.has(eid) && targets.size >= 256) throw new Error("Invalid spatial target");
      targets.set(eid, { key: identity, anchors: input.anchors.map(p => Object.freeze({ ...p })), reach });
    },
    requestMove(actor: number, room: number, onFinish?: (outcome: SpatialOutcome) => void): SpatialAdmission {
      if (!liveRoom(room)) return { ok: false, reason: "invalid_room" };
      return request(actor, room, onFinish);
    },
    requestApproach: request,
    requestWalk,
    /** Set (or clear with undefined) a body's walking speed in metres per second. */
    setActorSpeed(actor: number, metresPerSecond: number | undefined) {
      if (metresPerSecond === undefined) { actorSpeeds.delete(actor); return; }
      if (!Number.isFinite(metresPerSecond) || metresPerSecond <= 0 || metresPerSecond > 8) throw new Error("Invalid walking speed");
      actorSpeeds.set(actor, metresPerSecond);
    },
    /** The farthest standable point up to `distance` along a direction from the
     * actor, stepping back toward the actor; undefined when even a short step is blocked. */
    walkPointToward(actor: number, direction: SpatialPoint, distance = 1.2): SpatialPoint | undefined {
      const context = routingContext(actor), length = Math.hypot(direction.x, direction.y);
      if (!context || !validSpatialPoint(direction) || length < 1e-6 || !Number.isFinite(distance) || distance <= 0 || distance > 10) return;
      const ux = direction.x / length, uy = direction.y / length;
      for (let d = distance; d >= Math.min(distance, 0.3) - 1e-9; d -= 0.15) {
        const p = { x: context.start.x + ux * d, y: context.start.y + uy * d };
        if (insideSpatialRect(p, bounds) && standable(p, context.shape, actor) && findSpatialPath(context.start, p, bounds, cellSize, context.shape)) return p;
      }
    },
    /** A clear standing spot near a point (e.g. to place a newly arrived body). */
    findStandingPoint(near: SpatialPoint, maxRadius = 3, accept: (p: SpatialPoint) => boolean = () => true): SpatialPoint | undefined {
      if (!validSpatialPoint(near)) return;
      const shape = geometry(), step = Math.max(cellSize, radius * 2 + .05);
      const clear = (p: SpatialPoint, g: typeof shape) => standable(p, g) && accept(p);
      if (clear(near, shape)) return { x: near.x, y: near.y };
      for (let ring = 1; ring * step <= maxRadius; ring++) for (let y = -ring; y <= ring; y++) for (let x = -ring; x <= ring; x++) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== ring) continue;
        const p = { x: near.x + x * step, y: near.y + y * step };
        if (insideSpatialRect(p, bounds) && clear(p, shape)) return p;
      }
    },
    /** The room whose installed floor contains this point, if any. */
    roomAtPoint: (p: SpatialPoint) => validSpatialPoint(p) ? roomAt(p) : undefined,
    advance(atSimMs = readSimulationTime(world)) {
      assertSimulationTaskActive();
      if (!Number.isFinite(atSimMs) || atSimMs < installedAt || atSimMs > readSimulationTime(world)) throw new Error("Spatial advancement requires committed world time");
      for (const row of [...work.values()]) {
        if (work.get(row.actor) !== row) continue;
        const p = position(row.actor);
        const actorCurrent = actorLive(row.actor, row.actorKey) && !!p && spatialDistance(p, row.actorPosition) < 1e-8
          && getRoomForEntity(world, row.actor) === row.actorRoom && liveRoom(row.actorRoom)?.key === row.actorRoomKey;
        if (!current() || row.signal?.aborted || !actorCurrent || atSimMs < row.lastAt) { finish(row, "failed", "stale_actor_or_source"); continue; }
        if (!destinationCurrent(row)) { finish(row, "failed", "target_changed"); continue; }
        let travel = (atSimMs - row.lastAt) / 1000 * (actorSpeeds.get(row.actor) ?? speed); row.lastAt = atSimMs;
        let exit = egress.get(row.actor);
        if (exit && !seatCurrent(row.actor, exit, row.actorPosition)) { egress.delete(row.actor); exit = undefined; }
        let shape = geometry(exit);
        while (travel > 1e-9 && row.cursor < row.path.length) {
          const end = row.path[row.cursor], distance = spatialDistance(row.actorPosition, end);
          const amount = Math.min(distance, travel, cellSize / 2);
          const next = distance < 1e-9 ? end : { x: row.actorPosition.x + (end.x - row.actorPosition.x) * amount / distance,
            y: row.actorPosition.y + (end.y - row.actorPosition.y) * amount / distance };
          // A passerby near the destination must not invalidate a distant trip.
          // Stop before entering the occupied arrival area, discarding unused
          // travel for this tick so release never causes a catch-up teleport.
          if (spatialDistance(next, row.arrival) < Math.max(radius * 2, 1e-6) && !arrivalAvailable(row.actor, row.arrival)) {
            holdArrival(row, atSimMs); break;
          }
          row.arrivalBlockedSince = undefined;
          const room = roomAt(next, row.actorRoom);
          if (room === undefined || !shape.segmentClear(row.actorPosition, next)) { finish(row, "failed", "path_blocked"); break; }
          if (!row.moved && amount > 1e-9) { releaseDepartedSeating(world, row.actor, row.actorRoom); row.moved = true; }
          Position.x[row.actor] = next.x; Position.y[row.actor] = next.y; row.actorPosition = next;
          if (room !== row.actorRoom) { setLocatedIn(world, row.actor, room); row.actorRoom = room; row.actorRoomKey = key(room)!; }
          if (exit) {
            exit.actorPosition = next;
            if (!seatContains(exit, next)) { egress.delete(row.actor); exit = undefined; shape = geometry(); }
          }
          travel -= amount;
          if (distance <= amount + 1e-9) row.cursor++;
        }
        if (work.get(row.actor) === row && row.cursor === row.path.length) {
          const available = arrivalAvailable(row.actor, row.arrival);
          if (available) finish(row, "arrived", "anchor_reached");
          else holdArrival(row, atSimMs);
        }
      }
      notify();
    },
    cancel(actor: number, reason = "cancelled") {
      assertSimulationTaskActive(); const row = work.get(actor); if (!row) return false;
      finish(row, "cancelled", reason); notify(); return true;
    },
    busy: (actor: number) => work.has(actor),
    canReach: (actor: number, target: number) => !!route(actor, target),
    movementTargets(actor: number) {
      const context = routingContext(actor);
      if (!context) { menus.delete(actor); return []; }
      const { start, room, shape } = context, actorKey = key(actor)!, roomKey = key(room)!, prior = menus.get(actor);
      if (prior?.actorKey === actorKey && prior.room === room && prior.roomKey === roomKey && prior.shape === shape
        && prior.start.x === start.x && prior.start.y === start.y) return [...prior.ids];
      const ids = [...rooms.keys()].filter(eid => eid !== room && !!route(actor, eid, context)).sort((a, b) => a - b);
      if (!menus.has(actor) && menus.size >= 128) menus.delete(menus.keys().next().value!);
      menus.set(actor, { actorKey, room, roomKey, start, shape, ids });
      return [...ids];
    },
    isAtTarget(actor: number, target: number) {
      const p = position(actor), goal = destination(target);
      return current() && !work.has(actor) && actorLive(actor) && !!p && !!goal && getRoomForEntity(world, actor) === goal.room
        && goal.anchors.some(a => spatialDistance(p, a) <= goal.reach && geometry().segmentClear(p, a));
    },
    // Disposal only revokes transient work. It must remain possible from the
    // cancelled task that triggered shutdown; action/registration guards above
    // remain intact. Mark stopped before callbacks so none can report success.
    dispose() { stopped = true; egress.clear(); clearNavigation(); unsubscribe(); for (const row of [...work.values()]) finish(row, "cancelled", "adapter_disposed"); notify(); },
  };
}
