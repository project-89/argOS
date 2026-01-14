/**
 * Agent Daemon System
 *
 * Personal guardian spirits for individual agents. Each daemon:
 * - Watches their assigned agent's state and behavior
 * - Whispers guidance via cognitive stimuli
 * - Reports to higher spirits about agent struggles/achievements
 * - Helps prevent agents from getting stuck
 * - Maintains personality consistency
 *
 * Daemons are lightweight observers using the flash model for efficiency.
 */

import { generateText } from "ai";
import { query, entityExists, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Name, Description, Agent, Mind, Goal, GridPosition, Health, Inventory } from "../ecs/components";
import { OccupiesRoom, HasGoal, HasMemory, HasThought } from "../ecs/relations";
import { safeGetRelationTargets } from "../ecs/dynamic-systems";
import { queueStimulus } from "../cognition/cognition-system";
import { daemonModel, THINKING_LEVELS } from "../llm/config";
import type { SpiritRegistry } from "./spirit-registry";
import { sendMessage, reportToSuperior } from "./spirit-registry";
import { recordEvent } from "./consistency-spirit";
import type { NarrativeVision } from "../god/god-agent";
import {
  registerSpiritCapability,
  spiritEmit,
  type SpiritCapability,
  type SpiritMessage,
} from "./spirit-messaging";

// =============================================================================
// DYNAMIC WHISPER GENERATION
// =============================================================================

/**
 * Contextual whisper variations for different concern types.
 * Each array provides variety; a random one is selected each time.
 */
const WHISPER_VARIATIONS = {
  stuck: [
    "The world is vast. Perhaps a new corner awaits your attention?",
    "Stillness has its place, but so does motion. What draws your curiosity?",
    "Have you noticed what's happening around you? Others move with purpose.",
    "Sometimes a change of scenery reveals new possibilities.",
    "The mind stagnates in repetition. What if you tried something unexpected?",
    "Your feet know the way, even when your mind wanders. Perhaps let them lead?",
    "There's more to discover beyond this moment. What haven't you explored?",
    "A restless feeling stirs within you. Where might it lead?",
  ],
  low_arousal: [
    "A sound catches the edge of your attention...",
    "Something shifts in your peripheral vision.",
    "The air seems to carry a faint whisper of change.",
    "Your thoughts drift to someone you haven't spoken with recently.",
    "A distant noise piques your curiosity.",
    "There's an itch at the back of your mind, urging you forward.",
    "The world continues its dance. Do you hear its rhythm?",
    "Others seem engaged in something. What might it be?",
  ],
  high_arousal: [
    "Breathe. Let the moment settle before acting.",
    "The world can wait for your thoughts to collect.",
    "Haste invites mistakes. Consider your options carefully.",
    "Your heart races, but your mind need not follow blindly.",
    "Step back from the chaos. What truly matters here?",
    "Even storms pass. Find the still center within.",
    "Not everything demands immediate response. Choose wisely.",
    "Overwhelm clouds judgment. Seek clarity first.",
  ],
  danger: [
    "Your wounds demand attention. Safety should come first.",
    "The body speaks louder than pride. Rest is not retreat.",
    "You are more valuable alive than injured. Seek shelter.",
    "Even the brave know when to withdraw and recover.",
    "Pain is a messenger. What does it tell you to do?",
    "There is no shame in preserving oneself for another day.",
    "Tend to your wounds before the world takes more from you.",
    "Life is precious. Do not spend it carelessly.",
  ],
  goal_drift: [
    "Purpose gives strength. What do you wish to achieve?",
    "The aimless wander; the purposeful arrive. Which will you be?",
    "Others pursue their goals with fervor. What drives you?",
    "A mind without direction is like a ship without wind.",
    "Consider: what would make this day meaningful?",
    "Goals are stars by which we navigate. Find yours.",
    "Even small intentions can grow into great achievements.",
    "The question is not what you can do, but what you will do.",
  ],
  isolation: [
    "The presence of others enriches the soul. Seek company.",
    "Solitude has its place, but so does fellowship.",
    "Someone nearby might welcome a friendly word.",
    "Connection makes the journey lighter. Who might you speak with?",
  ],
  confusion: [
    "Clarity comes to those who seek it. Take time to understand.",
    "The fog of confusion lifts with patience and attention.",
    "When lost, any direction brings new information.",
    "Uncertainty is the beginning of discovery.",
  ],
};

/**
 * Contextual challenge variations for growth opportunities.
 */
const CHALLENGE_VARIATIONS = {
  too_comfortable: [
    "Comfort breeds complacency. Introduce a mild inconvenience.",
    "Shake the routine. Present an unexpected request.",
    "The unchallenged mind dulls. Create a small obstacle.",
    "Growth requires friction. Add a gentle complication.",
  ],
  ready_for_challenge: [
    "This one is ready. Present a worthy obstacle.",
    "Strength unused is strength wasted. Test their limits.",
    "The time for challenge has come. What will test them?",
    "They have prepared themselves. Now let them prove it.",
  ],
  stagnating: [
    "Stagnation is slow death. Disrupt the pattern.",
    "Force a choice. Present competing priorities.",
    "The rut deepens daily. Something must change.",
    "Introduce an element they cannot ignore.",
  ],
  needs_conflict: [
    "Harmony without conflict breeds weakness. Create tension.",
    "A clash of wills sharpens both parties.",
    "Disagreement reveals true character. Present one.",
    "Not all peace is healthy. Some conflicts are necessary.",
  ],
  breakthrough_possible: [
    "The moment crystallizes. Push them toward insight.",
    "Greatness hovers just beyond reach. Provide the catalyst.",
    "They stand at a threshold. Help them step through.",
    "This energy can transform. Direct it wisely.",
  ],
  skill_plateau: [
    "Mastery requires new challenges. Raise the bar.",
    "Competence can become a prison. Break the pattern.",
    "They've learned what they can here. Time for harder lessons.",
    "Introduce a mentor, rival, or technique to stretch them.",
  ],
  relationship_test: [
    "Bonds untested are bonds unproven. Create a challenge.",
    "Loyalty, jealousy, or passion—which will you test?",
    "Relationships grow through adversity. Provide it.",
    "The easy friendship may hide shallow roots. Probe deeper.",
  ],
};

/**
 * Get a contextual whisper for a concern type
 */
function getContextualWhisper(
  type: DaemonConcern["type"],
  agentName: string,
  context?: { focus?: string; room?: string; stuckTicks?: number }
): string {
  const variations = WHISPER_VARIATIONS[type] || WHISPER_VARIATIONS.stuck;
  let whisper = variations[Math.floor(Math.random() * variations.length)];

  // Add contextual flavor for specific situations
  if (context?.room && Math.random() < 0.3) {
    whisper += ` Perhaps ${context.room} holds answers.`;
  }

  return whisper;
}

/**
 * Get a contextual challenge for a growth opportunity type
 */
function getContextualChallenge(
  type: GrowthOpportunity["type"],
  agentName: string
): string {
  const variations = CHALLENGE_VARIATIONS[type] || CHALLENGE_VARIATIONS.ready_for_challenge;
  return variations[Math.floor(Math.random() * variations.length)];
}

// =============================================================================
// DAEMON STATE
// =============================================================================

export interface DaemonState {
  daemonEid: number;
  agentEid: number;
  agentName: string;
  lastObservation: number;
  observationCount: number;
  whisperCount: number;
  reportCount: number;
  lastAgentState: AgentStateSnapshot | null;
  concernLevel: number;  // 0-1, how worried the daemon is about the agent
  lastWhisper: number;
  lastReport: number;
  active: boolean;

  // Narrative constraints from GodAI
  narrativeConstraints?: {
    maxDramaLevel: number;       // 0-1, caps how dramatic daemon can make things
    allowConflict: boolean;      // Can this character escalate conflicts?
    allowRomance: boolean;       // Can this character pursue romance?
    preferredMood: string;       // Target mood for this character
    isFocusCharacter: boolean;   // Is narrator watching this character?
  };

  // Pending nudges from Narrator/GodAI
  pendingNudges: NarrativeNudge[];

  // Growth tracking
  growthMetrics: {
    lastGoalChange: number;      // When did they last change goals?
    lastBeliefChange: number;    // When did they last update beliefs?
    lastRelationshipChange: number; // When did relationships last shift?
    stagnationScore: number;     // 0-1, how stagnant is this character?
  };

  // ========================================
  // MINI-NARRATOR CAPABILITIES
  // ========================================

  // Comprehensive memory system - tracks thoughts, memories, plans
  memory: DaemonMemory;

  // Personal narrative arc - the daemon's view of their NPC's story
  narrativeArc: DaemonNarrativeArc;

  // Arc cognition - last time we thought about the arc
  lastArcCognition: number;
  arcCognitionInterval: number;  // ms between arc reflections
}

export interface NarrativeNudge {
  id: string;
  type: "arrive" | "interact" | "resolve" | "escalate" | "reflect" | "change_goal";
  action: string;               // What the character should do
  reason: string;               // Why (for daemon context)
  source: "narrator" | "god" | "player";
  timestamp: number;
  priority: "low" | "normal" | "high";
}

// =============================================================================
// DAEMON MEMORY (Solid tracking of NPC's thoughts, memories, plans)
// =============================================================================

/**
 * Comprehensive memory system for daemon to track their NPC
 * This is the "mini-narrator" memory - tracking the character's story
 */
export interface DaemonMemory {
  // Recent thoughts - summary of what the NPC has been thinking about
  recentThoughts: ThoughtSummary[];

  // Key memories - important events, discoveries, decisions
  keyMemories: MemoryEntry[];

  // Current plans - what the NPC intends to do
  activePlans: PlanEntry[];

