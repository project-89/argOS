import type { SitcomOptions } from "./apartment-sitcom";

/** Interactive defaults only. Authored/evaluation fixtures retain their defaults. */
export function sitcomLaunchProfile(args: readonly string[]): SitcomOptions {
  const project89 = args.includes("--project89");
  const focused = args.includes("--focused") || project89, legacy = args.includes("--legacy-profile");
  return {
    live: true, scenario: project89 ? "project89" : focused ? "duet" : "cookie", outsideTextAtMs: null,
    cognitionController: "priority",
    narrativeMind: !legacy || focused || args.includes("--narrative-mind"),
    experienceReconsideration: !legacy || focused || args.includes("--reconsideration"),
    cookieHistory: !focused && !legacy ? "david" : "legacy",
    ...(project89 && args.includes("--formative-history") ? { project89History: "formative" as const } : {}),
    openNeighborhood: !legacy || focused,
    worldMaintenance: (!legacy || focused) && !args.includes("--core-only"),
    // This interactive wiring pass is not authority for open-ended code jobs.
    // An enabled managed daemon with zero admissions cannot fall back to legacy
    // unisolated generation. Entity/place authoring remains independently useful.
    growthLimits: { maxWorldEntities: 32, maxBuildJobs: 0 },
  };
}
