import { jest } from "@jest/globals";

const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { getRelationTargets } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { Goal, Plan, WorkingMemoryIdentity } = await import("../../ecs/components");
const { HasGoal } = await import("../../ecs/relations");
const { createIntentGoal } = await import("../cognition-system");
const { createPlanEntity, generatePlanForGoal, getNextPlannedAction, getPlanForGoal, runPlanningSystem } = await import("../planning-system");
const { generateAutonomousGoal, resetAutonomousGoals } = await import("../autonomous-goals");
const { generateReflection } = await import("../reflection-system");
const { addMemory } = await import("../knowledge-graph");
const { agentThink, getAgentThoughts } = await import("../agent-mind");
const { consumeForegroundAction, isDiscardedForegroundDecision } = await import("../foreground-action-admission");
const { recordCommittedSpeech, getSocialDialogue } = await import("../social-memory");
const { recordPrivateCommunication } = await import("../communication-memory");
const { startCommittedEvents } = await import("../../runtime/committed-events");
const { applyCoordinationReviews, captureCoordinationWork, getCoordinationMemory, getCoordinationGoalRef } = await import("../coordination-memory");
const { coordinationDependency } = await import("../coordination-memory-dependencies");
const { recordWorkingMemoryEvidence } = await import("../working-memory");
const { recordCognitionOutcome, getForegroundCognitionReadiness } = await import("../idle-cognition");
import type { GeneratedPlan } from "../planning-system";

function fixture() {
  const world = createArgosWorld("Coordination consumers"); world.meta.aiEnabled = true; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Common Room" });
  const remote = createRoomEntity(world, { name: "Observatory" });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "Curious.", roomId: room });
  const ivo = createAgentEntity(world, { name: "Ivo", role: "caretaker", systemPrompt: "PRIVATE_IVO_PROMPT", roomId: room });
  const goal = createIntentGoal(world, actor, "Deliver the sealed map", 5);
  const speak = (content: string) => {
    recordCommittedSpeech(world, actor, content, "Ivo");
    return getSocialDialogue(world, actor).filter(turn => turn.own).at(-1)!.id;
  };
  const promise = (linked = true) => {
    const id = speak("I will deliver the sealed map.");
    expect(applyCoordinationReviews(world, actor, [{ kind: "undertake", speechId: id, task: "Deliver the sealed map", ...(linked ? { goalId: goal, goalRelation: "fulfills" } : {}) }])).toBe(1);
    return id;
  };
  const release = (id: string) => applyCoordinationReviews(world, actor, [{ kind: "release", id, reason: "I have withdrawn this undertaking." }]);
  return { world, room, remote, actor, ivo, goal, speak, promise, release };
}
const physical: GeneratedPlan = { goalDescription: "Deliver the sealed map", estimatedCompletion: "short", potentialObstacles: [],
  steps: [{ description: "Go to the Observatory.", actionType: "move", target: "Observatory" }] };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let oldKey: string | undefined;
beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset(); resetAutonomousGoals();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No paid cognition calls"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey;
});

test.each(["foreground", "planning", "goals", "reflection"])("%s sees its sourced undertaking before older recollections", async lane => {
  const f = fixture(); const id = f.promise(); f.release(id);
  addMemory(f.world, f.actor, { content: "OLD_RECOLLECTION: I should deliver the map.", type: "episodic", importance: .8, timestamp: Date.now() - 10_000, emotionalValence: 0 });
  if (lane === "foreground") {
    generate.mockResolvedValue({ text: '{"action":{"type":"wait"},"innerThought":"I need to let Ivo know I withdrew."}' }); await agentThink(f.world, f.actor);
  } else if (lane === "planning") {
    generate.mockResolvedValue({ text: JSON.stringify(physical) }); await generatePlanForGoal(f.world, f.actor, f.goal);
  } else if (lane === "goals") {
    generate.mockResolvedValue({ text: '{"goal":null}' }); await generateAutonomousGoal(f.world, f.actor);
  } else {
    generate.mockResolvedValue({ text: '{"insights":[],"questionsRaised":[],"emotionalSummary":""}' }); await generateReflection(f.world, f.actor);
  }
  const request = generate.mock.calls[0][0];
  const context = [request.system || "", ...(request.messages?.map((message: any) => message.content) || [])].join("\n");
  expect(context).toContain(id); expect(context).toContain("released");
  expect(context.indexOf(id)).toBeLessThan(context.indexOf("OLD_RECOLLECTION"));
  expect(context).not.toContain("PRIVATE_IVO_PROMPT");
});

