import { jest } from "@jest/globals";
import { addComponent, addEntity, getRelationTargets } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } from "../../ecs/prefabs";
import { Goal, Plan, Schedule } from "../../ecs/components";
import { HasGoal, HasPlan, HasSchedule } from "../../ecs/relations";
import { createSystemRegistry, registerSystem, runSystems } from "../../ecs/dynamic-systems";
import { createScheduledActivityGoalSystem, createScheduledActivityTemplatePlannerSystem } from "../scheduled-activity-systems";
import { createGeneratedIntention } from "../../cognition/goal-lifecycle";
import { createDefaultSchedule } from "../../cognition/schedule-system";
import { startCommittedEvents } from "../../runtime/committed-events";

beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Schedule checks are offline")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

function fixture(persona: boolean) {
  const world = createArgosWorld("Leisure ownership"); initializePrefabs(world); world.meta.aiEnabled = true;
  world.time.simulationHour = 18; startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Lounge" });
  const actor = createAgentEntity(world, { name: "Tess", role: "resident", systemPrompt: "Choose what matters to you.", roomId: room });
  createObjectEntity(world, { name: "Armchair", traits: ["chair"], portable: false, roomId: room });
  if (persona) expect(createGeneratedIntention(world, actor, { description: "Talk Leon into telling the Three Hooks story at the Gull tonight.", priority: 7, kind: "custom" }, "personal")).not.toBeNull();
  const schedule = addEntity(world); addComponent(world, schedule, Schedule); addComponent(world, actor, HasSchedule(schedule));
  Schedule.activities[schedule] = JSON.stringify([{ name: "evening leisure", startHour: 17, duration: 3, location: "Lounge", priority: 5, interruptible: true }]);
  const registry = createSystemRegistry();
  registerSystem(registry, { ...createScheduledActivityGoalSystem(), frequency: 0 });
  registerSystem(registry, { ...createScheduledActivityTemplatePlannerSystem(), frequency: 0 });
  runSystems(world, registry, world.time.tick + 1, 500); expect(registry.errors).toEqual([]);
  const leisure = getRelationTargets(world, actor, HasGoal).filter(id => Goal.kind[id] === "scheduled_activity");
  expect(leisure).toHaveLength(1);
  return getRelationTargets(world, actor, HasPlan).map(plan => JSON.parse(Plan.steps[plan]));
}

test("a resident with their own purpose gets no canned 'observe a chair, then sit' leisure plan", () => {
  expect(fixture(true)).toEqual([]);
});

test("the sit micro-plan remains a fallback for someone with no purpose of their own", () => {
  expect(fixture(false)).toEqual([expect.arrayContaining([expect.objectContaining({ actionType: "interact", target: "Armchair", content: "sit" })])]);
});

test("default rhythms follow the role's livelihood; unknown roles keep the generic day", () => {
  const evening = (role: string) => createDefaultSchedule(role).find(a => a.startHour === 17)!;
  expect(evening("cafe caretaker").name).toBe("evening service");
  expect(evening("neighborhood gardener").name).toBe("evening garden rounds");
  expect(evening("nurse enjoying a day off").name).toBe("off-duty evening");
  expect(evening("retired librarian").name).toBe("evening visiting and storytelling");
  expect(evening("bicycle mechanic taking a break").name).toBe("evening tinkering and errands");
  expect(evening("villager").name).toBe("leisure");
  expect(createDefaultSchedule("cafe caretaker").some(a => a.name === "leisure")).toBe(false);
  expect(new Set(["cafe caretaker", "neighborhood gardener", "retired librarian", "villager"].map(role => JSON.stringify(createDefaultSchedule(role)))).size).toBe(4);
});
