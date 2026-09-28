import { jest } from "@jest/globals";
const ai = await import("ai");
const appraisal = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: appraisal }));
const { addEntity, getRelationTargets } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { Goal, GoalLifecycle, WorkingMemoryIdentity } = await import("../../ecs/components");
const { HasGoal } = await import("../../ecs/relations");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { startCommittedEvents, getCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { withSimulationTask } = await import("../../runtime/task-scope");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { serializeWorld, deserializeWorld } = await import("../../persistence/world-persistence");
const { createGeneratedIntention } = await import("../goal-lifecycle");
const { createCommunicationMotivation } = await import("../communication-motivation");
const { queueExperiencedEvent, runExperienceAppraisal } = await import("../experience-appraisal");
const { recordPrivateCommunication, getPrivateCommunications } = await import("../communication-memory");
const { getPersonalConcerns, recordPersonalConcern } = await import("../personal-concerns");
const { captureGoalReviewContext, prepareGoalReview } = await import("../goal-pursuit");
const { snapshotAffect } = await import("../affect-state");
const { generateAutonomousGoal, hasPendingPersonalGoalReview, resetAutonomousGoals } = await import("../autonomous-goals");

const keys = ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"];
let saved: Array<string | undefined>;
beforeEach(() => {
  saved = keys.map(k => process.env[k]); keys.forEach(k => { delete process.env[k]; });
  process.env.GEMINI_API_KEY = "offline-only"; appraisal.mockReset(); resetAutonomousGoals();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network in handoff tests"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
});
function fixture() {
  const world = createArgosWorld("Ordinary choices"); initializePrefabs(world);
  world.meta.aiEnabled = true; world.meta.narrativeMind = true;
  const room = createRoomEntity(world, { name: "Apartment" });
  const actor = createAgentEntity(world, { name: "Ada", role: "friend", systemPrompt: "I choose my own plans.", roomId: room });
  const peer = createAgentEntity(world, { name: "Bo", role: "friend", systemPrompt: "I have my own life.", roomId: room });
  const sourceId = startCommittedEvents(world); advanceSimulationTime(world, 1, 44_000);
  const routine = createGeneratedIntention(world, actor, { description: "Resolve our argument", kind: "social", priority: 7 }, "personal")!;
  const phone = createCommunicationMotivation(world, actor, { description: "Stay in touch", memory: "My friends text me." }).goal;
  const goals = () => getRelationTargets(world, actor, HasGoal);
  const event = { id: "read:invitation", channel: "phone:ada", source: "Sam, friend",
    content: "PRIVATE_INVITATION: Pick somewhere for dinner. I am at work; do not wait for me.", atSimMs: 34_200 };
  const read = () => recordPrivateCommunication(world, actor, { sourceId, messageKey: "invitation", channel: "phone:ada", kind: "read",
    other: "Sam", content: event.content, sentAtSimMs: 5000, deliveredAtSimMs: 5200 });
  const appraise = async (value: unknown, receipt = event) => {
    expect(queueExperiencedEvent(world, actor, receipt)).toBe(true);
    appraisal.mockResolvedValue({ text: JSON.stringify(value) });
    return runExperienceAppraisal(world, actor);
  };
  const review = (value: unknown = { goal: null }) => {
    const infer = jest.fn(async (request: any) => {
      return { text: JSON.stringify(value) };
    });
    return { infer, run: () => generateAutonomousGoal(world, actor, { generateText: infer as any }),
      context: () => JSON.parse(infer.mock.calls[0][0].messages[1].content.split("\n")[0]) };
  };
  return { world, actor, peer, room, routine, phone, goals, event, read, appraise, review };
}
const ordinary = { innerThought: "Dinner sounds good. I want to choose where to go.",
  affectUpdate: { feeling: "interested", valence: .3, arousal: .4, reason: "My friend suggested dinner." },
  emotionalEpisode: { episodeId: "new", thread: "Dinner", meaning: "I could spend the evening differently.",
    feelings: [{ feeling: "anticipation", strength: .6 }], desires: ["choose somewhere to eat"], activation: .5, stance: "open" } };
const calm = { innerThought: "I can choose somewhere to eat without waiting for my friend." };
const dinner = { goal: "Choose somewhere to eat tonight", kind: "social", priority: 6, motivation: "I would like dinner out." };

test.each([ordinary, calm])("an admitted ordinary interpretation gets a review without raising its emotions: %p", async value => {
  const f = fixture(); f.read();
  expect(await f.appraise(value)).toMatchObject({ status: "admitted", personalConcernRecorded: true });
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(true);
  const before = snapshotAffect(f.world, f.actor);
  const r = f.review(dinner);
  expect(await r.run()).not.toBeNull(); expect(f.goals()).toHaveLength(3);
  expect(r.context().personalExperiences).toMatchObject([{ importance: value === ordinary ? .5 : 0, experiencedAtSimMs: 34_200 }]);
  expect(r.context().personallyReadOrSent[0].content).toBe(f.event.content);
  expect(snapshotAffect(f.world, f.actor)).toEqual(before);
  expect(Goal.status[f.routine]).toBe("active"); expect(Goal.priority[f.routine]).toBe(7);
  expect(getPrivateCommunications(f.world, f.actor).every(m => !m.own)).toBe(true);
  expect(JSON.stringify(getCommittedEvents(f.world).events)).not.toContain("PRIVATE_INVITATION");
  expect(getPersonalConcerns(f.world, f.peer)).toEqual([]);
});

test("review distinguishes a standing motivation from an already chosen concrete intention", async () => {
  const f = fixture(); f.read(); await f.appraise(ordinary);
  const planned = createGeneratedIntention(f.world, f.actor, { description: dinner.goal, kind: "social", priority: dinner.priority }, "personal")!;
  const r = f.review({ goal: null });
  await r.run(); expect(Goal.status[planned]).toBe("active"); expect(f.goals()).toHaveLength(3);
  expect(r.context().existingIntentions.find((g: any) => g.description === "Stay in touch")).toMatchObject({ persistence: "standing" });
  expect(r.context().existingIntentions.find((g: any) => g.description === dinner.goal)).toMatchObject({ persistence: "episodic" });
  expect(r.infer.mock.calls[0][0].messages[0].content).toContain("standing motivation");
});

test("reading and an unappraised notification do not themselves create a planning review", async () => {
  const f = fixture();
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
  f.read(); expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
  queueExperiencedEvent(f.world, f.actor, f.event);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
  appraisal.mockResolvedValue({ text: JSON.stringify(calm) });
  await runExperienceAppraisal(f.world, f.actor);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(true);
  expect(hasPendingPersonalGoalReview(f.world, f.peer)).toBe(false);
  expect(getPrivateCommunications(f.world, f.peer)).toEqual([]);
});

test.each([
  "I do not want to go. I am staying here.",
  "I would rather finish our conversation.",
  "This is useful to know, but there is nothing for me to do.",
])("a deliberate no-op stays quiet across clocks and repeated receipts: %s", async innerThought => {
  const f = fixture(); await f.appraise({ innerThought });
  const r = f.review(); await r.run(); expect(r.infer).toHaveBeenCalledTimes(1);
  const before = getPersonalConcerns(f.world, f.actor);
  advanceSimulationTime(f.world, 2, 120_000);
  expect(queueExperiencedEvent(f.world, f.actor, f.event)).toBe(false);
  expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "idle" });
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
  expect(getPersonalConcerns(f.world, f.actor)).toEqual(before);
  expect(f.goals()).toEqual([f.routine, f.phone]);
  expect(snapshotAffect(f.world, f.actor)).toBeUndefined();
});

