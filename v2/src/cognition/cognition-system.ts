import { isOperatorControlled } from "../ecs/controlled";
import type { World } from "../ecs/world";
import type { SystemDefinition, SystemContext, SystemRegistry } from "../ecs/dynamic-systems";
import { safeGetRelationTargets } from "../ecs/dynamic-systems";
import { query, getRelationTargets, addEntity, addComponent, removeComponent, hasComponent, entityExists, removeEntity } from "bitecs";
import { Name, Agent, Mind, Room, Description, Portal, GridPosition, WorldMap, Health, CombatStats, InCombat, Inventory, Item, StimulusSource, PhysicalObject, Appearance, Traits, ObjectState, ObjectType, Memory, WorkingMemoryIdentity } from "../ecs/components";
import { LocatedIn } from "../ecs/relations";
import { getDirectContainer, getRoomForEntity, listDirectContents, setLocatedIn } from "../ecs/location";
import {
  addToInventory,
  formatInventory,
  getInventoryItems,
  hasInventory,
  hasItem,
  initializeInventory,
  removeFromInventory,
  syncInventoryCache,
} from "../ecs/inventory";
import { tryHoldCarriedItem, syncHeldAppearance } from "../rendering/character-appearance";
import {
  processAgentCognition,
  agentThink,
  selectFastAgentAction,
  hasUnintegratedAttention,
  addPerception,
  getAgentMemory,
  type AgentAction
} from "./agent-mind";
import { addMemory, extractKnowledgeFromInteraction, getAgentMemories } from "./knowledge-graph";
import { hasDueAttentionSignal } from "./unresolved-attention";
import { recordCommittedSpeech, recordHeardSpeechFragment, flushHeardSpeechFragments } from "./social-memory";
import { beginTimedSpeech, estimateSpeechDurationMs, isSpeaking, getSpeakingActivity, readLocalSpeechOpportunity, interruptTimedSpeech, type SpeechInterval } from "./timed-speech";
import { captureWorkingMemoryAction, captureWorkingMemoryObservation, recordWorkingMemoryAction, type WorkingMemoryActionSnapshot } from "./working-memory-observation";
import { getCurrentInspection, recordInspectionResult } from "./inspection-memory";
import { workingMemoryEntityRef } from "./working-memory";
import { randomUUID } from "node:crypto";
import { stampGoalTiming } from "../ecs/temporal-age";
import { readSimulationTime } from "../ecs/simulation-time";
import { scheduleSimulationEvent, reserveSimulationResources, releaseSimulationResources, isSimulationResourceBusy } from "../runtime/simulation-timeline";
import { publicPhysicalOperation } from "./physical-activity";
import { publishCommittedEvent, getCommittedSource, startCommittedEvents } from "../runtime/committed-events";
import { captureRoomTraversal, getRoomRouteTopologyGeneration, isRoomTraversalCurrent, resolveRoomRouteTarget,
  type RoomTraversal } from "../runtime/room-routes";
import { captureCoordinationAction, recordCoordinationAction, reconcileCoordinationGoals,
  type CoordinationActionIssuance } from "./coordination-memory";
import { executeAffordance, type EffectContext } from "../world/effect-executor";
import { isDocumentOperation, captureDocumentWork, commitDocumentWork, cancelDocumentWork, type DocumentWorkAdmission } from "../world/productive-work";
import { recordGoalAttemptActivity } from "./goal-attempt";
import { worldSchema } from "../world/schema";
import { getAvailableAffordances } from "../world/affordance-availability";
import {
  queueStimulus,
  queueStimulusForAgent,
  broadcastToRoom,
  drainPendingStimuli,
  peekPendingStimuli,
  type PendingStimulus,
} from "./stimulus-queue";
import { filterPerceivableStimuli, getAgentSensoryCapabilities, normalizeSensoryEvent } from "./sensory-capabilities";
import { isStimulusCurrent } from "./stimulus-guard";
import { isForegroundCognitionReady, getForegroundCognitionReadiness, recordForegroundCognitionAdmission, type ForegroundCognitionReadiness, isForegroundActorAvailable, recordCognitionOutcome, wakeForegroundCognition, deferForegroundSpeech, isContinuingListeningProgress, getListeningActivities } from "./idle-cognition";
import { isInvalidHeardSpeechNotice } from "./social-memory";
import { isStandingIntention, maintainGoalLifecycles, intentionReviewRevision } from "./goal-lifecycle";
import { resumeDeferredGoals } from "./goal-pursuit";
import { beginRest, endRest } from "./rest-state";
import {
  generateStimuliForAgent,
  formatStimuliForPrompt,
  eventToStimulus,
  recordSuccessfulAction,
  type Stimulus,
} from "./sensory-system";
import { getMovementTarget, setMovementTarget, clearMovementTarget } from "../systems/builtin-systems";
import {
  isValidAction,
  suggestValidAction,
  validateAgentAction,
  recordIssue,
  type ValidAction,
} from "../spirits/consistency-spirit";
import { recordFailedInteraction } from "../spirits/world-crafter-spirit";
import { recordOutcome } from "./policy-learning";
import { captureLLMDecision, resolveDecision } from "./bt-compiler";
import { consumeForegroundAction, isDiscardedForegroundDecision, deferIntegratedForegroundSpeech, pollForegroundContinuation } from "./foreground-action-admission";
import { chronicle } from "./simulation-chronicle";
import { onProcedureActionResult, upsertProceduralSkillFromInteraction } from "./procedural-skills";
import { advanceGoalTick, expireStaleGoals } from "./autonomous-goals";
import { setGoalContract } from "./goal-contract";
import { snapshotActorContinuation } from "./actor-continuation";
import { situatedPlanGoal } from "./decision-policy";
import { prepareActorWait, captureActorWaitOutcomeAuthority, type ActorWaitOutcomeAuthority } from "./actor-wait";
import {
  runPlanningSystem,
  advancePlanStep,
  getPlanForGoal,
  getNextPlannedAction,
  getCurrentStep,
  failPlan,
  reconcileCurrentPlan,
} from "./planning-system";
import {
  runReflectionSystem,
  initializeReflectionState,
} from "./reflection-system";
import {
  runScheduleSystem,
  initializeAllSchedules,
  getCurrentActivity,
} from "./schedule-system";
import {
  runAppearanceEmitter,
  broadcastAppearanceChange,
  broadcastExpressionChange,
  cleanupAppearanceState,
} from "./appearance-emitter";
import { HasGoal, HasPlan } from "../ecs/relations";
import { Goal, Plan, PendingToolJob } from "../ecs/components";
import { LastAction } from "../ecs/components";
import { getAgentWorldCapabilities, getAgentWorldCapabilityGeneration, getAgentVisibleEntities, getAgentVisualEntities, getObservedPublicActivity, isPublicContainerOpen as isOpenContainer } from "./world-capabilities";
import { isAccessibleViaOpenContainer, isInteractTargetAccessible } from "../world/physical-access";
import { isEntityPresent } from "../ecs/entity-presence";
import { assertSimulationTaskActive, getSimulationTaskSignal, withSimulationTask } from "../runtime/task-scope";
import { trackGoalAction } from "./goal-learning";
import { registerAsyncAction } from "./async-action-evidence";
import { addEntity as bitAddEntity } from "bitecs";

export { getAvailableAffordances };
export { queueStimulus, queueStimulusForAgent, broadcastToRoom };

const pendingActions: Array<{ eid: number; action: AgentAction }> = [];

// Staggered processing state - prevents timeout from processing all agents at once
let agentProcessingIndex = 0;

// Recent failure guard: prevent agents from hammering the same failing action loop.
// This is deliberately local/deterministic (no LLM) and only blocks immediate repeats.
type FailureRecord = { signature: string; count: number; lastAtMs: number };
const failedActionsByWorld = new WeakMap<World, Map<string, FailureRecord>>();
const REPEAT_FAILURE_WINDOW_MS = 5000;
const MAX_REPEAT_FAILURES_BEFORE_BLOCK = 1;

// Plan-step failure guard: when the *current plan step* fails repeatedly, fail the plan so
// the planning system can regenerate a corrected plan.
const planStepFailuresByWorld = new WeakMap<World, Map<number, FailureRecord>>();
function stripControlAndAnsi(input: string): string {
  const s = String(input ?? "");
  // Strip ANSI CSI sequences: ESC [ ... finalByte
  const noAnsi = s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
  // Strip remaining C0/C1 control chars (keep \t, \n, \r).
  return noAnsi.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
}

const PLAN_STEP_FAILURE_WINDOW_MS = 30_000;
const MAX_PLAN_STEP_FAILURES_BEFORE_REPLAN = 2;

// Deterministic learning hook: persist certain high-signal stimuli as explicit long-term memories,
// even when LLM-backed knowledge extraction is disabled.
const MEMORY_CAPTURE_TYPES = new Set<string>(["tool_result", "action_failed"]);
const stimulusMemoryCapturesByWorld = new WeakMap<World, Map<number, { signature: string; atMs: number }>>();
const STIMULUS_MEMORY_DEDUP_WINDOW_MS = 60_000;

// Tune these based on your API rate limits:
// - Free tier: PARALLEL_BATCH_SIZE = 4-5
// - Paid tier: PARALLEL_BATCH_SIZE = 8-12
// - Enterprise: PARALLEL_BATCH_SIZE = 15-20
const AGENTS_PER_TICK = 12;        // Process max agents per cognition cycle
const PARALLEL_BATCH_SIZE = 8;     // Process in parallel (Promise.all) - safe for most paid tiers

/**
 * Determine if an agent should think this tick based on arousal level
 * High arousal agents think more frequently
 */
function shouldAgentThink(eid: number, tick: number): boolean {
  const arousal = Mind.arousal[eid] ?? 0.5;

  // High arousal (>0.7): think every tick
  if (arousal > 0.7) return true;

  // Medium arousal (0.4-0.7): think every 2 ticks
  if (arousal > 0.4) return tick % 2 === eid % 2;

  // Low arousal (<0.4): think every 3 ticks
  return tick % 3 === eid % 3;
}

const routineStimulusTypes = new Set(["perception", "action_result", "visual", "ambient", "awareness", "affordances", "cognitive"]);
function deservesForegroundAttention(world: World, event: PendingStimulus): boolean {
  if (isInvalidHeardSpeechNotice(world, event.targetEid, event)) return false;
  if (event.type === "speech_fragment" && isContinuingListeningProgress(world, event.targetEid, event)) return false;
  if (["observation", "examination"].includes(event.type) && ["observation", "examination", "senses"].includes(event.source)) return false;
  return !routineStimulusTypes.has(event.type);
}
/** Non-draining and modality-aware: an unheard event cannot wake cognition. */
export function hasPendingCognitionStimuli(world: World, eid: number): boolean {
  return filterPerceivableStimuli(world, eid, peekPendingStimuli(eid, world)).some(event => deservesForegroundAttention(world, event));
}

function maybeCaptureStimulusAsMemory(world: World, stimulus: PendingStimulus): void {
  if (!MEMORY_CAPTURE_TYPES.has(stimulus.type)) return;
  if (!entityExists(world, stimulus.targetEid)) return;
  if (!hasComponent(world, stimulus.targetEid, Agent)) return;
  if (!Agent.active[stimulus.targetEid]) return;

  const raw = (stimulus.content || "").trim();
  if (!raw) return;

  // Avoid turning explicit note-taking UX into double-memories:
  // notes.append already writes a dedicated `[Note] ...` memory entry.
  if (stimulus.type === "tool_result" && raw.startsWith("[Tool:notes.")) return;

  const maxLen = 500;
  const clipped = raw.length > maxLen ? raw.slice(0, maxLen) + "\n…(truncated)" : raw;

  const signature = `${stimulus.type}|${stimulus.source}|${clipped.slice(0, 240)}`;
  const now = Date.now();
  let recentStimulusMemoryCaptures = stimulusMemoryCapturesByWorld.get(world);
  if (!recentStimulusMemoryCaptures) { recentStimulusMemoryCaptures = new Map(); stimulusMemoryCapturesByWorld.set(world, recentStimulusMemoryCaptures); }
  const prev = recentStimulusMemoryCaptures.get(stimulus.targetEid);
  if (prev && prev.signature === signature && now - prev.atMs < STIMULUS_MEMORY_DEDUP_WINDOW_MS) return;

  // Avoid spamming exact duplicates already present in the most recent memories.
  const recent = getAgentMemories(world, stimulus.targetEid)
    .sort((a, b) => (Memory.timestamp[b] || 0) - (Memory.timestamp[a] || 0))
    .slice(0, 12);
  for (const memEid of recent) {
    const existing = (Memory.content[memEid] || "").trim();
    if (existing === clipped) {
      recentStimulusMemoryCaptures.set(stimulus.targetEid, { signature, atMs: now });
      return;
    }
  }

  if (stimulus.type === "tool_result") {
    addMemory(world, stimulus.targetEid, {
      type: "semantic",
      content: clipped,
      importance: 0.7,
      emotionalValence: 0,
      timestamp: stimulus.timestamp ?? now,
    });
  } else if (stimulus.type === "action_failed") {
    addMemory(world, stimulus.targetEid, {
      type: "episodic",
      content: clipped,
      importance: 0.9,
      emotionalValence: -0.2,
      timestamp: stimulus.timestamp ?? now,
    });
  }

  recentStimulusMemoryCaptures.set(stimulus.targetEid, { signature, atMs: now });
}

// Entity registry for name lookups (shared with effect executor)
const entityRegistry = {
  byName: new Map<string, number>(),
  byId: new Map<number, string>(),
};

/**
 * Register an entity in the name lookup system
 */
export function registerEntity(eid: number, name: string): void {
  entityRegistry.byName.set(name, eid);
  entityRegistry.byId.set(eid, name);
}

/**
 * Unregister an entity from the name lookup system
 */
export function unregisterEntity(eid: number): void {
  const name = entityRegistry.byId.get(eid);
  if (name) {
    entityRegistry.byName.delete(name);
    entityRegistry.byId.delete(eid);
  }
}

// ============================================================================
// GOAL CREATION HELPERS
// These create Goals that deterministic systems will execute
// This is the bridge between AI cognition (intent) and ECS systems (execution)
// ============================================================================

/**
 * Create a movement goal for an agent.
 * The GoalPursuitSystem will execute the actual movement.
 *
 * @param world - The ECS world
 * @param agentEid - The agent entity ID
 * @param destination - Target location name (room name)
 * @param reason - Optional reason for movement (for context)
 * @param priority - Goal priority (1-10, default 5)
 * @returns The goal entity ID, or undefined if goal already exists
 */
export function createMovementGoal(
  world: World,
  agentEid: number,
  destination: string,
  reason?: string,
  priority: number = 5
): number | undefined {
  const agentName = Name.value[agentEid] || `Agent ${agentEid}`;

  // Check if agent already has a movement goal to this destination
  const existingGoals = safeGetRelationTargets(world, agentEid, HasGoal);
  for (const goalEid of existingGoals) {
    if (!hasComponent(world, goalEid, Goal)) continue;
    const desc = Goal.description[goalEid] || "";
    const status = Goal.status[goalEid];
    if (status !== "active") continue;

    // Prefer typed movement goals (robust): don't accidentally treat arbitrary goals that contain "go to"
    // as a movement goal (this can stall movement entirely).
    const kind = String((Goal as any).kind?.[goalEid] || "");
    if (kind === "move_to_room") {
      try {
        const raw = String((Goal as any).paramsJson?.[goalEid] || "").trim();
        if (raw) {
          const parsed = JSON.parse(raw);
          const roomName = typeof parsed?.roomName === "string" ? parsed.roomName : "";
          if (roomName.trim().toLowerCase() === destination.trim().toLowerCase()) {
            console.log(`[Goal] ${agentName} already has goal to go to ${destination}`);
            return undefined;
          }
          continue;
        }
      } catch {
        // Fall through to legacy description matching if paramsJson isn't usable.
      }
    }

    // Legacy fallback: older movement goals were only described in text.
    if (desc.toLowerCase().startsWith("go to ") && desc.toLowerCase().includes(destination.toLowerCase())) {
      console.log(`[Goal] ${agentName} already has goal to go to ${destination}`);
      return undefined;
    }
  }

  // Create new goal entity
  const goalEid = bitAddEntity(world);
  addComponent(world, goalEid, Goal);
  addComponent(world, agentEid, HasGoal(goalEid));

  // Set goal properties - format matches what GoalPursuitSystem expects
  const goalDescription = reason
    ? `Go to ${destination} to ${reason}`
    : `Go to ${destination}`;

  Goal.description[goalEid] = goalDescription;
  Goal.priority[goalEid] = Math.min(10, Math.max(1, priority));
  Goal.status[goalEid] = "active";
  Goal.progress[goalEid] = 0;
  Goal.deadline[goalEid] = Date.now() + 5 * 60 * 1000; // 5 minute deadline
  Goal.createdAt[goalEid] = Date.now();
  stampGoalTiming(world, goalEid);

  // Typed contract: allows downstream systems (and learning) to key off a stable signature.
  setGoalContract(world, goalEid, {
    version: 1,
    kind: "move_to_room",
    params: { roomName: destination, reason: reason || undefined },
    success: { type: "in_room", roomName: destination },
    description: goalDescription,
  });

  console.log(`🎯 ${agentName} created goal: "${goalDescription}" (priority: ${priority})`);

  return goalEid;
}

/**
 * Create a general intent goal for an agent.
 * This allows AI to express intent that deterministic systems can act on.
 *
 * @param world - The ECS world
 * @param agentEid - The agent entity ID
 * @param description - What the agent wants to do
 * @param priority - Goal priority (1-10)
 * @returns The goal entity ID
 */
export function createIntentGoal(
  world: World,
  agentEid: number,
  description: string,
  priority: number = 5
): number {
  assertSimulationTaskActive();
  const agentName = Name.value[agentEid] || `Agent ${agentEid}`;

  // Create goal entity
  const goalEid = bitAddEntity(world);
  addComponent(world, goalEid, Goal);
  addComponent(world, agentEid, HasGoal(goalEid));

  Goal.description[goalEid] = description;
  Goal.priority[goalEid] = Math.min(10, Math.max(1, priority));
  Goal.status[goalEid] = "active";
  Goal.progress[goalEid] = 0;
  Goal.deadline[goalEid] = Date.now() + 10 * 60 * 1000; // 10 minute deadline
  Goal.createdAt[goalEid] = Date.now();
  stampGoalTiming(world, goalEid);

  setGoalContract(world, goalEid, {
    version: 1,
    kind: "custom",
    params: { description },
    success: { type: "custom", description: "requires world evidence or explicit verification; a completed plan alone is not proof" },
    description,
  });

  console.log(`🎯 ${agentName} created intent goal: "${description}" (priority: ${priority})`);

  return goalEid;
}

/**
 * Check if agent has any active movement goals
 */
export function hasActiveMovementGoal(world: World, agentEid: number): boolean {
  const goalEids = safeGetRelationTargets(world, agentEid, HasGoal);

  for (const goalEid of goalEids) {
    if (!hasComponent(world, goalEid, Goal)) continue;
    const desc = Goal.description[goalEid] || "";
    const status = Goal.status[goalEid];
    const kind = String(Goal.kind[goalEid] || "");
    if (status === "active" && (kind === "move_to_room" || desc.toLowerCase().includes("go to"))) {
      return true;
    }
  }

  return false;
}

/**
 * Get all active goals for an agent
 */
export function getActiveGoals(world: World, agentEid: number): Array<{ eid: number; description: string; priority: number }> {
  const goalEids = safeGetRelationTargets(world, agentEid, HasGoal);
  const active: Array<{ eid: number; description: string; priority: number }> = [];

  for (const goalEid of goalEids) {
    if (!hasComponent(world, goalEid, Goal)) continue;
    if (Goal.status[goalEid] !== "active") continue;

    active.push({
      eid: goalEid,
      description: Goal.description[goalEid] || "",
      priority: Goal.priority[goalEid] || 0,
    });
  }

  return active.sort((a, b) => b.priority - a.priority);
}

/**
 * Make an entity combatable by adding Health and CombatStats
 * @param eid Entity ID
 * @param maxHealth Maximum health points (default 100)
 * @param attack Attack power (default 10)
 * @param defense Defense rating (default 5)
 */
export function makeCombatable(
  eid: number,
  maxHealth: number = 100,
  attack: number = 10,
  defense: number = 5
): void {
  // Add Health component
  Health.current[eid] = maxHealth;
  Health.max[eid] = maxHealth;
  Health.regenRate[eid] = 0;  // No regen by default
  Health.lastDamage[eid] = 0;

  // Add CombatStats component
  CombatStats.attack[eid] = attack;
  CombatStats.defense[eid] = defense;
  CombatStats.speed[eid] = 1;
  CombatStats.accuracy[eid] = 0.9;  // 90% hit chance

  console.log(`[Combat] Entity ${eid} is now combatable (HP: ${maxHealth}, ATK: ${attack}, DEF: ${defense})`);
}

/**
 * Check if an entity is combatable (has Health component)
 */
export function isCombatable(eid: number): boolean {
  return Health.max[eid] !== undefined && Health.max[eid] > 0;
}

/**
 * Deal damage to an entity directly
 * Returns the actual damage dealt
 */
export function dealDamage(
  world: World,
  targetEid: number,
  damage: number,
  source: string = "unknown"
): number {
  const currentHealth = Health.current[targetEid];
  if (currentHealth === undefined) {
    console.warn(`[Combat] Cannot damage entity ${targetEid} - no Health component`);
    return 0;
  }

  const actualDamage = Math.min(damage, currentHealth);
  Health.current[targetEid] = Math.max(0, currentHealth - damage);
  Health.lastDamage[targetEid] = Date.now();

  const targetName = Name.value[targetEid] || `Entity ${targetEid}`;
  console.log(`[Combat] ${targetName} takes ${actualDamage.toFixed(1)} damage from ${source} (${Health.current[targetEid]}/${Health.max[targetEid]} HP)`);

  // Notify target
  queueStimulus(world, {
    targetEid: targetEid,
    type: "combat",
    modality: "tactile",
    content: `You take ${actualDamage.toFixed(1)} damage from ${source}!`,
    source: source,
    intensity: 1.0,
  });

  return actualDamage;
}

