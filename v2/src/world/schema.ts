/**
 * WorldSchema - The contract between hardcoded systems and GodAI
 *
 * This provides:
 * - Object type definitions (prefabs)
 * - Affordance definitions (what can be done to things)
 * - State transition rules
 * - The bridge between semantic descriptions and ECS entities
 */

import { createRelation } from "bitecs";

// ============================================================================
// RELATIONS - Spatial and ownership connections between entities
// ============================================================================

/** Entity is contained inside another (item in chest, object in room) */
export const ContainedIn = createRelation({ autoRemoveSubject: true });

/** Entity is on top of another (book on table, cat on bed) */
export const OnTopOf = createRelation();

/** Entity is occupied by another (bed occupied by sleeper) */
export const OccupiedBy = createRelation({ exclusive: true });

/** Entity is owned by another (farmer owns the barn) */
export const OwnedBy = createRelation();

/** Entity is adjacent to another (for spatial queries) */
export const AdjacentTo = createRelation();

// ============================================================================
// EFFECT SYSTEM - Real changes to ECS data (used by affordances AND rules)
// ============================================================================

export type EffectTarget = "actor" | "target" | "self" | "nearby" | string;

export interface ComponentModification {
  /** Component name */
  component: string;
  /** Property to modify */
  property: string;
  /** How to modify: "set", "add", "subtract", "multiply" */
  operation: "set" | "add" | "subtract" | "multiply";
  /** Value to use (can reference other properties with {component.property}) */
  value: number | string | boolean;
}

export interface EffectDefinition {
  /** What kind of effect */
  type:
    | "modify_component"   // Change component data
    | "set_state"          // Change ObjectMeta.state (recalculates traits)
    | "add_trait"          // Add a trait
    | "remove_trait"       // Remove a trait
    | "destroy"            // Remove entity from world
    | "spawn"              // Create a new entity
    | "emit_stimulus"      // Broadcast perception to nearby agents
    | "transfer"           // Move item to container/inventory
    | "add_relation"       // Create relation between entities
    | "remove_relation";   // Remove relation

  /** Who this effect applies to */
  target?: EffectTarget;

  /** For modify_component */
  modifications?: ComponentModification[];

  /** For set_state */
  state?: string;

  /** For add_trait/remove_trait */
  trait?: string;

  /** For spawn */
  spawnType?: string;
  spawnName?: string;
  spawnProperties?: Record<string, any>;

  /** For emit_stimulus */
  stimulusType?: string;
  stimulusContent?: string;
  stimulusRadius?: number;

  /** For transfer */
  containerName?: string;

  /** For add_relation/remove_relation */
  relation?: string;
  relatedEntity?: string;

  /** Chance to apply (0-1, default 1) */
  chance?: number;

  /** Condition for this effect */
  condition?: {
    /** Component.property to check */
    check?: string;
    /** Comparison operator */
    operator?: "==" | "!=" | ">" | "<" | ">=" | "<=";
    /** Value to compare against */
    value?: number | string | boolean;
  };
}

// ============================================================================
// AFFORDANCE DEFINITIONS - What actions can be performed on objects
// ============================================================================

export interface AffordanceDefinition {
  name: string;
  /** Traits the TARGET must have to allow this action */
  requires: string[];
  /** Traits that block this action */
  blockedBy?: string[];
  /** Traits the ACTOR must have (e.g., "hasKey" for unlock) */
  actorRequires?: string[];
  /** Duration in game ticks (0 = instant) */
  duration?: number;
  /** Effects that happen when this affordance is executed */
  effects?: EffectDefinition[];
  /** Description template for perception (shown to nearby agents) */
  descriptionTemplate?: string;
  /** Legacy: state transitions (converted to set_state effects) */
  transitions?: Record<string, string>;
}

