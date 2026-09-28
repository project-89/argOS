import { jest } from "@jest/globals";
import { gunzipSync } from "node:zlib";
import { BaselineEvidenceJournal, drainBaselineWork, finalizeBaselineObservation, recentBaselineThoughts } from "../baseline-evidence-journal";

test("cleanup observes late operation terminals even after HTTP auditing has drained", async () => {
  const observed: string[] = []; let subscribed = true, release!: () => void;
  const operation = new Promise<void>(resolve => { release = resolve; }).finally(() => { if (subscribed) observed.push("real terminal"); });
  const done = finalizeBaselineObservation({ checkpoint: () => {}, lifecycle: () => {}, stop: () => {},
    drain: () => drainBaselineWork(() => operation, async () => {}), disposers: [() => { subscribed = false; }] });
  await Promise.resolve(); expect(subscribed).toBe(true); expect(observed).toEqual([]);
  release(); expect(await done).toEqual([]);
  expect(observed).toEqual(["real terminal"]); expect(subscribed).toBe(false);
});

test("a failed operation drain still waits for provider auditing before disposing observers", async () => {
  let release!: () => void, disposed = false;
  const provider = new Promise<void>(resolve => { release = resolve; });
  const done = finalizeBaselineObservation({ checkpoint: () => {}, lifecycle: () => {}, stop: () => {},
    drain: () => drainBaselineWork(async () => { throw Error("operation failed"); }, () => provider),
    disposers: [() => { disposed = true; }] });
  await Promise.resolve(); expect(disposed).toBe(false); release();
  expect(await done).toEqual([{ stage: "drain", error: "Baseline work drain incomplete" }]);
  expect(disposed).toBe(true);
});

test.each(["operation", "provider"])("unsettled %s is a bounded failed drain, never successful grace-period expiry", async held => {
  jest.useFakeTimers();
  try {
    const pending = () => new Promise<void>(() => {}), ready = async () => {};
    const drain = drainBaselineWork(held === "operation" ? pending : ready, held === "provider" ? pending : ready, 50);
    const assertion = expect(drain).rejects.toThrow("timed out");
    await jest.advanceTimersByTimeAsync(50); await assertion;
  } finally { jest.useRealTimers(); }
});

test("an unavailable audit cannot produce a successful baseline drain", async () => {
  await expect(drainBaselineWork(async () => {}, undefined)).rejects.toThrow("incomplete");
});

test("thought observer keeps the newest eight in chronological order without mutating introspection", () => {
  const thoughts = Array.from({length:12},(_,i)=>Object.freeze({timestamp:12000-i*1000,content:`thought ${12-i}`}));
  const before = thoughts.slice(); Object.freeze(thoughts);
  const recent=recentBaselineThoughts(thoughts);
  expect(recent.map(t=>t.timestamp)).toEqual([5000,6000,7000,8000,9000,10000,11000,12000]);
  expect(recent.at(-1)).toBe(thoughts[0]); expect(thoughts).toEqual(before);
});

test("thought observer preserves empty and short histories and equal-timestamp content", () => {
  expect(recentBaselineThoughts([])).toEqual([]);
  const single={timestamp:5,content:"only thought"};
  expect(recentBaselineThoughts([single])).toEqual([single]);
  const same=[{timestamp:5,content:"newer"},{timestamp:5,content:"older"}];
  expect(recentBaselineThoughts(same)).toEqual([same[1],same[0]]);
});

function fixture(limits = { storedBytes: 100_000, lifecycleReserveBytes: 1000, recordBytes: 2_000_000 }) {
  const files = new Map<string, Buffer[]>();
  const journal = new BaselineEvidenceJournal("/evidence", limits, (path, bytes) => {
    files.set(path, [...files.get(path) ?? [], bytes]);
  });
  const read = (file: string) => Buffer.concat(files.get("/evidence/" + file) ?? []);
  return { journal, files, read };
}

test("compressed frames reconstruct every original field, including repeated private memories", () => {
  const f = fixture();
  const frames = Array.from({ length: 6 }, (_, i) => ({ atSimMs: i * 1000,
    state: { actors: [{ id: 21, mind: { conversationHistory: [{ role: "user", content: "Prior private context. ".repeat(20_000) }],
      perceptions: [{ source: "plaque", text: `コード №${i}: 3660 — 🗝️\nsecond line` }] } }] },
    actors: [{ goalId: 42, plan: { step: i }, receipt: i ? "committed" : null }], events: [] }));
  frames.forEach(row => f.journal.append("frames.jsonl.gz", row));
  const decoded = gunzipSync(f.read("frames.jsonl.gz")).toString("utf8").trim().split("\n").map(line => JSON.parse(line));
  expect(decoded).toEqual(frames);
  expect(f.journal.snapshot()).toMatchObject({ records: 6, lifecycleBytes: 0 });
  expect(f.journal.snapshot().storedBytes).toBeLessThan(20_000);
  expect(f.journal.snapshot().logicalBytes).toBeGreaterThan(2_000_000);
  // Prefix evidence is already a complete gzip stream, without graceful close.
  const prefix = Buffer.concat(f.files.get("/evidence/frames.jsonl.gz")!.slice(0,3));
  expect(gunzipSync(prefix).toString("utf8").trim().split("\n").map(line => JSON.parse(line))).toEqual(frames.slice(0,3));
});