  // Relationship evolution - how relationships have changed
  relationshipHistory: RelationshipChange[];

  // Character development moments - growth, setbacks, revelations
  characterMoments: CharacterMoment[];

  // Last pruning timestamp (to keep memory manageable)
  lastPruning: number;
}

export interface ThoughtSummary {
  id: string;
  timestamp: number;
  focus: string;           // What they're thinking about
  content: string;         // Summary of the thought
  emotionalTone: string;   // Mood/emotion during thought
  significance: number;    // 0-1, how important
}

export interface MemoryEntry {
  id: string;
  timestamp: number;
  type: "event" | "discovery" | "decision" | "dialogue" | "setback" | "victory";
  content: string;
  participants: string[];  // Other characters involved
  location?: string;
  emotionalImpact: number; // -1 to 1 (negative to positive)
  narrativeWeight: number; // 0-1, how important to their story
  resolved: boolean;       // Has this been addressed/resolved?
}

export interface PlanEntry {
  id: string;
  timestamp: number;
  goal: string;            // What they want to achieve
  steps: string[];         // How they plan to do it
  status: "planned" | "active" | "blocked" | "completed" | "abandoned";
  blockedReason?: string;  // Why it's stuck
  priority: number;        // 0-1
}

export interface RelationshipChange {
  id: string;
  timestamp: number;
  otherCharacter: string;
  previousState: string;   // "stranger" | "acquaintance" | "friend" | "rival" | etc
  newState: string;
  cause: string;           // What caused the change
  significance: number;
}

export interface CharacterMoment {
  id: string;
  timestamp: number;
  type: "growth" | "setback" | "revelation" | "choice" | "transformation" | "conflict";
  description: string;
  beforeState: string;     // How they were before
  afterState: string;      // How they are now
  catalyst: string;        // What triggered this moment
}

// =============================================================================
// DAEMON NARRATIVE ARC (Mini-narrator tracking of NPC's personal story)
// =============================================================================

/**
 * Personal narrative arc tracking - each daemon is a mini-narrator for their NPC
 */
export interface DaemonNarrativeArc {
  // Current arc theme
  theme: string;                  // e.g., "redemption", "discovery", "revenge", "love"

  // Arc status
  status: "dormant" | "setup" | "rising" | "crisis" | "climax" | "falling" | "resolution";

  // Personal goal driving the arc
  drivingGoal: string;            // e.g., "Find who took the plow"

  // Current tension in their personal story
  tension: number;                // 0-1

  // Desired resolution
  desiredResolution: string;      // How the daemon wants this arc to resolve

  // Stakes - what they could lose/gain
  stakes: {
    toGain: string;
    toLose: string;
  };

  // Key beats in this arc
  completedBeats: string[];       // What's happened
  upcomingBeats: string[];        // What should happen next

  // Stagnation tracking
  ticksSinceProgress: number;     // How long since arc moved forward
  lastProgressTimestamp: number;
  stagnationThreshold: number;    // Ticks before self-resolution kicks in

  // Self-resolution
  needsSelfResolution: boolean;   // Is this arc stuck and needs daemon intervention?
  selfResolutionAttempts: number; // How many times we've tried to unstick it

  // Arc history
  previousArcs: CompletedArc[];
}

export interface CompletedArc {
  id: string;
  theme: string;
  startTime: number;
  endTime: number;
  resolution: "success" | "failure" | "abandoned" | "transformed";
  summary: string;
  keyMoments: string[];
}

export interface AgentStateSnapshot {
  timestamp: number;
  position?: { x: number; y: number };
  room?: string;
  arousal: number;
  focus: string;
  mode: string;
  active: boolean;
  health?: number;
  goalCount: number;
  thoughtCount: number;
  lastAction?: string;
  stuckTicks: number;  // How many ticks with no meaningful change
}

export interface DaemonObservation {
  agentName: string;
  currentState: AgentStateSnapshot;
  previousState: AgentStateSnapshot | null;
  concerns: DaemonConcern[];
  growthOpportunities: GrowthOpportunity[];
  achievements: string[];
  timestamp: number;
}

export interface DaemonConcern {
  type: "stuck" | "goal_drift" | "low_arousal" | "high_arousal" | "isolation" | "danger" | "confusion";
  severity: "low" | "medium" | "high";
  description: string;
  suggestedWhisper?: string;
}

/**
 * Growth opportunities - when the daemon sees potential for challenge/development
 */
export interface GrowthOpportunity {
  type: "too_comfortable" | "ready_for_challenge" | "stagnating" | "needs_conflict" | "breakthrough_possible" | "skill_plateau" | "relationship_test";
  description: string;
  suggestedChallenge: string;
  urgency: "low" | "medium" | "high";
}

/**
 * Challenge whispers - provocations to push growth
 */
export interface ChallengeWhisper {
  agentEid: number;
  content: string;
  challengeType: "provocation" | "doubt" | "ambition" | "curiosity" | "restlessness";
  timestamp: number;
}

export interface DaemonWhisper {
  agentEid: number;
  content: string;
  type: "guidance" | "reminder" | "warning" | "encouragement" | "observation";
  timestamp: number;
}

export interface DaemonReport {
  daemonEid: number;
  agentName: string;
  reportType: "status" | "concern" | "achievement" | "intervention_needed" | "growth_opportunity";
  content: string;
  concerns: DaemonConcern[];
  growthOpportunities: GrowthOpportunity[];  // For GodAI/Arbiter to create challenges
  priority: "low" | "normal" | "high";
  timestamp: number;
}

// =============================================================================
// DAEMON REGISTRY
// =============================================================================

export interface DaemonRegistry {
  daemons: Map<number, DaemonState>;  // agentEid -> daemonState
  observationInterval: number;
  whisperCooldown: number;
  challengeCooldown: number;          // Longer cooldown for challenge whispers
  reportCooldown: number;
  superiorSpiritEid?: number;  // Usually ConsistencySpirit or GodAI
  simulationTension: number;          // 0-1, set by Narrator/GodAI for tension awareness
}

/**
 * Create a daemon registry
 */
export function createDaemonRegistry(
  observationInterval: number = 10000,  // 10 seconds
  whisperCooldown: number = 30000,      // 30 seconds between guidance whispers
  challengeCooldown: number = 120000,   // 2 minutes between challenge whispers (was 60s)
  reportCooldown: number = 60000        // 60 seconds between reports
): DaemonRegistry {
  return {
    daemons: new Map(),
    observationInterval,
    whisperCooldown,
    challengeCooldown,
    reportCooldown,
    simulationTension: 0.3,  // Default tension - can be updated by Narrator
  };
}

/**
 * Update simulation tension - called by Narrator/GodAI to let daemons know the current state
 */
export function setSimulationTension(registry: DaemonRegistry, tension: number): void {
  registry.simulationTension = Math.max(0, Math.min(1, tension));
}

/**
 * Set the superior spirit that daemons report to
 */
export function setDaemonSuperior(registry: DaemonRegistry, spiritEid: number): void {
  registry.superiorSpiritEid = spiritEid;
}

// =============================================================================
// MEMORY & ARC INITIALIZATION
// =============================================================================

/**
 * Create empty daemon memory
 */
export function createEmptyDaemonMemory(): DaemonMemory {
  return {
    recentThoughts: [],
    keyMemories: [],
    activePlans: [],
    relationshipHistory: [],
    characterMoments: [],
    lastPruning: Date.now(),
  };
}

/**
 * Create empty daemon narrative arc
 */
export function createEmptyDaemonArc(agentName: string): DaemonNarrativeArc {
  return {
    theme: "daily life",
    status: "dormant",
    drivingGoal: "",
    tension: 0.2,
    desiredResolution: "",
    stakes: {
      toGain: "",
      toLose: "",
    },
    completedBeats: [],
    upcomingBeats: [],
    ticksSinceProgress: 0,
    lastProgressTimestamp: Date.now(),
    stagnationThreshold: 10,  // 10 ticks without progress = stagnation
    needsSelfResolution: false,
    selfResolutionAttempts: 0,
    previousArcs: [],
  };
}

// =============================================================================
// DAEMON LIFECYCLE
// =============================================================================

let daemonIdCounter = 0;

/**
 * Create a daemon for an agent
 */
export function createDaemonForAgent(
  registry: DaemonRegistry,
  world: World,
  agentEid: number
): DaemonState | null {
  if (!entityExists(world, agentEid)) return null;
  if (registry.daemons.has(agentEid)) return registry.daemons.get(agentEid)!;

  const agentName = Name.value[agentEid] || `Agent_${agentEid}`;
  const now = Date.now();

  const daemon: DaemonState = {
    daemonEid: ++daemonIdCounter + 10000,  // Offset to not conflict with ECS entities
    agentEid,
    agentName,
    lastObservation: 0,
    observationCount: 0,
    whisperCount: 0,
    reportCount: 0,
    lastAgentState: null,
    concernLevel: 0,
    lastWhisper: 0,
    lastReport: 0,
    active: true,
    // Initialize narrative constraints (will be set by GodAI)
    narrativeConstraints: {
      maxDramaLevel: 0.5,
      allowConflict: true,
      allowRomance: true,
      preferredMood: "neutral",
      isFocusCharacter: false,
    },
    // Initialize empty nudge queue
    pendingNudges: [],
    // Initialize growth tracking
    growthMetrics: {
      lastGoalChange: now,
      lastBeliefChange: now,
      lastRelationshipChange: now,
      stagnationScore: 0,
    },
    // Initialize memory system (mini-narrator)
    memory: createEmptyDaemonMemory(),
    // Initialize narrative arc (mini-narrator)
    narrativeArc: createEmptyDaemonArc(agentName),
    // Arc cognition timing
    lastArcCognition: 0,
    arcCognitionInterval: 60000,  // Think about arc every minute
  };

  registry.daemons.set(agentEid, daemon);

  // Register capabilities for this daemon in spirit messaging system
  // This allows narrator/GodAI to route messages to specific character daemons
  registerDaemonCapabilities(registry, daemon);

  console.log(`[Daemon] Created guardian daemon for ${agentName}`);

  return daemon;
}