// ============================================================================
// INVENTORY HELPERS
// ============================================================================

// Inventory helpers live in `src/ecs/inventory.ts` so the world layer (effects/rules)
// and cognition can share the same canonical logic without circular imports.
export { initializeInventory, hasInventory, getInventoryItems, addToInventory, removeFromInventory, hasItem, formatInventory };

// ============================================================================
// APPEARANCE HELPERS - NPC physical appearance system
// ============================================================================

export interface AppearanceConfig {
  // Stable traits
  height?: string;
  build?: string;
  hairColor?: string;
  hairStyle?: string;
  eyeColor?: string;
  skinTone?: string;
  age?: string;
  distinguishing?: string;
  // Dynamic state
  expression?: string;
  posture?: string;
  clothing?: string;
  accessories?: string;
  condition?: string;
}

/**
 * Initialize an NPC's appearance with stable physical traits
 */
export function initializeAppearance(eid: number, config: AppearanceConfig): void {
  // Stable traits
  Appearance.height[eid] = config.height || "average";
  Appearance.build[eid] = config.build || "average";
  Appearance.hairColor[eid] = config.hairColor || "brown";
  Appearance.hairStyle[eid] = config.hairStyle || "short";
  Appearance.eyeColor[eid] = config.eyeColor || "brown";
  Appearance.skinTone[eid] = config.skinTone || "fair";
  Appearance.age[eid] = config.age || "adult";
  Appearance.distinguishing[eid] = config.distinguishing || "";

  // Dynamic state
  Appearance.expression[eid] = config.expression || "neutral";
  Appearance.posture[eid] = config.posture || "relaxed";
  Appearance.clothing[eid] = config.clothing || "simple clothes";
  Appearance.accessories[eid] = config.accessories || "";
  Appearance.condition[eid] = config.condition || "clean";
  Appearance.visiblyHolding[eid] = "";
  Appearance.lastUpdate[eid] = Date.now();

  const name = Name.value[eid] || `Entity ${eid}`;
  console.log(`[Appearance] Initialized appearance for ${name}`);
}

/**
 * Check if entity has appearance component
 */
export function hasAppearance(eid: number): boolean {
  return Appearance.height[eid] !== undefined;
}

/**
 * Update an NPC's expression (smile, frown, angry, etc.)
 */
export function setExpression(eid: number, expression: string): void {
  const oldExpression = Appearance.expression[eid];
  Appearance.expression[eid] = expression;
  Appearance.lastUpdate[eid] = Date.now();

  if (oldExpression !== expression) {
    const name = Name.value[eid] || `Entity ${eid}`;
    console.log(`[Appearance] ${name}'s expression changed to: ${expression}`);
  }
}

/**
 * Update an NPC's posture (tense, relaxed, defensive, etc.)
 */
export function setPosture(eid: number, posture: string): void {
  Appearance.posture[eid] = posture;
  Appearance.lastUpdate[eid] = Date.now();
}

/**
 * Update an NPC's clothing
 */
export function setClothing(eid: number, clothing: string): void {
  Appearance.clothing[eid] = clothing;
  Appearance.lastUpdate[eid] = Date.now();
}

/**
 * Update an NPC's accessories (hat, jewelry, belt, etc.)
 */
export function setAccessories(eid: number, accessories: string): void {
  Appearance.accessories[eid] = accessories;
  Appearance.lastUpdate[eid] = Date.now();
}

/**
 * Update an NPC's physical condition (clean, muddy, bloody, sweaty, etc.)
 */
export function setCondition(eid: number, condition: string): void {
  Appearance.condition[eid] = condition;
  Appearance.lastUpdate[eid] = Date.now();
}

/**
 * Update what an NPC is visibly holding in their hands
 * This syncs with inventory but only shows actively held items
 */
export function setVisiblyHolding(eid: number, itemName: string): void {
  Appearance.visiblyHolding[eid] = itemName;
  Appearance.lastUpdate[eid] = Date.now();
}

/**
 * Compatibility entry point: project actual hand equipment, not inventory.
 */
export function syncVisiblyHoldingFromInventory(world: World, eid: number): void {
  syncHeldAppearance(world, eid);
}

/**
 * Generate a short appearance description for visual perception
 * This is what other NPCs see when they look at this character
 */
export function getAppearanceDescription(eid: number): string {
  if (!hasAppearance(eid)) {
    return Name.value[eid] || "someone";
  }

  const name = Name.value[eid] || "someone";
  const parts: string[] = [];

  // Build physical description
  const age = Appearance.age[eid];
  const height = Appearance.height[eid];
  const build = Appearance.build[eid];
  const hairColor = Appearance.hairColor[eid];
  const hairStyle = Appearance.hairStyle[eid];

  // Concise physical traits
  if (age && age !== "adult") parts.push(age);
  if (height && height !== "average") parts.push(height);
  if (build && build !== "average") parts.push(build);

  // Hair description
  if (hairColor && hairStyle && hairColor !== "bald") {
    parts.push(`${hairStyle} ${hairColor} hair`);
  } else if (hairColor === "bald") {
    parts.push("bald");
  }

  // Clothing
  const clothing = Appearance.clothing[eid];
  if (clothing) {
    parts.push(`wearing ${clothing}`);
  }

  // Current state
  const expression = Appearance.expression[eid];
  const posture = Appearance.posture[eid];
  const condition = Appearance.condition[eid];

  if (expression && expression !== "neutral") {
    parts.push(`looking ${expression}`);
  }
  if (posture && posture !== "relaxed" && posture !== "upright") {
    parts.push(`standing ${posture}`);
  }
  if (condition && condition !== "clean") {
    parts.push(condition);
  }

  // What they're holding
  const holding = Appearance.visiblyHolding[eid];
  if (holding) {
    parts.push(`holding ${holding}`);
  }

  // Distinguishing features
  const distinguishing = Appearance.distinguishing[eid];
  if (distinguishing) {
    parts.push(`with ${distinguishing}`);
  }

  if (parts.length === 0) {
    return name;
  }

  return `${name} - ${parts.join(", ")}`;
}

/**
 * Generate a detailed appearance description for close observation
 */
export function getDetailedAppearance(eid: number): string {
  if (!hasAppearance(eid)) {
    return `You see ${Name.value[eid] || "someone"}.`;
  }

  const name = Name.value[eid] || "someone";
  const lines: string[] = [];

  lines.push(`You observe ${name} closely.`);

  // Physical build
  const height = Appearance.height[eid];
  const build = Appearance.build[eid];
  const age = Appearance.age[eid];
  if (height || build || age) {
    lines.push(`They appear ${[age, height, build].filter(Boolean).join(", ")}.`);
  }

  // Face and hair
  const hairColor = Appearance.hairColor[eid];
  const hairStyle = Appearance.hairStyle[eid];
  const eyeColor = Appearance.eyeColor[eid];
  const skinTone = Appearance.skinTone[eid];

  if (hairColor || eyeColor) {
    const hairPart = hairColor !== "bald" ? `${hairStyle} ${hairColor} hair` : "a bald head";
    lines.push(`They have ${hairPart} and ${eyeColor} eyes.`);
  }

  // Clothing and accessories
  const clothing = Appearance.clothing[eid];
  const accessories = Appearance.accessories[eid];
  if (clothing) {
    lines.push(`They are wearing ${clothing}${accessories ? ` with ${accessories}` : ""}.`);
  }

  // Current state
  const expression = Appearance.expression[eid];
  const posture = Appearance.posture[eid];
  const condition = Appearance.condition[eid];

  if (expression || posture) {
    lines.push(`Their expression is ${expression || "neutral"} and they stand ${posture || "normally"}.`);
  }

  if (condition && condition !== "clean") {
    lines.push(`They look ${condition}.`);
  }

  // What they're holding
  const holding = Appearance.visiblyHolding[eid];
  if (holding) {
    lines.push(`They are holding ${holding}.`);
  }

  // Distinguishing features
  const distinguishing = Appearance.distinguishing[eid];
  if (distinguishing) {
    lines.push(`Notable: ${distinguishing}.`);
  }

  return lines.join(" ");
}

// ============================================================================
// PERCEPTION HELPERS - Make objects perceivable by agents
// ============================================================================

/**
 * Make an object perceivable by adding StimulusSource component.
 * Objects with this will emit periodic stimuli that agents can perceive.
 *
 * @param eid Entity ID
 * @param stimulusType Type of stimulus: "visual", "sound", "smell", "presence", etc.
 * @param template Template for stimulus content. {name} is replaced with entity name.
 * @param interval Emission interval in ms (default 15000 = every 15 seconds)
 *
 * Examples:
 * - makePerceivable(treeEid, "visual", "You notice {name} standing nearby.", 20000)
 * - makePerceivable(fireEid, "sound", "{name} crackles warmly.", 5000)
 * - makePerceivable(flowerEid, "smell", "A sweet fragrance drifts from {name}.", 10000)
 */
export function makePerceivable(
  eid: number,
  stimulusType: string = "visual",
  template: string = "You notice {name} nearby.",
  interval: number = 15000
): void {
  StimulusSource.stimulusType[eid] = stimulusType;
  StimulusSource.template[eid] = template;
  StimulusSource.interval[eid] = interval;
  StimulusSource.lastEmit[eid] = 0;

  const entityName = Name.value[eid] || `Entity ${eid}`;
  console.log(`[Perception] Made ${entityName} perceivable (${stimulusType}, every ${interval}ms)`);
}

/**
 * Make an object visible - emits visual presence stimuli
 */
export function makeVisible(eid: number, template?: string, interval: number = 15000): void {
  const entityName = Name.value[eid] || "an object";
  const defaultTemplate = template || `You see ${entityName} nearby.`;
  makePerceivable(eid, "visual", defaultTemplate, interval);
}

/**
 * Make an object noisy - emits sound stimuli
 */
export function makeNoisy(eid: number, template: string, interval: number = 10000): void {
  makePerceivable(eid, "sound", template, interval);
}

/**
 * Make an object have a smell - emits olfactory stimuli
 */
export function makeSmelly(eid: number, template: string, interval: number = 15000): void {
  makePerceivable(eid, "smell", template, interval);
}

/**
 * Create a complete interactable object entity
 * Returns the entity ID
 */
export function createPerceivableObject(
  world: World,
  name: string,
  description: string,
  roomEid: number,
  options: {
    stimulusType?: string;
    stimulusTemplate?: string;
    stimulusInterval?: number;
    isItem?: boolean;
    weight?: number;
    category?: string;
    gridX?: number;
    gridY?: number;
  } = {}
): number {
  const eid = addEntity(world);

  // Set basic identity
  Name.value[eid] = name;
  Description.value[eid] = description;

  // Make it perceivable
  const stimType = options.stimulusType || "visual";
  const stimTemplate = options.stimulusTemplate || `You notice ${name}.`;
  const stimInterval = options.stimulusInterval || 20000;
  makePerceivable(eid, stimType, stimTemplate, stimInterval);

  // If it's a pickupable item, add Item component
  if (options.isItem) {
    Item.stackable[eid] = false;
    Item.quantity[eid] = 1;
    Item.maxStack[eid] = 1;
    Item.weight[eid] = options.weight ?? 1;
    Item.category[eid] = options.category || "misc";

    PhysicalObject.portable[eid] = true;
    PhysicalObject.weight[eid] = options.weight ?? 1;
  }

  // Position it (grid or room relation)
  if (options.gridX !== undefined && options.gridY !== undefined) {
    GridPosition.x[eid] = options.gridX;
    GridPosition.y[eid] = options.gridY;
  }

  // Add to room (canonical: LocatedIn)
  addComponent(world, eid, LocatedIn(roomEid));

  // Register for lookups
  registerEntity(eid, name);

  console.log(`[Object] Created perceivable object "${name}" in room ${Name.value[roomEid] || roomEid}`);

  return eid;
}

/**
 * Get all perceivable objects in a room
 */
export function getObjectsInRoom(world: World, roomEid: number): { eid: number; name: string; description: string }[] {
  const objects: { eid: number; name: string; description: string }[] = [];

  // Canonical: direct contents of the room via LocatedIn.
  // Nested items (e.g., items inside a backpack) are not returned here.
  const contents = listDirectContents(world, roomEid);
  for (const eid of contents) {
    if (!entityExists(world, eid)) continue;
    if (hasComponent(world, eid, Agent)) continue;
    if (!hasComponent(world, eid, StimulusSource)) continue;

    objects.push({
      eid,
      name: Name.value[eid] || `Object ${eid}`,
      description: Description.value[eid] || "",
    });
  }

  return objects;
}

/**
 * Find an entity by name (with fuzzy matching for natural language)
 */
export function findEntityByName(
  world: World,
  name: string,
  options?: { preferRoomEid?: number }
): number | undefined {
  return findEntityByNameWithScope(world, name, options);
}

function normalizeEntitySearchText(raw: string): {
  variants: string[];
  stateHints: string[];
} {
  const stateHints: string[] = [];
  const base = (raw || "")
    .trim()
    .replace(/^[-•]\s*/g, "") // list bullets from sensory output
    .replace(/^["']+|["']+$/g, "") // surrounding quotes
    .replace(/\s+/g, " ");

  // Strip bracket/paren state annotations commonly produced by sensory output: `food [fresh]`, `Silas (sleeping)`
  let withoutState = base
    .replace(/\[([^\]]+)\]/g, (_m, inner) => {
      if (typeof inner === "string" && inner.trim().length > 0) stateHints.push(inner.trim().toLowerCase());
      return " ";
    })
    .replace(/\(([^)]+)\)/g, (_m, inner) => {
      if (typeof inner === "string" && inner.trim().length > 0) stateHints.push(inner.trim().toLowerCase());
      return " ";
    });

  // Remove punctuation that commonly appears in prose references.
  withoutState = withoutState.replace(/[.,!?;:]+/g, " ").replace(/\s+/g, " ").trim();

  // Remove leading articles.
  withoutState = withoutState.replace(/^(the|a|an)\s+/i, "");

  const lowered = withoutState.toLowerCase().trim();
  if (lowered.length === 0) return { variants: [], stateHints };

  // Normalize underscores/spaces so `iron_ingot` and `iron ingot` both work.
  const asSpaces = lowered.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  const asUnderscore = lowered.replace(/\s+/g, "_").replace(/_+/g, "_").trim();

  // Plural handling: trees -> tree, berries -> berry
  const singularS = asSpaces.endsWith("s") ? asSpaces.slice(0, -1) : asSpaces;
  const singularIes = asSpaces.endsWith("ies") ? asSpaces.slice(0, -3) + "y" : singularS;

  const variants = Array.from(
    new Set(
      [
        lowered,
        asSpaces,
        asUnderscore,
        singularS,
        singularIes,
        singularS.replace(/\s+/g, "_"),
        singularIes.replace(/\s+/g, "_"),
      ].filter((v) => v.length > 0)
    )
  );

  return { variants, stateHints: Array.from(new Set(stateHints)) };
}

function getEntityNameCandidates(world: World, eid: number): string[] {
  const candidates: string[] = [];
  const entityName = Name.value[eid];
  if (typeof entityName === "string" && entityName.trim().length > 0) {
    candidates.push(entityName);
    candidates.push(entityName.replace(/_/g, " "));
  }

  if (hasComponent(world, eid, ObjectType)) {
    const typeId = ObjectType.typeId[eid];
    if (typeof typeId === "string" && typeId.trim().length > 0) {
      candidates.push(typeId);
      candidates.push(typeId.replace(/_/g, " "));
    }
  }

  return Array.from(new Set(candidates.map((c) => c.toLowerCase().trim()).filter(Boolean)));
}

function scoreNameMatch(
  search: ReturnType<typeof normalizeEntitySearchText>,
  entityCandidates: string[],
  entityEid: number,
  world: World,
  options?: { preferRoomEid?: number }
): number {
  let score = 0;

  for (const v of search.variants) {
    for (const cand of entityCandidates) {
      if (cand === v) score = Math.max(score, 100);
      else if (cand.startsWith(v)) score = Math.max(score, 80);
      else if (cand.includes(v)) score = Math.max(score, 65);
      else if (v.includes(cand) && cand.length >= 3) score = Math.max(score, 55);
    }
  }
  // Location/state are tie breakers, never evidence of a name match. Awarding
  // location points to a non-match made unknown targets resolve to the actor.
  if (score === 0) return 0;
  if (options?.preferRoomEid !== undefined && getRoomForEntity(world, entityEid) === options.preferRoomEid) score += 20;
  if (search.stateHints.length > 0 && hasComponent(world, entityEid, ObjectState) &&
      search.stateHints.includes(String(ObjectState.current[entityEid] || "").toLowerCase())) score += 15;
  return score;
}

export function findEntityByNameWithScope(
  world: World,
  name: string,
  options?: { preferRoomEid?: number }
): number | undefined {
  // First check registry for exact hit (fast path).
  const registered = entityRegistry.byName.get(name);
  if (registered !== undefined) {
    if (entityExists(world, registered) && String(Name.value[registered] || "").trim().toLowerCase() === name.trim().toLowerCase())
      return isEntityPresent(world,registered)?registered:undefined;
    // Registry can become stale if entities are removed without unregistering.
    entityRegistry.byName.delete(name);
    const prevName = entityRegistry.byId.get(registered);
    if (prevName) entityRegistry.byName.delete(prevName);
    entityRegistry.byId.delete(registered);
  }

  const search = normalizeEntitySearchText(name);
  if (search.variants.length === 0) return undefined;

  // Exact names outrank fuzzy local matches, including held/surface objects.
  // Otherwise "Mara's phone" can resolve to Mara while the real phone is on
  // her desk or in her inventory. Accessibility is validated by the executor.
  const exact = [...query(world, [Name])].filter(id => entityExists(world, id) &&
    String(Name.value[id] || "").trim().toLowerCase() === name.trim().toLowerCase());
  if (exact.length) {const present=exact.filter(id=>isEntityPresent(world,id));
    return present.find(id => options?.preferRoomEid !== undefined && getRoomForEntity(world, id) === options.preferRoomEid) ?? present[0];}

  // Prefer searching local room contents + agents in room first (prevents matching remote entities).
  const scopedEids: number[] = [];
  if (options?.preferRoomEid !== undefined) {
    for (const eid of listDirectContents(world, options.preferRoomEid)) {
      if (!entityExists(world, eid)) continue;
      scopedEids.push(eid);
    }
    for (const agentEid of Array.from(query(world, [Agent]))) {
      if (!entityExists(world, agentEid)) continue;
      if (getRoomForEntity(world, agentEid) !== options.preferRoomEid) continue;
      scopedEids.push(agentEid);
    }
  }

  const evalPool = (pool: number[]): { bestEid: number | undefined; bestScore: number } => {
    let bestEid: number | undefined;
    let bestScore = 0;
    for (const eid of pool) {
      if (!isEntityPresent(world, eid)) continue;
      const entityCandidates = getEntityNameCandidates(world, eid);
      if (entityCandidates.length === 0) continue;
      const s = scoreNameMatch(search, entityCandidates, eid, world, options);
      if (s > bestScore) {
        bestScore = s;
        bestEid = eid;
      }
    }
    return { bestEid, bestScore };
  };

  // If we have a room hint, prefer local matches even if they are imperfect.
  // This avoids "ghost object" failure modes where a remote or stale name wins.
  if (scopedEids.length > 0) {
    const local = evalPool(Array.from(new Set(scopedEids)));
    if (local.bestEid !== undefined && local.bestScore >= 55) return local.bestEid;
  }

  // Global fallback: include multiple common component pools (some entities have Name.value set
  // but may be missing the Name component, so querying only [Name] is insufficient).
  const allCandidateEids = new Set<number>();
  for (const eid of Array.from(query(world, [Name]))) allCandidateEids.add(eid);
  for (const eid of Array.from(query(world, [ObjectType]))) allCandidateEids.add(eid);
  for (const eid of Array.from(query(world, [PhysicalObject]))) allCandidateEids.add(eid);
  for (const eid of Array.from(query(world, [Agent]))) allCandidateEids.add(eid);
  for (const eid of Array.from(query(world, [Room]))) allCandidateEids.add(eid);

  const global = evalPool(Array.from(allCandidateEids));
  if (global.bestEid !== undefined && global.bestScore > 0) {
    // Cache the lookup for future fast-path hits.
    const canonical = Name.value[global.bestEid] || name;
    registerEntity(global.bestEid, canonical);
    if (canonical !== name) entityRegistry.byName.set(name, global.bestEid);
    return global.bestEid;
  }

  return undefined;
}

/**
 * Find objects in a room that can be used with a specific affordance
 * Useful for suggesting correct targets when AI picks the wrong one
 */
export function findObjectsWithAffordance(
  world: World,
  actorEid: number,
  roomEid: number,
  affordanceName: string
): string[] {
  const validTargets: string[] = [];

  // Get direct room contents (canonical: LocatedIn)
  const contents = listDirectContents(world, roomEid);

  for (const contentEid of contents) {
    if (!entityExists(world, contentEid)) continue;
    if (hasComponent(world, contentEid, Agent)) continue;  // Skip other agents

    const objName = Name.value[contentEid];
    if (!objName) continue;

    // Check if this affordance is available on this target
    const affordances = getAvailableAffordances(world, actorEid, contentEid);
    if (affordances.some(a => a.name === affordanceName)) {
      validTargets.push(objName);
    }
  }

  return validTargets;
}

