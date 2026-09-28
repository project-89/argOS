import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  cancelTask, getQueueStats, getTaskStatus, initializeTaskQueue, isTaskInProgress,
  queueTask, startTaskQueue, stopTaskQueue, type TaskLane, type TaskPriority,
} from "../async-task-queue";

describe("bounded subconscious priority aging", () => {
  let now: number;
  let started: string[];
  let releases: Array<() => void>;
  let actual: Record<TaskLane, number>;
  let peak: Record<TaskLane, number>;

  function held(label: string, options: { name?: string; lane?: TaskLane; priority?: TaskPriority; scope?: string } = {}) {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    releases.push(release);
    const lane = options.lane ?? "subconscious";
    const id = queueTask(options.name ?? label, async () => {
      started.push(label);
      actual[lane]++;
      peak[lane] = Math.max(peak[lane], actual[lane]);
      try { await promise; } finally { actual[lane]--; }
    }, { lane, priority: options.priority ?? "high", scope: options.scope ?? "source-A" });
    return { id, release };
  }
  async function advance(ms: number) {
    now += ms;
    await jest.advanceTimersByTimeAsync(ms);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Queue tests cannot call providers"));
    now = 0; started = []; releases = [];
    actual = { foreground: 0, subconscious: 0, background: 0 };
    peak = { ...actual };
    initializeTaskQueue({ processInterval: 10, subconsciousAgingMs: 5_000, monotonicNow: () => now });
    startTaskQueue();
  });

  afterEach(async () => {
    stopTaskQueue();
    releases.forEach(release => release());
    await jest.advanceTimersByTimeAsync(10);
    initializeTaskQueue();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("fresh priority wins, then old normal and low work dispatch despite a sustained high stream and long execution", async () => {
    const long = held("long planner"), first = held("first planner");
    await advance(10);
    const normal = held("coordination", { priority: "normal" });
    const low = held("reflection", { priority: "low" });
    let current = first;
    for (let wave = 0; wave < 4; wave++) {
      await advance(1_000);
      const high = held(`planner-${wave}`);
      current.release(); await advance(10);
      expect(getTaskStatus(high.id)?.status).toBe("running");
      expect(getTaskStatus(normal.id)?.status).toBe("pending");
      expect(getTaskStatus(low.id)?.status).toBe("pending");
      current = high;
    }
    const newer = held("new high"), critical = held("new critical", { priority: "critical" });
    await advance(960); // Exactly five seconds since coordination/reflection were queued.
    expect(getTaskStatus(normal.id)?.status).toBe("pending"); // No preemption of the two executors.
    current.release(); await advance(10);
    expect(getTaskStatus(normal.id)?.status).toBe("running");
    expect(getTaskStatus(newer.id)?.status).toBe("pending");
    expect(getTaskStatus(critical.id)?.status).toBe("pending");
    long.release(); await advance(10);
    expect(getTaskStatus(low.id)?.status).toBe("running");
    expect(started.slice(-2)).toEqual(["coordination", "reflection"]);
    expect(peak.subconscious).toBe(2);
    normal.release(); await advance(10);
    expect(getTaskStatus(critical.id)?.status).toBe("running"); // Fresh priorities still matter.
  });

  test("wall-clock jumps do not age or rejuvenate work, and equal monotonic ages use enqueue order", async () => {
    const a = held("planner-a"); held("planner-b");
    await advance(10);
    const low = held("older low", { priority: "low" });
    const normal = held("later normal", { priority: "normal" });
    const high = held("fresh high");
    const wall = Date.now();
    jest.setSystemTime(wall + 86_400_000);
    a.release(); await jest.advanceTimersByTimeAsync(10); // Monotonic age remains zero.
    expect(getTaskStatus(high.id)?.status).toBe("running");
    expect(getTaskStatus(low.id)?.status).toBe("pending");
    jest.setSystemTime(wall - 86_400_000);
    now += 5_000;
    high.release(); await jest.advanceTimersByTimeAsync(10);
    expect(getTaskStatus(low.id)?.status).toBe("running");
    expect(getTaskStatus(normal.id)?.status).toBe("pending");
    low.release(); await jest.advanceTimersByTimeAsync(10);
    expect(getTaskStatus(normal.id)?.status).toBe("running");
  });

  test("cancelled aged work is skipped and cancelled executors retain capacity and scoped single-flight until settlement", async () => {
    const retired = held("retired", { name: "same operation", scope: "source-A" });
    const otherSlot = held("other slot");
    await advance(10);
    const cancelled = held("cancelled pending", { priority: "low" });
    const replacement = held("replacement", { name: "same operation", scope: "source-A", priority: "low" });
    const otherSource = held("other source", { name: "same operation", scope: "source-B", priority: "normal" });
    const newer = held("new planner");
    cancelTask(retired.id); cancelTask(cancelled.id);
    await advance(5_000);
    expect(getQueueStats()).toMatchObject({ executing: 2, settling: 1 });
    expect(getTaskStatus(otherSource.id)?.status).toBe("pending");
    expect(isTaskInProgress("same operation", "source-A")).toBe(true);
    otherSlot.release(); await advance(10);
    expect(getTaskStatus(otherSource.id)?.status).toBe("running");
    expect(getTaskStatus(replacement.id)?.status).toBe("pending");
    expect(getTaskStatus(newer.id)?.status).toBe("pending");
    retired.release(); await advance(10);
    expect(getTaskStatus(replacement.id)?.status).toBe("running");
    expect(getTaskStatus(replacement.id)?.scope).toBe("source-A");
    expect(getTaskStatus(otherSource.id)?.scope).toBe("source-B");
    expect(getTaskStatus(cancelled.id)?.status).toBe("cancelled");
    expect(started).not.toContain("cancelled pending");
    expect(peak.subconscious).toBe(2);
  });

  test("aged subconscious work neither borrows idle lanes nor changes their strict priority selection", async () => {
    const subconscious = [held("sub-a"), held("sub-b")];
    const foreground = [held("fg-a", { lane: "foreground" }), held("fg-b", { lane: "foreground" })];
    const background = [0, 1, 2].map(i => held(`bg-${i}`, { lane: "background" }));
    await advance(10);
    const aged = held("old coordination", { priority: "normal" });
    const fgLow = held("old foreground", { lane: "foreground", priority: "low" });
    const bgLow = held("old background", { lane: "background", priority: "low" });
    await advance(5_000);
    const fgHigh = held("new foreground", { lane: "foreground" });
    const bgHigh = held("new background", { lane: "background" });
    foreground[0].release(); background[0].release(); await advance(10);
    expect(getTaskStatus(fgHigh.id)?.status).toBe("running");
    expect(getTaskStatus(bgHigh.id)?.status).toBe("running");
    expect(getTaskStatus(fgLow.id)?.status).toBe("pending");
    expect(getTaskStatus(bgLow.id)?.status).toBe("pending");
    [...foreground, ...background, fgLow, bgLow, fgHigh, bgHigh].forEach(task => task.release());
    await advance(30);
    expect(actual).toEqual({ foreground: 0, subconscious: 2, background: 0 });
    expect(getTaskStatus(aged.id)?.status).toBe("pending");
    const newer = held("new subconscious planner");
    subconscious[0].release(); await advance(10);
    expect(getTaskStatus(aged.id)?.status).toBe("running");
    expect(getTaskStatus(newer.id)?.status).toBe("pending");
    expect(peak).toEqual({ foreground: 2, subconscious: 2, background: 3 });
  });
});
