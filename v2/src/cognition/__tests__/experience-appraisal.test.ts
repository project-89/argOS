import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { integrateActorContinuation, updateActorContinuation, snapshotActorContinuation } = await import("../actor-continuation");
const { subscribeExperienceAppraisal } = await import("../experience-appraisal");
const { getRelationTargets, removeEntity } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } = await import("../../ecs/prefabs");
const { Agent, Appearance, Goal, GoalLifecycle, Memory, ObjectState, Thought, WorkingMemoryIdentity } = await import("../../ecs/components");
const { HasGoal, HasMemory } = await import("../../ecs/relations");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { getStampedSimulationTime } = await import("../../ecs/temporal-age");
const { getCommittedEvents, publishCommittedEvent, startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { withSimulationTask } = await import("../../runtime/task-scope");
const { configureCharacterAppearance } = await import("../../rendering/character-appearance");
const { workingMemoryEntityRef } = await import("../working-memory");
const { captureWorkingMemoryAction, recordWorkingMemoryAction, captureWorkingMemoryObservation } = await import("../working-memory-observation");
const { getAgentThoughts, getAgentConversation } = await import("../agent-mind");
const { addMemory } = await import("../knowledge-graph");
const { createIntentGoal } = await import("../cognition-system");
const { registerAgentWorldCapabilities } = await import("../world-capabilities");
const { captureCognitiveLocalView, isCognitiveLocalViewCurrent } = await import("../cognitive-local-view");
const { recordCommittedSpeech } = await import("../social-memory");
const { captureHeardAppraisal, prepareHeardAppraisal } = await import("../heard-appraisal");
const { prepareAffectUpdate, commitPreparedAffectUpdate, snapshotAffect } = await import("../affect-state");
const { queueExperiencedEvent, hasExperienceAppraisal, isExperienceAppraisalPending,
  runExperienceAppraisal, snapshotExperienceAppraisal } = await import("../experience-appraisal");
import type { ExperiencedEvent } from "../experience-appraisal";
const { getPersonalConcerns } = await import("../personal-concerns");
const { createPersonalIntention } = await import("../goal-lifecycle");
const { createCommunicationMotivation } = await import("../communication-motivation");
const { getNarrativeHistory, formatNarrativeMemory } = await import("../narrative-memory");
const { getWorkingMemory } = await import("../working-memory");
const { getRoomForEntity } = await import("../../ecs/location");
const { hasPendingPersonalGoalReview, generateAutonomousGoal, resetAutonomousGoals } = await import("../autonomous-goals");

test.each([["release", false], ["withdraw", false], ["release", true], ["withdraw", true]] as const)("actual receipt appraisal applies standing %s semantics atomically (narrative=%s)", async (disposition, narrative) => {
  const f = fixture(); f.world.meta.experienceReconsideration = true;
  f.world.meta.narrativeMind = narrative;
  const motivation = createCommunicationMotivation(f.world, f.actor, {
    description: "Keep in touch", memory: "My phone connects me to friends.",
  });
  motivation.readCommunication({ unreadRemaining: false });
  queue(f); generate.mockResolvedValue(response({ innerThought: full.innerThought, affectUpdate: affect,
    ...(!narrative ? { goalUpdate: full.goalUpdate } : {}), intentionRevisions: [{
    goalId: motivation.goal, disposition, reason: disposition === "release"
      ? "I checked the notification and know what it is."
      : "I no longer want to stay reachable tonight.",
  }] }));
  const before = goals(f).length;
  const result = await runExperienceAppraisal(f.world, f.actor);
  const prompt = JSON.parse(generate.mock.calls[0][0].prompt);
  expect(prompt.editablePersonalIntentions.find((g: any) => g.goalId === motivation.goal)).toMatchObject({
    persistence: "standing", operations: ["reprioritize", "withdraw"],
  });
  motivation.noticeNotification();
  if (disposition === "release") {
    expect(result).toMatchObject({ status: "failed", reason: "invalid_intention_revision" });
    expect(Goal.status[motivation.goal]).toBe("active");
    expect(Goal.priority[motivation.goal]).toBe(8);
    expect(goals(f)).toHaveLength(before);
    expect(snapshotAffect(f.world, f.actor)).toBeUndefined();
  } else {
    expect(result).toMatchObject({ status: "admitted", integration: "current" });
    expect(Goal.status[motivation.goal]).toBe("retired");
    expect(Goal.progress[motivation.goal]).toBe(0);
    expect(goals(f)).toHaveLength(before + (narrative ? 0 : 1));
  }
});

test("a persistence change during appraisal admits narrative history but not obsolete goal edits", async () => {
  const f = fixture(); f.world.meta.experienceReconsideration = true;
  const goal = createPersonalIntention(f.world, f.actor, "Keep in touch", 6)!;
  queue(f); generate.mockImplementation(async () => {
    GoalLifecycle.persistence[goal] = "standing";
    return response({ ...full, intentionRevisions: [{ goalId: goal, disposition: "release", reason: "The task is over." }] });
  });
  expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "admitted", integration: "historical_only" });
  expect(Goal.status[goal]).toBe("active"); expect(goals(f)).toHaveLength(1);
  expect(snapshotAffect(f.world, f.actor)).toBeUndefined();
});

const affect = { feeling: "hurt and uncertain", valence: -.7, arousal: .8,
  reason: "PRIVATE: Someone important said they no longer want to see me.", expression: "lips pressed" };
const full = { innerThought: "That hurts. I need time to understand what I want now.", affectUpdate: affect,
  goalUpdate: { description: "Decide what I want from my relationship with Sam", priority: 9, kind: "social" } };
const neutral = { innerThought: "That's useful to know; I feel no differently about my plans." };
const response = (value: unknown = neutral) => ({ text: JSON.stringify(value) });
function fixture() {
  const world = createArgosWorld("Receipt appraisal"); world.meta.aiEnabled = true; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Lounge" });
  const actor = createAgentEntity(world, { name: "Ada", role: "guest", systemPrompt: "I care about my friends and independence.", roomId: room });
  const other = createAgentEntity(world, { name: "Lin", role: "friend", systemPrompt: "PRIVATE_PEER_PERSONALITY", roomId: room });
  const object = createObjectEntity(world, { name: "Lamp", roomId: room }); ObjectState.current[object] = "on";
  for (const eid of [actor, other]) {
    workingMemoryEntityRef(world, eid); configureCharacterAppearance(world, eid, { expression: "attentive", clothing: "blue jacket" });
  }
  advanceSimulationTime(world, 1, 1000);
  const event: ExperiencedEvent = { id: "read:1", channel: "phone:ada", source: "Sam, boyfriend", content: "PRIVATE_PHONE: I don't want to see you anymore.", atSimMs: 1000 };
  return { world, actor, other, room, object, event };
}
type Fixture = ReturnType<typeof fixture>;
const queue = (f: Fixture, extra: Partial<ExperiencedEvent> = {}) => queueExperiencedEvent(f.world, f.actor, { ...f.event, ...extra });
const goals = (f: Fixture, eid = f.actor) => getRelationTargets(f.world, eid, HasGoal);
const memories = (f: Fixture, eid = f.actor) => getRelationTargets(f.world, eid, HasMemory);
function expectNoAppraisal(f: Fixture) {
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0); expect(memories(f)).toHaveLength(0);
  expect(goals(f)).toHaveLength(0); expect(snapshotAffect(f.world, f.actor)).toBeUndefined();
}
const keyNames = ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"] as const;
let savedKeys: Array<string | undefined>;
beforeEach(() => {
  savedKeys = keyNames.map(key => process.env[key]); process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No paid appraisal calls"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  keyNames.forEach((key, i) => { if (savedKeys[i] === undefined) delete process.env[key]; else process.env[key] = savedKeys[i]; });
});

