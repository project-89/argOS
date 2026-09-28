import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { getRelationTargets, addComponent, addEntity, removeEntity } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { createSystemRegistry, registerSystem, runSystems } = await import("../../ecs/dynamic-systems");
const { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } = await import("../../ecs/prefabs");
const { ObjectState, Appearance, Thought, Goal, Schedule, WorkingMemoryIdentity, Plan, CognitiveControl, BehaviorPolicy } = await import("../../ecs/components");
const { createGeneratedIntention } = await import("../goal-lifecycle");
const { workingMemoryEntityRef } = await import("../working-memory");
const { HasGoal, HasSchedule } = await import("../../ecs/relations");
const { createScheduledActivityGoalSystem } = await import("../../systems/scheduled-activity-systems");
const { setLocatedIn, getDirectContainer } = await import("../../ecs/location");
const { agentThink, addPerception, getAgentThoughts, hasUnintegratedAttention, selectFastAgentAction } = await import("../agent-mind");
const { cognitionController, parseCognitionController } = await import("../decision-policy");
const { captureIntentionReconsideration, prepareIntentionReconsideration } = await import("../intention-reconsideration");
const { executeActions, runActorControlStep, runCognitionCycle, createIntentGoal } = await import("../cognition-system");
const { snapshotForegroundCognitionDiagnostics } = await import("../idle-cognition");
const { createPlanEntity } = await import("../planning-system");
const { getActorWaitTiming, snapshotActorWait } = await import("../actor-wait");
const { registerAgentWorldCapabilities } = await import("../world-capabilities");
const { snapshotActorContinuation } = await import("../actor-continuation");
const { snapshotOngoingActivity } = await import("../ongoing-activity");
const { snapshotAttentionSignals } = await import("../unresolved-attention");
const { recordCommittedSpeech, getSocialDialogue } = await import("../social-memory");
const { snapshotExperienceAppraisal, queueExperiencedEvent, runExperienceAppraisal } = await import("../experience-appraisal");
const { snapshotActivityReview } = await import("../activity-review");
const { beginTimedSpeech, clearTimedSpeech, getSpeakingActivity, readLocalSpeechOpportunity } = await import("../timed-speech");
const { advanceSimulationTimeline, clearSimulationTimeline, reserveSimulationResources, releaseSimulationResources } = await import("../../runtime/simulation-timeline");
const { chronicle } = await import("../simulation-chronicle");
const { startCommittedEvents, stopCommittedEvents, getCommittedEvents } = await import("../../runtime/committed-events");
const { isDiscardedForegroundDecision, pollForegroundContinuation, consumeForegroundAction, deferIntegratedForegroundSpeech } = await import("../foreground-action-admission");
const { queueStimulus, drainPendingStimuli } = await import("../stimulus-queue");
const { initializeTaskQueue, queueTask, startTaskQueue, stopTaskQueue, getTaskStatus } = await import("../../runtime/async-task-queue");
const { createSimulation, registerFastSystem, registerAIOperation, startSimulation, stopSimulation, drainSimulationOperations } = await import("../../runtime/simulation-loop");
const { drainBaselineWork, finalizeBaselineObservation } = await import("../../evals/baseline-evidence-journal");
const { evaluateForegroundAttempts } = await import("../../evals/foreground-attempt-evaluation");
const { serializeWorld, deserializeWorld } = await import("../../persistence/world-persistence");
import type { AgentAction } from "../agent-mind";

