import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createObjectEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { LastAction, Thought, WorkingMemoryIdentity } = await import("../../ecs/components");
const { getDirectContainer } = await import("../../ecs/location");
const { getCommittedEvents, startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { agentThink, addPerception, addThought, getAgentThoughts, getAgentPerceptions, hasUnintegratedAttention, buildAgentContext } = await import("../agent-mind");
const { executeActions } = await import("../cognition-system");
const { getNarrativeHistory } = await import("../narrative-memory");
const { snapshotActorContinuation } = await import("../actor-continuation");
const { registerAgentWorldCapabilities } = await import("../world-capabilities");
const { workingMemoryEntityRef } = await import("../working-memory");
const { drainPendingStimuli } = await import("../stimulus-queue");
const { chronicle } = await import("../simulation-chronicle");
const { isDiscardedForegroundDecision } = await import("../foreground-action-admission");
import type { ChronicleEntry } from "../simulation-chronicle";

const cleanups: Array<() => void> = [];
let previousKey: string | undefined;
beforeEach(() => {
  previousKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  drainPendingStimuli(); generate.mockReset();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Optional thought tests must remain offline"));
});
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup()); drainPendingStimuli();
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  if (previousKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = previousKey;
});
function fixture() {
  const world = createArgosWorld("Private expression"); initializePrefabs(world);
  world.meta.aiEnabled = true; world.meta.narrativeMind = true;
  const room = createRoomEntity(world, { name: "Lounge" });
  const actor = (name: string) => createAgentEntity(world, { name, role: "friend", systemPrompt: "Act from experience", roomId: room });
  const ada = actor("Ada"), bo = actor("Bo");
  const key = createObjectEntity(world, { name: "Brass key", roomId: room, portable: true });
  const onThought = jest.fn();
  cleanups.push(registerAgentWorldCapabilities(world, ada, { context: () => "", ready: () => true, busy: () => false,
    execute: () => false, onThought }));
  startCommittedEvents(world);
  workingMemoryEntityRef(world, ada);
  const previous = "PRIVATE: I miss the way our evenings used to feel.";
  addThought(world, ada, { content: previous, type: "reasoning" });
  const entries: ChronicleEntry[] = [];
  cleanups.push(chronicle.subscribe(entry => { if (entry.data.agent === "Ada") entries.push(entry); }));
  return { world, ada, bo, key, previous, onThought, entries, registry: createSystemRegistry(),
    thoughts: () => getAgentThoughts(world, ada).map(id => Thought.content[id]) };
}
const response = (innerThought: unknown, type = "pickup", target: string | undefined = "Brass key") => ({ text: JSON.stringify({
  ...(innerThought !== undefined ? { innerThought } : {}),
  control: { version: 2, purpose: "Carry the key while considering my evening", goalId: null, localDependencies: [] },
  action: { type, ...(target ? { target } : {}) },
}) });

test.each([undefined, "", " \n\t "])("unexpressed innerThought=%p still commits control/action/perception without replacing private thought", async value => {
  const f = fixture();
  const perception = addPerception(f.world, f.ada, { type: "attention", source: "local cue", content: "The key catches your eye." });
  expect(hasUnintegratedAttention(f.world, f.ada)).toBe(true);
  generate.mockResolvedValue(response(value));
  const action = await agentThink(f.world, f.ada);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  executeActions(f.world, [{ eid: f.ada, action }], f.registry);
  expect(LastAction.type[f.ada]).toBe("pickup"); expect(LastAction.success[f.ada]).toBe(true);
  expect(getDirectContainer(f.world, f.key)).toBe(f.ada);
  expect(snapshotActorContinuation(f.world, f.ada)?.purpose).toBe("Carry the key while considering my evening");
  expect(getAgentPerceptions(f.world, f.ada)).toContain(perception);
  expect(hasUnintegratedAttention(f.world, f.ada)).toBe(false);
  expect(f.thoughts()).toEqual([f.previous]); expect(f.onThought).toHaveBeenCalledTimes(1);
  expect(getNarrativeHistory(f.world, f.ada).map(row => row.monologue)).toEqual([f.previous]);
  const decisions = f.entries.filter(entry => entry.type === "llm_decision");
  expect(decisions).toHaveLength(1); expect(decisions[0].data).not.toHaveProperty("reasoning");
  expect(decisions[0].summary).toBe("Ada: pickup→Brass key");
  expect(f.entries.filter(entry => entry.type === "cognition_integrated")).toHaveLength(1);
  expect((console.log as jest.Mock).mock.calls.flat().some(message => typeof message === "string" && message.includes('[Ada] thinks:'))).toBe(false);
  expect(JSON.stringify(getCommittedEvents(f.world))).not.toContain(f.previous);
  const prompt = generate.mock.calls[0][0].messages[0].content;
  expect(prompt).toContain("\"innerThought\": \"optional");
  expect(prompt).not.toContain('"innerThought": "A brief thought about this moment"');
});

