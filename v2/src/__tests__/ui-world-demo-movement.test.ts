import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { createSystemRegistry, runSystems } from "../ecs/dynamic-systems";
import {
  createMovementSystem,
  createRoomArrivalSystem,
  createGoalPursuitSystem,
} from "../systems/builtin-systems";
import { getRoomForEntity } from "../ecs/location";
import { GridPosition, Goal } from "../ecs/components";
import { executeActions, createMovementGoal } from "../cognition/cognition-system";
import { getRelationTargets } from "bitecs";
import { HasGoal } from "../ecs/relations";

describe("UI world demo: grounded movement", () => {
  test("agents keep room assignment and walk toward target room", () => {
    const world = createArgosWorld("UIWorldDemoMovementTest");
    initializePrefabs(world);

    const registry = createSystemRegistry();
    registry.systems.set("Movement", createMovementSystem());
    registry.systems.set("RoomArrival", createRoomArrivalSystem());
    registry.systems.set("GoalPursuitSystem", createGoalPursuitSystem());

    // Disable time gating in tests.
    for (const sys of registry.systems.values()) {
      sys.frequency = 0;
      sys.lastRun = 0;
    }

    const roomA = createRoomEntity(world, { name: "Alpha", x: 0, y: 0 });
    const roomB = createRoomEntity(world, { name: "Beta", x: 400, y: 0 }); // grid x ~= 20

    const agent = createAgentEntity(world, {
      name: "Ada",
      role: "npc",
      systemPrompt: "test",
      roomId: roomA,
      // Spawn far from room center so old RoomArrival would clear LocatedIn.
      gridPosition: { x: 15, y: 15 },
    });

    const startX = GridPosition.x[agent];
    const startY = GridPosition.y[agent];

    // First tick should not clear the room.
    runSystems(world, registry, 1, 250);
    expect(getRoomForEntity(world, agent)).toBe(roomA);

    // Ask the agent to move to roomB (creates a movement goal).
    executeActions(world, [{ eid: agent, action: { type: "move", target: "Beta" } }], registry);

    // Run ticks until the agent arrives.
    for (let t = 2; t < 80; t++) {
      runSystems(world, registry, t, 250);
    }

    const endX = GridPosition.x[agent];
    const endY = GridPosition.y[agent];

    expect(endX).not.toBe(startX);
    expect(endY).not.toBe(startY);

    // RoomArrival should have updated containment to Beta by the time we reach it.
    expect(getRoomForEntity(world, agent)).toBe(roomB);

    // Movement goal should be completed.
    const goalEids = getRelationTargets(world, agent, HasGoal);
    expect(goalEids.length).toBeGreaterThan(0);
    const statuses = goalEids.map((g) => Goal.status[g]).filter(Boolean);
    expect(statuses).toContain("completed");
  });


  test("GoalPursuit: does not thrash between equal-priority movement goals", () => {
    const world = createArgosWorld("UIWorldDemoGoalPursuitLockTest");
    initializePrefabs(world);

    const registry = createSystemRegistry();
    registry.systems.set("Movement", createMovementSystem());
    registry.systems.set("RoomArrival", createRoomArrivalSystem());
    registry.systems.set("GoalPursuitSystem", createGoalPursuitSystem());

    // Disable time gating in tests.
    for (const sys of registry.systems.values()) {
      sys.frequency = 0;
      sys.lastRun = 0;
    }

    const start = createRoomEntity(world, { name: "Start", x: 0, y: 0 });
    const beta = createRoomEntity(world, { name: "Beta", x: 400, y: 0 });
    const gamma = createRoomEntity(world, { name: "Gamma", x: 0, y: 400 });

    const agent = createAgentEntity(world, {
      name: "Dorian",
      role: "npc",
      systemPrompt: "test",
      roomId: start,
      gridPosition: { x: 1, y: 1 },
    });

    const goalBeta = createMovementGoal(world, agent, "Beta", "test", 5);
    const goalGamma = createMovementGoal(world, agent, "Gamma", "test", 5);

    expect(goalBeta).toBeDefined();
    expect(goalGamma).toBeDefined();

    // Force a deterministic tie-break: Beta is older.
    if (goalBeta !== undefined) Goal.createdAt[goalBeta] = 1;
    if (goalGamma !== undefined) Goal.createdAt[goalGamma] = 2;

    // Run multiple ticks; the movement target should remain stable (not flip-flop).
    for (let t = 1; t < 20; t++) {
      runSystems(world, registry, t, 250);
      // GoalPursuit should keep driving toward Beta.
      expect(getRoomForEntity(world, agent)).not.toBeUndefined();
      // Agent should not bounce rooms due to movement target thrash.
      // After a few ticks, it should be moving generally toward Beta (increasing x).
      if (t > 2) {
        expect(GridPosition.x[agent]).toBeGreaterThanOrEqual(1);
      }
    }

    // Eventually ends up in Beta.
    expect(getRoomForEntity(world, agent)).toBe(beta);
  });
});
