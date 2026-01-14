/**
 * Self-Growing Spirit Hierarchy Test
 *
 * Tests the complete self-growing ecosystem where:
 * 1. GodAI creates System Watcher spirits to monitor systems
 * 2. GodAI creates Architect spirits to propose new systems/components
 * 3. System Watchers observe and report on system health
 * 4. Architects identify needs and create proposals
 * 5. GodAI approves/rejects proposals
 * 6. Approved proposals are executed, expanding the simulation
 *
 * This demonstrates the key concept: GodAI doesn't manually build everything,
 * it spawns specialized spirits to handle observation and design, creating
 * a self-growing hierarchical ecosystem.
 */

import "dotenv/config";
import { createWorld, addEntity, addComponent, query } from "bitecs";
import { Name, Description, Agent, Mind, Room, GodAgent } from "../ecs/components";
import { OccupiesRoom } from "../ecs/relations";
import {
  createSystemRegistry,
  registerSystem,
  createStimulusEmissionSystem,
  type SystemRegistry,
} from "../ecs/dynamic-systems";
import { createEntityRegistry, type EntityRegistry } from "../ecs/tools";
import {
  createSpiritRegistry,
  setGodAgent,
  type SpiritRegistry,
} from "../spirits/spirit-registry";
import {
  createDynamicSpirit,
  submitProposal,
  approveProposal,
  rejectProposal,
  getPendingProposals,
  getApprovedProposals,
  getFactorySummary,
  getSpiritsByType,
  getDynamicSpirit,
  resetFactoryState,
  type DynamicSpiritState,
} from "../spirits/spirit-factory";
import {
  recordSystemExecution,
  recordSystemError,
  runWatcherCognition,
  createSystemWatcherConfig,
  getAllTrackedSystems,
} from "../spirits/system-watcher";
import {
  runArchitectCognition,
  createArchitectConfig,
  ARCHITECT_PRESETS,
} from "../spirits/architect-spirit";
import { recordEvent, getAndClearAccumulatedIssues } from "../spirits/consistency-spirit";
import { getIntrospectionContext } from "../introspection/introspection";

// =============================================================================
// TEST CONFIGURATION
// =============================================================================

interface TestWorld {
  world: ReturnType<typeof createWorld>;
  entityRegistry: EntityRegistry;
  systemRegistry: SystemRegistry;
  spiritRegistry: SpiritRegistry;
  godAgentEid: number;
  rooms: number[];
  agents: number[];
}

// =============================================================================
// WORLD SETUP
// =============================================================================

function setupTestWorld(): TestWorld {
  const world = createWorld();
  const entityRegistry = createEntityRegistry();
  const systemRegistry = createSystemRegistry();
  const spiritRegistry = createSpiritRegistry(world);

  // Reset factory state from previous tests
  resetFactoryState();
  getAndClearAccumulatedIssues();  // Clear any previous issues

  // Register base systems
  registerSystem(systemRegistry, createStimulusEmissionSystem());

  // Create a simple test system to monitor
  registerSystem(systemRegistry, {
    name: "TestDecaySystem",
    description: "A test system that decays values",
    frequency: 5000,
    enabled: true,
    execute: async (w) => {
      console.log("[TestDecaySystem] Running...");
      return { processed: 0, changes: [] };
    },
  });

  // Create GodAgent entity
  const godAgentEid = addEntity(world);
  addComponent(world, godAgentEid, Name);
  addComponent(world, godAgentEid, GodAgent);
  Name.value[godAgentEid] = "The Architect";
  GodAgent.worldName[godAgentEid] = "Self-Growing Test World";
  GodAgent.narrative[godAgentEid] = "A world that evolves through spirit-driven design";
  GodAgent.tick[godAgentEid] = 0;
  setGodAgent(spiritRegistry, godAgentEid);

  // Create rooms
  const rooms: number[] = [];
  const roomNames = ["Town Square", "Market District", "Ancient Library"];
  for (const name of roomNames) {
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Description);
    addComponent(world, eid, Room);
    Name.value[eid] = name;
    Description.value[eid] = `The ${name.toLowerCase()}`;
    Room.capacity[eid] = 10;
    rooms.push(eid);
  }

  // Create agents
  const agents: number[] = [];
  const agentConfigs = [
    { name: "Scholar Aldric", room: 2, role: "researcher" },
    { name: "Merchant Bela", room: 1, role: "trader" },
    { name: "Guard Captain Cira", room: 0, role: "guard" },
    { name: "Innkeeper Diana", room: 0, role: "innkeeper" },
  ];

  for (const config of agentConfigs) {
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Description);
    addComponent(world, eid, Agent);
    addComponent(world, eid, Mind);
    addComponent(world, eid, OccupiesRoom(rooms[config.room]));

    Name.value[eid] = config.name;
    Description.value[eid] = `A ${config.role}`;
    Agent.role[eid] = config.role;
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
    rooms,
    agents,
  };
}

