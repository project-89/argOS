import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { addComponent, addEntity, getRelationTargets } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } = await import("../../ecs/prefabs");
const { Goal, Plan, Schedule, LastAction, Needs, ObjectState, WorkingMemoryIdentity } = await import("../../ecs/components");
const { HasGoal, HasPlan, HasSchedule } = await import("../../ecs/relations");
const { setLocatedIn } = await import("../../ecs/location");
const { createSystemRegistry, registerSystem, runSystems } = await import("../../ecs/dynamic-systems");
const { createScheduledActivityGoalSystem, createScheduledActivityTemplatePlannerSystem, createDayPlanPreplannerSystem, createDayPlanActivationSystem } = await import("../../systems/scheduled-activity-systems");
const { evaluateGoalSuccessContract } = await import("../../systems/goal-evaluation-system");
const { agentThink, selectFastAgentAction, addPerception } = await import("../agent-mind");
const { executeActions } = await import("../cognition-system");
const { integrateActorContinuation, updateActorContinuation, snapshotActorContinuation } = await import("../actor-continuation");
const { captureCoordinationGoal } = await import("../coordination-memory");
const { workingMemoryEntityRef } = await import("../working-memory");
const { getForegroundCognitionReadiness } = await import("../idle-cognition");
const { isDiscardedForegroundDecision } = await import("../foreground-action-admission");
const { clearTimedSpeech, getSpeakingActivity } = await import("../timed-speech");
const { drainPendingStimuli } = await import("../stimulus-queue");
const { advanceSimulationTimeline } = await import("../../runtime/simulation-timeline");
const { startCommittedEvents } = await import("../../runtime/committed-events");

let previousKey: string | undefined;
const worlds: ReturnType<typeof createArgosWorld>[] = [];
beforeEach(() => {
  previousKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  jest.useFakeTimers(); jest.setSystemTime(1_800_000_000_000);
  generate.mockReset(); drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Scheduled choice tests are offline"));
});
afterEach(() => {
  for (const world of worlds.splice(0)) clearTimedSpeech(world);
  drainPendingStimuli(); expect(globalThis.fetch).not.toHaveBeenCalled();
  jest.restoreAllMocks(); jest.useRealTimers();
  if (previousKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  else process.env.GOOGLE_GENERATIVE_AI_API_KEY = previousKey;
});

function fixture(controller: "priority" | "situated" = "priority", withChair = false, activity = "afternoon leisure") {
  const world = createArgosWorld("Scheduled choice ownership"); worlds.push(world);
  initializePrefabs(world); world.meta.aiEnabled = true; world.meta.cognitionController = controller;
  world.time.simulationHour = 13; startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Lounge" }), away = createRoomEntity(world, { name: "Kitchen" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Choose what matters to you.", roomId: room });
  if (activity === "lunch") Needs.hunger[actor] = 80;
  if (activity === "sleep") Needs.energy[actor] = 20;
  const schedule = addEntity(world); addComponent(world, schedule, Schedule); addComponent(world, actor, HasSchedule(schedule));
  Schedule.activities[schedule] = JSON.stringify([{ name: activity, startHour: 13, duration: 1, location: "Lounge", priority: 5 }]);
  const registry = createSystemRegistry();
  // Meal/sleep admission normally requires a currently usable object. Exercise
  // their queued day-plan path too: the object may be absent when the slot opens.
  if (activity === "afternoon leisure") registerSystem(registry, { ...createScheduledActivityGoalSystem(), frequency: 0 });
  else {
    registerSystem(registry, { ...createDayPlanPreplannerSystem(), frequency: 0 });
    registerSystem(registry, { ...createDayPlanActivationSystem(), frequency: 0 });
  }
  registerSystem(registry, { ...createScheduledActivityTemplatePlannerSystem(), frequency: 0 });
  const chair = withChair ? createObjectEntity(world, { name: "Armchair", traits: ["chair"], portable: false, roomId: room }) : undefined;
  const tick = () => {
    runSystems(world, registry, world.time.tick + 1, 500);
    expect(registry.errors).toEqual([]);
  };
  tick();
  const goals = getRelationTargets(world, actor, HasGoal).filter(id => Goal.kind[id] === "scheduled_activity");
  expect(goals).toHaveLength(1); const goal = goals[0];
  const plans = () => getRelationTargets(world, actor, HasPlan);
  const choose = (actionType: string, purpose = "Take a quiet break") => {
    workingMemoryEntityRef(world, actor); captureCoordinationGoal(world, actor, goal);
    const revision = integrateActorContinuation(world, actor, { purpose, actionType, goalId: goal,
      goalKey: WorkingMemoryIdentity.id[goal], observedAtSimMs: world.time.elapsed })!;
    updateActorContinuation(world, actor, revision, "dispatched");
    return revision;
  };
  const advance = (ms: number) => advanceSimulationTimeline(world, ms, { integrate: () => {} });
  return { world, room, away, actor, chair, goal, registry, plans, tick, choose, advance };
}

