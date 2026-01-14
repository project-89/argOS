/**
 * Dual-Loop Integration Test
 *
 * Demonstrates the proper separation of:
 * 1. FAST ECS LOOP - deterministic systems running at high frequency
 * 2. SLOW AI LOOP - spirits and baking running in background
 *
 * The fast loop should run smoothly at 20Hz while AI operations
 * happen asynchronously without blocking.
 */

import "dotenv/config";
import { createWorld, addEntity, addComponent, query } from "bitecs";
import { Name, Description, Agent, Mind, Room, GodAgent, Health, Needs } from "../ecs/components";
import { OccupiesRoom } from "../ecs/relations";
import {
  createSystemRegistry,
  registerSystem,
  listSystems,
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
  approveProposal,
  getPendingProposals,
  resetFactoryState,
  type DynamicSpiritState,
} from "../spirits/spirit-factory";
import {
  recordSystemExecution,
  runWatcherCognition,
  createSystemWatcherConfig,
} from "../spirits/system-watcher";
import {
  runArchitectCognition,
  createArchitectConfig,
  queueAllApprovedProposals,
} from "../spirits/architect-spirit";
import { getAndClearAccumulatedIssues } from "../spirits/consistency-spirit";
import {
  createSimulation,
  registerFastSystem,
  registerAIOperation,
  startSimulation,
  stopSimulation,
  getSimulationStats,
  type SimulationState,
} from "../runtime/simulation-loop";
import {
  initializeTaskQueue,
  getQueueStats,
  getQueueSummary,
} from "../runtime/async-task-queue";

// =============================================================================
// TEST STATE
// =============================================================================

interface TestState {
  world: ReturnType<typeof createWorld>;
  entityRegistry: EntityRegistry;
  systemRegistry: SystemRegistry;
  spiritRegistry: SpiritRegistry;
  simulation: SimulationState;
  godAgentEid: number;
  watchers: DynamicSpiritState[];
  architects: DynamicSpiritState[];
  rooms: number[];
  agents: number[];
}

// =============================================================================
// SETUP
// =============================================================================

