/**
 * ArgOS v2 - Development Server (No Auto-Simulation)
 *
 * Starts the server with an empty world, ready for simulation creation via UI.
 */

import "dotenv/config";
import { createArgosWorld } from "./ecs/world";
import { initializePrefabs } from "./ecs/prefabs";
import { createGodAgent, godThink } from "./god/god-agent";
import { createSimulationServer } from "./server/simulation-server";
import {
  createTimeProgressionSystem,
  createSocialDynamicsSystem,
  createNarrativeEventSystem,
  createRelationshipEvolutionSystem,
} from "./systems/builtin-systems";
import {
  initializeSpiritSystem,
  createStandardHierarchy,
  startSpiritSystem,
  getAllSpirits,
  tickSpiritSystem,
  getSpiritSystemState,
  getSpiritByName,
  type SpiritSystemState,
  type DivineMessage,
} from "./spirits";
import { runWorldCrafterCycle, getPendingInteractions } from "./spirits/world-crafter-spirit";
import {
  runStewardCycle,
  requestRoomPopulation,
  getPendingRoomRequests,
  type PopulatedRoom,
} from "./spirits/steward-spirit";
import {
  getPendingProposals,
  approveProposal,
  getApprovedProposals,
} from "./spirits/spirit-factory";
import { executeAllApprovedProposals } from "./spirits/architect-spirit";
import type { GodCommandInjection, SpiritMessageInjection } from "./bus/simulation-bus";
import { query, getRelationTargets } from "bitecs";
import { Agent, Room, Name, Description, Mind, StimulusSource, Memory, Thought } from "./ecs/components";
import { OccupiesRoom, HasMemory, HasThought } from "./ecs/relations";
import { runCognitionCycle, executeActions } from "./cognition/cognition-system";
import { getAgentThoughts } from "./cognition/agent-mind";

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║         ArgOS v2 - Development Server                        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  const server = createSimulationServer(3000);

  // Create empty world
  const world = createArgosWorld("Empty World");
  initializePrefabs(world);

  // Create god agent with minimal config (no preset simulation)
  const god = createGodAgent(world, {
    name: "The Architect",
    worldName: "New Simulation",
    narrative: "An empty canvas awaiting creation.",
  });

  // Register builtin systems
  god.systemRegistry.systems.set("TimeProgression", createTimeProgressionSystem());
  god.systemRegistry.systems.set("SocialDynamics", createSocialDynamicsSystem());
  god.systemRegistry.systems.set("NarrativeEvents", createNarrativeEventSystem());
  god.systemRegistry.systems.set("RelationshipEvolution", createRelationshipEvolutionSystem());

  // Initialize the spirit system with the standard hierarchy
  const spiritSystem = initializeSpiritSystem(world, {
    godAgentEid: god.eid,
    tickInterval: 10000, // Spirits observe every 10 seconds
    autoCreateNarrator: false, // We'll create via standard hierarchy
  });
  createStandardHierarchy(god.eid);
  startSpiritSystem();
  console.log("[SpiritSystem] Spirits initialized and running");

  let tick = 0;

  server.setSimulationState({
    world,
    registry: god.systemRegistry,
    tick: 0,
    events: [],
    logs: [],
  });
  server.setGodAgent(god);

  // Helper to emit world state to the bus
  function emitWorldState() {
    const agentEids = query(world, [Agent]);
    const roomEids = query(world, [Room]);
    const stimulusSourceEids = query(world, [StimulusSource]);
    const systemCount = god.systemRegistry.systems.size;

    // Build agent summaries
    const agents = agentEids.map(eid => {
      const roomTargets = getRelationTargets(world, eid, OccupiesRoom);
      const roomEid = roomTargets[0];

      // Get agent's memories (limit to 20 most recent)
      const memoryEids = getRelationTargets(world, eid, HasMemory);
      const memories = memoryEids
        .filter(memEid => Memory.content[memEid])
        .map(memEid => ({
          id: memEid,
          type: Memory.type[memEid] || "unknown",
          content: Memory.content[memEid] || "",
          importance: Memory.importance[memEid] || 0,
          emotionalValence: Memory.emotionalValence[memEid] || 0,
          timestamp: Memory.timestamp[memEid] || 0,
        }))
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 20);

      // Get current thought if any
      const thoughtEids = getRelationTargets(world, eid, HasThought);
      const latestThought = thoughtEids
        .filter(tEid => Thought.content[tEid])
        .map(tEid => ({ content: Thought.content[tEid], ts: Thought.timestamp[tEid] || 0 }))
        .sort((a, b) => b.ts - a.ts)[0];

      return {
        id: eid,
        name: Name.value[eid] || `Agent ${eid}`,
        description: Description.value[eid] || "",
        role: Agent.role[eid] || "",
        room: roomEid ? Name.value[roomEid] : null,
        mind: {
          mode: Mind.mode[eid] || "idle",
          arousal: Mind.arousal[eid] || 0,
          focus: Mind.focus[eid] || "",
        },
        memories,
        currentThought: latestThought?.content || null,
      };
    });

    // Build room summaries
    const rooms = roomEids.map(eid => {
      // Find agents in this room
      const occupants = agentEids.filter(agentEid => {
        const roomTargets = getRelationTargets(world, agentEid, OccupiesRoom);
        return roomTargets.includes(eid);
      }).map(agentEid => Name.value[agentEid] || `Agent ${agentEid}`);

      return {
        id: eid,
        name: Name.value[eid] || `Room ${eid}`,
        description: Description.value[eid] || "",
        capacity: Room.capacity[eid] || 10,
        ambience: Room.ambience[eid] || "",
        occupants,
      };
    });

    // Build stimulus source summaries
    const stimulusSources = stimulusSourceEids.map(eid => {
      const roomTargets = getRelationTargets(world, eid, OccupiesRoom);
      const roomEid = roomTargets[0];
      return {
        id: eid,
        name: Name.value[eid] || `Source ${eid}`,
        description: Description.value[eid] || "",
        room: roomEid ? Name.value[roomEid] : null,
        type: StimulusSource.stimulusType[eid] || "ambient",
      };
    });

    // Build system summaries
    const systems = Array.from(god.systemRegistry.systems.entries()).map(([name, sys]) => ({
      name,
      description: sys.description || "",
      frequency: sys.frequency || 1000,
      active: sys.active !== false,
    }));

    // Build spirit summaries
    const activeSpirits = getAllSpirits();
    const spirits = activeSpirits.map(spirit => ({
      id: spirit.eid,
      name: spirit.definition.name,
      domain: spirit.definition.domain,
      rank: spirit.definition.rank,
      description: spirit.definition.description,
      observationInterval: spirit.definition.observationInterval,
      lastObservation: spirit.lastObservationTime,
      inboxSize: spirit.inbox.length,
      observationsCount: spirit.observations.length,
    }));

    const event = {
      type: "world:state" as const,
      timestamp: Date.now(),
      tick: tick,
      agentCount: agentEids.length,
      roomCount: roomEids.length,
      systemCount: systemCount,
      spiritCount: spirits.length,
      // Include full entity data
      agents,
      rooms,
      stimulusSources,
      systems,
      spirits,
    };

    console.log(`[WorldState] Emitting: tick=${tick}, agents=${agentEids.length}, rooms=${roomEids.length}, systems=${systemCount}, spirits=${spirits.length}`);
    server.bus.emit(event);
  }

  // Track if we're currently running cognition
  let runningCognition = false;

  // Run cognition cycle (every 5 seconds when agents exist)
  async function runCognitionTick() {
    const agentEids = query(world, [Agent]);
    if (agentEids.length === 0 || runningCognition) return;

    runningCognition = true;
    try {
      console.log(`[Cognition] Running cognitive cycle for ${agentEids.length} agents...`);

      // Run the cognition cycle
      const actions = await runCognitionCycle(world, god.systemRegistry, { tick });

      // Emit events for each agent's action and thought
      for (const { eid, action } of actions) {
        const name = Name.value[eid] || `Agent ${eid}`;

        // Get the agent's most recent thought
        const thoughtEids = getAgentThoughts(world, eid);
        const latestThoughtEid = thoughtEids[thoughtEids.length - 1];
        const latestThought = latestThoughtEid ? Thought.content[latestThoughtEid] : null;

        // Emit thought event if there's a new thought
        if (latestThought) {
          server.bus.emit({
            type: "agent:think",
            timestamp: Date.now(),
            agentId: eid,
            agentName: name,
            thought: latestThought,
            mode: Mind.mode[eid] || "reactive",
            arousal: Mind.arousal[eid] || 0.5,
          });
        }

        // Emit action event
        server.bus.emit({
          type: "agent:action",
          timestamp: Date.now(),
          agentId: eid,
          agentName: name,
          action: action.type,
          target: action.target,
          content: action.content,
        });

        console.log(`  [${name}] ${action.type}${action.target ? ` -> ${action.target}` : ""}${action.content ? `: ${action.content.substring(0, 50)}...` : ""}`);
      }

      // Execute the actions
      if (actions.length > 0) {
        executeActions(world, actions, god.systemRegistry);
      }
    } catch (error) {
      console.error("[Cognition] Error:", error);
    } finally {
      runningCognition = false;
    }
  }

  // Emit world state periodically (every 1 second)
  setInterval(() => {
    tick++;
    emitWorldState();
  }, 1000);

  // Run cognition cycle periodically (every 5 seconds when agents exist)
  setInterval(() => {
    runCognitionTick();
  }, 5000);

  // Run spirit system tick periodically (every 10 seconds)
  setInterval(async () => {
    try {
      // Use god.registry which is a proper EntityRegistry with byName and byId maps
      const result = await tickSpiritSystem(world, god.registry);

      // Emit spirit observation events
      if (result.spiritsProcessed > 0) {
        console.log(`[Spirits] Processed ${result.spiritsProcessed} spirits`);

        const spirits = getAllSpirits();
        for (const spirit of spirits) {
          if (spirit.observations.length > 0) {
            const latestObs = spirit.observations[spirit.observations.length - 1];
            if (latestObs && Date.now() - latestObs.timestamp < 15000) {
              server.bus.emit({
                type: "spirit:observe",
                timestamp: Date.now(),
                spiritId: spirit.eid,
                spiritName: spirit.definition.name,
                domain: spirit.definition.domain,
                rank: spirit.definition.rank,
                observationType: latestObs.type || "observation",
                content: latestObs.content || "Observation made",
                entities: latestObs.entities || [],
                location: latestObs.location,
                significance: latestObs.significance || 0.5,
              });
            }
          }

          // Also emit any recent messages from this spirit
          if (spirit.outbox && spirit.outbox.length > 0) {
            for (const msg of spirit.outbox) {
              if (Date.now() - msg.timestamp < 15000) {
                server.bus.emit({
                  type: "spirit:message",
                  timestamp: msg.timestamp,
                  spiritId: spirit.eid,
                  spiritName: spirit.definition.name,
                  messageType: msg.type,
                  content: msg.content || msg.subject,
                  priority: msg.priority || "normal",
                  subject: msg.subject,
                  toSpiritId: msg.to,
                });
              }
            }
          }
        }
      }

      // Emit narrative prose if any
      for (const prose of result.narrativeProse) {
        server.bus.emit({
          type: "spirit:message",
          timestamp: Date.now(),
          spiritName: "Narrator",
          content: prose,
        });
      }

      // Run World Crafter cycle - creates entities for failed agent interactions
      // Also runs periodically to check for evolution opportunities
      const state = getSpiritSystemState();
      if (state) {
        const pendingInteractions = getPendingInteractions();
        const shouldRunCrafter = pendingInteractions.length > 0 ||
          (Date.now() - (state as any).lastEvolutionCheck > 120000); // Run at least every 2 min

        if (pendingInteractions.length > 0) {
          console.log(`[WorldCrafter] Processing ${pendingInteractions.length} pending failed interactions...`);
        }

        const crafterResult = await runWorldCrafterCycle(world, state.registry, god);

        if (crafterResult.entitiesCreated > 0) {
          console.log(`[WorldCrafter] Created ${crafterResult.entitiesCreated} entities`);
          server.bus.emit({
            type: "spirit:message",
            timestamp: Date.now(),
            spiritName: "The Crafter",
            content: `Materialized ${crafterResult.entitiesCreated} entities to meet agent needs`,
            messageType: "creation",
            priority: "normal",
          });
          // Emit updated world state after creating entities
          emitWorldState();
        }
        if (crafterResult.recommendationsSent > 0) {
          console.log(`[WorldCrafter] Sent ${crafterResult.recommendationsSent} system recommendations to The Weaver`);
        }
        if (crafterResult.evolutionProposalsSent > 0) {
          console.log(`[WorldCrafter] Sent ${crafterResult.evolutionProposalsSent} evolution proposals to The Weaver`);
          server.bus.emit({
            type: "spirit:message",
            timestamp: Date.now(),
            spiritName: "The Crafter",
            content: `Proposed ${crafterResult.evolutionProposalsSent} world evolution(s) to address resource gaps`,
            messageType: "evolution",
            priority: "high",
          });
        }

        // Run The Steward cycle - populates rooms with entities
        const pendingRoomRequests = getPendingRoomRequests();
        if (pendingRoomRequests.length > 0) {
          console.log(`[Steward] Processing ${pendingRoomRequests.length} room population requests...`);
          const stewardResult = await runStewardCycle(state.registry);

          if (stewardResult.roomsPopulated > 0) {
            console.log(`[Steward] Populated ${stewardResult.roomsPopulated} rooms with ${stewardResult.entitiesGenerated} entities`);
            server.bus.emit({
              type: "spirit:message",
              timestamp: Date.now(),
              spiritName: "The Steward",
              content: `Furnished ${stewardResult.roomsPopulated} rooms with ${stewardResult.entitiesGenerated} entities`,
              messageType: "population",
              priority: "normal",
            });
            // Emit updated world state after populating rooms
            emitWorldState();
          }
          if (stewardResult.systemRequestsSent > 0) {
            console.log(`[Steward] Sent ${stewardResult.systemRequestsSent} system requests to The Weaver`);
          }
        }

        // Process spirit proposals - auto-approve system proposals
        const pendingProposals = getPendingProposals();
        if (pendingProposals.length > 0) {
          console.log(`[Proposals] ${pendingProposals.length} pending proposals`);
          for (const proposal of pendingProposals) {
            // Auto-approve system proposals (could add more sophisticated logic here)
            if (proposal.type === "system") {
              approveProposal(proposal.id, god.eid);
              console.log(`[Proposals] ✅ Auto-approved: ${proposal.name} (${proposal.type})`);
              server.bus.emit({
                type: "spirit:message",
                timestamp: Date.now(),
                spiritName: "System",
                content: `Approved proposal: ${proposal.name}`,
                messageType: "proposal_approved",
                priority: "high",
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
              server.bus.emit({
                type: "spirit:message",
                timestamp: Date.now(),
                spiritName: "The Weaver",
                content: `System created: ${name}`,
                messageType: "system_baked",
                priority: "high",
              });
            }
            // Emit updated world state after baking systems
            emitWorldState();
          }
          if (failed.length > 0) {
            console.log(`[Proposals] ❌ Failed: ${failed.join(", ")}`);
          }
        }
      }
    } catch (error) {
      console.error("[Spirits] Tick error:", error);
    }
  }, 10000);

  // Register injection handlers for the SimulationBus
  server.bus.registerInjectionHandler("inject:god_command", async (msg) => {
    const injection = msg as GodCommandInjection;
    console.log(`[God Command] ${injection.command}`);

    // Emit command started
    server.bus.emit({
      type: "god:command",
      timestamp: Date.now(),
      command: injection.command,
      status: "started",
    });

    try {
      const result = await godThink(god, injection.command);

      // Emit response
      server.bus.emit({
        type: "god:response",
        timestamp: Date.now(),
        command: injection.command,
        thinking: result.thinking,
        actions: result.actions,
      });

      // Emit updated world state after changes
      emitWorldState();
    } catch (error) {
      // Emit error
      server.bus.emit({
        type: "god:error",
        timestamp: Date.now(),
        command: injection.command,
        error: String(error),
      });
    }
  });

  // Register spirit message injection handler
  server.bus.registerInjectionHandler("inject:spirit_message", async (msg) => {
    const injection = msg as SpiritMessageInjection;
    console.log(`[Spirit Message] To: ${injection.targetSpiritName || injection.targetSpiritId} - ${injection.message.slice(0, 50)}...`);

    const state = getSpiritSystemState();
    if (!state) {
      console.error("[Spirit Message] Spirit system not initialized");
      return;
    }

    // Find target spirit
    let targetSpirit;
    if (injection.targetSpiritName) {
      targetSpirit = getSpiritByName(state.registry, injection.targetSpiritName);
    } else if (injection.targetSpiritId) {
      targetSpirit = state.registry.spirits.get(injection.targetSpiritId);
    }

    if (!targetSpirit) {
      console.error(`[Spirit Message] Spirit not found: ${injection.targetSpiritName || injection.targetSpiritId}`);
      server.bus.emit({
        type: "spirit:message",
        timestamp: Date.now(),
        spiritName: "System",
        content: `Could not find spirit: ${injection.targetSpiritName || injection.targetSpiritId}`,
        messageType: "error",
        priority: "high",
      });
      return;
    }

    // Create message for spirit's inbox
    const message: DivineMessage = {
      id: `user_msg_${Date.now()}`,
      timestamp: Date.now(),
      from: god.eid, // From the god/user
      to: targetSpirit.eid,
      type: "directive",
      domain: targetSpirit.definition.domain,
      priority: injection.priority || "normal",
      subject: injection.subject || "User Message",
      content: injection.message,
      requiresResponse: true,
    };

    // Add to spirit's inbox
    targetSpirit.inbox.push(message);
    console.log(`[Spirit Message] Added to ${targetSpirit.definition.name}'s inbox (${targetSpirit.inbox.length} messages)`);

    // Emit event to confirm message was received
    server.bus.emit({
      type: "spirit:message",
      timestamp: Date.now(),
      spiritName: targetSpirit.definition.name,
      spiritId: targetSpirit.eid,
      content: `Received message: "${injection.message.slice(0, 100)}..."`,
      messageType: "received",
      priority: injection.priority || "normal",
    });
  });

  server.start();

  console.log("\n✨ Server ready - use the UI to create a simulation\n");
}

main().catch(console.error);
