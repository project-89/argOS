import { jest } from "@jest/globals";

const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { getRelationTargets } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { Goal, Plan } = await import("../../ecs/components");
const { HasGoal } = await import("../../ecs/relations");
const { createIntentGoal } = await import("../cognition-system");
const { createPlanEntity, formatPlansForContext, generatePlanForGoal, getNextPlannedAction, getPlanForGoal, runPlanningSystem } = await import("../planning-system");
const { advanceGoalTick, generateAutonomousGoal, resetAutonomousGoals, shouldGenerateGoal } = await import("../autonomous-goals");
const { generateReflection } = await import("../reflection-system");
const { addMemory } = await import("../knowledge-graph");
const { recordWorkingMemoryEvidence, getWorkingMemory } = await import("../working-memory");
const { formatCoordinationContext } = await import("../coordination-memory");
const { addThought, addPerception, agentThink, buildAgentContext, getAgentThoughts, getAgentConversation } = await import("../agent-mind");
const { consumeForegroundAction, isDiscardedForegroundDecision } = await import("../foreground-action-admission");
const { recordCognitionOutcome, getForegroundCognitionReadiness } = await import("../idle-cognition");
import type { GeneratedPlan } from "../planning-system";

function fixture() {
  const world = createArgosWorld("Working memory consumers");
  world.meta.aiEnabled = true;
  initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Common Room" });
  const remote = createRoomEntity(world, { name: "Utility Room" });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "Curious.", roomId: room });
  const ivo = createAgentEntity(world, { name: "Ivo", role: "caretaker", systemPrompt: "Quiet.", roomId: room });
  const goal = createIntentGoal(world, actor, "Repair the Reading lamp", 5);
  let event = 0;
  function remember(owner: string, subject = "Spare fuse", kind: "observation" | "action" = "observation") {
    const serial = ++event;
    expect(recordWorkingMemoryEvidence(world, actor, {
      id: `owned-evidence:${serial}`, atMs: Date.now() + serial,
      kind, provenance: kind === "action" ? "own_action" : "visible_observation",
      ...(kind === "action" ? { succeeded: true } : {}),
      summary: `${subject} is with ${owner}.`,
      facts: [{ subject: `observed:${subject}`, subjectLabel: subject, predicate: "possession", value: `owner:${owner}`, valueLabel: owner }],
    })).toBe(true);
  }
  return { world, room, remote, actor, ivo, goal, remember };
}

const askFuse: GeneratedPlan = {
  goalDescription: "Repair the Reading lamp", estimatedCompletion: "short", potentialObstacles: [],
  steps: [{ description: "Ask Ivo about the Spare fuse.", actionType: "speak", target: "Ivo", content: "Do you have the Spare fuse?" }],
};
test("assembled context includes action receipt prose once while retaining full review IDs and unique observations", () => {
  const f = fixture();
  const id = "action:12345678-1234-4234-8234-123456789abc";
  const summary = "UNIQUE_EXECUTION_RECEIPT: moved the parcel to the shelf.";
  recordWorkingMemoryEvidence(f.world, f.actor, { id, atMs: Date.now(), kind: "action", provenance: "own_action",
    succeeded: true, summary, facts: [] });
  f.remember("Ivo", "Separate observation");
  const before = getWorkingMemory(f.world, f.actor);
  const context = buildAgentContext(f.world, f.actor);
  expect(context.split(summary)).toHaveLength(2);
  expect(context).toContain(id);
  expect(context).toContain("Separate observation is with Ivo.");
  expect(formatCoordinationContext(f.world, f.actor)).toContain(summary);
  expect(getWorkingMemory(f.world, f.actor)).toEqual(before);
});
test("receipt consolidation preserves the union of action and observation windows", () => {
  const f = fixture();
  const atMs = Date.now();
  for (let i = 0; i < 9; i++) {
    recordWorkingMemoryEvidence(f.world, f.actor, {
      id: `window-action:${i}`, atMs: atMs + i, kind: "action", provenance: "own_action",
      succeeded: i !== 8, summary: `Distinct action result ${i}.`, facts: [],
    });
  }
  for (let i = 0; i < 7; i++) {
    recordWorkingMemoryEvidence(f.world, f.actor, {
      id: `window-observation:${i}`, atMs: atMs + 10 + i, kind: "observation", provenance: "visible_observation",
      summary: `Distinct observation result ${i}.`, facts: [],
    });
  }
  const context = buildAgentContext(f.world, f.actor);
  expect(context).not.toContain("Distinct action result 0.");
  for (let i = 1; i < 9; i++) expect(context.split(`Distinct action result ${i}.`)).toHaveLength(2);
  for (let i = 0; i < 7; i++) expect(context.split(`Distinct observation result ${i}.`)).toHaveLength(2);
  expect(context).toMatch(/window-action:8;[^\n]*failed/);
  expect(context).toContain("[window-action:8] See RECENT ACTION RECEIPTS above.");
  // The older action is still remembered despite falling outside the review window.
  expect(context).not.toContain("[window-action:1] See RECENT ACTION RECEIPTS above.");
});
const physical: GeneratedPlan = { ...askFuse, steps: [{ description: "Inspect the controls.", actionType: "move", target: "Utility Room" }] };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let oldKey: string | undefined;
beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset(); resetAutonomousGoals();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Working-memory tests must not make paid calls"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  jest.restoreAllMocks(); jest.useRealTimers();
  if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey;
});