// Pre-defined affordances with REAL effects (GodAI can add more)
export const BASE_AFFORDANCES: Record<string, AffordanceDefinition> = {
  examine: {
    name: "examine",
    requires: [],
    descriptionTemplate: "{actor.name} examines {target.name}.",
    // No effects - just observation
  },

  take: {
    name: "take",
    requires: ["takeable"],
    blockedBy: ["tooHeavy", "fixed"],
    descriptionTemplate: "{actor.name} picks up {target.name}.",
    effects: [
      { type: "add_trait", target: "target", trait: "held" },
      { type: "add_relation", target: "target", relation: "HeldBy", relatedEntity: "{actor}" },
      { type: "remove_trait", target: "target", trait: "takeable" },
    ],
  },

  drop: {
    name: "drop",
    requires: ["held"],
    descriptionTemplate: "{actor.name} drops {target.name}.",
    effects: [
      { type: "remove_trait", target: "target", trait: "held" },
      { type: "remove_relation", target: "target", relation: "HeldBy", relatedEntity: "{actor}" },
      { type: "add_trait", target: "target", trait: "takeable" },
    ],
  },

  open: {
    name: "open",
    requires: ["openable"],
    blockedBy: ["locked"],
    descriptionTemplate: "{actor.name} opens {target.name}.",
    effects: [
      { type: "set_state", target: "target", state: "open" },
    ],
  },

  close: {
    name: "close",
    requires: ["openable"],
    descriptionTemplate: "{actor.name} closes {target.name}.",
    effects: [
      { type: "set_state", target: "target", state: "closed" },
    ],
  },

  lock: {
    name: "lock",
    requires: ["lockable"],
    actorRequires: ["hasKey"],
    descriptionTemplate: "{actor.name} locks {target.name}.",
    effects: [
      { type: "set_state", target: "target", state: "locked" },
    ],
  },

  unlock: {
    name: "unlock",
    requires: ["lockable"],
    actorRequires: ["hasKey"],
    descriptionTemplate: "{actor.name} unlocks {target.name}.",
    effects: [
      { type: "set_state", target: "target", state: "closed" },
    ],
  },

  sit: {
    name: "sit",
    requires: ["sittable"],
    blockedBy: ["occupied"],
    descriptionTemplate: "{actor.name} sits on {target.name}.",
    effects: [
      { type: "set_state", target: "target", state: "occupied" },
      { type: "add_relation", target: "actor", relation: "SittingOn", relatedEntity: "{target}" },
    ],
  },

  sleep: {
    name: "sleep",
    requires: ["sleepable"],
    blockedBy: ["occupied"],
    duration: 480,
    descriptionTemplate: "{actor.name} lies down on {target.name} to sleep.",
    effects: [
      { type: "set_state", target: "target", state: "occupied" },
      { type: "add_relation", target: "actor", relation: "SleepingOn", relatedEntity: "{target}" },
      { type: "modify_component", target: "actor", modifications: [
        { component: "Needs", property: "energy", operation: "set", value: 100 },
      ]},
    ],
  },

  eat: {
    name: "eat",
    requires: ["edible"],
    descriptionTemplate: "{actor.name} eats {target.name}.",
    effects: [
      { type: "modify_component", target: "actor", modifications: [
        { component: "Needs", property: "hunger", operation: "subtract", value: 30 },
      ]},
      { type: "destroy", target: "target" },
    ],
  },

  drink: {
    name: "drink",
    requires: ["drinkable"],
    descriptionTemplate: "{actor.name} drinks from {target.name}.",
    effects: [
      { type: "modify_component", target: "actor", modifications: [
        { component: "Needs", property: "hunger", operation: "subtract", value: 10 },
      ]},
      { type: "set_state", target: "target", state: "empty" },
    ],
  },

  attack: {
    name: "attack",
    requires: ["attackable"],
    descriptionTemplate: "{actor.name} attacks {target.name}!",
    effects: [
      { type: "modify_component", target: "target", modifications: [
        { component: "Health", property: "current", operation: "subtract", value: 20 },
      ]},
      { type: "emit_stimulus", target: "nearby", stimulusType: "combat", stimulusContent: "{actor.name} attacks {target.name}!", stimulusRadius: 10 },
    ],
  },

  talk: {
    name: "talk",
    requires: ["talkable"],
    descriptionTemplate: "{actor.name} speaks to {target.name}.",
    effects: [
      { type: "emit_stimulus", target: "target", stimulusType: "speech", stimulusContent: "{actor.name} wants to talk to you." },
    ],
  },
};

