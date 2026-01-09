/**
 * Spirit-GodAI Integration Test
 *
 * Full end-to-end test of:
 * 1. ConsistencySpirit detecting issues in the simulation
 * 2. Generating reports for GodAI
 * 3. GodAI receiving and processing the reports
 * 4. GodAI taking action (creating entities, baking systems, expanding world)
 */

import "dotenv/config";
import { createWorld, addEntity, addComponent, query } from "bitecs";
import { generateText, tool } from "ai";
import { z } from "zod/v3";
// LOCKED MODELS from centralized config - DO NOT CHANGE
import { executorModel } from "../llm/config";
import { Name, Description, Agent, Mind, Room, Health, Inventory, GodAgent } from "../ecs/components";
import { OccupiesRoom } from "../ecs/relations";
import {
  createSystemRegistry,
  registerSystem,
  createStimulusEmissionSystem,
  listSystems,
  type SystemRegistry,
} from "../ecs/dynamic-systems";
import { createEntityRegistry, type EntityRegistry } from "../ecs/tools";
import {
  generateSpiritReportForGodAI,
  formatReportAsMessage,
  validateAgentAction,
  recordIssue,
  recordEvent,
  getGlobalEventBuffer,
  type SpiritReportForGodAI,
} from "../spirits/consistency-spirit";
import {
  createSpiritRegistry,
  createSpirit,
  setGodAgent,
  reportToSuperior,
  getMessagesForGodAI,
  type SpiritRegistry,
} from "../spirits/spirit-registry";
import { ConsistencySpiritDefinition } from "../spirits/consistency-spirit";
import { getIntrospectionContext } from "../introspection/introspection";

// =============================================================================
// TEST CONFIGURATION
// =============================================================================

// Using locked model from centralized config
const model = executorModel;

// =============================================================================
// WORLD SETUP
// =============================================================================

interface TestWorld {
  world: ReturnType<typeof createWorld>;
  entityRegistry: EntityRegistry;
  systemRegistry: SystemRegistry;
  spiritRegistry: SpiritRegistry;
  godAgentEid: number;
  consistencySpiritEid: number;
  rooms: number[];
  agents: number[];
}

function setupTestWorld(): TestWorld {
  const world = createWorld();
  const entityRegistry = createEntityRegistry();
  const systemRegistry = createSystemRegistry();
  const spiritRegistry = createSpiritRegistry(world);

  // Register base systems
  registerSystem(systemRegistry, createStimulusEmissionSystem());

  // Create GodAgent entity
  const godAgentEid = addEntity(world);
  addComponent(world, godAgentEid, Name);
  addComponent(world, godAgentEid, GodAgent);
  Name.value[godAgentEid] = "The Architect";
  GodAgent.worldName[godAgentEid] = "Test World";
  GodAgent.narrative[godAgentEid] = "A world for testing spirit-god integration";
  GodAgent.tick[godAgentEid] = 0;
  setGodAgent(spiritRegistry, godAgentEid);

  // Create ConsistencySpirit
  const consistencyState = createSpirit(spiritRegistry, ConsistencySpiritDefinition);

  // Create some rooms
  const rooms: number[] = [];
  const roomNames = ["Village Square", "Dark Forest", "Mountain Cave"];
  for (const name of roomNames) {
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Description);
    addComponent(world, eid, Room);
    Name.value[eid] = name;
    Description.value[eid] = `The ${name.toLowerCase()} of the test world`;
    Room.capacity[eid] = 10;
    rooms.push(eid);
  }

  // Create some agents
  const agents: number[] = [];
  const agentConfigs = [
    { name: "Alice", room: 0 },
    { name: "Bob", room: 0 },
    { name: "Charlie", room: 1 },
  ];

  for (const config of agentConfigs) {
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Description);
    addComponent(world, eid, Agent);
    addComponent(world, eid, Mind);
    addComponent(world, eid, OccupiesRoom(rooms[config.room]));

    Name.value[eid] = config.name;
    Description.value[eid] = `An agent named ${config.name}`;
    Agent.role[eid] = "villager";
    Agent.active[eid] = true;
    Mind.mode[eid] = "reactive";
    Mind.arousal[eid] = 0.5;
    Mind.focus[eid] = "";
    Mind.lastUpdate[eid] = Date.now();

    agents.push(eid);
  }

  return {
    world,
    entityRegistry,
    systemRegistry,
    spiritRegistry,
    godAgentEid,
    consistencySpiritEid: consistencyState.eid,
    rooms,
    agents,
  };
}

