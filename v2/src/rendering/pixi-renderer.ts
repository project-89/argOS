import { Application, Container, Sprite, Texture, Assets, TilingSprite, Graphics, Rectangle } from 'pixi.js';

declare function requestAnimationFrame(callback: (time: number) => void): number;
import { query, hasComponent, addComponent } from 'bitecs';
import type { World } from '../ecs/world';
import { GridPosition, Name } from '../ecs/components';
import { PixiSprite, AnimatedSprite, Camera, Tilemap, TileLayer } from './components';
import { SpriteRegistry } from './sprite-registry';

export interface RendererConfig {
  width: number;
  height: number;
  tileSize: number;
  backgroundColor: number;
  antialias?: boolean;
  resolution?: number;
}

export interface RendererState {
  app: Application;
  world: World;
  config: RendererConfig;
  layers: {
    background: Container;
    tiles: Container;
    entities: Container;
    effects: Container;
    ui: Container;
  };
  spriteMap: Map<number, Sprite>;
  tilemapGraphics: Map<number, Container>;
  textures: Map<string, Texture>;
  cameraEid: number | null;
  initialized: boolean;
}

const DEFAULT_CONFIG: RendererConfig = {
  width: 800,
  height: 600,
  tileSize: 16,
  backgroundColor: 0x1a1a2e,
  antialias: false,
  resolution: 1,
};

export async function createRenderer(
  world: World,
  canvas: HTMLCanvasElement | null,
  config: Partial<RendererConfig> = {}
): Promise<RendererState> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  const app = new Application();
  await app.init({
    width: finalConfig.width,
    height: finalConfig.height,
    backgroundColor: finalConfig.backgroundColor,
    antialias: finalConfig.antialias,
    resolution: finalConfig.resolution,
    canvas: canvas as any ?? undefined,
  });

  const layers = {
    background: new Container(),
    tiles: new Container(),
    entities: new Container(),
    effects: new Container(),
    ui: new Container(),
  };

  layers.entities.sortableChildren = true;

  app.stage.addChild(layers.background);
  app.stage.addChild(layers.tiles);
  app.stage.addChild(layers.entities);
  app.stage.addChild(layers.effects);
  app.stage.addChild(layers.ui);

  return {
    app,
    world,
    config: finalConfig,
    layers,
    spriteMap: new Map(),
    tilemapGraphics: new Map(),
    textures: new Map(),
    cameraEid: null,
    initialized: true,
  };
}

export async function loadAtlasTexture(state: RendererState, atlasId: string): Promise<void> {
  const atlas = SpriteRegistry.getAtlas(atlasId);
  if (!atlas) {
    console.warn(`Atlas not found: ${atlasId}`);
    return;
  }
  
  if (!state.textures.has(atlasId)) {
    const texture = await Assets.load(atlas.imagePath);
    state.textures.set(atlasId, texture);
  }
}

export function getFrameTexture(state: RendererState, atlasId: string, frameId: string): Texture | null {
  const baseTexture = state.textures.get(atlasId);
  if (!baseTexture) return null;
  
  const frame = SpriteRegistry.getFrame(atlasId, frameId);
  if (!frame) return null;
  
  const texture = new Texture({
    source: baseTexture.source,
    frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
  });
  
  return texture;
}

export function syncSprites(state: RendererState): void {
  const entities = query(state.world, [GridPosition, PixiSprite]);
  const { tileSize } = state.config;
  const existingEids = new Set(entities);

  for (const [eid, sprite] of state.spriteMap) {
    if (!existingEids.has(eid)) {
      state.layers.entities.removeChild(sprite);
      sprite.destroy();
      state.spriteMap.delete(eid);
    }
  }

  for (const eid of entities) {
    let sprite = state.spriteMap.get(eid);
    
    if (!sprite) {
      const atlasId = PixiSprite.atlasId[eid];
      const frameId = PixiSprite.frameId[eid];
      const texture = getFrameTexture(state, atlasId, frameId);
      
      if (texture) {
        sprite = new Sprite(texture);
        state.spriteMap.set(eid, sprite);
        state.layers.entities.addChild(sprite);
      } else {
        const graphics = new Graphics();
        graphics.rect(0, 0, tileSize, tileSize);
        graphics.fill(0xff00ff);
        sprite = new Sprite(state.app.renderer.generateTexture(graphics));
        state.spriteMap.set(eid, sprite);
        state.layers.entities.addChild(sprite);
      }
    }

    const x = GridPosition.x[eid] * tileSize;
    const y = GridPosition.y[eid] * tileSize;
    
    sprite.x = x;
    sprite.y = y;
    sprite.anchor.set(
      PixiSprite.anchorX[eid] ?? 0,
      PixiSprite.anchorY[eid] ?? 0
    );
    sprite.scale.set(
      PixiSprite.scaleX[eid] ?? 1,
      PixiSprite.scaleY[eid] ?? 1
    );
    sprite.rotation = PixiSprite.rotation[eid] ?? 0;
    sprite.tint = PixiSprite.tint[eid] ?? 0xffffff;
    sprite.alpha = PixiSprite.alpha[eid] ?? 1;
    sprite.visible = PixiSprite.visible[eid] ?? true;
    sprite.zIndex = PixiSprite.zIndex[eid] ?? y;
  }
}

