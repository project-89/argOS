import { evaluateHouseholdEvidence, matchesHouseholdOwnActionMemory, type HouseholdEvidenceInput,
  type HouseholdReceiptEvidence } from "../spatial-household-evidence";
import type { PublicCommittedEvent } from "../../runtime/committed-events";
import { jest } from "@jest/globals";

function fixture(): HouseholdEvidenceInput {
  const names = ["Tess", "Ivo", "Noor", "Mara"];
  const base = (actorId: number, targetId: number, roomId: number, executionId: string, start: number, at: number,
    status: "pending" | "succeeded", seq: number, operation: "eating" | "inspecting"): PublicCommittedEvent => ({
    id: `${executionId}:${status}`, sourceId: "house", sequence: seq, tick: seq, executionId,
    kind: "action", action: "interact", status, actorId, actorKey: `actor:${actorId}`, roomId,
    roomKey: `room:${roomId}`, targetId, targetKey: `prop:${targetId}`, operation,
    startedAtSimMs: start, atSimMs: at, ...(status === "succeeded" ? { completedAtSimMs: at } : {}),
  });
  const rows: HouseholdReceiptEvidence[] = [
    { event: base(1, 200, 101, "meal", 5000, 5000, "pending", 1, "eating"), capturedAtSimMs: 5000,
      native: { sourceId: "house", actorKey: "actor:1", targetKey: "prop:200", targetPresent: true,
        sittingOn: [], actorRoomId: 101, hunger: 70 } },
    { event: base(1, 200, 101, "meal", 5000, 8000, "succeeded", 2, "eating"), capturedAtSimMs: 8000,
      native: { sourceId: "house", actorKey: "actor:1", targetKey: "prop:200", targetPresent: false,
        targetRemoved: true, sittingOn: [], actorRoomId: 101, hunger: 35 },
      memory: { sourceId: "house", actorKey: "actor:1", capturedAtSimMs: 8000, receipts: [{
        id: "private-meal-receipt", atMs: 999_000, kind: "action", provenance: "own_action", succeeded: true,
        action: { type: "interact", targetKey: "prop:200", content: "eat" }, completedAtSimMs: 8000,
        executionContext: { startedAtSimMs: 5000, purpose: "PRIVATE_PURPOSE", intention: { key: "goal:new", description: "PRIVATE_GOAL" } },
        summary: "PRIVATE_MEMORY", facts: [{ subject: "prop:200", predicate: "state", slot: "Entity.lifecycle", value: "removed" }],
      }] } },
    { event: base(2, 202, 102, "seat", 9000, 9000, "pending", 3, "inspecting"), capturedAtSimMs: 9000,
      native: { sourceId: "house", actorKey: "actor:2", targetKey: "prop:202", targetPresent: true,
        targetState: "empty", sittingOn: [], actorRoomId: 102 } },
    { event: base(2, 202, 102, "seat", 9000, 10000, "succeeded", 4, "inspecting"), capturedAtSimMs: 10000,
      native: { sourceId: "house", actorKey: "actor:2", targetKey: "prop:202", targetPresent: true,
        targetState: "occupied", sittingOn: [202], actorRoomId: 102 } },
  ];
  // Consumed entities retain historical targetKey, not a live ECS targetId.
  rows[1].event = { ...rows[1].event, targetId: undefined };
  return { sourceId: "house", endAtSimMs: 120_000,
    initial: { atSimMs: 0, residents: names.map((name, i) => ({ id: i + 1, key: `actor:${i + 1}`, name,
      openingGoal: { id: i + 31, key: `goal:${i + 31}` }, identityCounts: { memories: 3, motivations: 2, relationships: 0 } })),
      rooms: ["household-sitting-room", "household-kitchen", "household-patio"].map((scenarioId, i) => ({ scenarioId, id: i + 100, key: `room:${i + 100}` })),
      objects: ["household-apple-pastry", "household-pear-pastry", "household-patio-chair"].map((scenarioId, i) => ({ scenarioId,
        id: i + 200, key: `prop:${i + 200}`, roomId: i === 2 ? 102 : 101 })), narrator: { id: 40, key: "narrator:40" } },
    receipts: rows,
    goalSamples: [{ sourceId: "house", atSimMs: 1500, actorKey: "actor:1", goals: [
      { id: 31, key: "goal:31", createdAtSimMs: 0, status: "paused", source: "personal", mode: "exploratory", persistence: "episodic", reason: "PRIVATE_REVIEW" },
      { id: 35, key: "goal:new", createdAtSimMs: 1000, status: "active", source: "autonomous", mode: "verified", persistence: "episodic" },
    ] }],
    weather: [{ sourceId: "house", capturedAtSimMs: 20000, receiptId: "weather:102:1", spirit: "The Narrator",
      receipt: { status: "applied", detail: "Rain begins on the patio.", roomId: 102, condition: "rain", atSimMs: 20000, revision: 1 },
      native: { roomKey: "room:102", condition: "rain", revision: 1 } }],
    narratorReviews: [{ sourceId: "house", capturedAtSimMs: 31000, narratorId: 40, narratorKey: "narrator:40", status: {
      sourceId: "house", sourceStopped: false, atSimMs: 30000, accepted: true,
      observedAtSimMs: 30000, observationAgeSimMs: 0, progressReceiptIdsObserved: [], progressReceiptIdsOmitted: 0,
      observedThroughSequence: 4, acknowledgedThroughSequence: 4, observedEnvironmentThroughSequence: 1, acknowledgedEnvironmentThroughSequence: 1,
      receiptIdsObserved: ["weather:102:1", "seat:succeeded"], receiptIdsOmitted: 0, droppedBeforeWindow: 0,
      omittedRecords: 0, omittedReceipts: 0, environmentDroppedBeforeWindow: 0, environmentOmittedReceipts: 0,
      interventionsRequested: 0, interventionResults: [],
    } }],
  };
}

