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
// Spirit System imports
import {
  initializeSpiritSystem,
  startSpiritSystem,
  createStandardHierarchy,
  tickSpiritSystem,
  setGodAgentCallback,
  getSpiritSystemDebugInfo,
} from "./spirits/spirit-system";
import { createEntityRegistry } from "./ecs/tools";
import {
  getPendingProposals,
  approveProposal,
  getApprovedProposals,
} from "./spirits/spirit-factory";
import { executeAllApprovedProposals } from "./spirits/architect-spirit";

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

  // Initialize Spirit System with the celestial hierarchy
  const entityRegistry = createEntityRegistry();
  initializeSpiritSystem(world, {
    godAgentEid: 1, // GodAgent entity
    tickInterval: 10000, // Spirits think every 10 seconds
    autoCreateNarrator: true,
  });
  createStandardHierarchy(1); // Creates The Narrator, The Arbiter, The Weaver, The Tinker, The Crafter, The Steward, The Lawgiver

  // Set up callback for spirits to communicate with GodAgent
  setGodAgentCallback(async (messages) => {
    for (const msg of messages) {
      console.log(`[Spirit→God] ${msg.from}: ${msg.subject}`);
      server.pushEvent("spirit", { from: msg.from, subject: msg.subject, content: msg.content });
    }
  });

  startSpiritSystem();
  console.log("👼 Spirit hierarchy initialized:", getSpiritSystemDebugInfo());

  console.log("\n⚡ Setting up world...\n");

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

    // Tick the Spirit System - spirits observe, think, and may propose changes
    const spiritResult = await tickSpiritSystem(world, entityRegistry);
    if (spiritResult.spiritsProcessed > 0) {
      console.log(`[Spirits] ${spiritResult.spiritsProcessed} spirits processed`);
    }
    if (spiritResult.narrativeProse.length > 0) {
      for (const prose of spiritResult.narrativeProse) {
        console.log(`[Narrator] ${prose}`);
        server.pushEvent("narrative", { content: prose, source: "narrator" });
      }
    }
    if (spiritResult.messagesForGodAI.length > 0) {
      console.log(`[Spirits→God] ${spiritResult.messagesForGodAI.length} messages queued`);
    }

    // Process spirit proposals - auto-approve system proposals
    const pendingProposals = getPendingProposals();
    if (pendingProposals.length > 0) {
      console.log(`[Proposals] ${pendingProposals.length} pending proposals`);
      for (const proposal of pendingProposals) {
        // Auto-approve system proposals (could add more sophisticated logic here)
        if (proposal.type === "system") {
          approveProposal(proposal.id, 1); // GodAgent eid = 1
          console.log(`[Proposals] ✅ Auto-approved: ${proposal.name} (${proposal.type})`);
          server.pushEvent("spirit", {
            type: "proposal_approved",
            name: proposal.name,
            proposalType: proposal.type
          });
        } else {
          console.log(`[Proposals] ⏸️ Pending review: ${proposal.name} (${proposal.type})`);
        }
      }
    }

    // Execute approved proposals (bakes new systems, creates entities, etc.)
    const approvedProposals = getApprovedProposals();
    if (approvedProposals.length > 0) {
      console.log(`[Proposals] Executing ${approvedProposals.length} approved proposals...`);
      const { executed, failed } = await executeAllApprovedProposals(world, god.systemRegistry);
      if (executed.length > 0) {
        console.log(`[Proposals] 🔧 Executed: ${executed.join(", ")}`);
        for (const name of executed) {
          server.pushEvent("spirit", { type: "proposal_executed", name });
        }
      }
      if (failed.length > 0) {
        console.log(`[Proposals] ❌ Failed: ${failed.join(", ")}`);
      }
    }

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
