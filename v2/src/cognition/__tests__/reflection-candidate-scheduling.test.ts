import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { initializeReflectionState, generateReflection, storeReflectionResults, hasPendingReflection, maybeReflect } = await import("../reflection-system");
const { getReflectionQuestions, formatReflectionQuestions } = await import("../reflection-questions");
const { addMemory } = await import("../knowledge-graph");
const { serializeWorld, deserializeWorld } = await import("../../persistence/world-persistence");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { Description, ReflectionState, WorkingMemoryIdentity } = await import("../../ecs/components");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const empty = { insights: [], questionsRaised: [], emotionalSummary: "" };

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(100_000); generate.mockReset();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Candidate scheduling tests are offline"));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); jest.useRealTimers(); jest.restoreAllMocks(); });

function fixture() {
  const world = createArgosWorld("Candidate scheduling"); initializePrefabs(world); startCommittedEvents(world); world.meta.aiEnabled = true;
  const room = createRoomEntity(world, { name: "Study" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Use observed evidence.", roomId: room });
  const state = initializeReflectionState(world, actor);
  const memory = addMemory(world, actor, { type: "episodic", content: "I saw an unfamiliar envelope on my desk.", importance: 1, emotionalValence: 0, timestamp: Date.now() });
  return { world, actor, state, memory };
}
async function candidate(f: ReturnType<typeof fixture>, question = "Who left the envelope?") {
  generate.mockImplementationOnce(async () => {
    Description.value[f.actor] += " Changed during reflection.";
    return { text: JSON.stringify({ ...empty, questionsRaised: [{ question, sourceIds: [`memory:${f.memory}`] }] }) };
  });
  const result = await generateReflection(f.world, f.actor);
  expect(result).not.toBeNull(); expect(storeReflectionResults(f.world, f.actor, result!)).toBe(true);
  ReflectionState.importanceAccum[f.state] = 41;
  return getReflectionQuestions(f.world, f.actor).find(row => row.question === question)!;
}

test("a retained candidate requests one existing-lane review below the importance threshold; readiness is read-only", async () => {
  const f = fixture(), row = await candidate(f);
  const before = ReflectionState.questions[f.state]; generate.mockClear();
  for (let tick = 1; tick <= 3; tick++) {
    advanceSimulationTime(f.world, tick, 60_000);
    expect(hasPendingReflection(f.world, f.actor)).toBe(true);
  }
  expect(generate).not.toHaveBeenCalled();
  expect(ReflectionState.questions[f.state]).toBe(before);
  expect(ReflectionState.importanceAccum[f.state]).toBe(41);
  expect(formatReflectionQuestions(f.world, f.actor)).not.toContain(row.question);
  generate.mockResolvedValueOnce({ text: JSON.stringify({ ...empty, questionReviews: [{ id: row.id, status: "open",
    reason: "The envelope still matters to me.", sourceIds: [`memory:${f.memory}`] }] }) });
  expect(await maybeReflect(f.world, f.actor)).toBe(true);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(getReflectionQuestions(f.world, f.actor)[0].status).toBe("open");
  expect(hasPendingReflection(f.world, f.actor)).toBe(false);
});

test("a stale review remains historical and its unchanged batch cannot create a retry loop", async () => {
  const f = fixture(), row = await candidate(f); generate.mockClear();
  generate.mockImplementationOnce(async () => {
    Description.value[f.actor] += " Another scene change.";
    return { text: JSON.stringify({ ...empty, questionReviews: [{ id: row.id, status: "open",
      reason: "I would like to investigate.", sourceIds: [`memory:${f.memory}`] }] }) };
  });
  expect(await maybeReflect(f.world, f.actor)).toBe(false);
  expect(getReflectionQuestions(f.world, f.actor)[0]).toEqual(row);
  expect(formatReflectionQuestions(f.world, f.actor)).not.toContain(row.question);
  for (let tick = 1; tick <= 3; tick++) {
    await jest.advanceTimersByTimeAsync(60_000); advanceSimulationTime(f.world, tick, 60_000);
    Description.value[f.actor] += " More unrelated change.";
    expect(hasPendingReflection(f.world, f.actor)).toBe(false);
    expect(await maybeReflect(f.world, f.actor)).toBe(false);
  }
  expect(generate).toHaveBeenCalledTimes(1);
  // Ordinary accumulated experience remains an independent reason to reflect.
  ReflectionState.importanceAccum[f.state] = 100;
  expect(hasPendingReflection(f.world, f.actor)).toBe(true);
  generate.mockResolvedValueOnce({ text: JSON.stringify(empty) });
  expect(await maybeReflect(f.world, f.actor)).toBe(true);
  expect(generate).toHaveBeenCalledTimes(2);
});

test("dispatch reserves the attempt before inference and a provider failure does not loop the same candidate batch", async () => {
  const f = fixture(); await candidate(f); generate.mockClear();
  let release!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = maybeReflect(f.world, f.actor);
  expect(hasPendingReflection(f.world, f.actor)).toBe(false);
  expect(await maybeReflect(f.world, f.actor)).toBe(false);
  release({ text: "invalid JSON" }); expect(await pending).toBe(false);
  await jest.advanceTimersByTimeAsync(5000);
  expect(hasPendingReflection(f.world, f.actor)).toBe(false);
  ReflectionState.importanceAccum[f.state] = 100;
  expect(hasPendingReflection(f.world, f.actor)).toBe(true);
  expect(generate).toHaveBeenCalledTimes(1);
});

test("a newly retained candidate batch can request review after existing failure backoff", async () => {
  const f = fixture(); await candidate(f); generate.mockResolvedValueOnce({ text: "invalid JSON" });
  expect(await maybeReflect(f.world, f.actor)).toBe(false);
  await candidate(f, "What does the blue stamp mean?");
  expect(hasPendingReflection(f.world, f.actor)).toBe(false);
  await jest.advanceTimersByTimeAsync(5000);
  expect(hasPendingReflection(f.world, f.actor)).toBe(true);
});

test.each(["source", "owner"] as const)("a %s replacement gets fresh scheduling but never promotes historical candidates", async replacement => {
  const f = fixture(), row = await candidate(f); generate.mockResolvedValueOnce({ text: "invalid JSON" });
  expect(await maybeReflect(f.world, f.actor)).toBe(false);
  await jest.advanceTimersByTimeAsync(5000); expect(hasPendingReflection(f.world, f.actor)).toBe(false);
  if (replacement === "source") {
    stopCommittedEvents(f.world); expect(hasPendingReflection(f.world, f.actor)).toBe(false);
    startCommittedEvents(f.world);
  } else WorkingMemoryIdentity.id[f.actor] = "replacement-actor-lifetime";
  expect(hasPendingReflection(f.world, f.actor)).toBe(true);
  expect(getReflectionQuestions(f.world, f.actor)[0]).toEqual(row);
  expect(formatReflectionQuestions(f.world, f.actor)).not.toContain(row.question);
});

test.each(["source", "owner"] as const)("a late review from the previous %s cannot promote a candidate or consume its replacement's opportunity", async replacement => {
  const f = fixture(), row = await candidate(f); generate.mockClear();
  let release!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = maybeReflect(f.world, f.actor);
  if (replacement === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  else WorkingMemoryIdentity.id[f.actor] = "replacement-during-inference";
  release({ text: JSON.stringify({ ...empty, questionReviews: [{ id: row.id, status: "open",
    reason: "A stale review", sourceIds: [`memory:${f.memory}`] }] }) });
  expect(await pending).toBe(false);
  expect(getReflectionQuestions(f.world, f.actor)[0]).toEqual(row);
  await jest.advanceTimersByTimeAsync(5000);
  expect(hasPendingReflection(f.world, f.actor)).toBe(true);
  expect(formatReflectionQuestions(f.world, f.actor)).not.toContain(row.question);
});

test("removing or freshly reviewing another candidate does not give unchanged old candidates another attempt", async () => {
  const f = fixture(), first = await candidate(f), second = await candidate(f, "What does the stamp mean?");
  generate.mockResolvedValueOnce({ text: JSON.stringify({ ...empty, questionReviews: [{ id: second.id, status: "parked",
    reason: "The stamp is not relevant to me now.", sourceIds: [`memory:${f.memory}`] }] }) });
  expect(await maybeReflect(f.world, f.actor)).toBe(true);
  expect(getReflectionQuestions(f.world, f.actor).find(row => row.id === first.id)?.status).toBe("candidate");
  await jest.advanceTimersByTimeAsync(5000);
  expect(hasPendingReflection(f.world, f.actor)).toBe(false);
  ReflectionState.questions[f.state] = JSON.stringify(getReflectionQuestions(f.world, f.actor).filter(row => row.id === first.id));
  expect(hasPendingReflection(f.world, f.actor)).toBe(false);
});

test("restored candidate history gets a fresh inference opportunity, not a promoted question", async () => {
  const f = fixture(), row = await candidate(f); generate.mockResolvedValueOnce({ text: "invalid JSON" });
  expect(await maybeReflect(f.world, f.actor)).toBe(false);
  const owner = WorkingMemoryIdentity.id[f.actor];
  const saved = JSON.parse(JSON.stringify(serializeWorld(f.world, createSystemRegistry())));
  const restored = createArgosWorld("Restored candidate scheduling"); initializePrefabs(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved);
  startCommittedEvents(restored);
  const actor = oldToNewId.get(f.actor)!;
  expect(WorkingMemoryIdentity.id[actor]).toBe(owner);
  expect(hasPendingReflection(restored, actor)).toBe(false); // Loading a world does not enable AI.
  restored.meta.aiEnabled = true;
  expect(hasPendingReflection(restored, actor)).toBe(true);
  expect(getReflectionQuestions(restored, actor)[0]).toEqual(row);
  expect(formatReflectionQuestions(restored, actor)).not.toContain(row.question);
});

test("a candidate-free actor retains ordinary importance and failure-backoff behavior", async () => {
  const f = fixture(); ReflectionState.importanceAccum[f.state] = 99;
  expect(hasPendingReflection(f.world, f.actor)).toBe(false);
  ReflectionState.importanceAccum[f.state] = 100;
  generate.mockResolvedValue({ text: "invalid JSON" });
  expect(await maybeReflect(f.world, f.actor)).toBe(false);
  expect(hasPendingReflection(f.world, f.actor)).toBe(false);
  await jest.advanceTimersByTimeAsync(5000);
  expect(hasPendingReflection(f.world, f.actor)).toBe(true);
});
