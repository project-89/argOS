/**
 * ArgOS v2 - Unified Simulation API
 *
 * This is the main entry point for creating and running ArgOS simulations.
 * It provides a simple, unified API that abstracts away the complexity of
 * the underlying ECS architecture, god agent, and system management.
 *
 * Quick Start:
 * ```typescript
 * import { createSimulation } from 'argos';
 *
 * const sim = await createSimulation({
 *   name: "My Village",
 *   narrative: "A peaceful village where interesting things happen",
 *   preset: "slice-of-life",
 *   agents: [
 *     { name: "Alice", role: "baker", description: "A friendly baker" },
 *     { name: "Bob", role: "blacksmith", description: "A gruff but kind blacksmith" }
 *   ],
 *   rooms: [
 *     { name: "Bakery", description: "Warm and smells of fresh bread" },
 *     { name: "Forge", description: "Hot and filled with the ring of metal" }
 *   ]
 * });
 *
 * await sim.start();
 * ```
 */

import "dotenv/config";
import { createArgosWorld, type WorldContext } from "./ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } from "./ecs/prefabs";
import { createGodAgent, godCommand, getWorldState, tickWorld, type GodAgentState, type GodAgentConfig } from "./god/god-agent";
import { createPrebakePreset, getAvailablePresets, type PrebakePreset } from "./god/system-baker";
import { runCognitionCycle, executeActions, broadcastToRoom, queueStimulus } from "./cognition/cognition-system";
import { registerAllBuiltinSystems, createMovementSystem, createRoomArrivalSystem } from "./systems/builtin-systems";
import { createSimulationServer } from "./server/simulation-server";
import { query, addComponent } from "bitecs";
import { Agent, Name, Mind, Room } from "./ecs/components";
import { OccupiesRoom } from "./ecs/relations";
import { initializeAllSchedules } from "./cognition/schedule-system";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import {
  SimulationBus,
  createSimulationBus,
  type SimulationEvent,
  type GodEvent,
  type SpiritEvent,
  type AgentEvent,
  type SystemEvent,
  type WorldEvent,
  type RoomEvent,
  type ChannelType,
  type InjectionMessage,
} from "./bus/simulation-bus";
import {
  getAgentIntrospection,
  getAllAgentIntrospections,
  getAgentMemories as _getAgentMemories,
  getAgentThoughts as _getAgentThoughts,
  getAgentBeliefs as _getAgentBeliefs,
  getAgentGoals as _getAgentGoals,
  getAgentByName,
} from "./introspection/introspection";
import {
  createDaemonRegistry,
  createDaemonsForAllAgents,
  createDaemonForAgent,
  removeDaemon,
  setDaemonSuperior,
  setSimulationTension,
  runDaemonSystem,
  getDaemonSummary,
  getDaemonByAgentName,
  getDaemonDetailedSummary,
  queueNarrativeNudge,
  broadcastNarrativeVision,
  updateDaemonConstraints,
  getStagnatingCharacters,
  generateGrowthSuggestion,
  recordThought,
  recordMemory,
  recordPlan,
  recordCharacterMoment,
  recordRelationshipChange,
  startNarrativeArc,
  completeNarrativeArc,
  getMemorySummary,
  getArcSummary,
  type DaemonRegistry,
  type DaemonState,
  type DaemonObservation,
  type DaemonConcern,
  type DaemonWhisper,
  type DaemonReport,
  type GrowthOpportunity,
  type NarrativeNudge,
  type DaemonMemory,
  type DaemonNarrativeArc,
  type ThoughtSummary,
  type MemoryEntry,
  type PlanEntry,
  type CharacterMoment,
  type RelationshipChange,
  type CompletedArc,
} from "./spirits/agent-daemon";
import {
  initializeSpiritSystem,
  createStandardHierarchy,
  startSpiritSystem,
  stopSpiritSystem,
  tickSpiritSystem,
  getSpiritSystemState,
  type SpiritSystemState,
} from "./spirits";
import { runWorldCrafterCycle, getPendingInteractions } from "./spirits/world-crafter-spirit";
import { runStewardCycle, requestRoomPopulation, getPendingRoomRequests } from "./spirits/steward-spirit";
import { RulesEngine } from "./world/rules-engine";
import { ObjectManager } from "./world/object-manager";
import { worldSchema } from "./world/schema";

// ============================================================================
// Types
// ============================================================================

export interface AgentConfig {
  name: string;
  role: string;
  description?: string;
  systemPrompt?: string;
  /** Initial room to place agent in (by name) */
  startRoom?: string;
  /** Initial grid position if not using room */
  gridPosition?: { x: number; y: number };
}

export interface RoomConfig {
  name: string;
  description?: string;
  capacity?: number;
  ambience?: string;
  x?: number;
  y?: number;
  /** Room type for auto-population (e.g., "bakery", "blacksmith", "tavern") */
  roomType?: string;
  /** If true, The Steward will populate with appropriate entities */
  autoPopulate?: boolean;
}