const worlds: ReturnType<typeof createArgosWorld>[] = [];
let oldKey: string | undefined;
beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset(); drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Controller regressions must remain offline"));
});
afterEach(() => {
  for (const world of worlds.splice(0)) { clearTimedSpeech(world); clearSimulationTimeline(world); stopCommittedEvents(world); }
  drainPendingStimuli(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey;
});
function fixture() {
  const world = createArgosWorld("Noisy room controller"); initializePrefabs(world); worlds.push(world); world.meta.aiEnabled = true;
  const room = createRoomEntity(world, { name: "Hall" }), elsewhere = createRoomEntity(world, { name: "Kitchen" });
  const person = (name: string) => createAgentEntity(world, { name, role: "resident", systemPrompt: "Act on your own motives and observations.", roomId: room });
  const ada = person("Ada"), bo = person("Bo"), cy = person("Cy");
  const key = createObjectEntity(world, { name: "Key", roomId: room, portable: true, traits: ["takeable"] });
  const display = createObjectEntity(world, { name: "Display", roomId: room }); ObjectState.current[display] = "dark";
  const registry = createSystemRegistry();
  const advance = (ms: number) => advanceSimulationTimeline(world, ms, { integrate: () => {} });
  const dispatch = (action: AgentAction) => executeActions(world, [{ eid: ada, action }], registry);
  return { world, room, elsewhere, ada, bo, cy, key, display, registry, advance, dispatch };
}
function response(action: Partial<AgentAction> = {}, extra: Record<string, unknown> = {}) {
  return { text: JSON.stringify({ innerThought: "I want to tell Bo what happened to me.",
    control: { version: 1, purpose: "Tell Bo about my experience", localDependencies: [] },
    action: { type: "speak", target: "Bo", content: "Something happened to me that I need to share.", ...action }, ...extra }) };
}

test("shutdown drains real cognition-finally telemetry before disposing its observer, without publishing a late thought", async () => {
  jest.useFakeTimers();
  const f = fixture(), timings: Array<{ type: string; data: Record<string, unknown>; observedWallMs: number }> = [];
  const unsubscribe = chronicle.subscribe(e => { if (e.type.startsWith("foreground_")) timings.push({ type: e.type, data: e.data ?? {}, observedWallMs: 100 }); });
  const runtime = createSimulation(f.world, f.registry, {} as any, { ecsTickRate: 100, logTickStats: false });
  try {
    initializeTaskQueue({ processInterval: 10, foregroundMaxConcurrent: 2 });
    generate.mockImplementation(() => new Promise((_, reject) => setTimeout(() => reject(Error("Aborted provider request")), 80)));
    registerAIOperation(runtime, { name: "real foreground", interval: 1, lane: "foreground", execute: () => agentThink(f.world, f.ada) });
    startSimulation(runtime); await jest.advanceTimersByTimeAsync(30);
    expect(generate).toHaveBeenCalledTimes(1);
    const before = f.world.time.elapsed;
    const done = finalizeBaselineObservation({ checkpoint: () => {}, lifecycle: () => {},
      stop: () => { stopSimulation(runtime); stopCommittedEvents(f.world); },
      drain: () => drainBaselineWork(() => drainSimulationOperations(runtime), async () => {}), disposers: [unsubscribe] });
    expect(evaluateForegroundAttempts(timings, 200).complete).toBe(false);
    await jest.advanceTimersByTimeAsync(100); expect(await done).toEqual([]);
    const result = evaluateForegroundAttempts(timings, 200);
    expect(result).toMatchObject({ complete: true, count: 1, completed: 1, pending: 0 });
    expect(result.attempts[0].providerOutcome).toBe("cancelled");
    expect(f.world.time.elapsed).toBe(before); expect(getAgentThoughts(f.world, f.ada)).toEqual([]);
    expect(getSocialDialogue(f.world, f.bo)).toEqual([]);
  } finally { stopSimulation(runtime); unsubscribe(); stopTaskQueue(); jest.useRealTimers(); }
});

test.each([undefined, "   "])("a model-authored think action publishes once when innerThought is %s", async innerThought => {
  const f = fixture(); f.advance(1200);
  generate.mockResolvedValue(response({ type: "think", target: undefined, content: "  That bakery reminds me of home.  " }, { innerThought }));
  const action = await agentThink(f.world, f.ada);
  const thoughts = getAgentThoughts(f.world, f.ada);
  expect(thoughts).toHaveLength(1);
  expect(Thought.content[thoughts[0]]).toBe("  That bakery reminds me of home.  ");
  expect(Thought.type[thoughts[0]]).toBe("reasoning");
  expect(Thought.observedAtSimMs[thoughts[0]]).toBe(1200);
  f.dispatch(action); f.dispatch(action);
  expect(getAgentThoughts(f.world, f.ada)).toEqual(thoughts);
  expect(getCommittedEvents(f.world).events.some(e => JSON.stringify(e).includes("reminds me of home"))).toBe(false);
});

test("explicit innerThought wins over the think action content, without a duplicate thought", async () => {
  const f = fixture(); generate.mockResolvedValue(response({ type: "think", content: "Consider the route", target: undefined }, { innerThought: "I miss my old street." }));
  f.dispatch(await agentThink(f.world, f.ada));
  expect(getAgentThoughts(f.world, f.ada).map(eid => Thought.content[eid])).toEqual(["I miss my old street."]);
});

test("a cancelled model think and a deterministic plan instruction are not published monologue", async () => {
  const f = fixture();
  generate.mockImplementation(async () => { stopCommittedEvents(f.world); return response({ type: "think", content: "A cancelled thought", target: undefined }, { innerThought: undefined }); });
  const choice = await agentThink(f.world, f.ada); f.dispatch(choice);
  expect(getAgentThoughts(f.world, f.ada)).toEqual([]);
  startCommittedEvents(f.world);
  f.dispatch({ type: "think", content: "A plan step is not authored inner speech" });
  expect(getAgentThoughts(f.world, f.ada)).toEqual([]);
});

test("a foreground evidence wait survives a newly available background plan step", async () => {
  const f = fixture();
  const goal = createIntentGoal(f.world, f.ada, "Get ready for the evening", 5);
  generate.mockResolvedValue(response({ type: "wait", target: undefined, content: undefined,
    waitUntil: { kind: "heard_evidence", timeoutMs: 12000 } }, {
    innerThought: "I will listen for an answer.",
    control: { version: 2, purpose: "Listen for an answer before leaving", goalId: goal, localDependencies: [] },
  }));
  const choice = await agentThink(f.world, f.ada);
  expect(choice.type).toBe("wait");
  f.dispatch(choice);
  expect(getActorWaitTiming(f.world, f.ada)).toMatchObject({ deadlineMs: 12000 });
  const revision = snapshotActorContinuation(f.world, f.ada)?.revision;
  const plan = createPlanEntity(f.world, f.ada, goal, { goalDescription: "Get ready for the evening", steps: [
    { description: "Consider my readiness", actionType: "think", content: "Check readiness" },
  ] });
  const planStatus = Plan.status[plan];
  const planStep = Plan.currentStep[plan];
  f.advance(3000);
  const automatic = selectFastAgentAction(f.world, f.ada);
  // A background plan is available work, not permission to override a pause
  // the foreground actor chose. Only a fresh actor choice can replace it.
  expect(automatic).toBeNull();
  expect(Plan.status[plan]).toBe(planStatus);
  expect(Plan.status[plan]).not.toBe("completed");
  expect(Plan.currentStep[plan]).toBe(planStep);
  expect(snapshotActorContinuation(f.world, f.ada)?.revision).toBe(revision);
  expect(getActorWaitTiming(f.world, f.ada)).toMatchObject({ deadlineMs: 12000 });
  generate.mockResolvedValue(response({ type: "think", target: undefined, content: "I have changed my mind." }, {
    control: { version: 2, purpose: "Reconsider my evening", goalId: null, localDependencies: [] },
  }));
  f.dispatch(await agentThink(f.world, f.ada));
  expect(snapshotActorWait(f.world, f.ada)).toBeUndefined();
});

test("foreground dispatch records one typed admission and quiet scheduler probes do not inflate it", async () => {
  const f = fixture(); workingMemoryEntityRef(f.world, f.ada); startCommittedEvents(f.world);
  generate.mockResolvedValue(response({ type: "wait", target: undefined, content: undefined }));
  const selected = await runCognitionCycle(f.world, f.registry, { tick: f.ada, agentEids: [f.ada], enablePlanning: false });
  expect(selected).toHaveLength(1);
  expect(snapshotForegroundCognitionDiagnostics(f.world, f.ada)).toMatchObject({ admissions: 1,
    lastAdmission: { ready: true, reason: "first_decision", atSimMs: 0 } });
  executeActions(f.world, selected, f.registry);
  for (let i = 0; i < 5; i++) expect(runActorControlStep(f.world, f.ada, f.registry)).toBe(false);
  expect(snapshotForegroundCognitionDiagnostics(f.world, f.ada)?.admissions).toBe(1);
  expect(generate).toHaveBeenCalledTimes(1);
});

test.each(["response", "dispatch"])("a speech proposal drafted during its own earlier utterance cannot replay its suffix after %s completion", async boundary => {
  const f = fixture(); f.world.meta.timedSpeech = true;
  expect(beginTimedSpeech(f.world, f.ada, "The signal is already on its way.", "own:original", () => {}, () => {})).toBe(true);
  f.advance(1100);
  generate.mockImplementation(async () => {
    if (boundary === "response") f.advance(5000);
    return response({ content: "already on its way." });
  });
  const action = await agentThink(f.world, f.ada);
  if (boundary === "dispatch") f.advance(5000);
  f.dispatch(action);
  expect(getSpeakingActivity(f.world, f.ada)).toBeUndefined();
  expect(getCommittedEvents(f.world).events.filter(event => event.kind === "speech" && event.status === "pending")).toHaveLength(0);
  if (boundary === "response") {
    expect(isDiscardedForegroundDecision(action)).toBe(true);
    expect(getAgentThoughts(f.world, f.ada)).toHaveLength(0);
  }
});

test("own word progress preserves a voluntary correction bound to the same speaking episode", async () => {
  const f = fixture(); f.world.meta.timedSpeech = true;
  expect(beginTimedSpeech(f.world, f.ada, "The signal is already on its way.", "own:original", () => {}, () => {})).toBe(true);
  generate.mockImplementation(async () => {
    f.advance(1100);
    return response({ content: "Wait, I meant the other signal.", stopSpeaking: true } as any);
  });
  const action = await agentThink(f.world, f.ada);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  f.dispatch(action);
  expect(getSpeakingActivity(f.world, f.ada)?.executionId).not.toBe("own:original");
  expect(getSpeakingActivity(f.world, f.ada)).toBeDefined();
});

test("an explicitly deferred proposal cannot resume after its original own-voice episode finishes", async () => {
  const f = fixture(); f.world.meta.timedSpeech = true;
  expect(beginTimedSpeech(f.world, f.ada, "The signal is already on its way.", "own:original", () => {}, () => {})).toBe(true);
  f.advance(1100); generate.mockResolvedValue(response({ content: "already on its way." }));
  const action = await agentThink(f.world, f.ada);
  expect(deferIntegratedForegroundSpeech(f.world, f.ada, action)).toBe(true);
  expect(snapshotActorContinuation(f.world, f.ada)?.status).toBe("waiting");
  f.advance(5000);
  expect(pollForegroundContinuation(f.world, f.ada)).not.toHaveProperty("action");
  expect(snapshotActorContinuation(f.world, f.ada)).toMatchObject({ status: "needs_revision", reason: "voice_changed" });
  expect(getSpeakingActivity(f.world, f.ada)).toBeUndefined();
});

test("own speech completion does not invalidate independent physical work", async () => {
  const f = fixture(); f.world.meta.timedSpeech = true;
  expect(beginTimedSpeech(f.world, f.ada, "The signal is already on its way.", "own:original", () => {}, () => {})).toBe(true);
  generate.mockImplementation(async () => {
    f.advance(5000);
    return response({ type: "pickup", target: "Key", content: undefined });
  });
  const action = await agentThink(f.world, f.ada); f.dispatch(action);
  expect(getDirectContainer(f.world, f.key)).toBe(f.ada);
});

test("fresh speech authored after completion may deliberately repeat words; admission is not text deduplication", async () => {
  const f = fixture(); f.world.meta.timedSpeech = true;
  expect(beginTimedSpeech(f.world, f.ada, "Please wait here.", "own:original", () => {}, () => {})).toBe(true);
  f.advance(5000);
  generate.mockResolvedValue(response({ content: "Please wait here." }));
  const action = await agentThink(f.world, f.ada); f.dispatch(action);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(getSpeakingActivity(f.world, f.ada)).toBeDefined();
});

test.each(["completed", "expired", "retired"])("cleaning a %s goal does not cancel a chosen action", async status => {
  const f = fixture(), old = createIntentGoal(f.world, f.ada, "Historical schedule", 8);
  Goal.status[old] = status;
  generate.mockResolvedValue(response());
  const action = await agentThink(f.world, f.ada);
  removeEntity(f.world, old); f.dispatch(action);
  expect(getSocialDialogue(f.world, f.bo).some(t => t.speaker === "Ada")).toBe(true);
});

test("activating a queued goal still invalidates a pending choice", async () => {
  const f = fixture(), future = createIntentGoal(f.world, f.ada, "Future appointment", 9);
  Goal.status[future] = "queued";
  generate.mockResolvedValue(response());
  const action = await agentThink(f.world, f.ada);
  Goal.status[future] = "active"; f.dispatch(action);
  expect(getSocialDialogue(f.world, f.bo)).toHaveLength(0);
  expect(snapshotActorContinuation(f.world, f.ada)?.reason).toBe("goal_changed");
});

test("a repeated identified signal stays audible without cancelling a pending action", async () => {
  const f = fixture(), signal = { type: "attention", source: "alarm", content: "An indicator keeps beeping.", signalKey: "alarm:one" };
  addPerception(f.world, f.ada, signal);
  generate.mockResolvedValue(response());
  const action = await agentThink(f.world, f.ada);
  addPerception(f.world, f.ada, signal);
  expect(hasUnintegratedAttention(f.world, f.ada)).toBe(false);
  f.dispatch(action);
  expect(getSocialDialogue(f.world, f.bo).some(t => t.speaker === "Ada")).toBe(true);
});

test("a new identified signal and another listener's first hearing still demand attention", async () => {
  const f = fixture(), signal = { type: "attention", source: "alarm", content: "An indicator keeps beeping.", signalKey: "alarm:one" };
  addPerception(f.world, f.ada, signal); generate.mockResolvedValue(response());
  const action = await agentThink(f.world, f.ada);
  addPerception(f.world, f.bo, signal); expect(hasUnintegratedAttention(f.world, f.bo)).toBe(true);
  addPerception(f.world, f.ada, { ...signal, signalKey: "alarm:two" }); f.dispatch(action);
  expect(getSocialDialogue(f.world, f.bo)).toHaveLength(0);
  expect(snapshotActorContinuation(f.world, f.ada)?.reason).toBe("source_changed");
});

test("foreground can select consequential heard words, not its own imagined speech, for appraisal", async () => {
  const f = fixture(); f.world.meta.experienceReconsideration = true;
  const heard = recordCommittedSpeech(f.world, f.bo, "I have lost my home.", "Ada")!;
  generate.mockResolvedValue(response({ type: "wait", content: undefined }, { appraiseSpeechIds: [heard.id] }));
  await agentThink(f.world, f.ada);
  expect(snapshotExperienceAppraisal(f.world, f.ada)).toMatchObject({ pending: 1, handled: 0 });
  expect(snapshotExperienceAppraisal(f.world, f.bo)).toBeUndefined();
  expect(generate).toHaveBeenCalledTimes(1); // Selection costs no screening call.
});

test("an in-flight rich appraisal neither owns the immediate decision slot nor overwrites the resulting purpose", async () => {
  const f = fixture(); startCommittedEvents(f.world); workingMemoryEntityRef(f.world, f.ada);
  queueExperiencedEvent(f.world, f.ada, { id: "receipt:1", channel: "letter", source: "Bo", content: "Our meeting is cancelled.", atSimMs: 0 });
  let release!: (value: { text: string }) => void, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  generate.mockImplementationOnce(() => { started(); return new Promise(resolve => { release = resolve; }); });
  const reflection = runExperienceAppraisal(f.world, f.ada);
  await Promise.race([entered, reflection.then(result => { throw new Error(`Appraisal returned before inference: ${JSON.stringify(result)}`); })]);
  try {
    expect(snapshotExperienceAppraisal(f.world, f.ada)?.inFlight).toBe(true);
    expect(runActorControlStep(f.world, f.ada, f.registry, { appraisalPending: true })).toBe(true);
    generate.mockResolvedValueOnce(response({ type: "wait", content: undefined }, { innerThought: "I need a moment to decide what I want now." }));
    const action = await agentThink(f.world, f.ada); f.dispatch(action);
    expect(snapshotActorContinuation(f.world, f.ada)?.purpose).toBe("Tell Bo about my experience");
  } finally { release({ text: JSON.stringify({ innerThought: "I thought the evening would go differently.",
    goalUpdate: { description: "Ask everyone to reschedule", priority: 9, kind: "social" } }) }); }
  expect(await reflection).toMatchObject({ status: "admitted", integration: "historical_only", omittedUpdatesReason: "continuing_purpose_changed" });
  expect(getRelationTargets(f.world, f.ada, HasGoal)).toEqual([]);
  expect(snapshotActorContinuation(f.world, f.ada)?.purpose).toBe("Tell Bo about my experience");
});

test("the existing version2 controller reviews completed contributions before continuing, without requiring a new topic", async () => {
  const f = fixture();
  const control = { version: 2, purpose: "Keep Bo company", goalId: null, localDependencies: [] };
  generate.mockResolvedValueOnce(response({ type: "wait", content: undefined }, { control }));
  f.dispatch(await agentThink(f.world, f.ada));
  // Both turns really completed; a private plan alone would not open review.
  const own = recordCommittedSpeech(f.world, f.ada, "I can stay with you.", "Bo", Date.now(), undefined, "Offer my company")!;
  const heard = recordCommittedSpeech(f.world, f.bo, "I would like that.", "Ada")!;
  recordCommittedSpeech(f.world, f.ada, "There is no hurry.", "Bo", Date.now(), undefined, "Let Bo take their time");
  f.advance(20_000);
  generate.mockResolvedValueOnce(response({ type: "wait", content: undefined }, { control: { ...control,
    activityReview: { disposition: "continue", evidenceIds: [own.id, heard.id], reason: "Bo asked for company rather than solutions.", expectedProgress: "Stay present while Bo takes their time." } } }));
  const action = await agentThink(f.world, f.ada); f.dispatch(action);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(snapshotActivityReview(f.world, f.ada)).toMatchObject({ reviewCount: 1, expectedProgress: "Stay present while Bo takes their time." });
  expect(JSON.stringify(generate.mock.calls[1][0])).toContain("ACTIVITY REVIEW");
  expect(snapshotActorContinuation(f.world, f.ada)?.purpose).toBe("Keep Bo company");
});

test("unknown appraisal evidence rejects the whole proposed mental update", async () => {
  const f = fixture(); f.world.meta.experienceReconsideration = true;
  generate.mockResolvedValue(response({}, { appraiseSpeechIds: ["invented"], goalUpdate: { description: "Help Bo", priority: 9 } }));
  const action = await agentThink(f.world, f.ada);
  expect(isDiscardedForegroundDecision(action)).toBe(true);
  expect(getAgentThoughts(f.world, f.ada)).toHaveLength(0);
  expect(getRelationTargets(f.world, f.ada, HasGoal)).toHaveLength(0);
  expect(snapshotExperienceAppraisal(f.world, f.ada)).toBeUndefined();
});

test("unrelated room churn no longer erases a grounded thought or keeps the same attention novel", async () => {
  const f = fixture();
  addPerception(f.world, f.ada, { type: "attention", source: "phone", content: "I read a personally important message." });
  generate.mockImplementation(async () => {
    ObjectState.current[f.display] = "lit"; Appearance.expression[f.cy] = "frowning";
    return response();
  });
  const action = await agentThink(f.world, f.ada);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(getAgentThoughts(f.world, f.ada)).toHaveLength(1);
  expect(hasUnintegratedAttention(f.world, f.ada)).toBe(false);
  expect(getSocialDialogue(f.world, f.bo)).toHaveLength(0); // Thought is not speech.
  expect(snapshotActorContinuation(f.world, f.ada)).toMatchObject({ purpose: "Tell Bo about my experience", status: "proposed" });
  f.dispatch(action);
  expect(getSocialDialogue(f.world, f.bo).filter(turn => turn.speaker === "Ada")).toHaveLength(1);
  expect(snapshotActorContinuation(f.world, f.ada)?.status).toBe("dispatched");
  expect(generate).toHaveBeenCalledTimes(1);
});

test("a removed target invalidates the action, not the experience or newly chosen goal", async () => {
  const f = fixture();
  addPerception(f.world, f.ada, { type: "attention", source: "phone", content: "I need to prepare." });
  generate.mockImplementation(async () => {
    setLocatedIn(f.world, f.key, f.elsewhere);
    return response({ type: "pickup", target: "Key", content: undefined }, { goalUpdate: { description: "Prepare to leave", priority: 8 } });
  });
  const action = await agentThink(f.world, f.ada);
  expect(getRelationTargets(f.world, f.ada, HasGoal)).toHaveLength(1);
  expect(hasUnintegratedAttention(f.world, f.ada)).toBe(false);
  f.dispatch(action);
  expect(getDirectContainer(f.world, f.key)).toBe(f.elsewhere);
  expect(getAgentThoughts(f.world, f.ada)).toHaveLength(1);
  expect(snapshotActorContinuation(f.world, f.ada)).toMatchObject({ status: "needs_revision", reason: "target_changed" });
});

test("a newly integrated goal and undertaking do not invalidate their own first command", async () => {
  const f = fixture(), speech = recordCommittedSpeech(f.world, f.ada, "I will collect the key.", "Bo")!;
  generate.mockResolvedValue(response({ type: "pickup", target: "Key", content: undefined } as any, {
    goalUpdate: { description: "Collect the key", priority: 8 },
    coordinationReviews: [{ kind: "undertake", speechId: speech.id, task: "Collect the key", goalId: "new" }],
    action: { type: "pickup", target: "Key", goalId: "new", undertakingId: speech.id },
  }));
  const action = await agentThink(f.world, f.ada);
  expect(action.coordinationGoal).toBeDefined(); expect(action.coordinationWork).toBeDefined();
  f.dispatch(action);
  expect(getDirectContainer(f.world, f.key)).toBe(f.ada);
  expect(snapshotActorContinuation(f.world, f.ada)?.status).toBe("dispatched");
});

test("explicit local dependencies invalidate immediate words when their cited display changes", async () => {
  const f = fixture();
  generate.mockImplementation(async () => {
    const id = `entity:${WorkingMemoryIdentity.id[f.display]}`;
    ObjectState.current[f.display] = "lit";
    return response({ content: "That display is still dark." }, { control: { version: 1, purpose: "Discuss the display", localDependencies: [id] } });
  });
  const action = await agentThink(f.world, f.ada); f.dispatch(action);
  expect(getAgentThoughts(f.world, f.ada)).toHaveLength(1);
  expect(getSocialDialogue(f.world, f.bo)).toHaveLength(0);
  expect(snapshotActorContinuation(f.world, f.ada)).toMatchObject({ status: "needs_revision", reason: "local_view_changed" });
});

test.each(["bad-id", "duplicate", "wrong-version", "blank-purpose"])("invalid control contract %s cannot weaken legacy admission", async invalid => {
  const f = fixture(); generate.mockImplementation(async () => response({}, { control: {
    version: invalid === "wrong-version" ? 2 : 1, purpose: invalid === "blank-purpose" ? " " : "Talk",
    localDependencies: invalid === "bad-id" ? ["remote:hidden"] : invalid === "duplicate" ? ["room", "room"] : [],
  } }));
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.ada))).toBe(true);
  expect(getAgentThoughts(f.world, f.ada)).toHaveLength(0); expect(snapshotActorContinuation(f.world, f.ada)).toBeUndefined();
});

