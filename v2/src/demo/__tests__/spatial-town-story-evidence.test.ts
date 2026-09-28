import { evaluateTownStoryEvidence, matchesStoryClearingMemory, type TownStoryEvidenceInput } from "../spatial-town-story-evidence";
import type { PublicCommittedEvent } from "../../runtime/committed-events";
import type { SpiritPublicEventReviewStatus } from "../../spirits/spirit-public-event-review";
import type { WorkingMemoryReceipt } from "../../cognition/working-memory";

function review(atSimMs: number, receiptIdsObserved: string[]): SpiritPublicEventReviewStatus {
  return { sourceId: "world-a", sourceStopped: false, atSimMs, accepted: true,
    observedAtSimMs: atSimMs, observationAgeSimMs: 0, progressReceiptIdsObserved: [], progressReceiptIdsOmitted: 0,
    acknowledgedThroughSequence: 2, observedThroughSequence: 2,
    acknowledgedEnvironmentThroughSequence: 2, observedEnvironmentThroughSequence: 2,
    receiptIdsObserved, receiptIdsOmitted: 0, droppedBeforeWindow: 0, omittedRecords: 0,
    omittedReceipts: 0, environmentDroppedBeforeWindow: 0, environmentOmittedReceipts: 0,
    interventionsRequested: 0, interventionResults: [], phase: "rising", tension: .4 };
}
function fixture(): TownStoryEvidenceInput {
  const event: PublicCommittedEvent = { id: "response", sourceId: "world-a", sequence: 2,
    tick: 100, atSimMs: 10000, executionId: "clear-native", kind: "action", actorId: 8, actorKey: "resident-a",
    roomId: 4, roomKey: "park", action: "interact", status: "succeeded", targetId: 5,
    targetKey: "tree-a", startedAtSimMs: 3000, completedAtSimMs: 10000 };
  const native = { actorKey: "resident-a", targetKey: "tree-a", targetState: "pruned", targetRevision: 2,
    targetPresent: true, atTarget: true, memoryRecorded: true };
  return { sourceId: "world-a", initialTrees: [{ id: 5, key: "tree-a" }], changes: [
    { sourceId: "world-a", targetKey: "tree-a", change: { id: "story:5:1:tree_damage", atSimMs: 2000,
      spirit: "The Narrator", status: "applied", summary: "Native branch damage" } },
    { sourceId: "world-a", targetKey: "tree-a", change: { id: "story:5:2:tree_cleared", atSimMs: 10000,
      spirit: "Residents", status: "applied", summary: "Native branch clearing" } },
  ], receipts: [
    { event: { ...event, id: "approach", status: "pending", sequence: 1, tick: 30, atSimMs: 3000,
      completedAtSimMs: undefined }, native: { ...native, targetState: "branch_damage", targetRevision: 1,
      atTarget: false, memoryRecorded: false } },
    { event, native },
  ], reviews: [review(12000, ["story:5:1:tree_damage", "story:5:2:tree_cleared", "response"])],
  endTrees: [{ id: 5, key: "tree-a", phase: "pruned", revision: 2 }] };
}

function ownMemory(): WorkingMemoryReceipt {
  return { id: "action:own-native-outcome:0", atMs: 50000, kind: "action", provenance: "own_action",
    summary: "I cleared the loose branches.", succeeded: true,
    action: { type: "interact", targetKey: "tree-a", content: "clear_branches" }, completedAtSimMs: 10000, facts: [] };
}
test.each(["clear_branches", " Clear_branches ", "CLEAR_BRANCHES", "clear_branches by hand", "clear_branches\ncarefully"])(
  "memory observer matches native host normalization for %j", content => {
    const memory = ownMemory(); memory.action!.content = content;
    expect(matchesStoryClearingMemory(fixture().receipts[1].event, memory)).toBe(true);
  });
test("memory observer supports native use with exact matching action type", () => {
  const memory = ownMemory(); memory.action!.type = "use";
  const event = { ...fixture().receipts[1].event, action: "use" };
  expect(matchesStoryClearingMemory(event, memory)).toBe(true);
  memory.action!.type = "interact";
  expect(matchesStoryClearingMemory(event, memory)).toBe(false);
});
test.each<[string, (receipt: WorkingMemoryReceipt) => void]>([
  ["observation", receipt => { receipt.kind = "observation"; }],
  ["witness evidence", receipt => { receipt.provenance = "witnessed_action"; }],
  ["failed action", receipt => { receipt.succeeded = false; }],
  ["other action type", receipt => { receipt.action!.type = "observe"; }],
  ["other target", receipt => { receipt.action!.targetKey = "tree-b"; }],
  ["other completion time", receipt => { receipt.completedAtSimMs = 9999; }],
  ["missing action", receipt => { receipt.action = undefined; }],
  ["missing command", receipt => { receipt.action!.content = undefined; }],
  ["other command", receipt => { receipt.action!.content = "examine clear_branches"; }],
  ["partial token", receipt => { receipt.action!.content = "clear_branches_else"; }],
  ["blank command", receipt => { receipt.action!.content = " "; }],
])("memory observer rejects %s", (_name, mutate) => {
  const receipt = ownMemory(); mutate(receipt);
  expect(matchesStoryClearingMemory(fixture().receipts[1].event, receipt)).toBe(false);
});
test.each<Partial<PublicCommittedEvent>>([
  { kind: "speech" }, { action: "observe" }, { status: "pending" }, { status: "failed" },
  { targetKey: undefined }, { completedAtSimMs: undefined }, { completedAtSimMs: 10001 }, { atSimMs: Number.NaN },
])("memory observer rejects uncompleted or mismatched public event %j", patch => {
  expect(matchesStoryClearingMemory({ ...fixture().receipts[1].event, ...patch }, ownMemory())).toBe(false);
});