/**
 * Register daemon capabilities in the spirit messaging system
 * Allows Narrator/GodAI to route nudges to specific character daemons
 */
function registerDaemonCapabilities(registry: DaemonRegistry, daemon: DaemonState): void {
  // Create a minimal spirit state for capability registration
  const daemonSpiritState = {
    eid: daemon.daemonEid,
    definition: {
      name: `Daemon_${daemon.agentName}`,
      domain: "guardian" as const,
      rank: "daemon" as const,
      description: `Guardian daemon for ${daemon.agentName}`,
      watchConfig: { componentQueries: [], eventTypes: [], watchEntities: [daemon.agentName] },
      canInjectEvents: true,
      canModifyMood: true,
      canCreateEntities: false,
      canBakeSystems: false,
      model: "flash" as const,
      systemPrompt: "",
      observationInterval: 10000,
    },
    superiorEid: registry.superiorSpiritEid,
    subordinateEids: [],
    observations: [],
    lastObservationTime: 0,
    inbox: [],
    outbox: [],
    pendingDirectives: [],
    shortTermMemory: [],
    significantEvents: [],
  };

  // Register capabilities:
  // 1. "agent_control" - generic capability for controlling any agent
  // 2. "character_{name}" - specific capability for this character
  try {
    registerSpiritCapability(
      daemonSpiritState as any,  // Type cast since we're using minimal state
      "agent_control",
      1,  // Priority
      `Can control agent: ${daemon.agentName}`
    );

    // Register character-specific capability
    const characterCapability = `character_${daemon.agentName.toLowerCase().replace(/\s+/g, "_")}` as SpiritCapability;
    registerSpiritCapability(
      daemonSpiritState as any,
      characterCapability,
      10,  // Higher priority for specific character routing
      `Exclusive guardian for ${daemon.agentName}`
    );

    console.log(`[Daemon] Registered capabilities for ${daemon.agentName}: agent_control, ${characterCapability}`);
  } catch (error) {
    // Spirit messaging not initialized yet - that's ok, will register later
    console.log(`[Daemon] Capability registration deferred for ${daemon.agentName}`);
  }
}

/**
 * Create daemons for all agents in the world
 * Staggers initial observation times to prevent all daemons from triggering at once
 */
export function createDaemonsForAllAgents(registry: DaemonRegistry, world: World): number {
  const agents = Array.from(query(world, [Agent]));
  let created = 0;
  const now = Date.now();
  const staggerInterval = registry.observationInterval / Math.max(1, agents.length);

  for (let i = 0; i < agents.length; i++) {
    const agentEid = agents[i];
    if (!registry.daemons.has(agentEid)) {
      const daemon = createDaemonForAgent(registry, world, agentEid);
      if (daemon) {
        // Stagger initial observation times so only a few trigger each cycle
        daemon.lastObservation = now - (i * staggerInterval);
        created++;
      }
    }
  }

  return created;
}

/**
 * Remove a daemon
 */
export function removeDaemon(registry: DaemonRegistry, agentEid: number): void {
  const daemon = registry.daemons.get(agentEid);
  if (daemon) {
    console.log(`[Daemon] Removed guardian daemon for ${daemon.agentName}`);
    registry.daemons.delete(agentEid);
  }
}

/**
 * Get daemons that need to run observation
 */
export function getDaemonsNeedingObservation(registry: DaemonRegistry): DaemonState[] {
  const now = Date.now();
  return Array.from(registry.daemons.values()).filter(d =>
    d.active && (now - d.lastObservation >= registry.observationInterval)
  );
}

// =============================================================================
// NARRATIVE NUDGE HANDLING
// =============================================================================

/**
 * Queue a narrative nudge for a character daemon
 * Called by Narrator/GodAI to push characters in specific directions
 */
export function queueNarrativeNudge(
  registry: DaemonRegistry,
  agentName: string,
  nudge: Omit<NarrativeNudge, "id" | "timestamp">
): boolean {
  // Find daemon by agent name
  const daemon = Array.from(registry.daemons.values())
    .find(d => d.agentName.toLowerCase() === agentName.toLowerCase());

  if (!daemon) {
    console.warn(`[Daemon] Cannot nudge ${agentName}: no daemon found`);
    return false;
  }

  const fullNudge: NarrativeNudge = {
    ...nudge,
    id: `nudge_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    timestamp: Date.now(),
  };

  daemon.pendingNudges.push(fullNudge);
  console.log(`[Daemon] Queued nudge for ${agentName}: ${nudge.type} - ${nudge.action}`);

  return true;
}

/**
 * Process pending nudges for a daemon - converts them to whispers/stimuli
 */
export function processPendingNudges(
  daemon: DaemonState,
  world: World
): DaemonWhisper[] {
  const whispers: DaemonWhisper[] = [];

  // Sort by priority (high first)
  const sortedNudges = [...daemon.pendingNudges].sort((a, b) => {
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  // Process up to 2 nudges per cycle
  const toProcess = sortedNudges.slice(0, 2);

  for (const nudge of toProcess) {
    // Check if nudge respects narrative constraints
    if (!shouldApplyNudge(daemon, nudge)) {
      console.log(`[Daemon] Skipping nudge for ${daemon.agentName} - blocked by constraints`);
      continue;
    }

    // Convert nudge to whisper based on type
    const whisper = convertNudgeToWhisper(daemon, nudge);
    if (whisper) {
      whispers.push(whisper);
    }

    // Remove processed nudge
    const idx = daemon.pendingNudges.findIndex(n => n.id === nudge.id);
    if (idx !== -1) {
      daemon.pendingNudges.splice(idx, 1);
    }
  }

  return whispers;
}

/**
 * Check if a nudge should be applied based on narrative constraints
 */
function shouldApplyNudge(daemon: DaemonState, nudge: NarrativeNudge): boolean {
  const constraints = daemon.narrativeConstraints;
  if (!constraints) return true;

  // Check drama level
  if (nudge.type === "escalate" && constraints.maxDramaLevel < 0.5) {
    return false;
  }

  // Check conflict allowance
  if (nudge.type === "escalate" && !constraints.allowConflict) {
    return false;
  }

  // High priority nudges from GodAI always go through
  if (nudge.source === "god" && nudge.priority === "high") {
    return true;
  }

  return true;
}

/**
 * Convert a narrative nudge to a daemon whisper
 */
function convertNudgeToWhisper(daemon: DaemonState, nudge: NarrativeNudge): DaemonWhisper | null {
  let content: string;
  let type: DaemonWhisper["type"] = "guidance";

  switch (nudge.type) {
    case "arrive":
      content = `You've been traveling long enough. It's time to arrive and see what awaits you. ${nudge.action}`;
      type = "guidance";
      break;
    case "interact":
      content = `Someone nearby deserves your attention. ${nudge.action}`;
      type = "encouragement";
      break;
    case "resolve":
      content = `This situation has gone on long enough. Perhaps it's time to bring it to a close. ${nudge.action}`;
      type = "guidance";
      break;
    case "escalate":
      content = `Something stirs within you - a feeling that this moment matters. ${nudge.action}`;
      type = "observation";
      break;
    case "reflect":
      content = `Take a moment to consider what has happened. What does it mean? ${nudge.action}`;
      type = "reminder";
      break;
    case "change_goal":
      content = `Your priorities are shifting. Something new calls to you. ${nudge.action}`;
      type = "guidance";
      break;
    default:
      content = nudge.action;
  }

  return {
    agentEid: daemon.agentEid,
    content,
    type,
    timestamp: Date.now(),
  };
}

// =============================================================================
// NARRATIVE CONSTRAINT UPDATES
// =============================================================================

/**
 * Update narrative constraints for a specific daemon
 * Called when GodAI changes NarrativeVision
 */
export function updateDaemonConstraints(
  registry: DaemonRegistry,
  agentName: string,
  constraints: Partial<DaemonState["narrativeConstraints"]>
): boolean {
  const daemon = Array.from(registry.daemons.values())
    .find(d => d.agentName.toLowerCase() === agentName.toLowerCase());

  if (!daemon) return false;

  daemon.narrativeConstraints = {
    ...daemon.narrativeConstraints!,
    ...constraints,
  };

  console.log(`[Daemon] Updated constraints for ${agentName}:`, constraints);
  return true;
}

/**
 * Update all daemons with new narrative vision constraints from GodAI
 */
export function broadcastNarrativeVision(
  registry: DaemonRegistry,
  vision: NarrativeVision
): void {
  const baseConstraints = {
    maxDramaLevel: vision.moodConstraints.maxDramaLevel,
    allowConflict: vision.moodConstraints.allowConflict,
    allowRomance: vision.moodConstraints.allowRomance,
    preferredMood: vision.moodConstraints.preferredMood,
  };

  for (const daemon of registry.daemons.values()) {
    // Check if this daemon's agent is a focus character
    const isFocus = vision.focusCharacters.some(
      name => name.toLowerCase() === daemon.agentName.toLowerCase()
    );

    daemon.narrativeConstraints = {
      ...baseConstraints,
      isFocusCharacter: isFocus,
    };
  }

  console.log(`[Daemon] Broadcast narrative vision to ${registry.daemons.size} daemons (${vision.focusCharacters.length} focus characters)`);
}

