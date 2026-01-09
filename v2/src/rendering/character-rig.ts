import { hasComponent, addComponent } from 'bitecs';
import type { World } from '../ecs/world';
import { GridPosition } from '../ecs/components';
import { PixiSprite, AnimatedSprite } from './components';
import { SpriteRegistry } from './sprite-registry';

export interface ActionAnimationMapping {
  action: string;
  animation: string;
  loop: boolean;
  speed: number;
}

export interface CharacterRig {
  entityId: number;
  entityName: string;
  baseAtlas: string;
  actionAtlases: Map<string, string>;
  actionMappings: Map<string, ActionAnimationMapping>;
  currentAction: string | null;
  currentDirection: 'up' | 'down' | 'left' | 'right';
  idleAnimation: string;
}

const characterRigs = new Map<number, CharacterRig>();
const rigsByName = new Map<string, CharacterRig>();

export function createCharacterRig(params: {
  entityId: number;
  entityName: string;
  baseAtlas: string;
  actionAtlases?: Record<string, string>;
  actionMappings?: Record<string, { animation: string; loop?: boolean; speed?: number }>;
}): CharacterRig {
  const actionAtlases = new Map(Object.entries(params.actionAtlases || {}));
  
  const defaultMappings: Record<string, ActionAnimationMapping> = {
    idle: { action: 'idle', animation: 'idle', loop: false, speed: 1 },
    move: { action: 'move', animation: 'walk', loop: true, speed: 1 },
    walk: { action: 'walk', animation: 'walk', loop: true, speed: 1 },
  };

  const actionMappings = new Map<string, ActionAnimationMapping>();
  for (const [action, mapping] of Object.entries(defaultMappings)) {
    actionMappings.set(action, mapping);
  }
  
  if (params.actionMappings) {
    for (const [action, mapping] of Object.entries(params.actionMappings)) {
      actionMappings.set(action, {
        action,
        animation: mapping.animation,
        loop: mapping.loop ?? false,
        speed: mapping.speed ?? 1,
      });
    }
  }

  const rig: CharacterRig = {
    entityId: params.entityId,
    entityName: params.entityName,
    baseAtlas: params.baseAtlas,
    actionAtlases,
    actionMappings,
    currentAction: null,
    currentDirection: 'down',
    idleAnimation: 'idle',
  };

  characterRigs.set(params.entityId, rig);
  rigsByName.set(params.entityName, rig);

  return rig;
}

export function getCharacterRig(entityId: number): CharacterRig | undefined {
  return characterRigs.get(entityId);
}

export function getCharacterRigByName(entityName: string): CharacterRig | undefined {
  return rigsByName.get(entityName);
}

export function removeCharacterRig(entityId: number): void {
  const rig = characterRigs.get(entityId);
  if (rig) {
    rigsByName.delete(rig.entityName);
    characterRigs.delete(entityId);
  }
}

export function clearAllCharacterRigs(): void {
  characterRigs.clear();
  rigsByName.clear();
}

export function directionFromFacing(facing: number): 'up' | 'down' | 'left' | 'right' {
  const normalized = ((facing % 360) + 360) % 360;
  if (normalized >= 315 || normalized < 45) return 'right';
  if (normalized >= 45 && normalized < 135) return 'down';
  if (normalized >= 135 && normalized < 225) return 'left';
  return 'up';
}

export function directionFromDelta(dx: number, dy: number): 'up' | 'down' | 'left' | 'right' {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'right' : 'left';
  }
  return dy > 0 ? 'down' : 'up';
}

