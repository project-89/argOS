import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createObjectEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { LastAction, Needs, ObjectState, Perception, Traits, WorkingMemoryIdentity } = await import("../../ecs/components");
const { setLocatedIn } = await import("../../ecs/location");
const { advanceSimulationTimeline } = await import("../../runtime/simulation-timeline");
const { getCommittedEvents, startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { withSimulationTask } = await import("../../runtime/task-scope");
const { executeActions, runActorControlStep, runCognitionCycle, hasPendingCognitionStimuli } = await import("../cognition-system");
const { agentThink, addPerception, getAgentPerceptions, hasUnintegratedAttention } = await import("../agent-mind");
const { getForegroundCognitionReadiness, getListeningActivities, isContinuingListeningProgress, recordCognitionOutcome } = await import("../idle-cognition");
const { getSocialDialogue, getSocialSpeechFragments, isInvalidHeardSpeechNotice } = await import("../social-memory");
const { clearTimedSpeech, estimateSpeechDurationMs, getSpeakingActivity, interruptTimedSpeech } = await import("../timed-speech");
const { queueStimulus, drainPendingStimuli, peekPendingStimuli } = await import("../stimulus-queue");
const { filterPerceivableStimuli } = await import("../sensory-capabilities");
const { isDiscardedForegroundDecision } = await import("../foreground-action-admission");

const words = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen.";
const worlds: ReturnType<typeof createArgosWorld>[] = [];
let previousKey: string | undefined;
beforeEach(() => {
  previousKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  jest.useFakeTimers(); jest.setSystemTime(1_000_000); drainPendingStimuli(); generate.mockReset();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Listening tests must remain offline"));
});
afterEach(() => {
  for (const world of worlds.splice(0)) clearTimedSpeech(world);
  drainPendingStimuli(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); jest.useRealTimers();
  if (previousKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = previousKey;
});
function fixture(content = words, start = 0) {
  const world = createArgosWorld("Continuing listening"); worlds.push(world); initializePrefabs(world);
  world.meta.aiEnabled = true; world.meta.timedSpeech = true;
  const registry = createSystemRegistry(), room = createRoomEntity(world, { name: "Lounge" }), away = createRoomEntity(world, { name: "Kitchen" });
  const actor = (name: string, roomId = room) => createAgentEntity(world, { name, role: "friend", systemPrompt: "Act from experience", roomId });
  const ada = actor("Ada"), bo = actor("Bo"), cy = actor("Cy", away);
  const lamp = createObjectEntity(world, { name: "Lamp", roomId: room });
  const advance = (delta: number) => advanceSimulationTimeline(world, delta, { integrate: () => {} });
  if (start) advance(start);
  executeActions(world, [{ eid: ada, action: { type: "speak", target: "Bo", content } }], registry);
  const executionId = getSpeakingActivity(world, ada)!.executionId;
  advance(700); drainPendingStimuli();
  const listen = () => executeActions(world, [{ eid: bo, action: { type: "wait", listeningTo: executionId } }], registry);
  const perceptions = () => getAgentPerceptions(world, bo).map(id => Perception.content[id]);
  return { world, registry, room, away, ada, bo, cy, lamp, advance, executionId, listen, perceptions };
}

test("a listening follow-up waits through word progress and requests fresh review on interruption", async () => {
  const f = fixture();
  const { createIntentGoal } = await import("../cognition-system");
  const { snapshotActorContinuation, settleNextPurpose, reconsiderNextPurposeAfterWait } = await import("../actor-continuation");
  const { selectFastAgentAction } = await import("../agent-mind");
  const { isDiscardedForegroundDecision } = await import("../foreground-action-admission");
  const goal = createIntentGoal(f.world,f.bo,"Consider whether to investigate the lamp",6);
  generate.mockResolvedValue({ text: JSON.stringify({control:{version:2,goalId:null,purpose:"Listen before considering my other concern",localDependencies:[],
    nextPurpose:{goalId:goal,purpose:"Consider the lamp"}},action:{type:"wait",listeningTo:f.executionId}}) });
  const action = await agentThink(f.world,f.bo);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  const before = snapshotActorContinuation(f.world,f.bo)!.nextPurpose!;
  reconsiderNextPurposeAfterWait(f.world,f.bo); // A draft is not an executed wait.
  settleNextPurpose(f.world,f.bo,{type:"wait",foregroundDecisionId:"unrelated"},{succeeded:true,pending:false});
  expect(snapshotActorContinuation(f.world,f.bo)!.nextPurpose).toEqual(before);
  executeActions(f.world,[{eid:f.bo,action}],f.registry); drainPendingStimuli();
  expect(getForegroundCognitionReadiness(f.world,f.bo).ready).toBe(false);
  f.advance(200); drainPendingStimuli(); selectFastAgentAction(f.world,f.bo);
  expect(snapshotActorContinuation(f.world,f.bo)?.nextPurpose?.status).toBe("after_step");
  interruptTimedSpeech(f.world,f.ada,"Changed my mind");
  selectFastAgentAction(f.world,f.bo);
  expect(snapshotActorContinuation(f.world,f.bo)?.nextPurpose).toMatchObject({id:before.id,status:"ready",outcome:"reconsider"});
  // Readiness grants no future command or successful answer.
  expect(LastAction.type[f.bo]).toBe("wait");
});

test.each(["actor", "batch"])("%s intake retains exact heard evidence without reconsidering the same listen at117s before118.96s end", async intake => {
  const duration = estimateSpeechDurationMs(words), start = 118_960 - duration;
  const f = fixture(words, start); f.listen();
  f.advance(117_000 - start - 700);
  const notice = peekPendingStimuli(f.bo).find(event => event.type === "speech_fragment")!;
  expect(notice.hearing?.boundary).toBe("progress");
  expect(isContinuingListeningProgress(f.world, f.bo, notice)).toBe(true);
  expect(filterPerceivableStimuli(f.world, f.bo, [notice])[0].hearing).toBe(notice.hearing);
  expect(hasPendingCognitionStimuli(f.world, f.bo)).toBe(false);
  if (intake === "actor") expect(runActorControlStep(f.world, f.bo, f.registry)).toBe(false);
  else expect(await runCognitionCycle(f.world, f.registry, { agentEids: [f.bo] })).toEqual([]);
  expect(peekPendingStimuli(f.bo)).toEqual([]);
  expect(f.perceptions()).toContain(notice.content);
  expect(hasUnintegratedAttention(f.world, f.bo)).toBe(false);
  expect(getForegroundCognitionReadiness(f.world, f.bo)).toMatchObject({ ready: false, reason: "quiet", nextCheckAtMs: 118_960,
    listening: { executionIds: [f.executionId], explicit: true } });
  expect(getSocialDialogue(f.world, f.bo)).toEqual([]);
  expect(getSocialSpeechFragments(f.world, f.bo)[0].content).not.toContain("fourteen");
  expect(generate).not.toHaveBeenCalled();
  f.advance(1960);
  expect(hasPendingCognitionStimuli(f.world, f.bo)).toBe(true);
  expect(getForegroundCognitionReadiness(f.world, f.bo).ready).toBe(true);
  expect(getSocialDialogue(f.world, f.bo)[0].content).toBe(words);
});

test.each(["sentence", "stop", "speaker leaves", "listener leaves", "hearing lost", "new speaker", "new attention", "critical need", "physical change"])("explicit listening stays interruptible: %s", cause => {
  const f = fixture(cause === "sentence" ? "one two three four. Five six seven eight nine ten eleven twelve." : words); f.listen();
  if (cause === "sentence") f.advance(1500);
  if (cause === "stop") interruptTimedSpeech(f.world, f.ada, "changed my mind");
  if (cause === "speaker leaves") setLocatedIn(f.world, f.ada, f.away);
  if (cause === "listener leaves") setLocatedIn(f.world, f.bo, f.away);
  if (cause === "hearing lost") Traits.active[f.bo] = JSON.stringify(["deaf"]);
  if (cause === "new speaker") {
    setLocatedIn(f.world, f.cy, f.room);
    executeActions(f.world, [{ eid: f.cy, action: { type: "speak", content: "Wait!", speechMode: "interrupt" } }], f.registry);
    f.advance(500);
  }
  if (cause === "new attention") queueStimulus(f.world, { targetEid: f.bo, type: "attention", content: "A new vibration", source: "phone" });
  if (cause === "critical need") Needs.hunger[f.bo] = 90;
  if (cause === "physical change") ObjectState.current[f.lamp] = "broken";
  expect(getForegroundCognitionReadiness(f.world, f.bo, { hasPendingStimuli: hasPendingCognitionStimuli(f.world, f.bo) }).ready).toBe(true);
});

test.each(["owner", "source", "stopped", "payload", "wrong listener", "world", "clock rewind"])("authentic but invalid %s receipt never becomes new perception", cause => {
  const f = fixture(); f.listen(); f.advance(3600);
  const notice = drainPendingStimuli(new Set([f.bo]))[0]; expect(notice.hearing).toBeDefined();
  let target = f.bo, world = f.world;
  if (cause === "owner") WorkingMemoryIdentity.id[f.bo] = "replacement-owner";
  if (cause === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (cause === "stopped") stopCommittedEvents(f.world);
  if (cause === "payload") notice.content = "A different and urgent statement";
  if (cause === "wrong listener") target = f.cy;
  if (cause === "world") world = createArgosWorld("different runtime");
  if (cause === "clock rewind") f.world.time.elapsed = 0;
  expect(isInvalidHeardSpeechNotice(world, target, notice)).toBe(true);
  expect(isContinuingListeningProgress(world, target, notice)).toBe(false);
  expect(addPerception(world, target, notice)).toBe(-1);
});

test("forged receipt metadata cannot suppress a real unbound cue; a departed speaker's genuine heard prefix remains owned evidence", () => {
  const f = fixture(); f.listen(); f.advance(3600);
  const notice = drainPendingStimuli(new Set([f.bo]))[0];
  const forged = { ...notice, hearing: { ...notice.hearing! } };
  expect(isInvalidHeardSpeechNotice(f.world, f.bo, forged)).toBe(false);
  expect(isContinuingListeningProgress(f.world, f.bo, forged)).toBe(false);
  queueStimulus(f.world, forged); expect(hasPendingCognitionStimuli(f.world, f.bo)).toBe(true); drainPendingStimuli();
  setLocatedIn(f.world, f.ada, f.away);
  expect(isInvalidHeardSpeechNotice(f.world, f.bo, notice)).toBe(false);
  expect(isContinuingListeningProgress(f.world, f.bo, notice)).toBe(false);
  expect(addPerception(f.world, f.bo, notice)).toBeGreaterThanOrEqual(0);
  expect(f.perceptions()).toContain(notice.content);
});

test("stale queued hearing is discarded by both intake paths, including interrupted-prefix end notices", async () => {
  const f = fixture(); f.listen(); interruptTimedSpeech(f.world, f.ada, "stopped early");
  const notice = drainPendingStimuli(new Set([f.bo]))[0]; expect(notice.hearing?.boundary).toBe("end");
  WorkingMemoryIdentity.id[f.bo] = "replacement-owner";
  queueStimulus(notice); runActorControlStep(f.world, f.bo, f.registry, { deliberating: true });
  expect(f.perceptions()).not.toContain(notice.content);
  queueStimulus(notice); stopCommittedEvents(f.world);
  expect(await runCognitionCycle(f.world, f.registry, { agentEids: [f.bo], maxAgents: 0 })).toEqual([]);
  expect(peekPendingStimuli(f.bo)).toEqual([]);
  expect(f.perceptions()).not.toContain(notice.content);
  expect(addPerception(f.world, f.bo, notice)).toBe(-1);
});

test("an explicit listen has a30s safety ceiling even on a longer unfinished actual utterance", () => {
  const f = fixture(Array.from({ length: 100 }, () => "word").join(" ")); f.listen();
  expect(getForegroundCognitionReadiness(f.world, f.bo)).toMatchObject({ nextCheckAtMs: 30_700,
    listening: { explicit: true, untilSimMs: 30_700 } });
  f.advance(30_000);
  expect(getSpeakingActivity(f.world, f.ada)?.executionId).toBe(f.executionId);
  expect(getForegroundCognitionReadiness(f.world, f.bo)).toMatchObject({ ready: true, reason: "idle_deadline" });
});

test("ordinary visual inspection is not silently reinterpreted as listening", () => {
  const f = fixture(); executeActions(f.world, [{ eid: f.bo, action: { type: "observe", target: "Ada", content: "listen to Ada" } }], f.registry);
  f.advance(1500);
  expect(getForegroundCognitionReadiness(f.world, f.bo).listening).toBeUndefined();
  expect(LastAction.type[f.bo]).toBe("observe");
});

test("listening catalog and model selection are heard/local only and exact action binding prevents later retargeting", async () => {
  const f = fixture();
  expect(getListeningActivities(f.world, f.cy)).toEqual([]);
  generate.mockResolvedValue({ text: JSON.stringify({ innerThought: "Let me hear the rest.",
    control: { version: 2, purpose: "Listen to Ada", goalId: null, localDependencies: [] },
    action: { type: "wait", listeningTo: f.executionId } }) });
  const action = await agentThink(f.world, f.bo);
  expect(isDiscardedForegroundDecision(action)).toBe(false); expect(action.listeningTo).toBe(f.executionId);
  const sent = JSON.stringify(generate.mock.calls[0][0]);
  expect(sent).toContain("Observe is a visual inspection");
  expect(sent).not.toContain(words);
  expect(generate.mock.calls[0][0].messages[0].content).toContain(JSON.stringify({ type: "wait", listeningTo: f.executionId }));
  expect(generate.mock.calls[0][0].messages[0].content).toContain("never put it in target or content");
  action.listeningTo = "different-execution";
  executeActions(f.world, [{ eid: f.bo, action }], f.registry);
  expect(getForegroundCognitionReadiness(f.world, f.bo).listening).toBeUndefined();
});

test.each(["content", "target"])("a listeningTo instruction misplaced in %s remains ordinary text, never an explicit binding", async field => {
  const f = fixture();
  generate.mockResolvedValue({ text: JSON.stringify({
    control: { version: 2, purpose: "Listen to Ada", goalId: null, localDependencies: [] },
    action: { type: "wait", [field]: `listeningTo:${f.executionId}` } }) });
  const action = await agentThink(f.world, f.bo);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(action.listeningTo).toBeUndefined();
  executeActions(f.world, [{ eid: f.bo, action }], f.registry);
  expect(getForegroundCognitionReadiness(f.world, f.bo).listening?.explicit).not.toBe(true);
});

test("canceled scope cannot clear or replace an accepted listen or intake its progress", async () => {
  const f = fixture(); f.listen(); const before = getForegroundCognitionReadiness(f.world, f.bo);
  const controller = new AbortController();
  await withSimulationTask(controller.signal, async () => {
    controller.abort();
    expect(() => recordCognitionOutcome(f.world, f.bo, { type: "observe" }, { succeeded: true, pending: false })).toThrow();
    expect(() => runActorControlStep(f.world, f.bo, f.registry)).toThrow();
  });
  expect(getForegroundCognitionReadiness(f.world, f.bo)).toEqual(before);
});