export interface ObjectConfig {
  name: string;
  description?: string;
  room?: string;
  traits?: string[];
  portable?: boolean;
}

export interface SimulationConfig {
  /** Name of the simulation */
  name: string;
  /** High-level narrative/setting description */
  narrative?: string;
  /** Prebake preset for systems: "slice-of-life" | "survival" | "social" | "minimal" */
  preset?: PrebakePreset;
  /** Global state preset: "slice-of-life" | "chaos" | "dramatic" | "slow-burn" | "murder-mystery" | "corporate" */
  statePreset?: string;
  /** Agents to create */
  agents?: AgentConfig[];
  /** Rooms to create */
  rooms?: RoomConfig[];
  /** Objects to create */
  objects?: ObjectConfig[];
  /** Time scale multiplier (default: 1.0) */
  timeScale?: number;
  /** Enable web server for visualization (default: false) */
  enableServer?: boolean;
  /** Server port (default: 3000) */
  serverPort?: number;
  /** Auto-generate schedules for agents using LLM (default: false) */
  generateSchedules?: boolean;
  /** Use natural language setup via GodAI (slower but more flexible) */
  useGodCommand?: boolean;
  /** Natural language setup command (requires useGodCommand: true) */
  setupCommand?: string;
  /** Enable spirit system (Narrator, Arbiter, Crafter, Steward, Weaver) - default: true */
  enableSpirits?: boolean;
  /** Auto-populate rooms with entities via The Steward - default: true when roomType is provided */
  autoPopulateRooms?: boolean;
}

export interface SimulationStats {
  tick: number;
  agentCount: number;
  roomCount: number;
  objectCount: number;
  activeGoals: number;
  systemCount: number;
}

/** Callback type for event subscriptions */
export type EventCallback<T extends SimulationEvent = SimulationEvent> = (event: T) => void;

export interface ArgosSimulation {
  /** The underlying world context */
  world: WorldContext;
  /** The god agent state */
  god: GodAgentState;
  /** The event bus for observation/injection */
  bus: SimulationBus;
  /** The daemon registry for agent guardians */
  daemons: DaemonRegistry;
  /** Current tick */
  tick: number;
  /** Whether simulation is running */
  running: boolean;
  /** Whether simulation is paused */
  paused: boolean;

  // --- Lifecycle ---
  /** Start the simulation loop */
  start: () => Promise<void>;
  /** Stop the simulation */
  stop: () => void;
  /** Pause the simulation */
  pause: () => void;
  /** Resume the simulation */
  resume: () => void;
  /** Run a single tick */
  step: () => Promise<void>;

  // --- State ---
  /** Get current world state as string */
  getState: () => string;
  /** Get simulation statistics */
  getStats: () => SimulationStats;

  // --- Commands & Stimuli ---
  /** Send a god command */
  command: (cmd: string) => Promise<void>;
  /** Broadcast a stimulus to all agents in a room */
  broadcast: (roomName: string, content: string, type?: string) => void;
  /** Queue a stimulus to a specific agent */
  stimulate: (agentName: string, content: string, type?: string) => void;

  // --- Observation Hooks (Outbound) ---
  /** Subscribe to all simulation events */
  onEvent: (callback: EventCallback) => () => void;
  /** Subscribe to god AI events (commands, thinking, tool calls) */
  onGod: (callback: EventCallback<GodEvent>) => () => void;
  /** Subscribe to spirit events (observations, messages, interventions) */
  onSpirit: (callback: EventCallback<SpiritEvent>) => () => void;
  /** Subscribe to agent events (thinking, actions, emotions, state) */
  onAgent: (callback: EventCallback<AgentEvent>, agentName?: string) => () => void;
  /** Subscribe to system events (created, executed, errors) */
  onSystem: (callback: EventCallback<SystemEvent>) => () => void;
  /** Subscribe to world events (entity created/removed, time, state) */
  onWorld: (callback: EventCallback<WorldEvent>) => () => void;
  /** Subscribe to room events (activity, state) */
  onRoom: (callback: EventCallback<RoomEvent>, roomName?: string) => () => void;

  // --- Injection Methods (Inbound) ---
  /** Inject a command to the God AI */
  injectGodCommand: (command: string) => Promise<void>;
  /** Inject a message to spirits (optionally targeting specific spirit) */
  injectSpiritMessage: (message: string, targetId?: number, priority?: "low" | "normal" | "high" | "urgent") => Promise<void>;
  /** Inject a stimulus to an agent */
  injectAgentStimulus: (stimulus: string, agentName: string, stimulusType?: string) => Promise<void>;
  /** Inject a broadcast to a room */
  injectRoomBroadcast: (content: string, roomName: string, source?: string) => Promise<void>;

