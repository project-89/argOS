/**
 * AI-Powered Tilemap Generator
 *
 * Uses Gemini's vision capabilities to:
 * 1. Analyze tilesets and extract semantic tile information
 * 2. Generate meaningful tilemaps from natural language descriptions
 * 3. Place objects and define collision boxes intelligently
 */

import { generateObject, generateText } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod/v3";
import * as fs from "fs";
import * as path from "path";

// Use Gemini with vision capabilities
const visionModel = google("gemini-2.0-flash");
const designModel = google("gemini-2.0-flash");  // Use same model for text generation

// ============================================================================
// TILE METADATA SCHEMAS
// ============================================================================

export const TileMetadataSchema = z.object({
  id: z.string().describe("Unique tile identifier"),
  name: z.string().describe("Human-readable tile name"),
  category: z.enum([
    "terrain", "water", "path", "vegetation", "structure",
    "decoration", "transition", "special"
  ]).describe("Tile category"),
  description: z.string().describe("What this tile represents visually"),
  walkable: z.boolean().describe("Can characters walk on this tile"),
  solid: z.boolean().describe("Does this tile block movement completely"),
  liquid: z.boolean().optional().describe("Is this a water/liquid tile"),
  climbable: z.boolean().optional().describe("Can this be climbed"),
  damage: z.number().optional().describe("Damage per tick if walked on"),
  tags: z.array(z.string()).describe("Semantic tags for this tile"),
  gridPosition: z.object({
    col: z.number(),
    row: z.number(),
  }).describe("Position in tileset grid"),
  pixelPosition: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).describe("Pixel coordinates in tileset"),
  autotileType: z.enum(["none", "corner", "edge", "full", "transition"]).optional(),
  connectsTo: z.array(z.string()).optional().describe("Tile IDs this connects to for autotiling"),
});

export type TileMetadata = z.infer<typeof TileMetadataSchema>;

export const TilesetAnalysisSchema = z.object({
  tilesetId: z.string(),
  imagePath: z.string(),
  tileWidth: z.number(),
  tileHeight: z.number(),
  columns: z.number(),
  rows: z.number(),
  tiles: z.array(TileMetadataSchema),
  categories: z.record(z.array(z.string())).describe("Category -> tile IDs mapping"),
});

export type TilesetAnalysis = z.infer<typeof TilesetAnalysisSchema>;

// ============================================================================
// TILEMAP GENERATION SCHEMAS
// ============================================================================

export const TilemapCellSchema = z.object({
  tileId: z.string().describe("ID of tile to place"),
  layer: z.number().default(0).describe("Layer index (0=ground, 1=above)"),
});

export const TilemapLayerSchema = z.object({
  name: z.string(),
  data: z.array(z.array(z.string())).describe("2D array of tile IDs"),
  visible: z.boolean().default(true),
  alpha: z.number().default(1),
});

export const CollisionBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  type: z.enum(["solid", "trigger", "hazard", "water"]),
  damage: z.number().optional(),
  tag: z.string().optional(),
});

export const ObjectPlacementSchema = z.object({
  id: z.string(),
  type: z.string().describe("Object type (tree, rock, chest, npc, etc.)"),
  x: z.number(),
  y: z.number(),
  spriteId: z.string().optional(),
  animated: z.boolean().default(false),
  animationId: z.string().optional(),
  layer: z.number().default(1),
  tag: z.string().optional(),
});

export const GeneratedTilemapSchema = z.object({
  width: z.number(),
  height: z.number(),
  tileWidth: z.number(),
  tileHeight: z.number(),
  layers: z.array(TilemapLayerSchema),
  collisionBoxes: z.array(CollisionBoxSchema),
  objects: z.array(ObjectPlacementSchema),
  spawnPoints: z.array(z.object({
    id: z.string(),
    x: z.number(),
    y: z.number(),
    type: z.string(),
  })),
  metadata: z.object({
    name: z.string(),
    description: z.string(),
    theme: z.string(),
    tags: z.array(z.string()),
  }),
});