test("foreground cognition can review a sent private promise without broadcasting it", async () => {
  const f = fixture();
  const receipt = recordPrivateCommunication(f.world, f.actor, { sourceId: startCommittedEvents(f.world),
    messageKey: "private-map-promise", channel: "personal-phone", kind: "sent", other: "Alex",
    content: "I will deliver the sealed map.", sentAtSimMs: 0 })!;
  generate.mockResolvedValue({ text: JSON.stringify({ action: { type: "wait" }, innerThought: "I said I would bring it.",
    coordinationReviews: [{ kind: "undertake", speechId: receipt.id, task: "Deliver the sealed map", goalId: f.goal }] }) });
  const action = await agentThink(f.world, f.actor);
  expect(getCoordinationMemory(f.world, f.actor).items).toEqual([]);
  expect(consumeForegroundAction(f.world, f.actor, action)).toMatchObject({ admitted: true });
  expect(getCoordinationMemory(f.world, f.actor).items[0]).toMatchObject({ id: receipt.id, localStatus: "not_started" });
  expect(getCoordinationMemory(f.world, f.ivo).items).toEqual([]);
  expect(getSocialDialogue(f.world, f.ivo)).toEqual([]);
});

test("a reviewed prior undertaking links the actual newly admitted goal", async () => {
  const f = fixture(); const id = f.speak("I will inspect the Observatory roof.");
  generate.mockResolvedValue({ text: JSON.stringify({ action: { type: "wait" }, innerThought: "I can make that my next task.",
    goalUpdate: { description: "Inspect the Observatory roof", priority: 6, kind: "custom" },
    coordinationReviews: [{ kind: "undertake", speechId: id, task: "Inspect the Observatory roof", goalId: "new" }] }) });
  const action = await agentThink(f.world, f.actor);
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toEqual([f.goal]);
  expect(getCoordinationMemory(f.world, f.actor).items).toHaveLength(0);
  expect(consumeForegroundAction(f.world, f.actor, action)).toMatchObject({ admitted: true });
  const goals = getRelationTargets(f.world, f.actor, HasGoal);
  const admitted = goals.find(goal => Goal.description[goal] === "Inspect the Observatory roof");
  expect(admitted).toBeDefined();
  expect(getCoordinationMemory(f.world, f.actor).items.find(item => item.id === id)?.goal).toEqual(getCoordinationGoalRef(f.world, f.actor, admitted!));
  expect(getCoordinationMemory(f.world, f.actor).items.find(item => item.id === id)?.goal).not.toEqual(getCoordinationGoalRef(f.world, f.actor, f.goal));
});

test("an unexecuted speech action cannot supply its own undertaking evidence", async () => {
  const f = fixture();
  generate.mockResolvedValue({ text: JSON.stringify({ action: { type: "speak", target: "Ivo", content: "I will deliver the map." },
    coordinationReviews: [{ kind: "undertake", speechId: "unexecuted-choice", task: "Deliver the map", goalId: f.goal }] }) });
  expect(await agentThink(f.world, f.actor)).toMatchObject({ type: "speak" });
  expect(getCoordinationMemory(f.world, f.actor).items).toHaveLength(0);
});

test("speech committed after a request began cannot be borrowed by that older review", async () => {
  const f = fixture(); const pending = deferred<{ text: string }>(); generate.mockImplementation(() => pending.promise);
  const thinking = agentThink(f.world, f.actor);
  const id = f.speak("I will check the Observatory roof.");
  pending.resolve({ text: JSON.stringify({ action: { type: "move", target: "Observatory" },
    coordinationReviews: [{ kind: "undertake", speechId: id, task: "Inspect the roof" }] }) });
  await thinking;
  expect(getCoordinationMemory(f.world, f.actor).items).toHaveLength(0);
});

test("a changed undertaking rejects a held thought and review before either mutates state", async () => {
  const f = fixture(); const id = f.promise(); const pending = deferred<{ text: string }>(); generate.mockImplementation(() => pending.promise);
  const thinking = agentThink(f.world, f.actor); expect(generate).toHaveBeenCalledTimes(1);
  f.release(id);
  pending.resolve({ text: JSON.stringify({ action: { type: "wait" }, innerThought: "I am still handling the map.",
    goalUpdate: { description: "Make another map delivery", priority: 6, kind: "custom" },
    coordinationReviews: [{ kind: "link", id, goalId: "new" }] }) });
  expect(isDiscardedForegroundDecision(await thinking)).toBe(true);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toEqual([f.goal]);
  expect(getCoordinationMemory(f.world, f.actor).items[0].localStatus).toBe("released");
});

