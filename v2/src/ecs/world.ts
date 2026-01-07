import {
  createWorld,
  createEntityIndex,
  withVersioning,
  addEntity,
  removeEntity,
  entityExists,
  query,
  addComponent,
  removeComponent,
  hasComponent,
  getRelationTargets,
  addPrefab,
  IsA,
  observe,
  onAdd,
  onRemove,
  onSet,
  onGet,
  set,
  Wildcard,
  Hierarchy,
} from "bitecs";

export interface WorldContext {
  time: {
    tick: number;
    delta: number;
    elapsed: number;
  };
  meta: {
    name: string;
    createdAt: number;
  };
}

export function createArgosWorld(name: string = "ArgOS World"): WorldContext {
  const entityIndex = createEntityIndex(withVersioning(12));
  const context: WorldContext = {
    time: {
      tick: 0,
      delta: 0,
      elapsed: 0,
    },
    meta: {
      name,
      createdAt: Date.now(),
    },
  };
  return createWorld(context, entityIndex);
}

export {
  addEntity,
  removeEntity,
  entityExists,
  query,
  addComponent,
  removeComponent,
  hasComponent,
  getRelationTargets,
  addPrefab,
  IsA,
  observe,
  onAdd,
  onRemove,
  onSet,
  onGet,
  set,
  Wildcard,
  Hierarchy,
};

export type World = WorldContext;
