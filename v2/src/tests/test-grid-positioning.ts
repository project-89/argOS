import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, resetRoomPositionCounter } from "../ecs/prefabs";
import { createGodAgent, godThink, getWorldState } from "../god/god-agent";

async function runGridTest() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  ArgOS v2 - Grid Positioning Test                            ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const world = createArgosWorld();
  initializePrefabs(world);
  resetRoomPositionCounter();
  const state = createGodAgent(world, {
    name: "Architect",
    worldName: "GridTestWorld",
    narrative: "Testing grid positioning and collision detection",
  });

  console.log("═".repeat(70));
  console.log("TEST: GRID POSITIONING & COLLISION DETECTION");
  console.log("═".repeat(70));
  console.log("\nAsking God to create a map with entities and test positioning...\n");

  const { thinking, actions } = await godThink(state, `
    Create a grid-based puzzle room to test positioning:
    
    1. Create a world map called "PuzzleRoom" (20x10) filled with '.'
    2. Draw walls around the perimeter using '#'
    3. Draw some internal walls:
       - A horizontal wall from (5,3) to (15,3)
       - A vertical wall from (10,3) to (10,7)
    4. Add a door at (10,3) using '+'
    
    5. Create an object called "Player" and place it on the grid at (3,5) with char '@' and color '#00ff00'
    6. Create an object called "Boulder" and place it on the grid at (7,5) with char 'O' and color '#888888'
    7. Create an object called "Treasure" and place it on the grid at (15,7) with char 'T' and color '#ffff00'
    
    Now test the positioning tools:
    8. Use getEntityPosition to get the Player's position
    9. Use getEntitiesAtPosition at (7,5) to see what's there
    10. Use getEntitiesInRadius at (7,5) with radius 5 to see nearby entities
    11. Use checkCollision to see if Player can move east (toward Boulder)
    12. Use checkCollision to see if Player can move north (toward wall)
    
    Report what you find at each step.
  `);

  console.log(`\n📦 Actions executed: ${actions.length}`);
  console.log("\n🧠 God's thinking:");
  console.log(thinking);

  console.log("\n📊 World State:");
  console.log(getWorldState(state));

  console.log("\n✅ Grid positioning test complete!");
}

runGridTest().catch(console.error);
