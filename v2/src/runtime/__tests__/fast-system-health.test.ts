import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { createSystemRegistry, getAllSystemHealth, registerSystem, runSystems } from "../../ecs/dynamic-systems";
import { createSimulation, getSimulationStats, pauseSimulation, resumeSimulation, registerFastSystem, startSimulation, stopSimulation, type SimulationState } from "../simulation-loop";
import { stopTaskQueue } from "../async-task-queue";
import { formatWorldRuntimeHealth, getWorldRuntimeHealth } from "../fast-system-health";
import { getCommittedEvents, startCommittedEvents, stopCommittedEvents } from "../committed-events";
import { getWorldSummary, getWorldSummaryText, createObservationState, runObservation } from "../../god/monitoring-system";
import { createWatcherTools } from "../../spirits/spirit-tools";
import { gatherArchitectContext } from "../../spirits/architect-spirit";
import { createGodAgent, getWorldState } from "../../god/god-agent";
import { initializePrefabs } from "../../ecs/prefabs";
import { initializeRegistry } from "../../ecs/component-registry";

describe("outer runtime execution health", () => {
  const runtimes: SimulationState[] = [];
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    runtimes.splice(0).forEach(stopSimulation);
    stopTaskQueue();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  function runtime(world = createArgosWorld("Fast health")) {
    const state = createSimulation(world, createSystemRegistry(), {} as any,
      { ecsTickRate: 10, logTickStats: false });
    runtimes.push(state);
    return state;
  }

  test("112 cheap failed WorldTicks are visible even while independent callbacks and the clock continue", async () => {
    const state = runtime(), independent = jest.fn();
    registerFastSystem(state, { name: "WorldTick", execute: () => { throw new SyntaxError("Invalid generated traits"); } });
    registerFastSystem(state, { name: "Independent", execute: independent });
    startSimulation(state);
    await jest.advanceTimersByTimeAsync(11_200);
    expect(state.tick).toBe(112);
    expect(independent).toHaveBeenCalledTimes(112);
    expect(state.systemRegistry.systems.size).toBe(0);
    const stats = getSimulationStats(state);
    expect(stats.slowTicks).toBe(0);
    expect(stats.fastSystemHealth).toMatchObject({ totalFailures: 112, failingSystems: 1,
      systems: expect.arrayContaining([expect.objectContaining({ name: "WorldTick", attempts: 112,
        successes: 0, failures: 112, consecutiveFailures: 112, status: "failing", lastFailureTick: 112 })]) });
  });

  test("recovery clears the active failure streak, not the earlier failure evidence", async () => {
    const state = runtime(); let fail = true;
    registerFastSystem(state, { name: "WorldTick", execute: () => { if (fail) throw new TypeError("PRIVATE_PAYLOAD"); } });
    startSimulation(state);
    await jest.advanceTimersByTimeAsync(200);
    expect(getWorldRuntimeHealth(state.world).requiresRuntimeReview).toBe(true);
    fail = false;
    await jest.advanceTimersByTimeAsync(100);
    const health = getSimulationStats(state).fastSystemHealth;
    expect(health).toMatchObject({ status: "passing", totalFailures: 2, failingSystems: 0 });
    expect(health.systems[0]).toMatchObject({ attempts: 3, successes: 1, failures: 2, consecutiveFailures: 0,
      lastSuccessTick: 3, lastFailureTick: 2, lastFailureSimMs: 200, lastErrorKind: "TypeError" });
    expect(JSON.stringify(health)).not.toContain("PRIVATE_PAYLOAD");
    expect(getWorldRuntimeHealth(state.world).requiresRuntimeReview).toBe(false);
    const copy = getWorldRuntimeHealth(state.world); copy.runtimes[0].systems[0].failures = 999;
    expect(getSimulationStats(state).fastSystemHealth.totalFailures).toBe(2);
  });

  test("frequency-skipped and paused callbacks are not claimed as new successes", async () => {
    const state = runtime();
    registerFastSystem(state, { name: "Occasional", frequency: 3, execute: () => { throw new Error("failure"); } });
    expect(getSimulationStats(state).fastSystemHealth).toMatchObject({ lifecycle: "created", status: "unobserved" });
    startSimulation(state);
    await jest.advanceTimersByTimeAsync(200);
    expect(getSimulationStats(state).fastSystemHealth.systems[0]).toMatchObject({ attempts: 0, status: "unobserved" });
    await jest.advanceTimersByTimeAsync(100);
    pauseSimulation(state);
    await jest.advanceTimersByTimeAsync(1000);
    expect(getSimulationStats(state).fastSystemHealth).toMatchObject({ lifecycle: "paused", totalFailures: 1 });
    resumeSimulation(state);
    await jest.advanceTimersByTimeAsync(200);
    expect(getSimulationStats(state).fastSystemHealth.systems[0]).toMatchObject({ attempts: 1, failures: 1, status: "failing" });
  });

  test("same callback names have separate native registration identities", async () => {
    const state = runtime();
    registerFastSystem(state, { name: "Duplicate", execute: () => {} });
    registerFastSystem(state, { name: "Duplicate", execute: () => { throw null; } });
    startSimulation(state);
    await jest.advanceTimersByTimeAsync(100);
    const health = getSimulationStats(state).fastSystemHealth;
    expect(new Set(health.systems.map(system => system.id)).size).toBe(2);
    expect(health.systems).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "passing", successes: 1 }),
      expect.objectContaining({ status: "failing", failures: 1, lastErrorKind: "ThrownValue" }),
    ]));
  });

  test("stopped sources and restarts preserve old-run failures without attributing them to the new run", async () => {
    const state = runtime(); const source = startCommittedEvents(state.world); let fail = true;
    registerFastSystem(state, { name: "WorldTick", execute: () => { if (fail) throw new Error("old run"); } });
    startSimulation(state);
    await jest.advanceTimersByTimeAsync(100);
    stopCommittedEvents(state.world);
    expect(getWorldRuntimeHealth(state.world)).toMatchObject({ status: "unobserved", sourceStopped: true,
      staleActiveRuntimes: 1, requiresRuntimeReview: true });
    stopSimulation(state);
    expect(getWorldRuntimeHealth(state.world)).toMatchObject({ status: "unobserved", requiresRuntimeReview: false });
    expect(getSimulationStats(state).fastSystemHealth).toMatchObject({ sourceCurrent: false, lifecycle: "stopped", totalFailures: 1 });
    const nextSource = startCommittedEvents(state.world); expect(nextSource).not.toBe(source);
    startSimulation(state); fail = false;
    expect(getSimulationStats(state).fastSystemHealth).toMatchObject({ run: 2, sourceId: nextSource,
      status: "unobserved", totalFailures: 0 });
    await jest.advanceTimersByTimeAsync(100);
    const report = getWorldRuntimeHealth(state.world);
    expect(report).toMatchObject({ status: "passing", requiresRuntimeReview: false });
    expect(report.runtimes).toEqual(expect.arrayContaining([
      expect.objectContaining({ run: 1, sourceId: source, sourceCurrent: false, lifecycle: "stopped", totalFailures: 1 }),
      expect.objectContaining({ run: 2, sourceId: nextSource, sourceCurrent: true, lifecycle: "running", totalFailures: 0 }),
    ]));
    report.runtimes.find(run => run.run === 1)!.systems[0].failures = 999;
    expect(getWorldRuntimeHealth(state.world).runtimes.find(run => run.run === 1)!.systems[0].failures).toBe(1);
  });

  test("overlapping runtimes cannot mask one another; unknown worlds have no invented health", async () => {
    const failed = runtime(), good = runtime(failed.world);
    registerFastSystem(failed, { name: "WorldTick", execute: () => { throw new Error("bad"); } });
    registerFastSystem(good, { name: "WorldTick", execute: () => {} });
    startSimulation(failed); startSimulation(good);
    await jest.advanceTimersByTimeAsync(100);
    expect(getWorldRuntimeHealth(failed.world)).toMatchObject({ status: "failing", activeRuntimes: 2, failingSystems: 1 });
    stopSimulation(failed);
    expect(getWorldRuntimeHealth(failed.world)).toMatchObject({ status: "passing", activeRuntimes: 1 });
    expect(getWorldRuntimeHealth(createArgosWorld())).toMatchObject({ status: "unobserved", totalRuntimes: 0 });
  });

  test("bounded details retain complete failure aggregates and bounded stopped history", async () => {
    const state = runtime();
    for (let i = 0; i < 30; i++) registerFastSystem(state, { name: `Callback-${i}`, execute: () => { if (i >= 5) throw new Error("x"); } });
    startSimulation(state); await jest.advanceTimersByTimeAsync(100);
    const health = getSimulationStats(state).fastSystemHealth;
    expect(health).toMatchObject({ totalSystems: 30, omittedSystems: 14, totalFailures: 25, failingSystems: 25 });
    expect(health.systems).toHaveLength(16);
    expect(health.systems.every(system => system.status === "failing")).toBe(true);
    for (let i = 0; i < 12; i++) { stopSimulation(state); startSimulation(state); }
    const history = getWorldRuntimeHealth(state.world);
    expect(history).toMatchObject({ totalRuntimes: 5, omittedRuntimes: 1 });
    expect(history.runtimes).toHaveLength(4);
    stopSimulation(state);
    expect(getWorldRuntimeHealth(state.world).totalRuntimes).toBe(4);
  });

  test("a returned outer callback does not erase child-system error reports", async () => {
    const state = runtime();
    registerSystem(state.systemRegistry, { name: "BrokenChild", active: true, lastRun: 0, frequency: 1,
      description: "Throws inside runSystems", pseudocode: "", compiledFn: () => { throw new Error("child failure"); } });
    registerFastSystem(state, { name: "WorldTick", execute: (world, delta, tick) => { runSystems(world, state.systemRegistry, tick, delta); } });
    startSimulation(state); await jest.advanceTimersByTimeAsync(100);
    expect(getSimulationStats(state).fastSystemHealth).toMatchObject({ status: "passing", totalFailures: 0 });
    expect(getAllSystemHealth(state.systemRegistry)).toEqual([expect.objectContaining({ name: "BrokenChild", totalErrors: 1 })]);
  });

  test("God, monitoring, watcher and architect observe the real failure without stimuli or repair commands", async () => {
    const state = runtime(); startCommittedEvents(state.world);
    initializeRegistry(state.world); initializePrefabs(state.world);
    const god = createGodAgent(state.world, { name: "God", worldName: "Health fixture", narrative: "" });
    registerFastSystem(state, { name: "WorldTick", execute: () => { throw new SyntaxError("PRIVATE_TEXT"); } });
    startSimulation(state); await jest.advanceTimersByTimeAsync(100);
    const watcher = createWatcherTools(state.world, state.systemRegistry);
    const health = await (watcher.getSystemHealth.execute as any)({}, {});
    expect(health).toMatchObject({ total: 0, runtimeHealth: { requiresRuntimeReview: true, failingSystems: 1 } });
    const context = await gatherArchitectContext(state.world, state.systemRegistry);
    expect(context.runtimeHealth).toContain('"failingSystems":1');
    expect(context.runtimeHealth).not.toContain("PRIVATE_TEXT");
    expect(getWorldState(god)).toContain('"failingSystems":1');
    const summary = getWorldSummary(state.world, god.registry);
    expect(getWorldSummaryText(summary)).toContain('"failingSystems":1');
    const observation = runObservation(state.world, god.registry, createObservationState(), state.tick);
    expect(observation).toMatchObject({ requiresRuntimeReview: true, shouldIntervene: false, suggestedInterventions: [] });
    expect(getCommittedEvents(state.world).latestSequence).toBe(0);
    expect(formatWorldRuntimeHealth(state.world)).toContain("not that its child systems or NPC behavior succeeded");
  });
});