/**
 * Get daemon by agent name
 */
export function getDaemonByAgentName(
  registry: DaemonRegistry,
  agentName: string
): DaemonState | undefined {
  return Array.from(registry.daemons.values())
    .find(d => d.agentName.toLowerCase() === agentName.toLowerCase());
}

// =============================================================================
// AGENT STATE COLLECTION
// =============================================================================

/**
 * Collect current state snapshot of an agent
 */
export function collectAgentState(world: World, agentEid: number): AgentStateSnapshot | null {
  if (!entityExists(world, agentEid)) return null;

  const rooms = safeGetRelationTargets(world, agentEid, OccupiesRoom);
  const roomName = rooms.length > 0 ? Name.value[rooms[0]] : undefined;

  const goals = safeGetRelationTargets(world, agentEid, HasGoal);
  const thoughts = safeGetRelationTargets(world, agentEid, HasThought);

  return {
    timestamp: Date.now(),
    position: GridPosition.x[agentEid] !== undefined ? {
      x: GridPosition.x[agentEid],
      y: GridPosition.y[agentEid],
    } : undefined,
    room: roomName,
    arousal: Mind.arousal[agentEid] ?? 0.5,
    focus: Mind.focus[agentEid] || "",
    mode: Mind.mode[agentEid] || "reactive",
    active: Agent.active[agentEid] ?? true,
    health: Health.current[agentEid],
    goalCount: goals.length,
    thoughtCount: thoughts.length,
    stuckTicks: 0,
  };
}

/**
 * Detect concerns by comparing current and previous state
 */
export function detectConcerns(
  current: AgentStateSnapshot,
  previous: AgentStateSnapshot | null,
  agentName: string
): DaemonConcern[] {
  const concerns: DaemonConcern[] = [];
  const context = { focus: current.focus, room: current.room, stuckTicks: previous?.stuckTicks };

  // Check for stuck agent (no position change over multiple observations)
  if (previous) {
    const samePosition = current.position && previous.position &&
      current.position.x === previous.position.x &&
      current.position.y === previous.position.y;
    const sameFocus = current.focus === previous.focus;
    const sameRoom = current.room === previous.room;

    if (samePosition && sameFocus && sameRoom && previous.stuckTicks > 2) {
      concerns.push({
        type: "stuck",
        severity: previous.stuckTicks > 5 ? "high" : "medium",
        description: `${agentName} hasn't moved or changed focus for ${previous.stuckTicks} observations`,
        suggestedWhisper: getContextualWhisper("stuck", agentName, context),
      });
    }
  }

  // Check for low arousal (disengaged)
  if (current.arousal < 0.2) {
    concerns.push({
      type: "low_arousal",
      severity: "low",
      description: `${agentName} seems disengaged (arousal: ${current.arousal.toFixed(2)})`,
      suggestedWhisper: getContextualWhisper("low_arousal", agentName, context),
    });
  }

  // Check for high arousal (overwhelmed)
  if (current.arousal > 0.9) {
    concerns.push({
      type: "high_arousal",
      severity: "medium",
      description: `${agentName} seems overwhelmed (arousal: ${current.arousal.toFixed(2)})`,
      suggestedWhisper: getContextualWhisper("high_arousal", agentName, context),
    });
  }

  // Check for danger (low health)
  if (current.health !== undefined && current.health < 30) {
    concerns.push({
      type: "danger",
      severity: current.health < 10 ? "high" : "medium",
      description: `${agentName} is injured (health: ${current.health})`,
      suggestedWhisper: getContextualWhisper("danger", agentName, context),
    });
  }

  // Check for no goals
  if (current.goalCount === 0) {
    concerns.push({
      type: "goal_drift",
      severity: "low",
      description: `${agentName} has no active goals`,
      suggestedWhisper: getContextualWhisper("goal_drift", agentName, context),
    });
  }

  // Check for inactive agent
  if (!current.active) {
    concerns.push({
      type: "confusion",
      severity: "high",
      description: `${agentName} has become inactive`,
      suggestedWhisper: getContextualWhisper("confusion", agentName, context),
    });
  }

  return concerns;
}

// =============================================================================
// GROWTH OPPORTUNITY DETECTION
// =============================================================================

/**
 * Update growth metrics for a daemon based on observed changes
 */
export function updateGrowthMetrics(
  daemon: DaemonState,
  current: AgentStateSnapshot,
  previous: AgentStateSnapshot | null
): void {
  const now = Date.now();
  const metrics = daemon.growthMetrics;

  if (!previous) return;

  // Check for goal changes
  if (current.goalCount !== previous.goalCount) {
    metrics.lastGoalChange = now;
  }

  // Check for focus changes (proxy for belief/thought changes)
  if (current.focus !== previous.focus && current.focus !== "") {
    metrics.lastBeliefChange = now;
  }

  // Check for room changes (proxy for relationship opportunities)
  if (current.room !== previous.room) {
    metrics.lastRelationshipChange = now;
  }

  // Calculate stagnation score based on time since changes
  const hourInMs = 60 * 60 * 1000;
  const goalStagnation = Math.min(1, (now - metrics.lastGoalChange) / (5 * hourInMs));
  const beliefStagnation = Math.min(1, (now - metrics.lastBeliefChange) / (3 * hourInMs));
  const relationshipStagnation = Math.min(1, (now - metrics.lastRelationshipChange) / (10 * hourInMs));

  // Weighted average - goals matter most, then beliefs, then relationships
  metrics.stagnationScore = (goalStagnation * 0.5) + (beliefStagnation * 0.3) + (relationshipStagnation * 0.2);
}

/**
 * Get characters that need growth attention (high stagnation)
 */
export function getStagnatingCharacters(registry: DaemonRegistry, threshold: number = 0.6): DaemonState[] {
  return Array.from(registry.daemons.values())
    .filter(d => d.active && d.growthMetrics.stagnationScore > threshold)
    .sort((a, b) => b.growthMetrics.stagnationScore - a.growthMetrics.stagnationScore);
}

/**
 * Generate growth prompt for stagnating character
 * Used by narrator/GodAI to understand what a character needs
 */
export function generateGrowthSuggestion(daemon: DaemonState): string {
  const metrics = daemon.growthMetrics;
  const suggestions: string[] = [];

  const hoursSinceGoal = (Date.now() - metrics.lastGoalChange) / (60 * 60 * 1000);
  const hoursSinceBelief = (Date.now() - metrics.lastBeliefChange) / (60 * 60 * 1000);
  const hoursSinceRelationship = (Date.now() - metrics.lastRelationshipChange) / (60 * 60 * 1000);

  if (hoursSinceGoal > 0.1) {  // 6 minutes in simulation time
    suggestions.push(`${daemon.agentName} hasn't changed goals - needs new motivation or obstacle`);
  }

  if (hoursSinceBelief > 0.05) {  // 3 minutes
    suggestions.push(`${daemon.agentName}'s thinking is stagnant - needs new information or challenge to beliefs`);
  }

  if (hoursSinceRelationship > 0.15) {  // 9 minutes
    suggestions.push(`${daemon.agentName} hasn't had meaningful social change - needs interaction or conflict`);
  }

  if (suggestions.length === 0) {
    return `${daemon.agentName} is growing well - no immediate attention needed`;
  }

  return suggestions.join("; ");
}

/**
 * Detect growth opportunities - when an agent is ready for challenge/development
 * The daemon's job is not just to protect, but to push growth and engagement
 */
export function detectGrowthOpportunities(
  current: AgentStateSnapshot,
  previous: AgentStateSnapshot | null,
  agentName: string,
  concernLevel: number
): GrowthOpportunity[] {
  const opportunities: GrowthOpportunity[] = [];

  // TOO COMFORTABLE: Agent has been stable with no challenges for too long
  if (concernLevel < 0.1 && current.arousal > 0.3 && current.arousal < 0.6) {
    // Mid-range arousal with low concerns = complacency zone
    if (previous && previous.stuckTicks > 1) {
      opportunities.push({
        type: "too_comfortable",
        description: `${agentName} has been in a comfort zone with no challenges`,
        suggestedChallenge: getContextualChallenge("too_comfortable", agentName),
        urgency: "low",
      });
    }
  }

  // READY FOR CHALLENGE: High health, stable arousal, has goals
  if (current.health && current.health > 80 &&
      current.arousal > 0.4 && current.arousal < 0.7 &&
      current.goalCount >= 1) {
    opportunities.push({
      type: "ready_for_challenge",
      description: `${agentName} is in prime condition for a challenge`,
      suggestedChallenge: getContextualChallenge("ready_for_challenge", agentName),
      urgency: "medium",
    });
  }

  // STAGNATING: Same position/focus for too long despite being active
  if (current.stuckTicks > 3 && current.active && current.arousal > 0.2) {
    opportunities.push({
      type: "stagnating",
      description: `${agentName} is stuck in a rut despite being engaged`,
      suggestedChallenge: getContextualChallenge("stagnating", agentName),
      urgency: "medium",
    });
  }

  // NEEDS CONFLICT: No recent emotional peaks, flat arousal history
  if (current.arousal > 0.35 && current.arousal < 0.55 && concernLevel < 0.2) {
    opportunities.push({
      type: "needs_conflict",
      description: `${agentName}'s emotional state is too flat - needs drama`,
      suggestedChallenge: getContextualChallenge("needs_conflict", agentName),
      urgency: "low",
    });
  }

  // BREAKTHROUGH POSSIBLE: High arousal but productive (not danger)
  if (current.arousal > 0.7 && current.arousal < 0.85 &&
      current.health && current.health > 50 &&
      current.goalCount >= 1) {
    opportunities.push({
      type: "breakthrough_possible",
      description: `${agentName} is in flow state - prime for breakthrough moment`,
      suggestedChallenge: getContextualChallenge("breakthrough_possible", agentName),
      urgency: "high",
    });
  }

  // SKILL PLATEAU: Has goals but not progressing (similar state over time)
  if (previous && current.goalCount === previous.goalCount &&
      current.goalCount > 0 && current.stuckTicks > 2) {
    opportunities.push({
      type: "skill_plateau",
      description: `${agentName} may have hit a plateau in pursuing their goals`,
      suggestedChallenge: getContextualChallenge("skill_plateau", agentName),
      urgency: "medium",
    });
  }

  // RELATIONSHIP TEST: Agent is stable - good time for social challenge
  if (current.health && current.health > 60 &&
      current.arousal > 0.3 && current.arousal < 0.6 &&
      concernLevel < 0.3) {
    // Only add occasionally (not every observation)
    if (Math.random() < 0.3) {
      opportunities.push({
        type: "relationship_test",
        description: `${agentName} is in stable condition for relationship dynamics`,
        suggestedChallenge: getContextualChallenge("relationship_test", agentName),
        urgency: "low",
      });
    }
  }

  return opportunities;
}

