import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } = await import("../../ecs/prefabs");
const { Goal, Plan, ObjectState, WorkingMemoryIdentity } = await import("../../ecs/components");
const { addComponent } = await import("bitecs");
const { captureWorkingMemoryObservation } = await import("../working-memory-observation");
const { setLocatedIn, getDirectContainer } = await import("../../ecs/location");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { createIntentGoal, executeActions, capturePlanExecution } = await import("../cognition-system");
const { getSuccessfulGoalActions } = await import("../goal-learning");
const { setGoalContract } = await import("../goal-contract");
const { createPlanEntity, getNextPlannedAction, advancePlanStep } = await import("../planning-system");
const { agentThink, selectFastAgentAction, addPerception, getAgentThoughts, hasUnintegratedAttention } = await import("../agent-mind");
const { selectContractDrivenAction } = await import("../contract-driven-actions");
const { integrateActorContinuation, updateActorContinuation, snapshotActorContinuation } = await import("../actor-continuation");
const { workingMemoryEntityRef } = await import("../working-memory");
const { captureCoordinationGoal } = await import("../coordination-memory");
const { snapshotAttentionSignals, resolveAttentionSignal, prepareAttentionReview } = await import("../unresolved-attention");
const { isDiscardedForegroundDecision } = await import("../foreground-action-admission");
const { snapshotOngoingActivity } = await import("../ongoing-activity");
const { registerAgentWorldCapabilities } = await import("../world-capabilities");
const { reserveSimulationResources, releaseSimulationResources, advanceSimulationTimeline } = await import("../../runtime/simulation-timeline");
const { startCommittedEvents } = await import("../../runtime/committed-events");
const { beginTimedSpeech } = await import("../timed-speech");
const { getActorWaitTiming } = await import("../actor-wait");
const { getForegroundCognitionReadiness } = await import("../idle-cognition");