  // --- Introspection Methods ---
  /** Get full introspection data for an agent */
  getAgent: (agentName: string) => import("./introspection/introspection").AgentIntrospection | null;
  /** Get all agents with full introspection data */
  getAgents: () => import("./introspection/introspection").AgentIntrospection[];
  /** Get memories for a specific agent */
  getAgentMemories: (agentName: string) => import("./introspection/introspection").AgentMemory[];
  /** Get thoughts for a specific agent */
  getAgentThoughts: (agentName: string) => import("./introspection/introspection").AgentThought[];
  /** Get beliefs for a specific agent */
  getAgentBeliefs: (agentName: string) => import("./introspection/introspection").AgentBelief[];
  /** Get goals for a specific agent */
  getAgentGoals: (agentName: string) => import("./introspection/introspection").AgentGoalInfo[];

  // --- Daemon Methods ---
  /** Get daemon for a specific agent */
  getDaemon: (agentName: string) => DaemonState | undefined;
  /** Get all daemons summary */
  getDaemonsSummary: () => string;
  /** Queue a narrative nudge for an agent's daemon */
  nudgeAgent: (agentName: string, nudge: {
    type: "arrive" | "interact" | "resolve" | "escalate" | "reflect" | "change_goal";
    action: string;
    reason: string;
    priority?: "low" | "normal" | "high";
  }) => boolean;
  /** Set simulation tension level (0-1) - affects daemon behavior */
  setTension: (tension: number) => void;
  /** Get current simulation tension */
  getTension: () => number;
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Create a new ArgOS simulation with sensible defaults.
 *
 * This is the primary entry point for creating simulations.
 *
 * @example Basic usage with config:
 * ```typescript
 * const sim = await createSimulation({
 *   name: "Village Life",
 *   preset: "slice-of-life",
 *   agents: [
 *     { name: "Ada", role: "baker" },
 *     { name: "Bob", role: "farmer" }
 *   ],
 *   rooms: [
 *     { name: "Bakery" },
 *     { name: "Farm" }
 *   ]
 * });
 * await sim.start();
 * ```
 *
 * @example Using natural language setup:
 * ```typescript
 * const sim = await createSimulation({
 *   name: "Fantasy Tavern",
 *   useGodCommand: true,
 *   setupCommand: `
 *     Create a cozy tavern called "The Prancing Pony".
 *     Add a wise bartender named "Butterbur".
 *     Add a mysterious hooded traveler.
 *   `
 * });
 * ```
 */
export async function createSimulation(config: SimulationConfig): Promise<ArgosSimulation> {
  // Validate API key
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY environment variable is required");
  }

  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║  ArgOS v2 - ${config.name.padEnd(48)} ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝\n`);

  // Create world
  const world = createArgosWorld(config.name);
  initializePrefabs(world);

  // Create god agent
  const godConfig: GodAgentConfig = {
    name: "The Weaver",
    worldName: config.name,
    narrative: config.narrative || "A living world where stories unfold.",
    preset: config.statePreset as any,
    timeScale: config.timeScale,
  };
  const god = createGodAgent(world, godConfig);

  // Register builtin systems
  registerAllBuiltinSystems(god.systemRegistry);

  // Apply prebake preset
  const preset = config.preset || "slice-of-life";
  console.log(`⚙️  Applying preset: ${preset}`);
  const prebakeResult = createPrebakePreset(preset, world, god.systemRegistry);
  if (prebakeResult.errors.length > 0) {
    console.warn(`⚠️  Prebake warnings: ${prebakeResult.errors.join(", ")}`);
  }

  // Initialize spirit system (default: enabled)
  const spiritsEnabled = config.enableSpirits !== false;
  let spiritSystem: SpiritSystemState | null = null;
  if (spiritsEnabled) {
    console.log(`👁️  Initializing spirit system...`);
    spiritSystem = initializeSpiritSystem(world, {
      godAgentEid: god.eid,
      tickInterval: 10000,
      autoCreateNarrator: false,
    });
    createStandardHierarchy(god.eid);
    startSpiritSystem();
    console.log(`   Spirits: Narrator, Arbiter, Crafter, Steward, Weaver, Tinker`);
  }

  // Initialize ObjectManager and RulesEngine for deterministic world behavior
  const objectManager = new ObjectManager(world);
  const rulesEngine = new RulesEngine(world, objectManager);
  console.log(`⚡ Rules engine initialized (${worldSchema.getActiveRules().length} active rules)`);

  // Create rooms first (so agents can be placed in them)
  const roomMap = new Map<string, number>();
  const roomsToPopulate: { name: string; roomType: string }[] = [];
  if (config.rooms && !config.useGodCommand) {
    console.log(`🏠 Creating ${config.rooms.length} rooms...`);
    for (const roomConfig of config.rooms) {
      const roomEid = createRoomEntity(world, {
        name: roomConfig.name,
        description: roomConfig.description || (roomConfig.roomType ? `A ${roomConfig.roomType} awaiting furnishing.` : undefined),
        capacity: roomConfig.capacity,
        ambience: roomConfig.ambience,
        x: roomConfig.x,
        y: roomConfig.y,
      });
      roomMap.set(roomConfig.name, roomEid);

      // Queue for population if roomType is provided
      const shouldPopulate = roomConfig.autoPopulate !== false && (roomConfig.roomType || config.autoPopulateRooms);
      if (shouldPopulate && roomConfig.roomType && spiritsEnabled) {
        requestRoomPopulation(roomConfig.roomType, roomConfig.name, {
          worldTheme: "fantasy",
          economyLevel: "modest",
        });
        roomsToPopulate.push({ name: roomConfig.name, roomType: roomConfig.roomType });
        console.log(`   - ${roomConfig.name} (${roomConfig.roomType}) → queued for The Steward`);
      } else {
        console.log(`   - ${roomConfig.name}`);
      }
    }
  }

  // Create agents
  if (config.agents && !config.useGodCommand) {
    console.log(`👥 Creating ${config.agents.length} agents...`);
    for (const agentConfig of config.agents) {
      const roomEid = agentConfig.startRoom ? roomMap.get(agentConfig.startRoom) : undefined;
      const agentEid = createAgentEntity(world, {
        name: agentConfig.name,
        role: agentConfig.role,
        description: agentConfig.description || `A ${agentConfig.role}`,
        systemPrompt: agentConfig.systemPrompt || `You are ${agentConfig.name}, a ${agentConfig.role}. ${agentConfig.description || ""}`,
        roomId: roomEid,
        gridPosition: agentConfig.gridPosition,
      });
      console.log(`   - ${agentConfig.name} (${agentConfig.role})`);

      // If agent has start room but didn't get roomId, assign manually
      if (agentConfig.startRoom && roomEid) {
        addComponent(world, agentEid, OccupiesRoom(roomEid));
      }
    }
  }

  // Create objects
  if (config.objects && !config.useGodCommand) {
    console.log(`📦 Creating ${config.objects.length} objects...`);
    for (const objConfig of config.objects) {
      const roomEid = objConfig.room ? roomMap.get(objConfig.room) : undefined;
      createObjectEntity(world, {
        name: objConfig.name,
        description: objConfig.description,
        roomId: roomEid,
        traits: objConfig.traits,
        portable: objConfig.portable,
      });
      console.log(`   - ${objConfig.name}`);
    }
  }

  // Use god command for setup if specified
  if (config.useGodCommand && config.setupCommand) {
    console.log(`🔮 Running GodAI setup command...`);
    await godCommand(god, config.setupCommand);
  }

  // Generate schedules if requested
  if (config.generateSchedules) {
    console.log(`📅 Generating agent schedules...`);
    await initializeAllSchedules(world, true);
  }

  // Create daemon registry for agent guardians
  console.log(`👁️  Creating daemon registry...`);
  const daemonRegistry = createDaemonRegistry(
    30000,  // 30 second observation interval
    45000,  // 45 second whisper cooldown
    90000   // 90 second report cooldown
  );

  // Create daemons for all agents
  const daemonCount = createDaemonsForAllAgents(daemonRegistry, world);
  console.log(`   Created ${daemonCount} guardian daemons`);

  // Set god agent as superior for daemons
  setDaemonSuperior(daemonRegistry, god.eid);

  // Initialize simulation tension at low level
  setSimulationTension(daemonRegistry, 0.1);

  // Setup web server if enabled
  let server: ReturnType<typeof createSimulationServer> | null = null;
  if (config.enableServer) {
    const port = config.serverPort || 3000;
    server = createSimulationServer(port);
    server.setSimulationState({
      world,
      registry: god.systemRegistry,
      tick: 0,
      events: [],
      logs: [],
      daemonRegistry,
    });
    server.setGodAgent(god);
    server.start();
    console.log(`🌐 Server running at http://localhost:${port}`);
  }

  // Create event bus
  const bus = createSimulationBus();
  bus.setBuffering(true, 500); // Enable buffering for late subscribers

  // Register injection handlers
  bus.registerInjectionHandler("inject:god_command", async (msg) => {
    if (msg.type === "inject:god_command") {
      console.log(`[Bus] Injecting god command: ${msg.command}`);
      await godCommand(god, msg.command);
    }
  });

  bus.registerInjectionHandler("inject:spirit_message", async (msg) => {
    if (msg.type === "inject:spirit_message") {
      console.log(`[Bus] Injecting spirit message: ${msg.message}`);
      // TODO: Wire to spirit registry when available
    }
  });

  bus.registerInjectionHandler("inject:agent_stimulus", async (msg) => {
    if (msg.type === "inject:agent_stimulus") {
      const agents = Array.from(query(world, [Agent]));
      for (const agentEid of agents) {
        if (Name.value[agentEid] === msg.targetAgentName) {
          queueStimulus({
            targetEid: agentEid,
            type: msg.stimulusType || "perception",
            modality: "cognitive",
            content: msg.stimulus,
            source: msg.source || "external",
          });
          console.log(`[Bus] Injected stimulus to ${msg.targetAgentName}`);
          return;
        }
      }
      console.warn(`[Bus] Agent "${msg.targetAgentName}" not found for stimulus injection`);
    }
  });

  bus.registerInjectionHandler("inject:room_broadcast", async (msg) => {
    if (msg.type === "inject:room_broadcast") {
      const rooms = Array.from(query(world, [Room]));
      for (const roomEid of rooms) {
        if (Name.value[roomEid] === msg.roomName) {
          broadcastToRoom(world, roomEid, {
            type: msg.activityType || "environmental",
            content: msg.content,
            source: msg.source || "external",
          });
          console.log(`[Bus] Broadcast to room ${msg.roomName}`);
          return;
        }
      }
      console.warn(`[Bus] Room "${msg.roomName}" not found for broadcast injection`);
    }
  });

  // Build simulation state
  let running = false;
  let paused = false;
  let tick = 0;
  let loopTimeout: NodeJS.Timeout | null = null;

  const simulation: ArgosSimulation = {
    world,
    god,
    bus,
    daemons: daemonRegistry,
    tick: 0,
    running: false,
    paused: false,

    start: async () => {
      if (running) return;
      running = true;
      simulation.running = true;
      console.log(`\n🎭 Starting simulation loop...\n`);

      const runLoop = async () => {
        if (!running) return;
        if (paused) {
          loopTimeout = setTimeout(runLoop, 1000);
          return;
        }

        try {
          await simulation.step();
        } catch (error) {
          console.error("Simulation error:", error);
        }

        loopTimeout = setTimeout(runLoop, 3000);
      };

      await runLoop();
    },

    stop: () => {
      running = false;
      simulation.running = false;
      if (loopTimeout) {
        clearTimeout(loopTimeout);
        loopTimeout = null;
      }
      console.log(`\n🛑 Simulation stopped.`);
    },

    pause: () => {
      paused = true;
      simulation.paused = true;
      console.log(`⏸️  Simulation paused.`);
    },

    resume: () => {
      paused = false;
      simulation.paused = false;
      console.log(`▶️  Simulation resumed.`);
    },

    step: async () => {
      tick++;
      simulation.tick = tick;
      console.log(`\n--- Tick ${tick} ---`);

      // Update god systems
      tickWorld(god, 5000);

      // Run cognition cycle
      const actions = await runCognitionCycle(world, god.systemRegistry);

      // Log actions and emit events
      for (const { eid, action } of actions) {
        const name = Name.value[eid];
        console.log(`  ${name}: ${action.type}${action.target ? ` -> ${action.target}` : ""}`);
        if (server) {
          server.pushAgentAction(name, action);
        }

        // Emit agent action through bus
        bus.emit({
          type: "agent:action",
          timestamp: Date.now(),
          agentId: eid,
          agentName: name,
          action: action.type,
          target: action.target,
          content: action.content,
        } as SimulationEvent);
      }

      // Execute actions
      executeActions(world, actions, god.systemRegistry);

      // Run deterministic rules (fire spreads, decay, etc.)
      const ruleEvents = rulesEngine.processTick(tick);
      if (ruleEvents.length > 0) {
        console.log(`  [Rules] ${ruleEvents.length} rule events emitted`);
        for (const event of ruleEvents) {
          // Emit as world event with rule data
          bus.emit({
            type: "world:state",
            timestamp: event.timestamp,
            tick,
            agentCount: 0,
            roomCount: 0,
            systemCount: 0,
            daemonCount: 0,
            // Rule event metadata - extend WorldEvent type to include this
            ...(event.type && { ruleEvent: event.type, ruleEntityId: event.entityId }),
          } as unknown as SimulationEvent);
        }
      }

      // Update server state
      if (server) {
        server.setSimulationState({
          world,
          registry: god.systemRegistry,
          tick,
          events: god.systemRegistry.events.slice(-50),
          logs: god.systemRegistry.logs.slice(-50),
        });
        server.updateState();
      }

      // Run daemon observation system
      const daemonResult = await runDaemonSystem(world, daemonRegistry);
      if (daemonResult.observations > 0) {
        console.log(`  [Daemons] ${daemonResult.observations} observations, ${daemonResult.whispers} whispers, ${daemonResult.challenges} challenges, ${daemonResult.reports} reports`);
      }

      // Run spirit system (Narrator, Crafter, Steward, etc.)
      if (spiritsEnabled && spiritSystem) {
        // Tick spirits (Narrator, Arbiter, etc.)
        const spiritResult = await tickSpiritSystem(world, god.registry);
        if (spiritResult.spiritsProcessed > 0) {
          console.log(`  [Spirits] ${spiritResult.spiritsProcessed} spirits processed`);
        }

        // Run The Crafter (entity materialization)
        const crafterResult = await runWorldCrafterCycle(world, spiritSystem.registry, god);
        if (crafterResult.entitiesCreated > 0) {
          console.log(`  [Crafter] Created ${crafterResult.entitiesCreated} entities`);
        }

        // Run The Steward (room population)
        const pendingRooms = getPendingRoomRequests();
        if (pendingRooms.length > 0) {
          const stewardResult = await runStewardCycle(spiritSystem.registry);
          if (stewardResult.roomsPopulated > 0) {
            console.log(`  [Steward] Populated ${stewardResult.roomsPopulated} rooms with ${stewardResult.entitiesGenerated} entities`);
          }
        }
      }

      // Emit world state through bus
      const agentCountNow = Array.from(query(world, [Agent])).length;
      const roomCountNow = Array.from(query(world, [Room])).length;
      bus.emit({
        type: "world:state",
        timestamp: Date.now(),
        tick,
        agentCount: agentCountNow,
        roomCount: roomCountNow,
        systemCount: god.systemRegistry.systems.size,
        daemonCount: daemonRegistry.daemons.size,
      } as SimulationEvent);
    },

    getState: () => getWorldState(god),

    getStats: () => {
      const agents = Array.from(query(world, [Agent]));
      const rooms = Array.from(query(world, [Room]));
      return {
        tick,
        agentCount: agents.length,
        roomCount: rooms.length,
        objectCount: 0, // TODO: count objects
        activeGoals: 0, // TODO: count goals
        systemCount: god.systemRegistry.systems.size,
      };
    },

    command: async (cmd: string) => {
      await godCommand(god, cmd);
    },

    broadcast: (roomName: string, content: string, type: string = "environmental") => {
      const rooms = Array.from(query(world, [Room]));
      for (const roomEid of rooms) {
        if (Name.value[roomEid] === roomName) {
          broadcastToRoom(world, roomEid, {
            type,
            content,
            source: "narrator",
          });
          return;
        }
      }
      console.warn(`Room "${roomName}" not found`);
    },

    stimulate: (agentName: string, content: string, type: string = "perception") => {
      const agents = Array.from(query(world, [Agent]));
      for (const agentEid of agents) {
        if (Name.value[agentEid] === agentName) {
          queueStimulus({
            targetEid: agentEid,
            type,
            modality: "cognitive",
            content,
            source: "narrator",
          });
          return;
        }
      }
      console.warn(`Agent "${agentName}" not found`);
    },

    // --- Observation Hooks ---
    onEvent: (callback: EventCallback) => {
      return bus.subscribeAll(callback);
    },

    onGod: (callback: EventCallback<GodEvent>) => {
      return bus.subscribe("god", callback as EventCallback);
    },

    onSpirit: (callback: EventCallback<SpiritEvent>) => {
      return bus.subscribe("spirits", callback as EventCallback);
    },

    onAgent: (callback: EventCallback<AgentEvent>, agentName?: string) => {
      if (agentName) {
        return bus.subscribeAgent(agentName, callback);
      }
      return bus.subscribe("agents", callback as EventCallback);
    },

    onSystem: (callback: EventCallback<SystemEvent>) => {
      return bus.subscribe("systems", callback as EventCallback);
    },

    onWorld: (callback: EventCallback<WorldEvent>) => {
      return bus.subscribe("world", callback as EventCallback);
    },

    onRoom: (callback: EventCallback<RoomEvent>, roomName?: string) => {
      if (roomName) {
        return bus.subscribeRoom(roomName, callback);
      }
      return bus.subscribe("world", callback as EventCallback); // Room events go to world channel
    },

    // --- Injection Methods ---
    injectGodCommand: async (command: string) => {
      await bus.inject({
        type: "inject:god_command",
        command,
      });
    },

    injectSpiritMessage: async (
      message: string,
      targetId?: number,
      priority: "low" | "normal" | "high" | "urgent" = "normal"
    ) => {
      await bus.inject({
        type: "inject:spirit_message",
        message,
        targetSpiritId: targetId,
        priority,
      });
    },

    injectAgentStimulus: async (stimulus: string, agentName: string, stimulusType?: string) => {
      await bus.inject({
        type: "inject:agent_stimulus",
        stimulus,
        targetAgentName: agentName,
        stimulusType,
      });
    },

    injectRoomBroadcast: async (content: string, roomName: string, source?: string) => {
      await bus.inject({
        type: "inject:room_broadcast",
        content,
        roomName,
        source,
      });
    },

    // --- Introspection Methods ---
    getAgent: (agentName: string) => {
      return getAgentIntrospection(world, agentName);
    },

    getAgents: () => {
      return getAllAgentIntrospections(world);
    },

    getAgentMemories: (agentName: string) => {
      const eid = getAgentByName(world, agentName);
      if (eid === null) return [];
      return _getAgentMemories(world, eid);
    },

    getAgentThoughts: (agentName: string) => {
      const eid = getAgentByName(world, agentName);
      if (eid === null) return [];
      return _getAgentThoughts(world, eid);
    },

    getAgentBeliefs: (agentName: string) => {
      const eid = getAgentByName(world, agentName);
      if (eid === null) return [];
      return _getAgentBeliefs(world, eid);
    },

    getAgentGoals: (agentName: string) => {
      const eid = getAgentByName(world, agentName);
      if (eid === null) return [];
      return _getAgentGoals(world, eid);
    },

    // --- Daemon Methods ---
    getDaemon: (agentName: string) => {
      return getDaemonByAgentName(daemonRegistry, agentName);
    },

    getDaemonsSummary: () => {
      return getDaemonSummary(daemonRegistry);
    },

    nudgeAgent: (agentName: string, nudge: {
      type: "arrive" | "interact" | "resolve" | "escalate" | "reflect" | "change_goal";
      action: string;
      reason: string;
      priority?: "low" | "normal" | "high";
    }) => {
      return queueNarrativeNudge(daemonRegistry, agentName, {
        type: nudge.type,
        action: nudge.action,
        reason: nudge.reason,
        source: "god",
        priority: nudge.priority || "normal",
      });
    },

    setTension: (tension: number) => {
      setSimulationTension(daemonRegistry, tension);
    },

    getTension: () => {
      return daemonRegistry.simulationTension;
    },
  };

  console.log(`\n✅ Simulation created!`);
  console.log(getWorldState(god));

  return simulation;
}

