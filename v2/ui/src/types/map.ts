/**
 * ArgosMapV1 - Map data format for the map editor
 * Based on MAP_BUILDER_RENDERING_SPEC.md
 */

export interface ArgosMapV1 {
  version: 1;
  id: string;
  name: string;

  grid: {
    width: number;
    height: number;
    tileSize: number;
  };

  tilesets: TilesetDef[];

  layers: {
    // Dynamic tile layers - rendered in array order (first = bottom)
    tileLayers: TileLayerDef[];
    collision: CollisionLayer;
  };

  zones: ZoneDef[];

  markers?: MarkerDef[];

  // Prefab definitions - reusable tile bundles with semantic meaning
  prefabs?: PrefabDef[];

  render?: RenderSettings;
}

export interface TilesetDef {
  id: string;
  image: string;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  tileCount: number;
}

export interface TileLayer {
  tilesetId: string;
  tiles: number[]; // width * height tile IDs (0 = empty)
}

export interface TileLayerDef {
  id: string;         // Unique identifier (e.g., "ground", "deco1", "foreground")
  name: string;       // Display name (e.g., "Ground", "Decoration 1", "Foreground")
  tilesetId: string;  // Which tileset this layer uses
  tiles: number[];    // width * height tile IDs (0 = empty)
  visible: boolean;   // Toggle visibility in editor
}

export interface CollisionLayer {
  blocked: boolean[]; // width * height
}

export interface ZoneMeta {
  description?: string;
  semanticTags?: string[];
  [key: string]: unknown;
}

export interface ZoneDef {
  id: string;
  name: string;
  roomType?: string;
  shape: RectShape | PolyShape;
  meta?: ZoneMeta;
}

export interface RectShape {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PolyShape {
  kind: "poly";
  points: Array<{ x: number; y: number }>;
}

export type MarkerDef = SpawnMarker | PortalMarker | LabelMarker | PrefabInstance;

export interface SpawnMarker {
  kind: "spawn";
  id: string;
  x: number;
  y: number;
  spawnType: "agent" | "object";
  name: string;
  typeId?: string;
  traits?: string[];
  meta?: Record<string, unknown>;
}

export interface PortalMarker {
  kind: "portal";
  id: string;
  x: number;
  y: number;
  to: { x: number; y: number };
  bidirectional?: boolean;
  locked?: boolean;
  keyId?: string;
  meta?: Record<string, unknown>;
}

export interface LabelMarker {
  kind: "label";
  id: string;
  x: number;
  y: number;
  text: string;
}

export interface RenderSettings {
  backgroundColor?: string;
  zoneOverlay?: {
    enabledByDefault?: boolean;
    colorByRoomType?: boolean;
  };
  defaults?: {
    npcRig?: string;
    objectSprite?: string;
  };
  spriteBindings?: Record<string, { spriteId?: string; rigId?: string }>;
}

/**
 * PrefabDef - A reusable tile bundle with semantic meaning
 * Used for "define once, stamp many" workflow
 */
export interface PrefabDef {
  id: string;
  typeId: string;           // e.g., "oak_tree", "well", "market_stall" - used by ECS
  displayName: string;      // Human-readable name for UI
  description: string;      // Semantic description for AI understanding
  semanticTags: string[];   // Tags for categorization and AI perception

  // Tile data
  tilesetId: string;
  tiles: PrefabTile[];      // Tiles that make up this prefab
  size: { width: number; height: number };  // Bounding box in tiles

  // AI hints
  aiHint?: string;          // Instruction for AI on how to use/interpret this

  // Future: animation states
  // states?: { [stateName: string]: { animationFrames?: number[]; description?: string } };
}

export interface PrefabTile {
  tileId: number;           // Tile ID from the tileset
  offsetX: number;          // X offset from top-left of prefab (in tiles)
  offsetY: number;          // Y offset from top-left of prefab (in tiles)
  layer?: string;           // Optional: which layer this tile should go on
}

/**
 * PrefabInstance - A placed prefab on the map
 * References a PrefabDef by typeId
 */
export interface PrefabInstance {
  kind: "prefab";
  id: string;
  prefabId: string;         // References PrefabDef.id
  typeId: string;           // Duplicated from PrefabDef for easy ECS lookup
  x: number;                // Grid position
  y: number;
  meta?: Record<string, unknown>;  // Instance-specific overrides
}

// Editor state types
export type EditorTool = "select" | "paint" | "erase" | "zone" | "spawn" | "portal";
// EditorLayer can be "collision" for the collision layer, or a tile layer ID
export type EditorLayer = string;

export interface EditorState {
  tool: EditorTool;
  layer: EditorLayer;
  selectedTile: number;
  selectedZone: string | null;
  selectedMarker: string | null;
  showCollision: boolean;
  showZones: boolean;
  showGrid: boolean;
}

// Runtime entity state (for rendering NPCs/objects from simulation)
export interface EntityState {
  id: number;
  name: string;
  x: number;
  y: number;
  spriteId?: string;
  rigId?: string;
  animation?: string;
  direction?: "up" | "down" | "left" | "right";
  roomName?: string;
}
