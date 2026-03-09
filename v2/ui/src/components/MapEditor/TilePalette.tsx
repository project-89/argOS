import { useEffect, useRef, useState, useCallback } from "react";
import { Application, Container, Sprite, Graphics, Texture, Rectangle, Assets } from "pixi.js";
import { useMapEditorStore } from "../../store/mapEditorStore";

interface TilePaletteProps {
  width?: number;
  height?: number;
}

export function TilePalette({ width = 256, height = 400 }: TilePaletteProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const containerRef = useRef<Container | null>(null);
  const selectionRef = useRef<Graphics | null>(null);
  const [tileTextures, setTileTextures] = useState<Map<number, Texture>>(new Map());
  const [scrollX, setScrollX] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const [loadingTileset, setLoadingTileset] = useState<string | null>(null);
  const [appReady, setAppReady] = useState(false);
  // Multi-tile selection state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ col: number; row: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ col: number; row: number } | null>(null);

  const { map, layer, selectedTile, selectedTileRegion, setSelectedTile, setSelectedTileRegion, setLayerTileset, startPrefabCreation } = useMapEditorStore();

  // Get current tileset based on the active layer
  const getCurrentTileset = useCallback(() => {
    if (!map || map.tilesets.length === 0) return null;
    if (layer === "collision") return null;

    // Find the current tile layer
    const currentLayer = map.layers.tileLayers.find(l => l.id === layer);
    if (!currentLayer) return null;

    // Return the tileset for this layer
    return map.tilesets.find(t => t.id === currentLayer.tilesetId) || map.tilesets[0];
  }, [map, layer]);

  // Get current layer definition
  const getCurrentLayer = useCallback(() => {
    if (!map || layer === "collision") return null;
    return map.layers.tileLayers.find(l => l.id === layer) || null;
  }, [map, layer]);

  const currentLayer = getCurrentLayer();

  const currentTileset = getCurrentTileset();

  // Initialize PixiJS
  useEffect(() => {
    if (!canvasRef.current) return;
    if (appRef.current) return;

    const app = new Application();
    let mounted = true;

    const initApp = async () => {
      await app.init({
        width,
        height,
        backgroundColor: 0x2a2a3e,
        antialias: false,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      if (!mounted) {
        app.destroy(true);
        return;
      }

      if (canvasRef.current && canvasRef.current.children.length === 0) {
        canvasRef.current.appendChild(app.canvas as HTMLCanvasElement);
      }

      const container = new Container();
      app.stage.addChild(container);
      containerRef.current = container;

      const selection = new Graphics();
      selection.zIndex = 100;
      app.stage.addChild(selection);
      selectionRef.current = selection;

      appRef.current = app;
      setAppReady(true);
    };

    initApp();

    return () => {
      mounted = false;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
        appRef.current = null;
        setAppReady(false);
      }
    };
  }, [width, height]);

  // Load tileset textures when tileset changes
  useEffect(() => {
    if (!currentTileset) {
      setTileTextures(new Map());
      return;
    }

    // Don't reload if already loading this tileset
    if (loadingTileset === currentTileset.id) return;

    const loadTextures = async () => {
      setLoadingTileset(currentTileset.id);

      try {
        console.log(`[TilePalette] Loading tileset: ${currentTileset.id} from ${currentTileset.image}`);
        const texture = await Assets.load(currentTileset.image);
        const baseTexture = texture.source;
        const textures = new Map<number, Texture>();

        for (let i = 0; i < currentTileset.tileCount; i++) {
          const col = i % currentTileset.columns;
          const row = Math.floor(i / currentTileset.columns);

          const frame = new Rectangle(
            col * currentTileset.tileWidth,
            row * currentTileset.tileHeight,
            currentTileset.tileWidth,
            currentTileset.tileHeight
          );

          const tileTexture = new Texture({ source: baseTexture, frame });
          textures.set(i + 1, tileTexture); // Tile IDs are 1-indexed
        }

        console.log(`[TilePalette] Loaded ${textures.size} tiles for ${currentTileset.id}`);
        setTileTextures(textures);
        setScrollY(0); // Reset scroll when changing tileset
      } catch (err) {
        console.error(`[TilePalette] Failed to load tileset:`, err);
        setTileTextures(new Map());
      } finally {
        setLoadingTileset(null);
      }
    };

    loadTextures();
  }, [currentTileset?.id, currentTileset?.image]);

  // Render palette - use tileset's original column layout
  useEffect(() => {
    const container = containerRef.current;

    if (!container || !currentTileset || tileTextures.size === 0) {
      if (container) container.removeChildren();
      return;
    }

    container.removeChildren();

    const tileSize = 32;
    // Use the tileset's original columns to preserve multi-tile object layouts
    const cols = currentTileset.columns;
    const padding = 2;

    for (let i = 1; i <= currentTileset.tileCount; i++) {
      const texture = tileTextures.get(i);
      if (!texture) continue;

      const col = (i - 1) % cols;
      const row = Math.floor((i - 1) / cols);

      const sprite = new Sprite(texture);
      sprite.x = col * (tileSize + padding) - scrollX;
      sprite.y = row * (tileSize + padding) - scrollY;
      sprite.width = tileSize;
      sprite.height = tileSize;
      sprite.eventMode = "static";
      sprite.cursor = "pointer";

      // Store tile ID for click handling
      (sprite as any).tileId = i;

      container.addChild(sprite);
    }
  }, [tileTextures, scrollX, scrollY, currentTileset]);

  // Update selection highlight
  useEffect(() => {
    const selection = selectionRef.current;

    if (!selection || !currentTileset || layer === "collision") {
      if (selection) selection.clear();
      return;
    }

    selection.clear();

    const tileSize = 32;
    const cols = currentTileset.columns;
    const padding = 2;

    // Show drag selection preview while dragging
    if (isDragging && dragStart && dragEnd) {
      const minCol = Math.min(dragStart.col, dragEnd.col);
      const maxCol = Math.max(dragStart.col, dragEnd.col);
      const minRow = Math.min(dragStart.row, dragEnd.row);
      const maxRow = Math.max(dragStart.row, dragEnd.row);

      const x = minCol * (tileSize + padding) - scrollX;
      const y = minRow * (tileSize + padding) - scrollY;
      const w = (maxCol - minCol + 1) * (tileSize + padding) - padding;
      const h = (maxRow - minRow + 1) * (tileSize + padding) - padding;

      selection.rect(x - 2, y - 2, w + 4, h + 4);
      selection.stroke({ color: 0x00ffff, width: 2 });
      selection.fill({ color: 0x00ffff, alpha: 0.1 });
      return;
    }

    // Show multi-tile region selection
    if (selectedTileRegion) {
      const startCol = (selectedTileRegion.startTileId - 1) % cols;
      const startRow = Math.floor((selectedTileRegion.startTileId - 1) / cols);

      const x = startCol * (tileSize + padding) - scrollX;
      const y = startRow * (tileSize + padding) - scrollY;
      const w = selectedTileRegion.width * (tileSize + padding) - padding;
      const h = selectedTileRegion.height * (tileSize + padding) - padding;

      selection.rect(x - 2, y - 2, w + 4, h + 4);
      selection.stroke({ color: 0x00ff00, width: 2 });
      selection.fill({ color: 0x00ff00, alpha: 0.1 });
      return;
    }

    // Single tile selection
    const col = (selectedTile - 1) % cols;
    const row = Math.floor((selectedTile - 1) / cols);

    const x = col * (tileSize + padding) - scrollX;
    const y = row * (tileSize + padding) - scrollY;

    selection.rect(x - 2, y - 2, tileSize + 4, tileSize + 4);
    selection.stroke({ color: 0x00ff00, width: 2 });
  }, [selectedTile, selectedTileRegion, scrollX, scrollY, layer, currentTileset, isDragging, dragStart, dragEnd]);

  // Helper to get tile coordinates from mouse event
  const getTileCoords = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!currentTileset) return null;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;

      const x = e.clientX - rect.left + scrollX;
      const y = e.clientY - rect.top + scrollY;

      const tileSize = 32;
      const cols = currentTileset.columns;
      const padding = 2;

      const col = Math.floor(x / (tileSize + padding));
      const row = Math.floor(y / (tileSize + padding));

      // Clamp to valid range
      const maxRow = Math.ceil(currentTileset.tileCount / cols) - 1;
      return {
        col: Math.max(0, Math.min(cols - 1, col)),
        row: Math.max(0, Math.min(maxRow, row)),
      };
    },
    [scrollX, scrollY, currentTileset]
  );

  // Handle mouse down - start drag selection
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!currentTileset || layer === "collision") return;
      const coords = getTileCoords(e);
      if (!coords) return;

      setIsDragging(true);
      setDragStart(coords);
      setDragEnd(coords);
    },
    [layer, currentTileset, getTileCoords]
  );

  // Handle mouse move - update drag selection
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDragging || !currentTileset) return;
      const coords = getTileCoords(e);
      if (!coords) return;

      setDragEnd(coords);
    },
    [isDragging, currentTileset, getTileCoords]
  );

  // Handle mouse up - finalize selection
  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDragging || !dragStart || !currentTileset) {
        setIsDragging(false);
        return;
      }

      const coords = getTileCoords(e) || dragEnd;
      if (!coords) {
        setIsDragging(false);
        return;
      }

      // Calculate selection bounds
      const minCol = Math.min(dragStart.col, coords.col);
      const maxCol = Math.max(dragStart.col, coords.col);
      const minRow = Math.min(dragStart.row, coords.row);
      const maxRow = Math.max(dragStart.row, coords.row);

      const selWidth = maxCol - minCol + 1;
      const selHeight = maxRow - minRow + 1;

      // Calculate the top-left tile ID
      const startTileId = minRow * currentTileset.columns + minCol + 1;

      if (selWidth === 1 && selHeight === 1) {
        // Single tile selection
        setSelectedTile(startTileId);
        setSelectedTileRegion(null);
      } else {
        // Multi-tile selection
        setSelectedTile(startTileId);
        setSelectedTileRegion({
          startTileId,
          width: selWidth,
          height: selHeight,
          tilesetCols: currentTileset.columns,
        });
      }

      setIsDragging(false);
      setDragStart(null);
      setDragEnd(null);
    },
    [isDragging, dragStart, dragEnd, currentTileset, setSelectedTile, setSelectedTileRegion, getTileCoords]
  );

  // Handle scroll - supports both X and Y scrolling
  // Uses native event listener with passive: false to prevent browser back gesture
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;

    const handleWheel = (e: WheelEvent) => {
      // Prevent browser back/forward gesture
      e.preventDefault();
      e.stopPropagation();

      if (!currentTileset) return;

      const tileSize = 32;
      const cols = currentTileset.columns;
      const padding = 2;
      const rows = Math.ceil(currentTileset.tileCount / cols);
      const totalWidth = cols * (tileSize + padding);
      const totalHeight = rows * (tileSize + padding);

      // Handle horizontal scroll (when horizontal movement is dominant or shift+wheel)
      if (e.shiftKey || (e.deltaX !== 0 && Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
        const delta = e.shiftKey ? e.deltaY : e.deltaX;
        setScrollX((prev) => {
          const next = prev + delta;
          return Math.max(0, Math.min(Math.max(0, totalWidth - width), next));
        });
      }

      // Handle vertical scroll (when vertical movement is dominant)
      // Using >= instead of === 0 to support trackpads with slight horizontal drift
      if (!e.shiftKey && e.deltaY !== 0 && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        setScrollY((prev) => {
          const next = prev + e.deltaY;
          return Math.max(0, Math.min(Math.max(0, totalHeight - height), next));
        });
      }
    };

    // Use passive: false to allow preventDefault() to work
    element.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      element.removeEventListener("wheel", handleWheel);
    };
  }, [width, height, currentTileset]);

  // Handle tileset change for current layer
  // NOTE: This hook MUST be before the early return for collision layer
  // to avoid React hooks violation (fewer hooks rendered than expected)
  const handleTilesetChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!currentLayer) return;
    setLayerTileset(currentLayer.id, e.target.value);
  }, [currentLayer, setLayerTileset]);

  if (layer === "collision") {
    return (
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-2">Collision Layer</h3>
        <p className="text-xs text-gray-500">
          Use paint tool to add collision.<br />
          Use erase tool to remove collision.
        </p>
        <div className="mt-4 flex gap-4">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-500 opacity-40 border border-red-500" />
            <span className="text-xs text-gray-400">Blocked</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-gray-700 border border-gray-600" />
            <span className="text-xs text-gray-400">Walkable</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      <div className="p-2 border-b border-gray-700">
        <h3 className="text-sm font-medium text-gray-300">
          Tile Palette
        </h3>
        <p className="text-xs text-gray-500 mt-1">
          {currentLayer ? (
            selectedTileRegion ? (
              <>
                {currentLayer.name} - {selectedTileRegion.width}x{selectedTileRegion.height} selection
              </>
            ) : (
              <>
                {currentLayer.name} - Tile #{selectedTile}
              </>
            )
          ) : map ? (
            "Select a tile layer"
          ) : (
            "Create a map first"
          )}
        </p>
        {/* Tileset selector for current layer */}
        {currentLayer && map && (
          <select
            value={currentLayer.tilesetId}
            onChange={handleTilesetChange}
            className="mt-2 w-full bg-gray-700 text-gray-200 text-xs px-2 py-1 rounded border border-gray-600"
          >
            {map.tilesets.map(tileset => (
              <option key={tileset.id} value={tileset.id}>
                {tileset.id}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Canvas container - always render to allow Pixi to initialize */}
      <div className="relative" style={{ height }}>
        {/* Pixi canvas */}
        <div
          ref={canvasRef}
          className="absolute inset-0 cursor-crosshair select-none"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />

        {/* Scroll indicators */}
        {currentTileset && tileTextures.size > 0 && appReady && (
          <>
            {/* Left arrow */}
            {scrollX > 0 && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 bg-gray-900/70 text-gray-400 px-1 py-2 rounded-r text-xs pointer-events-none">
                ◀
              </div>
            )}
            {/* Right arrow - show if there's more content to the right */}
            {(() => {
              const tileSize = 32;
              const padding = 2;
              const totalWidth = currentTileset.columns * (tileSize + padding);
              return scrollX < totalWidth - width && (
                <div className="absolute right-0 top-1/2 -translate-y-1/2 bg-gray-900/70 text-gray-400 px-1 py-2 rounded-l text-xs pointer-events-none">
                  ▶
                </div>
              );
            })()}
            {/* Top arrow */}
            {scrollY > 0 && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-gray-900/70 text-gray-400 px-2 py-0.5 rounded-b text-xs pointer-events-none">
                ▲
              </div>
            )}
            {/* Bottom arrow */}
            {(() => {
              const tileSize = 32;
              const padding = 2;
              const rows = Math.ceil(currentTileset.tileCount / currentTileset.columns);
              const totalHeight = rows * (tileSize + padding);
              return scrollY < totalHeight - height && (
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 bg-gray-900/70 text-gray-400 px-2 py-0.5 rounded-t text-xs pointer-events-none">
                  ▼
                </div>
              );
            })()}
          </>
        )}

        {/* Loading overlay */}
        {(loadingTileset || (!appReady && currentTileset)) && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-800/80 text-gray-500 text-sm">
            Loading tileset...
          </div>
        )}

        {/* No tileset message */}
        {!currentTileset && !loadingTileset && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm text-center p-4">
            {map ? (
              "Switch to a tile layer to see tiles"
            ) : (
              "Create a new map to see tiles"
            )}
          </div>
        )}

        {/* Empty tileset message */}
        {currentTileset && tileTextures.size === 0 && !loadingTileset && appReady && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm text-center p-4">
            Failed to load tiles.<br />
            Check console for errors.
          </div>
        )}
      </div>

      {/* Scroll hint */}
      {currentTileset && tileTextures.size > 0 && (
        <div className="px-2 py-1 border-t border-gray-700 text-xs text-gray-500 text-center">
          Click-drag to select multiple tiles • Shift+scroll for horizontal
        </div>
      )}

      {/* Create Prefab button - shows when multi-tile selection exists */}
      {selectedTileRegion && currentTileset && (
        <div className="px-2 py-2 border-t border-gray-700">
          <button
            onClick={startPrefabCreation}
            className="w-full px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-500 flex items-center justify-center gap-2"
          >
            <span>📦</span>
            <span>Create Prefab from Selection</span>
          </button>
          <div className="text-xs text-gray-500 text-center mt-1">
            {selectedTileRegion.width}×{selectedTileRegion.height} tiles selected
          </div>
        </div>
      )}
    </div>
  );
}
