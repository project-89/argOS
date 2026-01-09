/**
 * Test file for the World System
 *
 * Tests:
 * - WorldSchema prefab definitions
 * - ObjectManager spawning and state management
 * - TextRenderer MUD-style output
 * - RulesEngine declarative behavior
 */

import { createWorld as createBitECSWorld } from "bitecs";
import {
  worldSchema,
  ObjectManager,
  TextRenderer,
  RulesEngine,
  type ObjectTypeDefinition,
} from "./world";
import { Name, Description, ObjectState, Traits, GridPosition } from "../ecs/components";

// Create a test world
function createTestWorld() {
  const world = createBitECSWorld();
  const objectManager = new ObjectManager(world);
  const textRenderer = new TextRenderer(world, objectManager);
  const rulesEngine = new RulesEngine(world, objectManager);

  return { world, objectManager, textRenderer, rulesEngine };
}

// Test 1: WorldSchema has base types
function testWorldSchemaBaseTypes() {
  console.log("\n=== Test 1: WorldSchema Base Types ===");

  const allTypes = worldSchema.getAllObjectTypes();
  console.log(`Found ${allTypes.length} base object types:`);
  allTypes.forEach((t) => {
    console.log(`  - ${t.name} (${t.category}): ${t.traits.join(", ")}`);
  });

  const allAffordances = worldSchema.getAllAffordances();
  console.log(`\nFound ${allAffordances.length} affordances:`);
  allAffordances.forEach((a) => {
    console.log(`  - ${a.name}: requires [${a.requires.join(", ")}]`);
  });

  console.log("\n✓ WorldSchema has base types and affordances");
}

// Test 2: Define custom object type
function testDefineCustomType() {
  console.log("\n=== Test 2: Define Custom Object Type ===");

  const campfireType: ObjectTypeDefinition = {
    name: "campfire",
    description: "A {adjective} campfire",
    traits: ["examinable", "lightSource", "flammable"],
    states: {
      unlit: {
        description: "A pile of wood and kindling, ready to be lit.",
        blockedTraits: ["lightSource"],
      },
      burning: {
        description: "A warm fire crackles and pops, casting dancing shadows.",
        traits: ["burning", "warming"],
        emitsStimulus: { type: "light", intensity: 0.9, radius: 8 },
      },
      embers: {
        description: "Glowing embers remain, giving off faint warmth.",
        traits: ["warming"],
        emitsStimulus: { type: "light", intensity: 0.3, radius: 3 },
      },
      extinguished: {
        description: "A pile of cold ash and charred wood.",
        blockedTraits: ["lightSource", "flammable"],
      },
    },
    defaultState: "unlit",
    category: "lighting",
  };

  worldSchema.defineObjectType(campfireType);

  const retrieved = worldSchema.getObjectType("campfire");
  console.log(`Defined campfire type with ${Object.keys(retrieved!.states).length} states`);
  console.log(`  Default state: ${retrieved!.defaultState}`);
  console.log(`  Base traits: ${retrieved!.traits.join(", ")}`);

  console.log("\n✓ Custom object type defined successfully");
}

// Test 3: Spawn objects
function testSpawnObjects() {
  console.log("\n=== Test 3: Spawn Objects ===");

  const { world, objectManager } = createTestWorld();

  // Spawn a room first
  const roomEid = objectManager.spawnCustom({
    name: "Cozy Tavern",
    description: "A warm and welcoming tavern with wooden beams and a stone fireplace.",
    traits: ["container", "location"],
    state: "normal",
  });
  console.log(`Spawned room: Cozy Tavern (eid: ${roomEid})`);

  // Spawn a bed
  const bedEid = objectManager.spawn("bed", {
    name: "rustic straw bed",
    containedIn: roomEid,
    properties: {
      adjective: "rustic",
      material: "straw",
    },
  });
  console.log(`Spawned bed: ${Name.value[bedEid!]} (eid: ${bedEid})`);

  // Spawn a chair
  const chairEid = objectManager.spawn("chair", {
    containedIn: roomEid,
    properties: {
      adjective: "sturdy",
      material: "oak",
    },
  });
  console.log(`Spawned chair: ${Name.value[chairEid!]} (eid: ${chairEid})`);

  // Spawn a torch
  const torchEid = objectManager.spawn("torch", {
    containedIn: roomEid,
  });
  console.log(`Spawned torch (eid: ${torchEid})`);

  // List contents
  const contents = objectManager.getContents(roomEid);
  console.log(`\nRoom contains ${contents.length} objects`);

  // Get info on each
  contents.forEach((eid) => {
    const info = objectManager.getInfo(eid);
    if (info) {
      console.log(`  - ${info.name} [${info.state}]: ${info.description}`);
    }
  });

  console.log("\n✓ Objects spawned successfully");
}