// =============================================================================
// DAEMON MEMORY MANAGEMENT (Mini-Narrator Memory)
// =============================================================================

/**
 * Record a thought summary in daemon memory
 */
export function recordThought(
  daemon: DaemonState,
  focus: string,
  content: string,
  emotionalTone: string,
  significance: number = 0.5
): void {
  const thought: ThoughtSummary = {
    id: `thought_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    timestamp: Date.now(),
    focus,
    content,
    emotionalTone,
    significance: Math.max(0, Math.min(1, significance)),
  };

  daemon.memory.recentThoughts.push(thought);

  // Keep only last 20 thoughts
  if (daemon.memory.recentThoughts.length > 20) {
    daemon.memory.recentThoughts = daemon.memory.recentThoughts.slice(-20);
  }
}

/**
 * Record a key memory (important event/decision)
 */
export function recordMemory(
  daemon: DaemonState,
  type: MemoryEntry["type"],
  content: string,
  participants: string[] = [],
  location?: string,
  emotionalImpact: number = 0,
  narrativeWeight: number = 0.5
): MemoryEntry {
  const memory: MemoryEntry = {
    id: `memory_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    timestamp: Date.now(),
    type,
    content,
    participants,
    location,
    emotionalImpact: Math.max(-1, Math.min(1, emotionalImpact)),
    narrativeWeight: Math.max(0, Math.min(1, narrativeWeight)),
    resolved: false,
  };

  daemon.memory.keyMemories.push(memory);

  // If memory is highly significant, it may progress the narrative arc
  if (narrativeWeight > 0.7) {
    progressNarrativeArc(daemon, content);
  }

  return memory;
}

/**
 * Record a plan
 */
export function recordPlan(
  daemon: DaemonState,
  goal: string,
  steps: string[] = [],
  priority: number = 0.5
): PlanEntry {
  const plan: PlanEntry = {
    id: `plan_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    timestamp: Date.now(),
    goal,
    steps,
    status: "planned",
    priority: Math.max(0, Math.min(1, priority)),
  };

  daemon.memory.activePlans.push(plan);

  // Update narrative arc if this is a significant new goal
  if (priority > 0.7 && !daemon.narrativeArc.drivingGoal) {
    daemon.narrativeArc.drivingGoal = goal;
    daemon.narrativeArc.status = "setup";
  }

  return plan;
}

/**
 * Update a plan's status
 */
export function updatePlanStatus(
  daemon: DaemonState,
  planId: string,
  status: PlanEntry["status"],
  blockedReason?: string
): boolean {
  const plan = daemon.memory.activePlans.find(p => p.id === planId);
  if (!plan) return false;

  plan.status = status;
  if (blockedReason) {
    plan.blockedReason = blockedReason;
  }

  // If plan completed or abandoned, record as character moment
  if (status === "completed") {
    recordCharacterMoment(daemon, "growth", `Completed goal: ${plan.goal}`, "working on goal", "achieved goal", "effort");
  } else if (status === "abandoned") {
    recordCharacterMoment(daemon, "setback", `Abandoned goal: ${plan.goal}`, "pursuing goal", "gave up", blockedReason || "obstacles");
  }

  return true;
}

/**
 * Record a relationship change
 */
export function recordRelationshipChange(
  daemon: DaemonState,
  otherCharacter: string,
  previousState: string,
  newState: string,
  cause: string,
  significance: number = 0.5
): void {
  const change: RelationshipChange = {
    id: `rel_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    timestamp: Date.now(),
    otherCharacter,
    previousState,
    newState,
    cause,
    significance: Math.max(0, Math.min(1, significance)),
  };

  daemon.memory.relationshipHistory.push(change);

  // Significant relationship changes are character moments
  if (significance > 0.6) {
    recordCharacterMoment(
      daemon,
      "transformation",
      `Relationship with ${otherCharacter} changed from ${previousState} to ${newState}`,
      previousState,
      newState,
      cause
    );
  }
}

/**
 * Record a character development moment
 */
export function recordCharacterMoment(
  daemon: DaemonState,
  type: CharacterMoment["type"],
  description: string,
  beforeState: string,
  afterState: string,
  catalyst: string
): void {
  const moment: CharacterMoment = {
    id: `moment_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    timestamp: Date.now(),
    type,
    description,
    beforeState,
    afterState,
    catalyst,
  };

  daemon.memory.characterMoments.push(moment);

  // Character moments progress the narrative arc
  progressNarrativeArc(daemon, description);

  // Keep only last 30 moments
  if (daemon.memory.characterMoments.length > 30) {
    daemon.memory.characterMoments = daemon.memory.characterMoments.slice(-30);
  }
}

/**
 * Get a summary of the daemon's memory for context
 */
export function getMemorySummary(daemon: DaemonState): string {
  const lines: string[] = [];
  const memory = daemon.memory;

  // Recent thoughts
  if (memory.recentThoughts.length > 0) {
    const recentThoughts = memory.recentThoughts.slice(-3);
    lines.push("Recent thoughts:");
    for (const thought of recentThoughts) {
      lines.push(`  - [${thought.emotionalTone}] ${thought.content}`);
    }
  }

  // Key unresolved memories
  const unresolvedMemories = memory.keyMemories.filter(m => !m.resolved).slice(-5);
  if (unresolvedMemories.length > 0) {
    lines.push("Unresolved matters:");
    for (const mem of unresolvedMemories) {
      lines.push(`  - [${mem.type}] ${mem.content}`);
    }
  }

  // Active plans
  const activePlans = memory.activePlans.filter(p => p.status === "active" || p.status === "planned");
  if (activePlans.length > 0) {
    lines.push("Current plans:");
    for (const plan of activePlans) {
      lines.push(`  - [${plan.status}] ${plan.goal}`);
    }
  }

  // Recent character moments
  const recentMoments = memory.characterMoments.slice(-3);
  if (recentMoments.length > 0) {
    lines.push("Recent character moments:");
    for (const moment of recentMoments) {
      lines.push(`  - [${moment.type}] ${moment.description}`);
    }
  }

  return lines.join("\n");
}

/**
 * Prune old memories to keep daemon memory manageable
 */
export function pruneMemory(daemon: DaemonState): void {
  const now = Date.now();
  const oneHourAgo = now - (60 * 60 * 1000);
  const memory = daemon.memory;

  // Remove old low-significance thoughts
  memory.recentThoughts = memory.recentThoughts.filter(t =>
    t.timestamp > oneHourAgo || t.significance > 0.7
  );

  // Keep only highly significant old memories
  memory.keyMemories = memory.keyMemories.filter(m =>
    m.timestamp > oneHourAgo || m.narrativeWeight > 0.6 || !m.resolved
  );

  // Remove completed/abandoned plans older than 30 minutes
  const thirtyMinsAgo = now - (30 * 60 * 1000);
  memory.activePlans = memory.activePlans.filter(p =>
    p.status === "active" || p.status === "planned" ||
    p.timestamp > thirtyMinsAgo
  );

  memory.lastPruning = now;
}

// =============================================================================
// DAEMON NARRATIVE ARC MANAGEMENT (Mini-Narrator Story Tracking)
// =============================================================================

/**
 * Progress the narrative arc based on an event
 */
export function progressNarrativeArc(daemon: DaemonState, eventDescription: string): void {
  const arc = daemon.narrativeArc;
  const now = Date.now();

  // Reset stagnation counter
  arc.ticksSinceProgress = 0;
  arc.lastProgressTimestamp = now;
  arc.needsSelfResolution = false;

  // Record the beat
  arc.completedBeats.push(eventDescription);
  if (arc.completedBeats.length > 20) {
    arc.completedBeats = arc.completedBeats.slice(-20);
  }

  // Auto-advance arc status based on progression
  const beatCount = arc.completedBeats.length;
  const previousStatus = arc.status;

  if (arc.status === "dormant" && arc.drivingGoal) {
    arc.status = "setup";
  } else if (arc.status === "setup" && beatCount >= 2) {
    arc.status = "rising";
    arc.tension = Math.min(1, arc.tension + 0.1);
  } else if (arc.status === "rising" && arc.tension > 0.7) {
    arc.status = "crisis";
  } else if (arc.status === "crisis" && beatCount >= 5) {
    arc.status = "climax";
    arc.tension = Math.min(1, arc.tension + 0.2);
  } else if (arc.status === "climax") {
    // Climax naturally moves to falling
    arc.status = "falling";
    arc.tension = Math.max(0, arc.tension - 0.3);
  } else if (arc.status === "falling" && arc.tension < 0.3) {
    arc.status = "resolution";
  }

  // If we transitioned to resolution, complete the arc
  if (arc.status === "resolution" && previousStatus !== "resolution") {
    completeNarrativeArc(daemon, "success");
  }
}

/**
 * Check if arc is stagnating and needs self-resolution
 */
export function checkArcStagnation(daemon: DaemonState): boolean {
  const arc = daemon.narrativeArc;

  // Dormant arcs don't stagnate
  if (arc.status === "dormant") return false;

  arc.ticksSinceProgress++;

  if (arc.ticksSinceProgress >= arc.stagnationThreshold) {
    arc.needsSelfResolution = true;
    console.log(`[Daemon] ${daemon.agentName}'s arc is stagnating (${arc.ticksSinceProgress} ticks without progress)`);
    return true;
  }

  return false;
}