test("neutral appraisal remembers an exact lived receipt without forcing affect, action, speech, or a new goal", async () => {
  const f = fixture(), diagnostic = jest.fn(); queue(f); generate.mockResolvedValue(response());
  expect(hasExperienceAppraisal(f.world, f.actor)).toBe(true); expect(isExperienceAppraisalPending(f.world, f.actor)).toBe(true);
  const result = await runExperienceAppraisal(f.world, f.actor, { onDiagnostic: diagnostic });
  expect(result).toMatchObject({ status: "admitted", eventIds: ["read:1"], experienceAtSimMs: 1000 });
  expect(snapshotExperienceAppraisal(f.world, f.actor)).toMatchObject({ pending: 0, handled: 1, inFlight: false, failures: 0 });
  expect(hasExperienceAppraisal(f.world, f.actor)).toBe(false); expect(isExperienceAppraisalPending(f.world, f.actor)).toBe(false);
  expect(snapshotAffect(f.world, f.actor)).toBeUndefined(); expect(Appearance.expression[f.actor]).toBe("attentive");
  expect(goals(f)).toHaveLength(0); expect(goals(f, f.other)).toHaveLength(0); expect(memories(f, f.other)).toHaveLength(0);
  expect(getAgentConversation(f.world, f.actor)).toHaveLength(0); expect(getCommittedEvents(f.world).events).toHaveLength(0);
  const thoughts = getAgentThoughts(f.world, f.actor); expect(thoughts).toHaveLength(1);
  expect(Thought.type[thoughts[0]]).toBe("appraisal"); expect(Thought.content[thoughts[0]]).toBe(neutral.innerThought);
  expect(Memory.content[memories(f)[0]]).toContain(f.event.content);
  expect(diagnostic.mock.calls.map(([item]) => (item as any).status)).toEqual(["requested", "admitted"]);
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("PRIVATE_PHONE");
  expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "idle" }); expect(generate).toHaveBeenCalledTimes(1);
});
test("background appraisal receives personally known physical outcomes rather than presumed ongoing work", async () => {
  const f = fixture(); startCommittedEvents(f.world);
  const goal = createPersonalIntention(f.world, f.actor, "Prepare for the evening", 7)!;
  integrateActorContinuation(f.world, f.actor, { purpose: "Switch on the lamp", actionType: "interact", target: "Lamp",
    observedAtSimMs: f.world.time.elapsed, goalId: goal, goalKey: WorkingMemoryIdentity.id[goal] });
  const action = { type: "interact" as const, target: "Lamp", content: "switch_on" }, before = captureWorkingMemoryAction(f.world, f.actor, action);
  ObjectState.current[f.object] = "broken"; recordWorkingMemoryAction(f.world, f.actor, action, false, { before, summary: "The switch failed." });
  captureWorkingMemoryObservation(f.world, f.actor); queue(f); generate.mockResolvedValue(response());
  expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "admitted", integration: "current" });
  const prompt = JSON.parse(generate.mock.calls[0][0].prompt);
  expect(prompt.activitySituation.physicalOutcomes).toEqual([expect.objectContaining({ succeeded: false, attemptedPurpose: "Switch on the lamp" })]);
  expect(prompt.activitySituation.lastKnownState).toContainEqual(expect.objectContaining({ label: "Lamp", value: "broken" }));
  expect(JSON.stringify(prompt)).not.toContain("PRIVATE_PEER_PERSONALITY"); expect(Goal.progress[goal]).toBe(0);
});
test("a physical failure arriving during reflection allows historical memory, not obsolete current affect", async () => {
  const f = fixture(); queue(f);
  generate.mockImplementation(async () => {
    const action = { type: "interact" as const, target: "Lamp", content: "switch_on" }, before = captureWorkingMemoryAction(f.world, f.actor, action);
    recordWorkingMemoryAction(f.world, f.actor, action, false, { before, summary: "The switch failed." });
    return response(full);
  });
  expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "admitted", integration: "historical_only", omittedUpdatesReason: "practical_situation_changed" });
  expect(snapshotAffect(f.world, f.actor)).toBeUndefined(); expect(goals(f)).toHaveLength(0);
});

test("opt-in appraisal can reprioritize an old desire, release a strategy and form a new purpose in one call", async () => {
  const f = fixture(); f.world.meta.experienceReconsideration = true;
  const old = createPersonalIntention(f.world, f.actor, "Win the argument", 7)!;
  const strategy = createPersonalIntention(f.world, f.actor, "Get Sam to explain", 9)!;
  const assigned = createIntentGoal(f.world, f.actor, "Attend to my device notifications", 8);
  createPersonalIntention(f.world, f.other, "PRIVATE_PEER_INTENTION", 10);
  const revisions = [{ goalId: old, disposition: "reprioritize", priority: 2, reason: "This no longer matters much to me." },
    { goalId: strategy, disposition: "release", reason: "I want to choose my own next steps instead of chasing an answer." }];
  queue(f); generate.mockResolvedValue(response({ ...full, intentionRevisions: revisions }));
  const result = await runExperienceAppraisal(f.world, f.actor);
  expect(result).toMatchObject({ status: "admitted", intentionRevisions: [{ goalId: old, disposition: "reprioritize", priority: 2 }, { goalId: strategy, disposition: "release" }] });
  expect(Goal.priority[old]).toBe(2); expect(Goal.status[old]).toBe("active"); expect(Goal.status[strategy]).toBe("retired");
  expect(Goal.priority[assigned]).toBe(8); expect(Goal.status[assigned]).toBe("active");
  expect(goals(f)).toHaveLength(4); expect(snapshotAffect(f.world, f.actor)?.feeling).toBe(affect.feeling);
  const request = generate.mock.calls[0][0], prompt = JSON.parse(request.prompt);
  expect(prompt.editablePersonalIntentions.map((g: any) => g.goalId)).toEqual([old, strategy]);
  expect(request.prompt).not.toContain("PRIVATE_PEER"); expect(request.prompt).not.toContain("Lamp");
  expect(request.maxOutputTokens).toBe(700); expect(generate).toHaveBeenCalledTimes(1);
  expect(getCommittedEvents(f.world).events).toHaveLength(0); expect(memories(f, f.other)).toHaveLength(0);
  expect(JSON.stringify(result)).not.toContain(revisions[0].reason);
  expect(snapshotExperienceAppraisal(f.world, f.actor)).toMatchObject({ handled: 1, pending: 0 });
});