let oldKey: string | undefined;
beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Controller tests are offline"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey;
});
function fixture() {
  const world = createArgosWorld("Purpose ownership"); world.meta.aiEnabled = true; initializePrefabs(world);
  const hall = createRoomEntity(world, { name: "Hall" }), workshop = createRoomEntity(world, { name: "Workshop" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Choose your own next step.", roomId: hall });
  const notebook = createObjectEntity(world, { name: "Notebook", portable: true, roomId: workshop });
  const schedule = createIntentGoal(world, actor, "Routine work in Hall", 9);
  setGoalContract(world, schedule, { version: 1, kind: "scheduled_activity", params: {}, success: { type: "all_of", conditions: [
    { type: "in_room", roomName: "Hall" }, { type: "did_interact", targetName: "Desk", affordance: "work" },
  ] } });
  const registry = createSystemRegistry();
  const choose = (goalId?: number) => {
    workingMemoryEntityRef(world, actor); if (goalId !== undefined) captureCoordinationGoal(world, actor, goalId);
    const revision = integrateActorContinuation(world, actor, { purpose: "Investigate the notebook", actionType: "move", target: "Workshop", observedAtSimMs: world.time.elapsed,
      ...(goalId !== undefined ? { goalId, goalKey: WorkingMemoryIdentity.id[goalId] } : {}) })!;
    updateActorContinuation(world, actor, revision, "dispatched"); return revision;
  };
  return { world, hall, workshop, actor, notebook, schedule, registry, choose };
}
function interruptedActivity() {
  const f = fixture(); startCommittedEvents(f.world); setLocatedIn(f.world, f.notebook, f.hall);
  const goal = createIntentGoal(f.world, f.actor, "Take the notebook", 7);
  const plan = createPlanEntity(f.world, f.actor, goal, { goalDescription: "Take the notebook", steps: [
    { description: "Pick it up", actionType: "pickup", target: "Notebook" },
    { description: "Inspect it", actionType: "observe", target: "Notebook" },
  ] });
  f.choose(goal);
  const activity = snapshotOngoingActivity(f.world, f.actor)!;
  const revision = integrateActorContinuation(f.world, f.actor, { purpose: "Answer a passing joke", actionType: "speak", observedAtSimMs: 0 })!;
  updateActorContinuation(f.world, f.actor, revision, "dispatched");
  executeActions(f.world, [{ eid: f.actor, action: { type: "speak", content: "Good one." } }], f.registry);
  expect(Plan.currentStep[plan]).toBe(0);
  return { ...f, goal, plan, activity };
}
test("a side turn returns to the actual physical plan without a new model thought", () => {
  const f = interruptedActivity();
  const action = selectFastAgentAction(f.world, f.actor);
  expect(action).toMatchObject({ type: "pickup", target: "Notebook" });
  expect(Plan.currentStep[f.plan]).toBe(0);
  expect(snapshotOngoingActivity(f.world, f.actor)?.id).toBe(f.activity.id);
  executeActions(f.world, [{ eid: f.actor, action: action! }], f.registry);
  expect(getDirectContainer(f.world, f.notebook)).toBe(f.actor);
  expect(Plan.currentStep[f.plan]).toBe(1);
  expect(generate).not.toHaveBeenCalled();
});
test("an old think-then-route plan cannot pull an actor back after independent movement", () => {
  const f = fixture(), goal = createIntentGoal(f.world, f.actor, "Get ready to leave", 7);
  const plan = createPlanEntity(f.world, f.actor, goal, { goalDescription: "Get ready to leave", steps: [
    { description: "Check readiness", actionType: "think", content: "I have what I need" },
    { description: "Pass through the hall", actionType: "move", target: "Hall" },
  ] });
  f.choose(goal);
  // The actor has progressed by a different action, not by executing this plan.
  setLocatedIn(f.world, f.actor, f.workshop);
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull();
  expect(Plan.currentStep[plan]).toBe(0);
  expect(Plan.status[plan]).toBe("failed");
});
test("matched route progress refreshes its origin and permits the next planned leg", () => {
  const f = fixture(), goal = createIntentGoal(f.world, f.actor, "Visit the workshop then return", 7);
  const plan = createPlanEntity(f.world, f.actor, goal, { goalDescription: "Visit the workshop then return", steps: [
    { description: "Go out", actionType: "move", target: "Workshop" },
    { description: "Return", actionType: "move", target: "Hall" },
  ] });
  f.choose(goal); expect(getNextPlannedAction(f.world, f.actor)?.target).toBe("Workshop");
  setLocatedIn(f.world, f.actor, f.workshop);
  // The normal completion boundary supplies actor/plan context after the move.
  advancePlanStep(plan, { world: f.world, agentEid: f.actor });
  expect(Plan.routeRoomKey[plan]).toBe(WorkingMemoryIdentity.id[f.workshop]);
  expect(getNextPlannedAction(f.world, f.actor)?.target).toBe("Hall");
});
test("removing the target during a side turn prevents resumed pickup and progress", () => {
  const f = interruptedActivity(); setLocatedIn(f.world, f.notebook, f.workshop);
  expect(selectFastAgentAction(f.world, f.actor)).toBeNull();
  expect(getDirectContainer(f.world, f.notebook)).toBe(f.workshop);
  expect(Plan.currentStep[f.plan]).toBe(0);
  expect(Plan.status[f.plan]).toBe("failed");
});
test("a same-name replacement cannot inherit an interrupted pickup", () => {
  const f = interruptedActivity(); setLocatedIn(f.world, f.notebook, f.workshop);
  const replacement = createObjectEntity(f.world, { name: "Notebook", portable: true, roomId: f.hall });
  expect(selectFastAgentAction(f.world, f.actor)).toBeNull();
  expect(getDirectContainer(f.world, replacement)).toBe(f.hall);
  expect(Plan.currentStep[f.plan]).toBe(0);
});
test("new attention defers resumption to cognition", () => {
  const f = interruptedActivity();
  addPerception(f.world, f.actor, { type: "attention", source: "alarm", signalKey: "fire", content: "The smoke alarm sounds." });
  expect(selectFastAgentAction(f.world, f.actor)).toBeNull();
  expect(snapshotActorContinuation(f.world, f.actor)?.purpose).toBe("Answer a passing joke");
  expect(Plan.currentStep[f.plan]).toBe(0);
});
test("native body occupation defers the return point until its real resource is released", () => {
  const f = interruptedActivity();
  expect(reserveSimulationResources(f.world, f.actor, "held-work", ["body"])).toBe(true);
  expect(selectFastAgentAction(f.world, f.actor)).toBeNull();
  expect(Plan.currentStep[f.plan]).toBe(0);
  releaseSimulationResources(f.world, f.actor, "held-work");
  expect(selectFastAgentAction(f.world, f.actor)).toMatchObject({ type: "pickup", target: "Notebook" });
});
test("resumption waits for speech completion and does not expire the organizing activity with the action lease", () => {
  const f = interruptedActivity();
  expect(beginTimedSpeech(f.world, f.actor, "Let me finish this sentence.", "side-voice", () => {}, () => {})).toBe(true);
  expect(selectFastAgentAction(f.world, f.actor)).toBeNull();
  advanceSimulationTimeline(f.world, 20_000, { integrate: () => {} });
  expect(selectFastAgentAction(f.world, f.actor)).toMatchObject({ type: "pickup", target: "Notebook" });
  expect(Plan.currentStep[f.plan]).toBe(0);
});
test("a busy physical executor prevents resumption without losing the return point", () => {
  const f = interruptedActivity();
  const release = registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => true, execute: () => false });
  // Revalidation after registration is an explicit choice, not restoration.
  f.choose(f.goal);
  const revision = integrateActorContinuation(f.world, f.actor, { purpose: "Answer a joke", actionType: "speak", observedAtSimMs: 0 })!;
  updateActorContinuation(f.world, f.actor, revision, "dispatched");
  expect(selectFastAgentAction(f.world, f.actor)).toBeNull();
  expect(snapshotOngoingActivity(f.world, f.actor)?.status).toBe("active");
  expect(Plan.currentStep[f.plan]).toBe(0); release();
});
const response = (action: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ text: JSON.stringify({ innerThought: "I want to inspect that notebook.",
  control: { version: 2, purpose: "Investigate the notebook", goalId: null, localDependencies: [] }, action, ...extra }) });

