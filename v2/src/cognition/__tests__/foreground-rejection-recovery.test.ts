import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } = await import("../../ecs/prefabs");
const { Agent, ObjectState, WorkingMemoryIdentity } = await import("../../ecs/components");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { agentThink, addPerception, getAgentThoughts, hasUnintegratedAttention } = await import("../agent-mind");
const { runCognitionCycle, executeActions } = await import("../cognition-system");
const { registerAgentWorldCapabilities } = await import("../world-capabilities");
const { isDiscardedForegroundDecision } = await import("../foreground-action-admission");
const { getForegroundCognitionReadiness, formatForegroundRejectionRecovery, captureForegroundRejectionBasis,
  recordForegroundRejection } = await import("../idle-cognition");
const { startCommittedEvents, stopCommittedEvents, getCommittedEvents } = await import("../../runtime/committed-events");
const { snapshotAttentionSignals } = await import("../unresolved-attention");
const { foregroundActionShapeIssue } = await import("../foreground-response-shape");
const { chronicle } = await import("../simulation-chronicle");
let oldKey: string | undefined;
beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset(); jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Recovery tests are offline"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey; });
function fixture() {
  const world = createArgosWorld("Rejected proposals" ); initializePrefabs(world); world.meta.aiEnabled = true; startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Street" });
  const actor = createAgentEntity(world, { name: "Ada", role: "visitor", systemPrompt: "Act from what I perceive.", roomId: room });
  const lamp = createObjectEntity(world, { name: "Lamp", roomId: room }); ObjectState.current[lamp] = "off";
  registerAgentWorldCapabilities(world, actor, { context: () => "", ready: () => true, busy: () => false, execute: () => false });
  addPerception(world, actor, { type: "attention", source: "phone", signalKey: "one", content: "A familiar notification buzzes." });
  return { world, actor, lamp, registry: createSystemRegistry() };
}
const invalid = () => ({ text: JSON.stringify({ innerThought: "NOT_COMMITTED_PRIVATE_TEXT", action: { type: "invented_action" } }) });
test("activity review recovery explains the rejected field without prescribing behavior", () => {
  const f=fixture();
  recordForegroundRejection(f.world,f.actor,captureForegroundRejectionBasis(f.world,f.actor),"invalid_schema","control.activityReview.expectedProgress");
  const feedback=formatForegroundRejectionRecovery(f.world,f.actor);
  expect(feedback).toContain("control.activityReview.expectedProgress");
  expect(feedback).toContain('For "close", omit expectedProgress entirely, including null');
  expect(feedback).not.toContain("NOT_COMMITTED_PRIVATE_TEXT");
  expect(getAgentThoughts(f.world,f.actor)).toHaveLength(0);
  expect(getCommittedEvents(f.world).events).toHaveLength(0);
});
test("goal review recovery identifies the missing reason without choosing an intention",()=>{
  const f=fixture();
  recordForegroundRejection(f.world,f.actor,captureForegroundRejectionBasis(f.world,f.actor),"invalid_schema","goalReview.reason");
  const feedback=formatForegroundRejectionRecovery(f.world,f.actor);
  expect(feedback).toContain("Every goalReview disposition requires a nonblank reason");
  expect(feedback).toContain("or omit goalReview");
  expect(getAgentThoughts(f.world,f.actor)).toHaveLength(0);
  expect(getCommittedEvents(f.world).events).toHaveLength(0);
});
test("native scheduling bounds unchanged invalid proposals without fake actions or acknowledging attention", async () => {
  const f = fixture(); generate.mockImplementation(async () => invalid());
  for (let at = 0; at < 10000; at += 250) {
    f.world.time.elapsed = at;
    await runCognitionCycle(f.world, f.registry, { tick: at / 250, maxAgents: 1, agentEids: [f.actor] });
  }
  expect(generate.mock.calls.length).toBeGreaterThan(1); expect(generate.mock.calls.length).toBeLessThanOrEqual(4);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  expect(getCommittedEvents(f.world).events).toHaveLength(0);
  expect(hasUnintegratedAttention(f.world, f.actor)).toBe(true);
  expect(snapshotAttentionSignals(f.world, f.actor)[0].status).toBe("unreviewed");
});
test("a valid subsequent decision receives bounded protocol feedback and can execute normally", async () => {
  const f = fixture(); generate.mockResolvedValueOnce(invalid()).mockResolvedValueOnce({ text: JSON.stringify({ innerThought: "I can look around.", action: { type: "wait" } }) });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
  expect(getForegroundCognitionReadiness(f.world, f.actor, { hasPendingStimuli: true })).toMatchObject({ ready: false, reason: "rejection_backoff" });
  f.world.time.elapsed = 1000;
  const action = await agentThink(f.world, f.actor);
  expect(action.type).toBe("wait");
  expect(generate.mock.calls[1][0].system).toContain("invalid_schema at action.type");
  expect(generate.mock.calls[1][0].system).not.toContain("NOT_COMMITTED_PRIVATE_TEXT");
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(formatForegroundRejectionRecovery(f.world, f.actor)).toBe("");
});
test.each(["perception", "same-word-new-cue", "physical-state", "persona", "source", "owner", "queued"] as const)("%s change can wake recovery without waiting for the deadline", async change => {
  const f = fixture(); generate.mockResolvedValue(invalid()); await agentThink(f.world, f.actor);
  if (change === "perception" || change === "same-word-new-cue") addPerception(f.world, f.actor,
    { type: "attention", source: "phone", signalKey: "two", content: change === "perception" ? "A different alarm sounds." : "A familiar notification buzzes." });
  if (change === "physical-state") ObjectState.current[f.lamp] = "on";
  if (change === "persona") Agent.systemPrompt[f.actor] = "My circumstances have changed.";
  if (change === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (change === "owner") WorkingMemoryIdentity.id[f.actor] = "replacement";
  expect(getForegroundCognitionReadiness(f.world, f.actor, { hasPendingStimuli: true, hasQueuedStimuli: change === "queued" }).ready).toBe(true);
});
test("late provider failure cannot impose a retry delay on a newly delivered cue", async () => {
  const f = fixture(); generate.mockImplementation(async () => {
    addPerception(f.world, f.actor, { type: "attention", source: "alarm", content: "A new alarm sounds." }); throw new Error("PRIVATE_PROVIDER_ERROR");
  });
  await agentThink(f.world, f.actor);
  expect(getForegroundCognitionReadiness(f.world, f.actor, { hasPendingStimuli: true }).ready).toBe(true);
  expect(formatForegroundRejectionRecovery(f.world, f.actor)).toBe("");
});
test("one receipt cannot increase backoff twice, clock rewind and stop do not inherit it", () => {
  const f = fixture(), basis = captureForegroundRejectionBasis(f.world, f.actor)!;
  recordForegroundRejection(f.world, f.actor, basis, "invalid_schema", "action.type");
  recordForegroundRejection(f.world, f.actor, basis, "invalid_schema", "action.type");
  expect(getForegroundCognitionReadiness(f.world, f.actor).nextCheckAtMs).toBe(1000);
  f.world.time.elapsed = 2000;
  recordForegroundRejection(f.world, f.actor, captureForegroundRejectionBasis(f.world, f.actor), "provider_error");
  f.world.time.elapsed = 0;
  expect(formatForegroundRejectionRecovery(f.world, f.actor)).toBe("");
  stopCommittedEvents(f.world); expect(formatForegroundRejectionRecovery(f.world, f.actor)).toBe("");
});
test("repeated failures have a30-second maximum delay, not an indefinite lockout", () => {
  const f = fixture();
  for (const expected of [1000, 2000, 5000, 10000, 30000, 30000, 30000]) {
    const at = f.world.time.elapsed;
    recordForegroundRejection(f.world, f.actor, captureForegroundRejectionBasis(f.world, f.actor), "provider_error");
    expect(getForegroundCognitionReadiness(f.world, f.actor, { hasPendingStimuli: true })).toMatchObject({ ready: false,
      reason: "rejection_backoff", nextCheckAtMs: at + expected });
    f.world.time.elapsed += expected;
    expect(getForegroundCognitionReadiness(f.world, f.actor, { hasPendingStimuli: true }).ready).toBe(true);
  }
});
test("hidden remote changes and repeated emissions of the same cue do not erase retry pacing", async () => {
  const f = fixture();
  const elsewhere = createRoomEntity(f.world, { name: "Elsewhere" });
  const remote = createObjectEntity(f.world, { name: "Private switch", roomId: elsewhere }); ObjectState.current[remote] = "off";
  generate.mockResolvedValue(invalid()); await agentThink(f.world, f.actor);
  ObjectState.current[remote] = "on";
  addPerception(f.world, f.actor, { type: "attention", source: "phone", signalKey: "one", content: "A familiar notification buzzes." });
  expect(getForegroundCognitionReadiness(f.world, f.actor, { hasPendingStimuli: true })).toMatchObject({ ready: false, reason: "rejection_backoff" });
});
test("unsupported wait conditions get their own operator-only category", async () => {
  const f = fixture(), record = jest.spyOn(chronicle, "record");
  generate.mockResolvedValue({ text: JSON.stringify({ action: { type: "wait", waitUntil: { kind: "physical_fact", subject: "NONEXISTENT_PRIVATE_TARGET", predicate: "state", slot: "ObjectState.current", equals: "arrived" } } }) });
  await agentThink(f.world, f.actor);
  const rejection = record.mock.calls.find(([kind]) => kind === "decision_rejected")?.[1];
  expect(rejection).toMatchObject({ schemaField: "action.waitUntil", schemaIssue: "unobserved_subject_or_slot" });
  expect(JSON.stringify(rejection)).not.toContain("NONEXISTENT_PRIVATE_TARGET");
});
test.each([
  [{ type: "wait", waitUntil: null }, "null_condition", "cannot be null"],
  [{ type: "wait", waitUntil: { kind: "heard_evidence", timeoutMs: 5 } }, "condition_timeout", "timeout range"],
  [{ type: "wait", waitUntil: { kind: "heard_evidence", privateExtra: "PRIVATE_CONDITION" } }, "condition_fields", "additional fields"],
  [{ type: "wait", waitUntil: { kind: "PRIVATE_CONDITION" } }, "condition_kind", "physical_fact or heard_evidence"],
  [{ type: "wait", waitUntil: { kind: "physical_fact", subject: "PRIVATE_CONDITION", predicate: "state", equals: true } }, "condition_equals", "Boolean state values use the strings"],
  [{ type: "observe", waitUntil: { kind: "heard_evidence" } }, "non_wait_action", "only supported on"],
])("a rejected wait returns specific private protocol feedback without recording its raw proposal", async (action, issue, feedback) => {
  const f = fixture(), record = jest.spyOn(chronicle, "record");
  generate.mockResolvedValueOnce({ text: JSON.stringify({ innerThought: "PRIVATE_CONDITION", action }) })
    .mockResolvedValueOnce({ text: JSON.stringify({ action: { type: "wait" } }) });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
  const rejection = record.mock.calls.find(([kind]) => kind === "decision_rejected")?.[1];
  expect(rejection).toMatchObject({ schemaField: "action.waitUntil", schemaIssue: issue });
  expect(JSON.stringify(rejection)).not.toContain("PRIVATE_CONDITION");
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  expect(getCommittedEvents(f.world).events).toHaveLength(0);
  expect(hasUnintegratedAttention(f.world, f.actor)).toBe(true);
  f.world.time.elapsed = 1000;
  const valid = await agentThink(f.world, f.actor);
  expect(valid.type).toBe("wait");
  expect(generate.mock.calls[1][0].system).toContain(feedback);
  expect(generate.mock.calls[1][0].system).not.toContain("PRIVATE_CONDITION");
  executeActions(f.world, [{ eid: f.actor, action: valid }], f.registry);
  expect(formatForegroundRejectionRecovery(f.world, f.actor)).toBe("");
});
test.each([
  [{ action: { type: "wait", target: 5 } }, "action.target"],
  [{ action: { type: "wait", content: null } }, "action.content"],
  [{ action: { type: "wait", listeningTo: "unknown" } }, "action.listeningTo"],
  [{ action: { type: "wait" }, innerThought: [] }, "innerThought"],
])("shape diagnostics distinguish the failed field without retaining its value", (input, field) => {
  expect(foregroundActionShapeIssue(input, ["wait"], [])).toBe(field);
});
