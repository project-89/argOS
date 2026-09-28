import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { serializeWorld, deserializeWorld } = await import("../../persistence/world-persistence");
const { startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { addMemory } = await import("../knowledge-graph");
const { buildAgentContext } = await import("../agent-mind");
const { initializeReflectionState, generateReflection, storeReflectionResults } = await import("../reflection-system");
const { getReflectionQuestions, formatReflectionQuestions } = await import("../reflection-questions");
const { enableControlLoopDiagnostics, getControlLoopDiagnostics } = await import("../../runtime/control-loop-diagnostics");
const { Description, Memory } = await import("../../ecs/components");
const { recordCommittedSpeech } = await import("../social-memory");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { setLocatedIn } = await import("../../ecs/location");
const empty = { insights: [], questionsRaised: [], emotionalSummary: "" };
beforeEach(() => {
  generate.mockReset();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Question tests stay offline"));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
function fixture() {
  const world = createArgosWorld("Questions"); initializePrefabs(world); startCommittedEvents(world); world.meta.aiEnabled = true;
  const room = createRoomEntity(world, { name: "Study" });
  const actor = createAgentEntity(world, { name: "Ada", role: "observer", systemPrompt: "Consider evidence.", roomId: room });
  const peer = createAgentEntity(world, { name: "Bo", role: "observer", systemPrompt: "Consider evidence.", roomId: room });
  initializeReflectionState(world, actor);
  const memory = addMemory(world, actor, { type: "episodic", content: "I saw an unfamiliar envelope on my desk.", importance: 1, emotionalValence: 0, timestamp: Date.now() });
  return { world, actor, peer, memory };
}
async function reflect(f: ReturnType<typeof fixture>, value: object) {
  generate.mockResolvedValue({ text: JSON.stringify(value) });
  return generateReflection(f.world, f.actor);
}
test("unanswered questions survive, deduplicate, enter private context and round-trip through ECS", async () => {
  const f = fixture(), question = "Who left that envelope, and what evidence could tell me?";
  const result = await reflect(f, { ...empty, questionsRaised: [question, ` ${question} `] });
  expect(result).not.toBeNull(); expect(storeReflectionResults(f.world, f.actor, result!)).toBe(true);
  expect(getReflectionQuestions(f.world, f.actor)).toHaveLength(1);
  expect(getReflectionQuestions(f.world, f.actor)[0]).toMatchObject({ question, status: "open", raisedAtSimMs: 0 });
  expect(buildAgentContext(f.world, f.actor)).toContain(question);
  expect(buildAgentContext(f.world, f.peer)).not.toContain(question);
  const saved = JSON.parse(JSON.stringify(serializeWorld(f.world, createSystemRegistry())));
  const before = getReflectionQuestions(f.world, f.actor);
  const restored = createArgosWorld("Restored"); initializePrefabs(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved);
  expect(getReflectionQuestions(restored, oldToNewId.get(f.actor)!)).toEqual(before);
});
test.each(["answered", "parked", "open"] as const)("sourced reflection can review a question as %s without creating an action", async status => {
  const f = fixture(); storeReflectionResults(f.world, f.actor, { ...empty, questionsRaised: ["Who left the envelope?"] });
  const q = getReflectionQuestions(f.world, f.actor)[0];
  const evidence = addMemory(f.world, f.actor, { type: "episodic", content: "Bo told me he left the envelope. This is his account, not independent proof.", importance: 1, emotionalValence: 0, timestamp: Date.now() });
  const result = await reflect(f, { ...empty, questionReviews: [{ id: q.id, status, reason: "I can consider Bo's account.", sourceIds: [`memory:${evidence}`] }] });
  expect(result).not.toBeNull(); expect(storeReflectionResults(f.world, f.actor, result!)).toBe(true);
  expect(getReflectionQuestions(f.world, f.actor)[0]).toMatchObject({ id: q.id, status,
    review: { evidence: [{ id: `memory:${evidence}`, excerpt: expect.stringContaining("his account") }] } });
  expect(formatReflectionQuestions(f.world, f.actor)).toContain("not verified answers");
  storeReflectionResults(f.world, f.actor, { ...empty, questionsRaised: [q.question] });
  expect(getReflectionQuestions(f.world, f.actor)[0].status).toBe(status);
});
test.each(["forged_source", "other_actor_question", "after_stop", "other_world", "tampered", "newer_questions", "new_evidence"])("question reviews reject %s", async kind => {
  const f = fixture(); storeReflectionResults(f.world, f.actor, { ...empty, questionsRaised: ["Who left the envelope?"] });
  const q = getReflectionQuestions(f.world, f.actor)[0], before = JSON.stringify(getReflectionQuestions(f.world, f.actor));
  const result = await reflect(f, { ...empty, questionReviews: [{ id: kind === "other_actor_question" ? "question:unissued" : q.id,
    status: "answered", reason: "I have an interpretation", sourceIds: [kind === "forged_source" ? "memory:unissued" : `memory:${f.memory}`] }] });
  if (["forged_source", "other_actor_question"].includes(kind)) expect(result).toBeNull();
  else {
    expect(result).not.toBeNull();
    if (kind === "after_stop") stopCommittedEvents(f.world);
    if (kind === "tampered") result!.questionReviews![0].reason = "INJECTED";
    if (kind === "newer_questions") storeReflectionResults(f.world, f.actor, { ...empty, questionsRaised: ["Should I ask Bo?"] });
    if (kind === "new_evidence") addMemory(f.world,f.actor,{type:"episodic",content:"Bo has just denied leaving it.",importance:1,emotionalValence:0,timestamp:Date.now()});
    const other = kind === "other_world" ? fixture() : f;
    expect(storeReflectionResults(other.world, other.actor, result!)).toBe(false);
    // Creating the legacy world resets process-global SoA arrays. Assert the
    // destination did not inherit anything; the old world is no longer live.
    if (kind === "other_world") { expect(getReflectionQuestions(other.world, other.actor)).toEqual([]); return; }
  }
  expect(getReflectionQuestions(f.world, f.actor)[0].status).toBe("open");
  if (kind !== "newer_questions") expect(JSON.stringify(getReflectionQuestions(f.world, f.actor))).toBe(before);
});
test("questions are bounded and do not evict other unresolved questions", () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) storeReflectionResults(f.world, f.actor, { ...empty, questionsRaised: [`What does clue ${i} mean?`] });
  const rows = getReflectionQuestions(f.world, f.actor);
  expect(rows).toHaveLength(12); expect(rows[0].question).toBe("What does clue 0 mean?");
  expect(storeReflectionResults(f.world, f.actor, { ...empty, questionsRaised: ["x".repeat(401)] })).toBe(false);
});

test.each(["omitted", "admitted", "stale"])("reflection diagnostics distinguish %s questions without changing admission", async kind => {
  const f = fixture(); enableControlLoopDiagnostics(f.world);
  generate.mockImplementationOnce(async () => {
    if (kind === "stale") Description.value[f.actor] = "A changed visible description";
    return { text: JSON.stringify({ ...empty, questionsRaised: kind === "omitted" ? [] : ["PRIVATE_QUESTION: Who left it?"],
      insights: [{ insight: "PRIVATE_INSIGHT: I recall seeing the envelope.", importance: .5, relatedMemories: [],
        category: "world", temporalScope: "historical", sourceIds: [`memory:${f.memory}`] }] }) };
  });
  const result = await generateReflection(f.world, f.actor);
  expect(result).not.toBeNull(); expect(result!.insights).toHaveLength(1);
  expect(storeReflectionResults(f.world, f.actor, result!)).toBe(true);
  expect(getReflectionQuestions(f.world, f.actor)).toHaveLength(kind === "admitted" ? 1 : 0);
  const trace = getControlLoopDiagnostics(f.world).entries;
  expect(new Set(trace.map(e => e.requestId)).size).toBe(1);
  expect(trace.find(e => e.stage === "generated")?.detail.questions).toBe(kind === "omitted" ? 0 : 1);
  expect(trace.find(e => e.stage === "generation_admission")?.detail).toMatchObject({
    retained: { insights: 1, questions: kind === "admitted" ? 1 : 0 },
    ...(kind === "stale" ? { reason: "description_changed" } : {}),
  });
  expect(trace.at(-1)?.stage).toBe("stored");
  expect(JSON.stringify(trace)).not.toMatch(/PRIVATE_QUESTION|PRIVATE_INSIGHT/);
  expect(buildAgentContext(f.world, f.peer)).not.toContain("generation_admission");
});

test("generated question schema failures and late storage failures have separate diagnostic stages", async () => {
  const f = fixture(); enableControlLoopDiagnostics(f.world);
  expect(await reflect(f, { ...empty, questionsRaised: ["x".repeat(401)] })).toBeNull();
  expect(getControlLoopDiagnostics(f.world).entries.at(-1)).toMatchObject({ stage: "generation_rejected", detail: { reason: "invalid_schema" } });
  const result = await reflect(f, { ...empty, questionsRaised: ["Who left it?"] });
  stopCommittedEvents(f.world);
  expect(storeReflectionResults(f.world, f.actor, result!)).toBe(false);
  expect(getControlLoopDiagnostics(f.world).entries.at(-1)).toMatchObject({ stage: "storage_admission", detail: { reason: "source_stopped", retained: { questions: 0 } } });
});

test("speech during background inference preserves sourced history but rejects present question admission", async () => {
  const f = fixture(); enableControlLoopDiagnostics(f.world);
  generate.mockImplementationOnce(async () => {
    recordCommittedSpeech(f.world, f.peer, "I left that envelope for you.", "Ada");
    return { text: JSON.stringify({ ...empty, questionsRaised: ["Who left that envelope?"],
      insights: [{ insight: "I remember wondering about the envelope.", importance: .5, relatedMemories: [], category: "world",
        temporalScope: "historical", sourceIds: [`memory:${f.memory}`] }] }) };
  });
  const result = await generateReflection(f.world, f.actor);
  expect(result?.insights).toHaveLength(1); expect(result?.questionsRaised).toEqual([]);
  expect(storeReflectionResults(f.world, f.actor, result!)).toBe(true);
  expect(getControlLoopDiagnostics(f.world).entries.find(e => e.stage === "generation_admission")?.detail)
    .toMatchObject({ reason: "dialogue_changed", input: { questions: 1 }, retained: { questions: 0, insights: 1 } });
});

test("a sourced question survives speech as a private historical candidate, then requires fresh review", async () => {
  const f = fixture(); enableControlLoopDiagnostics(f.world);
  const question = "CANDIDATE_ONLY: Who left that envelope?";
  generate.mockImplementationOnce(async () => {
    recordCommittedSpeech(f.world, f.peer, "I left the envelope for you.", "Ada");
    return { text: JSON.stringify({ ...empty, questionsRaised: [{ question, sourceIds: [`memory:${f.memory}`] }] }) };
  });
  const result = await generateReflection(f.world, f.actor);
  expect(result).not.toBeNull(); expect(storeReflectionResults(f.world, f.actor, result!)).toBe(true);
  const row = getReflectionQuestions(f.world, f.actor)[0];
  expect(row).toMatchObject({ question, status: "candidate", origin: { consideredAtSimMs: 0,
    evidence: [{ id: `memory:${f.memory}`, excerpt: expect.stringContaining("unfamiliar envelope") }] } });
  expect(formatReflectionQuestions(f.world, f.actor)).not.toContain(question);
  expect(buildAgentContext(f.world, f.actor)).not.toContain(question);
  expect(buildAgentContext(f.world, f.peer)).not.toContain(question);
  expect(getControlLoopDiagnostics(f.world).entries.find(e => e.stage === "generation_admission")?.detail)
    .toMatchObject({ retained: { questions: 1 }, candidateQuestions: 1 });
  expect(getControlLoopDiagnostics(f.world).entries.at(-1)?.detail.totalCandidates).toBe(1);
  const reviewed = await reflect(f, { ...empty, questionReviews: [{ id: row.id, status: "open",
    reason: "I still want to understand the envelope.", sourceIds: [`memory:${f.memory}`] }] });
  expect(generate.mock.calls.at(-1)![0].system).toContain("HISTORICAL QUESTION CANDIDATES");
  expect(storeReflectionResults(f.world, f.actor, reviewed!)).toBe(true);
  expect(getReflectionQuestions(f.world, f.actor)[0]).toMatchObject({ id: row.id, status: "open" });
  expect(buildAgentContext(f.world, f.actor)).toContain(question);
});

test("fresh sourced questions enter the current question store with their issued evidence", async () => {
  const f = fixture();
  const result = await reflect(f, { ...empty, questionsRaised: [{ question: "Who left it?", sourceIds: [`memory:${f.memory}`] }] });
  expect(result).not.toBeNull(); expect(storeReflectionResults(f.world, f.actor, result!)).toBe(true);
  expect(getReflectionQuestions(f.world, f.actor)[0]).toMatchObject({ status: "open", origin: { evidence: [{ id: `memory:${f.memory}` }] } });
});

async function historicalCandidate(f: ReturnType<typeof fixture>, question = "Who left that envelope?") {
  generate.mockImplementationOnce(async () => {
    Description.value[f.actor] += " Changed during reflection.";
    return { text: JSON.stringify({ ...empty, questionsRaised: [{ question, sourceIds: [`memory:${f.memory}`] }] }) };
  });
  const result = await generateReflection(f.world, f.actor);
  expect(result).not.toBeNull(); expect(storeReflectionResults(f.world, f.actor, result!)).toBe(true);
  return getReflectionQuestions(f.world, f.actor)[0];
}

test.each(["unknown", "foreign", "duplicate"])("sourced questions reject %s citations rather than inventing provenance", async kind => {
  const f = fixture();
  const peerMemory = addMemory(f.world, f.peer, { type: "episodic", content: "PRIVATE_PEER_SOURCE", importance: 1, emotionalValence: 0, timestamp: Date.now() });
  const refs = kind === "unknown" ? ["memory:unissued"] : kind === "foreign" ? [`memory:${peerMemory}`] : [`memory:${f.memory}`, `memory:${f.memory}`];
  expect(await reflect(f, { ...empty, questionsRaised: [{ question: "Who left it?", sourceIds: refs }] })).toBeNull();
  expect(getReflectionQuestions(f.world, f.actor)).toEqual([]);
});

test.each(["source_changed", "output_changed", "copied_result", "newer_questions", "stopped", "new_source", "other_actor", "other_world"])(
  "historical candidate rejects %s at storage", async kind => {
    const f = fixture();
    const result = await reflect(f, { ...empty, questionsRaised: [{ question: "Who left it?", sourceIds: [`memory:${f.memory}`] }] });
    expect(result).not.toBeNull();
    if (kind === "source_changed") Memory.content[f.memory] = "Different evidence";
    if (kind === "output_changed") (result!.questionsRaised[0] as { question: string }).question = "FORGED";
    if (kind === "newer_questions") storeReflectionResults(f.world, f.actor, { ...empty, questionsRaised: ["Newer question"] });
    if (kind === "stopped" || kind === "new_source") stopCommittedEvents(f.world);
    if (kind === "new_source") startCommittedEvents(f.world);
    const target = kind === "other_world" ? fixture() : f;
    expect(storeReflectionResults(target.world, kind === "other_actor" ? f.peer : target.actor,
      kind === "copied_result" ? structuredClone(result!) : result!)).toBe(false);
    expect(getReflectionQuestions(target.world, kind === "other_actor" ? f.peer : target.actor)).toHaveLength(kind === "newer_questions" ? 1 : 0);
  });

test("late output filters changed cited evidence per question and retains the untouched historical candidate", async () => {
  const f = fixture();
  const second = addMemory(f.world, f.actor, { type: "episodic", content: "I saw a blue stamp on it.", importance: 1, emotionalValence: 0, timestamp: Date.now() });
  generate.mockImplementationOnce(async () => {
    Memory.content[f.memory] = "Replaced evidence";
    return { text: JSON.stringify({ ...empty, questionsRaised: [
      { question: "Who left it?", sourceIds: [`memory:${f.memory}`] },
      { question: "What does that stamp mean?", sourceIds: [`memory:${second}`] },
    ] }) };
  });
  const result = await generateReflection(f.world, f.actor);
  expect(result?.questionsRaised).toHaveLength(1);
  expect(storeReflectionResults(f.world, f.actor, result!)).toBe(true);
  expect(getReflectionQuestions(f.world, f.actor)).toEqual([expect.objectContaining({ question: "What does that stamp mean?", status: "candidate" })]);
});

test.each(["open", "answered", "parked"] as const)("candidate review to %s cannot commit across a changed scene", async status => {
  const f = fixture(), row = await historicalCandidate(f);
  const result = await reflect(f, { ...empty, questionReviews: [{ id: row.id, status, reason: "A considered review.", sourceIds: [`memory:${f.memory}`] }] });
  Description.value[f.actor] += " A later scene change.";
  expect(storeReflectionResults(f.world, f.actor, result!)).toBe(false);
  expect(getReflectionQuestions(f.world, f.actor)[0]).toEqual(row);
  const current = await reflect(f, { ...empty, questionReviews: [{ id: row.id, status, reason: "Reviewed with current evidence.", sourceIds: [`memory:${f.memory}`] }] });
  expect(storeReflectionResults(f.world, f.actor, current!)).toBe(true);
  expect(getReflectionQuestions(f.world, f.actor)[0]).toMatchObject({ status, origin: row.origin });
});

test("a candidate never silently promotes on scene restoration or repeated new output", async () => {
  const f = fixture(), original = Description.value[f.actor];
  generate.mockImplementationOnce(async () => {
    Description.value[f.actor] = "Changed";
    return { text: JSON.stringify({ ...empty, questionsRaised: [{ question: "Who left it?", sourceIds: [`memory:${f.memory}`] }] }) };
  });
  const result = await generateReflection(f.world, f.actor);
  Description.value[f.actor] = original;
  expect(storeReflectionResults(f.world, f.actor, result!)).toBe(true);
  expect(getReflectionQuestions(f.world, f.actor)[0].status).toBe("candidate");
  const duplicate = await reflect(f, { ...empty, questionsRaised: [{ question: "  Who left it?  ", sourceIds: [`memory:${f.memory}`] }] });
  expect(storeReflectionResults(f.world, f.actor, duplicate!)).toBe(true);
  storeReflectionResults(f.world, f.actor, { ...empty, questionsRaised: ["Who left it?"] });
  expect(getReflectionQuestions(f.world, f.actor)).toHaveLength(1);
  expect(getReflectionQuestions(f.world, f.actor)[0].status).toBe("candidate");
});

test("a local-view change retains a candidate with distinct consideration and storage simulation times", async () => {
  const f = fixture(), remote = createRoomEntity(f.world, { name: "Other room" });
  generate.mockImplementationOnce(async () => {
    advanceSimulationTime(f.world, 1, 1500); setLocatedIn(f.world, f.peer, remote);
    return { text: JSON.stringify({ ...empty, questionsRaised: [{ question: "Who left it?", sourceIds: [`memory:${f.memory}`] }] }) };
  });
  const result = await generateReflection(f.world, f.actor);
  expect(storeReflectionResults(f.world, f.actor, result!)).toBe(true);
  expect(getReflectionQuestions(f.world, f.actor)[0]).toMatchObject({ status: "candidate", raisedAtSimMs: 1500, origin: { consideredAtSimMs: 0 } });
});

test("candidate history round-trips as inert private data, without restoring its request authority", async () => {
  const f = fixture(), row = await historicalCandidate(f, "SAVE_PRIVATE_CANDIDATE");
  const saved = JSON.parse(JSON.stringify(serializeWorld(f.world, createSystemRegistry())));
  const restored = createArgosWorld("Restored candidates"); initializePrefabs(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved);
  const actor = oldToNewId.get(f.actor)!;
  expect(getReflectionQuestions(restored, actor)).toEqual([row]);
  expect(formatReflectionQuestions(restored, actor)).not.toContain(row.question);
  expect(formatReflectionQuestions(restored, actor, true)).toContain(row.question);
  expect(storeReflectionResults(restored, actor, { ...empty, questionsRaised: [{ question: "Injected sourced question", sourceIds: [`memory:${f.memory}`] }] })).toBe(false);
});

test("candidate capacity protects unresolved entries and makes no goals, plans or inner speech", async () => {
  const f = fixture();
  const { getRelationTargets } = await import("bitecs");
  const { HasGoal, HasPlan, HasThought } = await import("../../ecs/relations");
  const before = [HasGoal, HasPlan, HasThought].map(relation => getRelationTargets(f.world, f.actor, relation));
  for (let i = 0; i < 16; i++) await historicalCandidate(f, `Question number ${i}?`);
  const rows = getReflectionQuestions(f.world, f.actor);
  expect(rows).toHaveLength(12); expect(rows[0].question).toBe("Question number 0?");
  expect(rows.every(row => row.status === "candidate")).toBe(true);
  expect([HasGoal, HasPlan, HasThought].map(relation => getRelationTargets(f.world, f.actor, relation))).toEqual(before);
});
