import type { World } from "../ecs/world";
import { query, addEntity, addComponent, getRelationTargets } from "bitecs";
import { Name, GridPosition, Sprite, WorldMap, Agent, Room } from "../ecs/components";
import { OccupiesRoom } from "../ecs/relations";

export interface AsciiCell {
  char: string;
  color: string;
  bgColor: string;
  entityId?: number;
}

export interface AsciiWorldState {
  width: number;
  height: number;
  cells: AsciiCell[][];
  entities: Array<{
    id: number;
    name: string;
    x: number;
    y: number;
    char: string;
    color: string;
    facing: string;
  }>;
}

const DEFAULT_TILES: Record<string, { char: string; color: string; bgColor: string; walkable: boolean }> = {
  '.': { char: '.', color: '#444', bgColor: '#111', walkable: true },
  '#': { char: '#', color: '#666', bgColor: '#333', walkable: false },
  '~': { char: '~', color: '#4488ff', bgColor: '#112244', walkable: false },
  ',': { char: ',', color: '#228822', bgColor: '#112211', walkable: true },
  '+': { char: '+', color: '#886644', bgColor: '#221100', walkable: true },
  ' ': { char: ' ', color: '#000', bgColor: '#000', walkable: false },
};

export function createWorldMap(world: World, name: string, width: number, height: number, fill: string = '.'): number {
  const eid = addEntity(world);
  addComponent(world, eid, WorldMap);
  addComponent(world, eid, Name);
  
  Name.value[eid] = name;
  WorldMap.width[eid] = width;
  WorldMap.height[eid] = height;
  WorldMap.name[eid] = name;
  
  const tiles = Array(height).fill(null).map(() => fill.repeat(width)).join('\n');
  WorldMap.tiles[eid] = tiles;
  
  return eid;
}

export function setTile(world: World, mapEid: number, x: number, y: number, char: string): void {
  const width = WorldMap.width[mapEid];
  const height = WorldMap.height[mapEid];
  
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  
  const tiles = WorldMap.tiles[mapEid].split('\n');
  const row = tiles[y].split('');
  row[x] = char;
  tiles[y] = row.join('');
  WorldMap.tiles[mapEid] = tiles.join('\n');
}

export function getTile(world: World, mapEid: number, x: number, y: number): string {
  const width = WorldMap.width[mapEid];
  const height = WorldMap.height[mapEid];
  
  if (x < 0 || x >= width || y < 0 || y >= height) return ' ';
  
  const tiles = WorldMap.tiles[mapEid].split('\n');
  return tiles[y]?.[x] ?? ' ';
}

export function isWalkable(world: World, mapEid: number, x: number, y: number): boolean {
  const tile = getTile(world, mapEid, x, y);
  return DEFAULT_TILES[tile]?.walkable ?? false;
}

export function setEntityPosition(world: World, eid: number, x: number, y: number, facing?: string): void {
  if (!GridPosition.x[eid] && GridPosition.x[eid] !== 0) {
    addComponent(world, eid, GridPosition);
  }
  GridPosition.x[eid] = x;
  GridPosition.y[eid] = y;
  if (facing) GridPosition.facing[eid] = facing;
}

export function setEntitySprite(world: World, eid: number, char: string, color: string = '#fff', bgColor?: string): void {
  if (!Sprite.char[eid]) {
    addComponent(world, eid, Sprite);
  }
  Sprite.char[eid] = char;
  Sprite.color[eid] = color;
  if (bgColor) Sprite.bgColor[eid] = bgColor;
  Sprite.zIndex[eid] = Sprite.zIndex[eid] ?? 1;
}

export function moveEntity(world: World, mapEid: number, eid: number, dx: number, dy: number): boolean {
  const newX = GridPosition.x[eid] + dx;
  const newY = GridPosition.y[eid] + dy;
  
  if (!isWalkable(world, mapEid, newX, newY)) {
    return false;
  }
  
  GridPosition.x[eid] = newX;
  GridPosition.y[eid] = newY;
  
  if (dx > 0) GridPosition.facing[eid] = 'east';
  else if (dx < 0) GridPosition.facing[eid] = 'west';
  else if (dy > 0) GridPosition.facing[eid] = 'south';
  else if (dy < 0) GridPosition.facing[eid] = 'north';
  
  return true;
}

export function renderAsciiWorld(world: World): AsciiWorldState | null {
  const maps = Array.from(query(world, [WorldMap]));
  if (maps.length === 0) return null;
  
  const mapEid = maps[0];
  const width = WorldMap.width[mapEid];
  const height = WorldMap.height[mapEid];
  const tileData = WorldMap.tiles[mapEid].split('\n');
  
  const cells: AsciiCell[][] = [];
  for (let y = 0; y < height; y++) {
    cells[y] = [];
    for (let x = 0; x < width; x++) {
      const tileChar = tileData[y]?.[x] ?? ' ';
      const tileInfo = DEFAULT_TILES[tileChar] ?? DEFAULT_TILES['.'];
      cells[y][x] = {
        char: tileInfo.char,
        color: tileInfo.color,
        bgColor: tileInfo.bgColor,
      };
    }
  }
  
  const entities: AsciiWorldState['entities'] = [];
  const gridEntities = Array.from(query(world, [GridPosition, Sprite]));
  
  for (const eid of gridEntities) {
    const x = GridPosition.x[eid];
    const y = GridPosition.y[eid];
    const char = Sprite.char[eid] || '@';
    const color = Sprite.color[eid] || '#fff';
    const facing = GridPosition.facing[eid] || 'south';
    const name = Name.value[eid] || `Entity ${eid}`;
    
    if (x >= 0 && x < width && y >= 0 && y < height) {
      cells[y][x] = {
        char,
        color,
        bgColor: cells[y][x].bgColor,
        entityId: eid,
      };
    }
    
    entities.push({ id: eid, name, x, y, char, color, facing });
  }
  
  return { width, height, cells, entities };
}

export function asciiToString(state: AsciiWorldState): string {
  return state.cells.map(row => row.map(cell => cell.char).join('')).join('\n');
}

export function drawRoom(world: World, mapEid: number, x: number, y: number, w: number, h: number, floor: string = '.', wall: string = '#'): void {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      if (py === y || py === y + h - 1 || px === x || px === x + w - 1) {
        setTile(world, mapEid, px, py, wall);
      } else {
        setTile(world, mapEid, px, py, floor);
      }
    }
  }
}

export function drawDoor(world: World, mapEid: number, x: number, y: number): void {
  setTile(world, mapEid, x, y, '+');
}

export function drawPath(world: World, mapEid: number, x1: number, y1: number, x2: number, y2: number, char: string = '.'): void {
  const dx = Math.sign(x2 - x1);
  const dy = Math.sign(y2 - y1);
  
  let x = x1;
  let y = y1;
  
  while (x !== x2) {
    setTile(world, mapEid, x, y, char);
    x += dx;
  }
  
  while (y !== y2) {
    setTile(world, mapEid, x, y, char);
    y += dy;
  }
  
  setTile(world, mapEid, x2, y2, char);
}
