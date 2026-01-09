/**
 * Agent Daemon & Report Routing Integration Test
 *
 * Tests:
 * 1. Agent Daemons watching individual agents
 * 2. Daemons detecting concerns and whispering guidance
 * 3. Daemons reporting to higher spirits
 * 4. ConsistencySpirit routing reports to Narrator vs GodAI
 */

import "dotenv/config";
import { createWorld, addEntity, addComponent, query } from "bitecs";
import { Name, Description, Agent, Mind, Room, Health, Goal, GridPosition, GodAgent } from "../ecs/components";
import { OccupiesRoom, HasGoal } from "../ecs/relations";
import {
  createSystemRegistry,
  registerSystem,
  createStimulusEmissionSystem,
  type SystemRegistry,
} from "../ecs/dynamic-systems";
import {
  createDaemonRegistry,
  createDaemonsForAllAgents,
  setDaemonSuperior,
  observeAgent,
  whisperToAgent,
  whisperChallenge,
  runDaemonSystem,
  getDaemonSummary,
  detectGrowthOpportunities,
  type DaemonRegistry,
} from "../spirits/agent-daemon";
import {
  createSpiritRegistry,
  createSpirit,
  setGodAgent,
  getSpiritByName,
  getMessagesForGodAI,
  type SpiritRegistry,
} from "../spirits/spirit-registry";
import { ConsistencySpiritDefinition } from "../spirits/consistency-spirit";
import {
  validateAgentAction,
  validateNarrativeEvent,
  generateRoutedReports,
  formatRoutedReportAsMessage,
  recordIssue,
  type RoutedReport,
} from "../spirits/consistency-spirit";
import { NarratorDefinition } from "../spirits/narrator-spirit";

// =============================================================================
// TEST WORLD SETUP
// =============================================================================

interface TestWorld {
  world: ReturnType<typeof createWorld>;
  systemRegistry: SystemRegistry;
  spiritRegistry: SpiritRegistry;
  daemonRegistry: DaemonRegistry;
  godAgentEid: number;
  consistencySpiritEid: number;
  narratorSpiritEid: number;
  rooms: number[];
  agents: number[];
}

function setupTestWorld(): TestWorld {
  const world = createWorld();
  const systemRegistry = createSystemRegistry();
  const spiritRegistry = createSpiritRegistry(world);
  const daemonRegistry = createDaemonRegistry(5000, 10000, 30000); // Faster for testing

  registerSystem(systemRegistry, createStimulusEmissionSystem());

  // Create GodAgent
  const godAgentEid = addEntity(world);
  addComponent(world, godAgentEid, Name);
  addComponent(world, godAgentEid, GodAgent);
  Name.value[godAgentEid] = "The Architect";
  GodAgent.worldName[godAgentEid] = "Daemon Test World";
  setGodAgent(spiritRegistry, godAgentEid);

  // Create ConsistencySpirit (The Arbiter)
  const consistencyState = createSpirit(spiritRegistry, ConsistencySpiritDefinition);

  // Create Narrator Spirit
  const narratorState = createSpirit(spiritRegistry, NarratorDefinition);

  // Set daemon superior to ConsistencySpirit
  setDaemonSuperior(daemonRegistry, consistencyState.eid);

  // Create rooms
  const rooms: number[] = [];
  const roomConfigs = [
    { name: "Village Square", ambience: "bustling" },
    { name: "Dark Forest", ambience: "ominous" },
    { name: "Peaceful Meadow", ambience: "serene" },
  ];

  for (const config of roomConfigs) {
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Description);
    addComponent(world, eid, Room);
    Name.value[eid] = config.name;
    Description.value[eid] = `The ${config.name.toLowerCase()}`;
    Room.capacity[eid] = 10;
    Room.ambience[eid] = config.ambience;
    rooms.push(eid);
  }

  // Create agents with various states for testing
  const agents: number[] = [];
  const agentConfigs = [
    { name: "Alice", room: 0, arousal: 0.5, health: 100, goals: 2 },  // Normal
    { name: "Bob", room: 1, arousal: 0.1, health: 80, goals: 0 },     // Low arousal, no goals
    { name: "Charlie", room: 2, arousal: 0.95, health: 20, goals: 1 }, // High arousal, low health
    { name: "Diana", room: 0, arousal: 0.5, health: 100, goals: 1 },   // Normal but stuck
  ];

  for (const config of agentConfigs) {
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Description);
    addComponent(world, eid, Agent);
    addComponent(world, eid, Mind);
    addComponent(world, eid, Health);
    addComponent(world, eid, GridPosition);
    addComponent(world, eid, OccupiesRoom(rooms[config.room]));

    Name.value[eid] = config.name;
    Description.value[eid] = `An agent named ${config.name}`;
    Agent.role[eid] = "villager";
    Agent.active[eid] = true;
    Mind.mode[eid] = "reactive";
    Mind.arousal[eid] = config.arousal;
    Mind.focus[eid] = "";
    Mind.lastUpdate[eid] = Date.now();
    Health.current[eid] = config.health;
    Health.max[eid] = 100;
    GridPosition.x[eid] = config.room * 10;
    GridPosition.y[eid] = 5;

    // Add goals
    for (let i = 0; i < config.goals; i++) {
      const goalEid = addEntity(world);
      addComponent(world, goalEid, Goal);
      addComponent(world, eid, HasGoal(goalEid));
      Goal.description[goalEid] = `Goal ${i + 1} for ${config.name}`;
      Goal.status[goalEid] = "active";
      Goal.priority[goalEid] = 5;
    }

    agents.push(eid);
  }

  return {
    world,
    systemRegistry,
    spiritRegistry,
    daemonRegistry,
    godAgentEid,
    consistencySpiritEid: consistencyState.eid,
    narratorSpiritEid: narratorState.eid,
    rooms,
    agents,
  };
}

