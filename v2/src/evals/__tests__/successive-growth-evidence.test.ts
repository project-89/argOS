import { evaluateSuccessiveGrowth, type SuccessiveGrowthEvidence, type SuccessiveGrowthFeedback } from "../successive-growth-evidence";
import type { PublicCommittedEvent } from "../../runtime/committed-events";

function event(sequence: number, targetKey: string, started: number, completed?: number): PublicCommittedEvent {
  return { id: `event:${sequence}`, sequence, sourceId: "source:a", actorId: 1, actorKey: "actor:a", actorName: "Ada",
    roomId: 2, roomKey: "room:a", executionId: `execution:${targetKey}`, kind: "action", action: "interact",
    status: completed === undefined ? "pending" : "succeeded", tick: sequence, atSimMs: completed ?? started,
    targetId: targetKey === "meal:new" ? 3 : 4, targetKey, startedAtSimMs: started,
    ...(completed === undefined ? { expectedEndSimMs: started + 1 } : { completedAtSimMs: completed }),
    ...(targetKey === "meal:new" ? { operation: "eating" as const } : {}) };
}
function feedback(kind: "meal" | "seat", event: PublicCommittedEvent): SuccessiveGrowthFeedback {
  return { kind, sourceId: "source:a", observedAtSimMs: event.atSimMs + 1, reviewedAtSimMs: event.atSimMs + 2,
    weaverEventIds: [event.id], godReview: {
      before: [{ id: `review:${kind}`, timestamp: 1, fromEid: 9, fromName: "Weaver", type: "report", domain: "ecology",
        priority: "normal", subject: "World activity reviewed", content: "Native outcomes", requiresResponse: false,
        data: { sourceId: "source:a", observedAtSimMs: event.atSimMs + 1, recentEvents: [event] } }],
      result: { ran: true, executed: true, messagesIncluded: 1, messagesConsidered: 1 },
    } };
}
function fixture(): SuccessiveGrowthEvidence {
  const mealStart = event(1, "meal:new", 3), mealEnd = event(2, "meal:new", 3, 4);
  const seatStart = event(3, "seat:new", 9), seatEnd = event(4, "seat:new", 9, 10);
  return { sourceId: "source:a", actorKey: "actor:a", startAtSimMs: 0, initialEntityKeys: ["actor:a", "room:a"],
    needGoals: [{ key: "goal:food", kind: "meal", description: "Get something to eat", authoredAtSimMs: 0 },
      { key: "goal:rest", kind: "seat", description: "Rest my legs in a dry seat", authoredAtSimMs: 0 }],
    builds: [{ proposalId: "proposal:meal", sourceId: "source:a", targetKey: "meal:new", kind: "meal",
      observedApprovedAtSimMs: 1, observedExecutedAtSimMs: 2, approvedByGod: true },
    { proposalId: "proposal:seat", sourceId: "source:a", targetKey: "seat:new", kind: "seat",
      observedApprovedAtSimMs: 7, observedExecutedAtSimMs: 8, approvedByGod: true }],
    observations: [{ event: mealStart, hunger: 70, targetExists: true }, { event: mealEnd, hunger: 40, targetExists: false },
      { event: seatStart, targetExists: true, seatOccupantKey: null }, { event: seatEnd, targetExists: true, seatOccupantKey: "actor:a" }],
    finalState: { sourceId: "source:a", actorKey: "actor:a", atSimMs: 14, presentEntityKeys: ["actor:a", "room:a", "seat:new"] },
    feedback: [feedback("meal", mealEnd), feedback("seat", seatEnd)], diagnostics: { errorsTotal: 0, observerFailures: 0 },
    authority: { hostActionInjections: 0, postStartGoalWrites: 0 } };
}

