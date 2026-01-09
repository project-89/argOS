/**
 * Behavioral Test 05: Interventions & Propositions
 *
 * Tests GodAI's ability to use the new TinyTroupe-inspired systems:
 * - Create interventions (event-driven precondition → effect rules)
 * - Create propositions (validation/scoring claims about entities)
 * - Use these together to build reactive, self-monitoring simulations
 *
 * Run with: npx tsx src/behavioral-tests/05-interventions-propositions.ts
 */

import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, resetRoomPositionCounter } from "../ecs/prefabs";
import { createGodAgent, godThink, godCommand, tickWorld, GodAgentState } from "../god/god-agent";
import { listInterventions } from "../ecs/interventions";
import { listPropositions, evaluateAllPropositions, getCategoryReport } from "../ecs/propositions";

const PROMPT = `You are building a POWER PLANT simulation with reactive safety systems.

Create the following:

1. ENTITIES:
   - A "Reactor" entity with Temperature (current: 50, target: 80)
   - A "CoolingTower" entity with Temperature (current: 30, target: 30)
   - A "ControlRoom" entity with AlertLevel (level: 0)

2. INTERVENTIONS (reactive rules):
   - "OverheatAlert": When Reactor Temperature current > 90, emit an event "overheat_warning"
   - "EmergencyCooldown": When Reactor Temperature current > 100, set it back to 80 and log "EMERGENCY COOLDOWN ACTIVATED"
   - "AlertEscalation": When ControlRoom AlertLevel level >= 3, log "CRITICAL ALERT - EVACUATION REQUIRED"

3. PROPOSITIONS (validation checks):
   - "ReactorSafe": Claim that Reactor Temperature current is in_range 40-95, category "safety"
   - "CoolingEfficient": Claim that CoolingTower Temperature current < 50, category "efficiency"
   - "AlertsManaged": Claim that ControlRoom AlertLevel level < 3, category "operations"

4. SYSTEMS (to make things dynamic):
   - A system that gradually increases Reactor Temperature current by 5 each tick (simulating heat generation)

After creating everything, evaluate all propositions and tell me the current validation report.

Remember: Use createIntervention, createProposition, defineComponent, createEntity, and createSystem tools.`;

