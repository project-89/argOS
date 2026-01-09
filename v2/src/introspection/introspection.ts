/**
 * System Introspection Module
 *
 * Provides dynamic introspection of the ArgOS simulation:
 * - Available actions and their metadata
 * - Component registry with descriptions
 * - System registry with summaries
 * - Rolling event buffer for pattern detection
 * - Entity snapshots
 */

import type { World } from "../ecs/world";
import { query, entityExists, hasComponent } from "bitecs";
import { AllComponents, Name, Agent, Description, GridPosition, Room } from "../ecs/components";
import { listSystems, type SystemRegistry, type SystemDefinition } from "../ecs/dynamic-systems";
import { OccupiesRoom } from "../ecs/relations";
import { safeGetRelationTargets } from "../ecs/dynamic-systems";

// =============================================================================
// ACTION INTROSPECTION
// =============================================================================

export interface ActionDefinition {
  name: string;
  description: string;
  category: "communication" | "movement" | "interaction" | "combat" | "inventory" | "cognitive" | "utility";
  requiresTarget: boolean;
  requiresContent: boolean;
  requiredComponents?: string[];  // Components the actor needs
  targetComponents?: string[];    // Components the target needs
  systemRequirements?: string[];  // Systems that must exist
}

/**
 * Central registry of all available actions in the cognition system.
 * This is the source of truth - ConsistencySpirit should use this.
 */
export const ACTION_REGISTRY: Record<string, ActionDefinition> = {
  speak: {
    name: "speak",
    description: "Say something aloud to nearby entities",
    category: "communication",
    requiresTarget: false,
    requiresContent: true,
    requiredComponents: ["Agent", "Mind"],
  },
  observe: {
    name: "observe",
    description: "Focus attention on a specific entity or area",
    category: "cognitive",
    requiresTarget: true,
    requiresContent: false,
    requiredComponents: ["Agent", "Mind"],
  },
  think: {
    name: "think",
    description: "Internal thought process (not audible)",
    category: "cognitive",
    requiresTarget: false,
    requiresContent: true,
    requiredComponents: ["Agent", "Mind"],
  },
  interact: {
    name: "interact",
    description: "Interact with an object using its affordances",
    category: "interaction",
    requiresTarget: true,
    requiresContent: true,
    requiredComponents: ["Agent"],
  },
  move: {
    name: "move",
    description: "Move to a location or towards an entity",
    category: "movement",
    requiresTarget: true,
    requiresContent: false,
    requiredComponents: ["Agent"],
  },
  wait: {
    name: "wait",
    description: "Do nothing for this tick",
    category: "utility",
    requiresTarget: false,
    requiresContent: false,
    requiredComponents: ["Agent"],
  },
  attack: {
    name: "attack",
    description: "Attack a target entity",
    category: "combat",
    requiresTarget: true,
    requiresContent: false,
    requiredComponents: ["Agent"],
    targetComponents: ["Health"],
    systemRequirements: ["combat"],
  },
  pickup: {
    name: "pickup",
    description: "Pick up an item from the environment",
    category: "inventory",
    requiresTarget: true,
    requiresContent: false,
    requiredComponents: ["Agent", "Inventory"],
    targetComponents: ["Item"],
    systemRequirements: ["inventory"],
  },
  drop: {
    name: "drop",
    description: "Drop an item from inventory",
    category: "inventory",
    requiresTarget: true,
    requiresContent: false,
    requiredComponents: ["Agent", "Inventory"],
    systemRequirements: ["inventory"],
  },
  use: {
    name: "use",
    description: "Use an item from inventory or environment",
    category: "inventory",
    requiresTarget: true,
    requiresContent: false,
    requiredComponents: ["Agent"],
    systemRequirements: ["inventory"],
  },
  give: {
    name: "give",
    description: "Give an item to another entity",
    category: "inventory",
    requiresTarget: true,
    requiresContent: true,  // Item name goes in content
    requiredComponents: ["Agent", "Inventory"],
    targetComponents: ["Inventory"],
    systemRequirements: ["inventory"],
  },
  examine: {
    name: "examine",
    description: "Examine something in detail",
    category: "cognitive",
    requiresTarget: true,
    requiresContent: false,
    requiredComponents: ["Agent", "Mind"],
  },
  rest: {
    name: "rest",
    description: "Rest to recover and reduce arousal",
    category: "utility",
    requiresTarget: false,
    requiresContent: false,
    requiredComponents: ["Agent", "Mind"],
  },
  craft: {
    name: "craft",
    description: "Craft an item from materials",
    category: "interaction",
    requiresTarget: false,
    requiresContent: true,
    requiredComponents: ["Agent", "Inventory"],
    systemRequirements: ["crafting"],
  },
  reflect: {
    name: "reflect",
    description: "Deep reflection on thoughts and experiences",
    category: "cognitive",
    requiresTarget: false,
    requiresContent: true,
    requiredComponents: ["Agent", "Mind"],
  },
};

