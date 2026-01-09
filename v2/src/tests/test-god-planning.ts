import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, resetRoomPositionCounter } from "../ecs/prefabs";
import { createGodAgent, godCommand, getActivePlan, addMemory, searchMemory } from "../god/god-agent";
import { query } from "bitecs";
import { Agent, Room, Name } from "../ecs/components";

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  ArgOS v2 - God Agent Planning & Memory Test                 ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const world = createArgosWorld("TestWorld");
  initializePrefabs(world);
  resetRoomPositionCounter();

  const god = createGodAgent(world, {
    name: "Architect",
    worldName: "Planning Test World",
    narrative: "A world for testing the God agent's planning and memory capabilities.",
  });

  console.log("🧠 Testing memory system...\n");

  addMemory(god, "decision", "World was created for testing planning capabilities", {
    importance: 9,
    tags: ["setup", "world-creation"],
  });

  addMemory(god, "observation", "The world is empty and needs population", {
    importance: 7,
    tags: ["setup", "observation"],
  });

  console.log("📝 Stored 2 initial memories\n");

  const memories = searchMemory(god, { tags: ["setup"] });
  console.log(`🔍 Found ${memories.length} memories with 'setup' tag:`);
  for (const m of memories) {
    console.log(`   [${m.type}] ${m.content}`);
  }

  console.log("\n🏗️  Asking God to create a complex apartment building...\n");
  console.log("(This should trigger the planning system for a multi-step task)\n");

  const result = await godCommand(god, `
    Create an apartment building with 3 apartments:
    
    1. Apartment A: A studio apartment with a bed and refrigerator. Add a resident named "Alex" who is a programmer.
    
    2. Apartment B: A one-bedroom apartment with a living room and bedroom. Add a couple named "Jordan" and "Sam" who are artists.
    
    3. Apartment C: A penthouse with a kitchen, living room, and bedroom. Add a resident named "Morgan" who is a CEO.
    
    Use the planning system to break this down into steps and track your progress.
  `);

  console.log(`\n📋 Actions executed: ${result.length}`);

  const activePlan = getActivePlan(god);
  if (activePlan) {
    console.log(`\n📋 Active Plan: ${activePlan.goal}`);
    console.log(`   Status: ${activePlan.status}`);
    for (const step of activePlan.steps) {
      const status = step.status === "completed" ? "✓" : 
                     step.status === "in_progress" ? "►" :
                     step.status === "failed" ? "✗" : "○";
      console.log(`   ${status} ${step.description}`);
    }
  } else {
    console.log("\n✅ No active plan (completed or not used)");
  }

  const rooms = Array.from(query(world, [Room]));
  const agents = Array.from(query(world, [Agent]));

  console.log(`\n🏠 World state: ${rooms.length} rooms, ${agents.length} agents`);

  for (const eid of rooms) {
    console.log(`   Room: ${Name.value[eid]}`);
  }
  for (const eid of agents) {
    console.log(`   Agent: ${Name.value[eid]}`);
  }

  console.log("\n🧠 Memory state:");
  console.log(`   Short-term: ${god.memory.shortTerm.length} entries`);
  console.log(`   Long-term: ${god.memory.longTerm.length} entries`);
  console.log(`   Plans: ${god.memory.plans.length}`);

  const recentActions = searchMemory(god, { type: "action" }).slice(-5);
  console.log("\n📝 Recent actions in memory:");
  for (const m of recentActions) {
    console.log(`   ${m.content.slice(0, 80)}...`);
  }

  console.log("\n✅ Test complete!");
}

main().catch(console.error);
