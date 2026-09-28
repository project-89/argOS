import { describe, expect, test } from "@jest/globals";
import type { PreparedRelease } from "../../engineering/release";
import { assertSpatialDevelopmentRelease, isSpatialDevelopmentComponent, SPATIAL_DEVELOPMENT_INPUT,
  SPATIAL_DEVELOPMENT_LIMITS, SPATIAL_DEVELOPMENT_BUILDER_CONTEXT, permitsSpatialDevelopmentValue } from "../spatial-development-policy";

function candidate(): PreparedRelease {
  return { manifest: { version: 1, components: ["components/SpatialDevMoisture.json"], tests: [], systems: [{
    name: "SpatialDevMoistureCycle", description: "Rain changes a public physical moisture value", file: "systems/SpatialDevMoistureCycle.ts",
    frequency: 10, reads: [SPATIAL_DEVELOPMENT_INPUT, "SpatialDevMoisture"], writes: ["SpatialDevMoisture.level"],
  }] }, components: [{ name: "SpatialDevMoisture", description: "Physical moisture", fields: { level: { type: "number", default: 0 } } }],
  sources: new Map(), scripts: new Map(), digest: "0".repeat(64), testsPassed: 2 };
}
describe("spatial development release policy", () => {
  test.each([0, -1_000_000, 1_000_000, true, false])("accepts bounded runtime scalar %s", value => {
    expect(permitsSpatialDevelopmentValue("SpatialDevMoisture", "value", value)).toBe(true);
  });
  test.each([Infinity, NaN, 1_000_001, -1_000_001, "rain", null, undefined, {}])("rejects invalid runtime scalar %s", value => {
    expect(permitsSpatialDevelopmentValue("SpatialDevMoisture", "value", value)).toBe(false);
  });
  test("allows different physical mechanics rather than one named canary, with explicit field owners", () => {
    const release = candidate();
    release.components.push({ name: "SpatialDevGrowth", description: "Plant development", fields: {
      maturity: { type: "number", default: 0 }, dormant: { type: "boolean", default: false },
    } });
    release.manifest.systems.push({ name: "SpatialDevPlantCycle", description: "Growth responds to moisture", file: "systems/SpatialDevPlantCycle.ts",
      frequency: 50, reads: [SPATIAL_DEVELOPMENT_INPUT, "SpatialDevMoisture", "SpatialDevGrowth"], writes: ["SpatialDevGrowth.maturity", "SpatialDevGrowth.dormant"] });
    expect(() => assertSpatialDevelopmentRelease(release)).not.toThrow();
    expect(SPATIAL_DEVELOPMENT_LIMITS).toMatchObject({ maxTotalJobs: 8, maxQueue: 2 });
    expect(SPATIAL_DEVELOPMENT_BUILDER_CONTEXT).toContain("do not automatically create");
  });
  test.each(["Mind", "Memory", "Agent", "Needs", "Position", "Inventory", "Description", "Name", "SpatialWeather"])("forbids %s reads despite some being public", name => {
    const release = candidate(); release.manifest.systems[0].reads.push(name);
    expect(() => assertSpatialDevelopmentRelease(release)).toThrow(/reads/);
  });
  test.each(["Position.x", "ObjectState.current", "Needs.hunger", `${SPATIAL_DEVELOPMENT_INPUT}.eligible`, "SpatialDevUndeclared.value"])("forbids unowned write %s", field => {
    const release = candidate(); release.manifest.systems[0].writes.push(field);
    expect(() => assertSpatialDevelopmentRelease(release)).toThrow(/writes/);
  });
  test("cannot redeclare inputs, declare narrative strings, or export unowned extra fields", () => {
    const input = candidate(); input.components[0].name = SPATIAL_DEVELOPMENT_INPUT;
    expect(() => assertSpatialDevelopmentRelease(input)).toThrow(/namespace/);
    const prose = candidate(); prose.components[0].fields.detail = { type: "string", default: "They feel scared" };
    expect(() => assertSpatialDevelopmentRelease(prose)).toThrow(/generated prose/);
    const unused = candidate(); unused.components[0].fields.extra = { type: "number", default: 0 };
    expect(() => assertSpatialDevelopmentRelease(unused)).toThrow(/exactly one/);
    const overlap = candidate(); overlap.manifest.systems.push({ ...overlap.manifest.systems[0], name: "SpatialDevOther" });
    expect(() => assertSpatialDevelopmentRelease(overlap)).toThrow(/exactly one/);
  });
  test.each([0, 9, 601, Infinity, 10.5])("rejects invalid or excessive cadence %s", frequency => {
    const release = candidate(); release.manifest.systems[0].frequency = frequency;
    expect(() => assertSpatialDevelopmentRelease(release)).toThrow(/cadence/);
  });
  test.each([Infinity, NaN, 1_000_001, -1_000_001])("rejects unbounded numeric default %s", value => {
    const release = candidate(); release.components[0].fields.level.default = value;
    expect(() => assertSpatialDevelopmentRelease(release)).toThrow(/bounded numeric/);
  });
  test("bounds systems, components and fields independently", () => {
    const systems = candidate(); systems.manifest.systems = Array.from({ length: 4 }, (_, index) => ({ ...systems.manifest.systems[0], name: `SpatialDevCycle${index}` }));
    expect(() => assertSpatialDevelopmentRelease(systems)).toThrow(/count/);
    const components = candidate(); components.components = Array.from({ length: 5 }, (_, index) => ({ ...components.components[0], name: `SpatialDevValue${index}` }));
    expect(() => assertSpatialDevelopmentRelease(components)).toThrow(/count/);
    const fields = candidate(); fields.components[0].fields = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`value${index}`, { type: "number", default: 0 }]));
    expect(() => assertSpatialDevelopmentRelease(fields)).toThrow(/field count/);
    expect(isSpatialDevelopmentComponent(SPATIAL_DEVELOPMENT_INPUT)).toBe(false);
    expect(isSpatialDevelopmentComponent("SpatialDev")).toBe(false);
  });
  test("every system must declare host inputs even if it consumes another generated output", () => {
    const release = candidate(); release.manifest.systems[0].reads = ["SpatialDevMoisture"];
    expect(() => assertSpatialDevelopmentRelease(release)).toThrow(/reads/);
  });
  test("a matching namespace is not permission to read another component; admitted mechanisms may compose", () => {
    const release = candidate(); release.manifest.systems[0].reads.push("SpatialDevTemperature");
    expect(() => assertSpatialDevelopmentRelease(release)).toThrow(/host-admitted/);
    expect(() => assertSpatialDevelopmentRelease(release, new Set(["SpatialDevTemperature"]))).not.toThrow();
    release.manifest.systems[0].reads.push("Mind");
    expect(() => assertSpatialDevelopmentRelease(release, new Set(["SpatialDevTemperature", "Mind"]))).toThrow(/reads/);
  });
});
