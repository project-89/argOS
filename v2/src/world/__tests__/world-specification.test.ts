import { describe, expect, test } from "@jest/globals";
import { createWorld } from "bitecs";
import { getWorldAuthoringContext, getWorldCharacterSeed, getWorldGenesisContext, getWorldSpecification,
  getWorldTheme, parseWorldSpecification, setWorldSpecification } from "../world-specification";
import { applyRuntimeProfile } from "../../runtime/runtime-profile";

const brief = () => ({ version: 1 as const,
  setting: { name: "Tidehaven", genre: "coastal mystery", premise: "A vanished keeper divides a fishing community.", tone: "uneasy warmth" },
  story: { style: "Clues and ordinary lives, not compulsory reactions.", tensions: ["The lighthouse is dark."] },
  inhabitants: [{ name: "Esme", role: "net mender", systemPrompt: "PRIVATE_ROLE_INSTRUCTION",
    past: { background: "PRIVATE_BACKGROUND", drives: ["Protect my brother"],
      memories: [{ recollection: "PRIVATE_MEMORY: I saw my brother hide the key.", cues: ["key"],
        emotionalTone: "unease", importance: .8, selfBelief: "I notice small things", meaning: "I should ask why", period: "last winter" }] } }],
  opportunities: ["A boat that can actually reach the lighthouse"], discovery: ["Clues require observation"], constraints: ["No medieval magic"] });

describe("world-local authoring specification", () => {
  test("builder projection is genre-specific without private cast data or execution permission", () => {
    const world = createWorld(); setWorldSpecification(world, brief());
    const prompt = getWorldAuthoringContext(world);
    expect(prompt).toContain("coastal mystery"); expect(prompt).toContain("actually reach");
    expect(prompt).toContain("not observed facts or permission");
    expect(prompt).not.toContain("PRIVATE_"); expect(prompt).not.toContain("Esme");
    expect(getWorldGenesisContext(world)).toContain("PRIVATE_MEMORY");
    expect(getWorldTheme(world)).toBe("coastal mystery; uneasy warmth");
  });
  test("input, result and character seed mutations cannot rewrite the installed brief", () => {
    const world = createWorld(), input = brief(); setWorldSpecification(world, input);
    input.setting.genre = "mutated";
    getWorldSpecification(world)!.inhabitants[0].past!.background = "mutated";
    getWorldCharacterSeed(world, "esme")!.past!.memories[0].recollection = "mutated";
    expect(getWorldTheme(world)).toContain("coastal mystery");
    expect(getWorldGenesisContext(world)).toContain("PRIVATE_BACKGROUND");
    expect(getWorldGenesisContext(world)).toContain("PRIVATE_MEMORY");
    expect(getWorldCharacterSeed(world, "different person")).toBeUndefined();
  });
  test("different worlds stay separate and only identical reinstallation is allowed", () => {
    const first = createWorld(), second = createWorld(); setWorldSpecification(first, brief());
    expect(getWorldAuthoringContext(second)).toBe("");
    expect(getWorldGenesisContext(second)).toBe(""); expect(getWorldTheme(second)).toBeUndefined();
    expect(() => setWorldSpecification(first, brief())).not.toThrow();
    const other = brief(); other.setting.genre = "orbital survival";
    setWorldSpecification(second, other);
    expect(() => setWorldSpecification(first, other)).toThrow("immutable");
    expect(getWorldAuthoringContext(first)).not.toContain("orbital survival");
  });
  test("strict versioned data rejects authority fields, ambiguous cast and unbounded text", () => {
    expect(() => parseWorldSpecification({ ...brief(), codingDaemons: true })).toThrow();
    expect(() => parseWorldSpecification({ ...brief(), runtime: { evolution: true } })).toThrow();
    expect(() => parseWorldSpecification({ ...brief(), version: 2 })).toThrow();
    expect(() => parseWorldSpecification({ ...brief(), inhabitants: [brief().inhabitants[0], { name: " ESME ", role: "impostor" }] })).toThrow("unique");
    expect(() => parseWorldSpecification({ ...brief(), constraints: ["x".repeat(801)] })).toThrow();
  });
});

describe("host-owned embodied runtime profile", () => {
  test("selects proven service configuration without enabling autonomous mutation", () => {
    const config = applyRuntimeProfile({ name: "test", worldSpecification: brief() });
    expect(config).toMatchObject({ runtimeProfile: "embodied-v1", ecsTickRate: 10, ecsDeltaMs: 100,
      narrativeMind: true, experienceReconsideration: true, enablePlanning: true, enableReflection: true,
      evolution: false, codingDaemons: false, godAutopilot: false, hostOfficeTools: false, maxWorldEntities: 200 });
    expect(config.cognitionController).toBeUndefined(); // Existing controller/default, not a replacement.
  });
  test("legacy callers remain untouched, undefined cannot erase safe defaults, cadence stays 1:1", () => {
    const legacy = { name: "legacy" }; expect(applyRuntimeProfile(legacy)).toBe(legacy);
    const config = applyRuntimeProfile({ name: "test", runtimeProfile: "embodied-v1", codingDaemons: undefined, ecsTickRate: 20, narrativeMind: false });
    expect(config.codingDaemons).toBe(false); expect(config.ecsDeltaMs).toBe(50); expect(config.narrativeMind).toBe(false);
  });
  test("explicit coding authority requires a finite host budget", () => {
    expect(() => applyRuntimeProfile({ name: "test", runtimeProfile: "embodied-v1", codingDaemons: true })).toThrow("maxTotalJobs");
    expect(() => applyRuntimeProfile({ name: "test", runtimeProfile: "embodied-v1", codingDaemons: {} })).toThrow("maxTotalJobs");
    expect(applyRuntimeProfile({ name: "test", runtimeProfile: "embodied-v1", codingDaemons: { maxTotalJobs: 1 } }).codingDaemons).toEqual({ maxTotalJobs: 1 });
  });
  test("unknown profiles fail rather than silently selecting one", () => {
    expect(() => applyRuntimeProfile({ name: "test", runtimeProfile: "unknown" as any })).toThrow("Unknown runtime profile");
  });
});
