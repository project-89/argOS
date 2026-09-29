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

import { readAttention } from "../runtime/attention";
import { generateText } from "ai";
import { randomUUID } from "node:crypto";
import { query, entityExists, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { readSimulationTime } from "../ecs/simulation-time";
import { legacySimulationTimestamp } from "../ecs/temporal-age";
import { Name, Description, Agent, Mind, Goal, GridPosition, Health, Inventory, WorkingMemoryIdentity, Removed, Room, Perception } from "../ecs/components";
import { HasGoal, HasMemory, HasThought } from "../ecs/relations";
import { hasOwnMindSuspended } from "../ecs/controlled";
import { getRoomForEntity } from "../ecs/location";
import { safeGetRelationTargets } from "../ecs/dynamic-systems";
import { queueGuardedStimulus } from "../cognition/stimulus-queue";
import { addPerception, getAgentPerceptions } from "../cognition/agent-mind";
import { getCharacterContext, getLocalOpportunityContext } from "../cognition/character-context";
import { snapshotAffect } from "../cognition/affect-state";
import { getRecentActions } from "../cognition/agent-action-history";
import { getWorldCharacterSeed } from "../world/world-specification";
import type { NarrativeState } from "./types";
import { chronicle } from "../cognition/simulation-chronicle";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { getCommittedSource, startCommittedEvents } from "../runtime/committed-events";
import { getRecentPhysicalAttempts, hasRepeatedPhysicalFailures } from "../runtime/recent-physical-attempts";
import { assertSimulationTaskActive, getSimulationTaskSignal } from "../runtime/task-scope";
import { formatCoordinationContext, getCoordinationMemory } from "../cognition/coordination-memory";
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
// INNER VOICE CONSTANTS
// =============================================================================

/** Private perception strength of a daemon's whisper: felt, not shouted. */
export const INNER_VOICE_INTENSITY = 0.6;
/** Actions that read as waiting rather than living. */
const IDLE_ACTIONS = new Set(["wait", "rest", "sleep", "idle", "pause"]);

// =============================================================================
// DAEMON STATE
// =============================================================================

export interface DaemonState {
  /** Parallel lived-time origins; source timestamps below retain their identity. */
  temporalMarks?: Record<string, { sourceAt: number; simAt: number }>;
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
    stagnationScore: number;     // Legacy name: latest repeated-physical-failure signal (0 or 1)
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

  /** Inner-voice pacing in simulation time, plus the last few whispers so the
   * voice keeps finding something new to say. Private to this daemon. */
  innerVoice?: { lastAtSimMs?: number; count: number; recent: string[] };
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
  needsSelfResolution: boolean;   // Legacy name: due review plus recent failed attempts, not a required ending
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
  /** Recent public executor evidence, not inferred from stillness or goal count. */
  recentAttempts?: { consecutiveFailures: number; status: "pending" | "succeeded" | "failed"; executionId: string };
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
  /** This daemon's own character account, not shared NPC knowledge. */
  coordination?: string;
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

export interface DaemonPovStory {
  agentName: string;
  prose: string;
  signature: string;
  arcStatus: DaemonNarrativeArc["status"];
  tension: number;
  concernLevel: number;
  score: number;
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
  /** Live worlds turn this on: each daemon whispers persona- and story-aware
   * impulses on its own cadence, and voices Narrator nudges in the person's
   * inner voice. Off by default so standalone registries stay inert. */
  innerVoice: boolean;
  /** False keeps whispers deterministic (no model call), e.g. when AI is off. */
  useModel: boolean;
  /** Simulation-time spacing between inner-voice whispers per resident. */
  innerVoiceCadenceMs: { idle: number; active: number };
  /** Bound on model-voiced whispers started in one daemon cycle. */
  innerVoiceMaxPerCycle: number;
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
    innerVoice: false,
    useModel: true,
    innerVoiceCadenceMs: { idle: 25_000, active: 45_000 },
    innerVoiceMaxPerCycle: 3,
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
const daemonWorlds = new WeakMap<DaemonState, World>();
/** Rebind a separately restored daemon to its actual world before it observes. */
export function bindDaemonToWorld(daemon: DaemonState, world: World): void { daemonWorlds.set(daemon, world); }
function stampDaemonTime(daemon: DaemonState, key: string, sourceAt: number): void {
  const world = daemonWorlds.get(daemon);
  if (world) { daemon.temporalMarks ??= {}; daemon.temporalMarks[key] = { sourceAt, simAt: readSimulationTime(world) }; }
}
function daemonAge(daemon: DaemonState, key: string, sourceAt: number): number {
  const world = daemonWorlds.get(daemon);
  if (!world) return Math.max(0, Date.now() - sourceAt); // Explicit legacy standalone daemon API.
  const mark = daemon.temporalMarks?.[key];
  return Math.max(0, readSimulationTime(world) - (mark?.sourceAt === sourceAt ? mark.simAt : legacySimulationTimestamp(world, sourceAt)));
}

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
  bindDaemonToWorld(daemon, world);
  for (const key of ["lastGoalChange", "lastBeliefChange", "lastRelationshipChange"] as const) stampDaemonTime(daemon, key, daemon.growthMetrics[key]);
  stampDaemonTime(daemon, "arc.lastProgress", daemon.narrativeArc.lastProgressTimestamp);

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

export type NarrativeNudgeScope = { world: World; agentEid: number;
  /** Trusted read-only validity of the captured evidence/plan, never JSON authority. */
  isCurrent?: () => boolean };
const SCOPED_NUDGE_PREFIX = "scoped-nudge:";
type ScopedNudgeReceipt = { registry: DaemonRegistry; daemon: DaemonState; world: World;
  agentEid: number; owner: string; persona: string; source: string | null; issuedAtSimMs: number; exact: string; consumed: boolean;
  agentName: string; terminalDiagnostic?: "converted" | "perception_delivered" | "dropped";
  isCurrent?: () => boolean };
const scopedNudges = new WeakMap<NarrativeNudge, ScopedNudgeReceipt>();
/** Operator diagnostics in the existing bounded log, not a public world event
 * or proof the suggestion was considered, obeyed, or caused a later action.
 * No suggestion text or private cognition enters this lifecycle record. */
function recordScopedNudgeLifecycle(nudge: NarrativeNudge,
  stage: "queued" | "converted" | "perception_delivered" | "dropped", perceptionEid?: number): void {
  const receipt = scopedNudges.get(nudge); if (!receipt) return;
  if (receipt.terminalDiagnostic && !(receipt.terminalDiagnostic === "converted" && (stage === "perception_delivered" || stage === "dropped"))) return;
  if (stage !== "queued") receipt.terminalDiagnostic = stage;
  chronicle.record("narrative_nudge_lifecycle", { nudgeId: nudge.id, sourceId: receipt.source, route: "daemon",
    agent: receipt.agentName, actorKey: receipt.owner, stage, issuedAtSimMs: receipt.issuedAtSimMs,
    atSimMs: readSimulationTime(receipt.world),
    ...(stage === "dropped" ? { reason: "scope_invalid_or_consumed" } : {}),
    ...(perceptionEid !== undefined ? { perceptionEid } : {}),
  }, `Narrative advice transport: ${stage}`);
}
function nudgeGuardCurrent(guard: NarrativeNudgeScope["isCurrent"]): boolean {
  try { return guard === undefined || typeof guard === "function" && guard() === true; } catch { return false; }
}
const nudgePersona = (eid: number) => JSON.stringify([Name.value[eid], Agent.role[eid], Agent.systemPrompt[eid]]);
function currentNudgeRecipient(registry: DaemonRegistry, daemon: DaemonState, world: World, eid: number): boolean {
  return registry.daemons.get(eid) === daemon && daemon.agentEid === eid && daemon.active
    && daemonWorlds.get(daemon) === world && entityExists(world, eid) && hasComponent(world, eid, Agent)
    && Agent.active[eid] && hasComponent(world, eid, Name) && Name.value[eid] === daemon.agentName;
}
/** `inFlight` rechecks a receipt this daemon already took for voicing: it is
 * consumed (no second delivery) but must still be current to be delivered. */
function scopedNudgeCurrent(daemon: DaemonState, world: World, nudge: NarrativeNudge, registry?: DaemonRegistry, inFlight = false): boolean {
  const receipt = scopedNudges.get(nudge), source = getCommittedSource(world);
  return !!receipt && receipt.consumed === inFlight && receipt.daemon === daemon && receipt.world === world
    && (!registry || receipt.registry === registry)
    && currentNudgeRecipient(receipt.registry, daemon, world, receipt.agentEid)
    && hasComponent(world, receipt.agentEid, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[receipt.agentEid] === receipt.owner
    && nudgePersona(receipt.agentEid) === receipt.persona && !source.stopped && source.sourceId === receipt.source
    && Number.isFinite(readSimulationTime(world)) && readSimulationTime(world) >= receipt.issuedAtSimMs && JSON.stringify(nudge) === receipt.exact
    && nudgeGuardCurrent(receipt.isCurrent);
}
function isScopedNudge(nudge: NarrativeNudge): boolean {
  // The reserved serialized marker conveys no authority. Its only purpose is
  // to stop a restored/copied scoped request from falling through as legacy.
  return scopedNudges.has(nudge) || typeof nudge.id === "string" && nudge.id.startsWith(SCOPED_NUDGE_PREFIX);
}

/**
 * Queue a narrative nudge for a character daemon
 * Scoped callers issue an optional suggestion to one live actor/daemon. The
 * unscoped overload remains the explicit legacy standalone-daemon API.
 */
export function queueNarrativeNudge(
  registry: DaemonRegistry,
  agentName: string,
  nudge: Omit<NarrativeNudge, "id" | "timestamp">,
  scope?: NarrativeNudgeScope
): boolean {
  assertSimulationTaskActive();
  const matches = Array.from(registry.daemons.values())
    .filter(d => d.agentName.toLowerCase() === agentName.toLowerCase());
  const daemon = scope ? registry.daemons.get(scope.agentEid) : matches[0];

  if (!daemon) {
    console.warn(`[Daemon] Cannot nudge ${agentName}: no daemon found`);
    return false;
  }
  if (scope && (matches.length !== 1 || matches[0] !== daemon
    || !currentNudgeRecipient(registry, daemon, scope.world, scope.agentEid) || getCommittedSource(scope.world).stopped
    || !Number.isFinite(readSimulationTime(scope.world)) || readSimulationTime(scope.world) < 0 || !nudgeGuardCurrent(scope.isCurrent))) return false;

  const fullNudge: NarrativeNudge = {
    ...nudge,
    id: scope ? `${SCOPED_NUDGE_PREFIX}${randomUUID()}` : `nudge_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    timestamp: Date.now(),
  };
  if (scope) {
    scopedNudges.set(fullNudge, { registry, daemon, world: scope.world, agentEid: scope.agentEid,
      owner: workingMemoryEntityRef(scope.world, scope.agentEid)!.key, persona: nudgePersona(scope.agentEid),
      source: getCommittedSource(scope.world).sourceId, issuedAtSimMs: readSimulationTime(scope.world), exact: JSON.stringify(fullNudge), consumed: false,
      agentName: daemon.agentName, isCurrent: scope.isCurrent });
    Object.freeze(fullNudge);
  }

  daemon.pendingNudges.push(fullNudge);
  if (scope) recordScopedNudgeLifecycle(fullNudge, "queued");
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
  return consumePendingNudges(daemon, world, false);
}
function discardInvalidScopedNudges(daemon: DaemonState, world: World, registry?: DaemonRegistry): void {
  assertSimulationTaskActive();
  // Reject every invalid scoped row before priority selection, including saved
  // JSON copies without an in-process receipt. They must not become whispers
  // or starve valid lower-priority suggestions. Legacy rows remain compatible.
  daemon.pendingNudges = daemon.pendingNudges.filter(nudge => {
    if (!isScopedNudge(nudge) || scopedNudgeCurrent(daemon, world, nudge, registry)) return true;
    recordScopedNudgeLifecycle(nudge, "dropped");
    return false;
  });
}
function consumePendingNudges(daemon: DaemonState, world: World, scopedOnly: boolean,
  deliver?: (whisper: DaemonWhisper) => number, registry?: DaemonRegistry): DaemonWhisper[] {
  assertSimulationTaskActive();
  const whispers: DaemonWhisper[] = [];
  discardInvalidScopedNudges(daemon, world, registry);

  // Sort by priority (high first)
  const sortedNudges = daemon.pendingNudges.filter(nudge => !scopedOnly || isScopedNudge(nudge) && shouldApplyNudge(daemon, nudge)).sort((a, b) => {
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  // Process up to 3 nudges per cycle
  const toProcess = sortedNudges.slice(0, 3);

  for (const nudge of toProcess) {
    assertSimulationTaskActive();
    if (isScopedNudge(nudge) && !scopedNudgeCurrent(daemon, world, nudge, registry)) {
      recordScopedNudgeLifecycle(nudge, "dropped");
      daemon.pendingNudges = daemon.pendingNudges.filter(row => row !== nudge);
      continue;
    }
    // Check if nudge respects narrative constraints
    if (!shouldApplyNudge(daemon, nudge)) {
      console.log(`[Daemon] Skipping nudge for ${daemon.agentName} - blocked by constraints`);
      continue;
    }

    const receipt = scopedNudges.get(nudge);
    if (receipt) {
      // Duplicate references in the queue are one request, not repeat guidance.
      if (!scopedNudgeCurrent(daemon, world, nudge, registry)) continue;
      receipt.consumed = true;
    }

    // Convert nudge to whisper based on type
    const whisper = convertNudgeToWhisper(daemon, nudge);
    // Remove processed nudge
    if (receipt) daemon.pendingNudges = daemon.pendingNudges.filter(row => row !== nudge);
    else {
      const idx = daemon.pendingNudges.findIndex(n => n.id === nudge.id);
      if (idx !== -1) daemon.pendingNudges.splice(idx, 1);
    }
    if (whisper) {
      // Chronicle subscribers run synchronously. Publish transport diagnostics
      // only after native admission so a subscriber cannot stop/rebind the
      // recipient between its last scope check and this perception commit.
      const perceptionEid = deliver?.(whisper);
      recordScopedNudgeLifecycle(nudge, "converted");
      if (perceptionEid !== undefined) recordScopedNudgeLifecycle(nudge,
        perceptionEid >= 0 ? "perception_delivered" : "dropped", perceptionEid >= 0 ? perceptionEid : undefined);
      whispers.push(whisper);
    }
  }

  return whispers;
}

/** Native cycles admit only newly scoped suggestions, synchronously, with the
 * ordinary whisper cooldown. Legacy backlog is not newly granted delivery. */
function deliverScopedNarrativeNudges(registry: DaemonRegistry, daemon: DaemonState, world: World): number {
  assertSimulationTaskActive();
  discardInvalidScopedNudges(daemon, world, registry);
  if (daemon.lastWhisper && daemonAge(daemon, "lastWhisper", daemon.lastWhisper) < registry.whisperCooldown) return 0;
  return consumePendingNudges(daemon, world, true, whisper => {
    const perceptionEid = addPerception(world, daemon.agentEid, { type: "daemon_whisper", content: whisper.content, source: "inner_voice", intensity: INNER_VOICE_INTENSITY });
    assertSimulationTaskActive();
    daemon.lastWhisper = Date.now();
    stampDaemonTime(daemon, "lastWhisper", daemon.lastWhisper);
    daemon.whisperCount++;
    return perceptionEid;
  }, registry).length;
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
      content = `Something keeps pulling you that way: ${nudge.action}`;
      type = "guidance";
      break;
    case "interact":
      content = `You keep thinking you should: ${nudge.action}`;
      type = "encouragement";
      break;
    case "resolve":
      content = `Maybe this is how it settles: ${nudge.action}`;
      type = "guidance";
      break;
    case "escalate":
      content = `Part of you wants to push it: ${nudge.action}`;
      type = "observation";
      break;
    case "reflect":
      content = `It keeps coming back to you: ${nudge.action}`;
      type = "reminder";
      break;
    case "change_goal":
      content = `What if, instead, you did this: ${nudge.action}`;
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
  if (!entityExists(world, agentEid) || !hasComponent(world, agentEid, Agent) || !hasComponent(world, agentEid, Mind)) return null;

  const roomEid = getRoomForEntity(world, agentEid);
  const roomName = roomEid !== undefined ? Name.value[roomEid] : undefined;

  const goals = safeGetRelationTargets(world, agentEid, HasGoal).filter(goal => hasComponent(world, goal, Goal) && Goal.status[goal] === "active");
  const thoughts = safeGetRelationTargets(world, agentEid, HasThought);
  const recentAttempts = getRecentPhysicalAttempts(world, agentEid);

  return {
    timestamp: Date.now(),
    position: hasComponent(world, agentEid, GridPosition) ? {
      x: GridPosition.x[agentEid],
      y: GridPosition.y[agentEid],
    } : undefined,
    room: roomName,
    arousal: Mind.arousal[agentEid] ?? 0.5,
    focus: Mind.focus[agentEid] || "",
    mode: Mind.mode[agentEid] || "reactive",
    active: Agent.active[agentEid] ?? true,
    health: hasComponent(world, agentEid, Health) ? Health.current[agentEid] : undefined,
    goalCount: goals.length,
    thoughtCount: thoughts.length,
    stuckTicks: 0,
    ...(recentAttempts ? { recentAttempts } : {}),
    coordination: getCoordinationMemory(world, agentEid).items.length ? formatCoordinationContext(world, agentEid) : undefined,
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
  // Concerns carry no canned text: the daemon voices them in the person's own
  // inner voice (see buildDaemonWhisperPrompt), grounded in their life.

  // Stationary work, listening and rest are not evidence of failure. Repeated
  // executor failures warrant reconsidering an approach, not abandoning a goal.
  if (current.active && current.recentAttempts?.status === "failed" && current.recentAttempts.consecutiveFailures >= 2) {
    concerns.push({
      type: "stuck",
      severity: "medium",
      description: `${agentName}'s last ${current.recentAttempts.consecutiveFailures} physical attempts failed.`,
    });
  }

  // Check for high arousal (overwhelmed)
  if (current.arousal > 0.9) {
    concerns.push({
      type: "high_arousal",
      severity: "medium",
      description: `${agentName}'s activation is high (arousal: ${current.arousal.toFixed(2)}); its meaning depends on the situation.`,
    });
  }

  // Check for danger (low health)
  if (current.health !== undefined && current.health < 30) {
    concerns.push({
      type: "danger",
      severity: current.health < 10 ? "high" : "medium",
      description: `${agentName} is injured (health: ${current.health})`,
    });
  }

  // No explicit goal is valid during rest or an unstructured interval. The
  // actor's cognition, not this observer, decides whether to choose a goal.

  // Check for inactive agent
  if (!current.active) {
    concerns.push({
      type: "confusion",
      severity: "high",
      description: `${agentName} has become inactive`,
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

  // Retained legacy field: now an observed failure signal, never a novelty quota.
  metrics.stagnationScore = current.active && hasRepeatedPhysicalFailures(current.recentAttempts) ? 1 : 0;
  if (!previous) return;

  // Check for goal changes
  if (current.goalCount !== previous.goalCount) {
    metrics.lastGoalChange = now;
    stampDaemonTime(daemon, "lastGoalChange", now);
  }

  // Check for focus changes (proxy for belief/thought changes)
  if (current.focus !== previous.focus && current.focus !== "") {
    metrics.lastBeliefChange = now;
    stampDaemonTime(daemon, "lastBeliefChange", now);
  }

  // Check for room changes (proxy for relationship opportunities)
  if (current.room !== previous.room) {
    metrics.lastRelationshipChange = now;
    stampDaemonTime(daemon, "lastRelationshipChange", now);
  }

  // Time since these proxy observations is telemetry, not proof of a belief,
  // relationship change, or need to replace an actor's ongoing intention.
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

  const hoursSinceGoal = daemonAge(daemon, "lastGoalChange", metrics.lastGoalChange) / (60 * 60 * 1000);
  const hoursSinceBelief = daemonAge(daemon, "lastBeliefChange", metrics.lastBeliefChange) / (60 * 60 * 1000);
  const hoursSinceRelationship = daemonAge(daemon, "lastRelationshipChange", metrics.lastRelationshipChange) / (60 * 60 * 1000);

  if (hoursSinceGoal > 0.1) {  // 6 minutes in simulation time
    suggestions.push(`${daemon.agentName}'s active goal count has not changed recently; this does not establish lack of progress`);
  }

  if (hoursSinceBelief > 0.05) {  // 3 minutes
    suggestions.push(`${daemon.agentName}'s focus has remained stable; belief change is not measured here`);
  }

  if (hoursSinceRelationship > 0.15) {  // 9 minutes
    suggestions.push(`${daemon.agentName} has stayed in the same room; relationship change is not measured here`);
  }

  if (suggestions.length === 0) {
    return `${daemon.agentName}: these change intervals alone do not establish a need for intervention`;
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
  // Readiness is a meaningful recovery/change, not a permanent demand to seek
  // novelty whenever a healthy actor has an ordinary active goal.
  const ready = (state: AgentStateSnapshot) => state.active && state.health !== undefined && state.health > 80
    && state.arousal > 0.4 && state.arousal < 0.7 && state.goalCount > 0;
  if (previous && ready(current) && !ready(previous) && concernLevel < 0.3 && current.recentAttempts?.status !== "pending") {
    opportunities.push({
      type: "ready_for_challenge", description: `${agentName}'s condition now permits renewed engagement with an existing goal.`,
      suggestedChallenge: "Does returning to what you wanted to do fit how you feel now?", urgency: "medium",
    });
  }
  if (current.active && current.goalCount > 0 && current.recentAttempts?.status === "failed"
    && current.recentAttempts.consecutiveFailures >= 2) {
    opportunities.push({
      type: "skill_plateau", description: `${agentName} has recent failed physical attempts; consider whether they affect the current goal.`,
      suggestedChallenge: "What have these attempts told you about the obstacle?", urgency: "medium",
    });
  }
  // Calmness, an unchanged goal count and a fixed position establish neither
  // complacency nor a need for conflict or relationship tests.
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
  stampDaemonTime(daemon, "arc.lastProgress", now);
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
export function checkArcStagnation(daemon: DaemonState, current?: AgentStateSnapshot): boolean {
  const arc = daemon.narrativeArc;

  // Dormant arcs don't stagnate
  if (arc.status === "dormant") { arc.needsSelfResolution = false; return false; }

  // The legacy threshold unit was one ten-second observation. Count lived
  // duration, not observation/model-completion callbacks, in a bound world.
  arc.ticksSinceProgress = daemonWorlds.has(daemon)
    ? Math.floor(daemonAge(daemon, "arc.lastProgress", arc.lastProgressTimestamp) / 10_000)
    : arc.ticksSinceProgress + 1;

  const world = daemonWorlds.get(daemon);
  const state = current ?? (world ? collectAgentState(world, daemon.agentEid) : daemon.lastAgentState);
  // A due review is not evidence of blockage. Even failure evidence does not
  // establish that the failure belonged to this narrative arc or goal.
  arc.needsSelfResolution = !!state?.active && hasRepeatedPhysicalFailures(state.recentAttempts)
    && arc.ticksSinceProgress >= arc.stagnationThreshold;
  return arc.needsSelfResolution;
}

/**
 * Explicit legacy review helper. Native observations use guarded concerns
 * instead. A review cannot choose an ending or abandon an actor's intention.
 */
export function attemptSelfResolution(daemon: DaemonState): NarrativeNudge | null {
  if (!checkArcStagnation(daemon)) return null;
  daemon.narrativeArc.selfResolutionAttempts++;
  return {
    id: `self_review_${randomUUID()}`,
    type: "reflect",
    action: "What have the failed attempts shown you? Does another approach fit what you still want?",
    reason: "Recent physical attempts failed; their relevance to this arc needs review",
    source: "god",
    timestamp: Date.now(),
    priority: "low",
  };
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
  stampDaemonTime(daemon, "arc.lastProgress", arc.lastProgressTimestamp);
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
  stampDaemonTime(daemon, "arc.lastProgress", arc.lastProgressTimestamp);

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
    lines.push(`Recent physical attempts failed; review relevance to this arc. No ending is implied.`);
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
  const previousState = daemon.lastAgentState;

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

  // Record a review signal only. Actual failed attempts already enter the
  // normal, guarded concern path; do not add a second timer-driven controller.
  checkArcStagnation(daemon, currentState);

  // Prune memory periodically (every 10 observations)
  if (daemon.observationCount % 10 === 0) {
    pruneMemory(daemon);
  }

  // All comparisons above need the previous observation, not the new snapshot.
  daemon.lastAgentState = currentState;
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
    previousState,
    concerns,
    growthOpportunities,
    achievements,
    timestamp: Date.now(),
  };
}

// =============================================================================
// INNER VOICE (persona- and story-aware whispers)
// =============================================================================

/** Author-side story rows relevant to one resident. The resident never sees
 * this ledger; the daemon uses it only to feel which way the pressure runs. */
export interface DaemonStoryLedger {
  phase?: string;
  tension?: number;
  tensionTarget?: number;
  threads: { name: string; description: string; status?: string }[];
  questions: string[];
  arc?: string;
  foreshadowing: string[];
}

/** The person this daemon belongs to, read from their own mind and history. */
export interface DaemonPersona {
  name: string;
  role?: string;
  character?: string;
  background?: string;
  drives: string[];
  aspirations: string[];
  privateHistory: string[];
  beliefs: string[];
  goals: string[];
  focus?: string;
  feeling?: string;
  body: string[];
  place?: string;
  company: string[];
  recentExperiences: string[];
}

export interface DaemonWhisperInput {
  persona: DaemonPersona;
  ledger?: DaemonStoryLedger;
  /** Something the daemon itself noticed (injury, repeated failure...). */
  pressing?: string;
  /** The Narrator's current pull on this person, to voice as their own impulse. */
  pull?: string;
  idle?: boolean;
  recentWhispers: readonly string[];
}

const clip = (value: unknown, limit: number) => {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};
function attempt<T>(read: () => T): T | undefined { try { return read(); } catch { return undefined; } }
const unique = (rows: readonly string[], limit: number) => [...new Set(rows.map(row => row.trim()).filter(Boolean))].slice(0, limit);

/** Everything here is the resident's own: their authored past, live goals,
 * feelings, memories and what they have perceived. No one else's private mind. */
export function buildDaemonPersona(world: World, agentEid: number): DaemonPersona {
  const name = Name.value[agentEid] || `Agent_${agentEid}`;
  const seed = attempt(() => getWorldCharacterSeed(world, name));
  const context = attempt(() => getCharacterContext(world, agentEid));
  const local = attempt(() => getLocalOpportunityContext(world, agentEid));
  const affect = attempt(() => snapshotAffect(world, agentEid));
  const room = getRoomForEntity(world, agentEid);
  const goals = safeGetRelationTargets(world, agentEid, HasGoal)
    .filter(goal => hasComponent(world, goal, Goal) && Goal.status[goal] === "active")
    .sort((a, b) => (Goal.priority[b] ?? 0) - (Goal.priority[a] ?? 0))
    .map(goal => clip(Goal.description[goal], 200));
  const needs = context?.needs, body: string[] = [];
  if (needs) {
    if (needs.hunger >= 60) body.push(needs.hunger >= 80 ? "very hungry" : "hungry");
    if (needs.energy <= 40) body.push(needs.energy <= 20 ? "exhausted" : "tired");
    if (needs.social <= 35) body.push("lonely");
    if (needs.comfort <= 30) body.push("uncomfortable");
  }
  const recent = getAgentPerceptions(world, agentEid)
    .filter(id => !["daemon_whisper", "daemon_challenge"].includes(Perception.type[id]) && Perception.content[id])
    .sort((a, b) => (Perception.timestamp[a] ?? 0) - (Perception.timestamp[b] ?? 0))
    .slice(-6).map(id => clip(Perception.content[id], 220));
  const past = seed?.past;
  return {
    name,
    role: clip(Agent.role[agentEid] || seed?.role, 200) || undefined,
    character: clip(Agent.systemPrompt[agentEid] || seed?.systemPrompt, 900) || undefined,
    background: clip(past?.background ?? Description.value[agentEid], 1400) || undefined,
    drives: unique([...(past?.drives ?? []), ...(context?.coreDrives ?? []).map(String)].map(row => clip(row, 180)), 5),
    aspirations: unique((context?.aspirations ?? []).map(row => clip(String(row), 180)), 4),
    privateHistory: unique([
      ...(context?.identityAnchors ?? []).map(row => clip(`${row.recollection} (${row.meaning})`, 360)),
      ...[...(past?.memories ?? [])].sort((a, b) => b.importance - a.importance).map(row => clip(`${row.recollection} (${row.meaning})`, 360)),
    ], 4),
    beliefs: unique((context?.beliefs ?? []).map(row => clip(`${row.subject} ${row.predicate} ${row.object}`, 200)), 4),
    goals: unique(goals, 3),
    focus: clip(Mind.focus[agentEid], 200) || undefined,
    feeling: affect ? clip(`${affect.feeling}${affect.reason ? ` — ${affect.reason}` : ""}`, 240) : undefined,
    body,
    place: room === undefined ? undefined : clip(Name.value[room], 120),
    company: unique((local?.visiblePeople ?? []).map(row => String(row.name ?? "")), 6),
    recentExperiences: recent,
  };
}

/** Read the Narrator's ledger (duck-typed: newer ledgers may add dramatic
 * questions, foreshadowing or a tension target). Absent fields degrade quietly. */
export function readDaemonStoryLedger(spiritRegistry: SpiritRegistry | undefined, agentName: string): DaemonStoryLedger | undefined {
  const eid = spiritRegistry?.byName.get("The Narrator");
  const state = eid === undefined ? undefined : spiritRegistry!.spirits.get(eid)?.narrativeState as (NarrativeState & Record<string, unknown>) | undefined;
  if (!state) return undefined;
  const lower = agentName.toLowerCase();
  const pattern = new RegExp(`\\b${agentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const named = (list: unknown) => Array.isArray(list) && list.some(item => typeof item === "string" && item.toLowerCase() === lower);
  const involves = (row: any) => typeof row === "string" ? pattern.test(row)
    : !!row && (named(row.participants) || named(row.characters) || named(row.residents) || named(row.involves)
      || [row.name, row.title, row.description, row.question, row.text, row.summary].some(value => typeof value === "string" && pattern.test(value)));
  const open = (row: any) => !row || typeof row === "string" || !["resolved", "abandoned", "answered", "closed", "paid_off"].includes(String(row.status ?? ""));
  const text = (row: any) => typeof row === "string" ? row : row?.question ?? row?.text ?? row?.description ?? row?.summary ?? row?.name ?? "";
  const list = (value: unknown) => Array.isArray(value) ? value : [];
  const threads = [...list(state.plotThreads), ...list(state.threads)].filter(row => open(row) && involves(row)).slice(0, 4)
    .map((row: any) => ({ name: clip(row.name ?? row.title ?? "", 120), description: clip(row.description ?? row.summary ?? "", 400),
      ...(row.status ? { status: String(row.status) } : {}) }));
  const questions = list(state.dramaticQuestions).filter(row => open(row) && involves(row)).map(row => clip(text(row), 240)).filter(Boolean).slice(0, 3);
  const foreshadowing = list(state.foreshadowing).filter(row => open(row) && involves(row)).map(row => clip(text(row), 240)).filter(Boolean).slice(0, 3);
  const arcRow = list(state.characterArcs).find((row: any) => typeof row?.entityName === "string" && row.entityName.toLowerCase() === lower) as any;
  const arc = arcRow ? clip(`${arcRow.arcType ?? "arc"}: ${arcRow.currentState ?? ""}${arcRow.desiredEndState ? ` → ${arcRow.desiredEndState}` : ""}`, 300) : undefined;
  const target = typeof state.tensionTarget === "number" && Number.isFinite(state.tensionTarget) ? state.tensionTarget : undefined;
  return { ...(state.currentPhase ? { phase: String(state.currentPhase) } : {}),
    ...(Number.isFinite(state.tension) ? { tension: state.tension } : {}), ...(target !== undefined ? { tensionTarget: target } : {}),
    threads, questions, foreshadowing, ...(arc ? { arc } : {}) };
}

/** The daemon's whisper prompt: persona first, story pressure second, one line
 * of how to answer. Privacy between residents is stated once, positively. */
export function buildDaemonWhisperPrompt(input: DaemonWhisperInput): string {
  const p = input.persona, n = p.name, lines: string[] = [];
  const row = (label: string, value: string | undefined) => { if (value) lines.push(`- ${label}: ${value}`); };
  lines.push(`You are ${n}'s daemon: the voice inside ${n}'s own head. Not a guide, not a narrator. You are the private part of ${n} that notices, wants, dreads, remembers and tempts.`, "", `WHO ${n.toUpperCase()} IS`);
  row("Character", p.character);
  row("Role", p.role);
  row("Background", p.background);
  row("What drives them", p.drives.join("; "));
  row("What they hope for", p.aspirations.join("; "));
  row("Carried privately", p.privateHistory.join(" | "));
  row("What they believe", p.beliefs.join("; "));
  row("What they want right now", p.goals.join("; "));
  row("On their mind", p.focus);
  row("Feeling", [p.feeling, p.body.length ? `body: ${p.body.join(", ")}` : ""].filter(Boolean).join("; "));
  row("Where", p.place ? `${p.place}${p.company.length ? `, with ${p.company.join(", ")} in sight` : ", no one else in sight"}` : undefined);
  row("Lately", p.recentExperiences.join(" | "));
  const ledger = input.ledger;
  if (ledger || input.pull || input.pressing || input.idle) {
    lines.push("", `THE STORY PRESSING ON ${n.toUpperCase()} (the author's ledger. ${n} does not know it, but can feel its pull)`);
    if (ledger) {
      row("Story", [ledger.phase, ledger.tension !== undefined ? `tension ${ledger.tension.toFixed(2)}${ledger.tensionTarget !== undefined ? ` (aiming for ${ledger.tensionTarget.toFixed(2)})` : ""}` : ""].filter(Boolean).join(", "));
      row("Threads through their life", ledger.threads.map(t => `${t.name}${t.description ? `: ${t.description}` : ""}`).join(" | "));
      row("Open questions", ledger.questions.join(" | "));
      row("Their arc", ledger.arc);
      row("Foreshadowing", ledger.foreshadowing.join(" | "));
    }
    if (input.pull) lines.push(`- The story is leaning ${n} toward this: "${clip(input.pull, 500)}". Voice it as ${n}'s own impulse, a want or an itch or a dare, felt from inside their life.`);
    if (input.pressing) lines.push(`- Pressing right now: ${clip(input.pressing, 300)}`);
    if (input.idle) lines.push(`- ${n} has been waiting and idling. Stir something: a reason to move, to speak, to look closer, to act.`);
  }
  if (input.recentWhispers.length) lines.push("", `Already whispered (find something new): ${input.recentWhispers.map(w => `"${w}"`).join(" ")}`);
  lines.push("",
    `Whisper one thing now: an impulse, a doubt, a temptation, a half-memory, a flicker of dread or of courage. Second person, present tense, in ${n}'s own inner voice, specific to their people, objects, wants and fears. It can needle, tempt, comfort or accuse. The register, not the content: "You could tell her about the box. You won't, will you."`,
    "",
    `Whispers come from ${n}'s own life and feelings: what ${n} remembers, wants, suspects and fears. Other people's secrets stay theirs; a hunch about someone is welcome, their private facts are not. Speak of the world as ${n} has seen, heard or remembered it.`,
    "",
    "Answer with the whisper only: one or two short sentences, under 30 words.");
  return lines.join("\n");
}

const lowerFirst = (text: string) => text ? text[0].toLowerCase() + text.slice(1) : text;
/** Deterministic inner voice when no model is available. It speaks only from
 * the person's own goals, drives and remembered meanings (never the ledger). */
export function composeFallbackWhisper(input: DaemonWhisperInput, turn = 0): string {
  const p = input.persona, goal = p.goals[0], drive = p.drives[turn % Math.max(1, p.drives.length)];
  const memory = p.privateHistory[turn % Math.max(1, p.privateHistory.length)];
  const options: string[] = [];
  if (input.pull) options.push(`Something in you keeps turning toward it: ${clip(input.pull, 200)}`);
  if (input.idle && goal) options.push(`You have been standing still too long. ${clip(goal, 160)}. It will not happen by itself.`);
  if (goal) options.push(`You still have not done it: ${lowerFirst(clip(goal, 160))}. What are you waiting for?`);
  if (drive) options.push(`${clip(drive, 160)}. Is that still true tonight?`);
  if (memory) options.push(`You remember it again, whether you want to or not: ${clip(memory, 200)}`);
  if (input.idle) options.push("Too long in one place. Go and find someone. Say the thing.");
  if (!options.length) options.push("Something is waiting for you to notice it.");
  return options[turn % options.length];
}

function sanitizeWhisper(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  if (!text || /^(none|nothing|empty|n\/a)\.?$/i.test(text)) return "";
  return text.length > 320 ? `${text.slice(0, 319)}…` : text;
}

async function generateWhisperText(input: DaemonWhisperInput, registry: DaemonRegistry | undefined, turn: number): Promise<string> {
  if (registry && !registry.useModel) return composeFallbackWhisper(input, turn);
  const result = await generateText({ model: daemonModel, prompt: buildDaemonWhisperPrompt(input), temperature: 0.9 });
  return sanitizeWhisper(result.text);
}

function innerVoiceState(daemon: DaemonState) {
  daemon.innerVoice ??= { count: 0, recent: [] };
  return daemon.innerVoice;
}

/** Waiting/resting share of recent choices, or an explicitly waiting mind. */
export function isDaemonAgentIdle(world: World, agentEid: number): boolean {
  const recent = getRecentActions(agentEid, world).slice(-8);
  const idleShare = recent.length ? recent.filter(action => IDLE_ACTIONS.has(action)).length / recent.length : 0;
  return recent.length >= 3 && idleShare >= 0.5 || ["waiting", "idle"].includes(Mind.mode[agentEid] ?? "");
}

/** Simulation-time pacing: roughly every 30-60s when active, sooner when idle.
 * First whispers are staggered so a cast does not all hear voices at once. */
export function isInnerVoiceDue(world: World, daemon: DaemonState, registry: DaemonRegistry): boolean {
  if (!registry.innerVoice || !daemon.active) return false;
  const now = readSimulationTime(world);
  if (!Number.isFinite(now) || now < 0) return false;
  if (daemon.lastWhisper && daemonAge(daemon, "lastWhisper", daemon.lastWhisper) < registry.whisperCooldown) return false;
  const state = innerVoiceState(daemon), idle = isDaemonAgentIdle(world, daemon.agentEid);
  const cadence = (idle ? registry.innerVoiceCadenceMs.idle : registry.innerVoiceCadenceMs.active)
    + ((daemon.agentEid * 7 + state.count * 13) % 5) * 3_000;
  // First voice lands 6-27s into the run (staggered by resident), or at once
  // for a daemon that joins later; a rewound clock restarts the stagger.
  if (state.lastAtSimMs === undefined || state.lastAtSimMs > now)
    state.lastAtSimMs = 6_000 + (daemon.agentEid % 8) * 3_000 - cadence;
  return now - state.lastAtSimMs >= cadence;
}

function whisperObservation(daemon: DaemonState): DaemonObservation {
  return { agentName: daemon.agentName, currentState: daemon.lastAgentState ?? { timestamp: Date.now(), arousal: 0.5, focus: "", mode: "",
    active: true, goalCount: 0, thoughtCount: 0, stuckTicks: 0 }, previousState: null, concerns: [], growthOpportunities: [], achievements: [], timestamp: Date.now() };
}

function recordInnerVoice(world: World, daemon: DaemonState, content: string, details: { idle: boolean; story: boolean; pulled: boolean }): void {
  const state = innerVoiceState(daemon);
  state.count++; state.lastAtSimMs = readSimulationTime(world);
  state.recent = [...state.recent, content].slice(-4);
  daemon.lastWhisper = Date.now();
  stampDaemonTime(daemon, "lastWhisper", daemon.lastWhisper);
  daemon.whisperCount++;
  // Transport diagnostics only: no whisper text (private cognition) is recorded.
  chronicle.record("daemon_inner_voice", { agent: daemon.agentName, actorKey: workingMemoryEntityRef(world, daemon.agentEid)?.key,
    sourceId: getCommittedSource(world).sourceId, atSimMs: readSimulationTime(world), ...details }, "Daemon inner voice delivered");
}

/**
 * The daemon's own whisper: persona- and story-aware, delivered as a private
 * perception. A whisper is an impulse the resident may follow or ignore; it
 * never selects an action, creates a goal or publishes anything.
 */
export async function whisperInnerVoice(
  world: World,
  daemon: DaemonState,
  registry: DaemonRegistry,
  spiritRegistry?: SpiritRegistry,
  options: { pressing?: string } = {}
): Promise<DaemonWhisper | null> {
  assertSimulationTaskActive();
  // Offstage minds keep living on their own cadence; the model-voiced inner voice
  // is spent where the observer is. A Narrator nudge (pressing) still gets through.
  if (!options.pressing && readAttention(world, daemon.agentEid).tier === "offstage") return null;
  const scope = captureWhisperScope(world, daemon, whisperObservation(daemon), registry);
  if (!scope.current()) return null;
  const idle = isDaemonAgentIdle(world, daemon.agentEid), ledger = readDaemonStoryLedger(spiritRegistry, daemon.agentName);
  const state = innerVoiceState(daemon);
  const input: DaemonWhisperInput = { persona: buildDaemonPersona(world, daemon.agentEid), ledger, idle,
    ...(options.pressing ? { pressing: options.pressing } : {}), recentWhispers: [...state.recent] };
  // Reserve this turn before awaiting, so a slow provider cannot start a duplicate.
  state.lastAtSimMs = readSimulationTime(world);
  let content: string;
  try { content = await generateWhisperText(input, registry, state.count); }
  catch { assertSimulationTaskActive(); return null; } // Provider failure is silence, not a canned line.
  assertSimulationTaskActive();
  if (!content || state.recent.includes(content) || !scope.latest() || !scope.current()) return null;
  if (!queueGuardedStimulus(world, { targetEid: daemon.agentEid, type: "daemon_whisper", modality: "cognitive", content,
    source: "inner_voice", intensity: INNER_VOICE_INTENSITY }, () => scope.current())) return null;
  recordInnerVoice(world, daemon, content, { idle, story: !!ledger && (ledger.threads.length + ledger.questions.length) > 0, pulled: false });
  return { agentEid: daemon.agentEid, content, type: "observation", timestamp: Date.now() };
}

/**
 * Voice one scoped Narrator nudge in the resident's inner voice. The nudge's
 * receipt is taken before inference (no double delivery) and rechecked before
 * delivery; if the model has nothing, the nudge's own wording is delivered.
 */
async function voiceScopedNarrativeNudge(registry: DaemonRegistry, daemon: DaemonState, world: World,
  spiritRegistry?: SpiritRegistry): Promise<number> {
  assertSimulationTaskActive();
  discardInvalidScopedNudges(daemon, world, registry);
  if (daemon.lastWhisper && daemonAge(daemon, "lastWhisper", daemon.lastWhisper) < registry.whisperCooldown) return 0;
  const rank = { high: 0, normal: 1, low: 2 };
  const nudge = daemon.pendingNudges.filter(row => isScopedNudge(row) && shouldApplyNudge(daemon, row))
    .sort((a, b) => rank[a.priority] - rank[b.priority])[0];
  const receipt = nudge && scopedNudges.get(nudge);
  if (!nudge || !receipt) return 0;
  daemon.pendingNudges = daemon.pendingNudges.filter(row => row !== nudge);
  if (!scopedNudgeCurrent(daemon, world, nudge, registry)) { recordScopedNudgeLifecycle(nudge, "dropped"); return 0; }
  receipt.consumed = true;
  const state = innerVoiceState(daemon), idle = isDaemonAgentIdle(world, daemon.agentEid);
  const ledger = readDaemonStoryLedger(spiritRegistry, daemon.agentName);
  const input: DaemonWhisperInput = { persona: buildDaemonPersona(world, daemon.agentEid), ledger, idle,
    pull: nudge.reason ? `${nudge.action} (${nudge.reason})` : nudge.action, recentWhispers: [...state.recent] };
  state.lastAtSimMs = readSimulationTime(world);
  let content = "";
  try { content = await generateWhisperText(input, registry, state.count); }
  catch { /* The nudge itself was already evaluated advice; deliver its wording. */ }
  assertSimulationTaskActive();
  if (!scopedNudgeCurrent(daemon, world, nudge, registry, true)) { recordScopedNudgeLifecycle(nudge, "dropped"); return 0; }
  content ||= convertNudgeToWhisper(daemon, nudge)!.content;
  const perceptionEid = addPerception(world, daemon.agentEid, { type: "daemon_whisper", content, source: "inner_voice", intensity: INNER_VOICE_INTENSITY });
  assertSimulationTaskActive();
  if (perceptionEid >= 0) recordInnerVoice(world, daemon, content, { idle, story: !!ledger && (ledger.threads.length + ledger.questions.length) > 0, pulled: true });
  recordScopedNudgeLifecycle(nudge, "converted");
  recordScopedNudgeLifecycle(nudge, perceptionEid >= 0 ? "perception_delivered" : "dropped", perceptionEid >= 0 ? perceptionEid : undefined);
  return perceptionEid >= 0 ? 1 : 0;
}

// =============================================================================
// WHISPERS (Guidance to Agents)
// =============================================================================

const whisperCycles = new WeakMap<DaemonState, object>();
function captureWhisperScope(world: World, daemon: DaemonState, observation: DaemonObservation, registry?: DaemonRegistry) {
  assertSimulationTaskActive();
  const eid = daemon.agentEid, actor = workingMemoryEntityRef(world, eid), persona = nudgePersona(eid);
  const source = getCommittedSource(world), at = readSimulationTime(world), signal = getSimulationTaskSignal();
  // A real advisory dispatch can precede sim.start(). Capture its first epoch
  // before inference, not during mailbox admission after the guard was taken.
  // A stopped source remains stopped; only the host may explicitly restart it.
  const sourceId = source.sourceId ?? (source.stopped ? null : startCommittedEvents(world));
  const token = {}; whisperCycles.set(daemon, token);
  const focus = Mind.focus[eid], x = GridPosition.x[eid], y = GridPosition.y[eid];
  const current = () => {
    const live = getCommittedSource(world), now = readSimulationTime(world);
    return !signal?.aborted && !source.stopped && !live.stopped && sourceId === live.sourceId
      && Number.isFinite(at) && Number.isFinite(now) && now >= at && !!actor
      && daemonWorlds.get(daemon) === world && daemon.active && daemon.agentEid === eid
      && (!registry || registry.daemons.get(eid) === daemon)
      && entityExists(world, eid) && !hasComponent(world, eid, Removed) && hasComponent(world, eid, Agent) && hasComponent(world, eid, Name) && Agent.active[eid]
      && hasComponent(world, eid, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[eid] === actor.key
      && nudgePersona(eid) === persona && daemon.agentName === actor.label && observation.agentName === actor.label
      // A possessed (or mindless visitor) body hears no inner voice, even one already in flight.
      && !hasOwnMindSuspended(world, eid);
    // The inner voice travels with its person; changing rooms mid-thought does
    // not silence it. Concern-specific whispers keep their own evidence checks.
  };
  const sameActivity = () => Mind.focus[eid] === focus && GridPosition.x[eid] === x && GridPosition.y[eid] === y;
  const activeGoals = () => safeGetRelationTargets(world, eid, HasGoal).filter(goal => hasComponent(world, goal, Goal) && Goal.status[goal] === "active").length;
  const concernCurrent = (type: DaemonConcern["type"]) => {
    if (type === "stuck") {
      const attempts = collectAgentState(world, eid)?.recentAttempts;
      return attempts?.status === "failed" && attempts.consecutiveFailures >= 2;
    }
    if (type === "danger") return hasComponent(world, eid, Health) && Health.current[eid] < 30;
    if (type === "low_arousal") return hasComponent(world, eid, Mind) && Mind.arousal[eid] < 0.2;
    if (type === "high_arousal") return hasComponent(world, eid, Mind) && Mind.arousal[eid] > 0.9;
    if (type === "goal_drift") return activeGoals() === 0;
    return sameActivity(); // Authored confusion/isolation needs richer evidence, not invented predicates.
  };
  const opportunityCurrent = (type: GrowthOpportunity["type"]) => {
    const arousal = Mind.arousal[eid], health = hasComponent(world, eid, Health) ? Health.current[eid] : undefined;
    if (registry && (registry.simulationTension > 0.85 || registry.simulationTension > 0.7
      && !observation.growthOpportunities.some(item => item.type === type && item.urgency === "high"))) return false;
    if (type === "ready_for_challenge") return !!health && health > 80 && arousal > 0.4 && arousal < 0.7 && activeGoals() > 0;
    if (type === "breakthrough_possible") return !!health && health > 50 && arousal > 0.7 && arousal < 0.85 && activeGoals() > 0;
    if (type === "skill_plateau" || type === "stagnating") {
      const attempts = collectAgentState(world, eid)?.recentAttempts;
      return attempts?.status === "failed" && attempts.consecutiveFailures >= 2 && activeGoals() > 0;
    }
    return sameActivity();
  };
  return { current, latest: () => whisperCycles.get(daemon) === token, concernCurrent, opportunityCurrent };
}

/**
 * Generate and send a whisper to an agent
 */
export async function whisperToAgent(
  world: World,
  daemon: DaemonState,
  observation: DaemonObservation,
  forceWhisper: boolean = false,
  registry?: DaemonRegistry,
  spiritRegistry?: SpiritRegistry
): Promise<DaemonWhisper | null> {
  const scope = captureWhisperScope(world, daemon, observation, registry);
  if (!scope.current()) return null;
  const now = Date.now();
  let evidenceCurrent = () => true;

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
    const topConcern = [...observation.concerns].sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    })[0];
    const concernType = topConcern.type;
    evidenceCurrent = () => scope.concernCurrent(concernType);
    if (!evidenceCurrent()) return null;

    if (topConcern.suggestedWhisper) {
      whisperContent = topConcern.suggestedWhisper;
      whisperType = topConcern.type === "danger" ? "warning" :
                    topConcern.type === "stuck" ? "guidance" : "observation";
    } else {
      // The person's own inner voice, with the concern as what is pressing.
      try {
        const state = innerVoiceState(daemon);
        whisperContent = await generateWhisperText({ persona: buildDaemonPersona(world, daemon.agentEid),
          ledger: readDaemonStoryLedger(spiritRegistry, daemon.agentName), pressing: topConcern.description,
          recentWhispers: [...state.recent] }, registry, state.count);
        whisperType = "guidance";
      } catch (error) {
        assertSimulationTaskActive();
        return null; // Provider failure is not a reason for a new inner suggestion.
      }
    }
  } else if (observation.achievements.length > 0) {
    whisperType = "encouragement";
    whisperContent = "You're doing well. Keep going.";
  }

  assertSimulationTaskActive();
  if (!whisperContent || !scope.latest() || !scope.current() || !evidenceCurrent()) return null;

  // Send whisper as cognitive stimulus
  if (!queueGuardedStimulus(world, {
    targetEid: daemon.agentEid,
    type: "daemon_whisper",
    modality: "cognitive",
    content: whisperContent,
    source: "inner_voice",
    intensity: INNER_VOICE_INTENSITY,
  }, () => scope.current() && evidenceCurrent())) return null;

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
  forceWhisper: boolean = false,
  spiritRegistry?: SpiritRegistry
): Promise<ChallengeWhisper | null> {
  const scope = captureWhisperScope(world, daemon, observation, registry);
  if (!scope.current()) return null;
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
  const topOpportunity = [...observation.growthOpportunities].sort((a, b) => {
    const urgencyOrder = { high: 0, medium: 1, low: 2 };
    return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
  })[0];
  const opportunityType = topOpportunity.type;
  const evidenceCurrent = () => scope.opportunityCurrent(opportunityType);
  if (!evidenceCurrent()) return null;

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
    const state = innerVoiceState(daemon);
    challengeContent = await generateWhisperText({ persona: buildDaemonPersona(world, daemon.agentEid),
      ledger: readDaemonStoryLedger(spiritRegistry, daemon.agentName),
      pressing: `${topOpportunity.description} The angle is ${challengeType}: dare them.`,
      recentWhispers: [...state.recent] }, registry, state.count);
  } catch (error) {
    assertSimulationTaskActive();
    return null;
  }

  assertSimulationTaskActive();
  if (!challengeContent || !scope.latest() || !scope.current() || !evidenceCurrent()) return null;

  // Send challenge whisper as cognitive stimulus (higher intensity than guidance)
  if (!queueGuardedStimulus(world, {
    targetEid: daemon.agentEid,
    type: "daemon_challenge",
    modality: "cognitive",
    content: challengeContent,
    source: "inner_voice",
    intensity: 0.5,  // Stronger than guidance whispers
  }, () => scope.current() && evidenceCurrent())) return null;

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
  if (observation.currentState.coordination) {
    lines.push("- Private coordination account (inspect blockers before proposing world changes):");
    lines.push(observation.currentState.coordination);
  }
  if (observation.currentState.health !== undefined) {
    lines.push(`- Health: ${observation.currentState.health}`);
  }

  // Mini-narrator signal so GodAI can drive story progression intentionally.
  const activePlan = daemon.memory.activePlans.find((p) => p.status === "active" || p.status === "planned");
  const unresolvedMemory = daemon.memory.keyMemories.filter((m) => !m.resolved).slice(-1)[0];
  const pendingNudge = daemon.pendingNudges[0];
  if (
    daemon.narrativeArc.status !== "dormant" ||
    activePlan ||
    unresolvedMemory ||
    pendingNudge
  ) {
    lines.push("");
    lines.push("### Character Story Arc (Daemon POV):");
    lines.push(`- Arc: ${daemon.narrativeArc.theme || "daily life"} [${daemon.narrativeArc.status}]`);
    lines.push(`- Arc tension: ${(daemon.narrativeArc.tension * 100).toFixed(0)}%`);
    if (daemon.narrativeArc.drivingGoal) {
      lines.push(`- Driving goal: ${daemon.narrativeArc.drivingGoal}`);
    }
    if (activePlan) {
      lines.push(`- Active plan: ${activePlan.goal} [${activePlan.status}]`);
    }
    if (unresolvedMemory) {
      lines.push(`- Unresolved thread: ${unresolvedMemory.content}`);
    }
    if (pendingNudge) {
      lines.push(`- Immediate nudge: ${pendingNudge.type} -> ${pendingNudge.action}`);
    }
    if (daemon.narrativeArc.needsSelfResolution) {
      lines.push("- Review: recent physical attempts failed; check relevance to this arc before offering help");
    }
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
  assertSimulationTaskActive();
  const daemonsToRun = getDaemonsNeedingObservation(registry);

  let observations = 0;
  let whispers = 0;
  let challenges = 0;
  let reports = 0;

  // Transport already evaluated advice independently of slow observation.
  // Waiting for a fresh observation could hold valid advice for 30s while its
  // cited circumstances expire. Ordinary whisper cooldown and per-item scope
  // checks still apply; no observation or model call is accelerated here.
  const deliveredThisCycle = new Set<DaemonState>();
  for (const daemon of [...registry.daemons.values()]) {
    assertSimulationTaskActive();
    if (daemon.pendingNudges.length === 0) continue;
    // Operator-driven or mindless bodies get no whispers; pending nudges keep
    // their own scope checks and may still apply after release.
    if (hasOwnMindSuspended(world, daemon.agentEid)) continue;
    // A living world voices the Narrator's pull in the person's inner voice;
    // otherwise the already evaluated wording is delivered synchronously.
    const delivered = registry.innerVoice && registry.useModel
      ? await voiceScopedNarrativeNudge(registry, daemon, world, spiritRegistry)
      : deliverScopedNarrativeNudges(registry, daemon, world);
    whispers += delivered;
    if (delivered) deliveredThisCycle.add(daemon);
    if (getCommittedSource(world).stopped) return { observations, whispers, challenges, reports };
  }

  for (const daemon of daemonsToRun) {
    assertSimulationTaskActive();
    // Check if agent still exists
    if (!entityExists(world, daemon.agentEid)) {
      removeDaemon(registry, daemon.agentEid);
      continue;
    }

    const deliveredNudges = deliveredThisCycle.has(daemon);
    assertSimulationTaskActive();
    if (getCommittedSource(world).stopped) break;
    if (hasOwnMindSuspended(world, daemon.agentEid)) continue;

    // Observe
    const observation = observeAgent(world, daemon);
    if (!observation) continue;
    observations++;

    // Priority: concerns get guidance whispers, growth gets challenge whispers
    // If there are concerns, prioritize protective guidance
    if (!deliveredNudges && observation.concerns.length > 0) {
      const whisper = await whisperToAgent(world, daemon, observation, false, registry, spiritRegistry);
      if (whisper) { whispers++; deliveredThisCycle.add(daemon); }
    }
    // If no concerns but growth opportunities, push with challenge whispers
    else if (!deliveredNudges && observation.growthOpportunities.length > 0) {
      const challenge = await whisperChallenge(world, daemon, observation, registry, false, spiritRegistry);
      if (challenge) { challenges++; deliveredThisCycle.add(daemon); }
    }

    // Maybe report (includes both concerns AND growth opportunities for GodAI)
    if (spiritRegistry) {
      const report = reportToSuperiorSpirit(registry, spiritRegistry, daemon, observation);
      if (report) reports++;
    }
  }

  // The inner voice: each resident's daemon whispers on its own cadence,
  // sooner when the person has been waiting. Most overdue first, bounded.
  if (registry.innerVoice) {
    const now = readSimulationTime(world);
    const due = [...registry.daemons.values()].filter(daemon => !deliveredThisCycle.has(daemon)
      && entityExists(world, daemon.agentEid) && !hasOwnMindSuspended(world, daemon.agentEid) && isInnerVoiceDue(world, daemon, registry))
      .sort((a, b) => (a.innerVoice?.lastAtSimMs ?? now) - (b.innerVoice?.lastAtSimMs ?? now))
      .slice(0, Math.max(0, registry.innerVoiceMaxPerCycle));
    for (const daemon of due) {
      assertSimulationTaskActive();
      if (getCommittedSource(world).stopped) break;
      if (await whisperInnerVoice(world, daemon, registry, spiritRegistry)) whispers++;
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
      lines.push(`   Recent failed attempts warrant review, not forced resolution`);
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
  lines.push(`Recent repeated-failure signal: ${(metrics.stagnationScore * 100).toFixed(0)}%`);
  const minutesSinceGoal = Math.round(daemonAge(daemon, "lastGoalChange", metrics.lastGoalChange) / 60000);
  const minutesSinceBelief = Math.round(daemonAge(daemon, "lastBeliefChange", metrics.lastBeliefChange) / 60000);
  const minutesSinceRelationship = Math.round(daemonAge(daemon, "lastRelationshipChange", metrics.lastRelationshipChange) / 60000);
  lines.push(`Last active goal-count change: ${minutesSinceGoal}m ago`);
  lines.push(`Last focus change (not a belief measurement): ${minutesSinceBelief}m ago`);
  lines.push(`Last room change (not a relationship measurement): ${minutesSinceRelationship}m ago`);
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

// =============================================================================
// DAEMON POV NARRATIVE (Mini-Narrator Output)
// =============================================================================

function daemonMoodLabel(arousal: number): string {
  if (arousal >= 0.8) return "frayed";
  if (arousal >= 0.65) return "tense";
  if (arousal >= 0.5) return "alert";
  if (arousal >= 0.35) return "steady";
  return "quiet";
}

function computeDaemonStoryScore(daemon: DaemonState): number {
  let score = 0;
  score += daemon.concernLevel * 0.35;
  score += daemon.narrativeArc.tension * 0.35;
  if (daemon.narrativeArc.needsSelfResolution) score += 0.2;
  if (daemon.pendingNudges.length > 0) score += 0.15;
  if (daemon.memory.keyMemories.some((m) => !m.resolved)) score += 0.1;
  return score;
}

export function buildDaemonPovStory(daemon: DaemonState): DaemonPovStory | null {
  if (!daemon.active) return null;

  const state = daemon.lastAgentState;
  const arc = daemon.narrativeArc;
  const activePlan = daemon.memory.activePlans.find((p) => p.status === "active" || p.status === "planned");
  const unresolved = daemon.memory.keyMemories.filter((m) => !m.resolved).slice(-1)[0];
  const recentMoment = daemon.memory.characterMoments.slice(-1)[0];
  const nudge = daemon.pendingNudges[0];
  const arousal = state?.arousal ?? Math.min(1, 0.25 + daemon.concernLevel * 0.7);
  const mood = daemonMoodLabel(arousal);
  const room = state?.room || (recentMoment as any)?.location || "their corner of the world";
  const focus = state?.focus || activePlan?.goal || arc.drivingGoal || "the day ahead";

  const lines: string[] = [];
  lines.push(`The daemon observes ${daemon.agentName} in ${room}, with focus recorded as ${focus} and activation described as ${mood}.`);

  if (unresolved) {
    lines.push(`From the daemon's watch, one thread still bites: ${unresolved.content}.`);
  } else if (recentMoment) {
    lines.push(`A recent turn still lingers in their arc: ${recentMoment.description}.`);
  } else if (daemon.concernLevel > 0.45 || arc.tension > 0.45) {
    lines.push("The daemon can feel strain building beneath the routine, even if the cause is not yet visible.");
  } else {
    lines.push("The thread is quiet for now, but the daemon keeps watch for the next turn.");
  }

  if (activePlan) {
    lines.push(`The daemon records a plan: ${activePlan.goal}. This is not a completed action.`);
  } else if (arc.drivingGoal) {
    lines.push(`The arc still points toward ${arc.drivingGoal}.`);
  } else {
    lines.push("No plan is recorded here; this alone does not call for intervention.");
  }

  if (arc.needsSelfResolution || nudge) {
    const consideration = nudge?.action || "review whether the recent failed attempts affect the current intention";
    lines.push(`The daemon has an optional consideration, not an actor decision: ${consideration}.`);
  }

  const prose = lines.slice(0, 3).join(" ");
  const signature = [
    daemon.agentName,
    room,
    focus,
    arc.status,
    activePlan?.goal || "",
    unresolved?.content || "",
    nudge?.type || "",
  ].join("|");

  return {
    agentName: daemon.agentName,
    prose,
    signature,
    arcStatus: arc.status,
    tension: arc.tension,
    concernLevel: daemon.concernLevel,
    score: computeDaemonStoryScore(daemon),
    timestamp: Date.now(),
  };
}

export function collectDaemonPovStories(
  registry: DaemonRegistry,
  options: { maxStories?: number; minScore?: number } = {}
): DaemonPovStory[] {
  const maxStories = options.maxStories ?? 3;
  const minScore = options.minScore ?? 0.05;

  const stories = Array.from(registry.daemons.values())
    .map((d) => buildDaemonPovStory(d))
    .filter((s): s is DaemonPovStory => s !== null)
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score || b.timestamp - a.timestamp)
    .slice(0, maxStories);

  return stories;
}
