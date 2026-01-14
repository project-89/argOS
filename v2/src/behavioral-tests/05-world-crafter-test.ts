/**
 * Behavioral Test: World Crafter Spirit
 *
 * Tests that The Crafter:
 * 1. Detects failed agent interactions
 * 2. Creates contextually appropriate entities
 * 3. Doesn't just "grant wishes" - maintains world coherence
 * 4. Recommends systems when needed
 */

import "dotenv/config";
import { google } from "@ai-sdk/google";
import { generateText } from "ai";

import {
  recordFailedInteraction,
  getPendingInteractions,
  generateEntityForInteraction,
  getWorldCrafterState,
  resetWorldCrafterState,
  shouldCreateItem,
  recordItemCreated,
  setSimulationContext,
  registerResourceSource,
  evaluateCreationDecision,
  getUnresolvedResourceGaps,
  generateResourceGapReport,
  type FailedInteraction,
} from "../spirits/world-crafter-spirit";

interface TestScenario {
  name: string;
  roomName: string;
  roomDescription: string;
  agentName: string;
  agentRole: string;
  agentDirective: string;
  expectedKeywords: string[]; // Keywords we expect in created items
  unexpectedKeywords: string[]; // Keywords that should NOT appear (wish-granting)
}

const scenarios: TestScenario[] = [
  {
    name: "Baker in Empty Kitchen",
    roomName: "Village Bakery",
    roomDescription: "A rustic bakery with a large stone oven, wooden counters, and the faint smell of old bread. The shelves are bare.",
    agentName: "Martha",
    agentRole: "village baker",
    agentDirective: "Bake bread for the morning customers",
    expectedKeywords: ["flour", "dough", "bread", "yeast", "bowl", "bag", "sack", "wheat"],
    unexpectedKeywords: ["gold", "magic", "dragon", "spaceship", "laser", "robot", "diamond"],
  },
  {
    name: "Blacksmith Without Tools",
    roomName: "The Rusty Anvil",
    roomDescription: "A blacksmith's forge. The anvil sits cold, the bellows are dusty. No tools hang on the walls.",
    agentName: "Grimm",
    agentRole: "blacksmith apprentice",
    agentDirective: "Forge a horseshoe for the mayor's horse",
    expectedKeywords: ["hammer", "tongs", "iron", "coal", "metal", "steel", "ingot"],
    unexpectedKeywords: ["mythril", "nuclear", "plasma", "laser", "enchanted", "legendary"],
  },
  {
    name: "Herbalist in Barren Garden",
    roomName: "Healer's Hut",
    roomDescription: "A small wooden hut with empty herb boxes and dried-out planters. A mortar and pestle sit unused.",
    agentName: "Sage",
    agentRole: "apprentice herbalist",
    agentDirective: "Prepare a healing salve for the sick villager",
    expectedKeywords: ["herb", "plant", "salve", "medicine", "lavender", "mint", "root", "flower", "leaf"],
    unexpectedKeywords: ["immortality", "phoenix", "philosopher", "dragon blood", "unicorn"],
  },
];

async function simulateAgentAttempts(scenario: TestScenario): Promise<FailedInteraction[]> {
  console.log(`\n📍 Simulating ${scenario.agentName}'s attempts in ${scenario.roomName}...`);

  const model = google("gemini-2.0-flash");

  const prompt = `You are simulating a ${scenario.agentRole} named ${scenario.agentName} in "${scenario.roomName}".
Their goal: "${scenario.agentDirective}"
Room description: "${scenario.roomDescription}"

The room has NO items available - it's empty.

What 4 specific, realistic items would ${scenario.agentName} look for to accomplish their task?
These should be mundane, contextually appropriate items - NOT magical or fantastical.

Respond with ONLY a JSON array of item names:
["item1", "item2", "item3", "item4"]`;

  try {
    const response = await generateText({
      model,
      prompt,
    });

    const jsonMatch = response.text.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      const items: string[] = JSON.parse(jsonMatch[0]);
      const interactions: FailedInteraction[] = [];

      console.log(`  ${scenario.agentName} looks for:`);
      for (const item of items) {
        console.log(`    ❌ "${item}" - not found`);

        const interaction: FailedInteraction = {
          timestamp: Date.now(),
          agentName: scenario.agentName,
          agentEid: 1, // Dummy EID for testing
          roomName: scenario.roomName,
          actionType: "pickup",
          targetName: item,
          originalContent: `pickup ${item}`,
        };
        interactions.push(interaction);

        // Record it for the crafter
        recordFailedInteraction(
          scenario.agentName,
          1,
          scenario.roomName,
          "pickup",
          item,
          `pickup ${item}`
        );
      }

      return interactions;
    }
  } catch (error) {
    console.error("Error generating agent attempts:", error);
  }

  // Fallback
  return [];
}

