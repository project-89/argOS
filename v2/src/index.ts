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
import { deserializeWorld, type SerializedWorld } from "./persistence/world-persistence";
import { validateSimulationSnapshot } from "./persistence/simulation-snapshot";
import { syncEntityRegistryFromWorld } from "./ecs/entity-lookup";
import { createArgosWorld, type WorldContext } from "./ecs/world";
import { validateSimulationDelta, validateTimeScale } from "./ecs/simulation-time";
import { clearTimedSpeech } from "./cognition/timed-speech";
import { clearSimulationTimeline } from "./runtime/simulation-timeline";
import { configureWorldConstructionBudget, getWorldConstructionStatus } from "./runtime/world-construction-budget";
import { startCommittedEvents, stopCommittedEvents } from "./runtime/committed-events";
import { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } from "./ecs/prefabs";
import { isOperatorControlled } from "./ecs/controlled";
import { initializeRegistry } from "./ecs/component-registry";
import { createGodAgent, godCommand, getWorldState, tickWorld, runWorldTickAt, updateGlobalTime, type GodAgentState, type GodAgentConfig } from "./god/god-agent";
import { createPrebakePreset, getAvailablePresets, type PrebakePreset } from "./god/system-baker";
import { runCognitionCycle, runActorControlStep, executeActions, broadcastToRoom, queueStimulus, hasPendingCognitionStimuli } from "./cognition/cognition-system";
import { getStimulusQueueStatus } from "./cognition/stimulus-queue";
import { getNativeRuntimeServices, registerNativeRuntimeServices } from "./runtime/native-services";
import { hasUnintegratedAttention } from "./cognition/agent-mind";
import { hasDueAttentionSignal } from "./cognition/unresolved-attention";
import { captureThoughtPublication, takeNewAuthoredThoughtEvents, type ThoughtPublicationCursor } from "./cognition/thought-publication";
import { isForegroundCognitionReady, isForegroundActorAvailable } from "./cognition/idle-cognition";
import { hasExperienceAppraisal, isExperienceAppraisalPending, runExperienceAppraisal } from "./cognition/experience-appraisal";
import { runAppearanceEmitter } from "./cognition/appearance-emitter";
import { runEmotionalDynamics } from "./cognition/emotional-life";
import { bridgeWorldEventsToStimuli } from "./cognition/world-event-bridge";
import { registerAllBuiltinSystems, createMovementSystem, createRoomArrivalSystem } from "./systems/builtin-systems";
import {
  getAllSystemHealth,
  getSystemTelemetrySnapshot,
  subscribeSystemDiagnostics,
  getSystemDiagnosticCoverage,
  type SystemHealthReport,
} from "./ecs/dynamic-systems";
import { createSimulationServer } from "./server/simulation-server";
import { query, addComponent, entityExists } from "bitecs";
import { getAgentWorldCapabilities } from "./cognition/world-capabilities";
import { advanceGoalTick, hasPendingPersonalGoalReview } from "./cognition/autonomous-goals";
import { Agent, Name, Mind, Room, PhysicalObject, Goal } from "./ecs/components";
import { getDirectContainer, setLocatedIn } from "./ecs/location";
import { initializeAllSchedules } from "./cognition/schedule-system";
import { runPlanningSystem, hasPendingPlanning } from "./cognition/planning-system";
import { runCoordinationReview, hasPendingCoordinationReview } from "./cognition/coordination-review";
import { initializeReflectionState } from "./cognition/reflection-system";
import { hasSubconsciousWork, runAgentSubconscious } from "./cognition/subconscious-system";
export { runAgentSubconscious, hasSubconsciousWork } from "./cognition/subconscious-system";
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
  setGodAgentCallback,
  type SpiritSystemState,
} from "./spirits";
import { createSpiritRegistry } from "./spirits/spirit-registry";
import { injectOperatorSpiritMessage } from "./spirits/spirit-system";
import { requestRoomPopulationForRoom } from "./spirits/steward-spirit";
import { installSpiritPhysicalEffectProfile } from "./spirits/physical-effect-capabilities";
import { RulesEngine } from "./world/rules-engine";
import { ObjectManager } from "./world/object-manager";
import { worldSchema } from "./world/schema";
import {
  initializeGodAutopilot,
  enqueueSpiritMessages,
  runGodAutopilotCycle,
  type GodAutopilotConfig,
} from "./god/god-autopilot";
import { setAgentBehaviorPolicy } from "./cognition/behavior-policy";
import { inferPolicyFromRole, getPolicyTemplate } from "./cognition/behavior-templates";
import {
  createSimulation as createRuntimeSimulation,
  registerFastSystem,
  registerAIOperation,
  startSimulation as startRuntimeSimulation,
  stopSimulation as stopRuntimeSimulation,
  drainSimulationOperations,
  pauseSimulation as pauseRuntimeSimulation,
  resumeSimulation as resumeRuntimeSimulation,
  getSimulationStats as getRuntimeStats,
  type SimulationState as RuntimeSimulationState,
} from "./runtime/simulation-loop";
import { registerBuiltinOfficeTools } from "./office-tools/builtin-tools";
import { setWorldOfficeToolPolicy, type HostOfficeToolsPolicy } from "./office-tools/tool-registry";
export { setWorldOfficeToolPolicy, isWorldOfficeToolAllowed, type HostOfficeToolsPolicy } from "./office-tools/tool-registry";
import { generateStoryScaffold } from "./nle/story-scaffold";
import { startBeatDetection, stopBeatDetection } from "./nle/beat-detector";
import { runNarrativeDirectorCycle, setDirectorGodAgent } from "./nle/narrative-director";
import { setNudgeDaemonRegistry } from "./nle/npc-nudge";
import {
  createEvolutionCoordinator,
  type EvolutionCoordinatorConfig,
  type EvolutionCoordinatorStatus,
} from "./runtime/evolution-coordinator";
import { CodingDaemon, type CodingDaemonConfig } from "./engineering/coding-daemon";
export type { CodingDaemonConfig } from "./engineering/coding-daemon";
export type { BuildRequest, BuildJob, BuildStatus, AcceptanceTest } from "./engineering/contracts";
import type { BuildRequest, BuildJob } from "./engineering/contracts";
import { applyRuntimeProfile } from "./runtime/runtime-profile";
import { parseWorldSpecification, setWorldSpecification, getWorldTheme, type WorldSpecificationInput } from "./world/world-specification";
import { chronicle as storyChronicle } from "./cognition/simulation-chronicle";
import { readSimulationTime as readStoryTime } from "./ecs/simulation-time";
export { EMBODIED_RUNTIME_PROFILE } from "./runtime/runtime-profile";
export { parseWorldSpecification, getWorldSpecification, type WorldSpecification, type WorldSpecificationInput } from "./world/world-specification";

// ============================================================================
// Types
// ============================================================================

