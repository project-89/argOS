import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { CodingDaemonConfig } from "../engineering/coding-daemon";

/** A new demo episode is not recovery of a previous coding release. The daemon
 * deliberately restores jobs/releases when given an existing directory, so
 * allocate a fresh namespace for independent episodes. No files are removed. */
export function createEpisodeBuildConfig(enabled: boolean, options: { maxTotalJobs?: number } = {}): CodingDaemonConfig | false {
  if (options.maxTotalJobs !== undefined && (!Number.isSafeInteger(options.maxTotalJobs) || options.maxTotalJobs < 0))
    throw new Error("Episode build admission limit must be a non-negative safe integer");
  return enabled ? { directory: resolve("data/live-builds", `episode-${randomUUID()}`), ...options } : false;
}

export type EpisodeGrowthLimits = { maxWorldEntities: number; maxBuildJobs: number };
/** Evaluation-only bounds. Ordinary library/UI worlds remain explicitly opt-in. */
export function parseEpisodeGrowthLimits(required: boolean, worldLimit: string, buildLimit: string): EpisodeGrowthLimits | undefined {
  if (!required && !worldLimit && !buildLimit) return;
  const maxWorldEntities = Number(worldLimit), maxBuildJobs = Number(buildLimit);
  if (!worldLimit.trim() || !buildLimit.trim() || !Number.isSafeInteger(maxWorldEntities) || maxWorldEntities < 0 || maxWorldEntities > 200
    || !Number.isSafeInteger(maxBuildJobs) || maxBuildJobs < 0 || maxBuildJobs > 8)
    throw new Error("Growth evaluations require explicit --max-world-entities=0..200 and --max-build-jobs=0..8");
  return { maxWorldEntities, maxBuildJobs };
}