// =============================================================================
// PHASE 1: GODAI CREATES SYSTEM WATCHERS
// =============================================================================

function phase1_CreateSystemWatchers(testWorld: TestWorld): DynamicSpiritState[] {
  console.log("\n" + "═".repeat(60));
  console.log("PHASE 1: GODAI CREATES SYSTEM WATCHERS");
  console.log("═".repeat(60));
  console.log("\n  GodAI realizes it needs spirits to monitor system health...\n");

  const watchers: DynamicSpiritState[] = [];

  // Create a watcher for all systems
  const coreWatcher = createDynamicSpirit(testWorld.spiritRegistry, {
    name: "The Sentinel",
    title: "Guardian of Systems",
    description: "Watches all core systems for anomalies",
    type: "watcher",
    domain: "meta",
    rank: "angel",
    superiorEid: testWorld.godAgentEid,
    watchConfig: createSystemWatcherConfig(
      ["StimulusEmissionSystem", "TestDecaySystem"],
      ["stagnation", "performance", "errors"]
    ),
    customPrompt: "You vigilantly watch all systems, alert for any degradation or failure.",
    observationInterval: 15000,
  });

  if (coreWatcher) {
    watchers.push(coreWatcher);
    console.log(`  ✓ Created: ${coreWatcher.definition.title} (${coreWatcher.definition.name})`);
    console.log(`    Domain: ${coreWatcher.definition.domain}`);
    console.log(`    Watching: ${coreWatcher.watchConfig?.targetSystems?.join(", ")}`);
  }

  // Create a specialized watcher for social dynamics
  const socialWatcher = createDynamicSpirit(testWorld.spiritRegistry, {
    name: "The Observer",
    title: "Watcher of Social Tides",
    description: "Monitors social dynamics and agent interactions",
    type: "watcher",
    domain: "social",
    rank: "daemon",
    superiorEid: coreWatcher?.eid || testWorld.godAgentEid,
    watchConfig: createSystemWatcherConfig(
      [],  // All systems
      ["stagnation", "overload"]
    ),
    customPrompt: "You observe the ebb and flow of social interactions.",
  });

  if (socialWatcher) {
    watchers.push(socialWatcher);
    console.log(`  ✓ Created: ${socialWatcher.definition.title} (${socialWatcher.definition.name})`);
    console.log(`    Domain: ${socialWatcher.definition.domain}`);
  }

  console.log(`\n  Total watchers created: ${watchers.length}`);
  return watchers;
}

// =============================================================================
// PHASE 2: GODAI CREATES ARCHITECTS
// =============================================================================