export type GeneratedTilemap = z.infer<typeof GeneratedTilemapSchema>;

// ============================================================================
// TILESET ANALYZER
// ============================================================================

/**
 * Analyzes a tileset image using Gemini vision to extract semantic tile information
 */
export async function analyzeTileset(
  imagePath: string,
  tileWidth: number = 32,
  tileHeight: number = 32,
  options: {
    tilesetId?: string;
    hints?: string;
  } = {}
): Promise<TilesetAnalysis> {
  const absolutePath = path.resolve(imagePath);
  const imageBuffer = fs.readFileSync(absolutePath);
  const base64Image = imageBuffer.toString("base64");
  const mimeType = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";

  // Get image dimensions
  // For now we'll estimate from file or require passing them
  // In a real implementation, use sharp or similar to get dimensions

  const tilesetId = options.tilesetId || path.basename(imagePath, path.extname(imagePath));

  const prompt = `Analyze this tileset image and identify each distinct tile.

The tileset uses ${tileWidth}x${tileHeight} pixel tiles arranged in a grid.
${options.hints ? `Additional context: ${options.hints}` : ""}

For each tile you can see, provide:
1. A descriptive name (e.g., "grass_full", "water_edge_top", "dirt_path_corner_nw")
2. Category: terrain, water, path, vegetation, structure, decoration, transition, or special
3. Whether it's walkable (characters can walk on it)
4. Whether it's solid (blocks movement completely)
5. Semantic tags that describe it
6. Its grid position (column, row) starting from 0,0 at top-left

Focus on identifying:
- Base terrain tiles (grass, dirt, sand, etc.)
- Water tiles and edges
- Path/road tiles
- Farm/tilled soil tiles
- Transition tiles between terrain types
- Any decorative elements

Group similar tiles together (e.g., all grass variations, all water edges).
Be thorough - analyze the ENTIRE tileset and catalog every distinct tile.`;

  const result = await generateObject({
    model: visionModel,
    schema: z.object({
      estimatedColumns: z.number(),
      estimatedRows: z.number(),
      tiles: z.array(z.object({
        name: z.string(),
        category: z.enum([
          "terrain", "water", "path", "vegetation", "structure",
          "decoration", "transition", "special"
        ]),
        description: z.string(),
        walkable: z.boolean(),
        solid: z.boolean(),
        liquid: z.boolean().optional(),
        tags: z.array(z.string()),
        col: z.number(),
        row: z.number(),
        autotileType: z.enum(["none", "corner", "edge", "full", "transition"]).optional(),
      })),
    }),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image", image: imageBuffer, mimeType },
        ],
      },
    ],
  });

  // Transform to our schema
  const tiles: TileMetadata[] = result.object.tiles.map((t, idx) => ({
    id: `${tilesetId}_${t.name}`,
    name: t.name,
    category: t.category,
    description: t.description,
    walkable: t.walkable,
    solid: t.solid,
    liquid: t.liquid,
    tags: t.tags,
    gridPosition: { col: t.col, row: t.row },
    pixelPosition: {
      x: t.col * tileWidth,
      y: t.row * tileHeight,
      width: tileWidth,
      height: tileHeight,
    },
    autotileType: t.autotileType || "none",
  }));

  const categories: Record<string, string[]> = {};
  for (const tile of tiles) {
    if (!categories[tile.category]) {
      categories[tile.category] = [];
    }
    categories[tile.category].push(tile.id);
  }

  return {
    tilesetId,
    imagePath,
    tileWidth,
    tileHeight,
    columns: result.object.estimatedColumns,
    rows: result.object.estimatedRows,
    tiles,
    categories,
  };
}

// ============================================================================
// TILEMAP GENERATOR
// ============================================================================

/**
 * Generates a tilemap from a natural language description using AI
 */
