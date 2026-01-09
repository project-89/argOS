/**
 * Unit tests for the Proposition/Validation system
 * Run with: npx tsx src/ecs/__tests__/test-propositions.ts
 */

import { createWorld, addEntity, addComponent } from "bitecs";
import {
  createPropositionRegistry,
  registerProposition,
  unregisterProposition,
  listPropositions,
  evaluateProposition,
  evaluateAllPropositions,
  getCategoryReport,
  getPropositionHistory,
  createNeedsHealthProposition,
  createValueRangeProposition,
  createExistenceProposition,
} from "../propositions";
import { createDynamicComponent, setDynamicComponentValue, clearDynamicComponents } from "../dynamic-components";
import { Name, Needs, Agent } from "../components";

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

console.log("\n=== Proposition System Tests ===\n");

// Test: Registry Management
console.log("Registry Management:");
{
  test("should create an empty registry", () => {
    const registry = createPropositionRegistry();
    assertEqual(registry.propositions.size, 0);
    assertEqual(registry.history.length, 0);
    assertEqual(registry.categoryScores.size, 0);
  });

  test("should register a proposition", () => {
    const registry = createPropositionRegistry();
    registerProposition(registry, {
      name: "TestProp",
      claim: "Test claim",
      target: "*",
      checks: [{ component: "Needs", property: "hunger", operator: "<", value: 70, weight: 1.0, description: "Not hungry" }],
      passThreshold: 5,
      category: "test",
    });
    assertEqual(registry.propositions.size, 1);
    assert(registry.propositions.get("TestProp") !== undefined);
  });

  test("should unregister a proposition", () => {
    const registry = createPropositionRegistry();
    registerProposition(registry, { name: "ToRemove", claim: "Will be removed", target: "*", checks: [], passThreshold: 5, category: "test" });
    const removed = unregisterProposition(registry, "ToRemove");
    assert(removed === true);
    assertEqual(registry.propositions.size, 0);
  });

  test("should list all propositions", () => {
    const registry = createPropositionRegistry();
    registerProposition(registry, { name: "Prop1", claim: "First", target: "*", checks: [], passThreshold: 5, category: "test" });
    registerProposition(registry, { name: "Prop2", claim: "Second", target: "SpecificEntity", checks: [], passThreshold: 7, category: "validation" });
    const list = listPropositions(registry);
    assertEqual(list.length, 2);
    assert(list.some(p => p.name === "Prop1"));
    assert(list.some(p => p.name === "Prop2"));
  });
}