test("credits only the complete native story loop while retaining larger open gates", () => {
  const result = evaluateTownStoryEvidence(fixture());
  expect(result).toMatchObject({ completeNativeStoryLoopObserved: true, baselineAndEndurance: "OPEN",
    constructionUnder100ms: "NOT_ASSESSED_BY_THIS_CHECK",
    passingChains: [{ treeId: 5, treeKey: "tree-a", actorKey: "resident-a", responseEventId: "response" }] });
  expect(Object.values(result.gates).every(Boolean)).toBe(true);
});
test("native use is accepted only when its admission and completion name the same action", () => {
  const input = fixture(); input.receipts = input.receipts.map(row => ({ ...row, event: { ...row.event, action: "use" } }));
  expect(evaluateTownStoryEvidence(input).completeNativeStoryLoopObserved).toBe(true);
  input.receipts[0].event = { ...input.receipts[0].event, action: "interact" };
  expect(evaluateTownStoryEvidence(input).completeNativeStoryLoopObserved).toBe(false);
});

const faults: Array<[string, (input: TownStoryEvidenceInput) => void]> = [
  ["foreign damage source", input => { input.changes[0].sourceId = "world-b"; }],
  ["foreign clear source", input => { input.changes[1].sourceId = "world-b"; }],
  ["foreign action source", input => { input.receipts[1].event = { ...input.receipts[1].event, sourceId: "world-b" }; }],
  ["foreign review source", input => { input.reviews = [{ ...input.reviews[0], sourceId: "world-b" }]; }],
  ["replaced damage tree", input => { input.changes[0].targetKey = "replacement"; }],
  ["replaced clear tree", input => { input.changes[1].targetKey = "replacement"; }],
  ["replaced action tree", input => { input.receipts[1].event = { ...input.receipts[1].event, targetKey: "replacement" }; }],
  ["replaced native tree", input => { input.receipts[1].native.targetKey = "replacement"; }],
  ["replaced final tree", input => { input.endTrees = [{ ...input.endTrees[0], key: "replacement" }]; }],
  ["replaced actor", input => { input.receipts[1].native.actorKey = "replacement"; }],
  ["wrong clear tree id", input => { input.changes[1].change.id = "story:6:2:tree_cleared"; }],
  ["wrong damage producer", input => { input.changes[0].change.spirit = "Operator"; }],
  ["proposed damage", input => { input.changes[0].change.status = "proposed"; }],
  ["failed clearing", input => { input.changes[1].change.status = "failed"; }],
  ["approach only", input => { input.receipts = input.receipts.slice(0, 1); }],
  ["observation not repair", input => { input.receipts[1].event = { ...input.receipts[1].event, action: "observe" }; }],
  ["failed action", input => { input.receipts[1].event = { ...input.receipts[1].event, status: "failed" }; }],
  ["missing admission", input => { input.receipts = input.receipts.slice(1); }],
  ["different admitted execution", input => { input.receipts[0].event = { ...input.receipts[0].event, executionId: "different" }; }],
  ["wrong target at admission", input => { input.receipts[0].event = { ...input.receipts[0].event, targetKey: "replacement" }; }],
  ["not at tree", input => { input.receipts[1].native.atTarget = false; }],
  ["tree absent", input => { input.receipts[1].native.targetPresent = false; }],
  ["not pruned at receipt", input => { input.receipts[1].native.targetState = "branch_damage"; }],
  ["wrong revision", input => { input.receipts[1].native.targetRevision = 1; }],
  ["no own-action memory", input => { input.receipts[1].native.memoryRecorded = false; }],
  ["only a review count", input => { input.reviews = [{ ...input.reviews[0], receiptIdsObserved: [] }]; }],
  ["failed review", input => { input.reviews = [{ ...input.reviews[0], accepted: false }]; }],
  ["stopped source review", input => { input.reviews = [{ ...input.reviews[0], sourceStopped: true }]; }],
  ["unacknowledged public event", input => { input.reviews = [{ ...input.reviews[0], acknowledgedThroughSequence: 1 }]; }],
  ["unacknowledged environment", input => { input.reviews = [{ ...input.reviews[0], acknowledgedEnvironmentThroughSequence: 1 }]; }],
  ["review before clearing", input => { input.reviews = [{ ...input.reviews[0], atSimMs: 9000 }]; }],
  ["review same time as clearing", input => { input.reviews = [{ ...input.reviews[0], atSimMs: 10000 }]; }],
  ["clearing before damage", input => { input.changes[0].change.atSimMs = 11000; }],
  ["action starts before damage", input => { input.changes[0].change.atSimMs = 4000; }],
  ["clear differs from committed completion", input => { input.changes[1].change.atSimMs = 10001; }],
  ["less than six native seconds", input => {
    input.receipts = input.receipts.map(row => ({ ...row, event: { ...row.event, startedAtSimMs: 5000,
      ...(row.event.status === "pending" ? { atSimMs: 5000 } : {}) } }));
  }],
  ["invalid action interval", input => { input.receipts[1].event = { ...input.receipts[1].event, completedAtSimMs: 11000 }; }],
  ["invalid event ordering", input => { input.receipts[0].event = { ...input.receipts[0].event, sequence: 3 }; }],
  ["no stable starting identity", input => { input.initialTrees = []; }],
  ["duplicate initial IDs", input => { input.initialTrees = [...input.initialTrees, { id: 5, key: "other-tree" }]; }],
];
test.each(faults)("does not pass %s", (_name, mutate) => {
  const input = fixture(); mutate(input);
  expect(evaluateTownStoryEvidence(input).completeNativeStoryLoopObserved).toBe(false);
});

