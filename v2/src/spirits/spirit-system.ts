/**
 * Spirit System
 *
 * The ECS system that orchestrates all spirits - scheduling their cognition cycles,
 * routing messages, and coordinating the celestial hierarchy.
 */

import type { World } from "../ecs/world";
import type { EntityRegistry } from "../ecs/tools";
import type { ActionSnapshot, SpiritState, DivineMessage } from "./types";
import type { SpiritRegistry } from "./spirit-registry";
import {
  createSpiritRegistry,
  createSpirit,
  setGodAgent,
  getActiveSpirits,
  getSpiritsNeedingObservation,
  getMessagesForGodAI,
  getSpiritSummary,
} from "./spirit-registry";
import { runSpiritCognition, getSpiritSummary as getCognitionSummary } from "./spirit-cognition";
import { NarratorDefinition } from "./narrator-spirit";
import { ConsistencySpiritDefinition } from "./consistency-spirit";
import {
  initializeSpiritMessaging,
  spiritRouter,
  registerSpiritCapability,
  type SpiritCapability,
} from "./spirit-messaging";
import { createDynamicSpirit, type CreateSpiritConfig } from "./spirit-factory";
import { createWorldCrafterSpirit } from "./world-crafter-spirit";
import { createStewardSpirit } from "./steward-spirit";
import { createLawgiverSpirit } from "./rules-spirit";
import { createWatcherSpirit, runObservationSynthesis } from "./watcher-spirit";

// =============================================================================
// SPIRIT SYSTEM STATE
// =============================================================================

export interface SpiritSystemState {
  registry: SpiritRegistry;
  running: boolean;
  tickInterval: number;
  lastTick: number;
  actionBuffer: ActionSnapshot[];
  godAgentCallback?: (messages: DivineMessage[]) => Promise<void>;
  /** Global context from GodAgent - injected into all spirit prompts */
  globalContext?: string;
}

let systemState: SpiritSystemState | null = null;

// =============================================================================
// SYSTEM LIFECYCLE
// =============================================================================

/**
 * Initialize the spirit system
 */
export function initializeSpiritSystem(
  world: World,
  options: {
    godAgentEid?: number;
    tickInterval?: number;
    autoCreateNarrator?: boolean;
  } = {}
): SpiritSystemState {
  const registry = createSpiritRegistry(world);

  // Register GodAI if provided
  if (options.godAgentEid !== undefined) {
    setGodAgent(registry, options.godAgentEid);
  }

  systemState = {
    registry,
    running: false,
    tickInterval: options.tickInterval || 5000, // Check every 5 seconds
    lastTick: 0,
    actionBuffer: [],
  };

  // Auto-create the Narrator spirit
  if (options.autoCreateNarrator !== false) {
    createSpirit(registry, NarratorDefinition);
    console.log("[SpiritSystem] Narrator spirit created");
  }

  console.log("[SpiritSystem] Initialized");

  return systemState;
}

/**
 * Get the current spirit system state
 */
export function getSpiritSystemState(): SpiritSystemState | null {
  return systemState;
}

/**
 * Start the spirit system
 */
export function startSpiritSystem(): void {
  if (!systemState) {
    throw new Error("Spirit system not initialized. Call initializeSpiritSystem first.");
  }

  systemState.running = true;
  systemState.lastTick = Date.now();

  console.log("[SpiritSystem] Started");
}

/**
 * Stop the spirit system
 */
export function stopSpiritSystem(): void {
  if (systemState) {
    systemState.running = false;
    console.log("[SpiritSystem] Stopped");
  }
}

/**
 * Deliver pending messages to GodAI without running a full spirit cognition tick.
 * Useful for external loops that run watcher/maintainer logic out-of-band.
 * When God isn't available, routes messages between spirits directly.
 */
export async function deliverPendingMessagesToGod(): Promise<number> {
  if (!systemState) return 0;
  const messagesForGodAI = getMessagesForGodAI(systemState.registry);
  if (messagesForGodAI.length === 0) return 0;

  if (systemState.godAgentCallback) {
    await systemState.godAgentCallback(messagesForGodAI);
  } else {
    // No God available - route messages between spirits autonomously
    routeMessagesWithoutGod(systemState.registry, messagesForGodAI);
  }
  return messagesForGodAI.length;
}

/**
 * Route spirit messages without God AI as intermediary.
 * Uses the SpiritMessageRouter's capability-based routing to deliver
 * messages to the most appropriate spirit handler.
 */