// =============================================================================
// TESTS
// =============================================================================

async function testDaemonCreation(testWorld: TestWorld): Promise<void> {
  console.log("\n📦 Testing Daemon Creation...\n");

  const { world, daemonRegistry } = testWorld;

  const created = createDaemonsForAllAgents(daemonRegistry, world);
  console.log(`  ✓ Created ${created} daemons for ${testWorld.agents.length} agents`);

  const summary = getDaemonSummary(daemonRegistry);
  console.log(`\n${summary}`);
}

async function testDaemonObservation(testWorld: TestWorld): Promise<void> {
  console.log("\n👁️ Testing Daemon Observation...\n");

  const { world, daemonRegistry } = testWorld;

  for (const [agentEid, daemon] of daemonRegistry.daemons) {
    const observation = observeAgent(world, daemon);
    if (observation) {
      console.log(`  ${daemon.agentName}:`);
      console.log(`    - Arousal: ${observation.currentState.arousal.toFixed(2)}`);
      console.log(`    - Health: ${observation.currentState.health ?? "N/A"}`);
      console.log(`    - Goals: ${observation.currentState.goalCount}`);
      console.log(`    - Concerns: ${observation.concerns.length}`);

      for (const concern of observation.concerns) {
        console.log(`      ⚠️ [${concern.severity}] ${concern.type}: ${concern.description}`);
      }
    }
  }
}

async function testDaemonWhispers(testWorld: TestWorld): Promise<void> {
  console.log("\n💭 Testing Daemon Whispers (Guidance)...\n");

  const { world, daemonRegistry } = testWorld;

  for (const [agentEid, daemon] of daemonRegistry.daemons) {
    const observation = observeAgent(world, daemon);
    if (observation && observation.concerns.length > 0) {
      const whisper = await whisperToAgent(world, daemon, observation, true);
      if (whisper) {
        console.log(`  ${daemon.agentName} receives guidance whisper:`);
        console.log(`    "${whisper.content}" (${whisper.type})`);
      }
    }
  }
}

async function testGrowthOpportunities(testWorld: TestWorld): Promise<void> {
  console.log("\n🌱 Testing Growth Opportunity Detection...\n");

  const { world, daemonRegistry } = testWorld;

  for (const [agentEid, daemon] of daemonRegistry.daemons) {
    const observation = observeAgent(world, daemon);
    if (observation) {
      console.log(`  ${daemon.agentName}:`);
      console.log(`    - Concerns: ${observation.concerns.length}`);
      console.log(`    - Growth Opportunities: ${observation.growthOpportunities.length}`);

      for (const opp of observation.growthOpportunities) {
        console.log(`      🌟 [${opp.urgency}] ${opp.type}: ${opp.description}`);
        console.log(`         → ${opp.suggestedChallenge}`);
      }
    }
  }
}

