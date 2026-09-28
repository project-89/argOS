import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createObjectEntity, createRoomEntity } from "../../ecs/prefabs";
import { createSpiritRegistry, createSpirit } from "../spirit-registry";
import { captureSpiritPublicEventReview, getSpiritPublicEventReviewStatus, recordSpiritPublicEnvironmentReceipt } from "../spirit-public-event-review";
import { startCommittedEvents, stopCommittedEvents, publishCommittedEvent } from "../../runtime/committed-events";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { recordPrivateCommunication } from "../../cognition/communication-memory";
import { WorkingMemoryIdentity } from "../../ecs/components";

const accepted = { accepted: true, interventions: [] };
function fixture(label = "Town") {
  const world = createArgosWorld(label); initializePrefabs(world); const sourceId = startCommittedEvents(world);
  advanceSimulationTime(world, 1, 1000);
  const room = createRoomEntity(world, { name: `${label} Square` });
  const actor = createAgentEntity(world, { name: `${label} Resident`, role: "neighbor", systemPrompt: "SECRET_IDENTITY", roomId: room });
  const box = createObjectEntity(world, { name: `${label} Box`, roomId: room });
  const registry = createSpiritRegistry(world), definition = { name: "The Narrator", domain: "narrative" as const,
    rank: "archangel" as const, model: "flash" as const, systemPrompt: "Compare outcomes.", observationInterval: 1000 };
  const spirit = createSpirit(registry, definition), other = createSpirit(registry, { ...definition, name: "Other" });
  const capture = (owner = spirit, current = () => true) => captureSpiritPublicEventReview(world, owner, registry, current);
  const receipt = (id: string, action = "examine", status: "pending" | "succeeded" | "failed" = "succeeded", target = box) =>
    publishCommittedEvent(world, { executionId: id, kind: "action", action, actorId: actor, roomId: room, targetId: target, status });
  const say = (id: string, text: string) => publishCommittedEvent(world,
    { executionId: id, kind: "speech", action: "speak", actorId: actor, roomId: room, status: "succeeded", text });
  const environment = (id: string) => recordSpiritPublicEnvironmentReceipt(world,
    { id, atSimMs: world.time.elapsed, roomId: room, detail: "Rain is falling in the square." });
  const advance = (ms: number) => advanceSimulationTime(world, world.time.tick + 1, ms);
  return { world, sourceId, room, actor, box, registry, spirit, other, capture, receipt, say, environment, advance };
}
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Progress tests must remain offline")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("a fully retained public tape is not a complete inactivity meter", () => {
  const f = fixture(); f.advance(30_000);
  const progress = f.capture().input.progress;
  expect(progress).toMatchObject({
    completeness: { complete: true },
    coverage: {
      basis: "published_public_receipts_only",
      allActivityRepresented: false,
      zeroCountsProveInactivity: false,
      note: expect.stringContaining("wait/rest"),
    },
    rolling: { physicalCompletions: 0, waitOrRestCompletions: 0 },
  });
  expect(Object.isFrozen(progress.coverage)).toBe(true);
});

test("repeated inspections remain activity, not new discoveries or speech-backed physical changes", () => {
  const f = fixture(), first = f.receipt("look-1"), initial = f.capture();
  expect(initial.input.progress).toMatchObject({ previousAcceptedAtSimMs: null, sincePreviousAcceptedSimMs: null,
    inspectionContents: "not_available_in_public_action_receipts", rolling: { inspectionCompletions: 1 } });
  expect(initial.finish({ ...accepted, phase: "rising", tension: .9 })).toBe(true);
  f.advance(30_000); const second = f.receipt("look-2", "observe");
  f.say("claim", "The roof collapsed and the box was forced open."); f.receipt("wait", "wait");
  const progress = f.capture().input.progress;
  expect(progress).toMatchObject({ observedAtSimMs: 31_000, previousAcceptedAtSimMs: 1000, sincePreviousAcceptedSimMs: 30_000,
    rolling: { inspectionCompletions: 2, physicalCompletions: 0, spokenExecutions: 1, waitOrRestCompletions: 1, environmentChanges: 0 },
    sinceReview: { inspectionCompletions: 1 }, completeness: { complete: true } });
  expect(progress.patterns.find(row => row.category === "inspection")).toMatchObject({ completedExecutions: 2,
    currentReviewExecutions: 1, firstAtSimMs: 1000, lastAtSimMs: 31_000, receiptIds: [first.id, second.id] });
  expect(JSON.stringify(progress)).not.toMatch(/collapsed|forced open|rising|SECRET_IDENTITY/);
});

test("actual native effects, terminal physical outcomes and pending work remain distinct", () => {
  const f = fixture(); f.receipt("opening", "interact", "pending");
  f.receipt("failed", "pickup", "failed"); f.environment("rain:1");
  let review = f.capture(); expect(review.input.progress.rolling).toMatchObject({ pendingOutcomes: 1, physicalCompletions: 0,
    failedActions: 1, environmentChanges: 1 }); review.finish(accepted);
  f.advance(1000); f.receipt("opening", "interact"); f.receipt("walking", "move", "pending");
  review = f.capture(); expect(review.input.progress.rolling).toMatchObject({ pendingOutcomes: 1,
    physicalCompletions: 1, failedActions: 1, environmentChanges: 1 });
  expect(review.input.progress.sinceReview).toMatchObject({ physicalCompletions: 1, environmentChanges: 0 });
});