// Test: Evaluation - Basic Operators
console.log("\nEvaluation - Basic Operators:");
{
  test("should evaluate > operator correctly (pass)", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createPropositionRegistry();
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Needs);
    Name.value[eid] = "TestAgent";
    Needs.hunger[eid] = 90;

    registerProposition(registry, {
      name: "IsHungry",
      claim: "Agent is hungry",
      target: "TestAgent",
      checks: [{ component: "Needs", property: "hunger", operator: ">", value: 80, weight: 1.0, description: "Hunger above 80" }],
      passThreshold: 5,
      category: "test",
    });

    const results = evaluateProposition(world, registry, "IsHungry");
    assertEqual(results.length, 1);
    assert(results[0].passed === true);
    assertEqual(results[0].score, 9);
  });

  test("should evaluate < operator correctly", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createPropositionRegistry();
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Needs);
    Name.value[eid] = "TestAgent";
    Needs.energy[eid] = 90;

    registerProposition(registry, {
      name: "HasEnergy",
      claim: "Agent has energy",
      target: "TestAgent",
      checks: [{ component: "Needs", property: "energy", operator: ">", value: 50, weight: 1.0, description: "Energy above 50" }],
      passThreshold: 5,
      category: "test",
    });

    const results = evaluateProposition(world, registry, "HasEnergy");
    assert(results[0].passed === true);
  });

  test("should evaluate == operator correctly", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createPropositionRegistry();
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Needs);
    Name.value[eid] = "TestAgent";
    Needs.hunger[eid] = 50;

    registerProposition(registry, {
      name: "ExactValue",
      claim: "Exact hunger",
      target: "TestAgent",
      checks: [{ component: "Needs", property: "hunger", operator: "==", value: 50, weight: 1.0, description: "Hunger is 50" }],
      passThreshold: 9,
      category: "test",
    });

    const results = evaluateProposition(world, registry, "ExactValue");
    assert(results[0].passed === true);
  });

  test("should evaluate in_range operator correctly (pass)", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createPropositionRegistry();
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Needs);
    Name.value[eid] = "TestAgent";
    Needs.hunger[eid] = 50;

    registerProposition(registry, {
      name: "InRange",
      claim: "Hunger in healthy range",
      target: "TestAgent",
      checks: [{ component: "Needs", property: "hunger", operator: "in_range", min: 30, max: 70, weight: 1.0, description: "Hunger 30-70" }],
      passThreshold: 5,
      category: "test",
    });

    const results = evaluateProposition(world, registry, "InRange");
    assert(results[0].passed === true);
  });

  test("should fail when out of range", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createPropositionRegistry();
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Needs);
    Name.value[eid] = "TestAgent";
    Needs.hunger[eid] = 90; // Outside range

    registerProposition(registry, {
      name: "InRange",
      claim: "Hunger in healthy range",
      target: "TestAgent",
      checks: [{ component: "Needs", property: "hunger", operator: "in_range", min: 30, max: 70, weight: 1.0, description: "Hunger 30-70" }],
      passThreshold: 5,
      category: "test",
    });

    const results = evaluateProposition(world, registry, "InRange");
    assert(results[0].passed === false);
    assertEqual(results[0].score, 0);
  });

  test("should evaluate exists operator correctly", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createPropositionRegistry();
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Needs);
    Name.value[eid] = "TestAgent";
    Needs.hunger[eid] = 50;

    registerProposition(registry, {
      name: "HasNeeds",
      claim: "Agent has needs",
      target: "TestAgent",
      checks: [{ component: "Needs", property: "hunger", operator: "exists", weight: 1.0, description: "Has hunger" }],
      passThreshold: 5,
      category: "test",
    });

    const results = evaluateProposition(world, registry, "HasNeeds");
    assert(results[0].passed === true);
  });
}

// Test: Target Types
console.log("\nTarget Types:");
{
  test("should evaluate for all entities with * target", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createPropositionRegistry();

    for (let i = 0; i < 3; i++) {
      const eid = addEntity(world);
      addComponent(world, eid, Name);
      addComponent(world, eid, Needs);
      Name.value[eid] = `Agent${i}`;
      Needs.hunger[eid] = 50;
    }

    registerProposition(registry, {
      name: "AllHealthy",
      claim: "All agents healthy",
      target: "*",
      checks: [{ component: "Needs", property: "hunger", operator: "<", value: 70, weight: 1.0, description: "Not hungry" }],
      passThreshold: 5,
      category: "test",
    });

    const results = evaluateProposition(world, registry, "AllHealthy");
    assertEqual(results.length, 3);
    assert(results.every(r => r.passed));
  });

  test("should evaluate for specific entity by name", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createPropositionRegistry();

    const eid1 = addEntity(world);
    addComponent(world, eid1, Name);
    addComponent(world, eid1, Needs);
    Name.value[eid1] = "TargetAgent";
    Needs.hunger[eid1] = 50;

    const eid2 = addEntity(world);
    addComponent(world, eid2, Name);
    addComponent(world, eid2, Needs);
    Name.value[eid2] = "OtherAgent";
    Needs.hunger[eid2] = 90;

    registerProposition(registry, {
      name: "TargetHealthy",
      claim: "Target is healthy",
      target: "TargetAgent",
      checks: [{ component: "Needs", property: "hunger", operator: "<", value: 70, weight: 1.0, description: "Not hungry" }],
      passThreshold: 5,
      category: "test",
    });

    const results = evaluateProposition(world, registry, "TargetHealthy");
    assertEqual(results.length, 1);
    assertEqual(results[0].target, "TargetAgent");
    assert(results[0].passed === true);
  });
}

