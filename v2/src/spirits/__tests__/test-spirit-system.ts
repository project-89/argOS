/**
 * Unit tests for the Spirit System
 * Run with: npx tsx src/spirits/__tests__/test-spirit-system.ts
 */

import { createWorld, addEntity, addComponent } from "bitecs";
import { createArgosWorld, type World } from "../../ecs/world";
import { Name, Description, Agent, Mind, Room } from "../../ecs/components";
import { createEntityRegistry, registerEntity, type EntityRegistry } from "../../ecs/tools";
import { clearDynamicComponents } from "../../ecs/dynamic-components";

// Spirit system imports
import {
  createSpiritRegistry,
  createSpirit,
  setGodAgent,
  getSpirit,
  getSpiritByName,
  getSpiritsInDomain,
  getActiveSpirits,
  sendMessage,
  reportToSuperior,
  sendDirective,
  getMessagesForGodAI,
  printHierarchy,
  activateSpirit,
  deactivateSpirit,
  type SpiritRegistry,
} from "../spirit-registry";
import { NarratorDefinition } from "../narrator-spirit";
import {
  calculateNarrativeUrgency,
  identifyPotentialPlotThreads,
  detectStagnation,
  assessNarrativePhase,
} from "../narrator-spirit";
import { collectEcsSnapshot } from "../spirit-cognition";
import type { SpiritDefinition, Observation } from "../types";

// =============================================================================
// TEST UTILITIES
// =============================================================================

let passCount = 0;
let failCount = 0;

function test(name: string, fn: () => void | Promise<void>) {
  const result = fn();
  if (result instanceof Promise) {
    return result
      .then(() => {
        console.log(`  ✓ ${name}`);
        passCount++;
      })
      .catch((error) => {
        console.log(`  ✗ ${name}`);
        console.log(`    ${error}`);
        failCount++;
      });
  } else {
    try {
      console.log(`  ✓ ${name}`);
      passCount++;
    } catch (error) {
      console.log(`  ✗ ${name}`);
      console.log(`    ${error}`);
      failCount++;
    }
  }
}

function assert(condition: boolean, message?: string) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(`${message || "Assertion failed"}: expected ${expected}, got ${actual}`);
  }
}

function assertArrayLength(arr: any[], expected: number, message?: string) {
  if (arr.length !== expected) {
    throw new Error(`${message || "Array length mismatch"}: expected ${expected}, got ${arr.length}`);
  }
}

// =============================================================================
// TEST FIXTURES
// =============================================================================

function createTestWorld(): { world: World; registry: EntityRegistry } {
  clearDynamicComponents();
  const world = createArgosWorld("Test World");
  const registry = createEntityRegistry();
  return { world, registry };
}

function createTestAgent(world: World, registry: EntityRegistry, name: string, roomEid?: number): number {
  const eid = addEntity(world);
  Name.value[eid] = name;
  Description.value[eid] = `Test agent: ${name}`;
  addComponent(world, eid, Agent);
  addComponent(world, eid, Mind);
  Mind.arousal[eid] = 0.5;
  Mind.focus[eid] = "";
  Mind.mode[eid] = "reactive";
  Agent.active[eid] = true;
  registerEntity(registry, name, eid);
  return eid;
}

function createTestRoom(world: World, registry: EntityRegistry, name: string): number {
  const eid = addEntity(world);
  Name.value[eid] = name;
  Description.value[eid] = `Test room: ${name}`;
  addComponent(world, eid, Room);
  Room.ambience[eid] = "neutral";
  registerEntity(registry, name, eid);
  return eid;
}

const testSpiritDefinition: SpiritDefinition = {
  name: "Test Spirit",
  domain: "narrative",
  rank: "angel",
  description: "A test spirit for unit testing",
  watchConfig: {
    componentQueries: [],
    eventTypes: ["action_executed"],
  },
  canInjectEvents: true,
  canModifyMood: false,
  canCreateEntities: false,
  canBakeSystems: false,
  model: "flash",
  observationInterval: 10000,
  systemPrompt: "You are a test spirit.",
};

// =============================================================================
// TESTS: SPIRIT REGISTRY
// =============================================================================

console.log("\n=== Spirit Registry Tests ===\n");

