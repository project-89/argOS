import type { TestbedEvent } from "../../demo/generative-agents";
import { compareGenerativeAgentsEvaluations, evaluateGenerativeAgentsRun, formatGenerativeAgentsEvaluation } from "../generative-agents-evaluation";

const actorNames = { 1: "Mara", 2: "Ivo", 3: "Sera" };
function speech(sequence: number, elapsedMs: number, actorId: number, target: string, text: string): TestbedEvent {
  return { sequence, elapsedMs, tick: sequence, actorId, roomId: 7, kind: "speech", text, visibility: "public",
    action: { type: "speak", target, content: text }, status: "succeeded" };
}
function event(sequence: number, elapsedMs: number, fields: Partial<TestbedEvent>): TestbedEvent {
  return { sequence, elapsedMs, tick: sequence, text: "", kind: "action", actorId: 1, roomId: 7, visibility: "public", ...fields };
}
const evaluate = (events: TestbedEvent[], elapsedMs = 60000) => evaluateGenerativeAgentsRun(events, elapsedMs, { actorNames });

test("a key information check links the public claim and exact earlier hearing, including equal timestamps", () => {
  const claim = speech(13, 2000, 2, "Mara", "I've got the key for the supply cupboard.");
  const heard = event(29, 4500, { actorId: 3, kind: "perception", visibility: "private", text: `Ivo says: "${claim.text}"` });
  const question = speech(35, 4500, 3, "Ivo", "Ivo, do you have the brass key for the supply cupboard? We need the spare fuse.");
  const result = evaluate([question, claim, heard]);
  expect(result.metrics.repetition).toMatchObject({ informationChecksAfterLocalClaim: 1, informationChecksAfterRecordedHearing: 1 });
  expect(result.evidence.find(e => e.kind === "information_check_after_claim")).toMatchObject({
    previous: { sequence: 13 }, current: { sequence: 35 }, heardPerceptionSequence: 29,
  });
});

test.each([
  "Could you lend me the key?", "Would you pass me the brass key?", "May I borrow the key?", "Can I have the key?",
])("reasonable handoff request is not an information recheck: %s", request => {
  const claim = speech(1, 1000, 2, "Mara", "I have the brass key.");
  expect(evaluate([claim, speech(2, 2000, 1, "Ivo", request)]).metrics.repetition.informationChecksAfterLocalClaim).toBe(0);
});

test("unheard, private, remote and uncommitted claims cannot become proof of heard information", () => {
  const claim = speech(1, 1000, 2, "Mara", "I have the brass key.");
  const question = speech(3, 3000, 1, "Ivo", "Do you have the brass key?");
  const merelyLocal = evaluate([claim, question]);
  expect(merelyLocal.metrics.repetition.informationChecksAfterLocalClaim).toBe(1);
  expect(merelyLocal.metrics.repetition.informationChecksAfterRecordedHearing).toBe(0);
  for (const changed of [{ ...claim, roomId: 8 }, { ...claim, visibility: "private" as const }, { ...claim, status: "pending" as const }])
    expect(evaluate([changed, question]).metrics.repetition.informationChecksAfterLocalClaim).toBe(0);
  const laterHearing = event(4, 3000, { kind: "perception", visibility: "private", text: claim.text });
  expect(evaluate([claim, question, laterHearing]).metrics.repetition.informationChecksAfterRecordedHearing).toBe(0);
});

test("an intervening actual item transfer makes a later possession check reasonable", () => {
  const claim = speech(1, 1000, 2, "Mara", "I have the brass key.");
  const transfer = event(2, 2000, { actorId: 2, status: "succeeded", action: { type: "give", target: "Sera", content: "Brass key" } });
  const question = speech(3, 3000, 1, "Ivo", "Do you have the brass key?");
  expect(evaluate([claim, transfer, question]).metrics.repetition.informationChecksAfterLocalClaim).toBe(0);
  expect(evaluate([claim, { ...transfer, status: "failed" }, question]).metrics.repetition.informationChecksAfterLocalClaim).toBe(1);
});

test("a generic mention of a fuse is not a claim that spare supplies exist", () => {
  const unrelated = speech(1, 1000, 2, "Mara", "I have the cupboard key. Cut the circuit before fitting any fuse.");
  const question = speech(3, 3000, 1, "Sera", "Do we have spare parts stocked anywhere?");
  expect(evaluate([unrelated, question]).metrics.repetition.informationChecksAfterLocalClaim).toBe(0);
  const relevant = speech(2, 2000, 3, "Mara", "There's a spare fuse inside the utility cupboard.");
  expect(evaluate([unrelated, relevant, question]).metrics.repetition.informationChecksAfterLocalClaim).toBe(1);
});

