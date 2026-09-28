import { jest } from "@jest/globals";
import { addComponent, addEntity, getRelationTargets } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Agent, Goal, GoalLifecycle, Plan, WorkingMemoryIdentity } from "../../ecs/components";
import { HasGoal, HasPlan } from "../../ecs/relations";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { createGeneratedIntention, createPersonalIntention, maintainGoalLifecycles } from "../goal-lifecycle";
import { captureGoalReviewContext, formatGoalPursuitContext, pendingHandoffReview, prepareGoalReview, resumeDeferredGoals } from "../goal-pursuit";
import { bindSupportingGoal } from "../goal-dependents";
import { queueExperiencedEvent } from "../experience-appraisal";
import { recordCommittedSpeech } from "../social-memory";
import { workingMemoryEntityRef } from "../working-memory";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { initializeRegistry } from "../../ecs/component-registry";
import { createSystemRegistry } from "../../ecs/dynamic-systems";

function fixture() {
  const world = createArgosWorld("Deferred intention"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Hall" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Act on experience", roomId: room });
  const bo = createAgentEntity(world, { name: "Bo", role: "resident", systemPrompt: "Act on experience", roomId: room });
  workingMemoryEntityRef(world, actor); workingMemoryEntityRef(world, bo);
  const goal = createGeneratedIntention(world, actor, { description: "Arrange to recover my belongings", priority: 9, kind: "social" }, "foreground")!;
  const proposal = (extra = {}) => ({ goalId: goal, disposition: "defer", reason: "I have asked and need a response before arranging the next step", afterSeconds: 20, wake: { kind: "review" }, ...extra });
  const defer = (extra = {}) => prepareGoalReview(captureGoalReviewContext(world, actor), proposal(extra));
  const receipt = (id: string, channel = "message:friend") => queueExperiencedEvent(world, actor, { id, channel, source: "Friend", content: "An actual read message", atSimMs: 0 });
  return { world, actor, bo, goal, proposal, defer, receipt };
}
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(100_000); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
test.each(["schema", "reason", "goal", "operation", "deferral", "changed"])("goal review reports typed %s rejection without private input or writes", kind => {
  const f = fixture(), context = captureGoalReviewContext(f.world, f.actor);
  let input: unknown = f.proposal({ reason: "PRIVATE_REASON" });
  if (kind === "schema") input = { privateField: "PRIVATE_VALUE" };
  if (kind === "reason") input = { goalId:f.goal, disposition:"release" };
  if (kind === "goal") input = f.proposal({ goalId: 999999 });
  if (kind === "operation") input = { goalId: f.goal, disposition: "withdraw", reason: "PRIVATE_REASON" };
  if (kind === "deferral") input = f.proposal({ afterSeconds: 500 });
  if (kind === "changed") Goal.priority[f.goal] = 3;
  const observed: string[] = [];
  expect(prepareGoalReview(context, input, field => observed.push(field))).toBeUndefined();
  expect(observed).toEqual([`goalReview.${kind}`]);
  expect(Goal.status[f.goal]).toBe("active");
  expect(JSON.stringify(observed)).not.toContain("PRIVATE");
});
test("deferral frees attention, preserves priority/progress, and resumes on simulation time only", () => {
  const f = fixture(), draft = f.defer()!; expect(draft.commit()).toBe(true); expect(draft.commit()).toBe(false);
  expect(Goal.status[f.goal]).toBe("paused"); expect(Goal.priority[f.goal]).toBe(9); expect(Goal.progress[f.goal]).toBe(0);
  jest.advanceTimersByTime(100_000); expect(resumeDeferredGoals(f.world, f.actor)).toBe(0);
  advanceSimulationTime(f.world, 1, 20_000); expect(resumeDeferredGoals(f.world, f.actor)).toBe(1);
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  expect(resumeDeferredGoals(f.world, f.actor)).toBe(0);
});
test("only a new personally experienced receipt on the selected channel wakes a wait", () => {
  const f = fixture(); f.receipt("one");
  expect(f.defer({ wake: { channel: "message:friend", kind: "experience" } })!.commit()).toBe(true);
  f.receipt("one"); recordCommittedSpeech(f.world, f.bo, "Who ate the cookie?"); f.receipt("other", "message:work");
  expect(resumeDeferredGoals(f.world, f.actor)).toBe(0);
  f.receipt("two"); expect(resumeDeferredGoals(f.world, f.actor)).toBe(1);
});
test("new evidence during deliberation rejects deferral before it can swallow the reply", () => {
  const f = fixture(); f.receipt("one"); const context = captureGoalReviewContext(f.world, f.actor);
  f.receipt("two"); expect(prepareGoalReview(context, f.proposal({ wake: { kind: "experience", channel: "message:friend" } }))).toBeUndefined();
  expect(Goal.status[f.goal]).toBe("active");
});
test("heard words wake a speaker-specific wait but own words do not", () => {
  const f = fixture(); recordCommittedSpeech(f.world, f.bo, "I will check.");
  expect(f.defer({ wake: { kind: "speech", speaker: "Bo" } })!.commit()).toBe(true);
  recordCommittedSpeech(f.world, f.actor, "Thank you."); expect(resumeDeferredGoals(f.world, f.actor)).toBe(0);
  recordCommittedSpeech(f.world, f.bo, "The door is locked."); expect(resumeDeferredGoals(f.world, f.actor)).toBe(1);
});
test.each([
  { afterSeconds: 0 }, { afterSeconds: 61 }, { afterSeconds: NaN }, { wake: { kind: "experience", channel: "unread:secret" } },
  { wake: { kind: "speech", speaker: "Unknown" } }, { wake: { kind: "review", imaginaryProof: true } }, { reason: "" },
])("invalid/unobserved wait cannot pause a goal: %p", extra => {
  const f = fixture(); expect(f.defer(extra)).toBeUndefined(); expect(Goal.status[f.goal]).toBe("active");
});
test("release is withdrawal, never completion, and cannot rewrite a physical contract", () => {
  const f = fixture(); expect(f.defer({ disposition: "release", afterSeconds: undefined, wake: undefined })!.commit()).toBe(true);
  expect(Goal.status[f.goal]).toBe("retired"); expect(Goal.progress[f.goal]).toBe(0);
  Goal.status[f.goal] = "active"; Goal.successJson[f.goal] = JSON.stringify({ type: "in_room", roomName: "Hall" });
  expect(f.defer()).toBeUndefined();
});
test("authored goals and another actor's goals cannot be suspended here", () => {
  const f = fixture(); expect(prepareGoalReview(captureGoalReviewContext(f.world, f.bo), f.proposal())).toBeUndefined();
  GoalLifecycle.source[f.goal] = "authored"; expect(f.defer()).toBeUndefined();
});