test("a full data journal cannot consume the reserved lifecycle budget", () => {
  const f = fixture({ storedBytes: 300, lifecycleReserveBytes: 150, recordBytes: 1000 });
  f.journal.append("events.jsonl", { text: "x".repeat(130) });
  const before = f.journal.snapshot();
  expect(() => f.journal.append("events.jsonl", { text: "overflow" })).toThrow("journal bound");
  expect(f.journal.snapshot()).toEqual(before);
  f.journal.append("lifecycle.jsonl", { stage: "stop_begin" });
  f.journal.append("lifecycle.jsonl", { stage: "stop_returned" });
  f.journal.append("lifecycle.jsonl", { stage: "drain_returned" });
  expect(f.journal.snapshot().storedBytes).toBeLessThanOrEqual(300);
  expect(f.read("lifecycle.jsonl").toString()).toContain("stop_returned");
  const complete = f.journal.snapshot();
  expect(() => f.journal.append("lifecycle.jsonl", { text: "x".repeat(140) })).toThrow("journal bound");
  expect(f.journal.snapshot()).toEqual(complete);
});

test("large records, invalid paths/values and disk errors cannot masquerade as saved evidence", () => {
  const f = fixture({ storedBytes: 1000, lifecycleReserveBytes: 100, recordBytes: 32 });
  expect(() => f.journal.append("frames.jsonl.gz", { text: "x".repeat(100) })).toThrow("record bound");
  expect(() => f.journal.append("../outside.jsonl", {})).toThrow("filename");
  expect(() => f.journal.append("frames.jsonl.gz", undefined)).toThrow("not JSON");
  expect(f.journal.snapshot().records).toBe(0);
  const broken = new BaselineEvidenceJournal("/evidence", undefined, () => { throw new Error("disk full"); });
  expect(() => broken.append("events.jsonl", {})).toThrow("disk full");
  expect(broken.snapshot()).toMatchObject({ records: 0, storedBytes: 0 });
});

test("cleanup stops, drains and disposes even when the checkpoint and every lifecycle write fail", async () => {
  const order: string[] = [];
  const failures = await finalizeBaselineObservation({
    checkpoint: () => { order.push("checkpoint"); throw new Error("journal full"); },
    lifecycle: stage => { order.push(stage); throw new Error("disk full"); },
    stop: () => { order.push("stop"); },
    drain: async () => { order.push("drain"); },
    disposers: [() => { order.push("dispose"); }],
  });
  expect(order).toEqual(["checkpoint", "stop_begin", "stop", "stop_returned", "drain", "drain_returned", "dispose"]);
  expect(failures.map(f => f.stage)).toEqual(["checkpoint", "stop_begin", "stop_returned", "drain_returned"]);
});

test("a thrown stop or drain is reported as failed, never a successful return; all disposers run", async () => {
  const stages: string[] = [], last = jest.fn();
  const failures = await finalizeBaselineObservation({
    checkpoint: () => {}, lifecycle: stage => { stages.push(stage); },
    stop: () => { throw new Error("native stop failed"); },
    drain: async () => { throw new Error("audit drain failed"); },
    disposers: [() => { throw new Error("unsubscribe failed"); }, last],
  });
  expect(stages).toEqual(["stop_begin", "stop_failed", "drain_failed"]);
  expect(failures.map(f => f.stage)).toEqual(["stop", "drain", "dispose:0"]);
  expect(last).toHaveBeenCalledTimes(1);
});

test("quota exhaustion preserves terminal markers and the failed observation while native stop runs", async () => {
  const f = fixture({ storedBytes: 600, lifecycleReserveBytes: 300, recordBytes: 1000 });
  f.journal.append("events.jsonl", { text: "x".repeat(270) });
  const stop = jest.fn(), drain = jest.fn(async () => {});
  const failures = await finalizeBaselineObservation({
    checkpoint: () => f.journal.append("frames.jsonl", { text: "oversized remaining evidence" }),
    lifecycle: stage => f.journal.append("lifecycle.jsonl", { stage }), stop, drain, disposers: [],
  });
  expect(failures).toEqual([{ stage: "checkpoint", error: "Evidence journal bound exceeded" }]);
  expect(stop).toHaveBeenCalledTimes(1); expect(drain).toHaveBeenCalledTimes(1);
  expect(f.read("lifecycle.jsonl").toString().trim().split("\n").map(s => JSON.parse(s).stage))
    .toEqual(["stop_begin", "stop_returned", "drain_returned"]);
});

test("a native relay world is actually stopped after its evidence sink fills", async () => {
  const { EscapeRoomTestbed } = await import("../../demo/escape-room");
  const bed = await EscapeRoomTestbed.create({ live: false, seed: 11, topology: "relay" });
  const f = fixture({ storedBytes: 600, lifecycleReserveBytes: 300, recordBytes: 2_000_000 });
  try {
    await bed.start();
    bed.dispatch("Mara", { type: "move", target: "Gallery" });
    bed.advance(1000);
    const failures = await finalizeBaselineObservation({
      checkpoint: () => f.journal.append("frames.jsonl", bed.snapshot()),
      lifecycle: stage => f.journal.append("lifecycle.jsonl", { stage }),
      stop: () => bed.stop(), drain: async () => {}, disposers: [],
    });
    expect(failures).toEqual([{ stage: "checkpoint", error: "Evidence journal bound exceeded" }]);
    expect(() => bed.dispatch("Mara", { type: "wait" })).toThrow("Start the testbed first");
    const before = bed.elapsedMs;
    bed.advance(10_000);
    expect(bed.elapsedMs).toBe(before);
    expect(bed.snapshot().actors.find(a => a.name === "Mara")?.room).toBe("Atrium");
    expect(f.read("lifecycle.jsonl").toString()).toContain("stop_returned");
  } finally { bed.stop(); }
});