/**
 * Find an item in the room that has a specific trait (e.g., "hasMatches")
 * Used to tell the agent which item to pick up to gain a capability
 */
export function findItemWithTrait(
  world: World,
  roomEid: number,
  traitName: string
): string | null {
  const contents = listDirectContents(world, roomEid);

  for (const contentEid of contents) {
    if (!isEntityPresent(world, contentEid)) continue;
    if (hasComponent(world, contentEid, Agent)) continue;

    // Check if this item has the trait
    const traitsJson = Traits?.active?.[contentEid];
    if (traitsJson) {
      try {
        const traits = JSON.parse(traitsJson) as string[];
        if (traits.includes(traitName)) {
          return Name.value[contentEid] || null;
        }
      } catch {
        // continue
      }
    }
  }

  return null;
}

/**
 * Get the entity registry for effect context
 */
export function getEntityRegistry() {
  return entityRegistry;
}

/**
 * Broadcast a sound stimulus to agents in a room
 */
export function broadcastSound(
  world: World,
  roomEid: number,
  content: string,
  source: string,
  excludeEid?: number
): void {
  broadcastToRoom(world, roomEid, {
    type: "sound",
    modality: "auditory",
    content,
    source,
  }, excludeEid);
}

/**
 * Broadcast a visual stimulus to agents in a room
 */
export function broadcastVisual(
  world: World,
  roomEid: number,
  content: string,
  source: string,
  excludeEid?: number
): void {
  broadcastToRoom(world, roomEid, {
    type: "action",
    modality: "visual",
    content,
    source,
  }, excludeEid);
}

export function findRoomByName(world: World, roomName: string): number | undefined {
  const rooms = Array.from(query(world, [Room]));
  const wanted = roomName.toLowerCase();

  const roomNameLower = (eid: number) => String(Name.value[eid] || "").toLowerCase();
  const roomAmbienceLower = (eid: number) => String((Room as any).ambience?.[eid] || "").toLowerCase();

  // Try exact match first (name, then ambience)
  for (const eid of rooms) {
    if (roomNameLower(eid) === wanted) return eid;
  }
  for (const eid of rooms) {
    if (roomAmbienceLower(eid) === wanted) return eid;
  }

  // Try partial match (name, then ambience)
  for (const eid of rooms) {
    if (roomNameLower(eid).includes(wanted)) return eid;
  }
  for (const eid of rooms) {
    if (roomAmbienceLower(eid).includes(wanted)) return eid;
  }

  return undefined;
}

/**
 * Make an agent wander randomly on the grid
 */
function doRandomWander(world: World, eid: number, name: string): void {
  const currentX = GridPosition.x[eid];
  const currentY = GridPosition.y[eid];

  if (currentX === undefined || currentY === undefined) return;

  // Get the world map to check boundaries
  const maps = Array.from(query(world, [WorldMap]));
  if (maps.length === 0) return;

  const mapEid = maps[0];
  const width = WorldMap.width[mapEid] || 20;
  const height = WorldMap.height[mapEid] || 15;

  // Pick a random direction
  const directions = [
    { dx: 1, dy: 0 },   // east
    { dx: -1, dy: 0 },  // west
    { dx: 0, dy: 1 },   // south
    { dx: 0, dy: -1 },  // north
    { dx: 1, dy: 1 },   // southeast
    { dx: -1, dy: 1 },  // southwest
    { dx: 1, dy: -1 },  // northeast
    { dx: -1, dy: -1 }, // northwest
  ];

  const dir = directions[Math.floor(Math.random() * directions.length)];

  // Move 1-3 steps in that direction
  const steps = Math.floor(Math.random() * 3) + 1;
  let newX = currentX + dir.dx * steps;
  let newY = currentY + dir.dy * steps;

  // Clamp to map bounds
  newX = Math.max(1, Math.min(width - 2, newX));
  newY = Math.max(1, Math.min(height - 2, newY));

  // Update position directly for immediate feedback
  GridPosition.x[eid] = newX;
  GridPosition.y[eid] = newY;

  // Update facing direction
  if (dir.dx > 0) GridPosition.facing[eid] = "east";
  else if (dir.dx < 0) GridPosition.facing[eid] = "west";
  else if (dir.dy > 0) GridPosition.facing[eid] = "south";
  else if (dir.dy < 0) GridPosition.facing[eid] = "north";

  console.log(`🚶 ${name} wanders (${currentX},${currentY}) → (${newX},${newY})`);
}

/**
 * Legacy MUD-style view of this actor's current visual surface. Keep the
 * compatibility format without granting it a second, omniscient scene query.
 */
export function renderRoomPerception(
  world: World,
  agentEid: number,
  roomEid: number
): string {
  const lines: string[] = [];

  // Validate entities exist
  if (!isEntityPresent(world, agentEid) || !hasComponent(world, agentEid, Agent) || !Agent.active[agentEid]
      || !isEntityPresent(world, roomEid) || getRoomForEntity(world, agentEid) !== roomEid) {
    return "You are nowhere.";
  }
  if (getAgentSensoryCapabilities(world, agentEid).visual <= 0) return "No current visual perception.";
  const visible = getAgentVisualEntities(world, agentEid);
  if (getRoomForEntity(world, agentEid) !== roomEid || getAgentSensoryCapabilities(world, agentEid).visual <= 0) return "No current visual perception.";

  // Room header
  const roomName = Name.value[roomEid] || "Unknown Location";
  const roomDesc = Description.value[roomEid] || "";
  const roomAmbience = Room.ambience[roomEid] || "";

  lines.push(`=== ${roomName} ===`);
  lines.push("");

  if (roomDesc) {
    lines.push(roomDesc);
  }

  if (roomAmbience) {
    lines.push("");
    lines.push(roomAmbience);
  }

  // Find other agents in the room
  const allAgents = visible.filter(eid => hasComponent(world, eid, Agent));
  const othersInRoom: Array<{ eid: number; appearance: string; affordances: string[] }> = [];

  for (const otherEid of allAgents) {
    if (otherEid === agentEid) continue;
    if (!entityExists(world, otherEid)) continue;

    const otherRoom = getRoomForEntity(world, otherEid);
    if (otherRoom === roomEid) {
      // Get available affordances for interacting with this agent
      const availableAffordances = getAvailableAffordances(world, agentEid, otherEid);
      const affordanceNames = availableAffordances.map(a => a.name);

      const otherName = Name.value[otherEid] || "someone";
      const activity = getObservedPublicActivity(world, agentEid, otherEid);
      const publicDescription = hasComponent(world, otherEid, Description) ? Description.value[otherEid] || "" : "";
      const appearance = `${otherName}${activity ? ` (${activity})` : ""}${publicDescription ? `: ${publicDescription}` : ""}`;

      othersInRoom.push({
        eid: otherEid,
        appearance,
        affordances: affordanceNames,
      });
    }
  }

  if (othersInRoom.length > 0) {
    lines.push("");
    lines.push("People here:");
    for (const other of othersInRoom) {
      let line = `  - ${other.appearance}`;
      if (other.affordances.length > 0) {
        line += ` [can: ${other.affordances.join(", ")}]`;
      }
      lines.push(line);
    }
  }

  // Include ordinary exposed tabletops/open containers, never sealed interiors.
  const contents = visible;
  const objectEntries: Array<{ name: string; desc?: string; affordances: string[] }> = [];

  for (const contentEid of contents) {
    // Skip non-existent entities
    if (!entityExists(world, contentEid)) continue;
    // Skip agents (already listed)
    if (hasComponent(world, contentEid, Agent)) continue;

    const objName = Name.value[contentEid];
    if (objName) {
      // Get available affordances for this object
      const availableAffordances = getAvailableAffordances(world, agentEid, contentEid);
      const affordanceNames = availableAffordances.map(a => a.name);

      // Get object state from ECS ObjectState component (not ObjectMeta)
      const objState = hasComponent(world, contentEid, ObjectState) ? ObjectState.current[contentEid] : undefined;
      const stateDesc = objState && objState !== "normal" ? ` (${objState})` : "";

      objectEntries.push({
        name: objName + stateDesc,
        desc: Description.value[contentEid],
        affordances: affordanceNames,
      });
    }
  }

  if (objectEntries.length > 0) {
    lines.push("");
    lines.push("Objects here:");
    for (const obj of objectEntries) {
      if (obj.affordances.length > 0) {
        lines.push(`  - ${obj.name} [can: ${obj.affordances.join(", ")}]`);
      } else {
        lines.push(`  - ${obj.name}`);
      }
    }
  }

  // A reverse portal in an unobserved room is not evidence of a visible exit.
  // Packages may explicitly expose known adjacent movement destinations.
  const knownDestinations = getAgentWorldCapabilities(world, agentEid)?.movementTargets?.() || [];
  const exits: string[] = [];
  for (const destination of knownDestinations) if (entityExists(world, destination) && destination !== roomEid
      && hasComponent(world, destination, Room) && Name.value[destination]) exits.push(Name.value[destination]);

  // Also check for portals IN this room pointing elsewhere
  for (const contentEid of contents) {
    if (hasComponent(world, contentEid, Portal)) {
      const destRoom = Portal.destinationRoom[contentEid];
      if (destRoom !== undefined && destRoom !== roomEid) {
        const destName = Name.value[destRoom];
        const portalName = Name.value[contentEid];
        if (destName) {
          exits.push(`${portalName || "passage"} to ${destName}`);
        }
      }
    }
  }

  if (exits.length > 0) {
    lines.push("");
    lines.push("Exits:");
    for (const exit of exits) {
      lines.push(`  - ${exit}`);
    }
  }

  return lines.join("\n");
}

/** Perception intake and deterministic continuation must not consume model
 * capacity. Called once per actor/world tick; an in-flight deliberation retains
 * control of selection, but incoming experiences are still admitted immediately.
 * true means the actor needs an asynchronous decision, not an executed wait. */
export function runActorControlStep(world: World, eid: number, registry: SystemRegistry,
  options: { deliberating?: boolean; appraisalPending?: boolean; onAction?: (action: AgentAction) => void } = {}): boolean {
  assertSimulationTaskActive();
  if (!isEntityPresent(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid] || getCommittedSource(world).stopped) return false;
  const events = drainPendingStimuli(new Set([eid]), world).filter(event => !isInvalidHeardSpeechNotice(world, eid, event))
    .flatMap(event => filterPerceivableStimuli(world, eid, [event]));
  for (const event of events) {
    if (deservesForegroundAttention(world, event)) wakeForegroundCognition(world, eid, { cause: "stimulus", stimulusType: event.type });
    maybeCaptureStimulusAsMemory(world, event);
    addPerception(world, eid, event);
  }
  // Operator possession: the body still perceives and remembers (above), but
  // its own mind does not continue, select or resume anything for it.
  if (isOperatorControlled(world, eid)) return false;
  if (resumeDeferredGoals(world, eid)) wakeForegroundCognition(world, eid, { cause: "goal_resumed" });
  // Rich receipt appraisal is asynchronous interpretation, not ownership of
  // the actor's body or immediate reaction. It admits against its own sources.
  if (options.deliberating) return false;
  const continuation = pollForegroundContinuation(world, eid);
  if (continuation?.waiting) return false;
  if (continuation?.needsRevision) { wakeForegroundCognition(world, eid, { cause: "continuation_revision" }); return true; }
  if (continuation?.action) {
    executeActions(world, [{ eid, action: continuation.action }], registry);
    options.onAction?.(continuation.action);
    return false;
  }
  if (!isForegroundActorAvailable(world, eid) || !isForegroundCognitionReady(world, eid,
    { hasQueuedStimuli: events.some(event => deservesForegroundAttention(world, event)),
      hasPendingStimuli: events.some(event => deservesForegroundAttention(world, event)) || hasUnintegratedAttention(world, eid, false),
      hasDueAttention: hasDueAttentionSignal(world, eid) })) return false;
  expireStaleGoals(world, eid); maintainGoalLifecycles(world, eid);
  const observation = captureWorkingMemoryObservation(world, eid);
  reconcileCoordinationGoals(world, eid, observation);
  for (const plan of getRelationTargets(world, eid, HasPlan)) reconcileCurrentPlan(world, eid, plan);
  const action = selectFastAgentAction(world, eid);
  if (!action) return true;
  executeActions(world, [{ eid, action }], registry);
  options.onAction?.(action);
  return false;
}

export async function runCognitionCycle(
  world: World,
  registry: SystemRegistry,
  options: { tick?: number; maxAgents?: number; enablePlanning?: boolean; agentEids?: readonly number[] } = {}
): Promise<Array<{ eid: number; action: AgentAction }>> {
  const currentTick = options.tick ?? Date.now();
  const maxAgentsThisTick = options.maxAgents ?? AGENTS_PER_TICK;
  // Foreground cognition must not queue behind an entire cast's planning calls.
  // The runtime schedules planning separately; batch callers may explicitly opt in.
  const enablePlanning = options.enablePlanning ?? false;
  const selectedAgents = options.agentEids ? new Set(options.agentEids) : undefined;

  // Advance autonomous goal cooldown counter
  if (!selectedAgents) advanceGoalTick(world); // per-actor runtime advances once in its world tick

  // Expire stale goals so agents can generate new ones
  // Goals that have been active for 2+ minutes without completion are expired
  const allAgentsForGoalExpiry = Array.from(query(world, [Agent as any])).filter(
    (eid: number) => Agent.active[eid] && (!selectedAgents || selectedAgents.has(eid)));
  for (const eid of allAgentsForGoalExpiry) {
    if (resumeDeferredGoals(world, eid)) wakeForegroundCognition(world, eid, { cause: "goal_resumed" });
    expireStaleGoals(world, eid);
    maintainGoalLifecycles(world, eid);
  }

  // === PLANNING PHASE ===
  // Generate plans for agents with goals but no active plan
  // This is crucial for multi-step reasoning!
  if (enablePlanning) {
    await runPlanningSystem(world, { agentEids: options.agentEids });
  }

  // Collect pending event-based stimuli by agent
  const eventsByAgent = new Map<number, PendingStimulus[]>();

  const pendingStimuli = drainPendingStimuli(selectedAgents, world).filter(event => !isInvalidHeardSpeechNotice(world, event.targetEid, event)).flatMap(event =>
    filterPerceivableStimuli(world, event.targetEid, [event]));
  for (const stimulus of pendingStimuli) {
    if (deservesForegroundAttention(world, stimulus)) wakeForegroundCognition(world, stimulus.targetEid, { cause: "stimulus", stimulusType: stimulus.type });
    maybeCaptureStimulusAsMemory(world, stimulus);
  }
  for (const stimulus of pendingStimuli) {
    // Intake still happens when this exact hearing progress belongs to a
    // committed listen. Do not requeue it until a redundant model call occurs.
    if (stimulus.type === "speech_fragment" && isContinuingListeningProgress(world, stimulus.targetEid, stimulus)) {
      addPerception(world, stimulus.targetEid, stimulus);
      continue;
    }
    // Preserve inputs for physically occupied agents; they will reconsider when free.
    if (!isForegroundActorAvailable(world, stimulus.targetEid)) {
      if (entityExists(world, stimulus.targetEid)) addPerception(world, stimulus.targetEid, stimulus);
      continue;
    }
    if (!eventsByAgent.has(stimulus.targetEid)) {
      eventsByAgent.set(stimulus.targetEid, []);
    }
    eventsByAgent.get(stimulus.targetEid)!.push(stimulus);
  }

  const allActiveAgents = Array.from(query(world, [Agent, Mind])).filter(
    eid => Agent.active[eid] && (!selectedAgents || selectedAgents.has(eid)) && isForegroundActorAvailable(world, eid)
  );

  // Filter agents based on arousal-based thinking schedule
  // Agents with pending stimuli always get to think
  const readinessByAgent = new Map<number, ForegroundCognitionReadiness>();
  const agentsToProcess = allActiveAgents.filter(eid => {
    const readiness = getForegroundCognitionReadiness(world, eid, {
      hasQueuedStimuli: eventsByAgent.get(eid)?.some(event => deservesForegroundAttention(world, event)),
      hasPendingStimuli: eventsByAgent.get(eid)?.some(event => deservesForegroundAttention(world, event)) || hasUnintegratedAttention(world, eid, false),
      hasDueAttention: hasDueAttentionSignal(world, eid),
    });
    readinessByAgent.set(eid, readiness);
    return readiness.ready && (getAgentWorldCapabilities(world, eid)?.ready() === true || eventsByAgent.has(eid) || shouldAgentThink(eid, currentTick));
  });

  // Apply round-robin pagination to avoid processing all agents at once
  const startIdx = agentProcessingIndex % Math.max(1, agentsToProcess.length);
  const agentsThisTick = agentsToProcess.slice(startIdx, startIdx + maxAgentsThisTick);
  const admitted = new Set(agentsThisTick);
  for (const [eid, events] of eventsByAgent) {
    if (!admitted.has(eid) && entityExists(world, eid)) for (const event of events) queueStimulus(event);
  }

  // Update index for next cycle
  agentProcessingIndex = (startIdx + agentsThisTick.length) % Math.max(1, agentsToProcess.length);

  if (agentsThisTick.length > 0) {
    console.log(`[Cognition] Processing ${agentsThisTick.length}/${allActiveAgents.length} agents this tick`);
  }

  const results: Array<{ eid: number; action: AgentAction }> = [];

  // Process agents in parallel batches for better throughput
  for (let i = 0; i < agentsThisTick.length; i += PARALLEL_BATCH_SIZE) {
    const batch = agentsThisTick.slice(i, i + PARALLEL_BATCH_SIZE);

    const batchResults = await Promise.all(batch.map(async (eid) => {
      recordForegroundCognitionAdmission(world, eid, readinessByAgent.get(eid)!);
      // Convert pending events to stimulus format with modalities
      const pendingEvents = (eventsByAgent.get(eid) || []).filter(event => isStimulusCurrent(event, world)).map(normalizeSensoryEvent);

      // Generate all stimuli for this agent (visual, auditory, cognitive, etc.)
      const currentObservation = captureWorkingMemoryObservation(world, eid);
      reconcileCoordinationGoals(world, eid, currentObservation);
      // A changed visible surface must invalidate the old inspection before
      // deciding that a stored inspection step is already covered.
      for (const plan of getRelationTargets(world, eid, HasPlan)) reconcileCurrentPlan(world, eid, plan);
      const allStimuli = generateStimuliForAgent(world, eid, pendingEvents);

	      // Format stimuli for the agent prompt (include agentEid for self-awareness)
	      const perceptionText = formatStimuliForPrompt(allStimuli, eid, world);

	      // Pass *structured* pending events (tool_result, action_failed, speech, etc.) into Perception storage,
	      // and also pass the formatted summary for the LLM prompt.
	      const structuredPerceptions = pendingEvents.map(s => ({
	        type: s.type,
	        content: s.content,
	        source: s.source,
	        intensity: s.intensity,
	        timestamp: s.timestamp,
	        hearing: s.hearing,
	      }));
	      structuredPerceptions.push({ type: "perception", content: perceptionText, source: "senses", intensity: 0, timestamp: Date.now(), hearing: undefined });

	      // Pass perceptions to cognition
          const capabilities = getAgentWorldCapabilities(world, eid);
          if (!capabilities) return { eid, action: await processAgentCognition(world, eid, structuredPerceptions) };
          for (const perception of structuredPerceptions) addPerception(world, eid, perception);
          const decision = capabilities.beginDecision?.();
          try {
            const parentSignal = getSimulationTaskSignal();
            const action = decision ? await withSimulationTask(AbortSignal.any([decision.signal, ...(parentSignal ? [parentSignal] : [])]),
              () => agentThink(world, eid, decision)) : await agentThink(world, eid);
            if (decision?.isCurrent() === false) return null;
            return { eid, action };
          } catch (error) {
            if (!decision?.signal.aborted && decision?.isCurrent() !== false) console.error(`[Cognition] ${Name.value[eid]}:`, error);
            return null;
          } finally { decision?.finish(); }
	    }));

    results.push(...batchResults.filter((result): result is { eid: number; action: AgentAction } => result !== null
      && !isDiscardedForegroundDecision(result.action)));
  }

  return results;
}

/**
 * Normalize and validate an action type
 * Returns the normalized action type or null if completely invalid
 */
function normalizeActionType(actionType: string): ValidAction | null {
  if (typeof actionType !== "string" || !actionType.trim()) return null;
  const lower = actionType.toLowerCase().trim();

  // Direct match
  if (isValidAction(lower)) {
    return lower as ValidAction;
  }

  // Common mappings for LLM-hallucinated action types
  const mappings: Record<string, ValidAction> = {
    "moveentityongrid": "move",
    "moveto": "move",
    "goto": "move",
    "walk": "move",
    "run": "move",
    "travel": "move",
    "say": "speak",
    "talk": "speak",
    "tell": "speak",
    "shout": "speak",
    "whisper": "speak",
    "yell": "speak",
    "look": "observe",
    "watch": "observe",
    "see": "observe",
    "examine": "observe",
    "inspect": "observe",
    "grab": "pickup",
    "take": "pickup",
    "get": "pickup",
    "collect": "pickup",
    "fight": "attack",
    "hit": "attack",
    "strike": "attack",
    "ponder": "think",
    "consider": "think",
    "contemplate": "think",
    "do": "interact",
    "perform": "interact",
    // Affordance-based actions → interact (the affordance system handles specifics)
    "sharpen": "interact",
    "chop": "interact",
    "cut": "interact",
    "fill": "interact",
    "dry": "interact",
    "light": "interact",
    "ignite": "interact",
    "cook": "interact",
    "eat": "interact",
    "consume": "interact",
    "drink": "interact",
    "unlock": "interact",
    "lock": "interact",
    "open": "interact",
    "close": "interact",
    "pry": "interact",
    "oil": "interact",
    "lubricate": "interact",
    "use": "interact",
    "apply": "interact",
    "stack": "interact",
    "climb": "interact",
    "reach": "interact",
    "search": "interact",
    "combine": "interact",
    "pour": "interact",
    "add": "interact",
    "place": "interact",
    "put": "interact",
    "read": "interact",
    "push": "interact",
    "pull": "interact",
    "turn": "interact",
    "flip": "interact",
    "press": "interact",
    "idle": "wait",
    "pause": "wait",
    "stand": "wait",
  };

  if (mappings[lower]) {
    return mappings[lower];
  }

  // Try to find a partial match
  for (const [pattern, valid] of Object.entries(mappings)) {
    if (lower.includes(pattern) || pattern.includes(lower)) {
      return valid;
    }
  }

  return null;
}