test("a genuinely new, equally calm receipt can reopen consideration after a no-op", async () => {
  const f = fixture(); await f.appraise(calm); await f.review().run();
  advanceSimulationTime(f.world, 2, 6_000);
  await f.appraise({ innerThought: "I would like to go now that my friend is free." },
    { ...f.event, id: "read:new", content: "I finished early. Would you like company?", atSimMs: 50_000 });
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(true);
  const r = f.review(dinner); expect(await r.run()).not.toBeNull();
  expect(r.context().personalExperiences).toHaveLength(1);
  expect(r.context().personalExperiences[0].evidenceIds).toEqual(["read:new"]);
  advanceSimulationTime(f.world, 3, 6_000);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
});

test("coalesced heard receipts get one review, not a phone-specific trigger or one task per sentence", async () => {
  const f = fixture();
  for (let n = 0; n < 3; n++) queueExperiencedEvent(f.world, f.actor,
    { id: `heard:${n}`, channel: "heard-speech", source: "Bo", content: `We could use the spare room. Detail ${n}.`, atSimMs: 44_000 });
  appraisal.mockResolvedValue({ text: JSON.stringify({ innerThought: "I could use that room for my work." }) });
  await runExperienceAppraisal(f.world, f.actor);
  expect(getPersonalConcerns(f.world, f.actor)[0].evidenceIds).toEqual(["heard:0", "heard:1", "heard:2"]);
  const r = f.review({ ...dinner, goal: "Arrange a place to work", motivation: "I want quiet." });
  await r.run(); expect(r.infer).toHaveBeenCalledTimes(1); expect(f.goals()).toHaveLength(3);
  advanceSimulationTime(f.world, 2, 10_000);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
  expect(getPrivateCommunications(f.world, f.actor)).toEqual([]);
});