test("new relevant words require fresh wording but preserve the prior interpretation and leave new attention pending", async () => {
  const f = fixture(); addPerception(f.world, f.ada, { type: "attention", source: "phone", content: "I read my message." });
  generate.mockImplementation(async () => {
    recordCommittedSpeech(f.world, f.bo, "Are you all right?", "Ada");
    addPerception(f.world, f.ada, { type: "speech", source: "Bo", content: "Are you all right?" });
    return response();
  });
  const action = await agentThink(f.world, f.ada); f.dispatch(action);
  expect(getAgentThoughts(f.world, f.ada)).toHaveLength(1);
  expect(hasUnintegratedAttention(f.world, f.ada)).toBe(true);
  expect(getSocialDialogue(f.world, f.bo).filter(turn => turn.speaker === "Ada")).toHaveLength(0);
  expect(snapshotActorContinuation(f.world, f.ada)).toMatchObject({ status: "needs_revision", reason: "dialogue_changed" });
});

test("the floor can open without a second model call; only the exact integrated proposal executes once", async () => {
  const f = fixture(); f.world.meta.timedSpeech = true;
  // Only reserve a real voice here; this unit isolates floor changes from new
  // heard words. The next test separately checks actual new dialogue.
  beginTimedSpeech(f.world, f.cy, "I am finishing my own sentence.", "other-voice", () => {}, () => {}, { floor: "conversational" });
  generate.mockResolvedValue(response());
  const action = await agentThink(f.world, f.ada); f.dispatch(action);
  expect(snapshotActorContinuation(f.world, f.ada)?.status).toBe("waiting");
  expect(getSpeakingActivity(f.world, f.ada)).toBeUndefined();
  expect(pollForegroundContinuation(f.world, f.ada)).toEqual({ waiting: true });
  f.advance(5000);
  expect(runActorControlStep(f.world, f.ada, f.registry)).toBe(false);
  expect(getSpeakingActivity(f.world, f.ada)).toBeDefined();
  expect(pollForegroundContinuation(f.world, f.ada)).toBeUndefined();
  expect(consumeForegroundAction(f.world, f.ada, action)).toMatchObject({ admitted: false, reason: "already_consumed" });
  expect(consumeForegroundAction(f.world, f.ada, { ...action })).toMatchObject({ admitted: false, reason: "invalid_issuance" });
  expect(getAgentThoughts(f.world, f.ada)).toHaveLength(1); expect(generate).toHaveBeenCalledTimes(1);
});

