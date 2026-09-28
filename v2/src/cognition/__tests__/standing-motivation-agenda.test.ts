import { jest } from "@jest/globals";
import { addComponent, removeComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, Plan, PendingToolJob } from "../../ecs/components";
import { HasPlan } from "../../ecs/relations";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { createGeneratedIntention, markStandingIntention } from "../goal-lifecycle";
import { generateAutonomousGoal, resetAutonomousGoals, shouldGenerateGoal } from "../autonomous-goals";
import { setAspirations } from "../goal-learning";
import { createPlanEntity, hasActionablePlannedStep } from "../planning-system";
import { recordOngoingActivityChoice } from "../ongoing-activity";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { recordPersonalConcern } from "../personal-concerns";
import { startCommittedEvents } from "../../runtime/committed-events";

let oldKey: string | undefined;
beforeEach(() => {
  resetAutonomousGoals(); oldKey = process.env.GEMINI_API_KEY; process.env.GEMINI_API_KEY = "offline-only";
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline agenda tests"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
});
function fixture() {
  const world = createArgosWorld("Life beyond the repair"); initializePrefabs(world); world.meta.aiEnabled = true;
  const room = createRoomEntity(world, { name: "Apartment" });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", roomId: room, systemPrompt: "Choose your own afternoon." });
  const desire = createGeneratedIntention(world, actor, { description: "Stay in touch with my friends", kind: "social", priority: 5 }, "personal")!;
  markStandingIntention(world, desire);
  const next = () => createGeneratedIntention(world, actor, { description: "Explore a new corner of my home", kind: "custom", priority: 4 }, "autonomous")!;
  return { world, actor, desire, next, eligible: () => shouldGenerateGoal(world, actor) };
}

test("a standing desire no longer suppresses the opportunity to choose a finite next purpose", async () => {
  const f = fixture(); expect(f.eligible()).toBe(true);
  const infer = jest.fn(async (_request: any) => ({ text: JSON.stringify({ goal: "Explore a new corner of my home", motivation: "I want to understand where I live", priority: 4, kind: "custom" }) }));
  expect(await generateAutonomousGoal(f.world, f.actor, { generateText: infer as any })).not.toBeNull();
  expect(infer.mock.calls[0][0].messages[1].content).toContain("standing motivation");
  expect(Goal.status[f.desire]).toBe("active"); expect(Goal.progress[f.desire]).toBe(0);
  advanceSimulationTime(f.world, 1, 6000);
  expect(f.eligible()).toBe(false); // One finite purpose is enough; do not fill the goal list every tick.
});

test.each(["completed", "retired", "paused"])("%s finite work permits another choice without terminating the standing motivation", status => {
  const f = fixture(), purpose = f.next(); expect(f.eligible()).toBe(true);
  Goal.status[purpose] = status;
  expect(f.eligible()).toBe(true); expect(Goal.status[f.desire]).toBe("active");
});

test("the change does not automatically shelve an unresolved active intention", () => {
  const f = fixture(); const purpose = f.next(); advanceSimulationTime(f.world, 1, 120000);
  expect(f.eligible()).toBe(true); expect(Goal.status[purpose]).toBe("active");
});

test("choosing nothing new retains the existing quiet review interval", async () => {
  const f = fixture(), infer = jest.fn(async () => ({ text: '{"goal":null}' }));
  await generateAutonomousGoal(f.world, f.actor, { generateText: infer as any });
  advanceSimulationTime(f.world, 1, 5000); expect(f.eligible()).toBe(false);
  advanceSimulationTime(f.world, 2, 24999); expect(f.eligible()).toBe(false);
  advanceSimulationTime(f.world, 3, 1); expect(f.eligible()).toBe(true);
  expect(infer).toHaveBeenCalledTimes(1); expect(Goal.status[f.desire]).toBe("active");
});

test("standing motivations still count toward the existing bounded goal capacity", () => {
  const f = fixture();
  for (let n = 0; n < 2; n++) {
    const desire = createGeneratedIntention(f.world, f.actor, { description: `Care about long-term relationship ${n}`, kind: "social", priority: 4 }, "personal")!;
    markStandingIntention(f.world, desire);
  }
  expect(f.eligible()).toBe(false);
});

