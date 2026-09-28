import { createSpatialGeometry, findSpatialPath, spatialDistance, type SpatialPoint, type SpatialRect } from "../spatial-path";

const bounds: SpatialRect = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
const obstacle: SpatialRect = { minX: 4, minY: 0, maxX: 6, maxY: 8 };
const start = { x: 1.1, y: 1.15 }, end = { x: 8.6, y: 8.2 };
const shape = () => createSpatialGeometry(bounds, [bounds], [obstacle], .1, .5);

// The original uncached BFS is the behavioral oracle: keep its connector
// ordering, four-neighbor order and exact returned waypoints, not just reachability.
function referencePath(a: SpatialPoint, b: SpatialPoint, rect: SpatialRect, cell: number,
  geometry: ReturnType<typeof createSpatialGeometry>): SpatialPoint[] | undefined {
  if (!geometry.pointClear(a) || !geometry.pointClear(b)) return;
  if (geometry.segmentClear(a, b)) return spatialDistance(a, b) < 1e-8 ? [] : [b];
  const width = Math.floor((rect.maxX - rect.minX) / cell) + 1, height = Math.floor((rect.maxY - rect.minY) / cell) + 1;
  const point = (id: number) => ({ x: rect.minX + id % width * cell, y: rect.minY + Math.floor(id / width) * cell });
  const neighbors = (p: SpatialPoint) => {
    const x = Math.round((p.x - rect.minX) / cell), y = Math.round((p.y - rect.minY) / cell), ids: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && geometry.segmentClear(p, point(ny * width + nx))) ids.push(ny * width + nx);
    }
    return ids.sort((l, r) => spatialDistance(p, point(l)) - spatialDistance(p, point(r)) || l - r);
  };
  const goals = new Set(neighbors(b)), queue = neighbors(a), parents = new Int32Array(width * height).fill(-2);
  for (const id of queue) parents[id] = -1;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];
    if (goals.has(id)) {
      const path = [b];
      for (let node = id; node !== -1; node = parents[node]) path.push(point(node));
      return path.reverse().filter((p, i, rows) => i === 0 ? spatialDistance(a, p) > 1e-8 : spatialDistance(rows[i - 1], p) > 1e-8);
    }
    const x = id % width, y = Math.floor(id / width);
    for (const [nx, ny] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const next = ny * width + nx;
      if (parents[next] !== -2 || !geometry.segmentClear(point(id), point(next))) continue;
      parents[next] = id; queue.push(next);
    }
  }
}

function counted(geometry = shape()) {
  const counts = { points: 0, segments: 0 };
  return { counts, geometry: {
    pointClear(p: SpatialPoint) { counts.points++; return geometry.pointClear(p); },
    segmentClear(a: SpatialPoint, b: SpatialPoint) { counts.segments++; return geometry.segmentClear(a, b); },
  } };
}

test("cached traversal exactly preserves deterministic BFS output and continuous connectors", () => {
  const geometry = shape();
  for (const [a, b] of [[start, end], [end, start], [{ x: 1.03, y: 9.13 }, end], [start, start],
    [{ x: 1, y: 1 }, { x: 1, y: 3 }], [{ x: 4.1, y: 2 }, end]]) {
    const expected = referencePath(a, b, bounds, .5, geometry);
    for (let repeat = 0; repeat < 3; repeat++) {
      const actual = findSpatialPath(a, b, bounds, .5, geometry);
      expect(actual).toEqual(expected);
      let prior = a;
      for (const waypoint of actual ?? []) { expect(geometry.segmentClear(prior, waypoint)).toBe(true); prior = waypoint; }
    }
  }
});

test("repeated queries reuse bounded grid collision checks, but always recheck continuous endpoints", () => {
  const { counts, geometry } = counted();
  const path = findSpatialPath(start, end, bounds, .5, geometry), coldSegments = counts.segments;
  expect(path).toBeDefined(); expect(coldSegments).toBeGreaterThan(100);
  counts.points = counts.segments = 0;
  expect(findSpatialPath(start, end, bounds, .5, geometry)).toEqual(path);
  expect(counts.segments).toBeGreaterThanOrEqual(1);
  expect(counts.segments).toBeLessThanOrEqual(19); // one direct segment and at most 18 endpoint connectors
  expect(counts.points).toBe(2);
  expect(counts.segments).toBeLessThan(coldSegments / 5);
  console.info("Spatial path collision calls:", { coldSegments, repeatedSegments: counts.segments, repeatedPoints: counts.points });
});

test.each(["bounds", "floors", "obstacles"] as const)("geometry snapshots detach caller-owned %s", which => {
  const inputBounds = { ...bounds }, floor = { ...bounds }, block = { ...obstacle };
  const floors = [floor], obstacles = [block];
  const geometry = createSpatialGeometry(inputBounds, floors, obstacles, .1, .5);
  const original = findSpatialPath(start, end, bounds, .5, geometry);
  if (which === "bounds") inputBounds.maxX = 2;
  if (which === "floors") { floor.maxX = 2; floors.splice(0); }
  if (which === "obstacles") { block.maxY = 10; obstacles.push({ ...bounds }); }
  expect(geometry.pointClear(end)).toBe(true);
  expect(findSpatialPath(start, end, bounds, .5, geometry)).toEqual(original);
});

