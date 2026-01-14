/**
 * Behavioral Test: The Steward Spirit
 *
 * Tests that The Steward:
 * 1. Receives room population requests
 * 2. Generates appropriate entities for room types
 * 3. Creates STIMULUS-EMITTING entities (not static descriptions!)
 * 4. Each entity emits stimuli (visual, smell, sound, heat, etc.)
 * 5. Agents perceive rooms dynamically through what's emitting
 * 6. Sends system requests to The Weaver when needed
 */

import "dotenv/config";
import {
  requestRoomPopulation,
  getPendingRoomRequests,
  generateRoomPopulation,
  getStewardState,
  resetStewardState,
  type RoomCreationRequest,
  type PopulatedRoom,
  type StimulusEmission,
} from "../spirits/steward-spirit";

interface TestScenario {
  name: string;
  roomType: string;
  roomName: string;
  context: RoomCreationRequest["context"];
  expectedEntityTypes: string[]; // Types of entities we expect
  unexpectedItems: string[]; // Items that should NOT appear
}

const scenarios: TestScenario[] = [
  {
    name: "Bakery Population",
    roomType: "bakery",
    roomName: "Martha's Bakery",
    context: {
      worldTheme: "medieval fantasy",
      economyLevel: "modest",
      primaryFunction: "Baking bread and pastries",
      inhabitants: ["Martha the Baker"],
    },
    expectedEntityTypes: ["resource", "station", "tool", "container"],
    unexpectedItems: ["sword", "laser", "computer", "spaceship"],
  },
  {
    name: "Blacksmith Population",
    roomType: "blacksmith",
    roomName: "The Rusty Anvil",
    context: {
      worldTheme: "medieval fantasy",
      economyLevel: "prosperous",
      primaryFunction: "Forging tools and weapons",
      inhabitants: ["Grimm the Blacksmith"],
    },
    expectedEntityTypes: ["station", "tool", "resource"],
    unexpectedItems: ["flour", "bread", "herbs", "magic wand"],
  },
  {
    name: "Tavern Population",
    roomType: "tavern",
    roomName: "The Prancing Pony",
    context: {
      worldTheme: "medieval fantasy",
      economyLevel: "modest",
      primaryFunction: "Serving drinks and food to travelers",
    },
    expectedEntityTypes: ["furniture", "container", "resource"],
    unexpectedItems: ["forge", "anvil", "coal"],
  },
];