function getVisibleNamesInRoom(
  world: World,
  actorEid: number,
  limit: number = 8
): string[] {
  // Failure recovery is a perception channel too. It must not reveal a hidden
  // person, sealed inventory or an unseen name merely because an action failed.
  return [...new Set(getAgentVisualEntities(world, actorEid)
    .map(eid => Name.value[eid]).filter((name): name is string => !!name))].slice(0, limit);
}

function parseTraitsJson(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t) => String(t)).map((t) => t.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function hasTrait(world: World, eid: number, trait: string): boolean {
  const wanted = String(trait || "").trim().toLowerCase();
  if (!wanted) return false;
  if (!hasComponent(world as any, eid, Traits as any)) return false;
  return parseTraitsJson(Traits.active[eid]).some((t) => t.toLowerCase() === wanted);
}

function getKnownRoomNames(world: World, limit: number = 12): string[] {
  const rooms = Array.from(query(world, [Room]));
  const names = rooms
    .map((eid) => Name.value[eid])
    .filter((n): n is string => typeof n === "string" && n.trim().length > 0);
  return Array.from(new Set(names)).slice(0, limit);
}

function addCriticalActionFailure(
  world: World,
  agentEid: number,
  message: string,
  source: string = "self"
): void {
  addPerception(world, agentEid, {
    type: "action_failed",
    content: `🚨 CRITICAL - YOUR LAST ACTION FAILED\n${message}\n⛔ DO NOT proceed as if this action succeeded.`,
    source,
    intensity: 1,
  });
}

function actionSignature(action: { type: string; target?: string; content?: string }, roomEid: number | undefined): string {
  return JSON.stringify({
    type: action.type,
    target: (action.target || "").trim(),
    content: (action.content || "").trim(),
    roomEid: roomEid ?? null,
  });
}

function failureGuards(world: World) {
  let rows = failedActionsByWorld.get(world);
  if (!rows) { rows = new Map(); failedActionsByWorld.set(world, rows); }
  const recentFailedActions = rows;
  const key = (eid: number) => workingMemoryEntityRef(world, eid)?.key || `missing:${eid}`;
function recordFailedActionAttempt(agentEid: number, signature: string): void {
  const now = readSimulationTime(world);
  const prev = recentFailedActions.get(key(agentEid));
  if (!prev || prev.signature !== signature || now - prev.lastAtMs > REPEAT_FAILURE_WINDOW_MS) {
    recentFailedActions.set(key(agentEid), { signature, count: 1, lastAtMs: now });
    return;
  }
  recentFailedActions.set(key(agentEid), { signature, count: prev.count + 1, lastAtMs: now });
}

function clearFailedActionAttempt(agentEid: number): void {
  recentFailedActions.delete(key(agentEid));
}

function shouldBlockRepeatedFailedAction(agentEid: number, signature: string): boolean {
  const now = readSimulationTime(world);
  const prev = recentFailedActions.get(key(agentEid));
  if (!prev) return false;
  if (prev.signature !== signature) return false;
  if (now - prev.lastAtMs > REPEAT_FAILURE_WINDOW_MS) return false;
  return prev.count >= MAX_REPEAT_FAILURES_BEFORE_BLOCK;
}
  return { recordFailedActionAttempt, clearFailedActionAttempt, shouldBlockRepeatedFailedAction };
}

function normalizeAffordanceToken(raw: string): string {
  // LLMs sometimes emit punctuation or quoting around affordance names, e.g. "run_command:" or "`run_command`".
  // Normalize so the affordance system stays robust without needing prompt-perfect outputs.
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^["'`]+|["'`]+$/g, "")
    // Strip trailing punctuation/symbols but preserve common identifier characters.
    // Use unicode properties to catch non-ASCII punctuation like fullwidth colons.
    .replace(/[^\p{L}\p{N}_-]+$/gu, "");
}

function normalizePlanContent(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "");
}

function doesActionSatisfyPlanStep(
  action: { type: string; target?: string; content?: string },
  step: { actionType: string; target?: string; content?: string }
): boolean {
  const typeMatches = String(action.type || "") === String(step.actionType || "");
  if (!typeMatches) return false;

  const stepTarget = String(step.target || "").trim();
  if (stepTarget) {
    const actionTarget = String(action.target || "").trim();
    if (!actionTarget) return false;
    if (actionTarget.toLowerCase() !== stepTarget.toLowerCase()) return false;
  }

  const stepContent = normalizePlanContent(step.content || "");
  if (!stepContent) return true;

  const actionContent = normalizePlanContent(action.content || "");
  if (!actionContent) return false;

  if (String(step.actionType) === "interact") {
    const stepAff = normalizeAffordanceToken(stepContent.split(/\s+/)[0] || "");
    const actionAff = normalizeAffordanceToken(actionContent.split(/\s+/)[0] || "");
    if (stepAff && actionAff && stepAff !== actionAff) return false;

    const stepArgs = stepContent.replace(/^\S+\s*/, "").trim();
    if (!stepArgs) return true;
    const actionArgs = actionContent.replace(/^\S+\s*/, "").trim();
    if (!actionArgs) return false;

    return actionArgs === stepArgs;
  }

  return actionContent === stepContent;
}

type GoalExecution = Readonly<{ goalEid: number; actorKey: string; goalKey: string; signature: string }>;
type PlanExecution = { planEid: number; goalEid: number; currentStep: number;
  /** Optional only for legacy direct advanceAgentPlan callers. New receipts always capture this. */
  episode?: Readonly<{ planKey: string; createdAt: number; steps: string; goal: GoalExecution }> };
type DeferredExecution = { action: AgentAction; actorKey: string; plan?: PlanExecution; goalEid?: number; goal?: GoalExecution; workingMemory?: WorkingMemoryActionSnapshot;
  inspectionTarget?: { eid: number; key: string }; coordination?: CoordinationActionIssuance; roomTraversal?: RoomTraversal; waitAuthority?: ActorWaitOutcomeAuthority };
const deferredExecutions = new WeakMap<World, Map<number, Map<string, DeferredExecution>>>();
// Only the scheduler possesses these exact action objects. A copied ID or model
// output cannot bypass foreground admission or inherit a newer plan at delivery.
type NativeResumption = DeferredExecution & { world: World; eid: number; startedAtSimMs: number; expectedEndSimMs: number;
  documentWork?: DocumentWorkAdmission;
  publicTarget?: { eid: number; key: string } };
const nativeResumptions = new WeakMap<AgentAction, NativeResumption>();

function publishNativeInterval(resume: NativeResumption, status: "pending" | "succeeded" | "failed") {
  const { world, eid, action, startedAtSimMs, expectedEndSimMs } = resume;
  const roomId = getRoomForEntity(world, eid);
  if (roomId === undefined || !entityExists(world, roomId) || getCommittedSource(world).stopped) return;
  publishCommittedEvent(world, { executionId: action.executionId!, kind: "action", actorId: eid, roomId,
    action: action.type, operation: publicPhysicalOperation(action), status, startedAtSimMs, expectedEndSimMs,
    ...(resume.publicTarget && entityExists(world, resume.publicTarget.eid)
      && workingMemoryEntityRef(world, resume.publicTarget.eid)?.key === resume.publicTarget.key ? { targetId: resume.publicTarget.eid } : {}),
    ...(status === "pending" ? {} : { completedAtSimMs: readSimulationTime(world) }) });
}

function nativeActionDuration(world: World, eid: number, action: AgentAction): number | undefined {
  if (!world.meta.timedActions) return;
  if (action.type === "move") {
    const target = findEntityByName(world, action.target || "", { preferRoomEid: getRoomForEntity(world, eid) });
    // Grid paths already integrate their own movement. Room edges lack geometry:
    // use an explicit short traversal, never a fabricated distance.
    return target !== undefined && hasComponent(world, target, Room) && getRoomForEntity(world, eid) !== target ? 3000 : undefined;
  }
  if (action.type === "interact") {
    const definition = worldSchema.getAffordance(normalizeAffordanceToken(action.content?.split(/\s+/)[0] || ""));
    // Tool jobs already have a real external completion boundary.
    if (definition?.effects?.some(effect => effect.type === "run_tool")) return;
    if (definition?.durationMs !== undefined) {
      if (!Number.isFinite(definition.durationMs) || definition.durationMs < 0) throw new RangeError("Invalid affordance durationMs");
      return definition.durationMs;
    }
    return 1000;
  }
  return ({ pickup: 800, drop: 600, give: 1000, use: 2000, observe: 1000, examine: 1500,
    attack: 800, defend: 500 } as Partial<Record<AgentAction["type"], number>>)[action.type];
}

function scheduleNativeAction(world: World, eid: number, operation: DeferredExecution, registry: SystemRegistry): boolean {
  // Explicit topology supplies its own world-time edge traversal even when a
  // legacy world's general timedActions flag is absent. It cannot teleport.
  const documentOperation = isDocumentOperation(operation.action);
  const documentTarget = documentOperation ? findEntityByName(world, operation.action.target || "", { preferRoomEid: getRoomForEntity(world, eid) }) : undefined;
  const documentWork = documentTarget === undefined ? undefined : captureDocumentWork(world, eid, documentTarget, operation.action);
  if (documentOperation && !documentWork) return false;
  const duration = documentWork?.durationMs ?? operation.roomTraversal?.travelMs ?? nativeActionDuration(world, eid, operation.action);
  if (duration === undefined || duration === 0) return false;
  const room = getRoomForEntity(world, eid), bindings: Array<{ label: string; eid: number; key: string }> = [];
  const labels = [operation.action.target, operation.action.type === "give" ? operation.action.content : undefined].filter(Boolean) as string[];
  for (const label of labels) {
    const target = operation.roomTraversal ? operation.roomTraversal.to : findEntityByName(world, label, { preferRoomEid: room });
    // Invalid targets fail through the ordinary executor immediately.
    if (target === undefined) { cancelDocumentWork(documentWork); return false; }
    bindings.push({ label, eid: target, key: workingMemoryEntityRef(world, target)!.key });
  }
  const action = Object.freeze({ ...operation.action, executionId: `execution:${randomUUID()}` });
  if (!reserveSimulationResources(world, eid, action.executionId, ["body"], { activity: {
    kind: action.type === "move" ? "moving" : "operating", operation: publicPhysicalOperation(action), targetEid: bindings[0]?.eid,
  } })) { cancelDocumentWork(documentWork); return true; }
  const resume: NativeResumption = { ...operation, action, world, eid, documentWork,
    ...(bindings[0] ? { publicTarget: { eid: bindings[0].eid, key: bindings[0].key } } : {}),
    startedAtSimMs: readSimulationTime(world), expectedEndSimMs: readSimulationTime(world) + duration };
  const roomKey = room === undefined ? undefined : workingMemoryEntityRef(world, room)?.key;
  const capabilityGeneration = getAgentWorldCapabilityGeneration(world, eid);
  const sourceId = getCommittedSource(world).sourceId ?? startCommittedEvents(world);
  let pending = deferredExecutions.get(world);
  if (!pending) { pending = new Map(); deferredExecutions.set(world, pending); }
  let operations = pending.get(eid);
  if (!operations) { operations = new Map(); pending.set(eid, operations); }
  operations.set(action.executionId, resume);
  const rows = operations;
  const cleanup = () => { cancelDocumentWork(documentWork); rows.delete(action.executionId); nativeResumptions.delete(action); releaseSimulationResources(world, eid, action.executionId); };
  scheduleSimulationEvent(world, { atSimMs: resume.expectedEndSimMs, phase: "physical", cancel: () => {
    // Cancellation closes the original public interval, never completes work or
    // grants a plan receipt. Recycled actors/new event sources cannot inherit it.
    if (rows.get(action.executionId) === resume && entityExists(world, eid)
      && workingMemoryEntityRef(world, eid)?.key === operation.actorKey
      && getCommittedSource(world).sourceId === sourceId && !getCommittedSource(world).stopped)
      publishNativeInterval(resume, "failed");
    cleanup();
  }, run: () => {
    releaseSimulationResources(world, eid, action.executionId);
    if (!entityExists(world, eid) || !Agent.active[eid] || workingMemoryEntityRef(world, eid)?.key !== operation.actorKey
      || getCommittedSource(world).stopped || getCommittedSource(world).sourceId !== sourceId) { cleanup(); return; }
    if(!isEntityPresent(world,eid)){publishNativeInterval(resume,"failed");cleanup();return;}
    const sameCapability = getAgentWorldCapabilityGeneration(world, eid) === capabilityGeneration;
    // Legacy package replacement remains silent cancellation. An opted-in walk
    // can report its failed crossing to the same source/actor, never teleport
    // through a policy/package change or rebind the newer execution authority.
    if (!sameCapability && !operation.roomTraversal) { cleanup(); return; }
    const sameRoom = getRoomForEntity(world, eid) === room && (room === undefined || workingMemoryEntityRef(world, room)?.key === roomKey);
    const sameTargets = bindings.every(binding => isEntityPresent(world, binding.eid)
      && workingMemoryEntityRef(world, binding.eid)?.key === binding.key
      && (operation.roomTraversal ? resolveRoomRouteTarget(world, eid, binding.label) : findEntityByName(world, binding.label, { preferRoomEid: room })) === binding.eid);
    const sameRoute = !operation.roomTraversal || isRoomTraversalCurrent(world, eid, operation.roomTraversal);
    if (!sameRoom || !sameTargets || !sameRoute || !sameCapability) {
      completeDeferredAction(world, eid, action, false, "The action was interrupted: its original location or target is no longer available.");
      publishNativeInterval(resume, "failed");
      cleanup(); wakeForegroundCognition(world, eid); return;
    }
    rows.delete(action.executionId);
    nativeResumptions.set(action, resume);
    try { executeActions(world, [{ eid, action }], registry); }
    catch (error) { wakeForegroundCognition(world, eid, { cause: "execution_outcome" }); throw error; }
    // The executor already recorded success/failure and its quiet backoff.
    // Cleanup is resource bookkeeping, not new evidence or another decision.
    // In particular a completed observe must not erase its own idle outcome.
    finally { cleanup(); }
  } });
  endRest(world, eid);
  publishNativeInterval(resume, "pending");
  return true;
}

function isVisualInspectionAction(action: { type: string; content?: string }): boolean {
  return ["observe", "examine"].includes(action.type)
    || action.type === "interact" && /^(examine|inspect|observe)$/i.test(action.content?.trim() || "");
}

/** Bind a pending look to an accessible entity at issuance, not a later name match. */
function captureInspectionTarget(world: World, eid: number, action: AgentAction, before?: WorkingMemoryActionSnapshot) {
  if (!isVisualInspectionAction(action) || !before) return;
  const target = findEntityByName(world, action.target || "", { preferRoomEid: before.room });
  if (target === undefined) return;
  const ref = before.entities.find(item => item.eid === target)?.ref
    || (target === before.room ? workingMemoryEntityRef(world, target) : undefined);
  return ref ? { eid: target, key: ref.key } : undefined;
}

/** Semantic episode identity excludes mutable progress/priority/deadline fields.
 * A real result may progress its original goal, but cannot inherit an in-place
 * replacement simply because the entity slot and action words stayed equal. */
function goalExecutionSignature(world: World, goalEid: number): string {
  return JSON.stringify([Goal.createdAt[goalEid], Goal.description[goalEid], Goal.kind[goalEid],
    Goal.paramsJson[goalEid], Goal.successJson[goalEid], Goal.signature[goalEid], intentionReviewRevision(world, goalEid)]);
}
function ensureExecutionIdentity(world: World, eid: number, prefix: string): string {
  if (!hasComponent(world, eid, WorkingMemoryIdentity)) {
    addComponent(world, eid, WorkingMemoryIdentity); WorkingMemoryIdentity.id[eid] = `${prefix}:${randomUUID()}`;
  } else if (!WorkingMemoryIdentity.id[eid]) WorkingMemoryIdentity.id[eid] = `${prefix}:${randomUUID()}`;
  return WorkingMemoryIdentity.id[eid];
}
function captureGoalExecution(world: World, eid: number, goalEid: number | undefined): GoalExecution | undefined {
  if (goalEid === undefined || !entityExists(world, eid) || !entityExists(world, goalEid)
    || !hasComponent(world, goalEid, Goal) || Goal.status[goalEid] !== "active"
    || !getRelationTargets(world, eid, HasGoal).includes(goalEid)) return;
  return Object.freeze({ goalEid, actorKey: ensureExecutionIdentity(world, eid, "entity"),
    goalKey: ensureExecutionIdentity(world, goalEid, "goal"), signature: goalExecutionSignature(world, goalEid) });
}
function isGoalExecutionCurrent(world: World, eid: number, execution: GoalExecution): boolean {
  return entityExists(world, eid) && hasComponent(world, eid, WorkingMemoryIdentity)
    && WorkingMemoryIdentity.id[eid] === execution.actorKey && entityExists(world, execution.goalEid)
    && hasComponent(world, execution.goalEid, Goal) && hasComponent(world, execution.goalEid, WorkingMemoryIdentity)
    && WorkingMemoryIdentity.id[execution.goalEid] === execution.goalKey && Goal.status[execution.goalEid] === "active"
    && getRelationTargets(world, eid, HasGoal).includes(execution.goalEid)
    && goalExecutionSignature(world, execution.goalEid) === execution.signature;
}
function isPlanExecutionCurrent(world: World, eid: number, execution: PlanExecution): boolean {
  const episode = execution.episode;
  return !!episode && isGoalExecutionCurrent(world, eid, episode.goal)
    && entityExists(world, execution.planEid) && entityExists(world, execution.goalEid) &&
    hasComponent(world, execution.planEid, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[execution.planEid] === episode.planKey &&
    Plan.createdAt[execution.planEid] === episode.createdAt && Plan.steps[execution.planEid] === episode.steps &&
    hasComponent(world, execution.planEid, Plan) && hasComponent(world, execution.goalEid, Goal) &&
    Plan.status[execution.planEid] === "active" && Goal.status[execution.goalEid] === "active" &&
    Plan.goalEid[execution.planEid] === execution.goalEid && Plan.currentStep[execution.planEid] === execution.currentStep &&
    getRelationTargets(world, eid, HasPlan).includes(execution.planEid) && getRelationTargets(world, eid, HasGoal).includes(execution.goalEid);
}

export function capturePlanExecution(world: World, eid: number, action: AgentAction): PlanExecution | undefined {
  const step = getNextPlannedAction(world, eid);
  if (!step || !doesActionSatisfyPlanStep(action, step)) return undefined;
  // Capture identity before starting the physical action: completion must not
  // advance whichever unrelated/replacement plan happens to be current later.
  if (step.planEid === undefined || step.goalEid === undefined || step.currentStep === undefined) return;
  const goal = captureGoalExecution(world, eid, step.goalEid);
  if (!goal || !entityExists(world, step.planEid) || !hasComponent(world, step.planEid, Plan)) return;
  return Object.freeze({ planEid: step.planEid, goalEid: step.goalEid, currentStep: step.currentStep,
    episode: Object.freeze({ planKey: ensureExecutionIdentity(world, step.planEid, "plan"),
      createdAt: Plan.createdAt[step.planEid], steps: Plan.steps[step.planEid], goal }) });
}

export function recordCompletedGoalAction(world: World, eid: number, action: AgentAction, goalEid?: number | null) {
  if (goalEid === null) return; // no known attribution at issuance
  // Successful direct choices count as activity just as planned steps do.
  // Unknown legacy attribution and idle waiting must not renew another goal.
  if (typeof goalEid === "number" && !["wait", "rest"].includes(action.type))
    recordGoalAttemptActivity(world, eid, goalEid);
  trackGoalAction(world, eid, { ...action, affordance: action.type === "interact" ? action.content?.split(/\s+/)[0] : undefined }, goalEid);
}

/** Complete utterances become social evidence only at their delivery boundary. */
function deliverSpeech(world: World, eid: number, action: AgentAction,
  delivery?: { audience: ReadonlySet<number>; interval: SpeechInterval }, privatePurpose?: string): void {
  const roomEid = getRoomForEntity(world, eid), name = Name.value[eid];
  if (!action.content || roomEid === undefined) return;
  const speech = recordCommittedSpeech(world, eid, action.content, action.target, Date.now(), delivery, privatePurpose);
  // Timed words already reached listeners as coherent heard spans. Completion
  // adds the full-turn receipt, not a duplicate utterance-sized stimulus.
  if (!delivery) broadcastSound(world, roomEid, `${name} says: "${action.content}"`, name, eid);
  console.log(`💬 ${name}: "${action.content}"`);
  chronicle.record("conversation", { speaker: name, target: action.target || "room", content: action.content.slice(0, 100),
    ...(delivery ? { simulation: delivery.interval } : {}) });
  if (!delivery) {
    resolveDecision(world, eid, true, action);
    queueStimulus(world, { targetEid: eid, type: "action_result", modality: "cognitive", content: `You say: "${action.content}"`, source: "speech" });
    onProcedureActionResult(world, eid, action, { success: true });
  }
  if (action.target && !delivery) {
    const target = findEntityByName(world, action.target, { preferRoomEid: roomEid });
    if (target !== undefined && hasComponent(world, target, Agent) && getRoomForEntity(world, target) === roomEid
      && getAgentSensoryCapabilities(world, target).auditory > 0) {
      queueStimulus(world, { targetEid: target, type: "speech", modality: "auditory", content: `${name} says to you: "${action.content}"`,
        source: name, intensity: 1 });
      Mind.arousal[target] = Math.min(1, (Mind.arousal[target] || 0.5) + 0.2);
      Mind.focus[target] = `heard ${name}`;
    }
  }
  extractKnowledgeFromInteraction(world, eid, { type: "speech", content: action.content,
    speechId: speech?.id,
    perspective: "own_speech", speaker: name, otherParty: action.target,
    context: `Speaking in ${Name.value[roomEid] || "a room"}` }).catch(() => {});
}

export function executeActions(
  world: World,
  actions: Array<{ eid: number; action: AgentAction }>,
  registry: SystemRegistry
): void {
  assertSimulationTaskActive();
  const { recordFailedActionAttempt, clearFailedActionAttempt, shouldBlockRepeatedFailedAction } = failureGuards(world);
  let recentPlanStepFailures = planStepFailuresByWorld.get(world);
  if (!recentPlanStepFailures) { recentPlanStepFailures = new Map(); planStepFailuresByWorld.set(world, recentPlanStepFailures); }
  for (const { eid, action } of actions) {
    const candidate = nativeResumptions.get(action);
    const nativeResume = candidate?.world === world && candidate.eid === eid ? candidate : undefined;
    if (nativeResume) nativeResumptions.delete(action);
    // Skip if entity no longer exists
    if (!isEntityPresent(world, eid) || getCommittedSource(world).stopped) continue;
    const requestedType = normalizeActionType(action.type);
    const replacingSpeech = !!action.stopSpeechId;
    const interruptionSource = replacingSpeech ? getCommittedSource(world).sourceId : undefined;
    const interruptionActor = replacingSpeech ? workingMemoryEntityRef(world, eid)?.key : undefined;
    const interruptionGeneration = replacingSpeech ? getAgentWorldCapabilityGeneration(world, eid) : undefined;
    const interruptionRoom = replacingSpeech ? getRoomForEntity(world, eid) : undefined;
    const interruptionRoomKey = interruptionRoom === undefined ? undefined : workingMemoryEntityRef(world, interruptionRoom)?.key;
    const interruptionTargets = replacingSpeech ? [action.target, action.type === "give" ? action.content : undefined]
      .filter((label): label is string => !!label).map(label => {
        const target = findEntityByName(world, label, { preferRoomEid: interruptionRoom });
        return { label, target, key: target === undefined ? undefined : workingMemoryEntityRef(world, target)?.key };
      }) : [];
    if (replacingSpeech && getSpeakingActivity(world, eid)?.executionId !== action.stopSpeechId) {
      chronicle.record("decision_superseded", { agent: Name.value[eid], reason: "voice_changed", boundary: "dispatch" });
      wakeForegroundCognition(world, eid); continue;
    }
    if (requestedType === "speak" && isSpeaking(world, eid) && !replacingSpeech) continue;
    if (world.meta.timedSpeech && requestedType === "speak" && !replacingSpeech) {
      const opportunity = readLocalSpeechOpportunity(world, eid, { mode: action.speechMode === "interrupt" ? "urgent" : "conversational" });
      if (!opportunity.available) {
        // New protocol retains a separately integrated purpose and a bounded,
        // dependency-checked speech proposal. Legacy drafts remain unadmitted.
        deferIntegratedForegroundSpeech(world, eid, action);
        deferForegroundSpeech(world, eid, Math.min(readSimulationTime(world) + 1000, opportunity.nextCheckAtSimMs ?? readSimulationTime(world) + 500));
        chronicle.record("speech_deferred", { agent: Name.value[eid], reason: opportunity.reason });
        continue;
      }
    }
    if (requestedType && ["move", "interact", "pickup", "drop", "give", "use", "attack", "observe", "examine", "rest"].includes(requestedType)
      && isSimulationResourceBusy(world, eid, "body") && !getAgentWorldCapabilities(world, eid)?.canInterruptBusyAction?.(action)) continue;

    // Recheck the exact actor-owned foreground issuance immediately before any
    // physical admission, proof capture, learning or side effects. Parallel
    // model returns can otherwise race one another after their first check.
    const foreground = nativeResume ? { admitted: true, reason: undefined, reasoning: undefined, mentalUpdateOmitted: false }
      : consumeForegroundAction(world, eid, action);
    if (!foreground.admitted) {
      if (foreground.reason) chronicle.record("decision_superseded", { agent: Name.value[eid], reason: foreground.reason,
        boundary: "dispatch", actionType: action.type, target: action.target, requestId: action.foregroundDecisionId,
        ...("localDependencyChange" in foreground && foreground.localDependencyChange ? { localDependencyChange: foreground.localDependencyChange } : {}) });
      wakeForegroundCognition(world, eid);
      continue;
    }
    if (foreground.mentalUpdateOmitted) wakeForegroundCognition(world, eid);
    if (action.waitUntil && (action.type !== "wait" || action.listeningTo || !prepareActorWait(world, eid, action.waitUntil))) {
      addCriticalActionFailure(world, eid, "FAILED: That waiting condition is not currently grounded in your available evidence.", "waiting");
      wakeForegroundCognition(world, eid, { cause: "execution_outcome" }); continue;
    }
    if (action.listeningTo && (action.type !== "wait" || !getListeningActivities(world, eid).some(row => row.executionId === action.listeningTo))) {
      addCriticalActionFailure(world, eid, "FAILED: That heard voice is no longer available to listen to.", "hearing");
      wakeForegroundCognition(world, eid, { cause: "execution_outcome" });
      continue;
    }
    const privateSpeechPurpose = "purpose" in foreground ? foreground.purpose : undefined;
    if (replacingSpeech && !interruptTimedSpeech(world, eid, "self_correction", { executionId: action.stopSpeechId })) {
      wakeForegroundCognition(world, eid); continue;
    }
    // Ending a voice calls synchronous observers. A stop, restart or world edit
    // there cannot authorize a fresh action after its old admission boundary.
    if (replacingSpeech && (getCommittedSource(world).stopped || getCommittedSource(world).sourceId !== interruptionSource
      || !entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid]
      || workingMemoryEntityRef(world, eid)?.key !== interruptionActor
      || getAgentWorldCapabilityGeneration(world, eid) !== interruptionGeneration
      || getRoomForEntity(world, eid) !== interruptionRoom
      || interruptionRoom !== undefined && workingMemoryEntityRef(world, interruptionRoom)?.key !== interruptionRoomKey
      || interruptionTargets.some(binding => findEntityByName(world, binding.label, { preferRoomEid: interruptionRoom }) !== binding.target
        || binding.target !== undefined && workingMemoryEntityRef(world, binding.target)?.key !== binding.key))) continue;

    const name = Name.value[eid];
    const roomEid = getRoomForEntity(world, eid);

    // Validate and normalize the action type
    const originalType = action.type;
    const normalizedType = normalizeActionType(originalType);

    if (normalizedType === null) {
      // Completely invalid action - log and skip
      console.log(`⚠️ ${name} tried invalid action "${originalType}" - skipping`);

      // Record consistency issue
      const issues = validateAgentAction(world, name, originalType, action.target, action.content);
      for (const issue of issues) {
        recordIssue(issue);
      }
      continue;
    }

    // If action was normalized, log it
    if (normalizedType !== originalType.toLowerCase()) {
      console.log(`🔧 Normalized "${originalType}" -> "${normalizedType}" for ${name}`);
    }

    // Use the normalized action type
    // IMPORTANT: If an affordance-type action was normalized to "interact",
    // preserve the original action name as the content (affordance to execute)
    // Self-stop is consumed once here, never replayed by a later body callback.
    const { stopSpeechId: _consumedVoice, ...withoutVoiceControl } = action;
    let validatedAction = { ...withoutVoiceControl, type: normalizedType };
    if (normalizedType === "interact" && originalType.toLowerCase() !== "interact") {
      // The original type was an affordance name (e.g., "sharpen", "cook", "oil")
      // Put it in the content field so the interact handler can use it
      const originalLower = originalType.toLowerCase();
      if (!validatedAction.content || validatedAction.content.trim() === "") {
        validatedAction = { ...validatedAction, content: originalLower };
      } else if (!validatedAction.content.toLowerCase().startsWith(originalLower)) {
        // Prepend the affordance name if content doesn't already start with it
        validatedAction = { ...validatedAction, content: `${originalLower} ${validatedAction.content}` };
      }
    }
    if (foreground.reasoning !== undefined) captureLLMDecision(world, eid, foreground.reasoning,
      { type: validatedAction.type as any, target: validatedAction.target, content: validatedAction.content },
      validatedAction.type === "interact" ? validatedAction.content?.split(/\s+/)[0] : undefined);

    // Domain-specific actions can take physical time. The package must report
    // completion later; accepting an intention must NOT advance the plan here.
    const capabilities = getAgentWorldCapabilities(world, eid);
    const visualInspection = ["observe", "examine"].includes(validatedAction.type) || validatedAction.type === "interact" &&
      ["examine", "inspect", "observe"].includes(normalizeAffordanceToken(validatedAction.content?.split(/\s+/)[0] || ""));
    const hasSight = getAgentSensoryCapabilities(world, eid).visual > 0;
    const inspectionTarget = visualInspection
      ? validatedAction.target ? findEntityByName(world, validatedAction.target, { preferRoomEid: roomEid }) : roomEid
      : undefined;
    // The package is a physical executor, not an alternate visual admission
    // authority. Explicit visual aliases must pass sight before dispatch too;
    // specialized commands such as read_message retain their authored rules.
    const visualInspectionUnavailable = visualInspection && (!hasSight || inspectionTarget === undefined
      || inspectionTarget !== roomEid && !getAgentVisualEntities(world, eid).includes(inspectionTarget));
    const waitAuthority = nativeResume?.waitAuthority ?? captureActorWaitOutcomeAuthority(world, eid, validatedAction,
      "selected" in foreground && foreground.selected === true);
    const actionPlan = nativeResume ? nativeResume.plan : capturePlanExecution(world, eid, validatedAction as AgentAction);
    const workingMemoryBefore = nativeResume ? nativeResume.workingMemory : captureWorkingMemoryAction(world, eid, validatedAction as AgentAction);
    // A parent goal can support several different promises. Attribute only the
    // explicitly selected undertaking, never every promise sharing that goal.
    const coordination = nativeResume ? nativeResume.coordination : validatedAction.coordinationWork
      ? captureCoordinationAction(world, eid, validatedAction.coordinationWork, validatedAction)
      : undefined;
    // Choosing an independent purpose is not evidence for an unrelated goal.
    // Preserve the same ownership used to select a deterministic primitive;
    // otherwise its successful receipt can train the wrong behavior tree.
    const ownedPurpose = snapshotActorContinuation(world, eid);
    const actionGoal = nativeResume ? nativeResume.goalEid : actionPlan?.goalEid ?? (ownedPurpose
      ? situatedPlanGoal(world, eid)
      : getRelationTargets(world, eid, HasGoal)
        .filter(gid => hasComponent(world, gid, Goal) && Goal.status[gid] === "active"
          && (world.meta.aiEnabled === false || Goal.kind[gid] !== "scheduled_activity"))
        .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0))[0]);
    const actionGoalEpisode = nativeResume ? nativeResume.goal : captureGoalExecution(world, eid, actionGoal);
    // The same one-step topology that supplies the action menu owns admission
    // and completion. Package execute hooks cannot bypass it with a global name.
    const topologyMove = validatedAction.type === "move" && (!!nativeResume?.roomTraversal || !!getRoomRouteTopologyGeneration(world));
    const roomTraversal = nativeResume?.roomTraversal ?? (topologyMove ? captureRoomTraversal(world, eid, validatedAction.target || "") : undefined);
    const unavailableRoute = topologyMove && (!roomTraversal || !isRoomTraversalCurrent(world, eid, roomTraversal));
    if (!nativeResume && capabilities && !visualInspectionUnavailable && !topologyMove && validatedAction.type !== "speak") {
      // Every admission is a distinct physical operation, even if it repeats
      // identical words. Packages must retain this ID with their pending work.
      validatedAction = { ...validatedAction, executionId: `execution:${randomUUID()}` };
      let pending = deferredExecutions.get(world);
      if (!pending) { pending = new Map(); deferredExecutions.set(world, pending); }
      const actorKey = workingMemoryEntityRef(world, eid)!.key;
      let operations = pending.get(eid);
      if (!operations || [...operations.values()].some(previous => previous.actorKey !== actorKey)) {
        operations = new Map(); pending.set(eid, operations);
      }
      // A concurrent voice is not an ignored prior body operation. Its receipt
      // must not cause a newly admitted walk/pickup receipt to be discarded.
      const previousIds = [...operations].filter(([, previous]) => previous.action.type !== "speak").map(([id]) => id);
      const executionId = validatedAction.executionId!;
      operations.set(executionId, { action: { ...validatedAction } as AgentAction, actorKey, plan: actionPlan, goalEid: actionGoal, goal: actionGoalEpisode,
        workingMemory: workingMemoryBefore, inspectionTarget: captureInspectionTarget(world, eid, validatedAction as AgentAction, workingMemoryBefore), coordination, waitAuthority });
      let handled: boolean;
      try { handled = capabilities.execute(validatedAction as AgentAction); }
      catch (error) { operations.delete(executionId); throw error; }
      if (handled) {
        // A package may synchronously finish a held operation and acknowledge
        // its release in the same call. Both need distinct receipts. If it only
        // ignores a new command while busy, do not accumulate phantom work.
        if (previousIds.some(id => operations.has(id))) operations.delete(executionId);
        if (capabilities.busy?.()) { endRest(world, eid); wakeForegroundCognition(world, eid); }
        // A synchronous package completion already recorded its actual outcome.
        // Do not erase quiet pacing established by that completion callback.
        continue;
      }
      operations.delete(executionId);
    }

    // Used for plan advancement: do not advance a plan step if the action clearly failed,
    // or if we're waiting on an async tool job to complete.
    // Fail closed. Every implemented handler must explicitly report completion.
    // Previously missing items, unknown moves and unimplemented actions advanced plans.
    let actionSucceededForPlan = false;
    let actionPendingForPlan = false;
    let executedTargetKey: string | undefined;
    const targetResolved = (target: number | undefined) => {
      if (coordination && target !== undefined) executedTargetKey = workingMemoryEntityRef(world, target)?.key;
    };

    const sig = actionSignature(validatedAction, roomEid);
    if (!nativeResume && shouldBlockRepeatedFailedAction(eid, sig)) {
      addCriticalActionFailure(
        world,
        eid,
        `FAILED: You are repeating the same action that just failed ("${validatedAction.type}"${validatedAction.target ? ` on "${validatedAction.target}"` : ""}).\nYou MUST change strategy: observe the room, inspect visible objects, or choose a different target.`,
        "recovery"
      );
      Mind.focus[eid] = "recover";
      continue;
    }

    if (!nativeResume && !visualInspectionUnavailable && !unavailableRoute && scheduleNativeAction(world, eid, {
      action: validatedAction as AgentAction, actorKey: workingMemoryEntityRef(world, eid)!.key,
      plan: actionPlan, goalEid: actionGoal, goal: actionGoalEpisode, workingMemory: workingMemoryBefore, coordination,
      inspectionTarget: captureInspectionTarget(world, eid, validatedAction as AgentAction, workingMemoryBefore),
      roomTraversal, waitAuthority,
    }, registry)) continue;

    switch (validatedAction.type) {
      case "speak":
        if (validatedAction.content && roomEid !== undefined) {
          if (world.meta.timedSpeech) {
            const speechAction: AgentAction = Object.freeze({ ...validatedAction, type: "speak", executionId: `execution:${randomUUID()}` });
            let pending = deferredExecutions.get(world);
            if (!pending) { pending = new Map(); deferredExecutions.set(world, pending); }
            let operations = pending.get(eid);
            if (!operations) { operations = new Map(); pending.set(eid, operations); }
            const executionId = speechAction.executionId!;
            operations.set(executionId, { action: speechAction, actorKey: workingMemoryEntityRef(world, eid)!.key,
              plan: actionPlan, goalEid: actionGoal, goal: actionGoalEpisode, workingMemory: workingMemoryBefore, coordination, waitAuthority });
            const operationRows = operations;
            const speechStart = readSimulationTime(world), speechEnd = speechStart + estimateSpeechDurationMs(speechAction.content!);
            const speechActorKey = workingMemoryEntityRef(world, eid)!.key;
            const speechActorName = Name.value[eid];
            const speechSource = getCommittedSource(world).sourceId ?? startCommittedEvents(world);
            const speechGeneration = getAgentWorldCapabilityGeneration(world, eid);
            const speechContextCurrent = () => !getCommittedSource(world).stopped && getCommittedSource(world).sourceId === speechSource
              && entityExists(world, eid) && hasComponent(world, eid, Agent) && Agent.active[eid]
              && workingMemoryEntityRef(world, eid)?.key === speechActorKey
              && getAgentWorldCapabilityGeneration(world, eid) === speechGeneration;
            const flushInterruptedHearing = () => {
              for (const heard of flushHeardSpeechFragments(world, executionId))
                queueStimulus(world, { targetEid: heard.eid, type: "speech_fragment", modality: "auditory", content: heard.content, source: speechActorName, hearing: heard.hearing });
            };
            let speechPublished = false;
            const publishSpeechTerminal = (success: boolean) => {
              const currentRoom = getRoomForEntity(world, eid);
              if (!speechPublished || getCommittedSource(world).stopped || !entityExists(world, eid)
                || workingMemoryEntityRef(world, eid)?.key !== speechActorKey || currentRoom === undefined) return;
              speechPublished = false;
              publishCommittedEvent(world, { executionId, kind: "speech", actorId: eid, roomId: currentRoom,
                action: "speak", status: success ? "succeeded" : "failed", startedAtSimMs: speechStart,
                expectedEndSimMs: speechEnd, completedAtSimMs: readSimulationTime(world) });
            };
            actionPendingForPlan = beginTimedSpeech(world, eid, speechAction.content!, executionId, result => {
              if (!speechContextCurrent()) { operationRows.delete(executionId); return; }
              if (!result.success) flushInterruptedHearing();
              if (result.success) deliverSpeech(world, eid, speechAction, result, privateSpeechPurpose);
              if (!speechContextCurrent()) { operationRows.delete(executionId); return; }
              completeDeferredAction(world, eid, speechAction, result.success,
                result.success ? `You finished saying: "${speechAction.content}"`
                  : `Your speech stopped${result.spokenText ? ` after saying: ${JSON.stringify(result.spokenText.trim())}` : " before any words were spoken"}. The remaining words were not delivered.`);
              if (!speechContextCurrent()) return;
              capabilities?.afterAction?.(result.success ? speechAction : { ...speechAction, content: result.spokenText }, result.success, false);
              if (!speechContextCurrent()) return;
              publishSpeechTerminal(result.success);
              if (!speechContextCurrent()) return;
              wakeForegroundCognition(world, eid);
            }, () => { operationRows.delete(executionId); publishSpeechTerminal(false); }, {
              floor: replacingSpeech || speechAction.speechMode === "interrupt" ? "urgent" : "conversational",
              fragment: fragment => {
              for (const heard of recordHeardSpeechFragment(world, eid, fragment, speechAction.target))
                queueStimulus(world, { targetEid: heard.eid, type: "speech_fragment", modality: "auditory", content: heard.content, source: Name.value[eid], hearing: heard.hearing });
              publishCommittedEvent(world, { executionId, kind: "speech", actorId: eid, roomId: fragment.roomId,
                action: "speak", status: "succeeded", startedAtSimMs: fragment.startedAtSimMs, text: fragment.content });
            } });
            if (!actionPendingForPlan) operationRows.delete(executionId);
            else {
              speechPublished = true;
              publishCommittedEvent(world, { executionId, kind: "speech", actorId: eid, roomId: roomEid,
                action: "speak", status: "pending", startedAtSimMs: speechStart, expectedEndSimMs: speechEnd });
            }
            // Admission observers can stop/restart the world, replace its actor
            // or package, or finish/interrupt this voice synchronously. Never
            // overwrite that settlement with stale pending bookkeeping below.
            if (!speechContextCurrent() || actionPendingForPlan
              && getSpeakingActivity(world, eid)?.executionId !== executionId) continue;
            validatedAction = speechAction;
          } else {
            actionSucceededForPlan = true;
            deliverSpeech(world, eid, { ...validatedAction, type: "speak" }, undefined, privateSpeechPurpose);
          }
        }
        clearFailedActionAttempt(eid);
        break;

      case "observe":
        if (getAgentSensoryCapabilities(world, eid).visual <= 0) {
          const failure = "FAILED: Visual inspection is unavailable without sight.";
          addCriticalActionFailure(world, eid, failure, "observation");
          if (!hasComponent(world, eid, LastAction)) addComponent(world, eid, LastAction);
          LastAction.type[eid] = "observe"; LastAction.target[eid] = validatedAction.target || "";
          LastAction.content[eid] = ""; LastAction.success[eid] = false; LastAction.timestamp[eid] = Date.now();
          recordFailedActionAttempt(eid, sig);
          onProcedureActionResult(world, eid, validatedAction, { success: false });
          break;
        }
        if (action.target) {
          Mind.focus[eid] = action.target;
          console.log(`👁️ ${name} observes ${action.target}`);

          // Find the target and provide detailed observation
          const observeTargetEid = findEntityByName(world, action.target, { preferRoomEid: roomEid });
          if (observeTargetEid === undefined) {
            actionSucceededForPlan = false;
            const visible = getVisibleNamesInRoom(world, eid);
            const hint = visible.length > 0 ? `Visible here: ${visible.join(", ")}.` : "No matching named entity is visible here.";
            addCriticalActionFailure(
              world,
              eid,
              `FAILED: You cannot currently see "${action.target}". ${hint}`,
              "observation"
            );
            if (!hasComponent(world as any, eid, LastAction as any)) addComponent(world as any, eid, LastAction as any);
            LastAction.type[eid] = "observe";
            LastAction.target[eid] = action.target || "";
            LastAction.content[eid] = "";
            LastAction.success[eid] = false;
            LastAction.timestamp[eid] = Date.now();
            recordFailedActionAttempt(eid, sig);
            const issues = validateAgentAction(world, name, validatedAction.type, action.target, action.content);
            for (const issue of issues) recordIssue(issue);
            break;
          }

          // Physical reach is not sight. A known/touchable hidden possession or
          // a remembered name cannot reveal its current description or state.
          if (observeTargetEid !== roomEid && !getAgentVisualEntities(world, eid).includes(observeTargetEid)) {
            actionSucceededForPlan = false;
            const targetName = action.target;
            const visible = getVisibleNamesInRoom(world, eid);
            const hint = visible.length > 0 ? `Visible here: ${visible.join(", ")}.` : "No matching named entity is visible here.";
            addCriticalActionFailure(
              world,
              eid,
              `FAILED: You cannot currently see "${targetName}". ${hint}`,
              "observation"
            );
            if (!hasComponent(world as any, eid, LastAction as any)) addComponent(world as any, eid, LastAction as any);
            LastAction.type[eid] = "observe";
            LastAction.target[eid] = targetName || action.target || "";
            LastAction.content[eid] = "";
            LastAction.success[eid] = false;
            LastAction.timestamp[eid] = Date.now();
            recordFailedActionAttempt(eid, sig);
            break;
          }
          targetResolved(observeTargetEid);

          // Only set grid movement target if agent has no current room (grid-only mode).
          // In room-based simulation, agents are already co-located with observable objects.
          // Setting movementTarget here previously blocked all future room-based moves.
          if (getRoomForEntity(world, eid) === undefined) {
            setMovementTarget(eid, observeTargetEid);
          }
          const targetName = Name.value[observeTargetEid] || action.target;
          const targetDesc = hasComponent(world, observeTargetEid, Description) ? Description.value[observeTargetEid] || "You see nothing special." : "You see nothing special.";
          // Read state from ECS ObjectState component (not ObjectMeta)
          const targetState = hasComponent(world, observeTargetEid, Agent)
            ? getObservedPublicActivity(world, eid, observeTargetEid)
            : hasComponent(world, observeTargetEid, ObjectState) ? ObjectState.current[observeTargetEid] : undefined;

          // Build detailed observation
          const observationParts: string[] = [];
          observationParts.push(`You examine ${targetName} closely.`);
          observationParts.push(targetDesc);

          if (targetState && targetState !== "normal") {
            observationParts.push(`It appears to be ${targetState}.`);
          }
          const observedKey = workingMemoryEntityRef(world, observeTargetEid)?.key;
          const previousInspection = observedKey === undefined ? undefined : getCurrentInspection(world, eid, observedKey, validatedAction.content);
          const inspection = recordInspectionResult(world, eid, observeTargetEid, { question: validatedAction.content });
          if (inspection) observationParts.push(inspection.summary);

          // Get available affordances - examining reveals what you can do
          const affordances = getAvailableAffordances(world, eid, observeTargetEid);
          if (affordances.length > 0) {
            observationParts.push(`You could: ${affordances.map(a => a.name).join(", ")}.`);
          }

          // Send detailed observation as cognitive stimulus
          actionSucceededForPlan = true;
          queueStimulus(world, {
            targetEid: eid,
            type: "observation",
            modality: "cognitive",
            content: observationParts.join(" "),
            source: "observation",
          });

          // LastAction (ECS): used by deterministic goal evaluation.
          if (!hasComponent(world as any, eid, LastAction as any)) addComponent(world as any, eid, LastAction as any);
          LastAction.type[eid] = "observe";
          LastAction.target[eid] = targetName;
          LastAction.content[eid] = "";
          LastAction.success[eid] = true;
          LastAction.timestamp[eid] = Date.now();

          // The explicit observation still commits its receipt and feedback.
          // Only new native evidence merits another asynchronous interpretation;
          // a new timestamp on the same inspected surface is not new knowledge.
          if (inspection && inspection.evidenceBasis !== previousInspection?.evidenceBasis) extractKnowledgeFromInteraction(world, eid, {
            type: "observation",
            perspective: "observation",
            content: observationParts.join(" "),
            otherParty: inspection.subjectLabel,
            context: `Completed inspection ${inspection.sourceId} of ${inspection.subject} in ${roomEid !== undefined ? Name.value[roomEid] || "a room" : "a room"}; question: ${inspection.question}. Only the supplied visible result was observed.`,
          }).catch(() => {});
          clearFailedActionAttempt(eid);

          onProcedureActionResult(world, eid, validatedAction, { success: true });
        }
        break;

      case "think":
        actionSucceededForPlan = true;
        if (action.content) {
          console.log(`💭 ${name} thinks: "${action.content}"`);
        }
        clearFailedActionAttempt(eid);
        onProcedureActionResult(world, eid, validatedAction, { success: true });
        break;

      case "interact":
        if (visualInspectionUnavailable) {
          const visible = getVisibleNamesInRoom(world, eid);
          const hint = visible.length ? ` Visible here: ${visible.join(", ")}.` : "";
          addCriticalActionFailure(world, eid, !hasSight ? "FAILED: Visual inspection is unavailable without sight."
            : `FAILED: You cannot currently see "${validatedAction.target || "that target"}".${hint}`, "observation");
          if (!hasComponent(world, eid, LastAction)) addComponent(world, eid, LastAction);
          LastAction.type[eid] = "interact"; LastAction.target[eid] = validatedAction.target || "";
          LastAction.content[eid] = validatedAction.content || ""; LastAction.success[eid] = false; LastAction.timestamp[eid] = Date.now();
          recordFailedActionAttempt(eid, sig);
          onProcedureActionResult(world, eid, validatedAction, { success: false });
          break;
        }
        if (validatedAction.target && validatedAction.content) {
          // Parse affordance name from content (e.g., "eat the apple" -> "eat")
          let affordanceName = normalizeAffordanceToken(validatedAction.content.split(/\s+/)[0] || "");

          // Find the target entity
            const targetEid = findEntityByName(world, validatedAction.target, { preferRoomEid: roomEid });
            targetResolved(targetEid);

          if (targetEid === undefined) {
            actionSucceededForPlan = false;
            console.log(`❓ ${name} tried to interact with "${validatedAction.target}" but couldn't find it`);
            // Record failed interaction for World Crafter spirit
            const roomName = roomEid !== undefined ? (Name.value[roomEid] || "Unknown Room") : "Unknown Room";
            recordFailedInteraction(
              name,
              eid,
              roomName,
              affordanceName,
              validatedAction.target,
              validatedAction.content,
              world
            );
            const visible = getVisibleNamesInRoom(world, eid);
            const hint = visible.length > 0 ? `Visible here: ${visible.join(", ")}.` : "No matching named entity is visible here.";
            addCriticalActionFailure(
              world,
              eid,
              affordanceName === "examine" ? `FAILED: You cannot currently see "${validatedAction.target}". ${hint}`
                : `FAILED: You tried to ${affordanceName} "${validatedAction.target}" but it doesn't exist as an entity here. ${hint}`,
              "interaction"
            );
            recordFailedActionAttempt(eid, sig);
            const issues = validateAgentAction(world, name, validatedAction.type, validatedAction.target, validatedAction.content);
            for (const issue of issues) recordIssue(issue);
            break;
          }

          // The visual examine affordance must not use generic physical reach
          // to inspect hidden possessions. Other physical actions retain their
          // own accessibility rules; knowing something by touch is still useful.
          if (affordanceName === "examine" && !getAgentVisualEntities(world, eid).includes(targetEid)) {
            const visible = getVisibleNamesInRoom(world, eid);
            const hint = visible.length ? `Visible here: ${visible.join(", ")}.` : "No matching named entity is visible here.";
            addCriticalActionFailure(world, eid, `FAILED: You cannot currently see "${validatedAction.target}". ${hint}`, "observation");
            recordFailedActionAttempt(eid, sig);
            onProcedureActionResult(world, eid, validatedAction, { success: false });
            break;
          }

          // Grounding: "interact" must target something physically accessible.
          // We allow:
          // - direct room contents (in the same room)
          // - anything contained by the actor (inventory tree: bags, nested items)
          // We reject interacting with whole rooms or remote entities.
          if (!isInteractTargetAccessible(world, eid, roomEid, targetEid)) {
            actionSucceededForPlan = false;
            const targetName = Name.value[targetEid] || validatedAction.target;
            const visible = getVisibleNamesInRoom(world, eid);
            const inv = hasInventory(world, eid) ? formatInventory(world, eid) : "";
            const hints: string[] = [];
            const containerEid = getDirectContainer(world, targetEid);
            if (containerEid !== undefined && roomEid !== undefined && containerEid !== roomEid &&
                getRoomForEntity(world, containerEid) === roomEid && getAgentVisibleEntities(world, eid).includes(containerEid)) {
              const containerName = Name.value[containerEid];
              if (containerName) hints.push(`It appears to be inside "${containerName}".`);
            }
            if (visible.length > 0) hints.push(`Visible here: ${visible.join(", ")}.`);
            if (inv.trim().length > 0) hints.push(`Inventory:\n${inv}`);

            addCriticalActionFailure(
              world,
              eid,
              `FAILED: You tried to ${affordanceName} "${targetName}" but it is not directly accessible here.\n${hints.join("\n") || "Try a different target that is actually present/held, or move first."}`,
              "interaction"
            );
            recordFailedActionAttempt(eid, sig);
            const issues = validateAgentAction(world, name, validatedAction.type, validatedAction.target, validatedAction.content);
            for (const issue of issues) recordIssue(issue);
            break;
          }

              // Heuristic grounding: if the agent omitted the affordance and typed a bare shell command
              // (e.g., "node ci.cjs"), rewrite it to run_command <cmd> instead of failing with
              // "Unknown affordance".
              const rawContent = String(validatedAction.content || "").trim();
              const looksLikeShellCmd = /^(node|npm|npx|pnpm|yarn|bash|sh|zsh|fish|ls|cat|rg|grep|git)\b/i.test(rawContent);
              if (looksLikeShellCmd) {
                const allowedAffordances = new Set(getAvailableAffordances(world, eid, targetEid).map((a) => normalizeAffordanceToken(a.name)));
                if (!allowedAffordances.has(affordanceName) && allowedAffordances.has("run_command")) {
                  affordanceName = "run_command";
                  validatedAction = { ...validatedAction, content: `run_command ${rawContent}` };
                }
              }

		          // Only set grid movement target if agent has no current room (grid-only mode).
		          if (getRoomForEntity(world, eid) === undefined) {
		            setMovementTarget(eid, targetEid);
		          }

		          // Create effect context
	            const rawAffordanceArgs = (validatedAction.content || "").trim().replace(/^\S+\s*/, "");
	            const affordanceArgs = stripControlAndAnsi(rawAffordanceArgs);
                validatedAction = { ...validatedAction, content: `${affordanceName}${affordanceArgs ? ` ${affordanceArgs}` : ""}` };

	            // Async tool jobs: if the agent already has an in-flight job for this exact tool+command, wait.
	            const expectedToolId =
	              affordanceName === "run_command"
	                ? "terminal.run"
	                : affordanceName === "gemini_cli"
	                  ? "gemini.cli"
	                  : affordanceName === "generate_image"
						? "nano_banana.generate_image"
						: affordanceName === "edit_image"
						  ? "nano_banana.edit_image"
						  : affordanceName === "describe_image"
						    ? "vision.describe_image"

									: undefined;
	            if (expectedToolId && hasComponent(world as any, eid, PendingToolJob as any)) {
	              const pendingToolId = String(PendingToolJob.toolId[eid] || "");
	              const pendingCmd = String(PendingToolJob.command[eid] || "");
	              // Single in-flight job per tool per agent: don't allow spamming multiple terminal/gemini runs.
	              // If the agent wants to change strategy, it should wait for the current job to finish and then decide.
	              if (pendingToolId === expectedToolId) {
	                actionSucceededForPlan = false;
	                actionPendingForPlan = true;
	                const detail = pendingCmd && pendingCmd !== affordanceArgs ? ` (pending: ${pendingCmd})` : "";
	                // Avoid spamming identical "waiting" stimuli every tick.
	                const now = Date.now();
	                const lastAt = Number(PendingToolJob.lastNotifyAt[eid] || 0);
	                const lastJob = String(PendingToolJob.lastNotifyJobId[eid] || "");
	                if (lastJob !== String(PendingToolJob.jobId[eid] || "") || !lastAt || now - lastAt > 2000) {
	                  PendingToolJob.lastNotifyAt[eid] = now;
	                  PendingToolJob.lastNotifyJobId[eid] = String(PendingToolJob.jobId[eid] || "");
	                  queueStimulus(world, {
	                    targetEid: eid,
	                    type: "action_result",
	                    modality: "cognitive",
	                    content: `You are waiting for ${pendingToolId} to finish running${detail}.`,
	                    source: "self",
	                  });
	                }
	                break;
	              }
	            }

	          const ctx: EffectContext = {
	            world,
	            actorEid: eid,
	            targetEid,
	            worldSchema,
	            registry: entityRegistry,
              affordanceArgs,
	          };

	          // Execute the affordance
	          const result = isDocumentOperation(validatedAction)
              ? commitDocumentWork(world, eid, targetEid, nativeResume?.documentWork)
              : executeAffordance(affordanceName, ctx);
            const affordanceDef = worldSchema.getAffordance(affordanceName);
            const toolChange = result.changes.find((c) => c.startsWith("tool: "));
            const toolId = toolChange ? toolChange.slice("tool: ".length).trim() : undefined;
            const toolJobChange = result.changes.find((c) => c.startsWith("tool_job: "));
            const toolJobId = toolJobChange ? toolJobChange.slice("tool_job: ".length).trim() : "";

          if (result.success) {
              actionSucceededForPlan = true;
              if (toolJobId && toolId) {
                actionSucceededForPlan = false;
                actionPendingForPlan = true;
                registerAsyncAction(world, toolJobId, { actorEid: eid, action: validatedAction as AgentAction, goalEid: actionGoal, plan: actionPlan, coordination, targetKey: executedTargetKey });
                if (!hasComponent(world as any, eid, PendingToolJob as any)) addComponent(world as any, eid, PendingToolJob as any);
                PendingToolJob.jobId[eid] = toolJobId;
                PendingToolJob.toolId[eid] = toolId;
                PendingToolJob.command[eid] = affordanceArgs;
                PendingToolJob.startedAt[eid] = Date.now();
                PendingToolJob.lastNotifyAt[eid] = 0;
                PendingToolJob.lastNotifyJobId[eid] = "";
              }
	            const targetName = Name.value[targetEid] || action.target;
	            console.log(`🎯 ${name} ${affordanceName}s ${targetName}: ${result.changes.join(", ") || "success"}`);

              // For async tool jobs (terminal/gemini), defer learning/procedure advancement until the tool_result arrives.
              // Otherwise, we accidentally "learn" failing commands as successes and create self-reinforcing loops.
              const learnNow = !(toolJobId && toolId);
              if (learnNow) {
                upsertProceduralSkillFromInteraction(world, eid, {
                  affordance: affordanceName,
                  args: affordanceArgs,
                  toolId,
                  requiredTraits: affordanceDef?.requires,
                  targetName,
                  success: true,
                });
              }

	            // Record successful action for memory/self-awareness
              if (learnNow) recordSuccessfulAction(world, eid, `${affordanceName} ${targetName}`);

              // Chronicle
              chronicle.record(learnNow ? "action_success" : "action_pending", {
                agent: name, affordance: affordanceName, target: targetName,
                changes: result.changes.slice(0, 3),
              });
              // Track world mutations (spawn/destroy)
              for (const change of result.changes) {
                if (change.startsWith("spawned:") || change.startsWith("destroyed:")) {
                  chronicle.record("world_mutation", {
                    agent: name, action: affordanceName, result: change,
                  });
                }
              }

              // Reinforce behavior tree — successful affordance use increases weight
              if (learnNow) recordOutcome(world, {
                agentEid: eid,
                action: { type: "interact", target: targetName, content: affordanceName },
                affordance: affordanceName,
                target: targetName,
                success: true,
              });
              // Compile LLM decision into BT branch if this was an LLM-originated action
              if (learnNow) resolveDecision(world, eid, true, validatedAction);

            // Broadcast visual to others in room - they can see the interaction!
            if (roomEid !== undefined) {
              broadcastVisual(world, roomEid, `${name} ${affordanceName}s the ${targetName}.`, name, eid);
            }

            // Give feedback to actor about what happened (cognitive stimulus)
            if (result.changes.length > 0 || isDocumentOperation(validatedAction) && result.message) {
              queueStimulus(world, {
                targetEid: eid,
                type: "action_result",
                modality: "cognitive",
                content: `You ${affordanceName} ${targetName}. ${isDocumentOperation(validatedAction) ? result.message || "" : result.changes.join(". ")}`,
                source: "self",
              });
            }

            // MEMORY FORMATION for successful actions - include the result!
            if (learnNow) extractKnowledgeFromInteraction(world, eid, {
              type: "action_success",
              content: `SUCCESS: I completed ${affordanceName} on ${targetName}. ${isDocumentOperation(validatedAction) ? result.message : result.changes.join(". ")}`,
              otherParty: targetName,
              context: `In ${roomEid !== undefined ? Name.value[roomEid] || "a room" : "a room"}. The operation succeeded. Only its recorded result establishes what was read or changed; it does not prove a larger goal was completed.`,
            }).catch(() => {});
            clearFailedActionAttempt(eid);

            // LastAction (ECS): used by deterministic goal evaluation.
            if (!hasComponent(world as any, eid, LastAction as any)) addComponent(world as any, eid, LastAction as any);
            LastAction.type[eid] = "interact";
            LastAction.target[eid] = targetName || "";
            LastAction.content[eid] = `${affordanceName}${affordanceArgs ? ` ${affordanceArgs}` : ""}`;
            LastAction.success[eid] = learnNow;
            LastAction.timestamp[eid] = Date.now();

            if (learnNow) onProcedureActionResult(world, eid, validatedAction, { success: true });
          } else {
            actionSucceededForPlan = false;
	            // Action failed - notify actor with HELPFUL feedback
	            console.log(`❌ ${name} failed to ${affordanceName} ${action.target}: ${result.message}`);

              // Penalize behavior tree — failed affordance use decreases weight
              recordOutcome(world, {
                agentEid: eid,
                action: { type: "interact", target: action.target, content: affordanceName },
                affordance: affordanceName,
                target: action.target,
                success: false,
                detail: result.message,
              });
              // Mark LLM decision as failed — don't compile this into BT
              resolveDecision(world, eid, false, validatedAction);

	            // Build helpful error message with ACTIONABLE hints
	            const targetName = Name.value[targetEid] || action.target;
		            let helpfulMessage = `FAILED: You cannot ${affordanceName} ${targetName}.`;
		            if (result.message && String(result.message).trim()) {
		              helpfulMessage += `\nReason: ${String(result.message).trim()}`;
		            }
		            const hints: string[] = [];

              upsertProceduralSkillFromInteraction(world, eid, {
                affordance: affordanceName,
                args: affordanceArgs,
                toolId,
                requiredTraits: affordanceDef?.requires,
                targetName,
                success: false,
              });

            // Check if actor is missing a required trait (e.g., "hasMatches")
            const actorMissingMatch = result.message?.match(/Actor lacks trait: (has\w+)/);
            if (actorMissingMatch && roomEid !== undefined) {
              const missingTrait = actorMissingMatch[1];
              // Find which item provides this trait
              const itemName = findItemWithTrait(world, roomEid, missingTrait);
              if (itemName) {
                hints.push(`→ PICK UP "${itemName}" first to gain ${missingTrait}`);
              } else {
                hints.push(`→ You need ${missingTrait} - find and pick up the right tool`);
              }
            }

            // Check if target is missing a required trait
            const targetMissingMatch = result.message?.match(/Target lacks trait: (\w+)/);
            if (targetMissingMatch) {
              const missingTrait = targetMissingMatch[1];
              // Suggest what might make the target have that trait
              hints.push(`→ ${targetName} is not ${missingTrait} - check its current state or try a different action`);
            }

            // Get available affordances for this target
            const targetAffordances = getAvailableAffordances(world, eid, targetEid);
            if (targetAffordances.length > 0) {
              hints.push(`→ Available actions on ${targetName}: ${targetAffordances.map(a => a.name).join(", ")}`);
            }

	            // If the affordance exists, suggest valid targets
	            if (affordanceDef && roomEid !== undefined) {
	              const validTargets = findObjectsWithAffordance(world, eid, roomEid, affordanceName);
	              if (validTargets.length > 0 && validTargets[0] !== targetName) {
	                hints.push(`→ TRY: ${affordanceName} "${validTargets[0]}" instead`);
	              }
	            }

            // Combine message with hints and an explicit warning
            if (hints.length > 0) {
              helpfulMessage += "\n" + hints.join("\n");
            }
            helpfulMessage += "\n⛔ DO NOT proceed as if this action succeeded. Try a different approach.";

            queueStimulus(world, {
              targetEid: eid,
              type: "action_failed",
              modality: "cognitive",
              content: helpfulMessage,
              source: "self",
            });
            recordFailedActionAttempt(eid, sig);

            // MEMORY FORMATION for failed actions - remember what didn't work!
            extractKnowledgeFromInteraction(world, eid, {
              type: "action_failed",
              content: `FAILED: I tried to ${affordanceName} the ${targetName} but it didn't work. ${result.message}`,
              otherParty: targetName,
              context: `In ${roomEid !== undefined ? Name.value[roomEid] || "a room" : "a room"}. This action failed - I should try a different approach.`,
            }).catch(() => {});

            // LastAction (ECS): used by deterministic goal evaluation.
            if (!hasComponent(world as any, eid, LastAction as any)) addComponent(world as any, eid, LastAction as any);
            LastAction.type[eid] = "interact";
            LastAction.target[eid] = targetName || "";
            LastAction.content[eid] = `${affordanceName}${affordanceArgs ? ` ${affordanceArgs}` : ""}`;
            LastAction.success[eid] = false;
            LastAction.timestamp[eid] = Date.now();

            onProcedureActionResult(world, eid, validatedAction, { success: false });
          }
        }
        break;

      case "move":
        if (unavailableRoute) {
          addCriticalActionFailure(world, eid, "FAILED: That destination is not reachable by an open one-step route from your current room.", "movement");
          recordFailedActionAttempt(eid, sig);
          break;
        }
        // GOAL-BASED MOVEMENT SYSTEM
        // AI creates intent (Goals), deterministic GoalPursuitSystem executes movement
        // This separates cognition (what to do) from execution (how to do it)

        // Check if agent has grid position for grid-based movement
        const hasGridPos = GridPosition.x[eid] !== undefined;

        if (action.target) {
          // First try room-based movement via Goal system
          const destRoom = roomTraversal?.to ?? findRoomByName(world, action.target);
          targetResolved(destRoom);
          if (destRoom !== undefined && destRoom !== roomEid) {
            const destName = Name.value[destRoom] || action.target;
            const sourceName = roomEid !== undefined ? Name.value[roomEid] : "somewhere";

            // Check if agent actually has a current room
            // If no room but has GridPosition, use grid-based movement instead
            // GoalPursuitSystem can't move agents without a resolvable room (via LocatedIn chain)
            const hasCurrentRoom = roomEid !== undefined;

            if (hasCurrentRoom) {
              // Execute the room transition immediately.
              // Previously this only created a Goal and relied on GoalPursuitSystem →
              // Movement → RoomArrival (a 3-system chain that often doesn't run in tests
              // or async contexts). Now we move the agent directly AND create the goal
              // so the learning system can still compile the move into a BT branch.
              const reason = action.content || undefined;
              const arousal = Mind.arousal[eid] || 0.5;
              const priority = Math.round(3 + arousal * 7);

              // Actually move the agent
              setLocatedIn(world, eid, destRoom);
              actionSucceededForPlan = true;
              clearMovementTarget(eid);
              // Snap GridPosition to destination room so grid-based systems stay in sync
              if (GridPosition.x[destRoom] !== undefined) {
                GridPosition.x[eid] = GridPosition.x[destRoom];
                GridPosition.y[eid] = GridPosition.y[destRoom];
              }

              // Update agent's focus
              Mind.focus[eid] = `arrived at ${destName}`;
              Mind.arousal[eid] = Math.min(1, arousal + 0.1);

              // Broadcast departure and arrival
              broadcastVisual(world, roomEid!, `${name} heads toward ${destName}`, name, eid);
              broadcastVisual(world, destRoom, `${name} arrives from ${sourceName}`, name, eid);

              console.log(`🚶 ${name} moves from ${sourceName} to ${destName}`);

              // Create a completed movement goal for the learning system
              // (goal-learning.ts compiles completed goals into skills)
              const goalEid = createMovementGoal(world, eid, destName, reason, priority);
              if (goalEid !== undefined) {
                Goal.status[goalEid] = "completed";
                Goal.progress[goalEid] = 100;
              }

              // Compile LLM move decision into BT branch
              resolveDecision(world, eid, true, validatedAction);

              // Notify agent they arrived
              queueStimulus(world, {
                targetEid: eid,
                type: "action_result",
                modality: "cognitive",
                content: `You traveled from ${sourceName} to ${destName}${reason ? ` to ${reason}` : ""}.`,
                source: "self",
              });

              // Record the arrival as a success
              chronicle.record("action_success", {
                agent: name,
                action: `move→${destName}`,
                from: sourceName,
              });

              extractKnowledgeFromInteraction(world, eid, {
                type: "movement",
                content: `Traveled from ${sourceName} to ${destName}`,
                context: `Now in ${destName}`,
              }).catch(() => {});
            } else if (hasGridPos && GridPosition.x[destRoom] !== undefined) {
              actionPendingForPlan = true;
              // Agent has NO room but has GridPosition - use grid-based movement to room
              // This is the key fix: agents stuck "somewhere" can now physically move to rooms
              // Once they arrive at room's GridPosition, RoomArrival system will set LocatedIn(room)
              if (getMovementTarget(eid) === destRoom) {
                addPerception(world, eid, {
                  type: "action_result",
                  content: `You are already walking toward ${destName}.`,
                  source: "movement",
                  intensity: 0.4,
                });
                break;
              }

              setMovementTarget(eid, destRoom);
              Mind.focus[eid] = `heading to ${destName}`;
              Mind.arousal[eid] = Math.min(1, (Mind.arousal[eid] || 0.5) + 0.1);

              console.log(`🚶 ${name} starts moving towards ${destName} (grid-based, no current room)`);

              // Notify agent
              queueStimulus(world, {
                targetEid: eid,
                type: "intent",
                modality: "cognitive",
                content: `You start walking toward ${destName}.`,
                source: "self",
              });
            } else {
              // No current room AND no grid position - create goal anyway (might work later)
              const reason = action.content || undefined;
              const priority = Math.round(3 + (Mind.arousal[eid] || 0.5) * 7);
              createMovementGoal(world, eid, destName, reason, priority);
              actionPendingForPlan = true;
              console.log(`🎯 ${name} intends to go to ${destName} (goal created, hoping GoalPursuit can help)`);
            }
          } else if (destRoom !== undefined && destRoom === roomEid) {
            actionSucceededForPlan = true;
            addPerception(world, eid, {
              type: "action_result",
              content: `You are already in ${Name.value[destRoom] || action.target}.`,
              source: "movement",
              intensity: 0.6,
            });
          } else if (hasGridPos) {
            // Grid-based movement - find an entity to move towards
            // This still uses direct movement for grid-based (pathfinding separate concern)
            const targetEid = findEntityByName(world, action.target);
            if (targetEid !== undefined && GridPosition.x[targetEid] !== undefined) {
              actionPendingForPlan = true;
              if (getMovementTarget(eid) === targetEid) {
                addPerception(world, eid, {
                  type: "action_result",
                  content: `You are already moving toward ${action.target}.`,
                  source: "movement",
                  intensity: 0.4,
                });
                break;
              }
              setMovementTarget(eid, targetEid);
              console.log(`🚶 ${name} starts moving towards ${action.target}`);
              clearFailedActionAttempt(eid);
            } else {
              const rooms = getKnownRoomNames(world);
              const hint = rooms.length > 0 ? `Known places: ${rooms.join(", ")}.` : "No known places found.";
              addCriticalActionFailure(
                world,
                eid,
                `FAILED: You tried to move to "${action.target}" but no such room or entity exists. ${hint}`,
                "movement"
              );
              recordFailedActionAttempt(eid, sig);
              const issues = validateAgentAction(world, name, validatedAction.type, action.target, action.content);
              for (const issue of issues) recordIssue(issue);
            }
          } else {
            // Neither room nor grid-based target found
            console.log(`❓ ${name} tried to move to "${action.target}" but couldn't find it`);
            const rooms = getKnownRoomNames(world);
            const hint = rooms.length > 0 ? `Known places: ${rooms.join(", ")}.` : "No known places found.";
            addCriticalActionFailure(
              world,
              eid,
              `FAILED: You tried to move to "${action.target}" but no such room or entity exists. ${hint}`,
              "movement"
            );
            recordFailedActionAttempt(eid, sig);
            const issues = validateAgentAction(world, name, validatedAction.type, action.target, action.content);
            for (const issue of issues) recordIssue(issue);
          }
        } else if (hasGridPos) {
          // No specific target - random wander (for grid-based only)
          doRandomWander(world, eid, name);
          actionPendingForPlan = true;
          clearFailedActionAttempt(eid);
        }
        break;

      case "wait":
        actionSucceededForPlan = true;
        // Agent is intentionally doing nothing
        if (!hasComponent(world as any, eid, LastAction as any)) addComponent(world as any, eid, LastAction as any);
        LastAction.type[eid] = "wait";
        LastAction.target[eid] = "";
        LastAction.content[eid] = validatedAction.content || "";
        LastAction.success[eid] = true;
        LastAction.timestamp[eid] = Date.now();
        onProcedureActionResult(world, eid, validatedAction, { success: true });
        break;

      case "attack":
        // Combat action - using Health component
        if (validatedAction.target) {
          const targetEid = findEntityByName(world, validatedAction.target, { preferRoomEid: roomEid });
          targetResolved(targetEid);
          if (targetEid !== undefined && isInteractTargetAccessible(world, eid, roomEid, targetEid)) {
            // Check if target has Health component
            const targetHealth = Health.current[targetEid];
            const targetMaxHealth = Health.max[targetEid];

            if (targetHealth !== undefined && targetMaxHealth !== undefined) {
              // Target can be attacked - calculate damage
              const attackerAttack = CombatStats.attack[eid] ?? 10;  // Default 10 attack
              const targetDefense = CombatStats.defense[targetEid] ?? 0;  // Default 0 defense
              const damage = Math.max(1, attackerAttack - (targetDefense * 0.5));

              // Apply damage
              Health.current[targetEid] = Math.max(0, targetHealth - damage);
              actionSucceededForPlan = true;
              Health.lastDamage[targetEid] = Date.now();

              // Mark attacker as in combat
              InCombat.targetEid[eid] = targetEid;
              InCombat.stance[eid] = "aggressive";
              InCombat.lastAction[eid] = Date.now();

              const targetName = Name.value[targetEid] || validatedAction.target;
              console.log(`⚔️ ${name} attacks ${targetName} for ${damage.toFixed(1)} damage! (${Health.current[targetEid]}/${targetMaxHealth} HP)`);

              // Notify both parties
              queueStimulus(world, {
                targetEid: eid,
                type: "combat",
                modality: "tactile",
                content: `You attack ${targetName}, dealing ${damage.toFixed(1)} damage!`,
                source: "combat",
              });
              queueStimulus(world, {
                targetEid: targetEid,
                type: "combat",
                modality: "tactile",
                content: `${name} attacks you for ${damage.toFixed(1)} damage!`,
                source: name,
                intensity: 1.0,  // High intensity - combat is urgent
              });

              // Check for defeat
              if (Health.current[targetEid] <= 0) {
                console.log(`💀 ${targetName} has been defeated by ${name}!`);

                // Broadcast the defeat
                const combatRoomEid = getRoomForEntity(world, eid);
                if (combatRoomEid !== undefined) {
                  broadcastToRoom(world, combatRoomEid, {
                    type: "combat",
                    content: `${targetName} has been defeated by ${name}!`,
                    source: "combat",
                    modality: "visual",
                  });
                }

                // Could deactivate or mark for removal
                if (Agent.active[targetEid] !== undefined) {
                  Agent.active[targetEid] = false;
                }
              }
            } else {
              // Target doesn't have Health - can't be attacked
              console.log(`❓ ${name} tried to attack "${validatedAction.target}" but it has no Health component`);
              recordIssue({
                id: `combat_${Date.now()}`,
                timestamp: Date.now(),
                severity: "medium",
                category: "missing_entity",
                description: `${name} tried to attack ${validatedAction.target} but target has no Health component`,
                evidence: [`Action: attack`, `Target: ${validatedAction.target}`],
                affectedEntities: [name, validatedAction.target],
                recommendation: `Add Health component to ${validatedAction.target} if it should be attackable`,
                autoFixable: true,
              });
            }
          } else {
            console.log(`❓ ${name} tried to attack "${validatedAction.target}" but couldn't find it`);
            const visible = getVisibleNamesInRoom(world, eid);
            const hint = visible.length > 0 ? `Visible here: ${visible.join(", ")}.` : "No matching named entity is visible here.";
            addCriticalActionFailure(
              world,
              eid,
              `FAILED: You tried to attack "${validatedAction.target}" but it doesn't exist as an entity here. ${hint}`,
              "combat"
            );
            recordFailedActionAttempt(eid, sig);
            const issues = validateAgentAction(world, name, validatedAction.type, validatedAction.target, validatedAction.content);
            for (const issue of issues) recordIssue(issue);
          }
        }
        break;

	      case "pickup":
	        // Pick up an item from the ground
	        if (validatedAction.target) {
	          // Check if agent has inventory
	          if (!hasInventory(world, eid)) {
	            console.log(`❓ ${name} tried to pickup but has no inventory`);
	            recordIssue({
	              id: `inventory_${Date.now()}`,
              timestamp: Date.now(),
              severity: "medium",
              category: "missing_system",
              description: `${name} tried to pickup ${validatedAction.target} but has no inventory`,
              evidence: [`Action: pickup`, `Target: ${validatedAction.target}`],
              affectedEntities: [name],
              recommendation: `Call initializeInventory(${eid}) to give ${name} an inventory`,
              autoFixable: true,
            });
            recordFailedActionAttempt(eid, sig);
            break;
          }

	          const itemEid = findEntityByName(world, validatedAction.target, { preferRoomEid: roomEid });
            targetResolved(itemEid);
	          if (itemEid !== undefined) {
	            const itemName = Name.value[itemEid] || validatedAction.target;

	            // Grounding: reach the item through open enclosures/surfaces in this room.
	            if (roomEid === undefined || !isAccessibleViaOpenContainer(world, roomEid, itemEid)) {
	              console.log(`❌ ${name} cannot pick up ${itemName} - it's not directly accessible here`);
                const containerEid = getDirectContainer(world, itemEid);
                let where = "";
                if (containerEid !== undefined) {
                  const containerName = Name.value[containerEid];
                  const inRoom = roomEid !== undefined && getDirectContainer(world, containerEid) === roomEid;
                  if (containerName && inRoom) {
                    where = isOpenContainer(world, containerEid)
                      ? ` It is inside the OPEN "${containerName}".`
                      : ` It appears to be inside "${containerName}".`;
                  }
                }
	              queueStimulus(world, {
	                targetEid: eid,
	                type: "action_failed",
	                modality: "cognitive",
	                content: `FAILED: "${itemName}" is not directly accessible here (it may be inside something or carried by someone).${where} You do NOT have the ${itemName}.`,
	                source: "inventory",
	              });
                recordFailedActionAttempt(eid, sig);
	              break;
	            }

	            // Check if item has the "takeable" trait
	            const itemTraitsJson = Traits?.active?.[itemEid];
	            let hasTakeable = false;
            if (itemTraitsJson) {
              try {
                const itemTraits = JSON.parse(itemTraitsJson) as string[];
                hasTakeable = itemTraits.includes("takeable");
              } catch {
                hasTakeable = false;
              }
            }

            if (!hasTakeable) {
              console.log(`❌ ${name} cannot pick up ${itemName} - it's not takeable`);
              queueStimulus(world, {
                targetEid: eid,
                type: "action_failed",
                modality: "cognitive",
                content: `FAILED: You tried to take "${itemName}" but it cannot be taken right now. You do NOT have the ${itemName}. Check what conditions must be met first.`,
                source: "inventory",
              });
              recordFailedActionAttempt(eid, sig);
              break;
            }

            const success = addToInventory(world, eid, itemEid);
	            if (success) {
                  actionSucceededForPlan = true;
	              console.log(`📦 ${name} picked up ${itemName}`);

	              // Record successful action for memory/self-awareness
	              recordSuccessfulAction(world, eid, `picked up ${itemName}`);

                  // Physical pickup, unlike arbitrary inventory insertion,
                  // establishes an actual free-hand claim that survives idle
                  // gaps and is revoked by drop/give/removal, not by a read ending.
                  tryHoldCarriedItem(world, eid, itemEid);

	              queueStimulus(world, {
	                targetEid: eid,
	                type: "inventory",
	                modality: "tactile",
	                content: `You pick up the ${itemName}.`,
	                source: "inventory",
	              });
	              queueStimulus(world, {
	                targetEid: eid,
	                type: "action_result",
	                modality: "cognitive",
	                content: `You picked up ${itemName}.`,
	                source: "inventory",
	              });
	              // Broadcast to others in the room so they can see the pickup!
	              if (roomEid !== undefined) {
	                broadcastVisual(world, roomEid, `${name} picks up the ${itemName}.`, name, eid);
	              }
              clearFailedActionAttempt(eid);
            } else {
              console.log(`❓ ${name} couldn't pick up ${itemName} (inventory full or too heavy)`);
              queueStimulus(world, {
                targetEid: eid,
                type: "action_failed",
                modality: "cognitive",
                content: `FAILED: You tried to take "${itemName}" but your inventory is full or it's too heavy. You do NOT have the ${itemName}.`,
                source: "inventory",
              });
              recordFailedActionAttempt(eid, sig);
            }
          } else {
            console.log(`❓ ${name} tried to pickup "${validatedAction.target}" but couldn't find it`);
            // Record failed interaction for World Crafter spirit
            const roomName = roomEid !== undefined ? (Name.value[roomEid] || "Unknown Room") : "Unknown Room";
            recordFailedInteraction(
              name,
              eid,
              roomName,
              "pickup",
              validatedAction.target,
              validatedAction.content,
              world
            );
            queueStimulus(world, {
              targetEid: eid,
              type: "action_failed",
              modality: "cognitive",
              content: `FAILED: "${validatedAction.target}" was not found here. You do NOT have it.`,
              source: "inventory",
            });
            recordFailedActionAttempt(eid, sig);
          }
        }
        break;

	      case "drop":
	        // Drop an item from inventory
	        if (validatedAction.target) {
	          const itemEid = findEntityByName(world, validatedAction.target);
            targetResolved(itemEid);
	          if (itemEid !== undefined && hasItem(world, eid, itemEid)) {
	            const itemName = Name.value[itemEid] || validatedAction.target;
	            const dropRoom = roomEid ?? getRoomForEntity(world, eid);
	            if (dropRoom === undefined) {
	              queueStimulus(world, {
	                targetEid: eid,
	                type: "action_failed",
	                modality: "cognitive",
	                content: `FAILED: You try to drop "${itemName}" but your location is unclear.`,
	                source: "inventory",
	              });
                recordFailedActionAttempt(eid, sig);
	              break;
	            }
	            const success = removeFromInventory(world, eid, itemEid, dropRoom);
	            if (success) {
                  actionSucceededForPlan = true;
	              console.log(`📦 ${name} dropped ${itemName}`);

	              // Update appearance - sync visiblyHolding with remaining inventory
	              if (hasAppearance(eid)) {
	                syncVisiblyHoldingFromInventory(world, eid);
	              }

	              queueStimulus(world, {
	                targetEid: eid,
	                type: "inventory",
	                modality: "tactile",
	                content: `You drop the ${itemName}.`,
	                source: "inventory",
	              });
	              queueStimulus(world, {
	                targetEid: eid,
	                type: "action_result",
	                modality: "cognitive",
	                content: `You dropped ${itemName}.`,
	                source: "inventory",
	              });

	              // Broadcast to others in the room so they can see the drop
	              if (roomEid !== undefined) {
	                broadcastVisual(world, roomEid, `${name} drops the ${itemName}.`, name, eid);
	              }
              clearFailedActionAttempt(eid);
            }
          } else {
            console.log(`❓ ${name} tried to drop "${validatedAction.target}" but doesn't have it`);
            queueStimulus(world, {
              targetEid: eid,
              type: "inventory",
              modality: "cognitive",
              content: `You don't have that item to drop.`,
              source: "inventory",
            });
            recordFailedActionAttempt(eid, sig);
          }
        }
        break;

	      case "use":
	        // Use an item from inventory
	        if (validatedAction.target) {
	          const itemEid = findEntityByName(world, validatedAction.target);
            targetResolved(itemEid);
	          if (itemEid !== undefined && hasItem(world, eid, itemEid)) {
	            const itemName = Name.value[itemEid] || validatedAction.target;
	            const itemCategory = Item.category[itemEid] || "misc";

	            // Handle different item categories
	            if (itemCategory === "food") {
	              // Consume food - remove entity from world
	              removeEntity(world, itemEid);
	              syncInventoryCache(world, eid);
	              if (hasAppearance(eid)) syncVisiblyHoldingFromInventory(world, eid);
                  actionSucceededForPlan = true;
                  queueStimulus(world, { targetEid: eid, type: "action_result", modality: "tactile", content: `You consumed ${itemName}.`, source: "inventory" });
	              console.log(`🍖 ${name} ate ${itemName}`);
                } else addCriticalActionFailure(world, eid, `FAILED: "use" has no defined effect on ${itemName}. Choose an available interaction verb.`);
	          } else if (itemEid !== undefined) {
            addCriticalActionFailure(world, eid, `FAILED: You do not hold "${validatedAction.target}". Use a currently visible object's actual affordance instead.`);
          } else {
            console.log(`❓ ${name} tried to use "${validatedAction.target}" but couldn't find it`);
            const visible = getVisibleNamesInRoom(world, eid);
            const hint = visible.length > 0 ? `Visible here: ${visible.join(", ")}.` : "No matching named entity is visible here.";
            addCriticalActionFailure(
              world,
              eid,
              `FAILED: You tried to use "${validatedAction.target}" but it doesn't exist as an entity here. ${hint}`,
              "inventory"
            );
            const issues = validateAgentAction(world, name, validatedAction.type, validatedAction.target, validatedAction.content);
            for (const issue of issues) recordIssue(issue);
          }
        }
        break;

	      case "give":
	        // Give an item to another entity
	        if (validatedAction.target && validatedAction.content) {
	          // Parse target as recipient, content as item
	          const recipientEid = findEntityByName(world, validatedAction.target);
            targetResolved(recipientEid);
	          const itemEid = findEntityByName(world, validatedAction.content);

	          if (recipientEid !== undefined && itemEid !== undefined && hasItem(world, eid, itemEid)) {
	            const recipientName = Name.value[recipientEid] || validatedAction.target;
	            const itemName = Name.value[itemEid] || validatedAction.content;

	            // Grounding: you can only give items to someone in the same room.
	            const recipientRoom = getRoomForEntity(world, recipientEid);
	            if (roomEid === undefined || recipientRoom !== roomEid) {
	              queueStimulus(world, {
	                targetEid: eid,
	                type: "action_failed",
	                modality: "cognitive",
	                content: `FAILED: You can't give "${itemName}" to ${recipientName} because they're not here.`,
	                source: "inventory",
	              });
	              break;
	            }

	            // Check if recipient has inventory
	            if (!hasInventory(world, recipientEid)) {
	              console.log(`❓ ${recipientName} can't receive items (no inventory)`);
	              queueStimulus(world, {
	                targetEid: eid,
                type: "inventory",
                modality: "cognitive",
                content: `${recipientName} can't receive items.`,
                source: "inventory",
              });
	              break;
	            }

	            // Transfer item (canonical: move containment)
	            if (addToInventory(world, recipientEid, itemEid)) {
                  actionSucceededForPlan = true;
                  tryHoldCarriedItem(world, recipientEid, itemEid);
	              console.log(`🎁 ${name} gave ${itemName} to ${recipientName}`);
	              if (hasAppearance(eid)) syncVisiblyHoldingFromInventory(world, eid);
	              queueStimulus(world, {
	                targetEid: eid,
	                type: "inventory",
                modality: "tactile",
                content: `You give the ${itemName} to ${recipientName}.`,
                source: "inventory",
              });
              queueStimulus(world, {
                targetEid: recipientEid,
                type: "inventory",
                modality: "tactile",
                content: `${name} gives you a ${itemName}.`,
                source: name,
              });
            }
          } else {
            console.log(`❓ ${name} tried to give but something went wrong`);
            if (recipientEid === undefined && validatedAction.target) {
              const visible = getVisibleNamesInRoom(world, eid);
              const hint = visible.length > 0 ? `Visible here: ${visible.join(", ")}.` : "No matching named entity is visible here.";
              addCriticalActionFailure(
                world,
                eid,
                `FAILED: You tried to give something to "${validatedAction.target}" but that recipient doesn't exist as an entity here. ${hint}`,
                "inventory"
              );
            } else if (itemEid === undefined && validatedAction.content) {
              addCriticalActionFailure(
                world,
                eid,
                `FAILED: You tried to give "${validatedAction.content}" but that item doesn't exist as an entity.`,
                "inventory"
              );
            } else {
              addCriticalActionFailure(
                world,
                eid,
                `FAILED: Your give action could not be completed.`,
                "inventory"
              );
            }
            const issues = validateAgentAction(world, name, validatedAction.type, validatedAction.target, validatedAction.content);
            for (const issue of issues) recordIssue(issue);
          }
        }
        break;

      case "examine":
        if (getAgentSensoryCapabilities(world, eid).visual <= 0) {
          const failure = "FAILED: Visual inspection is unavailable without sight.";
          addCriticalActionFailure(world, eid, failure, "examination");
          if (!hasComponent(world, eid, LastAction)) addComponent(world, eid, LastAction);
          LastAction.type[eid] = "examine"; LastAction.target[eid] = validatedAction.target || "";
          LastAction.content[eid] = ""; LastAction.success[eid] = false; LastAction.timestamp[eid] = Date.now();
          recordFailedActionAttempt(eid, sig);
          onProcedureActionResult(world, eid, validatedAction, { success: false });
          break;
        }
        // Examine is like observe but more detailed
        if (validatedAction.target) {
          Mind.focus[eid] = validatedAction.target;
          console.log(`🔍 ${name} examines ${validatedAction.target}`);
          // Use observe logic
          const examineTargetEid = findEntityByName(world, validatedAction.target);
          if (examineTargetEid === undefined) {
            const visible = getVisibleNamesInRoom(world, eid);
            const hint = visible.length > 0 ? `Visible here: ${visible.join(", ")}.` : "No matching named entity is visible here.";
            addCriticalActionFailure(
              world,
              eid,
              `FAILED: You cannot currently see "${validatedAction.target}". ${hint}`,
              "examination"
            );
            const issues = validateAgentAction(world, name, validatedAction.type, validatedAction.target, validatedAction.content);
            for (const issue of issues) recordIssue(issue);
            break;
          }

          // Explicit examination shares the same visual boundary as observation.
          if (examineTargetEid !== roomEid && !getAgentVisualEntities(world, eid).includes(examineTargetEid)) {
            const targetName = validatedAction.target;
            const visible = getVisibleNamesInRoom(world, eid);
            const hint = visible.length > 0 ? `Visible here: ${visible.join(", ")}.` : "No matching named entity is visible here.";
            addCriticalActionFailure(
              world,
              eid,
              `FAILED: You cannot currently see "${targetName}". ${hint}`,
              "examination"
            );
            recordFailedActionAttempt(eid, sig);
            break;
          }
          targetResolved(examineTargetEid);

          const targetName = Name.value[examineTargetEid] || validatedAction.target;
          const targetDesc = hasComponent(world, examineTargetEid, Description) ? Description.value[examineTargetEid] || "You see nothing special." : "You see nothing special.";
          const inspection = recordInspectionResult(world, eid, examineTargetEid, { question: validatedAction.content });
          actionSucceededForPlan = true;
          queueStimulus(world, {
            targetEid: eid,
            type: "examination",
            modality: "cognitive",
            content: `You examine ${targetName} closely. ${targetDesc}${inspection ? ` ${inspection.summary}` : ""}`,
            source: "examination",
          });
        }
        break;

      case "rest":
        actionSucceededForPlan = beginRest(world, eid);
        if (!actionSucceededForPlan) {
          addCriticalActionFailure(world, eid, "FAILED: You cannot begin resting in your current physical state.", "body");
          break;
        }
        console.log(`😴 ${name} rests`);
        // Lower arousal slightly
        Mind.arousal[eid] = Math.max(0.2, (Mind.arousal[eid] || 0.5) - 0.1);
        break;

      case "craft":
        // Crafting action - requires crafting system
        console.log(`🔨 ${name} tried to craft (crafting system pending)`);
        addCriticalActionFailure(world, eid, "FAILED: No crafting system implements this action. Use an available object affordance.");
        break;

      case "reflect":
        actionSucceededForPlan = Boolean(validatedAction.content);
        // Reflection action - internal processing
        if (validatedAction.content) {
          console.log(`💭 ${name} reflects: "${validatedAction.content}"`);
        }
        break;

      default:
        // This shouldn't happen since we validate above, but just in case
        console.log(`❓ ${name} tried unknown action "${validatedAction.type}"`);
        break;
    }

    // === PLAN ADVANCEMENT ===
    if (actionSucceededForPlan && !actionPendingForPlan && validatedAction.type === "interact"
      && /^(examine|inspect|observe)$/i.test(validatedAction.content?.trim() || "")) {
      const target = findEntityByName(world, validatedAction.target || "", { preferRoomEid: roomEid });
      const inspection = target === undefined ? undefined : recordInspectionResult(world, eid, target);
      if (inspection) queueStimulus(world, { targetEid: eid, type: "observation", modality: "cognitive", content: inspection.summary, source: "inspection" });
    }
    if (!actionPendingForPlan) recordWorkingMemoryAction(world, eid, validatedAction as AgentAction, actionSucceededForPlan, { before: workingMemoryBefore });
    addComponent(world, eid, LastAction);
    LastAction.type[eid] = validatedAction.type;
    LastAction.target[eid] = validatedAction.target || "";
    LastAction.content[eid] = validatedAction.content || "";
    LastAction.success[eid] = actionSucceededForPlan && !actionPendingForPlan;
    LastAction.timestamp[eid] = Date.now();
    if (coordination) recordCoordinationAction(world, eid, coordination, {
      succeeded: actionSucceededForPlan, pending: actionPendingForPlan,
      targetKey: executedTargetKey,
      summary: `${validatedAction.type}${validatedAction.target ? ` ${validatedAction.target}` : ""}: ${actionSucceededForPlan ? "completed" : actionPendingForPlan ? "pending" : "failed"}`,
    });
    if (actionSucceededForPlan && !actionPendingForPlan) recordCompletedGoalAction(world, eid, validatedAction as AgentAction,
      actionGoalEpisode && isGoalExecutionCurrent(world, eid, actionGoalEpisode) ? actionGoalEpisode.goalEid : null);
    if (!actionPendingForPlan && !["speak", "observe", "interact", "think", "wait"].includes(validatedAction.type)) {
      onProcedureActionResult(world, eid, validatedAction, { success: actionSucceededForPlan });
    }
    if ((actionSucceededForPlan || actionPendingForPlan) && !["rest", "wait", "think", "reflect", "observe"].includes(validatedAction.type)) endRest(world, eid);
    // A pending speech notification is public activity, not its future script.
    capabilities?.afterAction?.(actionPendingForPlan && validatedAction.type === "speak"
      ? { ...validatedAction, content: "" } as AgentAction : validatedAction as AgentAction,
      actionSucceededForPlan, actionPendingForPlan);
    // addMemory is the single salience feed; do not count the same action twice.
    // After each action, check if it advances the agent's active plan
    // This is crucial for multi-step goal execution!
    const nextStep = actionPlan && isPlanExecutionCurrent(world, eid, actionPlan)
      ? getCurrentStep(actionPlan.planEid) : null;
    if (nextStep) {
      if (actionPendingForPlan && doesActionSatisfyPlanStep(validatedAction, nextStep)) {
        // Waiting on an async tool job to complete; do not advance or count as failure.
      } else if (actionSucceededForPlan && doesActionSatisfyPlanStep(validatedAction, nextStep)) {
        const advanced = advanceAgentPlan(world, eid, actionPlan);
        if (advanced) {
          console.log(`📋 ${name} completed plan step: ${nextStep.description}`);
        }
      } else if (!actionSucceededForPlan && doesActionSatisfyPlanStep(validatedAction, nextStep)) {
        const now = readSimulationTime(world);
        const signature = `${workingMemoryEntityRef(world, eid)?.key}|${actionPlan!.planEid}|${actionPlan!.currentStep}|${nextStep.actionType}|${String(nextStep.target || "")}|${String(nextStep.content || "")}`;
        const prev = recentPlanStepFailures.get(eid);
        const within = prev && prev.signature === signature && now - prev.lastAtMs < PLAN_STEP_FAILURE_WINDOW_MS;
        const count = within ? prev!.count + 1 : 1;
        recentPlanStepFailures.set(eid, { signature, count, lastAtMs: now });

        if (count >= MAX_PLAN_STEP_FAILURES_BEFORE_REPLAN) {
          // Hooks may have reprioritized or replaced a plan while this action
          // executed. Repeated failure belongs only to the captured issuance.
          const planEid = actionPlan!.planEid;
          if (isPlanExecutionCurrent(world, eid, actionPlan!)) {
            failPlan(planEid, `Repeated plan-step failure: ${nextStep.description}`);
            queueStimulus(world, {
              targetEid: eid,
              type: "planning",
              modality: "cognitive",
              content: `Plan step failed repeatedly ("${nextStep.description}"). Replanning.`,
              source: "planning",
            });
          }
          recentPlanStepFailures.delete(eid);
        }
      }
    }
    recordCognitionOutcome(world, eid, validatedAction as AgentAction, { succeeded: actionSucceededForPlan, pending: actionPendingForPlan, waitAuthority });
    if (nativeResume && !actionPendingForPlan) publishNativeInterval(nativeResume, actionSucceededForPlan ? "succeeded" : "failed");
  }
}

