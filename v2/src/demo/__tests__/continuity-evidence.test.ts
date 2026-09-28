import { summarizeContinuityEvidence } from "../continuity-evidence";

test("sampled cumulative admissions are counted once and retained after stop", () => {
  const actor = { name: "Ada", foregroundDiagnostics: { admissions: 3, counts: { new_stimulus: 2, first_decision: 1 },
    lastAdmission: { atSimMs: 1000, reason: "new_stimulus", listening: { untilSimMs: 2000, executionIds: ["heard"] } } } };
  const result = summarizeContinuityEvidence([], [{ atSimMs: 1000, actors: [actor] }, { atSimMs: 1250, actors: [actor] },
    { atSimMs: 2000, actors: [{ name: "Ada" }] }]);
  expect(result.actors[0]).toMatchObject({ foregroundAdmissions: 3, sampledAdmissions: 1, newStimulusAdmissionsDuringListening: 1 });
  result.actors[0].admissionReasons!.new_stimulus = 900;
  expect(actor.foregroundDiagnostics.counts.new_stimulus).toBe(2);
});

test("reports actual expressed thoughts and completed speech separately, without semantic scores", () => {
  const result = summarizeContinuityEvidence([
    { actor: "Ada", atSimMs: 0, kind: "thought", thoughtType: "reasoning" },
    { actor: "Ada", atSimMs: 1, kind: "thought", thoughtType: "appraisal" },
    { actor: "Ada", atSimMs: 2, kind: "speech", status: "pending" },
    { actor: "Ada", atSimMs: 3, kind: "speech", status: "succeeded" },
    { actor: "Bo", atSimMs: 4, kind: "thought", thoughtType: "reasoning" },
    { actor: "Ada", atSimMs: 0, kind: "foreground_disposition", disposition: { type: "cognition_integrated" } },
    { actor: "Ada", atSimMs: 4, kind: "foreground_disposition", disposition: { type: "cognition_integrated" } },
    { actor: "Ada", atSimMs: 4, kind: "foreground_disposition", disposition: { type: "decision_rejected" } },
    ...[100, 200, 300, NaN].map(durationWallMs => ({ actor: "Ada", atSimMs: 4, kind: "decision_latency", durationWallMs })),
  ], [{ atSimMs: 4, actors: [{ name: "Ada" }] }]);
  expect(result.actors[0]).toMatchObject({ integratedDecisions: 2, expressedReasoningThoughts: 1, completedSpokenTurns: 1, foregroundAdmissions: null,
    admissionReasons: null, decisionLatency: { samples: 3, medianMs: 200, p95Ms: 300 } });
  expect(result.interpretation).toContain("not semantic quality");
});
