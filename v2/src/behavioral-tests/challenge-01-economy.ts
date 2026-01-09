/**
 * Challenge 01: Self-Balancing Economy
 *
 * GOAL: Build an economy with producers, consumers, resources, and prices
 * that reaches equilibrium through feedback loops - NOT hardcoded balance.
 *
 * SUCCESS CRITERIA:
 * - Prices rise when resources are scarce
 * - Prices fall when resources are abundant
 * - System stabilizes without explicit equilibrium values
 * - Multiple interacting economic actors
 *
 * Run with: npx tsx src/behavioral-tests/challenge-01-economy.ts
 */

import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, resetRoomPositionCounter } from "../ecs/prefabs";
import { createGodAgent, godCommand, godDesignAndExecute, tickWorld, tickWorldAsync, getWorldState, type DesignDocument } from "../god/god-agent";
import { listInterventions } from "../ecs/interventions";
import { listPropositions, evaluateAllPropositions, getCategoryReport } from "../ecs/propositions";
import { listDynamicComponents, getDynamicComponent } from "../ecs/dynamic-components";
import { Name } from "../ecs/components";
import { query } from "bitecs";

const CHALLENGE_PROMPT = `
CHALLENGE: Self-Balancing Economy

Build an economy simulation with these requirements:

1. RESOURCES: At least 2 types (e.g., Food, Wood, Gold)

2. PRODUCERS: Entities that create resources over time
   - Farms produce Food
   - Lumber mills produce Wood
   - Mines produce Gold

3. CONSUMERS: Entities that consume resources
   - Villages consume Food
   - Builders consume Wood

4. MARKET with PRICES:
   - Each resource has a Price
   - Track Supply (how much exists) and Demand (how much is wanted)

5. FEEDBACK LOOPS (the hard part):
   - When Supply < Demand → Price increases
   - When Supply > Demand → Price decreases
   - High prices → producers make more (incentive)
   - High prices → consumers buy less
   - Low prices → opposite effects

6. NO HARDCODED EQUILIBRIUM:
   - Don't set "target price = 50"
   - Let the system find its own balance through the feedback loops

Create all necessary components, entities, systems, and interventions.
The economy should naturally stabilize after some fluctuation.

After building, run a few ticks and show me the price/supply dynamics.
`;

interface EconomySnapshot {
  tick: number;
  resources: Record<string, { supply: number; price: number; demand?: number }>;
  entities: string[];
}