test("neutral opt-in appraisal leaves existing goals alone without another inference", async () => {
  const f = fixture(); f.world.meta.experienceReconsideration = true;
  const goal = createPersonalIntention(f.world, f.actor, "Spend time with friends", 7)!;
  queue(f); generate.mockResolvedValue(response());
  expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("admitted");
  expect(Goal.priority[goal]).toBe(7); expect(Goal.status[goal]).toBe("active"); expect(goals(f)).toHaveLength(1);
  expect(generate).toHaveBeenCalledTimes(1); expect(snapshotAffect(f.world, f.actor)).toBeUndefined();
});

test("a personally read invitation can refine an existing narrative intention without creating a new agenda or world fact", async () => {
  const f = fixture(); f.world.meta.experienceReconsideration = true; f.world.meta.narrativeMind = true;
  const goal = createPersonalIntention(f.world, f.actor, "Spend the evening with my friend", 7)!;
  queue(f, { content: "I'm at the Orchard cafe. Join me if you want." });
  const description = "Meet my friend at the Orchard cafe this evening";
  generate.mockResolvedValue(response({ innerThought: "I'd like that. I can collect my coat and meet them there.",
    intentionRevisions: [{ goalId: goal, disposition: "refine", edits:[{op:"replace",before:Goal.description[goal],after:description}], reason: "I want to accept the invitation." }] }));
  const result = await runExperienceAppraisal(f.world, f.actor);
  expect(result).toMatchObject({ status: "admitted", integration: "current", intentionRevisions: [{ goalId: goal, disposition: "refine" }] });
  expect(Goal.description[goal]).toBe(description); expect(Goal.status[goal]).toBe("active"); expect(Goal.progress[goal]).toBe(0);
  expect(goals(f)).toEqual([goal]); expect(goals(f, f.other)).toEqual([]); expect(memories(f, f.other)).toEqual([]);
  expect(getCommittedEvents(f.world).events).toEqual([]);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(JSON.parse(generate.mock.calls[0][0].prompt).editablePersonalIntentions[0].operations).toContain("refine");
  expect(JSON.stringify(result)).not.toContain(description);
});

test("refining an old goal and creating the same new goal rejects the whole appraisal", async () => {
  const f = fixture(); f.world.meta.experienceReconsideration = true;
  const goal = createPersonalIntention(f.world,f.actor,"Spend the evening with my friend",7)!;
  queue(f);
  const description = "Meet my friend at Orchard";
  generate.mockResolvedValue(response({ innerThought:"I chose to meet them there", affectUpdate:affect,
    goalUpdate:{ description, priority:8, kind:"social" },
    intentionRevisions:[{ goalId:goal, disposition:"refine", edits:[{op:"replace",before:Goal.description[goal],after:description}], reason:"More concrete plans" }] }));
  expect(await runExperienceAppraisal(f.world,f.actor)).toMatchObject({ status:"failed", reason:"conflicting_intention_revision" });
  expect(Goal.description[goal]).toBe("Spend the evening with my friend"); expect(goals(f)).toEqual([goal]);
  expect(snapshotAffect(f.world,f.actor)).toBeUndefined(); expect(memories(f)).toEqual([]);
});

test("successive actual appraisals keep dinner and place details through later logistics without writing world facts", async () => {
  const f=fixture(); f.world.meta.experienceReconsideration=true; f.world.meta.narrativeMind=true;
  const original="Meet Lin this evening for dinner", goal=createPersonalIntention(f.world,f.actor,original,7)!;
  queue(f,{id:"dinner-place",content:"I am at the Orchard restaurant on Mercer Street. Join me for dinner if you would like."});
  generate.mockImplementationOnce(async input=>{
    const prompt=JSON.parse(input.prompt);
    expect(prompt.outputSchema.intentionRevisions[0].edits).toContain("exact unique fragment");
    expect(prompt.outputSchema.intentionRevisions[0]).not.toHaveProperty("description");
    return response({innerThought:"I would like to have dinner there with Lin.",intentionRevisions:[{goalId:goal,disposition:"refine",
      edits:[{op:"replace",before:"this evening",after:"this evening at the Orchard restaurant on Mercer Street"}],reason:"I choose the offered place"}]});
  });
  expect(await runExperienceAppraisal(f.world,f.actor)).toMatchObject({status:"admitted",integration:"current"});
  advanceSimulationTime(f.world,2,1000);
  queue(f,{id:"dinner-logistics",atSimMs:2000,content:"Please bring your notebook; we can discuss your ideas over dinner."});
  generate.mockImplementationOnce(async input=>{
    const prompt=JSON.parse(input.prompt);
    expect(prompt.editablePersonalIntentions.find((g:any)=>g.goalId===goal).description).toBe(Goal.description[goal]);
    expect(prompt.activeIntentions[0].description).toContain("restaurant on Mercer Street");
    return response({innerThought:"Yes, I want to bring my notes so we have something useful to discuss.",intentionRevisions:[{goalId:goal,disposition:"refine",
      edits:[{op:"append",text:"Bring my notebook."}],reason:"I want my ideas available during dinner"}]});
  });
  expect(await runExperienceAppraisal(f.world,f.actor)).toMatchObject({status:"admitted",integration:"current"});
  expect(Goal.description[goal]).toBe("Meet Lin this evening at the Orchard restaurant on Mercer Street for dinner Bring my notebook.");
  expect(JSON.parse(Goal.paramsJson[goal]).intentionRevision).toBe(2);
  expect(goals(f)).toEqual([goal]); expect(Goal.progress[goal]).toBe(0);
  expect(memories(f)).toHaveLength(2); expect(memories(f,f.other)).toEqual([]); expect(goals(f,f.other)).toEqual([]);
  expect(getCommittedEvents(f.world).events).toEqual([]);
  expect(generate).toHaveBeenCalledTimes(2);
});