/**
 * Get all available action names
 */
export function getAvailableActions(): string[] {
  return Object.keys(ACTION_REGISTRY);
}

/**
 * Get action definition by name
 */
export function getActionDefinition(actionName: string): ActionDefinition | undefined {
  return ACTION_REGISTRY[actionName.toLowerCase()];
}

/**
 * Check if an action is valid
 */
export function isValidAction(actionType: string): boolean {
  return actionType.toLowerCase() in ACTION_REGISTRY;
}

/**
 * Get actions by category
 */
export function getActionsByCategory(category: ActionDefinition["category"]): ActionDefinition[] {
  return Object.values(ACTION_REGISTRY).filter(a => a.category === category);
}

/**
 * Get actions requiring specific system
 */
export function getActionsRequiringSystem(systemName: string): ActionDefinition[] {
  return Object.values(ACTION_REGISTRY).filter(
    a => a.systemRequirements?.includes(systemName)
  );
}

// =============================================================================
// COMPONENT INTROSPECTION
// =============================================================================

export interface ComponentDefinition {
  name: string;
  description: string;
  category: "identity" | "spatial" | "cognitive" | "combat" | "inventory" | "needs" | "object" | "visual" | "relation";
  fields: string[];
  isRelation: boolean;
}

/**
 * Registry of all ECS components with metadata
 */
