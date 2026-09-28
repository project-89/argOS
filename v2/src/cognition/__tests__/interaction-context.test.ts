import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createRoomEntity, createAgentEntity } = await import("../../ecs/prefabs");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { startCommittedEvents } = await import("../../runtime/committed-events");
const { workingMemoryEntityRef } = await import("../working-memory");
const { recordCommittedSpeech, getSocialDialogue } = await import("../social-memory");
const { captureInteractionContext } = await import("../interaction-context");
const { extractKnowledgeFromInteraction, getAgentMemories, getAgentBeliefs } = await import("../knowledge-graph");
const { Belief } = await import("../../ecs/components");
const { appendNarrative, getNarrativeHistory, selectNarrativeMemories, formatNarrativeMemory } = await import("../narrative-memory");

function fixture() {
  const world = createArgosWorld("Context laboratory"); initializePrefabs(world);
  world.meta.narrativeMind = true; world.meta.aiEnabled = true;
  const room = createRoomEntity(world, { name: "Kitchen" }), remote = createRoomEntity(world, { name: "Bedroom" });
  const create = (name: string, roomId: number) => createAgentEntity(world, { name, role: "friend", systemPrompt: "A person with their own outlook.", roomId });
  const actor = create("Ada", room), friend = create("Lin", room), absent = create("Bo", remote);
  for (const id of [actor, friend, absent]) workingMemoryEntityRef(world, id);
  startCommittedEvents(world); advanceSimulationTime(world, 1, 1000);
  const say = (eid: number, words: string) => {
    advanceSimulationTime(world, world.time.tick + 1, 1000);
    return recordCommittedSpeech(world, eid, words)!;
  };
  return { world, actor, friend, absent, say };
}
const input = (turn: ReturnType<ReturnType<typeof fixture>["say"]>) => ({ type: "speech", content: turn.content,
  context: "Speaking in Kitchen", perspective: "own_speech" as const, speaker: turn.speaker, speechId: turn.id });
let oldKey: string | undefined, oldEnable: string | undefined, oldDisable: string | undefined;
beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; oldEnable = process.env.ARGOS_ENABLE_LLM_IN_TESTS; oldDisable = process.env.ARGOS_DISABLE_KNOWLEDGE_EXTRACTION;
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only"; process.env.ARGOS_ENABLE_LLM_IN_TESTS = "1"; delete process.env.ARGOS_DISABLE_KNOWLEDGE_EXTRACTION;
  generate.mockReset(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network in context tests"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  for (const [key, value] of [["GOOGLE_GENERATIVE_AI_API_KEY", oldKey], ["ARGOS_ENABLE_LLM_IN_TESTS", oldEnable], ["ARGOS_DISABLE_KNOWLEDGE_EXTRACTION", oldDisable]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
});

test("extraction carries actual antecedents and freezes them before inference", async () => {
  const f = fixture(), context = f.say(f.friend, "Two years together and he ended it in two sentences."), turn = f.say(f.actor, "A sentence a year? What could he possibly have written?");
  generate.mockImplementation(async () => {
    f.say(f.friend, "LATER_WORDS_NOT_AT_ISSUANCE");
    return { text: JSON.stringify({ memories: [{ type: "episodic", content: "I joked about the brevity of her breakup message, not how fast he writes.", importance: .7, emotionalValence: -.2 }] }) };
  });
  await extractKnowledgeFromInteraction(f.world, f.actor, input(turn));
  const prompt = JSON.parse(generate.mock.calls[0][0].prompt);
  expect(prompt.precedingPersonallyExperiencedDialogue).toMatchObject([{ id: context.id, role: "context", kind: "dialogue" }]);
  expect(prompt.precedingPersonallyExperiencedDialogue[0].content).toContain("Two years together");
  expect(generate.mock.calls[0][0].prompt).not.toContain("LATER_WORDS");
  const row = getNarrativeHistory(f.world, f.actor)[0];
  expect(row.evidence).toMatchObject([{ id: turn.id, role: "primary" }, { role: "context" }, { id: context.id, role: "context" }]);
  expect(row.sourceAtSimMs).toBe(turn.atSimMs); expect(row.atSimMs).toBeGreaterThan(row.sourceAtSimMs);
});