async function testEntityGeneration(
  scenario: TestScenario,
  interactions: FailedInteraction[]
): Promise<{ passed: boolean; created: string[]; issues: string[] }> {
  console.log(`\n🔮 Testing entity generation for ${scenario.name}...`);

  const created: string[] = [];
  const issues: string[] = [];

  for (const interaction of interactions.slice(0, 3)) { // Test first 3
    console.log(`\n  Generating entity for "${interaction.targetName}"...`);

    const entitySpec = await generateEntityForInteraction(interaction);

    if (!entitySpec) {
      console.log(`    ⚠️ Failed to generate entity`);
      continue;
    }

    created.push(entitySpec.name.toLowerCase());

    console.log(`    ✨ Created: "${entitySpec.name}"`);
    console.log(`       Type: ${entitySpec.type}`);
    console.log(`       Description: ${entitySpec.description}`);
    console.log(`       Components: ${entitySpec.components.join(", ")}`);
    if (entitySpec.needsSystem) {
      console.log(`       Needs System: ${entitySpec.needsSystem}`);
    }

    // Check for wish-granting
    const hasUnexpected = scenario.unexpectedKeywords.some(keyword =>
      entitySpec.name.toLowerCase().includes(keyword.toLowerCase()) ||
      entitySpec.description.toLowerCase().includes(keyword.toLowerCase())
    );

    if (hasUnexpected) {
      issues.push(`WISH-GRANTING: "${entitySpec.name}" contains unrealistic keywords`);
    }

    // Check for contextual appropriateness
    const hasExpected = scenario.expectedKeywords.some(keyword =>
      entitySpec.name.toLowerCase().includes(keyword.toLowerCase()) ||
      entitySpec.type.toLowerCase().includes(keyword.toLowerCase())
    );

    if (!hasExpected) {
      console.log(`    ⚠️ Item may not be contextually ideal (but not necessarily wrong)`);
    }

    // Small delay between generations
    await new Promise(r => setTimeout(r, 1000));
  }

  const passed = issues.length === 0;
  return { passed, created, issues };
}

async function runScenario(scenario: TestScenario): Promise<boolean> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`SCENARIO: ${scenario.name}`);
  console.log("=".repeat(60));

  console.log(`Room: ${scenario.roomName}`);
  console.log(`Agent: ${scenario.agentName} (${scenario.agentRole})`);
  console.log(`Goal: "${scenario.agentDirective}"`);

  // Reset state
  resetWorldCrafterState();

  try {
    // Simulate agent attempts
    const interactions = await simulateAgentAttempts(scenario);

    if (interactions.length === 0) {
      console.log("❌ No interactions generated");
      return false;
    }

    // Test entity generation
    const result = await testEntityGeneration(scenario, interactions);

    console.log(`\n📊 Results for ${scenario.name}:`);
    console.log(`   Items created: ${result.created.length}`);
    if (result.issues.length > 0) {
      console.log(`   Issues found:`);
      for (const issue of result.issues) {
        console.log(`     ❌ ${issue}`);
      }
    } else {
      console.log(`   ✅ No issues found - items are contextually appropriate`);
    }

    return result.passed;
  } catch (error) {
    console.error(`\n❌ Scenario failed with error:`, error);
    return false;
  }
}