test("separates authored seeds, committed effects and subsequent intention/feedback evidence", () => {
  expect(evaluateHouseholdEvidence(fixture())).toMatchObject({ boundedHouseholdChainObserved: true,
    gates: { seed: { exactFourResidentFixture: true, authoredMemoriesAndMotivations: true },
      mechanical: { nativeMeal: true, nativeSeating: true, nativeRoomChange: false, ownActionMemory: true },
      behavioral: { multipleResidentsPhysicallyActed: true, newPersonalIntentionCreated: true, newPersonalIntentionEnacted: true,
        narratorChangedNativeWeather: true, narratorObservedExactWeatherReceipt: true, narratorObservedExactResidentOutcome: true } },
    learning: "NOT_PROVEN", weatherCausedBehavior: "NOT_PROVEN", baselineAndEndurance: "OPEN" });
});

test("a rich seed alone, narrator prose or a failed action is not a successful simulation", () => {
  const input = fixture(); input.receipts = []; input.goalSamples = []; input.weather = [];
  const result = evaluateHouseholdEvidence(input);
  expect(result.gates.seed.authoredMemoriesAndMotivations).toBe(true);
  expect(Object.values(result.gates.mechanical).every(v => !v)).toBe(true);
  expect(Object.values(result.gates.behavioral).every(v => !v)).toBe(true);
  expect(result.boundedHouseholdChainObserved).toBe(false);
});

test("the one-portion challenge must be explicitly labeled and cannot silently loosen baseline gates", () => {
  const input = fixture(); input.initial.objects = input.initial.objects.filter(o => o.scenarioId !== "household-apple-pastry");
  expect(evaluateHouseholdEvidence(input).gates.seed.exactFourResidentFixture).toBe(false);
  input.profile = "challenge";
  const result = evaluateHouseholdEvidence(input);
  expect(result.gates.seed.exactFourResidentFixture).toBe(true);
  // The deleted fixture's meal receipt is not valid evidence for this cohort.
  expect(result.gates.mechanical.nativeMeal).toBe(false);
  expect(result.boundedHouseholdChainObserved).toBe(false);
  input.profile = "evening";
  expect(evaluateHouseholdEvidence(input).gates.seed.exactFourResidentFixture).toBe(false);
  const wrong = fixture(); wrong.profile = "challenge";
  expect(evaluateHouseholdEvidence(wrong).gates.seed.exactFourResidentFixture).toBe(false);
});