/**
 * Create a simulation from a natural language prompt.
 *
 * This function uses the LLM to interpret your description and
 * generate appropriate configuration, then creates the simulation.
 *
 * @example
 * ```typescript
 * const sim = await createSimulationFromPrompt(`
 *   A medieval village with a blacksmith, a baker, and a mysterious
 *   traveler who just arrived. The baker and blacksmith are old friends.
 *   There should be a marketplace, a tavern, and a forge.
 * `);
 * await sim.start();
 * ```
 */
export async function createSimulationFromPrompt(
  prompt: string,
  options: Partial<SimulationConfig> = {}
): Promise<ArgosSimulation> {
  const model = google("gemini-2.0-flash");

  console.log(`🔮 Interpreting prompt...`);

  const systemPrompt = `You are an ArgOS simulation configurator. Given a natural language description,
you generate a JSON configuration for creating a simulation.

Output ONLY valid JSON with this structure:
{
  "name": "Simulation Name",
  "narrative": "One paragraph setting description",
  "agents": [
    { "name": "Name", "role": "role", "description": "description", "startRoom": "Room Name" }
  ],
  "rooms": [
    { "name": "Room Name", "description": "room description" }
  ],
  "objects": [
    { "name": "Object Name", "description": "description", "room": "Room Name", "traits": ["trait1"] }
  ]
}

Keep it focused - 2-5 agents, 2-5 rooms, 0-5 objects.
Rooms should match where agents start.
Agent roles should be simple (baker, blacksmith, traveler, etc).`;

  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: `Create a simulation configuration from this description:\n\n${prompt}`,
  });

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to parse LLM response into configuration");
  }

  const config = JSON.parse(jsonMatch[0]) as SimulationConfig;

  // Merge with options
  const finalConfig: SimulationConfig = {
    ...config,
    ...options,
    preset: options.preset || "slice-of-life",
  };

  console.log(`📋 Generated config: ${finalConfig.agents?.length || 0} agents, ${finalConfig.rooms?.length || 0} rooms`);

  return createSimulation(finalConfig);
}