async function runTest() {
  console.log("\n" + "=".repeat(60));
  console.log("Behavioral Test 05: Interventions & Propositions");
  console.log("=".repeat(60) + "\n");

  const world = createArgosWorld("PowerPlantSim");
  initializePrefabs(world);
  resetRoomPositionCounter();

  const state = createGodAgent(world, {
    name: "PowerPlantGod",
    worldName: "PowerPlantSim",
    narrative: "A power plant with reactive safety systems and continuous monitoring",
  });

  console.log("📋 Prompt given to GodAI:");
  console.log("-".repeat(40));
  console.log(PROMPT.slice(0, 500) + "...\n");

  // Let GodAI think and act
  console.log("🤖 GodAI is working...\n");
  const startTime = Date.now();

  let totalActions = 0;
  let iterations = 0;
  const MAX_ITERATIONS = 10;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const prompt = iterations === 1 ? PROMPT : "Continue building the simulation. When done, evaluate all propositions.";
    const actions = await godCommand(state, prompt);

    console.log(`\n--- Iteration ${iterations} ---`);
    console.log(`Actions taken: ${actions.length}`);

    for (const action of actions) {
      console.log(`  • ${action.tool}: ${JSON.stringify(action.result).slice(0, 100)}`);
    }

    totalActions += actions.length;

    // Check if we have what we need
    const interventions = listInterventions(state.interventionRegistry);
    const propositions = listPropositions(state.propositionRegistry);
    const hasSystems = state.fileSystems.length > 0;

    console.log(`\nProgress: ${interventions.length} interventions, ${propositions.length} propositions, ${state.fileSystems.length} systems`);

    // If we have enough, break
    if (interventions.length >= 2 && propositions.length >= 2 && hasSystems) {
      console.log("\n✅ Sufficient components created, finishing...");
      break;
    }

    // Also break if GodAI took no actions (might be done)
    if (actions.length === 0) {
      console.log("\n⚠️ No actions taken, may be done");
      break;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n⏱️ Completed in ${elapsed}s with ${totalActions} total actions\n`);

  // Analyze what was created
  console.log("=".repeat(40));
  console.log("ANALYSIS: What GodAI Built");
  console.log("=".repeat(40) + "\n");

  // Interventions
  const interventions = listInterventions(state.interventionRegistry);
  console.log(`📌 INTERVENTIONS (${interventions.length}):`);
  for (const int of interventions) {
    console.log(`  • ${int.name}: ${int.description}`);
    console.log(`    Conditions: ${int.conditions.length}, Effects: ${int.effects.length}, Active: ${int.active}`);
  }

  // Propositions
  const propositions = listPropositions(state.propositionRegistry);
  console.log(`\n📋 PROPOSITIONS (${propositions.length}):`);
  for (const prop of propositions) {
    console.log(`  • ${prop.name}: "${prop.claim}"`);
    console.log(`    Target: ${prop.target}, Checks: ${prop.checks.length}, Category: ${prop.category}`);
  }

  // Systems
  console.log(`\n⚙️ SYSTEMS (${state.fileSystems.length}):`);
  for (const sys of state.fileSystems) {
    console.log(`  • ${sys.name}: ${sys.description}`);
  }

  // Run a few ticks to see interventions fire
  console.log("\n" + "=".repeat(40));
  console.log("SIMULATION: Running 5 ticks");
  console.log("=".repeat(40) + "\n");

  for (let tick = 1; tick <= 5; tick++) {
    const events = tickWorld(state, 1000);
    console.log(`Tick ${tick}:`);

    // Show intervention events
    const intEvents = state.interventionRegistry.events.slice(-5);
    for (const evt of intEvents) {
      console.log(`  📣 Event: ${evt.type}`);
    }

    // Show intervention logs
    const recentLogs = state.interventionRegistry.logs.slice(-3);
    for (const log of recentLogs) {
      console.log(`  📝 ${log}`);
    }

    // Clear for next tick
    state.interventionRegistry.logs.length = 0;
    state.interventionRegistry.events.length = 0;
  }

  // Evaluate propositions
  console.log("\n" + "=".repeat(40));
  console.log("VALIDATION: Proposition Results");
  console.log("=".repeat(40) + "\n");

  const results = evaluateAllPropositions(state.world, state.propositionRegistry);
  for (const [name, propResults] of results) {
    for (const result of propResults) {
      const status = result.passed ? "✅ PASS" : "❌ FAIL";
      console.log(`${status} ${name} (${result.target}): Score ${result.score}/9`);
      for (const check of result.checkResults) {
        const checkStatus = check.passed ? "✓" : "✗";
        console.log(`    ${checkStatus} ${check.check}: ${check.actualValue} vs ${check.expectedValue}`);
      }
    }
  }

  // Category report
  const report = getCategoryReport(state.propositionRegistry);
  console.log("\n📊 Category Report:");
  for (const [category, data] of Object.entries(report)) {
    console.log(`  ${category}: avg=${data.avg}/9 (${data.count} checks)`);
  }

  // Summary
  console.log("\n" + "=".repeat(40));
  console.log("TEST SUMMARY");
  console.log("=".repeat(40));
  console.log(`✓ Interventions created: ${interventions.length}`);
  console.log(`✓ Propositions created: ${propositions.length}`);
  console.log(`✓ Systems created: ${state.fileSystems.length}`);
  console.log(`✓ Total actions: ${totalActions}`);
  console.log(`✓ Time: ${elapsed}s`);

  const success = interventions.length >= 1 && propositions.length >= 1;
  console.log(`\n${success ? "🎉 TEST PASSED" : "💥 TEST FAILED"}: GodAI ${success ? "successfully" : "failed to"} use intervention and proposition systems\n`);
}

runTest().catch(console.error);