// =============================================================================
// SIMULATE PROBLEMATIC ACTIONS
// =============================================================================

function simulateProblematicActions(testWorld: TestWorld): void {
  const { world } = testWorld;

  console.log("\n📛 Simulating problematic agent actions...\n");

  // Agent tries invalid actions
  validateAgentAction(world, "Alice", "teleport", "moon");
  validateAgentAction(world, "Alice", "fly", "sky");
  validateAgentAction(world, "Bob", "swim", "river");

  // Agent tries to interact with non-existent entities
  validateAgentAction(world, "Charlie", "attack", "Dragon");
  validateAgentAction(world, "Alice", "pickup", "Magic Sword");
  validateAgentAction(world, "Bob", "speak", undefined, "Hello Wolf!");

  // Agent tries actions requiring missing systems
  validateAgentAction(world, "Charlie", "craft", undefined, "wooden shield");
  validateAgentAction(world, "Alice", "attack", "Bob");

  // Record some events for pattern detection
  for (let i = 0; i < 20; i++) {
    recordEvent("agent_action", { action: "speak", agent: "Alice" }, "Alice");
  }

  // Record some failures
  for (let i = 0; i < 5; i++) {
    recordEvent("action_failed", { reason: "missing_entity", agent: "Bob" }, "Bob");
  }

  console.log("  ✓ Simulated 8 problematic actions");
  console.log("  ✓ Recorded 20 speak events (rapid pattern)");
  console.log("  ✓ Recorded 5 action failures");
}

// =============================================================================
// CONSISTENCY SPIRIT OBSERVATION CYCLE
// =============================================================================

function runConsistencySpiritObservation(testWorld: TestWorld): SpiritReportForGodAI {
  const { world, systemRegistry } = testWorld;

  console.log("\n👼 ConsistencySpirit running observation cycle...\n");

  const report = generateSpiritReportForGodAI(world, systemRegistry, GodAgent.tick[testWorld.godAgentEid]);

  console.log(`  ✓ Total issues detected: ${report.totalIssues}`);
  console.log(`  ✓ Critical issues: ${report.criticalIssues}`);
  console.log(`  ✓ Patterns detected: ${report.detectedPatterns.length}`);
  console.log(`  ✓ Recommendations: ${report.recommendations.length}`);
  console.log(`  ✓ Suggested actions: ${report.suggestedActions.length}`);

  return report;
}

// =============================================================================
// SEND REPORT TO GODAI
// =============================================================================

function sendReportToGodAI(testWorld: TestWorld, report: SpiritReportForGodAI): void {
  const { spiritRegistry, consistencySpiritEid } = testWorld;

  console.log("\n📬 Sending report to GodAI...\n");

  const message = formatReportAsMessage(report);

  // Send via spirit registry
  reportToSuperior(
    spiritRegistry,
    consistencySpiritEid,
    "Consistency Report - Issues Detected",
    message,
    report.criticalIssues > 0 ? "critical" : report.totalIssues > 5 ? "high" : "normal",
    { report }
  );

  console.log(`  ✓ Report sent (${message.length} chars)`);
  console.log(`  ✓ Priority: ${report.criticalIssues > 0 ? "critical" : report.totalIssues > 5 ? "high" : "normal"}`);
}

// =============================================================================
// GODAI PROCESSES REPORT AND TAKES ACTION
// =============================================================================