test("repeated benign inspections do not rewrite a grounded queued line about the same person", async () => {
  const f = fixture(); f.world.meta.timedSpeech = true; f.world.meta.timedActions = true;
  const bo = workingMemoryEntityRef(f.world, f.bo)!.key;
  // Isolate physical inspection transitions from new heard dialogue.
  beginTimedSpeech(f.world, f.cy, "I am taking the next few seconds to finish.", "floor-only", () => {}, () => {}, { floor: "conversational" });
  generate.mockResolvedValue(response({}, { control: { version: 2, purpose: "Tell Bo what happened", goalId: null, localDependencies: [`entity:${bo}`] } }));
  const line = await agentThink(f.world, f.ada); f.dispatch(line);
  expect(pollForegroundContinuation(f.world, f.ada)).toEqual({ waiting: true });
  for (let i = 0; i < 3; i++) {
    executeActions(f.world, [{ eid: f.bo, action: { type: "observe", target: "Ada" } }], f.registry);
    expect(pollForegroundContinuation(f.world, f.ada)).toEqual({ waiting: true });
    f.advance(1000);
    expect(pollForegroundContinuation(f.world, f.ada)).toEqual({ waiting: true });
  }
  f.advance(2500); expect(runActorControlStep(f.world, f.ada, f.registry)).toBe(false);
  expect(getSpeakingActivity(f.world, f.ada)).toBeDefined(); expect(generate).toHaveBeenCalledTimes(1);
  expect(getAgentThoughts(f.world, f.ada)).toHaveLength(1);
  f.advance(5000);
  expect(getSocialDialogue(f.world, f.bo).filter(turn => turn.speaker === "Ada")).toHaveLength(1);
});

test("one presence-bound reply survives reading, typing and closing while its speaker waits for the floor", async () => {
  const f = fixture(); f.world.meta.timedSpeech = true;
  const bo = workingMemoryEntityRef(f.world, f.bo)!.key;
  recordCommittedSpeech(f.world, f.bo, "I have been waiting all evening.", "Ada");
  beginTimedSpeech(f.world, f.cy, "I am taking the next few seconds to finish.", "floor-only", () => {}, () => {}, { floor: "conversational" });
  const activity = (operation: "reading" | "typing" | "closing") => reserveSimulationResources(f.world, f.bo, operation, ["body"],
    { activity: { kind: "operating", operation, targetEid: f.display } });
  generate.mockImplementation(async () => {
    activity("reading"); // Actual public work started while Ada was formulating her reply.
    return response({ content: "That is quite a wait." }, { control: { version: 2, purpose: "Respond to Bo's remark", goalId: null,
      localDependencies: [`presence:${bo}`] } });
  });
  f.dispatch(await agentThink(f.world, f.ada));
  for (const operation of ["reading", "typing", "closing"] as const) {
    if (operation !== "reading") activity(operation);
    expect(pollForegroundContinuation(f.world, f.ada)).toEqual({ waiting: true });
    f.advance(1000); releaseSimulationResources(f.world, f.bo, operation);
    if (operation === "closing") ObjectState.current[f.display] = "closed";
    expect(pollForegroundContinuation(f.world, f.ada)).toEqual({ waiting: true });
  }
  f.advance(2500); expect(runActorControlStep(f.world, f.ada, f.registry)).toBe(false);
  expect(getSpeakingActivity(f.world, f.ada)).toBeDefined(); expect(generate).toHaveBeenCalledTimes(1);
  expect(getAgentThoughts(f.world, f.ada)).toHaveLength(1);
  f.advance(4000);
  expect(getSocialDialogue(f.world, f.bo).filter(turn => turn.speaker === "Ada").map(turn => turn.content)).toEqual(["That is quite a wait."]);
});

test.each(["departure", "replacement"])("a presence-bound reply still rejects actual target %s", async change => {
  const f = fixture(); f.world.meta.timedSpeech = true;
  const bo = workingMemoryEntityRef(f.world, f.bo)!.key;
  generate.mockImplementation(async () => {
    if (change === "departure") setLocatedIn(f.world, f.bo, f.elsewhere);
    else { removeEntity(f.world, f.bo); createAgentEntity(f.world, { name: "Bo", role: "resident", roomId: f.room, systemPrompt: "A different person." }); }
    return response({}, { control: { version: 2, purpose: "Answer Bo", goalId: null, localDependencies: [`presence:${bo}`] } });
  });
  f.dispatch(await agentThink(f.world, f.ada));
  expect(getSpeakingActivity(f.world, f.ada)).toBeUndefined();
  expect(snapshotActorContinuation(f.world, f.ada)?.status).toBe("needs_revision");
});

test("new final words still revise a presence-bound reply drafted from an unfinished utterance", async () => {
  const f = fixture(); f.world.meta.timedSpeech = true;
  const bo = workingMemoryEntityRef(f.world, f.bo)!.key;
  executeActions(f.world, [{ eid: f.bo, action: { type: "speak", target: "Ada", content: "Yes, but not tonight." } }], f.registry);
  f.advance(1000);
  generate.mockImplementation(async () => {
    f.advance(4000);
    return response({}, { control: { version: 2, purpose: "Answer Bo", goalId: null, localDependencies: [`presence:${bo}`] } });
  });
  f.dispatch(await agentThink(f.world, f.ada));
  expect(getSpeakingActivity(f.world, f.ada)).toBeUndefined();
  expect(snapshotActorContinuation(f.world, f.ada)).toMatchObject({ status: "needs_revision", reason: "dialogue_changed" });
});

test("a strict activity dispatch reports exact dependency categories without disclosing source values", async () => {
  const f = fixture(), bo = workingMemoryEntityRef(f.world, f.bo)!.key;
  const log = jest.spyOn(chronicle, "record");
  generate.mockImplementation(async () => {
    reserveSimulationResources(f.world, f.bo, "private-operation-id", ["body"], { activity: { kind: "operating", operation: "reading", targetEid: f.display } });
    return response({}, { control: { version: 2, purpose: "Ask about his current activity", goalId: null, localDependencies: [`activity:${bo}`] } });
  });
  f.dispatch(await agentThink(f.world, f.ada));
  const event = log.mock.calls.find(([type, data]) => type === "decision_superseded" && data.boundary === "dispatch")?.[1];
  expect(event?.localDependencyChange).toEqual({ reason: "dependency_changed", changed: [{ id: `activity:${bo}`, kind: "activity", fields: ["activity", "activity_target"] }] });
  expect(JSON.stringify(event?.localDependencyChange)).not.toMatch(/reading|Display|private-operation/);
});

test.each(["explicit activity", "movement", "pickup", "expression", "new words", "reading", "typing"])("speech still rechecks genuinely relevant %s evidence", async change => {
  const f = fixture(); f.world.meta.timedSpeech = true; f.world.meta.timedActions = true;
  const bo = workingMemoryEntityRef(f.world, f.bo)!.key;
  generate.mockImplementation(async () => {
    if (change === "movement") executeActions(f.world, [{ eid: f.bo, action: { type: "move", target: "Kitchen" } }], f.registry);
    else if (change === "pickup") executeActions(f.world, [{ eid: f.bo, action: { type: "pickup", target: "Key" } }], f.registry);
    else if (change === "expression") { addComponent(f.world, f.bo, Appearance); Appearance.expression[f.bo] = "frowning"; }
    else if (change === "reading" || change === "typing") reserveSimulationResources(f.world, f.bo, `physical:${change}`, ["body"],
      { activity: { kind: "operating", operation: change, targetEid: f.display } });
    else {
      executeActions(f.world, [{ eid: f.bo, action: { type: "observe", target: "Ada" } }], f.registry);
      if (change === "new words") recordCommittedSpeech(f.world, f.bo, "Wait, that is not what happened.", "Ada");
    }
    return response({}, { control: { version: 2, purpose: "Answer Bo about what happened", goalId: null,
      localDependencies: [change === "explicit activity" ? `activity:${bo}` : `entity:${bo}`] } });
  });
  f.dispatch(await agentThink(f.world, f.ada));
  expect(getSpeakingActivity(f.world, f.ada)).toBeUndefined();
  expect(snapshotActorContinuation(f.world, f.ada)?.status).toBe("needs_revision");
});

