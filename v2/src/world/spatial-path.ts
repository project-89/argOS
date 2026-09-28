/** Bounded deterministic geometry, independent of cognition or presentation. */
export type SpatialPoint = Readonly<{ x: number; y: number }>;
export type SpatialRect = Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;
export const spatialDistance = (a: SpatialPoint, b: SpatialPoint) => Math.hypot(a.x - b.x, a.y - b.y);
export const insideSpatialRect = (p: SpatialPoint, r: SpatialRect) => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
export const validSpatialPoint = (p: SpatialPoint) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
export const validSpatialRect = (r: SpatialRect) => !!r && [r.minX, r.minY, r.maxX, r.maxY].every(Number.isFinite)
  && r.minX < r.maxX && r.minY < r.maxY;

const MAX_GRID_CELLS = 65536;
function gridDimensions(bounds: SpatialRect, cellSize: number) {
  if (!validSpatialRect(bounds) || !Number.isFinite(cellSize) || cellSize <= 0) return;
  const width = Math.floor((bounds.maxX - bounds.minX) / cellSize) + 1;
  const height = Math.floor((bounds.maxY - bounds.minY) / cellSize) + 1;
  const count = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || !Number.isSafeInteger(count) || count > MAX_GRID_CELLS) return;
  return { width, height, count };
}

function interval(a: SpatialPoint, b: SpatialPoint, rect: SpatialRect): [number, number] | undefined {
  let low = 0, high = 1;
  for (const [origin, delta, min, max] of [[a.x, b.x - a.x, rect.minX, rect.maxX], [a.y, b.y - a.y, rect.minY, rect.maxY]]) {
    if (Math.abs(delta) < 1e-10) { if (origin < min || origin > max) return; continue; }
    const entry = (min - origin) / delta, exit = (max - origin) / delta;
    low = Math.max(low, Math.min(entry, exit)); high = Math.min(high, Math.max(entry, exit));
    if (low > high) return;
  }
  return [low, high];
}

export function createSpatialGeometry(bounds: SpatialRect, floors: readonly SpatialRect[], obstacles: readonly SpatialRect[], radius: number, cellSize: number) {
  if (!gridDimensions(bounds, cellSize) || !Number.isFinite(radius) || radius < 0
    || !floors.every(validSpatialRect) || !obstacles.every(validSpatialRect))
    return Object.freeze({ pointClear: (_p: SpatialPoint) => false, segmentClear: (_a: SpatialPoint, _b: SpatialPoint) => false });
  // A shape is an immutable snapshot, even when its caller later mutates room
  // bounds or its arrays. A changed world must construct a new geometry object.
  bounds = Object.freeze({ ...bounds });
  floors = floors.map(r => Object.freeze({ ...r }));
  obstacles = obstacles.map(r => Object.freeze({ ...r }));
  const inflated = obstacles.map(r => ({ minX: r.minX - radius, minY: r.minY - radius, maxX: r.maxX + radius, maxY: r.maxY + radius }));
  const pointClear = (p: SpatialPoint) => validSpatialPoint(p)
    && [p, { x: p.x - radius, y: p.y - radius }, { x: p.x + radius, y: p.y - radius },
      { x: p.x - radius, y: p.y + radius }, { x: p.x + radius, y: p.y + radius }]
      .every(corner => insideSpatialRect(corner, bounds) && floors.some(f => insideSpatialRect(corner, f)))
    && !inflated.some(r => insideSpatialRect(p, r));
  const segmentClear = (a: SpatialPoint, b: SpatialPoint) => {
    if (!pointClear(a) || !pointClear(b) || inflated.some(r => interval(a, b, r))) return false;
    // Continuous coverage, not sampled permission: even a very narrow gap in
    // the installed floor must remain impassable at a large simulation delta.
    for (const [x, y] of [[0, 0], [-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]]) {
      const ranges = floors.map(r => interval({ x: a.x + x, y: a.y + y }, { x: b.x + x, y: b.y + y }, r))
        .filter((r): r is [number, number] => !!r).sort((l, r) => l[0] - r[0]);
      let end = 0;
      for (const range of ranges) { if (range[0] > end + 1e-10) return false; end = Math.max(end, range[1]); }
      if (end < 1 - 1e-10) return false;
    }
    return true;
  };
  return Object.freeze({ pointClear, segmentClear });
}

