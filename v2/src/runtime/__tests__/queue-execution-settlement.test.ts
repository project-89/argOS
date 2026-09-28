import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  cancelTask, clearCompletedTasks, getQueueStats, getTaskStatus, initializeTaskQueue,
  isTaskInProgress, queueTask, startTaskQueue, stopTaskQueue,
} from "../async-task-queue";

describe("queue capacity follows executor settlement", () => {
  let releases: Array<() => void>;
  const held = () => new Promise<void>(resolve => releases.push(resolve));

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    releases = [];
    initializeTaskQueue({ processInterval: 10, foregroundMaxConcurrent: 2, taskTimeout: 1000 });
    startTaskQueue();
  });

  afterEach(async () => {
    stopTaskQueue();
    releases.forEach(release => release());
    await jest.advanceTimersByTimeAsync(10);
    initializeTaskQueue();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test.each(["cancel", "timeout"] as const)("%s is terminal immediately but retains the lane until its executor settles", async disposition => {
    initializeTaskQueue({ processInterval: 10, foregroundMaxConcurrent: 1, taskTimeout: 30 });
    startTaskQueue();
    const done = jest.fn(), failed = jest.fn();
    const first = queueTask("Ada", held, { lane: "foreground", scope: "world-A", onComplete: done, onError: failed });
    const next = queueTask("Bea", async () => "ready", { lane: "foreground", scope: "world-A" });
    await jest.advanceTimersByTimeAsync(10);
    if (disposition === "cancel") cancelTask(first);
    await jest.advanceTimersByTimeAsync(40);
    expect(getTaskStatus(first)?.status).toBe(disposition === "cancel" ? "cancelled" : "failed");
    expect(failed).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();
    expect(getQueueStats().running).toBe(0);
    expect(getQueueStats()).toMatchObject({ executing: 1, settling: 1 });
    expect(getTaskStatus(next)?.status).toBe("pending");
    expect(isTaskInProgress("Ada", "world-A")).toBe(true);
    releases[0](); await jest.advanceTimersByTimeAsync(20);
    expect(getTaskStatus(next)?.status).toBe("completed");
    expect(isTaskInProgress("Ada", "world-A")).toBe(false);
    expect(getQueueStats()).toMatchObject({ executing: 0, settling: 0 });
    expect(done).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledTimes(1);
  });

  test("a duplicate name/scope waits for actual settlement without blocking another world or actor", async () => {
    const first = queueTask("Ada", held, { lane: "foreground", scope: "world-A" });
    await jest.advanceTimersByTimeAsync(10); cancelTask(first);
    await jest.advanceTimersByTimeAsync(10);
    const duplicate = queueTask("Ada", async () => "replacement", { lane: "foreground", scope: "world-A" });
    const otherWorld = queueTask("Ada", async () => "world-B", { lane: "foreground", scope: "world-B" });
    const otherActor = queueTask("Bea", async () => "world-A", { lane: "foreground", scope: "world-A" });
    await jest.advanceTimersByTimeAsync(30);
    expect(getTaskStatus(duplicate)?.status).toBe("pending");
    expect(getTaskStatus(otherWorld)?.status).toBe("completed");
    expect(getTaskStatus(otherActor)?.status).toBe("completed");
    releases[0](); await jest.advanceTimersByTimeAsync(20);
    expect(getTaskStatus(duplicate)?.status).toBe("completed");
  });

  test("history pruning and explicit cleanup cannot erase an unsettled executor's reservation", async () => {
    const first = queueTask("Ada", held, { lane: "foreground", scope: "world-A" });
    await jest.advanceTimersByTimeAsync(10); cancelTask(first);
    await jest.advanceTimersByTimeAsync(10);
    for (let i = 0; i < 120; i++) cancelTask(queueTask(`unused-${i}`, async () => undefined));
    clearCompletedTasks();
    expect(getTaskStatus(first)?.status).toBe("cancelled");
    expect(isTaskInProgress("Ada", "world-A")).toBe(true);
    expect(getQueueStats()).toMatchObject({ executing: 1, settling: 1 });
    releases[0](); await jest.advanceTimersByTimeAsync(10); clearCompletedTasks();
    expect(getTaskStatus(first)).toBeUndefined();
    expect(getQueueStats()).toMatchObject({ executing: 0, settling: 0 });
  });

  test("synchronous throws release execution capacity and preserve the failed outcome", async () => {
    initializeTaskQueue({ processInterval: 10, foregroundMaxConcurrent: 1 }); startTaskQueue();
    const first = queueTask("throws", () => { throw new Error("sync fault"); }, { lane: "foreground" });
    const next = queueTask("healthy", async () => 42, { lane: "foreground" });
    await jest.advanceTimersByTimeAsync(30);
    expect(getTaskStatus(first)).toMatchObject({ status: "failed", error: expect.stringContaining("sync fault") });
    expect(getTaskStatus(next)?.result).toBe(42);
    expect(getQueueStats()).toMatchObject({ executing: 0, settling: 0 });
  });

  test("a late rejected executor does not deliver a second error or resurrect completion", async () => {
    const done = jest.fn(), failed = jest.fn();
    const first = queueTask("Ada", async () => { await held(); throw new Error("late rejection"); },
      { lane: "foreground", onComplete: done, onError: failed });
    await jest.advanceTimersByTimeAsync(10); cancelTask(first);
    await jest.advanceTimersByTimeAsync(10);
    const originalError = getTaskStatus(first)?.error;
    releases[0](); await jest.advanceTimersByTimeAsync(10);
    expect(getTaskStatus(first)).toMatchObject({ status: "cancelled", error: originalError });
    expect(failed).toHaveBeenCalledTimes(1); expect(done).not.toHaveBeenCalled();
    expect(getQueueStats()).toMatchObject({ executing: 0, settling: 0 });
  });

  test("retired executor settlement cannot release a replacement queue's occupied slot", async () => {
    const old = queueTask("Ada", held, { lane: "foreground", scope: "world-A" });
    await jest.advanceTimersByTimeAsync(10);
    initializeTaskQueue({ processInterval: 10, foregroundMaxConcurrent: 1 }); startTaskQueue();
    const current = queueTask("Ada", held, { lane: "foreground", scope: "world-A" });
    const next = queueTask("Bea", async () => 1, { lane: "foreground", scope: "world-A" });
    await jest.advanceTimersByTimeAsync(10);
    releases[0](); await jest.advanceTimersByTimeAsync(20);
    expect(getTaskStatus(old)).toBeUndefined();
    expect(getTaskStatus(current)?.status).toBe("running");
    expect(getTaskStatus(next)?.status).toBe("pending");
    expect(getQueueStats()).toMatchObject({ executing: 1, settling: 0 });
    releases[1](); await jest.advanceTimersByTimeAsync(20);
    expect(getTaskStatus(next)?.status).toBe("completed");
    expect(getQueueStats()).toMatchObject({ executing: 0, settling: 0 });
  });

  test("32 actors remain bounded through cancellation while builders and subconscious work proceed", async () => {
    let actual = 0, peak = 0;
    const started: number[] = [];
    let freeBuilders!: () => void;
    const blocked = new Promise<void>(resolve => { freeBuilders = resolve; });
    releases.push(freeBuilders);
    const builders = Array.from({ length: 3 }, (_, i) => queueTask(`builder-${i}`, () => blocked));
    const planners = Array.from({ length: 2 }, (_, i) => queueTask(`planner-${i}`, () => blocked, { lane: "subconscious" }));
    const actors = Array.from({ length: 32 }, (_, i) => queueTask(`actor-${i}`, async () => {
      started.push(i);
      actual++; peak = Math.max(peak, actual);
      try { await held(); } finally { actual--; }
    }, { lane: "foreground", scope: i % 2 ? "world-B" : "world-A" }));
    await jest.advanceTimersByTimeAsync(10);
    cancelTask(actors[0]); cancelTask(actors[1]);
    await jest.advanceTimersByTimeAsync(30);
    expect(actual).toBe(2); expect(peak).toBe(2);
    expect(getTaskStatus(actors[2])?.status).toBe("pending");
    expect([...builders, ...planners].every(id => getTaskStatus(id)?.status === "running")).toBe(true);
    for (let wave = 0; wave < 16; wave++) {
      const boundary = releases.length;
      releases.slice(1, boundary).forEach(release => release());
      await jest.advanceTimersByTimeAsync(20);
    }
    expect(peak).toBe(2); expect(actual).toBe(0);
    expect(started).toEqual(Array.from({ length: 32 }, (_, i) => i));
    expect(actors.slice(2).every(id => getTaskStatus(id)?.status === "completed")).toBe(true);
    const last = getTaskStatus(actors[31])!;
    expect(last.startedAt! - last.queuedAt).toBeGreaterThan(0);
    expect(last.startedAt! - last.queuedAt).toBeLessThanOrEqual(350); // Synthetic timer/queue delay, not model latency.
    expect(getQueueStats()).toMatchObject({ pending: 0, running: 5, executing: 5, settling: 0 });
    freeBuilders(); await jest.advanceTimersByTimeAsync(10);
    expect(getQueueStats()).toMatchObject({ pending: 0, running: 0, executing: 0, settling: 0 });
  });
});
