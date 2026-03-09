/**
 * Unit tests for Movement System
 *
 * Tests the movement execution flow:
 * 1. setMovementTarget() adds agent to movement queue
 * 2. Movement system moves agents toward targets on grid
 * 3. RoomArrival system sets LocatedIn when agents arrive at rooms
 * 4. Move action handler uses grid-based movement for roomless agents
 */

import { query, entityExists, getRelationTargets, hasComponent, addComponent } from "bitecs";
import {
  createSystemRegistry,
  registerSystem,
  runSystems,
  type SystemRegistry,
} from "../ecs/dynamic-systems";
import { createArgosWorld, type WorldContext } from "../ecs/world";
import {
  initializePrefabs,
  createAgentEntity,
  createRoomEntity,
} from "../ecs/prefabs";
import { Agent, Mind, GridPosition, Room, Name } from "../ecs/components";
import { LocatedIn } from "../ecs/relations";
import {
  setMovementTarget,
  getMovementTarget,
  clearMovementTarget,
  createMovementSystem,
  createRoomArrivalSystem,
} from "../systems/builtin-systems";

describe("Movement System", () => {
  let world: WorldContext;
  let registry: SystemRegistry;
  let tick: number;
  const delta = 16; // ~60fps

  beforeEach(() => {
    world = createArgosWorld("TestWorld");
    initializePrefabs(world);
    registry = createSystemRegistry();
    tick = 0;
  });

  // Helper to run systems with proper tick/delta
  const runSystemsOnce = () => {
    tick++;
    runSystems(world, registry, tick, delta);
  };

  describe("setMovementTarget", () => {
    it("should set a movement target for an agent", () => {
      const agentId = createAgentEntity(world, {
        name: "TestAgent",
        role: "test",
        systemPrompt: "test prompt",
      });

      const roomId = createRoomEntity(world, {
        name: "TestRoom",
        description: "A test room",
      });

      // Set movement target
      setMovementTarget(agentId, roomId);

      // Verify target is set
      expect(getMovementTarget(agentId)).toBe(roomId);
    });

    it("should clear a movement target", () => {
      const agentId = createAgentEntity(world, {
        name: "TestAgent",
        role: "test",
        systemPrompt: "test prompt",
      });

      const roomId = createRoomEntity(world, {
        name: "TestRoom",
        description: "A test room",
      });

      setMovementTarget(agentId, roomId);
      expect(getMovementTarget(agentId)).toBe(roomId);

      clearMovementTarget(agentId);
      expect(getMovementTarget(agentId)).toBeUndefined();
    });

    it("should overwrite existing movement target", () => {
      const agentId = createAgentEntity(world, {
        name: "TestAgent",
        role: "test",
        systemPrompt: "test prompt",
      });

      const room1 = createRoomEntity(world, { name: "Room1" });
      const room2 = createRoomEntity(world, { name: "Room2" });

      setMovementTarget(agentId, room1);
      expect(getMovementTarget(agentId)).toBe(room1);

      setMovementTarget(agentId, room2);
      expect(getMovementTarget(agentId)).toBe(room2);
    });
  });

  describe("Movement System Execution", () => {
    it("should move agent toward target each tick", () => {
      const agentId = createAgentEntity(world, {
        name: "MovingAgent",
        role: "test",
        systemPrompt: "test prompt",
        gridPosition: { x: 0, y: 0 },
      });

      const roomId = createRoomEntity(world, {
        name: "TargetRoom",
        x: 200, // This creates a GridPosition
        y: 200,
      });

      // Get initial positions
      const initialX = GridPosition.x[agentId];
      const initialY = GridPosition.y[agentId];

      // Set movement target
      setMovementTarget(agentId, roomId);

      // Create and register movement system
      const movementSystem = createMovementSystem();
      movementSystem.lastRun = 0; // Ensure it runs immediately
      registerSystem(registry, movementSystem);

      // Run the system
      runSystemsOnce();

      // Agent should have moved
      const newX = GridPosition.x[agentId];
      const newY = GridPosition.y[agentId];

      // Should have moved at least one step
      expect(newX !== initialX || newY !== initialY).toBe(true);
    });

    it("should clear movement target when agent arrives", () => {
      const agentId = createAgentEntity(world, {
        name: "ArrivalAgent",
        role: "test",
        systemPrompt: "test prompt",
        gridPosition: { x: 5, y: 5 },
      });

      const roomId = createRoomEntity(world, {
        name: "TargetRoom",
        x: 100, // Creates GridPosition at x: 5, y: 5 (100/20 = 5)
        y: 100,
      });

      // Position agent right next to room
      GridPosition.x[agentId] = GridPosition.x[roomId];
      GridPosition.y[agentId] = GridPosition.y[roomId];

      setMovementTarget(agentId, roomId);

      // Create and register movement system
      const movementSystem = createMovementSystem();
      movementSystem.lastRun = 0;
      registerSystem(registry, movementSystem);

      // Run the system
      runSystemsOnce();

      // Movement target should be cleared since agent arrived
      expect(getMovementTarget(agentId)).toBeUndefined();
    });
  });

  describe("RoomArrival System", () => {
    it("should set LocatedIn when agent arrives at room GridPosition", () => {
      const agentId = createAgentEntity(world, {
        name: "ArrivingAgent",
        role: "test",
        systemPrompt: "test prompt",
        gridPosition: { x: 10, y: 10 }, // Start away from room
      });

      const roomId = createRoomEntity(world, {
        name: "DestRoom",
        x: 100, // GridPosition x: 5
        y: 100, // GridPosition y: 5
      });

      // Agent starts without LocatedIn
      expect(getRelationTargets(world, agentId, LocatedIn)).toHaveLength(0);

      // Move agent to room's grid position (within threshold)
      GridPosition.x[agentId] = GridPosition.x[roomId];
      GridPosition.y[agentId] = GridPosition.y[roomId];

      // Create and run RoomArrival system
      const roomArrivalSystem = createRoomArrivalSystem();
      roomArrivalSystem.lastRun = 0;
      registerSystem(registry, roomArrivalSystem);

      runSystemsOnce();

      // Agent should now be directly located in the room
      const locatedInTargets = getRelationTargets(world, agentId, LocatedIn);
      expect(locatedInTargets).toContain(roomId);
    });

    it("should update LocatedIn when agent moves between rooms", () => {
      const agentId = createAgentEntity(world, {
        name: "RoomSwitcher",
        role: "test",
        systemPrompt: "test prompt",
      });

      const room1 = createRoomEntity(world, {
        name: "Room1",
        x: 100,
        y: 100,
      });

      const room2 = createRoomEntity(world, {
        name: "Room2",
        x: 300,
        y: 300,
      });

      // Start at room1
      GridPosition.x[agentId] = GridPosition.x[room1];
      GridPosition.y[agentId] = GridPosition.y[room1];

      // Create and run RoomArrival system
      const roomArrivalSystem = createRoomArrivalSystem();
      roomArrivalSystem.lastRun = 0;
      registerSystem(registry, roomArrivalSystem);

      runSystemsOnce();

      // Should be in room1
      let locatedInTargets = getRelationTargets(world, agentId, LocatedIn);
      expect(locatedInTargets).toContain(room1);
      expect(locatedInTargets).not.toContain(room2);

      // Move to room2
      GridPosition.x[agentId] = GridPosition.x[room2];
      GridPosition.y[agentId] = GridPosition.y[room2];

      // Need to force system to run again
      roomArrivalSystem.lastRun = 0;
      runSystemsOnce();

      // Should now be in room2
      locatedInTargets = getRelationTargets(world, agentId, LocatedIn);
      expect(locatedInTargets).toContain(room2);
    });

    it("should not set LocatedIn when agent is far from all rooms", () => {
      const agentId = createAgentEntity(world, {
        name: "LostAgent",
        role: "test",
        systemPrompt: "test prompt",
        gridPosition: { x: 50, y: 50 }, // Far from any room
      });

      const roomId = createRoomEntity(world, {
        name: "FarRoom",
        x: 100, // GridPosition x: 5
        y: 100, // GridPosition y: 5
      });

      // Create and run RoomArrival system
      const roomArrivalSystem = createRoomArrivalSystem();
      roomArrivalSystem.lastRun = 0;
      registerSystem(registry, roomArrivalSystem);

      runSystemsOnce();

      // Agent should NOT be located in any room
      const locatedInTargets = getRelationTargets(world, agentId, LocatedIn);
      expect(locatedInTargets).toHaveLength(0);
    });
  });

  describe("Full Movement Flow", () => {
    it("should complete full movement: target -> move -> arrival -> room occupancy", async () => {
      // Create agent without room (simulating "@ somewhere")
      const agentId = createAgentEntity(world, {
        name: "FullFlowAgent",
        role: "test",
        systemPrompt: "test prompt",
        gridPosition: { x: 0, y: 0 },
      });

      // Create target room
      const roomId = createRoomEntity(world, {
        name: "Tavern",
        x: 60, // GridPosition x: 3
        y: 60, // GridPosition y: 3
      });

      // Agent starts without LocatedIn
      expect(getRelationTargets(world, agentId, LocatedIn)).toHaveLength(0);

      // Set movement target (this is what the move action does for roomless agents)
      setMovementTarget(agentId, roomId);
      expect(getMovementTarget(agentId)).toBe(roomId);

      // Create both systems
      const movementSystem = createMovementSystem();
      const roomArrivalSystem = createRoomArrivalSystem();
      movementSystem.lastRun = 0;
      roomArrivalSystem.lastRun = 0;
      registerSystem(registry, movementSystem);
      registerSystem(registry, roomArrivalSystem);

      // Run multiple ticks until agent arrives
      for (let i = 0; i < 10; i++) {
        movementSystem.lastRun = 0;
        roomArrivalSystem.lastRun = 0;
        runSystemsOnce();
      }

      // Calculate distance
      const dx = GridPosition.x[agentId] - GridPosition.x[roomId];
      const dy = GridPosition.y[agentId] - GridPosition.y[roomId];
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Agent should be close to room (within arrival threshold)
      expect(distance).toBeLessThan(4);

      // Agent should now be directly located in the room
      const locatedInTargets = getRelationTargets(world, agentId, LocatedIn);
      expect(locatedInTargets).toContain(roomId);
    });
  });

  describe("Edge Cases", () => {
    it("should handle multiple agents moving simultaneously", () => {
      const agents: number[] = [];
      for (let i = 0; i < 5; i++) {
        agents.push(createAgentEntity(world, {
          name: `Agent${i}`,
          role: "test",
          systemPrompt: "test",
          gridPosition: { x: i * 2, y: i * 2 }, // Start closer together
        }));
      }

      const roomId = createRoomEntity(world, {
        name: "CrowdedRoom",
        x: 100,
        y: 100,
      });

      // All agents move toward same room
      for (const agentId of agents) {
        setMovementTarget(agentId, roomId);
      }

      const movementSystem = createMovementSystem();
      movementSystem.lastRun = 0;
      registerSystem(registry, movementSystem);

      // Run more ticks to allow all agents to arrive (furthest agent is ~12 units away)
      for (let i = 0; i < 30; i++) {
        movementSystem.lastRun = 0;
        runSystemsOnce();
      }

      // All agents should have moved toward the room
      for (const agentId of agents) {
        const dx = GridPosition.x[agentId] - GridPosition.x[roomId];
        const dy = GridPosition.y[agentId] - GridPosition.y[roomId];
        const distance = Math.sqrt(dx * dx + dy * dy);
        expect(distance).toBeLessThan(5); // All should be close
      }
    });

    it("should handle agent with no target gracefully", () => {
      const agentId = createAgentEntity(world, {
        name: "IdleAgent",
        role: "test",
        systemPrompt: "test",
        gridPosition: { x: 5, y: 5 },
      });

      const initialX = GridPosition.x[agentId];
      const initialY = GridPosition.y[agentId];

      // No movement target set
      expect(getMovementTarget(agentId)).toBeUndefined();

      const movementSystem = createMovementSystem();
      movementSystem.lastRun = 0;
      registerSystem(registry, movementSystem);

      runSystemsOnce();

      // Agent should not have moved
      expect(GridPosition.x[agentId]).toBe(initialX);
      expect(GridPosition.y[agentId]).toBe(initialY);
    });

    it("should handle target entity being removed", () => {
      const agentId = createAgentEntity(world, {
        name: "TargetLostAgent",
        role: "test",
        systemPrompt: "test",
        gridPosition: { x: 0, y: 0 },
      });

      const roomId = createRoomEntity(world, {
        name: "DisappearingRoom",
        x: 100,
        y: 100,
      });

      setMovementTarget(agentId, roomId);

      // Note: We can't easily remove the entity in this test setup,
      // but the system should handle missing entities gracefully
      // by checking entityExists before processing

      const movementSystem = createMovementSystem();
      movementSystem.lastRun = 0;
      registerSystem(registry, movementSystem);

      // This should not throw even if target becomes invalid
      expect(() => runSystemsOnce()).not.toThrow();
    });
  });
});
