import { jest } from "@jest/globals";
import { addComponent, addEntity, getRelationTargets } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, Needs, Schedule } from "../../ecs/components";
import { HasGoal, HasSchedule } from "../../ecs/relations";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { readStampedSimulationTime } from "../../ecs/temporal-age";
import { createSystemRegistry, registerSystem, runSystems, type SystemDefinition } from "../../ecs/dynamic-systems";
import { goalCleanupSystem, needsBasedMovementSystem, scheduleExecutionSystem } from "../deterministic-behavior-systems";
import { createDayPlanActivationSystem, createScheduledActivityGoalSystem } from "../scheduled-activity-systems";

const EPOCH = 1_700_000_000_000;
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(EPOCH); });
afterEach(() => jest.useRealTimers());

function fixture() {
  const world = createArgosWorld("Goal writer timing"); initializePrefabs(world);
  world.time.simulationHour = 20;
  const room = createRoomEntity(world, { name: "Common Room" });
  createRoomEntity(world, { name: "Kitchen" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "test", roomId: room });
  const run = (compiledFn: SystemDefinition["compiledFn"]) => {
    const registry = createSystemRegistry();
    registerSystem(registry, { name: "Timing fixture", description: "test", pseudocode: "", active: true, frequency: 0, lastRun: 0, compiledFn });
    runSystems(world, registry, world.time.tick + 1, 500);
    expect(registry.errors).toEqual([]);
  };
  const advance = (ms: number) => advanceSimulationTime(world, world.time.tick + 1, ms);
  return { world, actor, run, advance, goals: () => getRelationTargets(world, actor, HasGoal) };
}

test("scheduled movement gets an epoch deadline with an explicit simulation-time stamp", () => {
  const f = fixture(), schedule = addEntity(f.world);
  addComponent(f.world, schedule, Schedule); addComponent(f.world, f.actor, HasSchedule(schedule));
  Schedule.activities[schedule] = JSON.stringify([{ name: "dinner", startHour: 20, duration: 2, location: "Kitchen" }]);
  f.advance(120_000); jest.setSystemTime(EPOCH + 86_400_000);
  f.run(scheduleExecutionSystem);
  const goal = f.goals()[0];
  expect(Goal.createdAt[goal]).toBe(EPOCH + 86_400_000);
  expect(Goal.deadline[goal] - Goal.createdAt[goal]).toBe(7_200_000);
  expect(readStampedSimulationTime(f.world, goal, "Goal.createdAt", Goal.createdAt[goal])).toBe(120_000);
  f.run(goalCleanupSystem); expect(Goal.status[goal]).toBe("active");
  jest.setSystemTime(EPOCH + 172_800_000); f.run(goalCleanupSystem); expect(Goal.status[goal]).toBe("active");
  f.advance(7_200_000); f.run(goalCleanupSystem); expect(Goal.status[goal]).toBe("failed");
});

test("a needs movement goal explicitly has no deadline and a stamped birth", () => {
  const f = fixture(); Needs.hunger[f.actor] = 90;
  f.advance(20_000); jest.setSystemTime(EPOCH + 86_400_000);
  f.run(needsBasedMovementSystem);
  const goal = f.goals()[0];
  expect(Goal.deadline[goal]).toBe(0);
  expect(readStampedSimulationTime(f.world, goal, "Goal.createdAt", Goal.createdAt[goal])).toBe(20_000);
  f.run(goalCleanupSystem); expect(Goal.status[goal]).toBe("active");
});

test("activating an old queued day plan starts a fresh bounded attempt, not an expired wall deadline", () => {
  const f = fixture(), goal = addEntity(f.world);
  addComponent(f.world, goal, Goal); addComponent(f.world, f.actor, HasGoal(goal));
  Goal.description[goal] = "Have dinner"; Goal.kind[goal] = "scheduled_activity"; Goal.status[goal] = "queued";
  Goal.createdAt[goal] = 0; Goal.deadline[goal] = EPOCH + 86_400_000; Goal.priority[goal] = 5; Goal.progress[goal] = 0;
  Goal.paramsJson[goal] = JSON.stringify({ startHour: 20, durationHours: 2, roomName: "Kitchen" });
  f.advance(60_000); jest.setSystemTime(EPOCH + 172_800_000);
  f.run(createDayPlanActivationSystem().compiledFn);
  expect(Goal.createdAt[goal]).toBe(Date.now()); expect(Goal.deadline[goal] - Goal.createdAt[goal]).toBe(180_000);
  expect(readStampedSimulationTime(f.world, goal, "Goal.deadline", Goal.deadline[goal])).toBe(240_000);
  f.run(goalCleanupSystem); expect(Goal.status[goal]).toBe("active");
  f.advance(179_999); f.run(goalCleanupSystem); expect(Goal.status[goal]).toBe("active");
  f.advance(1); f.run(goalCleanupSystem); expect(Goal.status[goal]).toBe("failed");
});

test("current-activity discovery uses the same activation budget for an existing queued intention", () => {
  const f = fixture(), schedule = addEntity(f.world);
  addComponent(f.world, schedule, Schedule); addComponent(f.world, f.actor, HasSchedule(schedule));
  Schedule.activities[schedule] = JSON.stringify([{ name: "socialize", startHour: 20, duration: 2, location: "Kitchen" }]);
  const system = createScheduledActivityGoalSystem(); f.run(system.compiledFn);
  const goal = f.goals().find(g => Goal.kind[g] === "scheduled_activity")!;
  expect(goal).toBeDefined();
  Goal.status[goal] = "queued"; Goal.createdAt[goal] = 0; Goal.deadline[goal] = EPOCH + 180_000;
  f.advance(120_000); jest.setSystemTime(EPOCH + 86_400_000);
  f.run(system.compiledFn);
  expect(Goal.createdAt[goal]).toBe(Date.now()); expect(Goal.deadline[goal] - Goal.createdAt[goal]).toBe(180_000);
  expect(readStampedSimulationTime(f.world, goal, "Goal.deadline", Goal.deadline[goal])).toBe(300_000);
  f.run(goalCleanupSystem); expect(Goal.status[goal]).toBe("active");
});