test("revising wording retains a bounded place ahead of later speakers, never the obsolete script", async () => {
  const f = fixture(); f.world.meta.timedSpeech = true;
  beginTimedSpeech(f.world, f.cy, "I am finishing my own sentence.", "other", () => {}, () => {}, { floor: "conversational" });
  generate.mockResolvedValue(response()); const old = await agentThink(f.world, f.ada); f.dispatch(old);
  f.advance(100);
  generate.mockResolvedValue(response({ target: "Ada", content: "My later point." }));
  const later = await agentThink(f.world, f.bo); executeActions(f.world, [{ eid: f.bo, action: later }], f.registry);
  recordCommittedSpeech(f.world, f.bo, "What happened?", "Ada");
  expect(pollForegroundContinuation(f.world, f.ada)?.needsRevision).toBe(true);
  generate.mockResolvedValue(response({ content: "Here is my fresh answer." }));
  const revised = await agentThink(f.world, f.ada); f.dispatch(revised);
  f.advance(4000);
  expect(readLocalSpeechOpportunity(f.world, f.bo).reason).toBe("queued_turn");
  expect(pollForegroundContinuation(f.world, f.bo)).toEqual({ waiting: true });
  runActorControlStep(f.world, f.ada, f.registry);
  expect(getSpeakingActivity(f.world, f.ada)).toBeDefined();
  expect(consumeForegroundAction(f.world, f.ada, old)).toMatchObject({ admitted: false });
  f.advance(4000);
  expect(getSocialDialogue(f.world, f.bo).filter(t => t.speaker === "Ada").map(t => t.content)).toEqual(["Here is my fresh answer."]);
});

test.each(["speaking", "moving"])("a considered cue deadline does not restart cognition while %s, but a fresh danger does", async kind => {
  const f = fixture(); f.world.meta.timedSpeech = true;
  addPerception(f.world,f.ada,{type:"attention",source:"indicator",signalKey:"one",content:"My indicator flashes."});
  const signalId=snapshotAttentionSignals(f.world,f.ada)[0].id;
  generate.mockResolvedValue(response({type:"think",content:"I will return to the indicator after this step."},{
    attentionReview:{signalId,disposition:"defer",afterSeconds:5,reason:"Finish my current step first."},
  }));
  f.dispatch(await agentThink(f.world,f.ada));
  if(kind==="speaking")beginTimedSpeech(f.world,f.ada,"I am still explaining this point and it takes a little while to finish the sentence.","own-step",()=>{},()=>{});
  else reserveSimulationResources(f.world,f.ada,"own-move",["body"]);
  f.advance(5500);
  expect(hasUnintegratedAttention(f.world,f.ada)).toBe(true);
  expect(hasUnintegratedAttention(f.world,f.ada,false)).toBe(false);
  expect(runActorControlStep(f.world,f.ada,f.registry)).toBe(false);
  expect(generate).toHaveBeenCalledTimes(1);
  addPerception(f.world,f.ada,{type:"danger",source:"alarm",content:"A fire alarm sounds."});
  expect(runActorControlStep(f.world,f.ada,f.registry)).toBe(true);
  expect(generate).toHaveBeenCalledTimes(1); // Readiness requests a decision; it does not run the model.
});

test("foreground motor plan executes a known second step without another inference", async () => {
  const f = fixture(), goal = createIntentGoal(f.world, f.ada, "Handle the key", 9);
  generate.mockResolvedValue(response({ type: "pickup", target: "Key", content: undefined }, {
    control: { version: 2, purpose: "Handle the key", goalId: goal, localDependencies: [] },
    motorPlan: [{ type: "pickup", target: "Key" }, { type: "drop", target: "Key" }],
  }));
  f.dispatch(await agentThink(f.world, f.ada));
  expect(getDirectContainer(f.world, f.key)).toBe(f.ada);
  runActorControlStep(f.world, f.ada, f.registry);
  expect(getDirectContainer(f.world, f.key)).toBe(f.room);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(Goal.status[goal]).toBe("active");
});

test("a motor plan waits for actual physical completion, not the proposed pickup", async () => {
  const f = fixture(); f.world.meta.timedActions = true;
  const goal = createIntentGoal(f.world, f.ada, "Handle the key", 9);
  generate.mockResolvedValue(response({ type: "pickup", target: "Key", content: undefined }, {
    control: { version: 2, purpose: "Handle the key", goalId: goal, localDependencies: [] },
    motorPlan: [{ type: "pickup", target: "Key" }, { type: "drop", target: "Key" }],
  }));
  f.dispatch(await agentThink(f.world, f.ada));
  runActorControlStep(f.world, f.ada, f.registry);
  expect(getDirectContainer(f.world, f.key)).toBe(f.room);
  f.advance(800);
  expect(getDirectContainer(f.world, f.key)).toBe(f.ada);
  runActorControlStep(f.world, f.ada, f.registry);
  expect(getDirectContainer(f.world, f.key)).toBe(f.ada);
  f.advance(1000);
  expect(getDirectContainer(f.world, f.key)).toBe(f.room);
  expect(generate).toHaveBeenCalledTimes(1);
});

test.each(["new attention", "replacement", "restart"])("motor steps stop for %s instead of blindly continuing", async change => {
  const f = fixture(), goal = createIntentGoal(f.world, f.ada, "Handle the key", 9);
  generate.mockResolvedValue(response({ type: "pickup", target: "Key", content: undefined }, {
    control: { version: 2, purpose: "Handle the key", goalId: goal, localDependencies: [] },
    motorPlan: [{ type: "pickup", target: "Key" }, { type: "drop", target: "Key" }],
  }));
  f.dispatch(await agentThink(f.world, f.ada));
  if (change === "new attention") addPerception(f.world, f.ada, { type: "danger", source: "alarm", content: "Fire!" });
  if (change === "replacement") WorkingMemoryIdentity.id[f.key] = "another object";
  if (change === "restart") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  runActorControlStep(f.world, f.ada, f.registry);
  expect(getDirectContainer(f.world, f.key)).toBe(f.ada);
  expect(generate).toHaveBeenCalledTimes(1);
});

test("a later motor target cannot silently rebind to a same-name substitute", async () => {
  const f = fixture(), goal = createIntentGoal(f.world, f.ada, "Check the display with the key", 9);
  generate.mockResolvedValue(response({ type: "pickup", target: "Key", content: undefined }, {
    control: { version: 2, purpose: "Check the display", goalId: goal, localDependencies: [] },
    motorPlan: [{ type: "pickup", target: "Key" }, { type: "observe", target: "Display" }],
  }));
  f.dispatch(await agentThink(f.world, f.ada));
  setLocatedIn(f.world, f.display, f.elsewhere);
  createObjectEntity(f.world, { name: "Display", roomId: f.room });
  const observed: AgentAction[] = [];
  runActorControlStep(f.world, f.ada, f.registry, { onAction: action => observed.push(action) });
  expect(observed).toHaveLength(0);
});

test.each(["unread reaction", "remote target", "wrong first step"])("rejects speculative motor plan: %s", async invalid => {
  const f = fixture(), goal = createIntentGoal(f.world, f.ada, "Handle the key", 9);
  generate.mockResolvedValue(response({ type: "pickup", target: "Key", content: undefined }, {
    control: { version: 2, purpose: "Handle the key", goalId: goal, localDependencies: [] },
    motorPlan: invalid === "unread reaction" ? [{ type: "pickup", target: "Key" }, { type: "observe", target: "Key" }, { type: "drop", target: "Key" }]
      : [{ type: "pickup", target: invalid === "wrong first step" ? "Display" : "Key" }, { type: "drop", target: invalid === "remote target" ? "Unknown" : "Key" }],
  }));
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.ada))).toBe(true);
  expect(getAgentThoughts(f.world, f.ada)).toHaveLength(0);
});

test.each(["listener leaves", "new words", "new urgent stimulus", "expiry", "restart", "replacement"])("pending speech %s never replays stale wording", async change => {
  const f = fixture(); f.world.meta.timedSpeech = true;
  beginTimedSpeech(f.world, f.cy, "I am finishing my own sentence.", "other-voice", () => {}, () => {}, { floor: "conversational" });
  generate.mockResolvedValue(response()); const action = await agentThink(f.world, f.ada); f.dispatch(action);
  if (change === "listener leaves") setLocatedIn(f.world, f.bo, f.elsewhere);
  if (change === "new words") recordCommittedSpeech(f.world, f.bo, "Never mind, don't tell me.", "Ada");
  if (change === "new urgent stimulus") addPerception(f.world, f.ada, { type: "danger", source: "alarm", content: "Fire alarm." });
  if (change === "expiry") f.advance(16_000);
  if (change === "restart") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (change === "replacement") WorkingMemoryIdentity.id[f.ada] = "replacement-life";
  expect(pollForegroundContinuation(f.world, f.ada)).toEqual({ waiting: false, needsRevision: true });
  expect(getSpeakingActivity(f.world, f.ada)).toBeUndefined();
  expect(pollForegroundContinuation(f.world, f.ada)).toBeUndefined();
  if (!["restart", "replacement"].includes(change)) expect(snapshotActorContinuation(f.world, f.ada)?.purpose).toBe("Tell Bo about my experience");
});

test("a valid known plan advances synchronously without invoking the model", () => {
  const f = fixture(), goal = createIntentGoal(f.world, f.ada, "Collect the key", 9);
  const plan = createPlanEntity(f.world, f.ada, goal, { goalDescription: "Collect the key", estimatedCompletion: "soon", potentialObstacles: [],
    steps: [{ description: "Pick up the key", actionType: "pickup", target: "Key" }, { description: "Pause", actionType: "wait" }] });
  expect(runActorControlStep(f.world, f.ada, f.registry)).toBe(false);
  expect(getDirectContainer(f.world, f.key)).toBe(f.ada);
  expect(Plan.currentStep[plan]).toBe(1); expect(generate).not.toHaveBeenCalled();
});