// ============================================================================
// OBJECT TYPE DEFINITIONS - Prefabs for creating entities
// ============================================================================

/**
 * A stimulus emission that entities can produce for dynamic perception.
 * Agents perceive rooms through stimuli, not static descriptions.
 */
export interface StimulusDefinition {
  /** Type of sensory stimulus */
  type: "visual" | "smell" | "sound" | "heat" | "cold" | "tactile" | "light";
  /** What agents perceive - written as sensory description */
  template: string;
  /** How noticeable (0-1), affects perception priority. Default: 0.5 */
  intensity?: number;
  /** Emission interval in ms. Default: 5000 */
  interval?: number;
  /** How far the stimulus reaches in units. Default: 5 */
  radius?: number;
}

/**
 * Defines a state transition that can occur via affordance or event
 */
export interface StateTransition {
  from: string;
  to: string;
  /** What triggers this transition (affordance name or event type) */
  trigger: string;
  /** Optional conditions that must be met */
  conditions?: RuleCondition[];
  /** Stimuli emitted during the transition (e.g., sound when opening a door) */
  transitionStimuli?: StimulusDefinition[];
}

export interface StateDefinition {
  description: string;
  /** Traits active in this state */
  traits?: string[];
  /** Traits blocked in this state */
  blockedTraits?: string[];
  /** Sprite/visual key for this state */
  sprite?: string;
  /** DEPRECATED: Use stimuli array instead */
  emitsStimulus?: {
    type: string;
    intensity: number;
    radius: number;
  };
  /** Multiple stimuli this state emits - for rich multi-sensory perception */
  stimuli?: StimulusDefinition[];
}

export interface ComponentSpec {
  /** Component name - can be built-in (Name, Position, etc) or dynamic (custom) */
  name: string;
  /** Default values for component properties */
  values: Record<string, any>;
  /** If true, create as dynamic component if doesn't exist */
  dynamic?: boolean;
  /** Property types for dynamic component creation */
  schema?: Record<string, "number" | "string" | "boolean">;
}

export interface ObjectTypeDefinition {
  name: string;
  /** Base description template - can use {variable} placeholders */
  description: string;
  /** Base traits this object type has */
  traits: string[];
  /** Possible states and their definitions */
  states: Record<string, StateDefinition>;
  /** Default state when spawned */
  defaultState: string;
  /** State transitions - how states change in response to actions/events */
  transitions?: StateTransition[];
  /** Whether this can contain other objects */
  isContainer?: boolean;
  /** Container capacity if isContainer */
  containerCapacity?: number;
  /** Components to add when spawned - these are REAL ECS components for systems */
  defaultComponents?: ComponentSpec[];
  /** Category for organization */
  category?: string;
  /** Variable definitions for description template */
  variables?: Record<string, {
    type: "string" | "enum";
    default?: string;
    options?: string[]; // for enum type
  }>;
}