test("deliberately repeated authored thought is retained exactly, archived twice, and remains private", async () => {
  const f = fixture(), authored = "  PRIVATE: I still wish they would call.  ";
  generate.mockResolvedValue(response(authored, "wait", undefined));
  for (let i = 0; i < 2; i++) {
    const action = await agentThink(f.world, f.ada);
    expect(isDiscardedForegroundDecision(action)).toBe(false);
    executeActions(f.world, [{ eid: f.ada, action }], f.registry);
  }
  expect(f.thoughts()).toEqual([f.previous, authored, authored]);
  expect(f.onThought).toHaveBeenCalledTimes(3);
  expect(getNarrativeHistory(f.world, f.ada).filter(row => row.monologue.trim() === authored.trim())).toHaveLength(2);
  expect(f.entries.filter(entry => entry.type === "llm_decision").map(entry => entry.data.reasoning)).toEqual([authored, authored]);
  expect(buildAgentContext(f.world, f.bo)).not.toContain("I still wish they would call");
  expect(JSON.stringify(getCommittedEvents(f.world))).not.toContain("I still wish they would call");
});

test.each([null, 42, {}])("invalid innerThought=%p cannot commit cognition, acknowledge attention, or execute", async value => {
  const f = fixture();
  addPerception(f.world, f.ada, { type: "attention", source: "local cue", content: "The key catches your eye." });
  generate.mockResolvedValue(response(value));
  const action = await agentThink(f.world, f.ada);
  expect(isDiscardedForegroundDecision(action)).toBe(true);
  executeActions(f.world, [{ eid: f.ada, action }], f.registry);
  expect(getDirectContainer(f.world, f.key)).not.toBe(f.ada);
  expect(f.thoughts()).toEqual([f.previous]); expect(f.onThought).toHaveBeenCalledTimes(1);
  expect(hasUnintegratedAttention(f.world, f.ada)).toBe(true);
  expect(f.entries.filter(entry => ["llm_decision", "cognition_integrated"].includes(entry.type))).toEqual([]);
});

test.each(["stop", "owner"])("a %s-stale asynchronous response cannot publish either authored thought or its action", async cause => {
  const f = fixture(); let resolve!: (value: { text: string }) => void;
  generate.mockImplementation(() => new Promise(done => { resolve = done; }));
  const pending = agentThink(f.world, f.ada);
  if (cause === "stop") stopCommittedEvents(f.world);
  else WorkingMemoryIdentity.id[f.ada] = "replacement-owner";
  resolve(response("PRIVATE: A thought based on obsolete authority."));
  const action = await pending; expect(isDiscardedForegroundDecision(action)).toBe(true);
  executeActions(f.world, [{ eid: f.ada, action }], f.registry);
  expect(getDirectContainer(f.world, f.key)).not.toBe(f.ada);
  expect(f.thoughts()).toEqual([f.previous]); expect(f.onThought).toHaveBeenCalledTimes(1);
  expect(f.entries.filter(entry => ["llm_decision", "cognition_integrated"].includes(entry.type))).toEqual([]);
});
