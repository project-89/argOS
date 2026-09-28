import type { BreakupCondition } from "../demo/sitcom-breakup-evaluation";
import type { EscapePerturbationStage } from "../demo/escape-room";
export type BaselineTrial = { id: string; world: "social"; seconds: 180; condition: BreakupCondition; drainFirstPour?: true }
  | { id: string; world: "puzzle"; seconds: 300; seed: number; perturbAfter?: EscapePerturbationStage };
export const BASELINE_TRIALS: readonly BaselineTrial[] = Object.freeze([
  { id: "S1", world: "social", seconds: 180, condition: "logistics" },
  { id: "S2", world: "social", seconds: 180, condition: "breakup" },
  { id: "S3", world: "social", seconds: 180, condition: "writing" },
  { id: "S4", world: "social", seconds: 180, condition: "handoff" },
  { id: "S5", world: "social", seconds: 180, condition: "coffee", drainFirstPour: true },
  { id: "P1", world: "puzzle", seconds: 300, seed: 11 },
  { id: "P2", world: "puzzle", seconds: 300, seed: 23 },
  { id: "P3", world: "puzzle", seconds: 300, seed: 37 },
  { id: "P4", world: "puzzle", seconds: 300, seed: 41, perturbAfter: "exit_code_read" },
  { id: "P5", world: "puzzle", seconds: 300, seed: 53, perturbAfter: "exit_unlock_started" },
]);
export const BASELINE_CONFIG = Object.freeze({ controller: "priority", narrativeMind: true, experienceReconsideration: true,
  planning: true, reflection: true, model: "gemini-3.8-flash", ecsTickRate: 2, ecsDeltaMs: 500, timeScale: 1,
  modelTransport: "google-http1", h3: false, worldMaintenance: false, hostOfficeTools: false, operatorActorActions: false });