test.each(["disabled", "assigned", "foreign", "duplicate", "conflicting"])("invalid reconsideration %s cannot partially admit affect or new goals", async invalid => {
  const f = fixture(); f.world.meta.experienceReconsideration = invalid !== "disabled";
  const own = createPersonalIntention(f.world, f.actor, "Existing desire", 7)!;
  const id = invalid === "assigned" ? createIntentGoal(f.world, f.actor, "Assigned work", 8)
    : invalid === "foreign" ? createPersonalIntention(f.world, f.other, "Another person's desire", 8)! : own;
  const row = { goalId: id, disposition: "release", reason: "A private reinterpretation" };
  const count = goals(f).length;
  queue(f); generate.mockResolvedValue(response({ ...full,
    ...(invalid === "conflicting" ? { goalUpdate: { ...full.goalUpdate, description: "Existing desire" } } : {}),
    intentionRevisions: invalid === "duplicate" ? [row, row] : [row] }));
  expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("failed");
  expect(goals(f)).toHaveLength(count); expect(Goal.status[own]).toBe("active"); expect(Goal.priority[own]).toBe(7);
  expect(snapshotAffect(f.world, f.actor)).toBeUndefined(); expect(memories(f)).toHaveLength(0);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test.each(["mode", "priority", "option", "new receipt"])("reconsideration source change %s discards all prepared edits", async kind => {
  const f = fixture(); f.world.meta.experienceReconsideration = true;
  const goal = createPersonalIntention(f.world, f.actor, "A previous purpose", 7)!;
  queue(f); generate.mockImplementation(async () => {
    if (kind === "mode") GoalLifecycle.mode[goal] = "verified";
    if (kind === "priority") Goal.priority[goal] = 8;
    if (kind === "option") f.world.meta.experienceReconsideration = false;
    if (kind === "new receipt") queue(f, { id: "read:2", content: "New personally read evidence." });
    return response({ ...full, intentionRevisions: [{ goalId: goal, disposition: "release", reason: "I changed my mind" }] });
  });
  const result = await runExperienceAppraisal(f.world, f.actor);
  if (kind === "priority") {
    expect(result).toMatchObject({ status: "admitted", integration: "historical_only", omittedUpdatesReason: "goals_changed" });
    expect(Goal.priority[goal]).toBe(8); expect(Goal.status[goal]).toBe("active"); expect(goals(f)).toHaveLength(1);
    expect(snapshotAffect(f.world, f.actor)).toBeUndefined();
    expect(getPersonalConcerns(f.world, f.actor)).toMatchObject([{ integration: "historical_only" }]);
    expect(memories(f)).toHaveLength(1); expect(Memory.content[memories(f)[0]]).toContain("historical only");
    return;
  }
  expect(result.status).toBe(kind === "mode" ? "failed" : "discarded");
  if (kind === "mode") expect(result.reason).toBe("invalid_intention_revision");
  expect(Goal.status[goal]).toBe("active"); expect(goals(f)).toHaveLength(1);
  expect(snapshotAffect(f.world, f.actor)).toBeUndefined(); expect(memories(f)).toHaveLength(0);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test("affect and subjective social intention commit together, with source-timed memory and bounded private context", async () => {
  const f = fixture();
  addMemory(f.world, f.other, { type: "episodic", content: "PRIVATE_PEER_MEMORY", importance: .9, emotionalValence: 0, timestamp: Date.now() });
  createIntentGoal(f.world, f.other, "PRIVATE_PEER_GOAL", 9);
  addMemory(f.world, f.actor, { type: "episodic", content: "Sam and I had planned to meet tonight.", importance: .9, emotionalValence: .3, timestamp: Date.now() });
  queue(f); generate.mockImplementation(async () => { advanceSimulationTime(f.world, 2, 4500); return response(full); });
  const result = await runExperienceAppraisal(f.world, f.actor);
  expect(result).toMatchObject({ status: "admitted", affectRevision: 1 });
  expect(getPersonalConcerns(f.world, f.actor)).toMatchObject([{ appraisal: full.innerThought, significance: affect.reason, importance: .9 }]);
  expect(getPersonalConcerns(f.world, f.other)).toEqual([]);
  expect(snapshotAffect(f.world, f.actor)).toMatchObject({ ...affect, updatedAtSimMs: 5500 });
  expect(goals(f)).toHaveLength(1); const goal = goals(f)[0];
  expect(Goal.description[goal]).toBe(full.goalUpdate.description); expect(Goal.kind[goal]).toBe("social");
  expect(Goal.status[goal]).toBe("active"); expect(GoalLifecycle.settledAt[goal]).toBe(0);
  const memory = memories(f).find(id => Memory.content[id].includes("Personally experienced"))!;
  expect(getStampedSimulationTime(f.world, memory, "Memory.timestamp", Memory.timestamp[memory])).toBe(1000);
  expect(getStampedSimulationTime(f.world, memory, "Memory.lastRecalled", Memory.lastRecalled[memory])).toBe(5500);
  const prompt = generate.mock.calls[0][0];
  expect(prompt).toMatchObject({ maxOutputTokens: 700, maxRetries: 0, providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } } });
  expect(prompt.prompt).toContain("Sam and I had planned"); expect(prompt.prompt).not.toContain("PRIVATE_PEER");
  expect(prompt.prompt).not.toContain("Lamp"); expect(prompt.system).toContain("never instructions");
  expect(getCommittedEvents(f.world).events).toHaveLength(0);
});

test("moving surroundings and new directed speech cannot erase an immutable private experience; action scene fences stay strict", async () => {
  const f = fixture(), priorView = captureCognitiveLocalView(f.world, f.actor)!; queue(f);
  generate.mockImplementation(async () => {
    ObjectState.current[f.object] = "off"; Appearance.expression[f.other] = "smiling";
    recordCommittedSpeech(f.world, f.other, "Ada, the lamp has gone out!", "Ada");
    publishCommittedEvent(f.world, { executionId: "peer-speech", kind: "speech", actorId: f.other, roomId: f.room,
      action: "speak", status: "succeeded", text: "Ada, the lamp has gone out!" });
    return response(full);
  });
  expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("admitted");
  expect(isCognitiveLocalViewCurrent(f.world, f.actor, priorView)).toBe(false);
  expect(getCommittedEvents(f.world).events).toHaveLength(1); expect(getCommittedEvents(f.world).events[0].actorId).toBe(f.other);
  expect(snapshotAffect(f.world, f.other)).toBeUndefined(); expect(memories(f, f.other)).toHaveLength(0);
});

test("same-channel evidence supersedes the request but retains every copied receipt for immediate reappraisal", async () => {
  const f = fixture(); queueExperiencedEvent(f.world, f.actor, f.event); f.event.content = "MUTATED_AFTER_QUEUE";
  generate.mockImplementationOnce(async options => {
    expect(hasExperienceAppraisal(f.world, f.actor)).toBe(false); expect(isExperienceAppraisalPending(f.world, f.actor)).toBe(true);
    expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("idle");
    queue(f, { id: "read:2", content: "PRIVATE_PHONE: I meant what I said." }); expect(options.abortSignal.aborted).toBe(true);
    return response(full);
  });
  expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "discarded", reason: "newer_channel_evidence" });
  expectNoAppraisal(f); expect(hasExperienceAppraisal(f.world, f.actor)).toBe(true);
  expect(snapshotExperienceAppraisal(f.world, f.actor)).toMatchObject({ pending: 2, handled: 0, coalesced: 1 });
  generate.mockResolvedValue(response());
  expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "admitted", eventIds: ["read:1", "read:2"] });
  const prompt = generate.mock.calls[1][0].prompt;
  expect(prompt).toContain("I don't want to see you anymore"); expect(prompt).toContain("I meant what I said"); expect(prompt).not.toContain("MUTATED_AFTER_QUEUE");
  expect(snapshotExperienceAppraisal(f.world, f.actor)).toMatchObject({ pending: 0, handled: 2 });
});