export function syncAnimations(state: RendererState, deltaTime: number): void {
  const entities = query(state.world, [AnimatedSprite]);
  
  for (const eid of entities) {
    if (!AnimatedSprite.playing[eid]) continue;
    
    const atlasId = AnimatedSprite.atlasId[eid];
    const animationId = AnimatedSprite.animationId[eid];
    const animation = SpriteRegistry.getAnimation(atlasId, animationId);
    
    if (!animation) continue;
    
    const frameTime = 1000 / (animation.frameRate * (AnimatedSprite.speed[eid] || 1));
    AnimatedSprite.frameTime[eid] += deltaTime;
    
    if (AnimatedSprite.frameTime[eid] >= frameTime) {
      AnimatedSprite.frameTime[eid] = 0;
      let nextFrame = AnimatedSprite.frameIndex[eid] + 1;
      
      if (nextFrame >= animation.frames.length) {
        if (animation.loop) {
          nextFrame = 0;
        } else {
          AnimatedSprite.playing[eid] = false;
          nextFrame = animation.frames.length - 1;
        }
      }
      
      AnimatedSprite.frameIndex[eid] = nextFrame;
      
      const sprite = state.spriteMap.get(eid);
      if (sprite) {
        const frameId = animation.frames[nextFrame];
        const texture = getFrameTexture(state, atlasId, frameId);
        if (texture) {
          sprite.texture = texture;
        }
      }
    }
  }
}

export function syncCamera(state: RendererState): void {
  const cameras = query(state.world, [Camera]);
  if (cameras.length === 0) return;
  
  const cameraEid = cameras[0];
  const targetEid = Camera.targetEid[cameraEid];
  const { tileSize, width, height } = state.config;
  
  let targetX = 0;
  let targetY = 0;
  
  if (targetEid && hasComponent(state.world, targetEid, GridPosition)) {
    targetX = GridPosition.x[targetEid] * tileSize;
    targetY = GridPosition.y[targetEid] * tileSize;
  }
  
  const offsetX = Camera.offsetX[cameraEid] ?? 0;
  const offsetY = Camera.offsetY[cameraEid] ?? 0;
  const zoom = Camera.zoom[cameraEid] ?? 1;
  const smoothing = Camera.smoothing[cameraEid] ?? 0.1;

  const desiredX = -targetX + width / 2 / zoom + offsetX;
  const desiredY = -targetY + height / 2 / zoom + offsetY;

  const currentX = state.app.stage.x;
  const currentY = state.app.stage.y;
  
  state.app.stage.x = currentX + (desiredX - currentX) * smoothing;
  state.app.stage.y = currentY + (desiredY - currentY) * smoothing;
  state.app.stage.scale.set(zoom);
}

export function renderTilemap(state: RendererState, tilemapEid: number): void {
  if (state.tilemapGraphics.has(tilemapEid)) return;
  
  const width = Tilemap.width[tilemapEid];
  const height = Tilemap.height[tilemapEid];
  const tileWidth = Tilemap.tileWidth[tilemapEid] || state.config.tileSize;
  const tileHeight = Tilemap.tileHeight[tilemapEid] || state.config.tileSize;
  const data = Tilemap.data[tilemapEid];
  
  if (!data) return;
  
  const container = new Container();
  const rows = data.split('\n');
  
  for (let y = 0; y < height && y < rows.length; y++) {
    for (let x = 0; x < width && x < rows[y].length; x++) {
      const char = rows[y][x];
      const graphics = new Graphics();
      
      let color = 0x333333;
      switch (char) {
        case '#': color = 0x666666; break;
        case '.': color = 0x222222; break;
        case '+': color = 0x886644; break;
        case '~': color = 0x4488ff; break;
        case ',': color = 0x228822; break;
        case ' ': color = 0x000000; break;
      }
      
      graphics.rect(x * tileWidth, y * tileHeight, tileWidth, tileHeight);
      graphics.fill(color);
      container.addChild(graphics);
    }
  }
  
  state.tilemapGraphics.set(tilemapEid, container);
  state.layers.tiles.addChild(container);
}

export function syncTilemaps(state: RendererState): void {
  const tilemaps = query(state.world, [Tilemap]);
  
  for (const eid of tilemaps) {
    renderTilemap(state, eid);
  }
}

export function createRenderLoop(state: RendererState): () => void {
  let running = true;
  let lastTime = performance.now();
  
  const tick = () => {
    if (!running) return;
    
    const now = performance.now();
    const deltaTime = now - lastTime;
    lastTime = now;
    
    syncTilemaps(state);
    syncSprites(state);
    syncAnimations(state, deltaTime);
    syncCamera(state);
    
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(tick);
    } else {
      setTimeout(tick, 16);
    }
  };
  
  tick();
  
  return () => {
    running = false;
  };
}

export function destroyRenderer(state: RendererState): void {
  for (const sprite of state.spriteMap.values()) {
    sprite.destroy();
  }
  state.spriteMap.clear();
  
  for (const container of state.tilemapGraphics.values()) {
    container.destroy({ children: true });
  }
  state.tilemapGraphics.clear();
  
  state.app.destroy(true, { children: true });
}

export function worldToScreen(state: RendererState, worldX: number, worldY: number): { x: number; y: number } {
  const { tileSize } = state.config;
  return {
    x: worldX * tileSize + state.app.stage.x,
    y: worldY * tileSize + state.app.stage.y,
  };
}

export function screenToWorld(state: RendererState, screenX: number, screenY: number): { x: number; y: number } {
  const { tileSize } = state.config;
  const zoom = state.app.stage.scale.x;
  return {
    x: Math.floor((screenX - state.app.stage.x) / tileSize / zoom),
    y: Math.floor((screenY - state.app.stage.y) / tileSize / zoom),
  };
}
