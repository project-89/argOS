import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { addComponent, addEntity, hasComponent, removeComponent, removeEntity } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { Agent, Belief, Container, Description, Impression, Memory, Name, ObjectState, ReflectionState, SocialMemory, Thought, Traits, WorkingMemoryIdentity } = await import("../../ecs/components");
const { HasMemory, HasImpression } = await import("../../ecs/relations");
const { setLocatedIn } = await import("../../ecs/location");
const { addMemory, addBelief, getAgentMemories } = await import("../knowledge-graph");
const { getAgentThoughts } = await import("../agent-mind");
const { getWorkingMemory, recordWorkingMemoryEvidence, workingMemoryEntityRef } = await import("../working-memory");
const { captureWorkingMemoryObservation } = await import("../working-memory-observation");
const { recordCommittedSpeech } = await import("../social-memory");
const { applyCoordinationReviews } = await import("../coordination-memory");
const { registerAgentWorldCapabilities } = await import("../world-capabilities");
const { generateReflection, initializeReflectionState, maybeReflect, storeReflectionResults, formatInsightsForContext } = await import("../reflection-system");
import type { ReflectionInsight } from "../reflection-system";

let now = 1_000_000;
beforeEach(() => {
  now = 1_000_000; generate.mockReset();
  jest.spyOn(Date, "now").mockImplementation(() => now);
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Reflection freshness tests are offline"));
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

function fixture() {
  const world = createArgosWorld("Reflection temporal evidence"); world.meta.aiEnabled = true; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Study" }), remote = createRoomEntity(world, { name: "Hall" });
  const actor = createAgentEntity(world, { name: "Ada", role: "observer", systemPrompt: "Respond to what you perceive.", roomId: room });
  const peer = createAgentEntity(world, { name: "Lin", role: "observer", systemPrompt: "Respond to what you perceive.", roomId: room });
  const away = createAgentEntity(world, { name: "Dee", role: "observer", systemPrompt: "Respond to what you perceive.", roomId: remote });
  const relay = addEntity(world); addComponent(world, relay, Name); Name.value[relay] = "Indicator";
  addComponent(world, relay, ObjectState); ObjectState.current[relay] = "off"; setLocatedIn(world, relay, room);
  captureWorkingMemoryObservation(world, actor);
  const memory = addMemory(world, actor, { content: "The early alarm startled me, and Lin spoke patiently.", type: "episodic",
    importance: 1, emotionalValence: 0, timestamp: now - 10_000 });
  const state = initializeReflectionState(world, actor, 1); ReflectionState.importanceAccum[state] = 10;
  const changedState = () => { now += 1; ObjectState.current[relay] = "on"; captureWorkingMemoryObservation(world, actor); };
  const ownSources = () => getAgentMemories(world, actor).map(id => Memory.content[id]);
  const historical = (insight = "Patience helped me recover after the alarm."): ReflectionInsight => ({ insight, importance: 7,
    category: "self", relatedMemories: ["The earlier alarm"], temporalScope: "historical", sourceIds: [`memory:${memory}`] });
  return { world, room, remote, actor, peer, away, relay, memory, state, changedState, ownSources, historical };
}
function insight(category: ReflectionInsight["category"] = "social", temporalScope?: ReflectionInsight["temporalScope"]): ReflectionInsight {
  return { insight: "We are all here together, and I am still waiting for their answer.", importance: 6, relatedMemories: ["Our conversation"], category,
    ...(temporalScope ? { temporalScope } : {}) };
}
function response(insights: ReflectionInsight[], questionsRaised: string[] = []) {
  return { text: JSON.stringify({ insights, questionsRaised, emotionalSummary: "Attentive" }) };
}
function deferred() {
  let resolve!: (value: { text: string }) => void;
  const promise = new Promise<{ text: string }>(done => { resolve = done; });
  generate.mockReturnValue(promise); return { resolve };
}

test.each(["self", "social", "world", "goal"] as const)("%s category and pronouns cannot evade changed physical evidence", async category => {
  const f = fixture(), slow = deferred(), pending = generateReflection(f.world, f.actor);
  f.changedState(); slow.resolve(response([insight(category)]));
  expect(await pending).toBeNull(); expect(generate).toHaveBeenCalledTimes(1);
  expect(f.ownSources()).toHaveLength(1); expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test("a truncated provider response cannot be admitted even if its JSON parses",async()=>{
  const f=fixture();
  generate.mockResolvedValue({...response([]),finishReason:"length"} as any);
  expect(await generateReflection(f.world,f.actor)).toBeNull();
});

test.each([undefined, "current"] as const)("newly heard answers invalidate current or legacy waiting claims (%s)", async temporalScope => {
  const f = fixture(), slow = deferred(), pending = generateReflection(f.world, f.actor);
  // No world fact changed. Real local hearing alone supersedes a draft about
  // what the actor is awaiting, without interpreting any message's semantics.
  now += 1; recordCommittedSpeech(f.world, f.peer, "The written number is 4286.", "Ada");
  slow.resolve(response([insight("social", temporalScope)]));
  expect(await pending).toBeNull();
});

test("a same-millisecond newly heard event still invalidates the older draft", async () => {
  const f = fixture(), slow = deferred(), pending = generateReflection(f.world, f.actor);
  recordCommittedSpeech(f.world, f.peer, "I have the answer now.");
  slow.resolve(response([insight()])); expect(await pending).toBeNull();
});

test("changed own action evidence invalidates 'still awaiting' even when the private read has no physical fact", async () => {
  const f = fixture(), slow = deferred(), pending = generateReflection(f.world, f.actor);
  now += 1;
  expect(recordWorkingMemoryEvidence(f.world, f.actor, { id: "own-read", atMs: now, kind: "action", provenance: "own_action",
    succeeded: true, summary: "I privately read the instruction.", facts: [] })).toBe(true);
  slow.resolve(response([insight("self")])); expect(await pending).toBeNull();
});

test("new actual speech and physical sources are supplied before reflection, without another actor's private knowledge", async () => {
  const f = fixture();
  const heard = recordCommittedSpeech(f.world, f.peer, "The result is 4286.", "Ada")!;
  recordCommittedSpeech(f.world, f.away, "REMOTE SECRET 9912.");
  addMemory(f.world, f.peer, { content: "PRIVATE MEMORY 7432.", importance: 1, type: "episodic", timestamp: now });
  generate.mockResolvedValue(response([{ ...f.historical("Their earlier explanation reassured me."), sourceIds: [`dialogue:${heard.id}`] }]));
  expect(await generateReflection(f.world, f.actor)).not.toBeNull();
  const request = generate.mock.calls[0][0];
  expect(request.providerOptions.google.thinkingConfig.thinkingLevel).toBe("medium");
  expect(request.maxOutputTokens).toBe(4096);
  expect(request.maxRetries).toBe(0);
  expect(request.abortSignal).toBeDefined();
  expect(request.system).toContain(`sourceId="dialogue:${heard.id}"`);
  expect(request.system).toContain('heard; speaker="Lin"'); expect(request.system).toContain("The result is 4286.");
  expect(request.system).not.toContain("REMOTE SECRET"); expect(request.system).not.toContain("PRIVATE MEMORY");
  expect(request.prompt).toContain('"historical"'); expect(request.prompt).toContain("category is not a time scope");
  expect(generate).toHaveBeenCalledTimes(1);
});

test("unobserved remote world changes do not create omniscient reflection dependencies", async () => {
  const f = fixture();
  // These are genuinely outside the current view before issuance. Moving a
  // visible peer away during the request is a local departure, tested below.
  setLocatedIn(f.world, f.relay, f.remote); setLocatedIn(f.world, f.peer, f.remote);
  const slow = deferred(), pending = generateReflection(f.world, f.actor);
  ObjectState.current[f.relay] = "on";
  recordCommittedSpeech(f.world, f.away, "The secret has changed.");
  slow.resolve(response([insight()])); expect(await pending).not.toBeNull();
});

function physicalActivity(f: ReturnType<typeof fixture>, eid = f.actor) {
  let activity: { kind: "moving" | "holding" | "operating"; targetEid?: number } | undefined;
  const capability = { context: () => "", ready: () => !activity, busy: () => !!activity,
    publicActivity: () => activity, movementTargets: () => [f.remote], execute: () => true };
  const unregister = registerAgentWorldCapabilities(f.world, eid, capability);
  return { set: (value: typeof activity) => { activity = value; }, capability, unregister };
}

test("request sensing corrects stale local values before selecting reflection sources", async () => {
  const f = fixture();
  const prior = getWorkingMemory(f.world, f.actor);
  expect(prior.facts.some(fact => fact.subjectLabel === "Indicator" && fact.value === "off")).toBe(true);
  ObjectState.current[f.relay] = "on";
  generate.mockResolvedValue(response([insight("world", "current")]));
  expect(await generateReflection(f.world, f.actor)).not.toBeNull();
  const memory = getWorkingMemory(f.world, f.actor);
  expect(memory.facts.some(fact => fact.subjectLabel === "Indicator" && fact.value === "on")).toBe(true);
  expect(memory.facts.some(fact => fact.subjectLabel === "Indicator" && fact.value === "off")).toBe(false);
  const context = generate.mock.calls[0][0].system as string;
  expect(context).toContain("freshly sensed local view takes precedence");
  expect(context).toContain("earlier evidence ledger remains last-known experience");
});

test("a companion who departed before the request is absent from its fresh view without revealing their remote location", async () => {
  const f = fixture();
  const previous = getWorkingMemory(f.world, f.actor).facts.find(fact => fact.subjectLabel === "Lin" && fact.predicate === "location")!;
  expect(previous.valueLabel).toBe("Study");
  setLocatedIn(f.world, f.peer, f.remote);
  generate.mockResolvedValue(response([f.historical()]));
  expect(await generateReflection(f.world, f.actor)).not.toBeNull();
  const context = generate.mock.calls[0][0].system as string;
  expect(context).toContain("FRESH LOCAL SENSING");
  expect(context.split("FRESH LOCAL SENSING")[1]).not.toContain("Lin");
  const locations = getWorkingMemory(f.world, f.actor).facts.filter(fact => fact.subjectLabel === "Lin" && fact.predicate === "location");
  expect(locations.some(fact => fact.valueLabel === "Hall")).toBe(false);
  expect(locations.some(fact => fact.value === previous.value && fact.observedAt !== previous.observedAt)).toBe(false);
});

test.each(["hidden", "closed container"])("fresh reflection sensing cannot leak a %s surface through its remembered ledger", async concealment => {
  const f = fixture();
  const secret = addEntity(f.world); addComponent(f.world, secret, Name); Name.value[secret] = "PRIVATE_DIAGRAM";
  addComponent(f.world, secret, ObjectState); ObjectState.current[secret] = "PRIVATE_STATE_7432";
  if (concealment === "hidden") {
    addComponent(f.world, secret, Traits); Traits.active[secret] = JSON.stringify(["hidden"]);
    setLocatedIn(f.world, secret, f.room);
  } else {
    const box = addEntity(f.world); addComponent(f.world, box, Name); Name.value[box] = "Opaque box";
    addComponent(f.world, box, Container); addComponent(f.world, box, ObjectState); ObjectState.current[box] = "closed";
    setLocatedIn(f.world, box, f.room); setLocatedIn(f.world, secret, box);
    registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false,
      visibleEntities: () => [box, secret], execute: () => true });
  }
  generate.mockResolvedValue(response([f.historical()]));
  expect(await generateReflection(f.world, f.actor)).not.toBeNull();
  const context = generate.mock.calls[0][0].system as string;
  expect(context).not.toContain("PRIVATE_DIAGRAM"); expect(context).not.toContain("PRIVATE_STATE_7432");
  expect(JSON.stringify(getWorkingMemory(f.world, f.actor))).not.toContain("PRIVATE_DIAGRAM");
  expect(hasComponent(f.world, secret, WorkingMemoryIdentity)).toBe(false);
});

test("a current reflection may run while already walking if its sensed local situation is unchanged", async () => {
  const f = fixture(), body = physicalActivity(f); body.set({ kind: "moving", targetEid: f.remote });
  generate.mockResolvedValue(response([insight("self", "current")]));
  const result = await generateReflection(f.world, f.actor);
  expect(result).not.toBeNull();
  expect(generate.mock.calls[0][0].system).toContain("moving");
  expect(storeReflectionResults(f.world, f.actor, result!)).toBe(true);
});

test.each([undefined, "current"] as const)("a visible departure during a busy walk invalidates local-presence reflection (%s)", async temporalScope => {
  const f = fixture(), body = physicalActivity(f), peerBody = physicalActivity(f, f.peer);
  body.set({ kind: "moving", targetEid: f.remote }); peerBody.set({ kind: "moving", targetEid: f.remote });
  const slow = deferred(), pending = generateReflection(f.world, f.actor);
  const before = getWorkingMemory(f.world, f.actor);
  // Trial 8: the observer's movement is still pending in the origin room, but
  // the companion has actually departed. No foreground sensing runs while busy.
  now += 1; setLocatedIn(f.world, f.peer, f.remote);
  expect(getWorkingMemory(f.world, f.actor)).toEqual(before);
  slow.resolve(response([insight("self", temporalScope), f.historical()]));
  const result = await pending;
  expect(result?.insights).toEqual([f.historical()]);
  expect(getWorkingMemory(f.world, f.actor)).toEqual(before);
  expect(storeReflectionResults(f.world, f.actor, result!)).toBe(true);
  expect(getAgentThoughts(f.world, f.actor).map(eid => Thought.content[eid])).toEqual([
    expect.stringMatching(/^Looking back .*Patience helped me/),
  ]);
});

test.each(["self begins walking", "visible peer begins holding"])("public activity changes invalidate current reflection without an ObjectState edit: %s", async change => {
  const f = fixture(), body = physicalActivity(f), peerBody = physicalActivity(f, f.peer);
  const slow = deferred(), pending = generateReflection(f.world, f.actor);
  const before = getWorkingMemory(f.world, f.actor);
  if (change === "self begins walking") body.set({ kind: "moving", targetEid: f.remote });
  else peerBody.set({ kind: "holding", targetEid: f.relay });
  slow.resolve(response([insight("social")]));
  expect(await pending).toBeNull(); expect(getWorkingMemory(f.world, f.actor)).toEqual(before);
});

test.each(["generation", "storage"])("visible state changes invalidate current reflection at %s without a new receipt", async boundary => {
  const f = fixture(), slow = deferred(), pending = generateReflection(f.world, f.actor);
  if (boundary === "generation") ObjectState.current[f.relay] = "on";
  slow.resolve(response([insight("world", "current")]));
  const result = await pending;
  if (boundary === "generation") expect(result).toBeNull();
  else {
    expect(result).not.toBeNull(); ObjectState.current[f.relay] = "on";
    expect(storeReflectionResults(f.world, f.actor, result!)).toBe(false);
  }
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test("a new visible entity rejects old current view without assigning identity during return or storage checks", async () => {
  const f = fixture(), slow = deferred(), pending = generateReflection(f.world, f.actor);
  const before = getWorkingMemory(f.world, f.actor);
  const entrant = addEntity(f.world); addComponent(f.world, entrant, Name); Name.value[entrant] = "New arrival";
  setLocatedIn(f.world, entrant, f.room);
  expect(hasComponent(f.world, entrant, WorkingMemoryIdentity)).toBe(false);
  slow.resolve(response([insight(), f.historical()]));
  const result = await pending;
  expect(result?.insights).toEqual([f.historical()]);
  expect(hasComponent(f.world, entrant, WorkingMemoryIdentity)).toBe(false);
  expect(getWorkingMemory(f.world, f.actor)).toEqual(before);
  expect(storeReflectionResults(f.world, f.actor, result!)).toBe(true);
  expect(hasComponent(f.world, entrant, WorkingMemoryIdentity)).toBe(false);
});

test("unchanged local refresh time is not evidence that invalidates a useful draft", async () => {
  const f = fixture(), slow = deferred(), pending = generateReflection(f.world, f.actor);
  now += 30_001; captureWorkingMemoryObservation(f.world, f.actor);
  // The cited physical receipt remains retained. New same-valued observations
  // must not starve reflection just because it is asynchronous.
  slow.resolve(response([insight()])); expect(await pending).not.toBeNull();
});

test("unrelated historical self-reflection survives movement/hearing while stale present claims and questions drop", async () => {
  const f = fixture(), slow = deferred(), pending = maybeReflect(f.world, f.actor);
  setLocatedIn(f.world, f.actor, f.remote); now += 1; captureWorkingMemoryObservation(f.world, f.actor);
  recordCommittedSpeech(f.world, f.away, "Here is the answer.");
  slow.resolve(response([insight(), f.historical()], ["Where are they now?"]));
  expect(await pending).toBe(true);
  const added = f.ownSources().find(text => text.startsWith("[Reflection]"))!;
  expect(added).toContain("Looking back at earlier experiences through");
  expect(added).toContain(new Date(now - 1 - 10_000).toISOString()); expect(added).toContain("1 cited sources; a retrospective interpretation");
  expect(added).toContain("Patience helped me"); expect(added).not.toContain("We are all here");
  const thought = getAgentThoughts(f.world, f.actor)[0];
  expect(Thought.content[thought]).toContain("Looking back at earlier experiences through"); expect(Thought.content[thought]).toContain("retrospective interpretation");
  expect(formatInsightsForContext(f.world, f.actor)).toContain("retrospective interpretation");
  const stored = JSON.parse(ReflectionState.insights[f.state]);
  expect(stored[0]).toMatchObject({ temporalScope: "historical", sourceIds: [`memory:${f.memory}`] });
});

test("a present-tense sentence labelled historical is still emitted only as an explicitly retrospective interpretation", async () => {
  const f = fixture(), slow = deferred(), pending = generateReflection(f.world, f.actor);
  f.changedState(); slow.resolve(response([f.historical("We are all here together.")]));
  const result = (await pending)!;
  expect(storeReflectionResults(f.world, f.actor, result)).toBe(true);
  expect(Thought.content[getAgentThoughts(f.world, f.actor)[0]]).toMatch(/^Looking back at earlier experiences through .*retrospective interpretation\): We are all here together\.$/);
});

test("a finite source timestamp outside the calendar range remains explicit without a partial storage failure", async () => {
  const f = fixture(); Memory.timestamp[f.memory] = 1e20;
  generate.mockResolvedValue(response([f.historical()]));
  const result = (await generateReflection(f.world, f.actor))!;
  expect(storeReflectionResults(f.world, f.actor, result)).toBe(true);
  expect(Thought.content[getAgentThoughts(f.world, f.actor)[0]]).toContain("recorded atMs=100000000000000000000");
});

test.each(["removed", "mutated", "unlinked", "reused"])("historical references cannot survive %s source identity", async change => {
  const f = fixture(), slow = deferred(), pending = generateReflection(f.world, f.actor);
  if (change === "removed") removeEntity(f.world, f.memory);
  if (change === "mutated") Memory.content[f.memory] = "A different event.";
  if (change === "unlinked") removeComponent(f.world, f.actor, HasMemory(f.memory));
  if (change === "reused") {
    removeEntity(f.world, f.memory);
    addMemory(f.world, f.actor, { content: "A replacement memory.", importance: 1, type: "episodic", timestamp: now });
  }
  slow.resolve(response([f.historical()])); expect(await pending).toBeNull();
});

test("changing an uncited historical source does not discard an independent exact cited memory", async () => {
  const f = fixture();
  const unrelated = addMemory(f.world, f.actor, { content: "An unrelated incident.", importance: 1, type: "episodic", timestamp: now - 500 });
  const slow = deferred(), pending = generateReflection(f.world, f.actor);
  Memory.content[unrelated] = "Corrected unrelated memory.";
  slow.resolve(response([f.historical()])); expect(await pending).not.toBeNull();
});

test("current interpretation fences the exact rendered knowledge summary, not the raw newest-memory fallback", async () => {
  const f = fixture();
  for (let n = 0; n < 6; n++) addMemory(f.world, f.actor, { content: `Recent episode ${n}.`, importance: .8,
    type: "episodic", timestamp: now - 5_000 + n });
  for (let n = 0; n < 14; n++) addMemory(f.world, f.actor, { content: `Significant old interpretation ${n}.`, importance: .99,
    type: "semantic", timestamp: now - 4_000 + n });
  const summaryOnly: number[] = [];
  for (let n = 0; n < 5; n++) summaryOnly.push(addMemory(f.world, f.actor, { content: `SUMMARY_ONLY_${n}: the indicator is unavailable.`, importance: .01,
    type: "semantic", timestamp: now - 3_000 + n }));
  for (let n = 0; n < 5; n++) addMemory(f.world, f.actor, { content: `[ProcedureV1] newest procedure ${n}`, importance: .01,
    type: "procedural", timestamp: now - 2_000 + n });
  const slow = deferred(), pending = generateReflection(f.world, f.actor);
  const context = generate.mock.calls[0][0].system;
  const selected = context.split("SELECTED EXPERIENCES")[1].split("Physical receipts establish")[0];
  expect(selected).not.toContain("SUMMARY_ONLY_");
  expect(context.split("EXISTING KNOWLEDGE:")[1]).toContain("SUMMARY_ONLY_0");
  Memory.content[summaryOnly[0]] = "CORRECTION: the indicator has become available.";
  slow.resolve(response([insight("world")])); expect(await pending).toBeNull();
});

test.each(["belief", "impression", "description"])("changed rendered %s invalidates current claims but preserves independently cited history", async kind => {
  const f = fixture();
  const belief = addBelief(f.world, f.actor, { subject: "Lin", predicate: "intends", object: "to remain here", confidence: .6,
    source: "heard earlier", timestamp: now });
  const impression = addEntity(f.world); addComponent(f.world, impression, Impression); addComponent(f.world, f.actor, HasImpression(impression));
  Impression.targetName[impression] = "Lin"; Impression.trait[impression] = "patient"; Impression.valence[impression] = .8;
  const slow = deferred(), pending = generateReflection(f.world, f.actor);
  if (kind === "belief") Belief.object[belief] = "to leave";
  if (kind === "impression") Impression.trait[impression] = "hurried";
  if (kind === "description") Description.value[f.actor] = "Now wearing a wet coat.";
  slow.resolve(response([insight(), f.historical()]));
  expect((await pending)?.insights).toEqual([f.historical()]);
});

test("historical heard sources bind the actual event's immutable text, not just its ID", async () => {
  const f = fixture(), speech = recordCommittedSpeech(f.world, f.peer, "I was frightened by the earlier storm.")!;
  const slow = deferred(), pending = generateReflection(f.world, f.actor);
  const turns = JSON.parse(SocialMemory.turnsJson[f.actor]); turns[0].content = "A different claim.";
  SocialMemory.turnsJson[f.actor] = JSON.stringify(turns);
  slow.resolve(response([{ ...f.historical(), sourceIds: [`dialogue:${speech.id}`] }]));
  expect(await pending).toBeNull();
});

test.each([
  { temporalScope: "historical" }, { temporalScope: "historical", sourceIds: [] },
  { temporalScope: "current", sourceIds: ["invented-source"] }, { temporalScope: "past" },
  { sourceIds: "memory:1" }, { sourceIds: [12] },
])("malformed or unissued temporal references fail closed: %j", fields => {
  const f = fixture(); generate.mockResolvedValue(response([{ ...insight(), ...fields } as ReflectionInsight]));
  return expect(generateReflection(f.world, f.actor)).resolves.toBeNull();
});

test("a reference created after request issuance cannot be backfilled into its source catalogue", async () => {
  const f = fixture(), slow = deferred(), pending = generateReflection(f.world, f.actor);
  const speech = recordCommittedSpeech(f.world, f.peer, "A new heard event.")!;
  slow.resolve(response([{ ...f.historical(), sourceIds: [`dialogue:${speech.id}`] }]));
  expect(await pending).toBeNull();
});

test("private foreign references cannot be cited, even with a valid-looking source ID", async () => {
  const f = fixture();
  const foreign = addMemory(f.world, f.peer, { content: "PRIVATE SECRET.", importance: 1, type: "episodic", timestamp: now });
  generate.mockResolvedValue(response([{ ...f.historical(), sourceIds: [`memory:${foreign}`] }]));
  expect(await generateReflection(f.world, f.actor)).toBeNull();
});

test("current and legacy admission also follow actual coordination changes, without parsing pronouns", async () => {
  const f = fixture();
  const promise = recordCommittedSpeech(f.world, f.actor, "I will inspect the indicator.")!;
  const slow = deferred(), pending = generateReflection(f.world, f.actor);
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: promise.id, task: "Inspect the indicator" }])).toBe(1);
  slow.resolve(response([insight("self")])); expect(await pending).toBeNull();
});