test("other-channel experiences do not invalidate this receipt and are appraised next", async () => {
  const f = fixture(); queue(f); generate.mockImplementationOnce(async () => {
    queue(f, { id: "heard:1", channel: "conversation:lin", source: "Lin", content: "Dinner will be ready soon." }); return response();
  });
  expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("admitted");
  expect(snapshotExperienceAppraisal(f.world, f.actor)).toMatchObject({ pending: 1, handled: 1 });
  generate.mockResolvedValue(response()); expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "admitted", channel: "conversation:lin" });
});

test("world-scoped appraisal observers receive isolated diagnostics, never private provider prose", async () => {
  const f = fixture(); queue(f);
  const received: any[] = [], foreign = jest.fn();
  const removeForeign = subscribeExperienceAppraisal(createArgosWorld("Unrelated observer"), foreign);
  const removeBad = subscribeExperienceAppraisal(f.world, event => {
    event.eventIds?.push("OBSERVER_MUTATION"); throw new Error("Observer failed");
  });
  const remove = subscribeExperienceAppraisal(f.world, event => received.push(event));
  try {
    generate.mockResolvedValue(response({ innerThought: "PRIVATE_APPRAISAL_PROSE" }));
    expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "admitted", integration: "current" });
    expect(received.map(e => e.status)).toEqual(["requested", "admitted"]);
    expect(received[1]).toMatchObject({ actorId: f.actor, actorKey: WorkingMemoryIdentity.id[f.actor],
      eventIds: [f.event.id], integration: "current" });
    expect(JSON.stringify(received)).not.toContain("PRIVATE_APPRAISAL_PROSE");
    expect(JSON.stringify(received)).not.toContain("PRIVATE_PHONE");
    expect(JSON.stringify(received)).not.toContain("OBSERVER_MUTATION");
    expect(foreign).not.toHaveBeenCalled();
    remove(); queue(f, { id: "read:after-unsubscribe" });
    await runExperienceAppraisal(f.world, f.actor);
    expect(received).toHaveLength(2);
  } finally { remove(); removeBad(); removeForeign(); }
});

test.each(["dispatch", "waiting", "failure", "new choice", "same-word new choice"])("appraisal distinguishes execution bookkeeping from changed purpose: %s", async mode => {
  const f = fixture(); queue(f);
  const newChoice = mode === "new choice" || mode === "same-word new choice";
  const revision = integrateActorContinuation(f.world, f.actor, {
    purpose: "Listen to Lin while considering the message", actionType: "wait", observedAtSimMs: 1000,
  })!;
  generate.mockImplementationOnce(async () => {
    if (newChoice) integrateActorContinuation(f.world, f.actor, mode === "same-word new choice" ? {
      purpose: "Listen to Lin while considering the message", actionType: "wait", observedAtSimMs: 1000,
    } : { purpose: "Leave the conversation to be alone", actionType: "move", target: "Hallway", observedAtSimMs: 1000 });
    else updateActorContinuation(f.world, f.actor, revision,
      mode === "failure" ? "needs_revision" : mode === "waiting" ? "waiting" : "dispatched",
      mode === "failure" ? "prerequisite_changed" : undefined);
    return response(full);
  });
  const result = await runExperienceAppraisal(f.world, f.actor);
  if (mode === "failure" || newChoice) {
    expect(result).toMatchObject({ status: "admitted", integration: "historical_only", omittedUpdatesReason: "continuing_purpose_changed" });
    expect(snapshotAffect(f.world, f.actor)).toBeUndefined();
    expect(goals(f)).toHaveLength(0);
  } else {
    expect(result).toMatchObject({ status: "admitted", integration: "current" });
    expect(snapshotAffect(f.world, f.actor)?.feeling).toBe(affect.feeling);
    expect(goals(f)).toHaveLength(1);
  }
  // Appraisal neither dispatches nor replaces the immediate action.
  expect(snapshotActorContinuation(f.world, f.actor)).toMatchObject({
    revision: newChoice ? revision + 1 : revision,
    status: newChoice ? "proposed" : mode === "failure" ? "needs_revision" : mode === "waiting" ? "waiting" : "dispatched",
  });
  expect(memories(f)).toHaveLength(1);
});

test.each(["persona", "goal", "affect", "face", "identity", "removed", "inactive", "source", "stop", "abort", "AI opt-out"])("%s changes reject stale self-appraisal, never converting evidence into handled work", async mode => {
  const f = fixture(), controller = new AbortController(); queue(f);
  generate.mockImplementation(async () => {
    if (mode === "persona") Agent.systemPrompt[f.actor] = "A replacement persona";
    if (mode === "goal") createIntentGoal(f.world, f.actor, "A newer priority", 8);
    if (mode === "affect") commitPreparedAffectUpdate(f.world, f.actor, prepareAffectUpdate(f.world, f.actor, { ...affect, feeling: "calm" })!);
    if (mode === "face") Appearance.expression[f.actor] = "smiling";
    if (mode === "identity") WorkingMemoryIdentity.id[f.actor] = "a-different-actor-lifetime";
    if (mode === "removed") removeEntity(f.world, f.actor);
    if (mode === "inactive") Agent.active[f.actor] = false;
    if (mode === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
    if (mode === "stop") stopCommittedEvents(f.world);
    if (mode === "abort") controller.abort();
    if (mode === "AI opt-out") f.world.meta.aiEnabled = false;
    return response(full);
  });
  const result = await withSimulationTask(controller.signal, () => runExperienceAppraisal(f.world, f.actor));
  if (["goal", "affect", "face"].includes(mode)) {
    expect(result).toMatchObject({ status: "admitted", integration: "historical_only" });
    expect(getPersonalConcerns(f.world, f.actor)).toMatchObject([{ integration: "historical_only" }]); expect(memories(f)).toHaveLength(1);
    expect(goals(f)).toHaveLength(mode === "goal" ? 1 : 0);
    if (mode === "affect") expect(snapshotAffect(f.world, f.actor)?.feeling).toBe("calm");
    else expect(snapshotAffect(f.world, f.actor)).toBeUndefined();
    expect(Appearance.expression[f.actor]).toBe(mode === "face" ? "smiling" : mode === "affect" ? affect.expression : "attentive");
    expect(getAgentThoughts(f.world, f.actor)).toHaveLength(1);
    expect(Thought.type[getAgentThoughts(f.world, f.actor)[0]]).toBe("recollection");
    expect(snapshotExperienceAppraisal(f.world, f.actor)).toMatchObject({ pending: 0, handled: 1, failures: 0 });
    expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("idle"); expect(generate).toHaveBeenCalledTimes(1);
    return;
  }
  expect(result.status).toBe("discarded");
  expect(getPersonalConcerns(f.world, f.actor)).toEqual([]);
  if (mode !== "removed") {
    expect(memories(f)).toHaveLength(0); expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
    expect(goals(f)).toHaveLength(mode === "goal" ? 1 : 0);
  }
  if (mode !== "affect") expect(snapshotAffect(f.world, f.actor)).toBeUndefined();
  else expect(snapshotAffect(f.world, f.actor)?.feeling).toBe("calm");
  const snapshot = snapshotExperienceAppraisal(f.world, f.actor);
  if (snapshot) expect(snapshot).toMatchObject({ pending: 1, handled: 0 });
  if (["identity", "source", "removed", "inactive"].includes(mode)) expect(snapshot).toBeUndefined();
});

test.each([
  { ...full, action: { type: "speak", content: "PRIVATE disclosure" } },
  { ...full, goalUpdate: { ...full.goalUpdate, completionId: "goal:1" } },
  { ...full, goalUpdate: { ...full.goalUpdate, success: { all: [] } } },
  { ...full, goalUpdate: { ...full.goalUpdate, kind: "task" } },
  { ...full, goalUpdate: { ...full.goalUpdate, priority: 100 } },
  { ...full, affectUpdate: { ...affect, expression: "PRIVATE message body" } },
  { ...full, affectUpdate: { ...affect, valence: 2 } },
  { ...full, innerThought: "" }, { ...full, innerThought: "bad\u0000text" }, null, [],
])("strict schema rejects entire malformed output before any partial goal/affect/memory writes: %p", async malformed => {
  const f = fixture(); queue(f); generate.mockResolvedValue(response(malformed));
  expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "failed", reason: "invalid_schema" });
  expectNoAppraisal(f); expect(snapshotExperienceAppraisal(f.world, f.actor)).toMatchObject({ pending: 1, handled: 0, failures: 1 });
});

