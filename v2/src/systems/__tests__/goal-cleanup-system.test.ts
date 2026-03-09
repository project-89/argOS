import { entityExists, getRelationTargets, addEntity, addComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { createSystemRegistry, runSystems } from "../../ecs/dynamic-systems";
import { Goal } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { createGoalCleanupSystem } from "../builtin-systems";

describe("GoalCleanupSystem", () => {
  test("removes completed goals", () => {
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

    const registry = createSystemRegistry();
    const sys = createGoalCleanupSystem();
    sys.frequency = 0;
    sys.active = true;
    registry.systems.set(sys.name, sys);

    runSystems(world, registry, 1, 1000);

    expect(entityExists(world, goal)).toBe(false);
    const remaining = getRelationTargets(world, agent, HasGoal).filter((gid) => entityExists(world, gid));
    expect(remaining.length).toBe(0);
  });
});