test("an explicit wait arms only after its exact foreground action executes", async () => {
  const f = fixture(); startCommittedEvents(f.world);
  generate.mockResolvedValueOnce(response({ type: "wait", waitUntil: { kind: "heard_evidence", timeoutMs: 12000 } }));
  const action = await agentThink(f.world, f.actor);
  expect(action.waitUntil).toEqual({ kind: "heard_evidence", timeoutMs: 12000 });
  expect(getActorWaitTiming(f.world, f.actor)).toBeUndefined();
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(getActorWaitTiming(f.world, f.actor)).toMatchObject({ invalid: false, deadlineMs: 12000 });
  advanceSimulationTimeline(f.world, 3000, { integrate: () => {} });
  expect(getForegroundCognitionReadiness(f.world, f.actor)).toMatchObject({ ready: false, nextCheckAtMs: 12000 });
  advanceSimulationTimeline(f.world, 9000, { integrate: () => {} });
  expect(getForegroundCognitionReadiness(f.world, f.actor)).toMatchObject({ ready: true, reason: "evidence_deadline" });
});
test("mutating an admitted wait condition cannot arm an altered timer", async () => {
  const f = fixture(); startCommittedEvents(f.world);
  generate.mockResolvedValueOnce(response({ type: "wait", waitUntil: { kind: "heard_evidence", timeoutMs: 12000 } }));
  const action = await agentThink(f.world, f.actor); action.waitUntil!.timeoutMs = 60000;
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(getActorWaitTiming(f.world, f.actor)).toBeUndefined();
});
test("invented physical waiting fields are rejected rather than treated as future events", async () => {
  const f = fixture();
  generate.mockResolvedValueOnce(response({ type: "wait", waitUntil: { kind: "physical_fact", subject: "imagined-taxi", predicate: "state", slot: "Observable.arrived", equals: "true" } }));
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(true);
  expect(getActorWaitTiming(f.world, f.actor)).toBeUndefined();
});
test("a chosen physical wait yields to a new observation, without claiming plan success", async () => {
  const f = fixture(); startCommittedEvents(f.world); setLocatedIn(f.world, f.notebook, f.hall);
  addComponent(f.world, f.notebook, ObjectState); ObjectState.current[f.notebook] = "closed";
  captureWorkingMemoryObservation(f.world, f.actor);
  generate.mockResolvedValueOnce(response({ type: "wait", waitUntil: { kind: "physical_fact", subject: "Notebook", predicate: "state", slot: "ObjectState.current", equals: "open", timeoutMs: 15000 } }));
  const action = await agentThink(f.world, f.actor);
  expect(action.waitUntil?.kind).toBe("physical_fact");
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(getActorWaitTiming(f.world, f.actor)).toMatchObject({ invalid: false });
  ObjectState.current[f.notebook] = "open"; captureWorkingMemoryObservation(f.world, f.actor);
  expect(getForegroundCognitionReadiness(f.world, f.actor).ready).toBe(true);
  expect(Goal.status[f.schedule]).toBe("active");
});
test("replacement of a grounded wait target before dispatch rejects the action", async () => {
  const f = fixture(); startCommittedEvents(f.world); setLocatedIn(f.world, f.notebook, f.hall);
  addComponent(f.world, f.notebook, ObjectState); ObjectState.current[f.notebook] = "closed";
  captureWorkingMemoryObservation(f.world, f.actor);
  generate.mockResolvedValueOnce(response({ type: "wait", waitUntil: { kind: "physical_fact", subject: "Notebook", predicate: "state", slot: "ObjectState.current", equals: "open" } }));
  const action = await agentThink(f.world, f.actor); expect(action.waitUntil).toBeDefined();
  setLocatedIn(f.world, f.notebook, f.workshop);
  createObjectEntity(f.world, { name: "Notebook", portable: true, roomId: f.hall });
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(getActorWaitTiming(f.world, f.actor)).toBeUndefined();
});

