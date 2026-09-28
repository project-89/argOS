import { jest } from "@jest/globals";
import { getRelationTargets } from "bitecs";
import { Goal, Plan, WorkingMemoryIdentity } from "../../ecs/components";
import { HasGoal, HasPlan } from "../../ecs/relations";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { createCommunicationMotivation } from "../communication-motivation";
import { createGeneratedIntention, isStandingIntention, markStandingIntention } from "../goal-lifecycle";
import { createPlanEntity, getNextPlannedAction, hasPendingPlanning, runPlanningSystem, type GeneratedPlan } from "../planning-system";
import { executeActions } from "../cognition-system";
import { integrateActorContinuation } from "../actor-continuation";
import { drainPendingStimuli } from "../stimulus-queue";
import { ApartmentSitcom } from "../../demo/apartment-sitcom";

const draft: GeneratedPlan = { goalDescription: "Consider the evidence", estimatedCompletion: "short", potentialObstacles: [],
  steps: [{ actionType: "think", description: "Consider the evidence", content: "I can choose what to do with this experience." }] };
let bed: ApartmentSitcom | undefined;
beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Standing planning regressions are offline"));
  drainPendingStimuli();
});
afterEach(() => {
  bed?.stop(); bed = undefined;
  expect(globalThis.fetch).not.toHaveBeenCalled();
  drainPendingStimuli(); jest.useRealTimers(); jest.restoreAllMocks();
});
function fixture() {
  const world = createArgosWorld("A motivation is not a never-ending task"); initializePrefabs(world); world.meta.aiEnabled = true;
  const room = createRoomEntity(world, { name: "Home" });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "Choose your own evening.", roomId: room });
  const motivation = createCommunicationMotivation(world, actor, { description: "Stay reachable while choosing how to spend my time.",
    memory: "A vibration reveals a notification, not its contents.", priority: 8 });
  const episodic = (description = "Consider what I learned about the workshop") => createGeneratedIntention(world, actor,
    { description, kind: "social", priority: 4 }, "personal")!;
  return { world, actor, motivation, episodic };
}

test.each([false, true])("an idle standing motivation creates no automatic planning demand (background=%s)", async background => {
  const f = fixture(), generate = jest.fn(async () => draft);
  const options = { background, focusActiveGoal: true, agentEids: [f.actor] };
  for (let tick = 0; tick < 4; tick++) {
    expect(hasPendingPlanning(f.world, f.actor, options)).toBe(false);
    await runPlanningSystem(f.world, { ...options, planGenerator: generate });
  }
  expect(generate).not.toHaveBeenCalled();
  expect(getRelationTargets(f.world, f.actor, HasPlan)).toEqual([]);
  expect(Goal.status[f.motivation.goal]).toBe("active"); expect(Goal.progress[f.motivation.goal]).toBe(0);
});

test.each([false, true])("standing priority does not starve separate episodic work (background=%s)", async background => {
  const f = fixture(), goal = f.episodic(), generate = jest.fn(async () => draft);
  const options = { background, focusActiveGoal: true, agentEids: [f.actor] };
  expect(hasPendingPlanning(f.world, f.actor, options)).toBe(true);
  await runPlanningSystem(f.world, { ...options, planGenerator: generate });
  expect(generate).toHaveBeenCalledTimes(1); expect(generate.mock.calls[0]).toEqual([f.world, f.actor, goal]);
  const plans = getRelationTargets(f.world, f.actor, HasPlan);
  expect(plans).toHaveLength(1); expect(Plan.goalEid[plans[0]]).toBe(goal); expect(Plan.status[plans[0]]).toBe("active");
  expect(Goal.status[f.motivation.goal]).toBe("active");
});

test("lifecycle, not availability wording, distinguishes a standing drive from chosen work", async () => {
  const f = fixture(); Goal.description[f.motivation.goal] = "Maintain my relationship with my sister";
  const goal = f.episodic("Stay reachable while choosing how to spend my time."), generate = jest.fn(async () => draft);
  expect(isStandingIntention(f.world, goal)).toBe(false);
  await runPlanningSystem(f.world, { agentEids: [f.actor], background: true, planGenerator: generate });
  expect(generate).toHaveBeenCalledTimes(1); expect(generate.mock.calls[0]).toEqual([f.world, f.actor, goal]);
});

test.each(["completed", "failed"])("a %s standing plan does not restart merely because its retry interval elapsed", async status => {
  jest.useFakeTimers(); jest.setSystemTime(100_000);
  const f = fixture(), plan = createPlanEntity(f.world, f.actor, f.motivation.goal, draft);
  Plan.status[plan] = status;
  const before = [Plan.steps[plan], Plan.currentStep[plan], Plan.status[plan]], generate = jest.fn(async () => draft);
  for (const now of [160_000, 220_000, 400_000]) {
    jest.setSystemTime(now);
    expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
    await runPlanningSystem(f.world, { agentEids: [f.actor], background: true, planGenerator: generate });
  }
  expect(generate).not.toHaveBeenCalled(); expect(getRelationTargets(f.world, f.actor, HasPlan)).toEqual([plan]);
  expect([Plan.steps[plan], Plan.currentStep[plan], Plan.status[plan]]).toEqual(before);
  expect(Goal.status[f.motivation.goal]).toBe("active");
});

