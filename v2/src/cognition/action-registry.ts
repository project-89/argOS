/**
 * Action Registry - Dynamic Action/Affordance System
 *
 * This system allows:
 * 1. Systems to register actions they provide
 * 2. Components to register affordances they enable
 * 3. Objects to expose their affordances
 * 4. Dynamic prompt generation based on actual capabilities
 *
 * This ensures the AI only tries to do things that are actually possible,
 * and automatically learns about new capabilities as systems are added.
 */

import type { World } from "../ecs/world";
import { query, hasComponent, getRelationTargets } from "bitecs";
import {
  Agent, Name, Room, Needs, Health, Inventory, Mind, Description,
  CombatStats, InCombat, StimulusSource, Item, Appearance
} from "../ecs/components";
import { OccupiesRoom, Contains } from "../ecs/relations";
import { worldSchema } from "../world/schema";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface ActionDefinition {
  name: string;                    // Action type (e.g., "move", "attack", "eat")
  description: string;             // Human-readable description for AI
  requiresTarget: boolean;         // Does this action need a target?
  requiresContent: boolean;        // Does this action need content/details?
  targetTypes?: string[];          // What can be targeted? ["room", "agent", "object", "any"]
  examples?: string[];             // Example usages for AI
  enabledBy?: string[];            // Components that enable this action
  category: "movement" | "social" | "combat" | "interaction" | "self" | "inventory";
}

export interface AffordanceInstance {
  action: string;                  // Action to perform
  target: string;                  // Target name
  description: string;             // What this specific affordance does
  priority?: number;               // Suggested priority (higher = more relevant)
}

export interface AvailableActionsContext {
  coreActions: ActionDefinition[];           // Always available actions
  componentActions: ActionDefinition[];      // Actions enabled by agent's components
  locationAffordances: AffordanceInstance[]; // Things you can do in current location
  objectAffordances: AffordanceInstance[];   // Things you can do with nearby objects
  socialAffordances: AffordanceInstance[];   // Things you can do with nearby agents
  availableLocations: string[];              // Places you can move to
}

// =============================================================================
// ACTION REGISTRY
// =============================================================================

class ActionRegistryClass {
  private coreActions: Map<string, ActionDefinition> = new Map();
  private componentActions: Map<string, ActionDefinition[]> = new Map();
  private systemActions: Map<string, ActionDefinition[]> = new Map();

  constructor() {
    this.registerCoreActions();
  }

  /**
   * Register core actions that are always available
   */
  private registerCoreActions(): void {
    // Movement
    this.coreActions.set("move", {
      name: "move",
      description: "Go to a different location",
      requiresTarget: true,
      requiresContent: false,
      targetTypes: ["room"],
      examples: ["move to Tavern", "move to Market Square"],
      category: "movement",
    });

    // Social
    this.coreActions.set("speak", {
      name: "speak",
      description: "Say something out loud that others can hear",
      requiresTarget: false,
      requiresContent: true,
      examples: ["speak: Hello everyone!", "speak: What a lovely day"],
      category: "social",
    });

    this.coreActions.set("observe", {
      name: "observe",
      description: "Pay close attention to someone or something",
      requiresTarget: true,
      requiresContent: false,
      targetTypes: ["agent", "object", "any"],
      examples: ["observe the stranger", "observe the locked door"],
      category: "social",
    });

    // Self
    this.coreActions.set("think", {
      name: "think",
      description: "Have an internal thought (not spoken aloud)",
      requiresTarget: false,
      requiresContent: true,
      examples: ["think: I wonder what they meant by that..."],
      category: "self",
    });

    this.coreActions.set("wait", {
      name: "wait",
      description: "Do nothing, just exist in the moment",
      requiresTarget: false,
      requiresContent: false,
      category: "self",
    });

    this.coreActions.set("rest", {
      name: "rest",
      description: "Take a moment to rest and recover energy",
      requiresTarget: false,
      requiresContent: false,
      category: "self",
    });

    this.coreActions.set("reflect", {
      name: "reflect",
      description: "Deeply contemplate recent events or decisions",
      requiresTarget: false,
      requiresContent: true,
      category: "self",
    });
  }