/** Commit physical evidence for a world-package action only when it finishes. */
export function completeDeferredAction(world: World, eid: number, action: AgentAction, success: boolean, detail: string,
  proof?: { targetKey?: string }): void {
  assertSimulationTaskActive();
  if (!entityExists(world, eid)) return;
  const operations = deferredExecutions.get(world)?.get(eid);
  const execution = operations?.get(action.executionId || "");
  // Labels, timestamps and current plans cannot identify an asynchronous
  // operation. A late result from attempt A must never settle identical retry B.
  const actionMatches = execution && typeof action.executionId === "string"
    && action.executionId === execution.action.executionId && action.type === execution.action.type
    && action.target === execution.action.target && action.content === execution.action.content
    && hasComponent(world, eid, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[eid] === execution.actorKey;
  if (!actionMatches) return;
  const expected = actionMatches ? execution.plan : undefined;
  operations!.delete(action.executionId!);
  const inspected = actionMatches ? execution.inspectionTarget : undefined;
  if (success && inspected && isVisualInspectionAction(action)
    && hasComponent(world, eid, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[eid] === execution?.workingMemory?.actor.key
    && entityExists(world, inspected.eid) && hasComponent(world, inspected.eid, WorkingMemoryIdentity)
    && WorkingMemoryIdentity.id[inspected.eid] === inspected.key) {
    const inspection = recordInspectionResult(world, eid, inspected.eid, {
      question: execution!.action.type === "interact" ? undefined : execution!.action.content,
    });
    if (inspection) detail += ` ${inspection.summary}`;
  }
  recordWorkingMemoryAction(world, eid, action, success, { before: actionMatches ? execution.workingMemory : undefined, summary: detail });
  // Plan matching tolerates presentation differences. Terminal work proof does
  // not: command arguments and paths may be case-sensitive executable data.
  const coordinationMatches = actionMatches && action.type === execution.action.type
    && action.target === execution.action.target && action.content === execution.action.content;
  if (coordinationMatches && execution.coordination) recordCoordinationAction(world, eid, execution.coordination, {
    succeeded: success, summary: detail, targetKey: proof?.targetKey,
  });
  const matchesPlan = expected !== undefined && isPlanExecutionCurrent(world, eid, expected);
  addComponent(world, eid, LastAction);
  LastAction.type[eid] = action.type;
  LastAction.target[eid] = action.target || "";
  LastAction.content[eid] = action.content || "";
  LastAction.success[eid] = success;
  LastAction.timestamp[eid] = Date.now();
  if (success && !["rest", "wait", "think", "reflect", "observe"].includes(action.type)) endRest(world, eid);
  addMemory(world, eid, { type: "episodic", content: detail, importance: success ? 0.6 : 0.9, emotionalValence: success ? 0.1 : -0.2, timestamp: Date.now() });
  // Completion feedback is evidence, not an interrupt. Packages emit explicit
  // attention/danger stimuli for genuine world changes; treating every ordinary
  // off-plan success as urgent can starve a valid plan or learned procedure.
  addPerception(world, eid, { type: success ? "action_result" : "attention", content: detail, source: "physical world" });
  if (success) recordCompletedGoalAction(world, eid, action,
    execution.goal && isGoalExecutionCurrent(world, eid, execution.goal) ? execution.goal.goalEid : null);
  if (matchesPlan) {
    if (success) advanceAgentPlan(world, eid, expected);
    else failPlan(expected.planEid, detail);
  }
  onProcedureActionResult(world, eid, action, { success });
  recordCognitionOutcome(world, eid, action, { succeeded: success, pending: false,
    waitAuthority: execution.waitAuthority ?? captureActorWaitOutcomeAuthority(world, eid, action, false) });
  resolveDecision(world, eid, success, action);
  chronicle.record(success ? "action_success" : "action_failure", {
    agent: Name.value[eid], action: action.type, target: action.target,
    content: detail, location: Name.value[getRoomForEntity(world, eid)!],
    ...(action.type === "move" && success ? { to: action.target } : {}),
    source: "physical_completion",
  });
}

export function createCognitionSystem(): SystemDefinition {
  return {
    name: "AgentCognition",
    description: "Processes agent perception, thinking, and action selection",
    pseudocode: "For each active agent with stimuli or high arousal: think and act",
    frequency: 10000,
    active: true,
    lastRun: 0,
    compiledFn: undefined,
  };
}

// ============================================================================
// COGNITIVE ENHANCEMENT SYSTEMS
// ============================================================================

/**
 * Run planning system - generates plans for goals that don't have them
 * Should be called periodically (e.g., every 30 seconds)
 */
export async function runPlanning(world: World): Promise<void> {
  await runPlanningSystem(world);
}

/**
 * Run reflection system - triggers reflection when importance threshold exceeded
 * Should be called after cognition cycles
 */
export async function runReflection(world: World): Promise<number> {
  return await runReflectionSystem(world);
}

/**
 * Run schedule system - updates current activities based on time
 * Should be called every cognition cycle
 */
export function runSchedule(world: World): void {
  runScheduleSystem(world);
}

/**
 * Initialize all cognitive enhancement systems for agents
 * Call this after creating agents
 */
export async function initializeCognitiveEnhancements(
  world: World,
  options: {
    generateSchedules?: boolean;  // Use LLM to generate schedules
    generatePlans?: boolean;      // Generate plans for existing goals
  } = {}
): Promise<void> {
  const agents = query(world, [Agent, Mind]);

  console.log(`[Cognition] Initializing cognitive enhancements for ${agents.length} agents...`);

  // Initialize reflection state for all agents
  for (const agentEid of agents) {
    if (!Agent.active[agentEid]) continue;
    initializeReflectionState(world, agentEid);
  }

  // Initialize schedules
  await initializeAllSchedules(world, options.generateSchedules ?? false);

  // Generate plans for existing goals if requested
  if (options.generatePlans) {
    await runPlanningSystem(world);
  }

  console.log(`[Cognition] Cognitive enhancements initialized`);
}

/**
 * Run a full, awaited batch cycle including enhancement systems.
 * Real-time callers should schedule foreground cognition and background work separately.
 */
export async function runFullCognitiveCycle(
  world: World,
  registry: SystemRegistry
): Promise<Array<{ eid: number; action: AgentAction }>> {
  // 1. Update schedules based on current time
  runSchedule(world);

  // 2. Run main cognition cycle
  const results = await runCognitionCycle(world, registry, { enablePlanning: true });

  // 3. Execute actions (this also accumulates importance for reflection)
  executeActions(world, results, registry);

  // 4. Run appearance emitter - broadcasts appearance changes to nearby NPCs
  runAppearanceEmitter(world);

  // 5. Action execution and episodic memory already contribute importance.
  // This batch helper settles reflection instead of leaking detached cognition.
  await runReflection(world);

  return results;
}

/**
 * Advance an agent's plan after completing a step
 * Call this when an action aligns with the current plan step
 */
export function advanceAgentPlan(world: World, agentEid: number, expected?: PlanExecution): boolean {
  if (expected?.episode && !isPlanExecutionCurrent(world, agentEid, expected)) return false;
  const goalTargets = getRelationTargets(world, agentEid, HasGoal);

  const activeGoals = goalTargets
    .filter((gid) => hasComponent(world, gid, Goal) && Goal.status[gid] === "active" && (!expected || gid === expected.goalEid))
    .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0));

  for (const goalEid of activeGoals) {
    const planEid = getPlanForGoal(world, agentEid, goalEid);
    if (planEid !== undefined && Plan.status[planEid] === "active" && (!expected ||
        (planEid === expected.planEid && Plan.currentStep[planEid] === expected.currentStep))) {
      // A malformed/empty step list is not an exhausted, successfully executed
      // plan. The low-level helper cannot establish action validity by itself.
      const current = getCurrentStep(planEid);
      if (!current || typeof current !== "object" || typeof current.actionType !== "string" ||
          normalizeActionType(current.actionType) === null) return false;
      const advanced = advancePlanStep(planEid, { world, agentEid });
      if (current.actionType !== "wait" && (advanced || String(Plan.status[planEid]) === "completed"))
        recordGoalAttemptActivity(world, agentEid, goalEid);
      if (!advanced) {
        if (String(Plan.status[planEid]) !== "completed") return false;
        const agentName = Name.value[agentEid];

        // If the goal has a *deterministically evaluable* success contract, do not auto-complete it
        // just because the plan ran out of steps. The GoalEvaluationSystem will complete it based on ECS state.
        const rawSuccess = String(Goal.successJson[goalEid] || "").trim();
        let isEvaluable = false;
        if (rawSuccess) {
          try {
            const parsed = JSON.parse(rawSuccess);
            const t = String(parsed?.type || "");
            isEvaluable = t !== "" && t !== "custom";
          } catch {
            isEvaluable = false;
          }
        }

        if (isEvaluable) {
          console.log(`[Cognition] ${agentName} completed plan for goal (pending eval): ${Goal.description[goalEid]}`);
        } else if (isStandingIntention(world, goalEid)) {
          // A finite bout may end without exhausting an enduring motivation.
          // Actual action receipts already describe what happened. Manufacturing
          // a fresh verification demand here turns persistence into more work.
          console.log(`[Cognition] ${agentName} finished plan; standing desire retained: ${Goal.description[goalEid]}`);
        } else {
          // A plausible list of actions cannot verify an open-ended intention.
          // Preserve the goal for world-specific evidence; do not learn a macro
          // labelled successful merely because the model's list ran out.
          const settled = maintainGoalLifecycles(world, agentEid);
          if (!settled) queueStimulus(world, { targetEid: agentEid, type: "attention", modality: "cognitive", source: "planning",
            content: `The plan for "${Goal.description[goalEid]}" finished, but the goal is not verified. Check actual outcomes before claiming success.` });
          console.log(`[Cognition] ${agentName} finished plan; goal needs verification: ${Goal.description[goalEid]}`);
        }
      }
      return true;
    }
  }

  return false;
}

// Re-export appearance emitter functions for external use
export {
  runAppearanceEmitter,
  broadcastAppearanceChange,
  broadcastExpressionChange,
  cleanupAppearanceState,
};