export async function generateTilemap(
  description: string,
  tilesetAnalysis: TilesetAnalysis,
  options: {
    width?: number;
    height?: number;
    theme?: string;
    includeObjects?: boolean;
    includeSpawnPoints?: boolean;
  } = {}
): Promise<GeneratedTilemap> {
  const width = options.width || 20;
  const height = options.height || 15;

  // Create a summary of available tiles for the AI
  const tilesSummary = tilesetAnalysis.tiles.map(t =>
    `- ${t.id}: ${t.description} [${t.category}] ${t.walkable ? "walkable" : "blocked"}`
  ).join("\n");

  const categorySummary = Object.entries(tilesetAnalysis.categories)
    .map(([cat, ids]) => `${cat}: ${ids.join(", ")}`)
    .join("\n");

  const prompt = `Generate a ${width}x${height} tilemap based on this description:

"${description}"

AVAILABLE TILES:
${tilesSummary}

TILES BY CATEGORY:
${categorySummary}

Requirements:
1. Create a coherent, visually pleasing map layout
2. Use appropriate tiles for each area (grass for fields, water for ponds, etc.)
3. Create smooth transitions between different terrain types
4. Place logical paths connecting important areas
5. ${options.includeObjects ? "Include object placements (trees, rocks, etc.)" : "Focus on terrain only"}
6. ${options.includeSpawnPoints ? "Define spawn points for players and NPCs" : ""}

Return a tilemap with:
- Ground layer (base terrain)
- Detail layer (decorations, transitions)
- Collision boxes for blocked areas
- ${options.includeObjects ? "Object placements" : "Empty objects array"}
- ${options.includeSpawnPoints ? "Spawn points" : "Empty spawn points array"}

The data arrays should be ${height} rows of ${width} tile IDs each.
Use tile IDs from the available tiles list above.`;

  const result = await generateObject({
    model: designModel,
    schema: GeneratedTilemapSchema,
    prompt,
  });

  return result.object;
}

/**
 * Generates a simple tilemap using a quick heuristic approach
 * (faster than full AI generation, good for testing)
 */
export function generateSimpleTilemap(
  tilesetAnalysis: TilesetAnalysis,
  width: number,
  height: number,
  template: "farm" | "forest" | "town" | "dungeon" = "farm"
): GeneratedTilemap {
  // Find tiles by category
  const findTile = (category: string, tag?: string): string => {
    const candidates = tilesetAnalysis.tiles.filter(t =>
      t.category === category && (!tag || t.tags.includes(tag))
    );
    return candidates[0]?.id || tilesetAnalysis.tiles[0]?.id || "unknown";
  };

  const grassTile = findTile("terrain", "grass");
  const dirtTile = findTile("terrain", "dirt") || findTile("path");
  const waterTile = findTile("water");
  const pathTile = findTile("path") || dirtTile;

  // Create base layer filled with grass
  const groundLayer: string[][] = [];
  for (let y = 0; y < height; y++) {
    groundLayer[y] = [];
    for (let x = 0; x < width; x++) {
      groundLayer[y][x] = grassTile;
    }
  }

  // Add template-specific features
  const collisionBoxes: z.infer<typeof CollisionBoxSchema>[] = [];

  if (template === "farm") {
    // Add farm plots
    for (let py = 3; py < 7; py++) {
      for (let px = 2; px < 8; px++) {
        groundLayer[py][px] = dirtTile;
      }
    }

    // Add a pond
    for (let py = 4; py < 8; py++) {
      for (let px = 12; px < 17; px++) {
        groundLayer[py][px] = waterTile;
      }
    }
    collisionBoxes.push({
      x: 12, y: 4, width: 5, height: 4,
      type: "water",
    });

    // Add a path
    for (let x = 0; x < width; x++) {
      groundLayer[Math.floor(height / 2)][x] = pathTile;
    }
  }

  return {
    width,
    height,
    tileWidth: tilesetAnalysis.tileWidth,
    tileHeight: tilesetAnalysis.tileHeight,
    layers: [
      {
        name: "ground",
        data: groundLayer,
        visible: true,
        alpha: 1,
      },
    ],
    collisionBoxes,
    objects: [],
    spawnPoints: [
      { id: "player_spawn", x: 1, y: 1, type: "player" },
    ],
    metadata: {
      name: `${template}_map`,
      description: `A ${template} themed map`,
      theme: template,
      tags: [template],
    },
  };
}