test("storage rechecks newly arrived hearing after generation returned", async () => {
  const f = fixture(); generate.mockResolvedValue(response([insight()]));
  const result = (await generateReflection(f.world, f.actor))!; expect(result).not.toBeNull();
  recordCommittedSpeech(f.world, f.peer, "I have already told you the answer.");
  expect(storeReflectionResults(f.world, f.actor, result)).toBe(false);
  expect(f.ownSources()).toHaveLength(1); expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  expect(ReflectionState.reflectionCount[f.state]).toBe(0);
});

test("storage cannot promote a generated historical insight by mutating its category, scope, or text", async () => {
  const f = fixture(); generate.mockResolvedValue(response([f.historical()]));
  const result = (await generateReflection(f.world, f.actor))!;
  result.insights[0].temporalScope = "current"; result.insights[0].insight = "Everyone is here now.";
  expect(storeReflectionResults(f.world, f.actor, result)).toBe(false);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test.each(["other actor", "identity replaced", "actor stopped", "clock reversed"])("storage rejects a generated result after %s", async change => {
  const f = fixture(); generate.mockResolvedValue(response([f.historical()]));
  const result = (await generateReflection(f.world, f.actor))!;
  if (change === "identity replaced") WorkingMemoryIdentity.id[f.actor] = "entity:replacement";
  if (change === "actor stopped") Agent.active[f.actor] = false;
  if (change === "clock reversed") now -= 1;
  expect(storeReflectionResults(f.world, change === "other actor" ? f.peer : f.actor, result)).toBe(false);
});

test("source and time metadata remain private reflection context rather than other NPC perception", async () => {
  const f = fixture(); generate.mockResolvedValue(response([f.historical()]));
  const peerBefore = getWorkingMemory(f.world, f.peer), peerMemories = getAgentMemories(f.world, f.peer);
  const result = (await generateReflection(f.world, f.actor))!;
  expect(storeReflectionResults(f.world, f.actor, result)).toBe(true);
  expect(getWorkingMemory(f.world, f.peer)).toEqual(peerBefore);
  expect(getAgentMemories(f.world, f.peer)).toEqual(peerMemories); expect(getAgentThoughts(f.world, f.peer)).toHaveLength(0);
});
