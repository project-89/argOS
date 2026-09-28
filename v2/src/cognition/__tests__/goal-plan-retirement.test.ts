import { jest } from "@jest/globals";
import { addComponent, addEntity, entityExists, getRelationTargets, hasComponent, query } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Goal, GoalLifecycle, PendingToolJob, Plan, Schedule } from "../../ecs/components";
import { HasPlan } from "../../ecs/relations";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { stampGoalTiming } from "../../ecs/temporal-age";
import { createSystemRegistry, runSystems } from "../../ecs/dynamic-systems";
import { startCommittedEvents } from "../../runtime/committed-events";
import { createGoalCleanupSystem, createGoalPursuitSystem } from "../../systems/builtin-systems";
import { goalEvaluationSystem } from "../../systems/goal-evaluation-system";
import { createPersonalIntention, maintainGoalLifecycles } from "../goal-lifecycle";
import { captureGoalReviewContext, prepareGoalReview } from "../goal-pursuit";
import { captureIntentionReconsideration, prepareIntentionReconsideration } from "../intention-reconsideration";
import { bindSupportingGoal, retireGoalDependents } from "../goal-dependents";
import { expireStaleGoals } from "../autonomous-goals";
import { setGoalInactivityBudget } from "../goal-inactivity-budget";
import { setGoalContract } from "../goal-contract";
import { workingMemoryEntityRef } from "../working-memory";
import { initializeSchedule } from "../schedule-system";
import { recordScheduleOccurrence, retireReplacedScheduleOccurrences } from "../schedule-occurrences";
import { getSocialDialogue, recordCommittedSpeech, reviewSocialGoal } from "../social-memory";

const EPOCH = 100_000;
const paths = ["foreground review", "background review", "dependents", "maintenance",
  "native success", "inactivity expiry", "schedule replacement", "deadline cleanup",
  "social satisfaction", "legacy arrival", "legacy missing destination"] as const;
type Path = typeof paths[number];
const statuses = ["active", "awaiting_evidence", "awaiting_decision", "completed", "failed", "retired", "paused"];

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(EPOCH); jest.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

function fixture() {
  const world = createArgosWorld("Plan retirement ownership"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Common Room" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Test", roomId: room });
  const other = createAgentEntity(world, { name: "Bo", role: "resident", systemPrompt: "Test", roomId: room });
  workingMemoryEntityRef(world, actor); workingMemoryEntityRef(world, other);
  const goal = createPersonalIntention(world, actor, "Find the missing letter", 6)!;
  const otherGoal = createPersonalIntention(world, other, "Read my own letter", 5)!;
  const plan = (owner: number, forGoal: number, status: string) => {
    const id = addEntity(world); addComponent(world, id, Plan); addComponent(world, owner, HasPlan(id));
    Plan.goalEid[id] = forGoal; Plan.status[id] = status; Plan.currentStep[id] = 2;
    Plan.steps[id] = JSON.stringify([{ description: "Historical failed attempt", actionType: "observe", status: "failed" }]);
    Plan.createdAt[id] = EPOCH; Plan.lastUpdated[id] = EPOCH;
    return id;
  };
  const at = (simMs: number) => advanceSimulationTime(world, world.time.tick + 1, simMs - world.time.elapsed);
  return { world, actor, other, goal, otherGoal, plan, at };
}

