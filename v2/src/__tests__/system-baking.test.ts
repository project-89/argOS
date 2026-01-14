/**
 * Unit tests for System Baking
 *
 * Tests that baked systems are properly registered with active: true
 * so they actually execute in the runtime loop.
 */

// @ts-nocheck - Ignoring type errors from codebase inconsistencies
import {
  createSystemRegistry,
  registerSystem,
  runSystems,
  getSystem,
  type SystemRegistry,
  type SystemDefinition,
} from "../ecs/dynamic-systems";
import { createArgosWorld, type WorldContext } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";

describe("System Baking Integration", () => {
  let registry: SystemRegistry;
  let world: WorldContext;

  beforeEach(() => {
    registry = createSystemRegistry();
    world = createArgosWorld("TestWorld");
    initializePrefabs(world);
  });

  describe("Baked System Registration", () => {
    it("should register baked system with active: true", () => {
      // Simulate what the architect does after baking
      let executionCount = 0;

      const bakedSystem: SystemDefinition = {
        name: "BakedTestSystem",
        description: "A system created by the architect",
        pseudocode: "do something",
        frequency: 0,
        active: true, // This should be 'active', not 'enabled'
        lastRun: 0,
        compiledFn: () => {
          executionCount++;
        },
      };

      // Register like the architect does
      registerSystem(registry, bakedSystem);

      // Verify it's registered correctly
      const retrieved = getSystem(registry, "BakedTestSystem");
      expect(retrieved).toBeDefined();
      expect(retrieved?.active).toBe(true);

      // Verify it executes
      runSystems(world, registry, 1, 100);
      expect(executionCount).toBe(1);
    });

    it("should NOT execute if baked with wrong property name (enabled instead of active)", () => {
      // This simulates the bug we fixed
      let executionCount = 0;

      const buggySystem: SystemDefinition = {
        name: "BuggySystem",
        description: "System with wrong property",
        pseudocode: "do something",
        frequency: 0,
        active: false, // Default to false
        lastRun: 0,
        compiledFn: () => {
          executionCount++;
        },
      };

      // Simulate the old bug: setting 'enabled' instead of 'active'
      (buggySystem as any).enabled = true;

      registerSystem(registry, buggySystem);

      // Verify 'active' is still false (the bug)
      const retrieved = getSystem(registry, "BuggySystem");
      expect(retrieved?.active).toBe(false);

      // Verify it does NOT execute (because active is false)
      runSystems(world, registry, 1, 100);
      expect(executionCount).toBe(0);
    });

    it("should execute multiple baked systems when all active", () => {
      const executed: string[] = [];

      // Create multiple systems like architect would
      const systems = ["TradeSystem", "SocialSystem", "WeatherSystem"];

      for (const name of systems) {
        const system: SystemDefinition = {
          name,
          description: `${name} description`,
          pseudocode: "",
          frequency: 0,
          active: true, // Correctly set to active
          lastRun: 0,
          compiledFn: () => {
            executed.push(name);
          },
        };
        registerSystem(registry, system);
      }

      runSystems(world, registry, 1, 100);

      expect(executed).toContain("TradeSystem");
      expect(executed).toContain("SocialSystem");
      expect(executed).toContain("WeatherSystem");
      expect(executed.length).toBe(3);
    });
  });

  describe("System Frequency Control", () => {
    it("should respect custom frequency from architect specification", () => {
      let executionCount = 0;
      const now = Date.now();

      const system: SystemDefinition = {
        name: "FrequencyControlledSystem",
        description: "Has specific frequency",
        pseudocode: "",
        frequency: 5000, // 5 second frequency set by architect
        active: true,
        lastRun: now - 6000, // Last ran 6 seconds ago
        compiledFn: () => {
          executionCount++;
        },
      };

      registerSystem(registry, system);

      // Should run - enough time passed
      runSystems(world, registry, 1, 100);
      expect(executionCount).toBe(1);

      // Should not run again immediately
      runSystems(world, registry, 2, 100);
      expect(executionCount).toBe(1); // Still 1
    });
  });

  describe("Error Resilience", () => {
    it("should continue running other systems when one throws", () => {
      const executed: string[] = [];

      const system1: SystemDefinition = {
        name: "WorkingSystem1",
        description: "",
        pseudocode: "",
        frequency: 0,
        active: true,
        lastRun: 0,
        compiledFn: () => {
          executed.push("WorkingSystem1");
        },
      };

      const errorSystem: SystemDefinition = {
        name: "ErrorSystem",
        description: "",
        pseudocode: "",
        frequency: 0,
        active: true,
        lastRun: 0,
        compiledFn: () => {
          throw new Error("System crashed!");
        },
      };

      const system2: SystemDefinition = {
        name: "WorkingSystem2",
        description: "",
        pseudocode: "",
        frequency: 0,
        active: true,
        lastRun: 0,
        compiledFn: () => {
          executed.push("WorkingSystem2");
        },
      };

      registerSystem(registry, system1);
      registerSystem(registry, errorSystem);
      registerSystem(registry, system2);

      // Should not throw
      expect(() => runSystems(world, registry, 1, 100)).not.toThrow();

      // Working systems should have run
      expect(executed).toContain("WorkingSystem1");
      expect(executed).toContain("WorkingSystem2");
    });
  });

  describe("Integration: Simulating Architect Flow", () => {
    it("should correctly activate and execute a system through the full flow", () => {
      let executionCount = 0;

      // Step 1: System is baked with active: false (as bakeSystem does)
      const system: SystemDefinition = {
        name: "ArchitectBakedSystem",
        description: "Baked by architect",
        pseudocode: "FOR_EACH agent: do something",
        frequency: 0,
        active: false, // Initially inactive (as returned by bakeSystem)
        lastRun: 0,
        compiledFn: () => {
          executionCount++;
        },
      };

      // Step 2: Architect sets active: true (the fix we applied)
      system.active = true;

      // Step 3: Register with system registry
      registerSystem(registry, system);

      // Step 4: Verify it runs
      runSystems(world, registry, 1, 100);
      expect(executionCount).toBe(1);

      // Verify the system is in the registry with correct state
      const retrieved = getSystem(registry, "ArchitectBakedSystem");
      expect(retrieved?.active).toBe(true);
    });
  });
});
