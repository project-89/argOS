import "dotenv/config";
import { createArgosWorld } from "./ecs/world";
import { initializePrefabs } from "./ecs/prefabs";
import { createGodAgent, godCommand, getWorldState, tickWorld } from "./god/god-agent";
import { 
  runCognitionCycle, 
  executeActions, 
  broadcastToRoom,
  queueStimulus 
} from "./cognition/cognition-system";
import { 
  createTimeProgressionSystem,
  createSocialDynamicsSystem,
  createNarrativeEventSystem,
  createRelationshipEvolutionSystem 
} from "./systems/builtin-systems";
import { createSimulationServer } from "./server/simulation-server";
import { query, getRelationTargets } from "bitecs";
import { Agent, Name, Mind } from "./ecs/components";
import { OccupiesRoom } from "./ecs/relations";

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║         ArgOS v2 - Live Simulation                           ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  const server = createSimulationServer(3000);

  const world = createArgosWorld("The Realm");
  initializePrefabs(world);

  const god = createGodAgent(world, {
    name: "The Weaver",
    worldName: "The Crossroads Inn",
    narrative: `An ancient inn at a mystical crossroads where travelers from different walks of life meet. 
Strange things happen here - time feels different, and connections form quickly.
Create a living, breathing world with interesting characters who have their own motivations.`,
  });

  god.systemRegistry.systems.set("TimeProgression", createTimeProgressionSystem());
  god.systemRegistry.systems.set("SocialDynamics", createSocialDynamicsSystem());
  god.systemRegistry.systems.set("NarrativeEvents", createNarrativeEventSystem());
  god.systemRegistry.systems.set("RelationshipEvolution", createRelationshipEvolutionSystem());

  console.log("⚡ Setting up world...\n");

  await godCommand(god, `
    Create "The Crossroads Inn" - a mystical tavern where paths converge.
    
    Create three agents with rich personalities:
    1. "Vera" - an elderly fortune teller with genuine mystical sight, speaks in riddles but kind
    2. "Kael" - a young runaway noble seeking adventure, naive but brave, wearing fine but worn clothes
    3. "Iron Jack" - a weathered bounty hunter, few words, strong moral code, scarred face
    
    Create a stimulus source "Mystic Hearth" - a magical fireplace that occasionally whispers cryptic prophecies.
    
    Place everyone in the inn.
  `);

  console.log("\n✅ World created!");
  console.log(getWorldState(god));

  server.setSimulationState({
    world,
    registry: god.systemRegistry,
    tick: 0,
    events: [],
    logs: [],
  });
  server.setGodAgent(god);

  server.start();

  const agents = Array.from(query(world, [Agent]));
  let innEid: number | undefined;
  
  for (const eid of agents) {
    const rooms = getRelationTargets(world, eid, OccupiesRoom);
    if (rooms.length > 0) {
      innEid = rooms[0];
      break;
    }
  }

  console.log("\n🎭 Starting simulation loop...\n");

  let cycle = 0;
  
  async function simulationLoop() {
    if (server.isPaused()) {
      setTimeout(simulationLoop, 1000);
      return;
    }

    cycle++;
    console.log(`\n--- Cycle ${cycle} ---`);

    tickWorld(god, 5000);

    if (cycle === 1 && innEid !== undefined) {
      broadcastToRoom(world, innEid, {
        type: "environmental",
        content: "The door creaks open as a gust of wind carries rain into the tavern. Three travelers find themselves drawn to the warmth of the hearth.",
        source: "narrator",
      });
    }

    if (cycle % 10 === 0 && innEid !== undefined) {
      const dramaticEvents = [
        "A distant church bell tolls midnight.",
        "Thunder rumbles ominously outside.",
        "The fire flares briefly, casting strange shadows.",
        "A cold draft sweeps through the room.",
        "Someone pounds on the door but stops before anyone can answer.",
      ];
      const event = dramaticEvents[Math.floor(Math.random() * dramaticEvents.length)];
      broadcastToRoom(world, innEid, {
        type: "environmental",
        content: event,
        source: "environment",
      });
      server.pushEvent("narrative", { content: event });
    }

    const actions = await runCognitionCycle(world, god.systemRegistry);
    
    for (const { eid, action } of actions) {
      const name = Name.value[eid];
      server.pushAgentAction(name, action);
    }
    
    executeActions(world, actions, god.systemRegistry);

    server.setSimulationState({
      world,
      registry: god.systemRegistry,
      tick: cycle,
      events: god.systemRegistry.events.slice(-50),
      logs: god.systemRegistry.logs.slice(-50),
    });
    server.updateState();

    setTimeout(simulationLoop, 3000);
  }

  setTimeout(simulationLoop, 2000);

  process.on("SIGINT", () => {
    console.log("\n\n🛑 Simulation stopped.");
    process.exit(0);
  });
}

main().catch(console.error);