// Base object types (GodAI can add more)
export const BASE_OBJECT_TYPES: Record<string, ObjectTypeDefinition> = {
  bed: {
    name: "bed",
    description: "A {adjective} bed with a {material} frame",
    traits: ["sleepable", "examinable", "furniture"],
    states: {
      empty: {
        description: "The bed is neatly made and unoccupied.",
        traits: ["sleepable"],
      },
      occupied: {
        description: "Someone is sleeping in the bed.",
        blockedTraits: ["sleepable"],
      },
      messy: {
        description: "The sheets are rumpled and unmade.",
        traits: ["sleepable"],
      },
    },
    defaultState: "empty",
    category: "furniture",
  },

  chair: {
    name: "chair",
    description: "A {adjective} {material} chair",
    traits: ["sittable", "examinable", "furniture", "takeable"],
    states: {
      empty: {
        description: "The chair sits empty.",
        traits: ["sittable"],
      },
      occupied: {
        description: "Someone is sitting in the chair.",
        blockedTraits: ["sittable"],
      },
    },
    defaultState: "empty",
    category: "furniture",
  },

  table: {
    name: "table",
    description: "A {adjective} {material} table",
    traits: ["examinable", "furniture", "surface"],
    states: {
      normal: { description: "A sturdy table." },
    },
    defaultState: "normal",
    isContainer: true, // things can be placed on it
    containerCapacity: 10,
    category: "furniture",
  },

  chest: {
    name: "chest",
    description: "A {adjective} {material} chest",
    traits: ["openable", "examinable", "container", "lockable"],
    states: {
      closed: {
        description: "The chest is closed.",
        traits: ["openable"],
      },
      open: {
        description: "The chest stands open.",
        traits: ["container"],
      },
      locked: {
        description: "The chest is locked tight.",
        blockedTraits: ["openable"],
      },
    },
    defaultState: "closed",
    isContainer: true,
    containerCapacity: 20,
    category: "container",
  },

  door: {
    name: "door",
    description: "A {adjective} {material} door",
    traits: ["openable", "examinable", "lockable", "portal"],
    states: {
      closed: {
        description: "The door is closed.",
        traits: ["openable"],
      },
      open: {
        description: "The door stands open.",
        traits: ["passable"],
      },
      locked: {
        description: "The door is locked.",
        blockedTraits: ["openable", "passable"],
      },
    },
    defaultState: "closed",
    category: "structure",
  },

  torch: {
    name: "torch",
    description: "A torch mounted on the wall",
    traits: ["examinable", "lightSource", "lightable"],
    states: {
      lit: {
        description: "The torch burns brightly, casting flickering shadows.",
        emitsStimulus: { type: "light", intensity: 0.8, radius: 5 }, // legacy
        stimuli: [
          { type: "visual", template: "A torch burns on the wall, casting dancing shadows", intensity: 0.7 },
          { type: "light", template: "Warm flickering light illuminates the area", intensity: 0.8, radius: 5 },
          { type: "heat", template: "Gentle warmth radiates from the torch", intensity: 0.3, radius: 2 },
        ],
      },
      unlit: {
        description: "The torch is dark and cold.",
        stimuli: [
          { type: "visual", template: "An unlit torch hangs on the wall", intensity: 0.3 },
        ],
      },
    },
    transitions: [
      { from: "lit", to: "unlit", trigger: "extinguish" },
      { from: "unlit", to: "lit", trigger: "light" },
    ],
    defaultState: "lit",
    category: "lighting",
  },

  forge: {
    name: "forge",
    description: "A {material} forge for metalworking",
    traits: ["examinable", "workstation", "heatable", "lightSource"],
    states: {
      cold: {
        description: "The forge sits cold and dark.",
        stimuli: [
          { type: "visual", template: "A cold forge with dark coals sits ready", intensity: 0.4 },
        ],
      },
      lit: {
        description: "The forge burns with intense heat.",
        stimuli: [
          { type: "visual", template: "Glowing coals illuminate the forge with fierce orange light", intensity: 0.9 },
          { type: "heat", template: "Waves of intense heat radiate from the forge", intensity: 0.9, radius: 4 },
          { type: "light", template: "The forge casts a warm orange glow across the room", intensity: 0.7, radius: 6 },
          { type: "sound", template: "The fire crackles and roars in the forge", intensity: 0.6 },
        ],
      },
      roaring: {
        description: "The forge roars at maximum heat, ready for serious work.",
        stimuli: [
          { type: "visual", template: "The forge blazes white-hot, almost too bright to look at", intensity: 1.0 },
          { type: "heat", template: "Searing heat blasts from the roaring forge", intensity: 1.0, radius: 6 },
          { type: "sound", template: "The forge roars like a hungry beast", intensity: 0.9 },
        ],
      },
    },
    transitions: [
      { from: "cold", to: "lit", trigger: "light" },
      { from: "lit", to: "roaring", trigger: "stoke" },
      { from: "roaring", to: "lit", trigger: "dampen" },
      { from: "lit", to: "cold", trigger: "extinguish" },
    ],
    defaultState: "cold",
    defaultComponents: [
      { name: "Temperature", values: { current: 20, max: 1500 }, dynamic: true, schema: { current: "number", max: "number" } },
    ],
    category: "workstation",
    variables: {
      material: { type: "enum", default: "stone", options: ["stone", "brick", "iron"] },
    },
  },

  oven: {
    name: "oven",
    description: "A {material} oven for baking",
    traits: ["examinable", "workstation", "heatable"],
    states: {
      cold: {
        description: "The oven is cold and empty.",
        stimuli: [
          { type: "visual", template: "A cold oven with its door ajar", intensity: 0.3 },
        ],
      },
      heating: {
        description: "The oven is warming up.",
        stimuli: [
          { type: "visual", template: "Embers glow inside the oven as it heats up", intensity: 0.5 },
          { type: "heat", template: "Warmth begins to radiate from the oven", intensity: 0.4, radius: 2 },
        ],
      },
      hot: {
        description: "The oven is hot and ready for baking.",
        stimuli: [
          { type: "visual", template: "The oven glows with steady heat, ready for baking", intensity: 0.7 },
          { type: "heat", template: "Even heat radiates from the oven", intensity: 0.7, radius: 3 },
          { type: "smell", template: "The warm smell of heated stone wafts from the oven", intensity: 0.4 },
        ],
      },
      baking: {
        description: "Something is baking inside.",
        stimuli: [
          { type: "visual", template: "The oven glows warmly with something baking inside", intensity: 0.6 },
          { type: "heat", template: "Pleasant baking heat radiates from the oven", intensity: 0.6, radius: 3 },
          { type: "smell", template: "The delicious aroma of fresh baking fills the air", intensity: 0.9, radius: 8 },
        ],
      },
    },
    transitions: [
      { from: "cold", to: "heating", trigger: "light" },
      { from: "heating", to: "hot", trigger: "wait" },
      { from: "hot", to: "baking", trigger: "insert_food" },
      { from: "baking", to: "hot", trigger: "remove_food" },
      { from: "hot", to: "cold", trigger: "extinguish" },
    ],
    defaultState: "cold",
    category: "workstation",
  },

  food_item: {
    name: "food",
    description: "Some {adjective} {foodType}",
    traits: ["edible", "takeable", "examinable"],
    states: {
      fresh: {
        description: "It looks fresh and appetizing.",
        stimuli: [
          { type: "visual", template: "Fresh {foodType} sits here, looking appetizing", intensity: 0.5 },
          { type: "smell", template: "A pleasant aroma rises from the fresh {foodType}", intensity: 0.6 },
        ],
      },
      stale: {
        description: "It's a bit past its prime.",
        stimuli: [
          { type: "visual", template: "Slightly stale {foodType} sits here", intensity: 0.3 },
        ],
      },
      rotten: {
        description: "It has gone bad.",
        blockedTraits: ["edible"],
        stimuli: [
          { type: "visual", template: "Rotten {foodType} sits here, covered in mold", intensity: 0.4 },
          { type: "smell", template: "A foul stench rises from the rotten food", intensity: 0.8 },
        ],
      },
    },
    transitions: [
      { from: "fresh", to: "stale", trigger: "decay" },
      { from: "stale", to: "rotten", trigger: "decay" },
    ],
    defaultState: "fresh",
    category: "consumable",
    variables: {
      adjective: { type: "string", default: "fresh" },
      foodType: { type: "string", default: "bread" },
    },
  },

  npc: {
    name: "npc",
    description: "{name}, a {adjective} {role}",
    traits: ["talkable", "examinable", "attackable", "alive"],
    states: {
      idle: { description: "{name} stands here, looking around." },
      busy: { description: "{name} appears to be occupied with something." },
      sleeping: {
        description: "{name} is sleeping.",
        blockedTraits: ["talkable"],
      },
      dead: {
        description: "The lifeless body of {name} lies here.",
        blockedTraits: ["talkable", "alive"],
      },
    },
    defaultState: "idle",
    category: "creature",
  },

  room: {
    name: "room",
    description: "{name}",
    traits: ["container", "location"],
    states: {
      normal: { description: "{ambience}" },
      dark: {
        description: "It is pitch black. You cannot see anything.",
        emitsStimulus: { type: "darkness", intensity: 1, radius: 0 },
      },
      lit: { description: "{ambience}" },
    },
    defaultState: "normal",
    isContainer: true,
    containerCapacity: 100,
    category: "location",
  },
};

