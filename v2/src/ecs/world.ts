import {
  createWorld,
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
    /** Simulation hour (0-23), progressed by TimeProgression system */
    simulationHour: number;
    /** Time of day: "dawn" | "morning" | "midday" | "afternoon" | "evening" | "night" */
    timeOfDay: string;
    /** Total simulation days elapsed */
    simulationDay: number;
  };
  meta: {
    name: string;
    createdAt: number;
    /** Whether LLM-powered features are enabled for this simulation */
    aiEnabled?: boolean;
    /** Whether schedules should be LLM-generated (vs. deterministic defaults) */
    generateSchedules?: boolean;
  };
}

export function createArgosWorld(name: string = "ArgOS World"): WorldContext {
  const context: WorldContext = {
    time: {
      tick: 0,
      delta: 0,
      elapsed: 0,
      simulationHour: 8,     // Start at 8am
      timeOfDay: "morning",
      simulationDay: 1,
    },
    meta: {
      name,
      createdAt: Date.now(),
      aiEnabled: false,
      generateSchedules: false,
    },
  };
  // NOTE: Avoid entity-id versioning here; the project uses sparse JS arrays keyed by EID,
  // and bitecs 0.4's versioning mode can produce unstable entityExists/addComponent behavior
  // under heavy churn (many create/remove cycles).
  return createWorld(context);
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