test("an explicitly self-directed opening desire can be relinquished without awarding success", () => {
  const f = fixture();
  const desire = createPersonalIntention(f.world, f.actor, "Persuade my friends to try my idea", 7)!;
  const draft = prepareGoalReview(captureGoalReviewContext(f.world, f.actor), { goalId: desire, disposition: "release", reason: "They declined; I no longer want to keep pressing this" });
  expect(draft?.commit()).toBe(true); expect(Goal.status[desire]).toBe("retired"); expect(Goal.progress[desire]).toBe(0);
  expect(Goal.status[f.goal]).toBe("active");
});
test("a late draft cannot mutate a revised priority or replacement goal", () => {
  const f = fixture(), draft = f.defer()!; Goal.priority[f.goal] = 10;
  expect(draft.commit()).toBe(false); expect(Goal.status[f.goal]).toBe("active");
  const fresh = f.defer()!; WorkingMemoryIdentity.id[f.goal] = "replacement";
  expect(fresh.commit()).toBe(false);
});
test("source restart reconsiders a durable wait but never replays its plan", () => {
  const f = fixture(), p = addEntity(f.world); addComponent(f.world, p, Plan); addComponent(f.world, f.actor, HasPlan(p));
  Plan.goalEid[p] = f.goal; Plan.status[p] = "active";
  f.defer()!.commit(); expect(Plan.status[p]).toBe("retired");
  stopCommittedEvents(f.world); expect(resumeDeferredGoals(f.world, f.actor)).toBe(0);
  startCommittedEvents(f.world); expect(resumeDeferredGoals(f.world, f.actor)).toBe(1);
  expect(Plan.status[p]).toBe("retired"); expect(getRelationTargets(f.world, f.actor, HasGoal)).toContain(f.goal);
});
test("resumed exploration is not immediately paused again by its historical completed plan", () => {
  const f = fixture(); GoalLifecycle.mode[f.goal] = "exploratory";
  const p = addEntity(f.world); addComponent(f.world, p, Plan); addComponent(f.world, f.actor, HasPlan(p));
  Plan.goalEid[p] = f.goal; Plan.status[p] = "completed"; Plan.lastUpdated[p] = 99_000;
  f.defer()!.commit(); advanceSimulationTime(f.world, 1, 20_000); resumeDeferredGoals(f.world, f.actor); maintainGoalLifecycles(f.world, f.actor);
  expect(Goal.status[f.goal]).toBe("active");
});

test("save/restore retains the deferred goal and reconsiders it in the new source", () => {
  const f = fixture(); initializeRegistry(f.world); f.defer()!.commit();
  const saved = serializeWorld(f.world, createSystemRegistry()), restored = createArgosWorld("Restored"); initializePrefabs(restored); initializeRegistry(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved);
  const actor = oldToNewId.get(f.actor)!;
  startCommittedEvents(restored); expect(resumeDeferredGoals(restored, actor)).toBe(1);
  const goal = getRelationTargets(restored, actor, HasGoal)[0];
  expect(Goal.status[goal]).toBe("active"); expect(Goal.progress[goal]).toBe(0);
});

const release = (f: ReturnType<typeof fixture>) => prepareGoalReview(captureGoalReviewContext(f.world, f.actor),
  { goalId: f.goal, disposition: "release", reason: "PRIVATE_HANDOFF_REASON" })!;