test.each(["afternoon leisure", "lunch", "sleep"])("an unchanged room cannot manufacture %s progress from observation", activity => {
  const f = fixture("priority", false, activity);
  for (let i = 0; i < 6; i++) {
    f.choose("wait");
    executeActions(f.world, [{ eid: f.actor, action: { type: "wait" } }], f.registry);
    f.advance(1000); f.tick();
    expect(f.plans()).toEqual([]);
    expect(Goal.status[f.goal]).toBe("active");
    expect(evaluateGoalSuccessContract(f.world, f.actor, f.goal).satisfied).toBe(false);
  }
  expect(LastAction.type[f.actor]).toBe("wait");
  expect(generate).not.toHaveBeenCalled();
});

test.each(["priority", "situated"] as const)("%s preserves an explicit same-goal wait or rest instead of recruiting a plan", controller => {
  const f = fixture(controller, true), plan = f.plans()[0]; expect(plan).toBeDefined();
  for (const type of ["wait", "rest"] as const) {
    f.choose(type);
    executeActions(f.world, [{ eid: f.actor, action: { type } }], f.registry);
    for (let i = 0; i < 3; i++) {
      f.advance(500); f.tick();
      expect(selectFastAgentAction(f.world, f.actor)).toBeNull();
      expect(snapshotActorContinuation(f.world, f.actor)?.actionType).toBe(type);
      expect(Plan.status[plan]).toBe("active"); expect(Plan.currentStep[plan]).toBe(0);
    }
  }
  expect(generate).not.toHaveBeenCalled();
});

test.each(["priority", "situated"] as const)("%s allows a real chosen activity and retains its target guard", controller => {
  const f = fixture(controller, true), plan = f.plans()[0]; f.choose("observe", "Sit in the armchair");
  expect(selectFastAgentAction(f.world, f.actor)).toMatchObject({ type: "observe", target: "Armchair" });
  expect(JSON.parse(Plan.steps[plan])).toEqual(expect.arrayContaining([expect.objectContaining({ actionType: "interact", target: "Armchair", content: "sit" })]));
  setLocatedIn(f.world, f.chair!, f.away);
  expect(selectFastAgentAction(f.world, f.actor)).toBeNull();
  expect(Plan.currentStep[plan]).toBe(0); expect(Plan.status[plan]).toBe("failed");
  expect(Goal.status[f.goal]).toBe("active");
});

test.each(["priority", "situated"] as const)("%s keeps listening under a scheduled purpose until the actor chooses again", controller => {
  const f = fixture(controller, true); f.world.meta.timedSpeech = true;
  const friend = createAgentEntity(f.world, { name: "Bo", role: "friend", systemPrompt: "Speak naturally.", roomId: f.room });
  executeActions(f.world, [{ eid: friend, action: { type: "speak", target: "Ada", content: "I wanted to tell you about the interesting person I met at the market this morning." } }], f.registry);
  const speaking = getSpeakingActivity(f.world, friend)!; expect(speaking).toBeDefined();
  f.advance(700); drainPendingStimuli();
  f.choose("wait", "Hear Bo out while taking a break");
  executeActions(f.world, [{ eid: f.actor, action: { type: "wait", listeningTo: speaking.executionId } }], f.registry);
  f.advance(200); drainPendingStimuli();
  expect(getForegroundCognitionReadiness(f.world, f.actor).ready).toBe(false);
  expect(selectFastAgentAction(f.world, f.actor)).toBeNull();
  expect(Plan.currentStep[f.plans()[0]]).toBe(0); expect(LastAction.type[f.actor]).toBe("wait");
});

test.each(["priority", "situated"] as const)("%s can reconsider quiet waiting on new evidence and execute its fresh choice", async controller => {
  const f = fixture(controller); f.choose("wait");
  executeActions(f.world, [{ eid: f.actor, action: { type: "wait" } }], f.registry);
  const chair = createObjectEntity(f.world, { name: "Armchair", traits: ["chair"], portable: false, roomId: f.room });
  f.tick(); expect(f.plans()).toHaveLength(1);
  addPerception(f.world, f.actor, { type: "attention", source: "sight", signalKey: "chair-available", content: "An armchair has been brought into the lounge." });
  expect(selectFastAgentAction(f.world, f.actor)).toBeNull(); // A proposal is not the actor's choice.
  generate.mockResolvedValueOnce({ text: JSON.stringify({ innerThought: "I can make myself comfortable now.",
    control: { version: 2, purpose: "Sit in the armchair", goalId: f.goal, localDependencies: [] },
    action: { type: "interact", target: "Armchair", content: "sit" } }) });
  const action = await agentThink(f.world, f.actor);
  expect(generate).toHaveBeenCalledTimes(1); expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(action).toMatchObject({ type: "interact", target: "Armchair", content: "sit" });
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(LastAction.success[f.actor]).toBe(true); expect(ObjectState.current[chair]).toBe("occupied");
  expect(snapshotActorContinuation(f.world, f.actor)?.actionType).toBe("interact");
});