test("a changed authored drive invalidates a proposal generated from the previous agenda", async () => {
  const f = fixture();
  const infer = jest.fn(async () => {
    setAspirations(f.world, f.actor, ["Make something useful for a friend"]);
    return { text: JSON.stringify({ goal: "Explore a new corner of my home", motivation: "An old interest", priority: 4, kind: "custom" }) };
  });
  expect(await generateAutonomousGoal(f.world, f.actor, { generateText: infer as any })).toBeNull();
  expect(Goal.status[f.desire]).toBe("active");
});

test("a changed authored drive can reopen quiet review after the ordinary cooldown", async () => {
  const f = fixture(); await generateAutonomousGoal(f.world, f.actor, { generateText: (async () => ({ text: '{"goal":null}' })) as any });
  advanceSimulationTime(f.world, 1, 5000); expect(f.eligible()).toBe(false);
  setAspirations(f.world, f.actor, ["Make something useful for a friend"]);
  expect(f.eligible()).toBe(true);
});

function finiteStandingPlan(f: ReturnType<typeof fixture>) {
  const destination = createRoomEntity(f.world, { name: "Quiet study" });
  const plan = createPlanEntity(f.world, f.actor, f.desire, { goalDescription: Goal.description[f.desire],
    estimatedCompletion: "A short walk", potentialObstacles: [],
    steps: [{ actionType: "move", target: "Quiet study", description: "Go somewhere quiet to call my friend" }] });
  expect(hasActionablePlannedStep(f.world, f.actor)).toBe(true);
  return { plan, destination };
}

test("background readiness neither executes nor displaces a standing motivation's finite plan", () => {
  const f = fixture(), { plan } = finiteStandingPlan(f);
  const before = [Plan.status[plan], Plan.currentStep[plan], Plan.steps[plan], Goal.status[f.desire]];
  expect(f.eligible()).toBe(true); expect(f.eligible()).toBe(true);
  expect([Plan.status[plan], Plan.currentStep[plan], Plan.steps[plan], Goal.status[f.desire]]).toEqual(before);
});

test.each(["completed", "failed", "paused", "awaiting_evidence", "awaiting_decision"])("a %s standing-motivation plan does not block a fresh agenda", status => {
  const f = fixture(), { plan } = finiteStandingPlan(f); Plan.status[plan] = status;
  expect(f.eligible()).toBe(true);
});

test.each(["blocked", "detached", "malformed", "wait"])("a %s stored plan cannot turn a standing motivation into permanent work", mode => {
  const f = fixture(), { plan } = finiteStandingPlan(f);
  if (mode === "blocked") Plan.steps[plan] = JSON.stringify([{ actionType: "interact", target: "Missing phone", content: "read", description: "Read a phone that is unavailable" }]);
  if (mode === "detached") removeComponent(f.world, f.actor, HasPlan(plan));
  if (mode === "malformed") Plan.steps[plan] = "invalid JSON";
  if (mode === "wait") Plan.steps[plan] = JSON.stringify([{ actionType: "wait", description: "Wait for my friend" }]);
  expect(f.eligible()).toBe(true);
});

test("organizing activity alone is not an unfinished finite plan", () => {
  const f = fixture(); recordOngoingActivityChoice(f.world, f.actor, { purpose: "Keep in touch", actionType: "think", goalId: f.desire });
  expect(f.eligible()).toBe(true);
});

test.each(["native body", "native tool"])("background agenda review can coexist with in-flight %s work", mode => {
  const f = fixture(); let busy = mode === "native body";
  registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => busy, execute: () => false });
  if (mode === "native tool") addComponent(f.world, f.actor, PendingToolJob);
  expect(f.eligible()).toBe(true);
  busy = false; removeComponent(f.world, f.actor, PendingToolJob);
  expect(f.eligible()).toBe(true);
});

test("new appraised experience retains its existing personal-review bypass during standing-motivation work", () => {
  const f = fixture(); finiteStandingPlan(f);
  registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => true, execute: () => false });
  expect(f.eligible()).toBe(true); startCommittedEvents(f.world);
  expect(recordPersonalConcern(f.world, f.actor, { channel: "phone", evidenceIds: ["read:new"],
    appraisal: "My friend's plans changed", significance: "I may choose another way to spend the afternoon", importance: .6,
    appraisedAtSimMs: 0 })).toBe(true);
  expect(f.eligible()).toBe(true);
});
