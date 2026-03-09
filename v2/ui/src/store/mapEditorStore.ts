import { create } from "zustand";
import type {
  ArgosMapV1,
  EditorTool,
  EditorLayer,
  EntityState,
  ZoneDef,
  MarkerDef,
  TileLayerDef,
  PrefabDef,
  PrefabInstance,
} from "../types/map";

interface MapEditorStore {
  // Map data
  map: ArgosMapV1 | null;
  entities: EntityState[];

  // Editor state
  tool: EditorTool;
  layer: EditorLayer;
  selectedTile: number;
  // Multi-tile selection: top-left tile ID and dimensions in tileset columns
  selectedTileRegion: { startTileId: number; width: number; height: number; tilesetCols: number } | null;
  selectedTilesetId: string | null;
  selectedZone: string | null;
  selectedMarker: string | null;
  brushSize: number;

  // Map position selection (for select tool)
  selectedMapPosition: { x: number; y: number } | null;

  // Zone drawing state
  zoneDrawStart: { x: number; y: number } | null;
  zoneDrawEnd: { x: number; y: number } | null;
  showZoneDialog: boolean;

  // Fill drawing state (shift+drag to fill rectangle)
  fillDrawStart: { x: number; y: number } | null;
  fillDrawEnd: { x: number; y: number } | null;

  // Prefab state
  selectedPrefab: string | null;  // Selected prefab ID for stamping
  showPrefabDialog: boolean;      // Show prefab creation dialog
  pendingPrefabTiles: { startTileId: number; width: number; height: number; tilesetId: string; tilesetCols: number } | null;

  // View options
  showCollision: boolean;
  showZones: boolean;
  showGrid: boolean;
  zoom: number;
  panX: number;
  panY: number;

  // Mode
  isEditing: boolean;
  isRunning: boolean;

  // Undo/redo
  history: ArgosMapV1[];
  historyIndex: number;

  // Actions
  setMap: (map: ArgosMapV1) => void;
  setTool: (tool: EditorTool) => void;
  setLayer: (layer: EditorLayer) => void;
  setSelectedTile: (tile: number) => void;
  setSelectedTileRegion: (region: { startTileId: number; width: number; height: number; tilesetCols: number } | null) => void;
  setSelectedTilesetId: (tilesetId: string | null) => void;
  setSelectedZone: (zoneId: string | null) => void;
  setSelectedMarker: (markerId: string | null) => void;
  setBrushSize: (size: number) => void;

  // Map position selection
  setSelectedMapPosition: (pos: { x: number; y: number } | null) => void;

  // Zone drawing
  startZoneDraw: (x: number, y: number) => void;
  updateZoneDraw: (x: number, y: number) => void;
  finishZoneDraw: () => void;
  cancelZoneDraw: () => void;
  setShowZoneDialog: (show: boolean) => void;

  // Fill drawing (shift+drag rectangle fill)
  startFillDraw: (x: number, y: number) => void;
  updateFillDraw: (x: number, y: number) => void;
  finishFillDraw: () => void;
  cancelFillDraw: () => void;

  toggleCollision: () => void;
  toggleZones: () => void;
  toggleGrid: () => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;

  setEditing: (editing: boolean) => void;
  setRunning: (running: boolean) => void;

  // Map mutations
  paintTile: (x: number, y: number, tileId: number) => void;
  paintTileRegion: (x: number, y: number) => void;
  setCollision: (x: number, y: number, blocked: boolean) => void;
  addZone: (zone: ZoneDef) => void;
  updateZone: (zoneId: string, updates: Partial<ZoneDef>) => void;
  removeZone: (zoneId: string) => void;
  addMarker: (marker: MarkerDef) => void;
  updateMarker: (markerId: string, updates: Partial<MarkerDef>) => void;
  removeMarker: (markerId: string) => void;

  // Layer management
  addLayer: (name: string, tilesetId: string) => void;
  removeLayer: (layerId: string) => void;
  moveLayerUp: (layerId: string) => void;
  moveLayerDown: (layerId: string) => void;
  toggleLayerVisibility: (layerId: string) => void;
  setLayerTileset: (layerId: string, tilesetId: string) => void;

  // Prefab management
  setSelectedPrefab: (prefabId: string | null) => void;
  setShowPrefabDialog: (show: boolean) => void;
  setPendingPrefabTiles: (tiles: { startTileId: number; width: number; height: number; tilesetId: string; tilesetCols: number } | null) => void;
  startPrefabCreation: () => void;  // Called when user wants to create prefab from current selection
  addPrefab: (prefab: PrefabDef) => void;
  updatePrefab: (prefabId: string, updates: Partial<PrefabDef>) => void;
  removePrefab: (prefabId: string) => void;
  stampPrefab: (x: number, y: number, prefabId: string) => void;  // Place prefab on map