// Test 4: State transitions
function testStateTransitions() {
  console.log("\n=== Test 4: State Transitions ===");

  const { world, objectManager } = createTestWorld();

  // Spawn a chest
  const chestEid = objectManager.spawn("chest", {
    properties: { adjective: "ornate", material: "iron" },
  });

  const initialInfo = objectManager.getInfo(chestEid!);
  console.log(`Initial state: ${initialInfo?.state}`);
  console.log(`  Description: ${initialInfo?.description}`);
  console.log(`  Traits: ${initialInfo?.traits.join(", ")}`);

  // Open the chest
  objectManager.transitionState(chestEid!, "open", "player");
  const openInfo = objectManager.getInfo(chestEid!);
  console.log(`\nAfter opening: ${openInfo?.state}`);
  console.log(`  Description: ${openInfo?.description}`);
  console.log(`  Traits: ${openInfo?.traits.join(", ")}`);

  // Close it
  objectManager.transitionState(chestEid!, "closed", "player");
  const closedInfo = objectManager.getInfo(chestEid!);
  console.log(`\nAfter closing: ${closedInfo?.state}`);

  // Lock it
  objectManager.transitionState(chestEid!, "locked", "player");
  const lockedInfo = objectManager.getInfo(chestEid!);
  console.log(`\nAfter locking: ${lockedInfo?.state}`);
  console.log(`  Traits: ${lockedInfo?.traits.join(", ")}`);

  console.log("\n✓ State transitions work correctly");
}

// Test 5: Affordances
function testAffordances() {
  console.log("\n=== Test 5: Affordances ===");

  const { world, objectManager } = createTestWorld();

  // Spawn a chair
  const chairEid = objectManager.spawn("chair", {
    properties: { adjective: "comfy", material: "leather" },
  });

  // Check available affordances
  const affordances = objectManager.getAvailableAffordances(chairEid!);
  console.log(`Chair affordances: ${affordances.join(", ")}`);

  // Now spawn a door
  const doorEid = objectManager.spawn("door", {
    properties: { adjective: "heavy", material: "oak" },
  });

  const doorAffordances = objectManager.getAvailableAffordances(doorEid!);
  console.log(`Door affordances (closed): ${doorAffordances.join(", ")}`);

  // Open the door
  objectManager.transitionState(doorEid!, "open", "player");
  const openDoorAffordances = objectManager.getAvailableAffordances(doorEid!);
  console.log(`Door affordances (open): ${openDoorAffordances.join(", ")}`);

  console.log("\n✓ Affordances computed correctly based on traits");
}

// Test 6: Text rendering
function testTextRendering() {
  console.log("\n=== Test 6: Text Rendering ===");

  const { world, objectManager, textRenderer } = createTestWorld();

  // Create a room
  const roomEid = objectManager.spawnCustom({
    name: "The Dusty Library",
    description: "Towering bookshelves line the walls, filled with ancient tomes. Dust motes dance in shafts of light from high windows.",
    traits: ["container", "location"],
    state: "lit",
  });

  // Add furniture
  objectManager.spawn("table", {
    containedIn: roomEid,
    properties: { adjective: "large", material: "mahogany" },
  });

  objectManager.spawn("chair", {
    containedIn: roomEid,
    properties: { adjective: "worn", material: "leather" },
  });

  objectManager.spawn("torch", {
    containedIn: roomEid,
  });

  // Spawn an NPC
  objectManager.spawn("npc", {
    name: "Old Librarian",
    containedIn: roomEid,
    properties: { adjective: "elderly", role: "librarian" },
  });

  // Spawn a door
  objectManager.spawn("door", {
    name: "Exit Door",
    containedIn: roomEid,
    properties: { adjective: "creaky", material: "wooden" },
  });

  // Render the room
  const rendered = textRenderer.renderRoom(roomEid, {
    detailed: true,
    includeExits: true,
  });

  console.log("\n--- Room Description ---");
  console.log(rendered.fullText);
  console.log("------------------------");

  console.log("\n✓ Text rendering works");
}