test("unrelated coordination changes do not starve an independent physical decision", async () => {
  const f = fixture(); const id = f.promise(false);
  Goal.description[f.goal] = "Inspect the Observatory roof";
  const pending = deferred<{ text: string }>(); generate.mockImplementation(() => pending.promise);
  const thinking = agentThink(f.world, f.actor); f.release(id);
  pending.resolve({ text: '{"action":{"type":"move","target":"Observatory"},"innerThought":"I should inspect the roof."}' });
  const action = await thinking;
  expect(action).toMatchObject({ type: "move", target: "Observatory" });
  expect(consumeForegroundAction(f.world, f.actor, action)).toMatchObject({ admitted: true, mentalUpdateOmitted: true });
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test.each([true, false])("queued physical work invalidation follows its linked goal (linked=%s)", linked => {
  const f = fixture(); const id = f.promise(linked);
  if (!linked) Goal.description[f.goal] = "Inspect the Observatory roof";
  const plan = createPlanEntity(f.world, f.actor, f.goal, physical);
  f.release(id);
  const next = getNextPlannedAction(f.world, f.actor);
  expect(next?.actionType || null).toBe(linked ? null : "move");
  expect(Plan.status[plan]).toBe(linked ? "failed" : "active");
});

test.each([true, false])("in-flight physical plan admission follows its linked goal (linked=%s)", async linked => {
  const f = fixture(); const id = f.promise(linked);
  if (!linked) Goal.description[f.goal] = "Inspect the Observatory roof";
  const pending = deferred<GeneratedPlan>();
  const planning = runPlanningSystem(f.world, { agentEids: [f.actor], planGenerator: () => pending.promise });
  f.release(id); pending.resolve(physical); await planning;
  expect(getPlanForGoal(f.world, f.actor, f.goal) !== undefined).toBe(!linked);
});

test("expected not-started to in-progress transition keeps physical steps, but updates social interpretation", () => {
  const f = fixture(); f.promise(); const before = getCoordinationMemory(f.world, f.actor);
  const after = structuredClone(before); after.items[0].localStatus = "in_progress"; after.revision++;
  const scope = { goalRefs: [getCoordinationGoalRef(f.world, f.actor, f.goal)] };
  expect(coordinationDependency(before, scope)).toBe(coordinationDependency(after, scope));
  expect(coordinationDependency(before, { ...scope, all: true })).not.toBe(coordinationDependency(after, { ...scope, all: true }));
  after.items[0].localStatus = "blocked";
  expect(coordinationDependency(before, scope)).not.toBe(coordinationDependency(after, scope));
});

test("quiet cognition wakes once for an actual coordination change, not an identical review", () => {
  const f = fixture(); const id = f.promise();
  recordCognitionOutcome(f.world, f.actor, { type: "wait" }, { succeeded: true, pending: false, now: 100 });
  f.release(id);
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 101 }).reason).toBe("state_changed");
  recordCognitionOutcome(f.world, f.actor, { type: "wait" }, { succeeded: true, pending: false, now: 101 });
  f.release(id);
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 102 }).reason).toBe("quiet");
});

test("a held autonomous goal cannot revive an undertaking withdrawn during its request", async () => {
  const f = fixture(); const id = f.promise(); const pending = deferred<{ text: string }>(); generate.mockImplementation(() => pending.promise);
  const choosing = generateAutonomousGoal(f.world, f.actor); f.release(id);
  pending.resolve({ text: '{"goal":{"description":"Deliver the sealed map now","priority":6,"kind":"custom","motivation":"I undertook it."}}' });
  expect(await choosing).toBeNull(); expect(getRelationTargets(f.world, f.actor, HasGoal)).toEqual([f.goal]);
});

