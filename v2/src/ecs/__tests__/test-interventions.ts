/**
 * Unit tests for the Intervention system
 * Run with: npx tsx src/ecs/__tests__/test-interventions.ts
 */

import { createWorld, addEntity, addComponent } from "bitecs";
import {
  createInterventionRegistry,
  registerIntervention,
  unregisterIntervention,
  listInterventions,
  activateIntervention,
  deactivateIntervention,
  runInterventions,
  createSimpleIntervention,
} from "../interventions";
import { createDynamicComponent, setDynamicComponentValue, getDynamicComponent, clearDynamicComponents } from "../dynamic-components";
import { Name, Needs } from "../components";

let passCount = 0;
let failCount = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passCount++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${error}`);
    failCount++;
  }
}

function assert(condition: boolean, message?: string) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function assertEqual(actual: any, expected: any, message?: string) {
  if (actual !== expected) {
    throw new Error(`${message || "Assertion failed"}: expected ${expected}, got ${actual}`);
  }
}

console.log("\n=== Intervention System Tests ===\n");

// Test: Registry Management
console.log("Registry Management:");
{
  const registry = createInterventionRegistry();
  test("should create an empty registry", () => {
    assertEqual(registry.interventions.size, 0);
    assertEqual(registry.logs.length, 0);
    assertEqual(registry.events.length, 0);
  });

  test("should register an intervention", () => {
    registerIntervention(registry, {
      name: "TestIntervention",
      description: "Test description",
      conditions: [{ targetEntity: "*", component: "Needs", property: "hunger", operator: ">", value: 80 }],
      effects: [{ type: "log", targetEntity: "$target", message: "Hungry!" }],
      repeatable: true,
      cooldown: 1,
      active: true,
      priority: 5,
    });
    assertEqual(registry.interventions.size, 1);
    assert(registry.interventions.get("TestIntervention") !== undefined);
  });

  test("should unregister an intervention", () => {
    const reg = createInterventionRegistry();
    registerIntervention(reg, {
      name: "ToRemove",
      description: "Will be removed",
      conditions: [],
      effects: [],
      repeatable: true,
      cooldown: 1,
      active: true,
      priority: 5,
    });
    assertEqual(reg.interventions.size, 1);
    const removed = unregisterIntervention(reg, "ToRemove");
    assert(removed === true);
    assertEqual(reg.interventions.size, 0);
  });

  test("should list all interventions", () => {
    const reg = createInterventionRegistry();
    registerIntervention(reg, { name: "Int1", description: "First", conditions: [], effects: [], repeatable: true, cooldown: 1, active: true, priority: 5 });
    registerIntervention(reg, { name: "Int2", description: "Second", conditions: [], effects: [], repeatable: false, cooldown: 10, active: false, priority: 3 });
    const list = listInterventions(reg);
    assertEqual(list.length, 2);
    assert(list.some(i => i.name === "Int1"));
    assert(list.some(i => i.name === "Int2"));
  });

  test("should activate and deactivate interventions", () => {
    const reg = createInterventionRegistry();
    registerIntervention(reg, { name: "Toggleable", description: "Can be toggled", conditions: [], effects: [], repeatable: true, cooldown: 1, active: false, priority: 5 });
    assertEqual(reg.interventions.get("Toggleable")?.definition.active, false);
    activateIntervention(reg, "Toggleable");
    assertEqual(reg.interventions.get("Toggleable")?.definition.active, true);
    deactivateIntervention(reg, "Toggleable");
    assertEqual(reg.interventions.get("Toggleable")?.definition.active, false);
  });
}

// Test: Condition Evaluation
console.log("\nCondition Evaluation:");
{
  test("should fire when > condition is met", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createInterventionRegistry();
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Needs);
    Name.value[eid] = "TestAgent";
    Needs.hunger[eid] = 90;

    registerIntervention(registry, {
      name: "HungerAlert",
      description: "Alert when hungry",
      conditions: [{ targetEntity: "*", component: "Needs", property: "hunger", operator: ">", value: 80 }],
      effects: [{ type: "log", targetEntity: "$target", message: "$name is hungry!" }],
      repeatable: true,
      cooldown: 1,
      active: true,
      priority: 5,
    });

    runInterventions(world, registry, 1);
    assert(registry.logs.some(l => l.includes("hungry")), "Expected log about hungry");
  });

  test("should NOT fire when condition is not met", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createInterventionRegistry();
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Needs);
    Name.value[eid] = "TestAgent";
    Needs.hunger[eid] = 50;

    registerIntervention(registry, {
      name: "HungerAlert",
      description: "Alert when hungry",
      conditions: [{ targetEntity: "*", component: "Needs", property: "hunger", operator: ">", value: 80 }],
      effects: [{ type: "log", targetEntity: "$target", message: "$name is hungry!" }],
      repeatable: true,
      cooldown: 1,
      active: true,
      priority: 5,
    });

    runInterventions(world, registry, 1);
    assertEqual(registry.logs.length, 0);
  });

  test("should handle == operator", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createInterventionRegistry();
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Needs);
    Name.value[eid] = "TestAgent";
    Needs.hunger[eid] = 50;

    registerIntervention(registry, {
      name: "ExactHunger",
      description: "Alert at exact hunger",
      conditions: [{ targetEntity: "*", component: "Needs", property: "hunger", operator: "==", value: 50 }],
      effects: [{ type: "log", targetEntity: "$target", message: "$name at exact!" }],
      repeatable: true,
      cooldown: 1,
      active: true,
      priority: 5,
    });

    runInterventions(world, registry, 1);
    assert(registry.logs.some(l => l.includes("exact")));
  });
}

// Test: Dynamic Components
console.log("\nDynamic Components:");
{
  test("should evaluate conditions on dynamic components", () => {
    clearDynamicComponents();
    createDynamicComponent({
      name: "Temperature",
      description: "Thermal state",
      properties: { current: "number", target: "number" },
    });

    const world = createWorld();
    const registry = createInterventionRegistry();
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    Name.value[eid] = "Reactor";
    setDynamicComponentValue("Temperature", eid, "current", 150);

    registerIntervention(registry, {
      name: "Overheat",
      description: "Alert on overheat",
      conditions: [{ targetEntity: "*", component: "Temperature", property: "current", operator: ">", value: 100 }],
      effects: [{ type: "log", targetEntity: "$target", message: "$name is overheating!" }],
      repeatable: true,
      cooldown: 1,
      active: true,
      priority: 5,
    });

    runInterventions(world, registry, 1);
    assert(registry.logs.some(l => l.includes("overheating")));
  });

  test("should set dynamic component values as effects", () => {
    clearDynamicComponents();
    createDynamicComponent({
      name: "Health",
      description: "Health points",
      properties: { current: "number", max: "number" },
    });

    const world = createWorld();
    const registry = createInterventionRegistry();
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    Name.value[eid] = "Player";
    setDynamicComponentValue("Health", eid, "current", 50);
    setDynamicComponentValue("Health", eid, "max", 100);

    registerIntervention(registry, {
      name: "AutoHeal",
      description: "Heal when below max",
      conditions: [{ targetEntity: "*", component: "Health", property: "current", operator: "<", value: 100 }],
      effects: [{ type: "setDynamic", targetEntity: "$target", component: "Health", property: "current", value: "$current + 10" }],
      repeatable: true,
      cooldown: 1,
      active: true,
      priority: 5,
    });

    runInterventions(world, registry, 1);
    const Health = getDynamicComponent("Health");
    assertEqual(Health?.current[eid], 60);
  });
}

// Test: Effect Types
console.log("\nEffect Types:");
{
  test("should emit events", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createInterventionRegistry();
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Needs);
    Name.value[eid] = "TestAgent";
    Needs.hunger[eid] = 95;

    registerIntervention(registry, {
      name: "HungerEvent",
      description: "Emit hunger event",
      conditions: [{ targetEntity: "*", component: "Needs", property: "hunger", operator: ">", value: 90 }],
      effects: [{ type: "emit", targetEntity: "$target", eventType: "critical_hunger", eventData: { severity: "high" } }],
      repeatable: true,
      cooldown: 1,
      active: true,
      priority: 5,
    });

    runInterventions(world, registry, 1);
    assertEqual(registry.events.length, 1);
    assertEqual(registry.events[0].type, "critical_hunger");
    assertEqual(registry.events[0].data.severity, "high");
  });

  test("should set built-in component values", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createInterventionRegistry();
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Needs);
    Name.value[eid] = "TestAgent";
    Needs.hunger[eid] = 100;

    registerIntervention(registry, {
      name: "ResetHunger",
      description: "Reset when max hunger",
      conditions: [{ targetEntity: "*", component: "Needs", property: "hunger", operator: ">=", value: 100 }],
      effects: [{ type: "setComponent", targetEntity: "$target", component: "Needs", property: "hunger", value: 50 }],
      repeatable: true,
      cooldown: 1,
      active: true,
      priority: 5,
    });

    runInterventions(world, registry, 1);
    assertEqual(Needs.hunger[eid], 50);
  });
}

// Test: Cooldown and Repeatable
console.log("\nCooldown and Repeatable:");
{
  test("should respect cooldown", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createInterventionRegistry();
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Needs);
    Name.value[eid] = "TestAgent";
    Needs.hunger[eid] = 90;

    registerIntervention(registry, {
      name: "CooldownTest",
      description: "Test cooldown",
      conditions: [{ targetEntity: "*", component: "Needs", property: "hunger", operator: ">", value: 80 }],
      effects: [{ type: "log", targetEntity: "$target", message: "effect-fired!" }],
      repeatable: true,
      cooldown: 5,
      active: true,
      priority: 5,
    });

    runInterventions(world, registry, 1);
    // Count only the effect's log, not the system's "fired for" log
    const countAfterFirst = registry.logs.filter(l => l.includes("effect-fired")).length;
    assertEqual(countAfterFirst, 1);

    runInterventions(world, registry, 2); // Should not fire (cooldown)
    const countAfterSecond = registry.logs.filter(l => l.includes("effect-fired")).length;
    assertEqual(countAfterSecond, 1);

    runInterventions(world, registry, 6); // Should fire (cooldown expired)
    const countAfterThird = registry.logs.filter(l => l.includes("effect-fired")).length;
    assertEqual(countAfterThird, 2);
  });

  test("should only fire once when not repeatable", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createInterventionRegistry();
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Needs);
    Name.value[eid] = "TestAgent";
    Needs.hunger[eid] = 90;

    registerIntervention(registry, {
      name: "OnceOnly",
      description: "Only fires once",
      conditions: [{ targetEntity: "*", component: "Needs", property: "hunger", operator: ">", value: 80 }],
      effects: [{ type: "log", targetEntity: "$target", message: "once!" }],
      repeatable: false,
      cooldown: 1,
      active: true,
      priority: 5,
    });

    runInterventions(world, registry, 1);
    runInterventions(world, registry, 2);
    runInterventions(world, registry, 3);

    assertEqual(registry.logs.filter(l => l.includes("once")).length, 1);
  });
}

// Test: Helper Functions
console.log("\nHelper Functions:");
{
  test("should create simple intervention", () => {
    const simple = createSimpleIntervention(
      "SimpleTest",
      "A simple test intervention",
      "*",
      "Needs",
      "hunger",
      ">",
      80,
      "log",
      { message: "Simple fired!" }
    );

    assertEqual(simple.name, "SimpleTest");
    assertEqual(simple.conditions.length, 1);
    assertEqual(simple.effects.length, 1);
    assertEqual(simple.effects[0].type, "log");
  });
}

// Summary
console.log("\n" + "=".repeat(40));
console.log(`Tests: ${passCount} passed, ${failCount} failed`);
console.log("=".repeat(40) + "\n");

process.exit(failCount > 0 ? 1 : 0);
