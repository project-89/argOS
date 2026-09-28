import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, OngoingActivity, Plan, WorkingMemoryIdentity } from "../../ecs/components";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { deserializeWorld, serializeWorld } from "../../persistence/world-persistence";
import { createIntentGoal } from "../cognition-system";
import { createPlanEntity } from "../planning-system";
import { integrateActorContinuation, snapshotActorContinuation } from "../actor-continuation";
import { formatOngoingActivity, snapshotOngoingActivity, observeOngoingActivity } from "../ongoing-activity";
import { workingMemoryEntityRef } from "../working-memory";
import { activityResumptionGoal, situatedPlanGoal } from "../decision-policy";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { stopCommittedEvents, startCommittedEvents } from "../../runtime/committed-events";

function fixture() {
  const world = createArgosWorld("Organizing activity"); initializePrefabs(world); world.meta.aiEnabled = false;
  const room = createRoomEntity(world, { name: "Kitchen" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Choose your activity", roomId: room });
  const goal = createIntentGoal(world, actor, "Prepare to leave", 7);
  workingMemoryEntityRef(world, actor);
  const plan = createPlanEntity(world, actor, goal, { goalDescription: "Prepare to leave", steps: [
    { description: "Inspect surroundings", actionType: "observe", target: "Kitchen" },
    { description: "Consider readiness", actionType: "think", content: "What remains?" },
  ] });
  integrateActorContinuation(world, actor, { purpose: "Prepare to leave", actionType: "observe", target: "Kitchen", goalId: goal, observedAtSimMs: 0 });
  return { world, actor, goal, plan };
}
test.each(["completed", "abandoned", "revised"])("an activity bound to a %s goal is visibly historical without changing native state", status => {
  const f = fixture(); expect(observeOngoingActivity(f.world, f.actor)).toMatchObject({ currentGoal: true, goalStatus: "active" });
  if (status === "revised") Goal.description[f.goal] = "A different purpose";
  else Goal.status[f.goal] = status;
  const before = OngoingActivity.stateJson[f.actor];
  expect(observeOngoingActivity(f.world, f.actor)).toMatchObject({ currentGoal: false,
    goalStatus: status === "revised" ? "unavailable_or_revised" : status, entryChoicePurpose: "Prepare to leave" });
  expect(formatOngoingActivity(f.world, f.actor)).toContain('"currentGoal":false');
  expect(OngoingActivity.stateJson[f.actor]).toBe(before); expect(Plan.currentStep[f.plan]).toBe(0);
});
test("context distinguishes the historical entry choice from the organizing goal and later action", () => {
  const f = fixture();
  integrateActorContinuation(f.world, f.actor, { purpose: "Collect my coat", actionType: "observe",
    goalId: f.goal, activityDisposition: "replace", observedAtSimMs: 0 });
  integrateActorContinuation(f.world, f.actor, { purpose: "Check my keys", actionType: "observe",
    goalId: f.goal, observedAtSimMs: 0 });
  const before = OngoingActivity.stateJson[f.actor];
  const text = formatOngoingActivity(f.world, f.actor);
  expect(text).toContain('"entryChoicePurpose":"Collect my coat"');
  expect(text).toContain('"organizingGoal":"Prepare to leave"');
  expect(text).not.toContain('"purpose":"Collect my coat"');
  expect(text).toContain("historical entry choice");
  expect(snapshotActorContinuation(f.world, f.actor)?.purpose).toBe("Check my keys");
  expect(OngoingActivity.stateJson[f.actor]).toBe(before);
  expect(Plan.currentStep[f.plan]).toBe(0);
  expect(Goal.progress[f.goal]).toBe(0);
});
test("a spoken side action retains the organizing activity and does not advance the physical plan", () => {
  const f = fixture(), before = snapshotOngoingActivity(f.world, f.actor)!;
  expect(before).toBeDefined();
  integrateActorContinuation(f.world, f.actor, { purpose: "Answer a joke", actionType: "speak", target: "Bea", observedAtSimMs: 0 });
  expect(snapshotActorContinuation(f.world, f.actor)?.purpose).toBe("Answer a joke");
  expect(snapshotOngoingActivity(f.world, f.actor)).toEqual(before);
  expect(Plan.currentStep[f.plan]).toBe(0); expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
});
test("listening retains the organizing activity without authorizing a return step during the wait", () => {
  const f = fixture(), before = snapshotOngoingActivity(f.world, f.actor)!;
  integrateActorContinuation(f.world, f.actor, { purpose: "Hear the rest of Bea's reply", actionType: "wait", observedAtSimMs: 0 });
  expect(snapshotOngoingActivity(f.world, f.actor)).toEqual(before);
  expect(snapshotActorContinuation(f.world, f.actor)?.actionType).toBe("wait");
  expect(situatedPlanGoal(f.world, f.actor)).toBeUndefined();
  expect(activityResumptionGoal(f.world, f.actor)).toBeUndefined();
  expect(Plan.currentStep[f.plan]).toBe(0);
  expect(Goal.progress[f.goal]).toBe(0);
});
test("waiting does not revive an explicitly paused activity", () => {
  const f = fixture();
  integrateActorContinuation(f.world, f.actor, { purpose: "Put preparations aside", actionType: "wait",
    activityDisposition: "pause", observedAtSimMs: 0 });
  const before = snapshotOngoingActivity(f.world, f.actor)!;
  expect(before.status).toBe("paused");
  integrateActorContinuation(f.world, f.actor, { purpose: "Keep listening", actionType: "wait", observedAtSimMs: 0 });
  expect(snapshotOngoingActivity(f.world, f.actor)).toEqual(before);
  expect(activityResumptionGoal(f.world, f.actor)).toBeUndefined();
});
test("physical interruption retains a paused return point and explicit reselection resumes its identity", () => {
  const f = fixture(), before = snapshotOngoingActivity(f.world, f.actor)!;
  integrateActorContinuation(f.world, f.actor, { purpose: "Check a parcel", actionType: "observe", target: "Parcel", observedAtSimMs: 0 });
  expect(snapshotOngoingActivity(f.world, f.actor)).toMatchObject({ id: before.id, status: "paused" });
  integrateActorContinuation(f.world, f.actor, { purpose: "Continue getting ready", actionType: "observe", target: "Kitchen", goalId: f.goal, observedAtSimMs: 0 });
  expect(snapshotOngoingActivity(f.world, f.actor)).toMatchObject({ id: before.id, status: "active", needsRevalidation: false });
});
test("explicit ending does not claim goal completion or allow a side remark to revive the activity", () => {
  const f = fixture();
  integrateActorContinuation(f.world, f.actor, { purpose: "I changed my mind", actionType: "speak", activityDisposition: "end", observedAtSimMs: 0 });
  integrateActorContinuation(f.world, f.actor, { purpose: "Answer Bea", actionType: "speak", observedAtSimMs: 0 });
  integrateActorContinuation(f.world, f.actor, { purpose: "Look around", actionType: "observe", target: "Kitchen", observedAtSimMs: 0 });
  expect(snapshotOngoingActivity(f.world, f.actor)?.status).toBe("ended");
  expect(Goal.status[f.goal]).toBe("active"); expect(Plan.currentStep[f.plan]).toBe(0);
});
test("an interruption retains its reason and onset across side conversation and repeated detour steps", () => {
  const f = fixture(), other = createIntentGoal(f.world, f.actor, "Check the parcel", 7);
  f.world.time.elapsed = 5000;
  integrateActorContinuation(f.world, f.actor, { purpose: "Inspect the delivery", actionType: "observe", goalId: other,
    switchReason: "The delivery may contain the keys I need before leaving.", observedAtSimMs: 5000 });
  const interrupted = snapshotOngoingActivity(f.world, f.actor)!;
  expect(interrupted.interruption).toMatchObject({ purpose: "Inspect the delivery", startedAtSimMs: 5000,
    reason: "The delivery may contain the keys I need before leaving.", goalKey: WorkingMemoryIdentity.id[other] });
  f.world.time.elapsed = 15000;
  integrateActorContinuation(f.world, f.actor, { purpose: "Answer a joke", actionType: "speak", observedAtSimMs: 15000 });
  integrateActorContinuation(f.world, f.actor, { purpose: "Read the delivery label", actionType: "observe", goalId: other, observedAtSimMs: 15000 });
  expect(snapshotOngoingActivity(f.world, f.actor)?.interruption).toEqual(interrupted.interruption);
  expect(formatOngoingActivity(f.world, f.actor)).toContain('"interruptionElapsedSimMs":10000');
  integrateActorContinuation(f.world, f.actor, { purpose: "Resume leaving", actionType: "observe", goalId: f.goal, observedAtSimMs: 15000 });
  expect(snapshotOngoingActivity(f.world, f.actor)?.interruption).toBeUndefined();
  expect(Goal.status[f.goal]).toBe("active");
});
test("restored intention and externally edited state retain no execution grant", () => {
  const f = fixture(), before = snapshotOngoingActivity(f.world, f.actor)!;
  const saved = structuredClone(serializeWorld(f.world, createSystemRegistry()));
  const world = createArgosWorld("Restored activity"), { oldToNewId } = deserializeWorld(world, createSystemRegistry(), saved);
  const actor = oldToNewId.get(f.actor)!;
  expect(snapshotOngoingActivity(world, actor)).toMatchObject({ id: before.id, needsRevalidation: true });
  integrateActorContinuation(world, actor, { purpose: "Say hello", actionType: "speak", observedAtSimMs: 0 });
  expect(snapshotOngoingActivity(world, actor)?.needsRevalidation).toBe(true);
  OngoingActivity.stateJson[actor] = "invalid"; expect(snapshotOngoingActivity(world, actor)).toBeUndefined();
});
test("explicitly compatible physical side work stays active but retains its detour context", () => {
  const f = fixture(), before = snapshotOngoingActivity(f.world, f.actor)!;
  const other = createIntentGoal(f.world, f.actor, "Read a phone message", 7);
  f.world.time.elapsed = 4000;
  integrateActorContinuation(f.world, f.actor, { purpose: "Check the address while getting ready", actionType: "interact",
    goalId: other, activityDisposition: "continue", switchReason: "I need the address for my journey.", observedAtSimMs: 4000 });
  expect(snapshotOngoingActivity(f.world, f.actor)).toMatchObject({ id: before.id, status: "active", needsRevalidation: false,
    interruption: { purpose: "Check the address while getting ready", startedAtSimMs: 4000 } });
  expect(Plan.currentStep[f.plan]).toBe(0);
});
test("interruption context survives restoration without restoring a grant", () => {
  const f = fixture(); f.world.time.elapsed = 5000;
  integrateActorContinuation(f.world, f.actor, { purpose: "Inspect a parcel", actionType: "observe",
    switchReason: "It might contain my keys.", observedAtSimMs: 5000 });
  const before = snapshotOngoingActivity(f.world, f.actor)!;
  const saved = structuredClone(serializeWorld(f.world, createSystemRegistry()));
  const restored = createArgosWorld("Restored detour");
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved);
  const actor = oldToNewId.get(f.actor)!;
  expect(snapshotOngoingActivity(restored, actor)).toMatchObject({ interruption: before.interruption, needsRevalidation: true });
  integrateActorContinuation(restored, actor, { purpose: "Answer a greeting", actionType: "speak", observedAtSimMs: 5000 });
  expect(snapshotOngoingActivity(restored, actor)?.needsRevalidation).toBe(true);
});
test("replacing the organizing activity does not inherit the old interruption", () => {
  const f = fixture(), other = createIntentGoal(f.world, f.actor, "Check a parcel", 7);
  integrateActorContinuation(f.world, f.actor, { purpose: "Inspect parcel", actionType: "observe", goalId: other, observedAtSimMs: 0 });
  const before = snapshotOngoingActivity(f.world, f.actor)!;
  integrateActorContinuation(f.world, f.actor, { purpose: "Stay and unpack instead", actionType: "observe", goalId: other,
    activityDisposition: "replace", switchReason: "My trip was cancelled.", observedAtSimMs: 0 });
  expect(snapshotOngoingActivity(f.world, f.actor)?.id).not.toBe(before.id);
  expect(snapshotOngoingActivity(f.world, f.actor)?.interruption).toBeUndefined();
  expect(Goal.status[f.goal]).toBe("active");
});
test("source replacement and changed goal definitions require revalidation", () => {
  const f = fixture(); stopCommittedEvents(f.world); startCommittedEvents(f.world);
  expect(snapshotOngoingActivity(f.world, f.actor)?.needsRevalidation).toBe(true);
  Goal.description[f.goal] = "An entirely different task";
  expect(snapshotOngoingActivity(f.world, f.actor)?.needsRevalidation).toBe(true);
  WorkingMemoryIdentity.id[f.actor] = "replacement";
  expect(snapshotOngoingActivity(f.world, f.actor)).toBeUndefined();
});
test.each(["pause", "end"] as const)("%s inhibits a fresh matching plan selection without completing its goal", disposition => {
  const f = fixture(), activity = snapshotOngoingActivity(f.world, f.actor)!;
  const choice = { purpose: "Prepare to leave", actionType: "observe", goalId: f.goal, goalKey: activity.goalKey, observedAtSimMs: 0 };
  integrateActorContinuation(f.world, f.actor, choice);
  expect(situatedPlanGoal(f.world, f.actor)).toBe(f.goal);
  integrateActorContinuation(f.world, f.actor, { ...choice, activityDisposition: disposition });
  expect(situatedPlanGoal(f.world, f.actor)).toBeUndefined();
  expect(Goal.status[f.goal]).toBe("active"); expect(Plan.currentStep[f.plan]).toBe(0);
});
test("re-registering the identical adapter requires fresh activity validation", () => {
  const f = fixture();
  const adapter = { context: () => "", ready: () => true, busy: () => false, execute: () => false };
  const unregister = registerAgentWorldCapabilities(f.world, f.actor, adapter);
  integrateActorContinuation(f.world, f.actor, { purpose: "Get ready", actionType: "observe", goalId: f.goal, observedAtSimMs: 0 });
  expect(snapshotOngoingActivity(f.world, f.actor)?.needsRevalidation).toBe(false);
  unregister(); const release = registerAgentWorldCapabilities(f.world, f.actor, adapter);
  expect(snapshotOngoingActivity(f.world, f.actor)?.needsRevalidation).toBe(true);
  release();
});