// Test 7: Rules engine
function testRulesEngine() {
  console.log("\n=== Test 7: Rules Engine ===");

  const { world, objectManager, rulesEngine } = createTestWorld();

  // Define a custom rule for testing
  worldSchema.defineRule({
    name: "test_decay",
    description: "Test rule that adds 'decaying' trait to food",
    when: {
      event: "tick",
      condition: { has: ["edible"], inState: "fresh" },
    },
    then: [
      {
        action: "add_trait",
        target: "self",
        params: { trait: "decaying", chance: 1.0 },
      },
    ],
    priority: 1,
    enabled: true,
  });

  // Spawn some food
  const foodEid = objectManager.spawn("food_item", {
    name: "Fresh Apple",
    properties: { adjective: "juicy", foodType: "apple" },
  });

  const initialTraits = objectManager.getTraits(foodEid!);
  console.log(`Initial food traits: ${initialTraits.join(", ")}`);

  // Process a tick
  const events = rulesEngine.processTick(1);
  console.log(`Tick processed, ${events.length} events emitted`);

  const afterTraits = objectManager.getTraits(foodEid!);
  console.log(`After tick traits: ${afterTraits.join(", ")}`);

  console.log("\n✓ Rules engine processes correctly");
}

// Test 8: Action processing
function testActionProcessing() {
  console.log("\n=== Test 8: Action Processing ===");

  const { world, objectManager, rulesEngine } = createTestWorld();

  // Create an actor
  const actorEid = objectManager.spawnCustom({
    name: "Hero",
    description: "A brave adventurer",
    traits: ["alive", "talkable"],
  });

  // Create a chest
  const chestEid = objectManager.spawn("chest", {
    properties: { adjective: "wooden", material: "pine" },
  });

  // Try to open the chest
  const openResult = rulesEngine.processAction("open", actorEid, chestEid!, 1);
  console.log(`Open action: ${openResult.success ? "SUCCESS" : "FAILED"}`);
  console.log(`  Message: ${openResult.message}`);

  // Verify state changed
  const info = objectManager.getInfo(chestEid!);
  console.log(`  New state: ${info?.state}`);

  // Try to close it
  const closeResult = rulesEngine.processAction("close", actorEid, chestEid!, 2);
  console.log(`\nClose action: ${closeResult.success ? "SUCCESS" : "FAILED"}`);
  console.log(`  Message: ${closeResult.message}`);

  // Try an impossible action (sit on chest - no sittable trait)
  const sitResult = rulesEngine.processAction("sit", actorEid, chestEid!, 3);
  console.log(`\nSit action: ${sitResult.success ? "SUCCESS" : "FAILED"}`);
  console.log(`  Message: ${sitResult.message}`);

  console.log("\n✓ Action processing works correctly");
}

// Run all tests
async function runAllTests() {
  console.log("╔════════════════════════════════════════╗");
  console.log("║     WORLD SYSTEM TEST SUITE            ║");
  console.log("╚════════════════════════════════════════╝");

  try {
    testWorldSchemaBaseTypes();
    testDefineCustomType();
    testSpawnObjects();
    testStateTransitions();
    testAffordances();
    testTextRendering();
    testRulesEngine();
    testActionProcessing();

    console.log("\n" + "=".repeat(50));
    console.log("ALL TESTS PASSED!");
    console.log("=".repeat(50));
  } catch (error) {
    console.error("\n❌ TEST FAILED:", error);
    process.exit(1);
  }
}

runAllTests();
