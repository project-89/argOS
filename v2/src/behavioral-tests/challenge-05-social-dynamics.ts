/**
 * Challenge 05: Social Dynamics
 *
 * GOAL: Test GodAI's ability to model social interactions and relationships.
 * Create a simulation where entities form, maintain, and break social bonds.
 *
 * SUCCESS CRITERIA:
 * - Create entities that can form relationships
 * - Track relationship strength/quality
 * - Implement reputation/trust mechanics
 * - Show emergent social structures (groups, hierarchies, or networks)
 *
 * Run with: npx tsx src/behavioral-tests/challenge-05-social-dynamics.ts
 */

import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, resetRoomPositionCounter } from "../ecs/prefabs";
import { createGodAgent, godDesignAndExecute, tickWorldAsync } from "../god/god-agent";
import { listDynamicComponents, getDynamicComponent } from "../ecs/dynamic-components";
import { Name } from "../ecs/components";
import { query } from "bitecs";

const CHALLENGE_PROMPT = `
CHALLENGE: Social Dynamics Simulation

Build a society simulation where individuals form and maintain relationships:

1. SOCIAL ATTRIBUTES:
   - Each individual has Charisma, Trust, and Reputation scores
   - Relationships have Strength (how close) and Sentiment (positive/negative)
   - Individuals remember past interactions

2. INTERACTION MECHANICS:
   - Individuals can interact: Cooperate, Compete, or Ignore
   - Cooperation increases relationship strength and mutual trust
   - Competition can damage relationships but increase individual reputation
   - Repeated positive interactions build strong bonds

3. SOCIAL DYNAMICS:
   - Trust affects willingness to cooperate
   - Reputation spreads through the network
   - Strong relationships decay slowly, weak ones faster
   - Betrayal (competing after cooperation) severely damages trust

4. EMERGENT BEHAVIOR:
   - Groups should form naturally based on mutual trust
   - High-reputation individuals should attract more interactions
   - Social hierarchies or clusters should emerge

5. ENTITIES:
   - Create 4-6 individuals with different personalities
   - Some should be more cooperative, others more competitive

Design components to track social attributes and relationships.
Create systems for interaction, trust updates, and reputation spreading.
`;

async function runChallenge() {
  console.log("\n" + "═".repeat(70));
  console.log("  CHALLENGE 05: Social Dynamics");
  console.log("═".repeat(70) + "\n");

  const world = createArgosWorld("SocialWorld");
  initializePrefabs(world);
  resetRoomPositionCounter();

  const state = createGodAgent(world, {
    name: "SocialArchitect",
    worldName: "SocialWorld",
    narrative: "A society simulation with relationships and trust",
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
  const individualEntities = entities.filter(eid => {
    const name = Name.value[eid]?.toLowerCase() || "";
    return !name.includes("architect") && !name.includes("god");
  });

  console.log(`\n👥 INDIVIDUALS (${individualEntities.length}):`);
  for (const eid of individualEntities) {
    console.log(`  • ${Name.value[eid]}`);
  }

  console.log(`\n⚙️  SYSTEMS (${systemsCreated.length}):`);
  for (const sys of systemsCreated) {
    console.log(`  • ${sys.name}: ${sys.description}`);
  }

  // Phase 3: Run the simulation
  console.log("\n" + "═".repeat(70));
  console.log("  PHASE 3: Running the Simulation (20 ticks)");
  console.log("═".repeat(70) + "\n");

  for (let tick = 1; tick <= 20; tick++) {
    const { fixes } = await tickWorldAsync(state, 1000);
    if (fixes.fixed.length > 0) {
      console.log(`  🔧 Auto-fixed: ${fixes.fixed.join(', ')}`);
    }

    // Print status every 5 ticks
    if (tick % 5 === 0) {
      console.log(`Tick ${tick}:`);

      // Try to find social attributes
      for (const eid of individualEntities) {
        const name = Name.value[eid] || "Unknown";
        let trust = 0, reputation = 0, charisma = 0;

        for (const comp of listDynamicComponents()) {
          const dynComp = getDynamicComponent(comp.name);
          if (!dynComp) continue;

          for (const prop of Object.keys(comp.properties)) {
            const val = dynComp[prop]?.[eid];
            if (val !== undefined && typeof val === 'number') {
              const propLower = prop.toLowerCase();
              // Use exact match to avoid matching trustworthiness as trust
              if (propLower === "trust") trust = val;
              if (propLower === "reputation" || propLower === "rep") reputation = val;
              if (propLower === "charisma") charisma = val;
              // Also check trustworthiness as trust backup
              if (propLower === "trustworthiness" && trust === 0) trust = val;
            }
          }
        }

        console.log(`  ${name}: Trust=${trust.toFixed(0)} Rep=${reputation.toFixed(0)} Char=${charisma.toFixed(0)}`);
      }

      // Print system logs
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
  const hasSocialAttributes = componentsCreated.some(c => {
    const props = Object.keys(c.properties).map(p => p.toLowerCase());
    return props.some(p =>
      p.includes("trust") || p.includes("reputation") || p.includes("charisma")
    );
  });

  const hasRelationshipTracking = componentsCreated.some(c =>
    c.name.toLowerCase().includes("relation") ||
    c.name.toLowerCase().includes("bond") ||
    Object.keys(c.properties).some(p =>
      p.toLowerCase().includes("strength") || p.toLowerCase().includes("sentiment")
    )
  );

  const hasInteractionSystem = systemsCreated.some(s =>
    s.name.toLowerCase().includes("interact") ||
    s.description.toLowerCase().includes("cooperat") ||
    s.description.toLowerCase().includes("compet")
  );

  const hasTrustSystem = systemsCreated.some(s =>
    s.name.toLowerCase().includes("trust") ||
    s.description.toLowerCase().includes("trust") ||
    s.description.toLowerCase().includes("reputation")
  );

  const hasMultipleIndividuals = individualEntities.length >= 4;

  const hasDecayMechanic = systemsCreated.some(s =>
    s.description.toLowerCase().includes("decay") ||
    s.description.toLowerCase().includes("fade") ||
    s.description.toLowerCase().includes("weaken")
  );

  console.log("📊 SUCCESS CRITERIA:");
  console.log(`  ${hasSocialAttributes ? "✅" : "❌"} Has social attributes (trust, reputation, charisma)`);
  console.log(`  ${hasRelationshipTracking ? "✅" : "❌"} Has relationship tracking`);
  console.log(`  ${hasInteractionSystem ? "✅" : "❌"} Has interaction system`);
  console.log(`  ${hasTrustSystem ? "✅" : "❌"} Has trust/reputation system`);
  console.log(`  ${hasMultipleIndividuals ? "✅" : "❌"} Has multiple individuals (4+)`);
  console.log(`  ${hasDecayMechanic ? "✅" : "❌"} Has relationship decay mechanic`);

  const score = [
    hasSocialAttributes,
    hasRelationshipTracking,
    hasInteractionSystem,
    hasTrustSystem,
    hasMultipleIndividuals,
    hasDecayMechanic
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
  console.log(`  Individuals: ${individualEntities.length}`);
  console.log(`  Score: ${score}/6`);

  const passed = score >= 4;
  console.log(`\n  ${passed ? "🎉 CHALLENGE PASSED" : "💥 CHALLENGE FAILED"}`);
  console.log("═".repeat(70) + "\n");

  return { passed, score, buildTime, totalActions };
}

runChallenge().catch(console.error);