/**
 * Quick helper to create a simple village simulation for testing.
 *
 * @example
 * ```typescript
 * const sim = await createVillageSimulation();
 * await sim.start();
 * ```
 */
export async function createVillageSimulation(): Promise<ArgosSimulation> {
  return createSimulation({
    name: "Test Village",
    narrative: "A peaceful medieval village where villagers go about their daily lives.",
    preset: "slice-of-life",
    rooms: [
      { name: "Town Square", description: "The central gathering place of the village." },
      { name: "Tavern", description: "A cozy tavern with a warm hearth." },
      { name: "Bakery", description: "Smells of fresh bread fill the air." },
    ],
    agents: [
      { name: "Ada", role: "baker", description: "A cheerful baker who loves her craft", startRoom: "Bakery" },
      { name: "Bram", role: "blacksmith", description: "A quiet but skilled craftsman", startRoom: "Town Square" },
      { name: "Clara", role: "innkeeper", description: "A wise woman who knows everyone's secrets", startRoom: "Tavern" },
    ],
    objects: [
      { name: "Fresh Bread", description: "Warm loaves of bread", room: "Bakery", traits: ["edible", "takeable"] },
      { name: "Ale Barrel", description: "A barrel of fine ale", room: "Tavern", traits: ["drinkable"] },
    ],
  });
}

