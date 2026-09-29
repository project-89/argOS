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
    /** Committed simulation step; independent of wall-clock time. */
    tick: number;
    /** In-world milliseconds advanced by the latest step. */
    delta: number;
    /** Monotonic elapsed in-world milliseconds. */
    elapsed: number;
    /** Fractional simulation hour [0, 24), advanced by the authoritative clock. */
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
    /** Opt-in high-level decision policy; execution constraints are shared. */
    cognitionController?: "priority" | "situated";
    /** Experimental receipt-driven revision of personal intentions. */
    experienceReconsideration?: boolean;
    experienceAppraisalEnabled?: boolean;
    narrativeMind?: boolean;
    /** How often a running conversation must justify itself. "relaxed" (default)
     * lets lively exchanges run; "strict" restores the earlier every-few-turns check. */
    activityReviewCadence?: "relaxed" | "strict";
    /** Speaking distance in metres for worlds with positions (spatial towns). Unset: room-wide hearing. */
    speechEarshotMetres?: number;
    /** Answer direct address with a lean conversational decision (spatial towns). */
    fastReplies?: boolean;
    /** Whether schedules should be LLM-generated (vs. deterministic defaults) */
    generateSchedules?: boolean;
    /** Model utterances as finite in-world actions (enabled by the library). */
    timedSpeech?: boolean;
    /** Give otherwise atomic native and package physical actions world-time durations. */
    timedActions?: boolean;
    /** Legacy timestamp migration baseline; never an execution/evidence clock. */
    temporalBaseline?: { wallAtMs: number; simAtMs: number };
  };
}

let isolatedWorldCreated = false;
export function createArgosWorld(name: string = "ArgOS World"): WorldContext {
  if (process.env.ARGOS_PROCESS_WORLD_HOST === "1") {
    if (isolatedWorldCreated) throw new Error("An isolated worker supports one world; construct another process host instead");
    isolatedWorldCreated = true;
  }
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
