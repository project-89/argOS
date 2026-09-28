import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createSimulation } = await import("../../index");
const { createObjectEntity } = await import("../../ecs/prefabs");
const { Traits } = await import("../../ecs/components");
const { godThink } = await import("../../god/god-agent");
const { getWorldRuntimeHealth } = await import("../fast-system-health");
const { gatherArchitectContext, identifyNeeds, validateObservedNeeds } = await import("../../spirits/architect-spirit");
const { runArtificerWithTools } = await import("../../spirits/artificer-spirit");
const { createDynamicSpirit, resetFactoryState } = await import("../../spirits/spirit-factory");
const { createSpiritRegistry } = await import("../../spirits/spirit-registry");
const { stopTaskQueue } = await import("../async-task-queue");

beforeEach(() => {
  jest.useFakeTimers();
  generate.mockReset();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network in runtime regression"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  stopTaskQueue(); resetFactoryState();
  jest.useRealTimers(); jest.restoreAllMocks();
});

test("actual library RulesEngine failure reaches runtime status and each supervisor's real input; recovery retains its history", async () => {
  const sim = await createSimulation({ name: "Outer health integration", preset: "minimal", enableAI: false,
    enableSpirits: false, evolution: false, codingDaemons: false, godAutopilot: false,
    enableNarrativeEngine: false, enableServer: false, dualLoop: true, ecsTickRate: 10 });
  try {
    const object = createObjectEntity(sim.world, { name: "Legacy malformed record", traits: ["readable"] });
    const validTraits = Traits.active[object];
    // Deliberately bypass repaired author validation: old or raw-native state
    // can still be corrupt. Exercise the actual production RulesEngine path.
    Traits.active[object] = "readable,examinable";
    await sim.start();
    await jest.advanceTimersByTimeAsync(300);
    expect(generate).not.toHaveBeenCalled();
    const failure = sim.getRuntimeStatus()!.fastSystemHealth;
    expect(failure).toMatchObject({ totalFailures: 3, failingSystems: 1 });
    expect(failure.systems[0]).toMatchObject({ name: "WorldTick", lastErrorKind: "SyntaxError", consecutiveFailures: 3 });
    expect(sim.getSystemHealth().filter(system => system.totalErrors > 0)).toEqual([]);
    expect(sim.getState()).toContain('"failingSystems":1');

    const spirits = createSpiritRegistry(sim.world);
    const architect = createDynamicSpirit(spirits, { name: "Health Weaver", type: "architect", rank: "archangel", domain: "ecology" })!;
    const context = await gatherArchitectContext(sim.world, sim.god.systemRegistry);
    generate.mockImplementation(async input => {
      expect(input.prompt).toContain("NATIVE FAST-LOOP HEALTH");
      expect(input.prompt).toContain('"failingSystems":1');
      expect(input.prompt).not.toContain("readable,examinable");
      return { text: "[]" };
    });
    expect(await identifyNeeds(architect, context)).toEqual([]);
    expect(generate).toHaveBeenCalledTimes(1);

    // A diagnostic runtime ID does not become a native proposal evidence grant.
    expect(validateObservedNeeds([{ type: "system", description: "Replace WorldTick", priority: "high",
      rationale: "It failed", evidence: [failure.runtimeId], expectedChange: "New controller" }], context)).toEqual([]);

    generate.mockImplementation(async input => {
      expect(input.system).toContain('"failingSystems":1');
      expect(input.system).not.toContain("readable,examinable");
      const report = await input.tools.getRuntimeHealth.execute({}, {});
      expect(report).toMatchObject({ success: true, result: { requiresRuntimeReview: true, failingSystems: 1 } });
      const brief = await input.tools.getWorldSummary.execute({ includeDetails: false }, {});
      expect(brief.result.runtimeHealth).toMatchObject({ requiresRuntimeReview: true });
      return { text: "An outer callback failed; inspect operator diagnostics before any repair.", steps: [{ toolCalls: [], toolResults: [] }] };
    });
    await godThink(sim.god, "Inspect runtime health without changing the world.");
    expect(generate).toHaveBeenCalledTimes(2);

    const artificer = createDynamicSpirit(spirits, { name: "Health Tinkerer", type: "artificer", rank: "angel", domain: "ecology", superiorEid: architect.eid })!;
    generate.mockImplementation(async input => {
      expect(input.system).toContain('"failingSystems":1');
      expect(input.system).toContain("separate from generated-system health");
      expect(input.system).not.toContain("readable,examinable");
      return { text: "Report the native failure; no registered-system replacement.", toolResults: [] };
    });
    const report = await runArtificerWithTools(sim.world, sim.god.systemRegistry, spirits, artificer);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(report.repairsAttempted).toEqual([]);

    Traits.active[object] = validTraits; // Explicit fixture repair, never a runtime fallback.
    await jest.advanceTimersByTimeAsync(100);
    expect(sim.getRuntimeStatus()!.fastSystemHealth).toMatchObject({ status: "passing", totalFailures: 3, failingSystems: 0 });
    expect(getWorldRuntimeHealth(sim.world).requiresRuntimeReview).toBe(false);
  } finally { sim.stop(); }
});