test("separate later accepted reviews can observe environment and action receipts", () => {
  const input = fixture(); input.reviews = [review(2500, ["story:5:1:tree_damage"]),
    review(12000, ["story:5:2:tree_cleared"]), review(14000, ["response"])];
  expect(evaluateTownStoryEvidence(input).completeNativeStoryLoopObserved).toBe(true);
});
test("one receipt omitted from reviews remains an open feedback gate", () => {
  const input = fixture(); input.reviews = [review(12000, ["story:5:1:tree_damage", "story:5:2:tree_cleared"])];
  expect(evaluateTownStoryEvidence(input).gates).toMatchObject({ autonomousNativeResponse: true,
    narratorObservedDamage: true, narratorObservedOutcome: false });
});
test("a pruned tree alone proves neither resident action nor source of damage", () => {
  const input = fixture(); input.receipts = []; input.changes = [];
  expect(evaluateTownStoryEvidence(input).gates).toMatchObject({ nativeNarratorDamage: false,
    nativeResidentClearing: false, autonomousNativeResponse: false, terminalNativeConsequence: false });
});
test("retains failure evidence even when a separate attempt closes the loop", () => {
  const input = fixture();
  input.receipts = [...input.receipts, { ...input.receipts[1], event: { ...input.receipts[1].event, id: "failed-action", status: "failed" } }];
  input.changes = [...input.changes, { ...input.changes[0], change: { ...input.changes[0].change, id: "rejected-change", status: "rejected" } }];
  input.reviews = [...input.reviews, { ...review(5000, []), accepted: false }];
  const before = structuredClone(input), result = evaluateTownStoryEvidence(input);
  expect(result).toMatchObject({ completeNativeStoryLoopObserved: true, failedEvidence: {
    receiptIds: ["failed-action"], changeIds: ["rejected-change"], reviewAtSimMs: [5000] } });
  expect(input).toEqual(before);
});
test("cannot assemble a passing loop from unrelated trees' partial successes", () => {
  const first = fixture(), second = fixture();
  second.initialTrees = [{ id: 6, key: "tree-b" }]; second.endTrees = [{ id: 6, key: "tree-b", phase: "pruned", revision: 2 }];
  second.changes = second.changes.map(row => ({ ...row, targetKey: "tree-b", change: { ...row.change,
    id: row.change.id.replace("story:5:", "story:6:") } }));
  second.receipts = second.receipts.map(row => ({ event: { ...row.event, id: `${row.event.id}-b`,
    executionId: "clear-native-b", targetId: 6, targetKey: "tree-b" }, native: { ...row.native, targetKey: "tree-b" } }));
  first.receipts[1].native.memoryRecorded = false;
  const input = { ...first, initialTrees: [...first.initialTrees, ...second.initialTrees],
    endTrees: [...first.endTrees, ...second.endTrees], changes: [...first.changes, ...second.changes],
    receipts: [...first.receipts, ...second.receipts] };
  const result = evaluateTownStoryEvidence(input);
  expect(Object.values(result.gates).every(Boolean)).toBe(true);
  expect(result.completeNativeStoryLoopObserved).toBe(false);
  expect(result.passingChains).toEqual([]);
});