/**
 * Attempt self-resolution when arc is stuck
 * Returns a nudge to push the character toward resolution
 */
export function attemptSelfResolution(daemon: DaemonState): NarrativeNudge | null {
  const arc = daemon.narrativeArc;

  if (!arc.needsSelfResolution) return null;

  arc.selfResolutionAttempts++;

  // After too many attempts, abandon the arc
  if (arc.selfResolutionAttempts > 3) {
    completeNarrativeArc(daemon, "abandoned");
    return null;
  }

  // Generate a resolution nudge based on arc status
  let nudgeType: NarrativeNudge["type"];
  let action: string;
  let reason: string;

  switch (arc.status) {
    case "setup":
      nudgeType = "change_goal";
      action = "Consider whether this path is worth pursuing, or if something else calls to you.";
      reason = "Arc stuck in setup - needs commitment or abandonment";
      break;
    case "rising":
      nudgeType = "escalate";
      action = "Push harder toward your goal. The tension must break one way or another.";
      reason = "Arc stuck in rising action - needs escalation to crisis";
      break;
    case "crisis":
      nudgeType = "resolve";
      action = "The moment of decision is here. You cannot avoid it any longer.";
      reason = "Arc stuck in crisis - needs decisive action";
      break;
    case "climax":
      nudgeType = "resolve";
      action = "This is the turning point. What happens now will define everything.";
      reason = "Arc stuck in climax - needs resolution";
      break;
    case "falling":
      nudgeType = "reflect";
      action = "Consider what has happened and what it means for your future.";
      reason = "Arc stuck in falling action - needs reflection to complete";
      break;
    default:
      nudgeType = "reflect";
      action = "Take stock of where you are and where you're going.";
      reason = "Arc needs direction";
  }

  const nudge: NarrativeNudge = {
    id: `self_resolve_${Date.now()}`,
    type: nudgeType,
    action,
    reason,
    source: "god", // Self-resolution acts like divine intervention
    timestamp: Date.now(),
    priority: "high",
  };

  console.log(`[Daemon] ${daemon.agentName} self-resolution attempt ${arc.selfResolutionAttempts}: ${action}`);

  return nudge;
}

/**
 * Complete the current narrative arc and start fresh
 */
export function completeNarrativeArc(
  daemon: DaemonState,
  resolution: CompletedArc["resolution"]
): void {
  const arc = daemon.narrativeArc;

  if (arc.status === "dormant") return;

  // Archive the completed arc
  const completedArc: CompletedArc = {
    id: `arc_${Date.now()}`,
    theme: arc.theme,
    startTime: arc.lastProgressTimestamp - (arc.ticksSinceProgress * 10000), // Approximate
    endTime: Date.now(),
    resolution,
    summary: `${daemon.agentName}'s arc of "${arc.theme}" ended in ${resolution}. Goal: ${arc.drivingGoal}`,
    keyMoments: arc.completedBeats.slice(-5),
  };

  arc.previousArcs.push(completedArc);
  if (arc.previousArcs.length > 5) {
    arc.previousArcs = arc.previousArcs.slice(-5);
  }

  console.log(`[Daemon] ${daemon.agentName} completed arc: "${arc.theme}" (${resolution})`);

  // Reset for new arc
  arc.theme = "daily life";
  arc.status = "dormant";
  arc.drivingGoal = "";
  arc.tension = 0.2;
  arc.desiredResolution = "";
  arc.stakes = { toGain: "", toLose: "" };
  arc.completedBeats = [];
  arc.upcomingBeats = [];
  arc.ticksSinceProgress = 0;
  arc.lastProgressTimestamp = Date.now();
  arc.needsSelfResolution = false;
  arc.selfResolutionAttempts = 0;
}

/**
 * Start a new narrative arc for the character
 */
export function startNarrativeArc(
  daemon: DaemonState,
  theme: string,
  drivingGoal: string,
  desiredResolution: string,
  stakes: { toGain: string; toLose: string }
): void {
  // Complete any existing arc first
  if (daemon.narrativeArc.status !== "dormant") {
    completeNarrativeArc(daemon, "transformed"); // Transformed into new arc
  }

  const arc = daemon.narrativeArc;
  arc.theme = theme;
  arc.status = "setup";
  arc.drivingGoal = drivingGoal;
  arc.desiredResolution = desiredResolution;
  arc.stakes = stakes;
  arc.tension = 0.3;
  arc.ticksSinceProgress = 0;
  arc.lastProgressTimestamp = Date.now();

  console.log(`[Daemon] ${daemon.agentName} started new arc: "${theme}" - ${drivingGoal}`);
}

/**
 * Get narrative arc summary for context
 */
export function getArcSummary(daemon: DaemonState): string {
  const arc = daemon.narrativeArc;
  const lines: string[] = [];

  lines.push(`=== ${daemon.agentName}'s Story Arc ===`);
  lines.push(`Theme: ${arc.theme}`);
  lines.push(`Status: ${arc.status}`);
  lines.push(`Tension: ${(arc.tension * 100).toFixed(0)}%`);

  if (arc.drivingGoal) {
    lines.push(`Driving Goal: ${arc.drivingGoal}`);
  }

  if (arc.desiredResolution) {
    lines.push(`Desired Resolution: ${arc.desiredResolution}`);
  }

  if (arc.stakes.toGain || arc.stakes.toLose) {
    lines.push(`Stakes: Gain "${arc.stakes.toGain}" / Lose "${arc.stakes.toLose}"`);
  }

  if (arc.completedBeats.length > 0) {
    lines.push(`Recent beats (${arc.completedBeats.length}):`);
    for (const beat of arc.completedBeats.slice(-3)) {
      lines.push(`  - ${beat}`);
    }
  }

  if (arc.needsSelfResolution) {
    lines.push(`** ARC STAGNATING - needs resolution **`);
  }

  if (arc.previousArcs.length > 0) {
    lines.push(`Previous arcs: ${arc.previousArcs.length}`);
  }

  return lines.join("\n");
}

/**
 * Increase arc tension
 */
export function increaseTension(daemon: DaemonState, amount: number = 0.1): void {
  daemon.narrativeArc.tension = Math.min(1, daemon.narrativeArc.tension + amount);
}

/**
 * Decrease arc tension
 */
export function decreaseTension(daemon: DaemonState, amount: number = 0.1): void {
  daemon.narrativeArc.tension = Math.max(0, daemon.narrativeArc.tension - amount);
}

// =============================================================================
// DAEMON OBSERVATION CYCLE
// =============================================================================

/**
 * Run observation cycle for a single daemon
 */
export function observeAgent(
  world: World,
  daemon: DaemonState
): DaemonObservation | null {
  const currentState = collectAgentState(world, daemon.agentEid);
  if (!currentState) return null;

  // Calculate stuck ticks
  if (daemon.lastAgentState) {
    const samePosition = currentState.position && daemon.lastAgentState.position &&
      currentState.position.x === daemon.lastAgentState.position.x &&
      currentState.position.y === daemon.lastAgentState.position.y;
    const sameFocus = currentState.focus === daemon.lastAgentState.focus;

    if (samePosition && sameFocus) {
      currentState.stuckTicks = daemon.lastAgentState.stuckTicks + 1;
    }
  }

  const concerns = detectConcerns(currentState, daemon.lastAgentState, daemon.agentName);
  const achievements: string[] = [];

  // Detect achievements (improvements from previous state)
  if (daemon.lastAgentState) {
    if (currentState.goalCount > daemon.lastAgentState.goalCount) {
      achievements.push(`Set a new goal`);
    }
    if (currentState.health && daemon.lastAgentState.health &&
        currentState.health > daemon.lastAgentState.health) {
      achievements.push(`Recovered health`);
    }
    if (currentState.arousal > 0.3 && daemon.lastAgentState.arousal < 0.3) {
      achievements.push(`Became more engaged`);
    }
  }

  // Update daemon state
  daemon.lastObservation = Date.now();
  daemon.observationCount++;
  daemon.lastAgentState = currentState;
  daemon.concernLevel = Math.min(1, concerns.reduce((sum, c) =>
    sum + (c.severity === "high" ? 0.3 : c.severity === "medium" ? 0.2 : 0.1), 0
  ));

  // Detect growth opportunities (the daemon pushes challenge, not just protects)
  const growthOpportunities = detectGrowthOpportunities(
    currentState,
    daemon.lastAgentState,
    daemon.agentName,
    daemon.concernLevel
  );

  // ========================================
  // MINI-NARRATOR: Update memory and arc
  // ========================================

  // Record focus/thought changes in memory
  if (currentState.focus && currentState.focus !== daemon.lastAgentState?.focus) {
    recordThought(
      daemon,
      currentState.focus,
      `Thinking about: ${currentState.focus}`,
      currentState.arousal > 0.6 ? "intense" : currentState.arousal < 0.3 ? "calm" : "neutral",
      0.3
    );
  }

  // Record achievements as character moments
  for (const achievement of achievements) {
    recordMemory(daemon, "victory", achievement, [], currentState.room, 0.5, 0.5);
  }

  // Record concerns as events that need attention
  for (const concern of concerns) {
    if (concern.severity === "high") {
      recordMemory(
        daemon,
        "event",
        concern.description,
        [],
        currentState.room,
        -0.3,
        0.6
      );
    }
  }

  // Update growth metrics
  updateGrowthMetrics(daemon, currentState, daemon.lastAgentState);

  // Check narrative arc stagnation
  const isStagnating = checkArcStagnation(daemon);

  // If stagnating, try self-resolution
  if (isStagnating) {
    const selfResolutionNudge = attemptSelfResolution(daemon);
    if (selfResolutionNudge) {
      daemon.pendingNudges.push(selfResolutionNudge);
    }
  }

  // Prune memory periodically (every 10 observations)
  if (daemon.observationCount % 10 === 0) {
    pruneMemory(daemon);
  }

  // Record observation event
  recordEvent("daemon_observation", {
    agent: daemon.agentName,
    concerns: concerns.length,
    achievements: achievements.length,
    growthOpportunities: growthOpportunities.length,
    concernLevel: daemon.concernLevel,
    arcStatus: daemon.narrativeArc.status,
    arcTension: daemon.narrativeArc.tension,
    memoryCount: daemon.memory.keyMemories.length,
  }, `Daemon_${daemon.agentName}`);

  return {
    agentName: daemon.agentName,
    currentState,
    previousState: daemon.lastAgentState,
    concerns,
    growthOpportunities,
    achievements,
    timestamp: Date.now(),
  };
}