test.each(["planning", "goals", "reflection", "foreground"])("%s receives recent physical evidence before older recollection", async consumer => {
  const f = fixture(); f.remember("Ivo"); f.remember("Mara", "Spare fuse", "action");
  addMemory(f.world, f.actor, { content: "OLD_RECOLLECTION: Ivo still has the fuse.", type: "episodic", importance: 0.8, timestamp: Date.now() - 30_000, emotionalValence: 0 });
  if (consumer === "planning") {
    generate.mockResolvedValue({ text: JSON.stringify(physical) });
    expect(await generatePlanForGoal(f.world, f.actor, f.goal)).not.toBeNull();
  } else if (consumer === "goals") {
    generate.mockResolvedValue({ text: '{"goal":null}' });
    await generateAutonomousGoal(f.world, f.actor);
  } else if (consumer === "foreground") {
    generate.mockResolvedValue({ text: '{"innerThought":"I can consider the evidence.","action":{"type":"wait"}}' });
    expect(await agentThink(f.world, f.actor)).toMatchObject({ type: "wait" });
  } else {
    generate.mockResolvedValue({ text: JSON.stringify({ insights: [], questionsRaised: [], emotionalSummary: "" }) });
    expect(await generateReflection(f.world, f.actor)).not.toBeNull();
  }
  const request = generate.mock.calls[0][0];
  const context = [request.system || "", ...(request.messages?.map((message: any) => message.content) || [])].join("\n");
  if (consumer === "foreground") {
    expect(context).toContain("Unspecified details remain unknown");
    expect(context).toContain("For a known-answer test");
    expect(context).toContain("open question or inspect first");
    expect(context).toContain("Your own new claim does not establish a past event");
  }
  expect(context).toContain('"Spare fuse" possession: "Mara"');
  expect(context).toContain("RECENT ACTION RECEIPTS");
  expect(context.indexOf("PHYSICAL WORKING MEMORY")).toBeLessThan(context.indexOf("OLD_RECOLLECTION"));
  expect(Goal.status[f.goal]).toBe("active");
});

test("foreground context prioritizes source evidence before both old perceptions and old thoughts", () => {
  const f = fixture(); f.remember("Mara");
  addThought(f.world, f.actor, { content: "OLD_THOUGHT: Ivo may have the fuse." });
  addPerception(f.world, f.actor, { content: "OLD_PERCEPTION: Ivo picked up the fuse.", source: "past experience", type: "visual" });
  const context = buildAgentContext(f.world, f.actor);
  expect(context.indexOf("PHYSICAL WORKING MEMORY")).toBeLessThan(context.indexOf("OLD_THOUGHT"));
  expect(context.indexOf("PHYSICAL WORKING MEMORY")).toBeLessThan(context.indexOf("OLD_PERCEPTION"));
});

test("a handoff arriving during foreground cognition cannot admit its stale question, thought or goal", async () => {
  const f = fixture(); f.remember("Ivo");
  const pending = deferred<{ text: string }>(); generate.mockImplementation(() => pending.promise);
  const running = agentThink(f.world, f.actor);
  expect(generate).toHaveBeenCalledTimes(1);
  f.remember("Mara", "Spare fuse", "action");
  pending.resolve({ text: JSON.stringify({ innerThought: "Ivo has the Spare fuse. I should ask for it.",
    action: { type: "speak", target: "Ivo", content: "Can I have the Spare fuse?" },
    goalUpdate: { description: "Get the Spare fuse from Ivo", priority: 8 } }) });
  expect(isDiscardedForegroundDecision(await running)).toBe(true);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  expect(getAgentConversation(f.world, f.actor)).toHaveLength(0);
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toEqual([f.goal]);
});

