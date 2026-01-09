/**
 * Behavioral Test 01: Ecosystem Builder
 *
 * GOAL: Give GodAI an open-ended goal and observe:
 * - What entities it creates
 * - What custom components it designs
 * - What systems it builds
 * - How it reasons through the problem
 *
 * This tests the GodAI's ability to creatively use primitives
 * to build complex, interacting systems without hand-holding.
 */

import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, resetRoomPositionCounter } from "../ecs/prefabs";
import { createGodAgent, godCommand, tickWorld, getWorldState } from "../god/god-agent";
import { listDynamicComponents } from "../ecs/dynamic-components";

interface TestObservation {
  timestamp: number;
  phase: string;
  observation: string;
  data?: any;
}

const observations: TestObservation[] = [];

function observe(phase: string, observation: string, data?: any) {
  const entry: TestObservation = {
    timestamp: Date.now(),
    phase,
    observation,
    data,
  };
  observations.push(entry);
  console.log(`[${phase}] ${observation}`);
  if (data) {
    console.log("   Data:", JSON.stringify(data, null, 2).split("\n").map(l => "   " + l).join("\n"));
  }
}

async function runEcosystemTest() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Behavioral Test 01: Ecosystem Builder                       ║");
  console.log("║  Testing GodAI's ability to design complex systems           ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // Setup
  const world = createArgosWorld("EcosystemTest");
  initializePrefabs(world);
  resetRoomPositionCounter();

  const god = createGodAgent(world, {
    name: "EcoArchitect",
    worldName: "Ecosystem Sandbox",
    narrative: "A blank canvas for creating living systems.",
  });

  observe("SETUP", "World initialized, GodAgent ready");

  // Phase 1: Open-ended ecosystem request
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PHASE 1: Open-Ended Ecosystem Request");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const ecosystemPrompt = `
    I want you to create a simple ecosystem simulation. Think about:
    - What kinds of entities would exist in an ecosystem?
    - What properties/data would they need?
    - What behaviors/systems would govern their interactions?

    Design and build a small but functional ecosystem from scratch.
    Use custom components where built-in ones don't fit.
    Create systems to drive the simulation dynamics.

    Don't ask questions - just make decisions and build something interesting!
  `;

  observe("PROMPT", "Sending open-ended ecosystem prompt to GodAI");
  const startTime = Date.now();

  const result = await godCommand(god, ecosystemPrompt);

  const elapsed = Date.now() - startTime;
  observe("RESPONSE", `GodAI responded in ${elapsed}ms`, {
    actionsExecuted: result.length,
    thinkingLength: god.thinkingLog[god.thinkingLog.length - 1]?.length || 0,
  });

  // Analyze what was created
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("ANALYSIS: What GodAI Created");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const entities = god.tools.listEntities().result as Array<{ name: string; id: number }>;
  observe("ENTITIES", `Created ${entities.length} entities`, entities.map(e => e.name));

  const dynamicComponents = listDynamicComponents();
  observe("CUSTOM_COMPONENTS", `Created ${dynamicComponents.length} custom components`,
    dynamicComponents.map(c => ({ name: c.name, properties: Object.keys(c.properties) })));

  observe("FILE_SYSTEMS", `Created ${god.fileSystems.length} file-based systems`,
    god.fileSystems.map(s => ({ name: s.name, description: s.description, frequency: s.frequency })));

  // Phase 2: Run the simulation and observe
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PHASE 2: Running Ecosystem Simulation");
  console.log("═══════════════════════════════════════════════════════════════\n");

  if (god.fileSystems.length === 0) {
    observe("WARNING", "No systems created - simulation won't evolve");
  } else {
    const tickSnapshots: any[] = [];

    for (let tick = 1; tick <= 30; tick++) {
      const events = tickWorld(god, 1000);
      const logs = god.systemRegistry.logs.splice(0);

      if (tick === 1 || tick === 10 || tick === 20 || tick === 30 || logs.length > 0 || events.length > 0) {
        const snapshot = {
          tick,
          events: events.length,
          logs: logs.slice(0, 5), // Cap at 5 logs per snapshot
        };
        tickSnapshots.push(snapshot);

        if (logs.length > 0) {
          console.log(`--- Tick ${tick} ---`);
          for (const log of logs.slice(0, 5)) {
            console.log(`   ${log}`);
          }
        }
      }
    }

    observe("SIMULATION", `Ran 30 ticks`, {
      snapshotsWithActivity: tickSnapshots.filter(s => s.logs.length > 0 || s.events > 0).length,
      totalLogs: tickSnapshots.reduce((sum, s) => sum + s.logs.length, 0),
      totalEvents: tickSnapshots.reduce((sum, s) => sum + s.events, 0),
    });
  }

  // Phase 3: Ask GodAI to explain what it built
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PHASE 3: GodAI Self-Explanation");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const explainPrompt = `
    Look at what you've built and explain:
    1. What is the core concept of this ecosystem?
    2. What entities exist and how do they interact?
    3. What systems drive the behavior?
    4. What emergent behaviors might we see over time?

    Be concise but insightful.
  `;

  const explanation = await godCommand(god, explainPrompt);
  const lastThinking = god.thinkingLog[god.thinkingLog.length - 1];

  observe("EXPLANATION", "GodAI's explanation of its creation", {
    responseLength: lastThinking?.length || 0,
    responseSnippet: lastThinking?.slice(0, 500) || "No response",
  });

  // Final Report
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  TEST COMPLETE - Final Report                                ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const report = {
    testName: "Ecosystem Builder",
    duration: Date.now() - startTime,
    entitiesCreated: entities.length,
    customComponentsCreated: dynamicComponents.length,
    systemsCreated: god.fileSystems.length,
    godMemorySize: god.memory.shortTerm.length + god.memory.longTerm.length,
    observations: observations.length,
  };

  console.log("Summary:");
  console.log(`  - Entities: ${report.entitiesCreated}`);
  console.log(`  - Custom Components: ${report.customComponentsCreated}`);
  console.log(`  - Systems: ${report.systemsCreated}`);
  console.log(`  - Test Duration: ${report.duration}ms`);
  console.log(`  - Observations Logged: ${report.observations}`);

  // Qualitative assessment
  console.log("\nQualitative Assessment:");

  const scores = {
    creativity: dynamicComponents.length > 0 ? "✓" : "✗",
    systemThinking: god.fileSystems.length > 0 ? "✓" : "✗",
    entityDiversity: entities.length >= 3 ? "✓" : "✗",
    selfAwareness: lastThinking && lastThinking.length > 100 ? "✓" : "✗",
  };

  console.log(`  - Created custom components: ${scores.creativity}`);
  console.log(`  - Created behavioral systems: ${scores.systemThinking}`);
  console.log(`  - Created diverse entities: ${scores.entityDiversity}`);
  console.log(`  - Explained its design: ${scores.selfAwareness}`);

  console.log("\n--- Full World State ---");
  console.log(getWorldState(god));

  console.log("\n✅ Behavioral test complete!");

  return {
    report,
    observations,
    worldState: getWorldState(god),
  };
}

// Run test
runEcosystemTest().catch(console.error);
