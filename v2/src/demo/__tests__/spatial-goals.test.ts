import { jest } from "@jest/globals";
import { removeComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Agent, CognitiveControl, Goal, OngoingActivity, WorkingMemoryIdentity } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { createGeneratedIntention } from "../../cognition/goal-lifecycle";
import { createCommunicationMotivation } from "../../cognition/communication-motivation";
import { integrateActorContinuation, updateActorContinuation } from "../../cognition/actor-continuation";
import { recordOngoingActivityChoice } from "../../cognition/ongoing-activity";
import { projectSpatialGoals } from "../spatial-goals";

beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline goal projection")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
function fixture() {
  const world = createArgosWorld("Honest operator focus"); initializePrefabs(world); world.meta.aiEnabled = false; startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Harbor House" });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "Choose your evening.", roomId: room });
  const other = createAgentEntity(world, { name: "Ivo", role: "resident", systemPrompt: "Choose independently.", roomId: room });
  const standing = createCommunicationMotivation(world, actor, { description: "Stay in touch with Alex", memory: "We have known each other for years.", priority: 9 }).goal;
  const finite = createGeneratedIntention(world, actor, { description: "Compare the workshop markings", priority: 6, kind: "custom" }, "personal")!;
  const lower = createGeneratedIntention(world, actor, { description: "Spend a quiet moment with Ivo", priority: 4, kind: "social" }, "personal")!;
  const chooseLower = () => {
    recordOngoingActivityChoice(world, actor, { purpose: "Check the markings", actionType: "observe", goalId: finite });
    return integrateActorContinuation(world, actor, { purpose: "Join Ivo for a moment", goalId: lower, goalKey: WorkingMemoryIdentity.id[lower],
      actionType: "observe", observedAtSimMs: world.time.elapsed })!;
  };
  return { world, actor, other, standing, finite, lower, chooseLower, projection: () => projectSpatialGoals(world, actor) };
}

test("fallback displays a finite intention before a higher-priority standing motivation without reordering goals", () => {
  const f = fixture(), before = [f.standing, f.finite, f.lower].map(id => [Goal.status[id], Goal.priority[id], Goal.progress[id]]);
  const first = f.projection(), second = f.projection();
  expect(first.focus).toEqual({ description: Goal.description[f.finite], kind: "goal", status: "active" });
  expect(first.goals?.map(goal => goal.id)).toEqual([f.standing, f.finite, f.lower]); expect(second).toEqual(first);
  expect([f.standing, f.finite, f.lower].map(id => [Goal.status[id], Goal.priority[id], Goal.progress[id]])).toEqual(before);
});

test("a verified ongoing activity stays first even when another finite purpose has higher priority", () => {
  const f = fixture();
  recordOngoingActivityChoice(f.world, f.actor, { purpose: "Be available for Alex", actionType: "think", goalId: f.standing });
  Goal.priority[f.finite] = 10;
  integrateActorContinuation(f.world, f.actor, { purpose: "Look at the markings while staying available", goalId: f.finite,
    goalKey: WorkingMemoryIdentity.id[f.finite], activityDisposition: "continue", actionType: "observe", observedAtSimMs: 0 });
  const before = [CognitiveControl.stateJson[f.actor], OngoingActivity.stateJson[f.actor]];
  expect(f.projection().focus).toEqual({ description: Goal.description[f.standing], kind: "activity", status: "active" });
  expect([CognitiveControl.stateJson[f.actor], OngoingActivity.stateJson[f.actor]]).toEqual(before);
});

test("a current independently chosen lower-priority purpose is shown when the organizing activity is paused", () => {
  const f = fixture(); f.chooseLower();
  const before = [CognitiveControl.stateJson[f.actor], OngoingActivity.stateJson[f.actor]];
  expect(f.projection().focus).toEqual({ description: Goal.description[f.lower], kind: "goal", status: "active" });
  expect(f.projection().goals?.map(goal => goal.id)).toEqual([f.standing, f.finite, f.lower]);
  expect([CognitiveControl.stateJson[f.actor], OngoingActivity.stateJson[f.actor]]).toEqual(before);
});

test.each(["expired", "needs revision", "replaced goal identity", "detached goal", "completed goal", "stopped source", "replaced actor persona"])(
  "%s cannot turn the remembered choice into current UI focus", change => {
    const f = fixture(), revision = f.chooseLower();
    if (change === "expired") advanceSimulationTime(f.world, 1, 10_000);
    if (change === "needs revision") updateActorContinuation(f.world, f.actor, revision, "needs_revision", "Evidence changed");
    if (change === "replaced goal identity") WorkingMemoryIdentity.id[f.lower] = "replacement-goal";
    if (change === "detached goal") removeComponent(f.world, f.actor, HasGoal(f.lower));
    if (change === "completed goal") Goal.status[f.lower] = "completed";
    if (change === "stopped source") stopCommittedEvents(f.world);
    if (change === "replaced actor persona") Agent.systemPrompt[f.actor] = "A different resident";
    expect(f.projection().focus).toEqual({ description: Goal.description[f.finite], kind: "goal", status: "active" });
  });

test("a foreign private goal is neither selected nor exposed by a claimed continuation", () => {
  const f = fixture(); f.chooseLower();
  const foreign = createGeneratedIntention(f.world, f.other, { description: "PRIVATE_OTHER_RESIDENT_PURPOSE", kind: "custom", priority: 10 }, "personal")!;
  integrateActorContinuation(f.world, f.actor, { purpose: "A claimed borrowed intention", goalId: foreign, goalKey: WorkingMemoryIdentity.id[foreign],
    actionType: "observe", observedAtSimMs: 0 });
  expect(f.projection().focus?.description).toBe(Goal.description[f.finite]);
  expect(JSON.stringify(f.projection())).not.toContain("PRIVATE_OTHER_RESIDENT_PURPOSE");
});

test("only standing motivations remaining are shown as goals, not fabricated activities", () => {
  const f = fixture(); Goal.status[f.finite] = "completed"; Goal.status[f.lower] = "retired";
  expect(f.projection().focus).toEqual({ description: Goal.description[f.standing], kind: "goal", status: "active" });
  Goal.status[f.standing] = "retired"; expect(f.projection()).toEqual({ goals: [] });
});

test("finite fallback preserves its native status instead of pretending it is active ongoing work", () => {
  const f = fixture(); Goal.status[f.finite] = "in_progress";
  expect(f.projection().focus).toEqual({ description: Goal.description[f.finite], kind: "goal", status: "in_progress" });
});