// ============================================================================
// Re-exports for Advanced Usage
// ============================================================================

// ECS Core
export { createArgosWorld, type WorldContext } from "./ecs/world";
export { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity, createGodAgentEntity } from "./ecs/prefabs";
export { query, addEntity, removeEntity, addComponent, removeComponent, hasComponent, getRelationTargets } from "bitecs";

// Components & Relations
export * from "./ecs/components";
export * from "./ecs/relations";

// God Agent
export { createGodAgent, godCommand, getWorldState, tickWorld } from "./god/god-agent";
export type { GodAgentState, GodAgentConfig } from "./god/god-agent";

// System Management
export { createSystemRegistry, registerSystem, runSystems, runAsyncSystems, type SystemDefinition, type SystemRegistry } from "./ecs/dynamic-systems";
export { registerAllBuiltinSystems, createMovementSystem, createRoomArrivalSystem, setMovementTarget, clearMovementTarget } from "./systems/builtin-systems";
export { createPrebakePreset, getAvailablePresets, bakeSystem } from "./god/system-baker";
export type { PrebakePreset } from "./god/system-baker";

// Cognition System
export { runCognitionCycle, executeActions, broadcastToRoom, queueStimulus } from "./cognition/cognition-system";
export { initializeSchedule, getCurrentActivity, getSchedule } from "./cognition/schedule-system";
export { createMemoryConsolidationSystem, runMemoryConsolidation, recallMemory } from "./cognition/memory-consolidation";
export { createBeliefRevisionSystem, runBeliefRevision, updateBeliefWithEvidence } from "./cognition/belief-revision";
export { createScheduleAdaptationSystem, runScheduleAdaptation, triggerEmergencyAdaptation } from "./cognition/schedule-adaptation";