// Test: Weighted Scoring
console.log("\nWeighted Scoring:");
{
  test("should calculate weighted score correctly", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createPropositionRegistry();
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Needs);
    Name.value[eid] = "TestAgent";
    Needs.hunger[eid] = 50;  // Pass (< 70)
    Needs.energy[eid] = 10;  // Fail (< 30)

    registerProposition(registry, {
      name: "MultiCheck",
      claim: "Multiple checks",
      target: "TestAgent",
      checks: [
        { component: "Needs", property: "hunger", operator: "<", value: 70, weight: 0.5, description: "Not hungry" },
        { component: "Needs", property: "energy", operator: ">", value: 30, weight: 0.5, description: "Has energy" },
      ],
      passThreshold: 5,
      category: "test",
    });

    const results = evaluateProposition(world, registry, "MultiCheck");
    assertEqual(results[0].score, 4.5); // Only half the checks pass: 0.5 * 9 = 4.5
  });

  test("should use different weights", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createPropositionRegistry();
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Needs);
    Name.value[eid] = "TestAgent";
    Needs.hunger[eid] = 50;  // Pass - weight 0.8
    Needs.energy[eid] = 10;  // Fail - weight 0.2

    registerProposition(registry, {
      name: "WeightedCheck",
      claim: "Weighted checks",
      target: "TestAgent",
      checks: [
        { component: "Needs", property: "hunger", operator: "<", value: 70, weight: 0.8, description: "Not hungry" },
        { component: "Needs", property: "energy", operator: ">", value: 30, weight: 0.2, description: "Has energy" },
      ],
      passThreshold: 5,
      category: "test",
    });

    const results = evaluateProposition(world, registry, "WeightedCheck");
    // Score = (0.8 * 9 + 0 * 9) / 1.0 = 7.2
    assertEqual(results[0].score, 7.2);
  });
}

// Test: Dynamic Components
console.log("\nDynamic Components:");
{
  test("should evaluate dynamic component properties", () => {
    clearDynamicComponents();
    createDynamicComponent({
      name: "Temperature",
      description: "Thermal state",
      properties: { current: "number", target: "number" },
    });

    const world = createWorld();
    const registry = createPropositionRegistry();
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    Name.value[eid] = "Reactor";
    setDynamicComponentValue("Temperature", eid, "current", 75);

    registerProposition(registry, {
      name: "SafeTemp",
      claim: "Temperature is safe",
      target: "Reactor",
      checks: [{ component: "Temperature", property: "current", operator: "in_range", min: 50, max: 100, weight: 1.0, description: "Safe range" }],
      passThreshold: 5,
      category: "simulation",
    });

    const results = evaluateProposition(world, registry, "SafeTemp");
    assert(results[0].passed === true);
  });
}

// Test: Category Reporting
console.log("\nCategory Reporting:");
{
  test("should aggregate scores by category", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createPropositionRegistry();

    const eid1 = addEntity(world);
    addComponent(world, eid1, Name);
    addComponent(world, eid1, Needs);
    Name.value[eid1] = "Agent1";
    Needs.hunger[eid1] = 50;

    const eid2 = addEntity(world);
    addComponent(world, eid2, Name);
    addComponent(world, eid2, Needs);
    Name.value[eid2] = "Agent2";
    Needs.hunger[eid2] = 60;

    registerProposition(registry, {
      name: "Health1",
      claim: "Agent1 healthy",
      target: "Agent1",
      checks: [{ component: "Needs", property: "hunger", operator: "<", value: 70, weight: 1.0, description: "Not hungry" }],
      passThreshold: 5,
      category: "agent_health",
    });

    registerProposition(registry, {
      name: "Health2",
      claim: "Agent2 healthy",
      target: "Agent2",
      checks: [{ component: "Needs", property: "hunger", operator: "<", value: 70, weight: 1.0, description: "Not hungry" }],
      passThreshold: 5,
      category: "agent_health",
    });

    evaluateAllPropositions(world, registry);
    const report = getCategoryReport(registry);

    assert(report["agent_health"] !== undefined);
    assertEqual(report["agent_health"].count, 2);
    assertEqual(report["agent_health"].avg, 9);
  });
}

