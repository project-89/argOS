import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { addEntity, addComponent } from "bitecs";
import { 
  Name, Description, Agent, Room, Needs, Interactable, CurrentAction, Mind 
} from "../ecs/components";
import { OccupiesRoom } from "../ecs/relations";
import { createSystemRegistry } from "../ecs/dynamic-systems";
import { 
  loadAllSystems, 
  runLoadedSystems, 
  type LoadedSystem 
} from "../systems/system-loader";

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║         ArgOS v2 - Deterministic Systems Test                ║");
  console.log("║         No AI - Pure ECS mechanics                           ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const world = createArgosWorld("TestWorld");
  const registry = createSystemRegistry();

  const roomEid = addEntity(world);
  addComponent(world, roomEid, Room);
  addComponent(world, roomEid, Name);
  Name.value[roomEid] = "Apartment";
  Description.value[roomEid] = "A cozy studio apartment";
  Room.capacity[roomEid] = 10;

  const agentEid = addEntity(world);
  addComponent(world, agentEid, Agent);
  addComponent(world, agentEid, Name);
  addComponent(world, agentEid, Needs);
  addComponent(world, agentEid, CurrentAction);
  addComponent(world, agentEid, Mind);
  addComponent(world, agentEid, OccupiesRoom(roomEid));
  Name.value[agentEid] = "Bob";
  Description.value[agentEid] = "A simple person with simple needs";
  Agent.role[agentEid] = "resident";
  Agent.active[agentEid] = true;
  Needs.hunger[agentEid] = 60;
  Needs.energy[agentEid] = 40;
  Mind.mode[agentEid] = "idle";

  const fridgeEid = addEntity(world);
  addComponent(world, fridgeEid, Name);
  addComponent(world, fridgeEid, Interactable);
  addComponent(world, fridgeEid, OccupiesRoom(roomEid));
  Name.value[fridgeEid] = "Fridge";
  Description.value[fridgeEid] = "A refrigerator full of food";
  Interactable.action[fridgeEid] = "eating";
  Interactable.targetNeed[fridgeEid] = "hunger";
  Interactable.effectAmount[fridgeEid] = 40;
  Interactable.cooldown[fridgeEid] = 5;

  const bedEid = addEntity(world);
  addComponent(world, bedEid, Name);
  addComponent(world, bedEid, Interactable);
  addComponent(world, bedEid, OccupiesRoom(roomEid));
  Name.value[bedEid] = "Bed";
  Description.value[bedEid] = "A comfortable bed for sleeping";
  Interactable.action[bedEid] = "sleeping";
  Interactable.targetNeed[bedEid] = "energy";
  Interactable.effectAmount[bedEid] = 50;
  Interactable.cooldown[bedEid] = 10;

  console.log("🏠 Created world:");
  console.log(`   Room: ${Name.value[roomEid]}`);
  console.log(`   Agent: ${Name.value[agentEid]} (hunger: ${Needs.hunger[agentEid]}, energy: ${Needs.energy[agentEid]})`);
  console.log(`   Objects: ${Name.value[fridgeEid]}, ${Name.value[bedEid]}\n`);

  console.log("📂 Loading systems from files...");
  const systems = await loadAllSystems();
  console.log(`   Loaded ${systems.length} systems: ${systems.map(s => s.name).join(", ")}\n`);

  console.log("🎮 Starting simulation (30 ticks)...\n");
  
  for (let tick = 1; tick <= 30; tick++) {
    runLoadedSystems(world, systems, registry, tick, 1);
    
    const logs = registry.logs.splice(0);
    const events = registry.events.splice(0);
    
    if (tick % 5 === 0 || logs.length > 0 || events.length > 0) {
      console.log(`--- Tick ${tick} ---`);
      console.log(`   Bob: hunger=${Math.round(Needs.hunger[agentEid])}, energy=${Math.round(Needs.energy[agentEid])}`);
      if (CurrentAction.type[agentEid]) {
        console.log(`   Action: ${CurrentAction.type[agentEid]} at ${Name.value[CurrentAction.targetEid[agentEid]]}`);
      }
      for (const log of logs) {
        console.log(`   ${log}`);
      }
      for (const event of events) {
        console.log(`   [Event] ${event.type}: ${JSON.stringify(event.data)}`);
      }
      console.log();
    }
  }

  console.log("✅ Simulation complete!");
  console.log(`   Final state: hunger=${Math.round(Needs.hunger[agentEid])}, energy=${Math.round(Needs.energy[agentEid])}`);
}

main().catch(console.error);