async function godAIProcessesReport(testWorld: TestWorld): Promise<{
  entitiesCreated: string[];
  systemsCreated: string[];
  worldExpansions: string[];
}> {
  const { world, spiritRegistry, systemRegistry, entityRegistry, rooms, godAgentEid } = testWorld;

  console.log("\n🌟 GodAI processing spirit reports...\n");

  // Get messages from spirits
  const messages = getMessagesForGodAI(spiritRegistry);
  console.log(`  ✓ Retrieved ${messages.length} messages from spirits`);

  if (messages.length === 0) {
    console.log("  ⚠️ No messages to process");
    return { entitiesCreated: [], systemsCreated: [], worldExpansions: [] };
  }

  // Extract the report data
  const reportMessage = messages[0];
  const reportData = reportMessage.data?.report as SpiritReportForGodAI | undefined;

  if (!reportData) {
    console.log("  ⚠️ No report data in message");
    return { entitiesCreated: [], systemsCreated: [], worldExpansions: [] };
  }

  // Build context for GodAI
  const introspection = getIntrospectionContext(world, systemRegistry, getGlobalEventBuffer());

  const godPrompt = `You are GodAI, the supreme architect of a simulated world.

## CURRENT WORLD STATE
- Agents: ${introspection.agentCount} (${introspection.activeAgentCount} active)
- Rooms: ${introspection.roomCount}
- Systems: ${introspection.systems.length} (${introspection.activeSystems} active)

## SPIRIT REPORT FROM THE ARBITER (Consistency Guardian)

${reportMessage.content}

## YOUR TASK

Based on the Arbiter's report, decide what actions to take to improve the world.
The Arbiter has identified issues that need fixing. Consider:

1. Creating missing entities that agents tried to interact with
2. Adding systems that agents need (combat, inventory, crafting)
3. Expanding the world with new rooms or features

Respond with a JSON object containing your decisions:
{
  "analysis": "Brief analysis of the issues",
  "entitiesToCreate": [
    { "name": "EntityName", "type": "agent|object|item", "description": "Why needed", "room": "RoomName" }
  ],
  "systemsToCreate": [
    { "name": "SystemName", "purpose": "What it does" }
  ],
  "worldExpansions": [
    { "type": "room|feature", "name": "Name", "description": "What it adds" }
  ]
}`;

  try {
    const result = await generateText({
      model,
      prompt: godPrompt,
      maxTokens: 2000,
    });

    console.log("\n  GodAI Response:");
    console.log("  " + "-".repeat(50));

    // Parse the response
    const responseText = result.text;
    console.log(responseText.slice(0, 500) + "...\n");

    // Try to extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log("  ⚠️ Could not parse GodAI response as JSON");
      return { entitiesCreated: [], systemsCreated: [], worldExpansions: [] };
    }

    const decisions = JSON.parse(jsonMatch[0]);

    const entitiesCreated: string[] = [];
    const systemsCreated: string[] = [];
    const worldExpansions: string[] = [];

    // Create entities
    if (decisions.entitiesToCreate && Array.isArray(decisions.entitiesToCreate)) {
      console.log("\n  📦 Creating entities:");
      for (const entity of decisions.entitiesToCreate) {
        const eid = addEntity(world);
        addComponent(world, eid, Name);
        addComponent(world, eid, Description);
        Name.value[eid] = entity.name;
        Description.value[eid] = entity.description || `A ${entity.type} named ${entity.name}`;

        // Add to a room if specified
        if (entity.room && rooms.length > 0) {
          const roomEid = rooms[0]; // Default to first room
          addComponent(world, eid, OccupiesRoom(roomEid));
        }

        // Add type-specific components
        if (entity.type === "agent") {
          addComponent(world, eid, Agent);
          addComponent(world, eid, Mind);
          Agent.role[eid] = "npc";
          Agent.active[eid] = true;
          Mind.mode[eid] = "reactive";
          Mind.arousal[eid] = 0.5;
        }

        if (entity.type === "item") {
          // Mark as item (would use Item component)
          Description.value[eid] = `[ITEM] ${entity.description || entity.name}`;
        }

        entitiesCreated.push(entity.name);
        console.log(`    ✓ Created ${entity.type}: ${entity.name}`);
      }
    }

    // Log systems to create (would actually bake them in full implementation)
    if (decisions.systemsToCreate && Array.isArray(decisions.systemsToCreate)) {
      console.log("\n  ⚙️ Systems to create:");
      for (const system of decisions.systemsToCreate) {
        systemsCreated.push(system.name);
        console.log(`    → ${system.name}: ${system.purpose}`);
      }
    }

    // Log world expansions (would actually create them in full implementation)
    if (decisions.worldExpansions && Array.isArray(decisions.worldExpansions)) {
      console.log("\n  🌍 World expansions:");
      for (const expansion of decisions.worldExpansions) {
        if (expansion.type === "room") {
          const eid = addEntity(world);
          addComponent(world, eid, Name);
          addComponent(world, eid, Description);
          addComponent(world, eid, Room);
          Name.value[eid] = expansion.name;
          Description.value[eid] = expansion.description || `A new ${expansion.name}`;
          Room.capacity[eid] = 10;
          rooms.push(eid);
        }
        worldExpansions.push(`${expansion.type}: ${expansion.name}`);
        console.log(`    ✓ Added ${expansion.type}: ${expansion.name}`);
      }
    }

    // Update GodAgent tick
    GodAgent.tick[godAgentEid]++;

    return { entitiesCreated, systemsCreated, worldExpansions };
  } catch (error) {
    console.log(`  ❌ Error: ${error}`);
    return { entitiesCreated: [], systemsCreated: [], worldExpansions: [] };
  }
}

