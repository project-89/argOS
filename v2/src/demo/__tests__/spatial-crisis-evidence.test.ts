import { createArgosWorld } from "../../ecs/world";
import { chronicle } from "../../cognition/simulation-chronicle";
import { recordControlLoopDiagnostic } from "../../runtime/control-loop-diagnostics";
import { CrisisReceiptDeltas, recordCrisisControlEvidence } from "../spatial-crisis-evidence";
import type { WorkingMemoryReceipt } from "../../cognition/working-memory";

test("control recorder captures actual admission reasons once and keeps chronicle process-scoped", () => {
  const world = createArgosWorld(), other = createArgosWorld(), rows: Array<{ file: string; value: any }> = [];
  const recorder = recordCrisisControlEvidence(world, (file, value) => rows.push({ file, value }));
  try {
    recordControlLoopDiagnostic(world, () => ({ lane: "foreground", actorId: 1, requestId: "pickup-1", stage: "superseded", detail: { reason: "goal_basis_changed" } }));
    recordControlLoopDiagnostic(other, () => ({ lane: "foreground", actorId: 2, stage: "admitted", detail: {} }));
    chronicle.record("decision_superseded", { agent: "Mara", requestId: "pickup-1", reason: "goal_basis_changed" });
    expect(recorder.collect()).toMatchObject({ archivedEntries: 1, missingSequences: 0 }); recorder.collect();
    expect(rows.filter(row => row.file === "control-ledger.jsonl")).toEqual([expect.objectContaining({ value: expect.objectContaining({
      requestId: "pickup-1", stage: "superseded", detail: { reason: "goal_basis_changed" },
    }) })]);
    expect(rows.find(row => row.file === "chronicle.jsonl")?.value).toMatchObject({ scope: "process", entry: { type: "decision_superseded" } });
  } finally { recorder.dispose(); }
  const length = rows.length; chronicle.record("decision_superseded", { reason: "after_dispose" }); expect(rows).toHaveLength(length);
});

test("ledger truncation is surfaced as missing coverage rather than silently claimed complete", () => {
  const world = createArgosWorld(), recorder = recordCrisisControlEvidence(world, () => {});
  try {
    for (let i = 0; i < 600; i++) recordControlLoopDiagnostic(world, () => ({ lane: "foreground", actorId: 1, stage: "test", detail: { i } }));
    expect(recorder.collect()).toMatchObject({ archivedEntries: 512, missingSequences: 88, nativeDropped: 88 });
  } finally { recorder.dispose(); }
});

test("receipt deltas preserve changes and eviction without repeating unchanged private history", () => {
  const journal = new CrisisReceiptDeltas();
  const receipt = (id: string, summary = id): WorkingMemoryReceipt => ({ id, atMs: 1, kind: "action", provenance: "own_action", summary, succeeded: true, facts: [] });
  const a = receipt("a"), b = receipt("b");
  expect(journal.capture("mara", [a, b])).toEqual({ upsert: [a, b], removed: [], retained: 2 });
  expect(journal.capture("mara", [a, b])).toEqual({ upsert: [], removed: [], retained: 2 });
  const changed = receipt("b", "updated");
  expect(journal.capture("mara", [changed])).toEqual({ upsert: [changed], removed: ["a"], retained: 1 });
  expect(journal.capture("ivo", [a])).toEqual({ upsert: [a], removed: [], retained: 1 });
  expect(journal.capture("mara", [])).toEqual({ upsert: [], removed: ["b"], retained: 0 });
});
