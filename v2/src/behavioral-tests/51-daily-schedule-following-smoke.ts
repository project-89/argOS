/**
 * Behavioral Test: Daily schedules (Generative Agents style) drive grounded movement over the day.
 *
 * This test validates the ECS-first "daily planning" loop without any LLM dependency:
 * - DailySchedulePlanner creates a default schedule for an agent
 * - ScheduleSystem updates currentActivity as world time changes
 * - ScheduleExecutionSystem creates movement goals to preferred locations
 * - GoalPursuitSystem executes those goals deterministically (updates LocatedIn)
 *
 * Run:
 *   npx tsx src/behavioral-tests/51-daily-schedule-following-smoke.ts
 */
import "dotenv/config";

import { createSystemRegistry, registerSystem, runAsyncSystems, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Name, Schedule } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { getSchedule } from "../cognition/schedule-system";
import {
  createDailySchedulePlannerSystem,
  createScheduleSystem,
  createScheduleExecutionSystem,
  createGoalPursuitSystem,
} from "../systems/builtin-systems";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const world = createArgosWorld("DailyScheduleFollowingSmoke") as any;
  initializePrefabs(world);

  // Rooms that match the default schedule location keywords.
  const home = createRoomEntity(world, { name: "Home", description: "A cozy home." });
  const bakery = createRoomEntity(world, { name: "Bakery", description: "Smells of bread." });
  const tavern = createRoomEntity(world, { name: "Tavern", description: "Warm and lively." });

  // A single agent who should follow the schedule across hours.
  const agent = createAgentEntity(world, { name: "Ada", role: "baker", systemPrompt: "x", roomId: home });

  // Systems (frequency=0 so they run every tick in this tight test loop).
  const registry = createSystemRegistry();
  const dailyPlanner = createDailySchedulePlannerSystem();
  dailyPlanner.frequency = 0;
  registerSystem(registry as any, dailyPlanner as any);

  const scheduleSystem = createScheduleSystem();
  scheduleSystem.frequency = 0;
  registerSystem(registry as any, scheduleSystem as any);

  const scheduleExec = createScheduleExecutionSystem();
  scheduleExec.frequency = 0;
  registerSystem(registry as any, scheduleExec as any);

  const goalPursuit = createGoalPursuitSystem();
  goalPursuit.frequency = 0;
  registerSystem(registry as any, goalPursuit as any);

  // Ensure the planner runs once and finishes.
  runAsyncSystems(world as any, registry as any, 0, 16);
  await sleep(10);

  const scheduleEid = getSchedule(world as any, agent);
  assert(scheduleEid !== undefined, "expected DailySchedulePlanner to create a schedule");
  assert(Schedule.plannedDay[scheduleEid!] === 1, "expected schedule plannedDay to be set to simulationDay=1");

  const stepToHour = async (hour: number) => {
    world.time.simulationHour = hour;
    // Run a couple ticks to let schedule update + goal creation + goal pursuit happen.
    for (let t = 0; t < 3; t++) {
      runSystems(world as any, registry as any, t + hour * 10, 16);
      runAsyncSystems(world as any, registry as any, t + hour * 10, 16);
      await sleep(1);
    }
  };

  // 08:00 -> work @ bakery (for role=baker).
  await stepToHour(8);
  const roomAfterWork = getRoomForEntity(world as any, agent);
  assert(roomAfterWork === bakery, `expected agent to be in Bakery at 08:00, got ${roomAfterWork ? Name.value[roomAfterWork] : "none"}`);
  assert(String(Schedule.currentActivity[scheduleEid!] || "").length > 0, "expected ScheduleSystem to set currentActivity");

  // 12:00 -> lunch @ tavern.
  await stepToHour(12);
  const roomAfterLunch = getRoomForEntity(world as any, agent);
  assert(roomAfterLunch === tavern, `expected agent to be in Tavern at 12:00, got ${roomAfterLunch ? Name.value[roomAfterLunch] : "none"}`);

  // 22:00 -> sleep @ home.
  await stepToHour(22);
  const roomAfterSleep = getRoomForEntity(world as any, agent);
  assert(roomAfterSleep === home, `expected agent to be in Home at 22:00, got ${roomAfterSleep ? Name.value[roomAfterSleep] : "none"}`);

  console.log("✓ Daily schedule following smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

