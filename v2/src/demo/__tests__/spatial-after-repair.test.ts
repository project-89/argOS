/** Integration proof of existing handoffs, not an assertion about live model judgment. */
import { jest } from "@jest/globals";
import type { SpatialDemo as SpatialDemoInstance } from "../spatial-demo";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { getRelationTargets } = await import("bitecs");
const { SpatialDemo } = await import("../spatial-demo");
const { Goal, GoalLifecycle, Needs, WorkingMemoryIdentity } = await import("../../ecs/components");
const { HasGoal } = await import("../../ecs/relations");
const { getDirectContainer } = await import("../../ecs/location");
const { createGeneratedIntention, maintainGoalLifecycles, pendingIntentionReview } = await import("../../cognition/goal-lifecycle");
const { captureGoalReviewContext, prepareGoalReview, resumeDeferredGoals } = await import("../../cognition/goal-pursuit");
const { shouldGenerateGoal, resetAutonomousGoals } = await import("../../cognition/autonomous-goals");
const { agentThink } = await import("../../cognition/agent-mind");
const { executeActions } = await import("../../cognition/cognition-system");
const { isDiscardedForegroundDecision } = await import("../../cognition/foreground-action-admission");
const { snapshotActorContinuation } = await import("../../cognition/actor-continuation");
const { snapshotWaitExperience } = await import("../../cognition/wait-experience");
const { getCommittedEvents } = await import("../../runtime/committed-events");
const { chronicle } = await import("../../cognition/simulation-chronicle");

