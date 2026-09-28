/** Seed wiring regression, not evidence that a live resident chose a review. */
import { jest } from "@jest/globals";
import { getRelationTargets, hasComponent } from "bitecs";
import { SpatialDemo } from "../spatial-demo";
import { createTownScenario } from "../spatial-town-fixtures";
import { Goal, GoalLifecycle, WorkingMemoryIdentity } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { shouldGenerateGoal, resetAutonomousGoals } from "../../cognition/autonomous-goals";
import { maintainGoalLifecycles, pendingIntentionReview } from "../../cognition/goal-lifecycle";
import { captureGoalReviewContext, prepareGoalReview } from "../../cognition/goal-pursuit";

let demo: SpatialDemo | undefined;
beforeEach(() => {
  resetAutonomousGoals();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Seed intention checks must stay offline"));
});
afterEach(() => {
  demo?.stop(); demo = undefined;
  expect(globalThis.fetch).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});
async function create(options: Parameters<typeof SpatialDemo.create>[0] = {}) {
  demo = await SpatialDemo.create({ live: false, automaticClock: false, ...options });
  return demo;
}
function opening(name = "Mara") {
  const world = demo!.sim.world, actor = demo!.snapshot().actors.find(a => a.name === name)!;
  const goal = getRelationTargets(world, actor.id, HasGoal).find(g => GoalLifecycle.persistence[g] !== "standing")!;
  expect(goal).toBeDefined();
  return { world, actor, goal };
}

test.each([false, true])("authored town openings are actor-owned reviewable intentions (story=%s)", async story => {
  await create({ scenario: "town", ...(story ? { evolving: true, story: "community-drama" as const } : {}) });
  const goalKeys = new Set<string>();
  for (const actor of demo!.snapshot().actors) {
    const { world, goal } = opening(actor.name);
    expect(hasComponent(world, goal, GoalLifecycle)).toBe(true);
    expect(GoalLifecycle.source[goal]).toBe("personal");
    expect(GoalLifecycle.mode[goal]).toBe("exploratory");
    expect(GoalLifecycle.persistence[goal]).toBe("episodic");
    expect(Goal.deadline[goal]).toBe(0);
    expect(Goal.progress[goal]).toBe(0);
    expect(Goal.status[goal]).toBe("active");
    expect(captureGoalReviewContext(world, actor.id).goals.has(goal)).toBe(true);
    expect(WorkingMemoryIdentity.id[goal]).toBeTruthy();
    goalKeys.add(WorkingMemoryIdentity.id[goal]);
    // Bounded background review coexists with the opening intention, with or
    // without an authored standing contact. Readiness does not replace it.
    expect(shouldGenerateGoal(world, actor.id)).toBe(true);
    expect(Goal.status[goal]).toBe("active"); expect(Goal.progress[goal]).toBe(0);
  }
  expect(goalKeys.size).toBe(10);
});

test.each(["defer", "release"] as const)("an actor can %s an opening purpose without false accomplishment", async disposition => {
  await create({ scenario: "town" });
  const { world, actor, goal } = opening();
  const desire = getRelationTargets(world, actor.id, HasGoal).find(g => GoalLifecycle.persistence[g] === "standing")!;
  const review = prepareGoalReview(captureGoalReviewContext(world, actor.id), {
    goalId: goal, disposition, reason: "I want to choose another way to spend my afternoon.",
    ...(disposition === "defer" ? { afterSeconds: 30, wake: { kind: "review" } } : {}),
  });
  expect(review).toBeDefined();
  expect(review!.commit()).toBe(true);
  expect(Goal.status[goal]).toBe(disposition === "defer" ? "paused" : "retired");
  expect(Goal.progress[goal]).toBe(0);
  expect(Goal.deadline[goal]).toBe(0);
  expect(Goal.status[desire]).toBe("active");
  expect(shouldGenerateGoal(world, actor.id)).toBe(true);
});

test("an unresolved opening reaches reconsideration, not automatic success or abandonment", async () => {
  await create({ scenario: "town" });
  const { world, actor, goal } = opening();
  await demo!.start(); demo!.advance(60_000); demo!.advance(1000);
  maintainGoalLifecycles(world, actor.id);
  expect(Goal.status[goal]).toBe("paused");
  expect(pendingIntentionReview(world, actor.id, goal)).toBeDefined();
  expect(Goal.progress[goal]).toBe(0);
  expect(Goal.deadline[goal]).toBe(0);
  expect(captureGoalReviewContext(world, actor.id).goals.has(goal)).toBe(true);
});