test("remote/false/private sources cannot be smuggled in as conversation receipts", async () => {
  const f = fixture(), hidden = f.say(f.absent, "PRIVATE_REMOTE_SPEECH"), turn = f.say(f.actor, "I wonder what is happening.");
  expect(captureInteractionContext(f.world, f.actor, input(turn))?.antecedents).toEqual([]);
  expect(getSocialDialogue(f.world, f.actor).some(t => t.id === hidden.id)).toBe(false);
  await extractKnowledgeFromInteraction(f.world, f.actor, input(hidden));
  await extractKnowledgeFromInteraction(f.world, f.actor, { ...input(turn), content: "Forged statement" });
  await extractKnowledgeFromInteraction(f.world, f.actor, { ...input(turn), perspective: "private_thought" });
  expect(generate).not.toHaveBeenCalled(); expect(getAgentMemories(f.world, f.actor)).toEqual([]);
});

test("context is bounded, chronological, and stops at a long silence", () => {
  const f = fixture(); f.say(f.friend, "Old unrelated conversation.");
  advanceSimulationTime(f.world, f.world.time.tick + 1, 70_000);
  const start = f.say(f.friend, "New topic.");
  for (let i = 0; i < 8; i++) f.say(i % 2 ? f.actor : f.friend, `Turn ${i}`);
  const turn = f.say(f.actor, "Current reply.");
  const capture = captureInteractionContext(f.world, f.actor, input(turn))!;
  expect(capture.antecedents).toHaveLength(6);
  expect(capture.antecedents.every(t => t.atSimMs >= start.atSimMs! && t.atSimMs < turn.atSimMs!)).toBe(true);
  expect(JSON.stringify(capture)).not.toContain("Old unrelated");
  const heardInput = { ...input(start), perspective: "heard_speech" as const };
  expect(captureInteractionContext(f.world, f.actor, heardInput)?.antecedents).toEqual([]);
});

test("belief attribution follows the speaker, not the listener or observed object", async () => {
  const f = fixture();
  generate.mockResolvedValue({ text: JSON.stringify({ beliefs: [{ subject: "Lin", predicate: "has", object: "the key", confidence: .7 }] }) });
  const own = f.say(f.actor, "I think Lin has the key.");
  await extractKnowledgeFromInteraction(f.world, f.actor, { ...input(own), otherParty: "Lin", speaker: undefined });
  expect(getAgentBeliefs(f.world, f.actor).map(id => Belief.source[id])).toEqual(["Ada (spoken claim)"]);
  const heard = f.say(f.friend, "I do have the key.");
  await extractKnowledgeFromInteraction(f.world, f.actor, { ...input(heard), perspective: "heard_speech", otherParty: "Lin", speaker: undefined });
  expect(getAgentBeliefs(f.world, f.actor).map(id => Belief.source[id])).toContain("Lin (spoken claim)");
  generate.mockResolvedValue({ text: JSON.stringify({ beliefs: [{ subject: "Cabinet", predicate: "is", object: "open", confidence: .9 }] }) });
  await extractKnowledgeFromInteraction(f.world, f.actor, { type: "action", perspective: "own_action", content: "I opened the cabinet.", otherParty: "Cabinet", context: "Inspecting the room." });
  const cabinet = getAgentBeliefs(f.world, f.actor).find(id => Belief.subject[id] === "Cabinet")!;
  expect(Belief.source[cabinet]).toBe("Ada (own observation)");
});