function routeMessagesWithoutGod(registry: SpiritRegistry, messages: DivineMessage[]): void {
  for (const msg of messages) {
    // If message has a specific target, deliver directly
    if (msg.to !== undefined && msg.to !== -1) {
      const targetSpirit = registry.spirits.get(msg.to);
      if (targetSpirit) {
        targetSpirit.inbox.push(msg);
        console.log(`[SpiritRouter] Direct: ${msg.from} → ${targetSpirit.definition.name}`);
        continue;
      }
    }

    // Try capability-based routing first (uses the SpiritMessageRouter)
    const capability = inferCapabilityFromMessage(msg);
    if (capability) {
      const handler = spiritRouter.getBestHandler(capability);
      if (handler) {
        const targetSpirit = registry.spirits.get(handler.spiritEid);
        if (targetSpirit) {
          targetSpirit.inbox.push(msg);
          console.log(`[SpiritRouter] Capability "${capability}": "${msg.subject}" → ${targetSpirit.definition.name}`);
          continue;
        }
      }
    }

    // Fallback: content-based routing
    const targetSpirit = findBestSpiritForMessage(registry, msg);
    if (targetSpirit) {
      targetSpirit.inbox.push(msg);
      console.log(`[SpiritRouter] Content-match: "${msg.subject}" → ${targetSpirit.definition.name}`);
    } else {
      console.log(`[SpiritRouter] No handler for: "${msg.subject}" (priority: ${msg.priority})`);
    }
  }
}

/**
 * Infer the capability needed from message content
 */
function inferCapabilityFromMessage(msg: DivineMessage): SpiritCapability | undefined {
  const content = `${msg.subject} ${msg.content}`.toLowerCase();

  if (content.includes("system") && (content.includes("error") || content.includes("repair") || content.includes("broken"))) {
    return "system_maintenance";
  }
  if (content.includes("system") || content.includes("component") || content.includes("architect") || content.includes("design")) {
    return "system_design";
  }
  if (content.includes("narrative") || content.includes("story") || content.includes("plot") || content.includes("tension")) {
    return "narrative_control";
  }
  if (content.includes("monitor") || content.includes("watch") || content.includes("anomal")) {
    return "monitoring";
  }
  if (content.includes("agent") || content.includes("mood") || content.includes("stimulus")) {
    return "agent_control";
  }
  if (content.includes("social") || content.includes("relationship")) {
    return "social_dynamics";
  }

  return undefined;
}

/**
 * Find the best spirit to handle a message based on content keywords.
 * Fallback when capability-based routing doesn't match.
 */
function findBestSpiritForMessage(registry: SpiritRegistry, msg: DivineMessage): SpiritState | undefined {
  const content = `${msg.subject} ${msg.content}`.toLowerCase();

  // Route system/architecture messages to The Weaver
  if (content.includes("system") || content.includes("component") || content.includes("architect")) {
    const weaver = registry.byName.get("The Weaver");
    if (weaver) return registry.spirits.get(weaver);
  }

  // Route room/entity population to The Steward
  if (content.includes("room") || content.includes("populate") || content.includes("furnish")) {
    const steward = registry.byName.get("The Steward");
    if (steward) return registry.spirits.get(steward);
  }

  // Route entity materialization to The Crafter
  if (content.includes("entity") || content.includes("create") || content.includes("materialize")) {
    const crafter = registry.byName.get("The Crafter");
    if (crafter) return registry.spirits.get(crafter);
  }

  // Route rule/consistency issues to The Lawgiver or Arbiter
  if (content.includes("rule") || content.includes("consistency") || content.includes("violation")) {
    const lawgiver = registry.byName.get("The Lawgiver");
    if (lawgiver) return registry.spirits.get(lawgiver);
    const arbiter = registry.byName.get("The Arbiter");
    if (arbiter) return registry.spirits.get(arbiter);
  }

  // Route maintenance/error to The Tinker
  if (content.includes("error") || content.includes("repair") || content.includes("maintenance")) {
    const tinker = registry.byName.get("The Tinker");
    if (tinker) return registry.spirits.get(tinker);
  }

  // Route narrative to The Narrator
  if (content.includes("narrative") || content.includes("story") || content.includes("plot")) {
    const narrator = registry.byName.get("The Narrator");
    if (narrator) return registry.spirits.get(narrator);
  }

  // Domain-based fallback
  const domainSpirits = registry.byDomain.get(msg.domain);
  if (domainSpirits && domainSpirits.length > 0) {
    return registry.spirits.get(domainSpirits[0]);
  }

  return undefined;
}

