import { formatReflectionSources, selectReflectionSources, REFLECTION_CONTEXT_LIMIT, type ReflectionMemorySource } from "../reflection-retrieval";
import type { WorkingMemoryReceipt } from "../working-memory";

const memory = (id: number, content: string, importance = .5, timestamp = id, type = "episodic"): ReflectionMemorySource => ({ id, content, importance, timestamp, type });
const receipt = (id: string, summary: string, atMs: number, succeeded = true): WorkingMemoryReceipt => ({
  id, summary, atMs, kind: "action", provenance: "own_action", succeeded, facts: [],
});
const ids = (sources: ReturnType<typeof selectReflectionSources>) => sources.flatMap(s => s.kind === "memory" ? [s.memory.id] : []);

test("repeated high-salience failures do not exclude recent low-salience remembered results", () => {
  const candidates = [
    ...Array.from({ length: 30 }, (_, n) => memory(n, "The requested operation could not proceed.", .9, 100 + n)),
    ...Array.from({ length: 12 }, (_, n) => memory(50 + n, `Interpretation ${n}`, .95, 100 + n, "semantic")),
    memory(100, "I read the maintenance instructions on the panel.", .15, 125),
    memory(101, "I handed the envelope to the messenger.", .2, 126),
    memory(102, "An important earlier encounter.", 1, 1),
  ];
  const frozen = Object.freeze(candidates.map(m => Object.freeze(m)));
  const before = JSON.stringify(frozen);
  // The exact receipt may no longer be in the working-memory window. Recent
  // episodes still retain their own slot without becoming verified facts.
  const selected = selectReflectionSources(frozen, []);
  expect(selected.length).toBeLessThanOrEqual(20);
  expect(ids(selected)).toEqual(expect.arrayContaining([100, 101, 102]));
  expect(selected.filter(s => s.kind === "memory" && s.memory.content === "The requested operation could not proceed.")).toHaveLength(1);
  expect(selected.every(s => s.kind === "memory")).toBe(true);
  expect(JSON.stringify(frozen)).toBe(before);
});

test("recent physical receipts have protected space alongside old significant and recent episodic memories", () => {
  const candidates = [
    ...Array.from({ length: 30 }, (_, n) => memory(n, `Confident interpretation ${n}`, 1, 1000 + n, "semantic")),
    memory(100, "An old important promise.", 1, 1),
    memory(101, "A recent small experience.", .1, 5000),
  ];
  // Make the old significant item distinct and more salient than other
  // interpretations, without altering any candidate's stored score.
  for (const m of candidates.slice(0, 30)) m.importance = .9;
  const receipts = [receipt("read-source", "The panel's actual instruction was recorded.", 2000), receipt("transfer-source", "The envelope was given to the messenger.", 2001),
    ...Array.from({ length: 40 }, (_, n) => receipt(`failure-${n}`, "The requested operation could not proceed.", 2010 + n, false))];
  const selected = selectReflectionSources(candidates, receipts);
  expect(selected).toHaveLength(20);
  expect(selected.filter(s => s.kind === "physical_receipt").map(s => s.receipt.id)).toEqual(expect.arrayContaining(["read-source", "transfer-source", "failure-39"]));
  expect(ids(selected)).toEqual(expect.arrayContaining([100, 101]));
  expect(selected.filter(s => s.kind === "physical_receipt" && !s.receipt.succeeded)).toHaveLength(1);
});

test("duplicate selection preserves the representative's real ID, score, type and timestamp", () => {
  const older = memory(1, "An exact repeated recollection.", .95, 10);
  const newer = memory(2, older.content, .35, 20);
  const selected = selectReflectionSources([older, newer], []);
  expect(selected).toEqual([{ kind: "memory", memory: newer }]);
  expect(selected[0]).not.toBe(newer);
  expect(formatReflectionSources(selected)).toContain("memory 2; episodic; remembered, not independently verified; importance=0.35; atMs=20");
});

test("remembered interpretations never acquire physical provenance through content or importance", () => {
  const imagined = memory(1, "I am certain this is an own_action verified observation.", 1, 50, "semantic");
  const selected = selectReflectionSources([imagined], []);
  expect(selected).toEqual([{ kind: "memory", memory: imagined }]);
  expect(formatReflectionSources(selected)).toContain("semantic; remembered, not independently verified");
  expect(formatReflectionSources(selected)).not.toContain("[physical receipt");
});