// ============================================================================
// RULE DEFINITIONS - Declarative behavior that systems interpret
// ============================================================================

export interface RuleCondition {
  /** Entity must have these traits */
  has?: string[];
  /** Entity must NOT have these traits */
  not?: string[];
  /** Entity must be in this state */
  inState?: string;
  /** Custom condition expression */
  expression?: string;
}

export interface RuleEffect {
  /** Action to perform */
  action: string;
  /** Target selector */
  target?: "self" | "source" | "nearby" | string;
  /** Query for nearby targets */
  query?: {
    radius?: number;
    has?: string[];
    not?: string[];
  };
  /** Parameters for the action */
  params?: Record<string, any>;
}

export interface RuleDefinition {
  name: string;
  description: string;
  /** When this rule triggers */
  when: {
    event: string;
    condition?: RuleCondition;
  };
  /** What happens when triggered */
  then: RuleEffect[];
  /** Priority (higher = runs first) */
  priority?: number;
  /** Is this rule active? */
  enabled?: boolean;
}

// Base rules (GodAI can add more)
export const BASE_RULES: RuleDefinition[] = [
  {
    name: "fire_spreads",
    description: "Fire spreads to nearby flammable objects",
    when: {
      event: "tick",
      condition: { has: ["burning"] },
    },
    then: [
      {
        action: "add_trait",
        target: "nearby",
        query: { radius: 1, has: ["flammable"], not: ["burning", "fireproof"] },
        params: { trait: "burning", chance: 0.3 },
      },
    ],
    priority: 10,
    enabled: true,
  },
  {
    name: "fire_damages",
    description: "Burning objects take damage over time",
    when: {
      event: "tick",
      condition: { has: ["burning"] },
    },
    then: [
      {
        action: "modify_value",
        target: "self",
        params: { component: "durability", field: "current", delta: -1 },
      },
    ],
    priority: 5,
    enabled: true,
  },
  {
    name: "destroyed_when_no_durability",
    description: "Objects are destroyed when durability reaches zero",
    when: {
      event: "value_change",
      condition: { expression: "durability.current <= 0" },
    },
    then: [
      {
        action: "transition_state",
        target: "self",
        params: { state: "destroyed" },
      },
      {
        action: "emit_event",
        params: { event: "object_destroyed", includeEntity: true },
      },
    ],
    priority: 100,
    enabled: true,
  },
  {
    name: "food_decays",
    description: "Food decays over time",
    when: {
      event: "tick",
      condition: { has: ["edible"], inState: "fresh" },
    },
    then: [
      {
        action: "transition_state",
        target: "self",
        params: { state: "stale", chance: 0.01 },
      },
    ],
    priority: 1,
    enabled: true,
  },
  {
    name: "torch_burns_out",
    description: "Torches eventually burn out",
    when: {
      event: "tick",
      condition: { has: ["lightSource"], inState: "lit" },
    },
    then: [
      {
        action: "modify_value",
        target: "self",
        params: { component: "fuel", field: "current", delta: -0.1 },
      },
    ],
    priority: 1,
    enabled: true,
  },
];