/**
 * Register a callback for GodAI to receive messages
 */
export function setGodAgentCallback(callback: (messages: DivineMessage[]) => Promise<void>): void {
  if (systemState) {
    systemState.godAgentCallback = callback;
  }
}

/**
 * Set global context from GodAgent - this is injected into all spirit prompts
 * Should be called before each spirit tick with updated context
 */
export function setGlobalContext(context: string): void {
  if (systemState) {
    systemState.globalContext = context;
  }
}

/**
 * Get current global context
 */
export function getGlobalContext(): string | undefined {
  return systemState?.globalContext;
}

// =============================================================================
// ACTION BUFFER
// =============================================================================

/**
 * Record an action for spirits to observe
 */
export function recordAction(action: ActionSnapshot): void {
  if (!systemState) return;

  systemState.actionBuffer.push(action);

  // Keep only recent actions
  if (systemState.actionBuffer.length > 100) {
    systemState.actionBuffer = systemState.actionBuffer.slice(-100);
  }
}

/**
 * Record an action from raw parameters
 */
export function recordActionEvent(
  actor: string,
  type: string,
  content: string,
  target?: string
): void {
  recordAction({
    timestamp: Date.now(),
    actor,
    type,
    content,
    target,
  });
}

// =============================================================================
// MAIN TICK FUNCTION
// =============================================================================

/**
 * Run a single tick of the spirit system
 * Should be called from the main simulation loop
 */
export async function tickSpiritSystem(
  world: World,
  entityRegistry: EntityRegistry
): Promise<{
  spiritsProcessed: number;
  messagesForGodAI: DivineMessage[];
  narrativeProse: string[];
}> {
  if (!systemState || !systemState.running) {
    return { spiritsProcessed: 0, messagesForGodAI: [], narrativeProse: [] };
  }

  const now = Date.now();

  // Check if enough time has passed since last tick
  if (now - systemState.lastTick < systemState.tickInterval) {
    // Still deliver pending messages even if we aren't running a full spirit cognition tick.
    const messagesForGodAI = getMessagesForGodAI(systemState.registry);
    if (messagesForGodAI.length > 0) {
      if (systemState.godAgentCallback) {
        await systemState.godAgentCallback(messagesForGodAI);
      } else {
        // No God - route between spirits directly
        routeMessagesWithoutGod(systemState.registry, messagesForGodAI);
      }
    }
    return { spiritsProcessed: 0, messagesForGodAI, narrativeProse: [] };
  }

  systemState.lastTick = now;

  // Find spirits that need to run their observation cycle
  const spiritsToRun = getSpiritsNeedingObservation(systemState.registry);

  if (spiritsToRun.length === 0) {
    // Still collect messages for GodAI or route locally
    const messagesForGodAI = getMessagesForGodAI(systemState.registry);

    if (messagesForGodAI.length > 0) {
      if (systemState.godAgentCallback) {
        await systemState.godAgentCallback(messagesForGodAI);
      } else {
        routeMessagesWithoutGod(systemState.registry, messagesForGodAI);
      }
    }

    return { spiritsProcessed: 0, messagesForGodAI, narrativeProse: [] };
  }

  console.log(`[SpiritSystem] Running ${spiritsToRun.length} spirits...`);

  // Collect narrative prose from spirits
  const narrativeProse: string[] = [];

  // Run cognition for each spirit
  for (const spirit of spiritsToRun) {
    try {
      // The Watcher uses deterministic synthesis, not LLM cognition
      if (spirit.definition.name === "The Watcher") {
        runObservationSynthesis(world, systemState.registry, spirit.eid);
        spirit.lastObservationTime = Date.now();
        continue;
      }

      const output = await runSpiritCognition(
        spirit,
        world,
        entityRegistry,
        systemState.registry,
        systemState.actionBuffer,
        systemState.globalContext  // Pass global context to spirit cognition
      );

      // Collect story prose from narrative spirits
      if (output.storyProse) {
        narrativeProse.push(output.storyProse);
      }
    } catch (error) {
      console.error(`[SpiritSystem] Error running ${spirit.definition.name}:`, error);
    }
  }

  // Collect messages for GodAI or route locally
  const messagesForGodAI = getMessagesForGodAI(systemState.registry);

  // Deliver messages to GodAI, or route between spirits directly
  if (messagesForGodAI.length > 0) {
    if (systemState.godAgentCallback) {
      await systemState.godAgentCallback(messagesForGodAI);
    } else {
      routeMessagesWithoutGod(systemState.registry, messagesForGodAI);
    }
  }

  // Clear processed actions
  systemState.actionBuffer = [];

  return {
    spiritsProcessed: spiritsToRun.length,
    messagesForGodAI,
    narrativeProse,
  };
}

