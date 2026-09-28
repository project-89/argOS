import { breakupTrialInputs, breakupObservationEvidence, type BreakupObservationFrame } from "../sitcom-breakup-evaluation";

test("destination invitation is a distinct input, not a scripted departure or a change to logistics", () => {
  const trial = breakupTrialInputs("destination" as Parameters<typeof breakupTrialInputs>[0]);
  expect(trial.contact).toEqual(breakupTrialInputs("logistics").contact);
  expect(trial.stimuli.map(s => s.atSimMs)).toEqual([8000, 28000]);
  expect(trial.stimuli[0].text).toContain("The Lantern");
  expect(trial.stimuli[0].text).toContain("meet me here now");
  expect(trial.stimuli[1].text).toContain("say no");
  expect(trial.stimuli.map(s => Object.keys(s))).toEqual([["atSimMs", "text"], ["atSimMs", "text"]]);
  expect(Object.isFrozen(trial.stimuli[0])).toBe(true);
  expect(breakupTrialInputs("logistics").stimuli[0].text).toBe("Elaine, are you still coming to dinner tonight? Please let me know so I can leave work.");
});

test("handoff is a separately labeled absent-recipient task with a later correction", () => {
  const trial = breakupTrialInputs("handoff" as Parameters<typeof breakupTrialInputs>[0]);
  expect(trial.contact).toEqual(breakupTrialInputs("writing").contact);
  expect(trial.stimuli.map(s => s.atSimMs)).toEqual([8000, 28000]);
  expect(trial.stimuli[0].text).toContain("building manager");
  expect(trial.stimuli[0].text).toContain("neither of us will be there");
  expect(trial.stimuli[0].text).toContain("10 AM");
  expect(trial.stimuli[1].text).toContain("11 AM");
  expect(trial.stimuli[1].text).toContain("bathroom tap, not the kitchen sink");
  expect(Object.isFrozen(trial.stimuli[1])).toBe(true);
  // The failed historical condition remains unchanged, not silently replaced.
  expect(breakupTrialInputs("writing").stimuli[0].text).toContain("spare apartment key is with the downstairs neighbor");
});

test("neutral-message control keeps exactly the same established partner and timing", () => {
  const experiment = breakupTrialInputs("breakup"), control = breakupTrialInputs("neutral");
  expect(control.contact).toEqual(experiment.contact); expect(control.contact.relationship).toBe("boyfriend");
  expect(control.stimuli.map(s => s.atSimMs)).toEqual(experiment.stimuli.map(s => s.atSimMs));
  expect(control.stimuli.map(s => s.text)).not.toEqual(experiment.stimuli.map(s => s.text));
  expect(Object.isFrozen(experiment.stimuli)).toBe(true); expect(Object.isFrozen(experiment.contact)).toBe(true);
  expect(Object.isFrozen(experiment.stimuli[0])).toBe(true);
});
test("unknown-contact control is explicit and does not alter the breakup messages", () => {
  expect(breakupTrialInputs("breakup", "neutral").contact).toEqual({ name: "Unknown sender", relationship: "unknown", context: "" });
  expect(breakupTrialInputs("breakup", "neutral").stimuli).toEqual(breakupTrialInputs("breakup").stimuli);
});
test("actionable logistics tests a reply opportunity without changing actors or forcing their behavior", () => {
  const request = breakupTrialInputs("logistics"), control = breakupTrialInputs("neutral");
  expect(request.contact).toEqual(control.contact);
  expect(request.stimuli.map(s => s.atSimMs)).toEqual(control.stimuli.map(s => s.atSimMs));
  expect(request.stimuli.every(s => s.text.includes("?"))).toBe(true);
  expect(request.stimuli.map(s => Object.keys(s))).toEqual([["atSimMs", "text"], ["atSimMs", "text"]]);
  expect(Object.isFrozen(request.stimuli)).toBe(true);
});
test("private feeling and visible expression never manufacture observer delivery or semantic success", () => {
  const frames: BreakupObservationFrame[] = [{ atSimMs: 16000, actors: [
    { name: "Elaine", affect: { feeling: "hurt", reason: "David ended our relationship", expression: "tearful" } },
    { name: "Jerry", visibleExpressions: [{ subject: "Elaine", expression: "tearful" }] },
  ] }];
  const result = breakupObservationEvidence(frames, 14700);
  expect(result.privateAffectChanges).toHaveLength(1); expect(result.sightGatedExpressionAvailability[1].expressions).toHaveLength(1);
  expect(result.deliveredPerceptions).toHaveLength(0); expect(result).not.toHaveProperty("success");
  expect(JSON.stringify(result.sightGatedExpressionAvailability)).not.toContain("David");
});
test("delivered perceptions retain first sample, literal source and actor; no read means no post-read claim", () => {
  const perception = { id: 12, type: "observation", source: "Elaine", content: "Elaine's expression is tearful.", timestamp: 1234 };
  const frames: BreakupObservationFrame[] = [16000, 16250, 18000].map(atSimMs => ({ atSimMs, actors: [{ name: "Jerry", perceptions: [perception] }] }));
  const result = breakupObservationEvidence(frames, 14700);
  expect(result.deliveredPerceptions).toEqual([{ observer: "Jerry", firstSampledAtSimMs: 16000, perception }]);
  expect(result.deliveredPeerPerceptionsAfterRead).toHaveLength(1);
  expect(breakupObservationEvidence(frames, null).deliveredPeerPerceptionsAfterRead).toHaveLength(0);
});
test("same entity reused for a new perception is a distinct record; private diagnostics are only retained on change", () => {
  const frames: BreakupObservationFrame[] = [1000, 1250, 1500].map((atSimMs, i) => ({ atSimMs, actors: [{ name: "Elaine", appraisal: { pending: i > 1 ? 0 : 1 },
    perceptions: [{ id: 12, type: "attention", source: "phone", content: i > 1 ? "A second actual read" : "First actual read", timestamp: i > 1 ? 1235 : 1234 }] }] }));
  const result = breakupObservationEvidence(frames, 1000);
  expect(result.deliveredPerceptions).toHaveLength(2); expect(result.privateAppraisalDiagnostics).toHaveLength(2);
});

