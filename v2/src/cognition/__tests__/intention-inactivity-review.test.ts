import { jest } from "@jest/globals";
import { addComponent, addEntity, getRelationTargets, entityExists, query, hasComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Agent, Goal, GoalLifecycle, Name, Plan, WorkingMemoryIdentity } from "../../ecs/components";
import { HasGoal, HasPlan } from "../../ecs/relations";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { createGeneratedIntention, prepareGeneratedIntention, requestIntentionReconsideration } from "../goal-lifecycle";
import { captureGoalReviewContext, prepareGoalReview, resumeDeferredGoals } from "../goal-pursuit";
import { expireStaleGoals } from "../autonomous-goals";
import { setGoalInactivityBudget } from "../goal-inactivity-budget";
import { workingMemoryEntityRef } from "../working-memory";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { initializeRegistry } from "../../ecs/component-registry";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { goalCleanupSystem } from "../../systems/deterministic-behavior-systems";
import { runPlanningSystem } from "../planning-system";

function fixture() {
  const world = createArgosWorld("Intention awaiting reconsideration"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Hall" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Act on experience", roomId: room });
  const bo = createAgentEntity(world, { name: "Bo", role: "resident", systemPrompt: "Act on experience", roomId: room });
  workingMemoryEntityRef(world, actor); workingMemoryEntityRef(world, bo);
  const make = (description: string) => createGeneratedIntention(world, actor, { description, priority: 6, kind: "social" }, "autonomous");
  const goal = make("Choose dinner and answer my friend")!;
  const plan = addEntity(world); addComponent(world, plan, Plan); addComponent(world, actor, HasPlan(plan));
  Plan.goalEid[plan] = goal; Plan.status[plan] = "awaiting_decision"; Plan.currentStep[plan] = 0; Plan.steps[plan] = "[]";
  const advance = (ms: number) => advanceSimulationTime(world, world.time.tick + 1, ms);
  const stale = () => { advance(120_001); expireStaleGoals(world, actor); };
  const review = (disposition: string, extra = {}) => prepareGoalReview(captureGoalReviewContext(world, actor),
    { goalId: goal, disposition, reason: "My own choice", ...extra });
  return { world, room, actor, bo, goal, plan, make, advance, stale, review };
}
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(100_000); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test("inactivity requests review without abandonment, success or an automatic return", () => {
  const f = fixture(); f.stale();
  expect(Goal.status[f.goal]).toBe("paused"); expect(Plan.status[f.plan]).toBe("retired");
  expect(captureGoalReviewContext(f.world, f.actor).goals.has(f.goal)).toBe(true);
  expect(Goal.progress[f.goal]).toBe(0); expect(Plan.currentStep[f.plan]).toBe(0);
  expect(resumeDeferredGoals(f.world, f.actor)).toBe(0);
  f.advance(600_000); expect(resumeDeferredGoals(f.world, f.actor)).toBe(0);
  expect(Goal.status[f.goal]).toBe("paused");
});
test("retain reopens the intention, never its old plan or recorded progress", () => {
  const f = fixture(); f.stale(); const draft = f.review("retain")!;
  expect(draft).toBeDefined(); expect(draft.commit()).toBe(true); expect(draft.commit()).toBe(false);
  expect(Goal.status[f.goal]).toBe("active"); expect(Plan.status[f.plan]).toBe("retired");
  expect(Goal.progress[f.goal]).toBe(0); expect(Plan.currentStep[f.plan]).toBe(0);
  expect(expireStaleGoals(f.world, f.actor)).toBe(0); expect(Goal.status[f.goal]).toBe("active");
  expect(f.review("retain")).toBeUndefined();
  f.advance(120_001); expireStaleGoals(f.world, f.actor); expect(Goal.status[f.goal]).toBe("paused");
});
test.each(["release", "defer"])("pending review supports explicit %s without progress", disposition => {
  const f = fixture(); f.stale();
  expect(f.review(disposition, disposition === "defer" ? { afterSeconds: 20, wake: { kind: "review" } } : {})?.commit()).toBe(true);
  expect(Goal.status[f.goal]).toBe(disposition === "release" ? "retired" : "paused");
  f.advance(20_000); expect(resumeDeferredGoals(f.world, f.actor)).toBe(disposition === "defer" ? 1 : 0);
  expect(Plan.status[f.plan]).toBe("retired"); expect(Goal.progress[f.goal]).toBe(0);
});
test("authored inactivity budgets remain expiry, not actor-review policy", () => {
  const f = fixture(); setGoalInactivityBudget(f.world, f.goal, 10_000); f.advance(10_001);
  expect(expireStaleGoals(f.world, f.actor)).toBe(1); expect(Goal.status[f.goal]).toBe("expired");
  expect(f.review("retain")).toBeUndefined();
});
test("a stalled invitation cannot replace another actor's choices or another goal episode", () => {
  const f = fixture(); f.stale();
  expect(prepareGoalReview(captureGoalReviewContext(f.world, f.bo), { goalId: f.goal, disposition: "retain", reason: "Not mine" })).toBeUndefined();
  const draft = f.review("retain")!; expect(draft).toBeDefined(); WorkingMemoryIdentity.id[f.goal] = "replacement";
  expect(draft.commit()).toBe(false); expect(f.review("retain")).toBeUndefined();
});
test.each(["source", "persona", "priority"])("pending review rejects a changed %s", change => {
  const f = fixture(); f.stale(); const draft = f.review("retain")!; expect(draft).toBeDefined();
  if (change === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (change === "persona") Agent.systemPrompt[f.actor] = "A different character";
  if (change === "priority") Goal.priority[f.goal] = 2;
  expect(draft.commit()).toBe(false); expect(Goal.status[f.goal]).toBe("paused");
});
test("new subjective intentions have no fabricated deadline; an explicit deadline is not erased", () => {
  const f = fixture(); expect(Goal.deadline[f.goal]).toBe(0);
  Goal.deadline[f.goal] = Date.now() + 240_000; f.stale(); expect(Goal.deadline[f.goal]).toBe(340_000);
  expect(f.review("retain")?.commit()).toBe(true); expect(Goal.deadline[f.goal]).toBe(340_000);
});
test("wall time alone cannot create pending review", () => {
  const f = fixture(); jest.advanceTimersByTime(600_000); expireStaleGoals(f.world, f.actor);
  expect(Goal.status[f.goal]).toBe("active"); f.stale(); expect(Goal.status[f.goal]).toBe("paused");
});
test("retained and deferred intentions consume bounded capacity rather than leaking new goals", () => {
  const f = fixture(); for (let i = 0; i < 4; i++) expect(f.make(`Intention ${i}`)).not.toBeNull();
  f.stale(); expect(f.make("Overflow")).toBeNull();
  expect(prepareGeneratedIntention(f.world, f.actor, { description: "Foreground overflow", priority: 5, kind: "social" }, "foreground")).toBeNull();
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toHaveLength(5);
  expect(f.review("release")?.commit()).toBe(true); expect(f.make("A newly chosen intention")).not.toBeNull();
});
test("save/reload preserves review but never an old draft or automatic action", () => {
  const f = fixture(); initializeRegistry(f.world); f.stale(); const draft = f.review("retain")!; expect(draft).toBeDefined();
  const saved = serializeWorld(f.world, createSystemRegistry()); stopCommittedEvents(f.world);
  const world = createArgosWorld("Restored"); initializePrefabs(world); initializeRegistry(world);
  const restored = deserializeWorld(world, createSystemRegistry(), saved); startCommittedEvents(world);
  const actor = restored.oldToNewId.get(f.actor)!, goal = restored.oldToNewId.get(f.goal)!;
  expect(draft.commit()).toBe(false); expect(resumeDeferredGoals(world, actor)).toBe(0);
  expect(prepareGoalReview(captureGoalReviewContext(world, actor), { goalId: goal, disposition: "retain", reason: "I still want this" })?.commit()).toBe(true);
  expect(Plan.status[restored.oldToNewId.get(f.plan)!]).toBe("retired"); expect(Goal.progress[goal]).toBe(0);
});
test.each([false, true])("cleanup retains review history but honors explicit deadline (deadline=%s)", deadline => {
  const f = fixture(); GoalLifecycle.mode[f.goal] = "exploratory";
  if (deadline) Goal.deadline[f.goal] = Date.now() + 180_000;
  f.stale(); f.advance(600_000);
  goalCleanupSystem(f.world, { query, hasComponent, getRelationTargets, removeEntity, components: { Goal, Name }, emit: () => {} } as any);
  expect(Goal.status[f.goal]).toBe(deadline ? "failed" : "paused");
  expect(entityExists(f.world, f.goal)).toBe(true); expect(Plan.status[f.plan]).toBe("retired");
});
test("a background plan from before review is stale even after retaining the same intention", async () => {
  const f = fixture(); Plan.status[f.plan] = "retired";
  const generator = jest.fn(async () => {
    expect(requestIntentionReconsideration(f.world, f.actor, f.goal, "Reconsider")).toBe(true);
    expect(f.review("retain")?.commit()).toBe(true);
    return { goalDescription: Goal.description[f.goal], estimatedCompletion: "short", potentialObstacles: [],
      steps: [{ actionType: "observe", target: "Hall", description: "Inspect the hall" }] };
  });
  await runPlanningSystem(f.world, { agentEids: [f.actor], planGenerator: generator as any });
  expect(generator).toHaveBeenCalledTimes(1);
  expect(getRelationTargets(f.world, f.actor, HasPlan)).toEqual([f.plan]); expect(Plan.status[f.plan]).toBe("retired");
});
test("a prior review marker cannot acknowledge a later inactivity episode", () => {
  const f = fixture(); f.stale(); const old = GoalLifecycle.reviewPendingJson[f.goal];
  expect(f.review("retain")?.commit()).toBe(true); f.stale();
  GoalLifecycle.reviewPendingJson[f.goal] = old;
  expect(f.review("retain")).toBeUndefined(); expect(Goal.status[f.goal]).toBe("paused");
});
test.each([NaN, Infinity, -1, 0, 1.5])("malformed/replaced review counter %s cannot grant retention", revision => {
  const f = fixture(); f.stale(); GoalLifecycle.reviewRevision[f.goal] = revision;
  expect(f.review("retain")).toBeUndefined(); expect(Goal.status[f.goal]).toBe("paused");
  expect(Plan.status[f.plan]).toBe("retired"); expect(Goal.progress[f.goal]).toBe(0);
});
