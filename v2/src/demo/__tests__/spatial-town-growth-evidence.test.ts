import { evaluateTownGrowthEvidence } from "../spatial-town-growth-evidence";

function fixture(): Parameters<typeof evaluateTownGrowthEvidence>[0] {
  const proposal = { id: "p", fromSpiritEid: 2, fromSpiritName: "The Weaver", type: "entity", name: "Cafe rest chair",
    observationScopeId: "native-scope", status: "executed", approvedBy: 1,
    specification: { name: "Cafe rest chair", roomEid: 3, components: [{ name: "SpatialPlacement", values: { assetId: "chair", siteId: "cafe-extra-seat" } }] } };
  const event = { id: "used", sourceId: "s", actorId: 4, actorKey: "tess", kind: "action", action: "interact",
    status: "succeeded", targetId: 5, targetKey: "chair", executionId: "e", atSimMs: 1000, startedAtSimMs: 500 };
  return { sourceId: "s", godId: 1, weaverId: 2, cafeId: 3, tessId: 4, tessKey: "tess",
    initialNeed: true, initialActorCount: 10, initialCafeSeats: 0,
    proposals: [{ sourceId: "s", atSimMs: 400, diagnostic: { id: "p", evidence: ["intention:native"], issuedAtSimMs: 100 }, proposal }],
    reviews: [{ sourceId: "s", result: { executed: true, actions: [{ success: true, result: { proposalId: "p", status: "approved" } }] } }],
    receipts: [{ event: { ...event, id: "start", status: "pending", atSimMs: 500 }, native: {} }, { event, native: {
      actorKey: "tess", sittingOn: [5], targetPresent: true, targetKey: "chair", targetRoom: 3, targetState: "occupied",
      placement: { assetId: "chair", siteId: "cafe-extra-seat" }, position: { x: 6.5, y: 32.5 },
      visual: { id: 5, key: "chair", roomId: 3, asset: "chair", position: { x: 6.5, y: 0, z: 32.5 } },
    } }], growth: { sourceId: "s", builds: [{ sourceId: "s", status: "built", assetId: "chair", siteId: "cafe-extra-seat",
      eid: 5, key: "chair", name: "Cafe rest chair", atSimMs: 400, feedback: [{ eventId: "used", actorKey: "tess", action: "interact", seated: true, atSimMs: 1000 }] }] },
    reports: [{ sourceId: "s", capturedAtSimMs: 1500, id: "r", senderId: 2, senderName: "The Weaver", subject: "World activity reviewed",
      data: { sourceId: "s", observedAtSimMs: 1200, recentEvents: [event] } }],
  } as unknown as Parameters<typeof evaluateTownGrowthEvidence>[0];
}

test("credits an exact native chain, but not baseline or endurance acceptance", () => {
  expect(evaluateTownGrowthEvidence(fixture())).toMatchObject({ completeNativeUseChainObserved: true, baselineAndEndurance: "OPEN",
    useEventIds: ["used"], observedFeedbackEventIds: ["used"] });
});
test.each(["source", "approver", "approval_result", "execution", "pending", "target_identity", "native_seated", "native_state", "renderer", "feedback", "weaver_report"])("rejects incomplete or rebound %s evidence", fault => {
  const input = fixture();
  if (fault === "source") input.proposals[0].sourceId = "foreign";
  if (fault === "approver") input.proposals[0].proposal.approvedBy = 99;
  if (fault === "approval_result") input.reviews[0].result.actions = [];
  if (fault === "execution") input.proposals[0].proposal.status = "approved";
  if (fault === "pending") input.receipts.shift();
  if (fault === "target_identity") input.receipts[1].native.targetKey = "replacement";
  if (fault === "native_seated") input.receipts[1].native.sittingOn = [];
  if (fault === "native_state") input.receipts[1].native.targetState = "empty";
  if (fault === "renderer") input.receipts[1].native.visual!.key = "replacement";
  if (fault === "feedback") input.growth.builds[0].feedback = [];
  if (fault === "weaver_report") input.reports[0].data!.recentEvents = [];
  expect(evaluateTownGrowthEvidence(input).completeNativeUseChainObserved).toBe(false);
});
test("receipt retained does not imply a spirit actually saw it", () => {
  const input = fixture(); input.reports = [];
  expect(evaluateTownGrowthEvidence(input).gates).toMatchObject({ autonomousTessSeating: true,
    exactNativeFeedbackRetained: true, exactNativeFeedbackObservedByWeaver: false });
});

function historyFixture() {
  const input = fixture(), event = { ...input.receipts[1].event, sequence: 2 };
  input.receipts[1].event = event;
  input.reports[0].data = { sourceId: "s", observedAtSimMs: 61_000, recentEvents: [], publicActivityHistory: {
    sourceId: "s", observedAtSimMs: 61_000, afterSequence: 0, throughSequence: 2,
    records: [{ kind: event.kind, action: event.action, status: event.status, executionId: event.executionId,
      actorKey: event.actorKey, targetKey: event.targetKey, receiptIds: [event.id], receiptCount: 1, receiptIdsOmitted: 0,
      firstSequence: 2, lastSequence: 2, firstAtSimMs: event.atSimMs, lastAtSimMs: event.atSimMs }],
  } };
  input.reports[0].capturedAtSimMs = 62_000;
  return input;
}

test("the same exact use gate recognizes a receipt actually delivered in delayed Weaver history", () => {
  const result = evaluateTownGrowthEvidence(historyFixture());
  expect(result).toMatchObject({ completeNativeUseChainObserved: true, observedFeedbackEventIds: ["used"], baselineAndEndurance: "OPEN" });
});

test.each(["source", "future", "future-report", "invalid-time", "before-use", "already-acknowledged", "beyond-window", "id", "actor", "target", "action", "status", "execution", "time", "sequence", "omitted", "only-range", "other-resident"])("historical %s cannot substitute for exact observed Tess use", fault => {
  const input = historyFixture(), history = input.reports[0].data!.publicActivityHistory, row = history.records[0];
  if (fault === "source") history.sourceId = "other";
  if (fault === "future") history.observedAtSimMs = 63_000;
  if (fault === "future-report") input.reports[0].data!.observedAtSimMs = 63_000;
  if (fault === "invalid-time") input.reports[0].capturedAtSimMs = Infinity;
  if (fault === "before-use") history.observedAtSimMs = 500;
  if (fault === "already-acknowledged") history.afterSequence = 2;
  if (fault === "beyond-window") history.throughSequence = 1;
  if (fault === "id") row.receiptIds = ["not-used"];
  if (fault === "actor") row.actorKey = "ivo";
  if (fault === "target") row.targetKey = "replacement-chair";
  if (fault === "action") row.action = "move";
  if (fault === "status") row.status = "pending";
  if (fault === "execution") row.executionId = "other";
  if (fault === "time") row.firstAtSimMs = 999;
  if (fault === "sequence") row.firstSequence = 1;
  if (fault === "omitted") row.receiptIdsOmitted = 1;
  if (fault === "only-range") row.receiptIds = [];
  if (fault === "other-resident") input.receipts[1].event = { ...input.receipts[1].event, actorKey: "ivo" };
  expect(evaluateTownGrowthEvidence(input).completeNativeUseChainObserved).toBe(false);
});
