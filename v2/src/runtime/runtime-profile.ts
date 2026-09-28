import type { SimulationConfig } from "../index";

/** Host configuration only: never loaded from world authoring or a snapshot.
 * Same fast/slow cognition split used by the spatial testbed. Autonomous
 * mutation remains off until the caller supplies its existing scoped grants. */
export const EMBODIED_RUNTIME_PROFILE = Object.freeze({
  dualLoop: true, ecsTickRate: 10, ecsDeltaMs: 100,
  timedSpeech: true, timedActions: true,
  narrativeMind: true, experienceReconsideration: true,
  enablePlanning: true, enableReflection: true, enableExperienceAppraisal: true,
  enableSpirits: true, enableNarrativeEngine: true,
  evolution: false, codingDaemons: false, godAutopilot: false,
  hostOfficeTools: false, autoPopulateRooms: false, maxWorldEntities: 200,
} as const);

export function applyRuntimeProfile(config: SimulationConfig): SimulationConfig {
  if (config.runtimeProfile !== undefined && config.runtimeProfile !== "embodied-v1") throw new Error("Unknown runtime profile");
  // A specification opts into a known profile rather than legacy implicit
  // evolution/coding defaults. Explicit host options still take precedence.
  if (!config.runtimeProfile && !config.worldSpecification && !config.restoreSnapshot?.worldSpecification) return config;
  const overrides = Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined));
  const result = { ...EMBODIED_RUNTIME_PROFILE, ...overrides, runtimeProfile: "embodied-v1" } as SimulationConfig;
  // Restored construction counters already carry their original finite limit.
  // A fresh-world default must not replace it or invent missing history.
  if (config.restoreSnapshot && config.maxWorldEntities === undefined) delete result.maxWorldEntities;
  // Changing cadence without a delta retains 1:1 simulated time by default.
  if (config.ecsTickRate !== undefined && config.ecsDeltaMs === undefined) result.ecsDeltaMs = 1000 / config.ecsTickRate;
  if (result.codingDaemons === true || (result.codingDaemons && typeof result.codingDaemons === "object"
    && (!Number.isSafeInteger(result.codingDaemons.maxTotalJobs) || result.codingDaemons.maxTotalJobs! < 0)))
    throw new Error("The embodied runtime profile requires an explicit finite codingDaemons.maxTotalJobs budget");
  return result;
}
