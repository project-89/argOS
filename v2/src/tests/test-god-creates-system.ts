import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, resetRoomPositionCounter } from "../ecs/prefabs";
import { createGodAgent, godCommand } from "../god/god-agent";
import { runLoadedSystems } from "../systems/system-loader";
import { query } from "bitecs";
import { Agent, Name, Needs } from "../ecs/components";

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  ArgOS v2 - God Creates System Test                          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const world = createArgosWorld("TestWorld");
  initializePrefabs(world);
  resetRoomPositionCounter();

  const god = createGodAgent(world, {
    name: "Architect",
    worldName: "System Creation Test",
    narrative: "Testing God's ability to create deterministic systems.",
  });

  console.log("🏗️  Asking God to create an agent and a custom decay system...\n");
  
  const result = await godCommand(god, `
    Create a simple test:
    1. Create a room called "Test Chamber"
    2. Create an agent called "TestSubject" with Needs component (hunger=30, energy=70)
    3. Create a NEW SYSTEM called "CustomDecay" that:
       - Runs every tick (frequency 1)
       - For all agents with Needs, increases hunger by 2 and decreases energy by 1
       - Logs when hunger > 50 saying "{name} is getting peckish"
       
    Use the createSystem tool to write this new system!
  `);

  console.log("\n📋 God's actions:");
  console.log("Actions:", result.length, "tool calls executed");
  
  const agents = Array.from(query(world, [Agent]));
  console.log(`\n🧪 World state: ${agents.length} agents`);
  
  for (const eid of agents) {
    console.log(`   Agent: ${Name.value[eid]} (hunger: ${Needs.hunger[eid]}, energy: ${Needs.energy[eid]})`);
  }

  console.log(`\n📂 File systems loaded: ${god.fileSystems.length}`);
  for (const sys of god.fileSystems) {
    console.log(`   - ${sys.name}: ${sys.description}`);
  }

  if (agents.length > 0 && god.fileSystems.length > 0) {
    console.log("\n🎮 Running 20 ticks with God-created systems...\n");
    
    for (let tick = 1; tick <= 20; tick++) {
      runLoadedSystems(world, god.fileSystems, god.systemRegistry, tick, 1);
      
      const logs = god.systemRegistry.logs.splice(0);
      
      if (logs.length > 0 || tick % 5 === 0) {
        const agentEid = agents[0];
        console.log(`--- Tick ${tick} ---`);
        console.log(`   ${Name.value[agentEid]}: hunger=${Math.round(Needs.hunger[agentEid] ?? 0)}, energy=${Math.round(Needs.energy[agentEid] ?? 0)}`);
        for (const log of logs) console.log(`   ${log}`);
      }
    }
  }

  console.log("\n✅ Test complete!");
}

main().catch(console.error);