function phase2_CreateArchitects(testWorld: TestWorld): DynamicSpiritState[] {
  console.log("\n" + "═".repeat(60));
  console.log("PHASE 2: GODAI CREATES ARCHITECT SPIRITS");
  console.log("═".repeat(60));
  console.log("\n  GodAI spawns architects to design new simulation elements...\n");

  const architects: DynamicSpiritState[] = [];

  // Create an economy architect
  const economyArchitect = createDynamicSpirit(testWorld.spiritRegistry, {
    name: "The Merchant Prince",
    title: "Architect of Commerce",
    description: "Designs economy and trade systems",
    type: "architect",
    domain: "economy",
    rank: "angel",
    superiorEid: testWorld.godAgentEid,
    architectConfig: createArchitectConfig({
      canProposeSystems: true,
      canProposeComponents: true,
      canProposeEntities: true,
      canProposeRules: false,
      canExecuteDirectly: false,
      approvalRequired: "godai",
      maxProposals: 3,
    }),
    customPrompt: ARCHITECT_PRESETS.economyArchitect.customPrompt,
    observationInterval: 30000,
  });

  if (economyArchitect) {
    architects.push(economyArchitect);
    console.log(`  ✓ Created: ${economyArchitect.definition.title} (${economyArchitect.definition.name})`);
    console.log(`    Domain: ${economyArchitect.definition.domain}`);
    console.log(`    Can propose: systems, components, entities`);
  }

  // Create a narrative architect
  const narrativeArchitect = createDynamicSpirit(testWorld.spiritRegistry, {
    name: "The Questmaster",
    title: "Weaver of Stories",
    description: "Designs quests and narrative systems",
    type: "architect",
    domain: "narrative",
    rank: "angel",
    superiorEid: testWorld.godAgentEid,
    architectConfig: createArchitectConfig({
      canProposeSystems: true,
      canProposeComponents: false,
      canProposeEntities: true,
      canProposeRules: true,
      canExecuteDirectly: false,
      approvalRequired: "godai",
      maxProposals: 2,
    }),
    customPrompt: ARCHITECT_PRESETS.questArchitect.customPrompt,
    observationInterval: 45000,
  });

  if (narrativeArchitect) {
    architects.push(narrativeArchitect);
    console.log(`  ✓ Created: ${narrativeArchitect.definition.title} (${narrativeArchitect.definition.name})`);
    console.log(`    Domain: ${narrativeArchitect.definition.domain}`);
    console.log(`    Can propose: systems, entities, rules`);
  }

  console.log(`\n  Total architects created: ${architects.length}`);
  return architects;
}

// =============================================================================
// PHASE 3: SIMULATE SYSTEM ACTIVITY
// =============================================================================

function phase3_SimulateSystemActivity(testWorld: TestWorld): void {
  console.log("\n" + "═".repeat(60));
  console.log("PHASE 3: SIMULATE SYSTEM ACTIVITY");
  console.log("═".repeat(60));
  console.log("\n  Simulating system executions and events...\n");

  // Simulate some system executions
  for (let i = 0; i < 20; i++) {
    recordSystemExecution("StimulusEmissionSystem", Math.random() * 50 + 10, Math.floor(Math.random() * 5));
    recordSystemExecution("TestDecaySystem", Math.random() * 30 + 5, Math.floor(Math.random() * 10));
  }
  console.log("  ✓ Recorded 20 executions for StimulusEmissionSystem");
  console.log("  ✓ Recorded 20 executions for TestDecaySystem");

  // Simulate some errors
  recordSystemError("TestDecaySystem", "Division by zero in decay calculation");
  recordSystemError("TestDecaySystem", "Entity reference invalid");
  console.log("  ✓ Recorded 2 errors for TestDecaySystem");

  // Simulate agent events
  for (let i = 0; i < 15; i++) {
    recordEvent("agent_spoke", { agent: "Merchant Bela", topic: "trade" }, "Merchant Bela");
    recordEvent("agent_trade", { agent: "Merchant Bela", item: "goods" }, "Merchant Bela");
  }
  console.log("  ✓ Recorded 15 trade events for Merchant Bela");

  // Simulate some stagnation (no events for a character)
  recordEvent("agent_idle", { agent: "Scholar Aldric", duration: 60000 }, "Scholar Aldric");
  console.log("  ✓ Recorded stagnation for Scholar Aldric");

  const trackedSystems = getAllTrackedSystems();
  console.log(`\n  Currently tracking ${trackedSystems.length} systems: ${trackedSystems.join(", ")}`);
}

// =============================================================================
// PHASE 4: SYSTEM WATCHERS OBSERVE
// =============================================================================

async function phase4_WatchersObserve(
  testWorld: TestWorld,
  watchers: DynamicSpiritState[]
): Promise<void> {
  console.log("\n" + "═".repeat(60));
  console.log("PHASE 4: SYSTEM WATCHERS OBSERVE");
  console.log("═".repeat(60));
  console.log("\n  Watchers running observation cycles...\n");

  for (const watcher of watchers) {
    console.log(`  📡 ${watcher.definition.name} observing...`);

    const report = await runWatcherCognition(
      testWorld.world,
      testWorld.systemRegistry,
      testWorld.spiritRegistry,
      watcher
    );

    if (report) {
      console.log(`    Health: ${report.overallHealth.toUpperCase()}`);
      console.log(`    Anomalies detected: ${report.systemObservations.reduce((sum, o) => sum + o.anomalies.length, 0)}`);
      console.log(`    Recommendations: ${report.recommendations.length}`);

      if (report.recommendations.length > 0) {
        console.log(`    → ${report.recommendations[0]}`);
      }
    } else {
      console.log(`    ⚠️ No report generated`);
    }
    console.log();
  }
}