// Server
export { createSimulationServer } from "./server/simulation-server";

// Introspection
export {
  // Agent introspection
  getAgentByName,
  getAgentMemories,
  getAgentThoughts,
  getAgentBeliefs,
  getAgentGoals,
  getAgentIntrospection,
  getAllAgentIntrospections,
  type AgentMemory,
  type AgentThought,
  type AgentBelief,
  type AgentGoalInfo,
  type AgentMindState,
  type AgentPersonality,
  type AgentIntrospection,
  // Entity introspection
  getEntitySnapshots,
  getEntityDetails,
  type EntitySnapshot,
  // System introspection
  getSystemSummaries,
  getSystemByName,
  type SystemSummary,
  // Action introspection
  getAvailableActions,
  getActionDefinition,
  isValidAction,
  getActionsByCategory,
  ACTION_REGISTRY,
  type ActionDefinition,
  // Component introspection
  getAvailableComponents,
  getComponentDefinition,
  getComponentsByCategory,
  COMPONENT_REGISTRY,
  type ComponentDefinition,
  // Event buffer
  createRollingEventBuffer,
  addToBuffer,
  getEventsInWindow,
  getEventsByType,
  getEventFrequencies,
  detectPatterns,
  type BufferedEvent,
  type RollingEventBuffer,
  // Full context
  getIntrospectionContext,
  type IntrospectionContext,
} from "./introspection/introspection";