test("speech slices and completion metadata count one utterance without inventing private observations", () => {
  const f = fixture(); f.say("one-turn", "I suspect"); f.say("one-turn", "someone tampered with it.");
  publishCommittedEvent(f.world, { executionId: "one-turn", kind: "action", action: "speak", actorId: f.actor, roomId: f.room, status: "succeeded" });
  recordPrivateCommunication(f.world, f.actor, { sourceId: f.sourceId, messageKey: "private", channel: "phone", kind: "sent",
    other: "Sibling", content: "SECRET_UNREAD_ACCOUNT", sentAtSimMs: 1000 });
  const progress = f.capture().input.progress;
  expect(progress.rolling).toMatchObject({ spokenExecutions: 1, physicalCompletions: 0, inspectionCompletions: 0 });
  expect(progress.patterns).toEqual([]);
  expect(JSON.stringify(progress)).not.toMatch(/SECRET|suspect|tampered|Sibling/);
});

test("failed reviews do not advance comparison, while success uses capture time rather than model completion time", () => {
  const f = fixture(); f.receipt("look"); const first = f.capture(); f.advance(4000);
  first.finish({ ...accepted, accepted: false });
  const retry = f.capture(); expect(retry.input.progress.previousAcceptedAtSimMs).toBeNull();
  f.advance(4000); retry.finish(accepted); f.receipt("later");
  expect(getSpiritPublicEventReviewStatus(f.world, f.spirit)).toMatchObject({ observedAtSimMs: 5000,
    atSimMs: 9000, observationAgeSimMs: 4000 });
  const next = f.capture().input.progress;
  expect(next).toMatchObject({ observedAtSimMs: 9000, previousAcceptedAtSimMs: 5000, sincePreviousAcceptedSimMs: 4000,
    rolling: { inspectionCompletions: 2 }, sinceReview: { inspectionCompletions: 1 } });
});

test("events arriving during inference remain new next time and captured progress is immutable", () => {
  const f = fixture(); f.receipt("before"); const first = f.capture();
  f.advance(1000); f.receipt("during"); first.finish(accepted);
  expect(first.input.progress.rolling.inspectionCompletions).toBe(1);
  expect(Object.isFrozen(first.input.progress.patterns[0])).toBe(true);
  expect(Object.isFrozen(first.input.progress.patterns[0].receiptIds)).toBe(true);
  expect(f.capture().input.progress).toMatchObject({ rolling: { inspectionCompletions: 2 }, sinceReview: { inspectionCompletions: 1 } });
});

test.each(["superseded", "cycle-stale", "stopped"])("%s inference cannot install a progress baseline", change => {
  const f = fixture(); f.receipt("first"); let current = true; const first = f.capture(f.spirit, () => current);
  if (change === "superseded") f.capture();
  if (change === "cycle-stale") current = false;
  if (change === "stopped") stopCommittedEvents(f.world);
  expect(first.finish(accepted)).toBe(false);
  expect(f.capture().input.progress.previousAcceptedAtSimMs).toBeNull();
});

test("worlds, source restarts, replacement spirits and independent reviewers do not share progress", () => {
  const a = fixture("A"), b = fixture("B"); a.receipt("one"); a.capture().finish(accepted);
  expect(b.capture().input.progress.rolling.inspectionCompletions).toBe(0);
  expect(a.capture(a.other).input.progress.previousAcceptedAtSimMs).toBeNull();
  const replacement = { ...a.spirit }; a.registry.spirits.set(a.spirit.eid, replacement);
  expect(a.capture(replacement).input.progress.previousAcceptedAtSimMs).toBeNull();
  stopCommittedEvents(a.world); startCommittedEvents(a.world);
  expect(a.capture(replacement).input.progress).toMatchObject({ previousAcceptedAtSimMs: null, rolling: { inspectionCompletions: 0 } });
});

test("immutable target identity distinguishes a new object from repetition at a reused slot", () => {
  const f = fixture(); f.receipt("one"); f.capture().finish(accepted);
  WorkingMemoryIdentity.id[f.box] = "replacement-target"; f.receipt("two");
  const patterns = f.capture().input.progress.patterns;
  expect(patterns).toHaveLength(2); expect(patterns.every(row => row.completedExecutions === 1)).toBe(true);
});