  /**
   * Register actions that are enabled by specific components
   */
  registerComponentAction(componentName: string, action: ActionDefinition): void {
    if (!this.componentActions.has(componentName)) {
      this.componentActions.set(componentName, []);
    }
    this.componentActions.get(componentName)!.push(action);
  }

  /**
   * Register actions provided by a system
   */
  registerSystemActions(systemName: string, actions: ActionDefinition[]): void {
    this.systemActions.set(systemName, actions);
  }

  /**
   * Get all core actions
   */
  getCoreActions(): ActionDefinition[] {
    return Array.from(this.coreActions.values());
  }

  /**
   * Get actions enabled by a specific component
   */
  getComponentActions(componentName: string): ActionDefinition[] {
    return this.componentActions.get(componentName) || [];
  }

  /**
   * Get actions provided by a specific system
   */
  getSystemActions(systemName: string): ActionDefinition[] {
    return this.systemActions.get(systemName) || [];
  }

  /**
   * Get all registered actions
   */
  getAllActions(): ActionDefinition[] {
    const all: ActionDefinition[] = [...this.coreActions.values()];
    for (const actions of this.componentActions.values()) {
      all.push(...actions);
    }
    for (const actions of this.systemActions.values()) {
      all.push(...actions);
    }
    return all;
  }
}

// Singleton instance
export const ActionRegistry = new ActionRegistryClass();

// =============================================================================
// REGISTER COMPONENT-BASED ACTIONS
// =============================================================================

// Health/Combat actions
ActionRegistry.registerComponentAction("Health", {
  name: "attack",
  description: "Attack a target in combat",
  requiresTarget: true,
  requiresContent: false,
  targetTypes: ["agent"],
  examples: ["attack the goblin", "attack Marcus"],
  enabledBy: ["Health", "CombatStats"],
  category: "combat",
});

ActionRegistry.registerComponentAction("Health", {
  name: "defend",
  description: "Take a defensive stance",
  requiresTarget: false,
  requiresContent: false,
  enabledBy: ["Health", "CombatStats"],
  category: "combat",
});

// Inventory actions
ActionRegistry.registerComponentAction("Inventory", {
  name: "pickup",
  description: "Pick up an item from the ground",
  requiresTarget: true,
  requiresContent: false,
  targetTypes: ["object"],
  examples: ["pickup the sword", "pickup gold coins"],
  enabledBy: ["Inventory"],
  category: "inventory",
});

ActionRegistry.registerComponentAction("Inventory", {
  name: "drop",
  description: "Drop an item from your inventory",
  requiresTarget: true,
  requiresContent: false,
  targetTypes: ["object"],
  examples: ["drop the torch", "drop old boots"],
  enabledBy: ["Inventory"],
  category: "inventory",
});

ActionRegistry.registerComponentAction("Inventory", {
  name: "use",
  description: "Use an item from your inventory",
  requiresTarget: true,
  requiresContent: false,
  targetTypes: ["object"],
  examples: ["use health potion", "use key"],
  enabledBy: ["Inventory"],
  category: "inventory",
});

ActionRegistry.registerComponentAction("Inventory", {
  name: "give",
  description: "Give an item to someone",
  requiresTarget: true,
  requiresContent: true,  // content = item name
  targetTypes: ["agent"],
  examples: ["give bread to the beggar", "give gold to Marcus"],
  enabledBy: ["Inventory"],
  category: "inventory",
});

ActionRegistry.registerComponentAction("Inventory", {
  name: "examine",
  description: "Closely examine an item or object",
  requiresTarget: true,
  requiresContent: false,
  targetTypes: ["object", "any"],
  examples: ["examine the ancient scroll", "examine the locked chest"],
  enabledBy: ["Inventory"],
  category: "interaction",
});