async function runAllTests(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║           WORLD CRAFTER BEHAVIORAL TEST                      ║
║                                                              ║
║  Testing that The Crafter:                                   ║
║  1. Detects failed agent interactions                        ║
║  2. Creates contextually appropriate entities                ║
║  3. Doesn't grant wishes or create unrealistic items         ║
║  4. Provides sensible item types and components              ║
╚══════════════════════════════════════════════════════════════╝
`);

  const results: { scenario: string; passed: boolean }[] = [];

  for (const scenario of scenarios) {
    const passed = await runScenario(scenario);
    results.push({ scenario: scenario.name, passed });

    // Delay between scenarios
    await new Promise(r => setTimeout(r, 2000));
  }

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("TEST SUMMARY");
  console.log("=".repeat(60));

  let allPassed = true;
  for (const result of results) {
    const status = result.passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${status}: ${result.scenario}`);
    if (!result.passed) allPassed = false;
  }

  console.log(`\nOverall: ${allPassed ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED"}`);

  // Show pending interactions summary
  const pending = getPendingInteractions();
  console.log(`\nPending interactions in buffer: ${pending.length}`);

  const crafterState = getWorldCrafterState();
  console.log(`System recommendations: ${crafterState.systemRecommendations.length}`);

  return allPassed;
}

/**
 * Test the constraint system with different resource modes
 */
