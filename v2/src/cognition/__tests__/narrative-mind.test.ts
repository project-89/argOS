import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { addEntity, addComponent, getRelationTargets, removeEntity } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createRoomEntity, createAgentEntity } = await import("../../ecs/prefabs");
const { Agent, EmotionalLife, Goal, Mind, NarrativeEntry, WorkingMemoryIdentity } = await import("../../ecs/components");
const { HasGoal, HasNarrative } = await import("../../ecs/relations");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { serializeWorld, deserializeWorld } = await import("../../persistence/world-persistence");
const { startCommittedEvents, stopCommittedEvents, getCommittedEvents } = await import("../../runtime/committed-events");
const { workingMemoryEntityRef } = await import("../working-memory");
const { addMemory, getAgentMemories, getAgentBeliefs, extractKnowledgeFromInteraction } = await import("../knowledge-graph");
const { addThought, agentThink, buildAgentContext, getAgentThoughts } = await import("../agent-mind");
const { executeActions } = await import("../cognition-system");
const { isDiscardedForegroundDecision } = await import("../foreground-action-admission");
const { appendNarrative, getNarrativeHistory, formatNarrativeMemory, narrativeEntryCount } = await import("../narrative-memory");
const { getEmotionalEpisodes, emotionalActivation, setEmotionalActivation, runEmotionalDynamics, prepareEmotionalEpisode, emotionalLifeBasis } = await import("../emotional-life");
const { queueExperiencedEvent, runExperienceAppraisal } = await import("../experience-appraisal");
const { generateReflection, storeReflectionResults } = await import("../reflection-system");
const { createPersonalIntention } = await import("../goal-lifecycle");
const { snapshotAffect } = await import("../affect-state");
const { getPersonalConcerns } = await import("../personal-concerns");
const { hasPendingPersonalGoalReview, resetAutonomousGoals } = await import("../autonomous-goals");

function fixture() {
  const world = createArgosWorld("Narrative laboratory"); initializePrefabs(world);
  world.meta.narrativeMind = true; world.meta.aiEnabled = true;
  const room = createRoomEntity(world, { name: "Lounge" });
  const actor = createAgentEntity(world, { name: "Ada", role: "guest", systemPrompt: "I value closeness and independence.", roomId: room });
  const other = createAgentEntity(world, { name: "Lin", role: "friend", systemPrompt: "PRIVATE_OTHER_PERSONA", roomId: room });
  workingMemoryEntityRef(world, actor); workingMemoryEntityRef(world, other);
  startCommittedEvents(world); advanceSimulationTime(world, 1, 1000);
  const event = { id: "read:1", channel: "phone", source: "Sam, partner", content: "PRIVATE_RECEIPT: I am ending our relationship.", atSimMs: 1000 };
  return { world, actor, other, event };
}
type Fixture = ReturnType<typeof fixture>;
const episode = { episodeId: "new", thread: "What I thought we had", meaning: "I expected we still mattered to each other.",
  feelings: [{ feeling: "hurt", strength: .9 }, { feeling: "anger", strength: .5 }],
  desires: ["I want him to care", "I do not want to plead"], activation: .9, stance: "open" };
