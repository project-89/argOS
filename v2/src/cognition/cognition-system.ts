import type { World } from "../ecs/world";
import type { SystemDefinition, SystemContext, SystemRegistry } from "../ecs/dynamic-systems";
import { safeGetRelationTargets } from "../ecs/dynamic-systems";
import { query, getRelationTargets, addComponent, removeComponent, hasComponent, entityExists } from "bitecs";
import { Name, Agent, Mind, Room, Description, Portal, GridPosition, WorldMap, Health, CombatStats, InCombat, Inventory, Item, StimulusSource, PhysicalObject, Appearance, Traits, ObjectState } from "../ecs/components";
import { OccupiesRoom, Contains } from "../ecs/relations";
import {
  processAgentCognition,
  addPerception,
  getAgentMemory,
  type AgentAction
} from "./agent-mind";
import { extractKnowledgeFromInteraction } from "./knowledge-graph";
import { executeAffordance, canUseAffordance, transferToolTraits, type EffectContext } from "../world/effect-executor";
import { worldSchema, type AffordanceDefinition } from "../world/schema";
import {
  generateStimuliForAgent,
  formatStimuliForPrompt,
  eventToStimulus,
  recordSuccessfulAction,
  type SensoryModality,
  type Stimulus,
} from "./sensory-system";
import { setMovementTarget } from "../systems/builtin-systems";
import {
  isValidAction,
  suggestValidAction,
  validateAgentAction,
  recordIssue,
  type ValidAction,
} from "../spirits/consistency-spirit";
import { recordFailedInteraction } from "../spirits/world-crafter-spirit";
import {
  runPlanningSystem,
  advancePlanStep,
  getPlanForGoal,
  getNextPlannedAction,
} from "./planning-system";
import {
  runReflectionSystem,
  accumulateImportance,
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
import { Goal, Plan } from "../ecs/components";
import { addEntity as bitAddEntity } from "bitecs";

export interface PendingStimulus {
  targetEid: number;
  type: string;
  content: string;
  source: string;
  modality?: SensoryModality;  // Optional for backwards compatibility
  intensity?: number;          // Stimulus intensity (0-1), defaults to 0.7
}

const pendingStimuli: PendingStimulus[] = [];
const pendingActions: Array<{ eid: number; action: AgentAction }> = [];

// Staggered processing state - prevents timeout from processing all agents at once
let agentProcessingIndex = 0;

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
    if (status === "active" &&
        desc.toLowerCase().includes("go to") &&
        desc.toLowerCase().includes(destination.toLowerCase())) {
      // Already has this goal
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
    if (status === "active" && desc.toLowerCase().includes("go to")) {
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
  queueStimulus({
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

/**
 * Initialize an entity's inventory
 */
export function initializeInventory(eid: number, maxSlots: number = 10, maxWeight: number = 50): void {
  Inventory.items[eid] = "[]";
  Inventory.maxSlots[eid] = maxSlots;
  Inventory.weight[eid] = 0;
  Inventory.maxWeight[eid] = maxWeight;
  console.log(`[Inventory] Initialized inventory for entity ${eid} (${maxSlots} slots, ${maxWeight} weight)`);
}

/**
 * Check if entity has inventory
 */
export function hasInventory(eid: number): boolean {
  return Inventory.items[eid] !== undefined;
}

/**
 * Get items in an entity's inventory
 */
export function getInventoryItems(eid: number): number[] {
  const itemsJson = Inventory.items[eid];
  if (!itemsJson) return [];
  try {
    return JSON.parse(itemsJson);
  } catch {
    return [];
  }
}

/**
 * Add an item to an entity's inventory
 * @returns true if successful, false if inventory full or item can't be picked up
 */
export function addToInventory(world: World, holderEid: number, itemEid: number): boolean {
  if (!hasInventory(holderEid)) {
    console.warn(`[Inventory] Entity ${holderEid} has no inventory`);
    return false;
  }

  // Check if item can be picked up (has Item component or is a PhysicalObject)
  const itemWeight = Item.weight[itemEid] ?? 1;

  // Check capacity
  const currentItems = getInventoryItems(holderEid);
  if (currentItems.length >= Inventory.maxSlots[holderEid]) {
    console.warn(`[Inventory] Inventory full for entity ${holderEid}`);
    return false;
  }

  // Check weight
  const currentWeight = Inventory.weight[holderEid] || 0;
  if (currentWeight + itemWeight > Inventory.maxWeight[holderEid]) {
    console.warn(`[Inventory] Too heavy for entity ${holderEid}`);
    return false;
  }

  // Add item
  currentItems.push(itemEid);
  Inventory.items[holderEid] = JSON.stringify(currentItems);
  Inventory.weight[holderEid] = currentWeight + itemWeight;

  const holderName = Name.value[holderEid] || `Entity ${holderEid}`;
  const itemName = Name.value[itemEid] || `Item ${itemEid}`;
  console.log(`[Inventory] ${holderName} picked up ${itemName}`);

  return true;
}

/**
 * Remove an item from an entity's inventory
 * @returns true if successful
 */
export function removeFromInventory(holderEid: number, itemEid: number): boolean {
  const currentItems = getInventoryItems(holderEid);
  const index = currentItems.indexOf(itemEid);

  if (index === -1) {
    console.warn(`[Inventory] Item ${itemEid} not in inventory of entity ${holderEid}`);
    return false;
  }

  currentItems.splice(index, 1);
  Inventory.items[holderEid] = JSON.stringify(currentItems);

  // Update weight
  const itemWeight = Item.weight[itemEid] ?? 1;
  Inventory.weight[holderEid] = Math.max(0, (Inventory.weight[holderEid] || 0) - itemWeight);

  const holderName = Name.value[holderEid] || `Entity ${holderEid}`;
  const itemName = Name.value[itemEid] || `Item ${itemEid}`;
  console.log(`[Inventory] ${holderName} dropped ${itemName}`);

  return true;
}

/**
 * Check if entity has a specific item
 */
export function hasItem(holderEid: number, itemEid: number): boolean {
  return getInventoryItems(holderEid).includes(itemEid);
}

/**
 * Get inventory contents as formatted string for prompts
 */
export function formatInventory(eid: number): string {
  const items = getInventoryItems(eid);
  if (items.length === 0) {
    return "Your inventory is empty.";
  }

  const itemNames = items.map(itemEid => Name.value[itemEid] || `Unknown Item`);
  return `You are carrying: ${itemNames.join(", ")}`;
}

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
 * Sync visiblyHolding with the first item in inventory (or clear it)
 */
export function syncVisiblyHoldingFromInventory(eid: number): void {
  if (!hasInventory(eid)) {
    Appearance.visiblyHolding[eid] = "";
    return;
  }

  const items = getInventoryItems(eid);
  if (items.length > 0) {
    // Show the first/primary item as what they're holding
    const firstItem = items[0];
    const itemName = Name.value[firstItem] || "something";
    Appearance.visiblyHolding[eid] = itemName;
  } else {
    Appearance.visiblyHolding[eid] = "";
  }
  Appearance.lastUpdate[eid] = Date.now();
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
  const { addEntity } = require("bitecs");
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

  // Add to room (using Contains relation)
  addComponent(world, roomEid, Contains(eid));

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

  // Get all entities with StimulusSource that are in this room
  const stimulusSources = Array.from(query(world, [StimulusSource]));

  for (const eid of stimulusSources) {
    // Check if it's in this room (via OccupiesRoom or Contains)
    const rooms = safeGetRelationTargets(world, eid, OccupiesRoom);
    if (rooms.includes(roomEid)) {
      objects.push({
        eid,
        name: Name.value[eid] || `Object ${eid}`,
        description: Description.value[eid] || "",
      });
      continue;
    }

    // Also check Contains relation (room contains object)
    const contents = safeGetRelationTargets(world, roomEid, Contains);
    if (contents.includes(eid)) {
      objects.push({
        eid,
        name: Name.value[eid] || `Object ${eid}`,
        description: Description.value[eid] || "",
      });
    }
  }

  return objects;
}

/**
 * Find an entity by name (with fuzzy matching for natural language)
 */
export function findEntityByName(world: World, name: string): number | undefined {
  // First check registry
  const registered = entityRegistry.byName.get(name);
  if (registered !== undefined) return registered;

  // Fall back to searching all entities with Name component
  const allEntities = Array.from(query(world, []));
  const nameLower = name.toLowerCase().trim();

  // Normalize: remove trailing 's' for plural handling (trees -> tree)
  const singularized = nameLower.endsWith('s') ? nameLower.slice(0, -1) : nameLower;
  // Also handle "ies" -> "y" (berries -> berry)
  const singularizedIes = nameLower.endsWith('ies') ? nameLower.slice(0, -3) + 'y' : singularized;

  // Exact match first
  for (const eid of allEntities) {
    const entityName = Name.value[eid];
    if (entityName?.toLowerCase() === nameLower) {
      return eid;
    }
  }

  // Try partial match (entity name contains search term)
  for (const eid of allEntities) {
    const entityName = Name.value[eid]?.toLowerCase();
    if (!entityName) continue;

    // Check if search term is in entity name OR singularized version matches
    if (entityName.includes(nameLower) ||
        entityName.includes(singularized) ||
        entityName.includes(singularizedIes)) {
      return eid;
    }

    // Also check if entity name starts with search term (tree matches "Tree 1")
    if (entityName.startsWith(singularized) || entityName.startsWith(singularizedIes)) {
      return eid;
    }
  }

  return undefined;
}

/**
 * Get available affordances for a target entity
 */
export function getAvailableAffordances(
  world: World,
  actorEid: number,
  targetEid: number
): AffordanceDefinition[] {
  const available: AffordanceDefinition[] = [];

  for (const affordance of worldSchema.getAllAffordances()) {
    const check = canUseAffordance(affordance, actorEid, targetEid);
    if (check.available) {
      available.push(affordance);
    }
  }

  return available;
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

  // Get room contents
  const contents = safeGetRelationTargets(world, roomEid, Contains);

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
  const contents = safeGetRelationTargets(world, roomEid, Contains);

  for (const contentEid of contents) {
    if (!entityExists(world, contentEid)) continue;
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

export function queueStimulus(stimulus: PendingStimulus): void {
  pendingStimuli.push(stimulus);
}

export function queueStimulusForAgent(
  world: World,
  agentName: string,
  stimulus: { type: string; content: string; source: string; modality?: SensoryModality }
): void {
  const agents = Array.from(query(world, [Agent]));
  for (const eid of agents) {
    if (Name.value[eid] === agentName) {
      pendingStimuli.push({ targetEid: eid, ...stimulus });
      return;
    }
  }
}

export function broadcastToRoom(
  world: World,
  roomEid: number,
  stimulus: { type: string; content: string; source: string; modality?: SensoryModality; intensity?: number },
  excludeEid?: number
): void {
  if (!entityExists(world, roomEid)) return;

  const agents = Array.from(query(world, [Agent])).filter(eid => entityExists(world, eid));
  for (const eid of agents) {
    if (eid === excludeEid) continue;
    const rooms = safeGetRelationTargets(world, eid, OccupiesRoom);
    if (rooms.includes(roomEid)) {
      pendingStimuli.push({ targetEid: eid, ...stimulus });
    }
  }
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
  const nameLower = roomName.toLowerCase();

  // Try exact match first
  for (const eid of rooms) {
    if (Name.value[eid]?.toLowerCase() === nameLower) {
      return eid;
    }
  }

  // Try partial match
  for (const eid of rooms) {
    if (Name.value[eid]?.toLowerCase().includes(nameLower)) {
      return eid;
    }
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
 * Generate MUD-style room perception text for an agent
 * This is a simplified version - will be replaced with TextRenderer when WorldSchema integrates
 */
export function renderRoomPerception(
  world: World,
  agentEid: number,
  roomEid: number
): string {
  const lines: string[] = [];

  // Validate entities exist
  if (!entityExists(world, agentEid) || !entityExists(world, roomEid)) {
    return "You are nowhere.";
  }

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
  const allAgents = Array.from(query(world, [Agent])).filter(eid => entityExists(world, eid));
  const othersInRoom: Array<{ eid: number; appearance: string; affordances: string[] }> = [];

  for (const otherEid of allAgents) {
    if (otherEid === agentEid) continue;
    if (!entityExists(world, otherEid)) continue;

    const otherRooms = safeGetRelationTargets(world, otherEid, OccupiesRoom);
    if (otherRooms.includes(roomEid)) {
      // Get available affordances for interacting with this agent
      const availableAffordances = getAvailableAffordances(world, agentEid, otherEid);
      const affordanceNames = availableAffordances.map(a => a.name);

      // Use appearance system if available, otherwise fall back to basic description
      let appearance: string;
      if (hasAppearance(otherEid)) {
        appearance = getAppearanceDescription(otherEid);
      } else {
        // Fallback: basic name + inventory
        const otherName = Name.value[otherEid] || "someone";
        const heldItems: string[] = [];
        if (hasInventory(otherEid)) {
          const items = getInventoryItems(otherEid);
          for (const itemEid of items) {
            const itemName = Name.value[itemEid];
            if (itemName) heldItems.push(itemName);
          }
        }
        appearance = heldItems.length > 0
          ? `${otherName} (holding: ${heldItems.join(", ")})`
          : otherName;
      }

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

  // Find objects/items in room (via Contains relation)
  const contents = safeGetRelationTargets(world, roomEid, Contains);
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
      const objState = ObjectState?.current?.[contentEid];
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

  // Find exits (rooms with portals to this room or other connected rooms)
  const allRooms = Array.from(query(world, [Room]));
  const exits: string[] = [];

  for (const otherRoomEid of allRooms) {
    if (otherRoomEid === roomEid) continue;

    // Check if there's a portal connection
    if (hasComponent(world, otherRoomEid, Portal)) {
      const destRoom = Portal.destinationRoom[otherRoomEid];
      if (destRoom === roomEid) {
        const exitName = Name.value[otherRoomEid];
        if (exitName) exits.push(exitName);
      }
    }
  }

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

export async function runCognitionCycle(
  world: World,
  registry: SystemRegistry,
  options: { tick?: number; maxAgents?: number; enablePlanning?: boolean } = {}
): Promise<Array<{ eid: number; action: AgentAction }>> {
  const currentTick = options.tick ?? Date.now();
  const maxAgentsThisTick = options.maxAgents ?? AGENTS_PER_TICK;
  const enablePlanning = options.enablePlanning ?? true; // Planning ON by default!

  // === PLANNING PHASE ===
  // Generate plans for agents with goals but no active plan
  // This is crucial for multi-step reasoning!
  if (enablePlanning) {
    await runPlanningSystem(world);
  }

  // Collect pending event-based stimuli by agent
  const eventsByAgent = new Map<number, PendingStimulus[]>();

  for (const stimulus of pendingStimuli) {
    if (!eventsByAgent.has(stimulus.targetEid)) {
      eventsByAgent.set(stimulus.targetEid, []);
    }
    eventsByAgent.get(stimulus.targetEid)!.push(stimulus);
  }
  pendingStimuli.length = 0;

  const allActiveAgents = Array.from(query(world, [Agent, Mind])).filter(
    eid => Agent.active[eid]
  );

  // Filter agents based on arousal-based thinking schedule
  // Agents with pending stimuli always get to think
  const agentsToProcess = allActiveAgents.filter(eid =>
    eventsByAgent.has(eid) || shouldAgentThink(eid, currentTick)
  );

  // Apply round-robin pagination to avoid processing all agents at once
  const startIdx = agentProcessingIndex % Math.max(1, agentsToProcess.length);
  const agentsThisTick = agentsToProcess.slice(startIdx, startIdx + maxAgentsThisTick);

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
      // Convert pending events to stimulus format with modalities
      const pendingEvents = (eventsByAgent.get(eid) || []).map(s => {
        // If modality was specified, use it; otherwise infer from type
        if (s.modality) {
          return {
            modality: s.modality,
            type: s.type,
            content: s.content,
            source: s.source,
            intensity: 1,
          };
        }
        return eventToStimulus({ type: s.type, content: s.content, source: s.source });
      });

      // Generate all stimuli for this agent (visual, auditory, cognitive, etc.)
      const allStimuli = generateStimuliForAgent(world, eid, pendingEvents);

      // Format stimuli for the agent prompt (include agentEid for self-awareness)
      const perceptionText = formatStimuliForPrompt(allStimuli, eid);

      // Pass formatted perception to cognition
      const action = await processAgentCognition(
        world,
        eid,
        [{ type: "perception", content: perceptionText, source: "senses" }]
      );
      return { eid, action };
    }));

    results.push(...batchResults);
  }

  return results;
}

/**
 * Normalize and validate an action type
 * Returns the normalized action type or null if completely invalid
 */
function normalizeActionType(actionType: string): ValidAction | null {
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

export function executeActions(
  world: World,
  actions: Array<{ eid: number; action: AgentAction }>,
  registry: SystemRegistry
): void {
  for (const { eid, action } of actions) {
    // Skip if entity no longer exists
    if (!entityExists(world, eid)) continue;

    const name = Name.value[eid];
    const rooms = safeGetRelationTargets(world, eid, OccupiesRoom);
    const roomEid = rooms[0];

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
    let validatedAction = { ...action, type: normalizedType };
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

    switch (validatedAction.type) {
      case "speak":
        if (validatedAction.content && roomEid !== undefined) {
          // Speech is an auditory stimulus
          broadcastSound(world, roomEid, `${name} says: "${action.content}"`, name, eid);
          console.log(`💬 ${name}: "${action.content}"`);

          extractKnowledgeFromInteraction(world, eid, {
            type: "speech",
            content: action.content || "",
            context: `Speaking in ${Name.value[roomEid] || "a room"}`,
          }).catch(() => {});
        }
        break;

      case "observe":
        if (action.target) {
          Mind.focus[eid] = action.target;
          console.log(`👁️ ${name} observes ${action.target}`);

          // Find the target and provide detailed observation
          const observeTargetEid = findEntityByName(world, action.target);
          if (observeTargetEid !== undefined) {
            // Set movement target so agent moves towards what they're observing
            setMovementTarget(eid, observeTargetEid);
            const targetName = Name.value[observeTargetEid] || action.target;
            const targetDesc = Description.value[observeTargetEid] || "You see nothing special.";
            // Read state from ECS ObjectState component (not ObjectMeta)
            const targetState = ObjectState?.current?.[observeTargetEid];

            // Build detailed observation
            const observationParts: string[] = [];
            observationParts.push(`You examine ${targetName} closely.`);
            observationParts.push(targetDesc);

            if (targetState && targetState !== "normal") {
              observationParts.push(`It appears to be ${targetState}.`);
            }

            // Get available affordances - examining reveals what you can do
            const affordances = getAvailableAffordances(world, eid, observeTargetEid);
            if (affordances.length > 0) {
              observationParts.push(`You could: ${affordances.map(a => a.name).join(", ")}.`);
            }

            // Send detailed observation as cognitive stimulus
            queueStimulus({
              targetEid: eid,
              type: "observation",
              modality: "cognitive",
              content: observationParts.join(" "),
              source: "observation",
            });
          }

          extractKnowledgeFromInteraction(world, eid, {
            type: "observation",
            content: `Observing ${action.target}`,
            otherParty: action.target,
            context: `In ${Name.value[roomEid] || "a room"}`,
          }).catch(() => {});
        }
        break;

      case "think":
        if (action.content) {
          console.log(`💭 ${name} thinks: "${action.content}"`);
        }
        break;

      case "interact":
        if (validatedAction.target && validatedAction.content) {
          // Parse affordance name from content (e.g., "eat the apple" -> "eat")
          const affordanceName = validatedAction.content.split(" ")[0].toLowerCase();

          // Find the target entity
          const targetEid = findEntityByName(world, validatedAction.target);

          if (targetEid === undefined) {
            console.log(`❓ ${name} tried to interact with "${validatedAction.target}" but couldn't find it`);
            // Record failed interaction for World Crafter spirit
            const roomName = roomEid !== undefined ? (Name.value[roomEid] || "Unknown Room") : "Unknown Room";
            recordFailedInteraction(
              name,
              eid,
              roomName,
              affordanceName,
              validatedAction.target,
              validatedAction.content
            );
            break;
          }

          // Set movement target so agent moves towards the object they're interacting with
          setMovementTarget(eid, targetEid);

          // Create effect context
          const ctx: EffectContext = {
            world,
            actorEid: eid,
            targetEid,
            worldSchema,
            registry: entityRegistry,
          };

          // Execute the affordance
          const result = executeAffordance(affordanceName, ctx);

          if (result.success) {
            const targetName = Name.value[targetEid] || action.target;
            console.log(`🎯 ${name} ${affordanceName}s ${targetName}: ${result.changes.join(", ") || "success"}`);

            // Record successful action for memory/self-awareness
            recordSuccessfulAction(eid, `${affordanceName} ${targetName}`);

            // Broadcast visual to others in room - they can see the interaction!
            if (roomEid !== undefined) {
              broadcastVisual(world, roomEid, `${name} ${affordanceName}s the ${targetName}.`, name, eid);
            }

            // Give feedback to actor about what happened (cognitive stimulus)
            if (result.changes.length > 0) {
              queueStimulus({
                targetEid: eid,
                type: "action_result",
                modality: "cognitive",
                content: `You ${affordanceName} ${targetName}. ${result.changes.join(". ")}`,
                source: "self",
              });
            }

            // MEMORY FORMATION for successful actions - include the result!
            extractKnowledgeFromInteraction(world, eid, {
              type: "action_success",
              content: `SUCCESS: I ${affordanceName}ed the ${targetName}. ${result.changes.join(". ")}`,
              otherParty: targetName,
              context: `In ${Name.value[roomEid] || "a room"}. The action succeeded and changed the world state.`,
            }).catch(() => {});
          } else {
            // Action failed - notify actor with HELPFUL feedback
            console.log(`❌ ${name} failed to ${affordanceName} ${action.target}: ${result.message}`);

            // Build helpful error message with ACTIONABLE hints
            const targetName = Name.value[targetEid] || action.target;
            let helpfulMessage = `FAILED: You cannot ${affordanceName} ${targetName}.`;
            const hints: string[] = [];

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
            const affordanceDef = worldSchema.getAffordance(affordanceName);
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

            queueStimulus({
              targetEid: eid,
              type: "action_failed",
              modality: "cognitive",
              content: helpfulMessage,
              source: "self",
            });

            // MEMORY FORMATION for failed actions - remember what didn't work!
            extractKnowledgeFromInteraction(world, eid, {
              type: "action_failed",
              content: `FAILED: I tried to ${affordanceName} the ${targetName} but it didn't work. ${result.message}`,
              otherParty: targetName,
              context: `In ${Name.value[roomEid] || "a room"}. This action failed - I should try a different approach.`,
            }).catch(() => {});
          }
        }
        break;

      case "move":
        // GOAL-BASED MOVEMENT SYSTEM
        // AI creates intent (Goals), deterministic GoalPursuitSystem executes movement
        // This separates cognition (what to do) from execution (how to do it)

        // Check if agent has grid position for grid-based movement
        const hasGridPos = GridPosition.x[eid] !== undefined;

        if (action.target) {
          // First try room-based movement via Goal system
          const destRoom = findRoomByName(world, action.target);
          if (destRoom !== undefined && destRoom !== roomEid) {
            const destName = Name.value[destRoom] || action.target;
            const sourceName = roomEid !== undefined ? Name.value[roomEid] : "somewhere";

            // Check if agent actually has a current room
            // If no room but has GridPosition, use grid-based movement instead
            // GoalPursuitSystem can't move agents without OccupiesRoom relation
            const hasCurrentRoom = roomEid !== undefined;

            if (hasCurrentRoom) {
              // Agent is in a room - use Goal-based movement
              // Create a movement goal - GoalPursuitSystem will execute the actual movement
              // Parse reason from action.content if available
              const reason = action.content || undefined;

              // Calculate priority based on agent's arousal (urgency)
              const arousal = Mind.arousal[eid] || 0.5;
              const priority = Math.round(3 + arousal * 7); // 3-10 based on arousal

              const goalEid = createMovementGoal(world, eid, destName, reason, priority);

              if (goalEid !== undefined) {
                // Update agent's focus
                Mind.focus[eid] = `going to ${destName}`;
                Mind.arousal[eid] = Math.min(1, arousal + 0.1);

                // Broadcast intent to room (others can see them getting ready to leave)
                broadcastVisual(world, roomEid, `${name} prepares to head toward ${destName}`, name, eid);

                console.log(`🎯 ${name} intends to go to ${destName} (goal created, GoalPursuitSystem will execute)`);

                // Notify agent of their plan (cognitive feedback)
                queueStimulus({
                  targetEid: eid,
                  type: "intent",
                  modality: "cognitive",
                  content: `You decide to go to ${destName}${reason ? ` to ${reason}` : ""}.`,
                  source: "self",
                });

                extractKnowledgeFromInteraction(world, eid, {
                  type: "movement_intent",
                  content: `Planning to travel from ${sourceName} to ${destName}`,
                  context: `Currently in ${sourceName}`,
                }).catch(() => {});
              }
            } else if (hasGridPos && GridPosition.x[destRoom] !== undefined) {
              // Agent has NO room but has GridPosition - use grid-based movement to room
              // This is the key fix: agents stuck "somewhere" can now physically move to rooms
              // Once they arrive at room's GridPosition, RoomArrival system will set OccupiesRoom
              setMovementTarget(eid, destRoom);
              Mind.focus[eid] = `heading to ${destName}`;
              Mind.arousal[eid] = Math.min(1, (Mind.arousal[eid] || 0.5) + 0.1);

              console.log(`🚶 ${name} starts moving towards ${destName} (grid-based, no current room)`);

              // Notify agent
              queueStimulus({
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
              console.log(`🎯 ${name} intends to go to ${destName} (goal created, hoping GoalPursuit can help)`);
            }
          } else if (hasGridPos) {
            // Grid-based movement - find an entity to move towards
            // This still uses direct movement for grid-based (pathfinding separate concern)
            const targetEid = findEntityByName(world, action.target);
            if (targetEid !== undefined && GridPosition.x[targetEid] !== undefined) {
              setMovementTarget(eid, targetEid);
              console.log(`🚶 ${name} starts moving towards ${action.target}`);
            } else {
              // No valid target found - do random wandering
              doRandomWander(world, eid, name);
            }
          } else {
            // Neither room nor grid-based target found
            console.log(`❓ ${name} tried to move to "${action.target}" but couldn't find it`);

            // Still give them a goal if we have a valid room name
            // GoalPursuitSystem might find it even if we can't here
            createMovementGoal(world, eid, action.target, action.content, 5);
          }
        } else if (hasGridPos) {
          // No specific target - random wander (for grid-based only)
          doRandomWander(world, eid, name);
        }
        break;

      case "wait":
        // Agent is intentionally doing nothing
        break;

      case "attack":
        // Combat action - using Health component
        if (validatedAction.target) {
          const targetEid = findEntityByName(world, validatedAction.target);
          if (targetEid !== undefined) {
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
              Health.lastDamage[targetEid] = Date.now();

              // Mark attacker as in combat
              InCombat.targetEid[eid] = targetEid;
              InCombat.stance[eid] = "aggressive";
              InCombat.lastAction[eid] = Date.now();

              const targetName = Name.value[targetEid] || validatedAction.target;
              console.log(`⚔️ ${name} attacks ${targetName} for ${damage.toFixed(1)} damage! (${Health.current[targetEid]}/${targetMaxHealth} HP)`);

              // Notify both parties
              queueStimulus({
                targetEid: eid,
                type: "combat",
                modality: "tactile",
                content: `You attack ${targetName}, dealing ${damage.toFixed(1)} damage!`,
                source: "combat",
              });
              queueStimulus({
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
                const rooms = getRelationTargets(world, eid, OccupiesRoom);
                if (rooms.length > 0) {
                  broadcastToRoom(world, rooms[0], {
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
          }
        }
        break;

      case "pickup":
        // Pick up an item from the ground
        if (validatedAction.target) {
          // Check if agent has inventory
          if (!hasInventory(eid)) {
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
            break;
          }

          const itemEid = findEntityByName(world, validatedAction.target);
          if (itemEid !== undefined) {
            const itemName = Name.value[itemEid] || validatedAction.target;

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
              queueStimulus({
                targetEid: eid,
                type: "action_failed",
                modality: "cognitive",
                content: `FAILED: You tried to take "${itemName}" but it cannot be taken right now. You do NOT have the ${itemName}. Check what conditions must be met first.`,
                source: "inventory",
              });
              break;
            }

            const success = addToInventory(world, eid, itemEid);
            if (success) {
              console.log(`📦 ${name} picked up ${itemName}`);

              // Record successful action for memory/self-awareness
              recordSuccessfulAction(eid, `picked up ${itemName}`);

              // Transfer tool traits from item to actor
              const traitChanges: string[] = [];
              transferToolTraits(eid, itemEid, traitChanges);
              if (traitChanges.length > 0) {
                console.log(`🔧 ${name} gained: ${traitChanges.join(", ")}`);
              }

              // Update appearance - they're now visibly holding this item
              if (hasAppearance(eid)) {
                setVisiblyHolding(eid, itemName);
              }

              queueStimulus({
                targetEid: eid,
                type: "inventory",
                modality: "tactile",
                content: `You pick up the ${itemName}.`,
                source: "inventory",
              });
              // Broadcast to others in the room so they can see the pickup!
              if (roomEid !== undefined) {
                broadcastVisual(world, roomEid, `${name} picks up the ${itemName}.`, name, eid);
              }
            } else {
              console.log(`❓ ${name} couldn't pick up ${itemName} (inventory full or too heavy)`);
              queueStimulus({
                targetEid: eid,
                type: "action_failed",
                modality: "cognitive",
                content: `FAILED: You tried to take "${itemName}" but your inventory is full or it's too heavy. You do NOT have the ${itemName}.`,
                source: "inventory",
              });
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
              validatedAction.content
            );
            queueStimulus({
              targetEid: eid,
              type: "action_failed",
              modality: "cognitive",
              content: `FAILED: "${validatedAction.target}" was not found here. You do NOT have it.`,
              source: "inventory",
            });
          }
        }
        break;

      case "drop":
        // Drop an item from inventory
        if (validatedAction.target) {
          const itemEid = findEntityByName(world, validatedAction.target);
          if (itemEid !== undefined && hasItem(eid, itemEid)) {
            const itemName = Name.value[itemEid] || validatedAction.target;
            const success = removeFromInventory(eid, itemEid);
            if (success) {
              console.log(`📦 ${name} dropped ${itemName}`);

              // Update appearance - sync visiblyHolding with remaining inventory
              if (hasAppearance(eid)) {
                syncVisiblyHoldingFromInventory(eid);
              }

              queueStimulus({
                targetEid: eid,
                type: "inventory",
                modality: "tactile",
                content: `You drop the ${itemName}.`,
                source: "inventory",
              });

              // Broadcast to others in the room so they can see the drop
              if (roomEid !== undefined) {
                broadcastVisual(world, roomEid, `${name} drops the ${itemName}.`, name, eid);
              }
            }
          } else {
            console.log(`❓ ${name} tried to drop "${validatedAction.target}" but doesn't have it`);
            queueStimulus({
              targetEid: eid,
              type: "inventory",
              modality: "cognitive",
              content: `You don't have that item to drop.`,
              source: "inventory",
            });
          }
        }
        break;

      case "use":
        // Use an item from inventory
        if (validatedAction.target) {
          const itemEid = findEntityByName(world, validatedAction.target);
          if (itemEid !== undefined && hasItem(eid, itemEid)) {
            const itemName = Name.value[itemEid] || validatedAction.target;
            const itemCategory = Item.category[itemEid] || "misc";

            console.log(`🔧 ${name} uses ${itemName}`);
            queueStimulus({
              targetEid: eid,
              type: "inventory",
              modality: "tactile",
              content: `You use the ${itemName}.`,
              source: "inventory",
            });

            // Handle different item categories
            if (itemCategory === "food") {
              // Consume food - remove from inventory
              removeFromInventory(eid, itemEid);
              console.log(`🍖 ${name} ate ${itemName}`);
            }
          } else if (itemEid !== undefined) {
            // Item exists but not in inventory - can they use it directly?
            const itemName = Name.value[itemEid] || validatedAction.target;
            console.log(`🔧 ${name} uses ${itemName} (in environment)`);
            queueStimulus({
              targetEid: eid,
              type: "interaction",
              modality: "tactile",
              content: `You use the ${itemName}.`,
              source: itemName,
            });
          } else {
            console.log(`❓ ${name} tried to use "${validatedAction.target}" but couldn't find it`);
          }
        }
        break;

      case "give":
        // Give an item to another entity
        if (validatedAction.target && validatedAction.content) {
          // Parse target as recipient, content as item
          const recipientEid = findEntityByName(world, validatedAction.target);
          const itemEid = findEntityByName(world, validatedAction.content);

          if (recipientEid !== undefined && itemEid !== undefined && hasItem(eid, itemEid)) {
            const recipientName = Name.value[recipientEid] || validatedAction.target;
            const itemName = Name.value[itemEid] || validatedAction.content;

            // Check if recipient has inventory
            if (!hasInventory(recipientEid)) {
              console.log(`❓ ${recipientName} can't receive items (no inventory)`);
              queueStimulus({
                targetEid: eid,
                type: "inventory",
                modality: "cognitive",
                content: `${recipientName} can't receive items.`,
                source: "inventory",
              });
              break;
            }

            // Transfer item
            if (removeFromInventory(eid, itemEid) && addToInventory(world, recipientEid, itemEid)) {
              console.log(`🎁 ${name} gave ${itemName} to ${recipientName}`);
              queueStimulus({
                targetEid: eid,
                type: "inventory",
                modality: "tactile",
                content: `You give the ${itemName} to ${recipientName}.`,
                source: "inventory",
              });
              queueStimulus({
                targetEid: recipientEid,
                type: "inventory",
                modality: "tactile",
                content: `${name} gives you a ${itemName}.`,
                source: name,
              });
            }
          } else {
            console.log(`❓ ${name} tried to give but something went wrong`);
          }
        }
        break;

      case "examine":
        // Examine is like observe but more detailed
        if (validatedAction.target) {
          Mind.focus[eid] = validatedAction.target;
          console.log(`🔍 ${name} examines ${validatedAction.target}`);
          // Use observe logic
          const examineTargetEid = findEntityByName(world, validatedAction.target);
          if (examineTargetEid !== undefined) {
            const targetName = Name.value[examineTargetEid] || validatedAction.target;
            const targetDesc = Description.value[examineTargetEid] || "You see nothing special.";
            queueStimulus({
              targetEid: eid,
              type: "examination",
              modality: "cognitive",
              content: `You examine ${targetName} closely. ${targetDesc}`,
              source: "examination",
            });
          }
        }
        break;

      case "rest":
        // Rest action - could reduce fatigue if we had that component
        console.log(`😴 ${name} rests`);
        // Lower arousal slightly
        Mind.arousal[eid] = Math.max(0.2, (Mind.arousal[eid] || 0.5) - 0.1);
        break;

      case "craft":
        // Crafting action - requires crafting system
        console.log(`🔨 ${name} tried to craft (crafting system pending)`);
        break;

      case "reflect":
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
    // After each action, check if it advances the agent's active plan
    // This is crucial for multi-step goal execution!
    const nextStep = getNextPlannedAction(world, eid);
    if (nextStep) {
      // Check if the action matches the current plan step
      const actionMatchesPlan =
        validatedAction.type === nextStep.actionType ||
        (validatedAction.type === "interact" && nextStep.actionType === "interact") ||
        (validatedAction.target?.toLowerCase() === nextStep.target?.toLowerCase());

      if (actionMatchesPlan) {
        const advanced = advanceAgentPlan(world, eid);
        if (advanced) {
          console.log(`📋 ${name} completed plan step: ${nextStep.description}`);
        }
      }
    }
  }
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
 * Run a full cognitive cycle including all enhancement systems
 * This is a convenience function that runs everything in order
 */
export async function runFullCognitiveCycle(
  world: World,
  registry: SystemRegistry
): Promise<Array<{ eid: number; action: AgentAction }>> {
  // 1. Update schedules based on current time
  runSchedule(world);

  // 2. Run main cognition cycle
  const results = await runCognitionCycle(world, registry);

  // 3. Execute actions (this also accumulates importance for reflection)
  executeActions(world, results, registry);

  // 4. Run appearance emitter - broadcasts appearance changes to nearby NPCs
  runAppearanceEmitter(world);

  // 5. Accumulate importance for agents based on stimuli received
  for (const { eid, action } of results) {
    // Significant actions increase importance
    if (action.type === "speak" || action.type === "interact") {
      accumulateImportance(world, eid, 5);
    } else if (action.type !== "wait") {
      accumulateImportance(world, eid, 2);
    }
  }

  // 6. Check for reflection triggers (runs async, doesn't block)
  runReflection(world).catch(console.error);

  return results;
}

/**
 * Advance an agent's plan after completing a step
 * Call this when an action aligns with the current plan step
 */
export function advanceAgentPlan(world: World, agentEid: number): boolean {
  const goalTargets = getRelationTargets(world, agentEid, HasGoal);

  for (const goalEid of goalTargets) {
    if (!hasComponent(world, goalEid, Goal)) continue;
    if (Goal.status[goalEid] !== "active") continue;

    const planEid = getPlanForGoal(world, agentEid, goalEid);
    if (planEid && Plan.status[planEid] === "active") {
      const advanced = advancePlanStep(planEid);
      if (!advanced) {
        // Plan completed - update goal progress
        Goal.progress[goalEid] = 100;
        Goal.status[goalEid] = "completed";
        const agentName = Name.value[agentEid];
        console.log(`[Cognition] ${agentName} completed goal: ${Goal.description[goalEid]}`);
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