// ============================================================================
// SPRITE ANALYZER (for characters/objects)
// ============================================================================

export const SpriteAnalysisSchema = z.object({
  spriteId: z.string(),
  imagePath: z.string(),
  frameWidth: z.number(),
  frameHeight: z.number(),
  columns: z.number(),
  rows: z.number(),
  animations: z.array(z.object({
    name: z.string(),
    row: z.number(),
    startCol: z.number(),
    frameCount: z.number(),
    frameRate: z.number(),
    loop: z.boolean(),
  })),
  characterType: z.string().optional(),
  description: z.string(),
});

export type SpriteAnalysis = z.infer<typeof SpriteAnalysisSchema>;

/**
 * Analyzes a sprite sheet to extract animation information
 */
export async function analyzeSprite(
  imagePath: string,
  options: {
    spriteId?: string;
    hints?: string;
  } = {}
): Promise<SpriteAnalysis> {
  const absolutePath = path.resolve(imagePath);
  const imageBuffer = fs.readFileSync(absolutePath);
  const mimeType = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";

  const spriteId = options.spriteId || path.basename(imagePath, path.extname(imagePath));

  const prompt = `Analyze this sprite sheet image and identify the animations.

${options.hints ? `Context: ${options.hints}` : ""}

Determine:
1. The frame size (width x height of each individual sprite frame)
2. How many columns and rows of frames there are
3. What animations are present (idle, walk directions, actions, etc.)
4. For each animation: which row, starting column, frame count, suggested framerate

Common sprite sheet layouts:
- Character sprites often have 4 directions (down, left, right, up)
- Idle animations are usually 2-4 frames
- Walk animations are usually 4-8 frames
- Action animations vary

Look at the visual content to determine what each row/section represents.`;

  const result = await generateObject({
    model: visionModel,
    schema: z.object({
      frameWidth: z.number(),
      frameHeight: z.number(),
      columns: z.number(),
      rows: z.number(),
      characterType: z.string().optional(),
      description: z.string(),
      animations: z.array(z.object({
        name: z.string(),
        row: z.number(),
        startCol: z.number(),
        frameCount: z.number(),
        frameRate: z.number(),
        loop: z.boolean(),
      })),
    }),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image", image: imageBuffer, mimeType },
        ],
      },
    ],
  });

  return {
    spriteId,
    imagePath,
    ...result.object,
  };
}

// ============================================================================
// COMBINED MAP BUILDER
// ============================================================================

export interface MapBuildConfig {
  tilesetPath: string;
  tileWidth?: number;
  tileHeight?: number;
  mapWidth?: number;
  mapHeight?: number;
  description: string;
  includeObjects?: boolean;
  characterSprites?: string[];
}

export interface BuiltMap {
  tilemap: GeneratedTilemap;
  tilesetAnalysis: TilesetAnalysis;
  spriteAnalyses?: SpriteAnalysis[];
}

/**
 * Full pipeline: analyze tileset, generate map, optionally analyze sprites
 */
export async function buildMap(config: MapBuildConfig): Promise<BuiltMap> {
  console.log("[MapBuilder] Analyzing tileset...");
  const tilesetAnalysis = await analyzeTileset(
    config.tilesetPath,
    config.tileWidth || 32,
    config.tileHeight || 32
  );
  console.log(`[MapBuilder] Found ${tilesetAnalysis.tiles.length} tiles`);

  console.log("[MapBuilder] Generating tilemap...");
  const tilemap = await generateTilemap(
    config.description,
    tilesetAnalysis,
    {
      width: config.mapWidth || 20,
      height: config.mapHeight || 15,
      includeObjects: config.includeObjects,
      includeSpawnPoints: true,
    }
  );
  console.log(`[MapBuilder] Generated ${tilemap.width}x${tilemap.height} map`);

  let spriteAnalyses: SpriteAnalysis[] | undefined;
  if (config.characterSprites && config.characterSprites.length > 0) {
    console.log("[MapBuilder] Analyzing character sprites...");
    spriteAnalyses = await Promise.all(
      config.characterSprites.map(spritePath => analyzeSprite(spritePath))
    );
  }

  return {
    tilemap,
    tilesetAnalysis,
    spriteAnalyses,
  };
}