test("a deliberate personal plan outranks routine behavior even with an enabled policy", () => {
  const f = fixture();
  const goal = createGeneratedIntention(f.world, f.ada, { description: "Collect the key", priority: 9 }, "foreground")!;
  addComponent(f.world, f.ada, BehaviorPolicy); BehaviorPolicy.enabled[f.ada] = true;
  createPlanEntity(f.world, f.ada, goal, { goalDescription: "Collect the key", estimatedCompletion: "soon", potentialObstacles: [],
    steps: [{ description: "Pick up the key", actionType: "pickup", target: "Key" }, { description: "Pause", actionType: "wait" }] });
  expect(runActorControlStep(f.world, f.ada, f.registry)).toBe(false);
  expect(getDirectContainer(f.world, f.key)).toBe(f.ada); expect(generate).not.toHaveBeenCalled();
});

test.each([undefined, "Answer Bo's immediate question before returning to my request"])("version 2 admits a lower-ranked purpose with optional explanation: %s", async switchReason => {
  const f = fixture(), important = createIntentGoal(f.world, f.ada, "Recover my belongings", 9), minor = createIntentGoal(f.world, f.ada, "Discuss the display", 4);
  generate.mockResolvedValue(response({}, { control: { version: 2, purpose: "Discuss the display", goalId: minor,
    switchReason, localDependencies: [] } }));
  const action = await agentThink(f.world, f.ada);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(getSocialDialogue(f.world, f.bo)).toHaveLength(0);
  f.dispatch(action);
  expect(snapshotActorContinuation(f.world, f.ada)).toMatchObject({ goalId: minor, goalKey: WorkingMemoryIdentity.id[minor] });
  expect(snapshotActorContinuation(f.world, f.ada)?.switchReason).toBe(switchReason);
  expect(getSocialDialogue(f.world, f.bo).some(t => t.speaker === "Ada" && t.content === action.content)).toBe(true);
  for (const [goal, priority] of [[important, 9], [minor, 4]]) {
    expect(Goal.status[goal]).toBe("active"); expect(Goal.priority[goal]).toBe(priority); expect(Goal.progress[goal]).toBe(0);
  }
  expect(generate).toHaveBeenCalledTimes(1);
});

test("continuing a lower-ranked activity does not require repeatedly justifying it", async () => {
  const f = fixture(), goal = createIntentGoal(f.world, f.ada, "Wait for Bo's explanation", 4);
  generate.mockResolvedValue(response({ type: "wait", target: undefined, content: undefined }, {
    control: { version: 2, purpose: "Hear Bo out", goalId: goal, localDependencies: [] },
  }));
  f.dispatch(await agentThink(f.world, f.ada));
  const before = snapshotOngoingActivity(f.world, f.ada)!;
  expect(before).toBeDefined();
  const important = createIntentGoal(f.world, f.ada, "Check my phone", 8);
  for (let i = 0; i < 3; i++) {
    f.advance(1000);
    const action = await agentThink(f.world, f.ada);
    expect(isDiscardedForegroundDecision(action)).toBe(false);
    f.dispatch(action);
    expect(snapshotOngoingActivity(f.world, f.ada)).toMatchObject({
      id: before.id, selectedAtSimMs: before.selectedAtSimMs, goalKey: WorkingMemoryIdentity.id[goal], status: "active",
    });
    expect(snapshotActorContinuation(f.world, f.ada)?.goalId).toBe(goal);
  }
  expect(Goal.status[important]).toBe("active"); expect(Goal.priority[important]).toBe(8);
  expect(Goal.progress[goal]).toBe(0); expect(generate).toHaveBeenCalledTimes(4);
});

test("explicit activity replacement can select a lower-ranked purpose without retiring the previous goal", async () => {
  const f = fixture(), important = createIntentGoal(f.world, f.ada, "Prepare to leave", 9);
  const minor = createIntentGoal(f.world, f.ada, "Hear Bo's news", 4);
  generate.mockResolvedValue(response({ type: "wait", target: undefined, content: undefined }, {
    control: { version: 2, purpose: "Prepare to leave", goalId: important, localDependencies: [] },
  }));
  f.dispatch(await agentThink(f.world, f.ada));
  const before = snapshotOngoingActivity(f.world, f.ada)!;
  expect(before).toBeDefined(); f.advance(1000);
  generate.mockResolvedValue(response({ type: "wait", target: undefined, content: undefined }, {
    control: { version: 2, purpose: "Hear Bo's news", goalId: minor, activityDisposition: "replace", localDependencies: [] },
  }));
  const action = await agentThink(f.world, f.ada);
  expect(isDiscardedForegroundDecision(action)).toBe(false); f.dispatch(action);
  const after = snapshotOngoingActivity(f.world, f.ada)!;
  expect(after.id).not.toBe(before.id);
  expect(after).toMatchObject({ goalKey: WorkingMemoryIdentity.id[minor], status: "active", selectedAtSimMs: 1000 });
  expect(Goal.status[important]).toBe("active"); expect(Goal.progress[important]).toBe(0);
});

test.each([3, 10])("a new rank-%s side intention is admitted without automatically replacing the organizing activity", async priority => {
  const f = fixture(), organizing = createIntentGoal(f.world, f.ada, "Prepare to leave", 9);
  generate.mockResolvedValue(response({ type: "wait", target: undefined, content: undefined }, {
    control: { version: 2, purpose: "Prepare to leave", goalId: organizing, localDependencies: [] },
  }));
  f.dispatch(await agentThink(f.world, f.ada));
  const before = snapshotOngoingActivity(f.world, f.ada)!;
  generate.mockResolvedValue(response({}, {
    control: { version: 2, purpose: "Tell Bo what happened", goalId: "new", localDependencies: [] },
    goalUpdate: { description: "Tell Bo what happened", priority, kind: "social" },
  }));
  const action = await agentThink(f.world, f.ada);
  expect(isDiscardedForegroundDecision(action)).toBe(false); f.dispatch(action);
  const created = getRelationTargets(f.world, f.ada, HasGoal).find(g => g !== organizing)!;
  expect(Goal.description[created]).toBe("Tell Bo what happened"); expect(Goal.priority[created]).toBe(priority);
  expect(snapshotActorContinuation(f.world, f.ada)).toMatchObject({ goalId: created, goalKey: WorkingMemoryIdentity.id[created] });
  expect(snapshotOngoingActivity(f.world, f.ada)).toMatchObject({ id: before.id, goalKey: WorkingMemoryIdentity.id[organizing], status: "active" });
  expect(Goal.status[organizing]).toBe("active"); expect(Goal.progress[organizing]).toBe(0);
});

test.each([null, "", 123, "x".repeat(401)])("an optional switch explanation must still be valid: %s", async switchReason => {
  const f = fixture(), important = createIntentGoal(f.world, f.ada, "Prepare to leave", 9);
  const minor = createIntentGoal(f.world, f.ada, "Hear Bo's news", 4);
  generate.mockResolvedValue(response({}, { control: { version: 2, purpose: "Hear Bo's news", goalId: minor, switchReason, localDependencies: [] } }));
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.ada))).toBe(true);
  expect(getAgentThoughts(f.world, f.ada)).toHaveLength(0); expect(getSocialDialogue(f.world, f.bo)).toHaveLength(0);
  expect(snapshotActorContinuation(f.world, f.ada)).toBeUndefined(); expect(Goal.status[important]).toBe("active");
});

test.each(["foreign goal", "invalid dependency", "retired during inference", "replaced during inference"])("advisory priority preserves admission boundaries: %s", async invalid => {
  const f = fixture(); createIntentGoal(f.world, f.ada, "Prepare to leave", 9);
  const goal = createIntentGoal(f.world, invalid === "foreign goal" ? f.bo : f.ada, "Discuss the display", 4);
  generate.mockImplementation(async () => {
    if (invalid === "retired during inference") Goal.status[goal] = "completed";
    if (invalid === "replaced during inference") WorkingMemoryIdentity.id[goal] = "replacement-goal";
    return response({}, { control: { version: 2, purpose: "Discuss the display", goalId: goal,
      localDependencies: invalid === "invalid dependency" ? ["hidden:other-person"] : [] } });
  });
  const action = await agentThink(f.world, f.ada);
  expect(isDiscardedForegroundDecision(action)).toBe(true); f.dispatch(action);
  expect(getAgentThoughts(f.world, f.ada)).toHaveLength(0); expect(getSocialDialogue(f.world, f.bo)).toHaveLength(0);
  expect(snapshotActorContinuation(f.world, f.ada)).toBeUndefined();
});

test.each(["priority", "situated"] as const)("%s prompt treats ranks as context and changes of activity as choices", async controller => {
  const f = fixture(); f.world.meta.cognitionController = controller;
  generate.mockResolvedValue(response({}, { control: { version: 2, purpose: "Talk to Bo", goalId: null, localDependencies: [] } }));
  await agentThink(f.world, f.ada);
  const prompt = generate.mock.calls[0][0].messages[0].content;
  expect(prompt).toContain("Priorities are context, not a requirement to choose the highest-ranked goal.");
  expect(prompt).toContain("Optionally include control.switchReason");
  expect(prompt).not.toContain("Pursue the highest remaining");
  expect(prompt).not.toContain("When choosing a lower-ranked goal");
  expect(prompt).not.toContain("A higher-priority goal interrupts");
});

