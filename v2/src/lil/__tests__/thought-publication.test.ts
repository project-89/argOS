import { jest } from "@jest/globals";
const mind = await import("../../cognition/agent-mind");
const cognition = await import("../../cognition/cognition-system");
const knowledge = await import("../../cognition/knowledge-graph");
const reflection = await import("../../cognition/reflection-system");
const think = jest.fn<(...args: any[]) => Promise<any>>();
const execute = jest.fn<(...args: any[]) => void>();
const extract = jest.fn<(...args: any[]) => Promise<void>>().mockResolvedValue(undefined);
const speech = jest.fn<(...args: any[]) => Promise<void>>().mockResolvedValue(undefined);
jest.unstable_mockModule("../../cognition/agent-mind", () => ({ ...mind, agentThink: think }));
jest.unstable_mockModule("../../cognition/cognition-system", () => ({ ...cognition, executeActions: execute }));
jest.unstable_mockModule("../../cognition/knowledge-graph", () => ({ ...knowledge, extractKnowledgeFromInteraction: extract }));
jest.unstable_mockModule("../../cognition/reflection-system", () => ({ ...reflection, accumulateImportance: jest.fn() }));
jest.unstable_mockModule("../speech-impact", () => ({ processSpeechImpact: speech, propagateGossip: jest.fn() }));
const { initGameEngine, processNpcSpeechInteraction, publicNpcResponses } = await import("../game-engine");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { ConversationTurn } = await import("../../ecs/components");
const { clearTimedSpeech, getSpeakingActivity } = await import("../../cognition/timed-speech");
const worlds: ReturnType<typeof createArgosWorld>[] = [];

beforeEach(() => {
  initGameEngine({ playerName: "Player", playerRole: "visitor" }); think.mockReset(); execute.mockReset(); extract.mockClear(); speech.mockClear();
  execute.mockImplementation((world, actions, registry) => cognition.executeActions(world, actions, registry));
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline adapter regression"));
});
afterEach(() => { for (const world of worlds.splice(0)) clearTimedSpeech(world); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
function fixture() {
  const world = createArgosWorld("LIL thought boundary"); worlds.push(world); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Lounge" });
  const actor = createAgentEntity(world, { name: "Ada", role: "friend", systemPrompt: "fixture", roomId: room });
  return { world, actor, registry: createSystemRegistry() };
}
async function interaction(f: ReturnType<typeof fixture>) {
  const responses: any[] = [];
  await processNpcSpeechInteraction(f.world, -1, f.actor, "Hello", { roomName: "Lounge" } as any, responses, f.registry);
  return responses;
}
test.each(["wait", "think", "observe"])("%s without a new thought does not reuse old monologue or manufacture speech", async type => {
  const f = fixture(); mind.addThought(f.world, f.actor, { type: "reasoning", content: "PRIVATE_OLD_THOUGHT" });
  think.mockResolvedValue({ type, ...(type === "think" ? { content: "PRIVATE_COGNITIVE_ACTION" } : {}) });
  const responses = await interaction(f);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(responses).toHaveLength(1); expect(responses[0].action.type).toBe(type);
  expect(responses[0]).not.toHaveProperty("innerThought");
  expect(JSON.stringify(publicNpcResponses(responses))).not.toContain("PRIVATE_");
  expect(extract.mock.calls[0][2].content).not.toContain("PRIVATE_");
  expect(extract.mock.calls[0][2].content).toContain("no spoken response");
  expect(speech.mock.calls[0][4]).toBe("");
});
test("a thought admitted at dispatch is retained privately, never passed off as dialogue", async () => {
  const f = fixture(); think.mockResolvedValue({ type: "wait" });
  execute.mockImplementation(() => { mind.addThought(f.world, f.actor, { type: "reasoning", content: "PRIVATE_NEW_THOUGHT" }); });
  const responses = await interaction(f);
  expect(responses[0]).toMatchObject({ action: { type: "wait" }, innerThought: "PRIVATE_NEW_THOUGHT" });
  expect(publicNpcResponses(responses)).toEqual([{ name: "Ada", action: { type: "wait" } }]);
  expect(extract.mock.calls[0][2].content).not.toContain("PRIVATE_");
});
test("explicit speech keeps its exact words and action without requiring an inner monologue", async () => {
  const f = fixture(); think.mockResolvedValue({ type: "speak", content: "Hello to you too." });
  const responses = await interaction(f);
  expect(responses).toEqual([{ name: "Ada", action: { type: "speak", content: "Hello to you too." } }]);
  expect(publicNpcResponses(responses)).toEqual(responses);
  expect(extract.mock.calls[0][2].content).toContain('I responded: "Hello to you too."');
  expect(mind.getAgentConversation(f.world, f.actor).map(id => ConversationTurn.content[id])).toContain('Ada: "Hello to you too."');
});
test("filtered hostile actions do not fabricate suspicion, a new observation, or speech", async () => {
  const f = fixture(); think.mockResolvedValue({ type: "attack", target: "Player" });
  expect(await interaction(f)).toEqual([{ name: "Ada", action: { type: "wait" } }]);
  expect(execute).not.toHaveBeenCalled();
});
test.each(["rejected", "pending"])("%s speech cannot expose its script or reuse a previous complete turn", async condition => {
  const f = fixture(), content = "A proposed future line.";
  cognition.executeActions(f.world, [{ eid: f.actor, action: { type: "speak", content: condition === "rejected" ? content : "A prior completed line." } }], f.registry);
  if (condition === "pending") f.world.meta.timedSpeech = true;
  think.mockResolvedValue({ type: "speak", content, ...(condition === "rejected" ? { foregroundDecisionId: "forged-issuance" } : { speechMode: "interrupt" }) });
  expect(await interaction(f)).toEqual([{ name: "Ada", action: { type: "wait" } }]);
  if (condition === "pending") expect(getSpeakingActivity(f.world, f.actor)?.spokenText).toBe("");
  expect(extract.mock.calls[0][2].content).not.toContain(content);
  expect(speech.mock.calls[0][4]).toBe("");
});
