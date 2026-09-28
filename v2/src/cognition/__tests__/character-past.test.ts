import { jest } from "@jest/globals";
const ai = await import("ai"), generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { addEntity, addComponent, query, getRelationTargets } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { Agent, Description, WorkingMemoryIdentity, NarrativeEntry } = await import("../../ecs/components");
const { HasNarrative, HasGoal } = await import("../../ecs/relations");
const { characterPastSchema } = await import("../character-past-schema");
const { getIdentityAnchors, getNarrativeHistory, appendNarrative, initializeCharacterNarrative, formatIdentityAnchors, selectIdentityAnchors } = await import("../narrative-memory");
const { buildAgentContext } = await import("../agent-mind");
const { getAspirations } = await import("../goal-learning");
const { addMemory } = await import("../knowledge-graph");
const { generateReflection, storeReflectionResults } = await import("../reflection-system");
const { startCommittedEvents, stopCommittedEvents, getCommittedEvents } = await import("../../runtime/committed-events");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { serializeWorld, deserializeWorld } = await import("../../persistence/world-persistence");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const past = () => characterPastSchema.parse({ background: "PRIVATE_BACKGROUND: I grew up above my family's repair shop.",
  drives: ["Care for people I love", "Make useful things"], memories: [
    { period: "Age nine", recollection: "PRIVATE_CHILDHOOD: My sister stayed beside me when I was frightened.", emotionalTone: "warmth",
      importance: .9, meaning: "Staying can show love", selfBelief: "I try not to abandon people", cues: ["sister", "friend", "alone"] },
    { period: "My first apprenticeship", recollection: "I repaired a lamp by myself.", emotionalTone: "pride", importance: .5,
      meaning: "I can learn difficult things", selfBelief: "I am capable of learning", cues: ["repair", "lamp"] },
  ] });