type SpatialGeometry = ReturnType<typeof createSpatialGeometry>;
type Lattice = {
  bounds: SpatialRect; cellSize: number;
  pointClear: SpatialGeometry["pointClear"]; segmentClear: SpatialGeometry["segmentClear"];
  points: Int8Array; edges: Int8Array;
};
// At most one bounded lattice per live shape: no arbitrary-coordinate cache,
// and neither the WeakMap nor its values retain otherwise unreachable shapes.
const lattices = new WeakMap<SpatialGeometry, Lattice>();
function latticeFor(geometry: SpatialGeometry, bounds: SpatialRect, cellSize: number, count: number): Lattice {
  let lattice = lattices.get(geometry);
  if (!lattice || lattice.cellSize !== cellSize || lattice.bounds.minX !== bounds.minX || lattice.bounds.minY !== bounds.minY
    || lattice.bounds.maxX !== bounds.maxX || lattice.bounds.maxY !== bounds.maxY
    || lattice.pointClear !== geometry.pointClear || lattice.segmentClear !== geometry.segmentClear) {
    lattice = { bounds: { ...bounds }, cellSize, pointClear: geometry.pointClear, segmentClear: geometry.segmentClear,
      points: new Int8Array(count), edges: new Int8Array(count * 4) };
    lattices.set(geometry, lattice);
  }
  return lattice;
}

/** Four-neighbor BFS with checked endpoint connectors. No diagonal corner
 * cutting, destination exceptions, path truncation, or obstacle teleporting. */
export function findSpatialPath(start: SpatialPoint, end: SpatialPoint, bounds: SpatialRect, cellSize: number,
  geometry: SpatialGeometry): SpatialPoint[] | undefined {
  const grid = gridDimensions(bounds, cellSize);
  if (!grid) return;
  if (!geometry.pointClear(start) || !geometry.pointClear(end)) return;
  if (geometry.segmentClear(start, end)) return spatialDistance(start, end) < 1e-8 ? [] : [end];
  const { width, height, count } = grid, lattice = latticeFor(geometry, bounds, cellSize, count);
  const point = (id: number) => ({ x: bounds.minX + id % width * cellSize, y: bounds.minY + Math.floor(id / width) * cellSize });
  const pointClear = (id: number) => {
    if (!lattice.points[id]) lattice.points[id] = geometry.pointClear(point(id)) ? 1 : -1;
    return lattice.points[id] === 1;
  };
  const edgeClear = (id: number, next: number, direction: number) => {
    const key = id * 4 + direction;
    if (!lattice.edges[key]) lattice.edges[key] = pointClear(id) && pointClear(next)
      && geometry.segmentClear(point(id), point(next)) ? 1 : -1;
    return lattice.edges[key] === 1;
  };
  const neighbors = (p: SpatialPoint) => {
    const x = Math.round((p.x - bounds.minX) / cellSize), y = Math.round((p.y - bounds.minY) / cellSize), ids: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && geometry.segmentClear(p, point(ny * width + nx))) ids.push(ny * width + nx);
    }
    return ids.sort((a, b) => spatialDistance(p, point(a)) - spatialDistance(p, point(b)) || a - b);
  };
  // These continuous connectors are deliberately never memoized: callers may
  // begin between grid points, change destinations, or leave a seat each time.
  const goals = new Set(neighbors(end)), queue = neighbors(start), parents = new Int32Array(count).fill(-2);
  for (const id of queue) parents[id] = -1;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];
    if (goals.has(id)) {
      const path: SpatialPoint[] = [end];
      for (let node = id; node !== -1; node = parents[node]) path.push(point(node));
      return path.reverse().filter((p, i, rows) => i === 0 ? spatialDistance(start, p) > 1e-8 : spatialDistance(rows[i - 1], p) > 1e-8);
    }
    const x = id % width, y = Math.floor(id / width);
    for (const [direction, [nx, ny]] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]].entries()) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const next = ny * width + nx;
      if (parents[next] !== -2 || !edgeClear(id, next, direction)) continue;
      parents[next] = id; queue.push(next);
    }
  }
}