export const COMPONENT_REGISTRY: Record<string, ComponentDefinition> = {
  // Identity
  Name: { name: "Name", description: "Entity name", category: "identity", fields: ["value"], isRelation: false },
  Description: { name: "Description", description: "Entity description", category: "identity", fields: ["value"], isRelation: false },

  // Spatial
  Position: { name: "Position", description: "3D position", category: "spatial", fields: ["x", "y", "z"], isRelation: false },
  GridPosition: { name: "GridPosition", description: "Grid-based position", category: "spatial", fields: ["x", "y", "facing"], isRelation: false },
  Room: { name: "Room", description: "Room properties", category: "spatial", fields: ["capacity", "ambience"], isRelation: false },

  // Cognitive
  Agent: { name: "Agent", description: "Agent properties", category: "cognitive", fields: ["role", "systemPrompt", "active"], isRelation: false },
  Mind: { name: "Mind", description: "Mental state", category: "cognitive", fields: ["mode", "arousal", "focus", "lastUpdate"], isRelation: false },
  Personality: { name: "Personality", description: "OCEAN personality traits", category: "cognitive", fields: ["openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"], isRelation: false },
  Thought: { name: "Thought", description: "A thought entity", category: "cognitive", fields: ["content", "type", "salience", "timestamp"], isRelation: false },
  Memory: { name: "Memory", description: "A memory entity", category: "cognitive", fields: ["type", "content", "emotionalValence", "importance", "timestamp", "lastRecalled", "recallCount"], isRelation: false },
  Belief: { name: "Belief", description: "A belief entity", category: "cognitive", fields: ["subject", "predicate", "object", "confidence", "source", "timestamp"], isRelation: false },
  Goal: { name: "Goal", description: "A goal entity", category: "cognitive", fields: ["description", "priority", "status", "progress", "deadline"], isRelation: false },

  // Combat
  Health: { name: "Health", description: "Health for living entities", category: "combat", fields: ["current", "max", "regenRate", "lastDamage"], isRelation: false },
  CombatStats: { name: "CombatStats", description: "Combat capabilities", category: "combat", fields: ["attack", "defense", "speed", "accuracy"], isRelation: false },
  InCombat: { name: "InCombat", description: "Currently in combat", category: "combat", fields: ["targetEid", "stance", "lastAction"], isRelation: false },
  StatusEffect: { name: "StatusEffect", description: "Status effects", category: "combat", fields: ["effectType", "duration", "intensity", "source"], isRelation: false },

  // Inventory
  Inventory: { name: "Inventory", description: "Inventory capacity", category: "inventory", fields: ["items", "maxSlots", "weight", "maxWeight"], isRelation: false },
  Item: { name: "Item", description: "Item properties", category: "inventory", fields: ["stackable", "quantity", "maxStack", "weight", "category"], isRelation: false },
  EquipSlot: { name: "EquipSlot", description: "Equipment slot", category: "inventory", fields: ["slot", "equippedBy"], isRelation: false },

  // Needs
  Needs: { name: "Needs", description: "Basic needs", category: "needs", fields: ["hunger", "energy", "social", "comfort"], isRelation: false },
  Interactable: { name: "Interactable", description: "Can be interacted with", category: "object", fields: ["action", "targetNeed", "effectAmount", "cooldown", "lastUsed"], isRelation: false },

  // Object system
  ObjectType: { name: "ObjectType", description: "Object type definition", category: "object", fields: ["typeId", "instanceName"], isRelation: false },
  ObjectState: { name: "ObjectState", description: "Object state", category: "object", fields: ["current", "previous", "lockedUntil"], isRelation: false },
  Traits: { name: "Traits", description: "Object traits", category: "object", fields: ["active"], isRelation: false },
  Durability: { name: "Durability", description: "Object durability", category: "object", fields: ["current", "max"], isRelation: false },
  Fuel: { name: "Fuel", description: "Fuel for burnables", category: "object", fields: ["current", "max", "burnRate"], isRelation: false },
  Container: { name: "Container", description: "Container properties", category: "object", fields: ["capacity", "currentCount", "allowedTypes"], isRelation: false },
  LightSource: { name: "LightSource", description: "Light source", category: "object", fields: ["intensity", "radius", "color"], isRelation: false },

  // Visual
  Sprite: { name: "Sprite", description: "Character sprite", category: "visual", fields: ["char", "color", "bgColor", "zIndex"], isRelation: false },
  Visual: { name: "Visual", description: "Visual representation", category: "visual", fields: ["shape", "color", "size", "label", "opacity", "glow", "pulseRate"], isRelation: false },
};

/**
 * Get all component names
 */
export function getAvailableComponents(): string[] {
  return Object.keys(COMPONENT_REGISTRY);
}

/**
 * Get component definition
 */
export function getComponentDefinition(name: string): ComponentDefinition | undefined {
  return COMPONENT_REGISTRY[name];
}

/**
 * Get components by category
 */
export function getComponentsByCategory(category: ComponentDefinition["category"]): ComponentDefinition[] {
  return Object.values(COMPONENT_REGISTRY).filter(c => c.category === category);
}

// =============================================================================
// SYSTEM INTROSPECTION
// =============================================================================

export interface SystemSummary {
  name: string;
  description: string;
  frequency: number;
  active: boolean;
  lastRun: number;
  pseudocode?: string;
}

/**
 * Get summaries of all registered systems
 */
export function getSystemSummaries(registry: SystemRegistry): SystemSummary[] {
  const systems = listSystems(registry);
  return systems.map(s => ({
    name: s.name,
    description: s.description,
    frequency: s.frequency,
    active: s.active,
    lastRun: s.lastRun,
    pseudocode: s.pseudocode,
  }));
}

/**
 * Get full system definition by name
 */
export function getSystemByName(registry: SystemRegistry, name: string): SystemDefinition | undefined {
  const systems = listSystems(registry);
  return systems.find(s => s.name === name);
}

// =============================================================================
// ROLLING EVENT BUFFER
// =============================================================================

export interface BufferedEvent {
  id: string;
  type: string;
  data: any;
  timestamp: number;
  source?: string;
  target?: string;
}

export interface RollingEventBuffer {
  events: BufferedEvent[];
  maxSize: number;
  eventCounts: Map<string, number>;
  lastPruneTime: number;
}