function fixture() {
  const world = createArgosWorld("People with a past"); initializePrefabs(world); startCommittedEvents(world);
  world.meta.narrativeMind = true; world.meta.aiEnabled = true;
  const room = createRoomEntity(world, { name: "Workshop" });
  const actor = createAgentEntity(world, { name: "Ada", role: "maker", description: "A person wearing a coat.", systemPrompt: "I choose my own actions.", roomId: room, past: past() });
  const peer = createAgentEntity(world, { name: "Lin", role: "friend", systemPrompt: "I have my own life.", roomId: room });
  return { world, room, actor, peer };
}
beforeEach(() => { generate.mockReset(); });
test("authored drives and memories initialize real private data, not public events or goals", () => {
  const f = fixture(), anchors = getIdentityAnchors(f.world, f.actor);
  expect(anchors).toHaveLength(2); expect(anchors[0].identity?.origin).toEqual({ period: "Age nine", provenance: "authored-history" });
  expect(getAspirations(f.world, f.actor)).toEqual(past().drives);
  expect(getCommittedEvents(f.world).events).toEqual([]); expect(getRelationTargets(f.world, f.actor, HasGoal)).toEqual([]);
  expect(Description.value[f.actor]).not.toContain("PRIVATE");
  expect(buildAgentContext(f.world, f.actor)).toContain("PRIVATE_CHILDHOOD");
  expect(buildAgentContext(f.world, f.peer)).not.toContain("PRIVATE"); expect(getIdentityAnchors(f.world, f.peer)).toEqual([]);
  expect(generate).not.toHaveBeenCalled();
});
test("seeding works without enabling background narrative inference", () => {
  const world = createArgosWorld("Quiet seed"); initializePrefabs(world); world.meta.narrativeMind = false;
  const actor = createAgentEntity(world, { name: "Ada", role: "maker", systemPrompt: "Choose", past: past() });
  expect(getIdentityAnchors(world, actor)).toHaveLength(2); expect(world.meta.narrativeMind).toBe(false); expect(generate).not.toHaveBeenCalled();
});
test.each(["bad-scale", "missing-cue", "extra-field", "too-many"])("invalid whole past (%s) rejects before allocating an NPC or memories", mode => {
  const f = fixture(), candidate: any = past(), before = [...query(f.world, [Agent])], count = [...query(f.world, [NarrativeEntry])].length;
  if (mode === "bad-scale") candidate.memories[1].importance = 100;
  if (mode === "missing-cue") candidate.memories[0].cues = [];
  if (mode === "extra-field") candidate.memories[0].execute = "force a goal";
  if (mode === "too-many") candidate.memories = Array(7).fill(candidate.memories[0]);
  expect(() => createAgentEntity(f.world, { name: "Invalid", role: "guest", systemPrompt: "Choose", past: candidate })).toThrow();
  expect([...query(f.world, [Agent])]).toEqual(before); expect([...query(f.world, [NarrativeEntry])]).toHaveLength(count);
});
test("a seeded life cannot be reinitialized", () => {
  const f = fixture(), before = getNarrativeHistory(f.world, f.actor);
  expect(() => initializeCharacterNarrative(f.world, f.actor, past())).toThrow(); expect(getNarrativeHistory(f.world, f.actor)).toEqual(before);
});
test("relevant anchors survive hundreds of unrelated thoughts and stay bounded", () => {
  const f = fixture();
  for (let i = 0; i < 230; i++) appendNarrative(f.world, f.actor, { kind: "thought", monologue: `Ordinary thought ${i}`, importance: .2,
    sourceAtSimMs: 0, evidence: [{ id: `thought:${i}`, kind: "thought", content: "My interpretation", atSimMs: 0 }] });
  expect(selectIdentityAnchors(f.world, f.actor, "repair the lamp")[0].identity?.selfBelief).toBe("I am capable of learning");
  expect(formatIdentityAnchors(f.world, f.actor, "friend alone")).toContain("PRIVATE_CHILDHOOD");
  expect(selectIdentityAnchors(f.world, f.actor)).toHaveLength(2);
});
test("implanted provenance stays available to the author, not disclosed as NPC self-knowledge", () => {
  const f = fixture(), seed = past(); seed.memories[0].provenance = "implanted";
  const actor = createAgentEntity(f.world, { name: "Bea", role: "maker", systemPrompt: "Choose", roomId: f.room, past: seed });
  expect(getIdentityAnchors(f.world, actor)[0].identity?.origin?.provenance).toBe("implanted");
  expect(buildAgentContext(f.world, actor)).not.toContain('"implanted"'); expect(getCommittedEvents(f.world).events).toEqual([]);
});
test("many revisions of one anchor never evict a different formative memory", () => {
  const f = fixture(), original = getIdentityAnchors(f.world, f.actor), revised = original[1];
  for (let n = 0; n < 205; n++) appendNarrative(f.world, f.actor, { kind: "learning", monologue: `Revisiting my apprenticeship, moment ${n}`,
    importance: .6, sourceAtSimMs: 0, identity: { ...revised.identity!, meaning: `Meaning ${n}` },
    evidence: [{ id: `experienced:${n}`, kind: "experience", content: `A real fixture experience ${n}`, atSimMs: 0 }] });
  const current = getIdentityAnchors(f.world, f.actor);
  expect(current).toHaveLength(2); expect(current).toContainEqual(original[0]);
  expect(current.find(row => row.identity?.anchorId === revised.identity!.anchorId)?.identity?.meaning).toBe("Meaning 204");
});
test("shared relations, copied records and recycled owner IDs cannot expose or rewrite a past", () => {
  const f = fixture(), entry = getRelationTargets(f.world, f.actor, HasNarrative)[0];
  addComponent(f.world, f.peer, HasNarrative(entry)); expect(getIdentityAnchors(f.world, f.peer)).toEqual([]);
  const copied = getIdentityAnchors(f.world, f.actor); copied[0].identity!.selfBelief = "Forged";
  expect(getIdentityAnchors(f.world, f.actor)[0].identity!.selfBelief).not.toBe("Forged");
  WorkingMemoryIdentity.id[f.actor] = "another lifetime"; expect(getIdentityAnchors(f.world, f.actor)).toEqual([]);
});
test("native save and remapped restore preserve provenance, anchors and privacy", () => {
  const f = fixture(), before = getIdentityAnchors(f.world, f.actor);
  advanceSimulationTime(f.world, 1, 30000);
  const data = JSON.parse(JSON.stringify(serializeWorld(f.world, createSystemRegistry())));
  const restored = createArgosWorld("Restored"); initializePrefabs(restored); addEntity(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), data);
  expect(getIdentityAnchors(restored, oldToNewId.get(f.actor)!)).toEqual(before);
  expect(buildAgentContext(restored, oldToNewId.get(f.peer)!)).not.toContain("PRIVATE");
});
function revisionFixture() {
  const f = fixture(), previous = getIdentityAnchors(f.world, f.actor)[0];
  const memory = addMemory(f.world, f.actor, { type: "episodic", content: "Lin asked for time alone. I gave them space, and later they thanked me.", importance: .9, emotionalValence: .5, timestamp: Date.now() });
  const insight = { insight: "I can care for someone by respecting their space, not only by staying beside them.", importance: 9,
    relatedMemories: [], category: "self", temporalScope: "historical", narrativeKind: "learning", sourceIds: [previous.id, `memory:${memory}`],
    identityRevision: { anchorId: previous.identity!.anchorId, selfBelief: "I try to care in the way someone actually needs", meaning: "Space can be loving too", cues: ["friend", "alone", "space"] } };
  return { ...f, previous, insight };
}
test("background reflection can revise an anchor without rewriting the formative memory or creating a task", async () => {
  const f = revisionFixture(); generate.mockResolvedValue({ text: JSON.stringify({ insights: [f.insight], questionsRaised: [], emotionalSummary: "Warm and thoughtful" }) });
  const result = await generateReflection(f.world, f.actor); expect(result).not.toBeNull(); expect(storeReflectionResults(f.world, f.actor, result!)).toBe(true);
  const current = getIdentityAnchors(f.world, f.actor).find(row => row.identity?.anchorId === f.previous.identity!.anchorId)!;
  expect(current.identity).toMatchObject({ selfBelief: f.insight.identityRevision.selfBelief, revises: f.previous.id });
  expect(getNarrativeHistory(f.world, f.actor, { id: f.previous.id })).toEqual([f.previous]);
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toEqual([]); expect(getCommittedEvents(f.world).events).toEqual([]);
});
test.each(["foreign-anchor", "no-experience", "low-significance", "unissued-source"])("unsupported identity revision (%s) cannot enter the archive", async mode => {
  const f = revisionFixture();
  if (mode === "foreign-anchor") f.insight.identityRevision.anchorId = "identity:someone-else";
  if (mode === "no-experience") f.insight.sourceIds = [f.previous.id];
  if (mode === "low-significance") f.insight.importance = 2;
  if (mode === "unissued-source") f.insight.sourceIds.push("invented-evidence");
  generate.mockResolvedValue({ text: JSON.stringify({ insights: [f.insight], questionsRaised: [], emotionalSummary: "" }) });
  expect(await generateReflection(f.world, f.actor)).toBeNull(); expect(getIdentityAnchors(f.world, f.actor)).toContainEqual(f.previous);
});
test("a genuinely formative experienced event can form a new anchor", async () => {
  const f = revisionFixture(); f.insight.identityRevision.anchorId = "new"; f.insight.sourceIds = f.insight.sourceIds.slice(1);
  generate.mockResolvedValue({ text: JSON.stringify({ insights: [f.insight], questionsRaised: [], emotionalSummary: "" }) });
  const result = await generateReflection(f.world, f.actor); expect(result).not.toBeNull(); expect(storeReflectionResults(f.world, f.actor, result!)).toBe(true);
  expect(getIdentityAnchors(f.world, f.actor)).toHaveLength(3);
  expect(storeReflectionResults(f.world, f.actor, result!)).toBe(false);
  expect(getIdentityAnchors(f.world, f.actor)).toHaveLength(3);
});
test("late stopped-source reflection and ungranted direct storage cannot change identity", async () => {
  const f = revisionFixture();
  expect(storeReflectionResults(f.world, f.actor, { insights: [f.insight as any], questionsRaised: [], emotionalSummary: "" })).toBe(false);
  generate.mockImplementation(async () => { stopCommittedEvents(f.world); return { text: JSON.stringify({ insights: [f.insight], questionsRaised: [], emotionalSummary: "" }) }; });
  expect(await generateReflection(f.world, f.actor)).toBeNull(); expect(getIdentityAnchors(f.world, f.actor)).toHaveLength(2);
});