console.log("Registry Creation:");
{
  const { world } = createTestWorld();

  test("should create an empty registry", () => {
    const registry = createSpiritRegistry(world);
    assertEqual(registry.spirits.size, 0);
    assertEqual(registry.byName.size, 0);
    assertEqual(registry.byDomain.size, 0);
    assertArrayLength(registry.messageQueue, 0);
  });

  test("should register GodAgent", () => {
    const registry = createSpiritRegistry(world);
    const godEid = addEntity(world);
    setGodAgent(registry, godEid);
    assertEqual(registry.godAgentEid, godEid);
  });
}

console.log("\nSpirit Creation:");
{
  const { world } = createTestWorld();

  test("should create a spirit", () => {
    const registry = createSpiritRegistry(world);
    const spirit = createSpirit(registry, testSpiritDefinition);

    assert(spirit !== undefined, "Spirit should be created");
    assertEqual(spirit.definition.name, "Test Spirit");
    assertEqual(spirit.definition.domain, "narrative");
    assertEqual(spirit.definition.rank, "angel");
  });

  test("should register spirit by name", () => {
    const registry = createSpiritRegistry(world);
    const spirit = createSpirit(registry, testSpiritDefinition);

    const found = getSpiritByName(registry, "Test Spirit");
    assert(found !== undefined, "Spirit should be found by name");
    assertEqual(found?.eid, spirit.eid);
  });

  test("should register spirit by domain", () => {
    const registry = createSpiritRegistry(world);
    createSpirit(registry, testSpiritDefinition);

    const spiritsInDomain = getSpiritsInDomain(registry, "narrative");
    assertArrayLength(spiritsInDomain, 1);
    assertEqual(spiritsInDomain[0].definition.name, "Test Spirit");
  });

  test("should create Narrator with NarrativeState", () => {
    const registry = createSpiritRegistry(world);
    const narrator = createSpirit(registry, NarratorDefinition);

    assert(narrator.narrativeState !== undefined, "Narrator should have narrativeState");
    assertEqual(narrator.narrativeState?.currentAct, 1);
    assertEqual(narrator.narrativeState?.currentPhase, "exposition");
    assertEqual(narrator.narrativeState?.tension, 0.2);
  });

  test("should establish hierarchy with superior", () => {
    const registry = createSpiritRegistry(world);
    const godEid = addEntity(world);
    setGodAgent(registry, godEid);

    const archangel = createSpirit(registry, NarratorDefinition);
    const angel = createSpirit(registry, {
      ...testSpiritDefinition,
      name: "Test Angel",
      rank: "angel",
    }, archangel.eid);

    assertEqual(angel.superiorEid, archangel.eid);
    assert(archangel.subordinateEids.includes(angel.eid), "Archangel should have angel as subordinate");
  });
}

// =============================================================================
// TESTS: MESSAGE ROUTING
// =============================================================================

console.log("\nMessage Routing:");
{
  const { world } = createTestWorld();

  test("should send message between spirits", () => {
    const registry = createSpiritRegistry(world);
    const spirit1 = createSpirit(registry, { ...testSpiritDefinition, name: "Spirit1" });
    const spirit2 = createSpirit(registry, { ...testSpiritDefinition, name: "Spirit2" });

    const msg = sendMessage(registry, spirit1.eid, spirit2.eid, "report", "Test Subject", "Test content");

    assert(msg !== undefined, "Message should be created");
    assertEqual(msg.from, spirit1.eid);
    assertEqual(msg.to, spirit2.eid);
    assertEqual(msg.type, "report");
    assertEqual(msg.subject, "Test Subject");
    assertArrayLength(spirit2.inbox, 1);
    assertEqual(spirit2.inbox[0].content, "Test content");
  });

  test("should report to superior", () => {
    const registry = createSpiritRegistry(world);
    const godEid = addEntity(world);
    setGodAgent(registry, godEid);

    const spirit = createSpirit(registry, testSpiritDefinition);
    reportToSuperior(registry, spirit.eid, "Alert", "Something happened", "high");

    const messages = getMessagesForGodAI(registry);
    assertArrayLength(messages, 1);
    assertEqual(messages[0].subject, "Alert");
    assertEqual(messages[0].priority, "high");
  });

  test("should send directive to subordinate", () => {
    const registry = createSpiritRegistry(world);
    const archangel = createSpirit(registry, NarratorDefinition);
    const angel = createSpirit(registry, {
      ...testSpiritDefinition,
      name: "Test Angel",
    }, archangel.eid);

    const directive = sendDirective(registry, archangel.eid, angel.eid, {
      type: "observe",
      description: "Watch the tavern",
      action: { type: "custom", parameters: {} },
    });

    assert(directive !== undefined, "Directive should be created");
    assertEqual(directive.status, "pending");
    assertArrayLength(angel.pendingDirectives, 1);
    assertEqual(angel.pendingDirectives[0].description, "Watch the tavern");
  });

  test("should clear messages after retrieval", () => {
    const registry = createSpiritRegistry(world);
    const godEid = addEntity(world);
    setGodAgent(registry, godEid);

    const spirit = createSpirit(registry, testSpiritDefinition);
    reportToSuperior(registry, spirit.eid, "Test", "Content");

    const messages1 = getMessagesForGodAI(registry);
    assertArrayLength(messages1, 1);

    const messages2 = getMessagesForGodAI(registry);
    assertArrayLength(messages2, 0, "Queue should be empty after retrieval");
  });
}

