/**
 * Challenge 04: Conflicting Goals
 *
 * GOAL: Test GodAI's ability to design systems that handle competing objectives.
 * Create a simulation where entities have multiple, potentially conflicting needs.
 *
 * SUCCESS CRITERIA:
 * - Design entities with multiple needs (hunger, safety, social)
 * - Create systems that force trade-offs
 * - Achieve emergent behavior where entities balance competing goals
 * - No single need should dominate completely
 *
 * Run with: npx tsx src/behavioral-tests/challenge-04-conflicting-goals.ts
 */

import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, resetRoomPositionCounter } from "../ecs/prefabs";
import { createGodAgent, godDesignAndExecute, tickWorldAsync, type DesignDocument } from "../god/god-agent";
import { listDynamicComponents, getDynamicComponent } from "../ecs/dynamic-components";
import { Name } from "../ecs/components";
import { query } from "bitecs";

const CHALLENGE_PROMPT = `
CHALLENGE: Conflicting Goals Simulation

Build a survival simulation where creatures must balance competing needs:

1. THREE COMPETING NEEDS:
   - Hunger: Increases over time, satisfied by eating (requires leaving safety)
   - Safety: Decreases when exposed to danger, restored by hiding
   - Social: Decreases when alone, restored by being near others

2. ENVIRONMENTAL CONSTRAINTS:
   - Food is only available in dangerous areas
   - Safe areas have no food
   - Social interaction requires leaving hiding spots

3. TRADE-OFF MECHANICS:
   - Eating exposes creature to danger (reduces safety)
   - Hiding prevents eating and socializing
   - Socializing requires being in open areas (reduces safety)

4. EMERGENT BEHAVIOR:
   - Creatures should dynamically switch between behaviors
   - Different creatures might develop different strategies
   - No need should stay at 0 or 100 indefinitely

5. BALANCE:
   - All needs should fluctuate over time
   - Creatures should survive (not die from any single need)
   - System should reach dynamic equilibrium

Create components for needs, locations, and behaviors.
Create systems that update needs and force trade-offs.
`;

interface NeedSnapshot {
  tick: number;
  creatures: Array<{
    name: string;
    hunger: number;
    safety: number;
    social: number;
    behavior: string;
  }>;
}