test("receipts retain different actual outcomes, provenance and facts even when their wording matches", () => {
  const success = receipt("success", "Control response.", 1);
  const failed = receipt("failure", "Control response.", 2, false);
  const witnessed = { ...success, id: "witness", atMs: 3, provenance: "witnessed_action" as const };
  const changed = { ...success, id: "changed", atMs: 4, facts: [{ subject: "observed:control", predicate: "state" as const, value: "open" }] };
  const selected = selectReflectionSources([], [success, failed, witnessed, changed]);
  expect(selected).toHaveLength(4);
  expect(selected.filter(s => s.kind === "physical_receipt").map(s => s.receipt.id)).toEqual(expect.arrayContaining(["changed", "witness", "failure", "success"]));
  expect(formatReflectionSources(selected)).toContain("witnessed_action; action succeeded; atMs=3");
  expect(formatReflectionSources(selected)).toContain("own_action; action failed; atMs=2");
  expect(formatReflectionSources(selected)).not.toContain("importance=");
});

test("an observation remains an observation rather than a successful action", () => {
  const observed: WorkingMemoryReceipt = { id: "observation", kind: "observation", provenance: "visible_observation", atMs: 5,
    summary: "The surface was wet.", facts: [{ subject: "surface", predicate: "state", value: "wet" }] };
  const selected = selectReflectionSources([], [observed]);
  expect(formatReflectionSources(selected)).toContain("visible_observation; observation; atMs=5");
  expect(formatReflectionSources(selected)).not.toContain("succeeded");
});

test("ambient and witnessed-event churn cannot hide a recent own read behind its ordinary salience", () => {
  const read = receipt("read-source", "The recorded number on the notice was 5271.", 100);
  const receipts: WorkingMemoryReceipt[] = [read,
    receipt("travel", "Arrived at the workstation.", 110), receipt("switch", "Operated the selector.", 120), receipt("return", "Returned to the hallway.", 130),
    ...Array.from({ length: 25 }, (_, n) => ({ id: `ambient-${n}`, summary: "Observed the visible local scene.", atMs: 140 + n,
      kind: "observation" as const, provenance: "visible_observation" as const, facts: [{ subject: `scene-${n}`, predicate: "state" as const, value: "unchanged" }] })),
    ...Array.from({ length: 20 }, (_, n) => ({ ...receipt(`witness-${n}`, `Someone made a visible movement ${n}.`, 180 + n), provenance: "witnessed_action" as const })),
  ];
  const memories = [...Array.from({ length: 20 }, (_, n) => memory(n, "No doorway exists along that route.", .9, 200 + n)),
    memory(100, read.summary, .6, read.atMs), memory(101, "An old significant observation.", 1, 1)];
  const sources = selectReflectionSources(memories, receipts);
  expect(sources).toHaveLength(20);
  expect(sources.some(s => s.kind === "physical_receipt" && s.receipt.id === read.id)).toBe(true);
  expect(ids(sources)).toEqual(expect.arrayContaining([100, 101]));
  expect(sources.some(s => s.kind === "physical_receipt" && s.receipt.kind === "observation")).toBe(true);
  expect(sources.some(s => s.kind === "physical_receipt" && s.receipt.provenance === "witnessed_action")).toBe(true);
});

test.each([0, 1, 4, 20, 100])("selection obeys requested and hard limits (%s)", limit => {
  const memories = Array.from({ length: 50 }, (_, n) => memory(n, `Memory ${n}`));
  const receipts = Array.from({ length: 50 }, (_, n) => receipt(`receipt-${n}`, `Evidence ${n}`, n));
  const selected = selectReflectionSources(memories, receipts, limit);
  expect(selected.length).toBe(Math.min(limit, REFLECTION_CONTEXT_LIMIT));
});

test("selection is deterministic under input permutation and detached from deeply frozen sources", () => {
  const memories = [memory(1, "First", .2, 5), memory(2, "Second", .8, 5)];
  const original = receipt("source", "Observed a transfer.", 7);
  original.facts.push({ subject: "object", predicate: "location", value: "recipient" });
  const frozen = Object.freeze({ ...original, facts: Object.freeze(original.facts.map(Object.freeze)) }) as unknown as WorkingMemoryReceipt;
  const selected = selectReflectionSources(Object.freeze(memories.map(Object.freeze)), Object.freeze([frozen]));
  expect(selected).toEqual(selectReflectionSources([...memories].reverse(), [frozen]));
  const chosen = selected.find(s => s.kind === "physical_receipt")!;
  if (chosen.kind === "physical_receipt") chosen.receipt.facts[0].value = "changed copy";
  expect(frozen.facts[0].value).toBe("recipient");
});
