import { jest } from "@jest/globals";
import { entityExists, getRelationTargets, addEntity, addComponent, removeComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { createSystemRegistry, runSystems } from "../../ecs/dynamic-systems";
import { Goal, GoalLifecycle, Plan, PendingToolJob } from "../../ecs/components";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { stampGoalTiming } from "../../ecs/temporal-age";
import { createPersonalIntention, isStandingIntention } from "../../cognition/goal-lifecycle";
import { createCommunicationMotivation } from "../../cognition/communication-motivation";
import { expireStaleGoals } from "../../cognition/autonomous-goals";
import { captureGoalReviewContext, prepareGoalReview, resumeDeferredGoals } from "../../cognition/goal-pursuit";
import { startCommittedEvents } from "../../runtime/committed-events";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { HasGoal } from "../../ecs/relations";
import { createGoalCleanupSystem } from "../builtin-systems";
import { createPlanEntity } from "../../cognition/planning-system";
import { registerAgentWorldCapabilities } from "../../cognition/world-capabilities";
import { getForegroundCognitionReadiness, recordCognitionOutcome, captureForegroundRejectionBasis,
  recordForegroundRejection, formatForegroundRejectionRecovery } from "../../cognition/idle-cognition";
import { workingMemoryEntityRef } from "../../cognition/working-memory";

const EPOCH = 1_700_000_000_000;
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(EPOCH); });
afterEach(() => jest.useRealTimers());