test("an unchosen live default schedule cannot seize the body after independent movement/pickup", async () => {
  const f = fixture();
  generate.mockResolvedValueOnce(response({ type: "move", target: "Workshop" }))
    .mockResolvedValueOnce(response({ type: "pickup", target: "Notebook" }))
    .mockResolvedValueOnce(response({ type: "observe", target: "Notebook" }));
  for (const expected of ["move", "pickup", "observe"]) {
    const action = await agentThink(f.world, f.actor);
    expect(action.type).toBe(expected); executeActions(f.world, [{ eid: f.actor, action }], f.registry);
    // No package clock: native room movement is settled at the test boundary.
    if (expected === "move") setLocatedIn(f.world, f.actor, f.workshop);
    expect(selectContractDrivenAction(f.world, f.actor)).toBeNull();
    expect(selectFastAgentAction(f.world, f.actor)).toBeNull();
  }
  expect(getDirectContainer(f.world, f.notebook)).toBe(f.actor);
  expect(Goal.status[f.schedule]).toBe("active"); expect(generate).toHaveBeenCalledTimes(3);
});

test("a selected lower-priority purpose recruits its own deterministic contract, not the schedule", () => {
  const f = fixture(), goal = createIntentGoal(f.world, f.actor, "Acquire notebook", 5);
  setGoalContract(f.world, goal, { version: 1, kind: "custom", params: {}, success: { type: "in_inventory", itemName: "Notebook" } });
  f.choose(goal); setLocatedIn(f.world, f.actor, f.workshop);
  expect(selectFastAgentAction(f.world, f.actor)).toMatchObject({ type: "pickup", target: "Notebook" });
  expect(selectContractDrivenAction(f.world, f.actor)).toMatchObject({ type: "pickup", target: "Notebook" });
});

test("chosen-plan filter excludes a competing higher-priority plan", () => {
  const f = fixture(), goal = createIntentGoal(f.world, f.actor, "Investigate notebook", 5);
  createPlanEntity(f.world, f.actor, f.schedule, { goalDescription: "Routine work", steps: [{ description: "Return", actionType: "move", target: "Hall" }] });
  createPlanEntity(f.world, f.actor, goal, { goalDescription: "Investigate notebook", steps: [{ description: "Inspect", actionType: "observe", target: "Notebook" }] });
  setLocatedIn(f.world, f.actor, f.workshop); f.choose(goal);
  expect(getNextPlannedAction(f.world, f.actor, { selectedGoalId: goal })?.target).toBe("Notebook");
  expect(selectFastAgentAction(f.world, f.actor)).toMatchObject({ type: "observe", target: "Notebook" });
});

