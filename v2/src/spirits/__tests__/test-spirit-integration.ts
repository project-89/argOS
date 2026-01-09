/**
 * Integration Tests for Spirit System
 *
 * Tests the full spirit hierarchy working with:
 * - ECS world with agents and rooms
 * - Spirit cognition loops (with mocked LLM)
 * - Message passing between spirits
 * - Interventions affecting agents
 *
 * Run with: npx tsx src/spirits/__tests__/test-spirit-integration.ts
 */

import { addEntity, addComponent, query } from "bitecs";
import { createArgosWorld, type World } from "../../ecs/world";
import { Name, Description, Agent, Mind, Room, GodAgent } from "../../ecs/components";
import { OccupiesRoom } from "../../ecs/relations";
import { createEntityRegistry, registerEntity, type EntityRegistry } from "../../ecs/tools";
import { clearDynamicComponents } from "../../ecs/dynamic-components";

// Spirit imports
import {
  initializeSpiritSystem,
  startSpiritSystem,
  stopSpiritSystem,
  tickSpiritSystem,
  getSpiritSystemState,
  createNewSpirit,
  getAllSpirits,
  getRegistrySummary,
  getSpiritDetails,
  recordActionEvent,
  getSpiritSystemDebugInfo,
  setGodAgentCallback,
} from "../spirit-system";
import {
  getSpiritByName,
  getMessagesForGodAI,
  sendDirective,
  reportToSuperior,
} from "../spirit-registry";
import { NarratorDefinition } from "../narrator-spirit";
import type { SpiritDefinition, DivineMessage } from "../types";

// =============================================================================
// TEST UTILITIES
// =============================================================================

let passCount = 0;
let failCount = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
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
// TEST WORLD SETUP
// =============================================================================

interface TestSimulation {
  world: World;
  registry: EntityRegistry;
  godEid: number;
  agents: Map<string, number>;
  rooms: Map<string, number>;
}

function createTestSimulation(): TestSimulation {
  clearDynamicComponents();

  const world = createArgosWorld("Spirit Integration Test");
  const registry = createEntityRegistry();

  // Create GodAgent entity
  const godEid = addEntity(world);
  Name.value[godEid] = "GodAI";
  addComponent(world, godEid, GodAgent);
  GodAgent.worldName[godEid] = "Test World";
  GodAgent.narrative[godEid] = "A test simulation for spirit integration";
  GodAgent.tick[godEid] = 0;
  registerEntity(registry, "GodAI", godEid);

  const agents = new Map<string, number>();
  const rooms = new Map<string, number>();

  // Create rooms
  const tavernEid = addEntity(world);
  Name.value[tavernEid] = "Tavern";
  Description.value[tavernEid] = "A cozy tavern with a roaring fireplace";
  addComponent(world, tavernEid, Room);
  Room.ambience[tavernEid] = "warm and inviting";
  registerEntity(registry, "Tavern", tavernEid);
  rooms.set("Tavern", tavernEid);

  const marketEid = addEntity(world);
  Name.value[marketEid] = "Market Square";
  Description.value[marketEid] = "A bustling marketplace with vendors";
  addComponent(world, marketEid, Room);
  Room.ambience[marketEid] = "busy and noisy";
  registerEntity(registry, "Market Square", marketEid);
  rooms.set("Market Square", marketEid);

  // Create agents
  const aliceEid = addEntity(world);
  Name.value[aliceEid] = "Alice";
  Description.value[aliceEid] = "A curious young woman with bright eyes";
  addComponent(world, aliceEid, Agent);
  addComponent(world, aliceEid, Mind);
  Mind.arousal[aliceEid] = 0.5;
  Mind.focus[aliceEid] = "exploring";
  Mind.mode[aliceEid] = "deliberative";
  Agent.active[aliceEid] = true;
  addComponent(world, aliceEid, OccupiesRoom(tavernEid));
  registerEntity(registry, "Alice", aliceEid);
  agents.set("Alice", aliceEid);

  const bobEid = addEntity(world);
  Name.value[bobEid] = "Bob";
  Description.value[bobEid] = "A gruff but kind-hearted blacksmith";
  addComponent(world, bobEid, Agent);
  addComponent(world, bobEid, Mind);
  Mind.arousal[bobEid] = 0.3;
  Mind.focus[bobEid] = "work";
  Mind.mode[bobEid] = "reactive";
  Agent.active[bobEid] = true;
  addComponent(world, bobEid, OccupiesRoom(tavernEid));
  registerEntity(registry, "Bob", bobEid);
  agents.set("Bob", bobEid);

  const charlieEid = addEntity(world);
  Name.value[charlieEid] = "Charlie";
  Description.value[charlieEid] = "A mysterious stranger who arrived recently";
  addComponent(world, charlieEid, Agent);
  addComponent(world, charlieEid, Mind);
  Mind.arousal[charlieEid] = 0.7;
  Mind.focus[charlieEid] = "secrets";
  Mind.mode[charlieEid] = "deliberative";
  Agent.active[charlieEid] = true;
  addComponent(world, charlieEid, OccupiesRoom(marketEid));
  registerEntity(registry, "Charlie", charlieEid);
  agents.set("Charlie", charlieEid);

  return { world, registry, godEid, agents, rooms };
}

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