export function updateCharacterAnimation(
  world: World,
  entityId: number,
  action: string,
  direction?: 'up' | 'down' | 'left' | 'right'
): boolean {
  const rig = characterRigs.get(entityId);
  if (!rig) return false;

  const mapping = rig.actionMappings.get(action);
  if (!mapping) {
    console.warn(`No animation mapping for action: ${action}`);
    return false;
  }

  const dir = direction || rig.currentDirection;
  rig.currentDirection = dir;
  rig.currentAction = action;

  const atlasId = rig.actionAtlases.get(action) || rig.baseAtlas;
  const animationId = `${mapping.animation}_${dir}`;

  const animation = SpriteRegistry.getAnimation(atlasId, animationId);
  if (!animation) {
    console.warn(`Animation not found: ${atlasId}:${animationId}`);
    return false;
  }

  if (!hasComponent(world, entityId, AnimatedSprite)) {
    addComponent(world, entityId, AnimatedSprite);
  }
  if (!hasComponent(world, entityId, PixiSprite)) {
    addComponent(world, entityId, PixiSprite);
  }

  AnimatedSprite.atlasId[entityId] = atlasId;
  AnimatedSprite.animationId[entityId] = animationId;
  AnimatedSprite.frameIndex[entityId] = 0;
  AnimatedSprite.frameTime[entityId] = 0;
  AnimatedSprite.loop[entityId] = mapping.loop;
  AnimatedSprite.playing[entityId] = true;
  AnimatedSprite.speed[entityId] = mapping.speed;

  PixiSprite.atlasId[entityId] = atlasId;
  PixiSprite.frameId[entityId] = animation.frames[0];
  PixiSprite.visible[entityId] = true;

  return true;
}

export function setCharacterIdle(world: World, entityId: number): boolean {
  return updateCharacterAnimation(world, entityId, 'idle');
}

export function setCharacterDirection(
  world: World,
  entityId: number,
  direction: 'up' | 'down' | 'left' | 'right'
): boolean {
  const rig = characterRigs.get(entityId);
  if (!rig) return false;

  rig.currentDirection = direction;
  
  const action = rig.currentAction || 'idle';
  return updateCharacterAnimation(world, entityId, action, direction);
}

export interface ActionAnimationTrigger {
  action: string;
  entityId: number;
  direction?: 'up' | 'down' | 'left' | 'right';
  targetX?: number;
  targetY?: number;
}

export function triggerActionAnimation(
  world: World,
  trigger: ActionAnimationTrigger
): { success: boolean; duration?: number } {
  const rig = characterRigs.get(trigger.entityId);
  if (!rig) {
    return { success: false };
  }

  let direction = trigger.direction;
  
  if (!direction && trigger.targetX !== undefined && trigger.targetY !== undefined) {
    if (hasComponent(world, trigger.entityId, GridPosition)) {
      const currentX = GridPosition.x[trigger.entityId];
      const currentY = GridPosition.y[trigger.entityId];
      const dx = trigger.targetX - currentX;
      const dy = trigger.targetY - currentY;
      direction = directionFromDelta(dx, dy);
    }
  }

  const success = updateCharacterAnimation(world, trigger.entityId, trigger.action, direction);
  
  if (success) {
    const mapping = rig.actionMappings.get(trigger.action);
    const atlasId = rig.actionAtlases.get(trigger.action) || rig.baseAtlas;
    const animationId = `${mapping!.animation}_${direction || rig.currentDirection}`;
    const animation = SpriteRegistry.getAnimation(atlasId, animationId);
    
    if (animation && !mapping!.loop) {
      const duration = animation.frames.length / animation.frameRate;
      return { success: true, duration };
    }
    return { success: true };
  }

  return { success: false };
}

export function onActionComplete(world: World, entityId: number): void {
  const rig = characterRigs.get(entityId);
  if (!rig) return;

  if (rig.currentAction && rig.currentAction !== 'idle') {
    const mapping = rig.actionMappings.get(rig.currentAction);
    if (mapping && !mapping.loop) {
      setCharacterIdle(world, entityId);
    }
  }
}

export function syncCharacterFacing(world: World, entityId: number): void {
  const rig = characterRigs.get(entityId);
  if (!rig) return;

  if (hasComponent(world, entityId, GridPosition)) {
    const facingStr = GridPosition.facing[entityId];
    const facing = facingStr ? parseFloat(facingStr) : 0;
    const direction = directionFromFacing(facing);
    
    if (direction !== rig.currentDirection) {
      setCharacterDirection(world, entityId, direction);
    }
  }
}

export function listCharacterRigs(): Array<{
  entityId: number;
  entityName: string;
  baseAtlas: string;
  actions: string[];
  currentAction: string | null;
  currentDirection: string;
}> {
  return Array.from(characterRigs.values()).map(rig => ({
    entityId: rig.entityId,
    entityName: rig.entityName,
    baseAtlas: rig.baseAtlas,
    actions: Array.from(rig.actionMappings.keys()),
    currentAction: rig.currentAction,
    currentDirection: rig.currentDirection,
  }));
}