// =============================================================================
// SPIRIT MANAGEMENT
// =============================================================================

/**
 * Create a new spirit from a definition
 */
export function createNewSpirit(
  definition: Parameters<typeof createSpirit>[1],
  superiorEid?: number
): SpiritState | null {
  if (!systemState) {
    console.error("[SpiritSystem] System not initialized");
    return null;
  }

  const spirit = createSpirit(systemState.registry, definition, superiorEid);
  return spirit;
}

/**
 * Get all active spirits
 */
export function getAllSpirits(): SpiritState[] {
  if (!systemState) return [];
  return getActiveSpirits(systemState.registry);
}

/**
 * Get the spirit registry summary
 */
export function getRegistrySummary(): string {
  if (!systemState) return "Spirit system not initialized";
  return getSpiritSummary(systemState.registry);
}

/**
 * Get a detailed summary of a specific spirit
 */
export function getSpiritDetails(spiritEid: number): string {
  if (!systemState) return "Spirit system not initialized";

  const spirit = systemState.registry.spirits.get(spiritEid);
  if (!spirit) return `Spirit ${spiritEid} not found`;

  return getCognitionSummary(spirit);
}

// =============================================================================
// SPIRIT CREATION HELPERS
// =============================================================================

/**
 * Register each spirit's capabilities with the message router
 * so it knows who can handle what types of requests.
 */
function registerSpiritCapabilities(registry: SpiritRegistry): void {
  const capabilityMap: Record<string, { capabilities: SpiritCapability[]; priority: number }> = {
    "The Tinker":   { capabilities: ["system_maintenance"], priority: 10 },
    "The Weaver":   { capabilities: ["system_design"], priority: 10 },
    "The Narrator": { capabilities: ["narrative_control", "social_dynamics"], priority: 10 },
    "The Arbiter":  { capabilities: ["monitoring"], priority: 10 },
    "The Crafter":  { capabilities: ["environment"], priority: 10 },
    "The Steward":  { capabilities: ["agent_control", "environment"], priority: 8 },
    "The Lawgiver": { capabilities: ["system_maintenance", "monitoring"], priority: 5 },
    "The Watcher":  { capabilities: ["monitoring"], priority: 12 },
  };

  for (const [name, config] of Object.entries(capabilityMap)) {
    const eid = registry.byName.get(name);
    if (eid === undefined) continue;
    const spirit = registry.spirits.get(eid);
    if (!spirit) continue;
    for (const cap of config.capabilities) {
      registerSpiritCapability(spirit, cap, config.priority, `${name} handles ${cap}`);
    }
  }

  console.log("[SpiritSystem] Spirit capabilities registered with message router");
}

/**
 * Create the standard spirit hierarchy
 */