function setupTest(): TestState {
  console.log("\n" + "═".repeat(70));
  console.log("DUAL-LOOP INTEGRATION TEST SETUP");
  console.log("═".repeat(70));

  const world = createWorld();
  const entityRegistry = createEntityRegistry();
  const systemRegistry = createSystemRegistry();
  const spiritRegistry = createSpiritRegistry(world);

  // Reset state
  resetFactoryState();
  getAndClearAccumulatedIssues();
  initializeTaskQueue({ maxConcurrent: 2, processInterval: 200 });

  // ==========================================================================
  // CREATE GODAGENT
  // ==========================================================================
  console.log("\n[Setup] Creating GodAgent...");
  const godAgentEid = addEntity(world);
  addComponent(world, godAgentEid, Name);
  addComponent(world, godAgentEid, GodAgent);
  Name.value[godAgentEid] = "The Architect";
  GodAgent.worldName[godAgentEid] = "Dual-Loop World";
  setGodAgent(spiritRegistry, godAgentEid);

  // ==========================================================================
  // CREATE ROOMS
  // ==========================================================================
  console.log("[Setup] Creating rooms...");
  const rooms: number[] = [];
  const roomNames = ["Town Square", "Tavern", "Market"];
  for (const name of roomNames) {
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Room);
    Name.value[eid] = name;
    Room.capacity[eid] = 10;
    rooms.push(eid);
  }

  // ==========================================================================
  // CREATE AGENTS
  // ==========================================================================
  console.log("[Setup] Creating agents...");
  const agents: number[] = [];
  const agentConfigs = [
    { name: "Alice", room: 0, health: 100, hunger: 20, energy: 80 },
    { name: "Bob", room: 1, health: 90, hunger: 30, energy: 70 },
    { name: "Charlie", room: 2, health: 85, hunger: 40, energy: 60 },
  ];

  for (const config of agentConfigs) {
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Agent);
    addComponent(world, eid, Mind);
    addComponent(world, eid, Health);
    addComponent(world, eid, Needs);
    addComponent(world, eid, OccupiesRoom(rooms[config.room]));

    Name.value[eid] = config.name;
    Agent.active[eid] = true;
    Mind.arousal[eid] = 0.5;
    Health.current[eid] = config.health;
    Health.max[eid] = 100;
    Needs.hunger[eid] = config.hunger;
    Needs.energy[eid] = config.energy;
    Needs.social[eid] = 30;
    Needs.comfort[eid] = 50;
    agents.push(eid);
  }

  // ==========================================================================
  // CREATE SPIRITS
  // ==========================================================================
  console.log("[Setup] Creating spirits...");

  const watcher = createDynamicSpirit(spiritRegistry, {
    name: "The Sentinel",
    title: "System Guardian",
    type: "watcher",
    domain: "meta",
    rank: "angel",
    superiorEid: godAgentEid,
    watchConfig: createSystemWatcherConfig(
      ["NeedsDecay", "HealthRegen", "MovementSystem"],
      ["stagnation", "performance"]
    ),
  });

  const architect = createDynamicSpirit(spiritRegistry, {
    name: "The Builder",
    title: "System Architect",
    type: "architect",
    domain: "economy",
    rank: "angel",
    superiorEid: godAgentEid,
    architectConfig: createArchitectConfig({
      canProposeSystems: true,
      canProposeComponents: true,
      maxProposals: 2,
    }),
  });

  const watchers = watcher ? [watcher] : [];
  const architects = architect ? [architect] : [];

  // ==========================================================================
  // CREATE SIMULATION
  // ==========================================================================
  console.log("[Setup] Creating simulation...");

  const simulation = createSimulation(world, systemRegistry, spiritRegistry, {
    ecsTickRate: 20,           // 20 Hz - very fast
    ecsMaxTickTime: 50,
    aiProcessInterval: 500,
    watcherTickInterval: 60,   // Every 3 seconds at 20 Hz
    architectTickInterval: 100, // Every 5 seconds
    approvalTickInterval: 120,  // Every 6 seconds
    logTickStats: true,
    logInterval: 40,           // Log every 2 seconds
  });

  // ==========================================================================
  // REGISTER FAST SYSTEMS
  // ==========================================================================
  console.log("[Setup] Registering fast ECS systems...");

  // These are FAST, DETERMINISTIC systems that run every tick
  registerFastSystem(simulation, {
    name: "NeedsDecay",
    frequency: 2, // Every 2 ticks (100ms at 20Hz)
    execute: (w, delta, tick) => {
      const agentList = query(w, [Agent, Needs]);
      for (const eid of agentList) {
        // Slow decay
        if (Needs.hunger[eid] < 100) Needs.hunger[eid] += 0.01;
        if (Needs.energy[eid] > 0) Needs.energy[eid] -= 0.005;
      }
      recordSystemExecution("NeedsDecay", 1, agentList.length);
    },
  });

  registerFastSystem(simulation, {
    name: "HealthRegen",
    frequency: 5, // Every 5 ticks (250ms)
    execute: (w, delta, tick) => {
      const agentList = query(w, [Agent, Health, Mind]);
      for (const eid of agentList) {
        // Regen when calm
        if (Mind.arousal[eid] < 0.3 && Health.current[eid] < Health.max[eid]) {
          Health.current[eid] = Math.min(Health.max[eid], Health.current[eid] + 0.1);
        }
      }
      recordSystemExecution("HealthRegen", 0.5, agentList.length);
    },
  });

  registerFastSystem(simulation, {
    name: "ArousalDecay",
    frequency: 3, // Every 3 ticks
    execute: (w, delta, tick) => {
      const agentList = query(w, [Agent, Mind]);
      for (const eid of agentList) {
        // Arousal slowly decreases
        if (Mind.arousal[eid] > 0.1) {
          Mind.arousal[eid] -= 0.001;
        }
      }
    },
  });

  // A system that logs every 100 ticks
  registerFastSystem(simulation, {
    name: "StatusLogger",
    frequency: 100, // Every 5 seconds
    execute: (w, delta, tick) => {
      console.log(`\n[Status] Tick ${tick}:`);
      for (const eid of agents) {
        console.log(`  ${Name.value[eid]}: H=${Health.current[eid]?.toFixed(1)} E=${Needs.energy[eid]?.toFixed(1)} Hu=${Needs.hunger[eid]?.toFixed(1)}`);
      }
    },
  });

  // ==========================================================================
  // REGISTER AI OPERATIONS (run in background)
  // ==========================================================================
  console.log("[Setup] Registering AI operations...");

  // Watcher cognition - runs in background
  registerAIOperation(simulation, {
    name: "WatcherCognition",
    interval: 60,  // Every 3 seconds
    lastRun: 0,
    execute: async () => {
      if (watchers.length === 0) return null;
      console.log("\n[AI] Running watcher cognition...");
      const report = await runWatcherCognition(
        world,
        systemRegistry,
        spiritRegistry,
        watchers[0]
      );
      if (report) {
        console.log(`[AI] Watcher report: ${report.overallHealth}`);
      }
      return report;
    },
  });

  // Architect cognition - runs in background
  registerAIOperation(simulation, {
    name: "ArchitectCognition",
    interval: 100, // Every 5 seconds
    lastRun: 0,
    execute: async () => {
      if (architects.length === 0) return null;
      console.log("\n[AI] Running architect cognition...");
      const proposals = await runArchitectCognition(
        world,
        systemRegistry,
        spiritRegistry,
        architects[0]
      );
      console.log(`[AI] Architect proposed: ${proposals.length} items`);
      return proposals;
    },
  });

  // GodAI approval - runs in background
  registerAIOperation(simulation, {
    name: "GodAIApproval",
    interval: 120, // Every 6 seconds
    lastRun: 0,
    execute: async () => {
      const pending = getPendingProposals();
      if (pending.length === 0) return { approved: 0 };

      console.log("\n[AI] GodAI reviewing proposals...");
      let approved = 0;
      for (const proposal of pending) {
        if (proposal.type === "system") {
          approveProposal(proposal.id, godAgentEid);
          console.log(`[AI] ✓ Approved: ${proposal.name}`);
          approved++;
        } else {
          console.log(`[AI] ⏸ Deferred: ${proposal.name}`);
        }
      }

      // Queue baking for approved proposals (non-blocking!)
      queueAllApprovedProposals(world, systemRegistry, (completed, total, name) => {
        console.log(`[AI] Baking progress: ${completed}/${total} (${name})`);
      });

      return { approved };
    },
  });

  console.log("[Setup] ✓ Complete!");
  console.log(`  - ${agents.length} agents`);
  console.log(`  - ${rooms.length} rooms`);
  console.log(`  - ${simulation.fastSystems.length} fast systems`);
  console.log(`  - ${simulation.aiOperations.length} AI operations`);

  return {
    world,
    entityRegistry,
    systemRegistry,
    spiritRegistry,
    simulation,
    godAgentEid,
    watchers,
    architects,
    rooms,
    agents,
  };
}

