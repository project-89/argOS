import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { createAgentEntity, createRoomEntity, initializePrefabs } = await import("../../ecs/prefabs");
const { createIntentGoal, runCognitionCycle } = await import("../cognition-system");
const { createPlanEntity } = await import("../planning-system");
const { addPerception, addConversationTurn, agentThink, getAgentThoughts } = await import("../agent-mind");
const { consumeForegroundAction, isDiscardedForegroundDecision } = await import("../foreground-action-admission");
const { getRelationTargets, addComponent } = await import("bitecs");
const { LastAction, Goal } = await import("../../ecs/components");
const { HasGoal } = await import("../../ecs/relations");
const { queueStimulus, drainPendingStimuli } = await import("../stimulus-queue");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { recordCommittedSpeech } = await import("../social-memory");
const { registerAgentWorldCapabilities } = await import("../world-capabilities");

function fixture() {
  const world = createArgosWorld("Model contract"); world.meta.aiEnabled = true;
  initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" });
  const actor = createAgentEntity(world, { name: "Mara", role: "keeper", systemPrompt: "Reason from evidence.", roomId: room });
  const goal = createIntentGoal(world, actor, "Investigate the room", 7);
  return { world, room, actor, goal };
}
let oldKey: string | undefined;
beforeEach(() => { oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only"; generate.mockReset(); drainPendingStimuli(); });
afterEach(() => { if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey; });

test.each([null, { type: 4 }, { type: "teleport" }, { type: "move", target: { room: "Workshop" } }, { type: "speak", content: ["hello"] },
  { type: "interact" }, { type: "move", target: " " }, { type: "speak", content: "" }])(
  "invalid model action %j cannot admit a goal or thought", async action => {
    const f = fixture();
    generate.mockResolvedValue({ text: JSON.stringify({ innerThought: "INVALID_THOUGHT", goalUpdate: { description: "INVALID_GOAL", priority: 10 }, action }) });
    expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
    expect(getRelationTargets(f.world, f.actor, HasGoal)).toEqual([f.goal]);
    expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  });

test("direct speech interrupts an active plan once, then the plan remains available", async () => {
  const f = fixture();
  createPlanEntity(f.world, f.actor, f.goal, { goalDescription: "Investigate", estimatedCompletion: "short", potentialObstacles: [],
    steps: [{ description: "Inspect the workshop", actionType: "observe", target: "Workshop" }] });
  addPerception(f.world, f.actor, { type: "speech", content: "Are you okay?", source: "Ivo" });
  generate.mockResolvedValue({ text: JSON.stringify({ innerThought: "I can answer and continue.", action: { type: "speak", target: "Ivo", content: "Yes, I am checking the room." } }) });
  const answer = await agentThink(f.world, f.actor);
  expect(answer.type).toBe("speak");
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  expect(consumeForegroundAction(f.world, f.actor, answer)).toMatchObject({ admitted: true });
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(1);
  expect(await agentThink(f.world, f.actor)).toEqual({ type: "observe", target: "Workshop", content: undefined });
  expect(generate).toHaveBeenCalledTimes(1);
});

test.each(["speak", "observe"])("new heard dialogue reconsiders stale %s without blocking unrelated physical selection", async type => {
  const f = fixture();
  const ivo = createAgentEntity(f.world, { name: "Ivo", role: "caretaker", systemPrompt: "Private", roomId: f.room });
  generate.mockImplementation(async () => {
    recordCommittedSpeech(f.world, ivo, "I have the key already.", "Mara");
    return { text: JSON.stringify({ innerThought: "I should check.", action: type === "speak"
      ? { type, target: "Ivo", content: "Do you have the key?" } : { type, target: "Workshop" } }) };
  });
  const action = await agentThink(f.world, f.actor);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  if (type === "speak") expect(isDiscardedForegroundDecision(action)).toBe(true);
  else {
    expect(action.type).toBe("observe");
    expect(consumeForegroundAction(f.world, f.actor, action)).toMatchObject({ admitted: true });
  }
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(type === "speak" ? 0 : 1);
});
test("unrelated side conversation cannot repeatedly starve a directed reply", async () => {
  const f = fixture();
  createAgentEntity(f.world, { name: "Ivo", role: "caretaker", systemPrompt: "Private", roomId: f.room });
  const sera = createAgentEntity(f.world, { name: "Sera", role: "resident", systemPrompt: "Private", roomId: f.room });
  createAgentEntity(f.world, { name: "Dara", role: "resident", systemPrompt: "Private", roomId: f.room });
  generate.mockImplementation(async () => {
    recordCommittedSpeech(f.world, sera, "A separate conversation.", "Dara");
    return { text: JSON.stringify({ innerThought: "Answer Ivo.", action: { type: "speak", target: "Ivo", content: "I can hold the panel." } }) };
  });
  for (let n = 0; n < 3; n++) {
    const reply = await agentThink(f.world, f.actor);
    expect(reply.type).toBe("speak");
    expect(getAgentThoughts(f.world, f.actor)).toHaveLength(n);
    expect(consumeForegroundAction(f.world, f.actor, reply)).toMatchObject({ admitted: true });
    expect(getAgentThoughts(f.world, f.actor)).toHaveLength(n + 1);
  }
});
test("accepted subjective review emits its own hook, not a physical success assertion", async () => {
  const f = fixture(); Goal.kind[f.goal] = "social";
  const ivo = createAgentEntity(f.world, { name: "Ivo", role: "caretaker", systemPrompt: "Private", roomId: f.room });
  const own = recordCommittedSpeech(f.world, f.actor, "I appreciate your company.", "Ivo")!;
  const heard = recordCommittedSpeech(f.world, ivo, "Likewise.", "Mara")!;
  const satisfied = jest.fn();
  const unregister = registerAgentWorldCapabilities(f.world, f.actor, {
    context: () => "", ready: () => true, busy: () => false, execute: () => false, onSocialGoalSatisfied: satisfied,
  });
  try {
    generate.mockResolvedValue({ text: JSON.stringify({ innerThought: "I feel connected.", action: { type: "wait" }, socialGoalReview: {
      goalId: f.goal, disposition: "satisfied_for_now", reason: "We shared a friendly moment.", evidenceIds: [own.id, heard.id],
    } }) });
    const action = await agentThink(f.world, f.actor);
    expect(action.type).toBe("wait");
    expect(Goal.status[f.goal]).toBe("active");
    expect(satisfied).not.toHaveBeenCalled();
    expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
    expect(consumeForegroundAction(f.world, f.actor, action)).toMatchObject({ admitted: true });
    expect(Goal.status[f.goal]).toBe("completed");
    expect(satisfied).toHaveBeenCalledWith(f.goal, "We shared a friendly moment.");
  } finally { unregister(); }
});

test("signals omitted from one bounded prompt remain unacknowledged for the next decision", async () => {
  const f = fixture();
  createPlanEntity(f.world, f.actor, f.goal, { goalDescription: "Investigate", estimatedCompletion: "short", potentialObstacles: [],
    steps: [{ description: "Inspect", actionType: "observe", target: "Workshop" }] });
  for (let i = 0; i < 10; i++) addPerception(f.world, f.actor, { type: "attention", source: "alarm", content: `SIGNAL_${i}_END` });
  generate.mockResolvedValue({ text: JSON.stringify({ innerThought: "Consider the signals.", action: { type: "wait" } }) });
  for (let n = 0; n < 2; n++) {
    const action = await agentThink(f.world, f.actor);
    expect(consumeForegroundAction(f.world, f.actor, action)).toMatchObject({ admitted: true });
  }
  expect(generate).toHaveBeenCalledTimes(2);
  const prompts = generate.mock.calls.map(call => String(call[0].system));
  for (let i = 0; i < 10; i++) expect(prompts.some(prompt => prompt.includes(`SIGNAL_${i}_END`))).toBe(true);
});

test("new danger gets deliberation before an old failure-recovery reflex", async () => {
  const f = fixture();
  addPerception(f.world, f.actor, { type: "action_failed", source: "interaction", content: 'FAILED: missing tool. → PICK UP "Fuse" first' });
  addPerception(f.world, f.actor, { type: "danger", source: "circuit", content: "Sparks! Isolate power immediately." });
  createIntentGoal(f.world, f.actor, "Isolate the dangerous circuit", 10);
  generate.mockResolvedValue({ text: JSON.stringify({ innerThought: "Safety first.", action: { type: "interact", target: "Circuit", content: "isolate" } }) });
  expect(await agentThink(f.world, f.actor)).toEqual({ type: "interact", target: "Circuit", content: "isolate", foregroundDecisionId: expect.stringMatching(/^foreground:/) });
  expect(generate).toHaveBeenCalledTimes(1);
});

test("a superseded model result cannot leave a thought, goal, or acknowledged interruption", async () => {
  const f = fixture(); let current = true;
  addPerception(f.world, f.actor, { type: "attention", content: "A concrete alarm", source: "alarm" });
  generate.mockImplementation(async () => { current = false; return { text: JSON.stringify({ innerThought: "STALE_THOUGHT", goalUpdate: { description: "STALE_GOAL", priority: 10 }, action: { type: "wait" } }) }; });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor, { isCurrent: () => current }))).toBe(true);
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toEqual([f.goal]);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test("pagination cannot swallow another actor's stimulus", async () => {
  const f = fixture(); f.world.meta.aiEnabled = false;
  const other = createAgentEntity(f.world, { name: "Ivo", role: "keeper", systemPrompt: "Test", roomId: f.room });
  queueStimulus(f.world, { targetEid: f.actor, type: "attention", source: "alarm", content: "Alarm for Mara" });
  queueStimulus(f.world, { targetEid: other, type: "attention", source: "alarm", content: "Alarm for Ivo" });
  const actions = await runCognitionCycle(f.world, createSystemRegistry(), { enablePlanning: false, maxAgents: 1, tick: 1 });
  const waiting = drainPendingStimuli();
  expect(actions).toHaveLength(1);
  const notAdmitted = actions[0].eid === f.actor ? other : f.actor;
  expect(waiting.some(s => s.targetEid === notAdmitted && s.content.startsWith("Alarm for"))).toBe(true);
  expect(generate).not.toHaveBeenCalled();
});

test("the decision deadline yields without admitting a partial result or consuming its signal", async () => {
  const f = fixture();
  createPlanEntity(f.world, f.actor, f.goal, { goalDescription: "Investigate", estimatedCompletion: "short", potentialObstacles: [],
    steps: [{ description: "Inspect", actionType: "observe", target: "Workshop" }] });
  addPerception(f.world, f.actor, { type: "attention", source: "alarm", content: "Important signal" });
  const timeout = jest.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    expect(ms).toBe(8000); return AbortSignal.abort(new Error("Decision deadline"));
  });
  try {
    generate.mockImplementation(async input => { input.abortSignal.throwIfAborted(); return { text: "{}" }; });
    expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
    expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  } finally { timeout.mockRestore(); }
  generate.mockResolvedValue({ text: JSON.stringify({ innerThought: "I can consider that signal now.", action: { type: "wait" } }) });
  const recovered = await agentThink(f.world, f.actor);
  expect(generate).toHaveBeenCalledTimes(2); // not silently resumed the old plan
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  expect(consumeForegroundAction(f.world, f.actor, recovered)).toMatchObject({ admitted: true });
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(1);
});