export interface AgentConfig {
  /** Private pre-simulation history and formative identity memories. */
  past?: import("./cognition/character-past-schema").CharacterPast;
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
  /** Immutable authoring brief, including private creation seeds. It does not
   * grant execution authority. Selects embodied-v1 unless explicitly configured. */
  worldSpecification?: WorldSpecificationInput;
  /** Opt-in fast ECS/background cognition configuration. Autonomous evolution,
   * coding, God autopilot and host tools default off; host overrides are explicit. */
  runtimeProfile?: "embodied-v1";
  /** Optional lifetime world-construction admissions, including authored seed
   * rooms/NPCs/props. Internal cognition entities do not consume these slots.
   * Failed initialization/deletion do not refund them; snapshots preserve them. */
  maxWorldEntities?: number;
  /** Trusted saved ECS/system code, restored before runtime wiring. Authored
   * rooms/agents/objects/preset are not reseeded. Host permissions come from
   * this config, never the snapshot. No pending action callbacks are resumed. */
  restoreSnapshot?: SerializedWorld;
  /** Real host office-tool access, not fictional device capability. Defaults to
   * false; use an exact tool-ID allowlist or explicit true for trusted workflows.
   * Shell/provider mode and environment checks remain additional restrictions. */
  hostOfficeTools?: HostOfficeToolsPolicy;
  /** Experimental high-level cognition policy. Default preserves priority arbitration. */
  cognitionController?: "priority" | "situated";
  /** Allow lived-event appraisals to revise existing subjective personal intentions. */
  experienceReconsideration?: boolean;
  /** First-person emotional episodes and durable narrative memory, separate from goals. */
  narrativeMind?: boolean;
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
  /** In-world delta multiplier (default: 1). AI and recording wall clocks are unaffected. */
  timeScale?: number;
  /** Give speech a finite in-world duration before its content is delivered (default: true). */
  timedSpeech?: boolean;
  /** Finite physical action durations; explicitly false retains legacy atomic execution. */
  timedActions?: boolean;
  /** Enable web server for visualization (default: false) */
  enableServer?: boolean;
  /** Server port (default: 3456) */
  serverPort?: number;
  /** Auto-generate schedules for agents using LLM (default: false) */
  generateSchedules?: boolean;
  /** Use natural language setup via GodAI (slower but more flexible) */
  useGodCommand?: boolean;
  /** Natural language setup command (requires useGodCommand: true) */
  setupCommand?: string;
  /** Disable all LLM-powered cognition/spirits/god commands for deterministic runs */
  enableAI?: boolean;
  /**
   * Enable background multi-step planning, independently of immediate cognition.
   * - `true` (default): agents with goals may generate multi-step plans
   * - `false`: skip plan generation (use policies/procedures/LLM action selection only)
   */
  enablePlanning?: boolean;
  /** Accumulate experiences and reflect in the per-actor subconscious (default: true with AI). */
  enableReflection?: boolean;
  /** Fast appraisal of personally experienced events, independently of slow planning/reflection. */
  enableExperienceAppraisal?: boolean;
  /** Enable spirit system (Narrator, Arbiter, Crafter, Steward, Weaver) - default: true */
  enableSpirits?: boolean;
  /** Enable continuous entity/component/system/rule evolution, or override its tick cadences. */
  evolution?: boolean | Partial<EvolutionCoordinatorConfig>;
  /** Isolated coding jobs and tick-boundary hot loading. Enabled with world evolution. */
  codingDaemons?: boolean | CodingDaemonConfig;
  /** Build and run the narrative director/scaffold layer. Defaults to true in genesis mode. */
  enableNarrativeEngine?: boolean;
  /** Auto-populate rooms with entities via The Steward - default: true when roomType is provided */
  autoPopulateRooms?: boolean;
  /** Use the dual-loop runtime (fast ECS tick + async AI tasks) */
  dualLoop?: boolean;
  /** ECS tick rate (ticks per second) when dual-loop is enabled (default: ~0.33 to match legacy pacing) */
  ecsTickRate?: number;
  /** Base simulation ms per tick, before timeScale (default: 1000 / ecsTickRate). Also used by step(). */
  ecsDeltaMs?: number;
  /**
   * Enable GodAI autopilot to consume spirit/daemon reports and act autonomously.
   * - `true`: enable with safe defaults (high-priority messages only + throttling)
   * - `false`: disable (messages are still captured into inbox for manual review)
   * - object: enable + override config
   */
  godAutopilot?: boolean | Partial<GodAutopilotConfig>;
  /**
   * Genesis mode: God creates the world from a seed description.
   * Builtin substrate systems remain active; authored presets and config-driven
   * rooms/agents/objects are replaced by a generated world.
   * - `true`: use `narrative` as the seed
   * - `{ seed: string }`: use the provided seed description
   */
  genesis?: boolean | { seed: string };
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
  /** After stop, await runtime-owned operation finalizers, bounded in wall time. Does not advance the world. */
  drainPendingOperations: (timeoutMs?: number) => Promise<void>;
  /** Pause the simulation */
  pause: () => void;
  /** Resume the simulation */
  resume: () => void;
  /** Run one tick; an explicit delta is exact in-world ms, not multiplied by timeScale. */
  step: (deltaMs?: number) => Promise<void>;

  // --- State ---
  /** Get current world state as string */
  getState: () => string;
  /** Get simulation statistics */
  getStats: () => SimulationStats;
  /** Native services outside the generated-system registry; configuration, not execution evidence. */
  getRuntimeServices: () => ReturnType<typeof getNativeRuntimeServices>;
  /** Inspect the continuous world-evolution and system-repair loop */
  getEvolutionStatus: () => EvolutionCoordinatorStatus;
  getCodingStatus: () => ReturnType<CodingDaemon["getStatus"]> | null;
  requestSystemBuild: (request: BuildRequest) => BuildJob;
  /** Registered builtin/generated system health. Outer native callbacks are in getRuntimeStatus().fastSystemHealth. */
  getSystemHealth: () => SystemHealthReport[];
  /** Native fast-callback failures plus scheduling/latency; null before dual-loop startup. Queue totals are process-wide. */
  getRuntimeStatus: () => ReturnType<typeof getRuntimeStats> | null;
  /** World-owned input admission and operational log coverage, including rejected/evicted evidence. */
  getOperationalStatus: () => {
    stimuli: ReturnType<typeof getStimulusQueueStatus>;
    systemDiagnostics: ReturnType<typeof getSystemDiagnosticCoverage>;
  };
  getWorldConstructionStatus: () => ReturnType<typeof getWorldConstructionStatus>;