function challengeTransitionFixture(verb: "open" | "close" | "pickup"): HouseholdEvidenceInput {
  const input = fixture(); input.profile = "challenge";
  input.initial.objects = [...input.initial.objects.filter(o => o.scenarioId !== "household-apple-pastry"),
    { id: 203, key: "prop:203", scenarioId: "household-empty-box", roomId: 101 },
    { id: 204, key: "prop:204", scenarioId: "tess-phone", roomId: 100 },
    { id: 205, key: "prop:205", scenarioId: "household-phone-table", roomId: 100 }];
  const targetId = verb === "pickup" ? 204 : 203, targetKey = `prop:${targetId}`;
  const roomId = verb === "pickup" ? 100 : 101, action = verb === "pickup" ? "pickup" : "interact";
  for (const [i, row] of input.receipts.slice(0, 2).entries()) {
    row.event = { ...row.event, id: `transition:${i === 0 ? "pending" : "succeeded"}`, executionId: "transition",
      targetId, targetKey, roomId, roomKey: `room:${roomId}`, action, operation: undefined };
    row.native = { sourceId: input.sourceId, actorKey: "actor:1", targetKey, targetPresent: true,
      actorRoomId: roomId, sittingOn: [],
      targetContainerKey: verb === "pickup" ? (i === 0 ? "prop:205" : "actor:1") : "room:101",
      targetState: verb === "pickup" ? "normal" : (i === 0 ? (verb === "open" ? "closed" : "open") : (verb === "open" ? "open" : "closed")) };
  }
  input.receipts[1].memory!.receipts[0].action = { type: action, targetKey, content: verb };
  return input;
}

test.each(["open", "close", "pickup"] as const)("challenge %s requires a native transition and can enact an exact new intention", verb => {
  const result = evaluateHouseholdEvidence(challengeTransitionFixture(verb));
  expect(result.gates.mechanical.nativeMeal).toBe(false);
  expect(result.gates.mechanical.ownActionMemory).toBe(true);
  expect(result.gates.behavioral.multipleResidentsPhysicallyActed).toBe(true);
  expect(result.enactedIntentions).toEqual([{ actorKey: "actor:1", goalKey: "goal:new", eventId: "transition:succeeded" }]);
  expect(result.boxTransitionEventIds).toEqual(verb === "pickup" ? [] : ["transition:succeeded"]);
  expect(result.phonePickupEventIds).toEqual(verb === "pickup" ? ["transition:succeeded"] : []);
  expect(result.boundedHouseholdChainObserved).toBe(true);
});

test.each(["open", "close", "pickup"] as const)("the original baseline does not count challenge-only %s evidence", verb => {
  const input = challengeTransitionFixture(verb); input.profile = "evening";
  input.initial.objects = [...input.initial.objects, { id: 200, key: "prop:200", scenarioId: "household-apple-pastry", roomId: 101 }];
  const result = evaluateHouseholdEvidence(input);
  expect(result.gates.seed.exactFourResidentFixture).toBe(true);
  expect(result.boxTransitionEventIds).toEqual([]);
  expect(result.phonePickupEventIds).toEqual([]);
  expect(result.actorKeysWithPhysicalOutcomes).toEqual(["actor:2"]);
  expect(result.gates.behavioral.newPersonalIntentionEnacted).toBe(false);
  expect(result.boundedHouseholdChainObserved).toBe(false);
});

