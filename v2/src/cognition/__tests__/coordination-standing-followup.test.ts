import { jest } from "@jest/globals";
import { getRelationTargets } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, WorkingMemoryIdentity } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { startCommittedEvents, getCommittedEvents } from "../../runtime/committed-events";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { createCommunicationMotivation } from "../communication-motivation";
import { recordPrivateCommunication } from "../communication-memory";
import { createGeneratedIntention } from "../goal-lifecycle";
import { applyCoordinationReviews, coordinationPlanningContext, getCoordinationMemory } from "../coordination-memory";
import { generateAutonomousGoal, hasPendingPersonalGoalReview, resetAutonomousGoals } from "../autonomous-goals";

const keys = ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"];
let saved: Array<string | undefined>;
beforeEach(() => {
  saved = keys.map(k => process.env[k]); keys.forEach(k => { delete process.env[k]; });
  process.env.GEMINI_API_KEY = "offline-only"; resetAutonomousGoals();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline undertaking tests"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
});

function fixture(standing = true) {
  const world = createArgosWorld("Supporting motivation is not follow-through"); initializePrefabs(world); world.meta.aiEnabled = true;
  const room = createRoomEntity(world, { name: "Home" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "I choose my own purposes.", roomId: room });
  const peer = createAgentEntity(world, { name: "Bo", role: "resident", systemPrompt: "I have my own life.", roomId: room });
  const sourceId = startCommittedEvents(world); advanceSimulationTime(world, 1, 150_000);
  const goal = standing
    ? createCommunicationMotivation(world, actor, { description: "Stay in touch with my sister", memory: "We check in by phone." }).goal
    : createGeneratedIntention(world, actor, { description: "Tell Bo what I observed", kind: "social", priority: 6 }, "personal")!;
  const sent = recordPrivateCommunication(world, actor, { sourceId, messageKey: "tell-bo", channel: "phone:ada", kind: "sent",
    other: "Sister", content: "Bo is away. I will make sure Bo knows what I observed.", sentAtSimMs: 138_500 })!;
  expect(applyCoordinationReviews(world, actor, [{ kind: "undertake", speechId: sent.id, task: "Tell Bo what I observed", goalId: goal }])).toBe(1);
  const context = () => coordinationPlanningContext(world, actor);
  return { world, actor, peer, goal, sent, context };
}

test.each(["active", "paused", "queued", "pending"])("a standing motive in %s status supports a promise but leaves concrete follow-up unrepresented", status => {
  const f = fixture(); Goal.status[f.goal] = status;
  const before = getCoordinationMemory(f.world, f.actor), publicBefore = structuredClone(getCommittedEvents(f.world).events);
  expect(f.context()).toMatchObject([{ id: f.sent.id, needsFollowUp: true,
    linkedIntention: { id: f.goal, description: "Stay in touch with my sister", status } }]);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(true);
  expect(getCoordinationMemory(f.world, f.actor)).toEqual(before);
  expect(getCoordinationMemory(f.world, f.peer).items).toEqual([]);
  expect(getCommittedEvents(f.world).events).toEqual(publicBefore);
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toEqual([f.goal]);
});

test.each(["active", "paused", "queued", "pending"])("a bound %s episodic intention still represents the work without creating duplicates", status => {
  const f = fixture(false); Goal.status[f.goal] = status;
  expect(f.context()).toMatchObject([{ needsFollowUp: false, linkedIntention: { id: f.goal, status } }]);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
});

test.each(["completed", "retired", "expired", "failed"])("an ended %s supporting intention does not settle the promise", status => {
  const f = fixture(false); Goal.status[f.goal] = status;
  expect(f.context()).toMatchObject([{ needsFollowUp: true, localStatus: "not_started" }]);
});

test("a stale goal identity cannot represent a current undertaking", () => {
  const f = fixture(false); WorkingMemoryIdentity.id[f.goal] = "replacement-goal";
  expect(f.context()).toMatchObject([{ needsFollowUp: true, linkedIntention: null }]);
});

test("explicitly releasing a standing-supported promise stops its follow-up opportunity", () => {
  const f = fixture();
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "release", id: f.sent.id, reason: "I changed my mind and will report that." }])).toBe(1);
  expect(f.context()).toEqual([]);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
  expect(Goal.status[f.goal]).toBe("active");
});

test("the newly available review may decline once without forcing a goal or repeated reviews", async () => {
  const f = fixture(); Goal.status[f.goal] = "paused";
  const infer = jest.fn(async () => ({ text: JSON.stringify({ goal: null }) }));
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(true);
  expect(await generateAutonomousGoal(f.world, f.actor, { generateText: infer as any })).toBeNull();
  expect(infer).toHaveBeenCalledTimes(1);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
  expect(f.context()[0].needsFollowUp).toBe(true);
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toEqual([f.goal]);
  expect(getCoordinationMemory(f.world, f.peer).items).toEqual([]);
});

test("a chosen finite follow-up can replace the standing association without executing or fulfilling work", async () => {
  const f = fixture(); Goal.status[f.goal] = "paused";
  const infer = jest.fn(async () => ({ text: JSON.stringify({ goal: "Find Bo and tell them what I observed", motivation: "I promised to let Bo know.",
    priority: 6, kind: "social", followUp: { undertakingId: f.sent.id } }) }));
  expect(await generateAutonomousGoal(f.world, f.actor, { generateText: infer as any })).not.toBeNull();
  expect(infer).toHaveBeenCalledTimes(1);
  const context = f.context()[0];
  expect(context).toMatchObject({ needsFollowUp: false, localStatus: "not_started",
    linkedIntention: { description: "Find Bo and tell them what I observed", status: "active" } });
  expect(context.linkedIntention!.id).not.toBe(f.goal);
  expect(Goal.status[f.goal]).toBe("paused");
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
  expect(getCoordinationMemory(f.world, f.peer).items).toEqual([]);
});