let eventIdCounter = 0;

/**
 * Create a new rolling event buffer
 */
export function createRollingEventBuffer(maxSize: number = 500): RollingEventBuffer {
  return {
    events: [],
    maxSize,
    eventCounts: new Map(),
    lastPruneTime: Date.now(),
  };
}

/**
 * Add event to buffer
 */
export function addToBuffer(buffer: RollingEventBuffer, event: Omit<BufferedEvent, "id">): void {
  const bufferedEvent: BufferedEvent = {
    ...event,
    id: `evt_${++eventIdCounter}`,
  };

  buffer.events.push(bufferedEvent);

  // Track event type counts
  const count = buffer.eventCounts.get(event.type) || 0;
  buffer.eventCounts.set(event.type, count + 1);

  // Prune if over max size
  while (buffer.events.length > buffer.maxSize) {
    const removed = buffer.events.shift();
    if (removed) {
      const oldCount = buffer.eventCounts.get(removed.type) || 0;
      buffer.eventCounts.set(removed.type, Math.max(0, oldCount - 1));
    }
  }
}

/**
 * Get events from buffer within time window
 */
export function getEventsInWindow(buffer: RollingEventBuffer, windowMs: number): BufferedEvent[] {
  const cutoff = Date.now() - windowMs;
  return buffer.events.filter(e => e.timestamp > cutoff);
}

/**
 * Get events by type
 */
export function getEventsByType(buffer: RollingEventBuffer, type: string): BufferedEvent[] {
  return buffer.events.filter(e => e.type === type);
}

/**
 * Get event frequency analysis
 */