async function runChallenge() {
  console.log("\n" + "═".repeat(70));
  console.log("  CHALLENGE 01: Self-Balancing Economy");
  console.log("═".repeat(70) + "\n");

  const world = createArgosWorld("EconomySim");
  initializePrefabs(world);
  resetRoomPositionCounter();

  const state = createGodAgent(world, {
    name: "EconomyArchitect",
    worldName: "EconomySim",
    narrative: "A dynamic economy seeking equilibrium through market forces",
  });

  console.log("📋 CHALLENGE PROMPT:");
  console.log("-".repeat(50));
  console.log(CHALLENGE_PROMPT);
  console.log("-".repeat(50) + "\n");

  // Phase 1: Design and Build using multi-model approach
  console.log("🏗️  PHASE 1: Design & Build (Pro thinks, Flash executes)\n");
  const startTime = Date.now();

  // Use the new design-first approach
  const { design, reasoning, actions } = await godDesignAndExecute(state, CHALLENGE_PROMPT);
  const totalActions = actions.length;

  // Show the design if we got one
  if (design) {
    console.log("\n📐 DESIGN DOCUMENT:");
    console.log("-".repeat(50));
    console.log(`Summary: ${design.summary}`);
    console.log(`\nComponents (${design.components?.length || 0}):`);
    for (const c of design.components || []) {
      console.log(`  • ${c.name}: ${c.purpose}`);
      console.log(`    Properties: ${Object.entries(c.properties).map(([k,v]) => `${k}:${v}`).join(', ')}`);
    }
    console.log(`\nEntities (${design.entities?.length || 0}):`);
    for (const e of design.entities || []) {
      console.log(`  • ${e.name} (${e.type}): [${e.components.join(', ')}]`);
    }
    console.log(`\nSystems (${design.systems?.length || 0}):`);
    for (const s of design.systems || []) {
      console.log(`  • ${s.name}: ${s.purpose}`);
      console.log(`    Logic: ${s.logic.slice(0, 100)}...`);
    }
    if (design.feedbackLoops?.length) {
      console.log(`\nFeedback Loops:`);
      for (const loop of design.feedbackLoops) {
        console.log(`  🔄 ${loop}`);
      }
    }
    console.log("-".repeat(50));
  }

  console.log(`\nExecution: ${totalActions} actions taken`);

  // Check what was actually created
  const componentsCreated = listDynamicComponents();
  const systemsCreated = state.fileSystems;
  const interventionsCreated = listInterventions(state.interventionRegistry);

  console.log(`\n✅ Created: ${componentsCreated.length} components, ${systemsCreated.length} systems, ${interventionsCreated.length} interventions\n`);

  const buildTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // Phase 2: Analyze what was built
  console.log("═".repeat(70));
  console.log("  PHASE 2: Analyzing the Economy");
  console.log("═".repeat(70) + "\n");

  const components = listDynamicComponents();
  console.log(`📦 COMPONENTS (${components.length}):`);
  for (const comp of components) {
    console.log(`  • ${comp.name}: ${Object.keys(comp.properties).join(", ")}`);
  }

  const entities = query(world, [Name]);
  console.log(`\n🏢 ENTITIES (${entities.length}):`);
  for (const eid of entities) {
    const name = Name.value[eid];
    if (name && !name.includes("God") && !name.includes("World")) {
      console.log(`  • ${name}`);
    }
  }

  console.log(`\n⚙️  SYSTEMS (${state.fileSystems.length}):`);
  for (const sys of state.fileSystems) {
    console.log(`  • ${sys.name}: ${sys.description}`);
  }

  const interventions = listInterventions(state.interventionRegistry);
  console.log(`\n🔔 INTERVENTIONS (${interventions.length}):`);
  for (const int of interventions) {
    console.log(`  • ${int.name}: ${int.description}`);
  }

  // Phase 3: Run the economy and observe
  console.log("\n" + "═".repeat(70));
  console.log("  PHASE 3: Running the Economy (20 ticks)");
  console.log("═".repeat(70) + "\n");

  const snapshots: EconomySnapshot[] = [];

  // Try to find price/supply components
  const priceComponent = getDynamicComponent("Price") || getDynamicComponent("Market") || getDynamicComponent("Resource");

  for (let tick = 1; tick <= 20; tick++) {
    // Use async tick to enable runtime error auto-fixing
    const { fixes } = await tickWorldAsync(state, 1000);
    if (fixes.fixed.length > 0) {
      console.log(`  🔧 Auto-fixed: ${fixes.fixed.join(', ')}`);
    }

    // Capture snapshot every 5 ticks
    if (tick % 5 === 0 || tick === 1) {
      const snapshot: EconomySnapshot = {
        tick,
        resources: {},
        entities: [],
      };

      // Try to extract economic data from various possible component structures
      for (const comp of listDynamicComponents()) {
        const dynComp = getDynamicComponent(comp.name);
        const compLower = comp.name.toLowerCase();

        // Match market/resource/price components
        if (dynComp && (compLower.includes("price") || compLower.includes("market") ||
            compLower.includes("resource") || compLower.includes("supply") || compLower.includes("economy"))) {

          // Find price property (could be named differently)
          const priceVal = (prop: string, eid: number) => {
            for (const key of Object.keys(comp.properties)) {
              if (key.includes("price") && dynComp[key]?.[eid] !== undefined) {
                return dynComp[key][eid];
              }
            }
            return undefined;
          };

          // Find supply property
          const supplyVal = (prop: string, eid: number) => {
            for (const key of Object.keys(comp.properties)) {
              if ((key.includes("supply") || key.includes("inventory") || key.includes("amount"))
                  && dynComp[key]?.[eid] !== undefined) {
                return dynComp[key][eid];
              }
            }
            return undefined;
          };

          // Find demand property
          const demandVal = (prop: string, eid: number) => {
            for (const key of Object.keys(comp.properties)) {
              if (key.includes("demand") && dynComp[key]?.[eid] !== undefined) {
                return dynComp[key][eid];
              }
            }
            return undefined;
          };

          for (const eid of query(world, [Name])) {
            const name = Name.value[eid];
            const price = priceVal('', eid);
            if (name && price !== undefined) {
              snapshot.resources[name] = {
                supply: supplyVal('', eid) ?? 0,
                price: price,
                demand: demandVal('', eid),
              };
            }
          }
        }
      }

      snapshots.push(snapshot);

      console.log(`Tick ${tick}:`);
      if (Object.keys(snapshot.resources).length > 0) {
        for (const [name, data] of Object.entries(snapshot.resources)) {
          console.log(`  ${name}: Supply=${data.supply}, Price=${data.price}${data.demand !== undefined ? `, Demand=${data.demand}` : ''}`);
        }
      } else {
        // Fallback: just show intervention logs
        const logs = state.interventionRegistry.logs.slice(-3);
        for (const log of logs) {
          console.log(`  📝 ${log}`);
        }
      }
    }

    // Clear intervention logs each tick
    state.interventionRegistry.logs.length = 0;
  }

  // Phase 4: Evaluate success
  console.log("\n" + "═".repeat(70));
  console.log("  PHASE 4: Evaluation");
  console.log("═".repeat(70) + "\n");

  // Check for feedback loops
  const hasPriceSystem = state.fileSystems.some(s =>
    s.name.toLowerCase().includes("price") ||
    s.description.toLowerCase().includes("price") ||
    s.description.toLowerCase().includes("supply") ||
    s.description.toLowerCase().includes("demand")
  );

  const hasSupplyDemandIntervention = interventions.some(i =>
    i.description.toLowerCase().includes("supply") ||
    i.description.toLowerCase().includes("demand") ||
    i.description.toLowerCase().includes("price")
  );

  const hasMultipleProducers = Array.from(query(world, [Name]))
    .filter(eid => {
      const name = Name.value[eid]?.toLowerCase() || "";
      return name.includes("farm") || name.includes("mill") || name.includes("mine") || name.includes("producer");
    }).length >= 2;

  const hasMultipleConsumers = Array.from(query(world, [Name]))
    .filter(eid => {
      const name = Name.value[eid]?.toLowerCase() || "";
      return name.includes("village") || name.includes("consumer") || name.includes("builder");
    }).length >= 1;

  console.log("📊 SUCCESS CRITERIA:");
  console.log(`  ${hasPriceSystem ? "✅" : "❌"} Has price adjustment system`);
  console.log(`  ${hasSupplyDemandIntervention ? "✅" : "❌"} Has supply/demand interventions`);
  console.log(`  ${hasMultipleProducers ? "✅" : "❌"} Has multiple producers`);
  console.log(`  ${hasMultipleConsumers ? "✅" : "❌"} Has consumers`);
  console.log(`  ${components.length >= 3 ? "✅" : "❌"} Has sufficient component complexity (${components.length})`);
  console.log(`  ${state.fileSystems.length >= 2 ? "✅" : "❌"} Has multiple systems (${state.fileSystems.length})`);

  const score = [
    hasPriceSystem,
    hasSupplyDemandIntervention,
    hasMultipleProducers,
    hasMultipleConsumers,
    components.length >= 3,
    state.fileSystems.length >= 2
  ].filter(Boolean).length;

  console.log(`\n📈 SCORE: ${score}/6`);

  // Summary
  console.log("\n" + "═".repeat(70));
  console.log("  SUMMARY");
  console.log("═".repeat(70));
  console.log(`  Build time: ${buildTime}s`);
  console.log(`  Total actions: ${totalActions}`);
  console.log(`  Components created: ${components.length}`);
  console.log(`  Systems created: ${state.fileSystems.length}`);
  console.log(`  Interventions created: ${interventions.length}`);
  console.log(`  Score: ${score}/6`);

  const passed = score >= 4;
  console.log(`\n  ${passed ? "🎉 CHALLENGE PASSED" : "💥 CHALLENGE FAILED"}`);
  console.log("═".repeat(70) + "\n");

  // Ask GodAI to reflect on what it built
  console.log("🤔 GodAI's Reflection:\n");
  const reflection = await godCommand(state,
    "Briefly explain: Did the economy reach equilibrium? What feedback loops did you create? What would you improve?"
  );

  return { passed, score, buildTime, totalActions };
}

runChallenge().catch(console.error);