// Needs-based actions are implicit through movement goals
// (the AI should understand they need to go somewhere to satisfy needs)

// =============================================================================
// DYNAMIC CONTEXT BUILDER
// =============================================================================

/**
 * Build the complete available actions context for an agent
 */
export function buildAvailableActionsContext(
  world: World,
  agentEid: number
): AvailableActionsContext {
  const context: AvailableActionsContext = {
    coreActions: ActionRegistry.getCoreActions(),
    componentActions: [],
    locationAffordances: [],
    objectAffordances: [],
    socialAffordances: [],
    availableLocations: [],
  };

  // 1. Get component-based actions
  context.componentActions = getComponentBasedActions(world, agentEid);

  // 2. Get available locations
  context.availableLocations = getAvailableLocations(world, agentEid);

  // 3. Get current room context
  const roomTargets = getRelationTargets(world, agentEid, OccupiesRoom);
  if (roomTargets.length > 0) {
    const roomEid = roomTargets[0];

    // Location-specific affordances
    context.locationAffordances = getLocationAffordances(world, roomEid);

    // Object affordances in the room
    context.objectAffordances = getObjectAffordances(world, agentEid, roomEid);

    // Social affordances with other agents
    context.socialAffordances = getSocialAffordances(world, agentEid, roomEid);
  }

  return context;
}

/**
 * Get actions enabled by the agent's components
 */
function getComponentBasedActions(world: World, agentEid: number): ActionDefinition[] {
  const actions: ActionDefinition[] = [];

  // Check for Health component
  if (hasComponent(world, agentEid, Health) && Health.max[agentEid] > 0) {
    actions.push(...ActionRegistry.getComponentActions("Health"));
  }

  // Check for Inventory component
  if (hasComponent(world, agentEid, Inventory)) {
    actions.push(...ActionRegistry.getComponentActions("Inventory"));
  }

  // Check for Needs component - add need-awareness
  if (hasComponent(world, agentEid, Needs)) {
    const hunger = Needs.hunger[agentEid] || 0;
    const energy = Needs.energy[agentEid] || 1;
    const social = Needs.social[agentEid] || 0.5;

    // These aren't actions per se, but the AI should know about them
    // We'll handle this in the prompt formatting
  }

  return actions;
}

/**
 * Get all available locations the agent can move to
 */
function getAvailableLocations(world: World, agentEid: number): string[] {
  const locations: string[] = [];
  const currentRooms = getRelationTargets(world, agentEid, OccupiesRoom);
  const currentRoomEid = currentRooms[0];

  // Get all rooms in the world
  const allRooms = Array.from(query(world, [Room]));

  for (const roomEid of allRooms) {
    const roomName = Name.value[roomEid];
    if (roomName && roomEid !== currentRoomEid) {
      locations.push(roomName);
    }
  }

  return locations;
}

/**
 * Get affordances specific to the current location
 */
function getLocationAffordances(world: World, roomEid: number): AffordanceInstance[] {
  const affordances: AffordanceInstance[] = [];
  const roomName = Name.value[roomEid] || "this place";
  const roomNameLower = roomName.toLowerCase();

  // Location-based implicit affordances
  if (roomNameLower.includes("tavern") || roomNameLower.includes("inn")) {
    affordances.push({
      action: "interact",
      target: "bar",
      description: "Order food or drink to satisfy hunger",
      priority: 5,
    });
    affordances.push({
      action: "interact",
      target: "innkeeper",
      description: "Rent a room to rest and restore energy",
      priority: 4,
    });
  }

  if (roomNameLower.includes("market") || roomNameLower.includes("shop")) {
    affordances.push({
      action: "interact",
      target: "merchant",
      description: "Buy or sell goods",
      priority: 5,
    });
  }

  if (roomNameLower.includes("temple") || roomNameLower.includes("shrine")) {
    affordances.push({
      action: "interact",
      target: "altar",
      description: "Pray or meditate for spiritual comfort",
      priority: 4,
    });
  }

  if (roomNameLower.includes("library") || roomNameLower.includes("study")) {
    affordances.push({
      action: "interact",
      target: "books",
      description: "Read and study to gain knowledge",
      priority: 5,
    });
  }

  if (roomNameLower.includes("forge") || roomNameLower.includes("smithy")) {
    affordances.push({
      action: "interact",
      target: "forge",
      description: "Craft or repair equipment",
      priority: 5,
    });
  }

  if (roomNameLower.includes("home") || roomNameLower.includes("bedroom")) {
    affordances.push({
      action: "rest",
      target: roomName,
      description: "Rest to restore energy",
      priority: 6,
    });
  }

  return affordances;
}