test("stale social reflection is filtered while unrelated self reflection remains", async () => {
  const f = fixture(); const id = f.promise();
  addMemory(f.world, f.actor, { type: "episodic", content: "I offered to deliver the sealed map.", importance: .8, timestamp: Date.now(), emotionalValence: 0 });
  const rain = addMemory(f.world, f.actor, { type: "episodic", content: "Rain was calming.", importance: .4, timestamp: Date.now() - 1_000, emotionalValence: .2 });
  const pending = deferred<{ text: string }>(); generate.mockImplementation(() => pending.promise);
  const reflecting = generateReflection(f.world, f.actor); f.release(id);
  pending.resolve({ text: JSON.stringify({ insights: [
    { insight: "I am still handling our delivery.", importance: 5, relatedMemories: ["I offered to deliver the map."], category: "social" },
    { insight: "I enjoy the quiet rain.", importance: 3, relatedMemories: ["Rain was calming."], category: "self",
      temporalScope: "historical", sourceIds: [`memory:${rain}`] },
  ], questionsRaised: [], emotionalSummary: "Calm" }) });
  expect((await reflecting)?.insights.map(insight => insight.insight)).toEqual(["I enjoy the quiet rain."]);
});

test.each([true, false])("a blocker review follows its cited receipt subjects, not just its prose (corrected=%s)", async corrected => {
  const f = fixture(); const id = f.promise(); const atMs = Date.now();
  const remember = (receiptId: string, subject: string, value: string, offset: number) => recordWorkingMemoryEvidence(f.world, f.actor, {
    id: receiptId, atMs: atMs + offset, kind: "observation", provenance: "visible_observation", summary: `Observed ${subject}: ${value}`,
    facts: [{ subject, subjectLabel: subject === "observed:cupboard" ? "Supply cupboard" : "Window", predicate: "state", slot: "Container.contents", value }],
  });
  expect(remember("receipt:empty-cupboard", "observed:cupboard", "empty", 1)).toBe(true);
  const pending = deferred<{ text: string }>(); generate.mockImplementation(() => pending.promise);
  const thinking = agentThink(f.world, f.actor);
  expect(remember("receipt:fresh-look", corrected ? "observed:cupboard" : "observed:window", corrected ? "map available" : "open", 2)).toBe(true);
  pending.resolve({ text: JSON.stringify({ action: { type: "wait" }, innerThought: "I need another approach.",
    coordinationReviews: [{ kind: "blocked", id, reason: "The required item was absent.", evidenceIds: ["receipt:empty-cupboard"] }] }) });
  const action = await thinking;
  expect(consumeForegroundAction(f.world, f.actor, action).admitted).toBe(!corrected);
  expect(getCoordinationMemory(f.world, f.actor).items[0].localStatus).toBe(corrected ? "not_started" : "blocked");
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(corrected ? 0 : 1);
});