// =============================================================================
// TESTS: SPIRIT LIFECYCLE
// =============================================================================

console.log("\nSpirit Lifecycle:");
{
  const { world } = createTestWorld();

  test("should activate and deactivate spirit", () => {
    const registry = createSpiritRegistry(world);
    const spirit = createSpirit(registry, testSpiritDefinition);

    let activeSpirits = getActiveSpirits(registry);
    assertArrayLength(activeSpirits, 1);

    deactivateSpirit(registry, spirit.eid);
    activeSpirits = getActiveSpirits(registry);
    assertArrayLength(activeSpirits, 0);

    activateSpirit(registry, spirit.eid);
    activeSpirits = getActiveSpirits(registry);
    assertArrayLength(activeSpirits, 1);
  });

  test("should print hierarchy", () => {
    const registry = createSpiritRegistry(world);
    const godEid = addEntity(world);
    setGodAgent(registry, godEid);

    createSpirit(registry, NarratorDefinition);
    createSpirit(registry, { ...testSpiritDefinition, name: "Social Angel", domain: "social" });

    const hierarchy = printHierarchy(registry);
    assert(hierarchy.includes("GodAI"), "Hierarchy should include GodAI");
    assert(hierarchy.includes("The Narrator"), "Hierarchy should include Narrator");
  });
}

// =============================================================================
// TESTS: NARRATOR HELPERS
// =============================================================================

console.log("\n=== Narrator Helper Tests ===\n");

console.log("Narrative Urgency:");
{
  test("should return 0.5 for empty observations", () => {
    const urgency = calculateNarrativeUrgency([]);
    assertEqual(urgency, 0.5);
  });

  test("should increase urgency for conflict", () => {
    const observations = [
      { type: "conflict", significance: 0.5 },
      { type: "action", significance: 0.3 },
    ];
    const urgency = calculateNarrativeUrgency(observations);
    assert(urgency > 0.5, "Urgency should increase with conflict");
  });

  test("should increase urgency for stagnation", () => {
    const observations = [
      { type: "stagnation", significance: 0.2 },
    ];
    const urgency = calculateNarrativeUrgency(observations);
    assert(urgency >= 0.5, "Urgency should increase with stagnation");
  });
}

console.log("\nPlot Thread Detection:");
{
  test("should identify plot threads from repeated interactions", () => {
    const observations = [
      { type: "dialogue", content: "Hello", entities: ["Alice", "Bob"] },
      { type: "dialogue", content: "Hi", entities: ["Alice", "Bob"] },
      { type: "dialogue", content: "How are you?", entities: ["Alice", "Bob"] },
      { type: "action", content: "walked", entities: ["Charlie"] },
    ];

    const threads = identifyPotentialPlotThreads(observations);
    assertArrayLength(threads, 1, "Should find one thread from Alice-Bob interactions");
    assert(threads[0].participants.includes("Alice"));
    assert(threads[0].participants.includes("Bob"));
  });

  test("should identify conflict threads", () => {
    const observations = [
      { type: "conflict", content: "argument", entities: ["Alice", "Bob"] },
      { type: "conflict", content: "fight", entities: ["Alice", "Bob"] },
      { type: "conflict", content: "dispute", entities: ["Alice", "Bob"] },
    ];

    const threads = identifyPotentialPlotThreads(observations);
    assert(threads[0].name.includes("Conflict"), "Thread should be labeled as conflict");
  });
}

