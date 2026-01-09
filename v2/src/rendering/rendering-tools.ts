import { addComponent, hasComponent, query } from 'bitecs';
import type { World } from '../ecs/world';
import { GridPosition, Name, CharacterRigConfig } from '../ecs/components';
import { PixiSprite, AnimatedSprite, Camera, Tilemap } from './components';
import { SpriteRegistry, type SpriteAtlas } from './sprite-registry';
import type { EntityRegistry } from '../ecs/tools';
import {
  createCharacterRig,
  getCharacterRigByName,
  triggerActionAnimation,
  setCharacterIdle,
  listCharacterRigs,
  type CharacterRig,
} from './character-rig';

function lookupEntity(registry: EntityRegistry, name: string): number | undefined {
  return registry.byName.get(name);
}

function lookupEntityName(registry: EntityRegistry, eid: number): string | undefined {
  return registry.byId.get(eid);
}

export interface RenderingToolResult {
  success: boolean;
  result: any;
  error?: string;
}

export function createRenderingTools(world: World, registry: EntityRegistry) {
  return {
    setEntitySprite: (params: {
      entityName: string;
      spriteName: string;
      options?: {
        scaleX?: number;
        scaleY?: number;
        rotation?: number;
        tint?: number;
        alpha?: number;
        zIndex?: number;
      };
    }): RenderingToolResult => {
      try {
        const eid = lookupEntity(registry, params.entityName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }

        const resolved = SpriteRegistry.resolveSpriteName(params.spriteName);
        if (!resolved) {
          return { success: false, result: null, error: `Sprite not found: ${params.spriteName}` };
        }

        if (!hasComponent(world, eid, PixiSprite)) {
          addComponent(world, eid, PixiSprite);
        }

        PixiSprite.atlasId[eid] = resolved.atlasId;
        PixiSprite.frameId[eid] = resolved.frameId;
        PixiSprite.anchorX[eid] = 0.5;
        PixiSprite.anchorY[eid] = 0.5;
        PixiSprite.scaleX[eid] = params.options?.scaleX ?? 1;
        PixiSprite.scaleY[eid] = params.options?.scaleY ?? 1;
        PixiSprite.rotation[eid] = params.options?.rotation ?? 0;
        PixiSprite.tint[eid] = params.options?.tint ?? 0xffffff;
        PixiSprite.alpha[eid] = params.options?.alpha ?? 1;
        PixiSprite.visible[eid] = true;
        PixiSprite.zIndex[eid] = params.options?.zIndex ?? 0;

        return {
          success: true,
          result: {
            entity: params.entityName,
            atlasId: resolved.atlasId,
            frameId: resolved.frameId,
          },
        };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    setEntityAnimation: (params: {
      entityName: string;
      atlasId: string;
      animationId: string;
      options?: {
        speed?: number;
        loop?: boolean;
        autoPlay?: boolean;
      };
    }): RenderingToolResult => {
      try {
        const eid = lookupEntity(registry, params.entityName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }

        const animation = SpriteRegistry.getAnimation(params.atlasId, params.animationId);
        if (!animation) {
          return { success: false, result: null, error: `Animation not found: ${params.atlasId}:${params.animationId}` };
        }

        if (!hasComponent(world, eid, AnimatedSprite)) {
          addComponent(world, eid, AnimatedSprite);
        }

        AnimatedSprite.atlasId[eid] = params.atlasId;
        AnimatedSprite.animationId[eid] = params.animationId;
        AnimatedSprite.frameIndex[eid] = 0;
        AnimatedSprite.frameTime[eid] = 0;
        AnimatedSprite.lastFrameTime[eid] = 0;
        AnimatedSprite.loop[eid] = params.options?.loop ?? animation.loop;
        AnimatedSprite.playing[eid] = params.options?.autoPlay ?? true;
        AnimatedSprite.speed[eid] = params.options?.speed ?? 1;

        return {
          success: true,
          result: {
            entity: params.entityName,
            animation: params.animationId,
            frameCount: animation.frames.length,
          },
        };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    playAnimation: (params: { entityName: string }): RenderingToolResult => {
      try {
        const eid = lookupEntity(registry, params.entityName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }
        if (!hasComponent(world, eid, AnimatedSprite)) {
          return { success: false, result: null, error: `Entity has no animation: ${params.entityName}` };
        }
        AnimatedSprite.playing[eid] = true;
        AnimatedSprite.frameIndex[eid] = 0;
        AnimatedSprite.frameTime[eid] = 0;
        return { success: true, result: { entity: params.entityName, playing: true } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    stopAnimation: (params: { entityName: string }): RenderingToolResult => {
      try {
        const eid = lookupEntity(registry, params.entityName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }
        if (hasComponent(world, eid, AnimatedSprite)) {
          AnimatedSprite.playing[eid] = false;
        }
        return { success: true, result: { entity: params.entityName, playing: false } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    setSpriteVisibility: (params: { entityName: string; visible: boolean }): RenderingToolResult => {
      try {
        const eid = lookupEntity(registry, params.entityName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }
        if (hasComponent(world, eid, PixiSprite)) {
          PixiSprite.visible[eid] = params.visible;
        }
        return { success: true, result: { entity: params.entityName, visible: params.visible } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    setSpriteTint: (params: { entityName: string; color: number }): RenderingToolResult => {
      try {
        const eid = lookupEntity(registry, params.entityName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }
        if (hasComponent(world, eid, PixiSprite)) {
          PixiSprite.tint[eid] = params.color;
        }
        return { success: true, result: { entity: params.entityName, tint: params.color } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    listAvailableSprites: (params: { tag?: string; search?: string }): RenderingToolResult => {
      try {
        if (params.search) {
          const results = SpriteRegistry.searchSprites(params.search);
          return { success: true, result: results.slice(0, 50) };
        }
        if (params.tag) {
          const results = SpriteRegistry.findSpritesByTag(params.tag);
          return { success: true, result: results };
        }
        return { success: true, result: SpriteRegistry.exportCatalog() };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    getSpriteInfo: (params: { spriteName: string }): RenderingToolResult => {
      try {
        const resolved = SpriteRegistry.resolveSpriteName(params.spriteName);
        if (!resolved) {
          return { success: false, result: null, error: `Sprite not found: ${params.spriteName}` };
        }
        const info = SpriteRegistry.getSpriteInfo(resolved.atlasId, resolved.frameId);
        if (!info) {
          return { success: false, result: null, error: `Sprite info not found: ${params.spriteName}` };
        }
        return {
          success: true,
          result: {
            atlasId: resolved.atlasId,
            frameId: resolved.frameId,
            frame: info.frame,
            animations: info.animations,
            atlasDescription: info.atlas.description,
            atlasTags: info.atlas.tags,
          },
        };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    registerSpriteAtlas: (params: {
      id: string;
      imagePath: string;
      tileWidth: number;
      tileHeight: number;
      columns: number;
      rows: number;
      frameNames: string[][];
      tags?: string[];
      description?: string;
    }): RenderingToolResult => {
      try {
        const atlas = SpriteRegistry.createAtlasFromGrid(
          params.id,
          params.imagePath,
          params.tileWidth,
          params.tileHeight,
          params.columns,
          params.rows,
          params.frameNames,
          { tags: params.tags, description: params.description }
        );
        return {
          success: true,
          result: {
            atlasId: atlas.id,
            frameCount: atlas.frames.size,
            tags: atlas.tags,
          },
        };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    defineAnimation: (params: {
      atlasId: string;
      animationId: string;
      frameIds: string[];
      frameRate?: number;
      loop?: boolean;
    }): RenderingToolResult => {
      try {
        SpriteRegistry.addAnimation(
          params.atlasId,
          params.animationId,
          params.frameIds,
          params.frameRate ?? 10,
          params.loop ?? true
        );
        return {
          success: true,
          result: {
            atlasId: params.atlasId,
            animationId: params.animationId,
            frameCount: params.frameIds.length,
          },
        };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    setCameraTarget: (params: {
      cameraName?: string;
      targetName: string;
      options?: {
        offsetX?: number;
        offsetY?: number;
        zoom?: number;
        smoothing?: number;
      };
    }): RenderingToolResult => {
      try {
        const targetEid = lookupEntity(registry, params.targetName);
        if (targetEid === undefined) {
          return { success: false, result: null, error: `Target entity not found: ${params.targetName}` };
        }

        const cameras = query(world, [Camera]);
        let cameraEid: number;

        if (cameras.length === 0) {
          return { success: false, result: null, error: 'No camera exists' };
        }

        if (params.cameraName) {
          const namedCamera = lookupEntity(registry, params.cameraName);
          if (namedCamera === undefined || !cameras.includes(namedCamera)) {
            return { success: false, result: null, error: `Camera not found: ${params.cameraName}` };
          }
          cameraEid = namedCamera;
        } else {
          cameraEid = cameras[0];
        }

        Camera.targetEid[cameraEid] = targetEid;
        if (params.options?.offsetX !== undefined) Camera.offsetX[cameraEid] = params.options.offsetX;
        if (params.options?.offsetY !== undefined) Camera.offsetY[cameraEid] = params.options.offsetY;
        if (params.options?.zoom !== undefined) Camera.zoom[cameraEid] = params.options.zoom;
        if (params.options?.smoothing !== undefined) Camera.smoothing[cameraEid] = params.options.smoothing;

        return {
          success: true,
          result: {
            camera: params.cameraName ?? 'default',
            target: params.targetName,
          },
        };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    getVisibleEntities: (params: {
      viewerName: string;
      radius?: number;
    }): RenderingToolResult => {
      try {
        const viewerEid = lookupEntity(registry, params.viewerName);
        if (viewerEid === undefined) {
          return { success: false, result: null, error: `Viewer not found: ${params.viewerName}` };
        }
        if (!hasComponent(world, viewerEid, GridPosition)) {
          return { success: false, result: null, error: `Viewer has no position: ${params.viewerName}` };
        }

        const viewerX = GridPosition.x[viewerEid];
        const viewerY = GridPosition.y[viewerEid];
        const radius = params.radius ?? 10;

        const allWithSprites = query(world, [GridPosition, PixiSprite]);
        const visible: Array<{
          name: string;
          distance: number;
          x: number;
          y: number;
          sprite: string;
          visible: boolean;
        }> = [];

        for (const eid of allWithSprites) {
          if (eid === viewerEid) continue;
          
          const x = GridPosition.x[eid];
          const y = GridPosition.y[eid];
          const dx = x - viewerX;
          const dy = y - viewerY;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance <= radius) {
            const entityName = lookupEntityName(registry, eid) ?? `entity:${eid}`;
            visible.push({
              name: entityName,
              distance,
              x,
              y,
              sprite: `${PixiSprite.atlasId[eid]}:${PixiSprite.frameId[eid]}`,
              visible: PixiSprite.visible[eid] ?? true,
            });
          }
        }

        visible.sort((a, b) => a.distance - b.distance);

        return { success: true, result: visible };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    describeEntityAppearance: (params: { entityName: string }): RenderingToolResult => {
      try {
        const eid = lookupEntity(registry, params.entityName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }

        const result: any = { entity: params.entityName };

        if (hasComponent(world, eid, PixiSprite)) {
          const atlasId = PixiSprite.atlasId[eid];
          const frameId = PixiSprite.frameId[eid];
          const info = SpriteRegistry.getSpriteInfo(atlasId, frameId);
          
          result.sprite = {
            atlasId,
            frameId,
            visible: PixiSprite.visible[eid],
            alpha: PixiSprite.alpha[eid],
            tint: PixiSprite.tint[eid],
            scale: { x: PixiSprite.scaleX[eid], y: PixiSprite.scaleY[eid] },
            rotation: PixiSprite.rotation[eid],
          };

          if (info) {
            result.sprite.description = info.atlas.description;
            result.sprite.tags = info.atlas.tags;
            result.sprite.availableAnimations = info.animations;
          }
        }

        if (hasComponent(world, eid, AnimatedSprite)) {
          result.animation = {
            atlasId: AnimatedSprite.atlasId[eid],
            animationId: AnimatedSprite.animationId[eid],
            playing: AnimatedSprite.playing[eid],
            frameIndex: AnimatedSprite.frameIndex[eid],
            speed: AnimatedSprite.speed[eid],
            loop: AnimatedSprite.loop[eid],
          };
        }

        if (hasComponent(world, eid, GridPosition)) {
          result.position = {
            x: GridPosition.x[eid],
            y: GridPosition.y[eid],
            facing: GridPosition.facing[eid],
          };
        }

        return { success: true, result };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    listAnimations: (params: { atlasId?: string; tag?: string }): RenderingToolResult => {
      try {
        const results: Array<{
          atlasId: string;
          animationId: string;
          frameCount: number;
          frameRate: number;
          loop: boolean;
        }> = [];

        const atlases = SpriteRegistry.listAtlases();
        for (const atlas of atlases) {
          if (params.atlasId && atlas.id !== params.atlasId) continue;
          if (params.tag && !atlas.tags.includes(params.tag)) continue;

          for (const [animId, anim] of atlas.animations) {
            results.push({
              atlasId: atlas.id,
              animationId: animId,
              frameCount: anim.frames.length,
              frameRate: anim.frameRate,
              loop: anim.loop,
            });
          }
        }

        return { success: true, result: results };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    setEntityWalkAnimation: (params: {
      entityName: string;
      characterAtlas: string;
      direction: 'up' | 'down' | 'left' | 'right';
    }): RenderingToolResult => {
      try {
        const eid = lookupEntity(registry, params.entityName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }

        const animationId = `walk_${params.direction}`;
        const animation = SpriteRegistry.getAnimation(params.characterAtlas, animationId);
        if (!animation) {
          return { success: false, result: null, error: `Animation not found: ${params.characterAtlas}:${animationId}` };
        }

        if (!hasComponent(world, eid, AnimatedSprite)) {
          addComponent(world, eid, AnimatedSprite);
        }
        if (!hasComponent(world, eid, PixiSprite)) {
          addComponent(world, eid, PixiSprite);
        }

        AnimatedSprite.atlasId[eid] = params.characterAtlas;
        AnimatedSprite.animationId[eid] = animationId;
        AnimatedSprite.frameIndex[eid] = 0;
        AnimatedSprite.frameTime[eid] = 0;
        AnimatedSprite.loop[eid] = true;
        AnimatedSprite.playing[eid] = true;
        AnimatedSprite.speed[eid] = 1;

        PixiSprite.atlasId[eid] = params.characterAtlas;
        PixiSprite.frameId[eid] = animation.frames[0];
        PixiSprite.visible[eid] = true;

        return {
          success: true,
          result: {
            entity: params.entityName,
            atlas: params.characterAtlas,
            animation: animationId,
            frameCount: animation.frames.length,
          },
        };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    setEntityIdleFrame: (params: {
      entityName: string;
      characterAtlas: string;
      direction: 'up' | 'down' | 'left' | 'right';
    }): RenderingToolResult => {
      try {
        const eid = lookupEntity(registry, params.entityName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }

        const animationId = `idle_${params.direction}`;
        const animation = SpriteRegistry.getAnimation(params.characterAtlas, animationId);
        if (!animation) {
          return { success: false, result: null, error: `Animation not found: ${params.characterAtlas}:${animationId}` };
        }

        if (!hasComponent(world, eid, PixiSprite)) {
          addComponent(world, eid, PixiSprite);
        }
        if (hasComponent(world, eid, AnimatedSprite)) {
          AnimatedSprite.playing[eid] = false;
        }

        PixiSprite.atlasId[eid] = params.characterAtlas;
        PixiSprite.frameId[eid] = animation.frames[0];
        PixiSprite.visible[eid] = true;

        return {
          success: true,
          result: {
            entity: params.entityName,
            atlas: params.characterAtlas,
            frame: animation.frames[0],
            direction: params.direction,
          },
        };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    playActionAnimation: (params: {
      entityName: string;
      characterAtlas: string;
      action: string;
      direction: 'up' | 'down' | 'left' | 'right';
    }): RenderingToolResult => {
      try {
        const eid = lookupEntity(registry, params.entityName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }

        const animationId = `${params.action}_${params.direction}`;
        const animation = SpriteRegistry.getAnimation(params.characterAtlas, animationId);
        if (!animation) {
          return { success: false, result: null, error: `Animation not found: ${params.characterAtlas}:${animationId}` };
        }

        if (!hasComponent(world, eid, AnimatedSprite)) {
          addComponent(world, eid, AnimatedSprite);
        }
        if (!hasComponent(world, eid, PixiSprite)) {
          addComponent(world, eid, PixiSprite);
        }

        AnimatedSprite.atlasId[eid] = params.characterAtlas;
        AnimatedSprite.animationId[eid] = animationId;
        AnimatedSprite.frameIndex[eid] = 0;
        AnimatedSprite.frameTime[eid] = 0;
        AnimatedSprite.loop[eid] = false;
        AnimatedSprite.playing[eid] = true;
        AnimatedSprite.speed[eid] = 1;

        PixiSprite.atlasId[eid] = params.characterAtlas;
        PixiSprite.frameId[eid] = animation.frames[0];
        PixiSprite.visible[eid] = true;

        return {
          success: true,
          result: {
            entity: params.entityName,
            action: params.action,
            direction: params.direction,
            frameCount: animation.frames.length,
            duration: animation.frames.length / animation.frameRate,
          },
        };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    getAvailableCharacters: (): RenderingToolResult => {
      try {
        const atlases = SpriteRegistry.listAtlases();
        const characters: Array<{
          atlasId: string;
          description: string;
          animations: string[];
          tags: string[];
        }> = [];

        for (const atlas of atlases) {
          if (atlas.tags.includes('character') || atlas.tags.includes('animal')) {
            const anims = Array.from(atlas.animations.keys());
            if (anims.length > 0) {
              characters.push({
                atlasId: atlas.id,
                description: atlas.description,
                animations: anims,
                tags: atlas.tags,
              });
            }
          }
        }

        return { success: true, result: characters };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    loadCharacterAssets: async (params: {
      characterName: string;
      assetsDir: string;
    }): Promise<RenderingToolResult> => {
      try {
        const { loadCharacterAnimations } = await import('./animation-loader');
        const atlases = await loadCharacterAnimations(params.assetsDir, params.characterName);
        
        return {
          success: true,
          result: {
            character: params.characterName,
            atlasesLoaded: atlases.size,
            atlasIds: Array.from(atlases.keys()),
          },
        };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    setupCharacterRig: (params: {
      entityName: string;
      baseAtlas: string;
      actionAtlases?: Record<string, string>;
      actionMappings?: Record<string, { animation: string; loop?: boolean; speed?: number }>;
    }): RenderingToolResult => {
      try {
        const eid = lookupEntity(registry, params.entityName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }

        const rig = createCharacterRig({
          entityId: eid,
          entityName: params.entityName,
          baseAtlas: params.baseAtlas,
          actionAtlases: params.actionAtlases,
          actionMappings: params.actionMappings,
        });

        // Store rig config in component for persistence
        if (!hasComponent(world, eid, CharacterRigConfig)) {
          addComponent(world, eid, CharacterRigConfig);
        }
        CharacterRigConfig.baseAtlas[eid] = params.baseAtlas;
        CharacterRigConfig.idleAnimation[eid] = 'idle';
        CharacterRigConfig.currentDirection[eid] = 'down';

        setCharacterIdle(world, eid);

        return {
          success: true,
          result: {
            entity: params.entityName,
            baseAtlas: rig.baseAtlas,
            actions: Array.from(rig.actionMappings.keys()),
          },
        };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    triggerCharacterAction: (params: {
      entityName: string;
      action: string;
      direction?: 'up' | 'down' | 'left' | 'right';
      targetX?: number;
      targetY?: number;
    }): RenderingToolResult => {
      try {
        const rig = getCharacterRigByName(params.entityName);
        if (!rig) {
          return { success: false, result: null, error: `No character rig for: ${params.entityName}` };
        }

        const result = triggerActionAnimation(world, {
          action: params.action,
          entityId: rig.entityId,
          direction: params.direction,
          targetX: params.targetX,
          targetY: params.targetY,
        });

        if (result.success) {
          return {
            success: true,
            result: {
              entity: params.entityName,
              action: params.action,
              direction: rig.currentDirection,
              duration: result.duration,
            },
          };
        }

        return { success: false, result: null, error: 'Failed to trigger animation' };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    setCharacterIdle: (params: { entityName: string }): RenderingToolResult => {
      try {
        const rig = getCharacterRigByName(params.entityName);
        if (!rig) {
          return { success: false, result: null, error: `No character rig for: ${params.entityName}` };
        }

        setCharacterIdle(world, rig.entityId);

        return {
          success: true,
          result: {
            entity: params.entityName,
            direction: rig.currentDirection,
          },
        };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    listCharacterRigs: (): RenderingToolResult => {
      try {
        return { success: true, result: listCharacterRigs() };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },
  };
}

export type RenderingTools = ReturnType<typeof createRenderingTools>;