  // Entity updates (from simulation)
  setEntities: (entities: EntityState[]) => void;
  updateEntity: (id: number, updates: Partial<EntityState>) => void;

  // History
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  // New map
  createNewMap: (width: number, height: number, name: string) => void;
}

const DEFAULT_TILE_SIZE = 32;

export const useMapEditorStore = create<MapEditorStore>((set, get) => ({
  // Initial state
  map: null,
  entities: [],

  tool: "select",
  layer: "ground", // Can be a tile layer ID or "collision"
  selectedTile: 1,
  selectedTileRegion: null,
  selectedTilesetId: null,
  selectedZone: null,
  selectedMarker: null,
  brushSize: 1,

  selectedMapPosition: null,
  zoneDrawStart: null,
  zoneDrawEnd: null,
  showZoneDialog: false,

  // Fill drawing state
  fillDrawStart: null,
  fillDrawEnd: null,

  selectedPrefab: null,
  showPrefabDialog: false,
  pendingPrefabTiles: null,

  showCollision: false,
  showZones: true,
  showGrid: true,
  zoom: 1,
  panX: 0,
  panY: 0,

  isEditing: true,
  isRunning: false,

  history: [],
  historyIndex: -1,

  // Actions
  setMap: (map) => set({ map }),
  setTool: (tool) => set({ tool }),
  setLayer: (layer) => set((state) => ({
    layer,
    // Auto-show collision overlay when collision layer is selected
    showCollision: layer === "collision" ? true : state.showCollision,
  })),
  setSelectedTile: (selectedTile) => set({ selectedTile, selectedTileRegion: null }),
  setSelectedTileRegion: (selectedTileRegion) => set({ selectedTileRegion }),
  setSelectedTilesetId: (selectedTilesetId) => set({ selectedTilesetId }),
  setSelectedZone: (selectedZone) => set({ selectedZone }),
  setSelectedMarker: (selectedMarker) => set({ selectedMarker }),
  setBrushSize: (brushSize) => set({ brushSize }),

  // Map position selection
  setSelectedMapPosition: (selectedMapPosition) => set({ selectedMapPosition }),

  // Zone drawing
  startZoneDraw: (x, y) => set({ zoneDrawStart: { x, y }, zoneDrawEnd: { x, y } }),
  updateZoneDraw: (x, y) => set({ zoneDrawEnd: { x, y } }),
  finishZoneDraw: () => set({ showZoneDialog: true }),
  cancelZoneDraw: () => set({ zoneDrawStart: null, zoneDrawEnd: null, showZoneDialog: false }),
  setShowZoneDialog: (showZoneDialog) => set({ showZoneDialog }),

  // Fill drawing (shift+drag rectangle fill)
  startFillDraw: (x, y) => set({ fillDrawStart: { x, y }, fillDrawEnd: { x, y } }),
  updateFillDraw: (x, y) => set({ fillDrawEnd: { x, y } }),
  finishFillDraw: () => {
    const { map, layer, tool, selectedTile, selectedTileRegion, fillDrawStart, fillDrawEnd } = get();
    console.log("[Fill Store] finishFillDraw called:", { fillDrawStart, fillDrawEnd, layer, tool, selectedTile });
    if (!map || !fillDrawStart || !fillDrawEnd) {
      console.log("[Fill Store] Aborting - missing data:", { map: !!map, fillDrawStart, fillDrawEnd });
      set({ fillDrawStart: null, fillDrawEnd: null });
      return;
    }

    const isErasing = tool === "erase";

    // Calculate the rectangle bounds
    const minX = Math.min(fillDrawStart.x, fillDrawEnd.x);
    const maxX = Math.max(fillDrawStart.x, fillDrawEnd.x);
    const minY = Math.min(fillDrawStart.y, fillDrawEnd.y);
    const maxY = Math.max(fillDrawStart.y, fillDrawEnd.y);

    // Push history before filling
    get().pushHistory();

    if (layer === "collision") {
      // Fill collision (paint = true, erase = false)
      set((state) => {
        if (!state.map) return state;
        const newMap = { ...state.map };
        newMap.layers = {
          ...newMap.layers,
          collision: {
            blocked: [...newMap.layers.collision.blocked],
          },
        };

        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            if (x >= 0 && x < newMap.grid.width && y >= 0 && y < newMap.grid.height) {
              const idx = y * newMap.grid.width + x;
              newMap.layers.collision.blocked[idx] = !isErasing;
            }
          }
        }

        return { map: newMap, fillDrawStart: null, fillDrawEnd: null };
      });
    } else {
      // Fill tiles
      set((state) => {
        if (!state.map) return state;
        const newMap = JSON.parse(JSON.stringify(state.map)) as ArgosMapV1;

        const targetLayer = newMap.layers.tileLayers.find(l => l.id === layer);
        if (!targetLayer) return { ...state, fillDrawStart: null, fillDrawEnd: null };

        if (isErasing) {
          // Erase mode - fill with 0 (empty)
          for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
              if (x >= 0 && x < newMap.grid.width && y >= 0 && y < newMap.grid.height) {
                const idx = y * newMap.grid.width + x;
                targetLayer.tiles[idx] = 0;
              }
            }
          }
        } else if (selectedTileRegion) {
          // Multi-tile pattern fill - repeat the pattern
          const { startTileId, width: patternW, height: patternH, tilesetCols } = selectedTileRegion;

          for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
              if (x >= 0 && x < newMap.grid.width && y >= 0 && y < newMap.grid.height) {
                const idx = y * newMap.grid.width + x;
                // Calculate pattern position (wrap around)
                const patternX = (x - minX) % patternW;
                const patternY = (y - minY) % patternH;
                const tileId = startTileId + patternY * tilesetCols + patternX;
                targetLayer.tiles[idx] = tileId;
              }
            }
          }
        } else {
          // Single tile fill
          for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
              if (x >= 0 && x < newMap.grid.width && y >= 0 && y < newMap.grid.height) {
                const idx = y * newMap.grid.width + x;
                targetLayer.tiles[idx] = selectedTile;
              }
            }
          }
        }

        return { map: newMap, fillDrawStart: null, fillDrawEnd: null };
      });
    }
  },
  cancelFillDraw: () => set({ fillDrawStart: null, fillDrawEnd: null }),

  toggleCollision: () => set((s) => ({ showCollision: !s.showCollision })),
  toggleZones: () => set((s) => ({ showZones: !s.showZones })),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(4, zoom)) }),
  setPan: (panX, panY) => set({ panX, panY }),

  setEditing: (isEditing) => set({ isEditing }),
  setRunning: (isRunning) => set({ isRunning }),

  // Map mutations
  paintTile: (x, y, tileId) => {
    const { map, layer } = get();
    if (!map || layer === "collision") return;

    // Validate coordinates
    if (x < 0 || x >= map.grid.width || y < 0 || y >= map.grid.height) return;

    const idx = y * map.grid.width + x;

    // Find the layer by ID
    const layerDef = map.layers.tileLayers.find(l => l.id === layer);
    if (!layerDef) return;

    // Check if tile already has this value (skip if no change needed)
    if (layerDef.tiles[idx] === tileId) return;

    // Only push history for actual changes
    get().pushHistory();

    set((state) => {
      if (!state.map) return state;

      // Deep clone the map to avoid mutations
      const newMap = JSON.parse(JSON.stringify(state.map)) as ArgosMapV1;

      // Find and update the layer
      const targetLayer = newMap.layers.tileLayers.find(l => l.id === layer);
      if (targetLayer) {
        targetLayer.tiles[idx] = tileId;
      }

      return { map: newMap };
    });
  },

  // Paint a region of tiles (for multi-tile selection like houses)
  paintTileRegion: (x, y) => {
    const { map, layer, selectedTileRegion } = get();
    if (!map || layer === "collision" || !selectedTileRegion) return;

    const { startTileId, width, height, tilesetCols } = selectedTileRegion;

    // Find the layer by ID
    const layerDef = map.layers.tileLayers.find(l => l.id === layer);
    if (!layerDef) return;

    // Check if any tiles will change
    let hasChanges = false;
    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        const mapX = x + dx;
        const mapY = y + dy;
        if (mapX < 0 || mapX >= map.grid.width || mapY < 0 || mapY >= map.grid.height) continue;

        const idx = mapY * map.grid.width + mapX;
        // Calculate the tile ID in the tileset based on position in the region
        const tileId = startTileId + dy * tilesetCols + dx;
        if (layerDef.tiles[idx] !== tileId) {
          hasChanges = true;
          break;
        }
      }
      if (hasChanges) break;
    }

    if (!hasChanges) return;

    // Only push history for actual changes
    get().pushHistory();

    set((state) => {
      if (!state.map) return state;

      // Deep clone the map to avoid mutations
      const newMap = JSON.parse(JSON.stringify(state.map)) as ArgosMapV1;

      // Find and update the layer
      const targetLayer = newMap.layers.tileLayers.find(l => l.id === layer);
      if (targetLayer) {
        for (let dy = 0; dy < height; dy++) {
          for (let dx = 0; dx < width; dx++) {
            const mapX = x + dx;
            const mapY = y + dy;
            if (mapX < 0 || mapX >= newMap.grid.width || mapY < 0 || mapY >= newMap.grid.height) continue;

            const idx = mapY * newMap.grid.width + mapX;
            // Calculate the tile ID in the tileset based on position in the region
            const tileId = startTileId + dy * tilesetCols + dx;
            targetLayer.tiles[idx] = tileId;
          }
        }
      }

      return { map: newMap };
    });
  },

  setCollision: (x, y, blocked) => {
    const { map, pushHistory } = get();
    if (!map) return;

    const idx = y * map.grid.width + x;
    if (idx < 0 || idx >= map.grid.width * map.grid.height) return;

    pushHistory();

    set((state) => {
      if (!state.map) return state;

      const newMap = { ...state.map };
      newMap.layers = {
        ...newMap.layers,
        collision: {
          blocked: [...newMap.layers.collision.blocked],
        },
      };
      newMap.layers.collision.blocked[idx] = blocked;

      return { map: newMap };
    });
  },

  addZone: (zone) => {
    get().pushHistory();
    set((state) => {
      if (!state.map) return state;
      return {
        map: {
          ...state.map,
          zones: [...state.map.zones, zone],
        },
      };
    });
  },

  updateZone: (zoneId, updates) => {
    get().pushHistory();
    set((state) => {
      if (!state.map) return state;
      return {
        map: {
          ...state.map,
          zones: state.map.zones.map((z) =>
            z.id === zoneId ? { ...z, ...updates } : z
          ),
        },
      };
    });
  },

  removeZone: (zoneId) => {
    get().pushHistory();
    set((state) => {
      if (!state.map) return state;
      return {
        map: {
          ...state.map,
          zones: state.map.zones.filter((z) => z.id !== zoneId),
        },
        selectedZone: state.selectedZone === zoneId ? null : state.selectedZone,
      };
    });
  },

  addMarker: (marker) => {
    get().pushHistory();
    set((state) => {
      if (!state.map) return state;
      return {
        map: {
          ...state.map,
          markers: [...(state.map.markers || []), marker],
        },
      };
    });
  },

  updateMarker: (markerId, updates) => {
    get().pushHistory();
    set((state) => {
      if (!state.map) return state;
      return {
        map: {
          ...state.map,
          markers: (state.map.markers || []).map((m) =>
            m.id === markerId ? { ...m, ...updates } as MarkerDef : m
          ),
        },
      };
    });
  },

  removeMarker: (markerId) => {
    get().pushHistory();
    set((state) => {
      if (!state.map) return state;
      return {
        map: {
          ...state.map,
          markers: (state.map.markers || []).filter((m) => m.id !== markerId),
        },
        selectedMarker: state.selectedMarker === markerId ? null : state.selectedMarker,
      };
    });
  },

  // Entity updates
  setEntities: (entities) => set({ entities }),
  updateEntity: (id, updates) => {
    set((state) => ({
      entities: state.entities.map((e) =>
        e.id === id ? { ...e, ...updates } : e
      ),
    }));
  },

  // History
  pushHistory: () => {
    const { map, history, historyIndex } = get();
    if (!map) return;

    // Truncate future history if we're not at the end
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(JSON.parse(JSON.stringify(map)));

    // Keep only last 50 states
    if (newHistory.length > 50) {
      newHistory.shift();
    }

    set({
      history: newHistory,
      historyIndex: newHistory.length - 1,
    });
  },

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex <= 0) return;

    const newIndex = historyIndex - 1;
    set({
      map: JSON.parse(JSON.stringify(history[newIndex])),
      historyIndex: newIndex,
    });
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;

    const newIndex = historyIndex + 1;
    set({
      map: JSON.parse(JSON.stringify(history[newIndex])),
      historyIndex: newIndex,
    });
  },

  // Layer management
  addLayer: (name, tilesetId) => {
    const { map, pushHistory } = get();
    if (!map) return;

    pushHistory();

    const layerId = `layer_${Date.now()}`;
    const totalTiles = map.grid.width * map.grid.height;

    const newLayer: TileLayerDef = {
      id: layerId,
      name,
      tilesetId,
      tiles: new Array(totalTiles).fill(0),
      visible: true,
    };

    set((state) => {
      if (!state.map) return state;
      return {
        map: {
          ...state.map,
          layers: {
            ...state.map.layers,
            tileLayers: [...state.map.layers.tileLayers, newLayer],
          },
        },
        layer: layerId, // Switch to new layer
      };
    });
  },

  removeLayer: (layerId) => {
    const { map, pushHistory, layer } = get();
    if (!map) return;
    // Don't allow removing the last layer
    if (map.layers.tileLayers.length <= 1) return;

    pushHistory();

    set((state) => {
      if (!state.map) return state;
      const newLayers = state.map.layers.tileLayers.filter(l => l.id !== layerId);
      return {
        map: {
          ...state.map,
          layers: {
            ...state.map.layers,
            tileLayers: newLayers,
          },
        },
        // If we removed the active layer, switch to the first layer
        layer: layer === layerId ? (newLayers[0]?.id || "collision") : layer,
      };
    });
  },

  moveLayerUp: (layerId) => {
    const { map, pushHistory } = get();
    if (!map) return;

    const idx = map.layers.tileLayers.findIndex(l => l.id === layerId);
    if (idx <= 0) return; // Already at top or not found

    pushHistory();

    set((state) => {
      if (!state.map) return state;
      const newLayers = [...state.map.layers.tileLayers];
      [newLayers[idx - 1], newLayers[idx]] = [newLayers[idx], newLayers[idx - 1]];
      return {
        map: {
          ...state.map,
          layers: {
            ...state.map.layers,
            tileLayers: newLayers,
          },
        },
      };
    });
  },

  moveLayerDown: (layerId) => {
    const { map, pushHistory } = get();
    if (!map) return;

    const idx = map.layers.tileLayers.findIndex(l => l.id === layerId);
    if (idx < 0 || idx >= map.layers.tileLayers.length - 1) return; // At bottom or not found

    pushHistory();

    set((state) => {
      if (!state.map) return state;
      const newLayers = [...state.map.layers.tileLayers];
      [newLayers[idx], newLayers[idx + 1]] = [newLayers[idx + 1], newLayers[idx]];
      return {
        map: {
          ...state.map,
          layers: {
            ...state.map.layers,
            tileLayers: newLayers,
          },
        },
      };
    });
  },

  toggleLayerVisibility: (layerId) => {
    const { map } = get();
    if (!map) return;

    // No history push for visibility toggle (non-destructive)
    set((state) => {
      if (!state.map) return state;
      return {
        map: {
          ...state.map,
          layers: {
            ...state.map.layers,
            tileLayers: state.map.layers.tileLayers.map(l =>
              l.id === layerId ? { ...l, visible: !l.visible } : l
            ),
          },
        },
      };
    });
  },

  setLayerTileset: (layerId, tilesetId) => {
    const { map, pushHistory } = get();
    if (!map) return;

    pushHistory();

    set((state) => {
      if (!state.map) return state;
      return {
        map: {
          ...state.map,
          layers: {
            ...state.map.layers,
            tileLayers: state.map.layers.tileLayers.map(l =>
              l.id === layerId ? { ...l, tilesetId } : l
            ),
          },
        },
      };
    });
  },

  // Prefab management
  setSelectedPrefab: (selectedPrefab) => set({ selectedPrefab }),
  setShowPrefabDialog: (showPrefabDialog) => set({ showPrefabDialog }),
  setPendingPrefabTiles: (pendingPrefabTiles) => set({ pendingPrefabTiles }),

  startPrefabCreation: () => {
    const { selectedTileRegion, layer, map } = get();
    if (!selectedTileRegion || !map || layer === "collision") return;

    // Find the current layer to get its tileset
    const currentLayer = map.layers.tileLayers.find(l => l.id === layer);
    if (!currentLayer) return;

    set({
      pendingPrefabTiles: {
        startTileId: selectedTileRegion.startTileId,
        width: selectedTileRegion.width,
        height: selectedTileRegion.height,
        tilesetId: currentLayer.tilesetId,
        tilesetCols: selectedTileRegion.tilesetCols,
      },
      showPrefabDialog: true,
    });
  },

  addPrefab: (prefab) => {
    get().pushHistory();
    set((state) => {
      if (!state.map) return state;
      return {
        map: {
          ...state.map,
          prefabs: [...(state.map.prefabs || []), prefab],
        },
        showPrefabDialog: false,
        pendingPrefabTiles: null,
      };
    });
  },

  updatePrefab: (prefabId, updates) => {
    get().pushHistory();
    set((state) => {
      if (!state.map) return state;
      return {
        map: {
          ...state.map,
          prefabs: (state.map.prefabs || []).map((p) =>
            p.id === prefabId ? { ...p, ...updates } : p
          ),
        },
      };
    });
  },

  removePrefab: (prefabId) => {
    get().pushHistory();
    set((state) => {
      if (!state.map) return state;
      return {
        map: {
          ...state.map,
          prefabs: (state.map.prefabs || []).filter((p) => p.id !== prefabId),
        },
        selectedPrefab: state.selectedPrefab === prefabId ? null : state.selectedPrefab,
      };
    });
  },

  stampPrefab: (x, y, prefabId) => {
    const { map, layer, pushHistory } = get();
    if (!map) return;

    const prefab = (map.prefabs || []).find(p => p.id === prefabId);
    if (!prefab) return;

    pushHistory();

    set((state) => {
      if (!state.map) return state;

      // Deep clone the map
      const newMap = JSON.parse(JSON.stringify(state.map)) as ArgosMapV1;

      // Find the target layer (use current layer or first layer that matches tileset)
      let targetLayer = newMap.layers.tileLayers.find(l => l.id === layer && l.tilesetId === prefab.tilesetId);
      if (!targetLayer) {
        // Fall back to first layer with matching tileset
        targetLayer = newMap.layers.tileLayers.find(l => l.tilesetId === prefab.tilesetId);
      }
      if (!targetLayer) {
        // Create a new layer for this tileset
        const newLayerId = `prefab_layer_${prefab.tilesetId}`;
        const totalTiles = newMap.grid.width * newMap.grid.height;
        targetLayer = {
          id: newLayerId,
          name: `Prefab (${prefab.tilesetId})`,
          tilesetId: prefab.tilesetId,
          tiles: new Array(totalTiles).fill(0),
          visible: true,
        };
        newMap.layers.tileLayers.push(targetLayer);
      }

      // Paint the prefab tiles
      for (const tile of prefab.tiles) {
        const mapX = x + tile.offsetX;
        const mapY = y + tile.offsetY;

        if (mapX >= 0 && mapX < newMap.grid.width && mapY >= 0 && mapY < newMap.grid.height) {
          const idx = mapY * newMap.grid.width + mapX;
          targetLayer.tiles[idx] = tile.tileId;
        }
      }

      // Add a prefab instance marker
      const instanceId = `prefab_instance_${Date.now()}`;
      const instance: PrefabInstance = {
        kind: "prefab",
        id: instanceId,
        prefabId: prefab.id,
        typeId: prefab.typeId,
        x,
        y,
      };

      newMap.markers = [...(newMap.markers || []), instance];

      return { map: newMap };
    });
  },

  // New map
  createNewMap: (width, height, name) => {
    const totalTiles = width * height;

    const newMap: ArgosMapV1 = {
      version: 1,
      id: `map_${Date.now()}`,
      name,
      grid: {
        width,
        height,
        tileSize: DEFAULT_TILE_SIZE,
      },
      tilesets: [
        {
          id: "terrain",
          image: "/32x32/1_Terrains_32x32.png",
          tileWidth: 32,
          tileHeight: 32,
          columns: 32,
          tileCount: 736,
        },
        {
          id: "props",
          image: "/32x32/3_Props_and_Buildings_32x32.png",
          tileWidth: 32,
          tileHeight: 32,
          columns: 32,
          tileCount: 1024,
        },
      ],
      layers: {
        tileLayers: [
          {
            id: "ground",
            name: "Ground",
            tilesetId: "terrain",
            tiles: new Array(totalTiles).fill(1), // Default grass tile
            visible: true,
          },
          {
            id: "deco",
            name: "Decoration",
            tilesetId: "props",
            tiles: new Array(totalTiles).fill(0),
            visible: true,
          },
        ],
        collision: {
          blocked: new Array(totalTiles).fill(false),
        },
      },
      zones: [],
      markers: [],
    };

    set({
      map: newMap,
      layer: "ground", // Default to ground layer
      history: [JSON.parse(JSON.stringify(newMap))],
      historyIndex: 0,
    });
  },
}));