describe.each(["open", "close", "pickup"] as const)("challenge %s transition fails closed", verb => {
  test.each(["native-source", "event-source", "actor", "target-id", "target-key", "start-action", "start-time", "completion-time",
    "sequence", "missing-start", "failed", "missing-before-custody", "missing-after-custody", "unknown-before-custody",
    "unknown-after-custody", "wrong-after-custody", "unchanged", "missing-before-state", "missing-after-state",
    "missing-before-target", "missing-after-target", "removed", "stale-before-capture", "stale-after-capture",
    "missing-memory", "wrong-memory-owner", "witness-memory", "failed-memory", "stale-memory", "wrong-memory-target", "prose-only", "operation"])("%s", fault => {
    const input = challengeTransitionFixture(verb), [start, row] = input.receipts;
    if (fault === "native-source") start.native.sourceId = "other";
    if (fault === "event-source") row.event = { ...row.event, sourceId: "other" };
    if (fault === "actor") start.event = { ...start.event, actorKey: "actor:2", actorId: 2 };
    if (fault === "target-id") row.event = { ...row.event, targetId: 999 };
    if (fault === "target-key") start.native.targetKey = "replacement";
    if (fault === "start-action") start.event = { ...start.event, action: "examine" };
    if (fault === "start-time") start.event = { ...start.event, startedAtSimMs: 4999 };
    if (fault === "completion-time") row.event = { ...row.event, completedAtSimMs: 7999 };
    if (fault === "sequence") row.event = { ...row.event, sequence: 1 };
    if (fault === "missing-start") input.receipts = input.receipts.slice(1);
    if (fault === "failed") row.event = { ...row.event, status: "failed" };
    if (fault === "missing-before-custody") start.native.targetContainerKey = undefined;
    if (fault === "missing-after-custody") row.native.targetContainerKey = undefined;
    if (fault === "unknown-before-custody") start.native.targetContainerKey = "stale:container";
    if (fault === "unknown-after-custody") row.native.targetContainerKey = "stale:container";
    if (fault === "wrong-after-custody") row.native.targetContainerKey = "actor:2";
    if (fault === "unchanged") {
      if (verb === "pickup") start.native.targetContainerKey = "actor:1";
      else start.native.targetState = row.native.targetState;
    }
    if (fault === "missing-before-state") {
      if (verb === "pickup") start.native.targetContainerKey = undefined;
      else start.native.targetState = undefined;
    }
    if (fault === "missing-after-state") {
      if (verb === "pickup") row.native.targetContainerKey = undefined;
      else row.native.targetState = undefined;
    }
    if (fault === "missing-before-target") start.native.targetPresent = false;
    if (fault === "missing-after-target") row.native.targetPresent = false;
    if (fault === "removed") row.native.targetRemoved = true;
    if (fault === "stale-before-capture") start.capturedAtSimMs = 5001;
    if (fault === "stale-after-capture") row.capturedAtSimMs = 8001;
    if (fault === "missing-memory") row.memory = undefined;
    if (fault === "wrong-memory-owner") row.memory!.actorKey = "actor:2";
    if (fault === "witness-memory") row.memory!.receipts[0].provenance = "witnessed_action";
    if (fault === "failed-memory") row.memory!.receipts[0].succeeded = false;
    if (fault === "stale-memory") row.memory!.receipts[0].completedAtSimMs = 7999;
    if (fault === "wrong-memory-target") row.memory!.receipts[0].action!.targetKey = "replacement";
    if (fault === "prose-only") {
      for (const r of [start, row]) r.event = { ...r.event, action: "interact" };
      row.memory!.receipts[0].action = { type: "interact", targetKey: row.event.targetKey!, content: "inspect" };
      row.memory!.receipts[0].summary = `I successfully ${verb} it for my new goal.`;
    }
    if (fault === "operation") for (const r of [start, row]) r.event = { ...r.event, operation: "eating" };
    const result = evaluateHouseholdEvidence(input);
    expect(result.boxTransitionEventIds).toEqual([]);
    expect(result.phonePickupEventIds).toEqual([]);
    expect(result.actorKeysWithPhysicalOutcomes).toEqual(["actor:2"]);
    expect(result.gates.behavioral.newPersonalIntentionEnacted).toBe(false);
    if (fault === "failed") expect(result.failedEvidence.actionIds).toContain("transition:succeeded");
  });
});

test.each(["open", "close", "pickup"] as const)("challenge %s still needs exact goal attribution, not a newly created goal nearby", verb => {
  const input = challengeTransitionFixture(verb);
  input.receipts[1].memory!.receipts[0].executionContext!.intention!.key = "unrelated:goal";
  expect(evaluateHouseholdEvidence(input).gates.behavioral.newPersonalIntentionEnacted).toBe(false);
  input.receipts[1].memory!.receipts[0].executionContext = undefined;
  const result = evaluateHouseholdEvidence(input);
  expect(result.ownMemoryEventIds).toContain("transition:succeeded");
  expect(result.gates.behavioral.newPersonalIntentionEnacted).toBe(false);
});