const monologue = "I keep looking at those words. Yesterday I was imagining next weekend with him. I want to ask why, and I hate that I want to ask.";
const appraisal = { innerThought: monologue, emotionalEpisode: episode };
const response = (data: unknown) => ({ text: JSON.stringify(data) });
const narrate = (f: Fixture, extra: Partial<Parameters<typeof appendNarrative>[2]> = {}) => appendNarrative(f.world, f.actor, {
  kind: "experience", monologue, importance: .9, sourceAtSimMs: 1000,
  evidence: [{ id: f.event.id, kind: "experience", content: f.event.content, atSimMs: 1000 }], ...extra,
});
const queue = (f: Fixture) => queueExperiencedEvent(f.world, f.actor, f.event);
let savedKey: string | undefined;
let savedExtraction: string | undefined, savedDisabled: string | undefined;
beforeEach(() => { savedKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  savedExtraction = process.env.ARGOS_ENABLE_LLM_IN_TESTS; savedDisabled = process.env.ARGOS_DISABLE_KNOWLEDGE_EXTRACTION;
  delete process.env.ARGOS_DISABLE_KNOWLEDGE_EXTRACTION;
  generate.mockReset(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network in narrative tests")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  if (savedExtraction === undefined) delete process.env.ARGOS_ENABLE_LLM_IN_TESTS; else process.env.ARGOS_ENABLE_LLM_IN_TESTS = savedExtraction;
  if (savedDisabled === undefined) delete process.env.ARGOS_DISABLE_KNOWLEDGE_EXTRACTION; else process.env.ARGOS_DISABLE_KNOWLEDGE_EXTRACTION = savedDisabled;
  if (savedKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = savedKey; });

test("a grounded emotional episode can contain conflicting desires without creating a task or public disclosure", async () => {
  const f = fixture(); queue(f); generate.mockResolvedValue(response(appraisal));
  expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("admitted");
  expect(getEmotionalEpisodes(f.world, f.actor)).toMatchObject([{ thread: episode.thread, desires: episode.desires, evidenceIds: ["read:1"] }]);
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toEqual([]);
  expect(getNarrativeHistory(f.world, f.actor)).toMatchObject([{ kind: "experience", monologue, sourceAtSimMs: 1000,
    evidence: [{ content: f.event.content }], episodeSnapshot: { meaning: episode.meaning, desires: episode.desires } }]);
  expect(getNarrativeHistory(f.world, f.other)).toEqual([]); expect(getCommittedEvents(f.world).events).toEqual([]);
  expect(buildAgentContext(f.world, f.other)).not.toContain("PRIVATE_RECEIPT");
  expect(buildAgentContext(f.world, f.other)).not.toContain(monologue);
  expect(buildAgentContext(f.world, f.actor)).toContain(monologue);
  expect(generate).toHaveBeenCalledTimes(1);
});

test.each([false, true])("episode-only significance reaches fresh review without forcing its feelings or actions (historical=%s)", async historical => {
  resetAutonomousGoals(); const f = fixture(); queue(f);
  const goal = createPersonalIntention(f.world, f.actor, "Finish our conversation", 7)!;
  generate.mockImplementation(async () => {
    if (historical) Goal.priority[goal] = 8;
    return response(appraisal);
  });
  expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "admitted", personalConcernRecorded: true });
  expect(getPersonalConcerns(f.world, f.actor)).toMatchObject([{ importance: .9, experiencedAtSimMs: 1000,
    integration: historical ? "historical_only" : "current" }]);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(true);
  expect(getEmotionalEpisodes(f.world, f.actor)).toHaveLength(historical ? 0 : 1);
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toEqual([goal]);
  expect(getPersonalConcerns(f.world, f.other)).toEqual([]);
  expect(getCommittedEvents(f.world).events).toEqual([]);
});

test("provider episode IDs are restricted to this actor's issued IDs or new", async () => {
  const f = fixture();
  const own = prepareEmotionalEpisode(f.world, f.actor, episode, ["own:1"])!; own.commit();
  const peer = prepareEmotionalEpisode(f.world, f.other, episode, ["peer:1"])!; peer.commit();
  queue(f); generate.mockResolvedValue(response({ innerThought: monologue }));
  await runExperienceAppraisal(f.world, f.actor);
  const format = await generate.mock.calls[0][0].output.responseFormat;
  expect(format.schema.properties.emotionalEpisode.properties.episodeId.enum).toEqual(["new", own.id]);
  expect(JSON.stringify(format.schema)).not.toContain(peer.id);
});

test.each([false, true])("invented episode ID is rejected even when response is historical-only (%s)", async historical => {
  const f = fixture(); queue(f);
  generate.mockImplementation(async () => {
    if (historical) createPersonalIntention(f.world, f.actor, "A newer choice", 7);
    return response({ ...appraisal, emotionalEpisode: { ...episode, episodeId: "invented_thread_name" } });
  });
  expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "failed", reason: "invalid_schema",
    schemaIssues: [{ path: "emotionalEpisode.episodeId", code: "invalid_enum_value" }] });
  expect(getPersonalConcerns(f.world, f.actor)).toEqual([]);
  expect(getEmotionalEpisodes(f.world, f.actor)).toEqual([]);
  expect(narrativeEntryCount(f.world, f.actor)).toBe(0);
});

test("appraisal cannot turn a feeling into an abstract goal even when reconsideration is enabled", async () => {
  const f = fixture(); f.world.meta.experienceReconsideration = true; queue(f);
  generate.mockResolvedValue(response({ ...appraisal, goalUpdate: { description: "Process the breakup", priority: 9, kind: "social" } }));
  expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("failed");
  expect(getEmotionalEpisodes(f.world, f.actor)).toEqual([]); expect(narrativeEntryCount(f.world, f.actor)).toBe(0);
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toEqual([]);
  expect(generate.mock.calls[0][0].system).not.toContain("propose one new subjective");
});