test("comparison retention and elapsed interval use simulation time, never wall or inference latency", () => {
  const f = fixture(); f.receipt("first"); f.environment("rain"); f.capture().finish(accepted);
  jest.spyOn(Date, "now").mockReturnValue(Date.now() + 86_400_000);
  expect(f.capture().input.progress).toMatchObject({ sincePreviousAcceptedSimMs: 0,
    rolling: { inspectionCompletions: 1, environmentChanges: 1 } });
  f.advance(120_001);
  expect(f.capture().input.progress).toMatchObject({ windowStartSimMs: 1001, sincePreviousAcceptedSimMs: 120_001,
    rolling: { inspectionCompletions: 0, environmentChanges: 0 }, completeness: { complete: true } });
});

test("bounded execution retention remains explicit until its simulated window expires", () => {
  const f = fixture(); for (let i = 0; i < 260; i++) f.receipt(`look:${i}`);
  const first = f.capture();
  expect(first.input.progress).toMatchObject({ rolling: { inspectionCompletions: 256 }, completeness: { complete: false, rollingRetentionLoss: true } });
  first.finish(accepted);
  expect(f.capture().input.progress.completeness.rollingRetentionLoss).toBe(true);
  f.advance(120_001); expect(f.capture().input.progress.completeness.complete).toBe(true);
});

test("summary row omissions do not pretend that the other completed actions were absent", () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) f.receipt(`inspect:${i}`, "examine", "succeeded",
    createObjectEntity(f.world, { name: `Object ${i}`, roomId: f.room }));
  const progress = f.capture().input.progress;
  expect(progress.rolling.inspectionCompletions).toBe(20); expect(progress.patterns).toHaveLength(16);
  expect(progress.completeness).toMatchObject({ complete: false, patternRowsOmitted: 4, rollingRetentionLoss: false });
});

test("native event and environment ledger loss cannot be called a quiet complete history", () => {
  const f = fixture(); for (let i = 0; i < 2050; i++) f.receipt(`event:${i}`);
  for (let i = 0; i < 130; i++) f.environment(`rain:${i}`);
  expect(f.capture().input.progress.completeness).toMatchObject({ complete: false, eventLedgerGap: true,
    environmentLedgerGap: true, rollingRetentionLoss: true });
});

test("rewound simulation time resets comparison rather than publishing a negative review interval", () => {
  const f = fixture(); f.capture().finish(accepted); f.world.time.elapsed = 0;
  expect(f.capture().input.progress).toMatchObject({ observedAtSimMs: 0, previousAcceptedAtSimMs: null, sincePreviousAcceptedSimMs: null });
});

test("review counts preserve older unacknowledged outcomes while rolling counts have an explicit shorter window", () => {
  const f = fixture(); f.capture().finish(accepted); f.receipt("earlier"); f.environment("earlier-rain");
  f.advance(120_001);
  expect(f.capture().input.progress).toMatchObject({ windowStartSimMs: 1001, sincePreviousAcceptedSimMs: 120_001,
    sinceReview: { inspectionCompletions: 1, environmentChanges: 1 }, rolling: { inspectionCompletions: 0, environmentChanges: 0 } });
});

test("arrival in a different room resolves the same public movement execution", () => {
  const f = fixture(), destination = createRoomEntity(f.world, { name: "Destination" });
  f.receipt("walk", "move", "pending", destination); f.capture().finish(accepted); f.advance(1000);
  publishCommittedEvent(f.world, { executionId: "walk", kind: "action", action: "move", actorId: f.actor,
    roomId: destination, targetId: destination, status: "succeeded" });
  const progress = f.capture().input.progress;
  expect(progress.rolling).toMatchObject({ pendingOutcomes: 0, physicalCompletions: 1 });
  expect(progress.patterns[0]).toMatchObject({ roomName: "Destination", completedExecutions: 1 });
});

test("duplicate completion metadata and continued speech slices do not become newly completed actions", () => {
  const f = fixture(); f.receipt("inspection"); f.say("speech", "A first phrase."); f.capture().finish(accepted);
  f.advance(1000); f.receipt("inspection"); f.say("speech", "A later phrase from the same turn.");
  const progress = f.capture().input.progress;
  expect(progress).toMatchObject({ rolling: { inspectionCompletions: 1, spokenExecutions: 1 },
    sinceReview: { inspectionCompletions: 0, spokenExecutions: 0 } });
  expect(progress.patterns[0].currentReviewExecutions).toBe(0);
});

test("diagnostics separately preserve IDs actually visible in rolling patterns from an earlier accepted review", () => {
  const f = fixture(), event = f.receipt("earlier"); f.capture().finish(accepted); f.advance(1000);
  const review = f.capture(); review.finish(accepted);
  expect(getSpiritPublicEventReviewStatus(f.world, f.spirit)).toMatchObject({ receiptIdsObserved: [],
    progressReceiptIdsObserved: [event.id], progressReceiptIdsOmitted: 0 });
});

test("rewinding while inference is in flight cannot commit a future-dated baseline", () => {
  const f = fixture(), review = f.capture(); f.world.time.elapsed = 0;
  expect(review.finish(accepted)).toBe(false);
  expect(getSpiritPublicEventReviewStatus(f.world, f.spirit)).toBeUndefined();
  expect(f.capture().input.progress.previousAcceptedAtSimMs).toBeNull();
});