/**
 * Get affordances from objects in the room
 */
function getObjectAffordances(
  world: World,
  agentEid: number,
  roomEid: number
): AffordanceInstance[] {
  const affordances: AffordanceInstance[] = [];

  // Get objects in room via Contains relation
  const contents = getRelationTargets(world, roomEid, Contains);

  for (const objectEid of contents) {
    // Skip agents
    if (hasComponent(world, objectEid, Agent)) continue;

    const objectName = Name.value[objectEid];
    if (!objectName) continue;

    // Check WorldSchema for registered affordances
    const schemaAffordances = worldSchema.getAllAffordances();
    for (const affordance of schemaAffordances) {
      // Check if this affordance applies to this object
      // (simplified check - could be more sophisticated)
      affordances.push({
        action: "interact",
        target: objectName,
        description: `${affordance.name} the ${objectName}`,
        priority: 3,
      });
    }

    // Check if it's a pickupable item
    if (hasComponent(world, objectEid, Item)) {
      affordances.push({
        action: "pickup",
        target: objectName,
        description: `Pick up the ${objectName}`,
        priority: 4,
      });
    }

    // Check if it has a stimulus source (observable)
    if (hasComponent(world, objectEid, StimulusSource)) {
      affordances.push({
        action: "observe",
        target: objectName,
        description: `Examine the ${objectName} more closely`,
        priority: 2,
      });
    }
  }

  return affordances;
}

/**
 * Get social affordances with other agents in the room
 */
function getSocialAffordances(
  world: World,
  agentEid: number,
  roomEid: number
): AffordanceInstance[] {
  const affordances: AffordanceInstance[] = [];

  // Find other agents in the room
  const allAgents = Array.from(query(world, [Agent]));

  for (const otherEid of allAgents) {
    if (otherEid === agentEid) continue;

    const otherRooms = getRelationTargets(world, otherEid, OccupiesRoom);
    if (!otherRooms.includes(roomEid)) continue;

    const otherName = Name.value[otherEid];
    if (!otherName) continue;

    // Basic social affordances
    affordances.push({
      action: "speak",
      target: otherName,
      description: `Talk to ${otherName}`,
      priority: 5,
    });

    affordances.push({
      action: "observe",
      target: otherName,
      description: `Watch what ${otherName} is doing`,
      priority: 3,
    });

    // Check if they have inventory (can give items to them)
    if (hasComponent(world, otherEid, Inventory) && hasComponent(world, agentEid, Inventory)) {
      affordances.push({
        action: "give",
        target: otherName,
        description: `Give an item to ${otherName}`,
        priority: 2,
      });
    }

    // Combat affordances (if both have health)
    if (hasComponent(world, otherEid, Health) && hasComponent(world, agentEid, Health)) {
      affordances.push({
        action: "attack",
        target: otherName,
        description: `Attack ${otherName}`,
        priority: 1, // Low priority - don't encourage random violence
      });
    }
  }

  return affordances;
}

// =============================================================================
// PROMPT FORMATTING
// =============================================================================

/**
 * Format the available actions context for the AI prompt
 */