function fixture(status = "active", generated = false) {
  const world = createArgosWorld("Cleanup"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Common Room" });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "test", roomId: room });
  const goal = addEntity(world); addComponent(world, goal, Goal); addComponent(world, actor, HasGoal(goal));
  Goal.description[goal] = "Inspect the controls"; Goal.status[goal] = status; Goal.priority[goal] = 5;
  Goal.progress[goal] = 0; Goal.createdAt[goal] = EPOCH; Goal.deadline[goal] = 0;
  Goal.signature[goal] = "fixture-inspect-controls";
  if (generated) {
    addComponent(world, goal, GoalLifecycle); GoalLifecycle.source[goal] = "foreground";
    GoalLifecycle.mode[goal] = "exploratory"; GoalLifecycle.settledAt[goal] = status === "active" ? 0 : EPOCH;
  }
  const registry = createSystemRegistry(), system = createGoalCleanupSystem(); system.frequency = 0;
  registry.systems.set(system.name, system);
  const run = (at = Date.now(), simAt = at - EPOCH) => {
    jest.setSystemTime(at);
    advanceSimulationTime(world, world.time.tick + 1, simAt - world.time.elapsed);
    runSystems(world, registry, world.time.tick, 500);
  };
  const plan = () => createPlanEntity(world, actor, goal, { goalDescription: "Inspect", estimatedCompletion: "short", potentialObstacles: [],
    steps: [{ description: "Look", actionType: "observe", target: "Common Room" }] });
  return { world, actor, goal, run, plan };
}

describe("GoalCleanupSystem", () => {
  test.each(["completed", "failed", "retired", "expired"])("removing %s history does not restart quiet cognition or rejected-proposal recovery", status => {
    for (const mode of ["quiet", "rejection"] as const) {
      const f = fixture(status, true); startCommittedEvents(f.world); workingMemoryEntityRef(f.world, f.actor);
      f.run(EPOCH, 0); f.run(EPOCH, 59_999);
      expect(entityExists(f.world, f.goal)).toBe(true);
      recordCognitionOutcome(f.world, f.actor, { type: "wait" }, { succeeded: true, pending: false });
      recordCognitionOutcome(f.world, f.actor, { type: "wait" }, { succeeded: true, pending: false });
      const quietDeadline = getForegroundCognitionReadiness(f.world, f.actor).nextCheckAtMs!;
      if (mode === "rejection") recordForegroundRejection(f.world, f.actor,
        captureForegroundRejectionBasis(f.world, f.actor), "invalid_schema", "action.waitUntil", "null_condition");
      const before = getForegroundCognitionReadiness(f.world, f.actor);
      expect(before.ready).toBe(false);
      f.run(EPOCH, 60_000);
      expect(entityExists(f.world, f.goal)).toBe(false);
      const after = getForegroundCognitionReadiness(f.world, f.actor);
      expect(after).toMatchObject({ ready: false, reason: before.reason, nextCheckAtMs: before.nextCheckAtMs,
        quietDecisions: before.quietDecisions });
      if (mode === "rejection") expect(formatForegroundRejectionRecovery(f.world, f.actor)).toContain("cannot be null");
      // A rejected retry does not erase the already-selected quiet deadline.
      f.run(EPOCH, Math.max(quietDeadline, before.nextCheckAtMs!));
      expect(getForegroundCognitionReadiness(f.world, f.actor).ready).toBe(true);
    }
  });

  test("a standing communication desire remains explicitly deferrable and withdrawable", () => {
    const f = fixture(); startCommittedEvents(f.world);
    const motivation = createCommunicationMotivation(f.world, f.actor, {
      description: "Keep in touch", memory: "My phone connects me to my friends.",
    });
    const defer = prepareGoalReview(captureGoalReviewContext(f.world, f.actor), {
      goalId: motivation.goal, disposition: "defer", reason: "I want a minute of quiet.", afterSeconds: 60, wake: { kind: "review" },
    });
    expect(defer?.commit()).toBe(true);
    motivation.noticeNotification(); expect(Goal.status[motivation.goal]).toBe("paused"); expect(Goal.priority[motivation.goal]).toBe(6);
    f.run(EPOCH + 86_400_000, 59_999); expect(resumeDeferredGoals(f.world, f.actor)).toBe(0);
    f.run(EPOCH + 86_400_000, 60_000); expect(resumeDeferredGoals(f.world, f.actor)).toBe(1);
    expect(isStandingIntention(f.world, motivation.goal)).toBe(true);
    const release = prepareGoalReview(captureGoalReviewContext(f.world, f.actor), {
      goalId: motivation.goal, disposition: "withdraw", reason: "I am choosing not to stay reachable tonight.",
    });
    expect(release?.commit()).toBe(true); motivation.noticeNotification();
    expect(Goal.status[motivation.goal]).toBe("retired"); expect(Goal.progress[motivation.goal]).toBe(0);
  });

  test("standing persistence survives save and restore without renewing an episodic goal", () => {
    const f = fixture();
    const motivation = createCommunicationMotivation(f.world, f.actor, {
      description: "Keep in touch", memory: "My phone connects me to my friends.",
    });
    f.run(EPOCH, 180_000);
    const saved = JSON.parse(JSON.stringify(serializeWorld(f.world, createSystemRegistry())));
    jest.setSystemTime(EPOCH + 86_400_000);
    const restored = createArgosWorld("Restored desires"), registry = createSystemRegistry();
    const ids = deserializeWorld(restored, registry, saved).oldToNewId;
    const actor = ids.get(f.actor)!, goal = ids.get(motivation.goal)!;
    expect(isStandingIntention(restored, goal)).toBe(true);
    expireStaleGoals(restored, actor, 120_000);
    expect(Goal.status[goal]).toBe("active"); expect(Goal.deadline[goal]).toBe(0);
    expect(Goal.status[ids.get(f.goal)!]).toBe("expired");
  });

  test("waiting before Start or pausing does not expire a finite intention or standing communication desire", () => {
    const f = fixture();
    const personal = createPersonalIntention(f.world, f.actor, "Find my missing letter", 7)!;
    Goal.deadline[personal] = EPOCH + 600_000; stampGoalTiming(f.world, personal); // Explicit finite deadline, not a generated default.
    const communication = createCommunicationMotivation(f.world, f.actor, {
      description: "Keep in touch with the people in my life", memory: "I check familiar notifications.",
    });
    f.run(EPOCH + 671_402, 0);
    expect(Goal.status[personal]).toBe("active"); expect(Goal.status[communication.goal]).toBe("active");
    communication.noticeNotification(); expect(Goal.priority[communication.goal]).toBe(8);
    f.run(EPOCH + 86_400_000, 599_999);
    expect(Goal.status[personal]).toBe("active");
    f.run(EPOCH + 86_400_000, 600_000);
    expect(Goal.status[personal]).toBe("failed"); expect(Goal.progress[personal]).toBe(0);
    f.run(EPOCH + 86_400_000, 3_600_000);
    expect(Goal.status[communication.goal]).toBe("active"); expect(Goal.deadline[communication.goal]).toBe(0);
    communication.readCommunication(); expect(Goal.priority[communication.goal]).toBe(6);
    communication.noticeNotification(); expect(Goal.priority[communication.goal]).toBe(8);
    Goal.status[communication.goal] = "retired"; Goal.priority[communication.goal] = 6;
    communication.noticeNotification(); expect(Goal.status[communication.goal]).toBe("retired");
    expect(Goal.priority[communication.goal]).toBe(6);
  });

  test("accelerated time expires a stamped finite goal even when wall time is unchanged", () => {
    const f = fixture(); Goal.deadline[f.goal] = EPOCH + 100; stampGoalTiming(f.world, f.goal);
    f.run(EPOCH, 99); expect(Goal.status[f.goal]).toBe("active");
    f.run(EPOCH, 100); expect(Goal.status[f.goal]).toBe("failed");
    f.run(EPOCH + 86_400_000, 100); expect(entityExists(f.world, f.goal)).toBe(true);
    f.run(EPOCH + 86_400_000, 60_100); expect(entityExists(f.world, f.goal)).toBe(false);
  });

  test("persisted outcome retention survives restore and an offline wall interval", () => {
    const f = fixture("completed"); f.run(EPOCH, 0); f.run(EPOCH, 20_000);
    const saved = JSON.parse(JSON.stringify(serializeWorld(f.world, createSystemRegistry())));
    jest.setSystemTime(EPOCH + 86_400_000);
    const restored = createArgosWorld("Restored cleanup"), registry = createSystemRegistry();
    const ids = deserializeWorld(restored, registry, saved).oldToNewId;
    const goal = ids.get(f.goal)!; const system = createGoalCleanupSystem(); system.frequency = 0;
    registry.systems.set(system.name, system);
    runSystems(restored, registry, 1, 500); expect(entityExists(restored, goal)).toBe(true);
    advanceSimulationTime(restored, restored.time.tick + 1, 39_999); runSystems(restored, registry, restored.time.tick, 500);
    expect(entityExists(restored, goal)).toBe(true);
    advanceSimulationTime(restored, restored.time.tick + 1, 1); runSystems(restored, registry, restored.time.tick, 500);
    expect(entityExists(restored, goal)).toBe(false);
  });

  test.each([false, true])("reactivation receives a new retention episode (generated=%s)", generated => {
    const f = fixture("completed", generated); f.run(EPOCH, 0); f.run(EPOCH, 59_000);
    Goal.status[f.goal] = "active"; f.run(EPOCH, 59_000);
    Goal.status[f.goal] = "failed"; f.run(EPOCH, 60_000);
    f.run(EPOCH, 119_999); expect(entityExists(f.world, f.goal)).toBe(true);
    f.run(EPOCH, 120_000); expect(entityExists(f.world, f.goal)).toBe(false);
  });

  test("keeps a completed goal for at least a minute before removal", () => {
    const world = createArgosWorld("test") as any;
    initializePrefabs(world);

    const room = createRoomEntity(world, { name: "Room" });
    const agent = createAgentEntity(world, { name: "Ada", role: "baker", systemPrompt: "x", roomId: room });

    const goal = addEntity(world);
    addComponent(world, goal, Goal);
    addComponent(world, agent, HasGoal(goal));
    Goal.description[goal] = "Go to Bakery";
    Goal.status[goal] = "completed";
    Goal.priority[goal] = 5;
    Goal.progress[goal] = 100;
    Goal.deadline[goal] = 0;

    const registry = createSystemRegistry();
    const sys = createGoalCleanupSystem();
    sys.frequency = 0;
    sys.active = true;
    registry.systems.set(sys.name, sys);

    runSystems(world, registry, 1, 1000);
    expect(entityExists(world, goal)).toBe(true);
    jest.setSystemTime(EPOCH + 59_999);
    advanceSimulationTime(world, 2, 59_999);
    runSystems(world, registry, 2, 1000);
    expect(entityExists(world, goal)).toBe(true);
    jest.setSystemTime(EPOCH + 60_000);
    advanceSimulationTime(world, 3, 1);
    runSystems(world, registry, 3, 1000);

    expect(entityExists(world, goal)).toBe(false);
    const remaining = getRelationTargets(world, agent, HasGoal).filter((gid) => entityExists(world, gid));
    expect(remaining.length).toBe(0);
  });

  test("deadlines age in simulation time, retire future plan steps and do not claim physical completion", () => {
    const f = fixture(); const plan = f.plan(); Goal.deadline[f.goal] = EPOCH + 100;
    f.run(EPOCH + 99); expect(Goal.status[f.goal]).toBe("active");
    f.run(EPOCH + 100); expect(Goal.status[f.goal]).toBe("failed");
    expect(Goal.progress[f.goal]).toBe(0);
    expect(Plan.status[plan]).toBe("retired"); expect(Plan.currentStep[plan]).toBe(0);
    expect(entityExists(f.world, plan)).toBe(true);
    f.run(EPOCH + 60_100);
    expect(entityExists(f.world, f.goal)).toBe(false);
    expect(entityExists(f.world, plan)).toBe(false);
  });

  test.each(["retired", "failed", "completed"])("recent generated %s outcomes survive before bounded cleanup", status => {
    const f = fixture(status, true); const plan = f.plan(); Plan.status[plan] = "retired";
    f.run(EPOCH + 59_999); expect(entityExists(f.world, f.goal)).toBe(true);
    f.run(EPOCH + 60_000); expect(entityExists(f.world, f.goal)).toBe(false);
    expect(entityExists(f.world, plan)).toBe(false);
  });

  test("only generated paused exploratory episodes age out; authored pauses are retained", () => {
    const f = fixture("paused", true);
    const authored = addEntity(f.world); addComponent(f.world, authored, Goal); addComponent(f.world, f.actor, HasGoal(authored));
    Goal.description[authored] = "Authored future project"; Goal.status[authored] = "paused"; Goal.deadline[authored] = 0;
    f.run(EPOCH + 299_999); expect(entityExists(f.world, f.goal)).toBe(true);
    f.run(EPOCH + 300_000); expect(entityExists(f.world, f.goal)).toBe(false);
    expect(entityExists(f.world, authored)).toBe(true);
    expect(Goal.status[authored]).toBe("paused");
  });

  test.each(["active", "paused"])("a still-%s plan protects its goal even after retention", status => {
    const f = fixture("completed", true); const plan = f.plan(); Plan.status[plan] = status;
    f.run(EPOCH + 120_000);
    expect(entityExists(f.world, f.goal)).toBe(true); expect(entityExists(f.world, plan)).toBe(true);
    expect(Plan.status[plan]).toBe(status);
    Plan.status[plan] = "retired"; f.run();
    expect(entityExists(f.world, f.goal)).toBe(false); expect(entityExists(f.world, plan)).toBe(false);
  });

  test.each(["package", "tool"])("a pending %s execution protects its captured goal until its real receipt", mode => {
    const f = fixture("retired", true); const plan = f.plan(); Plan.status[plan] = "retired";
    let busy = true;
    const unregister = registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => !busy,
      busy: () => mode === "package" && busy, execute: () => false });
    if (mode === "tool") addComponent(f.world, f.actor, PendingToolJob);
    try {
      f.run(EPOCH + 120_000);
      expect(entityExists(f.world, f.goal)).toBe(true); expect(entityExists(f.world, plan)).toBe(true);
      busy = false; if (mode === "tool") removeComponent(f.world, f.actor, PendingToolJob);
      f.run(); expect(entityExists(f.world, f.goal)).toBe(false);
    } finally { unregister(); }
  });
});