test("only the exact sight-emitter delivered envelope counts as a facial observation; private cause is absent", () => {
  const frame: BreakupObservationFrame = { atSimMs: 16250, actors: [{ name: "Elaine", affect: { feeling: "hurt", reason: "Private breakup text" } },
    { name: "Jerry", perceptions: [
      { id: 1, type: "action", source: "Elaine", content: "Elaine's expression shifts to lips pressed.", timestamp: 1000 },
      { id: 2, type: "speech", source: "Elaine", content: "Elaine's expression shifts to lips pressed.", timestamp: 1001 },
      { id: 3, type: "action", source: "phone", content: "Elaine's expression shifts to lips pressed.", timestamp: 1002 },
      { id: 4, type: "action", source: "Elaine", content: "Elaine looks sad because David dumped her.", timestamp: 1003 },
    ] }] };
  const events = [{ kind: "perception", actor: "Jerry", text: "Elaine's expression shifts to lips pressed.", atSimMs: 16100, sequence: 42 }];
  const result = breakupObservationEvidence([frame], 14700, events);
  expect(result.deliveredFacialExpressionObservations).toEqual([{ observer: "Jerry", subject: "Elaine", expression: "lips pressed", cue: "expression_transition", perceptionId: 1,
    atSimMs: 16100, eventSequence: 42, timing: "exact_delivered_perception_event" }]);
  expect(result.elaineExpressionDeliveredToPeersAfterRead).toHaveLength(1);
  expect(JSON.stringify(result.deliveredFacialExpressionObservations)).not.toContain("David");
});

test("combined physical changes and delivered refreshes are counted separately from expression transitions", () => {
  const frames: BreakupObservationFrame[] = [{ atSimMs: 20000, actors: [{ name: "Elaine" }, { name: "Jerry", perceptions: [
    { id: 1, type: "action", source: "Elaine", content: "Elaine's appearance has changed: expression: jaw clenched, now holding: a phone.", timestamp: 1 },
    { id: 2, type: "action", source: "Elaine", content: "You notice Elaine: expression: jaw clenched; posture: standing; holding: a phone.", timestamp: 2 },
    { id: 3, type: "action", source: "Elaine", content: "Elaine's appearance has changed: clothing: shirt says expression: tearful, posture: standing.", timestamp: 3 },
  ] }] }];
  expect(breakupObservationEvidence(frames, 10000).deliveredFacialExpressionObservations.map(row => row.cue)).toEqual(["multi_property_transition", "appearance_refresh"]);
});