// ============================================================================
// WORLD SCHEMA - The main registry
// ============================================================================

export class WorldSchema {
  private affordances: Map<string, AffordanceDefinition> = new Map();
  private objectTypes: Map<string, ObjectTypeDefinition> = new Map();
  private rules: Map<string, RuleDefinition> = new Map();
  private traits: Set<string> = new Set();

  constructor() {
    // Load base definitions
    for (const [name, aff] of Object.entries(BASE_AFFORDANCES)) {
      this.affordances.set(name, aff);
    }
    for (const [name, obj] of Object.entries(BASE_OBJECT_TYPES)) {
      this.objectTypes.set(name, obj);
      obj.traits.forEach(t => this.traits.add(t));
    }
    for (const rule of BASE_RULES) {
      this.rules.set(rule.name, rule);
    }
  }

  // --- Affordances ---

  getAffordance(name: string): AffordanceDefinition | undefined {
    return this.affordances.get(name);
  }

  defineAffordance(def: AffordanceDefinition): void {
    this.affordances.set(def.name, def);
  }

  getAllAffordances(): AffordanceDefinition[] {
    return Array.from(this.affordances.values());
  }

  // --- Object Types ---

  getObjectType(name: string): ObjectTypeDefinition | undefined {
    return this.objectTypes.get(name);
  }

