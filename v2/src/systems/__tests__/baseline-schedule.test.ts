import { jest } from "@jest/globals";
import { getRelationTargets } from "bitecs";
import { createSimulation } from "../../index";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { createArgosWorld } from "../../ecs/world";
import { createSystemRegistry, registerSystem, runSystems } from "../../ecs/dynamic-systems";
import { Agent, Goal, GridPosition, Schedule } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { getRoomForEntity, setLocatedIn } from "../../ecs/location";
import { createIntentGoal } from "../../cognition/cognition-system";
import { createDefaultSchedule, ensureSchedulesForCurrentDay, getSchedule, initializeAllSchedules, initializeSchedule, runScheduleSystem } from "../../cognition/schedule-system";
import { createDayPlanActivationSystem, createDayPlanPreplannerSystem, createScheduledActivityGoalSystem } from "../scheduled-activity-systems";
import { evaluateGoalSuccessContract } from "../goal-evaluation-system";
import { initializeWorkDocument } from "../../world/productive-work";

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network in scheduling regression"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

const workGoals = (world: ReturnType<typeof createArgosWorld>, actor: number) => getRelationTargets(world, actor, HasGoal)
  .filter(goal => Goal.kind[goal] === "scheduled_activity" && JSON.parse(Goal.paramsJson[goal] || "{}").activityType === "work_block");

test("a new visitor's real library schedule cannot invent a Street job that competes with their chosen purpose", async () => {
  const sim = await createSimulation({ name: "Baseline routine regression", preset: "minimal", enableAI: false,
    enableSpirits: false, evolution: false, codingDaemons: false, enableNarrativeEngine: false, godAutopilot: false,
    enableServer: false, dualLoop: false, rooms: [{ name: "Street", x: 0 }, { name: "Archive", x: 200 }],
    agents: [{ name: "Ada", role: "independent visitor", startRoom: "Street" }] });
  try {
    const actor = sim.god.registry.byName.get("Ada")!;
    const archive = sim.god.registry.byName.get("Archive")!;
    const purpose = createIntentGoal(sim.world, actor, "Compare the archive records and discuss the discrepancies.", 7);
    for (let i = 0; i < 5; i++) await sim.step(500);
    expect(getSchedule(sim.world, actor)).toBeDefined();
    expect(workGoals(sim.world, actor)).toEqual([]);
    const original = { description: Goal.description[purpose], status: Goal.status[purpose], progress: Goal.progress[purpose] };
    setLocatedIn(sim.world, actor, archive); // Controlled arrival, not a claimed autonomous choice.
    GridPosition.x[actor] = GridPosition.x[archive]; GridPosition.y[actor] = GridPosition.y[archive];
    for (let i = 0; i < 5; i++) await sim.step(500);
    expect(workGoals(sim.world, actor)).toEqual([]);
    expect({ description: Goal.description[purpose], status: Goal.status[purpose], progress: Goal.progress[purpose] }).toEqual(original);
    expect(getRoomForEntity(sim.world, actor)).toBe(archive);
    expect(sim.getSystemHealth().filter(system => system.totalErrors > 0)).toEqual([]);
  } finally { sim.stop(); }
});

test.each(["independent visitor", "writer", "night guard", "retired scientist", "merchant"])(
  "fallback routines do not turn the role label %s into a job or invent named destinations", role => {
    const routine = createDefaultSchedule(role);
    expect(routine.some(activity => /work/.test(activity.name))).toBe(false);
    expect(routine.some(activity => activity.location !== undefined)).toBe(false);
    expect(routine.some(activity => activity.name === "sleep")).toBe(true);
    expect(routine.some(activity => activity.name === "breakfast")).toBe(true);
  });

test.each(["initialize", "daily"])("%s initialization does not assign employment merely because a useful document is nearby", async path => {
  const world = createArgosWorld(); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Reading room" });
  const actor = createAgentEntity(world, { name: "Ada", role: "visitor", systemPrompt: "Choose freely.", roomId: room });
  const document = createObjectEntity(world, { name: "Notes", roomId: room }); initializeWorkDocument(world, document);
  if (path === "initialize") await initializeAllSchedules(world, false);
  else await ensureSchedulesForCurrentDay(world, { useLLM: false });
  const registry = createSystemRegistry();
  for (const system of [createDayPlanPreplannerSystem(), createDayPlanActivationSystem(), createScheduledActivityGoalSystem()]) registerSystem(registry, system);
  runSystems(world, registry, 1, 500);
  expect(workGoals(world, actor)).toEqual([]);
  expect(registry.errors).toEqual([]);
});

test("a deliberately authored work commitment remains active without tools and is never completed just by being in its room", async () => {
  const world = createArgosWorld(); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" });
  const actor = createAgentEntity(world, { name: "Ada", role: "writer", systemPrompt: "Keep the agreed shift.", roomId: room });
  const schedule = initializeSchedule(world, actor, [{ name: "work", startHour: 8, duration: 4,
    location: "Workshop", priority: 8, interruptible: true, description: "Complete the commissioned report." }]);
  await ensureSchedulesForCurrentDay(world, { useLLM: false });
  expect(getSchedule(world, actor)).toBe(schedule);
  const registry = createSystemRegistry(); registerSystem(registry, createScheduledActivityGoalSystem());
  runSystems(world, registry, 1, 500);
  expect(workGoals(world, actor)).toHaveLength(1);
  const goal = workGoals(world, actor)[0];
  expect(Goal.status[goal]).toBe("active");
  expect(evaluateGoalSuccessContract(world, actor, goal).satisfied).toBe(false);
  expect(Agent.active[actor]).toBe(true);
});

test("a real gap in a schedule clears the current-activity projection instead of showing the previous obligation", () => {
  const world = createArgosWorld(); initializePrefabs(world);
  const actor = createAgentEntity(world, { name: "Ada", role: "visitor", systemPrompt: "Choose freely." });
  const schedule = initializeSchedule(world, actor, [{ name: "breakfast", startHour: 7, duration: 1, priority: 5, interruptible: true }]);
  world.time.simulationHour = 7; runScheduleSystem(world);
  expect(Schedule.currentActivity[schedule]).toBe("breakfast");
  world.time.simulationHour = 8; runScheduleSystem(world);
  expect(Schedule.currentActivity[schedule]).toBe("");
});

test("a day rollover carries an existing authored routine forward instead of replacing it with generic defaults", async () => {
  const world = createArgosWorld(); initializePrefabs(world);
  const actor = createAgentEntity(world, { name: "Ada", role: "visitor", systemPrompt: "Keep the actual agreed routine." });
  const schedule = initializeSchedule(world, actor, [{ name: "work", startHour: 20, duration: 2,
    location: "Dispatch room", priority: 8, interruptible: true, description: "The agreed evening dispatch shift." }], 0.8);
  const activities = Schedule.activities[schedule];
  world.time.simulationDay++;
  await ensureSchedulesForCurrentDay(world, { useLLM: false });
  expect(getSchedule(world, actor)).toBe(schedule);
  expect(Schedule.activities[schedule]).toBe(activities);
  expect(Schedule.flexibility[schedule]).toBe(0.8);
  expect(Schedule.plannedDay[schedule]).toBe(world.time.simulationDay);
});