test("a blocker review cannot borrow physical evidence first received after its request began", async () => {
  const f = fixture(); const id = f.promise();
  const pending = deferred<{ text: string }>(); generate.mockImplementation(() => pending.promise);
  const thinking = agentThink(f.world, f.actor);
  expect(recordWorkingMemoryEvidence(f.world, f.actor, {
    id: "receipt:future-source", atMs: Date.now() + 1, kind: "observation", provenance: "visible_observation", summary: "The Supply cupboard is empty.",
    facts: [{ subject: "observed:cupboard", subjectLabel: "Supply cupboard", predicate: "state", slot: "Container.contents", value: "empty" }],
  })).toBe(true);
  pending.resolve({ text: JSON.stringify({ action: { type: "wait" }, innerThought: "I need another approach.",
    coordinationReviews: [{ kind: "blocked", id, reason: "The required item was absent.", evidenceIds: ["receipt:future-source"] }] }) });
  await thinking;
  expect(getCoordinationMemory(f.world, f.actor).items[0].localStatus).toBe("not_started");
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test("a foreground physical action can explicitly bind its own listed intention without claiming progress", async () => {
  const f = fixture(); const id = f.promise();
  generate.mockResolvedValue({ text: JSON.stringify({ action: { type: "move", target: "Observatory", goalId: f.goal }, innerThought: "I will take this next step." }) });
  const action = await agentThink(f.world, f.actor);
  expect(action.coordinationGoal).toEqual(getCoordinationGoalRef(f.world, f.actor, f.goal));
  expect(Object.isFrozen(action.coordinationGoal)).toBe(true);
  expect(getCoordinationMemory(f.world, f.actor).items.find(item => item.id === id)?.localStatus).toBe("not_started");
  expect(Goal.status[f.goal]).toBe("active");
});

test("the same decision can admit a new intention, link an earlier undertaking, and bind its next physical action", async () => {
  const f = fixture(); const id = f.speak("I will inspect the Observatory roof.");
  generate.mockResolvedValue({ text: JSON.stringify({ action: { type: "move", target: "Observatory", goalId: "new" },
    goalUpdate: { description: "Inspect the Observatory roof", priority: 6, kind: "custom" },
    coordinationReviews: [{ kind: "undertake", speechId: id, task: "Inspect the Observatory roof", goalId: "new" }] }) });
  const action = await agentThink(f.world, f.actor);
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toEqual([f.goal]);
  expect(getCoordinationMemory(f.world, f.actor).items).toHaveLength(0);
  expect(consumeForegroundAction(f.world, f.actor, action)).toMatchObject({ admitted: true });
  const newGoal = getRelationTargets(f.world, f.actor, HasGoal).find(goal => Goal.description[goal] === "Inspect the Observatory roof")!;
  expect(newGoal).toBeDefined();
  expect(action.coordinationGoal).toEqual(getCoordinationGoalRef(f.world, f.actor, newGoal));
  expect(getCoordinationMemory(f.world, f.actor).items.find(item => item.id === id)?.goal).toEqual(action.coordinationGoal);
  expect(action.coordinationGoal).not.toEqual(getCoordinationGoalRef(f.world, f.actor, f.goal));
});

test("model-supplied internal coordination references are ignored without a goal hint", async () => {
  const f = fixture(); f.promise(); const raw = getCoordinationGoalRef(f.world, f.actor, f.goal);
  generate.mockResolvedValue({ text: JSON.stringify({ action: { type: "move", target: "Observatory", coordinationGoal: raw }, coordinationGoal: raw }) });
  const action = await agentThink(f.world, f.actor);
  expect(action).toMatchObject({ type: "move", target: "Observatory" });
  expect(action).not.toHaveProperty("coordinationGoal");
});

test.each(["foreign", "unlisted", "malformed"])("a %s goal hint cannot bind or execute under a fallback intention", async kind => {
  const f = fixture(); let goalId: unknown = f.goal;
  if (kind === "foreign") goalId = createIntentGoal(f.world, f.ivo, "Inspect the Observatory roof", 9);
  else if (kind === "unlisted") for (let i = 0; i < 6; i++) createIntentGoal(f.world, f.actor, `More urgent work ${i}`, 9);
  else goalId = { ownerKey: "forged", goalKey: "forged" };
  generate.mockResolvedValue({ text: JSON.stringify({ action: { type: "move", target: "Observatory", goalId }, innerThought: "I should do that work." }) });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test.each(["completed", "replaced episode"])("a goal %s during inference rejects its stale action before thoughts or reviews", async change => {
  const f = fixture(); const id = f.promise();
  const pending = deferred<{ text: string }>(); generate.mockImplementation(() => pending.promise);
  const thinking = agentThink(f.world, f.actor);
  if (change === "completed") Goal.status[f.goal] = "completed";
  else WorkingMemoryIdentity.id[f.goal] = "goal:replacement-with-same-numeric-id-contract-and-birth";
  pending.resolve({ text: JSON.stringify({ action: { type: "move", target: "Observatory", goalId: f.goal }, innerThought: "I will keep working on it.",
    coordinationReviews: [{ kind: "release", id, reason: "A stale decision's release must not be admitted." }] }) });
  expect(isDiscardedForegroundDecision(await thinking)).toBe(true);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  expect(getCoordinationMemory(f.world, f.actor).items.find(item => item.id === id)?.localStatus).toBe("not_started");
});

test("an action bound to a lower-priority listed intention follows its coordination changes", async () => {
  const f = fixture(); const id = f.promise(); createIntentGoal(f.world, f.actor, "Inspect the storm damage", 9);
  const pending = deferred<{ text: string }>(); generate.mockImplementation(() => pending.promise);
  const thinking = agentThink(f.world, f.actor); f.release(id);
  pending.resolve({ text: JSON.stringify({ action: { type: "move", target: "Observatory", goalId: f.goal }, innerThought: "I will take the next step." }) });
  expect(isDiscardedForegroundDecision(await thinking)).toBe(true);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test("a rejected new intention cannot silently bind an existing goal", async () => {
  const f = fixture();
  generate.mockResolvedValue({ text: JSON.stringify({ action: { type: "move", target: "Observatory", goalId: "new" }, innerThought: "I will start it.",
    goalUpdate: { description: "Deliver the sealed map", priority: 6, kind: "custom" } }) });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toEqual([f.goal]);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test("foreground selects one undertaking, not all promises supporting its goal", async () => {
  const f = fixture();
  const first = f.speak("I will check the chart."), second = f.speak("I will ask the caretaker about the route.");
  applyCoordinationReviews(f.world, f.actor, [
    { kind: "undertake", speechId: first, task: "Check the chart", goalId: f.goal },
    { kind: "undertake", speechId: second, task: "Ask the caretaker", goalId: f.goal },
  ]);
  generate.mockResolvedValue({ text: JSON.stringify({ action: { type: "move", target: "Observatory", goalId: f.goal, undertakingId: first } }) });
  const action = await agentThink(f.world, f.actor);
  expect(action.coordinationWork).toEqual(captureCoordinationWork(f.world, f.actor, first));
  expect(action.coordinationWork?.itemId).not.toBe(second);
  expect(Object.isFrozen(action.coordinationWork)).toBe(true);
});

test("a new undertaking grounded in prior speech can bind the same decision's action", async () => {
  const f = fixture(); const id = f.speak("I will inspect the Observatory roof.");
  generate.mockResolvedValue({ text: JSON.stringify({ action: { type: "move", target: "Observatory", undertakingId: id },
    coordinationReviews: [{ kind: "undertake", speechId: id, task: "Inspect the Observatory roof", goalId: f.goal }] }) });
  const action = await agentThink(f.world, f.actor);
  expect(captureCoordinationWork(f.world, f.actor, id)).toBeUndefined();
  expect(consumeForegroundAction(f.world, f.actor, action)).toMatchObject({ admitted: true });
  expect(action.coordinationWork).toEqual(captureCoordinationWork(f.world, f.actor, id));
  expect(action.coordinationWork).toBeDefined();
});

test.each(["unlisted", "foreign", "internal"])("a %s undertaking reference cannot forge work attribution", async kind => {
  const f = fixture(); const id = f.promise();
  let undertakingId: unknown = "invented";
  if (kind === "foreign") {
    const source = recordCommittedSpeech(f.world, f.ivo, "I will inspect the roof.")!;
    applyCoordinationReviews(f.world, f.ivo, [{ kind: "undertake", speechId: source.id, task: "Inspect the roof" }]);
    undertakingId = source.id;
  } else if (kind === "internal") undertakingId = captureCoordinationWork(f.world, f.actor, id);
  generate.mockResolvedValue({ text: JSON.stringify({ action: { type: "move", target: "Observatory", undertakingId } }) });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test("raw model-supplied internal work identity is stripped", async () => {
  const f = fixture(); const id = f.promise();
  generate.mockResolvedValue({ text: JSON.stringify({ action: { type: "move", target: "Observatory", coordinationWork: captureCoordinationWork(f.world, f.actor, id) } }) });
  expect(await agentThink(f.world, f.actor)).not.toHaveProperty("coordinationWork");
});

test("relinked work rejects a late physical decision before its thought is admitted", async () => {
  const f = fixture(); const id = f.promise(); const pending = deferred<{ text: string }>(); generate.mockImplementation(() => pending.promise);
  const thinking = agentThink(f.world, f.actor);
  const next = createIntentGoal(f.world, f.actor, "Inspect the Observatory roof", 7);
  applyCoordinationReviews(f.world, f.actor, [{ kind: "link", id, goalId: next }]);
  pending.resolve({ text: JSON.stringify({ action: { type: "move", target: "Observatory", undertakingId: id }, innerThought: "An old plan." }) });
  expect(isDiscardedForegroundDecision(await thinking)).toBe(true);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test("a sibling supporting promise changing does not discard an independent scoped action", async () => {
  const f = fixture(); const a = f.speak("I will check the chart."), b = f.speak("I will sweep the floor.");
  applyCoordinationReviews(f.world, f.actor, [
    { kind: "undertake", speechId: a, task: "Check the chart", goalId: f.goal },
    { kind: "undertake", speechId: b, task: "Sweep the floor", goalId: f.goal },
  ]);
  const pending = deferred<{ text: string }>(); generate.mockImplementation(() => pending.promise);
  const thinking = agentThink(f.world, f.actor); f.release(b);
  pending.resolve({ text: JSON.stringify({ action: { type: "move", target: "Observatory", goalId: f.goal, undertakingId: a } }) });
  expect(await thinking).toMatchObject({ type: "move", coordinationWork: { itemId: a } });
});
