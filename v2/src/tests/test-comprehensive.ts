import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, resetRoomPositionCounter } from "../ecs/prefabs";
import { createGodAgent, godThink, getWorldState, tickWorld } from "../god/god-agent";

async function runComprehensiveTest() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  ArgOS v2 - Comprehensive Capability Test                    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const world = createArgosWorld();
  initializePrefabs(world);
  resetRoomPositionCounter();
  const state = createGodAgent(world, {
    name: "Architect",
    worldName: "TestWorld",
    narrative: "Testing deterministic systems, spatial accuracy, and cognitive extensions",
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: Complex Deterministic World
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═".repeat(70));
  console.log("TEST 1: DETERMINISTIC WORLD WITH INTERACTING SYSTEMS");
  console.log("═".repeat(70));
  console.log("\nAsking God to create a physics-based puzzle room...\n");

  const { thinking: t1, actions: a1 } = await godThink(state, `
    Create a deterministic puzzle room that demonstrates object properties and system interactions:
    
    1. Create a component called "Weight" with a "value" property (number, kilograms)
    2. Create a component called "Pressure" with "threshold" (number) and "activated" (boolean)
    3. Create a component called "Temperature" with "celsius" (number) and "flammable" (boolean)
    4. Create a component called "Electricity" with "powered" (boolean) and "voltage" (number)
    
    5. Create a room called "Puzzle Chamber" 
    
    6. Create these objects IN the Puzzle Chamber with their properties:
       - "Heavy Boulder" with Weight=50
       - "Pressure Plate" with Pressure threshold=40, activated=false
       - "Torch" with Temperature celsius=400, flammable=false
       - "Wooden Crate" with Weight=10, Temperature celsius=20, flammable=true
       - "Generator" with Electricity powered=false, voltage=0
       - "Electric Door" with Electricity powered=false, voltage=0
    
    7. Create a system called "PressurePlateSystem" that:
       - Checks if any object with Weight >= Pressure.threshold is in the same room as the pressure plate
       - If so, sets Pressure.activated = true
       - Description: "Activates pressure plates when heavy objects are placed on them"
    
    8. Create a system called "ElectricCircuitSystem" that:
       - When a pressure plate is activated, powers the generator (Electricity.powered=true, voltage=220)
       - When generator is powered, also powers the electric door
       - Description: "Propagates electricity from generators to connected devices"
    
    After creating everything, list all the entities with their components to verify.
  `);

  console.log(`\n📦 Test 1 Actions: ${a1.length}`);
  
  // Run a few ticks to see if systems work
  console.log("\n⚙️  Running world ticks to test systems...");
  for (let i = 0; i < 3; i++) {
    const events = tickWorld(state, 1000);
    if (events.length > 0) {
      console.log(`   Tick ${i + 1}: ${events.length} events`);
      events.forEach(e => console.log(`     - ${e.type}: ${JSON.stringify(e.data).slice(0, 60)}`));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: ASCII Spatial Accuracy
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n" + "═".repeat(70));
  console.log("TEST 2: ASCII SPATIAL ACCURACY");
  console.log("═".repeat(70));
  console.log("\nAsking God to create a precise ASCII layout...\n");

  const { thinking: t2, actions: a2 } = await godThink(state, `
    Create a precise ASCII dungeon map called "Dungeon" (25x15) with these EXACT specifications:
    
    Layout requirements:
    - Outer walls using '#' around the entire perimeter
    - An entrance room (5x5) in the bottom-left corner at position (1,9) to (5,13)
    - A corridor (width 3) running from the entrance room to the right
    - A treasure room (7x5) in the top-right area at position (16,1) to (22,5)
    - A trap room (5x5) in the middle at position (10,5) to (14,9)
    - Doors marked with 'D' connecting:
      - Entrance room to corridor at (5,11)
      - Corridor to trap room at (10,7)
      - Trap room to treasure room at (14,3)
    - Place a 'T' for treasure chest at position (19,3)
    - Place a 'X' for trap at position (12,7)
    - Place a 'P' for player start at position (3,11)
    
    After creating, use getWorldMap to show the result so I can verify accuracy.
  `);

  console.log(`\n🗺️  Test 2 Actions: ${a2.length}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: Cognitive Extensions (Hunger System)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n" + "═".repeat(70));
  console.log("TEST 3: COGNITIVE EXTENSIONS - HUNGER & NEEDS SYSTEM");
  console.log("═".repeat(70));
  console.log("\nAsking God to create agents with hunger that affects cognition...\n");

  const { thinking: t3, actions: a3 } = await godThink(state, `
    Create a survival scenario with agents whose hunger affects their decisions:
    
    1. Create components:
       - "Hunger" with "level" (0-100, 100=starving), "lastAte" (timestamp), "metabolism" (rate of hunger increase)
       - "Energy" with "level" (0-100), "maxLevel" (number)
       - "Edible" with "nutritionValue" (number), "spoiled" (boolean)
    
    2. Create a room called "Survival Camp"
    
    3. Create an agent called "Survivor" in Survival Camp with:
       - Role: "hungry survivor"
       - System prompt that says: "You are desperately hungry. Your hunger level affects your priorities. When hunger > 70, you MUST prioritize finding food above all else. When hunger > 90, you become irrational and might make poor decisions. Always check your hunger status before acting."
       - Add Hunger component with level=75, metabolism=5
       - Add Energy component with level=50, maxLevel=100
    
    4. Create food objects in Survival Camp:
       - "Canned Beans" with Edible nutritionValue=30, spoiled=false
       - "Rotten Apple" with Edible nutritionValue=10, spoiled=true
       - "Fresh Bread" with Edible nutritionValue=25, spoiled=false
    
    5. Create a system called "HungerSystem" that:
       - Increases Hunger.level by metabolism each tick
       - Decreases Energy.level as hunger increases (when hunger > 50)
       - Description: "Simulates hunger increasing over time and affecting energy"
    
    6. Create a system called "EatingSystem" that:
       - When an agent interacts with an Edible object, reduces their hunger by nutritionValue
       - If the food is spoiled, also reduces energy by 20
       - Description: "Handles eating mechanics and nutrition"
    
    7. Send a stimulus to Survivor saying "You notice food nearby. Your stomach growls loudly. What do you do?"
    
    List the survivor's current state including their hunger and energy levels.
  `);

  console.log(`\n🧠 Test 3 Actions: ${a3.length}`);

  // Run ticks to see hunger system in action
  console.log("\n⚙️  Running ticks to simulate hunger...");
  for (let i = 0; i < 5; i++) {
    const events = tickWorld(state, 1000);
    if (events.length > 0) {
      console.log(`   Tick ${i + 1}: ${events.length} events`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n" + "═".repeat(70));
  console.log("FINAL SUMMARY");
  console.log("═".repeat(70));

  const { thinking: summary } = await godThink(state, `
    Give me a complete status report:
    1. List all custom components that were created
    2. List all systems that are running
    3. Show the Dungeon map if it exists
    4. List all agents and their current component values (especially Hunger/Energy)
    5. List all objects and their properties
    
    Format this as a clear report.
  `);

  console.log("\n📊 World State:");
  console.log(getWorldState(state));

  console.log("\n🧠 Memory State:");
  console.log(`   Short-term memories: ${state.memory.shortTerm.length}`);
  console.log(`   Long-term memories: ${state.memory.longTerm.length}`);
  console.log(`   Active plans: ${state.memory.plans.filter(p => p.status === "active").length}`);

  console.log("\n✅ Comprehensive test complete!");
}

runComprehensiveTest().catch(console.error);
