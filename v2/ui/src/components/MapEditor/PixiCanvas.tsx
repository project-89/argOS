import { useEffect, useRef, useCallback, useState } from "react";
import {
  Application,
  Container,
  Sprite,
  Graphics,
  Texture,
  Rectangle,
  Assets,
  AnimatedSprite,
  Text,
  TextStyle,
} from "pixi.js";
import { useMapEditorStore } from "../../store/mapEditorStore";
import type { ArgosMapV1, EntityState, ZoneDef } from "../../types/map";
import { spriteManager, getAnimationName, CHARACTER_SPRITES, type Direction } from "./SpriteManager";

interface PixiCanvasProps {
  width: number;
  height: number;
}

export function PixiCanvas({ width, height }: PixiCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const containersRef = useRef<{
    tileLayers: Map<string, Container>;
    collision?: Container;
    zones?: Container;
    entities?: Container;
    markers?: Container;
    grid?: Container;
    cursor?: Graphics;
  }>({ tileLayers: new Map() });
  const tileLayerContainerRef = useRef<Container | null>(null);
  const texturesRef = useRef<Map<string, Texture>>(new Map());
  const tileTexturesRef = useRef<Map<string, Map<number, Texture>>>(new Map());
  const entitySpritesRef = useRef<Map<number, { sprite: AnimatedSprite | Graphics; label: Text }>>(new Map());
  const prevEntityPositions = useRef<Map<number, { x: number; y: number }>>(new Map());
  const selectionIndicatorRef = useRef<Graphics | null>(null);
  const [appReady, setAppReady] = useState(false);

  const {
    map,
    entities,
    zoom,
    panX,
    panY,
    showCollision,
    showZones,
    showGrid,
    tool,
    layer,
    selectedTile,
    selectedTileRegion,
    selectedMapPosition,
    selectedZone,
    selectedPrefab,
    zoneDrawStart,
    fillDrawStart,
    isEditing,
    paintTile,
    paintTileRegion,
    setCollision,
    setSelectedMapPosition,
    startZoneDraw,
    updateZoneDraw,
    finishZoneDraw,
    startFillDraw,
    updateFillDraw,
    finishFillDraw,
    stampPrefab,
    addMarker,
  } = useMapEditorStore();

  // Initialize PixiJS
  useEffect(() => {
    if (!canvasRef.current || appRef.current) return;

    const app = new Application();

    const initApp = async () => {
      await app.init({
        width,
        height,
        backgroundColor: 0x1a1a2e,
        antialias: false,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      if (canvasRef.current) {
        canvasRef.current.appendChild(app.canvas as HTMLCanvasElement);
      }

      // Create layer containers
      const worldContainer = new Container();
      worldContainer.sortableChildren = true;

      // Container that holds all tile layers (dynamic)
      const tileLayerContainer = new Container();
      tileLayerContainer.sortableChildren = true;
      tileLayerContainer.zIndex = 0;
      tileLayerContainerRef.current = tileLayerContainer;
      containersRef.current.tileLayers = new Map();

      containersRef.current.collision = new Container();
      containersRef.current.collision.zIndex = 100;

      containersRef.current.zones = new Container();
      containersRef.current.zones.zIndex = 101;

      containersRef.current.entities = new Container();
      containersRef.current.entities.zIndex = 102;

      containersRef.current.markers = new Container();
      containersRef.current.markers.zIndex = 103;

      containersRef.current.grid = new Container();
      containersRef.current.grid.zIndex = 104;

      containersRef.current.cursor = new Graphics();
      containersRef.current.cursor.zIndex = 105;

      worldContainer.addChild(tileLayerContainer);
      worldContainer.addChild(containersRef.current.collision);
      worldContainer.addChild(containersRef.current.zones);
      worldContainer.addChild(containersRef.current.entities);
      worldContainer.addChild(containersRef.current.markers);
      worldContainer.addChild(containersRef.current.grid);
      worldContainer.addChild(containersRef.current.cursor);

      app.stage.addChild(worldContainer);
      appRef.current = app;
      setAppReady(true);
    };

    initApp();

    return () => {
      app.destroy(true, { children: true, texture: true });
      appRef.current = null;
      setAppReady(false);
    };
  }, [width, height]);

  // Load tileset textures
  const loadTilesetTextures = useCallback(async (map: ArgosMapV1) => {
    for (const tileset of map.tilesets) {
      if (tileTexturesRef.current.has(tileset.id)) {
        continue;
      }

      try {
        const texture = await Assets.load(tileset.image);
        texturesRef.current.set(tileset.id, texture);

        // Create individual tile textures
        const tileTextures = new Map<number, Texture>();
        const baseTexture = texture.source;

        for (let i = 0; i < tileset.tileCount; i++) {
          const col = i % tileset.columns;
          const row = Math.floor(i / tileset.columns);

          const frame = new Rectangle(
            col * tileset.tileWidth,
            row * tileset.tileHeight,
            tileset.tileWidth,
            tileset.tileHeight
          );

          const tileTexture = new Texture({ source: baseTexture, frame });
          tileTextures.set(i + 1, tileTexture); // Tile IDs are 1-indexed
        }

        tileTexturesRef.current.set(tileset.id, tileTextures);
      } catch (err) {
        console.error(`Failed to load tileset ${tileset.id}:`, err);
      }
    }
  }, []);

  // Render all tile layers dynamically
  const renderTileLayers = useCallback((map: ArgosMapV1) => {
    const parentContainer = tileLayerContainerRef.current;
    if (!parentContainer) {
      console.warn("TileLayerContainer not ready");
      return;
    }

    // Clear old containers that no longer exist
    const currentLayerIds = new Set(map.layers.tileLayers.map(l => l.id));
    for (const [layerId, container] of containersRef.current.tileLayers) {
      if (!currentLayerIds.has(layerId)) {
        parentContainer.removeChild(container);
        containersRef.current.tileLayers.delete(layerId);
      }
    }

    const { width: gridWidth, height: gridHeight, tileSize } = map.grid;

    // Render each tile layer in order (first = bottom, last = top)
    map.layers.tileLayers.forEach((layerDef, index) => {
      // Get or create container for this layer
      let container = containersRef.current.tileLayers.get(layerDef.id);
      if (!container) {
        container = new Container();
        containersRef.current.tileLayers.set(layerDef.id, container);
        parentContainer.addChild(container);
      }

      // Set z-index based on array order
      container.zIndex = index;
      container.visible = layerDef.visible;

      // Get textures for this layer - DON'T clear container if textures aren't loaded yet
      const tileTextures = tileTexturesRef.current.get(layerDef.tilesetId);
      if (!tileTextures) {
        console.warn(`Textures not loaded for tileset: ${layerDef.tilesetId}`);
        return; // Don't clear - keep existing sprites
      }

      // Clear and re-render only if we have textures
      container.removeChildren();

      if (!layerDef.visible) return;

      for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
          const idx = y * gridWidth + x;
          const tileId = layerDef.tiles[idx];

          if (tileId === 0) continue;

          const texture = tileTextures.get(tileId);
          if (!texture) continue;

          const sprite = new Sprite(texture);
          sprite.x = x * tileSize;
          sprite.y = y * tileSize;
          sprite.width = tileSize;
          sprite.height = tileSize;
          container.addChild(sprite);
        }
      }
    });
  }, []);

  // Render collision overlay
  const renderCollisionLayer = useCallback((map: ArgosMapV1, show: boolean) => {
    const container = containersRef.current.collision;
    if (!container) return;

    container.removeChildren();
    container.visible = show;

    if (!show) return;

    const { width: gridWidth, height: gridHeight, tileSize } = map.grid;
    const graphics = new Graphics();

    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        const idx = y * gridWidth + x;
        if (map.layers.collision.blocked[idx]) {
          graphics.rect(x * tileSize, y * tileSize, tileSize, tileSize);
          graphics.fill({ color: 0xff0000, alpha: 0.4 });
        }
      }
    }

    container.addChild(graphics);
  }, []);

  // Render zones
  const renderZones = useCallback((zones: ZoneDef[], tileSize: number, show: boolean, selectedZoneId: string | null) => {
    const container = containersRef.current.zones;
    if (!container) return;

    // Keep the selection indicator if it exists
    const existingIndicator = selectionIndicatorRef.current;
    container.removeChildren();
    if (existingIndicator) {
      container.addChild(existingIndicator);
    }
    container.visible = show;

    if (!show) return;

    const colors: Record<string, number> = {
      bakery: 0xffa500,
      tavern: 0x8b4513,
      office: 0x4169e1,
      home: 0x32cd32,
      market: 0xffd700,
      shop: 0x9370db,
      garden: 0x10b981,
      street: 0x6b7280,
      plaza: 0x64748b,
      warehouse: 0x78716c,
      workshop: 0xef4444,
      temple: 0x8b5cf6,
      library: 0x6366f1,
      inn: 0xf59e0b,
      default: 0x9370db,
    };

    for (const zone of zones) {
      const graphics = new Graphics();
      const color = colors[zone.roomType || "default"] || colors.default;
      const isSelected = zone.id === selectedZoneId;

      if (zone.shape.kind === "rect") {
        const { x, y, w, h } = zone.shape;
        graphics.rect(
          x * tileSize,
          y * tileSize,
          w * tileSize,
          h * tileSize
        );
        graphics.fill({ color, alpha: isSelected ? 0.4 : 0.2 });
        graphics.stroke({ color: isSelected ? 0xffffff : color, width: isSelected ? 3 : 2, alpha: isSelected ? 1 : 0.8 });
      }
      // TODO: polygon zones

      container.addChild(graphics);
    }
  }, []);

  // Render grid
  const renderGrid = useCallback((map: ArgosMapV1, show: boolean) => {
    const container = containersRef.current.grid;
    if (!container) return;

    container.removeChildren();
    container.visible = show;

    if (!show) return;

    const { width: gridWidth, height: gridHeight, tileSize } = map.grid;
    const graphics = new Graphics();

    graphics.setStrokeStyle({ width: 1, color: 0xffffff, alpha: 0.15 });

    // Vertical lines
    for (let x = 0; x <= gridWidth; x++) {
      graphics.moveTo(x * tileSize, 0);
      graphics.lineTo(x * tileSize, gridHeight * tileSize);
      graphics.stroke();
    }

    // Horizontal lines
    for (let y = 0; y <= gridHeight; y++) {
      graphics.moveTo(0, y * tileSize);
      graphics.lineTo(gridWidth * tileSize, y * tileSize);
      graphics.stroke();
    }

    container.addChild(graphics);
  }, []);

  // Render entities (NPCs/objects) with animated sprites
  const renderEntities = useCallback(async (entities: EntityState[], tileSize: number) => {
    const container = containersRef.current.entities;
    if (!container) return;

    // Track which entities still exist
    const currentEntityIds = new Set(entities.map(e => e.id));

    // Remove sprites for entities that no longer exist
    for (const [id, spriteData] of entitySpritesRef.current) {
      if (!currentEntityIds.has(id)) {
        container.removeChild(spriteData.sprite);
        container.removeChild(spriteData.label);
        entitySpritesRef.current.delete(id);
        prevEntityPositions.current.delete(id);
      }
    }

    // Preload character sprites if not loaded
    for (const spriteName of CHARACTER_SPRITES) {
      if (!spriteManager.isLoaded(spriteName)) {
        await spriteManager.loadCharacterSprite(spriteName);
      }
    }

    for (const entity of entities) {
      const prevPos = prevEntityPositions.current.get(entity.id);
      const isMoving = prevPos && (prevPos.x !== entity.x || prevPos.y !== entity.y);

      // Determine direction based on movement
      let direction: Direction = (entity.direction as Direction) || "down";
      if (isMoving && prevPos) {
        const dx = entity.x - prevPos.x;
        const dy = entity.y - prevPos.y;
        if (Math.abs(dx) > Math.abs(dy)) {
          direction = dx > 0 ? "right" : "left";
        } else {
          direction = dy > 0 ? "down" : "up";
        }
      }

      // Update previous position
      prevEntityPositions.current.set(entity.id, { x: entity.x, y: entity.y });

      const x = entity.x * tileSize + tileSize / 2;
      const y = entity.y * tileSize + tileSize / 2;

      // Check if we have an existing sprite for this entity
      let spriteData = entitySpritesRef.current.get(entity.id);

      if (!spriteData) {
        // Create new sprite
        // Assign a random character sprite based on entity id
        const spriteIndex = entity.id % CHARACTER_SPRITES.length;
        const spriteName = entity.spriteId || CHARACTER_SPRITES[spriteIndex];
        const animation = getAnimationName(isMoving ? "walk" : "idle", direction);

        const animatedSprite = spriteManager.createAnimatedSprite(spriteName, animation);

        if (animatedSprite) {
          animatedSprite.x = x;
          animatedSprite.y = y;
          animatedSprite.play();
          container.addChild(animatedSprite);

          // Create name label
          const labelStyle = new TextStyle({
            fontSize: 10,
            fill: 0xffffff,
            fontFamily: "Arial",
            stroke: { color: 0x000000, width: 2 },
          });
          const label = new Text({ text: entity.name, style: labelStyle });
          label.anchor.set(0.5, 0);
          label.x = x;
          label.y = y + tileSize / 2 + 2;
          container.addChild(label);

          spriteData = { sprite: animatedSprite, label };
          entitySpritesRef.current.set(entity.id, spriteData);
        } else {
          // Fallback to colored circle if sprite loading failed
          const graphics = new Graphics();
          graphics.circle(0, 0, tileSize / 3);
          graphics.fill({ color: 0x00ff88 });
          graphics.stroke({ color: 0xffffff, width: 2 });
          graphics.x = x;
          graphics.y = y;
          container.addChild(graphics);

          const labelStyle = new TextStyle({
            fontSize: 10,
            fill: 0xffffff,
            fontFamily: "Arial",
            stroke: { color: 0x000000, width: 2 },
          });
          const label = new Text({ text: entity.name, style: labelStyle });
          label.anchor.set(0.5, 0);
          label.x = x;
          label.y = y + tileSize / 3 + 4;
          container.addChild(label);

          spriteData = { sprite: graphics, label };
          entitySpritesRef.current.set(entity.id, spriteData);
        }
      } else {
        // Update existing sprite position
        spriteData.sprite.x = x;
        spriteData.sprite.y = y;
        spriteData.label.x = x;
        spriteData.label.y = y + (spriteData.sprite instanceof AnimatedSprite ? tileSize / 2 + 2 : tileSize / 3 + 4);

        // Update animation based on movement
        if (spriteData.sprite instanceof AnimatedSprite) {
          const animation = getAnimationName(isMoving ? "walk" : "idle", direction);
          const newFrames = spriteManager.getAnimationFrames(
            entity.spriteId || CHARACTER_SPRITES[entity.id % CHARACTER_SPRITES.length],
            animation
          );

          if (newFrames.length > 0) {
            spriteData.sprite.textures = newFrames;
            if (isMoving) {
              spriteData.sprite.play();
            } else {
              spriteData.sprite.gotoAndStop(0);
            }
          }
        }
      }
    }
  }, []);

  // Render markers
  const renderMarkers = useCallback((map: ArgosMapV1) => {
    const container = containersRef.current.markers;
    if (!container || !map.markers) return;

    container.removeChildren();

    const { tileSize } = map.grid;

    for (const marker of map.markers) {
      const graphics = new Graphics();

      if (marker.kind === "spawn") {
        // Spawn marker - star shape
        graphics.circle(0, 0, tileSize / 4);
        graphics.fill({ color: marker.spawnType === "agent" ? 0x00ffff : 0xffff00 });
        graphics.stroke({ color: 0xffffff, width: 2 });
      } else if (marker.kind === "portal") {
        // Portal marker - diamond shape
        graphics.moveTo(0, -tileSize / 3);
        graphics.lineTo(tileSize / 3, 0);
        graphics.lineTo(0, tileSize / 3);
        graphics.lineTo(-tileSize / 3, 0);
        graphics.closePath();
        graphics.fill({ color: 0xff00ff });
        graphics.stroke({ color: 0xffffff, width: 2 });
      }

      graphics.x = marker.x * tileSize + tileSize / 2;
      graphics.y = marker.y * tileSize + tileSize / 2;

      container.addChild(graphics);
    }
  }, []);

  // Update transform (zoom/pan)
  useEffect(() => {
    if (!appReady || !appRef.current) return;

    const worldContainer = appRef.current.stage.children[0] as Container;
    if (worldContainer) {
      worldContainer.scale.set(zoom);
      worldContainer.x = panX;
      worldContainer.y = panY;
    }
  }, [zoom, panX, panY, appReady]);

  // Update map rendering when map changes
  useEffect(() => {
    if (!map || !appReady) return;

    const render = async () => {
      await loadTilesetTextures(map);
      renderTileLayers(map);
      renderCollisionLayer(map, showCollision);
      renderZones(map.zones, map.grid.tileSize, showZones, selectedZone);
      renderGrid(map, showGrid);
      renderMarkers(map);
    };

    render();
  }, [map, appReady, loadTilesetTextures, renderTileLayers, renderCollisionLayer, renderZones, renderGrid, renderMarkers, showCollision, showZones, showGrid, selectedZone]);

  // Update entities rendering
  useEffect(() => {
    if (!map) return;
    renderEntities(entities, map.grid.tileSize);
  }, [entities, map, renderEntities]);

  // Handle mouse events for editing
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!map || !appRef.current || !isEditing) return;

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = (e.clientX - rect.left - panX) / zoom;
      const mouseY = (e.clientY - rect.top - panY) / zoom;

      const tileX = Math.floor(mouseX / map.grid.tileSize);
      const tileY = Math.floor(mouseY / map.grid.tileSize);

      // Update cursor
      const cursor = containersRef.current.cursor;
      if (cursor) {
        cursor.clear();

        if (
          tileX >= 0 &&
          tileX < map.grid.width &&
          tileY >= 0 &&
          tileY < map.grid.height
        ) {
          const { tileSize } = map.grid;

          if ((tool === "paint" || tool === "erase") && fillDrawStart) {
            // Show fill preview rectangle while shift+dragging
            const minX = Math.min(fillDrawStart.x, tileX);
            const minY = Math.min(fillDrawStart.y, tileY);
            const maxX = Math.max(fillDrawStart.x, tileX);
            const maxY = Math.max(fillDrawStart.y, tileY);
            const w = (maxX - minX + 1) * tileSize;
            const h = (maxY - minY + 1) * tileSize;
            cursor.rect(minX * tileSize, minY * tileSize, w, h);
            cursor.stroke({ color: tool === "paint" ? 0x00ff00 : 0xff0000, width: 2 });
            cursor.fill({ color: tool === "paint" ? 0x00ff00 : 0xff0000, alpha: 0.2 });
          } else if (tool === "paint" || tool === "erase") {
            cursor.rect(tileX * tileSize, tileY * tileSize, tileSize, tileSize);
            cursor.stroke({ color: tool === "paint" ? 0x00ff00 : 0xff0000, width: 2 });
          } else if (tool === "select" || tool === "spawn" || tool === "portal") {
            cursor.rect(tileX * tileSize, tileY * tileSize, tileSize, tileSize);
            cursor.stroke({ color: 0x00ffff, width: 2 });
          } else if (tool === "zone" && zoneDrawStart) {
            // Show zone preview while drawing
            const minX = Math.min(zoneDrawStart.x, tileX);
            const minY = Math.min(zoneDrawStart.y, tileY);
            const maxX = Math.max(zoneDrawStart.x, tileX);
            const maxY = Math.max(zoneDrawStart.y, tileY);
            const w = (maxX - minX + 1) * tileSize;
            const h = (maxY - minY + 1) * tileSize;
            cursor.rect(minX * tileSize, minY * tileSize, w, h);
            cursor.stroke({ color: 0xffff00, width: 2 });
            cursor.fill({ color: 0xffff00, alpha: 0.1 });
          } else if (tool === "zone") {
            cursor.rect(tileX * tileSize, tileY * tileSize, tileSize, tileSize);
            cursor.stroke({ color: 0xffff00, width: 2 });
          }
        }
      }

      // Handle zone drawing while dragging
      if (e.buttons === 1 && tool === "zone" && zoneDrawStart) {
        if (
          tileX >= 0 &&
          tileX < map.grid.width &&
          tileY >= 0 &&
          tileY < map.grid.height
        ) {
          updateZoneDraw(tileX, tileY);
        }
      }

      // Handle fill drawing while shift+dragging
      if (e.buttons === 1 && (tool === "paint" || tool === "erase") && fillDrawStart) {
        if (
          tileX >= 0 &&
          tileX < map.grid.width &&
          tileY >= 0 &&
          tileY < map.grid.height
        ) {
          updateFillDraw(tileX, tileY);
        }
      }

      // Handle painting while dragging (but not for prefabs - they're one-click, and not during fill mode)
      if (e.buttons === 1 && (tool === "paint" || tool === "erase") && !selectedPrefab && !fillDrawStart) {
        if (
          tileX >= 0 &&
          tileX < map.grid.width &&
          tileY >= 0 &&
          tileY < map.grid.height
        ) {
          if (layer === "collision") {
            setCollision(tileX, tileY, tool === "paint");
          } else if (tool === "erase") {
            // Erase always uses single tile (0)
            paintTile(tileX, tileY, 0);
          } else if (selectedTileRegion) {
            // Paint multi-tile region
            paintTileRegion(tileX, tileY);
          } else {
            // Paint single tile
            paintTile(tileX, tileY, selectedTile);
          }
        }
      }
    },
    [map, isEditing, panX, panY, zoom, tool, layer, selectedTile, selectedTileRegion, selectedPrefab, zoneDrawStart, fillDrawStart, paintTile, paintTileRegion, setCollision, updateZoneDraw, updateFillDraw]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!map || !isEditing) return;

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = (e.clientX - rect.left - panX) / zoom;
      const mouseY = (e.clientY - rect.top - panY) / zoom;

      const tileX = Math.floor(mouseX / map.grid.tileSize);
      const tileY = Math.floor(mouseY / map.grid.tileSize);

      if (
        tileX >= 0 &&
        tileX < map.grid.width &&
        tileY >= 0 &&
        tileY < map.grid.height
      ) {
        if (tool === "select") {
          // Select tool: set selected map position
          setSelectedMapPosition({ x: tileX, y: tileY });
        } else if (tool === "zone") {
          // Zone tool: start drawing
          startZoneDraw(tileX, tileY);
        } else if (tool === "paint" || tool === "erase") {
          // Shift+click starts fill rectangle mode
          if (e.shiftKey) {
            console.log("[Fill] Starting fill draw at", tileX, tileY);
            startFillDraw(tileX, tileY);
          } else if (layer === "collision") {
            setCollision(tileX, tileY, tool === "paint");
          } else if (tool === "erase") {
            // Erase always uses single tile (0)
            paintTile(tileX, tileY, 0);
          } else if (selectedPrefab) {
            // Stamp prefab at position
            stampPrefab(tileX, tileY, selectedPrefab);
          } else if (selectedTileRegion) {
            // Paint multi-tile region
            paintTileRegion(tileX, tileY);
          } else {
            // Paint single tile
            paintTile(tileX, tileY, selectedTile);
          }
        } else if (tool === "spawn") {
          // Spawn tool: add a spawn marker at clicked position
          const spawnCount = (map.markers || []).filter(m => m.kind === "spawn").length;
          addMarker({
            kind: "spawn",
            id: `spawn_${Date.now()}`,
            x: tileX,
            y: tileY,
            spawnType: "agent",
            name: `Spawn Point ${spawnCount + 1}`,
          });
        } else if (tool === "portal") {
          // Portal tool: add a portal marker at clicked position
          addMarker({
            kind: "portal",
            id: `portal_${Date.now()}`,
            x: tileX,
            y: tileY,
            to: { x: tileX, y: tileY }, // Default to same position, user can edit
            bidirectional: true,
          });
        }
      }
    },
    [map, isEditing, panX, panY, zoom, tool, layer, selectedTile, selectedTileRegion, selectedPrefab, paintTile, paintTileRegion, setCollision, setSelectedMapPosition, startZoneDraw, startFillDraw, stampPrefab, addMarker]
  );

  const handleMouseUp = useCallback(
    (_e: React.MouseEvent<HTMLDivElement>) => {
      if (!map || !isEditing) return;

      // Finish zone drawing
      if (tool === "zone" && zoneDrawStart) {
        finishZoneDraw();
      }

      // Finish fill drawing
      if ((tool === "paint" || tool === "erase") && fillDrawStart) {
        console.log("[Fill] Finishing fill draw, fillDrawStart:", fillDrawStart);
        finishFillDraw();
      }
    },
    [map, isEditing, tool, zoneDrawStart, fillDrawStart, finishZoneDraw, finishFillDraw]
  );

  // Handle wheel for zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      useMapEditorStore.getState().setZoom(zoom + delta);
    },
    [zoom]
  );

  // Render selection indicator for selected map position
  useEffect(() => {
    if (!map || !appReady) return;

    const zonesContainer = containersRef.current.zones;
    if (!zonesContainer) return;

    // Remove existing indicator if any
    if (selectionIndicatorRef.current) {
      zonesContainer.removeChild(selectionIndicatorRef.current);
      selectionIndicatorRef.current = null;
    }

    if (!selectedMapPosition) return;

    const { tileSize } = map.grid;
    const { x, y } = selectedMapPosition;

    // Create selection indicator
    const indicator = new Graphics();
    indicator.rect(x * tileSize, y * tileSize, tileSize, tileSize);
    indicator.stroke({ color: 0x00ffff, width: 3 });
    indicator.fill({ color: 0x00ffff, alpha: 0.15 });

    zonesContainer.addChild(indicator);
    selectionIndicatorRef.current = indicator;
  }, [selectedMapPosition, map, appReady]);

  return (
    <div
      ref={canvasRef}
      className="w-full h-full overflow-hidden bg-gray-900 cursor-crosshair"
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
    />
  );
}