test("paraphrased question topics and gratitude are separate from exact or token-overlap duplication", () => {
  const result = evaluate([
    speech(1, 1000, 1, "Ivo", "What brought you here to care for this house?"),
    speech(2, 2000, 2, "Mara", "I arrived years ago to fix the roof and decided to stay."),
    speech(3, 3000, 1, "Ivo", "How did you come to look after this place?"),
    speech(4, 4000, 2, "Mara", "Thank you for respecting my judgment."),
    speech(5, 5000, 2, "Mara", "I am grateful we can share these responsibilities as equals."),
  ]);
  expect(result.metrics.repetition).toMatchObject({ exactSameSpeakerDuplicates: 0, repeatedQuestionTopicCandidates: 1,
    questionReturnsAfterTargetResponse: 1, gratitudeRecurrenceCandidates: 1 });
  expect(result.evidence.find(e => e.kind === "question_topic_return")?.response?.sequence).toBe(2);
  expect(result.evidence.find(e => e.kind === "gratitude_recurrence")?.reason).toContain("not a semantic duplicate claim");
});

test("token overlap catches substantial repeated content without requiring identical wording", () => {
  const result = evaluate([
    speech(1, 1000, 1, "Ivo", "The copper lantern beside the shutter needs a replacement wick."),
    speech(2, 2000, 1, "Ivo", "A replacement wick is needed for the copper lantern beside the shutter."),
  ]);
  expect(result.metrics.repetition.exactSameSpeakerDuplicates).toBe(0);
  expect(result.metrics.repetition.lexicalRepeatCandidates).toBe(1);
});

test("pacing counts dense speaker changes and ABA turns independently of content repetition", () => {
  const result = evaluate([
    speech(1, 1000, 1, "Ivo", "The storm is loud."), speech(2, 2000, 2, "Mara", "The roof still holds."),
    speech(3, 3000, 1, "Ivo", "Can we inspect the latch?"), speech(4, 4000, 2, "Mara", "Yes, bring the lantern."),
  ]);
  expect(result.metrics.pacing).toMatchObject({ medianGapMs: 1000, rapidSpeakerSwitchesWithin2s: 3, rapidABAAlternations: 2, peakTurnsIn10s: 4 });
  expect(result.metrics.speech.wordsPerMinute).toBeGreaterThan(0);
});

test("post-goal reporting distinguishes physical activity, observation, raw wait receipts and uninstrumented gaps", () => {
  const result = evaluate([
    event(1, 19000, { status: "succeeded", action: { type: "interact", target: "Lighting relay", content: "repair" } }),
    event(2, 20000, { kind: "goal_completed", visibility: "operator", text: "Restore the lamp" }),
    event(3, 25000, { status: "pending", action: { type: "move", target: "Common Room" } }),
    event(4, 28000, { status: "succeeded", action: { type: "move", target: "Common Room" } }),
    event(5, 40000, { status: "succeeded", action: { type: "observe", target: "Ivo" } }),
    event(6, 45000, { status: "succeeded", action: { type: "wait" } }),
    event(7, 50000, { status: "failed", action: { type: "pickup", target: "Spare fuse" } }),
  ]);
  expect(result.metrics.actions).toMatchObject({ successfulPhysical: 2, pendingReceipts: 1, failed: 1 });
  expect(result.metrics.postGoal).toMatchObject({ firstGoalMs: 20000, durationMs: 40000, successfulPhysicalActions: 1,
    successfulObservationActions: 1, rawWaitOrRestReceipts: 1, explicitWaitOrRestActions: 1,
    intentionalModelWaits: null, unattributedWaitOrRestReceipts: 1, failedActions: 1, physicalActionFreeTailMs: 32000 });
  expect(result.assessment.postGoalPhysicalEngagement).toBe("long_gap_without_physical_action_receipts");
  expect(result.limitations.join(" ")).toContain("does not establish idleness");
});