export function createStandardHierarchy(godAgentEid: number): void {
  if (!systemState) {
    throw new Error("Spirit system not initialized");
  }

  // Initialize the message router with the registry
  initializeSpiritMessaging(systemState.registry);
  console.log("[SpiritSystem] Message router initialized");

  // Set GodAI
  setGodAgent(systemState.registry, godAgentEid);

  // Create Narrator if not already created
  const existingNarrator = systemState.registry.byName.get("The Narrator");
  if (!existingNarrator) {
    createSpirit(systemState.registry, NarratorDefinition);
    console.log("[SpiritSystem] Narrator spirit created");
  }

  // Create Consistency Spirit (The Arbiter)
  const existingArbiter = systemState.registry.byName.get("The Arbiter");
  if (!existingArbiter) {
    createSpirit(systemState.registry, ConsistencySpiritDefinition);
    console.log("[SpiritSystem] Consistency spirit (The Arbiter) created");
  }

  // Create Artificer Spirit (The Tinker) - maintains and repairs systems
  const existingArtificer = systemState.registry.byName.get("The Tinker");
  if (!existingArtificer) {
    const artificerConfig: CreateSpiritConfig = {
      name: "The Tinker",
      title: "Master Artificer",
      description: "Guardian of system health and maintenance. Monitors all simulation systems, detects errors, and performs repairs to keep the world running smoothly.",
      type: "artificer",
      domain: "guardian",
      rank: "archangel",
      observationInterval: 60000, // Every 60 seconds
      artificerConfig: {
        inspectionInterval: 60000,
        maxErrorsBeforeDisable: 20,
        autoFixEnabled: true,
        ignoreSystems: ["StimulusEmission", "MindDecay"],
      },
    };
    createDynamicSpirit(systemState.registry, artificerConfig);
    console.log("[SpiritSystem] Artificer spirit (The Tinker) created");
  }

  // Create Architect Spirit (The Weaver) - designs new systems
  const existingArchitect = systemState.registry.byName.get("The Weaver");
  if (!existingArchitect) {
    const architectConfig: CreateSpiritConfig = {
      name: "The Weaver",
      title: "Master Architect",
      description: "Creator of new systems and components. Observes simulation needs and proposes new behavioral patterns, entities, and rules to enrich the world.",
      type: "architect",
      domain: "narrative",
      rank: "archangel",
      observationInterval: 120000, // Every 2 minutes
      architectConfig: {
        canProposeSystems: true,
        canProposeComponents: true,
        canProposeEntities: true,
        canProposeRules: false, // Require approval for rules
        canExecuteDirectly: true, // Spirits are autonomous - execute without God approval
        proposalApproval: "auto",
        maxProposalsPerCycle: 3,
      },
    };
    createDynamicSpirit(systemState.registry, architectConfig);
    console.log("[SpiritSystem] Architect spirit (The Weaver) created");
  }

  // Create The Crafter spirit (World Materializer)
  const existingCrafter = systemState.registry.byName.get("The Crafter");
  if (!existingCrafter) {
    createWorldCrafterSpirit(systemState.registry);
    console.log("[SpiritSystem] World Crafter spirit (The Crafter) created");
  }

  // Create The Steward spirit (Room Population & Maintenance)
  const existingSteward = systemState.registry.byName.get("The Steward");
  if (!existingSteward) {
    createStewardSpirit(systemState.registry);
    console.log("[SpiritSystem] Steward spirit (The Steward) created");
  }

  // Create The Lawgiver spirit (Deterministic Rules)
  const existingLawgiver = systemState.registry.byName.get("The Lawgiver");
  if (!existingLawgiver) {
    createLawgiverSpirit(systemState.registry);
    console.log("[SpiritSystem] Lawgiver spirit (The Lawgiver) created");
  }

  // Create The Watcher spirit (Observation Synthesis & Prioritization)
  const existingWatcher = systemState.registry.byName.get("The Watcher");
  if (!existingWatcher) {
    createWatcherSpirit(systemState.registry);
    console.log("[SpiritSystem] Watcher spirit (The Watcher) created");
  }

  // Future: Add other archangels here
  // - Sociologist (social domain)
  // - Economist (economy domain)

  // Register capabilities so the message router knows who handles what
  registerSpiritCapabilities(systemState.registry);

  console.log("[SpiritSystem] Standard hierarchy created:");
  console.log(getRegistrySummary());
}

// =============================================================================
// DEBUGGING
// =============================================================================

/**
 * Get debug info about the spirit system
 */
export function getSpiritSystemDebugInfo(): object {
  if (!systemState) {
    return { status: "not_initialized" };
  }

  return {
    status: systemState.running ? "running" : "stopped",
    tickInterval: systemState.tickInterval,
    lastTick: systemState.lastTick,
    timeSinceLastTick: Date.now() - systemState.lastTick,
    actionBufferSize: systemState.actionBuffer.length,
    spiritCount: systemState.registry.spirits.size,
    messageQueueSize: systemState.registry.messageQueue.length,
    hasGodAgent: systemState.registry.godAgentEid !== undefined,
    spirits: Array.from(systemState.registry.spirits.values()).map(s => ({
      name: s.definition.name,
      domain: s.definition.domain,
      rank: s.definition.rank,
      lastObservation: s.lastObservationTime,
      observationsCount: s.observations.length,
      inboxSize: s.inbox.length,
      pendingDirectives: s.pendingDirectives.length,
    })),
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  createSpirit,
  getSpiritsNeedingObservation,
  getActiveSpirits,
  type SpiritRegistry,
  type SpiritState,
  type DivineMessage,
};