// =============================================================================
// WHISPERS (Guidance to Agents)
// =============================================================================

/**
 * Generate and send a whisper to an agent
 */
export async function whisperToAgent(
  world: World,
  daemon: DaemonState,
  observation: DaemonObservation,
  forceWhisper: boolean = false
): Promise<DaemonWhisper | null> {
  const now = Date.now();

  // Check cooldown
  if (!forceWhisper && now - daemon.lastWhisper < 30000) { // 30 second cooldown
    return null;
  }

  // Only whisper if there are concerns or it's time for encouragement
  if (observation.concerns.length === 0 && daemon.observationCount % 10 !== 0) {
    return null;
  }

  // Determine whisper type and content
  let whisperType: DaemonWhisper["type"] = "guidance";
  let whisperContent = "";

  if (observation.concerns.length > 0) {
    const topConcern = observation.concerns.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    })[0];

    if (topConcern.suggestedWhisper) {
      whisperContent = topConcern.suggestedWhisper;
      whisperType = topConcern.type === "danger" ? "warning" :
                    topConcern.type === "stuck" ? "guidance" : "observation";
    } else {
      // Generate whisper with LLM
      try {
        const result = await generateText({
          model: daemonModel,
          prompt: `You are a daemon (guardian spirit) watching over ${observation.agentName}.
You've observed a concern: ${topConcern.description}

Generate a short, subtle whisper (1 sentence, under 20 words) to gently guide them.
The whisper should feel like an inner voice or intuition, not a direct command.
Do not use quotes. Just output the whisper text.`,
          maxTokens: 50,
        });
        whisperContent = result.text.trim().replace(/^["']|["']$/g, '');
        whisperType = "guidance";
      } catch (error) {
        // Fallback to generic whisper
        whisperContent = "Something feels off. Perhaps a change is needed.";
      }
    }
  } else if (observation.achievements.length > 0) {
    whisperType = "encouragement";
    whisperContent = "You're doing well. Keep going.";
  }

  if (!whisperContent) return null;

  // Send whisper as cognitive stimulus
  queueStimulus({
    targetEid: daemon.agentEid,
    type: "daemon_whisper",
    modality: "cognitive",
    content: whisperContent,
    source: "inner_voice",
    intensity: 0.3,  // Subtle, not overwhelming
  });

  daemon.lastWhisper = now;
  daemon.whisperCount++;

  const whisper: DaemonWhisper = {
    agentEid: daemon.agentEid,
    content: whisperContent,
    type: whisperType,
    timestamp: now,
  };

  console.log(`[Daemon] Whisper to ${daemon.agentName}: "${whisperContent}"`);

  // Record whisper event
  recordEvent("daemon_whisper", {
    agent: daemon.agentName,
    type: whisperType,
    content: whisperContent,
  }, `Daemon_${daemon.agentName}`, daemon.agentName);

  return whisper;
}

/**
 * Generate and send a CHALLENGE whisper to push agent growth
 * Unlike protective whispers, these provocations encourage risk, ambition, curiosity
 *
 * TENSION AWARENESS: Daemons will back off challenges when simulation tension is high
 * - High tension (>0.7): Only challenge if urgency is HIGH
 * - Critical tension (>0.85): No challenges at all, let things calm down
 */