test("one appraisal can revise a commitment and author an episode without inventing replacement work", async () => {
  const f = fixture(); f.world.meta.experienceReconsideration = true;
  const goal = createPersonalIntention(f.world, f.actor, "Ask Sam to stay for dinner", 8)!;
  queue(f); generate.mockResolvedValue(response({ ...appraisal, affectUpdate: { feeling: "hurt", reason: "I thought we were close.", valence: -.8, arousal: .9 },
    intentionRevisions: [{ goalId: goal, disposition: "release", reason: "I no longer want to invite him tonight." }] }));
  expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("admitted");
  expect(Goal.status[goal]).toBe("retired"); expect(getRelationTargets(f.world, f.actor, HasGoal)).toEqual([goal]);
  expect(snapshotAffect(f.world, f.actor)?.feeling).toBe("hurt"); expect(getEmotionalEpisodes(f.world, f.actor)).toHaveLength(1);
});

test("a later heard experience revises the same semantic thread; earlier monologue and meaning remain immutable", async () => {
  const f = fixture(); queue(f); generate.mockResolvedValue(response(appraisal)); await runExperienceAppraisal(f.world, f.actor);
  const old = getNarrativeHistory(f.world, f.actor)[0], id = getEmotionalEpisodes(f.world, f.actor)[0].id;
  advanceSimulationTime(f.world, 2, 5000);
  queueExperiencedEvent(f.world, f.actor, { id: "heard:2", channel: "heard-speech", source: "Lin", content: "You do not have to explain yourself to me.", atSimMs: 6000 });
  generate.mockResolvedValue(response({ innerThought: "I had braced for questions. Lin is letting me be quiet. I am still hurt, but not so alone.",
    emotionalEpisode: { ...episode, episodeId: id, meaning: "I can be hurt without having to perform it for my friends.", activation: .6 } }));
  expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("admitted");
  expect(getEmotionalEpisodes(f.world, f.actor)).toHaveLength(1);
  expect(getEmotionalEpisodes(f.world, f.actor)[0].evidenceIds).toEqual(["read:1", "heard:2"]);
  expect(getNarrativeHistory(f.world, f.actor)[0]).toEqual(old);
  expect(getNarrativeHistory(f.world, f.actor)[1].episodeId).toBe(id);
});

test.each(["foreign episode", "changed owner", "stopped", "new meaning"])("stale or invalid %s cannot partially commit narrative, affect or goals", async change => {
  const f = fixture(); queue(f);
  const foreign = prepareEmotionalEpisode(f.world, f.other, episode, ["other:1"])!; foreign.commit();
  generate.mockImplementation(async () => {
    if (change === "changed owner") WorkingMemoryIdentity.id[f.actor] = "recycled-owner";
    if (change === "stopped") stopCommittedEvents(f.world);
    if (change === "new meaning") prepareEmotionalEpisode(f.world, f.actor, { ...episode, meaning: "A newer interpretation." }, ["new:1"])!.commit();
    return response({ ...appraisal, ...(change === "foreign episode" ? { emotionalEpisode: { ...episode, episodeId: foreign.id } } : {}),
      affectUpdate: { feeling: "sad", valence: -.8, arousal: .9, reason: "The message hurt." } });
  });
  const result = await runExperienceAppraisal(f.world, f.actor);
  if (change === "new meaning") {
    expect(result).toMatchObject({ status: "admitted", integration: "historical_only", omittedUpdatesReason: "emotional_episode_changed" });
    expect(narrativeEntryCount(f.world, f.actor)).toBe(1);
    expect(getNarrativeHistory(f.world, f.actor)[0]).toMatchObject({ kind: "recollection", sourceAtSimMs: 1000,
      evidence: [{ id: "read:1" }] });
    expect(getNarrativeHistory(f.world, f.actor)[0].monologue).toContain("not a claim about my present feelings");
    expect(getEmotionalEpisodes(f.world, f.actor)).toHaveLength(1);
    expect(getEmotionalEpisodes(f.world, f.actor)[0].meaning).toBe("A newer interpretation.");
    expect(snapshotAffect(f.world, f.actor)).toBeUndefined();
    expect(getRelationTargets(f.world, f.actor, HasGoal)).toEqual([]);
    return;
  }
  expect(result.status).not.toBe("admitted");
  expect(narrativeEntryCount(f.world, f.actor)).toBe(0); expect(snapshotAffect(f.world, f.actor)).toBeUndefined();
});

