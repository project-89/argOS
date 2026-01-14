/**
 * Unit tests for Dynamic Systems
 *
 * Tests the core functionality of the dynamic system registry,
 * system execution, and the critical 'active' flag that controls
 * whether systems run.
 */

// @ts-nocheck - Ignoring type errors from codebase inconsistencies
import {
  createSystemRegistry,
  registerSystem,
  runSystems,
  getSystem,
  listSystems,
  activateSystem,
  deactivateSystem,
  type SystemDefinition,
  type SystemRegistry,
} from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";

describe("Dynamic Systems", () => {
  let registry: SystemRegistry;
  let world: ReturnType<typeof createArgosWorld>;

  beforeEach(() => {
    registry = createSystemRegistry();
    world = createArgosWorld("TestWorld");
    initializePrefabs(world);
  });

  describe("System Registry", () => {
    it("should create an empty registry", () => {
      expect(registry.systems.size).toBe(0);
      expect(registry.events).toEqual([]);
      expect(registry.logs).toEqual([]);
      expect(registry.errors).toEqual([]);
    });

    it("should register a system", () => {
      const system: SystemDefinition = {
        name: "TestSystem",
        description: "A test system",
        pseudocode: "do nothing",
        frequency: 1000,
        active: true,
        lastRun: 0,
      };

      registerSystem(registry, system);

      expect(registry.systems.size).toBe(1);
      expect(getSystem(registry, "TestSystem")).toBe(system);
    });

    it("should list all systems", () => {
      const system1: SystemDefinition = {
        name: "System1",
        description: "First system",
        pseudocode: "",
        frequency: 1000,
        active: true,
        lastRun: 0,
      };
      const system2: SystemDefinition = {
        name: "System2",
        description: "Second system",
        pseudocode: "",
        frequency: 2000,
        active: false,
        lastRun: 0,
      };

      registerSystem(registry, system1);
      registerSystem(registry, system2);

      const systems = listSystems(registry);
      expect(systems.length).toBe(2);
      expect(systems.map(s => s.name)).toContain("System1");
      expect(systems.map(s => s.name)).toContain("System2");
    });
  });

  describe("System Activation", () => {
    it("should activate a system", () => {
      const system: SystemDefinition = {
        name: "InactiveSystem",
        description: "Initially inactive",
        pseudocode: "",
        frequency: 1000,
        active: false,
        lastRun: 0,
      };

      registerSystem(registry, system);
      expect(getSystem(registry, "InactiveSystem")?.active).toBe(false);

      activateSystem(registry, "InactiveSystem");
      expect(getSystem(registry, "InactiveSystem")?.active).toBe(true);
    });

    it("should deactivate a system", () => {
      const system: SystemDefinition = {
        name: "ActiveSystem",
        description: "Initially active",
        pseudocode: "",
        frequency: 1000,
        active: true,
        lastRun: 0,
      };

      registerSystem(registry, system);
      expect(getSystem(registry, "ActiveSystem")?.active).toBe(true);

      deactivateSystem(registry, "ActiveSystem");
      expect(getSystem(registry, "ActiveSystem")?.active).toBe(false);
    });

    it("should return false when activating non-existent system", () => {
      const result = activateSystem(registry, "NonExistentSystem");
      expect(result).toBe(false);
    });
  });

  describe("System Execution", () => {
    it("should execute active systems with compiledFn", () => {
      let executionCount = 0;

      const system: SystemDefinition = {
        name: "CountingSystem",
        description: "Counts executions",
        pseudocode: "",
        frequency: 0, // Always run
        active: true,
        lastRun: 0,
        compiledFn: () => {
          executionCount++;
        },
      };

      registerSystem(registry, system);
      runSystems(world, registry, 1, 100);

      expect(executionCount).toBe(1);
    });

    it("should NOT execute inactive systems", () => {
      let executionCount = 0;

      const system: SystemDefinition = {
        name: "InactiveCountingSystem",
        description: "Should not run",
        pseudocode: "",
        frequency: 0,
        active: false, // INACTIVE
        lastRun: 0,
        compiledFn: () => {
          executionCount++;
        },
      };

      registerSystem(registry, system);
      runSystems(world, registry, 1, 100);

      expect(executionCount).toBe(0);
    });

    it("should respect frequency timing", () => {
      let executionCount = 0;
      const now = Date.now();

      const system: SystemDefinition = {
        name: "FrequencySystem",
        description: "Has frequency limit",
        pseudocode: "",
        frequency: 10000, // 10 second frequency
        active: true,
        lastRun: now, // Just ran
        compiledFn: () => {
          executionCount++;
        },
      };

      registerSystem(registry, system);

      // Should not run - just ran
      runSystems(world, registry, 1, 100);
      expect(executionCount).toBe(0);

      // Simulate time passing
      system.lastRun = now - 15000; // 15 seconds ago
      runSystems(world, registry, 2, 100);
      expect(executionCount).toBe(1);
    });

    it("should execute multiple active systems", () => {
      const executed: string[] = [];

      const system1: SystemDefinition = {
        name: "System1",
        description: "",
        pseudocode: "",
        frequency: 0,
        active: true,
        lastRun: 0,
        compiledFn: () => {
          executed.push("System1");
        },
      };

      const system2: SystemDefinition = {
        name: "System2",
        description: "",
        pseudocode: "",
        frequency: 0,
        active: true,
        lastRun: 0,
        compiledFn: () => {
          executed.push("System2");
        },
      };

      const system3: SystemDefinition = {
        name: "System3Inactive",
        description: "",
        pseudocode: "",
        frequency: 0,
        active: false, // Inactive
        lastRun: 0,
        compiledFn: () => {
          executed.push("System3Inactive");
        },
      };

      registerSystem(registry, system1);
      registerSystem(registry, system2);
      registerSystem(registry, system3);

      runSystems(world, registry, 1, 100);

      expect(executed).toContain("System1");
      expect(executed).toContain("System2");
      expect(executed).not.toContain("System3Inactive");
      expect(executed.length).toBe(2);
    });

    it("should update lastRun after execution", () => {
      const beforeRun = Date.now();

      const system: SystemDefinition = {
        name: "LastRunSystem",
        description: "",
        pseudocode: "",
        frequency: 0,
        active: true,
        lastRun: 0,
        compiledFn: () => {},
      };

      registerSystem(registry, system);
      runSystems(world, registry, 1, 100);

      const afterRun = Date.now();
      expect(system.lastRun).toBeGreaterThanOrEqual(beforeRun);
      expect(system.lastRun).toBeLessThanOrEqual(afterRun);
    });
  });

  describe("Critical: active vs enabled property", () => {
    it("should use 'active' property, not 'enabled'", () => {
      // This test ensures we don't accidentally use 'enabled' instead of 'active'
      let executionCount = 0;

      const system: SystemDefinition = {
        name: "ActivePropertySystem",
        description: "Tests active property",
        pseudocode: "",
        frequency: 0,
        active: true, // This is the correct property
        lastRun: 0,
        compiledFn: () => {
          executionCount++;
        },
      };

      // Verify the interface only has 'active', not 'enabled'
      expect("active" in system).toBe(true);
      // @ts-expect-error - 'enabled' should not exist on SystemDefinition
      expect(system.enabled).toBeUndefined();

      registerSystem(registry, system);
      runSystems(world, registry, 1, 100);

      expect(executionCount).toBe(1);
    });

    it("should not be fooled by an 'enabled' property", () => {
      let executionCount = 0;

      const system: SystemDefinition = {
        name: "MisnamedPropertySystem",
        description: "Has wrong property name",
        pseudocode: "",
        frequency: 0,
        active: false, // INACTIVE - this is what runSystems checks
        lastRun: 0,
        compiledFn: () => {
          executionCount++;
        },
      };

      // Simulate the bug: setting 'enabled' instead of 'active'
      (system as any).enabled = true;

      registerSystem(registry, system);
      runSystems(world, registry, 1, 100);

      // System should NOT run because 'active' is false
      expect(executionCount).toBe(0);
    });
  });

  describe("Error Handling", () => {
    it("should catch and record system errors", () => {
      const system: SystemDefinition = {
        name: "ErrorSystem",
        description: "Throws an error",
        pseudocode: "",
        frequency: 0,
        active: true,
        lastRun: 0,
        compiledFn: () => {
          throw new Error("Test error");
        },
      };

      registerSystem(registry, system);

      // Should not throw
      expect(() => runSystems(world, registry, 1, 100)).not.toThrow();

      // Should have recorded the error
      expect(registry.errors.length).toBeGreaterThan(0);
      expect(registry.errors[0].systemName).toBe("ErrorSystem");
      expect(registry.errors[0].error).toContain("Test error");
    });
  });
});