test("output never copies private purpose, intention, memory, summary or action content", () => {
  const input = fixture(); input.receipts[1].memory!.receipts[0].action!.content = "PRIVATE_MESSAGE";
  const output = JSON.stringify(evaluateHouseholdEvidence(input));
  for (const secret of ["PRIVATE_MESSAGE", "PRIVATE_PURPOSE", "PRIVATE_GOAL", "PRIVATE_MEMORY", "PRIVATE_REVIEW"]) expect(output).not.toContain(secret);
  expect(output).toContain("meal:succeeded");
});

test.each(["source", "four residents", "actor identity", "duplicate key", "room identity", "food identity", "future", "non-finite"])("rejects invalid %s fixture", fault => {
  const input = fixture();
  if (fault === "source") input.sourceId = "other";
  if (fault === "four residents") input.initial.residents = input.initial.residents.slice(0, 3);
  if (fault === "actor identity") input.initial.residents[0].key = "replacement";
  if (fault === "duplicate key") input.initial.residents[1].key = input.initial.residents[0].key;
  if (fault === "room identity") input.initial.rooms[1].key = "replacement";
  if (fault === "food identity") input.initial.objects[0].key = "replacement";
  if (fault === "future") input.endAtSimMs = 4000;
  if (fault === "non-finite") input.endAtSimMs = Infinity;
  expect(evaluateHouseholdEvidence(input).boundedHouseholdChainObserved).toBe(false);
});

test.each(["native-source", "event-source", "actor", "room", "missing-start", "execution", "target", "sequence", "pending", "failed", "speech", "start-time", "completion-time", "capture-time", "capture-infinity", "removed", "still-present", "hunger", "operation"])("rejects non-native meal evidence: %s", fault => {
  const input = fixture(), row = input.receipts[1];
  if (fault === "native-source") row.native.sourceId = "elsewhere";
  if (fault === "event-source") row.event = { ...row.event, sourceId: "elsewhere" };
  if (fault === "actor") row.native.actorKey = "actor:2";
  if (fault === "room") row.native.actorRoomId = 100;
  if (fault === "missing-start") input.receipts = input.receipts.slice(1);
  if (fault === "execution") row.event = { ...row.event, executionId: "unadmitted" };
  if (fault === "target") row.event = { ...row.event, targetKey: "prop:201" };
  if (fault === "sequence") row.event = { ...row.event, sequence: 1 };
  if (fault === "pending") row.event = { ...row.event, status: "pending" };
  if (fault === "failed") row.event = { ...row.event, status: "failed" };
  if (fault === "speech") row.event = { ...row.event, kind: "speech" };
  if (fault === "start-time") row.event = { ...row.event, startedAtSimMs: 4000 };
  if (fault === "completion-time") row.event = { ...row.event, completedAtSimMs: 7999 };
  if (fault === "capture-time") row.capturedAtSimMs = 7000;
  if (fault === "capture-infinity") row.capturedAtSimMs = Infinity;
  if (fault === "removed") row.native.targetRemoved = false;
  if (fault === "still-present") row.native.targetPresent = true;
  if (fault === "hunger") row.native.hunger = 80;
  if (fault === "operation") row.event = { ...row.event, operation: "inspecting" };
  const result = evaluateHouseholdEvidence(input);
  expect(result.gates.mechanical.nativeMeal).toBe(false);
  expect(result.boundedHouseholdChainObserved).toBe(false);
});