export async function whisperChallenge(
  world: World,
  daemon: DaemonState,
  observation: DaemonObservation,
  registry: DaemonRegistry,
  forceWhisper: boolean = false
): Promise<ChallengeWhisper | null> {
  const now = Date.now();

  // TENSION AWARENESS: Back off when simulation is already tense
  if (registry.simulationTension > 0.85) {
    // Critical tension - no challenges, let things settle
    return null;
  }

  if (registry.simulationTension > 0.7) {
    // High tension - only proceed if we have high urgency opportunities
    const hasHighUrgency = observation.growthOpportunities.some(o => o.urgency === "high");
    if (!hasHighUrgency) {
      return null;
    }
  }

  // Use registry's challenge cooldown (longer than guidance whispers)
  if (!forceWhisper && now - daemon.lastWhisper < registry.challengeCooldown) {
    return null;
  }

  // Only challenge if there are growth opportunities
  if (observation.growthOpportunities.length === 0) {
    return null;
  }

  // Pick the highest urgency growth opportunity
  const topOpportunity = observation.growthOpportunities.sort((a, b) => {
    const urgencyOrder = { high: 0, medium: 1, low: 2 };
    return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
  })[0];

  // Map opportunity types to challenge types
  const challengeTypeMap: Record<GrowthOpportunity["type"], ChallengeWhisper["challengeType"]> = {
    "too_comfortable": "restlessness",
    "ready_for_challenge": "ambition",
    "stagnating": "curiosity",
    "needs_conflict": "provocation",
    "breakthrough_possible": "ambition",
    "skill_plateau": "doubt",
    "relationship_test": "provocation",
  };

  const challengeType = challengeTypeMap[topOpportunity.type];

  // Generate challenge whisper with LLM
  let challengeContent = "";
  try {
    const result = await generateText({
      model: daemonModel,
      prompt: `You are a daemon (guardian spirit) watching over ${observation.agentName}.
Your role is NOT just to protect, but to push growth, challenge, and development.

You've noticed: ${topOpportunity.description}
Challenge type you should use: ${challengeType}

Generate a short, provocative whisper (1 sentence, under 20 words) that:
- If "provocation": Plants doubt, stirs jealousy, or questions their choices
- If "doubt": Questions their abilities or complacency
- If "ambition": Whispers of greater things they could achieve
- If "curiosity": Hints at mysteries or unexplored paths
- If "restlessness": Makes them feel the need to change or move

The whisper should feel like a nagging inner voice that won't let them rest easy.
Be subtle but unsettling. Do not use quotes. Just output the whisper text.`,
      maxTokens: 50,
    });
    challengeContent = result.text.trim().replace(/^["']|["']$/g, '');
  } catch (error) {
    // Fallback challenge whispers by type
    const fallbackWhispers: Record<ChallengeWhisper["challengeType"], string> = {
      provocation: "Are you truly content with this? Others achieve so much more.",
      doubt: "Is this really the best you can do?",
      ambition: "You were meant for greater things than this.",
      curiosity: "What lies beyond? You'll never know if you stay here.",
      restlessness: "Something is wrong. You can feel it. You need to move.",
    };
    challengeContent = fallbackWhispers[challengeType];
  }

  if (!challengeContent) return null;

  // Send challenge whisper as cognitive stimulus (higher intensity than guidance)
  queueStimulus({
    targetEid: daemon.agentEid,
    type: "daemon_challenge",
    modality: "cognitive",
    content: challengeContent,
    source: "inner_voice",
    intensity: 0.5,  // Stronger than guidance whispers
  });

  daemon.lastWhisper = now;
  daemon.whisperCount++;

  const challenge: ChallengeWhisper = {
    agentEid: daemon.agentEid,
    content: challengeContent,
    challengeType,
    timestamp: now,
  };

  console.log(`[Daemon] Challenge to ${daemon.agentName}: "${challengeContent}" (${challengeType})`);

  // Record challenge event
  recordEvent("daemon_challenge", {
    agent: daemon.agentName,
    challengeType,
    opportunity: topOpportunity.type,
    content: challengeContent,
  }, `Daemon_${daemon.agentName}`, daemon.agentName);

  return challenge;
}

// =============================================================================
// REPORTS (To Higher Spirits)
// =============================================================================

/**
 * Generate and send a report to superior spirit
 * Reports include both concerns (protection) and growth opportunities (challenge)
 * The Arbiter/GodAI can use growth opportunities to create interesting challenges
 */
export function reportToSuperiorSpirit(
  registry: DaemonRegistry,
  spiritRegistry: SpiritRegistry,
  daemon: DaemonState,
  observation: DaemonObservation,
  forceReport: boolean = false
): DaemonReport | null {
  const now = Date.now();

  // Check cooldown
  if (!forceReport && now - daemon.lastReport < registry.reportCooldown) {
    return null;
  }

  // Report if there are significant concerns OR high-urgency growth opportunities
  const highConcerns = observation.concerns.filter(c => c.severity === "high");
  const urgentGrowth = observation.growthOpportunities.filter(g => g.urgency === "high" || g.urgency === "medium");

  if (highConcerns.length === 0 && urgentGrowth.length === 0 && !forceReport) {
    return null;
  }

  // Determine report type - growth opportunities are important too!
  const reportType: DaemonReport["reportType"] =
    highConcerns.length > 0 ? "concern" :
    urgentGrowth.length > 0 ? "growth_opportunity" :
    observation.achievements.length > 0 ? "achievement" : "status";

  // Priority considers both concerns AND growth opportunities
  const priority: DaemonReport["priority"] =
    highConcerns.length > 1 ? "high" :
    (highConcerns.length === 1 || urgentGrowth.filter(g => g.urgency === "high").length > 0) ? "normal" : "low";

  // Build report content
  const lines: string[] = [
    `## Daemon Report: ${daemon.agentName}`,
    "",
  ];

  if (observation.concerns.length > 0) {
    lines.push("### Concerns (Protection Needed):");
    for (const concern of observation.concerns) {
      lines.push(`- [${concern.severity.toUpperCase()}] ${concern.type}: ${concern.description}`);
    }
    lines.push("");
  }

  // IMPORTANT: Include growth opportunities for the Arbiter/GodAI to act on
  if (observation.growthOpportunities.length > 0) {
    lines.push("### Growth Opportunities (Challenge Recommended):");
    for (const opportunity of observation.growthOpportunities) {
      lines.push(`- [${opportunity.urgency.toUpperCase()}] ${opportunity.type}: ${opportunity.description}`);
      lines.push(`  → Suggested: ${opportunity.suggestedChallenge}`);
    }
    lines.push("");
  }

  if (observation.achievements.length > 0) {
    lines.push("### Achievements:");
    for (const achievement of observation.achievements) {
      lines.push(`- ${achievement}`);
    }
    lines.push("");
  }

  lines.push(`### Agent State:`);
  lines.push(`- Arousal: ${observation.currentState.arousal.toFixed(2)}`);
  lines.push(`- Focus: ${observation.currentState.focus || "none"}`);
  lines.push(`- Goals: ${observation.currentState.goalCount}`);
  if (observation.currentState.health !== undefined) {
    lines.push(`- Health: ${observation.currentState.health}`);
  }

  const report: DaemonReport = {
    daemonEid: daemon.daemonEid,
    agentName: daemon.agentName,
    reportType,
    content: lines.join("\n"),
    concerns: observation.concerns,
    growthOpportunities: observation.growthOpportunities,
    priority,
    timestamp: now,
  };

  // Send to superior if available
  if (registry.superiorSpiritEid && spiritRegistry) {
    reportToSuperior(
      spiritRegistry,
      daemon.daemonEid as any, // Daemon IDs are virtual, not ECS entities
      `Daemon Report: ${daemon.agentName}`,
      report.content,
      priority,
      { report }
    );
  }

  daemon.lastReport = now;
  daemon.reportCount++;

  console.log(`[Daemon] Report sent for ${daemon.agentName} (${reportType}, ${priority})`);

  // Record report event
  recordEvent("daemon_report", {
    agent: daemon.agentName,
    type: reportType,
    priority,
    concerns: observation.concerns.length,
    growthOpportunities: observation.growthOpportunities.length,
  }, `Daemon_${daemon.agentName}`);

  return report;
}

// =============================================================================
// DAEMON SYSTEM RUNNER
// =============================================================================

/**
 * Run all daemons that need observation
 * Daemons now serve dual purpose: protection (guidance whispers) AND growth (challenge whispers)
 */
export async function runDaemonSystem(
  world: World,
  registry: DaemonRegistry,
  spiritRegistry?: SpiritRegistry
): Promise<{
  observations: number;
  whispers: number;
  challenges: number;
  reports: number;
}> {
  const daemonsToRun = getDaemonsNeedingObservation(registry);

  let observations = 0;
  let whispers = 0;
  let challenges = 0;
  let reports = 0;

  for (const daemon of daemonsToRun) {
    // Check if agent still exists
    if (!entityExists(world, daemon.agentEid)) {
      removeDaemon(registry, daemon.agentEid);
      continue;
    }

    // Observe
    const observation = observeAgent(world, daemon);
    if (!observation) continue;
    observations++;

    // Priority: concerns get guidance whispers, growth gets challenge whispers
    // If there are concerns, prioritize protective guidance
    if (observation.concerns.length > 0) {
      const whisper = await whisperToAgent(world, daemon, observation);
      if (whisper) whispers++;
    }
    // If no concerns but growth opportunities, push with challenge whispers
    else if (observation.growthOpportunities.length > 0) {
      const challenge = await whisperChallenge(world, daemon, observation, registry);
      if (challenge) challenges++;
    }

    // Maybe report (includes both concerns AND growth opportunities for GodAI)
    if (spiritRegistry) {
      const report = reportToSuperiorSpirit(registry, spiritRegistry, daemon, observation);
      if (report) reports++;
    }
  }

  return { observations, whispers, challenges, reports };
}

// =============================================================================
// DAEMON SUMMARY
// =============================================================================

/**
 * Get summary of all daemons
 */
export function getDaemonSummary(registry: DaemonRegistry): string {
  const lines: string[] = [
    "=== Daemon Registry ===",
    `Total daemons: ${registry.daemons.size}`,
    `Observation interval: ${registry.observationInterval}ms`,
    `Whisper cooldown: ${registry.whisperCooldown}ms`,
    `Challenge cooldown: ${registry.challengeCooldown}ms`,
    `Report cooldown: ${registry.reportCooldown}ms`,
    `Simulation tension: ${(registry.simulationTension * 100).toFixed(0)}%`,
    "",
  ];

  for (const daemon of registry.daemons.values()) {
    const status = daemon.active ? "✓" : "✗";
    lines.push(`${status} ${daemon.agentName}:`);
    lines.push(`   Observations: ${daemon.observationCount}, Whispers: ${daemon.whisperCount}, Reports: ${daemon.reportCount}`);
    lines.push(`   Concern level: ${(daemon.concernLevel * 100).toFixed(0)}%`);
    // Mini-narrator info
    lines.push(`   Arc: "${daemon.narrativeArc.theme}" (${daemon.narrativeArc.status}, ${(daemon.narrativeArc.tension * 100).toFixed(0)}% tension)`);
    if (daemon.narrativeArc.drivingGoal) {
      lines.push(`   Goal: ${daemon.narrativeArc.drivingGoal}`);
    }
    if (daemon.narrativeArc.needsSelfResolution) {
      lines.push(`   ⚠ Arc stagnating - needs resolution`);
    }
    lines.push(`   Memory: ${daemon.memory.recentThoughts.length} thoughts, ${daemon.memory.keyMemories.length} memories, ${daemon.memory.activePlans.length} plans`);
  }

  return lines.join("\n");
}

/**
 * Get detailed summary for a specific daemon (mini-narrator view)
 */
export function getDaemonDetailedSummary(daemon: DaemonState): string {
  const lines: string[] = [];

  lines.push(`=== ${daemon.agentName}'s Guardian Daemon ===`);
  lines.push("");

  // Basic stats
  lines.push("## Status");
  lines.push(`Active: ${daemon.active ? "Yes" : "No"}`);
  lines.push(`Concern level: ${(daemon.concernLevel * 100).toFixed(0)}%`);
  lines.push(`Observations: ${daemon.observationCount}`);
  lines.push(`Whispers sent: ${daemon.whisperCount}`);
  lines.push(`Reports sent: ${daemon.reportCount}`);
  lines.push("");

  // Narrative arc (mini-narrator view)
  lines.push("## Narrative Arc");
  lines.push(getArcSummary(daemon));
  lines.push("");

  // Memory summary
  lines.push("## Memory");
  lines.push(getMemorySummary(daemon));
  lines.push("");

  // Growth metrics
  lines.push("## Growth Tracking");
  const metrics = daemon.growthMetrics;
  lines.push(`Stagnation score: ${(metrics.stagnationScore * 100).toFixed(0)}%`);
  const minutesSinceGoal = Math.round((Date.now() - metrics.lastGoalChange) / 60000);
  const minutesSinceBelief = Math.round((Date.now() - metrics.lastBeliefChange) / 60000);
  const minutesSinceRelationship = Math.round((Date.now() - metrics.lastRelationshipChange) / 60000);
  lines.push(`Last goal change: ${minutesSinceGoal}m ago`);
  lines.push(`Last belief change: ${minutesSinceBelief}m ago`);
  lines.push(`Last relationship change: ${minutesSinceRelationship}m ago`);
  lines.push("");

  // Pending nudges
  if (daemon.pendingNudges.length > 0) {
    lines.push("## Pending Nudges");
    for (const nudge of daemon.pendingNudges) {
      lines.push(`- [${nudge.priority}] ${nudge.type}: ${nudge.action}`);
    }
    lines.push("");
  }

  // Narrative constraints
  if (daemon.narrativeConstraints) {
    lines.push("## Narrative Constraints");
    lines.push(`Max drama level: ${(daemon.narrativeConstraints.maxDramaLevel * 100).toFixed(0)}%`);
    lines.push(`Allow conflict: ${daemon.narrativeConstraints.allowConflict}`);
    lines.push(`Allow romance: ${daemon.narrativeConstraints.allowRomance}`);
    lines.push(`Preferred mood: ${daemon.narrativeConstraints.preferredMood}`);
    lines.push(`Is focus character: ${daemon.narrativeConstraints.isFocusCharacter}`);
  }

  return lines.join("\n");
}