test.each(["unchanged confirmation", "unrelated object"])("%s permits an independent foreground action and thought", async change => {
  const f = fixture(); f.remember("Ivo");
  const pending = deferred<{ text: string }>(); generate.mockImplementation(() => pending.promise);
  const running = agentThink(f.world, f.actor);
  if (change === "unchanged confirmation") f.remember("Ivo");
  else f.remember("Sera", "Coffee mug");
  pending.resolve({ text: JSON.stringify({ innerThought: "Ivo can keep the Spare fuse while I inspect the controls.",
    action: { type: "move", target: "Utility Room" } }) });
  const action = await running;
  expect(action).toMatchObject({ type: "move", target: "Utility Room" });
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  expect(consumeForegroundAction(f.world, f.actor, action)).toMatchObject({ admitted: true });
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(1);
});

test.each([
  { subject: "Coffee mug", predicate: "location" as const, before: "Utility Room", after: "Sera", thought: "I should inspect the controls in the Utility Room." },
  { subject: "Desk lamp", predicate: "state" as const, before: "off", after: "on", thought: "I should turn off the relay before working on it." },
  { subject: "Supply cupboard", predicate: "state" as const, before: "closed", after: "open", thought: "I should keep the relay cover closed before switching the power on." },
])("unrelated $subject value changes do not stall foreground movement merely because prose mentions that value", async example => {
  const f = fixture();
  const remember = (value: string, serial: number) => recordWorkingMemoryEvidence(f.world, f.actor, {
    id: `unrelated:${serial}`, atMs: Date.now() + serial, kind: "observation", provenance: "visible_observation",
    summary: `${example.subject}: ${value}`, facts: [{ subject: `observed:${example.subject}`, subjectLabel: example.subject,
      predicate: example.predicate, value, valueLabel: value }],
  });
  expect(remember(example.before, 1)).toBe(true);
  const pending = deferred<{ text: string }>(); generate.mockImplementation(() => pending.promise);
  const running = agentThink(f.world, f.actor);
  expect(remember(example.after, 2)).toBe(true);
  pending.resolve({ text: JSON.stringify({ innerThought: example.thought, action: { type: "move", target: "Utility Room" } }) });
  const action = await running;
  expect(action).toMatchObject({ type: "move", target: "Utility Room" });
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  expect(consumeForegroundAction(f.world, f.actor, action)).toMatchObject({ admitted: true });
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(1);
});

test("quiet foreground cognition wakes for new physical knowledge, not another confirmation of the same fact", () => {
  const f = fixture(); f.remember("Ivo");
  recordCognitionOutcome(f.world, f.actor, { type: "wait" }, { succeeded: true, pending: false, now: 100 });
  f.remember("Ivo");
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 101 }).reason).toBe("quiet");
  f.remember("Mara");
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 102 }).reason).toBe("state_changed");
});

test("a completed handoff supersedes an in-flight question even when room and affordances are unchanged", async () => {
  const f = fixture(); f.remember("Ivo");
  const pending = deferred<GeneratedPlan>();
  const running = runPlanningSystem(f.world, { agentEids: [f.actor], planGenerator: () => pending.promise });
  f.remember("Mara", "Spare fuse", "action"); pending.resolve(askFuse); await running;
  expect(getPlanForGoal(f.world, f.actor, f.goal)).toBeUndefined();
});

test.each(["same value refresh", "unrelated object"])("%s does not discard a valid in-flight question", async change => {
  const f = fixture(); f.remember("Ivo");
  const pending = deferred<GeneratedPlan>();
  const running = runPlanningSystem(f.world, { agentEids: [f.actor], planGenerator: () => pending.promise });
  if (change === "same value refresh") f.remember("Ivo");
  else f.remember("Sera", "Coffee mug");
  pending.resolve(askFuse); await running;
  expect(getPlanForGoal(f.world, f.actor, f.goal)).toBeDefined();
});

test("updated working memory hides a stale stored question without giving a context reader mutation authority", () => {
  const f = fixture(); f.remember("Ivo");
  const id = createPlanEntity(f.world, f.actor, f.goal, askFuse);
  f.remember("Mara");
  expect(formatPlansForContext(f.world, f.actor)).not.toContain("Ask Ivo about the Spare fuse.");
  expect(Plan.status[id]).toBe("active");
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull();
  expect(Plan.status[id]).toBe("failed");
});