test("new geometry reflecting a moved obstacle never inherits an old traversable edge", () => {
  const geometry = shape();
  expect(findSpatialPath(start, end, bounds, .5, geometry)).toBeDefined();
  const changed = createSpatialGeometry(bounds, [bounds], [{ ...obstacle, maxY: 10 }], .1, .5);
  expect(findSpatialPath(start, end, bounds, .5, changed)).toBeUndefined();
  expect(findSpatialPath(start, end, bounds, .5, geometry)).toBeDefined();
});

test("one graph per shape is replaced when bounds or cell size change", () => {
  const { counts, geometry } = counted();
  findSpatialPath(start, end, bounds, .5, geometry);
  for (const [rect, cell] of [[bounds, .25], [bounds, .5], [{ ...bounds, maxX: 11 }, .5], [bounds, .5]] as const) {
    counts.segments = 0;
    const path = findSpatialPath(start, end, rect, cell, geometry);
    expect(path).toEqual(referencePath(start, end, rect, cell, shape()));
    expect(counts.segments).toBeGreaterThan(100);
  }
});

test("changing a geometry function identity discards cached grid permissions", () => {
  const geometry = { ...shape() };
  expect(findSpatialPath(start, end, bounds, .5, geometry)).toBeDefined();
  geometry.segmentClear = () => false;
  expect(findSpatialPath(start, end, bounds, .5, geometry)).toBeUndefined();
});

test.each([0, -1, NaN, Infinity, .00001])("invalid or oversized grid cell size %s fails closed before geometry evaluation", cell => {
  const { counts, geometry } = counted();
  expect(findSpatialPath({ x: 1, y: 1 }, { x: 1, y: 2 }, bounds, cell, geometry)).toBeUndefined();
  expect(counts).toEqual({ points: 0, segments: 0 });
});

test.each([
  { ...bounds, maxX: NaN }, { ...bounds, maxX: Infinity }, { ...bounds, maxX: 0 },
  { ...bounds, minY: 11 }, { ...bounds, maxX: 1e300 },
])("invalid or oversized grid bounds fail closed before geometry evaluation: %j", rect => {
  const { counts, geometry } = counted();
  expect(findSpatialPath({ x: 1, y: 1 }, { x: 1, y: 2 }, rect, .5, geometry)).toBeUndefined();
  expect(counts).toEqual({ points: 0, segments: 0 });
});

test.each([
  { radius: -.1, cell: .5 }, { radius: NaN, cell: .5 }, { radius: Infinity, cell: .5 },
  { radius: .1, cell: 0 }, { radius: .1, cell: .00001 },
])("invalid geometry configuration grants no point or segment permission: %j", ({ radius, cell }) => {
  const geometry = createSpatialGeometry(bounds, [bounds], [], radius, cell);
  expect(geometry.pointClear(start)).toBe(false);
  expect(geometry.segmentClear(start, end)).toBe(false);
});

test("the exact 65,536-cell cap is admitted, but a larger grid fails closed", () => {
  const limit = { minX: 0, minY: 0, maxX: 255, maxY: 255 };
  const geometry = createSpatialGeometry(limit, [limit], [], 0, 1);
  expect(findSpatialPath({ x: 1, y: 1 }, { x: 2, y: 2 }, limit, 1, geometry)).toEqual([{ x: 2, y: 2 }]);
  expect(findSpatialPath({ x: 1, y: 1 }, { x: 2, y: 2 }, { ...limit, maxX: 256 }, 1, geometry)).toBeUndefined();
});

test.each(["floor", "obstacle"])("invalid %s rectangles grant no traversal permission", kind => {
  const bad = { ...bounds, minX: NaN };
  const geometry = createSpatialGeometry(bounds, kind === "floor" ? [bad] : [bounds], kind === "obstacle" ? [bad] : [], .1, .5);
  expect(geometry.pointClear(start)).toBe(false);
  expect(geometry.segmentClear(start, end)).toBe(false);
});

test("cached lattice edges still reject a sub-grid floor gap and diagonal corner cutting", () => {
  const gap = createSpatialGeometry(bounds, [{ ...bounds, maxX: 4.99 }, { ...bounds, minX: 5.01 }], [], 0, .5);
  const corner = createSpatialGeometry(bounds, [bounds], [
    { minX: 4, minY: 0, maxX: 6, maxY: 5 }, { minX: 0, minY: 5, maxX: 4, maxY: 7 },
  ], .1, .5);
  for (let repeat = 0; repeat < 2; repeat++) {
    expect(findSpatialPath({ x: 1, y: 1 }, { x: 9, y: 1 }, bounds, .5, gap)).toBeUndefined();
    expect(findSpatialPath({ x: 1, y: 1 }, { x: 9, y: 9 }, bounds, .5, corner)).toBeUndefined();
  }
});