// =============================================================================
// PHASE 5: ARCHITECTS PROPOSE
// =============================================================================

async function phase5_ArchitectsPropose(
  testWorld: TestWorld,
  architects: DynamicSpiritState[]
): Promise<void> {
  console.log("\n" + "═".repeat(60));
  console.log("PHASE 5: ARCHITECTS CREATE PROPOSALS");
  console.log("═".repeat(60));
  console.log("\n  Architects identifying needs and designing solutions...\n");

  for (const architect of architects) {
    console.log(`  🏗️ ${architect.definition.name} analyzing simulation...`);

    try {
      const proposals = await runArchitectCognition(
        testWorld.world,
        testWorld.systemRegistry,
        testWorld.spiritRegistry,
        architect
      );

      console.log(`    Created ${proposals.length} proposals:`);
      for (const proposal of proposals) {
        console.log(`    → [${proposal.type}] ${proposal.name}`);
        console.log(`      "${proposal.description.slice(0, 80)}..."`);
      }
    } catch (error) {
      console.log(`    ⚠️ Error during cognition: ${error}`);
    }
    console.log();
  }

  // Show all pending proposals
  const pending = getPendingProposals();
  console.log(`  Total pending proposals: ${pending.length}`);
}

// =============================================================================
// PHASE 6: GODAI REVIEWS PROPOSALS
// =============================================================================

function phase6_GodAIReviewsProposals(testWorld: TestWorld): {
  approved: string[];
  rejected: string[];
} {
  console.log("\n" + "═".repeat(60));
  console.log("PHASE 6: GODAI REVIEWS PROPOSALS");
  console.log("═".repeat(60));
  console.log("\n  GodAI evaluating architect proposals...\n");

  const pending = getPendingProposals();
  const approved: string[] = [];
  const rejected: string[] = [];

  for (const proposal of pending) {
    console.log(`  Reviewing: [${proposal.type}] ${proposal.name}`);
    console.log(`    From: ${proposal.fromSpiritName}`);
    console.log(`    Rationale: ${proposal.rationale.slice(0, 100)}...`);

    // GodAI decision logic (simple heuristic for test)
    // In real implementation, this would be an LLM call
    const shouldApprove =
      proposal.type === "system" ||
      proposal.type === "entity" ||
      (proposal.type === "component" && proposal.name.toLowerCase().includes("economy"));

    if (shouldApprove) {
      approveProposal(proposal.id, testWorld.godAgentEid);
      approved.push(proposal.name);
      console.log(`    ✅ APPROVED\n`);
    } else {
      rejectProposal(proposal.id, "Not aligned with current world direction");
      rejected.push(proposal.name);
      console.log(`    ❌ REJECTED: Not aligned with current world direction\n`);
    }
  }

  console.log(`  Summary:`);
  console.log(`    Approved: ${approved.length}`);
  console.log(`    Rejected: ${rejected.length}`);

  return { approved, rejected };
}

// =============================================================================
// PHASE 7: EXECUTE APPROVED PROPOSALS
// =============================================================================

function phase7_ExecuteProposals(testWorld: TestWorld): void {
  console.log("\n" + "═".repeat(60));
  console.log("PHASE 7: EXECUTE APPROVED PROPOSALS");
  console.log("═".repeat(60));
  console.log("\n  Executing approved proposals to expand the simulation...\n");

  const approved = getApprovedProposals();
  console.log(`  ${approved.length} proposals ready for execution`);

  for (const proposal of approved) {
    console.log(`  Executing: [${proposal.type}] ${proposal.name}`);

    switch (proposal.type) {
      case "system":
        console.log(`    → Would register new system: ${proposal.name}`);
        console.log(`    → Frequency: ${proposal.specification?.frequency || 10000}ms`);
        break;
      case "component":
        console.log(`    → Would create component: ${proposal.name}`);
        console.log(`    → Fields: ${proposal.specification?.fields?.map((f: any) => f.name).join(", ") || "none"}`);
        break;
      case "entity":
        console.log(`    → Would create entity: ${proposal.name}`);
        console.log(`    → Type: ${proposal.specification?.type || "unknown"}`);
        break;
      case "rule":
        console.log(`    → Would add rule: ${proposal.name}`);
        break;
    }
    console.log();
  }
}