test("another resident cannot review a private owned opening purpose", async () => {
  await create({ scenario: "town" });
  const mara = opening(), ivo = opening("Ivo");
  const context = captureGoalReviewContext(mara.world, ivo.actor.id);
  expect(context.goals.has(mara.goal)).toBe(false);
  expect(prepareGoalReview(context, { goalId: mara.goal, disposition: "release", reason: "Not my choice to make." })).toBeUndefined();
  expect(Goal.status[mara.goal]).toBe("active");
});

test("a prepared personal review does not survive actor identity replacement", async () => {
  await create({ scenario: "town" });
  const { world, actor, goal } = opening();
  const review = prepareGoalReview(captureGoalReviewContext(world, actor.id), {
    goalId: goal, disposition: "release", reason: "I choose something else.",
  });
  expect(review).toBeDefined();
  WorkingMemoryIdentity.id[actor.id] = "replacement-actor";
  expect(review!.current()).toBe(false);
  expect(review!.commit()).toBe(false);
  expect(Goal.status[goal]).toBe("active");
});

test("custom packages preserve an explicitly social opening kind", async () => {
  const world = createTownScenario();
  world.residents[0].initialGoal.kind = "social";
  await create({ world });
  const { goal } = opening();
  expect(Goal.kind[goal]).toBe("social");
  expect(GoalLifecycle.mode[goal]).toBe("social");
  expect(GoalLifecycle.source[goal]).toBe("personal");
  expect(Goal.deadline[goal]).toBe(0);
});

test("opening authoring cannot import completion authority or a parent goal through undeclared fields", async () => {
  const world = createTownScenario();
  const description = world.residents[0].initialGoal.description;
  Object.assign(world.residents[0].initialGoal, {
    description: `  ${description}  `, completionId: "not-issued", supportsGoalId: 0,
  });
  await create({ world });
  const { goal } = opening();
  expect(Goal.description[goal]).toBe(description);
  expect(JSON.parse(Goal.successJson[goal]).type).toBe("custom");
  expect(GoalLifecycle.mode[goal]).toBe("exploratory");
  expect(GoalLifecycle.parentGoalEid[goal]).toBe(-1);
});

test.each(["move_to_room", "survive", ""])("unsupported opening kind %p fails instead of becoming a different intention", async kind => {
  const world = createTownScenario();
  Object.assign(world.residents[0].initialGoal, { kind });
  await expect(create({ world })).rejects.toThrow(/opening intention|opening purpose/i);
});

test("invalid personal authoring is rejected instead of falling back to a legacy objective", async () => {
  const world = createTownScenario();
  world.residents[0].initialGoal.description = "A".repeat(301);
  await expect(create({ world })).rejects.toThrow(/opening intention|opening purpose/i);
});

test("existing intention admission rejection is not hidden by a legacy fallback", async () => {
  const world = createTownScenario();
  world.residents[0].initialGoal.description = world.residents[0].phoneContact!.description;
  await expect(create({ world })).rejects.toThrow(/Mara's opening intention was rejected/);
});

test("Blackout keeps its verified repair objective and cannot release it as a subjective intention", async () => {
  await create({ scenario: "blackout" });
  const { world, actor, goal } = opening();
  expect(Goal.description[goal]).toMatch(/^Restore the apartment lighting/);
  expect(JSON.parse(Goal.successJson[goal])).toEqual({ type: "entity_component_equals", entityName: "Lighting panel", component: "SpatialCircuit", field: "powered", equals: true });
  expect(hasComponent(world, goal, GoalLifecycle)).toBe(false);
  expect(captureGoalReviewContext(world, actor.id).goals.has(goal)).toBe(false);
  expect(Goal.deadline[goal]).toBeGreaterThan(0);
});

test("the fallback apartment retains its pre-existing objective semantics", async () => {
  await create();
  const { world, goal } = opening();
  expect(Goal.description[goal]).toMatch(/^Take a short walk outside/);
  expect(hasComponent(world, goal, GoalLifecycle)).toBe(false);
  expect(Goal.deadline[goal]).toBeGreaterThan(0);
});