async function testRoomPopulation(scenario: TestScenario): Promise<{
  passed: boolean;
  populatedRoom: PopulatedRoom | null;
  issues: string[];
}> {
  console.log(`\n📍 Testing: ${scenario.name}`);
  console.log(`   Room: ${scenario.roomName} (${scenario.roomType})`);

  const issues: string[] = [];

  // Create the request
  const request = requestRoomPopulation(
    scenario.roomType,
    scenario.roomName,
    scenario.context,
    { maxItems: 15 }
  );

  console.log(`   Request ID: ${request.id}`);

  // Generate population
  const populatedRoom = await generateRoomPopulation(request);

  if (!populatedRoom) {
    issues.push("Failed to generate room population");
    return { passed: false, populatedRoom: null, issues };
  }

  console.log(`\n   ✨ Generated ${populatedRoom.entities.length} entities:`);
  let totalStimuli = 0;
  const stimuliByType: Record<string, number> = {};

  for (const entity of populatedRoom.entities) {
    const stimuliCount = entity.stimuli?.length || 0;
    totalStimuli += stimuliCount;
    console.log(`      - ${entity.name} (${entity.type}) [${stimuliCount} stimuli]`);

    // Count stimuli by type
    if (entity.stimuli) {
      for (const stim of entity.stimuli) {
        stimuliByType[stim.type] = (stimuliByType[stim.type] || 0) + 1;
      }
    }
  }

  // Check for expected entity types
  const entityTypes = new Set(populatedRoom.entities.map(e => e.type));
  for (const expectedType of scenario.expectedEntityTypes) {
    if (!entityTypes.has(expectedType)) {
      // Not a hard failure, but note it
      console.log(`      ⚠️ Missing expected type: ${expectedType}`);
    }
  }

  // Check for unexpected items (contextual coherence)
  for (const entity of populatedRoom.entities) {
    const nameLower = entity.name.toLowerCase();
    const descLower = entity.description.toLowerCase();

    for (const unexpected of scenario.unexpectedItems) {
      if (nameLower.includes(unexpected) || descLower.includes(unexpected)) {
        issues.push(`INCOHERENT: Found "${unexpected}" in ${scenario.roomType}`);
      }
    }
  }

  // Check STIMULUS-BASED perception (the new paradigm)
  console.log(`\n   📡 Stimulus-based perception:`);
  console.log(`      Total entity stimuli: ${totalStimuli}`);
  console.log(`      By type: ${Object.entries(stimuliByType).map(([k, v]) => `${k}:${v}`).join(", ") || "none"}`);

  // At least half the entities should emit stimuli
  const entitiesWithStimuli = populatedRoom.entities.filter(e => e.stimuli && e.stimuli.length > 0).length;
  if (entitiesWithStimuli < populatedRoom.entities.length / 2) {
    issues.push(`Too few entities emit stimuli: ${entitiesWithStimuli}/${populatedRoom.entities.length}`);
  }

  // Should have visual stimuli at minimum
  if (!stimuliByType["visual"] || stimuliByType["visual"] < 3) {
    issues.push("Not enough visual stimuli for perception");
  }

  // Check ambient stimuli
  if (populatedRoom.ambientStimuli && populatedRoom.ambientStimuli.length > 0) {
    console.log(`\n   🌫️ Ambient stimuli:`);
    for (const stim of populatedRoom.ambientStimuli) {
      console.log(`      - [${stim.type}] "${stim.template.slice(0, 50)}..."`);
    }
  }

  // Show a sample of entity stimuli
  console.log(`\n   📝 Sample stimuli emissions:`);
  for (const entity of populatedRoom.entities.slice(0, 3)) {
    if (entity.stimuli && entity.stimuli.length > 0) {
      const stim = entity.stimuli[0];
      console.log(`      ${entity.name}: [${stim.type}] "${stim.template.slice(0, 60)}..."`);
    }
  }

  // Legacy ambience (for backwards compat)
  if (populatedRoom.ambience) {
    console.log(`\n   🔊 Legacy sounds: ${populatedRoom.ambience.sounds?.join(", ") || "none"}`);
    console.log(`   👃 Legacy smells: ${populatedRoom.ambience.smells?.join(", ") || "none"}`);
  }

  // Check system requests
  if (populatedRoom.systemRequests && populatedRoom.systemRequests.length > 0) {
    console.log(`\n   🔧 System requests:`);
    for (const req of populatedRoom.systemRequests) {
      console.log(`      - ${req.type}: ${req.name} (${req.reason})`);
    }
  }

  const passed = issues.length === 0;
  console.log(`\n   ${passed ? "✅ PASSED" : "❌ FAILED"}`);
  if (!passed) {
    for (const issue of issues) {
      console.log(`      ❌ ${issue}`);
    }
  }

  return { passed, populatedRoom, issues };
}

async function testRequestQueueing(): Promise<boolean> {
  console.log(`\n${"=".repeat(60)}`);
  console.log("TEST: Request Queueing");
  console.log("=".repeat(60));

  resetStewardState();

  // Queue multiple requests
  requestRoomPopulation("bakery", "Test Bakery 1", {});
  requestRoomPopulation("blacksmith", "Test Forge 1", {});
  requestRoomPopulation("tavern", "Test Tavern 1", {});

  const pending = getPendingRoomRequests();
  console.log(`\n   Queued ${pending.length} requests`);

  if (pending.length !== 3) {
    console.log("   ❌ FAILED: Expected 3 pending requests");
    return false;
  }

  console.log("   ✅ PASSED: Requests queued correctly");
  return true;
}

async function runAllTests(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║              THE STEWARD BEHAVIORAL TEST                     ║
║                                                              ║
║  Testing that The Steward:                                   ║
║  1. Generates appropriate entities for room types            ║
║  2. Maintains contextual coherence                           ║
║  3. Creates grounded descriptions                            ║
║  4. Tracks system requests                                   ║
╚══════════════════════════════════════════════════════════════╝
`);

  const results: { scenario: string; passed: boolean }[] = [];

  // Test request queueing first
  const queuePassed = await testRequestQueueing();
  results.push({ scenario: "Request Queueing", passed: queuePassed });

  // Test each scenario
  for (const scenario of scenarios) {
    resetStewardState();

    console.log(`\n${"=".repeat(60)}`);
    console.log(`SCENARIO: ${scenario.name}`);
    console.log("=".repeat(60));

    const result = await testRoomPopulation(scenario);
    results.push({ scenario: scenario.name, passed: result.passed });

    // Delay between scenarios to avoid rate limiting
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

  // Show final state
  const state = getStewardState();
  console.log(`\nFinal State:`);
  console.log(`  Completed rooms: ${state.completedRooms.length}`);
  console.log(`  System requests: ${state.systemRequests.length}`);
  console.log(`  Rooms tracked: ${state.roomInventory.size}`);

  process.exit(allPassed ? 0 : 1);
}

runAllTests().catch(console.error);