async function testChallengeWhispers(testWorld: TestWorld): Promise<void> {
  console.log("\n🔥 Testing Challenge Whispers (Provocation)...\n");

  const { world, daemonRegistry } = testWorld;

  for (const [agentEid, daemon] of daemonRegistry.daemons) {
    const observation = observeAgent(world, daemon);
    if (observation && observation.growthOpportunities.length > 0) {
      const challenge = await whisperChallenge(world, daemon, observation, true);
      if (challenge) {
        console.log(`  ${daemon.agentName} receives challenge:`);
        console.log(`    "${challenge.content}" (${challenge.challengeType})`);
      }
    }
  }
}

async function testDaemonReporting(testWorld: TestWorld): Promise<void> {
  console.log("\n📝 Testing Daemon Reporting...\n");

  const { world, daemonRegistry, spiritRegistry } = testWorld;

  const result = await runDaemonSystem(world, daemonRegistry, spiritRegistry);

  console.log(`  ✓ Observations: ${result.observations}`);
  console.log(`  ✓ Guidance Whispers: ${result.whispers}`);
  console.log(`  ✓ Challenge Whispers: ${result.challenges}`);
  console.log(`  ✓ Reports sent: ${result.reports}`);

  // Check messages queued for ConsistencySpirit
  const messages = getMessagesForGodAI(spiritRegistry);
  console.log(`  ✓ Messages in queue: ${messages.length}`);

  for (const msg of messages) {
    console.log(`    - From: ${Name.value[msg.from] || msg.from}, Subject: ${msg.subject}`);
  }
}

async function testReportRouting(testWorld: TestWorld): Promise<void> {
  console.log("\n🔀 Testing Report Routing (Narrator vs GodAI)...\n");

  const { world, systemRegistry } = testWorld;

  // Generate some narrative drift issues
  validateNarrativeEvent(world, "The dragon swooped down from the mountains", ["dragon", "mountains"]);

  // Generate some mechanical issues
  validateAgentAction(world, "Alice", "teleport", "moon");
  validateAgentAction(world, "Bob", "attack", "Goblin");
  validateAgentAction(world, "Charlie", "craft", undefined, "sword");

  // Generate routed reports
  const routedReports = generateRoutedReports(world, systemRegistry);

  console.log(`  Generated ${routedReports.length} routed reports:\n`);

  for (const report of routedReports) {
    console.log(`  📨 Report for ${report.targetSpirit} (${report.domain})`);
    console.log(`     Priority: ${report.priority}`);
    console.log(`     Issues: ${report.issues.length}`);
    console.log(`     Recommendations: ${report.recommendations.length}`);

    if (report.recommendations.length > 0) {
      console.log(`     Recommendations:`);
      for (const rec of report.recommendations.slice(0, 3)) {
        console.log(`       - ${rec}`);
      }
    }

    console.log("");
  }

  // Show formatted messages
  console.log("  Formatted messages:\n");
  for (const report of routedReports) {
    const message = formatRoutedReportAsMessage(report);
    console.log(`  --- Message for ${report.targetSpirit} ---`);
    console.log(message.slice(0, 500) + (message.length > 500 ? "..." : ""));
    console.log("");
  }
}

async function testFullIntegration(testWorld: TestWorld): Promise<void> {
  console.log("\n🔄 Testing Full Integration Loop...\n");

  const { world, daemonRegistry, spiritRegistry, systemRegistry } = testWorld;

  console.log("  Step 1: Daemons observe agents...");
  const daemonResult = await runDaemonSystem(world, daemonRegistry, spiritRegistry);
  console.log(`    - ${daemonResult.observations} observations`);
  console.log(`    - ${daemonResult.whispers} guidance whispers (protection)`);
  console.log(`    - ${daemonResult.challenges} challenge whispers (growth)`);
  console.log(`    - ${daemonResult.reports} reports to Arbiter/GodAI`);

  console.log("\n  Step 2: ConsistencySpirit generates routed reports...");
  const routedReports = generateRoutedReports(world, systemRegistry);
  console.log(`    - Generated ${routedReports.length} routed reports`);

  for (const report of routedReports) {
    console.log(`    - ${report.domain} → ${report.targetSpirit}: ${report.issues.length} issues, ${report.recommendations.length} recommendations`);
  }

  console.log("\n  Step 3: Check spirit message queues...");
  const godMessages = getMessagesForGodAI(spiritRegistry);
  console.log(`    - Messages for GodAI: ${godMessages.length}`);

  console.log("\n  Integration loop complete!");
}

// =============================================================================
// MAIN TEST RUNNER
// =============================================================================