// ============================================================================
// COLLISION GRID GENERATOR
// ============================================================================

/**
 * Generates a collision grid from tilemap and tileset analysis
 * Returns a 2D boolean array where true = blocked/non-walkable
 */
export function generateCollisionGrid(
  tilemap: GeneratedTilemap,
  tilesetAnalysis: TilesetAnalysis
): boolean[][] {
  const grid: boolean[][] = [];
  const tileMap = new Map(tilesetAnalysis.tiles.map(t => [t.id, t]));

  // Get ground layer
  const groundLayer = tilemap.layers.find(l => l.name === "ground");
  if (!groundLayer) {
    // Return all walkable if no ground layer
    for (let y = 0; y < tilemap.height; y++) {
      grid[y] = new Array(tilemap.width).fill(false);
    }
    return grid;
  }

  // Build collision grid from tile walkability
  for (let y = 0; y < tilemap.height; y++) {
    grid[y] = [];
    for (let x = 0; x < tilemap.width; x++) {
      const tileId = groundLayer.data[y]?.[x];
      const tile = tileMap.get(tileId);
      // Default to walkable if tile not found
      grid[y][x] = tile ? !tile.walkable : false;
    }
  }

  // Apply collision boxes on top
  for (const box of tilemap.collisionBoxes) {
    if (box.type === "solid" || box.type === "water") {
      for (let y = box.y; y < box.y + box.height; y++) {
        for (let x = box.x; x < box.x + box.width; x++) {
          if (y >= 0 && y < tilemap.height && x >= 0 && x < tilemap.width) {
            grid[y][x] = true;
          }
        }
      }
    }
  }

  return grid;
}

/**
 * Collision type grid - more detailed than boolean
 */
export type CollisionType = "walkable" | "solid" | "water" | "hazard" | "trigger";

export function generateDetailedCollisionGrid(
  tilemap: GeneratedTilemap,
  tilesetAnalysis: TilesetAnalysis
): CollisionType[][] {
  const grid: CollisionType[][] = [];
  const tileMap = new Map(tilesetAnalysis.tiles.map(t => [t.id, t]));

  // Get ground layer
  const groundLayer = tilemap.layers.find(l => l.name === "ground");

  for (let y = 0; y < tilemap.height; y++) {
    grid[y] = [];
    for (let x = 0; x < tilemap.width; x++) {
      const tileId = groundLayer?.data[y]?.[x];
      const tile = tileMap.get(tileId || "");

      if (tile?.liquid) {
        grid[y][x] = "water";
      } else if (tile?.solid) {
        grid[y][x] = "solid";
      } else if (tile?.damage && tile.damage > 0) {
        grid[y][x] = "hazard";
      } else if (!tile?.walkable) {
        grid[y][x] = "solid";
      } else {
        grid[y][x] = "walkable";
      }
    }
  }

  // Apply collision boxes
  for (const box of tilemap.collisionBoxes) {
    const collisionType: CollisionType = box.type === "trigger" ? "trigger" : box.type;
    for (let y = box.y; y < box.y + box.height; y++) {
      for (let x = box.x; x < box.x + box.width; x++) {
        if (y >= 0 && y < tilemap.height && x >= 0 && x < tilemap.width) {
          grid[y][x] = collisionType;
        }
      }
    }
  }

  return grid;
}

// ============================================================================
// ANIMATED OBJECT PLACEMENT
// ============================================================================

export interface AnimatedObject {
  id: string;
  x: number;  // World X position (pixels)
  y: number;  // World Y position (pixels)
  spriteId: string;
  animationName: string;
  layer: number;
  zIndex: number;
  flipX?: boolean;
  scale?: number;
}

/**
 * Converts object placements to animated objects with proper positioning
 */
