import type { World } from "../ecs/world";
import { query } from "bitecs";
import { WorldMap, GridPosition, Sprite, Name } from "../ecs/components";

export interface Point {
  x: number;
  y: number;
}

export interface PathNode extends Point {
  g: number; // Cost from start
  h: number; // Heuristic (estimated cost to end)
  f: number; // Total cost (g + h)
  parent: PathNode | null;
}

const DIRECTIONS = [
  { dx: 0, dy: -1 }, // north
  { dx: 0, dy: 1 },  // south
  { dx: 1, dy: 0 },  // east
  { dx: -1, dy: 0 }, // west
];

const WALKABLE_TILES = new Set(['.', ',', '+']);

/**
 * Get the map entity and tile data
 */
export function getMapData(world: World): { mapEid: number; width: number; height: number; tiles: string[] } | null {
  const maps = Array.from(query(world, [WorldMap]));
  if (maps.length === 0) return null;

  const mapEid = maps[0];
  const width = WorldMap.width[mapEid];
  const height = WorldMap.height[mapEid];
  const tiles = WorldMap.tiles[mapEid]?.split('\n') || [];

  return { mapEid, width, height, tiles };
}

/**
 * Check if a tile is walkable
 */
export function isTileWalkable(tiles: string[], width: number, height: number, x: number, y: number): boolean {
  if (x < 0 || x >= width || y < 0 || y >= height) return false;
  const tile = tiles[y]?.[x] ?? ' ';
  return WALKABLE_TILES.has(tile);
}

/**
 * Get all entity positions on the grid (for collision avoidance)
 */
export function getEntityPositions(world: World): Map<string, number> {
  const positions = new Map<string, number>();
  const entities = Array.from(query(world, [GridPosition]));

  for (const eid of entities) {
    const x = GridPosition.x[eid];
    const y = GridPosition.y[eid];
    const key = `${x},${y}`;
    positions.set(key, eid);
  }

  return positions;
}

/**
 * Manhattan distance heuristic
 */
function heuristic(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * A* pathfinding algorithm
 */
export function findPath(
  world: World,
  start: Point,
  end: Point,
  options: {
    avoidEntities?: boolean;
    excludeEntityId?: number;
    maxIterations?: number;
  } = {}
): Point[] | null {
  const mapData = getMapData(world);
  if (!mapData) return null;

  const { width, height, tiles } = mapData;
  const { avoidEntities = false, excludeEntityId, maxIterations = 1000 } = options;

  // Get entity positions for collision avoidance
  const entityPositions = avoidEntities ? getEntityPositions(world) : new Map();

  // Check if position is valid for pathfinding
  const isValidPosition = (x: number, y: number): boolean => {
    if (!isTileWalkable(tiles, width, height, x, y)) return false;
    if (avoidEntities) {
      const key = `${x},${y}`;
      const occupant = entityPositions.get(key);
      if (occupant !== undefined && occupant !== excludeEntityId) {
        // Allow destination even if occupied (we might want to interact with entity there)
        if (x !== end.x || y !== end.y) return false;
      }
    }
    return true;
  };

  // Early exit if start or end is invalid
  if (!isTileWalkable(tiles, width, height, start.x, start.y)) return null;
  if (!isTileWalkable(tiles, width, height, end.x, end.y)) return null;

  // If already at destination
  if (start.x === end.x && start.y === end.y) return [];

  const openSet: PathNode[] = [];
  const closedSet = new Set<string>();

  const startNode: PathNode = {
    x: start.x,
    y: start.y,
    g: 0,
    h: heuristic(start, end),
    f: heuristic(start, end),
    parent: null,
  };

  openSet.push(startNode);

  let iterations = 0;

  while (openSet.length > 0 && iterations < maxIterations) {
    iterations++;

    // Find node with lowest f score
    openSet.sort((a, b) => a.f - b.f);
    const current = openSet.shift()!;
    const currentKey = `${current.x},${current.y}`;

    // Found the path
    if (current.x === end.x && current.y === end.y) {
      const path: Point[] = [];
      let node: PathNode | null = current;
      while (node) {
        path.unshift({ x: node.x, y: node.y });
        node = node.parent;
      }
      // Remove start position from path
      path.shift();
      return path;
    }

    closedSet.add(currentKey);

    // Check neighbors
    for (const dir of DIRECTIONS) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      const neighborKey = `${nx},${ny}`;

      if (closedSet.has(neighborKey)) continue;
      if (!isValidPosition(nx, ny)) continue;

      const g = current.g + 1;
      const h = heuristic({ x: nx, y: ny }, end);
      const f = g + h;

      // Check if already in open set with better score
      const existingIndex = openSet.findIndex(n => n.x === nx && n.y === ny);
      if (existingIndex >= 0) {
        if (g >= openSet[existingIndex].g) continue;
        openSet.splice(existingIndex, 1);
      }

      openSet.push({
        x: nx,
        y: ny,
        g,
        h,
        f,
        parent: current,
      });
    }
  }

  // No path found
  return null;
}

/**
 * Get the next step toward a destination
 */
export function getNextStep(world: World, start: Point, end: Point): Point | null {
  const path = findPath(world, start, end, { avoidEntities: true });
  if (!path || path.length === 0) return null;
  return path[0];
}

/**
 * Get direction from one point to another
 */
export function getDirection(from: Point, to: Point): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (dy < 0) return "north";
  if (dy > 0) return "south";
  if (dx > 0) return "east";
  if (dx < 0) return "west";
  return "south";
}

/**
 * Find the nearest entity matching criteria
 */
export function findNearestEntity(
  world: World,
  from: Point,
  predicate: (eid: number) => boolean
): { eid: number; distance: number; position: Point } | null {
  const entities = Array.from(query(world, [GridPosition]));
  let nearest: { eid: number; distance: number; position: Point } | null = null;

  for (const eid of entities) {
    if (!predicate(eid)) continue;

    const x = GridPosition.x[eid];
    const y = GridPosition.y[eid];
    const distance = Math.abs(x - from.x) + Math.abs(y - from.y);

    if (!nearest || distance < nearest.distance) {
      nearest = { eid, distance, position: { x, y } };
    }
  }

  return nearest;
}

/**
 * Get entities within a radius
 */
export function getEntitiesInRadius(world: World, center: Point, radius: number): number[] {
  const entities = Array.from(query(world, [GridPosition]));
  const result: number[] = [];

  for (const eid of entities) {
    const x = GridPosition.x[eid];
    const y = GridPosition.y[eid];
    const distance = Math.abs(x - center.x) + Math.abs(y - center.y);

    if (distance <= radius) {
      result.push(eid);
    }
  }

  return result;
}