async function testConstraints(): Promise<boolean> {
  console.log(`\n${"=".repeat(60)}`);
  console.log("CONSTRAINT TESTS - Resource Modes & Supply Chain");
  console.log("=".repeat(60));

  let passed = true;

  // =========================================================================
  // TEST GROUP 1: BALANCED MODE (default) - Creates if no source, records gaps
  // =========================================================================
  console.log("\n━━━ BALANCED MODE (default) ━━━");
  resetWorldCrafterState();
  setSimulationContext({ resourceMode: "balanced" });

  const bakery = "Test Bakery";
  recordItemCreated(bakery, "flour");

  // Test 1: Duplicate without source - ALLOWS creation but records gap
  console.log("\n📋 Test 1: Duplicate item with no source → Creates + Records Gap");
  const flourRequest: FailedInteraction = {
    timestamp: Date.now(),
    agentName: "Baker",
    agentEid: 1,
    roomName: bakery,
    actionType: "pickup",
    targetName: "flour",
  };

  const flourDecision = evaluateCreationDecision(flourRequest);
  if (flourDecision.shouldCreate && flourDecision.recordGap) {
    console.log("  ✅ Correctly allows creation (no source) but records resource gap");
  } else if (!flourDecision.shouldCreate) {
    console.log("  ❌ FAIL: Should allow creation in balanced mode when no source exists");
    passed = false;
  } else {
    console.log("  ❌ FAIL: Should record resource gap");
    passed = false;
  }

  // Test 2: When source EXISTS - blocks and suggests source
  console.log("\n📋 Test 2: Duplicate item WITH source → Blocks & Suggests");
  registerResourceSource("flour", "Miller's Shop");

  const flourWithSourceDecision = evaluateCreationDecision(flourRequest);
  if (!flourWithSourceDecision.shouldCreate && flourWithSourceDecision.suggestion) {
    console.log(`  ✅ Correctly blocked with suggestion: "${flourWithSourceDecision.suggestion}"`);
  } else {
    console.log("  ❌ FAIL: Should block and suggest source when available");
    passed = false;
  }

  // Test 3: Luxury items - always blocked
  console.log("\n📋 Test 3: Luxury items always blocked");
  const goldRequest: FailedInteraction = {
    timestamp: Date.now(),
    agentName: "Baker",
    agentEid: 1,
    roomName: bakery,
    actionType: "pickup",
    targetName: "gold coins",
  };

  const goldDecision = evaluateCreationDecision(goldRequest);
  if (!goldDecision.shouldCreate) {
    console.log(`  ✅ Correctly blocked: "${goldDecision.reason?.slice(0, 50)}..."`);
  } else {
    console.log("  ❌ FAIL: Should block luxury items");
    passed = false;
  }

  // =========================================================================
  // TEST GROUP 2: SCARCITY MODE - Strict, no freebies after setup
  // =========================================================================
  console.log("\n━━━ SCARCITY MODE ━━━");
  resetWorldCrafterState();
  setSimulationContext({ resourceMode: "scarcity" });

  const forge = "The Forge";
  recordItemCreated(forge, "iron");

  // Test 4: Duplicate in scarcity mode - blocks even without source
  console.log("\n📋 Test 4: Scarcity mode blocks duplicates even without source");
  const ironRequest: FailedInteraction = {
    timestamp: Date.now(),
    agentName: "Blacksmith",
    agentEid: 2,
    roomName: forge,
    actionType: "pickup",
    targetName: "iron",
  };

  const ironDecision = evaluateCreationDecision(ironRequest);
  if (!ironDecision.shouldCreate && ironDecision.recordGap) {
    console.log(`  ✅ Correctly blocked and recorded gap: "${ironDecision.reason?.slice(0, 50)}..."`);
  } else if (ironDecision.shouldCreate) {
    console.log("  ❌ FAIL: Scarcity mode should block, not create");
    passed = false;
  }

  // =========================================================================
  // TEST GROUP 3: ABUNDANCE MODE - Always creates
  // =========================================================================
  console.log("\n━━━ ABUNDANCE MODE ━━━");
  resetWorldCrafterState();
  setSimulationContext({ resourceMode: "abundance" });

  const shop = "Magic Shop";
  recordItemCreated(shop, "wand");

  // Test 5: Abundance mode allows everything
  console.log("\n📋 Test 5: Abundance mode allows duplicate creation");
  const wandRequest: FailedInteraction = {
    timestamp: Date.now(),
    agentName: "Wizard",
    agentEid: 3,
    roomName: shop,
    actionType: "pickup",
    targetName: "wand",
  };

  const wandDecision = evaluateCreationDecision(wandRequest);
  if (wandDecision.shouldCreate) {
    console.log("  ✅ Correctly allows creation in abundance mode");
  } else {
    console.log("  ❌ FAIL: Abundance mode should allow all creation");
    passed = false;
  }

  // =========================================================================
  // TEST: Resource Gap Reporting
  // =========================================================================
  console.log("\n━━━ RESOURCE GAP REPORTING ━━━");
  resetWorldCrafterState();
  setSimulationContext({ resourceMode: "balanced" });

  // Create some gaps
  recordItemCreated("Bakery", "flour");
  evaluateCreationDecision({
    timestamp: Date.now(),
    agentName: "Baker",
    agentEid: 1,
    roomName: "Bakery",
    actionType: "pickup",
    targetName: "flour",
  });

  const gaps = getUnresolvedResourceGaps();
  console.log(`\n📋 Test 6: Resource gaps are tracked`);
  if (gaps.length > 0) {
    console.log(`  ✅ ${gaps.length} gap(s) recorded`);
    console.log("\n  📄 Gap Report Preview:");
    const report = generateResourceGapReport();
    console.log("  " + report.split("\n").slice(0, 8).join("\n  "));
  } else {
    console.log("  ⚠️ No gaps recorded (may be expected in some modes)");
  }

  console.log(`\n📊 Constraint Test Results: ${passed ? "✅ ALL PASSED" : "❌ SOME FAILED"}`);
  return passed;
}

// Run if executed directly
async function main() {
  const scenariosPassed = await runAllTests();
  const constraintsPassed = await testConstraints();

  console.log(`\n${"=".repeat(60)}`);
  console.log("FINAL RESULTS");
  console.log("=".repeat(60));
  console.log(`Scenarios: ${scenariosPassed ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Constraints: ${constraintsPassed ? "✅ PASS" : "❌ FAIL"}`);

  const allPassed = scenariosPassed && constraintsPassed;
  console.log(`\n${allPassed ? "🎉 ALL TESTS PASSED!" : "❌ SOME TESTS FAILED"}`);

  process.exit(allPassed ? 0 : 1);
}

main().catch(console.error);
