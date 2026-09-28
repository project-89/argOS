import { jest } from "@jest/globals";

const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { addComponent, addEntity } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { Agent, Goal, Name, Needs, ReflectionState } = await import("../../ecs/components");
const { setLocatedIn } = await import("../../ecs/location");
const { createIntentGoal } = await import("../cognition-system");
const { generatePlanForGoal } = await import("../planning-system");
const { generateAutonomousGoal, generateAspirations, resetAutonomousGoals } = await import("../autonomous-goals");
const { generateReflection, initializeReflectionState, maybeReflect, shouldReflect } = await import("../reflection-system");
const { addMemory, getAgentMemories } = await import("../knowledge-graph");
const { registerAgentWorldCapabilities } = await import("../world-capabilities");
const { enableRoomRouteTopology, connectRoomRoute } = await import("../../runtime/room-routes");

function fixture() {
  const world = createArgosWorld("Background prompt contracts");
  world.meta.aiEnabled = true;
  initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Common Room" });
  const actor = createAgentEntity(world, {
    name: "Mara", role: "blacksmith", systemPrompt: "Privately interested in astronomy.", roomId: room,
  });
  Needs.social[actor] = 10;
  const goal = createIntentGoal(world, actor, "Inspect the room", 4);
  Goal.successJson[goal] = JSON.stringify({ type: "component", component: "Lamp", property: "on", value: true });
  return { world, room, actor, goal };
}

const plan = {
  goalDescription: "Inspect the room", estimatedCompletion: "short", potentialObstacles: [],
  steps: [{ description: "I should inspect the room.", actionType: "observe", target: "Common Room" }],
};
let oldKey: string | undefined;
beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset();
  resetAutonomousGoals();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Prompt tests must not make paid calls"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  jest.restoreAllMocks();
  if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey;
});

test.each([false, true])("planner keeps one contract and physical evidence, without unrelated office scripts (package=%s)", async packaged => {
  const f = fixture();
  if (packaged) registerAgentWorldCapabilities(f.world, f.actor, {
    context: () => "The lamp is visible but unlit.", ready: () => true, busy: () => false, execute: () => false,
  });
  generate.mockResolvedValue({ text: JSON.stringify(plan) });
  expect(await generatePlanForGoal(f.world, f.actor, f.goal)).toEqual(plan);
  const { system, prompt } = generate.mock.calls[0][0];
  expect(system).toContain("background planner");
  expect(system).toContain("KNOWN ROOMS:\n- Common Room");
  expect(system).not.toMatch(/CRITICAL RULES|SOCIAL PLANNING|Workstation|Team Board|invoice math|replace_in_file/);
  expect(prompt).toContain(Goal.successJson[f.goal]);
  expect(prompt).toContain("Executed steps and thoughts do not by themselves establish goal success");
  expect(prompt).toContain('"kind":"heard_evidence"');
  expect(prompt).toContain("a new message requires reconsideration, not automatic agreement");
  expect(prompt).not.toMatch(/gemini_cli|generate_image|Writes:|Run:/);
  expect(prompt.match(/"steps":/g)).toHaveLength(1);
  expect(Goal.status[f.goal]).toBe("active");
});

test("visible tools retain argument formats without importing unrelated tool examples", async () => {
  const f = fixture();
  const desk = addEntity(f.world); addComponent(f.world, desk, Name); Name.value[desk] = "Desk";
  setLocatedIn(f.world, desk, f.room);
  registerAgentWorldCapabilities(f.world, f.actor, {
    context: () => "", ready: () => true, busy: () => false, execute: () => false,
    affordances: target => target === desk ? ["read_file", "replace_in_file"].map(name => ({ name, requires: [] })) : [],
  });
  generate.mockResolvedValue({ text: JSON.stringify(plan) });
  await generatePlanForGoal(f.world, f.actor, f.goal);
  const { system } = generate.mock.calls[0][0];
  expect(system).toMatch(/Desk: .*read_file, replace_in_file/);
  expect(system).toContain('replace_in_file {"path":"...","find":"...","replace":"..."}');
  expect(system).toContain("workspace-relative");
  expect(system).not.toMatch(/kanban_move_card|write_file <path>|run_command <command/);
});

test("an opted-in planner sees current and adjacent room labels, never a global room catalog", async () => {
  const f = fixture(), next = createRoomEntity(f.world, { name: "Adjacent hallway" });
  createRoomEntity(f.world, { name: "HIDDEN_DISCONNECTED_VAULT" });
  enableRoomRouteTopology(f.world); connectRoomRoute(f.world, f.room, next);
  generate.mockResolvedValue({ text: JSON.stringify(plan) });
  expect(await generatePlanForGoal(f.world, f.actor, f.goal)).toEqual(plan);
  const { system, prompt } = generate.mock.calls[0][0];
  expect(system).toContain("Adjacent hallway"); expect(system).toContain("Common Room");
  expect(`${system}\n${prompt}`).not.toContain("HIDDEN_DISCONNECTED_VAULT");
});

