import { evaluateLivingWorld, type WorldSoakEvidence } from "../living-world-evaluation";

function evidence(): WorldSoakEvidence {
  const messages = [
    { id: 1, direction: "in", body: "Remember lantern", status: "read", createdMs: 8000, deliveredMs: 8000, readMs: 20000, replyTo: -1 },
    { id: 2, direction: "in", body: "Are you okay?", status: "read", createdMs: 63000, deliveredMs: 81000, readMs: 90000, replyTo: -1 },
    { id: 3, direction: "in", body: "What was the word?", status: "read", createdMs: 132000, deliveredMs: 132000, readMs: 140000, replyTo: -1 },
    { id: 4, direction: "out", body: "The word is lantern.", status: "delivered", createdMs: 145000, deliveredMs: 152000, readMs: -1, replyTo: 3 },
  ];
  const history = Array.from({ length: 37 }, (_, i) => ({ sequence: i, atMs: i * 5000, kind: "thought", text: "A thought", perceived: true }));
  history.push({ sequence: 38, atMs: 1000, kind: "cognition_completed", text: "Shared cognition finished in 900ms. Ready delay: 0ms", perceived: true });
  history.push({ sequence: 39, atMs: 15000, kind: "phone_picked_up", text: "Phone transferred from Landing to Mara's hand.", perceived: true });
  return {
    durationMs: 180000, history, privacyViolations: [], memoryQuestionId: 3, offlineMessageId: 2, rememberedWord: "lantern",
    interventions: [{ type: "phone_relocated", atMs: 10000 }, { type: "network_restored", atMs: 81000 }],
    samples: Array.from({ length: 181 }, (_, i) => ({ wallMs: i * 1000, tick: i, elapsedMs: i * 1000, location: "Landing", phase: "idle", decisions: i, clock: i, buildStatus: "active" })),
    snapshot: { elapsedMs: 180000, messages } as WorldSoakEvidence["snapshot"],
    runtime: { tick: 180, operations: ["AgentCognition:1", "AgentPlanning:1", "AgentSubconscious:1", "WorldEvolution", "GodAutopilot", "NarrativeDirector", "DaemonSystem"]
      .map(name => ({ name, lane: "background", metrics: { completed: 20, failed: 0 } })) } as WorldSoakEvidence["runtime"],
  };
}

test("independently scored successful sustained evidence passes", () => {
  expect(Object.values(evaluateLivingWorld(evidence()).gates).every(Boolean)).toBe(true);
});

test("a still-enabled but stalled world and maintenance cannot pass", () => {
  const e = evidence();
  e.samples.forEach((s, i) => { if (i > 10) s.tick = 10; s.clock = 0; });
  e.runtime!.operations.find(o => o.name === "WorldEvolution")!.metrics.completed = 0;
  const result = evaluateLivingWorld(e);
  expect(result.maxTickStallMs).toBe(170000);
  expect(result.gates.worldKeptTicking).toBe(false);
  expect(result.gates.worldMaintenanceRan).toBe(false);
  expect(result.gates.generatedSystemKeptRunning).toBe(false);
});

test("one first reply cannot stand in for delayed memory or physical message handling", () => {
  const e = evidence();
  e.snapshot.messages[3].replyTo = 1;
  e.snapshot.messages[1].deliveredMs = 63000;
  e.snapshot.messages[0].readMs = -1;
  e.privacyViolations.push("secret visible before reading");
  const gates = evaluateLivingWorld(e).gates;
  expect(gates.delayedRecall).toBe(false);
  expect(gates.offlineDeliveryRespected).toBe(false);
  expect(gates.repliesFollowPhysicalRead).toBe(false);
  expect(gates.unreadKnowledgePrivate).toBe(false);
});

test("fast opening followed by idle cognition fails sustained progress", () => {
  const e = evidence(); e.history = e.history.filter(r => r.atMs < 10000);
  expect(evaluateLivingWorld(e).gates.cognitionContinued).toBe(false);
  e.snapshot.messages[3].body = "The word was ash.";
  expect(evaluateLivingWorld(e).gates.delayedRecall).toBe(false);
});

test("a narrator restoring the old phone placement does not pass persistence just because a reply arrived", () => {
  const e = evidence();
  e.history.find(r => r.kind === "phone_picked_up")!.text = "Phone transferred from Bedroom desk to Mara's hand.";
  const gates = evaluateLivingWorld(e).gates;
  expect(gates.delayedRecall).toBe(true);
  expect(gates.relocationRespectedThroughPickup).toBe(false);
});

test("repeated failed actions and unread secrets in thoughts invalidate an otherwise lively run", () => {
  const e = evidence();
  for (let i = 0; i < 3; i++) e.history.push({ sequence: 40 + i, atMs: 50000 + i * 15000, kind: "action_failed", text: "Unavailable", perceived: true });
  e.history[0].text = "The verification word is lantern.";
  const gates = evaluateLivingWorld(e).gates;
  expect(gates.noRepeatedActionFailureLoop).toBe(false);
  expect(gates.unreadKnowledgePrivate).toBe(false);
});
