import { SimulationChronicle, type ChronicleSnapshot } from "../simulation-chronicle";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const snapshot = (tick: number): ChronicleSnapshot => ({
  tick, timestamp: tick, agents: [],
  worldStats: { rooms: 1, entities: 1, affordances: 0, components: 1, systems: 1, skills: 0 },
});

describe("chronicle operational evidence retention", () => {
  it("keeps a bounded tail but full event totals and archive delivery", () => {
    const log = new SimulationChronicle({ entries: { maxEntries: 2, maxBytes: 4096 }, snapshots: { maxEntries: 1, maxBytes: 4096 } });
    const archived: string[] = [];
    log.subscribeArchive(record => archived.push(record.kind));
    for (let tick = 1; tick <= 4; tick++) {
      log.setTick(tick);
      log.record("llm_decision", { agent: "Mara", action: "wait" });
      log.addSnapshot(snapshot(tick));
    }
    expect(log.getAll().map(entry => entry.id)).toEqual([3, 4]);
    expect(log.getLLMCalls("Mara")).toBe(4);
    expect(archived).toEqual(["entry", "snapshot", "entry", "snapshot", "entry", "snapshot", "entry", "snapshot"]);
    const report = log.generateReport();
    expect(report.meta.totalEvents).toBe(4);
    expect(report.meta.snapshotCount).toBe(4);
    expect(report.eventCounts.llm_decision).toBe(4);
    expect(report.coverage.scope).toBe("process-global");
    expect(report.coverage.events).toMatchObject({ total: 4, retained: 2, evicted: 2, complete: false });
    expect(report.coverage.snapshots).toMatchObject({ total: 4, retained: 1, evicted: 3, complete: false });
    expect(report.finalSnapshot?.tick).toBe(4);
  });

  it("archives oversized/cyclic evidence without crashing or retaining an unbounded body", () => {
    const log = new SimulationChronicle({ entries: { maxEntries: 8, maxBytes: 512 } });
    const delivered: number[] = [];
    log.subscribe(entry => delivered.push(entry.id));
    log.subscribeArchive(() => { throw new Error("archive unavailable"); });
    log.record("world_seed", { body: "x".repeat(10000) });
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => log.record("world_seed", cyclic)).not.toThrow();
    expect(delivered).toEqual([1, 2]);
    expect(log.getAll()).toEqual([]);
    expect(log.getCoverage()).toMatchObject({ archiveListenerFailures: 2, events: { total: 2, oversized: 1, unmeasurable: 1, complete: false } });
  });

  it("keeps subscribers through reset and archives an explicit epoch boundary", () => {
    const log = new SimulationChronicle();
    const delivered: number[] = [];
    const epochs: number[] = [];
    log.subscribe(entry => delivered.push(entry.id));
    log.subscribeArchive(record => { if (record.kind === "reset") epochs.push(record.epoch); });
    log.record("world_seed", {});
    log.reset();
    log.record("world_seed", {});
    expect(delivered).toEqual([1, 1]);
    expect(epochs).toEqual([1]);
    expect(log.getCoverage()).toMatchObject({ epoch: 1, events: { total: 1, retained: 1, complete: true } });
  });

  it("saves honest retained-tail coverage and does not label an older snapshot as final", () => {
    const log = new SimulationChronicle({ entries: { maxEntries: 1, maxBytes: 4096 }, snapshots: { maxEntries: 2, maxBytes: 4096 } });
    log.record("world_seed", {}); log.record("room_created", { name: "Hall" });
    log.addSnapshot(snapshot(1));
    const large = snapshot(2);
    large.agents.push({ name: "x".repeat(10000), role: "", room: "", treeSize: 0, compiledBranches: 0, llmCallsTotal: 0, policyCallsTotal: 0, skillCount: 0, memoryBranchCount: 0 });
    log.addSnapshot(large);
    const directory = mkdtempSync(join(tmpdir(), "argos-chronicle-retention-"));
    try {
      log.save(join(directory, "chronicle.json")); log.saveReport(join(directory, "report.json"));
      const saved = JSON.parse(readFileSync(join(directory, "chronicle.json"), "utf8"));
      expect(saved.chronicle.entries).toHaveLength(1);
      expect(saved.chronicle.coverage.events).toMatchObject({ total: 2, evicted: 1, complete: false });
      expect(saved.report.finalSnapshot).toBeNull();
      expect(saved.report.coverage.snapshots).toMatchObject({ total: 2, retained: 1, oversized: 1 });
      expect(readFileSync(join(directory, "report.md"), "utf8")).toContain("Complete hot evidence: false");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