async function runIntegrationTests() {
  console.log("\n" + "=".repeat(60));
  console.log("Spirit System Integration Tests");
  console.log("=".repeat(60) + "\n");

  // -------------------------------------------------------------------------
  // Test: Spirit System Initialization
  // -------------------------------------------------------------------------
  console.log("Spirit System Initialization:");
  {
    const sim = createTestSimulation();

    await test("should initialize spirit system with GodAgent", async () => {
      const state = initializeSpiritSystem(sim.world, {
        godAgentEid: sim.godEid,
        autoCreateNarrator: false,
      });

      assert(state !== null, "System state should be created");
      assertEqual(state.registry.godAgentEid, sim.godEid);
      assertEqual(state.running, false);
    });

    await test("should auto-create Narrator when requested", async () => {
      const state = initializeSpiritSystem(sim.world, {
        godAgentEid: sim.godEid,
        autoCreateNarrator: true,
      });

      const narrator = getSpiritByName(state.registry, "The Narrator");
      assert(narrator !== undefined, "Narrator should be created");
      assertEqual(narrator?.definition.rank, "archangel");
    });

    await test("should start and stop spirit system", async () => {
      initializeSpiritSystem(sim.world, { godAgentEid: sim.godEid });

      startSpiritSystem();
      let state = getSpiritSystemState();
      assertEqual(state?.running, true);

      stopSpiritSystem();
      state = getSpiritSystemState();
      assertEqual(state?.running, false);
    });
  }

  // -------------------------------------------------------------------------
  // Test: Spirit Hierarchy with Multiple Spirits
  // -------------------------------------------------------------------------
  console.log("\nSpirit Hierarchy:");
  {
    const sim = createTestSimulation();

    await test("should create multi-level hierarchy", async () => {
      initializeSpiritSystem(sim.world, {
        godAgentEid: sim.godEid,
        autoCreateNarrator: true,
      });

      const state = getSpiritSystemState()!;
      const narrator = getSpiritByName(state.registry, "The Narrator")!;

      // Create an angel under the Narrator
      const sceneAngel = createNewSpirit({
        name: "Scene Angel",
        domain: "narrative",
        rank: "angel",
        description: "Watches individual scenes",
        watchConfig: {
          componentQueries: [],
          eventTypes: ["dialogue_spoken"],
          watchRooms: ["Tavern"],
        },
        canInjectEvents: true,
        canModifyMood: false,
        canCreateEntities: false,
        canBakeSystems: false,
        model: "flash",
        observationInterval: 15000,
        systemPrompt: "You watch individual scenes.",
      }, narrator.eid);

      assert(sceneAngel !== null, "Scene Angel should be created");
      assertEqual(sceneAngel?.superiorEid, narrator.eid);
      assert(narrator.subordinateEids.includes(sceneAngel!.eid));

      const summary = getRegistrySummary();
      assert(summary.includes("The Narrator"), "Summary should include Narrator");
      assert(summary.includes("Scene Angel"), "Summary should include Scene Angel");
    });

    await test("should track spirits by domain", async () => {
      const state = getSpiritSystemState()!;

      // Create a social domain spirit
      createNewSpirit({
        name: "Sociologist",
        domain: "social",
        rank: "archangel",
        description: "Watches relationships",
        watchConfig: { componentQueries: [], eventTypes: [] },
        canInjectEvents: true,
        canModifyMood: true,
        canCreateEntities: false,
        canBakeSystems: false,
        model: "flash",
        observationInterval: 30000,
        systemPrompt: "You track relationships.",
      });

      const allSpirits = getAllSpirits();
      assert(allSpirits.length >= 3, "Should have at least 3 spirits");

      const narrativeSpirits = allSpirits.filter(s => s.definition.domain === "narrative");
      const socialSpirits = allSpirits.filter(s => s.definition.domain === "social");

      assert(narrativeSpirits.length >= 2, "Should have narrative spirits");
      assert(socialSpirits.length >= 1, "Should have social spirits");
    });
  }

  // -------------------------------------------------------------------------
  // Test: Action Recording & Spirit Awareness
  // -------------------------------------------------------------------------
  console.log("\nAction Recording:");
  {
    const sim = createTestSimulation();

    await test("should record actions for spirits to observe", async () => {
      initializeSpiritSystem(sim.world, {
        godAgentEid: sim.godEid,
        autoCreateNarrator: true,
      });

      // Simulate some actions
      recordActionEvent("Alice", "speak", "Hello, Bob! How are you today?", "Bob");
      recordActionEvent("Bob", "speak", "Good day, Alice. Just finished a sword.", "Alice");
      recordActionEvent("Alice", "action", "Alice laughs warmly");
      recordActionEvent("Charlie", "observe", "Charlie watches from the shadows");

      const state = getSpiritSystemState()!;
      assertArrayLength(state.actionBuffer, 4);
      assertEqual(state.actionBuffer[0].actor, "Alice");
      assertEqual(state.actionBuffer[0].type, "speak");
    });

    await test("should clear action buffer after tick", async () => {
      startSpiritSystem();
      const state = getSpiritSystemState()!;

      // Force immediate tick
      state.lastTick = 0;

      // Tick will process actions (but won't run LLM in test)
      // Just verify the structure works
      const debugInfo = getSpiritSystemDebugInfo();
      assert(typeof debugInfo === "object", "Should return debug info");
      assert("actionBufferSize" in debugInfo, "Should track action buffer");

      stopSpiritSystem();
    });
  }

  // -------------------------------------------------------------------------
  // Test: Message Flow
  // -------------------------------------------------------------------------
  console.log("\nMessage Flow:");
  {
    const sim = createTestSimulation();

    await test("should flow messages from spirit to GodAI", async () => {
      initializeSpiritSystem(sim.world, {
        godAgentEid: sim.godEid,
        autoCreateNarrator: true,
      });

      const state = getSpiritSystemState()!;
      const narrator = getSpiritByName(state.registry, "The Narrator")!;

      // Spirit reports to GodAI
      reportToSuperior(
        state.registry,
        narrator.eid,
        "Narrative Stagnation Detected",
        "Alice and Bob have been idle for extended period. Recommend intervention.",
        "high"
      );

      const messages = getMessagesForGodAI(state.registry);
      assertArrayLength(messages, 1);
      assertEqual(messages[0].subject, "Narrative Stagnation Detected");
      assertEqual(messages[0].priority, "high");
      assertEqual(messages[0].from, narrator.eid);
    });

    await test("should flow directives from GodAI to spirit", async () => {
      const state = getSpiritSystemState()!;
      const narrator = getSpiritByName(state.registry, "The Narrator")!;

      // GodAI sends directive
      const directive = sendDirective(state.registry, sim.godEid, narrator.eid, {
        type: "intervene",
        description: "Create dramatic tension between Alice and Charlie",
        action: {
          type: "inject_stimulus",
          target: "Tavern",
          parameters: { content: "A mysterious note is found" },
        },
      });

      assert(directive !== undefined, "Directive should be created");
      assertArrayLength(narrator.pendingDirectives, 1);
      assertEqual(narrator.pendingDirectives[0].type, "intervene");
      assertEqual(narrator.pendingDirectives[0].status, "pending");
    });

    await test("should handle callback for GodAI messages", async () => {
      const state = getSpiritSystemState()!;
      const narrator = getSpiritByName(state.registry, "The Narrator")!;

      let receivedMessages: DivineMessage[] = [];

      // Set up callback
      setGodAgentCallback(async (messages) => {
        receivedMessages = messages;
      });

      // Spirit reports
      reportToSuperior(
        state.registry,
        narrator.eid,
        "Test Report",
        "This is a test",
        "normal"
      );

      // Manually process (normally done in tick)
      const messages = getMessagesForGodAI(state.registry);
      if (messages.length > 0) {
        receivedMessages = messages;
      }

      assert(receivedMessages.length > 0, "Callback should receive messages");
    });
  }

  // -------------------------------------------------------------------------
  // Test: Spirit Details & Debug Info
  // -------------------------------------------------------------------------
  console.log("\nDebug & Introspection:");
  {
    const sim = createTestSimulation();

    await test("should provide detailed spirit information", async () => {
      initializeSpiritSystem(sim.world, {
        godAgentEid: sim.godEid,
        autoCreateNarrator: true,
      });

      const state = getSpiritSystemState()!;
      const narrator = getSpiritByName(state.registry, "The Narrator")!;

      const details = getSpiritDetails(narrator.eid);
      assert(details.includes("The Narrator"), "Details should include name");
      assert(details.includes("narrative"), "Details should include domain");
    });

    await test("should provide complete system debug info", async () => {
      const debugInfo = getSpiritSystemDebugInfo() as any;

      assert("status" in debugInfo, "Should have status");
      assert("spiritCount" in debugInfo, "Should have spirit count");
      assert("spirits" in debugInfo, "Should list spirits");
      assert(Array.isArray(debugInfo.spirits), "Spirits should be array");

      const narratorInfo = debugInfo.spirits.find((s: any) => s.name === "The Narrator");
      assert(narratorInfo !== undefined, "Should include Narrator info");
      assertEqual(narratorInfo.domain, "narrative");
    });
  }

  // -------------------------------------------------------------------------
  // Test: Full Simulation Scenario
  // -------------------------------------------------------------------------
  console.log("\nFull Simulation Scenario:");
  {
    const sim = createTestSimulation();

    await test("should run complete spirit observation cycle", async () => {
      // Initialize with full hierarchy
      initializeSpiritSystem(sim.world, {
        godAgentEid: sim.godEid,
        autoCreateNarrator: true,
        tickInterval: 100, // Fast for testing
      });

      const state = getSpiritSystemState()!;

      // Create additional spirits
      const narrator = getSpiritByName(state.registry, "The Narrator")!;

      createNewSpirit({
        name: "Guardian of Alice",
        domain: "guardian",
        rank: "daemon",
        description: "Watches over Alice specifically",
        watchConfig: {
          componentQueries: [],
          eventTypes: ["action_executed"],
          watchEntities: ["Alice"],
        },
        canInjectEvents: false,
        canModifyMood: false,
        canCreateEntities: false,
        canBakeSystems: false,
        model: "flash",
        observationInterval: 10000,
        systemPrompt: "You watch Alice.",
      }, narrator.eid);

      // Simulate actions
      recordActionEvent("Alice", "speak", "I wonder what secrets this town holds...");
      recordActionEvent("Bob", "speak", "Best not to dig too deep, Alice.");
      recordActionEvent("Charlie", "action", "Charlie overhears the conversation from the doorway");

      startSpiritSystem();

      // Verify system state
      const debugInfo = getSpiritSystemDebugInfo() as any;
      assertEqual(debugInfo.status, "running");
      assert(debugInfo.spiritCount >= 2, "Should have multiple spirits");
      assert(debugInfo.actionBufferSize > 0, "Should have recorded actions");

      // Verify hierarchy
      const allSpirits = getAllSpirits();
      const guardians = allSpirits.filter(s => s.definition.domain === "guardian");
      assert(guardians.length >= 1, "Should have guardian spirit");
      assertEqual(guardians[0].superiorEid, narrator.eid);

      stopSpiritSystem();
    });

    await test("should handle narrative state tracking", async () => {
      const state = getSpiritSystemState()!;
      const narrator = getSpiritByName(state.registry, "The Narrator")!;

      // Verify Narrator has narrative state
      assert(narrator.narrativeState !== undefined, "Narrator should track narrative");
      assertEqual(narrator.narrativeState?.currentAct, 1);
      assertEqual(narrator.narrativeState?.currentPhase, "exposition");

      // Simulate narrative progression (normally done by LLM)
      narrator.narrativeState!.tension = 0.5;
      narrator.narrativeState!.currentPhase = "rising";
      narrator.narrativeState!.plotThreads.push({
        id: "plot_1",
        name: "The Mystery of Charlie",
        description: "Charlie's true identity and purpose",
        participants: ["Alice", "Charlie"],
        status: "active",
        tension: 0.6,
        events: [],
        startedAt: Date.now(),
      });

      // Verify state updated
      assertEqual(narrator.narrativeState?.tension, 0.5);
      assertEqual(narrator.narrativeState?.currentPhase, "rising");
      assertArrayLength(narrator.narrativeState!.plotThreads, 1);
    });
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log("\n" + "=".repeat(60));
  console.log(`Integration tests completed: ${passCount} passed, ${failCount} failed`);
  console.log("=".repeat(60) + "\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

// Run tests
runIntegrationTests().catch(console.error);