test("a matching 2000-character prefix cannot authenticate an unverified suffix", async () => {
  const f = fixture(), turn = f.say(f.actor, "a".repeat(2000));
  expect(captureInteractionContext(f.world, f.actor, input(turn))?.sourceId).toBe(turn.id);
  await extractKnowledgeFromInteraction(f.world, f.actor, { ...input(turn), content: `${turn.content} FORGED_SUFFIX` });
  expect(generate).not.toHaveBeenCalled(); expect(getAgentMemories(f.world, f.actor)).toEqual([]);
});

test("a new autobiographical speech claim retains speech provenance even with confident extraction", async () => {
  const f = fixture(), turn = f.say(f.actor, "Nobody guesses porridge for breakfast.");
  generate.mockResolvedValue({ text: JSON.stringify({
    memories: [{ type: "episodic", content: "I claimed nobody guesses porridge for breakfast.", importance: .5, emotionalValence: 0 }],
    beliefs: [{ subject: "Ada", predicate: "ate", object: "porridge", confidence: 1 }],
  }) });
  await extractKnowledgeFromInteraction(f.world, f.actor, input(turn));
  const request = generate.mock.calls[0][0];
  expect(request.system).toContain("including my own");
  expect(request.system).toContain("not independent verification of X or a newly established past event");
  const belief = getAgentBeliefs(f.world, f.actor)[0];
  // The character may believe the claim; confidence does not authenticate breakfast.
  expect(Belief.confidence[belief]).toBe(1);
  expect(Belief.source[belief]).toBe("Ada (spoken claim)");
  expect(getNarrativeHistory(f.world, f.actor)[0].evidence[0]).toMatchObject({ id: turn.id, kind: "dialogue" });
});

test("one source or emotional episode gets one prompt slot while the full history remains", () => {
  const f = fixture();
  const record = (monologue: string, primary: string, extra: { episodeId?: string } = {}) => appendNarrative(f.world, f.actor, {
    kind: "recollection", monologue, importance: .5, sourceAtSimMs: 1000,
    evidence: [{ id: primary, kind: "experience", role: "primary", content: "Actually experienced.", atSimMs: 1000 },
      { id: "shared-context", kind: "dialogue", role: "context", content: "An earlier conversation.", atSimMs: 1000 }], ...extra,
  });
  record("First interpretation", "source:1"); record("Revised interpretation", "source:1");
  record("Another event", "source:2");
  record("How the episode began", "source:3", { episodeId: "episode:1" });
  record("How I now remember it", "source:4", { episodeId: "episode:1" });
  expect(getNarrativeHistory(f.world, f.actor)).toHaveLength(5);
  expect(selectNarrativeMemories(f.world, f.actor).map(r => r.monologue)).toEqual(["Revised interpretation", "Another event", "How I now remember it"]);
  expect(formatNarrativeMemory(f.world, f.actor)).toContain('sources=["source:1"]');
  expect(formatNarrativeMemory(f.world, f.absent)).toBe("");
});

test("reflecting on a previous interpretation does not make its source independent corroboration", () => {
  const f = fixture();
  const original = appendNarrative(f.world, f.actor, { kind: "experience", monologue: "I was surprised by the news.",
    importance: .7, sourceAtSimMs: 1000, episodeId: "episode:surprise",
    evidence: [{ id: "read:1", kind: "experience", content: "News actually read.", atSimMs: 1000 }] })!;
  const reflection = appendNarrative(f.world, f.actor, { kind: "learning", monologue: "I had assumed too much.", importance: .7, sourceAtSimMs: 1000,
    evidence: [{ id: original, kind: "reflection", content: "I was surprised by the news.", atSimMs: 1000 }] })!;
  appendNarrative(f.world, f.actor, { kind: "recollection", monologue: "I remember reconsidering that assumption.", importance: .7, sourceAtSimMs: 1000,
    evidence: [{ id: reflection, kind: "reflection", content: "I had assumed too much.", atSimMs: 1000 }] });
  expect(getNarrativeHistory(f.world, f.actor)).toHaveLength(3);
  expect(selectNarrativeMemories(f.world, f.actor).map(r => r.monologue)).toEqual(["I remember reconsidering that assumption."]);
});
