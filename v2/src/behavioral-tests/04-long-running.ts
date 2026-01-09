/**
 * Behavioral Test 04: Long-Running Observation
 *
 * GOAL: Let a simulation run for an extended period and observe:
 * - How GodAI's decisions play out over time
 * - Emergent behaviors from system interactions
 * - Data drift and stability
 * - Whether the simulation reaches interesting states or collapses
 *
 * This tests the real-world viability of GodAI-created simulations.
 */

import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, resetRoomPositionCounter } from "../ecs/prefabs";
import { createGodAgent, godCommand, tickWorld, getWorldState } from "../god/god-agent";
import { listDynamicComponents, getDynamicComponentValues, getDynamicComponent } from "../ecs/dynamic-components";
import { query } from "bitecs";
import { Name, Agent, Needs } from "../ecs/components";

interface SimulationSnapshot {
  tick: number;
  timestamp: number;
  entityCount: number;
  systemLogs: string[];
  events: any[];
  componentSamples: Record<string, Record<string, any>>;
  metrics: {
    avgHunger?: number;
    avgEnergy?: number;
    customMetrics: Record<string, number>;
  };
}

interface SimulationAnalysis {
  totalTicks: number;
  durationMs: number;
  entityCountChange: number;
  totalLogs: number;
  totalEvents: number;
  dataVolatility: number; // How much data changed
  interestingMoments: string[];
  finalState: string;
}

