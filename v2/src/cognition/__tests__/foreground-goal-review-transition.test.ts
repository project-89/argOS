import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { addComponent, addEntity } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } = await import("../../ecs/prefabs");
const { Goal, GoalLifecycle, ObjectState, Plan, WorkingMemoryIdentity } = await import("../../ecs/components");
const { HasPlan } = await import("../../ecs/relations");
const { createPersonalIntention, requestIntentionReconsideration } = await import("../goal-lifecycle");
const { agentThink, getAgentThoughts } = await import("../agent-mind");
const { isDiscardedForegroundDecision, consumeForegroundAction } = await import("../foreground-action-admission");
const { integrateActorContinuation, snapshotActorContinuation } = await import("../actor-continuation");
const { snapshotOngoingActivity } = await import("../ongoing-activity");
const { queueExperiencedEvent } = await import("../experience-appraisal");
const { resumeDeferredGoals, captureGoalReviewContext, prepareGoalReview } = await import("../goal-pursuit");
const { registerAgentWorldCapabilities } = await import("../world-capabilities");
const { chronicle } = await import("../simulation-chronicle");
const { workingMemoryEntityRef } = await import("../working-memory");
const { executeActions } = await import("../cognition-system");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { ApartmentSitcom } = await import("../../demo/apartment-sitcom");
const { getDirectContainer, setLocatedIn } = await import("../../ecs/location");

function fixture(disposition = "defer", otherActivity = false) {
  const world = createArgosWorld("Closing an intention is not continuing its work");
  world.meta.aiEnabled = true; world.meta.cognitionController = "priority"; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Hall" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Act from experience.", roomId: room });
  workingMemoryEntityRef(world, actor);
  const notebook = createObjectEntity(world, { name: "Notebook", roomId: room });
  ObjectState.current[notebook] = "closed";
  registerAgentWorldCapabilities(world, actor, { context: () => "", ready: () => true, busy: () => false, execute: () => false });
  const goal = createPersonalIntention(world, actor, "Stay in touch with my friend", 6)!;
  GoalLifecycle.persistence[goal] = disposition === "release" ? "episodic" : "standing";
  const other = createPersonalIntention(world, actor, "Consider what to do this evening", 4)!;
  const activityGoal = otherActivity ? other : goal;
  integrateActorContinuation(world, actor, { purpose: Goal.description[activityGoal], actionType: "think",
    goalId: activityGoal, goalKey: WorkingMemoryIdentity.id[activityGoal], observedAtSimMs: 0 });
  expect(snapshotOngoingActivity(world, actor)?.status).toBe("active");
  const plan = addEntity(world); addComponent(world, plan, Plan); addComponent(world, actor, HasPlan(plan));
  Plan.goalEid[plan] = goal; Plan.status[plan] = "active"; Plan.steps[plan] = "[]"; Plan.currentStep[plan] = 0;
  const receipt = (id: string) => queueExperiencedEvent(world, actor, { id, channel: "message:friend", source: "Friend",
    content: "An actually read message", atSimMs: 0 });
  receipt("read-one");
  const response = (actionType = "think", extra: Record<string, unknown> = {}) => ({
    control: { version: 2, purpose: "I am setting this intention aside for now.", goalId: goal, localDependencies: [] },
    innerThought: "No new messages. I can set this aside.",
    action: { type: actionType },
    goalReview: { goalId: goal, disposition, reason: "I have considered this and choose to set it aside.",
      ...(disposition === "defer" ? { afterSeconds: 30, wake: { kind: "experience", channel: "message:friend" } } : {}) },
    ...extra,
  });
  return { world, actor, goal, other, plan, receipt, response };
}
let oldKey: string | undefined;
let apartment: Awaited<ReturnType<typeof ApartmentSitcom.create>> | undefined;
beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Must stay offline"));
});
afterEach(() => {
  apartment?.stop(); apartment = undefined;
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey;
});

