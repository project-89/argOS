/**
 * WorldSchema - The contract between hardcoded systems and GodAI
 *
 * This provides:
 * - Object type definitions (prefabs)
 * - Affordance definitions (what can be done to things)
 * - State transition rules
 * - The bridge between semantic descriptions and ECS entities
 */
import { AdjacentTo, ContainedIn, OccupiedBy, OnTopOf, OwnedBy } from "../ecs/relations";

// ============================================================================
// RELATIONS - Spatial and ownership connections between entities
// ============================================================================

export { ContainedIn, OnTopOf, OccupiedBy, OwnedBy, AdjacentTo };

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
    | "set_state"          // Change ObjectState.current (recalculates traits/description)
    | "add_trait"          // Add a trait
    | "remove_trait"       // Remove a trait
    | "destroy"            // Remove entity from world
    | "spawn"              // Create a new entity
    | "emit_stimulus"      // Broadcast perception to nearby agents
    | "run_tool"           // Execute a tool (terminal, repo ops, web, etc.)
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

  /** For run_tool */
  toolId?: string;
  /**
   * Tool input source. When "affordanceArgs", tool input comes from whatever
   * text follows the affordance name (e.g., interact.content = "run_command npm test").
   */
  toolInputFrom?: "affordanceArgs" | "affordanceArgsJson" | "static";
  /** Static tool input (used when toolInputFrom="static") */
  toolInput?: any;
  /** Emit tool results as a stimulus to this target (default: actor) */
  toolResultTarget?: EffectTarget;
  /** Stimulus type for tool results (default: "tool_result") */
  toolResultType?: string;
  /**
   * Whether a tool returning `ok:false` should fail the affordance.
   *
   * Default: true (preserves legacy behavior).
   * For workflows like running tests, a non-zero exit code is evidence and should not fail the action.
   */
  failOnToolError?: boolean;

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
      // Canonical: move target into actor (inventory/holding is derived from LocatedIn)
      { type: "transfer", target: "target", containerName: "actor" },
    ],
  },

  drop: {
    name: "drop",
    requires: [],
    descriptionTemplate: "{actor.name} drops {target.name}.",
    effects: [
      // Canonical: move target into actor's room (on the ground)
      { type: "transfer", target: "target", containerName: "room" },
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

  // ==========================================================================
  // DEVICE AFFORDANCES - For technology objects
  // ==========================================================================

  power_on: {
    name: "power_on",
    requires: ["device"],
    blockedBy: ["powered_on", "broken"],
    descriptionTemplate: "{actor.name} turns on {target.name}.",
    effects: [
      { type: "set_state", target: "target", state: "powered_on" },
    ],
  },

  power_off: {
    name: "power_off",
    requires: ["device"],
    blockedBy: ["powered_off"],
    descriptionTemplate: "{actor.name} turns off {target.name}.",
    effects: [
      { type: "set_state", target: "target", state: "powered_off" },
    ],
  },

  use_phone: {
    name: "use_phone",
    requires: ["communication", "usable"],
    descriptionTemplate: "{actor.name} uses their phone.",
    effects: [
      { type: "emit_stimulus", target: "actor", stimulusType: "device", stimulusContent: "{actor.name} is using their phone." },
    ],
  },

  answer_call: {
    name: "answer_call",
    requires: ["answerable"],
    descriptionTemplate: "{actor.name} answers the phone.",
    effects: [
      { type: "set_state", target: "target", state: "in_call" },
      { type: "emit_stimulus", target: "nearby", stimulusType: "speech", stimulusContent: "{actor.name} answers the phone: 'Hello?'" },
    ],
  },

  make_call: {
    name: "make_call",
    requires: ["callable"],
    descriptionTemplate: "{actor.name} makes a phone call.",
    effects: [
      { type: "set_state", target: "target", state: "in_call" },
      { type: "emit_stimulus", target: "nearby", stimulusType: "speech", stimulusContent: "{actor.name} dials a number on their phone." },
    ],
  },

  end_call: {
    name: "end_call",
    requires: ["in_use"],
    descriptionTemplate: "{actor.name} ends the call.",
    effects: [
      { type: "set_state", target: "target", state: "powered_on" },
      { type: "emit_stimulus", target: "nearby", stimulusType: "speech", stimulusContent: "{actor.name} hangs up the phone." },
    ],
  },

  send_text: {
    name: "send_text",
    requires: ["textable"],
    descriptionTemplate: "{actor.name} sends a text message.",
    effects: [
      { type: "emit_stimulus", target: "actor", stimulusType: "device", stimulusContent: "Message sent." },
    ],
  },

  use_computer: {
    name: "use_computer",
    requires: ["usable", "typeable"],
    descriptionTemplate: "{actor.name} uses the computer.",
    effects: [
      { type: "set_state", target: "target", state: "in_use" },
      { type: "emit_stimulus", target: "nearby", stimulusType: "sound", stimulusContent: "Keyboard clicks come from {actor.name}'s direction." },
    ],
  },

  browse_web: {
    name: "browse_web",
    requires: ["browsable"],
    descriptionTemplate: "{actor.name} browses the web.",
    effects: [
      { type: "emit_stimulus", target: "actor", stimulusType: "device", stimulusContent: "Web browser displays search results." },
    ],
  },

  send_email: {
    name: "send_email",
    requires: ["usable", "typeable"],
    descriptionTemplate: "{actor.name} sends an email.",
    effects: [
      { type: "emit_stimulus", target: "actor", stimulusType: "device", stimulusContent: "Email sent successfully." },
    ],
  },

  check_email: {
    name: "check_email",
    requires: ["usable", "browsable"],
    descriptionTemplate: "{actor.name} checks their email.",
    effects: [
      { type: "emit_stimulus", target: "actor", stimulusType: "device", stimulusContent: "Checking email inbox..." },
    ],
  },

  search_files: {
    name: "search_files",
    requires: ["searchable"],
    descriptionTemplate: "{actor.name} searches through files.",
    effects: [
      { type: "emit_stimulus", target: "actor", stimulusType: "device", stimulusContent: "Searching files..." },
    ],
  },

  run_command: {
    name: "run_command",
    requires: ["usable", "typeable"],
    descriptionTemplate: "{actor.name} runs a command on {target.name}.",
    effects: [
      { type: "run_tool", toolId: "terminal.run", toolInputFrom: "affordanceArgs", toolResultType: "tool_result", failOnToolError: false },
    ],
  },

  list_dir: {
    name: "list_dir",
    requires: ["usable", "typeable"],
    descriptionTemplate: "{actor.name} checks files on {target.name}.",
    effects: [
      // Accept either JSON args or simple string args; see workspace.list_dir tool parser.
      { type: "run_tool", toolId: "workspace.list_dir", toolInputFrom: "affordanceArgs", toolResultType: "tool_result", failOnToolError: true },
    ],
  },

  read_file: {
    name: "read_file",
    requires: ["usable", "typeable"],
    descriptionTemplate: "{actor.name} reads a file on {target.name}.",
    effects: [
      // Accept either JSON args or simple string args; see workspace.read_file tool parser.
      { type: "run_tool", toolId: "workspace.read_file", toolInputFrom: "affordanceArgs", toolResultType: "tool_result", failOnToolError: true },
    ],
  },

  write_file: {
    name: "write_file",
    requires: ["usable", "typeable"],
    descriptionTemplate: "{actor.name} writes a file on {target.name}.",
    effects: [
      // Accept either JSON args or a multiline "<path>\\n<content>" format; see workspace.write_file tool parser.
      { type: "run_tool", toolId: "workspace.write_file", toolInputFrom: "affordanceArgs", toolResultType: "tool_result", failOnToolError: true },
    ],
  },

  replace_in_file: {
    name: "replace_in_file",
    requires: ["usable", "typeable"],
    descriptionTemplate: "{actor.name} edits a file on {target.name}.",
    effects: [
      { type: "run_tool", toolId: "workspace.replace_in_file", toolInputFrom: "affordanceArgs", toolResultType: "tool_result", failOnToolError: true },
    ],
  },

  init_workspace_fixture: {
    name: "init_workspace_fixture",
    requires: ["usable", "typeable"],
    descriptionTemplate: "{actor.name} sets up a workspace on {target.name}.",
    effects: [
      { type: "run_tool", toolId: "workspace.init_fixture", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result", failOnToolError: true },
    ],
  },

  gemini_cli: {
    name: "gemini_cli",
    requires: ["usable", "typeable"],
    descriptionTemplate: "{actor.name} consults a coding assistant on {target.name}.",
    effects: [
      // Provide plain args as both {input,command}. The office tool reads prompt from params.prompt/input/command.
      { type: "run_tool", toolId: "gemini.cli", toolInputFrom: "affordanceArgs", toolResultType: "tool_result", failOnToolError: true },
    ],
  },

  generate_image: {
    name: "generate_image",
    requires: ["usable", "typeable"],
    descriptionTemplate: "{actor.name} generates an image on {target.name}.",
    effects: [
      { type: "run_tool", toolId: "nano_banana.generate_image", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result", failOnToolError: true },
    ],
  },

  describe_image: {
    name: "describe_image",
    requires: ["usable", "typeable"],
    descriptionTemplate: "{actor.name} inspects an image on {target.name}.",
    effects: [
      // Accept either JSON args or simple string args; see vision.describe_image tool parser.
      { type: "run_tool", toolId: "vision.describe_image", toolInputFrom: "affordanceArgs", toolResultType: "tool_result", failOnToolError: true },
    ],
  },

  edit_image: {
    name: "edit_image",
    requires: ["usable", "typeable"],
    descriptionTemplate: "{actor.name} edits an image on {target.name}.",
    effects: [
      { type: "run_tool", toolId: "nano_banana.edit_image", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result", failOnToolError: true },
    ],
  },

  git_apply_from_last_gemini: {
    name: "git_apply_from_last_gemini",
    requires: ["usable", "typeable"],
    descriptionTemplate: "{actor.name} applies the last coding assistant patch on {target.name}.",
    effects: [
      // Args optionally include an allowlist of workspace-relative paths, e.g. "src/math.cjs src/service.cjs".
      { type: "run_tool", toolId: "workspace.git_apply_from_last_gemini", toolInputFrom: "affordanceArgs", toolResultType: "tool_result", failOnToolError: true },
    ],
  },

  repo_init: {
    name: "repo_init",
    requires: ["usable", "typeable"],
    descriptionTemplate: "{actor.name} initializes a repo service on {target.name}.",
    effects: [
      { type: "run_tool", toolId: "repo.init", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result", failOnToolError: true },
    ],
  },

  repo_checkout: {
    name: "repo_checkout",
    requires: ["usable", "typeable"],
    descriptionTemplate: "{actor.name} checks out a repo onto {target.name}.",
    effects: [
      { type: "run_tool", toolId: "repo.checkout", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result", failOnToolError: true },
    ],
  },

  repo_submit_pr: {
    name: "repo_submit_pr",
    requires: ["usable", "typeable"],
    descriptionTemplate: "{actor.name} submits a pull request from {target.name}.",
    effects: [
      { type: "run_tool", toolId: "repo.submit_pr", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result", failOnToolError: true },
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

function normalizeEdibleType(def: ObjectTypeDefinition): ObjectTypeDefinition {
  if (!def.traits.includes("edible")) return def;

  const states: Record<string, StateDefinition> = { ...(def.states || {}) };
  const baseState =
    states[def.defaultState] ||
    states.fresh ||
    states.normal || {
      description: `A ${def.name}.`,
      stimuli: [{ type: "visual", template: `A ${def.name} is here`, intensity: 0.4 }],
    };

  if (!states.fresh) {
    states.fresh = {
      ...baseState,
      description: baseState.description || "It looks fresh.",
      stimuli: baseState.stimuli || [{ type: "visual", template: `Fresh ${def.name} sits here`, intensity: 0.5 }],
    };
  }

  if (!states.stale) {
    states.stale = {
      description: "It's a bit past its prime.",
      stimuli: [{ type: "visual", template: `Slightly stale ${def.name} sits here`, intensity: 0.3 }],
    };
  }

  if (!states.rotten) {
    states.rotten = {
      description: "It has gone bad.",
      blockedTraits: ["edible"],
      stimuli: [
        { type: "visual", template: `Rotten ${def.name} sits here, unpleasant to behold`, intensity: 0.4 },
        { type: "smell", template: "A foul stench rises from the rotten food", intensity: 0.8 },
      ],
    };
  }

  const transitions = [...(def.transitions || [])];
  const hasFreshToStale = transitions.some(t => t.from === "fresh" && t.to === "stale" && t.trigger === "decay");
  const hasStaleToRotten = transitions.some(t => t.from === "stale" && t.to === "rotten" && t.trigger === "decay");
  if (!hasFreshToStale) transitions.push({ from: "fresh", to: "stale", trigger: "decay" });
  if (!hasStaleToRotten) transitions.push({ from: "stale", to: "rotten", trigger: "decay" });

  const defaultState = states[def.defaultState] ? def.defaultState : "fresh";

  return { ...def, states, transitions, defaultState };
}

// Base object types (GodAI can add more)
export const BASE_OBJECT_TYPES: Record<string, ObjectTypeDefinition> = {
  // Generic object used for simple props created outside specialized schema types.
  // Lets the engine keep ObjectType/ObjectState/Traits canonical even for “plain objects”.
  object: {
    name: "object",
    description: "{name}",
    traits: ["examinable"],
    states: {
      normal: { description: "{description}" },
      occupied: {
        description: "{name} is currently occupied.",
        blockedTraits: ["sleepable", "sittable"],
      },
      empty: {
        description: "{name} appears empty.",
        blockedTraits: ["drinkable"],
      },
    },
    defaultState: "normal",
    category: "misc",
  },

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

  // ==========================================================================
  // TECHNOLOGY - Objects that provide tool access
  // ==========================================================================

  phone: {
    name: "phone",
    description: "A {adjective} phone",
    traits: ["takeable", "examinable", "device", "communication"],
    states: {
      powered_off: {
        description: "The phone is turned off.",
        stimuli: [
          { type: "visual", template: "A phone lies here, screen dark", intensity: 0.2 },
        ],
      },
      powered_on: {
        description: "The phone is on, screen glowing softly.",
        traits: ["usable"],
        stimuli: [
          { type: "visual", template: "A phone glows with its standby screen", intensity: 0.4 },
          { type: "light", template: "Soft light emanates from the phone screen", intensity: 0.2, radius: 1 },
        ],
      },
      ringing: {
        description: "The phone is ringing!",
        traits: ["answerable"],
        stimuli: [
          { type: "visual", template: "A phone buzzes and lights up with an incoming call", intensity: 0.8 },
          { type: "sound", template: "A phone rings insistently", intensity: 0.9, radius: 8 },
        ],
      },
      in_call: {
        description: "The phone is connected to a call.",
        traits: ["in_use"],
        stimuli: [
          { type: "visual", template: "A phone shows an active call in progress", intensity: 0.5 },
        ],
      },
      low_battery: {
        description: "The phone's battery is critically low.",
        traits: ["usable"],
        stimuli: [
          { type: "visual", template: "A phone flashes a low battery warning", intensity: 0.6 },
        ],
      },
    },
    transitions: [
      { from: "powered_off", to: "powered_on", trigger: "power_on" },
      { from: "powered_on", to: "powered_off", trigger: "power_off" },
      { from: "powered_on", to: "ringing", trigger: "incoming_call" },
      { from: "ringing", to: "in_call", trigger: "answer_call" },
      { from: "ringing", to: "powered_on", trigger: "decline_call" },
      { from: "in_call", to: "powered_on", trigger: "end_call" },
      { from: "powered_on", to: "low_battery", trigger: "battery_drain" },
      { from: "low_battery", to: "powered_off", trigger: "battery_dead" },
    ],
    defaultState: "powered_on",
    defaultComponents: [
      { name: "Battery", values: { current: 100, max: 100 }, dynamic: true, schema: { current: "number", max: "number" } },
    ],
    category: "technology",
    variables: {
      adjective: { type: "enum", default: "basic", options: ["basic", "old", "worn", "sleek"] },
    },
  },

  smartphone: {
    name: "smartphone",
    description: "A {adjective} smartphone",
    traits: ["takeable", "examinable", "device", "communication", "computer", "camera"],
    states: {
      powered_off: {
        description: "The smartphone is turned off.",
        stimuli: [
          { type: "visual", template: "A smartphone lies here, screen dark", intensity: 0.2 },
        ],
      },
      powered_on: {
        description: "The smartphone glows with apps and notifications.",
        traits: ["usable", "browsable", "callable", "textable"],
        stimuli: [
          { type: "visual", template: "A smartphone displays its home screen with various apps", intensity: 0.5 },
          { type: "light", template: "The phone's bright screen illuminates the area", intensity: 0.3, radius: 1 },
        ],
      },
      ringing: {
        description: "The smartphone is ringing with an incoming call!",
        traits: ["answerable"],
        stimuli: [
          { type: "visual", template: "A smartphone vibrates and displays an incoming call", intensity: 0.8 },
          { type: "sound", template: "A phone rings with a digital ringtone", intensity: 0.9, radius: 8 },
        ],
      },
      in_call: {
        description: "The smartphone shows an active call.",
        traits: ["in_use"],
        stimuli: [
          { type: "visual", template: "A smartphone shows call controls on its screen", intensity: 0.5 },
        ],
      },
      notification: {
        description: "The smartphone buzzes with a notification.",
        traits: ["usable", "browsable", "callable", "textable"],
        stimuli: [
          { type: "visual", template: "A notification banner appears on the phone", intensity: 0.6 },
          { type: "sound", template: "A soft notification chime sounds", intensity: 0.4, radius: 3 },
        ],
      },
    },
    transitions: [
      { from: "powered_off", to: "powered_on", trigger: "power_on" },
      { from: "powered_on", to: "powered_off", trigger: "power_off" },
      { from: "powered_on", to: "ringing", trigger: "incoming_call" },
      { from: "ringing", to: "in_call", trigger: "answer_call" },
      { from: "ringing", to: "powered_on", trigger: "decline_call" },
      { from: "in_call", to: "powered_on", trigger: "end_call" },
      { from: "powered_on", to: "notification", trigger: "receive_notification" },
      { from: "notification", to: "powered_on", trigger: "dismiss" },
    ],
    defaultState: "powered_on",
    defaultComponents: [
      { name: "Battery", values: { current: 100, max: 100 }, dynamic: true, schema: { current: "number", max: "number" } },
      { name: "Storage", values: { used: 20, max: 128 }, dynamic: true, schema: { used: "number", max: "number" } },
    ],
    category: "technology",
    variables: {
      adjective: { type: "enum", default: "modern", options: ["modern", "high-end", "budget", "cracked"] },
    },
  },

  computer: {
    name: "computer",
    description: "A {adjective} computer with a {screenSize} monitor",
    traits: ["examinable", "device", "computer", "workstation", "furniture"],
    states: {
      powered_off: {
        description: "The computer is turned off, screen dark.",
        stimuli: [
          { type: "visual", template: "A computer sits here, monitor dark and silent", intensity: 0.2 },
        ],
      },
      powered_on: {
        description: "The computer hums quietly, desktop visible on screen.",
        traits: ["usable", "browsable", "typeable"],
        stimuli: [
          { type: "visual", template: "A computer displays its desktop with icons and windows", intensity: 0.6 },
          { type: "light", template: "The monitor casts a blue-white glow", intensity: 0.4, radius: 2 },
          { type: "sound", template: "The computer hums softly with fans spinning", intensity: 0.2 },
        ],
      },
      locked: {
        description: "The computer shows a login screen.",
        stimuli: [
          { type: "visual", template: "A computer displays a password prompt", intensity: 0.5 },
          { type: "light", template: "The login screen glows steadily", intensity: 0.3, radius: 2 },
        ],
      },
      in_use: {
        description: "Someone is actively using the computer.",
        // "in_use" should not make the computer unusable for tool-backed actions (terminal/file/wiki/etc).
        // Treat it as "powered_on + occupied" so multi-agent office scenarios can share a workstation.
        traits: ["usable", "browsable", "typeable", "occupied"],
        stimuli: [
          { type: "visual", template: "The computer screen shows active work in progress", intensity: 0.6 },
          { type: "sound", template: "Keyboard clicks echo from the workstation", intensity: 0.3 },
        ],
      },
      error: {
        description: "The computer displays an error message.",
        stimuli: [
          { type: "visual", template: "An error dialog flashes on the computer screen", intensity: 0.7 },
        ],
      },
    },
    transitions: [
      { from: "powered_off", to: "locked", trigger: "power_on" },
      { from: "locked", to: "powered_on", trigger: "login" },
      { from: "powered_on", to: "locked", trigger: "lock" },
      { from: "powered_on", to: "powered_off", trigger: "shutdown" },
      { from: "powered_on", to: "in_use", trigger: "start_using" },
      { from: "in_use", to: "powered_on", trigger: "stop_using" },
      { from: "powered_on", to: "error", trigger: "crash" },
      { from: "error", to: "powered_off", trigger: "force_shutdown" },
    ],
    defaultState: "powered_off",
    defaultComponents: [
      { name: "ComputerSpec", values: { ram: 16, storage: 512 }, dynamic: true, schema: { ram: "number", storage: "number" } },
    ],
    category: "technology",
    variables: {
      adjective: { type: "enum", default: "standard", options: ["standard", "gaming", "office", "old", "high-end"] },
      screenSize: { type: "enum", default: "24-inch", options: ["21-inch", "24-inch", "27-inch", "32-inch", "dual"] },
    },
  },

  laptop: {
    name: "laptop",
    description: "A {adjective} laptop computer",
    traits: ["takeable", "examinable", "device", "computer", "portable"],
    states: {
      closed: {
        description: "The laptop is closed.",
        stimuli: [
          { type: "visual", template: "A closed laptop sits here", intensity: 0.2 },
        ],
      },
      powered_off: {
        description: "The laptop is open but powered off.",
        stimuli: [
          { type: "visual", template: "An open laptop with a dark screen", intensity: 0.3 },
        ],
      },
      powered_on: {
        description: "The laptop is on and ready for use.",
        traits: ["usable", "browsable", "typeable"],
        stimuli: [
          { type: "visual", template: "A laptop displays its desktop, ready for use", intensity: 0.6 },
          { type: "light", template: "Soft light glows from the laptop screen", intensity: 0.3, radius: 1 },
        ],
      },
      in_use: {
        description: "Someone is working on the laptop.",
        traits: ["usable", "browsable", "typeable", "occupied"],
        stimuli: [
          { type: "visual", template: "The laptop shows active work in progress", intensity: 0.5 },
          { type: "sound", template: "Soft typing sounds come from the laptop", intensity: 0.2 },
        ],
      },
    },
    transitions: [
      { from: "closed", to: "powered_off", trigger: "open" },
      { from: "powered_off", to: "closed", trigger: "close" },
      { from: "powered_off", to: "powered_on", trigger: "power_on" },
      { from: "powered_on", to: "powered_off", trigger: "power_off" },
      { from: "powered_on", to: "in_use", trigger: "start_using" },
      { from: "in_use", to: "powered_on", trigger: "stop_using" },
      { from: "powered_on", to: "closed", trigger: "close" },
    ],
    defaultState: "closed",
    defaultComponents: [
      { name: "Battery", values: { current: 80, max: 100 }, dynamic: true, schema: { current: "number", max: "number" } },
    ],
    category: "technology",
    variables: {
      adjective: { type: "enum", default: "modern", options: ["modern", "thin", "bulky", "gaming", "business"] },
    },
  },

  workstation: {
    name: "workstation",
    description: "A {adjective} office workstation with computer, phone, and filing",
    traits: ["examinable", "device", "computer", "workstation", "furniture", "office"],
    states: {
      powered_off: {
        description: "The workstation is powered off.",
        traits: ["powered_off"],
        stimuli: [
          { type: "visual", template: "A workstation sits here, screen dark", intensity: 0.3 },
        ],
      },
      powered_on: {
        description: "The workstation is powered on and ready for use.",
        traits: ["usable", "browsable", "typeable", "powered_on"],
        stimuli: [
          { type: "visual", template: "An empty workstation with computer and phone awaits use", intensity: 0.4 },
        ],
      },
      unoccupied: {
        description: "The workstation is empty and ready for use.",
        traits: ["usable", "browsable", "typeable"],
        stimuli: [
          { type: "visual", template: "An empty workstation with computer and phone awaits use", intensity: 0.4 },
        ],
      },
      occupied: {
        description: "Someone is working at the workstation.",
        traits: ["in_use", "browsable", "typeable"],
        stimuli: [
          { type: "visual", template: "The workstation is occupied with active work", intensity: 0.5 },
          { type: "sound", template: "Keyboard clicks and mouse movements come from the workstation", intensity: 0.3 },
        ],
      },
      meeting: {
        description: "A video call is in progress at the workstation.",
        traits: ["in_use", "in_call", "browsable", "typeable"],
        stimuli: [
          { type: "visual", template: "A video conference is displayed on the workstation monitor", intensity: 0.6 },
          { type: "sound", template: "Meeting voices come from the workstation speakers", intensity: 0.5, radius: 4 },
        ],
      },
    },
    transitions: [
      { from: "powered_off", to: "powered_on", trigger: "power_on" },
      { from: "powered_on", to: "powered_off", trigger: "power_off" },
    ],


    defaultState: "unoccupied",
    category: "technology",
    variables: {
      adjective: { type: "enum", default: "standard", options: ["standard", "executive", "corner", "standing"] },
    },
  },

  filing_cabinet: {
    name: "filing_cabinet",
    description: "A {adjective} {material} filing cabinet",
    traits: ["examinable", "openable", "container", "lockable", "furniture", "storage"],
    states: {
      closed: {
        description: "The filing cabinet drawers are closed.",
        traits: ["openable"],
        stimuli: [
          { type: "visual", template: "A filing cabinet stands here, drawers closed", intensity: 0.3 },
        ],
      },
      open: {
        description: "A drawer of the filing cabinet is open, revealing files.",
        traits: ["searchable", "container"],
        stimuli: [
          { type: "visual", template: "Files are visible in the open filing cabinet drawer", intensity: 0.4 },
        ],
      },
      locked: {
        description: "The filing cabinet is locked.",
        blockedTraits: ["openable", "searchable"],
        stimuli: [
          { type: "visual", template: "A locked filing cabinet stands here", intensity: 0.3 },
        ],
      },
    },
    transitions: [
      { from: "closed", to: "open", trigger: "open" },
      { from: "open", to: "closed", trigger: "close" },
      { from: "closed", to: "locked", trigger: "lock" },
      { from: "locked", to: "closed", trigger: "unlock" },
    ],
    defaultState: "closed",
    isContainer: true,
    containerCapacity: 50,
    category: "technology",
    variables: {
      adjective: { type: "enum", default: "metal", options: ["metal", "wooden", "modern", "old"] },
      material: { type: "enum", default: "steel", options: ["steel", "wood", "plastic"] },
    },
  },

  tree: {
    name: "tree",
    description: "A {adjective} tree",
    traits: ["examinable", "tree", "plant", "scenery", "flammable"],
    states: {
      standing: {
        description: "A {adjective} tree stands here, branches rustling softly.",
        stimuli: [
          { type: "visual", template: "A {adjective} tree stands here", intensity: 0.4 },
          { type: "sound", template: "Leaves rustle in the wind", intensity: 0.2, radius: 3 },
        ],
      },
      burning: {
        description: "The tree is burning, flames licking up the trunk.",
        traits: ["burning"],
        stimuli: [
          { type: "visual", template: "A tree burns fiercely", intensity: 0.7 },
          { type: "light", template: "Firelight flickers from the burning tree", intensity: 0.6, radius: 5 },
          { type: "sound", template: "Wood crackles as the tree burns", intensity: 0.5, radius: 5 },
        ],
      },
    },
    transitions: [
      { from: "standing", to: "burning", trigger: "ignite" },
    ],
    defaultState: "standing",
    category: "nature",
    variables: {
      adjective: { type: "enum", default: "tall", options: ["tall", "gnarled", "young", "ancient", "lush"] },
    },
  },

  house: {
    name: "house",
    description: "A {adjective} {material} house",
    traits: ["examinable", "house", "building", "structure", "scenery"],
    states: {
      quiet: {
        description: "A {adjective} {material} house. The windows are still and the door is shut.",
        stimuli: [
          { type: "visual", template: "A {adjective} {material} house sits here", intensity: 0.5 },
        ],
      },
      occupied: {
        description: "Light and movement suggest the house is occupied.",
        traits: ["occupied"],
        stimuli: [
          { type: "visual", template: "A house with signs of activity inside", intensity: 0.6 },
          { type: "sound", template: "Muffled voices and footsteps come from within the house", intensity: 0.3, radius: 4 },
          { type: "light", template: "Warm lamplight glows from the windows", intensity: 0.3, radius: 2 },
        ],
      },
    },
    transitions: [
      { from: "quiet", to: "occupied", trigger: "occupy" },
      { from: "occupied", to: "quiet", trigger: "vacate" },
    ],
    defaultState: "quiet",
    category: "structure",
    variables: {
      adjective: { type: "enum", default: "small", options: ["small", "modest", "sturdy", "weathered", "cozy"] },
      material: { type: "enum", default: "wooden", options: ["wooden", "stone", "brick"] },
    },
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
      const normalized = normalizeEdibleType(obj);
      this.objectTypes.set(name, normalized);
      normalized.traits.forEach(t => this.traits.add(t));
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
    const normalized = normalizeEdibleType(def);
    this.objectTypes.set(normalized.name, normalized);
    normalized.traits.forEach(t => this.traits.add(t));
  }

  getAllObjectTypes(): ObjectTypeDefinition[] {
    return Array.from(this.objectTypes.values());
  }

  getAllObjectTypeIds(): string[] {
    return Array.from(this.objectTypes.keys());
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
