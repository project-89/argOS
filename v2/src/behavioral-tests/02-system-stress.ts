/**
 * Behavioral Test 02: System Stress Test
 *
 * GOAL: Push GodAI to create multiple interacting systems and observe:
 * - How it handles system dependencies
 * - Whether systems interact correctly
 * - Performance under multiple concurrent systems
 * - Error handling and self-correction
 *
 * This tests GodAI's ability to design modular, interacting systems.
 */

import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, resetRoomPositionCounter } from "../ecs/prefabs";
import { createGodAgent, godCommand, tickWorld, getWorldState } from "../god/god-agent";
import { listDynamicComponents, getDynamicComponentValues } from "../ecs/dynamic-components";

interface SystemMetrics {
  name: string;
  ticksRun: number;
  logsEmitted: number;
  eventsEmitted: number;
  errors: string[];
}

const systemMetrics: Map<string, SystemMetrics> = new Map();

function trackSystem(name: string) {
  if (!systemMetrics.has(name)) {
    systemMetrics.set(name, {
      name,
      ticksRun: 0,
      logsEmitted: 0,
      eventsEmitted: 0,
      errors: [],
    });
  }
}

async function runSystemStressTest() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Behavioral Test 02: System Stress Test                      ║");
  console.log("║  Testing multiple interacting systems                        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const world = createArgosWorld("SystemStressTest");
  initializePrefabs(world);
  resetRoomPositionCounter();

  const god = createGodAgent(world, {
    name: "SystemArchitect",
    worldName: "System Factory",
    narrative: "A testing ground for complex system interactions.",
  });

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("PHASE 1: Request Multiple Interacting Systems");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const stressPrompt = `
    I need you to create a FACTORY SIMULATION with multiple interacting systems.

    Requirements:
    1. Create a custom "Resource" component with: type (string), amount (number), maxAmount (number)
    2. Create a custom "Machine" component with: state (string), efficiency (number), inputType (string), outputType (string)
    3. Create a custom "Storage" component with: capacity (number), currentLoad (number)

    Entities needed:
    - "Iron Mine" - produces iron ore
    - "Smelter" - converts iron ore to iron ingots
    - "Storage Depot" - stores resources
    - "Power Plant" - provides power (affects efficiency)

    Systems needed:
    1. "ResourceProduction" - Mines/generators produce resources over time
    2. "MachineProcessing" - Machines convert input resources to output resources
    3. "ResourceTransfer" - Resources move from producers to storage to consumers
    4. "PowerManagement" - Power affects machine efficiency

    These systems should INTERACT:
    - Production creates resources
    - Processing consumes one resource and produces another
    - Transfer moves resources between entities
    - Power affects how fast everything runs

    Build all of this! Don't ask questions - make reasonable assumptions.
  `;

  console.log("Sending factory simulation request to GodAI...\n");
  const startTime = Date.now();
  const result = await godCommand(god, stressPrompt);
  const phase1Time = Date.now() - startTime;

  console.log(`\n[PHASE 1 COMPLETE] ${result.length} actions in ${phase1Time}ms\n`);

  // Check what was created
  const entities = god.tools.listEntities().result as Array<{ name: string; id: number }>;
  const dynamicComponents = listDynamicComponents();

  console.log("Created entities:", entities.map(e => e.name).join(", "));
  console.log("Created components:", dynamicComponents.map(c => c.name).join(", "));
  console.log("Created systems:", god.fileSystems.map(s => s.name).join(", "));

  // Initialize tracking for all systems
  for (const sys of god.fileSystems) {
    trackSystem(sys.name);
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PHASE 2: Run Systems and Monitor Interactions");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const tickData: Array<{
    tick: number;
    logs: string[];
    events: any[];
    entityStates: Record<string, any>;
  }> = [];

  // Run 50 ticks and collect data
  for (let tick = 1; tick <= 50; tick++) {
    const events = tickWorld(god, 1000);
    const logs = god.systemRegistry.logs.splice(0);

    // Collect entity states at certain intervals
    const entityStates: Record<string, any> = {};
    if (tick % 10 === 0 || tick === 1) {
      for (const entity of entities) {
        entityStates[entity.name] = {};
        for (const comp of dynamicComponents) {
          const values = getDynamicComponentValues(comp.name, entity.id);
          if (values && Object.values(values).some(v => v !== undefined)) {
            entityStates[entity.name][comp.name] = values;
          }
        }
      }
    }

    tickData.push({ tick, logs, events, entityStates });

    // Update metrics
    for (const sys of god.fileSystems) {
      const metrics = systemMetrics.get(sys.name)!;
      metrics.ticksRun++;
      metrics.logsEmitted += logs.filter(l => l.includes(sys.name)).length;
      metrics.eventsEmitted += events.filter(e => e.system === sys.name).length;
    }

    // Print progress at intervals
    if (tick % 10 === 0 || logs.length > 0) {
      console.log(`--- Tick ${tick} ---`);
      if (logs.length > 0) {
        for (const log of logs.slice(0, 3)) {
          console.log(`   ${log}`);
        }
        if (logs.length > 3) console.log(`   ... and ${logs.length - 3} more`);
      }

      // Show some entity states
      if (Object.keys(entityStates).length > 0) {
        for (const [name, state] of Object.entries(entityStates)) {
          if (Object.keys(state).length > 0) {
            console.log(`   ${name}: ${JSON.stringify(state)}`);
          }
        }
      }
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PHASE 3: System Interaction Analysis");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Analyze system interactions
  const totalLogs = tickData.reduce((sum, t) => sum + t.logs.length, 0);
  const totalEvents = tickData.reduce((sum, t) => sum + t.events.length, 0);
  const ticksWithActivity = tickData.filter(t => t.logs.length > 0 || t.events.length > 0).length;

  console.log("System Activity Summary:");
  console.log(`  - Total log messages: ${totalLogs}`);
  console.log(`  - Total events: ${totalEvents}`);
  console.log(`  - Ticks with activity: ${ticksWithActivity}/50`);

  console.log("\nPer-System Metrics:");
  for (const [name, metrics] of systemMetrics) {
    console.log(`  ${name}:`);
    console.log(`    - Ticks run: ${metrics.ticksRun}`);
    console.log(`    - Logs: ${metrics.logsEmitted}`);
    console.log(`    - Events: ${metrics.eventsEmitted}`);
    if (metrics.errors.length > 0) {
      console.log(`    - Errors: ${metrics.errors.length}`);
    }
  }

  // Check for data changes over time
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PHASE 4: Data Evolution Check");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const firstState = tickData[0].entityStates;
  const lastState = tickData[tickData.length - 1].entityStates;

  console.log("State comparison (tick 1 vs tick 50):");
  let stateChanged = false;
  for (const entityName of Object.keys(firstState)) {
    const initial = firstState[entityName];
    const final = lastState[entityName];
    if (JSON.stringify(initial) !== JSON.stringify(final)) {
      stateChanged = true;
      console.log(`  ${entityName}:`);
      console.log(`    Initial: ${JSON.stringify(initial)}`);
      console.log(`    Final:   ${JSON.stringify(final)}`);
    }
  }

  if (!stateChanged) {
    console.log("  ⚠️  WARNING: No state changes detected - systems may not be modifying data");
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PHASE 5: Ask GodAI to Diagnose Issues");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const diagnosePrompt = `
    Look at the factory simulation you created. After running 50 ticks:
    - Total logs: ${totalLogs}
    - Total events: ${totalEvents}
    - State changes detected: ${stateChanged}

    ${!stateChanged ? "WARNING: No entity data changed during simulation!" : ""}

    1. Are the systems working correctly?
    2. Are they interacting as intended?
    3. If there are problems, what would you fix?

    Analyze and report briefly.
  `;

  await godCommand(god, diagnosePrompt);
  const diagnosis = god.thinkingLog[god.thinkingLog.length - 1];

  console.log("GodAI's Diagnosis:");
  console.log(diagnosis?.slice(0, 800) || "No diagnosis provided");

  // Final Report
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  TEST COMPLETE - Final Report                                ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const report = {
    testName: "System Stress Test",
    entitiesCreated: entities.length,
    customComponentsCreated: dynamicComponents.length,
    systemsCreated: god.fileSystems.length,
    totalTicks: 50,
    totalLogs,
    totalEvents,
    stateEvolutionDetected: stateChanged,
    systemsActive: god.fileSystems.filter(s => s.active).length,
  };

  console.log("Quantitative Results:");
  console.log(`  - Entities: ${report.entitiesCreated}`);
  console.log(`  - Components: ${report.customComponentsCreated}`);
  console.log(`  - Systems: ${report.systemsCreated}`);
  console.log(`  - Logs generated: ${report.totalLogs}`);
  console.log(`  - State evolution: ${report.stateEvolutionDetected ? "YES" : "NO"}`);

  console.log("\nQualitative Assessment:");
  const scores = {
    componentDesign: dynamicComponents.length >= 3 ? "✓" : "✗",
    systemCreation: god.fileSystems.length >= 2 ? "✓" : "✗",
    systemsProduceOutput: totalLogs > 0 ? "✓" : "✗",
    dataEvolution: stateChanged ? "✓" : "✗",
  };

  console.log(`  - Designed required components: ${scores.componentDesign}`);
  console.log(`  - Created multiple systems: ${scores.systemCreation}`);
  console.log(`  - Systems produce output: ${scores.systemsProduceOutput}`);
  console.log(`  - Data evolves over time: ${scores.dataEvolution}`);

  console.log("\n✅ Stress test complete!");

  return report;
}

runSystemStressTest().catch(console.error);