test("a new calm channel remains available even when the bounded buffer held eight intense experiences", async () => {
  const f = fixture();
  for (let n = 0; n < 8; n++) recordPersonalConcern(f.world, f.actor, { channel: `older:${n}`, evidenceIds: [`old:${n}`],
    appraisal: "An intense past event", significance: "It was intense", importance: 1, appraisedAtSimMs: 40_000 });
  await f.appraise(calm);
  const rows = getPersonalConcerns(f.world, f.actor);
  expect(rows).toHaveLength(8); expect(rows.at(-1)).toMatchObject({ importance: 0, evidenceIds: [f.event.id] });
  const r = f.review(); await r.run();
  expect(r.context().personalExperiences.some((c: any) => c.evidenceIds.includes(f.event.id))).toBe(true);
});

test("a calm resolution replaces old intensity and is reviewed without reasserting the old concern", async () => {
  const f = fixture(); await f.appraise(ordinary); await f.review().run();
  advanceSimulationTime(f.world, 2, 6_000);
  await f.appraise({ innerThought: "We cleared that up. I need nothing more from it." },
    { ...f.event, id: "read:resolved", atSimMs: 50_000 });
  expect(getPersonalConcerns(f.world, f.actor)).toMatchObject([{ importance: 0, evidenceIds: ["read:resolved"] }]);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(true);
  await f.review().run(); advanceSimulationTime(f.world, 3, 60_000);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
  expect(f.goals()).toHaveLength(2);
});

test("queued schedule and deferred concrete work retain their distinct source and status", async () => {
  const f = fixture(); await f.appraise(calm);
  const planned = createGeneratedIntention(f.world, f.actor, { description: dinner.goal, kind: "social", priority: 6 }, "personal")!;
  prepareGoalReview(captureGoalReviewContext(f.world, f.actor), { goalId: planned, disposition: "defer", reason: "Reconsider soon",
    afterSeconds: 60, wake: { kind: "review" } })!.commit();
  const scheduled = createGeneratedIntention(f.world, f.actor, { description: "Follow schedule: dinner", kind: "social", priority: 6 }, "personal")!;
  Goal.status[scheduled] = "queued"; GoalLifecycle.source[scheduled] = "schedule";
  const r = f.review(); await r.run();
  expect(r.context().existingIntentions.find((g: any) => g.description === dinner.goal)).toMatchObject({ status: "paused", persistence: "episodic", reviewAtSimMs: 104_000 });
  expect(r.context().existingIntentions.find((g: any) => g.description === "Follow schedule: dinner")).toMatchObject({ status: "queued", source: "schedule" });
  expect(f.goals()).toHaveLength(4); expect(Goal.status[planned]).toBe("paused");
});