  defineObjectType(def: ObjectTypeDefinition): void {
    this.objectTypes.set(def.name, def);
    def.traits.forEach(t => this.traits.add(t));
  }

  getAllObjectTypes(): ObjectTypeDefinition[] {
    return Array.from(this.objectTypes.values());
  }

  getObjectTypesByCategory(category: string): ObjectTypeDefinition[] {
    return this.getAllObjectTypes().filter(t => t.category === category);
  }

  // --- Rules ---

  getRule(name: string): RuleDefinition | undefined {
    return this.rules.get(name);
  }

  defineRule(def: RuleDefinition): void {
    this.rules.set(def.name, def);
  }

  removeRule(name: string): boolean {
    return this.rules.delete(name);
  }

  getActiveRules(): RuleDefinition[] {
    return Array.from(this.rules.values())
      .filter(r => r.enabled !== false)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  // --- Traits ---

  hasTrait(trait: string): boolean {
    return this.traits.has(trait);
  }

  defineTrait(trait: string): void {
    this.traits.add(trait);
  }

  getAllTraits(): string[] {
    return Array.from(this.traits);
  }

  // --- Serialization ---

  toJSON(): object {
    return {
      affordances: Object.fromEntries(this.affordances),
      objectTypes: Object.fromEntries(this.objectTypes),
      rules: Object.fromEntries(this.rules),
      traits: Array.from(this.traits),
    };
  }

  static fromJSON(data: any): WorldSchema {
    const schema = new WorldSchema();
    // Clear defaults and load from data
    schema.affordances.clear();
    schema.objectTypes.clear();
    schema.rules.clear();
    schema.traits.clear();

    for (const [name, aff] of Object.entries(data.affordances || {})) {
      schema.affordances.set(name, aff as AffordanceDefinition);
    }
    for (const [name, obj] of Object.entries(data.objectTypes || {})) {
      schema.objectTypes.set(name, obj as ObjectTypeDefinition);
    }
    for (const [name, rule] of Object.entries(data.rules || {})) {
      schema.rules.set(name, rule as RuleDefinition);
    }
    for (const trait of data.traits || []) {
      schema.traits.add(trait);
    }

    return schema;
  }
}

// Singleton instance
export const worldSchema = new WorldSchema();