test("model-provided dependency metadata cannot suppress later memory validation", () => {
  const f = fixture(); f.remember("Ivo");
  const id = createPlanEntity(f.world, f.actor, f.goal, { ...askFuse, steps: [{ ...askFuse.steps[0], workingMemoryDependency: "malicious model override" }] });
  expect(JSON.parse(Plan.steps[id])[0].workingMemoryDependency).not.toBe("malicious model override");
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ actionType: "speak" });
  f.remember("Mara");
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull();
});

test("a changed memory does not erase a still-grounded physical plan", async () => {
  const f = fixture(); f.remember("Ivo");
  const pending = deferred<GeneratedPlan>();
  const running = runPlanningSystem(f.world, { agentEids: [f.actor], planGenerator: () => pending.promise });
  f.remember("Mara"); pending.resolve(physical); await running;
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ actionType: "move", target: "Utility Room" });
});

test("a stale next question is not projected as an instruction while a valid physical step remains", () => {
  const f = fixture(); f.remember("Ivo");
  const id = createPlanEntity(f.world, f.actor, f.goal, { ...physical, steps: [...physical.steps, ...askFuse.steps] });
  f.remember("Mara");
  expect(formatPlansForContext(f.world, f.actor)).toContain("Current: Inspect the controls.");
  expect(formatPlansForContext(f.world, f.actor)).not.toContain("Ask Ivo about the Spare fuse.");
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ actionType: "move" });
  expect(Plan.status[id]).toBe("active");
});

test("a legacy social plan without a working-memory dependency must reconsider newly known evidence", () => {
  const f = fixture();
  const id = createPlanEntity(f.world, f.actor, f.goal, askFuse);
  Plan.steps[id] = JSON.stringify(askFuse.steps);
  f.remember("Mara");
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull();
  expect(Plan.status[id]).toBe("failed");
});

test("a handoff invalidates an in-flight autonomous goal instead of accepting its obsolete premise", async () => {
  const f = fixture(); f.remember("Ivo");
  const pending = deferred<{ text: string }>(); generate.mockImplementation(() => pending.promise);
  const running = generateAutonomousGoal(f.world, f.actor);
  f.remember("Mara");
  pending.resolve({ text: JSON.stringify({ goal: "Ask Ivo for the Spare fuse", motivation: "Ivo has it", priority: 4, kind: "acquire" }) });
  expect(await running).toBeNull();
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toEqual([f.goal]);
});

test("meaningful working-memory changes wake quiet goal deliberation; repeated confirmation does not", async () => {
  jest.useFakeTimers(); jest.setSystemTime(100_000);
  const f = fixture(); Goal.status[f.goal] = "completed"; f.remember("Ivo");
  generate.mockResolvedValue({ text: '{"goal":null}' });
  await generateAutonomousGoal(f.world, f.actor);
  for (let i = 0; i < 5; i++) advanceGoalTick(f.world);
  jest.setSystemTime(101_000); f.remember("Ivo");
  expect(shouldGenerateGoal(f.world, f.actor)).toBe(false);
  f.remember("Mara");
  expect(shouldGenerateGoal(f.world, f.actor)).toBe(true);
});

test("a slow reflection drops the corrected physical interpretation but retains unrelated historical insight", async () => {
  const f = fixture(); f.remember("Ivo");
  addMemory(f.world, f.actor, { content: "Ivo held the Spare fuse earlier.", type: "episodic", importance: 0.8, timestamp: Date.now(), emotionalValence: 0 });
  const cooperation = addMemory(f.world, f.actor, { content: "We worked together on a difficult repair.", type: "episodic", importance: .6, timestamp: Date.now() - 1_000, emotionalValence: .2 });
  const pending = deferred<{ text: string }>(); generate.mockImplementation(() => pending.promise);
  const running = generateReflection(f.world, f.actor);
  f.remember("Mara");
  pending.resolve({ text: JSON.stringify({
    insights: [
      { insight: "Ivo is the person holding the Spare fuse.", importance: 6, category: "world", relatedMemories: ["Ivo held the Spare fuse."] },
      { insight: "I enjoy cooperating on difficult tasks.", importance: 4, category: "self", relatedMemories: ["We worked together."],
        temporalScope: "historical", sourceIds: [`memory:${cooperation}`] },
    ], questionsRaised: ["Where did the Spare fuse go?"], emotionalSummary: "Interested",
  }) });
  expect(await running).toMatchObject({ insights: [{ category: "self" }], questionsRaised: [] });
});