test.each(["persistence", "goal source", "new goal", "owner", "source", "stop", "cancel", "new read", "new appraisal"])(
  "%s changing during ordinary personal review invalidates its proposal before effects", async change => {
    const f = fixture(); f.read(); await f.appraise(calm); const abort = new AbortController();
    let finish!: (result: any) => void;
    const infer = jest.fn(() => new Promise<any>(resolve => { finish = resolve; }));
    const running = withSimulationTask(abort.signal, () => generateAutonomousGoal(f.world, f.actor, { generateText: infer as any }));
    expect(infer).toHaveBeenCalledTimes(1);
    if (change === "persistence") GoalLifecycle.persistence[f.phone] = "episodic";
    if (change === "goal source") GoalLifecycle.source[f.routine] = "schedule";
    if (change === "new goal") createGeneratedIntention(f.world, f.actor, { description: "Leave for work", kind: "social", priority: 9 }, "personal");
    if (change === "owner") WorkingMemoryIdentity.id[f.actor] = "replacement-owner";
    if (change === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
    if (change === "stop") stopCommittedEvents(f.world);
    if (change === "cancel") abort.abort();
    if (change === "new read") recordPrivateCommunication(f.world, f.actor, { sourceId: getCommittedEvents(f.world).sourceId!,
      messageKey: "new-read", channel: "phone:ada", kind: "read", other: "Sam", content: "Actually the restaurant is closed.",
      sentAtSimMs: 44_000, deliveredAtSimMs: 44_000 });
    if (change === "new appraisal") await f.appraise({ innerThought: "Actually I would rather stay here." }, { ...f.event, id: "read:later", atSimMs: 44_000 });
    finish({ text: JSON.stringify(dinner) }); expect(await running).toBeNull();
    expect(f.goals()).toHaveLength(change === "new goal" ? 3 : 2);
    expect(f.goals().some(g => Goal.description[g] === dinner.goal)).toBe(false);
    expect(getPrivateCommunications(f.world, f.actor).every(m => !m.own)).toBe(true);
  },
);

test("lived time may advance during review without becoming action or moving source timestamps", async () => {
  const f = fixture(); await f.appraise(calm);
  const infer = jest.fn(async () => { advanceSimulationTime(f.world, 2, 20_000); return { text: JSON.stringify(dinner) }; });
  expect(await generateAutonomousGoal(f.world, f.actor, { generateText: infer as any })).not.toBeNull();
  expect(getPersonalConcerns(f.world, f.actor)[0]).toMatchObject({ experiencedAtSimMs: 34_200, appraisedAtSimMs: 44_000 });
  const chosen = f.goals().find(g => Goal.description[g] === dinner.goal)!;
  expect(Goal.progress[chosen]).toBe(0);
  expect(getCommittedEvents(f.world).events.filter(e => e.type === "action")).toEqual([]);
});

test.each([
  { firstAction: { type: "move", target: "Restaurant" } },
  { completionId: "invented" }, { supportsGoalId: 123 }, { followUp: { undertakingId: "invented" } },
])("ordinary review grants no extra execution or commitment authority: %p", async extra => {
  const f = fixture(); await f.appraise(calm);
  expect(await f.review({ ...dinner, ...extra }).run()).toBeNull();
  expect(f.goals()).toHaveLength(2); expect(getPrivateCommunications(f.world, f.actor)).toEqual([]);
});

test("calm evidence and a chosen intention survive remapping without leaking or replaying actions", async () => {
  const f = fixture(); f.read(); await f.appraise(calm); await f.review(dinner).run();
  const savedWorld = serializeWorld(f.world, createSystemRegistry());
  const restored = createArgosWorld("Restored ordinary choices"); for (let n = 0; n < 20; n++) addEntity(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), savedWorld);
  restored.meta.aiEnabled = true; startCommittedEvents(restored);
  const actor = oldToNewId.get(f.actor)!, peer = oldToNewId.get(f.peer)!;
  expect(actor).not.toBe(f.actor);
  expect(getPersonalConcerns(restored, actor)).toEqual(getPersonalConcerns(f.world, f.actor));
  expect(getPersonalConcerns(restored, peer)).toEqual([]); expect(getPrivateCommunications(restored, peer)).toEqual([]);
  // A fresh scheduler can reconsider saved evidence, never re-run an old action.
  expect(hasPendingPersonalGoalReview(restored, actor)).toBe(true);
  const r = jest.fn(async () => ({ text: '{"goal":null}' }));
  await generateAutonomousGoal(restored, actor, { generateText: r as any });
  expect(r).toHaveBeenCalledTimes(1);
  expect(getRelationTargets(restored, actor, HasGoal)).toHaveLength(3);
  expect(getCommittedEvents(restored).events).toEqual([]);
});

test("a different world or recycled actor cannot review this actor's ordinary evidence", async () => {
  const f = fixture(); await f.appraise(calm); const other = fixture();
  expect(hasPendingPersonalGoalReview(other.world, other.actor)).toBe(false);
  expect(getPersonalConcerns(other.world, other.actor)).toEqual([]);
  WorkingMemoryIdentity.id[f.actor] = "replacement";
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
});