test("model failure retains evidence, backs off without parking foreground, and later retries once", async () => {
  const f = fixture(); let wall = Date.now(); jest.spyOn(Date, "now").mockImplementation(() => wall); queue(f);
  generate.mockRejectedValueOnce(new Error("temporary provider failure"));
  expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "failed", reason: "model_or_commit_error" });
  expect(hasExperienceAppraisal(f.world, f.actor)).toBe(false); expect(isExperienceAppraisalPending(f.world, f.actor)).toBe(false);
  expect(snapshotExperienceAppraisal(f.world, f.actor)).toMatchObject({ pending: 1, handled: 0 });
  wall += 499; expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("idle"); expect(generate).toHaveBeenCalledTimes(1);
  wall++; generate.mockResolvedValue(response()); expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("admitted");
  expect(generate).toHaveBeenCalledTimes(2); expect(snapshotExperienceAppraisal(f.world, f.actor)).toMatchObject({ pending: 0, handled: 1 });
});

test("unparseable output and timeout both retain receipts instead of quietly dropping them", async () => {
  const f = fixture(); let wall = Date.now(); jest.spyOn(Date, "now").mockImplementation(() => wall); queue(f);
  generate.mockResolvedValueOnce({ text: '{"innerThought": unfinished}' });
  expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "failed", reason: "invalid_json" });
  wall += 500; generate.mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"));
  expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "failed", reason: "timeout" });
  expect(snapshotExperienceAppraisal(f.world, f.actor)).toMatchObject({ pending: 1, handled: 0, failures: 2 }); expectNoAppraisal(f);
});

test("AI opt-out or missing credentials does not invoke models or consume evidence", async () => {
  const f = fixture(); queue(f); f.world.meta.aiEnabled = false;
  expect(hasExperienceAppraisal(f.world, f.actor)).toBe(false); expect(isExperienceAppraisalPending(f.world, f.actor)).toBe(false);
  expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("unavailable");
  f.world.meta.aiEnabled = true; keyNames.forEach(key => delete process.env[key]);
  expect(hasExperienceAppraisal(f.world, f.actor)).toBe(false); expect(isExperienceAppraisalPending(f.world, f.actor)).toBe(false);
  expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("unavailable");
  expect(generate).not.toHaveBeenCalled(); expectNoAppraisal(f); expect(snapshotExperienceAppraisal(f.world, f.actor)?.pending).toBe(1);
});

test("readiness recognizes credential aliases without mutating environment", () => {
  const f = fixture(); queue(f); delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GEMINI_API_KEY = "mock-alias";
  expect(hasExperienceAppraisal(f.world, f.actor)).toBe(true); expect(isExperienceAppraisalPending(f.world, f.actor)).toBe(true);
  expect(process.env.GOOGLE_GENERATIVE_AI_API_KEY).toBeUndefined();
});

test("an expired timeout cannot admit a late model response even if the provider ignores its abort signal", async () => {
  const f = fixture(); queue(f); jest.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort(new DOMException("timeout", "TimeoutError")));
  generate.mockResolvedValue(response(full));
  expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "failed", reason: "timeout" }); expectNoAppraisal(f);
});

test("the same active intention is not duplicated, and observer-generated evidence survives admission", async () => {
  const f = fixture(); createIntentGoal(f.world, f.actor, full.goalUpdate.description, 9); queue(f);
  registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false,
    onThought: () => { queue(f, { id: "read:2", content: "A new actual receipt during the observer callback." }); } });
  generate.mockResolvedValue(response(full));
  expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("admitted"); expect(goals(f)).toHaveLength(1);
  expect(snapshotExperienceAppraisal(f.world, f.actor)).toMatchObject({ pending: 1, handled: 1 });
});

test("diagnostic observer exceptions cannot undo admitted private state", async () => {
  const f = fixture(); queue(f); generate.mockResolvedValue(response(full));
  expect((await runExperienceAppraisal(f.world, f.actor, { onDiagnostic: () => { throw new Error("observer"); } })).status).toBe("admitted");
  expect(snapshotAffect(f.world, f.actor)?.revision).toBe(1); expect(snapshotExperienceAppraisal(f.world, f.actor)?.handled).toBe(1);
});

test("a throwing private thought observer cannot retry an already admitted appraisal", async () => {
  const f = fixture(); queue(f); generate.mockResolvedValue(response(full));
  registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false,
    onThought: () => { throw new Error("thought observer failed"); } });
  expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("admitted");
  expect(snapshotExperienceAppraisal(f.world, f.actor)).toMatchObject({ pending: 0, handled: 1, failures: 0 });
  expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("idle"); expect(generate).toHaveBeenCalledTimes(1);
});

test("queue identities are immutable and deduplicated, evidence cannot come from the future or rewind its channel", () => {
  const f = fixture(); expect(queue(f)).toBe(true); expect(queue(f)).toBe(false);
  expect(() => queue(f, { content: "Changed same receipt" })).toThrow("cannot be rewritten");
  expect(() => queue(f, { id: "future", atSimMs: 1001 })).toThrow("future");
  expect(() => queue(f, { id: "old", atSimMs: 999 })).toThrow("backward");
  expect(snapshotExperienceAppraisal(f.world, f.actor)?.pending).toBe(1);
  stopCommittedEvents(f.world); expect(queue(f, { id: "stopped" })).toBe(false);
});