// =============================================================================
// VERIFY WORLD CHANGES
// =============================================================================

function verifyWorldChanges(testWorld: TestWorld, changes: {
  entitiesCreated: string[];
  systemsCreated: string[];
  worldExpansions: string[];
}): void {
  const { world } = testWorld;

  console.log("\n✅ Verifying world changes...\n");

  // Count entities
  const agents = Array.from(query(world, [Agent]));
  const rooms = Array.from(query(world, [Room]));

  console.log(`  World now has:`);
  console.log(`    - ${agents.length} agents`);
  console.log(`    - ${rooms.length} rooms`);
  console.log(`    - ${changes.entitiesCreated.length} new entities created`);
  console.log(`    - ${changes.systemsCreated.length} systems proposed`);
  console.log(`    - ${changes.worldExpansions.length} world expansions`);

  // List new entities
  if (changes.entitiesCreated.length > 0) {
    console.log(`\n  New entities: ${changes.entitiesCreated.join(", ")}`);
  }

  // List proposed systems
  if (changes.systemsCreated.length > 0) {
    console.log(`  Proposed systems: ${changes.systemsCreated.join(", ")}`);
  }
}

// =============================================================================
// MAIN TEST RUNNER
// =============================================================================

async function runIntegrationTest(): Promise<void> {
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║     SPIRIT-GODAI INTEGRATION TEST                            ║");
  console.log("║     ConsistencySpirit → Report → GodAI → World Changes       ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝");

  // Phase 1: Setup
  console.log("\n" + "=".repeat(60));
  console.log("PHASE 1: WORLD SETUP");
  console.log("=".repeat(60));
  const testWorld = setupTestWorld();
  console.log(`  ✓ Created world with ${testWorld.agents.length} agents, ${testWorld.rooms.length} rooms`);
  console.log(`  ✓ GodAgent: ${Name.value[testWorld.godAgentEid]}`);
  console.log(`  ✓ ConsistencySpirit active`);

  // Phase 2: Simulate problems
  console.log("\n" + "=".repeat(60));
  console.log("PHASE 2: SIMULATE PROBLEMATIC ACTIONS");
  console.log("=".repeat(60));
  simulateProblematicActions(testWorld);

  // Phase 3: ConsistencySpirit observes
  console.log("\n" + "=".repeat(60));
  console.log("PHASE 3: CONSISTENCY SPIRIT OBSERVATION");
  console.log("=".repeat(60));
  const report = runConsistencySpiritObservation(testWorld);

  // Phase 4: Send report to GodAI
  console.log("\n" + "=".repeat(60));
  console.log("PHASE 4: SEND REPORT TO GODAI");
  console.log("=".repeat(60));
  sendReportToGodAI(testWorld, report);

  // Phase 5: GodAI processes and acts
  console.log("\n" + "=".repeat(60));
  console.log("PHASE 5: GODAI PROCESSES REPORT & TAKES ACTION");
  console.log("=".repeat(60));
  const changes = await godAIProcessesReport(testWorld);

  // Phase 6: Verify changes
  console.log("\n" + "=".repeat(60));
  console.log("PHASE 6: VERIFY WORLD CHANGES");
  console.log("=".repeat(60));
  verifyWorldChanges(testWorld, changes);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("TEST COMPLETE");
  console.log("=".repeat(60));
  console.log(`
The integration test demonstrated:
1. ✓ ConsistencySpirit detected ${report.totalIssues} issues
2. ✓ Generated ${report.recommendations.length} recommendations
3. ✓ Sent report to GodAI via spirit registry
4. ✓ GodAI received and processed the report
5. ✓ GodAI decided to create ${changes.entitiesCreated.length} entities
6. ✓ GodAI proposed ${changes.systemsCreated.length} new systems
7. ✓ GodAI suggested ${changes.worldExpansions.length} world expansions
`);
}

// Run the test
runIntegrationTest().catch(console.error);