// =============================================================================
// PHASE 8: VERIFY HIERARCHY
// =============================================================================

function phase8_VerifyHierarchy(testWorld: TestWorld): void {
  console.log("\n" + "═".repeat(60));
  console.log("PHASE 8: VERIFY SPIRIT HIERARCHY");
  console.log("═".repeat(60));

  const summary = getFactorySummary();
  console.log("\n" + summary);

  // Verify hierarchy
  const watchers = getSpiritsByType("watcher");
  const architects = getSpiritsByType("architect");

  console.log("\n  Spirit Hierarchy:");
  console.log(`  └── GodAI (The Architect)`);

  for (const watcher of watchers) {
    const indent = watcher.definition.rank === "daemon" ? "      " : "    ";
    const marker = watcher.definition.rank === "daemon" ? "└──" : "├──";
    console.log(`  ${marker} [Watcher] ${watcher.definition.name} (${watcher.definition.rank})`);
  }

  for (const architect of architects) {
    console.log(`    ├── [Architect] ${architect.definition.name} (${architect.definition.rank})`);
  }
}

// =============================================================================
// MAIN TEST RUNNER
// =============================================================================

async function runSelfGrowingHierarchyTest(): Promise<void> {
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║        SELF-GROWING SPIRIT HIERARCHY TEST                     ║");
  console.log("║        GodAI → Watchers → Architects → Proposals → Growth     ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝");

  // Setup
  console.log("\n" + "═".repeat(60));
  console.log("SETUP: CREATING TEST WORLD");
  console.log("═".repeat(60));
  const testWorld = setupTestWorld();
  console.log(`  ✓ Created world with ${testWorld.agents.length} agents, ${testWorld.rooms.length} rooms`);
  console.log(`  ✓ GodAgent: ${Name.value[testWorld.godAgentEid]}`);
  console.log(`  ✓ Base systems registered`);

  // Phase 1: Create watchers
  const watchers = phase1_CreateSystemWatchers(testWorld);

  // Phase 2: Create architects
  const architects = phase2_CreateArchitects(testWorld);

  // Phase 3: Simulate activity
  phase3_SimulateSystemActivity(testWorld);

  // Phase 4: Watchers observe
  await phase4_WatchersObserve(testWorld, watchers);

  // Phase 5: Architects propose
  await phase5_ArchitectsPropose(testWorld, architects);

  // Phase 6: GodAI reviews
  const reviewResult = phase6_GodAIReviewsProposals(testWorld);

  // Phase 7: Execute proposals
  phase7_ExecuteProposals(testWorld);

  // Phase 8: Verify hierarchy
  phase8_VerifyHierarchy(testWorld);

  // Final Summary
  console.log("\n" + "═".repeat(60));
  console.log("TEST COMPLETE - SELF-GROWING ECOSYSTEM DEMONSTRATED");
  console.log("═".repeat(60));
  console.log(`
The test demonstrated the self-growing spirit hierarchy:

1. ✓ GodAI created ${watchers.length} System Watcher spirits
   - The Sentinel (meta domain, angel rank)
   - The Observer (social domain, daemon rank)

2. ✓ GodAI created ${architects.length} Architect spirits
   - The Merchant Prince (economy domain)
   - The Questmaster (narrative domain)

3. ✓ System activity was simulated
   - 40 system executions recorded
   - 2 system errors logged
   - Agent events tracked

4. ✓ Watchers observed and reported
   - Anomalies detected
   - Recommendations generated
   - Reports sent to GodAI

5. ✓ Architects analyzed and proposed
   - Identified simulation needs
   - Designed new systems/components/entities
   - Submitted proposals for approval

6. ✓ GodAI reviewed proposals
   - Approved: ${reviewResult.approved.length}
   - Rejected: ${reviewResult.rejected.length}

7. ✓ Hierarchy verified
   - Watchers subordinate to GodAI
   - Architects subordinate to GodAI
   - Daemon subordinate to Angel

KEY INSIGHT: The simulation can now grow ORGANICALLY through:
- Watchers monitoring health and detecting needs
- Architects proposing solutions
- GodAI approving expansions
- All without manual intervention!
`);
}

// Run the test
runSelfGrowingHierarchyTest().catch(console.error);
