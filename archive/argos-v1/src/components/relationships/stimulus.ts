import {
  createRelation,
  World,
  addComponent,
  removeComponent,
  hasComponent,
} from "bitecs";
import {
  StimulusInRoomStore,
  StimulusSourceStore,
  StimulusRoomMetadata,
  StimulusSourceMetadata,
} from "./types";

// Create relationships with metadata stores
export const StimulusInRoom = createRelation<StimulusInRoomStore>({
  store: () => ({
    timestamp: [] as number[],
    intensity: [] as number[],
    metadata: [] as Record<string, any>[],
  }),
  autoRemoveSubject: true,
});

export const StimulusSource = createRelation<StimulusSourceStore>({
  store: () => ({
    timestamp: [] as number[],
    strength: [] as number[],
    metadata: [] as Record<string, any>[],
  }),
  autoRemoveSubject: true,
});

// Helper functions for stimulus relationships
export function getStimulusSourceMetadata(
  world: World,
  source: number,
  target: number
): StimulusSourceMetadata {
  const relation = StimulusSource(target);
  return {
    timestamp: relation.timestamp[source],
    strength: relation.strength[source],
    metadata: relation.metadata[source],
  };
}

export function getStimulusRoomMetadata(
  world: World,
  source: number,
  target: number
): StimulusRoomMetadata {
  const relation = StimulusInRoom(target);
  return {
    timestamp: relation.timestamp[source],
    intensity: relation.intensity[source],
    metadata: relation.metadata[source],
  };
}

// Stimulus room relationship helpers
export function addStimulusToRoom(
  world: World,
  stimulusId: number,
  roomId: number,
  intensity = 1,
  metadata?: Record<string, any>
) {
  addComponent(world, stimulusId, StimulusInRoom(roomId));
  const relation = StimulusInRoom(roomId);
  relation.timestamp[stimulusId] = Date.now();
  relation.intensity[stimulusId] = intensity;
  if (metadata) relation.metadata[stimulusId] = metadata;
}

export function removeStimulusFromRoom(
  world: World,
  stimulusId: number,
  roomId: number
) {
  removeComponent(world, stimulusId, StimulusInRoom(roomId));
}

export function isStimulusInRoom(
  world: World,
  stimulusId: number,
  roomId: number
): boolean {
  return hasComponent(world, stimulusId, StimulusInRoom(roomId));
}

// Stimulus source relationship helpers
export function setStimulusSource(
  world: World,
  stimulusId: number,
  sourceId: number,
  strength = 1,
  metadata?: Record<string, any>
) {
  addComponent(world, stimulusId, StimulusSource(sourceId));
  const relation = StimulusSource(sourceId);
  relation.timestamp[stimulusId] = Date.now();
  relation.strength[stimulusId] = strength;
  if (metadata) relation.metadata[stimulusId] = metadata;
}

export function removeStimulusSource(
  world: World,
  stimulusId: number,
  sourceId: number
) {
  removeComponent(world, stimulusId, StimulusSource(sourceId));
}

export function hasStimulusSource(
  world: World,
  stimulusId: number,
  sourceId: number
): boolean {
  return hasComponent(world, stimulusId, StimulusSource(sourceId));
}

// Query helpers
export function getStimuliInRoom(world: World, roomId: number): number[] {
  return Object.entries(StimulusInRoom(roomId).timestamp)
    .filter(([_, timestamp]) => timestamp > 0)
    .map(([eid]) => parseInt(eid));
}

export function getStimuliFromSource(world: World, sourceId: number): number[] {
  return Object.entries(StimulusSource(sourceId).timestamp)
    .filter(([_, timestamp]) => timestamp > 0)
    .map(([eid]) => parseInt(eid));
}