test.each(["priority", "situated"])("%s foreground retains an intention without selecting its old activity or plan", async controller => {
  const f = fixture("release", true); f.world.meta.cognitionController = controller;
  const activity = snapshotOngoingActivity(f.world, f.actor);
  expect(requestIntentionReconsideration(f.world, f.actor, f.goal, "Reconsider this inactive intention")).toBe(true);
  generate.mockResolvedValue({ text: JSON.stringify({ control: { version: 2, purpose: "I still want to answer later", goalId: null, localDependencies: [] },
    goalReview: { goalId: f.goal, disposition: "retain", reason: "It still matters" }, action: { type: "think" } }) });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(false); expect(Goal.status[f.goal]).toBe("active");
  expect(Plan.status[f.plan]).toBe("retired"); expect(Goal.progress[f.goal]).toBe(0);
  expect(snapshotOngoingActivity(f.world, f.actor)).toEqual(activity);
  expect(consumeForegroundAction(f.world, f.actor, action).admitted).toBe(true);
});
test("retaining cannot authorize same-turn work on the paused intention", async () => {
  const f = fixture("release"); requestIntentionReconsideration(f.world, f.actor, f.goal, "Needs reconsideration");
  generate.mockResolvedValue({ text: JSON.stringify({ control: { version: 2, purpose: "Resume", goalId: f.goal, localDependencies: [] },
    goalReview: { goalId: f.goal, disposition: "retain", reason: "Still wanted" }, action: { type: "pickup", target: "Notebook", goalId: f.goal } }) });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
  expect(Goal.status[f.goal]).toBe("paused"); expect(Goal.progress[f.goal]).toBe(0);
});
test("active-review-retain cannot resurrect a previously integrated foreground action", async () => {
  const f = fixture("release");
  generate.mockResolvedValue({ text: JSON.stringify({ control: { version: 2, purpose: "Take my notebook", goalId: f.goal, localDependencies: [] },
    action: { type: "pickup", target: "Notebook", goalId: f.goal } }) });
  const action = await agentThink(f.world, f.actor); expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(requestIntentionReconsideration(f.world, f.actor, f.goal, "Review needed")).toBe(true);
  expect(prepareGoalReview(captureGoalReviewContext(f.world, f.actor), { goalId: f.goal, disposition: "retain", reason: "Still wanted" })?.commit()).toBe(true);
  expect(consumeForegroundAction(f.world, f.actor, action).admitted).toBe(false);
  expect(snapshotOngoingActivity(f.world, f.actor)?.needsRevalidation).toBe(true);
  expect(Goal.progress[f.goal]).toBe(0);
});

test.each(["defer", "release", "withdraw"])("%s can refer to the departing intention in a closing thought without recreating pursuit", async disposition => {
  const f = fixture(disposition), log = jest.spyOn(chronicle, "record");
  generate.mockResolvedValue({ text: JSON.stringify(f.response()) });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(action.type).toBe("think"); expect(action.coordinationGoal).toBeUndefined();
  expect(Goal.status[f.goal]).toBe(disposition === "defer" ? "paused" : "retired");
  expect(Goal.progress[f.goal]).toBe(0); expect(Plan.status[f.plan]).toBe("retired");
  expect(snapshotActorContinuation(f.world, f.actor)?.goalId).toBeUndefined();
  expect(snapshotOngoingActivity(f.world, f.actor)?.status).toBe(disposition === "defer" ? "paused" : "ended");
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(1);
  executeActions(f.world, [{ eid: f.actor, action }], createSystemRegistry());
  expect(log).not.toHaveBeenCalledWith("decision_superseded", expect.anything());
  expect(Goal.progress[f.goal]).toBe(0);
  expect(log).not.toHaveBeenCalledWith("goal_completed", expect.anything());
});

test("an ordinary wait can accompany deferral, and a newly read message resumes the goal but not its retired plan", async () => {
  const f = fixture(); generate.mockResolvedValue({ text: JSON.stringify(f.response("wait")) });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(false); expect(action.type).toBe("wait");
  expect(Goal.status[f.goal]).toBe("paused"); expect(resumeDeferredGoals(f.world, f.actor)).toBe(0);
  f.receipt("read-two"); expect(resumeDeferredGoals(f.world, f.actor)).toBe(1);
  expect(Goal.status[f.goal]).toBe("active"); expect(Plan.status[f.plan]).toBe("retired");
  expect(snapshotOngoingActivity(f.world, f.actor)?.status).toBe("paused");
});

