/**
 * Unit Tests for Schedule System
 *
 * Tests:
 * - Schedule initialization
 * - Activity lookup by time
 * - Schedule generation
 * - Context formatting
 */

import "dotenv/config";
import { addEntity, addComponent, hasComponent, getRelationTargets } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Name, Description, Agent, Mind, Schedule, Room } from "../../ecs/components";
import { HasSchedule, LocatedIn } from "../../ecs/relations";
import {
  initializeSchedule,
  getSchedule,
  getActivityForHour,
  getCurrentActivity,
  getNextActivity,
  generateSchedule,
  createDefaultSchedule,
  runScheduleSystem,
  formatScheduleForContext,
  canInterruptCurrentActivity,
  getScheduleFlexibility,
  initializeAllSchedules,
  type ScheduledActivity,
} from "../schedule-system";

// =============================================================================
// TEST HELPERS
// =============================================================================

function createTestWorld() {
  return createArgosWorld("Test World");
}

function createTestAgent(world: ReturnType<typeof createArgosWorld>, name: string, role: string = "villager") {
  const eid = addEntity(world);
  addComponent(world, eid, Name);
  addComponent(world, eid, Description);
  addComponent(world, eid, Agent);
  addComponent(world, eid, Mind);

  Name.value[eid] = name;
  Description.value[eid] = `A test agent named ${name}`;
  Agent.role[eid] = role;
  Agent.active[eid] = true;
  Mind.arousal[eid] = 0.5;
  Mind.mode[eid] = "normal";

  return eid;
}

function createTestRoom(world: ReturnType<typeof createArgosWorld>, name: string) {
  const eid = addEntity(world);
  addComponent(world, eid, Name);
  addComponent(world, eid, Room);
  Name.value[eid] = name;
  Room.capacity[eid] = 10;
  return eid;
}

const testSchedule: ScheduledActivity[] = [
  { name: "sleep", startHour: 22, duration: 8, priority: 9, interruptible: false },
  { name: "breakfast", startHour: 6, duration: 1, priority: 6, interruptible: true },
  { name: "work", startHour: 7, duration: 5, priority: 8, interruptible: true, location: "Workshop" },
  { name: "lunch", startHour: 12, duration: 1, priority: 6, interruptible: true },
  { name: "afternoon_work", startHour: 13, duration: 4, priority: 7, interruptible: true },
  { name: "leisure", startHour: 17, duration: 4, priority: 4, interruptible: true },
  { name: "dinner", startHour: 21, duration: 1, priority: 6, interruptible: true },
];

// =============================================================================
// TESTS
// =============================================================================