export function getEventFrequencies(buffer: RollingEventBuffer): Array<{ type: string; count: number; frequency: number }> {
  const oldestEvent = buffer.events[0];
  const newestEvent = buffer.events[buffer.events.length - 1];

  if (!oldestEvent || !newestEvent) {
    return [];
  }

  const timeSpan = newestEvent.timestamp - oldestEvent.timestamp;
  const timeSpanSeconds = Math.max(1, timeSpan / 1000);

  return Array.from(buffer.eventCounts.entries())
    .map(([type, count]) => ({
      type,
      count,
      frequency: count / timeSpanSeconds, // events per second
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Detect repeated patterns in events
 */
export function detectPatterns(buffer: RollingEventBuffer): Array<{ pattern: string; count: number; significance: string }> {
  const patterns: Array<{ pattern: string; count: number; significance: string }> = [];

  // Look for rapid repetition (same event type in quick succession)
  const recentEvents = getEventsInWindow(buffer, 5000);
  const typeCounts = new Map<string, number>();
  for (const event of recentEvents) {
    typeCounts.set(event.type, (typeCounts.get(event.type) || 0) + 1);
  }

  for (const [type, count] of typeCounts) {
    if (count > 10) {
      patterns.push({
        pattern: `rapid_${type}`,
        count,
        significance: "high_frequency",
      });
    }
  }

  // Look for action failures
  const failures = recentEvents.filter(e => e.type === "action_failed");
  if (failures.length > 3) {
    patterns.push({
      pattern: "frequent_failures",
      count: failures.length,
      significance: "system_issue",
    });
  }

  // Look for consistency issues
  const issues = recentEvents.filter(e => e.type === "consistency_issue");
  if (issues.length > 2) {
    patterns.push({
      pattern: "consistency_drift",
      count: issues.length,
      significance: "requires_attention",
    });
  }

  return patterns;
}

// =============================================================================
// ENTITY INTROSPECTION
// =============================================================================

export interface EntitySnapshot {
  eid: number;
  name: string;
  description?: string;
  components: string[];
  position?: { x: number; y: number };
  room?: string;
  isAgent: boolean;
  isActive?: boolean;
}

/**
 * Get snapshot of all entities
 */
export function getEntitySnapshots(world: World): EntitySnapshot[] {
  const snapshots: EntitySnapshot[] = [];

  // Get all agents
  const agents = Array.from(query(world, [Agent]));
  for (const eid of agents) {
    if (!entityExists(world, eid)) continue;

    const components: string[] = ["Agent"];
    if (hasComponent(world, eid, AllComponents.Mind)) components.push("Mind");
    if (hasComponent(world, eid, AllComponents.Personality)) components.push("Personality");
    if (hasComponent(world, eid, AllComponents.Inventory)) components.push("Inventory");
    if (hasComponent(world, eid, AllComponents.Health)) components.push("Health");
    if (hasComponent(world, eid, AllComponents.GridPosition)) components.push("GridPosition");

    const rooms = safeGetRelationTargets(world, eid, OccupiesRoom);
    const roomName = rooms.length > 0 ? Name.value[rooms[0]] : undefined;

    snapshots.push({
      eid,
      name: Name.value[eid] || `Entity_${eid}`,
      description: Description.value[eid],
      components,
      position: GridPosition.x[eid] !== undefined ? { x: GridPosition.x[eid], y: GridPosition.y[eid] } : undefined,
      room: roomName,
      isAgent: true,
      isActive: Agent.active[eid],
    });
  }

  // Get rooms
  const rooms = Array.from(query(world, [Room]));
  for (const eid of rooms) {
    if (!entityExists(world, eid)) continue;

    snapshots.push({
      eid,
      name: Name.value[eid] || `Room_${eid}`,
      description: Description.value[eid],
      components: ["Room"],
      isAgent: false,
    });
  }

  return snapshots;
}

/**
 * Get detailed introspection for a specific entity
 */
export function getEntityDetails(world: World, eid: number): Record<string, any> | null {
  if (!entityExists(world, eid)) return null;

  const details: Record<string, any> = {
    eid,
    name: Name.value[eid],
    description: Description.value[eid],
    components: {},
  };

  // Check each component and get values
  for (const [compName, component] of Object.entries(AllComponents)) {
    if (hasComponent(world, eid, component)) {
      const values: Record<string, any> = {};
      for (const [fieldName, fieldArray] of Object.entries(component)) {
        if (Array.isArray(fieldArray)) {
          values[fieldName] = fieldArray[eid];
        }
      }
      if (Object.keys(values).length > 0) {
        details.components[compName] = values;
      } else {
        details.components[compName] = true; // Tag component
      }
    }
  }

  return details;
}

// =============================================================================
// FULL INTROSPECTION CONTEXT
// =============================================================================

export interface IntrospectionContext {
  // Actions
  availableActions: ActionDefinition[];
  actionCount: number;

  // Components
  availableComponents: ComponentDefinition[];
  componentCount: number;

  // Systems
  systems: SystemSummary[];
  activeSystems: number;

  // Entities
  entities: EntitySnapshot[];
  agentCount: number;
  activeAgentCount: number;
  roomCount: number;

  // Event buffer
  recentEvents: BufferedEvent[];
  eventFrequencies: Array<{ type: string; count: number; frequency: number }>;
  detectedPatterns: Array<{ pattern: string; count: number; significance: string }>;

  // Meta
  timestamp: number;
  worldTick?: number;
}

/**
 * Get full introspection context for spirits
 */
export function getIntrospectionContext(
  world: World,
  registry: SystemRegistry,
  eventBuffer: RollingEventBuffer,
  tick?: number
): IntrospectionContext {
  const entities = getEntitySnapshots(world);
  const agents = entities.filter(e => e.isAgent);
  const rooms = entities.filter(e => e.components.includes("Room"));

  return {
    // Actions
    availableActions: Object.values(ACTION_REGISTRY),
    actionCount: Object.keys(ACTION_REGISTRY).length,

    // Components
    availableComponents: Object.values(COMPONENT_REGISTRY),
    componentCount: Object.keys(COMPONENT_REGISTRY).length,

    // Systems
    systems: getSystemSummaries(registry),
    activeSystems: getSystemSummaries(registry).filter(s => s.active).length,

    // Entities
    entities,
    agentCount: agents.length,
    activeAgentCount: agents.filter(a => a.isActive).length,
    roomCount: rooms.length,

    // Event buffer
    recentEvents: getEventsInWindow(eventBuffer, 30000), // Last 30 seconds
    eventFrequencies: getEventFrequencies(eventBuffer),
    detectedPatterns: detectPatterns(eventBuffer),

    // Meta
    timestamp: Date.now(),
    worldTick: tick,
  };
}