function transition(f: ReturnType<typeof fixture>, path: Path) {
  const { world, actor, goal } = f;
  switch (path) {
    case "foreground review": {
      const prepared = prepareGoalReview(captureGoalReviewContext(world, actor), {
        goalId: goal, disposition: "release", reason: "I have chosen something else." });
      expect(prepared).toBeDefined(); expect(prepared!.commit()).toBe(true); break;
    }
    case "background review": {
      const prepared = prepareIntentionReconsideration(captureIntentionReconsideration(world, actor), [{
        goalId: goal, disposition: "release", reason: "The experience changed what I want." }]);
      expect(prepared).toBeDefined(); expect(prepared!.commit()).toBe(true); break;
    }
    case "dependents":
    case "maintenance": {
      const parent = createPersonalIntention(world, actor, "Prepare to leave", 7)!;
      bindSupportingGoal(world, actor, goal, parent);
      Goal.status[parent] = "retired";
      if (path === "dependents") expect(retireGoalDependents(world, actor, parent, "Parent ended, not completed.")).toBe(1);
      else expect(maintainGoalLifecycles(world, actor)).toBe(1);
      break;
    }
    case "native success":
      setGoalContract(world, goal, { version: 1, kind: "reach_room", params: { roomName: "Common Room" },
        description: "Be in Common Room", success: { type: "in_room", roomName: "Common Room" } });
      goalEvaluationSystem(world, { query, getRelationTargets, log: () => {}, emit: () => {} });
      expect(Goal.progress[goal]).toBe(100); break;
    case "social satisfaction": {
      Goal.kind[goal] = "social"; GoalLifecycle.mode[goal] = "social";
      Goal.successJson[goal] = JSON.stringify({ type: "custom" });
      recordCommittedSpeech(world, actor, "I found the company I wanted.", "Bo");
      recordCommittedSpeech(world, f.other, "I am glad we talked.", "Ada");
      const evidenceIds = getSocialDialogue(world, actor).map(turn => turn.id);
      expect(reviewSocialGoal(world, actor, { goalId: goal, disposition: "satisfied_for_now",
        reason: "We had the exchange I wanted.", evidenceIds })).toBeDefined();
      expect(Goal.status[goal]).toBe("completed"); break;
    }
    case "legacy arrival":
    case "legacy missing destination": {
      world.meta.aiEnabled = false;
      Goal.kind[goal] = "move_to_room";
      Goal.paramsJson[goal] = JSON.stringify({ roomName: path === "legacy arrival" ? "Common Room" : "Missing Room" });
      const registry = createSystemRegistry(), system = createGoalPursuitSystem(); system.frequency = 0;
      registry.systems.set(system.name, system); f.at(100);
      runSystems(world, registry, world.time.tick, 100);
      expect(Goal.status[goal]).toBe(path === "legacy arrival" ? "completed" : "failed"); break;
    }
    case "inactivity expiry":
      // An explicit authored expiry policy remains terminal; unconfigured
      // self-directed intentions now request review (covered separately).
      setGoalInactivityBudget(world, goal, 60_000);
      expect(expireStaleGoals(world, actor, 60_000)).toBe(0);
      f.at(60_001); expect(expireStaleGoals(world, actor, 60_000)).toBe(1); break;
    case "schedule replacement": {
      const activity = { name: "read", startHour: 9, duration: 1, interruptible: true };
      const schedule = initializeSchedule(world, actor, [activity]);
      Goal.kind[goal] = "scheduled_activity";
      expect(recordScheduleOccurrence(world, actor, schedule, activity, world.time.simulationDay, goal)).toBe(true);
      Schedule.activities[schedule] = "[]";
      expect(retireReplacedScheduleOccurrences(world, actor)).toBe(1); break;
    }
    case "deadline cleanup": {
      Goal.deadline[goal] = EPOCH + 100; stampGoalTiming(world, goal);
      const registry = createSystemRegistry(), system = createGoalCleanupSystem(); system.frequency = 0;
      registry.systems.set(system.name, system); f.at(100);
      runSystems(world, registry, world.time.tick, 100); break;
    }
  }
  expect(Goal.status[goal]).not.toBe("active");
}

describe.each(paths)("characterize %s", path => {
  test.each(statuses)("retirement of %s preserves evidence, ownership and pending work", status => {
    const f = fixture();
    const p = f.plan(f.actor, f.goal, status), unrelated = f.plan(f.other, f.otherGoal, status);
    const previous = { steps: Plan.steps[p], cursor: Plan.currentStep[p], created: Plan.createdAt[p], updated: Plan.lastUpdated[p] };
    addComponent(f.world, f.actor, PendingToolJob);
    PendingToolJob.toolId[f.actor] = "already-running-job"; PendingToolJob.command[f.actor] = "original-command";
    transition(f, path);
    // A decision draft belongs to the ended goal just as its motor steps do.
    const retired = ["active", "awaiting_evidence", "awaiting_decision"].includes(status);
    expect(Plan.status[p]).toBe(retired ? "retired" : status);
    expect(Plan.status[unrelated]).toBe(status); expect(Goal.status[f.otherGoal]).toBe("active");
    expect(entityExists(f.world, p)).toBe(true); expect(entityExists(f.world, f.goal)).toBe(true);
    expect({ steps: Plan.steps[p], cursor: Plan.currentStep[p], created: Plan.createdAt[p], updated: Plan.lastUpdated[p] }).toEqual(previous);
    expect(hasComponent(f.world, f.actor, PendingToolJob)).toBe(true);
    expect(PendingToolJob.toolId[f.actor]).toBe("already-running-job");
    expect(PendingToolJob.command[f.actor]).toBe("original-command");
    expect(Goal.progress[f.goal]).toBe(["native success", "social satisfaction", "legacy arrival"].includes(path) ? 100 : 0);
  });
});
