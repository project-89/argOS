/**
 * Challenge 02: Predator-Prey Ecosystem
 *
 * GOAL: Build a classic Lotka-Volterra style ecosystem with emergent
 * population dynamics - boom/bust cycles without hardcoded oscillation.
 *
 * SUCCESS CRITERIA:
 * - Prey population grows when predators are scarce
 * - Predator population grows when prey is abundant
 * - Population crashes/recoveries emerge naturally
 * - System doesn't collapse to extinction or explosion
 *
 * Run with: npx tsx src/behavioral-tests/challenge-02-predator-prey.ts
 */

import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, resetRoomPositionCounter } from "../ecs/prefabs";
import { createGodAgent, godDesignAndExecute, tickWorldAsync, type DesignDocument } from "../god/god-agent";
import { listInterventions } from "../ecs/interventions";
import { listDynamicComponents, getDynamicComponent } from "../ecs/dynamic-components";
import { Name } from "../ecs/components";
import { query } from "bitecs";

const CHALLENGE_PROMPT = `
CHALLENGE: Predator-Prey Ecosystem

Build a population dynamics simulation with these requirements:

1. THREE TROPHIC LEVELS:
   - Grass: Base resource, regrows over time
   - Rabbits: Eat grass, reproduce when well-fed, die when starving
   - Foxes: Eat rabbits, reproduce when well-fed, die when starving

2. POPULATION DYNAMICS:
   - Each species has a population count (not individual entities)
   - Grass grows at a constant rate, capped by carrying capacity
   - Rabbits consume grass proportional to their population
   - Foxes consume rabbits proportional to their population
   - Birth rate increases when food is abundant
   - Death rate increases when food is scarce

3. FEEDBACK LOOPS (Lotka-Volterra style):
   - More grass → more rabbit births
   - More rabbits → more fox births
   - More rabbits → less grass
   - More foxes → fewer rabbits
   - Fewer rabbits → fox starvation
   - Less grass → rabbit starvation

4. EMERGENT BEHAVIOR:
   - Population cycles should emerge naturally
   - Predator population should lag behind prey population
   - System should NOT require hardcoded oscillation values

5. STABILITY:
   - Populations should not go to zero (extinction)
   - Populations should not explode to infinity
   - Use minimum population thresholds and carrying capacities

Create components, entities, and systems to model this ecosystem.
The simulation should show population fluctuations over time.
`;

interface PopulationSnapshot {
  tick: number;
  grass: number;
  rabbits: number;
  foxes: number;
}