export function formatActionsForPrompt(
  world: World,
  agentEid: number
): string {
  const context = buildAvailableActionsContext(world, agentEid);
  const lines: string[] = [];

  // Core actions (always available)
  lines.push("AVAILABLE ACTIONS:");
  lines.push("");

  // Group actions by category
  const allActions = [...context.coreActions, ...context.componentActions];
  const byCategory = new Map<string, ActionDefinition[]>();

  for (const action of allActions) {
    if (!byCategory.has(action.category)) {
      byCategory.set(action.category, []);
    }
    byCategory.get(action.category)!.push(action);
  }

  // Format by category
  const categoryOrder = ["movement", "social", "self", "inventory", "combat", "interaction"];
  for (const category of categoryOrder) {
    const actions = byCategory.get(category);
    if (!actions || actions.length === 0) continue;

    lines.push(`${category.toUpperCase()}:`);
    for (const action of actions) {
      const targetNote = action.requiresTarget ? " (requires target)" : "";
      const contentNote = action.requiresContent ? " (requires content)" : "";
      lines.push(`  - ${action.name}: ${action.description}${targetNote}${contentNote}`);
    }
    lines.push("");
  }

  // Available locations
  if (context.availableLocations.length > 0) {
    lines.push("PLACES YOU CAN GO:");
    lines.push(`  ${context.availableLocations.join(", ")}`);
    lines.push("");
  }

  // Current location affordances
  if (context.locationAffordances.length > 0) {
    lines.push("THINGS YOU CAN DO HERE:");
    for (const aff of context.locationAffordances) {
      lines.push(`  - ${aff.description}`);
    }
    lines.push("");
  }

  // Object affordances
  if (context.objectAffordances.length > 0) {
    lines.push("OBJECTS YOU CAN INTERACT WITH:");
    const uniqueObjects = new Map<string, AffordanceInstance[]>();
    for (const aff of context.objectAffordances) {
      if (!uniqueObjects.has(aff.target)) {
        uniqueObjects.set(aff.target, []);
      }
      uniqueObjects.get(aff.target)!.push(aff);
    }
    for (const [target, affs] of uniqueObjects) {
      const actions = affs.map(a => a.action).join(", ");
      lines.push(`  - ${target}: can ${actions}`);
    }
    lines.push("");
  }

  // Social affordances
  if (context.socialAffordances.length > 0) {
    lines.push("PEOPLE YOU CAN INTERACT WITH:");
    const uniquePeople = new Map<string, string[]>();
    for (const aff of context.socialAffordances) {
      if (!uniquePeople.has(aff.target)) {
        uniquePeople.set(aff.target, []);
      }
      uniquePeople.get(aff.target)!.push(aff.action);
    }
    for (const [person, actions] of uniquePeople) {
      lines.push(`  - ${person}: can ${[...new Set(actions)].join(", ")}`);
    }
    lines.push("");
  }

  // Agent's needs status (if they have Needs component)
  if (hasComponent(world, agentEid, Needs)) {
    const hunger = Needs.hunger[agentEid] || 0;
    const energy = Needs.energy[agentEid] || 1;
    const social = Needs.social[agentEid] || 0.5;

    lines.push("YOUR NEEDS:");
    lines.push(`  - Hunger: ${(hunger * 100).toFixed(0)}%${hunger > 0.7 ? " (CRITICAL - find food!)" : ""}`);
    lines.push(`  - Energy: ${(energy * 100).toFixed(0)}%${energy < 0.3 ? " (LOW - need rest!)" : ""}`);
    lines.push(`  - Social: ${(social * 100).toFixed(0)}%${social < 0.3 ? " (lonely - seek company!)" : ""}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get valid action types for JSON schema validation hint
 */
export function getValidActionTypes(world: World, agentEid: number): string[] {
  const context = buildAvailableActionsContext(world, agentEid);
  const allActions = [...context.coreActions, ...context.componentActions];
  return [...new Set(allActions.map(a => a.name))];
}