test("an independent social response does not require surrendering a high-priority goal", async () => {
  const f = fixture(), important = createIntentGoal(f.world, f.ada, "Recover my belongings", 9);
  recordCommittedSpeech(f.world, f.bo, "My home was destroyed.", "Ada");
  generate.mockResolvedValue(response({ content: "Bo, what happened?" }, { control: { version: 2,
    purpose: "Understand what just happened to Bo", goalId: null, localDependencies: [] }, appraiseSpeechIds: [] }));
  const action = await agentThink(f.world, f.ada); f.dispatch(action);
  expect(getSocialDialogue(f.world, f.bo).some(t => t.speaker === "Ada" && t.content === "Bo, what happened?")).toBe(true);
  expect(Goal.status[important]).toBe("active"); expect(Goal.priority[important]).toBe(9);
  expect(snapshotExperienceAppraisal(f.world, f.ada)).toBeUndefined();
  expect(generate).toHaveBeenCalledTimes(1);
});

test("controller selection is validated and world-local; priority remains the default", () => {
  const first = fixture(), second = fixture();
  first.world.meta.cognitionController = "situated";
  expect(cognitionController(first.world)).toBe("situated");
  expect(cognitionController(second.world)).toBe("priority");
  expect(() => parseCognitionController("typo")).toThrow("Unknown cognition controller");
});

test("situated policy chooses a lower-ranked purpose without changing goal facts or claiming success", async () => {
  const f = fixture(); f.world.meta.cognitionController = "situated";
  const important = createIntentGoal(f.world, f.ada, "Recover my belongings", 9);
  const minor = createIntentGoal(f.world, f.ada, "Discuss the display", 4);
  generate.mockResolvedValue(response({}, { control: { version: 2, purpose: "Discuss the display", goalId: minor, localDependencies: [] } }));
  const action = await agentThink(f.world, f.ada);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(getSocialDialogue(f.world, f.bo)).toHaveLength(0);
  f.dispatch(action);
  expect(snapshotActorContinuation(f.world, f.ada)).toMatchObject({ goalId: minor, status: "dispatched" });
  expect(Goal.status[important]).toBe("active"); expect(Goal.priority[important]).toBe(9);
  const request = generate.mock.calls[0][0];
  expect(request.messages[0].content).toContain("Consider your situation as a whole");
  expect(request.messages[0].content).not.toContain("Pursue the highest remaining");
  expect(request.system).not.toContain("Do not fall back to lower-priority work");
  expect(request.system).not.toContain("Only plans at this priority");
});

test("situated policy does not execute an unchosen high-priority plan", () => {
  const f = fixture(); f.world.meta.cognitionController = "situated";
  const goal = createIntentGoal(f.world, f.ada, "Collect the key", 9);
  createPlanEntity(f.world, f.ada, goal, { goalDescription: "Collect the key",
    steps: [{ description: "Collect the key", actionType: "pickup", target: "Key" }], estimatedCompletion: "soon", potentialObstacles: [] });
  expect(selectFastAgentAction(f.world, f.ada)).toBeNull();
  expect(getDirectContainer(f.world, f.key)).toBe(f.room);
});

test.each(["priority", "situated"] as const)("%s policy executes a chosen lower-priority motor plan with actual completion receipts", async controller => {
  const f = fixture(); f.world.meta.cognitionController = controller; f.world.meta.timedActions = true;
  createIntentGoal(f.world, f.ada, "Another saved priority", 10);
  const goal = createIntentGoal(f.world, f.ada, "Handle the key", 4);
  generate.mockResolvedValue(response({ type: "pickup", target: "Key", content: undefined }, {
    control: { version: 2, purpose: "Handle the key", goalId: goal, localDependencies: [] },
    motorPlan: [{ type: "pickup", target: "Key" }, { type: "drop", target: "Key" }],
  }));
  f.dispatch(await agentThink(f.world, f.ada));
  expect(getDirectContainer(f.world, f.key)).toBe(f.room);
  f.advance(800); expect(getDirectContainer(f.world, f.key)).toBe(f.ada);
  runActorControlStep(f.world, f.ada, f.registry);
  f.advance(1000); expect(getDirectContainer(f.world, f.key)).toBe(f.room);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(Goal.status[goal]).toBe("active");
});

test.each(["attention", "expiry", "replacement", "restart", "edited purpose"])("situated plan is reconsidered after %s", async change => {
  const f = fixture(); f.world.meta.cognitionController = "situated";
  const goal = createIntentGoal(f.world, f.ada, "Handle the key", 4);
  generate.mockResolvedValue(response({ type: "pickup", target: "Key", content: undefined }, {
    control: { version: 2, purpose: "Handle the key", goalId: goal, localDependencies: [] },
    motorPlan: [{ type: "pickup", target: "Key" }, { type: "drop", target: "Key" }],
  }));
  f.dispatch(await agentThink(f.world, f.ada));
  if (change === "attention") addPerception(f.world, f.ada, { type: "attention", source: "Bo", content: "Something changed." });
  if (change === "expiry") f.advance(10_000);
  if (change === "replacement") WorkingMemoryIdentity.id[goal] = "replacement-goal";
  if (change === "restart") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (change === "edited purpose") CognitiveControl.stateJson[f.ada] = JSON.stringify({ ...snapshotActorContinuation(f.world, f.ada), purpose: "Another purpose" });
  expect(selectFastAgentAction(f.world, f.ada)).toBeNull();
  expect(getDirectContainer(f.world, f.key)).toBe(f.ada);
});

test.each(["unknown goal", "invalid dependency", "legacy envelope"])("situated policy preserves admission checks: %s", async invalid => {
  const f = fixture(); f.world.meta.cognitionController = "situated";
  generate.mockResolvedValue(response({}, { control: { version: invalid === "legacy envelope" ? 1 : 2,
    purpose: "Talk", goalId: invalid === "unknown goal" ? 999999 : null,
    localDependencies: invalid === "invalid dependency" ? ["hidden:other-person"] : [] } }));
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.ada))).toBe(true);
  expect(getAgentThoughts(f.world, f.ada)).toHaveLength(0);
});

test("switching controller during inference rejects the old decision without publishing a thought", async () => {
  const f = fixture(); f.world.meta.cognitionController = "situated";
  generate.mockImplementation(async () => {
    f.world.meta.cognitionController = "priority";
    return response({}, { control: { version: 2, purpose: "Talk", goalId: null, localDependencies: [] } });
  });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.ada))).toBe(true);
  expect(getAgentThoughts(f.world, f.ada)).toHaveLength(0);
});

test("situated interpretation cannot make a removed physical target executable", async () => {
  const f = fixture(); f.world.meta.cognitionController = "situated";
  generate.mockImplementation(async () => {
    setLocatedIn(f.world, f.key, f.elsewhere);
    return response({ type: "pickup", target: "Key", content: undefined }, {
      control: { version: 2, purpose: "Get ready", goalId: null, localDependencies: [] },
    });
  });
  f.dispatch(await agentThink(f.world, f.ada));
  expect(getAgentThoughts(f.world, f.ada)).toHaveLength(1);
  expect(getDirectContainer(f.world, f.key)).toBe(f.elsewhere);
  expect(getSocialDialogue(f.world, f.bo)).toHaveLength(0);
  expect(snapshotActorContinuation(f.world, f.ada)?.status).toBe("needs_revision");
});

test("a controller switch after integration cannot execute a pending old-policy utterance", async () => {
  const f = fixture(); f.world.meta.cognitionController = "situated";
  generate.mockResolvedValue(response({}, { control: { version: 2, purpose: "Talk", goalId: null, localDependencies: [] } }));
  const action = await agentThink(f.world, f.ada);
  f.world.meta.cognitionController = "priority";
  f.dispatch(action);
  expect(getSocialDialogue(f.world, f.bo)).toHaveLength(0);
});

test.each(["release", "reprioritize"])("appraisal-style %s invalidates an old pending intention's words", async disposition => {
  const f = fixture(); workingMemoryEntityRef(f.world, f.ada);
  const goal = createGeneratedIntention(f.world, f.ada, { description: "Win an argument", priority: 9, kind: "social" }, "personal")!;
  generate.mockResolvedValue(response({}, { control: { version: 2, purpose: "Win the argument", goalId: goal, localDependencies: [] } }));
  const action = await agentThink(f.world, f.ada);
  const draft = prepareIntentionReconsideration(captureIntentionReconsideration(f.world, f.ada), [{ goalId: goal,
    disposition, reason: "My experience changed what matters", ...(disposition === "reprioritize" ? { priority: 2 } : {}) }])!;
  expect(draft.commit()).toBe(true); f.dispatch(action);
  expect(getSocialDialogue(f.world, f.bo)).toHaveLength(0);
  expect(Goal.status[goal]).toBe(disposition === "release" ? "retired" : "active");
  expect(snapshotActorContinuation(f.world, f.ada)?.status).toBe("needs_revision");
});

test("foreground can defer a personal goal without discarding the newly selected step", async () => {
  const f = fixture(); workingMemoryEntityRef(f.world, f.ada);
  const goal = createGeneratedIntention(f.world, f.ada, { description: "Arrange to recover my belongings", priority: 9, kind: "social" }, "foreground")!;
  generate.mockResolvedValue(response({}, { control: { version: 2, purpose: "Talk while awaiting a response", goalId: null, localDependencies: [] },
    goalReview: { goalId: goal, disposition: "defer", reason: "I have asked and await a reply", afterSeconds: 20, wake: { kind: "review" } } }));
  const action = await agentThink(f.world, f.ada); f.dispatch(action);
  expect(Goal.status[goal]).toBe("paused"); expect(Goal.progress[goal]).toBe(0);
  expect(getSocialDialogue(f.world, f.bo)).toHaveLength(1);
  expect(snapshotActorContinuation(f.world, f.ada)?.status).toBe("dispatched");
  f.advance(20_000); runActorControlStep(f.world, f.ada, f.registry, { deliberating: true });
  expect(Goal.status[goal]).toBe("active");
});

