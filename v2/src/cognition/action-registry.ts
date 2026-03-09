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
import { query, hasComponent } from "bitecs";
import {
  Agent, Name, Room, Needs, Health, Inventory, Mind, Description,
  CombatStats, InCombat, StimulusSource, Item, Appearance, Traits
} from "../ecs/components";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import { getAvailableAffordances } from "../world/affordance-availability";

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
  affordanceName?: string;         // For "interact": the concrete affordance name
  contentHint?: string;            // Suggested content string (e.g., "open", "eat the apple")
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

    this.coreActions.set("interact", {
      name: "interact",
      description: "Physically interact with a target using a specific affordance (content must start with the affordance name, e.g. \"open\", \"eat\", \"take\")",
      requiresTarget: true,
      requiresContent: true,
      targetTypes: ["agent", "object", "any"],
      examples: [
        "interact with Door: open",
        "interact with Apple: eat",
        "interact with Chest: unlock (if you have a key)",
      ],
      category: "interaction",
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
  const roomEid = getRoomForEntity(world, agentEid);
  if (roomEid !== undefined) {

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
    const energy = Needs.energy[agentEid] ?? 100;
    const social = Needs.social[agentEid] ?? 50;

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
  const currentRoomEid = getRoomForEntity(world, agentEid);

  // Get all rooms in the world
  const allRooms = Array.from(query(world, [Room]));

  for (const roomEid of allRooms) {
    const roomName = Name.value[roomEid];
    if (roomName && (currentRoomEid === undefined || roomEid !== currentRoomEid)) {
      locations.push(roomName);
    }
  }

  return locations;
}

/**
 * Get affordances specific to the current location
 */
function getLocationAffordances(world: World, roomEid: number): AffordanceInstance[] {
  // NOTE: "Location affordances" must be grounded in actual entities.
  // The previous implementation inferred conceptual targets ("merchant", "bar", etc.)
  // from room names, which encouraged hallucinated actions.
  //
  // For now we rely on object affordances in the room (and core/self actions).
  void world;
  void roomEid;
  return [];
}

/**
 * Get affordances from objects in the room
 */
function getTraitsArray(traitsJson: string | undefined): string[] {
  if (!traitsJson) return [];
  try {
    const traits = JSON.parse(traitsJson) as unknown;
    return Array.isArray(traits) ? (traits.filter((t) => typeof t === "string") as string[]) : [];
  } catch {
    return [];
  }
}

function hasTrait(world: World, eid: number, trait: string): boolean {
  if (!hasComponent(world, eid, Traits)) return false;
  const traits = getTraitsArray(Traits.active[eid]);
  return traits.includes(trait);
}

function getObjectAffordances(
  world: World,
  agentEid: number,
  roomEid: number
): AffordanceInstance[] {
  const affordances: AffordanceInstance[] = [];

  // Get objects directly located in the room (canonical containment)
  const contents = listDirectContents(world, roomEid);

  const MAX_AFFORDANCES_PER_OBJECT = 6;

  for (const objectEid of contents) {
    // Skip agents
    if (hasComponent(world, objectEid, Agent)) continue;

    const objectName = Name.value[objectEid];
    if (!objectName) continue;

    // Pickup suggestions should align with deterministic pickup grounding:
    // - requires actor inventory action availability
    // - requires target trait "takeable"
    if (hasComponent(world, agentEid, Inventory) && hasTrait(world, objectEid, "takeable")) {
      affordances.push({
        action: "pickup",
        target: objectName,
        description: `Pick up ${objectName}`,
        priority: 6,
      });
    }

    // Affordance-based interaction suggestions (worldSchema + canUseAffordance)
    const available = getAvailableAffordances(world, agentEid, objectEid);
    const filtered = available
      .map((a) => a.name)
      // Avoid double-teaching the same verb through multiple channels.
      // `examine` exists as a first-class action, so keep it out of "interact" suggestions.
      .filter((name) => name !== "examine")
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_AFFORDANCES_PER_OBJECT);

    for (const affordanceName of filtered) {
      affordances.push({
        action: "interact",
        target: objectName,
        affordanceName,
        contentHint: affordanceName,
        description: `Interact with ${objectName} using "${affordanceName}"`,
        priority: 4,
      });
    }

    // Optional: point out that some objects emit stimuli (useful observation targets).
    // We do NOT enumerate observe targets for every object to keep prompts compact.
    if (hasComponent(world, objectEid, StimulusSource)) {
      affordances.push({
        action: "observe",
        target: objectName,
        description: `Observe ${objectName}`,
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

    if (getRoomForEntity(world, otherEid) !== roomEid) continue;

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
      const pickups = affs.some((a) => a.action === "pickup");
      const observes = affs.some((a) => a.action === "observe");
      const interactNames = affs
        .filter((a) => a.action === "interact")
        .map((a) => a.affordanceName || a.contentHint)
        .filter((v): v is string => Boolean(v));

      const parts: string[] = [];
      if (pickups) parts.push("pickup");
      if (interactNames.length > 0) parts.push(`interact via: ${[...new Set(interactNames)].join(", ")}`);
      if (observes) parts.push("observe");

      lines.push(`  - ${target}: ${parts.join("; ")}`);
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
    const energy = Needs.energy[agentEid] ?? 100;
    const social = Needs.social[agentEid] ?? 50;

    lines.push("YOUR NEEDS:");
    lines.push(`  - Hunger: ${hunger.toFixed(0)}%${hunger >= 70 ? " (CRITICAL - find food!)" : ""}`);
    lines.push(`  - Energy: ${energy.toFixed(0)}%${energy <= 30 ? " (LOW - need rest!)" : ""}`);
    lines.push(`  - Social: ${social.toFixed(0)}%${social <= 30 ? " (lonely - seek company!)" : ""}`);
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