// =============================================================================
// RUN TEST
// =============================================================================

async function runTest(): Promise<void> {
  console.log("╔═══════════════════════════════════════════════════════════════════════╗");
  console.log("║        DUAL-LOOP INTEGRATION TEST                                     ║");
  console.log("║        Fast ECS (20Hz) + Background AI                                ║");
  console.log("╚═══════════════════════════════════════════════════════════════════════╝");

  const state = setupTest();

  console.log("\n" + "═".repeat(70));
  console.log("STARTING SIMULATION (running for 60 seconds)");
  console.log("═".repeat(70));
  console.log("\nWatch the fast ECS loop run while AI operations process in background.");

  // Start the simulation
  startSimulation(state.simulation);

  // Let it run for 60 seconds to see full cycle: propose → approve → bake → run
  console.log("Running for 60 seconds to observe full AI cycle...\n");
  await new Promise(resolve => setTimeout(resolve, 60000));

  // Stop and report
  stopSimulation(state.simulation);

  // ==========================================================================
  // FINAL REPORT
  // ==========================================================================
  console.log("\n" + "═".repeat(70));
  console.log("FINAL REPORT");
  console.log("═".repeat(70));

  const stats = getSimulationStats(state.simulation);
  console.log("\n📊 SIMULATION STATS:");
  console.log(`  Total ticks: ${stats.tick}`);
  console.log(`  Runtime: ${stats.runtime.toFixed(1)}s`);
  console.log(`  Avg tick time: ${stats.avgTickTime.toFixed(2)}ms`);
  console.log(`  Slow ticks: ${stats.slowTicks}`);
  console.log(`  Target tick time: ${(1000 / 20).toFixed(0)}ms (20Hz)`);

  const queueStats = getQueueStats();
  console.log("\n🤖 AI TASK QUEUE:");
  console.log(`  Pending: ${queueStats.pending}`);
  console.log(`  Running: ${queueStats.running}`);
  console.log(`  Completed: ${queueStats.completed}`);
  console.log(`  Failed: ${queueStats.failed}`);
  console.log(`  Avg execution time: ${queueStats.avgExecutionTime}ms`);

  const systems = listSystems(state.systemRegistry);
  console.log(`\n⚙️ REGISTERED SYSTEMS (${systems.length}):`);
  for (const sys of systems) {
    console.log(`  ${sys.enabled ? "✓" : "○"} ${sys.name}`);
  }

  console.log("\n👤 AGENT FINAL STATES:");
  for (const eid of state.agents) {
    console.log(`  ${Name.value[eid]}:`);
    console.log(`    Health: ${Health.current[eid]?.toFixed(1)}/${Health.max[eid]}`);
    console.log(`    Energy: ${Needs.energy[eid]?.toFixed(1)}`);
    console.log(`    Hunger: ${Needs.hunger[eid]?.toFixed(1)}`);
  }

  console.log("\n" + "═".repeat(70));
  console.log("TEST COMPLETE");
  console.log("═".repeat(70));
}

// Run
runTest().catch(console.error);