test("activation recovery uses simulation time and does not resolve meaning, forgive or complete a goal", () => {
  const f = fixture(), goal = createPersonalIntention(f.world, f.actor, "Return the keys", 8)!;
  prepareEmotionalEpisode(f.world, f.actor, episode, [f.event.id])!.commit();
  const before = emotionalLifeBasis(f.world, f.actor);
  for (let tick = 2; tick <= 121; tick++) { advanceSimulationTime(f.world, tick, 500); runEmotionalDynamics(f.world); }
  expect(emotionalActivation(f.world, f.actor)).toBeCloseTo(.55, 10);
  expect(emotionalLifeBasis(f.world, f.actor)).toBe(before); expect(Goal.status[goal]).toBe("active");
  const fast = fixture(); setEmotionalActivation(fast.world, fast.actor, .9);
  advanceSimulationTime(fast.world, 2, 60_000); runEmotionalDynamics(fast.world);
  expect(emotionalActivation(fast.world, fast.actor)).toBeCloseTo(emotionalActivation(f.world, f.actor), 10);
  expect(generate).not.toHaveBeenCalled();
});

test("clock recovery during inference does not discard a grounded appraisal", async () => {
  const f = fixture(); queue(f); setEmotionalActivation(f.world, f.actor, .9);
  generate.mockImplementation(async () => { advanceSimulationTime(f.world, 2, 60_000); runEmotionalDynamics(f.world); return response(appraisal); });
  expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("admitted");
  expect(getNarrativeHistory(f.world, f.actor)[0]).toMatchObject({ atSimMs: 61_000, sourceAtSimMs: 1000 });
});

test.each(["clock", "meaning"])("foreground narrative is admitted only with current meaning, while %s changes during inference", async change => {
  const f = fixture(); setEmotionalActivation(f.world, f.actor, .9);
  generate.mockImplementation(async () => {
    if (change === "clock") { advanceSimulationTime(f.world, 2, 500); runEmotionalDynamics(f.world); }
    else prepareEmotionalEpisode(f.world, f.actor, episode, ["new:experience"])!.commit();
    return response({ innerThought: "I want to listen for a moment. I do not know what Lin is going to say.",
      control: { version: 2, purpose: "Hear Lin out", goalId: null, localDependencies: [] }, action: { type: "wait" } });
  });
  const action = await agentThink(f.world, f.actor);
  // A non-physical wait admits its mental bundle at selection. Physical work
  // uses the existing dispatch boundary; a clock tick is not a semantic veto.
  expect(narrativeEntryCount(f.world, f.actor)).toBe(change === "clock" ? 1 : 0);
  expect(isDiscardedForegroundDecision(action)).toBe(change === "meaning");
  executeActions(f.world, [{ eid: f.actor, action }], createSystemRegistry());
  expect(getNarrativeHistory(f.world, f.actor, { kind: "thought" })).toHaveLength(change === "clock" ? 1 : 0);
  expect(generate).toHaveBeenCalledTimes(1);
});

test("narrative survives bounded memory and thought pruning; thought volume cannot bury meaningful history", () => {
  const f = fixture(), id = narrate(f)!;
  for (let i = 0; i < 120; i++) {
    addMemory(f.world, f.actor, { content: `Ordinary event ${i}`, type: "episodic", timestamp: Date.now() + i, importance: .1, emotionalValence: 0, learnPolicy: false });
    addThought(f.world, f.actor, { content: `I am considering step ${i}.`, type: "reasoning" });
  }
  expect(getAgentMemories(f.world, f.actor)).toHaveLength(50); expect(getAgentThoughts(f.world, f.actor)).toHaveLength(10);
  expect(narrativeEntryCount(f.world, f.actor)).toBe(121);
  expect(getNarrativeHistory(f.world, f.actor, { limit: 200 }).map(r => r.sequence)).toEqual(Array.from({ length: 121 }, (_, i) => i + 1));
  expect(formatNarrativeMemory(f.world, f.actor)).toContain(monologue);
  expect(getNarrativeHistory(f.world, f.actor, { id })).toHaveLength(1);
  const page = getNarrativeHistory(f.world, f.actor, { limit: 10 });
  const prior = getNarrativeHistory(f.world, f.actor, { limit: 10, before: page[0].id });
  expect(prior).toHaveLength(10); expect(prior.some(r => page.some(p => p.id === r.id))).toBe(false);
});