test.each(["source", "owner", "witness", "failure", "target", "action", "time", "capture-time", "context-time"])("private memory must be an exact actor-owned outcome: %s", fault => {
  const input = fixture(), memory = input.receipts[1].memory!, receipt = memory.receipts[0];
  if (fault === "source") memory.sourceId = "elsewhere";
  if (fault === "owner") memory.actorKey = "actor:2";
  if (fault === "witness") receipt.provenance = "witnessed_action";
  if (fault === "failure") receipt.succeeded = false;
  if (fault === "target") receipt.action!.targetKey = "prop:201";
  if (fault === "action") receipt.action!.type = "use";
  if (fault === "time") receipt.completedAtSimMs = 7000;
  if (fault === "capture-time") memory.capturedAtSimMs = 7000;
  if (fault === "context-time") receipt.executionContext!.startedAtSimMs = 4000;
  const result = evaluateHouseholdEvidence(input);
  expect(result.gates.mechanical.nativeMeal).toBe(true);
  expect(result.gates.mechanical.ownActionMemory).toBe(false);
  expect(result.gates.behavioral.newPersonalIntentionEnacted).toBe(false);
});

test("memory summaries do not determine matching, and event IDs are not private receipt IDs", () => {
  const input = fixture(), event = input.receipts[1].event, receipt = input.receipts[1].memory!.receipts[0];
  receipt.summary = "A confused description";
  expect(receipt.id).not.toBe(event.id);
  expect(matchesHouseholdOwnActionMemory(event, receipt)).toBe(true);
});

test.each(["same-seed", "initial-time", "future-time", "sample-before-created", "non-active", "standing", "schedule", "source", "actor", "no-context", "wrong-intention", "future-sample"])("does not infer post-seed agency from %s", fault => {
  const input = fixture(), sample = input.goalSamples[0], goal = sample.goals[1];
  if (fault === "same-seed") goal.key = "goal:31";
  if (fault === "initial-time") goal.createdAtSimMs = 0;
  if (fault === "future-time") goal.createdAtSimMs = 6000;
  if (fault === "sample-before-created") sample.atSimMs = 500;
  if (fault === "non-active") goal.status = "completed";
  if (fault === "standing") goal.persistence = "standing";
  if (fault === "schedule") goal.source = "schedule";
  if (fault === "source") sample.sourceId = "elsewhere";
  if (fault === "actor") sample.actorKey = "actor:2";
  if (fault === "no-context") input.receipts[1].memory!.receipts[0].executionContext = undefined;
  if (fault === "wrong-intention") input.receipts[1].memory!.receipts[0].executionContext!.intention!.key = "goal:wrong";
  if (fault === "future-sample") sample.atSimMs = 9000;
  expect(evaluateHouseholdEvidence(input).gates.behavioral.newPersonalIntentionEnacted).toBe(false);
});

test("maintenance pause is not an agent-created agenda, goal completion or learning", () => {
  const input = fixture(); input.goalSamples[0].goals = input.goalSamples[0].goals.slice(0, 1);
  const result = evaluateHouseholdEvidence(input);
  expect(result.gates.behavioral.newPersonalIntentionCreated).toBe(false);
  expect(result.gates.behavioral.newPersonalIntentionEnacted).toBe(false);
  expect(result.learning).toBe("NOT_PROVEN");
});

test.each(["source", "spirit", "status", "room", "room-key", "condition", "revision", "id", "capture"])("weather must actually commit: %s", fault => {
  const input = fixture(), weather = input.weather[0];
  if (fault === "source") weather.sourceId = "other";
  if (fault === "spirit") weather.spirit = "An operator";
  if (fault === "status") weather.receipt.status = "unchanged";
  if (fault === "room") weather.receipt.roomId = 100;
  if (fault === "room-key") weather.native.roomKey = "replacement";
  if (fault === "condition") weather.native.condition = "clear";
  if (fault === "revision") weather.native.revision = 2;
  if (fault === "id") weather.receiptId = "another event";
  if (fault === "capture") weather.capturedAtSimMs = 19000;
  expect(evaluateHouseholdEvidence(input).gates.behavioral.narratorChangedNativeWeather).toBe(false);
});