async function runChallenge() {
  console.log("\n" + "═".repeat(70));
  console.log("  CHALLENGE 04: Conflicting Goals");
  console.log("═".repeat(70) + "\n");

  const world = createArgosWorld("ConflictingGoals");
  initializePrefabs(world);
  resetRoomPositionCounter();

  const state = createGodAgent(world, {
    name: "GoalArchitect",
    worldName: "ConflictingGoals",
    narrative: "A survival simulation with competing needs",
  });

  console.log("📋 CHALLENGE PROMPT:");
  console.log("-".repeat(50));
  console.log(CHALLENGE_PROMPT);
  console.log("-".repeat(50) + "\n");

  // Phase 1: Design and Build
  console.log("🏗️  PHASE 1: Design & Build\n");
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
    console.log("-".repeat(50));
  }

  console.log(`\nExecution: ${totalActions} actions taken`);

  const componentsCreated = listDynamicComponents();
  const systemsCreated = state.fileSystems;

  console.log(`\n✅ Created: ${componentsCreated.length} components, ${systemsCreated.length} systems\n`);

  const buildTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // Phase 2: Analyze
  console.log("═".repeat(70));
  console.log("  PHASE 2: Analyzing the Simulation");
  console.log("═".repeat(70) + "\n");

  console.log(`📦 COMPONENTS (${componentsCreated.length}):`);
  for (const comp of componentsCreated) {
    console.log(`  • ${comp.name}: ${Object.keys(comp.properties).join(", ")}`);
  }

  const entities = query(world, [Name]);
  const creatureEntities = entities.filter(eid => {
    const name = Name.value[eid]?.toLowerCase() || "";
    // Filter out non-creature entities
    return !name.includes("architect") &&
           !name.includes("god") &&
           !name.includes("food") &&
           !name.includes("pellet") &&
           !name.includes("cave") &&
           !name.includes("spot") &&
           !name.includes("resource") &&
           !name.includes("patch");
  });

  console.log(`\n🐾 CREATURES (${creatureEntities.length}):`);
  for (const eid of creatureEntities) {
    console.log(`  • ${Name.value[eid]}`);
  }

  console.log(`\n⚙️  SYSTEMS (${systemsCreated.length}):`);
  for (const sys of systemsCreated) {
    console.log(`  • ${sys.name}: ${sys.description}`);
  }

  // Phase 3: Run the simulation
  console.log("\n" + "═".repeat(70));
  console.log("  PHASE 3: Running the Simulation (30 ticks)");
  console.log("═".repeat(70) + "\n");

  const snapshots: NeedSnapshot[] = [];

  // Try to find needs components
  const Needs = getDynamicComponent("Needs") ||
                getDynamicComponent("CreatureNeeds") ||
                getDynamicComponent("Survival");

  const Behavior = getDynamicComponent("Behavior") ||
                   getDynamicComponent("State") ||
                   getDynamicComponent("Activity");

  for (let tick = 1; tick <= 30; tick++) {
    const { fixes } = await tickWorldAsync(state, 1000);
    if (fixes.fixed.length > 0) {
      console.log(`  🔧 Auto-fixed: ${fixes.fixed.join(', ')}`);
    }

    // Capture snapshot every 5 ticks
    if (tick % 5 === 0 || tick === 1) {
      const snapshot: NeedSnapshot = {
        tick,
        creatures: [],
      };

      for (const eid of creatureEntities) {
        const name = Name.value[eid] || "Unknown";
        let hunger = 0, safety = 0, social = 0;
        let behavior = "unknown";

        // Try to extract need values from various possible component structures
        for (const comp of listDynamicComponents()) {
          const dynComp = getDynamicComponent(comp.name);
          if (!dynComp) continue;

          for (const prop of Object.keys(comp.properties)) {
            const val = dynComp[prop]?.[eid];
            if (val !== undefined && typeof val === 'number') {
              const propLower = prop.toLowerCase();
              // Use exact match or startsWith to avoid matching threshold properties
              if (propLower === "hunger" || propLower === "food" || (propLower.startsWith("hunger") && !propLower.includes("threshold"))) {
                hunger = val;
              } else if (propLower === "safety" || propLower === "danger" || propLower === "fear" || (propLower.startsWith("safety") && !propLower.includes("threshold"))) {
                safety = val;
              } else if (propLower === "social" || propLower === "lonely" || propLower === "connection" || propLower === "isolation" || (propLower.startsWith("social") && !propLower.includes("threshold"))) {
                social = val;
              }
            }
            // Check for behavior/state string
            if (typeof dynComp[prop]?.[eid] === 'string') {
              behavior = dynComp[prop][eid];
            }
          }
        }

        snapshot.creatures.push({ name, hunger, safety, social, behavior });
      }

      snapshots.push(snapshot);

      // Print snapshot
      console.log(`Tick ${tick}:`);
      for (const creature of snapshot.creatures) {
        // Clamp values for display (handle negative or >100)
        const clampedHunger = Math.max(0, Math.min(100, creature.hunger));
        const clampedSafety = Math.max(0, Math.min(100, creature.safety));
        const clampedSocial = Math.max(0, Math.min(100, creature.social));
        const hungerBar = "█".repeat(Math.floor(clampedHunger / 10));
        const safetyBar = "█".repeat(Math.floor(clampedSafety / 10));
        const socialBar = "█".repeat(Math.floor(clampedSocial / 10));
        console.log(`  ${creature.name}:`);
        console.log(`    Hunger: ${hungerBar.padEnd(10)} ${creature.hunger.toFixed(0)}`);
        console.log(`    Safety: ${safetyBar.padEnd(10)} ${creature.safety.toFixed(0)}`);
        console.log(`    Social: ${socialBar.padEnd(10)} ${creature.social.toFixed(0)}`);
        if (creature.behavior !== "unknown") {
          console.log(`    Behavior: ${creature.behavior}`);
        }
      }
    }
  }

  // Phase 4: Evaluate
  console.log("\n" + "═".repeat(70));
  console.log("  PHASE 4: Evaluation");
  console.log("═".repeat(70) + "\n");

  // Check for key characteristics
  const hasMultipleNeeds = componentsCreated.some(c => {
    const props = Object.keys(c.properties);
    const needProps = props.filter(p =>
      p.toLowerCase().includes("hunger") ||
      p.toLowerCase().includes("safety") ||
      p.toLowerCase().includes("social") ||
      p.toLowerCase().includes("need")
    );
    return needProps.length >= 2;
  });

  const hasNeedDecaySystem = systemsCreated.some(s =>
    s.name.toLowerCase().includes("decay") ||
    s.name.toLowerCase().includes("need") ||
    s.description.toLowerCase().includes("increase") ||
    s.description.toLowerCase().includes("decrease")
  );

  const hasBehaviorSystem = systemsCreated.some(s =>
    s.name.toLowerCase().includes("behavior") ||
    s.name.toLowerCase().includes("decision") ||
    s.name.toLowerCase().includes("action") ||
    s.description.toLowerCase().includes("choose") ||
    s.description.toLowerCase().includes("switch")
  );

  const hasTradeoffLogic = systemsCreated.some(s =>
    s.description.toLowerCase().includes("trade") ||
    s.description.toLowerCase().includes("conflict") ||
    s.description.toLowerCase().includes("balance") ||
    s.description.toLowerCase().includes("reduce") ||
    s.description.toLowerCase().includes("cost")
  );

  const hasMultipleCreatures = creatureEntities.length >= 2;

  // Check if needs fluctuate (not stuck at 0 or 100)
  let hasFluctuation = false;
  if (snapshots.length > 1) {
    for (const creature of snapshots[0].creatures) {
      const creatureName = creature.name;
      const hungerValues = snapshots.map(s =>
        s.creatures.find(c => c.name === creatureName)?.hunger ?? 0
      );
      const safetyValues = snapshots.map(s =>
        s.creatures.find(c => c.name === creatureName)?.safety ?? 0
      );

      const hungerRange = Math.max(...hungerValues) - Math.min(...hungerValues);
      const safetyRange = Math.max(...safetyValues) - Math.min(...safetyValues);

      if (hungerRange > 10 || safetyRange > 10) {
        hasFluctuation = true;
        break;
      }
    }
  }

  console.log("📊 SUCCESS CRITERIA:");
  console.log(`  ${hasMultipleNeeds ? "✅" : "❌"} Has multiple competing needs`);
  console.log(`  ${hasNeedDecaySystem ? "✅" : "❌"} Has need decay/update system`);
  console.log(`  ${hasBehaviorSystem ? "✅" : "❌"} Has behavior/decision system`);
  console.log(`  ${hasTradeoffLogic ? "✅" : "❌"} Has trade-off logic`);
  console.log(`  ${hasMultipleCreatures ? "✅" : "❌"} Has multiple creatures`);
  console.log(`  ${hasFluctuation ? "✅" : "❌"} Shows need fluctuation`);

  const score = [
    hasMultipleNeeds,
    hasNeedDecaySystem,
    hasBehaviorSystem,
    hasTradeoffLogic,
    hasMultipleCreatures,
    hasFluctuation
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
  console.log(`  Creatures: ${creatureEntities.length}`);
  console.log(`  Score: ${score}/6`);

  const passed = score >= 4;
  console.log(`\n  ${passed ? "🎉 CHALLENGE PASSED" : "💥 CHALLENGE FAILED"}`);
  console.log("═".repeat(70) + "\n");

  return { passed, score, buildTime, totalActions };
}

runChallenge().catch(console.error);