test("an already admitted finite standing-goal plan remains executable and finishes without extinguishing the drive", async () => {
  const f = fixture(), plan = createPlanEntity(f.world, f.actor, f.motivation.goal, draft);
  const before = [Plan.steps[plan], Plan.currentStep[plan], Plan.status[plan]], generate = jest.fn(async () => draft);
  await runPlanningSystem(f.world, { agentEids: [f.actor], background: true, planGenerator: generate });
  expect(generate).not.toHaveBeenCalled(); expect([Plan.steps[plan], Plan.currentStep[plan], Plan.status[plan]]).toEqual(before);
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ planEid: plan, actionType: "think" });
  executeActions(f.world, [{ eid: f.actor, action: { type: "think", content: draft.steps[0].content } }], createSystemRegistry());
  expect(Plan.status[plan]).toBe("completed"); expect(Goal.status[f.motivation.goal]).toBe("active");
  expect(drainPendingStimuli().filter(row => row.source === "planning")).toEqual([]);
});

test("a perceived notification changes salience, not execution, while a chosen finite phone purpose can plan", async () => {
  const f = fixture(), generate = jest.fn(async () => draft);
  f.motivation.noticeNotification();
  expect(Goal.priority[f.motivation.goal]).toBe(8);
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
  const goal = f.episodic("Read the notification I heard on my phone");
  await runPlanningSystem(f.world, { agentEids: [f.actor], focusActiveGoal: true, background: true, planGenerator: generate });
  expect(generate).toHaveBeenCalledTimes(1); expect(generate.mock.calls[0]).toEqual([f.world, f.actor, goal]);
  expect(Goal.status[goal]).toBe("active"); expect(Goal.progress[goal]).toBe(0);
});

test.each([false, true])("conversion to a standing drive invalidates an in-flight episodic plan (background=%s)", async background => {
  const f = fixture(), goal = f.episodic(); Goal.status[f.motivation.goal] = "retired";
  await runPlanningSystem(f.world, { agentEids: [f.actor], background, planGenerator: async () => {
    markStandingIntention(f.world, goal); return draft;
  } });
  expect(getRelationTargets(f.world, f.actor, HasPlan)).toEqual([]);
  expect(Goal.status[goal]).toBe("active"); expect(isStandingIntention(f.world, goal)).toBe(true);
});

test.each([false, true])("a new high-priority standing motivation does not invalidate pending finite planning (background=%s)", async background => {
  const f = fixture(), goal = f.episodic(); Goal.status[f.motivation.goal] = "retired";
  await runPlanningSystem(f.world, { agentEids: [f.actor], focusActiveGoal: true, background, planGenerator: async () => {
    createCommunicationMotivation(f.world, f.actor, { description: "Keep in touch with my family", memory: "My family matters to me.", priority: 10 });
    return draft;
  } });
  const plans = getRelationTargets(f.world, f.actor, HasPlan);
  expect(plans).toHaveLength(1); expect(Plan.goalEid[plans[0]]).toBe(goal); expect(Plan.status[plans[0]]).toBe("active");
});

test("manual native message read still requires custody and elapsed time and discloses only to its reader", async () => {
  // Integration contract, not an autonomous behavior claim: explicitly choose
  // a finite purpose and dispatch its actions through the real native host.
  bed = await ApartmentSitcom.create({ live: false, scenario: "duet", outsideTextAtMs: null, worldMaintenance: false });
  await bed.start(); const t = bed, world = t.sim.world, actor = t.ids.Elaine;
  t.dispatch("Elaine", { type: "move", target: "Kitchen" }); t.advance(3000);
  for (const goal of getRelationTargets(world, actor, HasGoal)) if (!isStandingIntention(world, goal)) Goal.status[goal] = "retired";
  const message = t.text("PRIVATE_STANDING_PLAN_READ"); t.advance(200);
  expect(t.context("Elaine")).not.toContain("PRIVATE_STANDING_PLAN_READ");
  const generate = jest.fn(async () => ({ ...draft, steps: [
    { actionType: "pickup" as const, target: "Elaine's phone", description: "Pick up my phone" },
    { actionType: "interact" as const, target: "Elaine's phone", content: "read_phone", description: "Read my notification" },
  ] }));
  await runPlanningSystem(world, { agentEids: [actor], background: true, planGenerator: generate });
  expect(generate).not.toHaveBeenCalled();
  const goal = createGeneratedIntention(world, actor, { description: "Read the new notification", kind: "custom", priority: 7 }, "personal")!;
  await runPlanningSystem(world, { agentEids: [actor], background: true, planGenerator: generate });
  expect(generate).toHaveBeenCalledTimes(1); expect(generate.mock.calls[0]).toEqual([world, actor, goal]);
  const plan = getRelationTargets(world, actor, HasPlan).find(id => Plan.goalEid[id] === goal)!;
  expect(Plan.status[plan]).toBe("active");
  integrateActorContinuation(world, actor, { purpose: "Read the notification", actionType: "pickup", target: "Elaine's phone",
    goalId: goal, goalKey: WorkingMemoryIdentity.id[goal], observedAtSimMs: world.time.elapsed });
  t.dispatch("Elaine", { type: "pickup", target: "Elaine's phone", goalId: goal }); t.advance(800);
  t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: "read_phone", goalId: goal }); t.advance(1199);
  expect(t.message.status[message]).toBe("delivered"); expect(t.context("Elaine")).not.toContain("PRIVATE_STANDING_PLAN_READ");
  t.advance(1); expect(t.message.status[message]).toBe("read"); expect(Plan.status[plan]).toBe("completed");
  expect(t.context("Elaine")).toContain("PRIVATE_STANDING_PLAN_READ"); expect(t.context("Jerry")).not.toContain("PRIVATE_STANDING_PLAN_READ");
  expect(t.snapshot().phone.filter(row => row.direction === "out")).toHaveLength(0);
});