test("setting aside a side intention does not pause the actor's different organizing activity", async () => {
  const f = fixture("defer", true), before = snapshotOngoingActivity(f.world, f.actor);
  Goal.priority[f.other] = 9;
  generate.mockResolvedValue({ text: JSON.stringify(f.response()) });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(false);
  expect(Goal.status[f.goal]).toBe("paused"); expect(Goal.status[f.other]).toBe("active");
  expect(snapshotOngoingActivity(f.world, f.actor)).toEqual(before);
});

test.each([true, false])("closing conditional wait preserves normal observable-condition validation (known=%s)", async known => {
  const f = fixture(), proposal = f.response("wait", { action: { type: "wait", waitUntil: {
    kind: "physical_fact", subject: known ? "Notebook" : "An unseen private notebook", predicate: "state",
    slot: "ObjectState.current", equals: "open", timeoutMs: 15000,
  } } });
  generate.mockResolvedValue({ text: JSON.stringify(proposal) });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(!known);
  expect(Goal.status[f.goal]).toBe(known ? "paused" : "active");
  if (known) {
    expect(action.waitUntil).toMatchObject({ kind: "physical_fact", equals: "open", timeoutMs: 15000 });
    executeActions(f.world, [{ eid: f.actor, action }], createSystemRegistry());
    expect(Goal.progress[f.goal]).toBe(0);
  }
});

test("explicitly ending an activity can accompany a release about the same goal", async () => {
  const f = fixture("release"), proposal = f.response();
  generate.mockResolvedValue({ text: JSON.stringify({ ...proposal, control: { ...proposal.control, activityDisposition: "end" } }) });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(false);
  expect(Goal.status[f.goal]).toBe("retired"); expect(Goal.progress[f.goal]).toBe(0);
  expect(snapshotOngoingActivity(f.world, f.actor)?.status).toBe("ended");
});