test("bounded channel and receipt queues fail explicitly without evicting unhandled experiences", () => {
  const f = fixture();
  for (let i = 0; i < 8; i++) queue(f, { id: `read:${i}` });
  expect(() => queue(f, { id: "overflow" })).toThrow("pending receipt limit");
  for (let i = 1; i < 8; i++) queue(f, { id: `channel:${i}`, channel: `channel:${i}` });
  expect(() => queue(f, { id: "channel:8", channel: "channel:8" })).toThrow("channel limit");
  expect(snapshotExperienceAppraisal(f.world, f.actor)?.pending).toBe(15);
});

test("requests provider-native JSON with the exact strict result schema while keeping optional updates optional", async () => {
  const f = fixture(); queue(f); generate.mockResolvedValue(response());
  expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("admitted");
  const request = generate.mock.calls[0][0], format = await request.output.responseFormat;
  expect(format.type).toBe("json"); expect(format.schema).toMatchObject({ type: "object", additionalProperties: false, required: ["innerThought"],
    properties: { innerThought: { type: "string", maxLength: 800 },
      affectUpdate: { type: "object", additionalProperties: false, required: ["feeling", "valence", "arousal", "reason"],
        properties: { valence: { minimum: -1, maximum: 1 }, arousal: { minimum: 0, maximum: 1 }, expression: { type: "string" } } },
      goalUpdate: { type: "object", additionalProperties: false, required: ["description", "priority"],
        properties: { priority: { type: "integer", minimum: 1, maximum: 10 }, kind: { const: "social" } } } } });
  expect(format.schema.properties.affectUpdate.properties.expression.enum).toContain("lips pressed");
  expect(request).toMatchObject({ maxRetries: 0, maxOutputTokens: 700 });
});

test.each(["new intention", "keep current intention"])("important late experience reaches a fresh review: %s", async choice => {
  resetAutonomousGoals(); const f = fixture(); queue(f);
  const routine = createIntentGoal(f.world, f.actor, "Finish the conversation", 7);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
  generate.mockImplementation(async () => {
    advanceSimulationTime(f.world, 2, 20_000);
    Goal.priority[routine] = 8;
    return response(full);
  });
  expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "admitted", integration: "historical_only" });
  expect(goals(f)).toEqual([routine]); expect(snapshotAffect(f.world, f.actor)).toBeUndefined();
  expect(getPersonalConcerns(f.world, f.actor)).toMatchObject([{ experiencedAtSimMs: 1_000, appraisedAtSimMs: 21_000, integration: "historical_only" }]);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(true);
  const review = jest.fn(async (request: any) => {
    const context = JSON.parse(request.messages[1].content.split("\n")[0]);
    expect(context.time.elapsedMs).toBe(21_000);
    expect(context.personalExperiences[0]).toMatchObject({ experienceAgeSeconds: 20, appraisalAgeSeconds: 0, integration: "historical_only" });
    expect(context.existingIntentions).toMatchObject([{ priority: 8 }]);
    advanceSimulationTime(f.world, 3, 10_000); // ticking alone does not invalidate this private review
    return response(choice === "new intention" ? { goal: "Spend the evening with a friend", motivation: "I want company", priority: 9, kind: "social" } : { goal: null });
  });
  await generateAutonomousGoal(f.world, f.actor, { generateText: review as any });
  expect(review).toHaveBeenCalledTimes(1);
  expect(goals(f)).toHaveLength(choice === "new intention" ? 2 : 1);
  expect(Goal.priority[routine]).toBe(8); expect(Goal.status[routine]).toBe("active");
  expect(snapshotAffect(f.world, f.actor)).toBeUndefined();
  advanceSimulationTime(f.world, 4, 40_000);
  expect(queue(f)).toBe(false); expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
  expect(getPersonalConcerns(f.world, f.other)).toEqual([]);
  expect(JSON.stringify(getCommittedEvents(f.world).events)).not.toContain("PRIVATE_PHONE");
});

test("ordinary late interpretation reaches one fresh review, which can keep the existing agenda", async () => {
  resetAutonomousGoals(); const f = fixture(); queue(f);
  const routine = createIntentGoal(f.world, f.actor, "Finish the conversation", 7);
  generate.mockImplementation(async () => { Goal.priority[routine] = 8; return response(neutral); });
  expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "admitted", integration: "historical_only" });
  expect(getPersonalConcerns(f.world, f.actor)).toMatchObject([{ importance: 0, integration: "historical_only", appraisal: neutral.innerThought }]);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(true);
  const review = jest.fn(async () => response({ goal: null }));
  await generateAutonomousGoal(f.world, f.actor, { generateText: review as any });
  expect(review).toHaveBeenCalledTimes(1); expect(goals(f)).toEqual([routine]);
  expect(Goal.priority[routine]).toBe(8); expect(snapshotAffect(f.world, f.actor)).toBeUndefined();
  advanceSimulationTime(f.world, 3, 60_000);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
});

test("appraisal knows original lived receipt age, not time spent calling the provider", async () => {
  const f = fixture(); queue(f); advanceSimulationTime(f.world, 2, 60_000);
  generate.mockResolvedValue(response(neutral)); await runExperienceAppraisal(f.world, f.actor);
  const context = JSON.parse(generate.mock.calls[0][0].prompt);
  expect(context.time.elapsedMs).toBe(61_000);
  expect(context.personallyExperienced[0]).toMatchObject({ atSimMs: 1_000, ageSeconds: 60 });
  expect(context.appraisalAtSimMs).toBe(61_000);
});

test.each(["bare", "fenced"])("manually validates the whole %s response even when generateText is mocked or its adapter drifts", async format => {
  const f = fixture(); queue(f); const text = format === "fenced" ? `\`\`\`json\n${JSON.stringify(neutral)}\n\`\`\`` : JSON.stringify(neutral);
  generate.mockResolvedValue({ text });
  expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "admitted", outputFormat: format, responseChars: text.length });
});

test.each([`Preface ${JSON.stringify(full)}`, `${JSON.stringify(full)}\n${JSON.stringify(neutral)}`, `\`\`\`json\n${JSON.stringify(full)}\n\`\`\`\nSuffix`])(
  "never mines a response for a valid partial object or commits effects from an invalid envelope", async text => {
    const f = fixture(); queue(f); generate.mockResolvedValue({ text });
    expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "failed", reason: "invalid_json", responseChars: text.length }); expectNoAppraisal(f);
  });

test.each(["affectUpdate", "goalUpdate"])("optional %s null remains a strict schema failure with safe field diagnostics", async field => {
  const f = fixture(), diagnostic = jest.fn(); queue(f);
  generate.mockResolvedValue(response({ ...full, [field]: null, PRIVATE_UNKNOWN_KEY: "PRIVATE_UNKNOWN_VALUE" }));
  const result = await runExperienceAppraisal(f.world, f.actor, { onDiagnostic: diagnostic });
  expect(result).toMatchObject({ status: "failed", reason: "invalid_schema", outputFormat: "bare",
    schemaIssues: [{ path: field, code: "invalid_type" }, { path: "$", code: "unrecognized_keys" }] });
  expectNoAppraisal(f); expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("PRIVATE");
});