export function resolveObjectPlacements(
  tilemap: GeneratedTilemap,
  spriteMetadata: Record<string, { frameWidth: number; frameHeight: number; animations: Record<string, any> }>
): AnimatedObject[] {
  const animatedObjects: AnimatedObject[] = [];

  for (const obj of tilemap.objects) {
    const sprite = spriteMetadata[obj.spriteId || ""];

    animatedObjects.push({
      id: obj.id,
      // Convert tile position to pixel position
      x: obj.x * tilemap.tileWidth + tilemap.tileWidth / 2,
      y: obj.y * tilemap.tileHeight + tilemap.tileHeight,
      spriteId: obj.spriteId || obj.type,
      animationName: obj.animationId || "idle_down",
      layer: obj.layer,
      zIndex: obj.y,  // Y-sorting for depth
    });
  }

  return animatedObjects;
}

/**
 * Place character/NPC at spawn point with sprite data
 */
export function placeCharacterAtSpawn(
  tilemap: GeneratedTilemap,
  spawnId: string,
  spriteId: string,
  animationName: string = "idle_down"
): AnimatedObject | null {
  const spawn = tilemap.spawnPoints.find(s => s.id === spawnId);
  if (!spawn) return null;

  return {
    id: `character_${spawnId}`,
    x: spawn.x * tilemap.tileWidth + tilemap.tileWidth / 2,
    y: spawn.y * tilemap.tileHeight + tilemap.tileHeight,
    spriteId,
    animationName,
    layer: 1,
    zIndex: spawn.y,
  };
}

// ============================================================================
// PATHFINDING HELPERS
// ============================================================================

/**
 * Get walkable neighbors for pathfinding (4-directional)
 */
export function getWalkableNeighbors(
  x: number,
  y: number,
  collisionGrid: boolean[][],
  width: number,
  height: number
): Array<{ x: number; y: number }> {
  const neighbors: Array<{ x: number; y: number }> = [];
  const directions = [
    { dx: 0, dy: -1 },  // up
    { dx: 0, dy: 1 },   // down
    { dx: -1, dy: 0 },  // left
    { dx: 1, dy: 0 },   // right
  ];

  for (const dir of directions) {
    const nx = x + dir.dx;
    const ny = y + dir.dy;

    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
      if (!collisionGrid[ny][nx]) {
        neighbors.push({ x: nx, y: ny });
      }
    }
  }

  return neighbors;
}

/**
 * Check if a position is walkable
 */
export function isWalkable(
  x: number,
  y: number,
  collisionGrid: boolean[][]
): boolean {
  if (y < 0 || y >= collisionGrid.length) return false;
  if (x < 0 || x >= collisionGrid[0].length) return false;
  return !collisionGrid[y][x];
}

// ============================================================================
// EXPORT UTILITIES
// ============================================================================

/**
 * Export tilemap to a format compatible with the ECS rendering system
 */
export function exportToECS(tilemap: GeneratedTilemap): {
  tilemapData: string;
  collisions: Array<{ x: number; y: number; w: number; h: number; type: string }>;
} {
  // Convert 2D array to string format used by current renderer
  const groundLayer = tilemap.layers.find(l => l.name === "ground");
  if (!groundLayer) {
    return { tilemapData: "", collisions: [] };
  }

  // For now, convert tile IDs to simple characters
  // In a full implementation, this would use the tile registry
  const charMap: Record<string, string> = {
    grass: ",",
    dirt: ".",
    water: "~",
    path: "+",
    default: " ",
  };

  const rows: string[] = [];
  for (const row of groundLayer.data) {
    let rowStr = "";
    for (const tileId of row) {
      const category = tileId.split("_")[1] || "default";
      rowStr += charMap[category] || charMap.default;
    }
    rows.push(rowStr);
  }

  return {
    tilemapData: rows.join("\n"),
    collisions: tilemap.collisionBoxes.map(c => ({
      x: c.x,
      y: c.y,
      w: c.width,
      h: c.height,
      type: c.type,
    })),
  };
}
