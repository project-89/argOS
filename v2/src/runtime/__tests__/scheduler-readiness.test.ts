import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { createSimulation, getSimulationStats, registerAIOperation, startSimulation, stopSimulation, type SimulationState } from "../simulation-loop";
import { cancelTask, getQueueStats, getTaskStatus, initializeTaskQueue, isTaskInProgress, queueTask, startTaskQueue, stopTaskQueue } from "../async-task-queue";
import { assertSimulationTaskActive, getSimulationTaskSignal } from "../task-scope";
import * as simulationRuntime from "../simulation-loop";

describe("reserved cognition lanes and dispatch readiness", () => {
  let states: SimulationState[];
  let releases: Array<() => void>;

  function hold() {
    return new Promise<void>(resolve => releases.push(resolve));
  }

  function simulation() {
    const state = createSimulation(createArgosWorld("Scheduler regression"), {} as any, {} as any, {
      ecsTickRate: 100, logTickStats: false,
    });
    states.push(state);
    return state;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-04T12:00:00Z"));
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    states = [];
    releases = [];
    initializeTaskQueue({ processInterval: 10, maxConcurrent: 3, foregroundMaxConcurrent: 2, subconsciousMaxConcurrent: 2 });
    startTaskQueue();
  });

  afterEach(async () => {
    for (const state of states) stopSimulation(state);
    for (const release of releases) release();
    await jest.advanceTimersByTimeAsync(20);
    stopTaskQueue();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("stopped-runtime drain awaits the actual operation finally, not the queue cancellation race", async () => {
    const state = simulation(), terminal = jest.fn();
    registerAIOperation(state, { name: "late cognition terminal", interval: 1, lane: "foreground", execute: async () => {
      try { await hold(); assertSimulationTaskActive(); } finally { terminal(); }
    } });
    startSimulation(state); await jest.advanceTimersByTimeAsync(30);
    expect(releases).toHaveLength(1); stopSimulation(state);
    const stoppedAt = state.world.time.elapsed;
    let done = false;
    const drain = simulationRuntime.drainSimulationOperations(state, 100).then(() => { done = true; });
    await jest.advanceTimersByTimeAsync(20);
    expect(getQueueStats().running).toBe(0); expect(state.tasks.size).toBe(0);
    expect(done).toBe(false); expect(terminal).not.toHaveBeenCalled();
    releases[0](); await drain;
    expect(terminal).toHaveBeenCalledTimes(1); expect(done).toBe(true);
    expect(state.world.time.elapsed).toBe(stoppedAt);
  });

  test("draining one stopped runtime neither waits for nor cancels another world", async () => {
    const first = simulation(), second = simulation();
    for (const state of [first, second]) registerAIOperation(state, { name: "same name", interval: 1, lane: "foreground", execute: hold });
    startSimulation(first); startSimulation(second); await jest.advanceTimersByTimeAsync(30);
    stopSimulation(first); releases[0]();
    await simulationRuntime.drainSimulationOperations(first, 100);
    expect(second.isRunning).toBe(true); expect(second.abort.signal.aborted).toBe(false);
    expect(isTaskInProgress("same name", second.scopeId)).toBe(true);
  });

  test("an uncooperative operation reports bounded drain failure without manufacturing completion", async () => {
    const state = simulation(), terminal = jest.fn();
    registerAIOperation(state, { name: "held finally", interval: 1, execute: async () => { await hold(); terminal(); } });
    startSimulation(state); await jest.advanceTimersByTimeAsync(30); stopSimulation(state);
    const drain = simulationRuntime.drainSimulationOperations(state, 50);
    const assertion = expect(drain).rejects.toThrow("drain timed out");
    await jest.advanceTimersByTimeAsync(50); await assertion;
    expect(terminal).not.toHaveBeenCalled();
    releases[0](); await simulationRuntime.drainSimulationOperations(state, 100);
    expect(terminal).toHaveBeenCalledTimes(1);
  });

  test("drain requires a stopped runtime and detects restart while waiting", async () => {
    const state = simulation();
    registerAIOperation(state, { name: "held operation", interval: 1, execute: hold });
    startSimulation(state); await jest.advanceTimersByTimeAsync(30);
    await expect(simulationRuntime.drainSimulationOperations(state, 100)).rejects.toThrow("stopped runtime");
    stopSimulation(state);
    const drain = simulationRuntime.drainSimulationOperations(state, 100);
    const assertion = expect(drain).rejects.toThrow("restarted");
    startSimulation(state); releases[0](); await assertion;
  });

  test("held world builders cannot starve planning, and held planning cannot block foreground cognition", async () => {
    const builders = [1, 2, 3].map(i => queueTask(`held-builder-${i}`, hold, { priority: "critical" }));
    const extraBuilder = queueTask("queued builder", async () => "built", { priority: "critical" });
    await jest.advanceTimersByTimeAsync(20);
    expect(builders.map(id => getTaskStatus(id)?.status)).toEqual(["running", "running", "running"]);
    expect(getTaskStatus(extraBuilder)?.status).toBe("pending");

    const planning = [1, 2].map(i => queueTask(`held-planning-${i}`, hold, { lane: "subconscious", priority: "low" }));
    const extraPlanning = queueTask("queued reflection", async () => "reflected", { lane: "subconscious", priority: "low" });
    await jest.advanceTimersByTimeAsync(20);
    expect(planning.map(id => getTaskStatus(id)?.status)).toEqual(["running", "running"]);
    expect(getTaskStatus(extraPlanning)?.status).toBe("pending");

    const fast = queueTask("Mara immediate decision", async () => "heard the phone", { lane: "foreground" });
    await jest.advanceTimersByTimeAsync(20);
    expect(getTaskStatus(fast)?.result).toBe("heard the phone");
    expect(getTaskStatus(extraBuilder)?.status).toBe("pending");
    expect(getTaskStatus(extraPlanning)?.status).toBe("pending");
  });

  test.each(["foreground", "subconscious"] as const)("%s operation rechecks readiness at dispatch and can promptly retry", async lane => {
    queueTask("occupy lane 1", hold, { lane });
    queueTask("occupy lane 2", hold, { lane });
    await jest.advanceTimersByTimeAsync(20);
    let ready = true;
    const execute = jest.fn(async () => "current decision");
    const state = simulation();
    registerAIOperation(state, { name: `test-${lane}`, interval: 10, lane, ready: () => ready, execute });
    startSimulation(state);
    await jest.advanceTimersByTimeAsync(100);
    const queued = [...state.tasks][0];
    expect(getTaskStatus(queued)?.status).toBe("pending");
    expect(execute).not.toHaveBeenCalled();

    ready = false;
    releases[0]();
    await jest.advanceTimersByTimeAsync(20);
    expect(execute).not.toHaveBeenCalled();
    expect(getTaskStatus(queued)?.status).toBe("completed"); // Completed no-op, not a model request.
    expect(state.tasks.size).toBe(0);
    expect(isTaskInProgress(`test-${lane}`)).toBe(false);
    expect(state.aiOperations[0].lastRun).toBe(0); // A skipped decision did not consume its interval.

    ready = true;
    await jest.advanceTimersByTimeAsync(20);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("a throwing readiness probe does not crash the ECS loop or launch its operation", async () => {
    const state = simulation();
    const execute = jest.fn(async () => undefined);
    const healthy = jest.fn(async () => undefined);
    registerAIOperation(state, {
      name: "unloaded actor", interval: 1, lane: "subconscious",
      ready: () => { throw new Error("The world package unloaded"); }, execute,
    });
    registerAIOperation(state, { name: "healthy actor", interval: 1, lane: "foreground", execute: healthy });
    startSimulation(state);
    await jest.advanceTimersByTimeAsync(40);
    expect(state.tick).toBeGreaterThanOrEqual(3);
    expect(execute).not.toHaveBeenCalled();
    expect(healthy).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("[SimLoop] AI readiness failed: unloaded actor", expect.any(Error));
  });

  test("stopping a world clears its queued subconscious work before capacity frees", async () => {
    queueTask("held subconscious 1", hold, { lane: "subconscious" });
    queueTask("held subconscious 2", hold, { lane: "subconscious" });
    await jest.advanceTimersByTimeAsync(20);
    const state = simulation();
    const execute = jest.fn(async () => undefined);
    registerAIOperation(state, { name: "stopped actor", interval: 1, lane: "subconscious", execute });
    startSimulation(state);
    await jest.advanceTimersByTimeAsync(20);
    const queued = [...state.tasks][0];
    expect(getTaskStatus(queued)?.status).toBe("pending");
    stopSimulation(state);
    expect(getTaskStatus(queued)?.status).toBe("cancelled");
    expect(state.tasks.size).toBe(0);
    releases.forEach(release => release());
    await jest.advanceTimersByTimeAsync(20);
    expect(execute).not.toHaveBeenCalled();
  });

  test("equal operation names in separate runtimes neither deduplicate nor stop each other", async () => {
    const first = simulation(), second = simulation();
    const left = jest.fn(hold), right = jest.fn(async () => undefined);
    registerAIOperation(first, { name: "same name", interval: 1, lane: "foreground", execute: left });
    registerAIOperation(second, { name: "same name", interval: 1, lane: "foreground", execute: right });
    startSimulation(first); startSimulation(second);
    await jest.advanceTimersByTimeAsync(40);
    expect(left).toHaveBeenCalledTimes(1);
    expect(right).toHaveBeenCalled();
    const calls = right.mock.calls.length;
    stopSimulation(first);
    await jest.advanceTimersByTimeAsync(40);
    expect(right.mock.calls.length).toBeGreaterThan(calls);
    expect(getSimulationStats(second).operations[0].metrics.completed).toBeGreaterThan(0);
  });

  test("timeout cancels the task scope before a late result can mutate the world", async () => {
    initializeTaskQueue({ processInterval: 10, taskTimeout: 25 }); startTaskQueue();
    const state = simulation();
    let signal: AbortSignal | undefined;
    let writes = 0;
    registerAIOperation(state, { name: "slow provider", interval: 100, execute: async () => {
      signal = getSimulationTaskSignal();
      await hold();
      assertSimulationTaskActive();
      writes++;
    } });
    startSimulation(state);
    await jest.advanceTimersByTimeAsync(1050);
    expect(signal?.aborted).toBe(true);
    expect(getSimulationStats(state).operations[0].metrics.failed).toBe(1);
    releases.forEach(release => release());
    await jest.advanceTimersByTimeAsync(10);
    expect(writes).toBe(0);
  });

  test("queue replacement cannot receive completion or statistics from its retired queue", async () => {
    const done = jest.fn();
    const task = queueTask("old world", hold, { onComplete: done });
    await jest.advanceTimersByTimeAsync(20);
    const signal = getTaskStatus(task)!.abort.signal;
    initializeTaskQueue(); startTaskQueue();
    releases.forEach(release => release());
    await jest.advanceTimersByTimeAsync(20);
    expect(signal.aborted).toBe(true);
    expect(done).not.toHaveBeenCalled();
    expect(getQueueStats()).toMatchObject({ pending: 0, running: 0, completed: 0, failed: 0, avgExecutionTime: 0 });
  });

  test("cancelled pending history and operation latency samples remain bounded", async () => {
    const first = queueTask("cancelled", hold); cancelTask(first);
    for (let i = 0; i < 120; i++) cancelTask(queueTask("cancelled", hold));
    expect(getTaskStatus(first)).toBeUndefined();
    expect(getQueueStats().pending).toBe(0);
    const state = simulation();
    registerAIOperation(state, { name: "heartbeat", interval: 1, execute: async () => undefined });
    startSimulation(state);
    await jest.advanceTimersByTimeAsync(2000);
    const metrics = getSimulationStats(state).operations[0].metrics;
    expect(metrics.completed).toBeGreaterThan(100);
    expect(metrics.durationsMs).toHaveLength(100);
  });
});