test.each(["action_credit", "undertaking_credit", "motor_plan", "continue", "replace", "success"])("a closing reference cannot disguise contradictory %s authority", async kind => {
  const f = fixture(), log = jest.spyOn(chronicle, "record"); const proposal: any = f.response();
  if (kind === "action_credit") proposal.action.goalId = f.goal;
  if (kind === "undertaking_credit") proposal.action.undertakingId = "a-promise";
  if (kind === "motor_plan") proposal.motorPlan = [{ type: "pickup", target: "Notebook" }, { type: "drop", target: "Notebook" }];
  if (["continue", "replace"].includes(kind)) proposal.control.activityDisposition = kind;
  if (kind === "success") proposal.socialGoalReview = { goalId: f.goal, disposition: "satisfied_for_now" };
  generate.mockResolvedValue({ text: JSON.stringify(proposal) });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
  expect(log).toHaveBeenCalledWith("decision_rejected", expect.objectContaining({ schemaField: "goalReview.conflict" }));
  expect(Goal.status[f.goal]).toBe("active"); expect(Plan.status[f.plan]).toBe("active");
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test.each([
  { type: "pickup", target: "Notebook" },
  { type: "observe", target: "Notebook" },
  { type: "rest" },
  { type: "speak", content: "I am setting this aside for now." },
])("closing reference can accompany uncredited $type without retaining goal authority", async selected => {
  const f = fixture("release");
  generate.mockResolvedValue({ text: JSON.stringify(f.response(selected.type, { action: selected })) });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(action).toMatchObject(selected); expect(action.coordinationGoal).toBeUndefined();
  expect(action.coordinationWork).toBeUndefined();
  expect(Goal.status[f.goal]).toBe("retired"); expect(Goal.progress[f.goal]).toBe(0);
  expect(Plan.status[f.plan]).toBe("retired");
  expect(snapshotActorContinuation(f.world, f.actor)?.goalId).toBeUndefined();
  expect(snapshotOngoingActivity(f.world, f.actor)?.status).toBe("ended");
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(1);
});

test.each(["valid", "moved_before_dispatch", "read_during_cognition"])("native closing drop preserves physical timing, freshness and no success credit (%s)", async variant => {
  apartment = await ApartmentSitcom.create({ live: false, scenario: "duet", outsideTextAtMs: null, cognitionController: "priority" });
  const t = apartment, world = t.sim.world, actor = t.ids.Jerry, mug = t.ids.blueMug;
  await t.start();
  t.dispatch("Jerry", { type: "move", target: "Kitchen" }); t.advance(3000);
  t.dispatch("Jerry", { type: "pickup", target: "Blue mug" }); t.advance(800);
  expect(getDirectContainer(world, mug)).toBe(actor);
  world.meta.aiEnabled = true; // Only the explicitly invoked, mocked foreground call.
  const goal = createPersonalIntention(world, actor, "Have a coffee before the evening", 10)!;
  GoalLifecycle.persistence[goal] = "episodic";
  integrateActorContinuation(world, actor, { purpose: Goal.description[goal], actionType: "think",
    goalId: goal, goalKey: WorkingMemoryIdentity.id[goal], observedAtSimMs: t.elapsedMs });
  const receipt = (id: string) => queueExperiencedEvent(world, actor, { id, channel: "message:friend", source: "Friend",
    content: "An actually read message", atSimMs: t.elapsedMs });
  receipt("before-thinking");
  generate.mockImplementation(async () => {
    if (variant === "read_during_cognition") receipt("during-thinking");
    return { text: JSON.stringify({
      control: { version: 2, purpose: "Put the mug down and set the coffee idea aside.", goalId: goal,
        switchReason: "I no longer want a drink right now.", localDependencies: [] },
      innerThought: "I do not want this coffee now. I will put the mug down.",
      action: { type: "drop", target: "Blue mug" },
      goalReview: { goalId: goal, disposition: variant === "read_during_cognition" ? "defer" : "release",
        reason: "I choose to set this intention aside.", ...(variant === "read_during_cognition"
          ? { afterSeconds: 30, wake: { kind: "experience", channel: "message:friend" } } : {}) },
    }) };
  });
  const action = await agentThink(world, actor);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(isDiscardedForegroundDecision(action)).toBe(variant === "read_during_cognition");
  expect(Goal.status[goal]).toBe(variant === "read_during_cognition" ? "active" : "retired");
  expect(Goal.progress[goal]).toBe(0); expect(getDirectContainer(world, mug)).toBe(actor);
  if (variant === "read_during_cognition") return;
  expect(action.coordinationGoal).toBeUndefined(); expect(action.coordinationWork).toBeUndefined();
  if (variant === "moved_before_dispatch") setLocatedIn(world, mug, t.ids.living);
  t.dispatch("Jerry", action);
  if (variant === "valid") expect(getDirectContainer(world, mug)).toBe(actor);
  t.advance(599); // Native drop duration is600ms, distinct from800ms pickup.
  expect(getDirectContainer(world, mug)).toBe(variant === "valid" ? actor : t.ids.living);
  t.advance(1);
  expect(getDirectContainer(world, mug)).toBe(variant === "valid" ? t.ids.kitchen : t.ids.living);
  expect(Goal.status[goal]).toBe("retired"); expect(Goal.progress[goal]).toBe(0);
  expect(snapshotOngoingActivity(world, actor)?.status).toBe("ended");
});

test("a closing physical action cannot detach from a stale mental transition", async () => {
  const f = fixture("release");
  generate.mockImplementation(async () => {
    Goal.priority[f.other] = 9; // Changed organizing choice, not a changed notebook.
    return { text: JSON.stringify(f.response("pickup", { action: { type: "pickup", target: "Notebook" } })) };
  });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(true);
  expect(Goal.status[f.goal]).toBe("active"); expect(Plan.status[f.plan]).toBe("active");
  expect(snapshotOngoingActivity(f.world, f.actor)?.status).toBe("active");
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test.each(["unreviewable", "new_receipt", "replaced_goal"])("a %s source still prevents the entire closing transition", async kind => {
  const f = fixture();
  if (kind === "unreviewable") GoalLifecycle.source[f.goal] = "authored";
  generate.mockImplementation(async () => {
    if (kind === "new_receipt") f.receipt("arrived-during-thinking");
    if (kind === "replaced_goal") WorkingMemoryIdentity.id[f.goal] = "replacement-goal";
    return { text: JSON.stringify(f.response()) };
  });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
  expect(Goal.status[f.goal]).toBe("active"); expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});