test.each(["defer", "release"])("foreground model response can %s eligible scheduled work and still execute its independent selected action", async disposition => {
  const f = fixture(); workingMemoryEntityRef(f.world, f.ada); f.world.time.simulationHour = 13;
  const schedule = addEntity(f.world); addComponent(f.world, schedule, Schedule); addComponent(f.world, f.ada, HasSchedule(schedule));
  Schedule.activities[schedule] = JSON.stringify([{ name: "afternoon work", startHour: 13, duration: 4, priority: 5, interruptible: true }]);
  const schedules = createSystemRegistry(); registerSystem(schedules, { ...createScheduledActivityGoalSystem(), frequency: 0 });
  runSystems(f.world, schedules, 1, 500); expect(schedules.errors).toEqual([]);
  const goal = getRelationTargets(f.world, f.ada, HasGoal).find(g => Goal.kind[g] === "scheduled_activity")!;
  expect(goal).toBeDefined(); const proof = Goal.successJson[goal];
  generate.mockResolvedValue(response({}, { control: { version: 2, purpose: "Speak to Bo before doing anything else", goalId: null, localDependencies: [] },
    goalReview: { goalId: goal, disposition, reason: "I am choosing to speak to my friend now.",
      ...(disposition === "defer" ? { afterSeconds: 20, wake: { kind: "review" } } : {}) } }));
  const action = await agentThink(f.world, f.ada); f.dispatch(action);
  expect(Goal.status[goal]).toBe(disposition === "defer" ? "paused" : "retired");
  expect(Goal.progress[goal]).toBe(0); expect(Goal.successJson[goal]).toBe(proof);
  expect(getSocialDialogue(f.world, f.bo)).toHaveLength(1);
  expect(snapshotActorContinuation(f.world, f.ada)?.status).toBe("dispatched");
  expect(generate.mock.calls[0][0].system).toContain(`[goalId=${goal}; persistence=episodic; operations=defer,release]`);
  runSystems(f.world, schedules, 2, 500);
  expect(getRelationTargets(f.world, f.ada, HasGoal).filter(g => Goal.kind[g] === "scheduled_activity")).toEqual([goal]);
});

test("invalid personal review cannot partially create a goal, thought or action", async () => {
  const log = jest.spyOn(chronicle, "record");
  const f = fixture(); generate.mockResolvedValue(response({}, {
    control: { version: 2, purpose: "Wait for a stranger", goalId: "new", localDependencies: [] },
    goalUpdate: { description: "New intention", priority: 8 },
    goalReview: { goalId: 99999, disposition: "defer", reason: "Invented", afterSeconds: 20, wake: { kind: "review" } },
  }));
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.ada))).toBe(true);
  expect(log).toHaveBeenCalledWith("decision_rejected", expect.objectContaining({ schemaField: "goalReview.goal" }));
  expect(getRelationTargets(f.world, f.ada, HasGoal)).toHaveLength(0); expect(getAgentThoughts(f.world, f.ada)).toHaveLength(0);
});

test("a new focused goal uses its committed identity, including normalized description whitespace", async () => {
  const f = fixture(); generate.mockResolvedValue(response({}, {
    control: { version: 2, purpose: "Talk to Bo", goalId: "new", localDependencies: [] },
    goalUpdate: { description: "  Tell Bo what happened  ", priority: 8, kind: "social" },
  }));
  const action = await agentThink(f.world, f.ada); f.dispatch(action);
  const goal = getRelationTargets(f.world, f.ada, HasGoal)[0];
  expect(Goal.description[goal]).toBe("Tell Bo what happened");
  expect(snapshotActorContinuation(f.world, f.ada)).toMatchObject({ goalId: goal, goalKey: WorkingMemoryIdentity.id[goal], status: "dispatched" });
});

test("perception intake continues during deliberation without starting a competing action", () => {
  const f = fixture(); queueStimulus(f.world, { targetEid: f.ada, type: "danger", modality: "auditory", source: "alarm", content: "Fire alarm." });
  expect(runActorControlStep(f.world, f.ada, f.registry, { deliberating: true })).toBe(false);
  expect(hasUnintegratedAttention(f.world, f.ada)).toBe(true);
  expect(getDirectContainer(f.world, f.key)).toBe(f.room); expect(generate).not.toHaveBeenCalled();
});

test("superseding the actor's own priorities during inference still rejects an obsolete mental patch", async () => {
  const f = fixture(); generate.mockImplementation(async () => {
    createIntentGoal(f.world, f.ada, "New immediate priority", 10); return response();
  });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.ada))).toBe(true);
  expect(getAgentThoughts(f.world, f.ada)).toHaveLength(0);
  expect(getRelationTargets(f.world, f.ada, HasGoal).map(id => Goal.description[id])).toEqual(["New immediate priority"]);
});

test("saturated foreground model slots cannot delay the deterministic actor controller", async () => {
  jest.useFakeTimers();
  const releases: Array<() => void> = [];
  const f = fixture();
  initializeTaskQueue({ processInterval: 10, foregroundMaxConcurrent: 2 }); startTaskQueue();
  const slots = [0, 1].map(i => queueTask(`held-model-${i}`, () => new Promise<void>(resolve => releases.push(resolve)), { lane: "foreground" }));
  const runtime = createSimulation(f.world, f.registry, {} as any, { ecsTickRate: 20, logTickStats: false });
  try {
    await jest.advanceTimersByTimeAsync(20);
    expect(slots.map(id => getTaskStatus(id)?.status)).toEqual(["running", "running"]);
    const goal = createIntentGoal(f.world, f.ada, "Collect the key", 9);
    createPlanEntity(f.world, f.ada, goal, { goalDescription: "Collect the key", estimatedCompletion: "soon", potentialObstacles: [],
      steps: [{ description: "Pick up the key", actionType: "pickup", target: "Key" }] });
    registerFastSystem(runtime, { name: "ActorControl", execute: () => { runActorControlStep(f.world, f.ada, f.registry); } });
    startSimulation(runtime); await jest.advanceTimersByTimeAsync(60);
    expect(getDirectContainer(f.world, f.key)).toBe(f.ada);
    expect(slots.map(id => getTaskStatus(id)?.status)).toEqual(["running", "running"]);
    expect(generate).not.toHaveBeenCalled();
  } finally {
    stopSimulation(runtime); releases.forEach(release => release()); await jest.advanceTimersByTimeAsync(20);
    stopTaskQueue(); jest.useRealTimers();
  }
});

test("saved ECS retains a private purpose and thought provenance, never a replayable speech command", async () => {
  const f = fixture(); f.world.meta.timedSpeech = true;
  beginTimedSpeech(f.world, f.cy, "My own unfinished turn.", "other-voice", () => {}, () => {}, { floor: "conversational" });
  generate.mockResolvedValue(response()); const action = await agentThink(f.world, f.ada); f.dispatch(action);
  const saved = serializeWorld(f.world, f.registry);
  const restored = createArgosWorld("Restored controller"); initializePrefabs(restored); worlds.push(restored);
  const registry = createSystemRegistry(), { oldToNewId } = deserializeWorld(restored, registry, saved), ada = oldToNewId.get(f.ada)!;
  expect(snapshotActorContinuation(restored, ada)).toMatchObject({ purpose: "Tell Bo about my experience", status: "needs_revision", reason: "restored_purpose" });
  expect(pollForegroundContinuation(restored, ada)).toBeUndefined();
  expect(getSpeakingActivity(restored, ada)).toBeUndefined();
  expect(Thought.observedAtSimMs[getAgentThoughts(restored, ada)[0]]).toBe(0);
});

test("a thought observer stopping the world cannot let its action escape afterward", async () => {
  const f = fixture();
  registerAgentWorldCapabilities(f.world, f.ada, { context: () => "", ready: () => true, busy: () => false, execute: () => false,
    onThought: () => stopCommittedEvents(f.world) });
  generate.mockResolvedValue(response({ type: "pickup", target: "Key", content: undefined }));
  const action = await agentThink(f.world, f.ada); f.dispatch(action);
  expect(getCommittedEvents(f.world).stopped).toBe(true);
  expect(getDirectContainer(f.world, f.key)).toBe(f.room);
});

test("direct ECS intent edits retire old speech authority without losing the edited purpose", async () => {
  const f = fixture(); f.world.meta.timedSpeech = true;
  beginTimedSpeech(f.world, f.cy, "My unfinished turn.", "other-voice", () => {}, () => {}, { floor: "conversational" });
  generate.mockResolvedValue(response()); const action = await agentThink(f.world, f.ada); f.dispatch(action);
  const saved = JSON.parse(CognitiveControl.stateJson[f.ada]);
  CognitiveControl.stateJson[f.ada] = JSON.stringify({ ...saved, purpose: "Attend to the new situation" });
  expect(pollForegroundContinuation(f.world, f.ada)).toEqual({ waiting: false, needsRevision: true });
  expect(snapshotActorContinuation(f.world, f.ada)).toMatchObject({ purpose: "Attend to the new situation", status: "needs_revision" });
  expect(getSpeakingActivity(f.world, f.ada)).toBeUndefined();
});

test("an in-flight interpretation cannot overwrite an external ECS intent edit at the same revision", async () => {
  const f = fixture(); generate.mockResolvedValue(response());
  const first = await agentThink(f.world, f.ada); f.dispatch(first);
  generate.mockImplementation(async () => {
    const saved = JSON.parse(CognitiveControl.stateJson[f.ada]);
    CognitiveControl.stateJson[f.ada] = JSON.stringify({ ...saved, purpose: "A newer chosen purpose" });
    return response();
  });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.ada))).toBe(true);
  expect(snapshotActorContinuation(f.world, f.ada)?.purpose).toBe("A newer chosen purpose");
  expect(getAgentThoughts(f.world, f.ada)).toHaveLength(1);
});