test("narrative copies cannot mutate storage and actor ownership cannot be bypassed by sharing a relation", () => {
  const f = fixture(); narrate(f); const entry = getRelationTargets(f.world, f.actor, HasNarrative)[0];
  addComponent(f.world, f.other, HasNarrative(entry));
  expect(getNarrativeHistory(f.world, f.other)).toEqual([]);
  const copied = getNarrativeHistory(f.world, f.actor); copied[0].monologue = "rewritten"; copied[0].evidence[0].content = "rewritten";
  expect(getNarrativeHistory(f.world, f.actor)[0].monologue).toBe(monologue);
  WorkingMemoryIdentity.id[f.actor] = "new-owner";
  expect(getNarrativeHistory(f.world, f.actor)).toEqual([]);
});

test("save and remapped restore preserve private narrative, episode identity and paused emotional time", () => {
  const f = fixture(); prepareEmotionalEpisode(f.world, f.actor, episode, [f.event.id])!.commit(); narrate(f);
  advanceSimulationTime(f.world, 2, 30_000); runEmotionalDynamics(f.world);
  const history = getNarrativeHistory(f.world, f.actor), episodes = getEmotionalEpisodes(f.world, f.actor), level = emotionalActivation(f.world, f.actor);
  const data = JSON.parse(JSON.stringify(serializeWorld(f.world, createSystemRegistry())));
  const restored = createArgosWorld("Restored"); initializePrefabs(restored); addEntity(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), data), actor = oldToNewId.get(f.actor)!;
  expect(actor).not.toBe(f.actor); expect(restored.meta.narrativeMind).toBe(true);
  expect(getNarrativeHistory(restored, actor)).toEqual(history); expect(getEmotionalEpisodes(restored, actor)).toEqual(episodes);
  expect(emotionalActivation(restored, actor)).toBeCloseTo(level, 10);
  advanceSimulationTime(restored, restored.time.tick + 1, 30_000); runEmotionalDynamics(restored);
  expect(emotionalActivation(restored, actor)).toBeCloseTo(.55, 10);
});

test("settling an episode neither completes a goal nor erases its history", () => {
  const f = fixture(), goal = createPersonalIntention(f.world, f.actor, "Return keys", 5)!;
  const draft = prepareEmotionalEpisode(f.world, f.actor, episode, ["read:1"])!; draft.commit(); narrate(f);
  prepareEmotionalEpisode(f.world, f.actor, { ...episode, episodeId: draft.id, stance: "settled" }, ["reflection:2"])!.commit();
  expect(Goal.status[goal]).toBe("active"); expect(narrativeEntryCount(f.world, f.actor)).toBe(1);
  expect(getEmotionalEpisodes(f.world, f.actor)[0].stance).toBe("settled");
});

test.each(["recollection", "learning"] as const)("background %s becomes sourced first-person narrative, retrievable after raw-memory eviction", async kind => {
  const f = fixture(), id = narrate(f)!;
  const words = kind === "learning" ? "I tend to expect silence means rejection. This time I should leave room for what I do not know."
    : "I remember rereading the message, wanting an explanation and dreading another reply.";
  generate.mockResolvedValue(response({ insights: [{ insight: words, importance: 8, relatedMemories: [], category: "self", temporalScope: "historical", narrativeKind: kind, sourceIds: [id] }], questionsRaised: [], emotionalSummary: "Uncertain" }));
  const result = await generateReflection(f.world, f.actor); expect(result).not.toBeNull();
  expect(storeReflectionResults(f.world, f.actor, result!)).toBe(true);
  const row = getNarrativeHistory(f.world, f.actor).at(-1)!;
  expect(row).toMatchObject({ kind, monologue: words, evidence: [{ id, content: monologue, kind: "reflection" }] });
  expect(generate.mock.calls[0][0].system).toContain(monologue); expect(generate.mock.calls[0][0].prompt).toContain("first-person inner voice");
  expect(getNarrativeHistory(f.world, f.other)).toEqual([]); expect(getCommittedEvents(f.world).events).toEqual([]);
});