console.log("\nStagnation Detection:");
{
  test("should detect stagnation with no observations", () => {
    const result = detectStagnation([]);
    assertEqual(result.stagnating, true);
    assert(result.suggestion.length > 0, "Should provide suggestion");
  });

  test("should not detect stagnation with recent significant events", () => {
    const now = Date.now();
    const observations = [
      { type: "action", timestamp: now - 1000 },
      { type: "dialogue", timestamp: now - 2000 },
    ];

    const result = detectStagnation(observations, 60000);
    assertEqual(result.stagnating, false);
  });

  test("should detect stagnation after threshold", () => {
    const now = Date.now();
    const observations = [
      { type: "action", timestamp: now - 120000 }, // 2 minutes ago
    ];

    const result = detectStagnation(observations, 60000);
    assertEqual(result.stagnating, true);
    assert(result.duration > 60000);
  });
}

console.log("\nNarrative Phase Assessment:");
{
  test("should return exposition for few events", () => {
    const phase = assessNarrativePhase([], 0.2, 5);
    assertEqual(phase, "exposition");
  });

  test("should detect rising phase", () => {
    const threads = [{ status: "active", tension: 0.6 }];
    const phase = assessNarrativePhase(threads, 0.65, 20);
    assertEqual(phase, "rising");
  });

  test("should detect crisis phase", () => {
    const threads = [{ status: "active", tension: 0.9 }];
    const phase = assessNarrativePhase(threads, 0.85, 30);
    assertEqual(phase, "crisis");
  });

  test("should detect climax phase", () => {
    const threads = [{ status: "climax", tension: 0.9 }];
    const phase = assessNarrativePhase(threads, 0.9, 40);
    assertEqual(phase, "climax");
  });
}

// =============================================================================
// TESTS: ECS SNAPSHOT
// =============================================================================

console.log("\n=== ECS Snapshot Tests ===\n");

console.log("Snapshot Collection:");
{
  const { world, registry } = createTestWorld();

  test("should collect empty snapshot", () => {
    const snapshot = collectEcsSnapshot(world, registry);

    assert(snapshot.tick > 0, "Tick should be set");
    assertArrayLength(snapshot.agents, 0);
    assertArrayLength(snapshot.rooms, 0);
    assertArrayLength(snapshot.recentActions, 0);
  });

  test("should collect agents", () => {
    createTestAgent(world, registry, "Alice");
    createTestAgent(world, registry, "Bob");

    const snapshot = collectEcsSnapshot(world, registry);
    assertArrayLength(snapshot.agents, 2);

    const alice = snapshot.agents.find(a => a.name === "Alice");
    assert(alice !== undefined, "Should find Alice");
    assertEqual(alice?.mood, "calm"); // default arousal 0.5 = calm
  });

  test("should collect rooms", () => {
    createTestRoom(world, registry, "Tavern");
    createTestRoom(world, registry, "Market");

    const snapshot = collectEcsSnapshot(world, registry);
    assertArrayLength(snapshot.rooms, 2);

    const tavern = snapshot.rooms.find(r => r.name === "Tavern");
    assert(tavern !== undefined, "Should find Tavern");
  });

  test("should include recent actions", () => {
    const actions = [
      { timestamp: Date.now(), actor: "Alice", type: "speak", content: "Hello" },
    ];

    const snapshot = collectEcsSnapshot(world, registry, actions);
    assertArrayLength(snapshot.recentActions, 1);
    assertEqual(snapshot.recentActions[0].actor, "Alice");
  });
}

// =============================================================================
// SUMMARY
// =============================================================================

console.log("\n" + "=".repeat(50));
console.log(`Tests completed: ${passCount} passed, ${failCount} failed`);
console.log("=".repeat(50) + "\n");

if (failCount > 0) {
  process.exit(1);
}