describe("Schedule System", () => {
  describe("Schedule Initialization", () => {
    test("should initialize schedule for agent", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Alice");

      const scheduleEid = initializeSchedule(world, agentEid, testSchedule, 0.5);

      expect(hasComponent(world, scheduleEid, Schedule)).toBe(true);
      expect(Schedule.flexibility[scheduleEid]).toBe(0.5);

      const activities = JSON.parse(Schedule.activities[scheduleEid]);
      expect(activities.length).toBe(7);
    });

    test("should link schedule to agent via relation", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Bob");

      initializeSchedule(world, agentEid, testSchedule);

      const scheduleTargets = getRelationTargets(world, agentEid, HasSchedule);
      expect(scheduleTargets.length).toBe(1);
    });

    test("should replace existing schedule", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Charlie");

      const schedule1 = initializeSchedule(world, agentEid, testSchedule, 0.3);
      const schedule2 = initializeSchedule(world, agentEid, [
        { name: "new_activity", startHour: 0, duration: 24, priority: 5, interruptible: true },
      ], 0.8);

      // Should have replaced contents (EID may be recycled in non-versioned worlds)
      expect(Schedule.flexibility[schedule2]).toBe(0.8);
      const activities = JSON.parse(Schedule.activities[schedule2]) as ScheduledActivity[];
      expect(activities.length).toBe(1);
      expect(activities[0].name).toBe("new_activity");

      // Only one schedule linked
      const scheduleTargets = getRelationTargets(world, agentEid, HasSchedule);
      expect(scheduleTargets.length).toBe(1);
      expect(scheduleTargets[0]).toBe(schedule2);
    });

    test("should get schedule for agent", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Diana");

      expect(getSchedule(world, agentEid)).toBeUndefined();

      const scheduleEid = initializeSchedule(world, agentEid, testSchedule);
      expect(getSchedule(world, agentEid)).toBe(scheduleEid);
    });
  });

  describe("Activity Lookup", () => {
    test("should get activity for specific hour", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Eve");
      const scheduleEid = initializeSchedule(world, agentEid, testSchedule);

      // 7:00 AM - should be work
      const activity7 = getActivityForHour(scheduleEid, 7);
      expect(activity7).not.toBeNull();
      expect(activity7!.name).toBe("work");

      // 12:00 - should be lunch
      const activity12 = getActivityForHour(scheduleEid, 12);
      expect(activity12).not.toBeNull();
      expect(activity12!.name).toBe("lunch");

      // 23:00 - should be sleep
      const activity23 = getActivityForHour(scheduleEid, 23);
      expect(activity23).not.toBeNull();
      expect(activity23!.name).toBe("sleep");
    });

    test("should handle activities spanning midnight", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Frank");
      const scheduleEid = initializeSchedule(world, agentEid, testSchedule);

      // Sleep: 22:00 - 06:00 (spans midnight)

      // 1:00 AM - should still be sleep
      const activity1 = getActivityForHour(scheduleEid, 1);
      expect(activity1).not.toBeNull();
      expect(activity1!.name).toBe("sleep");

      // 5:00 AM - should still be sleep
      const activity5 = getActivityForHour(scheduleEid, 5);
      expect(activity5).not.toBeNull();
      expect(activity5!.name).toBe("sleep");
    });

    test("should return null for gaps in schedule", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Grace");

      // Schedule with a gap
      const gappySchedule: ScheduledActivity[] = [
        { name: "morning", startHour: 8, duration: 2, priority: 5, interruptible: true },
        { name: "evening", startHour: 18, duration: 2, priority: 5, interruptible: true },
      ];

      const scheduleEid = initializeSchedule(world, agentEid, gappySchedule);

      // 14:00 - no activity scheduled
      const activity14 = getActivityForHour(scheduleEid, 14);
      expect(activity14).toBeNull();
    });
  });

  describe("Current and Next Activity", () => {
    test("should get current activity based on world time", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Henry");
      initializeSchedule(world, agentEid, testSchedule);

      // This depends on actual current time, so we just verify it doesn't crash
      const current = getCurrentActivity(world, agentEid);
      // Result depends on time of day
      expect(current === null || typeof current.name === "string").toBe(true);
    });

    test("should get next scheduled activity", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Ivy");
      initializeSchedule(world, agentEid, testSchedule);

      const next = getNextActivity(world, agentEid);
      expect(next).not.toBeNull();
      expect(next!.activity.name).toBeDefined();
      expect(next!.hoursUntil).toBeGreaterThanOrEqual(0);
    });

    test("should return null for agent without schedule", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Jack");

      expect(getCurrentActivity(world, agentEid)).toBeNull();
      expect(getNextActivity(world, agentEid)).toBeNull();
    });
  });

  describe("Default Schedule", () => {
    test("should create default schedule", () => {
      const schedule = createDefaultSchedule("villager");

      expect(schedule.length).toBeGreaterThan(0);

      // Should have sleep
      const sleep = schedule.find(a => a.name === "sleep");
      expect(sleep).toBeDefined();

      // Should have meals
      const breakfast = schedule.find(a => a.name === "breakfast");
      const lunch = schedule.find(a => a.name === "lunch");
      const dinner = schedule.find(a => a.name === "dinner");
      expect(breakfast).toBeDefined();
      expect(lunch).toBeDefined();
      expect(dinner).toBeDefined();

      // Should have work
      const work = schedule.find(a => a.name === "work");
      expect(work).toBeDefined();
    });

    test("should cover 24 hours reasonably", () => {
      const schedule = createDefaultSchedule("merchant");

      // Calculate total hours covered
      const totalHours = schedule.reduce((sum, a) => sum + a.duration, 0);

      // Should cover most of the day
      expect(totalHours).toBeGreaterThanOrEqual(20);
    });
  });

  describe("Schedule System Run", () => {
    test("should update current activity", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Kate");
      const scheduleEid = initializeSchedule(world, agentEid, testSchedule);

      runScheduleSystem(world);

      // Current activity should be set (depends on time)
      const current = Schedule.currentActivity[scheduleEid];
      // May or may not be set depending on if there's an activity for current hour
      expect(current !== undefined).toBe(true);
    });

    test("should handle multiple agents", () => {
      const world = createTestWorld();
      const agent1 = createTestAgent(world, "Luna");
      const agent2 = createTestAgent(world, "Mike");

      initializeSchedule(world, agent1, testSchedule);
      initializeSchedule(world, agent2, testSchedule);

      // Should not throw
      expect(() => runScheduleSystem(world)).not.toThrow();
    });
  });

  describe("Context Formatting", () => {
    test("should format schedule for context", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Nina");
      initializeSchedule(world, agentEid, testSchedule);

      const context = formatScheduleForContext(world, agentEid);

      expect(context).toContain("DAILY SCHEDULE");
      expect(context).toContain("Current time");
    });

    test("should return empty string when no schedule", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Oscar");

      const context = formatScheduleForContext(world, agentEid);
      expect(context).toBe("");
    });
  });

  describe("Interruptibility", () => {
    test("should check if current activity is interruptible", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Petra");
      initializeSchedule(world, agentEid, testSchedule);

      // Should return a boolean
      const canInterrupt = canInterruptCurrentActivity(world, agentEid);
      expect(typeof canInterrupt).toBe("boolean");
    });

    test("should return true when no schedule", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Quinn");

      expect(canInterruptCurrentActivity(world, agentEid)).toBe(true);
    });
  });

  describe("Flexibility", () => {
    test("should get schedule flexibility", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Rachel");
      initializeSchedule(world, agentEid, testSchedule, 0.7);

      expect(getScheduleFlexibility(world, agentEid)).toBe(0.7);
    });

    test("should return 1.0 (fully flexible) when no schedule", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Sam");

      expect(getScheduleFlexibility(world, agentEid)).toBe(1.0);
    });
  });

  describe("LLM Schedule Generation", () => {
    test("should generate schedule via LLM", async () => {
      const world = createTestWorld();
      const roomEid = createTestRoom(world, "Village");
      const agentEid = createTestAgent(world, "Tina", "blacksmith");
      addComponent(world, agentEid, LocatedIn(roomEid));

      const schedule = await generateSchedule(world, agentEid);

      expect(schedule).not.toBeNull();
      expect(schedule!.activities.length).toBeGreaterThanOrEqual(5);
      expect(schedule!.activities.length).toBeLessThanOrEqual(8);
      expect(schedule!.flexibility).toBeGreaterThanOrEqual(0);
      expect(schedule!.flexibility).toBeLessThanOrEqual(1);

      // Each activity should have valid structure
      for (const activity of schedule!.activities) {
        expect(activity.name.length).toBeGreaterThan(0);
        expect(activity.startHour).toBeGreaterThanOrEqual(0);
        expect(activity.startHour).toBeLessThanOrEqual(23);
        expect(activity.duration).toBeGreaterThan(0);
        expect(typeof activity.interruptible).toBe("boolean");
      }
    }, 30000);

    test("should initialize all schedules", async () => {
      const world = createTestWorld();
      const roomEid = createTestRoom(world, "Town");

      const agent1 = createTestAgent(world, "Uma");
      const agent2 = createTestAgent(world, "Victor");
      addComponent(world, agent1, LocatedIn(roomEid));
      addComponent(world, agent2, LocatedIn(roomEid));

      await initializeAllSchedules(world, false); // Use default schedules

      expect(getSchedule(world, agent1)).toBeDefined();
      expect(getSchedule(world, agent2)).toBeDefined();
    });

    test("should not duplicate schedules on re-run", async () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Walter");

      await initializeAllSchedules(world, false);
      const schedule1 = getSchedule(world, agentEid);

      await initializeAllSchedules(world, false);
      const schedule2 = getSchedule(world, agentEid);

      // Should be same schedule (not recreated)
      expect(schedule1).toBe(schedule2);
    });
  });
});
