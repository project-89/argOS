import { jest } from "@jest/globals";

const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { getRelationTargets } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { HasGoal } = await import("../../ecs/relations");
const { agentThink, addPerception, getAgentThoughts, getAgentConversation } = await import("../agent-mind");
const { consumeForegroundAction, isDiscardedForegroundDecision } = await import("../foreground-action-admission");
const { recordCommittedSpeech } = await import("../social-memory");

function fixture() {
  const world = createArgosWorld("Social decision continuity"); world.meta.aiEnabled = true; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Common Room" });
  const remote = createRoomEntity(world, { name: "Utility Room" });
  const make = (name: string, roomId = room) => createAgentEntity(world, { name, role: "resident", systemPrompt: "Curious.", roomId });
  return { world, room, remote, mara: make("Mara"), ivo: make("Ivo"), sera: make("Sera"), remoteActor: make("Rook", remote) };
}
function deferred() { let resolve!: (value: { text: string }) => void; const promise = new Promise<{ text: string }>(done => { resolve = done; }); return { promise, resolve }; }
let oldKey: string | undefined;
beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No live model calls"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey;
});

test.each(["wait", "think", "rest"])("a concurrent directed answer cannot admit stale %s thought or new social goal", async type => {
  const f = fixture(); recordCommittedSpeech(f.world, f.mara, "How do you divide the chores?", "Ivo");
  const pending = deferred(); generate.mockImplementation(() => pending.promise);
  const thinking = agentThink(f.world, f.mara);
  expect(generate).toHaveBeenCalledTimes(1);
  recordCommittedSpeech(f.world, f.ivo, "I handle repairs; Sera handles cooking.", "Mara");
  addPerception(f.world, f.mara, { type: "speech", source: "Ivo", content: 'Ivo says to you: "I handle repairs; Sera handles cooking."' });
  pending.resolve({ text: JSON.stringify({ action: { type }, innerThought: "I should wait for his answer.",
    goalUpdate: { description: "Ask again about the chores", priority: 4, kind: "social" } }) });
  expect(isDiscardedForegroundDecision(await thinking)).toBe(true);
  expect(getAgentThoughts(f.world, f.mara)).toHaveLength(0);
  expect(getAgentConversation(f.world, f.mara)).toHaveLength(0);
  expect(getRelationTargets(f.world, f.mara, HasGoal)).toEqual([]);
  generate.mockResolvedValue({ text: '{"innerThought":"I heard who does what.","action":{"type":"wait"}}' });
  const fresh = await agentThink(f.world, f.mara);
  expect(generate.mock.calls[1][0].system).toContain("I handle repairs; Sera handles cooking.");
  expect(getAgentThoughts(f.world, f.mara)).toHaveLength(0);
  expect(consumeForegroundAction(f.world, f.mara, fresh)).toMatchObject({ admitted: true });
  expect(getAgentThoughts(f.world, f.mara)).toHaveLength(1);
});

test.each(["unrelated ambient", "other addressee", "remote"])("%s chatter does not starve a slower reply", async change => {
  const f = fixture(); const pending = deferred(); generate.mockImplementation(() => pending.promise);
  const thinking = agentThink(f.world, f.mara);
  if (change === "unrelated ambient") recordCommittedSpeech(f.world, f.sera, "The rain sounds pleasant.");
  else if (change === "other addressee") recordCommittedSpeech(f.world, f.ivo, "The flowers look nice.", "Sera");
  else recordCommittedSpeech(f.world, f.remoteActor, "I have news for Mara.", "Mara");
  pending.resolve({ text: '{"innerThought":"I can offer Ivo a hand.","action":{"type":"speak","target":"Ivo","content":"I can help with the panel."}}' });
  const action = await thinking;
  expect(action).toMatchObject({ type: "speak", target: "Ivo" });
  expect(getAgentThoughts(f.world, f.mara)).toHaveLength(0);
  expect(consumeForegroundAction(f.world, f.mara, action)).toMatchObject({ admitted: true });
  expect(getAgentThoughts(f.world, f.mara)).toHaveLength(1);
});

test("an independent physical step can proceed while someone speaks", async () => {
  const f = fixture(); const pending = deferred(); generate.mockImplementation(() => pending.promise);
  const thinking = agentThink(f.world, f.mara);
  recordCommittedSpeech(f.world, f.ivo, "I like the rain.", "Mara");
  pending.resolve({ text: '{"innerThought":"I should inspect the controls in the Utility Room.","action":{"type":"move","target":"Utility Room"}}' });
  const action = await thinking;
  expect(action).toMatchObject({ type: "move", target: "Utility Room" });
  expect(getAgentThoughts(f.world, f.mara)).toHaveLength(0);
  expect(consumeForegroundAction(f.world, f.mara, action)).toMatchObject({ admitted: true });
  expect(getAgentThoughts(f.world, f.mara)).toHaveLength(1);
});

test("an independently grounded physical action cannot publish a thought invalidated by newly heard speech", async () => {
  const f = fixture(); const pending = deferred(); generate.mockImplementation(() => pending.promise);
  const thinking = agentThink(f.world, f.mara);
  recordCommittedSpeech(f.world, f.ivo, "I already checked the controls; stay here.", "Mara");
  pending.resolve({ text: '{"innerThought":"Ivo has not answered. I should inspect the controls myself.","action":{"type":"move","target":"Utility Room"}}' });
  const action = await thinking;
  expect(action).toMatchObject({ type: "move", target: "Utility Room" });
  expect(getAgentThoughts(f.world, f.mara)).toHaveLength(0);
  expect(consumeForegroundAction(f.world, f.mara, action)).toMatchObject({ admitted: true, mentalUpdateOmitted: true });
  expect(getAgentThoughts(f.world, f.mara)).toHaveLength(0);
  expect(getAgentConversation(f.world, f.mara)).toHaveLength(0);
});