let demo: SpatialDemoInstance, previousKey: string | undefined;
beforeEach(async () => {
  previousKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-offline-only";
  generate.mockReset(); resetAutonomousGoals();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("After-repair regression must stay offline"));
  demo = await SpatialDemo.create({ live: false, automaticClock: false, scenario: "blackout" });
  await demo.start();
});
afterEach(() => {
  demo?.stop(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  if (previousKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  else process.env.GOOGLE_GENERATIVE_AI_API_KEY = previousKey;
});
const actor = () => demo.snapshot().actors.find(a => a.name === "Mara")!;
const id = (name: string) => demo.byId.get(name)!;
function act(type: string, target?: string, content?: string, ms = 12000) {
  demo.dispatch(actor().key, type, target && WorkingMemoryIdentity.id[id(target)], content);
  demo.advance(ms);
}
function repaired() {
  const world = demo.sim.world, mara = actor().id;
  const repair = getRelationTargets(world, mara, HasGoal).find(g => Goal.description[g].startsWith("Restore the apartment"))!;
  const communication = getRelationTargets(world, mara, HasGoal).find(g => GoalLifecycle.persistence[g] === "standing")!;
  act("interact", "lighting-panel", "inspect");
  act("interact", "lighting-panel", "isolate");
  act("interact", "supply-box", "open");
  act("pickup", "amber-cartridge");
  act("interact", "lighting-panel", "install Amber cartridge");
  act("interact", "lighting-panel", "power_on");
  expect(demo.snapshot().scenario).toMatchObject({ power: "on", complete: true });
  expect(Goal.status[repair]).toBe("completed");
  expect(getDirectContainer(world, id("amber-cartridge"))).toBe(id("lighting-panel"));
  expect(Goal.status[communication]).toBe("active");
  return { world, mara, repair, communication };
}
function investigation() {
  const f = repaired();
  const concern = createGeneratedIntention(f.world, f.mara, {
    description: "Find out why the lighting circuit failed, if further evidence becomes available", priority: 7, kind: "custom",
  }, "personal")!;
  expect(concern).not.toBeNull();
  expect(GoalLifecycle.mode[concern]).toBe("exploratory");
  return { ...f, concern };
}
async function think(response: unknown) {
  generate.mockResolvedValueOnce({ text: JSON.stringify(response) });
  demo.sim.world.meta.aiEnabled = true; // Only this explicit mocked foreground transaction.
  const records = jest.spyOn(chronicle, "record");
  try {
    const action = await agentThink(demo.sim.world, actor().id);
    expect(records.mock.calls.filter(([kind]) => kind === "decision_rejected" || kind === "decision_superseded")).toEqual([]);
    return action;
  }
  finally { demo.sim.world.meta.aiEnabled = false; }
}

test("a completed physical repair leaves a standing communication desire without blocking another finite project", () => {
  const f = repaired();
  expect(shouldGenerateGoal(f.world, f.mara)).toBe(true);
  expect(Goal.status[f.communication]).toBe("active");
  expect(Goal.progress[f.communication]).toBe(0);
  const finite = createGeneratedIntention(f.world, f.mara, { description: "Decide what I want to do with the quiet afternoon", priority: 5, kind: "custom" }, "autonomous")!;
  expect(finite).not.toBeNull();
  // Background agenda review can coexist with an unfinished purpose; mere
  // readiness neither replaces that purpose nor claims its completion.
  expect(shouldGenerateGoal(f.world, f.mara)).toBe(true);
  expect(Goal.status[finite]).toBe("active"); expect(Goal.progress[finite]).toBe(0);
  expect(Goal.status[f.repair]).toBe("completed");
});

test.each(["defer", "release"] as const)("an unresolved exploration reaches reconsideration, then the actor can %s it without claiming a solution", async disposition => {
  const f = investigation();
  expect(shouldGenerateGoal(f.world, f.mara)).toBe(true);
  expect(Goal.status[f.concern]).toBe("active"); expect(Goal.progress[f.concern]).toBe(0);
  demo.advance(60000); demo.advance(1000);
  maintainGoalLifecycles(f.world, f.mara);
  expect(pendingIntentionReview(f.world, f.mara, f.concern)).toBeDefined();
  expect(Goal.status[f.concern]).toBe("paused"); // Execution pauses for review, not withdrawal or proof.
  expect(Goal.progress[f.concern]).toBe(0);
  const action = await think({
    control: { version: 2, purpose: "Set the unexplained cause aside while the light works", goalId: null, localDependencies: [] },
    innerThought: "The repair worked. I still do not know why it failed, and I have no new evidence to inspect.",
    action: { type: "wait" },
    goalReview: { goalId: f.concern, disposition, reason: "There is no actionable new evidence; I can choose something else now.",
      ...(disposition === "defer" ? { afterSeconds: 30, wake: { kind: "review" } } : {}) },
  });
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  executeActions(f.world, [{ eid: f.mara, action }], demo.sim.god.systemRegistry);
  expect(Goal.status[f.concern]).toBe(disposition === "defer" ? "paused" : "retired");
  expect(Goal.progress[f.concern]).toBe(0);
  expect(Goal.status[f.communication]).toBe("active");
  expect(snapshotActorContinuation(f.world, f.mara)?.goalId).toBeUndefined();
  expect(shouldGenerateGoal(f.world, f.mara)).toBe(true);
  expect(demo.snapshot().scenario!.power).toBe("on");
  expect(Goal.status[f.repair]).toBe("completed");
});

test("after review a separate selected purpose can execute a real alternate action; the old investigation is not completed", async () => {
  const f = investigation();
  const review = prepareGoalReview(captureGoalReviewContext(f.world, f.mara), {
    goalId: f.concern, disposition: "defer", afterSeconds: 60, wake: { kind: "review" },
    reason: "The lamp works and further investigation has no new evidence yet.",
  });
  expect(review?.commit()).toBe(true);
  const alternative = createGeneratedIntention(f.world, f.mara, {
    description: "Have the apple pastry while taking a break", priority: 5, kind: "custom",
  }, "foreground")!;
  expect(alternative).not.toBeNull();
  const action = await think({
    control: { version: 2, purpose: "Eat the pastry while the investigation is set aside", goalId: alternative,
      switchReason: "The lighting works and I want a snack", localDependencies: [] },
    innerThought: "I can leave the unanswered electrical question alone and enjoy the pastry.",
    action: { type: "interact", target: "Apple pastry", content: "eat" },
  });
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  const hunger = Needs.hunger[f.mara], eventCount = getCommittedEvents(f.world).events.length;
  executeActions(f.world, [{ eid: f.mara, action }], demo.sim.god.systemRegistry);
  expect(demo.snapshot().entities.some(e => e.id === id("apartment-snack"))).toBe(true); // Admission is not consumption.
  demo.advance(12000);
  expect(Needs.hunger[f.mara]).toBeLessThan(hunger);
  expect(demo.snapshot().entities.some(e => e.id === id("apartment-snack"))).toBe(false);
  expect(getCommittedEvents(f.world).events.slice(eventCount).some(e => e.actorId === f.mara && e.status === "succeeded")).toBe(true);
  expect(Goal.status[f.concern]).toBe("paused"); expect(Goal.progress[f.concern]).toBe(0);
  expect(Goal.status[f.communication]).toBe("active");
  expect(snapshotActorContinuation(f.world, f.mara)?.goalId).toBe(alternative);
});

test("a legitimate observation wait remains allowed and elapsed waiting does not establish investigative success", async () => {
  const f = investigation();
  const action = await think({
    control: { version: 2, purpose: "Watch the repaired lamp for a little while", goalId: f.concern, localDependencies: [] },
    innerThought: "It is reasonable to watch briefly before deciding what to do next.", action: { type: "wait" },
  });
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  executeActions(f.world, [{ eid: f.mara, action }], demo.sim.god.systemRegistry);
  demo.advance(10000);
  expect(snapshotWaitExperience(f.world, f.mara)).toMatchObject({ elapsedSimMs: 10000, waitChoices: 1 });
  expect(Goal.status[f.concern]).toBe("active"); expect(Goal.progress[f.concern]).toBe(0);
  expect(resumeDeferredGoals(f.world, f.mara)).toBe(0);
  expect(Goal.status[f.repair]).toBe("completed");
});
