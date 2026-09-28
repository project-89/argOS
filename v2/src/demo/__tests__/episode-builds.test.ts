import { isAbsolute, dirname } from "node:path";
import { createEpisodeBuildConfig, parseEpisodeGrowthLimits } from "../episode-builds";

describe("independent episode build namespaces", () => {
  it("does not enable a daemon in core-only/offline episodes", () => {
    expect(createEpisodeBuildConfig(false)).toBe(false);
  });
  it("preserves a caller's lifetime job limit, including zero", () => {
    expect(createEpisodeBuildConfig(true, { maxTotalJobs: 0 })).toMatchObject({ maxTotalJobs: 0 });
    expect(createEpisodeBuildConfig(true, { maxTotalJobs: 2 })).toMatchObject({ maxTotalJobs: 2 });
    expect(createEpisodeBuildConfig(false, { maxTotalJobs: 2 })).toBe(false);
  });
  it.each([-1, 0.5, Infinity, NaN])("rejects invalid job limit %s", maxTotalJobs => {
    expect(() => createEpisodeBuildConfig(true, { maxTotalJobs })).toThrow(/safe integer/);
  });
  it("requires explicit bounds in growth evaluations without changing core-only defaults", () => {
    expect(parseEpisodeGrowthLimits(false, "", "")).toBeUndefined();
    expect(() => parseEpisodeGrowthLimits(true, "", "")).toThrow(/explicit/);
    expect(parseEpisodeGrowthLimits(true, "80", "2")).toEqual({ maxWorldEntities: 80, maxBuildJobs: 2 });
    expect(parseEpisodeGrowthLimits(false, "0", "0")).toEqual({ maxWorldEntities: 0, maxBuildJobs: 0 });
  });
  it.each([["", "2"], ["80", ""], ["201", "2"], ["80", "9"], ["-1", "2"], ["2.5", "1"], ["NaN", "1"]])("rejects invalid evaluation limits %s/%s", (world, jobs) => {
    expect(() => parseEpisodeGrowthLimits(true, world, jobs)).toThrow(/explicit/);
  });
  it("gives each fresh episode a separate absolute directory without mutating the previous one", () => {
    const one = createEpisodeBuildConfig(true), two = createEpisodeBuildConfig(true);
    if (!one || !two) throw new Error("Expected enabled coding config");
    const original = one.directory;
    expect(isAbsolute(one.directory!)).toBe(true);
    expect(one.directory).not.toBe(two.directory);
    expect(dirname(one.directory!)).toBe(dirname(two.directory!));
    expect(one.directory).toBe(original);
  });
});
