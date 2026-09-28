import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } = await import("../../ecs/prefabs");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { getDirectContainer } = await import("../../ecs/location");
const { ObjectState } = await import("../../ecs/components");
const { advanceSimulationTimeline, clearSimulationTimeline } = await import("../../runtime/simulation-timeline");
const { getCommittedEvents } = await import("../../runtime/committed-events");
const { getSpeakingActivity, isSpeaking, clearTimedSpeech, estimateSpeechDurationMs } = await import("../timed-speech");
const { agentThink, addPerception, getAgentThoughts } = await import("../agent-mind");
const { executeActions } = await import("../cognition-system");
const { getSocialDialogue, getSocialSpeechFragments, getCompletedContributions, formatSocialMemoryContext } = await import("../social-memory");
const { isDiscardedForegroundDecision, bindForegroundAction, captureForegroundDecisionFence } = await import("../foreground-action-admission");
const { drainPendingStimuli } = await import("../stimulus-queue");
const { registerAgentWorldCapabilities } = await import("../world-capabilities");
import type { AgentAction } from "../agent-mind";

const worlds: ReturnType<typeof createArgosWorld>[] = [];
let priorKey: string | undefined;
beforeEach(() => {
  priorKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset(); drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Speech cognition tests stay offline"));
});
afterEach(() => {
  for (const world of worlds.splice(0)) { clearTimedSpeech(world); clearSimulationTimeline(world); }
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli();
  if (priorKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = priorKey;
});
function fixture() {
  const world = createArgosWorld("Conversation"); worlds.push(world); world.meta.aiEnabled = true; world.meta.timedSpeech = true;
  initializePrefabs(world); const registry = createSystemRegistry();
  const room = createRoomEntity(world, { name: "Workshop" });
  const actor = (name: string) => createAgentEntity(world, { name, roomId: room, role: "resident", systemPrompt: "Act from your own perceptions." });
  const ada = actor("Ada"), bo = actor("Bo"), cy = actor("Cy");
  const control = createObjectEntity(world, { name: "Control", roomId: room, portable: true }); ObjectState.current[control] = "powered";
  const dispatch = (eid: number, action: AgentAction) => executeActions(world, [{ eid, action }], registry);
  const advance = (ms: number) => advanceSimulationTimeline(world, ms, { integrate: () => {} });
  return { world, registry, room, ada, bo, cy, control, dispatch, advance };
}
const statement = "The control is powered and every switch is ready for the next part of our experiment.";

test("a completed contribution keeps its original private purpose, not a later thought or listener inference", async () => {
  const f = fixture();
  generate.mockResolvedValue({ text: JSON.stringify({ innerThought: "I need reassurance", control: { version: 1, purpose: "PRIVATE: Seek reassurance without admitting my fear", localDependencies: [] },
    action: { type: "speak", target: "Bo", content: statement } }) });
  const action = await agentThink(f.world, f.ada); f.dispatch(f.ada, action);
  expect(getCompletedContributions(f.world, f.ada)).toEqual([]);
  f.advance(500);
  generate.mockResolvedValue({ text: JSON.stringify({ innerThought: "Now something else", control: { version: 1, purpose: "A different private purpose", localDependencies: [] }, action: { type: "wait" } }) });
  await agentThink(f.world, f.ada);
  f.advance(10_000);
  expect(getCompletedContributions(f.world, f.ada)).toMatchObject([{ purpose: "PRIVATE: Seek reassurance without admitting my fear", turn: { content: statement, own: true } }]);
  expect(formatSocialMemoryContext(f.world, f.ada)).toContain("POINTS YOU ALREADY CONTRIBUTED");
  expect(formatSocialMemoryContext(f.world, f.bo)).not.toContain("PRIVATE:");
  expect(getCompletedContributions(f.world, f.bo)).toEqual([]);
  expect(JSON.stringify(getCommittedEvents(f.world).events)).not.toContain("PRIVATE:");
});

test("an interrupted speech has no completed contribution even when its prefix was heard", async () => {
  const f = fixture();
  generate.mockResolvedValue({ text: JSON.stringify({ innerThought: "Explain", control: { version: 1, purpose: "Explain the entire setup", localDependencies: [] }, action: { type: "speak", target: "Bo", content: statement } }) });
  const action = await agentThink(f.world, f.ada); f.dispatch(f.ada, action); f.advance(500);
  const speech = getSpeakingActivity(f.world, f.ada)!;
  const { interruptTimedSpeech } = await import("../timed-speech");
  interruptTimedSpeech(f.world, f.ada, "self_correction", { executionId: speech.executionId });
  f.advance(10_000); expect(getCompletedContributions(f.world, f.ada)).toEqual([]);
});

test("parallel normal speeches take one floor and denied scripts never start later", () => {
  const f = fixture();
  executeActions(f.world, [f.ada, f.bo, f.cy].map(eid => ({ eid, action: { type: "speak", content: "The control is powered." } as AgentAction })), f.registry);
  expect([f.ada, f.bo, f.cy].filter(eid => isSpeaking(f.world, eid))).toEqual([f.ada]);
  f.advance(10000);
  expect(getCommittedEvents(f.world).events.filter(e => e.kind === "speech" && e.status === "pending")).toHaveLength(1);
  expect(getSocialDialogue(f.world, f.bo).filter(turn => turn.own)).toHaveLength(0);
});

test("the recent speaker yields space for another normal reply; urgent interruption is explicit", () => {
  const f = fixture(); f.dispatch(f.ada, { type: "speak", content: "Hello Bo." });
  f.advance(estimateSpeechDurationMs("Hello Bo.") + 250);
  f.dispatch(f.ada, { type: "speak", content: "And another paragraph." }); expect(isSpeaking(f.world, f.ada)).toBe(false);
  f.dispatch(f.bo, { type: "speak", content: statement }); expect(isSpeaking(f.world, f.bo)).toBe(true);
  f.dispatch(f.cy, { type: "speak", content: "Stop!", speechMode: "interrupt" }); expect(isSpeaking(f.world, f.cy)).toBe(true);
});

test("a model-chosen correction stops the exact old voice and delivers only the real prefix", async () => {
  const f = fixture(), after = jest.fn();
  registerAgentWorldCapabilities(f.world, f.ada, { context: () => "", ready: () => true, busy: () => false,
    execute: () => false, afterAction: after });
  f.dispatch(f.ada, { type: "speak", target: "Bo", content: statement }); f.advance(1100);
  const original = getSpeakingActivity(f.world, f.ada)!;
  ObjectState.current[f.control] = "unpowered";
  addPerception(f.world, f.ada, { type: "attention", source: "local world", content: "The control goes dark." });
  generate.mockResolvedValueOnce({ text: JSON.stringify({ innerThought: "Wait, that just changed.", action: {
    type: "speak", target: "Bo", content: "No, it's off now.", stopSpeaking: true } }) });
  const action = await agentThink(f.world, f.ada);
  expect(action.stopSpeechId).toBe(original.executionId); expect(getAgentThoughts(f.world, f.ada)).toHaveLength(0);
  f.dispatch(f.ada, action);
  expect(getSpeakingActivity(f.world, f.ada)?.executionId).not.toBe(original.executionId);
  const heard = getSocialSpeechFragments(f.world, f.bo).find(row => row.executionId === original.executionId)!;
  expect(heard.content).toBe(original.spokenText); expect(heard.notifiedLength).toBe(heard.content.length);
  f.advance(10000);
  expect(getSocialDialogue(f.world, f.bo).map(turn => turn.content)).toEqual(["No, it's off now."]);
  expect(getCommittedEvents(f.world).events.filter(e => e.executionId === original.executionId && e.completedAtSimMs !== undefined)
    .map(e => e.status)).toEqual(["failed"]);
  expect(after.mock.calls.find(([, success, pending]) => success === false && !pending)?.[0].content).toBe(original.spokenText);
  expect(after.mock.calls.filter(([, , pending]) => pending).every(([action]) => action.content === "")).toBe(true);
  expect(getAgentThoughts(f.world, f.ada)).toHaveLength(1);
});

test("a stale self-stop cannot cut a replacement voice", () => {
  const f = fixture(); f.dispatch(f.ada, { type: "speak", content: "Old sentence." });
  const old = getSpeakingActivity(f.world, f.ada)!;
  f.advance(estimateSpeechDurationMs("Old sentence.") + 1750);
  f.dispatch(f.ada, { type: "speak", content: statement }); const current = getSpeakingActivity(f.world, f.ada)!;
  f.dispatch(f.ada, { type: "wait", stopSpeechId: old.executionId });
  expect(getSpeakingActivity(f.world, f.ada)?.executionId).toBe(current.executionId);
});

test("mutating a signed proposal's speech controls cannot grant interruption authority", () => {
  const f = fixture(); f.dispatch(f.ada, { type: "speak", content: statement });
  const action = bindForegroundAction(f.world, f.ada, captureForegroundDecisionFence(f.world, f.ada)!, { type: "wait" }, "Keep listening.");
  action.stopSpeechId = getSpeakingActivity(f.world, f.ada)!.executionId;
  f.dispatch(f.ada, action); expect(isSpeaking(f.world, f.ada)).toBe(true);
});

test.each(["speak", "pickup"] as const)("a newly heard coherent span invalidates %s interpretation without blocking independent body work", async type => {
  const f = fixture(); f.dispatch(f.bo, { type: "speak", content: "The first part sounds fine but actually the control is broken and needs to be replaced before tomorrow morning." });
  f.advance(2300);
  let reply!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
  const pending = agentThink(f.world, f.ada);
  f.advance(2000);
  reply({ text: JSON.stringify({ innerThought: "Everything sounds fine.", action: { type, target: type === "speak" ? "Bo" : "Control", content: type === "speak" ? "Great, all ready." : undefined } }) });
  const action = await pending;
  if (type === "speak") expect(isDiscardedForegroundDecision(action)).toBe(true);
  else { f.dispatch(f.ada, action); expect(getDirectContainer(f.world, f.control)).toBe(f.ada); }
  expect(getAgentThoughts(f.world, f.ada)).toHaveLength(0);
});