test.each(["source", "review-source", "narrator-id", "narrator-key", "rejected", "stopped", "missing-id", "only-sequence", "unacknowledged", "same-time", "future-time", "capture-infinity"])("feedback requires a later accepted exact review: %s", fault => {
  const input = fixture(), row = input.narratorReviews[0], status = { ...row.status }; row.status = status;
  if (fault === "source") row.sourceId = "other";
  if (fault === "review-source") status.sourceId = "other";
  if (fault === "narrator-id") row.narratorId = 41;
  if (fault === "narrator-key") row.narratorKey = "replacement";
  if (fault === "rejected") status.accepted = false;
  if (fault === "stopped") status.sourceStopped = true;
  if (fault === "missing-id") status.receiptIdsObserved = ["weather:102:2"];
  if (fault === "only-sequence") status.receiptIdsObserved = [];
  if (fault === "unacknowledged") status.acknowledgedEnvironmentThroughSequence = 0;
  if (fault === "same-time") status.atSimMs = 20000;
  if (fault === "future-time") status.atSimMs = 32000;
  if (fault === "capture-infinity") row.capturedAtSimMs = Infinity;
  const result = evaluateHouseholdEvidence(input);
  expect(result.gates.behavioral.narratorChangedNativeWeather).toBe(true);
  expect(result.gates.behavioral.narratorObservedExactWeatherReceipt).toBe(false);
  expect(result.boundedHouseholdChainObserved).toBe(false);
});

test("retains failed evidence without turning it into success or learned experience", () => {
  const input = fixture(); input.receipts[1].event = { ...input.receipts[1].event, status: "failed" };
  input.weather[0].receipt.status = "rejected";
  input.narratorReviews[0].status = { ...input.narratorReviews[0].status, accepted: false };
  expect(evaluateHouseholdEvidence(input)).toMatchObject({ boundedHouseholdChainObserved: false,
    failedEvidence: { actionIds: ["meal:succeeded"], weatherIds: ["weather:102:1"], reviewTimes: [30000] }, learning: "NOT_PROVEN" });
});

