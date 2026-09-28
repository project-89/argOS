import {
  createRelation,
  World,
  addComponent,
  removeComponent,
  hasComponent,
} from "bitecs";
import {
  InteractionStore,
  InteractionMetadata,
  InteractionUpdateData,
} from "./types";

// Room occupancy - exclusive relationship (agent can only be in one room)
export const OccupiesRoom = createRelation({ exclusive: true });

// Interaction relationship with metadata store
export const Interaction = createRelation<InteractionStore>({
  store: () => ({
    type: [] as string[],
    strength: [] as number[],
    lastUpdate: [] as number[],
    metadata: [] as Record<string, any>[],
  }),
});

// Helper functions
export function getInteractionMetadata(
  world: World,
  source: number,
  target: number
): InteractionMetadata {
  const relation = Interaction(target);
  return {
    type: relation.type[source],
    strength: relation.strength[source],
    lastUpdate: relation.lastUpdate[source],
    metadata: relation.metadata[source],
  };
}

export function updateInteraction(
  world: World,
  source: number,
  target: number,
  data: InteractionUpdateData
) {
  const relation = Interaction(target);
  if (data.type) relation.type[source] = data.type;
  if (data.strength) relation.strength[source] = data.strength;
  if (data.lastUpdate) relation.lastUpdate[source] = data.lastUpdate;
  if (data.metadata) relation.metadata[source] = data.metadata;
}

// Room occupancy helpers
export function moveToRoom(world: World, agentId: number, roomId: number) {
  addComponent(world, agentId, OccupiesRoom(roomId));
}

export function leaveRoom(world: World, agentId: number, roomId: number) {
  removeComponent(world, agentId, OccupiesRoom(roomId));
}

export function isInRoom(
  world: World,
  agentId: number,
  roomId: number
): boolean {
  return hasComponent(world, agentId, OccupiesRoom(roomId));
}

// Interaction helpers
export function createInteraction(
  world: World,
  source: number,
  target: number,
  type: string,
  strength = 1
) {
  addComponent(world, source, Interaction(target));
  updateInteraction(world, source, target, {
    type,
    strength,
    lastUpdate: Date.now(),
  });
}

export function removeInteraction(
  world: World,
  source: number,
  target: number
) {
  removeComponent(world, source, Interaction(target));
}

export function hasInteraction(
  world: World,
  source: number,
  target: number
): boolean {
  return hasComponent(world, source, Interaction(target));
}
