import "dotenv/config";
import { createArgosWorld } from "./ecs/world";
import { initializePrefabs, resetRoomPositionCounter } from "./ecs/prefabs";
import { createGodAgent, godCommand, tickWorld } from "./god/god-agent";
import { query } from "bitecs";
import { Agent, Room, Name, Needs, Interactable } from "./ecs/components";
import { loadAllSystems, runLoadedSystems, type LoadedSystem } from "./systems/system-loader";
import { createSystemRegistry } from "./ecs/dynamic-systems";

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  ArgOS v2 - God Agent + File-based Systems Test              ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const world = createArgosWorld("TestWorld");
  initializePrefabs(world);
  resetRoomPositionCounter();

  const god = createGodAgent(world, {
    name: "Architect",
    worldName: "Test Apartment",
    narrative: "A simple apartment simulation to test needs-based behaviors.",
  });

  console.log("🏗️  Asking God to create an apartment with a person...\n");
  
  const result = await godCommand(god, `
    Create a simple apartment simulation:
    1. Create a room called "Studio Apartment"
    2. Create an agent called "Alex" who lives there - give them the Needs component with hunger=50, energy=50
    3. Create a "Refrigerator" object with Interactable component (action="eating", targetNeed="hunger", effectAmount=40, cooldown=5)
    4. Create a "Bed" object with Interactable component (action="sleeping", targetNeed="energy", effectAmount=50, cooldown=10)
    5. Place Alex, Refrigerator, and Bed in the Studio Apartment
  `);

  console.log("\n📋 God's actions:");
  console.log("Actions taken:", result.length);

  const rooms = Array.from(query(world, [Room]));
  const agents = Array.from(query(world, [Agent]));
  
  console.log(`\n🏠 World state: ${rooms.length} rooms, ${agents.length} agents`);
  
  for (const eid of rooms) {
    console.log(`   Room: ${Name.value[eid]}`);
  }
  for (const eid of agents) {
    const hunger = Needs.hunger[eid];
    const energy = Needs.energy[eid];
    console.log(`   Agent: ${Name.value[eid]} (hunger: ${hunger ?? "N/A"}, energy: ${energy ?? "N/A"})`);
  }

  const interactables = Array.from(query(world, [Interactable]));
  for (const eid of interactables) {
    console.log(`   Object: ${Name.value[eid]} (${Interactable.action[eid]} -> ${Interactable.targetNeed[eid]})`);
  }

  console.log("\n📂 Loading file-based systems...");
  const fileSystems = await loadAllSystems();
  console.log(`   Loaded: ${fileSystems.map(s => s.name).join(", ")}`);

  if (agents.length > 0 && fileSystems.length > 0) {
    console.log("\n🎮 Running 50 ticks with file-based systems...\n");
    
    const registry = createSystemRegistry();
    
    for (let tick = 1; tick <= 50; tick++) {
      runLoadedSystems(world, fileSystems, registry, tick, 1);
      
      const logs = registry.logs.splice(0);
      const events = registry.events.splice(0);
      
      if (logs.length > 0 || events.length > 0 || tick % 5 === 0) {
        const agentEid = agents[0];
        console.log(`--- Tick ${tick} ---`);
        console.log(`   ${Name.value[agentEid]}: hunger=${Math.round(Needs.hunger[agentEid] ?? 0)}, energy=${Math.round(Needs.energy[agentEid] ?? 0)}`);
        for (const log of logs) console.log(`   ${log}`);
        for (const event of events) console.log(`   [${event.type}]`);
      }
    }
  }

  console.log("\n✅ Test complete!");
}

main().catch(console.error);