test("execution captures the chosen lower-priority plan, not another goal with the same primitive", () => {
  const f = fixture(), other = createIntentGoal(f.world, f.actor, "Prepare a report", 10);
  const chosen = createIntentGoal(f.world, f.actor, "Investigate the notebook", 5);
  const step = { description: "Take notebook", actionType: "pickup", target: "Notebook" };
  const competingPlan = createPlanEntity(f.world, f.actor, other, { goalDescription: "Prepare report", steps: [step] });
  const chosenPlan = createPlanEntity(f.world, f.actor, chosen, { goalDescription: "Investigate notebook", steps: [step] });
  setLocatedIn(f.world, f.actor, f.workshop); f.choose(chosen);
  const action = { type: "pickup", target: "Notebook" } as const;
  expect(getNextPlannedAction(f.world, f.actor)?.goalEid).toBe(chosen);
  expect(getNextPlannedAction(f.world, f.actor, { selectedGoalId: other })).toBeNull();
  expect(capturePlanExecution(f.world, f.actor, action)).toMatchObject({ goalEid: chosen, planEid: chosenPlan });
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(Plan.status[chosenPlan]).toBe("completed"); expect(Plan.currentStep[competingPlan]).toBe(0);
  expect(getSuccessfulGoalActions(f.world, f.actor, chosen)).toMatchObject([{ type: "pickup", target: "Notebook" }]);
  expect(getSuccessfulGoalActions(f.world, f.actor, other)).toEqual([]);
});

test("independent action cannot advance or train an unrelated plan with identical action words", () => {
  const f = fixture(), goal = createIntentGoal(f.world, f.actor, "Prepare a report", 10);
  const plan = createPlanEntity(f.world, f.actor, goal, { goalDescription: "Prepare report", steps: [
    { description: "Take notebook", actionType: "pickup", target: "Notebook" },
  ] });
  setLocatedIn(f.world, f.actor, f.workshop); f.choose();
  const action = { type: "pickup", target: "Notebook" } as const;
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull(); expect(capturePlanExecution(f.world, f.actor, action)).toBeUndefined();
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(getDirectContainer(f.world, f.notebook)).toBe(f.actor); expect(Plan.currentStep[plan]).toBe(0);
  expect(getSuccessfulGoalActions(f.world, f.actor, goal)).toEqual([]);
  expect(getSuccessfulGoalActions(f.world, f.actor, f.schedule)).toEqual([]);
});

test("a selected contract without a plan learns only its own successful primitive", () => {
  const f = fixture(), chosen = createIntentGoal(f.world, f.actor, "Acquire notebook", 5);
  setGoalContract(f.world, chosen, { version: 1, kind: "custom", params: {}, success: { type: "in_inventory", itemName: "Notebook" } });
  setLocatedIn(f.world, f.actor, f.workshop); f.choose(chosen);
  const action = selectFastAgentAction(f.world, f.actor)!;
  expect(action).toMatchObject({ type: "pickup", target: "Notebook" });
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(getSuccessfulGoalActions(f.world, f.actor, chosen)).toMatchObject([{ type: "pickup", target: "Notebook" }]);
  expect(getSuccessfulGoalActions(f.world, f.actor, f.schedule)).toEqual([]);
});

test("choosing the schedule explicitly allows its deterministic return; stale choices require cognition", () => {
  const f = fixture(); setLocatedIn(f.world, f.actor, f.workshop); f.choose(f.schedule);
  expect(selectFastAgentAction(f.world, f.actor)).toMatchObject({ type: "move", target: "Hall" });
  f.world.time.elapsed = 10_000;
  expect(selectFastAgentAction(f.world, f.actor)).toBeNull(); expect(selectContractDrivenAction(f.world, f.actor)).toBeNull();
});

test("offline deterministic schedules remain available without inferred live autonomy", () => {
  const f = fixture(); f.world.meta.aiEnabled = false; setLocatedIn(f.world, f.actor, f.workshop);
  expect(selectContractDrivenAction(f.world, f.actor)).toMatchObject({ type: "move", target: "Hall" });
});