test.each(["removed", "edited", "owner", "stopped"])("reflection cannot learn from an archived source that became %s during inference", async change => {
  const f = fixture(), id = narrate(f)!;
  generate.mockImplementation(async () => {
    const eid = getRelationTargets(f.world, f.actor, HasNarrative)[0];
    if (change === "removed") removeEntity(f.world, eid);
    if (change === "edited") NarrativeEntry.monologue[eid] = "Different experience";
    if (change === "owner") WorkingMemoryIdentity.id[f.actor] = "replacement";
    if (change === "stopped") stopCommittedEvents(f.world);
    return response({ insights: [{ insight: "I learned from this.", importance: 7, relatedMemories: [], category: "self", temporalScope: "historical", sourceIds: [id] }], questionsRaised: [], emotionalSummary: "" });
  });
  expect(await generateReflection(f.world, f.actor)).toBeNull();
  expect(getNarrativeHistory(f.world, f.actor, { kind: "learning" })).toEqual([]);
});

test("disabled mode and future evidence cannot silently create autobiographical records", () => {
  const f = fixture(); expect(narrate(f, { sourceAtSimMs: 2000 })).toBeUndefined();
  f.world.meta.narrativeMind = false; expect(narrate(f)).toBeUndefined();
  expect(prepareEmotionalEpisode(f.world, f.actor, episode, ["read:1"])).toBeUndefined();
  expect(narrativeEntryCount(f.world, f.actor)).toBe(0);
});

const extraction = { memories: [{ type: "episodic", content: "I heard Lin offer to sit with me. I was relieved not to have to explain.", importance: 0, emotionalValence: .2 }],
  beliefs: [{ subject: "Lin", predicate: "offered", object: "company", confidence: 0 }], impressions: [] };
test("interaction memories become first-person recollections with immutable source provenance, preserving zero values", async () => {
  const f = fixture(); process.env.ARGOS_ENABLE_LLM_IN_TESTS = "1";
  const input = { type: "heard", content: "I can sit with you.", context: "Lin spoke to me.", otherParty: "Lin", speaker: "Lin", perspective: "heard_speech" as const };
  generate.mockImplementation(async () => { input.content = "changed by caller"; advanceSimulationTime(f.world, 2, 2000); return response(extraction); });
  await extractKnowledgeFromInteraction(f.world, f.actor, input);
  const row = getNarrativeHistory(f.world, f.actor)[0];
  expect(row).toMatchObject({ kind: "recollection", monologue: extraction.memories[0].content, importance: 0,
    sourceAtSimMs: 1000, atSimMs: 3000, evidence: [{ content: "I can sit with you." }, { kind: "interaction" }] });
  expect(getAgentMemories(f.world, f.actor)).toHaveLength(1); expect(getAgentBeliefs(f.world, f.actor)).toHaveLength(1);
  expect(generate).toHaveBeenCalledTimes(1); expect(generate.mock.calls[0][0].prompt).not.toContain("changed by caller");
  expect(JSON.parse(generate.mock.calls[0][0].prompt)).toMatchObject({ rememberingCharacter: "Ada", interaction: { speaker: "Lin", perspective: "heard_speech" } });
  expect(generate.mock.calls[0][0]).toMatchObject({ maxRetries: 0, maxOutputTokens: 1200 });
});

test.each(["stop", "restart", "owner", "persona", "malformed"])("late/malformed extraction (%s) writes neither memories, beliefs nor narrative", async change => {
  const f = fixture(); process.env.ARGOS_ENABLE_LLM_IN_TESTS = "1";
  generate.mockImplementation(async () => {
    if (change === "stop" || change === "restart") stopCommittedEvents(f.world);
    if (change === "restart") startCommittedEvents(f.world);
    if (change === "owner") WorkingMemoryIdentity.id[f.actor] = "recycled";
    if (change === "persona") Agent.systemPrompt[f.actor] = "A different character";
    return response(change === "malformed" ? { ...extraction, beliefs: [{ nonsense: true }] } : extraction);
  });
  await extractKnowledgeFromInteraction(f.world, f.actor, { type: "speech", content: "I heard a claim.", context: "In the lounge." });
  expect(getAgentMemories(f.world, f.actor)).toEqual([]); expect(getAgentBeliefs(f.world, f.actor)).toEqual([]);
  expect(getNarrativeHistory(f.world, f.actor)).toEqual([]);
});
