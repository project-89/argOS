/**
 * ArgOS Server
 *
 * A robust simulation server that:
 * - Creates simulations from prompts
 * - Streams all events in real-time via WebSocket
 * - Supports simulation lifecycle management
 * - Integrates with the ECS event bus
 */

import "dotenv/config";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

import { createArgosWorld, type World } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";
import type { SystemRegistry } from "../ecs/dynamic-systems";
import { listSystems, safeGetRelationTargets } from "../ecs/dynamic-systems";
import { query, getRelationTargets, entityExists } from "bitecs";
import {
  Name, Description, Agent, Mind, Room, Position, GridPosition,
  StimulusSource, Visual, Thought, Perception
} from "../ecs/components";
import { getDynamicComponentValues } from "../ecs/dynamic-components";
import { OccupiesRoom } from "../ecs/relations";
import { renderAsciiWorld } from "../world/ascii-world";
import { getAgentKnowledge } from "../cognition/knowledge-graph";
import { getAgentMemory, getAgentThoughts, getAgentPerceptions, getAgentConversation } from "../cognition/agent-mind";
import { runCognitionCycle, executeActions } from "../cognition/cognition-system";
import { BUILTIN_SYSTEMS } from "../systems/builtin-systems";

import {
  createGodAgentWithPersistence,
  createGodAgent,
  godCommand,
  godThink,
  tickWorldAsync,
  type GodAgentState
} from "../god/god-agent";

import {
  createSpiritRegistry,
  createSpirit,
  setGodAgent as setSpiritGodAgent,
  getHierarchyTree,
  getActiveSpirits,
  type SpiritRegistry
} from "../spirits/spirit-registry";
import type { SpiritDefinition } from "../spirits/types";
import {
  initializeSpiritSystem,
  startSpiritSystem,
  tickSpiritSystem,
  recordActionEvent,
  getSpiritSystemState,
  type SpiritSystemState
} from "../spirits/spirit-system";

import {
  listSimulations,
  deleteSimulation,
  type SimulationInstance
} from "../persistence/simulation-manager";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================================================
// TYPES
// =============================================================================

/**
 * System tick rates - separate fast ECS systems from slow AI systems.
 * Fast systems: run every tick (physics, stimulus emission, state updates)
 * Medium systems: run every few ticks (social dynamics, time progression)
 * Slow AI systems: run less frequently (agent cognition, spirit observations)
 */
interface TickRates {
  /** Base tick rate in ms - how often the main loop runs */
  baseTick: number;
  /** How many base ticks between ECS system runs (1 = every tick) */
  ecsRate: number;
  /** How many base ticks between agent cognition cycles */
  cognitionRate: number;
  /** How many base ticks between spirit system cycles */
  spiritRate: number;
  /** How many base ticks between full state broadcasts */
  stateBroadcastRate: number;
}

const DEFAULT_TICK_RATES: TickRates = {
  baseTick: 1000,       // Base tick every 1 second
  ecsRate: 1,           // ECS systems run every tick
  cognitionRate: 5,     // Agent cognition every 5 ticks (5 seconds)
  spiritRate: 10,       // Spirit system every 10 ticks (10 seconds)
  stateBroadcastRate: 5,// Full state every 5 ticks
};

interface ActiveSimulation {
  id: string;
  name: string;
  world: World;
  god: GodAgentState;
  spiritRegistry: SpiritRegistry;
  spiritSystem: SpiritSystemState;
  tick: number;
  status: "running" | "paused" | "stopped";
  tickInterval?: NodeJS.Timeout;
  tickRates: TickRates;
  createdAt: number;
  events: Array<{ type: string; data: any; timestamp: number }>;
  logs: string[];
  /** Track if cognition cycle is currently running to prevent overlap */
  cognitionRunning: boolean;
  /** Track if spirit cycle is currently running to prevent overlap */
  spiritRunning: boolean;
}

interface ClientMessage {
  type:
    | "createSimulation"
    | "listSimulations"
    | "loadSimulation"
    | "deleteSimulation"
    | "godCommand"
    | "pause"
    | "resume"
    | "stop"
    | "getState"
    | "setTickSpeed"
    | "setTickRates"
    | "getSystems";
  payload?: any;
}