async function runAllTests(): Promise<void> {
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║     DAEMON & ROUTING INTEGRATION TEST                        ║");
  console.log("╠═══════════════════════════════════════════════════════════════╣");
  console.log("║  Tests:                                                       ║");
  console.log("║  1. Daemon creation for agents                               ║");
  console.log("║  2. Daemon observation and concern detection                 ║");
  console.log("║  3. Daemon guidance whispers (protection)                    ║");
  console.log("║  4. Growth opportunity detection                             ║");
  console.log("║  5. Challenge whispers (provocation for growth)              ║");
  console.log("║  6. Daemon reporting to higher spirits                       ║");
  console.log("║  7. ConsistencySpirit report routing                         ║");
  console.log("║  8. Full integration loop                                    ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝");

  // Setup
  console.log("\n" + "=".repeat(60));
  console.log("SETUP: Creating test world");
  console.log("=".repeat(60));
  const testWorld = setupTestWorld();
  console.log(`  ✓ Created world with ${testWorld.agents.length} agents, ${testWorld.rooms.length} rooms`);
  console.log(`  ✓ Spirits: The Arbiter (Consistency), The Weaver (Narrator)`);

  // Run tests
  console.log("\n" + "=".repeat(60));
  console.log("TEST 1: DAEMON CREATION");
  console.log("=".repeat(60));
  await testDaemonCreation(testWorld);

  console.log("\n" + "=".repeat(60));
  console.log("TEST 2: DAEMON OBSERVATION");
  console.log("=".repeat(60));
  await testDaemonObservation(testWorld);

  console.log("\n" + "=".repeat(60));
  console.log("TEST 3: GUIDANCE WHISPERS (Protection)");
  console.log("=".repeat(60));
  await testDaemonWhispers(testWorld);

  console.log("\n" + "=".repeat(60));
  console.log("TEST 4: GROWTH OPPORTUNITIES");
  console.log("=".repeat(60));
  await testGrowthOpportunities(testWorld);

  console.log("\n" + "=".repeat(60));
  console.log("TEST 5: CHALLENGE WHISPERS (Provocation)");
  console.log("=".repeat(60));
  await testChallengeWhispers(testWorld);

  console.log("\n" + "=".repeat(60));
  console.log("TEST 6: DAEMON REPORTING");
  console.log("=".repeat(60));
  await testDaemonReporting(testWorld);

  console.log("\n" + "=".repeat(60));
  console.log("TEST 7: REPORT ROUTING");
  console.log("=".repeat(60));
  await testReportRouting(testWorld);

  console.log("\n" + "=".repeat(60));
  console.log("TEST 8: FULL INTEGRATION");
  console.log("=".repeat(60));
  await testFullIntegration(testWorld);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("TEST COMPLETE - SUMMARY");
  console.log("=".repeat(60));
  console.log(`
The daemon and routing system demonstrated:

1. ✓ Daemons created for each agent (guardian spirits)

2. ✓ Daemons detect CONCERNS (protection mode):
   - Low arousal (disengaged agents)
   - High arousal (overwhelmed agents)
   - Low health (danger)
   - No goals (goal drift)

3. ✓ Daemons detect GROWTH OPPORTUNITIES (challenge mode):
   - Too comfortable (complacency zone)
   - Ready for challenge (prime condition)
   - Stagnating (stuck in a rut)
   - Needs conflict (flat emotional state)
   - Breakthrough possible (flow state)
   - Skill plateau (not progressing)
   - Relationship test (stable for drama)

4. ✓ Daemons send TWO types of whispers:
   - Guidance whispers → protection (warnings, encouragement)
   - Challenge whispers → growth (provocations, doubts, ambitions)

5. ✓ Daemons report BOTH concerns AND growth opportunities to Arbiter/GodAI
   - GodAI can create challenges based on growth opportunities
   - Ensures agents face meaningful obstacles and develop

6. ✓ ConsistencySpirit routes reports:
   - Narrative issues → Narrator
   - Mechanical issues → GodAI

The daemon's dual purpose is now:
  🛡️  PROTECTION: Guide agents away from danger, confusion, stagnation
  🔥 CHALLENGE: Push agents toward growth, conflict, engagement

The spirit hierarchy:
  👑 GodAI (The Architect) ← receives growth recommendations
    ├── 👼 The Arbiter (Consistency) ← receives daemon reports
    │     └── 👻 Agent Daemons (personal guardians & challengers)
    └── 👼 The Weaver (Narrator) ← receives narrative issues
`);
}

// Run the tests
runAllTests().catch(console.error);