async function runChallenge() {
  console.log("\n" + "═".repeat(70));
  console.log("  CHALLENGE 02: Predator-Prey Ecosystem");
  console.log("═".repeat(70) + "\n");

  const world = createArgosWorld("Ecosystem");
  initializePrefabs(world);
  resetRoomPositionCounter();

  const state = createGodAgent(world, {
    name: "EcosystemArchitect",
    worldName: "Ecosystem",
    narrative: "A dynamic ecosystem with predator-prey dynamics",
  });

  console.log("📋 CHALLENGE PROMPT:");
  console.log("-".repeat(50));
  console.log(CHALLENGE_PROMPT);
  console.log("-".repeat(50) + "\n");

  // Phase 1: Design and Build
  console.log("🏗️  PHASE 1: Design & Build (Pro thinks, Flash executes)\n");
  const startTime = Date.now();

  const { design, reasoning, actions } = await godDesignAndExecute(state, CHALLENGE_PROMPT);
  const totalActions = actions.length;

  // Show the design
  if (design) {
    console.log("\n📐 DESIGN DOCUMENT:");
    console.log("-".repeat(50));
    console.log(`Summary: ${design.summary}`);
    console.log(`\nComponents (${design.components?.length || 0}):`);
    for (const c of design.components || []) {
      console.log(`  • ${c.name}: ${c.purpose}`);
    }
    console.log(`\nEntities (${design.entities?.length || 0}):`);
    for (const e of design.entities || []) {
      console.log(`  • ${e.name} (${e.type})`);
    }
    console.log(`\nSystems (${design.systems?.length || 0}):`);
    for (const s of design.systems || []) {
      console.log(`  • ${s.name}: ${s.purpose}`);
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

  const componentsCreated = listDynamicComponents();
  const systemsCreated = state.fileSystems;
  const interventionsCreated = listInterventions(state.interventionRegistry);

  console.log(`\n✅ Created: ${componentsCreated.length} components, ${systemsCreated.length} systems, ${interventionsCreated.length} interventions\n`);

  const buildTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // Phase 2: Analyze
  console.log("═".repeat(70));
  console.log("  PHASE 2: Analyzing the Ecosystem");
  console.log("═".repeat(70) + "\n");

  console.log(`📦 COMPONENTS (${componentsCreated.length}):`);
  for (const comp of componentsCreated) {
    console.log(`  • ${comp.name}: ${Object.keys(comp.properties).join(", ")}`);
  }

  const entities = query(world, [Name]);
  console.log(`\n🏢 ENTITIES (${entities.length}):`);
  for (const eid of entities) {
    const name = Name.value[eid];
    if (name && !name.includes("Architect")) {
      console.log(`  • ${name}`);
    }
  }

  console.log(`\n⚙️  SYSTEMS (${systemsCreated.length}):`);
  for (const sys of systemsCreated) {
    console.log(`  • ${sys.name}: ${sys.description}`);
  }

  // Phase 3: Run the simulation
  console.log("\n" + "═".repeat(70));
  console.log("  PHASE 3: Running the Ecosystem (50 ticks)");
  console.log("═".repeat(70) + "\n");

  const snapshots: PopulationSnapshot[] = [];

  // Try to find population component
  const Population = getDynamicComponent("Population") ||
                     getDynamicComponent("Species") ||
                     getDynamicComponent("Ecosystem");

  for (let tick = 1; tick <= 50; tick++) {
    const { fixes } = await tickWorldAsync(state, 1000);
    if (fixes.fixed.length > 0) {
      console.log(`  🔧 Auto-fixed: ${fixes.fixed.join(', ')}`);
    }

    // Capture snapshot every 10 ticks
    if (tick % 10 === 0 || tick === 1) {
      const snapshot: PopulationSnapshot = {
        tick,
        grass: 0,
        rabbits: 0,
        foxes: 0,
      };

      // Try to extract population data - look for Population.current or similar
      const Population = getDynamicComponent("Population");
      const populationProp = Population ?
        (Population.current ? "current" :
         Population.count ? "count" :
         Population.population ? "population" :
         Population.value ? "value" : null) : null;

      for (const eid of query(world, [Name])) {
        const name = Name.value[eid]?.toLowerCase() || "";

        // Prefer Population.current for population tracking
        if (Population && populationProp) {
          const val = Population[populationProp]?.[eid];
          if (val !== undefined && typeof val === 'number') {
            if (name.includes("grass") || name.includes("resource") || name.includes("plant")) {
              snapshot.grass = val;
            } else if (name.includes("rabbit") || name.includes("prey") || name.includes("herbivore")) {
              snapshot.rabbits = val;
            } else if (name.includes("fox") || name.includes("predator") || name.includes("wolf")) {
              snapshot.foxes = val;
            }
          }
        } else {
          // Fallback: search through all components for population-like properties
          for (const comp of listDynamicComponents()) {
            const dynComp = getDynamicComponent(comp.name);
            if (!dynComp) continue;

            // Only look at population/count/level properties, not all properties
            for (const prop of Object.keys(comp.properties)) {
              if (!prop.includes("current") && !prop.includes("count") &&
                  !prop.includes("population") && !prop.includes("level") &&
                  !prop.includes("amount")) continue;

              const val = dynComp[prop]?.[eid];
              if (val !== undefined && typeof val === 'number') {
                if (name.includes("grass") || name.includes("resource")) {
                  snapshot.grass = val;
                  break; // Found population for this entity, stop searching
                } else if (name.includes("rabbit") || name.includes("prey")) {
                  snapshot.rabbits = val;
                  break;
                } else if (name.includes("fox") || name.includes("predator")) {
                  snapshot.foxes = val;
                  break;
                }
              }
            }
          }
        }
      }

      snapshots.push(snapshot);

      // Visual representation
      const grassBar = "🌿".repeat(Math.min(Math.floor(snapshot.grass / 100), 10));
      const rabbitBar = "🐰".repeat(Math.min(Math.floor(snapshot.rabbits / 10), 10));
      const foxBar = "🦊".repeat(Math.min(Math.floor(snapshot.foxes / 5), 10));

      console.log(`Tick ${tick.toString().padStart(2)}:`);
      console.log(`  Grass:   ${snapshot.grass.toFixed(0).padStart(6)} ${grassBar}`);
      console.log(`  Rabbits: ${snapshot.rabbits.toFixed(0).padStart(6)} ${rabbitBar}`);
      console.log(`  Foxes:   ${snapshot.foxes.toFixed(0).padStart(6)} ${foxBar}`);
    }

    // Print system logs periodically
    if (tick % 10 === 0) {
      const logs = state.systemRegistry.logs.slice(-3);
      for (const log of logs) {
        if (log.includes("[System]")) {
          console.log(`  📝 ${log.replace("[System] ", "")}`);
        }
      }
      state.systemRegistry.logs.length = 0;
    }
  }

  // Phase 4: Evaluate
  console.log("\n" + "═".repeat(70));
  console.log("  PHASE 4: Evaluation");
  console.log("═".repeat(70) + "\n");

  // Check for key characteristics
  const hasPopulationTracking = componentsCreated.some(c =>
    c.name.toLowerCase().includes("population") ||
    Object.keys(c.properties).some(p => p.includes("count") || p.includes("population"))
  );

  const hasGrowthSystem = systemsCreated.some(s =>
    s.name.toLowerCase().includes("growth") ||
    s.description.toLowerCase().includes("grow") ||
    s.description.toLowerCase().includes("birth")
  );

  const hasDeathSystem = systemsCreated.some(s =>
    s.name.toLowerCase().includes("death") ||
    s.name.toLowerCase().includes("starv") ||
    s.description.toLowerCase().includes("die") ||
    s.description.toLowerCase().includes("death")
  );

  const hasPredationSystem = systemsCreated.some(s =>
    s.name.toLowerCase().includes("predat") ||
    s.name.toLowerCase().includes("hunt") ||
    s.name.toLowerCase().includes("eat") ||
    s.description.toLowerCase().includes("eat") ||
    s.description.toLowerCase().includes("consume")
  );

  const hasMultipleSpecies = query(world, [Name]).filter(eid => {
    const name = Name.value[eid]?.toLowerCase() || "";
    return name.includes("rabbit") || name.includes("fox") || name.includes("grass") ||
           name.includes("prey") || name.includes("predator");
  }).length >= 2;

  // Check for population changes (indicates dynamics)
  const hasPopulationChanges = snapshots.length > 1 &&
    (snapshots.some(s => s.rabbits !== snapshots[0].rabbits) ||
     snapshots.some(s => s.foxes !== snapshots[0].foxes));

  console.log("📊 SUCCESS CRITERIA:");
  console.log(`  ${hasPopulationTracking ? "✅" : "❌"} Has population tracking`);
  console.log(`  ${hasGrowthSystem ? "✅" : "❌"} Has growth/birth system`);
  console.log(`  ${hasDeathSystem ? "✅" : "❌"} Has death/starvation system`);
  console.log(`  ${hasPredationSystem ? "✅" : "❌"} Has predation/consumption system`);
  console.log(`  ${hasMultipleSpecies ? "✅" : "❌"} Has multiple species`);
  console.log(`  ${hasPopulationChanges ? "✅" : "❌"} Shows population dynamics`);

  const score = [
    hasPopulationTracking,
    hasGrowthSystem,
    hasDeathSystem,
    hasPredationSystem,
    hasMultipleSpecies,
    hasPopulationChanges
  ].filter(Boolean).length;

  console.log(`\n📈 SCORE: ${score}/6`);

  // Summary
  console.log("\n" + "═".repeat(70));
  console.log("  SUMMARY");
  console.log("═".repeat(70));
  console.log(`  Build time: ${buildTime}s`);
  console.log(`  Total actions: ${totalActions}`);
  console.log(`  Components created: ${componentsCreated.length}`);
  console.log(`  Systems created: ${systemsCreated.length}`);
  console.log(`  Interventions created: ${interventionsCreated.length}`);
  console.log(`  Score: ${score}/6`);

  const passed = score >= 4;
  console.log(`\n  ${passed ? "🎉 CHALLENGE PASSED" : "💥 CHALLENGE FAILED"}`);
  console.log("═".repeat(70) + "\n");

  // Population dynamics visualization
  if (snapshots.length > 1 && (snapshots[0].rabbits > 0 || snapshots[0].foxes > 0)) {
    console.log("📈 POPULATION DYNAMICS:");
    console.log("-".repeat(50));
    for (const s of snapshots) {
      const r = Math.floor(s.rabbits / 10);
      const f = Math.floor(s.foxes / 5);
      console.log(`T${s.tick.toString().padStart(2)}: ${"R".repeat(Math.min(r, 30))}${"F".repeat(Math.min(f, 15))}`);
    }
    console.log("-".repeat(50));
  }

  // Clean up test file
  const fs = await import("fs/promises");
  try {
    await fs.unlink("./test-economy.ts");
  } catch {}

  return { passed, score, buildTime, totalActions };
}

runChallenge().catch(console.error);