test.each(["evening", "challenge"] as const)("manual native household %s traces satisfy mechanical evidence, without claiming autonomous intent or story", async profile => {
  // This deliberately dispatches the actions. It checks the observer/engine
  // contract only, never the quality of a live model's independent choices.
  const { SpatialDemo } = await import("../spatial-demo");
  const { createHouseholdScenario } = await import("../spatial-household");
  const { createHouseholdChallengeScenario } = await import("../spatial-household-challenge");
  const { entityExists, getRelationTargets, hasComponent } = await import("bitecs");
  const { Goal, GoalLifecycle, Needs, ObjectState, WorkingMemoryIdentity } = await import("../../ecs/components");
  const { HasGoal, SittingOn } = await import("../../ecs/relations");
  const { isEntityPresent } = await import("../../ecs/entity-presence");
  const { getRoomForEntity, getDirectContainer } = await import("../../ecs/location");
  const { getWorkingMemory } = await import("../../cognition/working-memory");
  const { getIdentityAnchors } = await import("../../cognition/narrative-memory");
  const { getAspirations } = await import("../../cognition/goal-learning");
  const { subscribeCommittedEvents } = await import("../../runtime/committed-events");
  const fetch = jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Mechanical evidence integration stays offline"));
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  let demo: Awaited<ReturnType<typeof SpatialDemo.create>> | undefined, dispose: (() => void) | undefined;
  try {
    const challenge = profile === "challenge";
    const scenario = challenge ? createHouseholdChallengeScenario() : createHouseholdScenario();
    demo = await SpatialDemo.create({ scenario: "household", householdChallenge: challenge, live: false, automaticClock: false });
    const world = demo.sim.world, snapshot = demo.snapshot();
    const input: HouseholdEvidenceInput = { profile, sourceId: demo.sourceId, endAtSimMs: 0,
      initial: { atSimMs: 0,
        residents: snapshot.actors.map(actor => {
          const opening = getRelationTargets(world, actor.id, HasGoal).find(id => GoalLifecycle.persistence[id] !== "standing")!;
          expect(Goal.description[opening]).toBeTruthy();
          return { id: actor.id, key: actor.key, name: actor.name, openingGoal: { id: opening, key: WorkingMemoryIdentity.id[opening] },
            identityCounts: { memories: getIdentityAnchors(world, actor.id).length, motivations: getAspirations(world, actor.id).length, relationships: 0 } };
        }),
        objects: scenario.blueprint.props.map(prop => { const id = demo!.byId.get(prop.id)!;
          return { scenarioId: prop.id, id, key: WorkingMemoryIdentity.id[id], roomId: getRoomForEntity(world, id)! }; }),
        rooms: scenario.blueprint.rooms.map(room => { const id = demo!.byId.get(room.id)!;
          return { scenarioId: room.id, id, key: WorkingMemoryIdentity.id[id] }; }),
      }, receipts: [], goalSamples: [], weather: [], narratorReviews: [] };
    const receipts: HouseholdReceiptEvidence[] = [];
    input.receipts = receipts;
    const byKey = new Map([...input.initial.objects, ...input.initial.rooms].map(row => [row.key, row.id]));
    dispose = subscribeCommittedEvents(world, event => {
      const target = event.targetId ?? (event.targetKey ? byKey.get(event.targetKey) : undefined);
      const matches = target !== undefined && entityExists(world, target) && hasComponent(world, target, WorkingMemoryIdentity)
        && WorkingMemoryIdentity.id[target] === event.targetKey;
      const present = matches && isEntityPresent(world, target!);
      const historical = target !== undefined && event.targetKey !== undefined && byKey.get(event.targetKey) === target;
      const container = present ? getDirectContainer(world, target!) : undefined;
      receipts.push(structuredClone({ event, capturedAtSimMs: demo!.atSimMs,
        native: { sourceId: demo!.sourceId, actorKey: WorkingMemoryIdentity.id[event.actorId],
          targetKey: historical || matches ? event.targetKey : undefined, targetPresent: present, targetRemoved: historical && !present,
          targetState: matches && hasComponent(world, target!, ObjectState) ? ObjectState.current[target!] : undefined,
          targetContainerKey: container === undefined ? undefined : WorkingMemoryIdentity.id[container],
          sittingOn: getRelationTargets(world, event.actorId, SittingOn),
          actorRoomId: getRoomForEntity(world, event.actorId)!, hunger: Needs.hunger[event.actorId] },
        memory: { sourceId: demo!.sourceId, actorKey: WorkingMemoryIdentity.id[event.actorId], capturedAtSimMs: demo!.atSimMs,
          receipts: getWorkingMemory(world, event.actorId).receipts } }));
    });
    await demo.start();
    const act = (name: string, type: string, scenarioId: string, content?: string) => {
      const actor = snapshot.actors.find(a => a.name === name)!, target = demo!.byId.get(scenarioId)!;
      demo!.dispatch(actor.key, type, WorkingMemoryIdentity.id[target], content); demo!.advance(15_000);
    };
    const foodId = challenge ? "household-pear-pastry" : "household-apple-pastry";
    act("Ivo", "interact", foodId, "eat");
    act("Noor", "interact", "household-patio-chair", "sit");
    act("Tess", "move", "household-kitchen");
    if (challenge) {
      act("Tess", "interact", "household-empty-box", "close");
      act("Tess", "interact", "household-empty-box", "open");
      act("Mara", "pickup", "mara-phone");
    }
    input.endAtSimMs = demo.atSimMs;
    expect(demo.snapshot().events.filter(e => e.kind === "failed")).toEqual([]);
    const foodKey = input.initial.objects.find(o => o.scenarioId === foodId)!.key;
    expect(demo.snapshot().entities.some(e => e.key === foodKey)).toBe(false);
    expect(getRelationTargets(world, snapshot.actors.find(a => a.name === "Noor")!.id, SittingOn)).toContain(demo.byId.get("household-patio-chair"));
    const result = evaluateHouseholdEvidence(input);
    expect(result.gates.seed).toEqual({ exactFourResidentFixture: true, authoredMemoriesAndMotivations: true });
    expect(result.gates.mechanical).toEqual({ nativeMeal: true, nativeSeating: true, nativeRoomChange: true, ownActionMemory: true });
    expect(result.boxTransitionEventIds).toHaveLength(challenge ? 2 : 0);
    expect(result.phonePickupEventIds).toHaveLength(challenge ? 1 : 0);
    expect(result.gates.behavioral.newPersonalIntentionEnacted).toBe(false);
    expect(result.boundedHouseholdChainObserved).toBe(false);
    expect(result.learning).toBe("NOT_PROVEN");
  } finally { dispose?.(); demo?.stop(); expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore(); log.mockRestore(); }
});