  // --- Commands & Stimuli ---
  /** Send a god command */
  command: (cmd: string) => Promise<void>;
  /** Broadcast a stimulus to all agents in a room */
  broadcast: (roomName: string, content: string, type?: string) => void;
  /** Queue a stimulus to a specific agent; false means it was not admitted. Inspect getOperationalStatus(). */
  stimulate: (agentName: string, content: string, type?: string) => boolean;

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
/** In-process integration API: component arrays/registries are process-global.
 * Do not construct concurrent worlds through this legacy path. Use
 * createSimulationHost for process-isolated concurrent simulations. */
export async function createSimulation(input: SimulationConfig | string): Promise<ArgosSimulation> {
  const supplied: SimulationConfig = typeof input === "string"
    ? {
        name: input.trim().split(/\n|[.!?]/, 1)[0]?.slice(0, 49) || "Generated World",
        narrative: input,
        genesis: { seed: input },
        enableNarrativeEngine: true,
      }
    : input;
  const specification = supplied.worldSpecification === undefined ? undefined : parseWorldSpecification(supplied.worldSpecification);
  const config = applyRuntimeProfile({ ...supplied,
    ...(specification ? { worldSpecification: specification,
      narrative: supplied.narrative ?? specification.setting.premise,
      agents: supplied.agents ?? specification.inhabitants } : {}) });
  const aiEnabled = config.enableAI !== false;
  const restoring = config.restoreSnapshot;
  const savedGod = restoring !== undefined ? validateSimulationSnapshot(restoring) : undefined;
  if (restoring && specification && (!restoring.worldSpecification
    || JSON.stringify(parseWorldSpecification(restoring.worldSpecification)) !== JSON.stringify(specification)))
    throw new Error("Restore must retain the saved world specification; use a new world for a different authoring brief");
  if (restoring?.systems.some(system => system.managedRelease)
    && config.codingDaemons !== true && !(config.codingDaemons && typeof config.codingDaemons === "object"))
    throw new Error("Managed snapshot restore requires caller-enabled codingDaemons and its accepted release store");
  if (restoring && (config.genesis || config.useGodCommand || config.generateSchedules))
    throw new Error("Restore cannot also run genesis, setup commands or schedule regeneration");
  if (config.narrativeMind !== undefined && typeof config.narrativeMind !== "boolean") throw new Error("narrativeMind must be boolean");
  if (config.experienceReconsideration !== undefined && typeof config.experienceReconsideration !== "boolean") {
    throw new Error("experienceReconsideration must be boolean");
  }
  if (config.cognitionController !== undefined && !["priority", "situated"].includes(config.cognitionController)) {
    throw new Error("Unknown cognition controller; choose priority or situated");
  }
  const timeScale = validateTimeScale(config.timeScale ?? 1);
  const ecsTickRate = config.ecsTickRate ?? (1 / 3);
  if (!Number.isFinite(ecsTickRate) || ecsTickRate <= 0) throw new RangeError("ecsTickRate must be finite and greater than zero");
  const baseDeltaMs = validateSimulationDelta(config.ecsDeltaMs ?? 1000 / ecsTickRate);
  const defaultDeltaMs = validateSimulationDelta(baseDeltaMs * timeScale);

  // Validate API key only when LLM features are enabled
  if (aiEnabled && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY environment variable is required (or set enableAI:false)");
  }

  if (!aiEnabled) {
    if (config.useGodCommand) throw new Error("useGodCommand requires enableAI:true");
    if (config.generateSchedules) throw new Error("generateSchedules requires enableAI:true");
  }

  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║  ArgOS v2 - ${config.name.padEnd(48)} ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝\n`);

  // Create world
  const world = createArgosWorld(config.name);
  if (specification && !restoring) setWorldSpecification(world, specification);
  if (config.runtimeProfile === "embodied-v1") {
    startCommittedEvents(world);
    // Retain a deny-by-default tombstone, not an active host grant. Native
    // integrations may install their own scoped profile after construction;
    // start/restart must never replace that later host-installed authority.
    installSpiritPhysicalEffectProfile(world).close();
  }
  if (config.maxWorldEntities !== undefined) configureWorldConstructionBudget(world, config.maxWorldEntities);
  setWorldOfficeToolPolicy(world, config.hostOfficeTools ?? false);
  // Expose key runtime flags to ECS systems via the world context.
  (world as any).meta.aiEnabled = aiEnabled;
  world.meta.cognitionController = config.cognitionController ?? "priority";
  world.meta.experienceReconsideration = config.experienceReconsideration ?? false;
  world.meta.experienceAppraisalEnabled = config.enableExperienceAppraisal !== false;
  world.meta.narrativeMind = config.narrativeMind ?? false;
  world.meta.timedSpeech = config.timedSpeech ?? true;
  world.meta.timedActions = config.timedActions ?? true;
  (world as any).meta.generateSchedules = Boolean(config.generateSchedules);

  // Prefab initialization also establishes the unified component registry.
  initializePrefabs(world);
  registerBuiltinOfficeTools();

  // Create god agent
  const godConfig: GodAgentConfig = {
    name: "The Weaver",
    worldName: restoring?.name ?? config.name,
    narrative: config.narrative ?? restoring?.entities.find(entity => entity.id === savedGod)?.components.GodAgent?.narrative
      ?? restoring?.narrative ?? "A living world where stories unfold.",
    preset: config.statePreset as any,
    timeScale,
  };
  const god = createGodAgent(world, godConfig);

  const isGenesis = Boolean(config.genesis);
  const narrativeEngineEnabled = aiEnabled && (config.enableNarrativeEngine ?? isGenesis);

  // The deterministic substrate belongs to every world, including generated
  // ones. Genesis replaces authored content, not physics, cognition, goals,
  // schedules, stimuli, or monitoring.
  registerAllBuiltinSystems(god.systemRegistry);

  if (restoring) {
    deserializeWorld(world, god.systemRegistry, restoring, { reuseGod: { savedEid: savedGod!, liveEid: god.eid }, strictSystems: true });
    syncEntityRegistryFromWorld(world, god.registry);
    god.tick = world.time.tick;
    updateGlobalTime(god, 0);
    // Explicit runtime mode overrides remain caller-owned; defaults retain save modes.
    const restoreModes = supplied.runtimeProfile ? config : supplied;
    if (restoreModes.timedSpeech !== undefined) world.meta.timedSpeech = restoreModes.timedSpeech;
    if (restoreModes.timedActions !== undefined) world.meta.timedActions = restoreModes.timedActions;
    if (restoreModes.narrativeMind !== undefined) world.meta.narrativeMind = restoreModes.narrativeMind;
  }
  registerNativeRuntimeServices(world, { ai: aiEnabled, planning: config.enablePlanning !== false,
    reflection: config.enableReflection !== false, timedSpeech: world.meta.timedSpeech, timedActions: world.meta.timedActions });

  if (!isGenesis && !restoring) {
    // Standard path: apply authored prebake preset.

    const preset = config.preset || "slice-of-life";
    console.log(`⚙️  Applying preset: ${preset}`);
    const prebakeResult = createPrebakePreset(preset, world, god.systemRegistry);
    if (prebakeResult.errors.length > 0) {
      console.warn(`⚠️  Prebake warnings: ${prebakeResult.errors.join(", ")}`);
    }
  } else if (isGenesis) {
    console.log(`🌱 Genesis mode — God will create the world from seed`);
  }

  // Initialize spirit system (default: enabled, but requires AI)
  const spiritsEnabled = aiEnabled && (config.enableSpirits !== false);
  let spiritSystem: SpiritSystemState | null = null;
  if (spiritsEnabled) {
    console.log(`👁️  Initializing spirit system...`);
    spiritSystem = initializeSpiritSystem(world, {
      godAgentEid: god.eid,
      tickInterval: 10000,
      autoCreateNarrator: false,
    });
    createStandardHierarchy(god.eid, world);
    console.log(`   Spirits: Narrator, Arbiter, Crafter, Steward, Weaver, Tinker`);

    // --- GodAI Autopilot wiring ---
    // Always capture spirit messages (prevents message loss even if autopilot disabled).
    const autopilotSetting = config.godAutopilot;
    const autopilotEnabled =
      autopilotSetting === undefined
        ? true
        : typeof autopilotSetting === "boolean"
          ? autopilotSetting
          : autopilotSetting.enabled !== false;

    const autopilotOverrides =
      typeof autopilotSetting === "object" ? autopilotSetting : {};

    // Spirit reports (Narrator requests, Watcher stagnation) stay readable for
    // five simulated minutes unless the host sets its own freshness window.
    initializeGodAutopilot(god, { maxMessageAgeMs: 300_000, ...autopilotOverrides, enabled: autopilotEnabled });

    setGodAgentCallback(async (messages) => {
      // Fast callback: just enqueue, do not call LLM here.
      enqueueSpiritMessages(god, messages, (fromEid) => {
        const spirit = spiritSystem?.registry.spirits.get(fromEid);
        return spirit?.definition.name || `Spirit#${fromEid}`;
      });
    }, world);
  }

  const evolutionSetting = config.evolution;
  const evolutionEnabled = spiritsEnabled && evolutionSetting !== false;
  const evolutionCoordinator = createEvolutionCoordinator({
    ...(typeof evolutionSetting === "object" ? evolutionSetting : {}),
    enabled: evolutionEnabled,
  });
  const codingSetting = config.codingDaemons;
  const codingDaemon = (codingSetting === true || typeof codingSetting === "object" || (codingSetting !== false && evolutionEnabled))
    ? new CodingDaemon(world, god.systemRegistry, typeof codingSetting === "object" ? codingSetting : {}) : null;

  // Initialize ObjectManager and RulesEngine for deterministic world behavior
  const objectManager = new ObjectManager(world);
  const rulesEngine = new RulesEngine(world, objectManager);
  console.log(`⚡ Rules engine initialized (${worldSchema.getActiveRules().length} active rules)`);

  // Create rooms first (so agents can be placed in them)
  const roomMap = new Map<string, number>();
  const roomsToPopulate: { name: string; roomType: string }[] = [];
  if (config.rooms && !config.useGodCommand && !isGenesis && !restoring) {
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
      const shouldPopulate = roomConfig.autoPopulate ?? config.autoPopulateRooms ?? Boolean(roomConfig.roomType);
      if (shouldPopulate && roomConfig.roomType && spiritsEnabled) {
        requestRoomPopulationForRoom(world, roomEid, {
          roomType: roomConfig.roomType,
          context: { worldTheme: getWorldTheme(world), economyLevel: "modest" },
          requestedBy: god.eid,
        });
        roomsToPopulate.push({ name: roomConfig.name, roomType: roomConfig.roomType });
        console.log(`   - ${roomConfig.name} (${roomConfig.roomType}) → queued for The Steward`);
      } else {
        console.log(`   - ${roomConfig.name}`);
      }
    }
  }

  // Create agents
  if (config.agents && !config.useGodCommand && !isGenesis && !restoring) {
    console.log(`👥 Creating ${config.agents.length} agents...`);
    for (const agentConfig of config.agents) {
      const roomEid = agentConfig.startRoom ? roomMap.get(agentConfig.startRoom) : undefined;
      const agentEid = createAgentEntity(world, {
        name: agentConfig.name,
        role: agentConfig.role,
        description: agentConfig.description || `A ${agentConfig.role}`,
        systemPrompt: agentConfig.systemPrompt || `You are ${agentConfig.name}, a ${agentConfig.role}. ${agentConfig.description || ""}`,
        past: agentConfig.past,
        roomId: roomEid,
        gridPosition: agentConfig.gridPosition,
      });
      console.log(`   - ${agentConfig.name} (${agentConfig.role})`);

      // Ensure canonical containment is set exactly once.
      if (agentConfig.startRoom && roomEid && getDirectContainer(world, agentEid) === undefined) {
        setLocatedIn(world, agentEid, roomEid);
      }

      // Auto-assign behavior policy based on role (deterministic-first cognition)
      const { template, params: inferredParams } = inferPolicyFromRole(agentConfig.role);
      // Pass the agent's actual start room so policy room references match reality
      const policyParams = {
        ...inferredParams,
        room: inferredParams?.room || agentConfig.startRoom,
        workplace: inferredParams?.workplace || agentConfig.startRoom,
        rooms: inferredParams?.rooms || (config.rooms ? config.rooms.map(r => r.name) : undefined),
      };
      const policyTree = getPolicyTemplate(template, policyParams);
      if (policyTree) {
        setAgentBehaviorPolicy(world, agentEid, policyTree);
        console.log(`     policy: ${template}`);
      }
    }
  }

  // Create objects
  if (config.objects && !config.useGodCommand && !isGenesis && !restoring) {
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

  // Genesis: God creates the entire world from a seed description
  if (isGenesis) {
    const seed = typeof config.genesis === "object" && config.genesis.seed
      ? config.genesis.seed
      : config.narrative || "A living world where stories unfold.";

    console.log(`🌱 Genesis seed: "${seed.slice(0, 80)}${seed.length > 80 ? "..." : ""}"`);

    const genesisPrompt = `GENESIS MODE — You are creating an entire world from scratch. The world is completely empty.

SEED DESCRIPTION: ${seed}

Your task:
1. Create 2-4 rooms that fit the setting (use createRoom)
2. ${specification?.inhabitants.length ? `Create the ${specification.inhabitants.length} named inhabitants in the PRIVATE CHARACTER CREATION SEEDS, using their declared rooms where provided` : "Create 2-4 agents with appropriate roles placed in those rooms"} (use createAgent).
   Use its past field to give each person a private background, enduring drives,
   and 2-4 formative recollections with personal meaning. Include ordinary warmth,
   belonging or achievement, not only trauma. Keep shared histories consistent;
   one person's recollection is not another person's knowledge or a current event.
3. Create 3-8 objects/furniture to populate the rooms (use createObject)
4. Optionally create 1-2 custom components if the setting calls for unique mechanics (use createComponent)
5. Optionally create 1-2 custom systems for unique world behaviors (use bakeNewSystem)
6. If creating affordances, you MUST also create the required traits AND tag the relevant objects with those traits.
   For example: if you create affordance "read_forbidden_text" requiring trait "forbidden_text",
   you must ALSO create trait "forbidden_text" AND ensure the target objects have that trait in their traits list.
   Without matching traits on objects, affordances will silently fail.

Create a COMPLETE, FUNCTIONAL world. Every agent must be in a room. Objects should make the setting feel alive.
Do NOT explain — just create everything using your tools.`;

    console.log(`🔮 Running genesis command...`);
    const results = await godCommand(god, genesisPrompt);
    const successCount = results.filter(r => r.success).length;
    console.log(`🌱 Genesis complete: ${successCount}/${results.length} tool calls succeeded`);

    const generatedAgents = Array.from(query(world, [Agent])).length;
    const generatedRooms = Array.from(query(world, [Room])).length;
    const generatedObjects = Array.from(query(world, [PhysicalObject])).length;
    if (generatedAgents === 0 || generatedRooms === 0 || generatedObjects === 0) {
      const firstError = results.find((result) => !result.success)?.error;
      throw new Error(
        `Genesis failed its world-integrity gate: ${generatedAgents} agents, ${generatedRooms} rooms, `
        + `${generatedObjects} objects were created${firstError ? `. First error: ${firstError}` : ""}`,
      );
    }
  }

  if (narrativeEngineEnabled && !restoring) {
    const narrativeSeed = typeof config.genesis === "object" && config.genesis.seed
      ? config.genesis.seed
      : config.narrative || config.name;
    console.log(`🕯️  Building narrative scaffold...`);
    const scaffold = await generateStoryScaffold(world, narrativeSeed);
    if (!scaffold) {
      console.warn(`⚠️  Narrative scaffold generation failed; simulation can still run without direction`);
    }
  }

  // Settle baseline routines before the first deterministic world tick, which
  // projects their activity goals before cognition issues its first request.
  // Otherwise the async daily installer can introduce a routine goal during
  // inference and correctly invalidate a choice made from an incomplete agenda.
  // Restored worlds retain their exact saved state; genuinely new schedules
  // and later agenda changes still use ordinary stale-decision validation.
  if (config.generateSchedules) {
    console.log(`📅 Generating agent schedules...`);
    await initializeAllSchedules(world, true);
  } else if (!restoring && god.systemRegistry.systems.get("DailySchedulePlanner")?.active) {
    await initializeAllSchedules(world, false);
  }

  // Create daemon registry for agent guardians
  console.log(`👁️  Creating daemon registry...`);
  const daemonRegistry = createDaemonRegistry(
    15000,  // 15 second observation interval
    20000,  // 20 second minimum gap between any two whispers to one resident
    90000   // 90 second challenge cooldown
  );
  // A live world's daemons whisper: persona- and story-aware inner voices on
  // their own cadence (~30-60s sim, sooner when a resident is idling).
  daemonRegistry.innerVoice = aiEnabled;

  if (aiEnabled) {
    if (config.enableReflection !== false) {
      for (const eid of query(world, [Agent, Mind])) initializeReflectionState(world, eid);
    }
    // Create daemons for all agents
    const daemonCount = createDaemonsForAllAgents(daemonRegistry, world);
    console.log(`   Created ${daemonCount} guardian daemons`);

    // Set god agent as superior for daemons
    setDaemonSuperior(daemonRegistry, god.eid);

    // Initialize simulation tension at low level
    setSimulationTension(daemonRegistry, 0.1);
  } else {
    console.log(`   (enableAI:false) Skipping daemon creation`);
  }

  if (narrativeEngineEnabled) setDirectorGodAgent(god);
  // Narrator (and director) nudges are voiced by each resident's daemon
  // whenever daemons exist, independent of the narrative-engine flag.
  if (narrativeEngineEnabled || aiEnabled) setNudgeDaemonRegistry(world, daemonRegistry);

  // Setup web server if enabled
  let server: ReturnType<typeof createSimulationServer> | null = null;
  if (config.enableServer) {
    const port = config.serverPort || 3456;
    server = createSimulationServer(port);
    server.setSimulationState({
      world,
      registry: god.systemRegistry,
      tick: world.time.tick,
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
  // Private operator/actor observations, never public committed world events.
  // Each writer owns its thought type: a background appraisal finishing during
  // foreground inference must not be published by both overlapping cursors.
  const publishThoughts = (cursor: ThoughtPublicationCursor, type: "decision" | "reflection") => {
    for (const event of takeNewAuthoredThoughtEvents(cursor)) if (event.thoughtType === type) bus.emit(event);
  };
  const appraiseWithThoughtPublication = async (eid: number) => {
    const cursor = captureThoughtPublication(world, eid);
    const result = await runExperienceAppraisal(world, eid);
    publishThoughts(cursor, "reflection");
    return result;
  };
  if (codingDaemon) {
    codingDaemon.setEventHandler(({job,message}) => {
      bus.emit({type:"system:build",timestamp:Date.now(),jobId:job.id,status:job.status,source:job.request.source,message});
      if (!["active","rejected","rolled_back","cancelled"].includes(job.status)) return;
      const report = {id:`coding:${job.id}:${job.status}`,timestamp:Date.now(),from:god.eid,to:god.eid,
        type:"report" as const,domain:"ecology" as const,
        priority:job.status === "rejected" || job.status === "rolled_back" ? "high" as const : "normal" as const,
        subject:`Coding daemon ${job.status}: ${job.systems?.join(", ") || job.id}`,
        content:message,data:{jobId:job.id,status:job.status,systems:job.systems},requiresResponse:false};
      if (god.autopilot) enqueueSpiritMessages(god,[report],()=>"Coding daemon");
      const requester = [...(spiritSystem?.registry.spirits.values() ?? [])].find(s=>s.definition.name===job.request.source);
      if(requester) requester.inbox.push({...report,to:requester.eid});
    });
    await codingDaemon.initialize();
  }

  // Turn registry-local execution data into the public event stream. This is
  // intentionally part of the library: generated systems must remain
  // observable even when no development server or UI exists.
  const observedSystems = new Set<string>();
  const observedRuns = new Map(
    getSystemTelemetrySnapshot().map((entry) => [entry.systemName, entry.runs]),
  );
  // Observe appends, not tail length: a full bounded tail rotates at constant
  // length, and external consumers may drain it between monitoring ticks.
  subscribeSystemDiagnostics(god.systemRegistry, ({ channel, value }) => {
    if (channel !== "errors") return;
    const system = god.systemRegistry.systems.get(value.systemName);
    bus.emit({
      type: "system:error", timestamp: value.timestamp, systemName: value.systemName,
      error: value.error, errorCount: value.errorCount,
      disabled: system ? !system.active : undefined,
    });
  });
  const emitSystemMonitoring = (): void => {
    for (const system of god.systemRegistry.systems.values()) {
      if (observedSystems.has(system.name)) continue;
      observedSystems.add(system.name);
      bus.emit({
        type: "system:created",
        timestamp: Date.now(),
        systemName: system.name,
        description: system.description,
        frequency: system.frequency,
        pseudocode: system.pseudocode,
      });
    }

    for (const telemetry of getSystemTelemetrySnapshot()) {
      if (!god.systemRegistry.systems.has(telemetry.systemName)) continue;
      const previousRuns = observedRuns.get(telemetry.systemName) ?? 0;
      if (telemetry.runs > previousRuns) {
        bus.emit({
          type: "system:executed",
          timestamp: telemetry.lastTimestamp || Date.now(),
          systemName: telemetry.systemName,
          duration: telemetry.lastDurationMs,
        });
      }
      observedRuns.set(telemetry.systemName, telemetry.runs);
    }

  };
  // Register injection handlers
  bus.registerInjectionHandler("inject:god_command", async (msg) => {
    if (msg.type === "inject:god_command") {
      console.log(`[Bus] Injecting god command: ${msg.command}`);
      await godCommand(god, msg.command);
    }
  });

  bus.registerInjectionHandler("inject:spirit_message", async (msg) => {
    if (msg.type !== "inject:spirit_message") return;
    if (!spiritSystem) throw new Error("Spirit messages need the spirit system (enableAI and enableSpirits)");
    const delivered = injectOperatorSpiritMessage(world, { message: msg.message, subject: msg.subject,
      targetSpiritId: msg.targetSpiritId, targetSpiritName: msg.targetSpiritName, priority: msg.priority }, god.eid);
    console.log(`[Bus] Spirit message delivered to ${delivered.join(", ")}`);
  });

  bus.registerInjectionHandler("inject:agent_stimulus", async (msg) => {
    if (msg.type === "inject:agent_stimulus") {
      const agents = Array.from(query(world, [Agent]));
      for (const agentEid of agents) {
        if (Name.value[agentEid] === msg.targetAgentName) {
          const admitted = queueStimulus(world, {
            targetEid: agentEid,
            type: msg.stimulusType || "perception",
            modality: "cognitive",
            content: msg.stimulus,
            source: msg.source || "external",
          });
          if (!admitted) throw new Error(`Stimulus to ${msg.targetAgentName} was not admitted; inspect simulation.getOperationalStatus().stimuli`);
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

  const dualLoopEnabled = config.dualLoop !== false;

  // Build simulation state
  let running = false;
  let stopping = false;
  let paused = false;
  let tick = world.time.tick;
  let loopTimeout: NodeJS.Timeout | null = null;
  let runtime: RuntimeSimulationState | null = null;

  const simulation: ArgosSimulation = {
    world,
    god,
    bus,
    daemons: daemonRegistry,
    tick,
    running: false,
    paused: false,

    start: async () => {
      if (running) return;
      startCommittedEvents(world);
      running = true;
      simulation.running = true;
      if (spiritsEnabled) startSpiritSystem(world);
      codingDaemon?.start();
      console.log(`\n🎭 Starting simulation loop...\n`);

      if (narrativeEngineEnabled) {
        startBeatDetection(world);
      }

	      if (dualLoopEnabled) {
	        if (!runtime) {
	          const spiritRegistry = spiritSystem?.registry ?? createSpiritRegistry(world);
	          runtime = createRuntimeSimulation(world, god.systemRegistry, spiritRegistry, {
	            ecsTickRate, ecsDeltaMs: baseDeltaMs, timeScale, ownsWorldClock: false,
	            logTickStats: false,
	          });

          // Fast deterministic tick (no awaits)
          registerFastSystem(runtime, {
            name: "WorldTick",
            execute: (_w, deltaMs, t) => {
              advanceGoalTick(world);
              codingDaemon?.commitReady(t);
              const worldEvents = runWorldTickAt(god, t, deltaMs);
              runEmotionalDynamics(world);
              runAppearanceEmitter(world);
              bridgeWorldEventsToStimuli(world, worldEvents);
              emitSystemMonitoring();
              simulation.tick = t;
              simulation.running = running;
              simulation.paused = paused;

              // Run deterministic rules (fire spreads, decay, etc.)
              const ruleEvents = rulesEngine.processTick(t);
              if (ruleEvents.length > 0) {
                for (const event of ruleEvents) {
                  bus.emit({
                    type: "world:state",
                    timestamp: event.timestamp,
                    tick: t,
                    agentCount: 0,
                    roomCount: 0,
                    systemCount: 0,
                    daemonCount: 0,
                    ...(event.type && { ruleEvent: event.type, ruleEntityId: event.entityId }),
                  } as unknown as SimulationEvent);
                }
              }

              // Emit world state through bus (coarse)
              const agentCountNow = Array.from(query(world, [Agent])).length;
              const roomCountNow = Array.from(query(world, [Room])).length;
              bus.emit({
                type: "world:state",
                timestamp: Date.now(),
                tick: t,
                agentCount: agentCountNow,
                roomCount: roomCountNow,
                systemCount: god.systemRegistry.systems.size,
                daemonCount: daemonRegistry.daemons.size,
              } as SimulationEvent);

              // Update server state (if enabled)
              if (server) {
                server.setSimulationState({
                  world,
                  registry: god.systemRegistry,
                  tick: t,
                  events: worldEvents.slice(-50),
                  logs: god.systemRegistry.logs.slice(-50),
                });
                server.updateState();
              }
            },
          });

	          // Cognition loop: always registered so behavior policies fire even without AI.
	          // When AI is off, planning is skipped and LLM fallback is never reached.
              // Independent actors: a slow secondary NPC cannot hold Mara's
              // completed decision in a Promise.all batch. Foreground slots are
              // reserved, so world-building cannot occupy the entire AI queue.
              const enrolled = new Set<number>();
              const modelDemand = new Set<number>(), deliberating = new Set<number>();
              registerFastSystem(runtime, {
                name: "CognitionEnrollment",
                execute: () => {
                  for (const eid of query(world, [Agent, Mind])) {
                    if (enrolled.has(eid)) continue;
                    enrolled.add(eid);
                    registerAIOperation(runtime!, {
                      name: `AgentCognition:${eid}`, interval: 1, priority: "high", lane: "foreground",
                      ready: () => modelDemand.has(eid) && entityExists(world, eid) && Agent.active[eid] && isForegroundActorAvailable(world, eid)
                        && isForegroundCognitionReady(world, eid, { hasQueuedStimuli: hasPendingCognitionStimuli(world, eid),
                          hasPendingStimuli: hasPendingCognitionStimuli(world, eid) || hasUnintegratedAttention(world, eid, false),
                          hasDueAttention: hasDueAttentionSignal(world, eid) }),
                      execute: async () => {
                        deliberating.add(eid);
                        try {
                          const thoughtCursor = captureThoughtPublication(world, eid);
                          const actions = await runCognitionCycle(world, god.systemRegistry, { tick: runtime!.tick, enablePlanning: false, agentEids: [eid] });
                          for (const { action } of actions) {
                            if (server) server.pushAgentAction(Name.value[eid], action);
                            bus.emit({ type: "agent:action", timestamp: Date.now(), agentId: eid,
                              agentName: Name.value[eid], action: action.type, target: action.target, content: action.content } as SimulationEvent);
                          }
                          executeActions(world, actions, god.systemRegistry);
                          publishThoughts(thoughtCursor, "decision");
                        } finally { deliberating.delete(eid); }
                      },
                    });
                    if (aiEnabled) {
                      const active = () => entityExists(world, eid) && Agent.active[eid];
                      // Appraisal is how lived experience becomes feeling and memory; it
                      // continues while the operator possesses this body. The resident's
                      // own planning, goal review and reflection wait until release.
                      const ownMind = () => active() && !isOperatorControlled(world, eid);
                      if (config.enableExperienceAppraisal !== false) registerAIOperation(runtime!, {
                        name: `AgentAppraisal:${eid}`, interval: 1, priority: "high", lane: "subconscious",
                        ready: () => active() && hasExperienceAppraisal(world, eid),
                        execute: () => appraiseWithThoughtPublication(eid),
                      });
                      if (config.enableReflection !== false) initializeReflectionState(world, eid);
                      if (config.enableReflection !== false) registerAIOperation(runtime!, {
                        name: `AgentCoordinationReview:${eid}`, interval: 2, priority: "normal", lane: "subconscious",
                        ready: () => ownMind() && hasPendingCoordinationReview(world, eid),
                        execute: () => runCoordinationReview(world, eid),
                      });
                      if (config.enablePlanning !== false) {
                        registerAIOperation(runtime!, {
                          name: `AgentPlanning:${eid}`, interval: 1, priority: "high", lane: "subconscious",
                          ready: () => ownMind() && !hasPendingPersonalGoalReview(world, eid) && hasPendingPlanning(world, eid, { focusActiveGoal: true, background: true }),
                          execute: () => runPlanningSystem(world, { agentEids: [eid], focusActiveGoal: true, background: true }),
                        });
                      }
                      registerAIOperation(runtime!, {
                        name: `AgentPersonalReview:${eid}`, interval: 1, priority: "high", lane: "subconscious",
                        ready: () => ownMind() && hasPendingPersonalGoalReview(world, eid),
                        execute: () => runAgentSubconscious(world, eid, { enableReflection: config.enableReflection }),
                      });
                      registerAIOperation(runtime!, {
                        name: `AgentSubconscious:${eid}`, interval: 5, priority: "normal", lane: "subconscious",
                        ready: () => ownMind() && !hasPendingPersonalGoalReview(world, eid) && hasSubconsciousWork(world, eid, { enableReflection: config.enableReflection }),
                        execute: () => runAgentSubconscious(world, eid, { enableReflection: config.enableReflection }),
                      });
                    }
                  }
                },
              });

              registerFastSystem(runtime, {
                name: "ActorControl",
                execute: () => {
                  for (const eid of query(world, [Agent, Mind])) {
                    try {
                      const thoughtCursor = captureThoughtPublication(world, eid);
                      const needsModel = runActorControlStep(world, eid, god.systemRegistry, {
                        deliberating: deliberating.has(eid),
                        appraisalPending: config.enableExperienceAppraisal !== false && isExperienceAppraisalPending(world, eid),
                        onAction: action => {
                          if (server) server.pushAgentAction(Name.value[eid], action);
                          bus.emit({ type: "agent:action", timestamp: Date.now(), agentId: eid,
                            agentName: Name.value[eid], action: action.type, target: action.target, content: action.content } as SimulationEvent);
                        },
                      });
                      publishThoughts(thoughtCursor, "decision");
                      if (needsModel) modelDemand.add(eid); else modelDemand.delete(eid);
                    } catch {
                      // A faulty/unloaded actor package must not starve every
                      // later actor in this tick or launch speculative inference.
                      modelDemand.delete(eid);
                      console.warn(`[ActorControl] Could not advance actor ${eid}; retrying next tick.`);
                    }
                  }
                },
              });

	          if (aiEnabled) {
	            // Daemon observations (async)
	            registerAIOperation(runtime, {
	              name: "DaemonSystem",
	              interval: 1,
	              priority: "normal",
	              execute: async () => {
	                createDaemonsForAllAgents(daemonRegistry, world);
	                await runDaemonSystem(world, daemonRegistry, spiritSystem?.registry);
	              },
	            });

              if (narrativeEngineEnabled) {
                registerAIOperation(runtime, {
                  name: "NarrativeDirector",
                  interval: 1,
                  priority: "normal",
                  execute: async () => {
                    await runNarrativeDirectorCycle(world);
                  },
                });
              }

	            // Generic spirit cognition and message routing (async)
	            registerAIOperation(runtime, {
	              name: "SpiritSystem",
	              interval: 1,
	              priority: "normal",
	              execute: async () => {
	                if (!spiritsEnabled || !spiritSystem) return;

	                const spiritTick = await tickSpiritSystem(world, god.registry);
	                // Narrator prose is a viewer/recording feed, never a resident perception.
	                for (const text of spiritTick.narrativeProse) {
	                  bus.emit({ type: "spirit:prose", timestamp: Date.now(), spiritName: "The Narrator", text, atSimMs: readStoryTime(world) });
	                  storyChronicle.record("narrator_prose", { text, atSimMs: readStoryTime(world) }, `Narrator: ${text.slice(0, 160)}`);
	                }
	              },
	            });

              if (evolutionEnabled && spiritSystem) {
                registerAIOperation(runtime, {
                  name: "WorldEvolution",
                  interval: 1,
                  priority: "normal",
                  execute: async () => {
                    await evolutionCoordinator.run(runtime?.tick ?? simulation.tick, {
                      world,
                      god,
                      spirits: spiritSystem!.registry,
                    });
                    emitSystemMonitoring();
                  },
                });
              }

              // GodAI Autopilot (async)
              // Consumes spirit/daemon reports from the inbox and issues godCommand calls under throttling.
              registerAIOperation(runtime, {
                name: "GodAutopilot",
                interval: 1,
                priority: "high",
                execute: async () => {
                  if (!spiritsEnabled) return;
                  if (!god.autopilot) return;
                  await runGodAutopilotCycle(god);
                },
              });
	          }
	        }

        startRuntimeSimulation(runtime);
        return;
      }

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
      if (stopping) return;
      stopping = true;
      const errors: unknown[] = [];
      const cleanup = (run: () => void) => { try { run(); } catch (error) { errors.push(error); } };
      // Fence scheduling first. Preserve cancellation receipts before sealing
      // their source, but never let a consumer failure skip native shutdown.
      running = false;
      simulation.running = false;
      if (loopTimeout) {
        clearTimeout(loopTimeout);
        loopTimeout = null;
      }
      try {
        cleanup(() => clearTimedSpeech(world));
        cleanup(() => clearSimulationTimeline(world));
        cleanup(() => stopCommittedEvents(world));
        cleanup(() => codingDaemon?.stop());
        if (dualLoopEnabled && runtime) cleanup(() => stopRuntimeSimulation(runtime!));
        if (narrativeEngineEnabled) cleanup(() => stopBeatDetection(world));
        if (spiritsEnabled) cleanup(() => stopSpiritSystem(world));
      } finally { stopping = false; }
      if (errors.length) throw new AggregateError(errors, "Simulation cleanup failed after attempting all teardown stages");
      console.log(`\n🛑 Simulation stopped.`);
    },

    drainPendingOperations: async timeoutMs => {
      if (running || simulation.running) throw new Error("Operation drain requires a stopped simulation");
      if (runtime) await drainSimulationOperations(runtime, timeoutMs);
    },

    pause: () => {
      paused = true;
      simulation.paused = true;
      if (dualLoopEnabled && runtime) pauseRuntimeSimulation(runtime);
      console.log(`⏸️  Simulation paused.`);
    },

    resume: () => {
      paused = false;
      simulation.paused = false;
      if (dualLoopEnabled && runtime) resumeRuntimeSimulation(runtime);
      console.log(`▶️  Simulation resumed.`);
    },

	    step: async (deltaMs = defaultDeltaMs) => {
          validateSimulationDelta(deltaMs);
          if (dualLoopEnabled && runtime?.ecsTimer) throw new Error("Pause the live runtime before manually stepping");
	      tick = Math.max(tick, world.time.tick) + 1;
	      simulation.tick = tick;
      codingDaemon?.commitReady(tick);
      void codingDaemon?.pump();
	      console.log(`\n--- Tick ${tick} ---`);

      // Update god systems
      const worldEvents = runWorldTickAt(god, tick, deltaMs);
      runEmotionalDynamics(world);
      runAppearanceEmitter(world);
      bridgeWorldEventsToStimuli(world, worldEvents);
      emitSystemMonitoring();

      if (aiEnabled && config.enableExperienceAppraisal !== false)
        for (const eid of query(world, [Agent, Mind])) if (hasExperienceAppraisal(world, eid)) await appraiseWithThoughtPublication(eid);

	      // Run cognition cycle (AI)
	      const thoughtCursors = aiEnabled ? Array.from(query(world, [Agent, Mind]), eid => captureThoughtPublication(world, eid)) : [];
	      const actions = aiEnabled
	        ? await runCognitionCycle(world, god.systemRegistry, { tick, enablePlanning: false })
	        : [];

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
      for (const cursor of thoughtCursors) publishThoughts(cursor, "decision");

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
          events: worldEvents.slice(-50),
          logs: god.systemRegistry.logs.slice(-50),
        });
        server.updateState();
      }

	      // Run daemon observation system (AI)
	      if (aiEnabled) {
            // Batch stepping explicitly awaits background work AFTER action execution.
            // Live dual-loop runs these jobs independently; neither detaches promises.
            for (const eid of query(world, [Agent, Mind])) {
              await runAgentSubconscious(world, eid, { enableReflection: config.enableReflection });
            }
            if (config.enablePlanning !== false) await runPlanningSystem(world, { focusActiveGoal: true });
            createDaemonsForAllAgents(daemonRegistry, world);
	        const daemonResult = await runDaemonSystem(world, daemonRegistry, spiritSystem?.registry);
	        if (daemonResult.observations > 0) {
	          console.log(`  [Daemons] ${daemonResult.observations} observations, ${daemonResult.whispers} whispers, ${daemonResult.challenges} challenges, ${daemonResult.reports} reports`);
	        }
	      }

	      // Run generic spirit cognition and the specialist evolution pipeline (AI)
	      if (aiEnabled && spiritsEnabled && spiritSystem) {
        // Tick spirits (Narrator, Arbiter, etc.)
        const spiritResult = await tickSpiritSystem(world, god.registry);
        // Narrator prose is a viewer/recording feed, never a resident perception.
        for (const text of spiritResult.narrativeProse) {
          bus.emit({ type: "spirit:prose", timestamp: Date.now(), spiritName: "The Narrator", text, atSimMs: readStoryTime(world) });
          storyChronicle.record("narrator_prose", { text, atSimMs: readStoryTime(world) }, `Narrator: ${text.slice(0, 160)}`);
        }
        if (spiritResult.spiritsProcessed > 0) {
          console.log(`  [Spirits] ${spiritResult.spiritsProcessed} spirits processed`);
        }

        if (evolutionEnabled) {
          await evolutionCoordinator.run(tick, { world, god, spirits: spiritSystem.registry });
          emitSystemMonitoring();
        }
        if (god.autopilot) await runGodAutopilotCycle(god);
      }

      if (narrativeEngineEnabled) {
        await runNarrativeDirectorCycle(world);
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
        tick: simulation.tick || tick,
        agentCount: agents.length,
        roomCount: rooms.length,
        objectCount: Array.from(query(world, [PhysicalObject])).length,
        activeGoals: Array.from(query(world, [Goal])).filter(
          (goalEid) => Goal.status[goalEid] === "active" || Goal.status[goalEid] === "in_progress",
        ).length,
        systemCount: god.systemRegistry.systems.size,
      };
    },

    getEvolutionStatus: () => evolutionCoordinator.getStatus(),
    getRuntimeServices: () => getNativeRuntimeServices(world),
    getRuntimeStatus: () => runtime ? getRuntimeStats(runtime) : null,
    getOperationalStatus: () => ({
      stimuli: getStimulusQueueStatus(world),
      systemDiagnostics: getSystemDiagnosticCoverage(god.systemRegistry),
    }),
    getWorldConstructionStatus: () => getWorldConstructionStatus(world),
    getCodingStatus: () => codingDaemon?.getStatus() ?? null,
    requestSystemBuild: (request: BuildRequest) => {
      if(!codingDaemon) throw new Error("Enable codingDaemons to request system builds");
      return codingDaemon.enqueue(request);
    },

    getSystemHealth: () => getAllSystemHealth(god.systemRegistry),

	    command: async (cmd: string) => {
	      if (!aiEnabled) {
	        throw new Error("Simulation.command is disabled when enableAI:false");
	      }
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
          return queueStimulus(world, {
            targetEid: agentEid,
            type,
            modality: "cognitive",
            content,
            source: "narrator",
          });
        }
      }
      console.warn(`Agent "${agentName}" not found`);
      return false;
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
 * Compatibility wrapper for the single genesis path. New callers can pass
 * the prompt directly to `createSimulation(prompt)`.
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
  const finalConfig: SimulationConfig = {
    name: prompt.trim().split(/\n|[.!?]/, 1)[0]?.slice(0, 49) || "Generated World",
    narrative: prompt,
    genesis: { seed: prompt },
    ...options,
    enableNarrativeEngine: options.enableNarrativeEngine ?? true,
  };

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
export { approveRuntimeRuleDefinitions, restoreRuntimeRuleApprovals, type RuntimeRuleApprovalCatalogue } from "./world/runtime-rule-restoration";
export { readSimulationTime, getSimulationTimeSnapshot, advanceSimulationTime, type SimulationTimeSnapshot } from "./ecs/simulation-time";
export { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity, createGodAgentEntity } from "./ecs/prefabs";
export { registerExternalParticipant, getExternalParticipants, authorizeParticipantEmbodiment,
  type ParticipantEmbodimentGrant } from "./runtime/participant-identities";
export { initializeWorkDocument, getDocumentAffordances, readProductiveGoalTime } from "./world/productive-work";
export { createSimulationHost, type SimulationHost, type SimulationHostSnapshot, type SimulationHostHealth } from "./runtime/simulation-host";
export { hasFinitePortions, isPortionVessel, transferSinglePortion, consumeSinglePortion,
  type PortionSupplyStore, type PortionVesselStore } from "./world/finite-portions";
export { query, addEntity, removeEntity, addComponent, removeComponent, hasComponent, getRelationTargets } from "bitecs";

// Unified Component Registry
export {
  initializeRegistry,
  getComponent,
  registryHasComponent,
  attachToEntity,
  detachFromEntity,
  getMergedComponents,
  listNames as listComponentNames,
  listDynamic as listDynamicComponentDefs,
  listDefinitions as listAllComponentDefs,
} from "./ecs/component-registry";

// Components & Relations
export * from "./ecs/components";
export * from "./ecs/relations";

// God Agent
export { createGodAgent, godCommand, getWorldState, tickWorld } from "./god/god-agent";
export type { GodAgentState, GodAgentConfig } from "./god/god-agent";

// System Management
export { createSystemRegistry, registerSystem, runSystems, runAsyncSystems, subscribeSystemDiagnostics,
  getSystemDiagnosticCoverage, type SystemDefinition, type SystemRegistry, type SystemDiagnosticRecord } from "./ecs/dynamic-systems";
export { registerAllBuiltinSystems, createMovementSystem, createRoomArrivalSystem, setMovementTarget, clearMovementTarget } from "./systems/builtin-systems";
export { createPrebakePreset, getAvailablePresets, bakeSystem } from "./god/system-baker";
export type { PrebakePreset } from "./god/system-baker";

// Cognition System
export { runCognitionCycle, executeActions, broadcastToRoom, queueStimulus } from "./cognition/cognition-system";
export { getStimulusQueueStatus } from "./cognition/stimulus-queue";
export { queueExperiencedEvent, hasExperienceAppraisal, runExperienceAppraisal, subscribeExperienceAppraisal } from "./cognition/experience-appraisal";
export { snapshotActorContinuation } from "./cognition/actor-continuation";
export { createPersonalIntention } from "./cognition/goal-lifecycle";
export { snapshotAffect } from "./cognition/affect-state";
export { getForegroundCognitionReadiness, type ForegroundCognitionReadiness } from "./cognition/idle-cognition";
export { getWorkingMemory, getWorkingMemoryRevision, formatWorkingMemoryContext,
  type ActorWorkingMemory, type WorkingMemoryFact, type WorkingMemoryReceipt } from "./cognition/working-memory";
export { getCoordinationMemory, getCoordinationRevision, formatCoordinationContext,
  type ActorCoordinationMemory, type CoordinationItem, type CoordinationGoalRef } from "./cognition/coordination-memory";
export { recordPrivateCommunication, getPrivateCommunications, type PrivateCommunicationReceipt } from "./cognition/communication-memory";
export { getCurrentInspection, type InspectionMemory } from "./cognition/inspection-memory";
export { getSocialClosures, type SocialClosure } from "./cognition/social-memory";
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
export { getNarrativeHistory, narrativeEntryCount, getIdentityAnchors, type NarrativeRecord, type NarrativeEvidence } from "./cognition/narrative-memory";
export { characterPastSchema, type CharacterPast } from "./cognition/character-past-schema";
export { getEmotionalEpisodes, emotionalActivation, type EmotionalEpisode } from "./cognition/emotional-life";
export const VERSION = "2.0.0";

// In-world speech timing is distinct from model latency and video playback.
export { estimateSpeechDurationMs, getSpeakingActivity, isSpeaking, type SpeechInterval } from "./cognition/timed-speech";

// Small social laboratory + read-only multi-character rendering surface.
export { GenerativeAgentsTestbed, type GenerativeAgentsOptions, type TestbedCharacter } from "./demo/generative-agents";
export { SceneDirector, projectMultiCharacterScene, snapshotDirectorScene, type SceneSnapshot, type SceneShot } from "./rendering/scene-director";
export { attachCommittedSceneRenderer } from "./rendering/attach-committed-renderer";
export { attachCommittedSceneSource, type CommittedSceneSource, type CommittedSceneSourceOptions } from "./rendering/committed-scene-source";
// Optional embodied world package: ECS owns locomotion; renderers only observe.
export { createSpatialWorld, type SpatialAdmission, type SpatialOutcome, type SpatialPoint, type SpatialRect } from "./world/spatial-world";
export type { SceneEvent, SceneActor, SceneProp, SceneActionInterval, SceneActionStatus } from "./rendering/scene-snapshot";
export { CommittedSceneHistory, type CommittedSceneWindow, type CommittedSceneWorldWindow,
  type SceneWorldState, type WorldRoomEvidence, type SceneWorldWindowResult } from "./rendering/committed-scene-history";
export { CommittedSceneRenderer, projectCommittedSceneWindow, type CommittedRenderSegment } from "./rendering/committed-scene-renderer";
export { SourcePlaybackTimeline } from "./rendering/source-playback-timeline";
export { configureCharacterAppearance, registerGarment, tryWearGarment, tryRemoveGarment, snapshotCharacterAppearance, type CharacterAppearanceSnapshot } from "./rendering/character-appearance";