test("wait origin stays unknown even with plausible serialized decision IDs or nearby decision text", () => {
  const result = evaluate([
    event(1, 1000, { kind: "thought", visibility: "private", text: "I deliberately choose to wait for an answer." }),
    event(2, 1000, { kind: "decision_superseded", visibility: "operator", text: "discarded", status: undefined }),
    event(3, 1000, { status: "succeeded", action: { type: "wait", foregroundDecisionId: "foreground:valid-looking-id" } }),
    event(4, 2000, { status: "succeeded", action: { type: "rest" } }),
    event(5, 3000, { status: "pending", action: { type: "wait" } }),
    event(6, 4000, { status: "failed", action: { type: "wait" } }),
  ]);
  expect(result.metrics.actions).toMatchObject({ rawWaitOrRestReceipts: 2, explicitWaitOrRestActions: 2,
    intentionalModelWaits: null, unattributedWaitOrRestReceipts: 2,
    waitIntentAttribution: "unavailable_without_matching_admission_provenance" });
  const formatted = formatGenerativeAgentsEvaluation(result);
  expect(formatted).toContain("raw successful wait/rest receipts: 2");
  expect(formatted).toContain("Intentional model-wait attribution: unavailable");
  expect(formatted).not.toContain("explicit wait/rest actions");
});

test("duplicate, future and absent wait receipts cannot be promoted to deliberate waiting", () => {
  const wait = event(1, 1000, { status: "succeeded", action: { type: "wait" } });
  const result = evaluate([wait, wait, { ...wait, sequence: 2, elapsedMs: 90000 }]);
  expect(result.metrics.actions.rawWaitOrRestReceipts).toBe(1);
  expect(result.metrics.actions.intentionalModelWaits).toBeNull();
  expect(evaluate([]).metrics.actions).toMatchObject({ rawWaitOrRestReceipts: 0, intentionalModelWaits: null });
});

test("milestones use actual successful non-speech receipts and can describe an extended challenge", () => {
  const result = evaluateGenerativeAgentsRun([
    speech(1, 1000, 1, "Ivo", "I repaired the relay and restored the light."),
    event(2, 2000, { status: "failed", action: { type: "interact", target: "Lighting relay", content: "repair" } }),
    event(3, 3000, { actorId: 2, status: "succeeded", action: { type: "interact", target: "Storm shutter", content: "brace" } }),
  ], 60000, { actorNames, milestoneRules: [{ id: "brace", label: "Shutter braced", actionType: "interact", target: "Storm shutter", verb: "brace" }] });
  expect(result.milestones[0]).toMatchObject({ observed: true, occurrences: 1, first: { sequence: 3 }, actorIds: [2] });
  const noRepair = evaluate([speech(1, 1000, 1, "Ivo", "The Reading lamp comes on. I repaired the Lighting relay.")]);
  expect(noRepair.metrics.collaboration.observedMilestones).toBe(0);
});

test("silence and short samples never pass; comparisons keep coverage and physical evidence visible", () => {
  const silent = evaluate([]);
  expect(silent.assessment.socialEvidence).toBe("insufficient_observation");
  expect(silent.metrics.repetition.flaggedSpeechFraction).toBeNull();
  expect(silent.metrics.observation).toMatchObject({ observedActors: 0, namedExpectedActors: 3 });
  const busyEvents: TestbedEvent[] = Array.from({ length: 12 }, (_, i) => speech(i + 1, 1000 + 1000 * i, 1, "Ivo", "The lantern wick needs another careful inspection."));
  for (let i = 0; i < 3; i++) busyEvents.push(event(20 + i, 20000 + i, { kind: "thought", visibility: "private", text: "A private reflection on the physical surroundings." }));
  const busy = evaluate(busyEvents);
  expect(busy.assessment.socialEvidence).toBe("repetition_review_needed");
  expect(compareGenerativeAgentsEvaluations(busy, silent).comparableObservation).toBe(false);
  expect(compareGenerativeAgentsEvaluations(busy, silent).interpretation).toContain("physical receipts");
});

test("private operator text is counted but never quoted; duplicate/future events do not inflate evidence", () => {
  const a = speech(1, 1000, 1, "Ivo", "It is raining."), future = speech(9, 90000, 2, "Mara", "FUTURE_PUBLIC_BODY");
  const hidden = event(2, 2000, { kind: "thought", visibility: "private", text: "SECRET_THOUGHT_BODY_1138" });
  const result = evaluate([a, a, hidden, future]);
  expect(result.metrics.observation.droppedInvalidOrDuplicateEvents).toBe(2);
  expect(result.metrics.thoughts.count).toBe(1);
  const output = JSON.stringify(result) + formatGenerativeAgentsEvaluation(result);
  expect(output).not.toContain("SECRET_THOUGHT_BODY_1138");
  expect(output).not.toContain("FUTURE_PUBLIC_BODY");
  expect(() => evaluateGenerativeAgentsRun([], -1)).toThrow("elapsedMs");
});