test("paired native uses, sequential God-approved growth and reviewed feedback satisfy this bounded structural gate", () => {
  const evidence = fixture(), before = structuredClone(evidence);
  expect(evaluateSuccessiveGrowth(evidence)).toEqual({ passed: true, failures: [], mealEventId: "event:2", seatEventId: "event:4", requiresQualitativeReview: true });
  expect(evidence).toEqual(before);
  // No final sitting requirement: the NPC may legitimately stand up afterward.
  evidence.finalState.presentEntityKeys.push("an-unrelated-later-object");
  expect(evaluateSuccessiveGrowth(evidence).passed).toBe(true);
});

test("a complete God batch can review the exact meal and approve the next build together", () => {
  const evidence = fixture(), review = evidence.feedback[0].godReview;
  review.before.push({ ...review.before[0], id: "seat-proposal-message", subject: "Proposed waiting chair",
    data: { proposal: { id: evidence.builds[1].proposalId } } });
  review.result.messagesIncluded = 2; review.result.messagesConsidered = 2;
  expect(evaluateSuccessiveGrowth(evidence).passed).toBe(true);
});

const reject: [string, (evidence: SuccessiveGrowthEvidence) => void][] = [
  ["same initial goal", e => { e.needGoals[1].key = e.needGoals[0].key; }],
  ["same need prose relabeled", e => { e.needGoals[1].description = "  GET SOMETHING TO EAT  "; }],
  ["after-start authored goal", e => { e.needGoals[1].authoredAtSimMs = 1; }],
  ["host selected the actions", e => { e.authority.hostActionInjections = 1; }],
  ["host rewrote a goal", e => { e.authority.postStartGoalWrites = 1; }],
  ["historic error drained from tail", e => { e.diagnostics.errorsTotal = 1; }],
  ["observer lost evidence", e => { e.diagnostics.observerFailures = 1; }],
  ["source restart", e => { e.finalState.sourceId = "source:b"; }],
  ["replacement actor", e => { e.finalState.actorKey = "actor:b"; }],
  ["actor not initially present", e => { e.initialEntityKeys = ["room:a"]; }],
  ["actor removed before final observation", e => { e.finalState.presentEntityKeys = ["room:a", "seat:new"]; }],
  ["preexisting meal", e => { e.initialEntityKeys.push("meal:new"); }],
  ["preexisting chair", e => { e.initialEntityKeys.push("seat:new"); }],
  ["both built together is insufficient second-cycle evidence", e => { e.builds[1].observedApprovedAtSimMs = 1; e.builds[1].observedExecutedAtSimMs = 2; }],
  ["one proposal masquerades as two", e => { e.builds[1].proposalId = e.builds[0].proposalId; }],
  ["unapproved build", e => { e.builds[1].approvedByGod = false; }],
  ["foreign source build", e => { e.builds[1].sourceId = "source:b"; }],
  ["approval after execution", e => { e.builds[1].observedApprovedAtSimMs = 9; }],
  ["build observed after alleged use", e => { e.builds[1].observedExecutedAtSimMs = 11; }],
  ["no admitted meal interval", e => { e.observations.shift(); }],
  ["no completed meal", e => { e.observations.splice(1, 1); }],
  ["another actor ate", e => { e.observations[1].event = { ...e.observations[1].event, actorKey: "someone-else" }; }],
  ["replacement numeric actor address", e => { e.observations[1].event = { ...e.observations[1].event, actorId: 77 }; }],
  ["invalid numeric actor address", e => { e.observations[0].event = { ...e.observations[0].event, actorId: -1 }; e.observations[1].event = { ...e.observations[1].event, actorId: -1 }; }],
  ["unrelated target success", e => { e.observations[1].event = { ...e.observations[1].event, targetKey: "other-meal" }; }],
  ["cross-room completion", e => { e.observations[1].event = { ...e.observations[1].event, roomKey: "other-room" }; }],
  ["mere dialogue about a meal", e => { e.observations[1].event = { ...e.observations[1].event, kind: "speech", action: "speak" }; }],
  ["missing physical target observation", e => { delete e.observations[1].targetExists; }],
  ["meal not consumed", e => { e.observations[1].targetExists = true; }],
  ["food removed without hunger reduction", e => { e.observations[1].hunger = 70; }],
  ["negative hunger", e => { e.observations[1].hunger = -1; }],
  ["nonfinite hunger", e => { e.observations[1].hunger = NaN; }],
  ["fake instant completion", e => { e.observations[1].event = { ...e.observations[1].event, atSimMs: 3, completedAtSimMs: 3 }; }],
  ["missing expected temporal boundary", e => { e.observations[0].event = { ...e.observations[0].event, expectedEndSimMs: undefined }; }],
  ["pending receipt claims completion", e => { e.observations[0].event = { ...e.observations[0].event, completedAtSimMs: 3 }; }],
  ["repeated event id", e => { e.observations[1].event = { ...e.observations[1].event, id: "event:1" }; }],
  ["backward sequence", e => { e.observations[1].event = { ...e.observations[1].event, sequence: 1 }; }],
  ["foreign event source", e => { e.observations[1].event = { ...e.observations[1].event, sourceId: "source:b" }; }],
  ["chair already occupied", e => { e.observations[2].seatOccupantKey = "actor:a"; }],
  ["unobserved chair before use", e => { delete e.observations[2].seatOccupantKey; }],
  ["chair occupied by somebody else", e => { e.observations[3].seatOccupantKey = "actor:b"; }],
  ["chair vanished instead of being used", e => { e.observations[3].targetExists = false; }],
  ["consumed identity returned", e => { e.finalState.presentEntityKeys.push("meal:new"); }],
  ["feedback observed before meal", e => { e.feedback[0].observedAtSimMs = 3; }],
  ["feedback reviewed before observation", e => { e.feedback[1].reviewedAtSimMs = 10; }],
  ["future feedback", e => { e.feedback[1].reviewedAtSimMs = 15; }],
  ["foreign feedback source", e => { e.feedback[1].sourceId = "source:b"; }],
  ["Weaver never reported chair use", e => { e.feedback[1].weaverEventIds = ["unrelated"]; }],
  ["God did not execute review", e => { e.feedback[1].godReview.result.executed = false; }],
  ["God review did not run", e => { e.feedback[1].godReview.result.ran = false; }],
  ["God read only an unspecified subset", e => { e.feedback[1].godReview.result.messagesIncluded = 0; }],
  ["God merely approved another proposal", e => { e.feedback[1].godReview.before[0].data = { proposal: { id: "unrelated" } }; }],
  ["God read no exact event", e => { e.feedback[1].godReview.before[0].data!.recentEvents = []; }],
  ["God input has foreign source", e => { e.feedback[1].godReview.before[0].data!.sourceId = "source:b"; }],
  ["God input predates outcome", e => { e.feedback[1].godReview.before[0].data!.observedAtSimMs = 9; }],
];
test.each(reject)("rejects %s without repairing or mutating evidence", (_name, mutate) => {
  const evidence = fixture(); mutate(evidence); const before = structuredClone(evidence);
  const verdict = evaluateSuccessiveGrowth(evidence);
  expect(verdict.passed).toBe(false); expect(verdict.failures.length).toBeGreaterThan(0);
  expect(evidence).toEqual(before);
});

test("a duplicated success receipt with a different event ID does not manufacture a use", () => {
  const evidence = fixture();
  evidence.observations.splice(2, 0, { ...evidence.observations[1], event: { ...evidence.observations[1].event, id: "forged-duplicate" } });
  evidence.observations = evidence.observations.map((row, index) => ({ ...row, event: { ...row.event, sequence: index + 1 } }));
  expect(evaluateSuccessiveGrowth(evidence).failures).toContain("new_approved_meal_native_use_missing");
});

test.each([null, {}, { ...fixture(), observations: [null] }])("malformed evidence fails closed", evidence => {
  expect(evaluateSuccessiveGrowth(evidence as SuccessiveGrowthEvidence).passed).toBe(false);
});