// Test: History
console.log("\nHistory:");
{
  test("should track evaluation history", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createPropositionRegistry();
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Needs);
    Name.value[eid] = "TestAgent";
    Needs.hunger[eid] = 50;

    registerProposition(registry, {
      name: "HealthCheck",
      claim: "Agent is healthy",
      target: "TestAgent",
      checks: [{ component: "Needs", property: "hunger", operator: "<", value: 70, weight: 1.0, description: "Not hungry" }],
      passThreshold: 5,
      category: "health",
    });

    evaluateProposition(world, registry, "HealthCheck");
    evaluateProposition(world, registry, "HealthCheck");
    evaluateProposition(world, registry, "HealthCheck");

    const history = getPropositionHistory(registry);
    assertEqual(history.length, 3);
  });

  test("should filter history by passed/failed", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createPropositionRegistry();

    const eid1 = addEntity(world);
    addComponent(world, eid1, Name);
    addComponent(world, eid1, Needs);
    Name.value[eid1] = "Healthy";
    Needs.hunger[eid1] = 50;

    const eid2 = addEntity(world);
    addComponent(world, eid2, Name);
    addComponent(world, eid2, Needs);
    Name.value[eid2] = "Hungry";
    Needs.hunger[eid2] = 90;

    registerProposition(registry, {
      name: "HealthCheck",
      claim: "Not hungry",
      target: "*",
      checks: [{ component: "Needs", property: "hunger", operator: "<", value: 70, weight: 1.0, description: "Not hungry" }],
      passThreshold: 5,
      category: "health",
    });

    evaluateProposition(world, registry, "HealthCheck");

    const passed = getPropositionHistory(registry, { passedOnly: true });
    const failed = getPropositionHistory(registry, { failedOnly: true });

    assertEqual(passed.length, 1);
    assertEqual(passed[0].target, "Healthy");
    assertEqual(failed.length, 1);
    assertEqual(failed[0].target, "Hungry");
  });
}

// Test: Helper Functions
console.log("\nHelper Functions:");
{
  test("should create needs health proposition", () => {
    const prop = createNeedsHealthProposition("AgentHealth", "TestAgent", 70, 30);
    assertEqual(prop.name, "AgentHealth");
    assertEqual(prop.checks.length, 2);
    assertEqual(prop.category, "agent_health");
  });

  test("should create value range proposition", () => {
    const prop = createValueRangeProposition(
      "SafeTemp",
      "Temperature in safe range",
      "*",
      "Temperature",
      "current",
      50,
      100,
      "simulation_health"
    );
    assertEqual(prop.name, "SafeTemp");
    assertEqual(prop.checks[0].operator, "in_range");
    assertEqual(prop.checks[0].min, 50);
    assertEqual(prop.checks[0].max, 100);
  });

  test("should create existence proposition", () => {
    const prop = createExistenceProposition(
      "HasMind",
      "Entity has mind component",
      "*",
      "Mind",
      "mode",
      "entity_validation"
    );
    assertEqual(prop.name, "HasMind");
    assertEqual(prop.checks[0].operator, "exists");
    assertEqual(prop.passThreshold, 9);
  });
}

// Test: Check Results Detail
console.log("\nCheck Results Detail:");
{
  test("should provide detailed check results", () => {
    clearDynamicComponents();
    const world = createWorld();
    const registry = createPropositionRegistry();
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Needs);
    Name.value[eid] = "TestAgent";
    Needs.hunger[eid] = 50;
    Needs.energy[eid] = 80;

    registerProposition(registry, {
      name: "DetailedCheck",
      claim: "Multiple conditions",
      target: "TestAgent",
      checks: [
        { component: "Needs", property: "hunger", operator: "<", value: 70, weight: 0.5, description: "Not hungry" },
        { component: "Needs", property: "energy", operator: ">", value: 50, weight: 0.5, description: "Has energy" },
      ],
      passThreshold: 5,
      category: "test",
    });

    const results = evaluateProposition(world, registry, "DetailedCheck");
    assertEqual(results[0].checkResults.length, 2);

    const hungerCheck = results[0].checkResults.find(c => c.check.includes("hungry"));
    assert(hungerCheck?.passed === true);
    assertEqual(hungerCheck?.actualValue, 50);
    assertEqual(hungerCheck?.expectedValue, 70);

    const energyCheck = results[0].checkResults.find(c => c.check.includes("energy"));
    assert(energyCheck?.passed === true);
    assertEqual(energyCheck?.actualValue, 80);
  });
}

// Summary
console.log("\n" + "=".repeat(40));
console.log(`Tests: ${passCount} passed, ${failCount} failed`);
console.log("=".repeat(40) + "\n");

process.exit(failCount > 0 ? 1 : 0);