test("an unchosen generated schedule plan is not a backdoor around contract ownership", () => {
  const f = fixture(); setLocatedIn(f.world, f.actor, f.workshop);
  createPlanEntity(f.world, f.actor, f.schedule, { goalDescription: "Routine work", steps: [{ description: "Return", actionType: "move", target: "Hall" }] });
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull();
  expect(selectFastAgentAction(f.world, f.actor)).toBeNull();
  f.choose(f.schedule);
  expect(selectFastAgentAction(f.world, f.actor)).toMatchObject({ type: "move", target: "Hall" });
});

test("a model review records explicit deferral without another inference or action coercion", async () => {
  const f = fixture(); addPerception(f.world, f.actor, { type: "attention", source: "indicator", signalKey: "one", content: "My familiar indicator flashes." });
  const signal = snapshotAttentionSignals(f.world, f.actor)[0];
  generate.mockResolvedValue(response({ type: "wait" }, { attentionReview: { signalId: signal.id, disposition: "defer", reason: "I want to finish my conversation", afterSeconds: 60 } }));
  const action = await agentThink(f.world, f.actor);
  expect(action.type).toBe("wait"); expect(snapshotAttentionSignals(f.world, f.actor)[0]).toMatchObject({ status: "deferred", reconsiderAtSimMs: 60_000 });
  expect(generate).toHaveBeenCalledTimes(1); expect(getAgentThoughts(f.world, f.actor)).toHaveLength(1);
  expect(hasUnintegratedAttention(f.world, f.actor)).toBe(false);
  expect(generate.mock.calls[0][0].system).toContain("UNRESOLVED EXPERIENCED SIGNALS");
});

test("an invented review ID rejects the whole mental envelope, leaving the real signal unresolved", async () => {
  const f = fixture(); addPerception(f.world, f.actor, { type: "attention", source: "indicator", signalKey: "one", content: "My familiar indicator flashes." });
  generate.mockResolvedValue(response({ type: "wait" }, { attentionReview: { signalId: "fabricated", disposition: "consider", reason: "I say I considered it" } }));
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  expect(snapshotAttentionSignals(f.world, f.actor)[0]).not.toHaveProperty("lastPresentedAtSimMs");
});

test("foreground receives earlier postponements but remains free to choose quiet company", async () => {
  const f = fixture(); addPerception(f.world, f.actor, { type: "attention", source: "indicator", signalKey: "one", content: "My familiar indicator flashes." });
  for (const now of [0, 15000]) {
    f.world.time.elapsed = now; const issued = snapshotAttentionSignals(f.world, f.actor);
    prepareAttentionReview(f.world, f.actor, issued, { signalId: issued[0].id, disposition: "defer",
      reason: now ? "Hear one more answer" : "After this exchange", afterSeconds: 15 })!.commit();
  }
  f.world.time.elapsed = 30000; const signal = snapshotAttentionSignals(f.world, f.actor)[0];
  generate.mockResolvedValue(response({ type: "wait" }, { attentionReview: { signalId: signal.id,
    disposition: "defer", reason: "Quiet company matters to me more right now", afterSeconds: 120 } }));
  const action = await agentThink(f.world, f.actor);
  expect(action.type).toBe("wait");
  expect(generate.mock.calls[0][0].system).toContain("After this exchange");
  expect(generate.mock.calls[0][0].system).toContain("Hear one more answer");
  expect(snapshotAttentionSignals(f.world, f.actor)[0]).toMatchObject({ reviewRevision: 3, reconsiderAtSimMs: 150000 });
});

test("a resolved signal cannot receive a late model deferral", async () => {
  const f = fixture(); addPerception(f.world, f.actor, { type: "attention", source: "indicator", signalKey: "one", content: "My familiar indicator flashes." });
  const signal = snapshotAttentionSignals(f.world, f.actor)[0];
  generate.mockImplementation(async () => {
    resolveAttentionSignal(f.world, f.actor, { source: "indicator", signalKey: "one" });
    return response({ type: "wait" }, { attentionReview: { signalId: signal.id, disposition: "defer", reason: "Later", afterSeconds: 60 } });
  });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
  expect(snapshotAttentionSignals(f.world, f.actor)).toEqual([]); expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});