test("a handoff draft queues review only, once; fresh explicit review consumes it without success", () => {
  const f = fixture(), draft = release(f);
  const plan = addEntity(f.world); addComponent(f.world, plan, Plan); addComponent(f.world, f.actor, HasPlan(plan));
  Plan.goalEid[plan] = f.goal; Plan.status[plan] = "active";
  expect(draft.queueForReconsideration()).toBe(true);
  expect(draft.queueForReconsideration()).toBe(false); expect(draft.commit()).toBe(false);
  expect(pendingHandoffReview(f.world, f.actor, f.goal)).toMatchObject({ disposition: "release", reason: "PRIVATE_HANDOFF_REASON", atSimMs: 0 });
  expect(Goal.status[f.goal]).toBe("active"); expect(Plan.status[plan]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  const fresh = release(f); expect(fresh.commit()).toBe(true);
  expect(Goal.status[f.goal]).toBe("retired"); expect(Plan.status[plan]).toBe("retired"); expect(Goal.progress[f.goal]).toBe(0);
  expect(GoalLifecycle.handoffReviewJson[f.goal]).toBe("");
});

test("handoff draft expiry uses lived time, never refreshes on projection, and never retires work", () => {
  const f = fixture(); release(f).queueForReconsideration(); const before = GoalLifecycle.handoffReviewJson[f.goal];
  jest.advanceTimersByTime(600_000);
  expect(pendingHandoffReview(f.world, f.actor, f.goal)).toBeDefined();
  advanceSimulationTime(f.world, 1, 59_999);
  expect(formatGoalPursuitContext(f.world, f.actor)).toContain("PENDING HANDOFF REVIEW");
  expect(GoalLifecycle.handoffReviewJson[f.goal]).toBe(before);
  advanceSimulationTime(f.world, 2, 1);
  expect(pendingHandoffReview(f.world, f.actor, f.goal)).toBeUndefined();
  expect(formatGoalPursuitContext(f.world, f.actor)).not.toContain("PRIVATE_HANDOFF_REASON");
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
});

test.each(["source", "actor", "persona", "goal", "priority", "paused", "descendant"])("a %s change invalidates a queued review and any prepared review", kind => {
  const f = fixture(); release(f).queueForReconsideration(); const prepared = release(f);
  if (kind === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (kind === "actor") WorkingMemoryIdentity.id[f.actor] = "replacement-actor";
  if (kind === "persona") Agent.systemPrompt[f.actor] = "A different character";
  if (kind === "goal") Goal.description[f.goal] = "A different intention";
  if (kind === "priority") Goal.priority[f.goal] = 2;
  if (kind === "paused") Goal.status[f.goal] = "paused";
  if (kind === "descendant") {
    const child = createPersonalIntention(f.world, f.actor, "Supporting new work", 4)!;
    bindSupportingGoal(f.world, f.actor, child, f.goal);
  }
  expect(pendingHandoffReview(f.world, f.actor, f.goal)).toBeUndefined();
  expect(prepared.commit()).toBe(false); expect(prepared.queueForReconsideration()).toBe(false);
  expect(Goal.progress[f.goal]).toBe(0);
});

test("drafts are owner-private and another world's goal cannot project them", () => {
  const f = fixture(); release(f).queueForReconsideration();
  expect(formatGoalPursuitContext(f.world, f.bo)).not.toContain("PRIVATE_HANDOFF_REASON");
  expect(pendingHandoffReview(f.world, f.bo, f.goal)).toBeUndefined();
  const other = fixture();
  GoalLifecycle.handoffReviewJson[other.goal] = GoalLifecycle.handoffReviewJson[f.goal];
  expect(pendingHandoffReview(other.world, other.actor, other.goal)).toBeUndefined();
  expect(formatGoalPursuitContext(other.world, other.actor)).not.toContain("PRIVATE_HANDOFF_REASON");
});

test("a restored draft remains historical data, not live review or execution authority", () => {
  const f = fixture(); initializeRegistry(f.world); release(f).queueForReconsideration();
  const saved = serializeWorld(f.world, createSystemRegistry()), restored = createArgosWorld("Restored handoff");
  initializePrefabs(restored); initializeRegistry(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved);
  startCommittedEvents(restored);
  const actor = oldToNewId.get(f.actor)!, goal = oldToNewId.get(f.goal)!;
  expect(GoalLifecycle.handoffReviewJson[goal]).toContain("PRIVATE_HANDOFF_REASON");
  expect(pendingHandoffReview(restored, actor, goal)).toBeUndefined();
  expect(formatGoalPursuitContext(restored, actor)).not.toContain("PRIVATE_HANDOFF_REASON");
  expect(Goal.status[goal]).toBe("active"); expect(Goal.progress[goal]).toBe(0);
});

test("deferral cannot be queued as if it authorized work, and a newer review draft fences an older one", () => {
  const f = fixture(); expect(f.defer()!.queueForReconsideration()).toBe(false);
  const old = release(f), next = release(f); expect(next.queueForReconsideration()).toBe(true);
  expect(old.commit()).toBe(false); expect(old.queueForReconsideration()).toBe(false);
  expect(Goal.status[f.goal]).toBe("active");
});