test("a provider returning valid JSON after its deadline cannot admit a late thought or goal", async () => {
  const f = fixture();
  const timeout = jest.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort(new Error("Decision deadline")));
  generate.mockResolvedValue({ text: JSON.stringify({ innerThought: "TOO_LATE", goalUpdate: { description: "TOO_LATE_GOAL", priority: 10 }, action: { type: "wait" } }) });
  try {
    expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
    expect(getRelationTargets(f.world, f.actor, HasGoal)).toEqual([f.goal]);
    expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  } finally { timeout.mockRestore(); }
});

test("fresh evidence and priority accompany each decision; past action JSON is not replayed as assistant truth", async () => {
  const f = fixture();
  addConversationTurn(f.world, f.actor, "assistant", '{"innerThought":"UNEXECUTED_SUCCESS_CLAIM","action":{"type":"wait"}}');
  addComponent(f.world, f.actor, LastAction);
  LastAction.type[f.actor] = "interact"; LastAction.target[f.actor] = "Valve";
  LastAction.content[f.actor] = "close"; LastAction.success[f.actor] = false; LastAction.timestamp[f.actor] = Date.now();
  createIntentGoal(f.world, f.actor, "Respond to the confirmed leak", 10);
  addPerception(f.world, f.actor, { type: "danger", source: "pipe", content: "CURRENT_CONFIRMED_LEAK" });
  generate.mockResolvedValue({ text: JSON.stringify({ innerThought: "I should inspect the leak.", action: { type: "observe", target: "Workshop" } }) });
  await agentThink(f.world, f.actor);
  const input = generate.mock.calls[0][0];
  expect(input.messages).toHaveLength(1);
  expect(input.messages[0].role).toBe("user");
  expect(input.system).toContain("CURRENT_CONFIRMED_LEAK");
  expect(input.messages[0].content).not.toContain("CURRENT_CONFIRMED_LEAK"); // context is not duplicated
  expect(input.system).toMatch(/Priority 10\] Respond to the confirmed leak/);
  expect(input.messages[0].content).not.toContain('Highest-priority active goal(s)');
  expect(input.messages[0].content).toContain('"success":false');
  expect(JSON.stringify(input)).not.toContain("UNEXECUTED_SUCCESS_CLAIM");
});
