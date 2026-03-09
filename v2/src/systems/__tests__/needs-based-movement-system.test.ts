import { entityExists, getRelationTargets } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createObjectEntity, createRoomEntity } from "../../ecs/prefabs";
import { createSystemRegistry, runSystems } from "../../ecs/dynamic-systems";
import { Needs, Goal } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { createNeedsBasedMovementSystem } from "../builtin-systems";

describe("NeedsBasedMovementSystem", () => {
  test("creates a movement goal to a food location when hunger is critical", () => {
    const world = createArgosWorld("test") as any;
    initializePrefabs(world);

    const square = createRoomEntity(world, { name: "Village Square" });
    const bakery = createRoomEntity(world, { name: "Bakery" });

    // Ensure there is at least one "food-like" room so the keyword match can resolve.
    createObjectEntity(world, { name: "Bread", roomId: bakery, traits: ["edible"] });

    // Put the hungry agent somewhere else so the movement system has work to do.
    const agent = createAgentEntity(world, { name: "Ada", role: "baker", systemPrompt: "x", roomId: square });
    Needs.hunger[agent] = 90;
    Needs.energy[agent] = 80;
    Needs.social[agent] = 80;

    const registry = createSystemRegistry();
    const sys = createNeedsBasedMovementSystem();
    sys.frequency = 0;
    sys.active = true;
    registry.systems.set(sys.name, sys);

    runSystems(world, registry, 1, 1000);

    const goals = getRelationTargets(world, agent, HasGoal);
    expect(goals.length).toBeGreaterThan(0);
    const descs = goals
      .filter((gid) => entityExists(world, gid))
      .map((gid) => Goal.description[gid] || "");
    expect(descs.some((d) => d.toLowerCase().includes("go to") && d.toLowerCase().includes("bakery"))).toBe(true);
  });
});