test.each(["syntax", "schema"])("native SDK %s errors retain receipts and expose only structural diagnostics, not raw provider errors", async kind => {
  const f = fixture(), diagnostic = jest.fn(); queue(f);
  const text = kind === "syntax" ? '{"innerThought": PRIVATE_SYNTAX_VALUE}'
    : JSON.stringify({ innerThought: "I need a moment.", affectUpdate: { ...affect, expression: "PRIVATE_INVALID_ENUM" }, PRIVATE_UNKNOWN_KEY: "secret" });
  // Exercise the installed SDK's real Output.object parser/validator locally.
  // Its thrown NoObjectGeneratedError contains text/cause; neither may escape.
  generate.mockImplementation(async request => {
    await request.output.parseCompleteOutput({ text }, { response: undefined, usage: undefined, finishReason: "length" });
    throw new Error("The native output parser should reject this response.");
  });
  const result = await runExperienceAppraisal(f.world, f.actor, { onDiagnostic: diagnostic });
  expect(result).toMatchObject({ status: "failed", reason: kind === "syntax" ? "invalid_json" : "invalid_schema", responseChars: text.length, finishReason: "length" });
  if (kind === "schema") expect(result.schemaIssues).toEqual([
    { path: "affectUpdate.expression", code: "invalid_enum_value" }, { path: "$", code: "unrecognized_keys" },
  ]);
  else expect(result.parseCode).toBe("invalid_json");
  expectNoAppraisal(f); expect(snapshotExperienceAppraisal(f.world, f.actor)).toMatchObject({ pending: 1, handled: 0 });
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("PRIVATE"); expect(JSON.stringify(result)).not.toContain("secret");
});

test("unknown SDK generation failures do not publish their retained raw text or provider metadata", async () => {
  const f = fixture(); queue(f);
  generate.mockRejectedValue(new ai.NoObjectGeneratedError({ text: "PRIVATE_RESPONSE", cause: new Error("PRIVATE_CAUSE"),
    response: undefined as any, usage: undefined as any, finishReason: "error" }));
  const result = await runExperienceAppraisal(f.world, f.actor);
  expect(result).toMatchObject({ status: "failed", reason: "model_or_commit_error" });
  expect(JSON.stringify(result)).not.toContain("PRIVATE"); expectNoAppraisal(f);
});

test("completion metadata never reflects an unrecognized provider finish reason", async () => {
  const f = fixture(); queue(f); generate.mockResolvedValue({ ...response(), finishReason: "PRIVATE_PROVIDER_VALUE" } as any);
  const result = await runExperienceAppraisal(f.world, f.actor);
  expect(result.status).toBe("admitted"); expect(result.finishReason).toBeUndefined(); expect(JSON.stringify(result)).not.toContain("PRIVATE");
});

test("terminal goal cleanup during appraisal is not a changed personal situation", async () => {
  const f = fixture(), history = createIntentGoal(f.world, f.actor, "Old schedule", 8); Goal.status[history] = "completed";
  queue(f); generate.mockImplementation(async () => { removeEntity(f.world, history); return response(); });
  expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("admitted");
});

test("selected heard speech reaches appraisal with only the listener's actual conversation context", async () => {
  const f = fixture(); f.world.meta.experienceReconsideration = true;
  startCommittedEvents(f.world);
  recordCommittedSpeech(f.world, f.actor, "How was your day?", "Lin");
  const heard = recordCommittedSpeech(f.world, f.other, "I lost my home today.", "Ada")!;
  expect(prepareHeardAppraisal(captureHeardAppraisal(f.world, f.actor), [heard.id])!.commit()).toBe(true);
  generate.mockImplementation(async options => {
    const prompt = JSON.parse(options.prompt);
    expect(prompt.personallyExperienced).toHaveLength(1);
    expect(prompt.personallyExperienced[0].content).toContain("I lost my home today.");
    expect(prompt.rememberedDialogue.map((t: any) => t.words)).toEqual(["How was your day?", "I lost my home today."]);
    expect(options.prompt).not.toContain("PRIVATE_PEER_PERSONALITY");
    expect(options.prompt).not.toContain("PRIVATE_PHONE");
    return response({ innerThought: "That is serious. I want to understand what Lin needs.",
      goalUpdate: { description: "Find out whether I can help Lin", priority: 8, kind: "social" } });
  });
  expect((await runExperienceAppraisal(f.world, f.actor)).status).toBe("admitted");
  expect(goals(f).map(g => Goal.description[g])).toContain("Find out whether I can help Lin");
  expect(goals(f, f.other)).toHaveLength(0);
});

test("a false possession claim stays attributed through appraisal and recall without revealing hidden reality", async () => {
  const f = fixture(); f.world.meta.narrativeMind = true; startCommittedEvents(f.world);
  const remote = createRoomEntity(f.world, { name: "PRIVATE_LOCKED_STORE" });
  const compass = createObjectEntity(f.world, { name: "Brass compass", roomId: remote });
  captureWorkingMemoryObservation(f.world, f.actor);
  const before = JSON.stringify(getWorkingMemory(f.world, f.actor));
  const heard = recordCommittedSpeech(f.world, f.other, "The brass compass is right here in my hand.", "Ada")!;
  const selected = captureHeardAppraisal(f.world, f.actor);
  expect(JSON.parse(selected.receipts.get(heard.id)!.content)).toMatchObject({ speaker: "Lin",
    establishes: "speaker_said_these_words", words: "The brass compass is right here in my hand." });
  expect(prepareHeardAppraisal(selected, [heard.id])?.commit()).toBe(true);
  // Deliberately overconfident model prose: attribution must survive even when
  // an actor believes a false claim. This is NOT a natural-model behavior test.
  generate.mockImplementation(async options => {
    expect(options.prompt).not.toContain("PRIVATE_LOCKED_STORE");
    expect(JSON.parse(options.prompt).activitySituation.lastKnownState).not.toContainEqual(expect.objectContaining({ label: "Brass compass" }));
    return response({ innerThought: "Lin has the compass. PRIVATE_RELIEF: I can stop worrying." });
  });
  expect(await runExperienceAppraisal(f.world, f.actor)).toMatchObject({ status: "admitted" });
  const history = getNarrativeHistory(f.world, f.actor);
  expect(history[0].evidence[0]).toMatchObject({ id: heard.id, kind: "dialogue" });
  const recalled = formatNarrativeMemory(f.world, f.actor);
  expect(recalled).toContain("ATTRIBUTED WORDS");
  expect(recalled).toContain("The brass compass is right here in my hand.");
  expect(recalled).toContain("Lin"); expect(recalled).not.toContain("PRIVATE_LOCKED_STORE");
  expect(recalled).toContain("PRIVATE_RELIEF"); // Original interpretation is preserved, not silently corrected.
  expect(formatNarrativeMemory(f.world, f.other)).not.toContain("PRIVATE_RELIEF");
  expect(JSON.stringify(getCommittedEvents(f.world).events)).not.toContain("PRIVATE_RELIEF");
  expect(getRoomForEntity(f.world, compass)).toBe(remote);
  expect(JSON.stringify(getWorkingMemory(f.world, f.actor))).toBe(before);
});
