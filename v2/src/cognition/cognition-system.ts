import type { World } from "../ecs/world";
import type { SystemDefinition, SystemContext, SystemRegistry } from "../ecs/dynamic-systems";
import { safeGetRelationTargets } from "../ecs/dynamic-systems";
import { query, getRelationTargets, addComponent, removeComponent, hasComponent, entityExists } from "bitecs";
import { Name, Agent, Mind, Room, Description, Portal, GridPosition, WorldMap, Health, CombatStats, InCombat, Inventory, Item, StimulusSource, PhysicalObject } from "../ecs/components";
import { OccupiesRoom, Contains } from "../ecs/relations";
import {
  processAgentCognition,
  addPerception,
  getAgentMemory,
  type AgentAction
} from "./agent-mind";
import { extractKnowledgeFromInteraction } from "./knowledge-graph";
import { executeAffordance, canUseAffordance, type EffectContext } from "../world/effect-executor";
import { worldSchema, type AffordanceDefinition } from "../world/schema";
import { getDynamicComponentValues } from "../ecs/dynamic-components";
import {
  generateStimuliForAgent,
  formatStimuliForPrompt,
  eventToStimulus,
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
  const othersInRoom: Array<{ name: string; desc?: string; affordances: string[] }> = [];

  for (const otherEid of allAgents) {
    if (otherEid === agentEid) continue;
    if (!entityExists(world, otherEid)) continue;

    const otherRooms = safeGetRelationTargets(world, otherEid, OccupiesRoom);
    if (otherRooms.includes(roomEid)) {
      const otherName = Name.value[otherEid] || "someone";
      const otherDesc = Description.value[otherEid];

      // Get available affordances for interacting with this agent
      const availableAffordances = getAvailableAffordances(world, agentEid, otherEid);
      const affordanceNames = availableAffordances.map(a => a.name);

      othersInRoom.push({
        name: otherName,
        desc: otherDesc?.slice(0, 60),
        affordances: affordanceNames,
      });
    }
  }

  if (othersInRoom.length > 0) {
    lines.push("");
    lines.push("People here:");
    for (const other of othersInRoom) {
      let line = `  - ${other.name}`;
      if (other.desc) {
        line += ` - ${other.desc}`;
      }
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

      // Get object description/state
      const objMeta = getDynamicComponentValues("ObjectMeta", contentEid);
      const stateDesc = objMeta?.state ? ` (${objMeta.state})` : "";

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
  registry: SystemRegistry
): Promise<Array<{ eid: number; action: AgentAction }>> {
  // Collect pending event-based stimuli by agent
  const eventsByAgent = new Map<number, PendingStimulus[]>();

  for (const stimulus of pendingStimuli) {
    if (!eventsByAgent.has(stimulus.targetEid)) {
      eventsByAgent.set(stimulus.targetEid, []);
    }
    eventsByAgent.get(stimulus.targetEid)!.push(stimulus);
  }
  pendingStimuli.length = 0;

  const activeAgents = Array.from(query(world, [Agent, Mind])).filter(
    eid => Agent.active[eid]
  );

  const results: Array<{ eid: number; action: AgentAction }> = [];

  for (const eid of activeAgents) {
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

    // Format stimuli for the agent prompt
    const perceptionText = formatStimuliForPrompt(allStimuli);

    // Pass formatted perception to cognition
    const action = await processAgentCognition(
      world,
      eid,
      [{ type: "perception", content: perceptionText, source: "senses" }]
    );
    results.push({ eid, action });
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
    const validatedAction = { ...action, type: normalizedType };

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
            const targetMeta = getDynamicComponentValues("ObjectMeta", observeTargetEid);

            // Build detailed observation
            const observationParts: string[] = [];
            observationParts.push(`You examine ${targetName} closely.`);
            observationParts.push(targetDesc);

            if (targetMeta?.state && targetMeta.state !== "normal") {
              observationParts.push(`It appears to be ${targetMeta.state}.`);
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
        if (action.target && action.content) {
          // Find the target entity
          const targetEid = findEntityByName(world, action.target);

          if (targetEid === undefined) {
            console.log(`❓ ${name} tried to interact with "${action.target}" but couldn't find it`);
            break;
          }

          // Set movement target so agent moves towards the object they're interacting with
          setMovementTarget(eid, targetEid);

          // Parse affordance name from content (e.g., "eat the apple" -> "eat")
          const affordanceName = action.content.split(" ")[0].toLowerCase();

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
            // Broadcast to room (description already sent by executeAffordance)
            const targetName = Name.value[targetEid] || action.target;
            console.log(`🎯 ${name} ${affordanceName}s ${targetName}: ${result.changes.join(", ") || "success"}`);

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
          } else {
            // Action failed - notify actor (cognitive stimulus)
            console.log(`❌ ${name} failed to ${affordanceName} ${action.target}: ${result.message}`);
            queueStimulus({
              targetEid: eid,
              type: "action_failed",
              modality: "cognitive",
              content: `You cannot ${affordanceName} ${action.target}: ${result.message}`,
              source: "self",
            });
          }

          extractKnowledgeFromInteraction(world, eid, {
            type: "interaction",
            content: action.content,
            otherParty: action.target,
            context: `In ${Name.value[roomEid] || "a room"}`,
          }).catch(() => {});
        }
        break;

      case "move":
        // Check if agent has grid position for grid-based movement
        const hasGridPos = GridPosition.x[eid] !== undefined;

        if (action.target) {
          // First try room-based movement
          const destRoom = findRoomByName(world, action.target);
          if (destRoom !== undefined && destRoom !== roomEid) {
            const destName = Name.value[destRoom] || action.target;
            const sourceName = roomEid !== undefined ? Name.value[roomEid] : "somewhere";

            // Broadcast departure to current room (visual stimulus)
            if (roomEid !== undefined) {
              broadcastVisual(world, roomEid, `${name} leaves toward ${destName}`, name, eid);
              // Remove from current room
              removeComponent(world, eid, OccupiesRoom(roomEid));
            }

            // Add to new room
            addComponent(world, eid, OccupiesRoom(destRoom));

            // Broadcast arrival to new room (visual stimulus)
            broadcastVisual(world, destRoom, `${name} arrives from ${sourceName}`, name, eid);

            console.log(`🚶 ${name} moves from ${sourceName} to ${destName}`);

            extractKnowledgeFromInteraction(world, eid, {
              type: "movement",
              content: `Traveled from ${sourceName} to ${destName}`,
              context: `Now in ${destName}`,
            }).catch(() => {});
          } else if (hasGridPos) {
            // Try grid-based movement - find an entity to move towards
            const targetEid = findEntityByName(world, action.target);
            if (targetEid !== undefined && GridPosition.x[targetEid] !== undefined) {
              setMovementTarget(eid, targetEid);
              console.log(`🚶 ${name} starts moving towards ${action.target}`);
            } else {
              // No valid target found - do random wandering
              doRandomWander(world, eid, name);
            }
          } else {
            console.log(`❓ ${name} tried to move to "${action.target}" but couldn't find it`);
          }
        } else if (hasGridPos) {
          // No specific target - random wander
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
            const success = addToInventory(world, eid, itemEid);
            if (success) {
              console.log(`📦 ${name} picked up ${itemName}`);
              queueStimulus({
                targetEid: eid,
                type: "inventory",
                modality: "tactile",
                content: `You pick up the ${itemName}.`,
                source: "inventory",
              });
            } else {
              console.log(`❓ ${name} couldn't pick up ${itemName} (inventory full or too heavy)`);
              queueStimulus({
                targetEid: eid,
                type: "inventory",
                modality: "cognitive",
                content: `You can't pick up the ${itemName} - your inventory is full or it's too heavy.`,
                source: "inventory",
              });
            }
          } else {
            console.log(`❓ ${name} tried to pickup "${validatedAction.target}" but couldn't find it`);
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
              queueStimulus({
                targetEid: eid,
                type: "inventory",
                modality: "tactile",
                content: `You drop the ${itemName}.`,
                source: "inventory",
              });
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
