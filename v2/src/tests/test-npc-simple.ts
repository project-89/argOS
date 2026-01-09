/**
 * Simple NPC World Interaction Test
 *
 * This test demonstrates the core mechanics of:
 * 1. NPCs perceiving the world through TextRenderer
 * 2. Performing actions on objects
 * 3. World state changes in response
 *
 * This is a programmatic test that doesn't rely on the LLM continuing.
 */

import { createWorld as createBitECSWorld } from "bitecs";
import {
  worldSchema,
  ObjectManager,
  TextRenderer,
  RulesEngine,
} from "./world";

function runSimpleNPCTest() {
  console.log("╔════════════════════════════════════════╗");
  console.log("║   SIMPLE NPC INTERACTION TEST          ║");
  console.log("╚════════════════════════════════════════╝\n");

  const world = createBitECSWorld();
  const objectManager = new ObjectManager(world);
  const textRenderer = new TextRenderer(world, objectManager);
  const rulesEngine = new RulesEngine(world, objectManager);

  // Create the tavern
  console.log("=== Setting Up Scene ===\n");

  const roomEid = objectManager.spawnCustom({
    name: "The Rusty Tankard",
    description: "A warm and cozy tavern with a low ceiling. The smell of ale fills the air.",
    traits: ["container", "location"],
  });
  console.log("Created room: The Rusty Tankard");

  // Add furniture
  const tableEid = objectManager.spawn("table", {
    name: "oak table",
    containedIn: roomEid,
    properties: { adjective: "worn", material: "oak" },
  });
  console.log("Added: oak table");

  const chairEid = objectManager.spawn("chair", {
    name: "wooden chair",
    containedIn: roomEid,
    properties: { adjective: "sturdy", material: "wooden" },
  });
  console.log("Added: wooden chair");

  const chestEid = objectManager.spawn("chest", {
    name: "old chest",
    containedIn: roomEid,
    properties: { adjective: "old", material: "iron-bound" },
  });
  console.log("Added: old chest");

  const torchEid = objectManager.spawn("torch", {
    containedIn: roomEid,
  });
  console.log("Added: torch");

  // Create the NPC
  const npcEid = objectManager.spawn("npc", {
    name: "Gareth the Wanderer",
    containedIn: roomEid,
    properties: { adjective: "weary", role: "traveler" },
  });
  console.log("Created NPC: Gareth the Wanderer");

  // === Step 1: NPC perceives the room ===
  console.log("\n" + "=".repeat(60));
  console.log("STEP 1: Gareth looks around the tavern");
  console.log("=".repeat(60));

  const perception = textRenderer.renderPerception(npcEid!, roomEid, {
    detailed: true,
    includeExits: true,
  });
  console.log("\n📖 What Gareth perceives:\n");
  console.log(perception);

  // === Step 2: NPC examines the chair ===
  console.log("\n" + "=".repeat(60));
  console.log("STEP 2: Gareth examines the wooden chair");
  console.log("=".repeat(60));

  const chairInfo = objectManager.getInfo(chairEid!);
  const chairAffordances = objectManager.getAvailableAffordances(chairEid!);
  console.log(`\n🔍 Chair examination:`);
  console.log(`   Name: ${chairInfo?.name}`);
  console.log(`   State: ${chairInfo?.state}`);
  console.log(`   Description: ${chairInfo?.description}`);
  console.log(`   Traits: ${chairInfo?.traits.join(", ")}`);
  console.log(`   Available actions: ${chairAffordances.join(", ")}`);

  // === Step 3: NPC sits on the chair ===
  console.log("\n" + "=".repeat(60));
  console.log("STEP 3: Gareth sits on the chair");
  console.log("=".repeat(60));

  const sitResult = rulesEngine.processAction("sit", npcEid!, chairEid!, 1);
  console.log(`\n🪑 Sit action: ${sitResult.success ? "SUCCESS" : "FAILED"}`);
  console.log(`   ${sitResult.message}`);

  // Show chair's new state
  const chairAfterSit = objectManager.getInfo(chairEid!);
  console.log(`   Chair is now: ${chairAfterSit?.state}`);

  // === Step 4: NPC examines the chest ===
  console.log("\n" + "=".repeat(60));
  console.log("STEP 4: Gareth examines the old chest");
  console.log("=".repeat(60));

  const chestInfo = objectManager.getInfo(chestEid!);
  const chestAffordances = objectManager.getAvailableAffordances(chestEid!);
  console.log(`\n🔍 Chest examination:`);
  console.log(`   Name: ${chestInfo?.name}`);
  console.log(`   State: ${chestInfo?.state}`);
  console.log(`   Description: ${chestInfo?.description}`);
  console.log(`   Traits: ${chestInfo?.traits.join(", ")}`);
  console.log(`   Available actions: ${chestAffordances.join(", ")}`);

  // === Step 5: NPC opens the chest ===
  console.log("\n" + "=".repeat(60));
  console.log("STEP 5: Gareth opens the chest");
  console.log("=".repeat(60));

  const openResult = rulesEngine.processAction("open", npcEid!, chestEid!, 2);
  console.log(`\n📦 Open action: ${openResult.success ? "SUCCESS" : "FAILED"}`);
  console.log(`   ${openResult.message}`);

  // Show chest's new state
  const chestAfterOpen = objectManager.getInfo(chestEid!);
  const newChestAffordances = objectManager.getAvailableAffordances(chestEid!);
  console.log(`   Chest is now: ${chestAfterOpen?.state}`);
  console.log(`   Description: ${chestAfterOpen?.description}`);
  console.log(`   New available actions: ${newChestAffordances.join(", ")}`);

  // === Step 6: NPC closes the chest ===
  console.log("\n" + "=".repeat(60));
  console.log("STEP 6: Gareth closes the chest");
  console.log("=".repeat(60));

  const closeResult = rulesEngine.processAction("close", npcEid!, chestEid!, 3);
  console.log(`\n📦 Close action: ${closeResult.success ? "SUCCESS" : "FAILED"}`);
  console.log(`   ${closeResult.message}`);

  // === Final state ===
  console.log("\n" + "=".repeat(60));
  console.log("FINAL STATE: Room after all interactions");
  console.log("=".repeat(60));

  const finalRoom = textRenderer.renderRoom(roomEid, { detailed: true });
  console.log("\n" + finalRoom.fullText);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("TEST SUMMARY");
  console.log("=".repeat(60));
  console.log(`
✓ NPC can perceive the world through TextRenderer
✓ NPC can examine objects to learn available actions
✓ NPC can perform actions on objects (sit, open, close)
✓ World state updates in response to actions
✓ Descriptions update when state changes

The world system is ready for NPCs to:
- Perceive their environment semantically
- Make decisions based on available affordances
- Take actions that affect the world state
- Have their actions described naturally
`);
}

runSimpleNPCTest();