test("invalid physical targets are still rejected after prompt cleanup", async () => {
  const f = fixture();
  generate.mockResolvedValue({ text: JSON.stringify({ ...plan, steps: [{ description: "I should use it.", actionType: "interact", target: "Invisible Machine", content: "activate" }] }) });
  expect(await generatePlanForGoal(f.world, f.actor, f.goal)).toBeNull();
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate.mock.calls[1][0].prompt).toContain('invalid interact target: "Invisible Machine"');
  expect(Goal.status[f.goal]).toBe("active");
});

test("autonomous goals receive needs and commitments as context rather than mandatory social instructions", async () => {
  const f = fixture();
  generate.mockResolvedValue({ text: JSON.stringify({ goal: "Study the stars", motivation: "I enjoy astronomy", priority: 3, kind: "improve" }) });
  expect(await generateAutonomousGoal(f.world, f.actor)).toMatchObject({ description: "Study the stars", kind: "improve" });
  const request = generate.mock.calls[0][0];
  const content = request.messages.map((message: { content: string }) => message.content).join("\n");
  expect(content).toContain("background deliberation");
  expect(content).toContain("Social: 10 (0 = lonely, 100 = fulfilled)");
  expect(content).toContain("Inspect the room");
  expect(content).toContain("Privately interested in astronomy.");
  expect(content).toContain('"kind": "<explore|social|craft|acquire|improve|survive|custom>"');
  expect(content).not.toMatch(/PRIORITY RULES|ALWAYS top priority|festival → socialize|→ social goal|Choose something DIFFERENT/);
});

test("aspiration generation includes the actor's own interests beyond occupation", async () => {
  const f = fixture();
  generate.mockResolvedValue({ text: JSON.stringify({ aspirations: ["Learn the movements of the stars", "Forge a telescope mount", "Map the night sky"] }) });
  expect(await generateAspirations(f.world, f.actor)).toHaveLength(3);
  const content = generate.mock.calls[0][0].messages.map((message: { content: string }) => message.content).join("\n");
  expect(content).toContain(Agent.systemPrompt[f.actor]);
  expect(content).not.toMatch(/not become a scholar|Personal .* AND practical/);
});

test("reflection keeps memory sources and interpretation boundaries without forcing extra insights or questions", async () => {
  const f = fixture();
  const memoryId = addMemory(f.world, f.actor, { type: "episodic", content: "Ivo said the lamp was repaired; I have not checked it.", importance: 0.7, timestamp: Date.now(), emotionalValence: 0 });
  const result = { insights: [{ insight: "I can check Ivo's report against the lamp.", importance: 5, relatedMemories: ["Ivo's report"], category: "world" }], questionsRaised: [], emotionalSummary: "Curious" };
  generate.mockResolvedValue({ text: JSON.stringify(result) });
  expect(await generateReflection(f.world, f.actor)).toEqual(result);
  const { system, prompt } = generate.mock.calls[0][0];
  expect(system).toContain("background reflection process");
  expect(system).toContain("does not execute actions or verify world facts");
  expect(system).toContain(`[memory ${memoryId}; episodic; remembered, not independently verified;`);
  expect(system).toContain('"Ivo said the lamp was repaired; I have not checked it."');
  expect(prompt).toContain("up to 4 insights");
  expect(prompt).toContain("Insights and questions may be empty arrays");
  expect(prompt).toContain('"category": "self|social|world|goal"');
  expect(Goal.status[f.goal]).toBe("active");
});

test("an empty reflection consumes reviewed importance without manufacturing memory or immediately retrying", async () => {
  const f = fixture();
  const state = initializeReflectionState(f.world, f.actor, 10);
  addMemory(f.world, f.actor, { type: "episodic", content: "The same clock ticked again.", importance: 1, timestamp: Date.now(), emotionalValence: 0 });
  const memories = getAgentMemories(f.world, f.actor);
  expect(shouldReflect(f.world, f.actor)).toBe(true);
  generate.mockResolvedValue({ text: JSON.stringify({ insights: [], questionsRaised: [], emotionalSummary: "" }) });
  expect(await maybeReflect(f.world, f.actor)).toBe(true);
  expect(getAgentMemories(f.world, f.actor)).toEqual(memories);
  expect(ReflectionState.importanceAccum[state]).toBe(0);
  expect(ReflectionState.reflectionCount[state]).toBe(1);
  expect(shouldReflect(f.world, f.actor)).toBe(false);
  expect(await maybeReflect(f.world, f.actor)).toBe(false);
  expect(generate).toHaveBeenCalledTimes(1);
});