async function runLongRunningTest() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Behavioral Test 04: Long-Running Observation                ║");
  console.log("║  Testing simulation stability and emergent behavior          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const world = createArgosWorld("LongRunningTest");
  initializePrefabs(world);
  resetRoomPositionCounter();

  const god = createGodAgent(world, {
    name: "SimulationMaster",
    worldName: "Living World",
    narrative: "A persistent simulation to observe over time.",
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 1: Setup - Ask GodAI to create a "living" simulation
  // ═══════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("PHASE 1: Creating a Living Simulation");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const setupPrompt = `
    Create a small village simulation that can run autonomously for a long time.

    Requirements:
    1. Create 3-5 villager entities with Needs (hunger, energy)
    2. Create resource sources (food, rest spots)
    3. Create systems that:
       - Make villagers' needs decay over time
       - Allow villagers to satisfy needs from resources
       - Log interesting events (someone got hungry, someone ate, etc.)

    The simulation should be self-sustaining - villagers should be able to
    survive indefinitely if they use resources wisely.

    Also create a custom "Mood" component with: happiness (number), stress (number)
    Make mood change based on how well needs are met.

    Build this now - I want to observe it running for 200 ticks.
  `;

  console.log("Asking GodAI to create village simulation...\n");
  await godCommand(god, setupPrompt);

  const entities = god.tools.listEntities().result as Array<{ name: string; id: number }>;
  const components = listDynamicComponents();

  console.log(`\nSetup complete:`);
  console.log(`  - Entities: ${entities.map(e => e.name).join(", ")}`);
  console.log(`  - Custom components: ${components.map(c => c.name).join(", ")}`);
  console.log(`  - Systems: ${god.fileSystems.map(s => s.name).join(", ")}`);

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2: Long Running Observation
  // ═══════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PHASE 2: Running Simulation (200 ticks)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const snapshots: SimulationSnapshot[] = [];
  const interestingMoments: string[] = [];
  const startTime = Date.now();

  const TOTAL_TICKS = 200;
  const SNAPSHOT_INTERVAL = 20;

  for (let tick = 1; tick <= TOTAL_TICKS; tick++) {
    const events = tickWorld(god, 1000);
    const logs = god.systemRegistry.logs.splice(0);

    // Take snapshots at intervals
    if (tick % SNAPSHOT_INTERVAL === 0 || tick === 1) {
      const snapshot: SimulationSnapshot = {
        tick,
        timestamp: Date.now(),
        entityCount: entities.length,
        systemLogs: [...logs],
        events: [...events],
        componentSamples: {},
        metrics: {
          customMetrics: {},
        },
      };

      // Sample entity states
      const villagers = entities.filter(e =>
        e.name.toLowerCase().includes("villager") ||
        e.name.toLowerCase().includes("person") ||
        e.name.toLowerCase().includes("npc")
      );

      // Get needs data
      const agentEids = Array.from(query(world, [Agent, Needs]));
      if (agentEids.length > 0) {
        const hungers = agentEids.map(eid => Needs.hunger[eid] ?? 50);
        const energies = agentEids.map(eid => Needs.energy[eid] ?? 50);
        snapshot.metrics.avgHunger = hungers.reduce((a, b) => a + b, 0) / hungers.length;
        snapshot.metrics.avgEnergy = energies.reduce((a, b) => a + b, 0) / energies.length;
      }

      // Sample custom component data
      for (const comp of components) {
        const dynComp = getDynamicComponent(comp.name);
        if (dynComp && entities.length > 0) {
          const sampleEid = entities[0].id;
          const values = getDynamicComponentValues(comp.name, sampleEid);
          if (values && Object.values(values).some(v => v !== undefined)) {
            snapshot.componentSamples[comp.name] = values;
          }
        }
      }

      snapshots.push(snapshot);

      // Print progress
      console.log(`--- Tick ${tick}/${TOTAL_TICKS} ---`);
      if (snapshot.metrics.avgHunger !== undefined) {
        console.log(`   Avg Hunger: ${snapshot.metrics.avgHunger.toFixed(1)}, Avg Energy: ${snapshot.metrics.avgEnergy?.toFixed(1)}`);
      }
      if (logs.length > 0) {
        for (const log of logs.slice(0, 3)) {
          console.log(`   ${log}`);
          // Track interesting moments
          if (log.toLowerCase().includes("died") ||
              log.toLowerCase().includes("critical") ||
              log.toLowerCase().includes("starv") ||
              log.toLowerCase().includes("born") ||
              log.toLowerCase().includes("reproduced")) {
            interestingMoments.push(`Tick ${tick}: ${log}`);
          }
        }
        if (logs.length > 3) {
          console.log(`   ... and ${logs.length - 3} more logs`);
        }
      }
      if (Object.keys(snapshot.componentSamples).length > 0) {
        console.log(`   Custom data: ${JSON.stringify(snapshot.componentSamples)}`);
      }
    }

    // Check for critical events
    for (const log of logs) {
      if (log.toLowerCase().includes("died") || log.toLowerCase().includes("critical")) {
        interestingMoments.push(`Tick ${tick}: ${log}`);
      }
    }
  }

  const duration = Date.now() - startTime;

  // ═══════════════════════════════════════════════════════════════
  // PHASE 3: Analysis
  // ═══════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PHASE 3: Simulation Analysis");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const analysis: SimulationAnalysis = {
    totalTicks: TOTAL_TICKS,
    durationMs: duration,
    entityCountChange: 0, // Would need entity creation/destruction tracking
    totalLogs: snapshots.reduce((sum, s) => sum + s.systemLogs.length, 0),
    totalEvents: snapshots.reduce((sum, s) => sum + s.events.length, 0),
    dataVolatility: 0,
    interestingMoments,
    finalState: "",
  };

  // Calculate data volatility (how much values changed)
  if (snapshots.length >= 2) {
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];

    let changes = 0;
    let comparisons = 0;

    // Compare needs
    if (first.metrics.avgHunger !== undefined && last.metrics.avgHunger !== undefined) {
      changes += Math.abs((last.metrics.avgHunger - first.metrics.avgHunger) / 100);
      comparisons++;
    }
    if (first.metrics.avgEnergy !== undefined && last.metrics.avgEnergy !== undefined) {
      changes += Math.abs((last.metrics.avgEnergy - first.metrics.avgEnergy) / 100);
      comparisons++;
    }

    analysis.dataVolatility = comparisons > 0 ? (changes / comparisons) : 0;
  }

  console.log("Simulation Statistics:");
  console.log(`  - Duration: ${(duration / 1000).toFixed(1)}s for ${TOTAL_TICKS} ticks`);
  console.log(`  - Avg tick time: ${(duration / TOTAL_TICKS).toFixed(1)}ms`);
  console.log(`  - Total log messages: ${analysis.totalLogs}`);
  console.log(`  - Total events: ${analysis.totalEvents}`);
  console.log(`  - Data volatility: ${(analysis.dataVolatility * 100).toFixed(1)}%`);

  // Track needs over time
  console.log("\nNeeds Evolution (avg hunger over time):");
  const hungerTrend = snapshots
    .filter(s => s.metrics.avgHunger !== undefined)
    .map(s => ({ tick: s.tick, hunger: s.metrics.avgHunger! }));

  if (hungerTrend.length > 0) {
    for (const point of hungerTrend) {
      const bar = "█".repeat(Math.floor(point.hunger / 5));
      console.log(`  Tick ${point.tick.toString().padStart(3)}: ${bar} ${point.hunger.toFixed(1)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 4: Ask GodAI to Reflect
  // ═══════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PHASE 4: GodAI Reflection");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const reflectPrompt = `
    The village simulation has run for ${TOTAL_TICKS} ticks. Here's what happened:
    - Total log messages: ${analysis.totalLogs}
    - Data volatility: ${(analysis.dataVolatility * 100).toFixed(1)}%
    - Interesting moments: ${interestingMoments.length > 0 ? interestingMoments.join("; ") : "none recorded"}

    ${hungerTrend.length > 0 ? `Average hunger went from ${hungerTrend[0].hunger.toFixed(1)} to ${hungerTrend[hungerTrend.length-1].hunger.toFixed(1)}` : ""}

    Reflect on:
    1. Did the simulation behave as intended?
    2. Were there any emergent behaviors?
    3. Was it stable or did it collapse?
    4. What would you change to make it more interesting?

    Be concise but insightful.
  `;

  await godCommand(god, reflectPrompt);
  const reflection = god.thinkingLog[god.thinkingLog.length - 1];

  console.log("GodAI's Reflection:");
  console.log("─".repeat(60));
  console.log(reflection?.slice(0, 1000) || "No reflection provided");
  console.log("─".repeat(60));

  // ═══════════════════════════════════════════════════════════════
  // FINAL REPORT
  // ═══════════════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  TEST COMPLETE - Long-Running Report                         ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // Determine simulation health
  let health = "UNKNOWN";
  if (analysis.totalLogs === 0 && analysis.dataVolatility < 0.01) {
    health = "STATIC - No activity detected";
  } else if (analysis.dataVolatility > 0.5) {
    health = "VOLATILE - High fluctuation (may be unstable)";
  } else if (analysis.totalLogs > 10 && analysis.dataVolatility > 0.05) {
    health = "HEALTHY - Active with reasonable stability";
  } else if (analysis.totalLogs > 0) {
    health = "ACTIVE - Some activity detected";
  }

  console.log("Simulation Health Assessment:");
  console.log(`  Status: ${health}`);
  console.log(`  Total runtime: ${(duration / 1000).toFixed(1)} seconds`);
  console.log(`  Ticks simulated: ${TOTAL_TICKS}`);
  console.log(`  Activity level: ${analysis.totalLogs} logs, ${analysis.totalEvents} events`);

  if (interestingMoments.length > 0) {
    console.log("\nNotable Moments:");
    for (const moment of interestingMoments.slice(0, 10)) {
      console.log(`  - ${moment}`);
    }
  }

  console.log("\nQualitative Assessment:");
  const scores = {
    systemsCreated: god.fileSystems.length >= 2 ? "✓" : "✗",
    producesOutput: analysis.totalLogs > 0 ? "✓" : "✗",
    dataEvolves: analysis.dataVolatility > 0.01 ? "✓" : "✗",
    staysStable: health.includes("HEALTHY") || health.includes("ACTIVE") ? "✓" : "✗",
  };

  console.log(`  - Created behavioral systems: ${scores.systemsCreated}`);
  console.log(`  - Produces observable output: ${scores.producesOutput}`);
  console.log(`  - Data evolves over time: ${scores.dataEvolves}`);
  console.log(`  - Maintains stability: ${scores.staysStable}`);

  console.log("\n--- Final World State ---");
  console.log(getWorldState(god).slice(0, 2000) + "...");

  console.log("\n✅ Long-running test complete!");

  return {
    analysis,
    health,
    snapshots: snapshots.length,
    interestingMoments,
  };
}

runLongRunningTest().catch(console.error);