// Event Bus
export {
  SimulationBus,
  createSimulationBus,
  getGlobalBus,
  resetGlobalBus,
  type BusTransport,
  type SimulationEvent,
  type GodEvent,
  type SpiritEvent,
  type AgentEvent,
  type SystemEvent,
  type WorldEvent,
  type RoomEvent,
  type ChannelType,
  type InjectionMessage,
  type GodCommandInjection,
  type SpiritMessageInjection,
  type AgentStimulusInjection,
  type RoomBroadcastInjection,
} from "./bus/simulation-bus";
export { WebSocketTransport, createWebSocketTransport } from "./bus/websocket-transport";

// Presets (re-exported from god-agent)
export {
  PRESET_SLICE_OF_LIFE,
  PRESET_CHAOS,
  PRESET_DRAMATIC,
  PRESET_SLOW_BURN,
  PRESET_MURDER_MYSTERY,
  PRESET_CORPORATE,
} from "./god/god-agent";

// Daemon System (Agent Guardians)
export {
  createDaemonRegistry,
  createDaemonsForAllAgents,
  createDaemonForAgent,
  removeDaemon,
  setDaemonSuperior,
  setSimulationTension,
  runDaemonSystem,
  getDaemonSummary,
  getDaemonByAgentName,
  getDaemonDetailedSummary,
  queueNarrativeNudge,
  broadcastNarrativeVision,
  updateDaemonConstraints,
  getStagnatingCharacters,
  generateGrowthSuggestion,
  // Memory and arc functions
  recordThought,
  recordMemory,
  recordPlan,
  recordCharacterMoment,
  recordRelationshipChange,
  startNarrativeArc,
  completeNarrativeArc,
  getMemorySummary,
  getArcSummary,
  type DaemonRegistry,
  type DaemonState,
  type DaemonObservation,
  type DaemonConcern,
  type DaemonWhisper,
  type DaemonReport,
  type GrowthOpportunity,
  type NarrativeNudge,
  type DaemonMemory,
  type DaemonNarrativeArc,
  type ThoughtSummary,
  type MemoryEntry,
  type PlanEntry,
  type CharacterMoment,
  type RelationshipChange,
  type CompletedArc,
} from "./spirits/agent-daemon";

// Version
export const VERSION = "2.0.0";