interface ServerMessage {
  type:
    | "simulationCreated"
    | "simulationList"
    | "state"
    | "event"
    | "log"
    | "agentThought"
    | "agentAction"
    | "spiritMessage"
    | "godResponse"
    | "error"
    | "tick"
    | "systems"
    | "tickRates";
  payload: any;
  timestamp: number;
}

// =============================================================================
// SERVER
// =============================================================================

export function createArgosServer(port: number = 3000) {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  // Active simulation state
  let activeSimulation: ActiveSimulation | null = null;
  let tickRates: TickRates = { ...DEFAULT_TICK_RATES };
  const clients = new Set<WebSocket>();

  // Serve argos.html as the main page (before static middleware to override index.html)
  app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../../public/argos.html"));
  });
  // Serve static files
  app.use(express.static(path.join(__dirname, "../../public")));

  // =============================================================================
  // WEBSOCKET HANDLERS
  // =============================================================================

  wss.on("connection", (ws) => {
    console.log("[Server] Client connected");
    clients.add(ws);

    // Send current state if simulation running
    if (activeSimulation) {
      sendTo(ws, { type: "state", payload: getFullState(), timestamp: Date.now() });
    }

    ws.on("message", async (data) => {
      try {
        const msg: ClientMessage = JSON.parse(data.toString());
        await handleClientMessage(ws, msg);
      } catch (e) {
        console.error("[Server] Error handling message:", e);
        sendTo(ws, { type: "error", payload: String(e), timestamp: Date.now() });
      }
    });

    ws.on("close", () => {
      console.log("[Server] Client disconnected");
      clients.delete(ws);
    });
  });

  async function handleClientMessage(ws: WebSocket, msg: ClientMessage) {
    switch (msg.type) {
      case "createSimulation":
        await handleCreateSimulation(ws, msg.payload);
        break;

      case "listSimulations":
        await handleListSimulations(ws);
        break;

      case "loadSimulation":
        await handleLoadSimulation(ws, msg.payload?.id);
        break;

      case "deleteSimulation":
        await handleDeleteSimulation(ws, msg.payload?.id);
        break;

      case "godCommand":
        await handleGodCommand(ws, msg.payload?.command);
        break;

      case "pause":
        handlePause();
        break;

      case "resume":
        handleResume();
        break;

      case "stop":
        handleStop();
        break;

      case "getState":
        sendTo(ws, { type: "state", payload: getFullState(), timestamp: Date.now() });
        break;

      case "setTickSpeed":
        if (msg.payload?.speed) {
          tickRates.baseTick = Math.max(500, Math.min(30000, msg.payload.speed));
          if (activeSimulation) {
            activeSimulation.tickRates.baseTick = tickRates.baseTick;
          }
          broadcast({ type: "log", payload: `Base tick rate set to ${tickRates.baseTick}ms`, timestamp: Date.now() });
          broadcast({ type: "tickRates", payload: tickRates, timestamp: Date.now() });
        }
        break;

      case "setTickRates":
        if (msg.payload) {
          if (msg.payload.baseTick) tickRates.baseTick = Math.max(500, Math.min(30000, msg.payload.baseTick));
          if (msg.payload.ecsRate) tickRates.ecsRate = Math.max(1, Math.min(10, msg.payload.ecsRate));
          if (msg.payload.cognitionRate) tickRates.cognitionRate = Math.max(1, Math.min(30, msg.payload.cognitionRate));
          if (msg.payload.spiritRate) tickRates.spiritRate = Math.max(1, Math.min(60, msg.payload.spiritRate));
          if (msg.payload.stateBroadcastRate) tickRates.stateBroadcastRate = Math.max(1, Math.min(30, msg.payload.stateBroadcastRate));
          if (activeSimulation) {
            activeSimulation.tickRates = { ...tickRates };
          }
          broadcast({ type: "log", payload: `Tick rates updated`, timestamp: Date.now() });
          broadcast({ type: "tickRates", payload: tickRates, timestamp: Date.now() });
        }
        break;

      case "getSystems":
        handleGetSystems(ws);
        break;
    }
  }

  function handleGetSystems(ws: WebSocket) {
    if (!activeSimulation) {
      sendTo(ws, { type: "systems", payload: { ecs: [], ai: [], spirits: [] }, timestamp: Date.now() });
      return;
    }

    const systems = listSystems(activeSimulation.god.systemRegistry);

    // Categorize systems by type
    const aiSystems = ["AgentCognition"];
    const spiritSystems = ["SpiritSystem"];

    const categorized = {
      ecs: systems.filter(s => !aiSystems.includes(s.name) && !spiritSystems.includes(s.name)).map(s => ({
        name: s.name,
        description: s.description,
        frequency: s.frequency,
        active: s.active,
        lastRun: s.lastRun,
        type: "ecs",
      })),
      ai: systems.filter(s => aiSystems.includes(s.name)).map(s => ({
        name: s.name,
        description: s.description,
        frequency: s.frequency,
        active: s.active,
        lastRun: s.lastRun,
        type: "ai",
      })),
      spirits: [{
        name: "SpiritSystem",
        description: "Spirit hierarchy observation and intervention system",
        frequency: tickRates.spiritRate * tickRates.baseTick,
        active: true,
        lastRun: 0,
        type: "spirit",
      }],
      tickRates,
    };

    sendTo(ws, { type: "systems", payload: categorized, timestamp: Date.now() });
  }

  // =============================================================================
  // SIMULATION MANAGEMENT
  // =============================================================================

  async function handleCreateSimulation(ws: WebSocket, payload: any) {
    const { name, prompt, withPersistence = true } = payload || {};

    if (!name || !prompt) {
      sendTo(ws, { type: "error", payload: "Name and prompt required", timestamp: Date.now() });
      return;
    }

    // Stop existing simulation
    if (activeSimulation) {
      handleStop();
    }

    broadcast({ type: "log", payload: `Creating simulation: ${name}...`, timestamp: Date.now() });

    try {
      // Create world
      const world = createArgosWorld(name);
      initializePrefabs(world);

      // Create GodAgent
      let god: GodAgentState;
      if (withPersistence) {
        god = await createGodAgentWithPersistence(world, {
          name: "GodAI",
          worldName: name.toLowerCase().replace(/\s+/g, "-"),
          narrative: prompt,
          persistence: {
            autosaveInterval: 10,
            snapshotInterval: 50,
            maxSnapshots: 5,
          },
        });
      } else {
        god = createGodAgent(world);
      }

      // Register builtin systems for narrative atmosphere
      for (const [name, createSystem] of Object.entries(BUILTIN_SYSTEMS)) {
        god.systemRegistry.systems.set(name, createSystem());
      }

      // Initialize spirit system with proper hierarchy
      const spiritSystem = initializeSpiritSystem(world, {
        godAgentEid: god.godAgentEid,
        tickInterval: 15000, // Spirits observe every 15 seconds
        autoCreateNarrator: true,
      });

      // Create additional spirits for social dynamics
      const socialDef: SpiritDefinition = {
        name: "SocialSpirit",
        description: "Manages relationships, tensions, and social dynamics between agents",
        domain: "social",
        rank: "archangel",
        observationInterval: 20000,
        model: "flash",
        systemPrompt: `You are the SocialSpirit, an archangel overseeing social dynamics.

## YOUR ROLE
Watch relationships between agents - friendships, rivalries, alliances, and conflicts.
Track social dynamics, gossip, reputation, and group formation.

## WHAT YOU OBSERVE
- Who is talking to whom
- Tone of conversations (friendly, hostile, neutral)
- Alliances forming or breaking
- Conflicts and their escalation
- Isolated individuals who could use connection

## WHEN TO INTERVENE
- When relationships stagnate
- When conflicts could be interesting but need a push
- When someone is too isolated
- When rumors or gossip could spice things up

Respond with JSON analysis of social dynamics and any interventions needed.`,
        watchConfig: {
          componentQueries: [
            { name: "all_agents", components: ["Agent", "Name"], description: "All named agents" },
          ],
          eventTypes: ["dialogue_spoken", "action_executed", "mood_changed"],
          watchEntities: [],
          watchRooms: [],
        },
        canInjectEvents: true,
        canModifyMood: true,
        canCreateEntities: false,
        canBakeSystems: false,
      };
      createSpirit(spiritSystem.registry, socialDef);

      // Start the spirit system
      startSpiritSystem();

      // Create simulation record
      activeSimulation = {
        id: god.simulation?.id || `sim-${Date.now()}`,
        name,
        world,
        god,
        spiritRegistry: spiritSystem.registry,
        spiritSystem,
        tick: 0,
        status: "paused",
        tickRates: { ...tickRates },
        createdAt: Date.now(),
        events: [],
        logs: [],
        cognitionRunning: false,
        spiritRunning: false,
      };

      broadcast({ type: "log", payload: "Simulation created. Executing initial prompt...", timestamp: Date.now() });

      // Execute initial prompt
      const result = await godCommand(god, prompt);

      broadcast({
        type: "godResponse",
        payload: { command: prompt, thinking: result.thinking, actions: result.actions },
        timestamp: Date.now(),
      });

      broadcast({
        type: "simulationCreated",
        payload: { id: activeSimulation.id, name },
        timestamp: Date.now(),
      });

      // Send initial state
      broadcast({ type: "state", payload: getFullState(), timestamp: Date.now() });

      // Auto-start
      handleResume();

    } catch (e) {
      console.error("[Server] Error creating simulation:", e);
      sendTo(ws, { type: "error", payload: `Failed to create simulation: ${e}`, timestamp: Date.now() });
    }
  }

  async function handleListSimulations(ws: WebSocket) {
    try {
      const sims = await listSimulations();
      sendTo(ws, {
        type: "simulationList",
        payload: sims.map(s => ({
          id: s.id,
          name: s.name,
          description: s.description,
          createdAt: s.createdAt,
          lastSavedAt: s.lastSavedAt,
          currentTick: s.currentTick,
        })),
        timestamp: Date.now(),
      });
    } catch (e) {
      sendTo(ws, { type: "error", payload: `Failed to list simulations: ${e}`, timestamp: Date.now() });
    }
  }

  async function handleLoadSimulation(ws: WebSocket, id: string) {
    // TODO: Implement loading from persistence
    sendTo(ws, { type: "error", payload: "Load simulation not yet implemented", timestamp: Date.now() });
  }

  async function handleDeleteSimulation(ws: WebSocket, id: string) {
    try {
      await deleteSimulation(id);
      broadcast({ type: "log", payload: `Deleted simulation: ${id}`, timestamp: Date.now() });
      await handleListSimulations(ws);
    } catch (e) {
      sendTo(ws, { type: "error", payload: `Failed to delete: ${e}`, timestamp: Date.now() });
    }
  }

  async function handleGodCommand(ws: WebSocket, command: string) {
    if (!activeSimulation) {
      sendTo(ws, { type: "error", payload: "No active simulation", timestamp: Date.now() });
      return;
    }

    broadcast({ type: "log", payload: `[God] ${command}`, timestamp: Date.now() });

    try {
      const { thinking, actions } = await godThink(activeSimulation.god, command);

      broadcast({
        type: "godResponse",
        payload: { command, thinking, actions },
        timestamp: Date.now(),
      });

      // Send updated state
      broadcast({ type: "state", payload: getFullState(), timestamp: Date.now() });

    } catch (e) {
      broadcast({ type: "error", payload: `God command failed: ${e}`, timestamp: Date.now() });
    }
  }

  function handlePause() {
    if (!activeSimulation) return;

    activeSimulation.status = "paused";
    if (activeSimulation.tickInterval) {
      clearInterval(activeSimulation.tickInterval);
      activeSimulation.tickInterval = undefined;
    }

    broadcast({ type: "log", payload: "Simulation paused", timestamp: Date.now() });
    broadcast({ type: "state", payload: getFullState(), timestamp: Date.now() });
  }

  function handleResume() {
    if (!activeSimulation || activeSimulation.status === "running") return;

    activeSimulation.status = "running";
    const rates = activeSimulation.tickRates;

    // Start tick loop
    activeSimulation.tickInterval = setInterval(async () => {
      if (activeSimulation?.status !== "running") return;
      await runTick();
    }, rates.baseTick);

    broadcast({
      type: "log",
      payload: `Simulation running (base: ${rates.baseTick}ms, cognition: every ${rates.cognitionRate} ticks, spirits: every ${rates.spiritRate} ticks)`,
      timestamp: Date.now()
    });
    broadcast({ type: "tickRates", payload: rates, timestamp: Date.now() });
    broadcast({ type: "state", payload: getFullState(), timestamp: Date.now() });
  }

  function handleStop() {
    if (!activeSimulation) return;

    if (activeSimulation.tickInterval) {
      clearInterval(activeSimulation.tickInterval);
    }

    activeSimulation.status = "stopped";
    broadcast({ type: "log", payload: "Simulation stopped", timestamp: Date.now() });

    activeSimulation = null;
  }

  // =============================================================================
  // TICK LOOP
  // =============================================================================

  async function runTick() {
    if (!activeSimulation || activeSimulation.status !== "running") return;

    const rates = activeSimulation.tickRates;
    const tick = activeSimulation.tick + 1;
    activeSimulation.tick = tick;

    try {
      // =========================================================================
      // FAST ECS SYSTEMS - Run every ecsRate ticks
      // These are quick systems: stimulus emission, mind decay, state updates
      // =========================================================================
      if (tick % rates.ecsRate === 0) {
        const result = await tickWorldAsync(activeSimulation.god, rates.baseTick);

        // Stream ECS events immediately
        for (const event of result.events) {
          const evt = { type: event.type, data: event.data, timestamp: Date.now() };
          activeSimulation.events.push(evt);
          if (activeSimulation.events.length > 200) activeSimulation.events.shift();
          broadcast({ type: "event", payload: evt, timestamp: Date.now() });
        }
      }

      // =========================================================================
      // SLOW AI SYSTEMS - Agent Cognition (runs every cognitionRate ticks)
      // This is expensive: LLM calls for each agent's perception/thinking/action
      // =========================================================================
      if (tick % rates.cognitionRate === 0 && !activeSimulation.cognitionRunning) {
        // Run cognition asynchronously without blocking main tick loop
        activeSimulation.cognitionRunning = true;
        runCognitionAsync().catch(err => {
          console.error("[Server] Cognition async error:", err);
        }).finally(() => {
          if (activeSimulation) activeSimulation.cognitionRunning = false;
        });
      }

      // =========================================================================
      // SLOW SPIRIT SYSTEMS - Spirit observations (runs every spiritRate ticks)
      // Even more expensive: spirits analyze world state and may intervene
      // =========================================================================
      if (tick % rates.spiritRate === 0 && !activeSimulation.spiritRunning) {
        // Run spirit system asynchronously without blocking main tick loop
        activeSimulation.spiritRunning = true;
        runSpiritAsync().catch(err => {
          console.error("[Server] Spirit async error:", err);
        }).finally(() => {
          if (activeSimulation) activeSimulation.spiritRunning = false;
        });
      }

      // =========================================================================
      // BROADCAST TICK INFO
      // =========================================================================
      broadcast({
        type: "tick",
        payload: {
          tick,
          ecsRan: tick % rates.ecsRate === 0,
          cognitionRan: tick % rates.cognitionRate === 0,
          spiritRan: tick % rates.spiritRate === 0,
          cognitionRunning: activeSimulation.cognitionRunning,
          spiritRunning: activeSimulation.spiritRunning,
        },
        timestamp: Date.now(),
      });

      // Periodically send full state
      if (tick % rates.stateBroadcastRate === 0) {
        broadcast({ type: "state", payload: getFullState(), timestamp: Date.now() });
      }

    } catch (e) {
      console.error("[Server] Tick error:", e);
      broadcast({ type: "error", payload: `Tick error: ${e}`, timestamp: Date.now() });
    }
  }

  /**
   * Run agent cognition cycle asynchronously.
   * This prevents expensive LLM calls from blocking the main tick loop.
   */
  async function runCognitionAsync() {
    if (!activeSimulation) return;

    try {
      const actions = await runCognitionCycle(
        activeSimulation.world,
        activeSimulation.god.systemRegistry
      );

      if (!activeSimulation) return; // Check again after async

      // Execute agent actions
      if (actions.length > 0) {
        executeActions(activeSimulation.world, actions, activeSimulation.god.systemRegistry);

        // Emit events for each action and record for spirits
        for (const { eid, action } of actions) {
          if (!entityExists(activeSimulation.world, eid)) continue;

          const agentName = Name.value[eid] || "Agent";

          const actionEvt = {
            type: "agent_action",
            data: { agent: agentName, action },
            timestamp: Date.now(),
          };
          activeSimulation.events.push(actionEvt);
          broadcast({ type: "event", payload: actionEvt, timestamp: Date.now() });
          broadcast({ type: "agentAction", payload: actionEvt.data, timestamp: Date.now() });

          // Record action for spirits to observe
          recordActionEvent(agentName, action.type, action.content || "", action.target);

          // Emit thought if the action includes thinking
          if (action.thinking) {
            const thoughtEvt = {
              type: "agent_thought",
              data: { agent: agentName, thought: action.thinking },
              timestamp: Date.now(),
            };
            activeSimulation.events.push(thoughtEvt);
            broadcast({ type: "event", payload: thoughtEvt, timestamp: Date.now() });
            broadcast({ type: "agentThought", payload: thoughtEvt.data, timestamp: Date.now() });
          }
        }
      }
    } catch (cognitionError) {
      console.error("[Server] Cognition cycle error:", cognitionError);
    }
  }

  /**
   * Run spirit system asynchronously.
   * Spirits observe the world and may intervene with stimuli.
   */
  async function runSpiritAsync() {
    if (!activeSimulation) return;

    try {
      const spiritResult = await tickSpiritSystem(
        activeSimulation.world,
        activeSimulation.god.registry
      );

      if (!activeSimulation) return; // Check again after async

      // Emit spirit messages
      for (const msg of spiritResult.messagesForGodAI) {
        const evt = {
          type: "spirit_message",
          data: { from: msg.from, content: msg.content, priority: msg.priority },
          timestamp: Date.now(),
        };
        activeSimulation.events.push(evt);
        broadcast({ type: "event", payload: evt, timestamp: Date.now() });
        broadcast({ type: "spiritMessage", payload: msg, timestamp: Date.now() });
      }

      // Emit narrative prose from the Narrator
      for (const prose of spiritResult.narrativeProse) {
        const narrativeEvt = {
          type: "narrative",
          data: { prose, source: "narrator" },
          timestamp: Date.now(),
        };
        activeSimulation.events.push(narrativeEvt);
        broadcast({ type: "event", payload: narrativeEvt, timestamp: Date.now() });
        broadcast({ type: "narrative", payload: prose, timestamp: Date.now() });
        console.log(`[System] Narrative: "${prose.slice(0, 80)}..."`);
      }

      if (spiritResult.spiritsProcessed > 0) {
        broadcast({
          type: "log",
          payload: `[Spirits] ${spiritResult.spiritsProcessed} spirits processed observations`,
          timestamp: Date.now(),
        });
      }
    } catch (spiritError) {
      console.error("[Server] Spirit system error:", spiritError);
    }
  }

  // =============================================================================
  // STATE SERIALIZATION
  // =============================================================================

  function getFullState() {
    if (!activeSimulation) {
      return { simulation: null, entities: [], systems: [], spirits: null, agentMinds: [] };
    }

    const { world, god, spiritRegistry, tick, status, name, id } = activeSimulation;

    // Get entities
    const entities = getEntities(world);
    const agentMinds = getAgentMinds(world);
    const systems = listSystems(god.systemRegistry).map(s => ({
      name: s.name,
      description: s.description,
      frequency: s.frequency,
      active: s.active,
      lastRun: s.lastRun,
    }));

    // Get spirit data
    let spirits = null;
    if (spiritRegistry) {
      const hierarchy = getHierarchyTree(spiritRegistry);
      const activeSpirits = getActiveSpirits(spiritRegistry);

      spirits = {
        hierarchy,
        totalCount: spiritRegistry.spirits.size,
        pendingMessages: spiritRegistry.messageQueue.length,
        active: activeSpirits.map(s => ({
          eid: s.eid,
          name: s.definition.name,
          domain: s.definition.domain,
          rank: s.definition.rank,
          description: s.definition.description,
          observations: s.observations.slice(-5),
          recentMessages: s.inbox.slice(-3).map(m => ({
            from: Name.value[m.from] || m.from,
            subject: m.subject,
            content: m.content?.slice(0, 100),
            type: m.type,
            timestamp: m.timestamp,
          })),
          narrativeState: s.narrativeState ? {
            currentAct: s.narrativeState.currentAct,
            currentPhase: s.narrativeState.currentPhase,
            tension: s.narrativeState.tension,
            activeThreads: s.narrativeState.activeThreads?.length || 0,
          } : null,
          socialState: s.socialState ? {
            relationships: s.socialState.relationships?.length || 0,
            activeConflicts: s.socialState.activeConflicts?.length || 0,
            factions: s.socialState.factions?.length || 0,
          } : null,
        })),
      };
    }

    // ASCII world
    const asciiWorld = renderAsciiWorld(world);

    return {
      simulation: {
        id,
        name,
        tick,
        status,
        tickRates: activeSimulation.tickRates,
        cognitionRunning: activeSimulation.cognitionRunning,
        spiritRunning: activeSimulation.spiritRunning,
      },
      entities,
      systems,
      spirits,
      agentMinds,
      asciiWorld,
      recentEvents: activeSimulation.events.slice(-30),
      recentLogs: activeSimulation.logs.slice(-30),
    };
  }

  function getEntities(world: World) {
    const entities: any[] = [];
    const agents = Array.from(query(world, [Agent])).filter(eid => entityExists(world, eid));
    const rooms = Array.from(query(world, [Room])).filter(eid => entityExists(world, eid));

    // Rooms
    for (const eid of rooms) {
      if (!entityExists(world, eid)) continue;
      entities.push({
        id: eid,
        type: "room",
        name: Name.value[eid],
        description: Description.value[eid],
        capacity: Room.capacity[eid],
        ambience: Room.ambience[eid],
        position: Position.x[eid] !== undefined ? { x: Position.x[eid], y: Position.y[eid] } : null,
      });
    }

    // Agents
    for (const eid of agents) {
      if (!entityExists(world, eid)) continue;

      const roomTargets = safeGetRelationTargets(world, eid, OccupiesRoom);
      const roomEid = roomTargets[0];
      const memory = getAgentMemory(world, eid);
      const knowledge = getAgentKnowledge(world, eid);

      entities.push({
        id: eid,
        type: "agent",
        name: Name.value[eid],
        description: Description.value[eid],
        role: Agent.role[eid],
        active: Agent.active[eid],
        mind: {
          mode: Mind.mode[eid],
          arousal: Mind.arousal[eid],
          focus: Mind.focus[eid],
        },
        room: roomEid && entityExists(world, roomEid) ? Name.value[roomEid] : null,
        position: Position.x[eid] !== undefined ? { x: Position.x[eid], y: Position.y[eid] } : null,
        visual: Visual.shape[eid] ? {
          shape: Visual.shape[eid],
          color: Visual.color[eid],
          size: Visual.size[eid],
        } : null,
        recentThoughts: memory.thoughts.slice(-5).map(t => t.content),
        knowledge: {
          memories: knowledge.memories.length,
          beliefs: knowledge.beliefs.length,
          impressions: knowledge.impressions.size,
        },
      });
    }

    // Stimulus sources
    const sources = Array.from(query(world, [StimulusSource])).filter(eid => entityExists(world, eid));
    for (const eid of sources) {
      if (!entityExists(world, eid)) continue;

      const roomTargets = safeGetRelationTargets(world, eid, OccupiesRoom);
      const firstRoom = roomTargets[0];
      entities.push({
        id: eid,
        type: "stimulus_source",
        name: Name.value[eid],
        description: Description.value[eid],
        stimulusType: StimulusSource.stimulusType[eid],
        room: firstRoom && entityExists(world, firstRoom) ? Name.value[firstRoom] : null,
      });
    }

    // Other named entities (objects like trees, deer, items, etc.)
    const allEntities = Array.from(query(world, [Name])).filter(eid => entityExists(world, eid));
    const existingIds = new Set(entities.map(e => e.id));

    for (const eid of allEntities) {
      if (existingIds.has(eid)) continue; // Skip already added entities
      if (!entityExists(world, eid)) continue;

      const name = Name.value[eid];
      if (!name) continue;

      const roomTargets = safeGetRelationTargets(world, eid, OccupiesRoom);
      const firstRoom = roomTargets[0];

      // Get dynamic component data
      const dynamicData = getDynamicComponentValues(world, eid);

      entities.push({
        id: eid,
        type: "object",
        name: name,
        description: Description.value[eid] || "",
        room: firstRoom && entityExists(world, firstRoom) ? Name.value[firstRoom] : null,
        position: GridPosition.x[eid] !== undefined ? {
          x: GridPosition.x[eid],
          y: GridPosition.y[eid]
        } : (Position.x[eid] !== undefined ? {
          x: Position.x[eid],
          y: Position.y[eid]
        } : null),
        visual: Visual.shape[eid] ? {
          shape: Visual.shape[eid],
          color: Visual.color[eid],
          size: Visual.size[eid],
        } : null,
        components: dynamicData,
      });
    }

    return entities;
  }

  function getAgentMinds(world: World) {
    const agents = Array.from(query(world, [Agent])).filter(eid => entityExists(world, eid));

    return agents.map(eid => {
      if (!entityExists(world, eid)) return null;

      const thoughtEids = getAgentThoughts(world, eid).filter(tid => entityExists(world, tid));
      const perceptionEids = getAgentPerceptions(world, eid).filter(pid => entityExists(world, pid));
      const conversationEids = getAgentConversation(world, eid).filter(cid => entityExists(world, cid));

      return {
        eid,
        name: Name.value[eid],
        role: Agent.role[eid],
        mind: {
          mode: Mind.mode[eid],
          arousal: Mind.arousal[eid],
          focus: Mind.focus[eid],
        },
        thoughts: thoughtEids
          .sort((a, b) => (Thought.timestamp[b] || 0) - (Thought.timestamp[a] || 0))
          .slice(0, 15)
          .map(tid => ({
            content: Thought.content[tid],
            type: Thought.type[tid],
            timestamp: Thought.timestamp[tid],
            salience: Thought.salience[tid],
          })),
        perceptions: perceptionEids
          .sort((a, b) => (Perception.timestamp[b] || 0) - (Perception.timestamp[a] || 0))
          .slice(0, 15)
          .map(pid => ({
            type: Perception.type[pid],
            content: Perception.content[pid],
            source: Perception.source[pid],
            intensity: Perception.intensity[pid],
            timestamp: Perception.timestamp[pid],
          })),
        conversationLength: conversationEids.length,
      };
    }).filter(Boolean);
  }

  // =============================================================================
  // HELPERS
  // =============================================================================

  function sendTo(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function broadcast(msg: ServerMessage) {
    const data = JSON.stringify(msg);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  // =============================================================================
  // START
  // =============================================================================

  function start() {
    server.listen(port, () => {
      console.log(`
╔═══════════════════════════════════════════════════════╗
║                    ArgOS Server                       ║
╠═══════════════════════════════════════════════════════╣
║  🌐 Web UI:    http://localhost:${port.toString().padEnd(5)}                ║
║  📡 WebSocket: ws://localhost:${port.toString().padEnd(5)}                  ║
║                                                       ║
║  Ready to create simulations!                         ║
╚═══════════════════════════════════════════════════════╝
`);
    });
  }

  return { start };
}

// =============================================================================
// ENTRY POINT
// =============================================================================

// Auto-start when run directly (not when imported as a module)
// In ESM, we check if this is the entry point by looking at the process args
const isDirectRun = process.argv[1]?.includes('argos-server');
if (isDirectRun) {
  const server = createArgosServer(3000);
  server.start();
}
