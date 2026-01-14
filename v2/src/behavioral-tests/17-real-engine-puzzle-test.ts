/**
 * Real Engine Multi-Step Puzzle Test
 *
 * IMPORTANT: This test uses the ACTUAL ArgOS engine components:
 * - WorldSchema for object type definitions and affordances
 * - ObjectManager for spawning with traits and states
 * - Cognition System for agent thinking
 * - Effect Executor for action processing with grounded feedback
 * - Sensory System for perception
 *
 * The puzzle chain: crowbar → pry floorboard → key → unlock cupboard → vegetables → cook → eat
 *
 * If the AI hallucinates results, that's an ENGINE problem to fix, not a test problem.
 */

import "dotenv/config";
import { createWorld, addEntity, addComponent, query, hasComponent } from "bitecs";
import {
  Agent, Mind, Name, Needs, Room, Goal, Description, Inventory,
  ObjectType, ObjectState, Traits,
} from "../ecs/components";
import { OccupiesRoom, HasGoal, Contains } from "../ecs/relations";
import {
  worldSchema,
  ObjectManager,
  type ObjectTypeDefinition,
  type AffordanceDefinition,
} from "../world";
import {
  runCognitionCycle,
  executeActions,
  registerEntity,
  initializeInventory,
  queueStimulus,
} from "../cognition/cognition-system";
import { createSystemRegistry } from "../ecs/dynamic-systems";

// =============================================================================
// COLORS
// =============================================================================

const c = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

const log = {
  header: (s: string) => console.log(`${c.bright}${s}${c.reset}`),
  success: (s: string) => console.log(`${c.green}${s}${c.reset}`),
  error: (s: string) => console.log(`${c.red}${s}${c.reset}`),
  info: (s: string) => console.log(`${c.cyan}${s}${c.reset}`),
  action: (s: string) => console.log(`${c.yellow}${s}${c.reset}`),
  thought: (s: string) => console.log(`${c.dim}${s}${c.reset}`),
};

// =============================================================================
// REGISTER PUZZLE-SPECIFIC OBJECT TYPES
// =============================================================================

function registerPuzzleObjectTypes(): void {
  // Cupboard - can be locked, needs key to unlock
  worldSchema.defineObjectType({
    name: "cupboard",
    description: "A wooden cupboard with a rusty padlock",
    traits: ["openable", "lockable", "examinable", "container"],
    states: {
      locked: {
        description: "The cupboard is LOCKED with a rusty padlock. You can see vegetables through a crack. You need a KEY to open it.",
        blockedTraits: ["openable"],  // Can't open when locked
      },
      closed: {
        description: "The cupboard is closed but unlocked.",
        traits: ["openable"],
      },
      open: {
        description: "The cupboard stands open.",
        traits: ["container"],
      },
    },
    defaultState: "locked",
    isContainer: true,
    containerCapacity: 5,
    category: "container",
  });

  // Floorboard - can be pried up to reveal key
  worldSchema.defineObjectType({
    name: "floorboard",
    description: "A loose floorboard",
    traits: ["examinable", "pryable"],
    states: {
      normal: {
        description: "One floorboard is loose and slightly raised. Something might be hidden underneath. A crowbar could pry it up.",
        traits: ["pryable"],
      },
      pried: {
        description: "The floorboard has been pried up, revealing a space underneath.",
        blockedTraits: ["pryable"],
      },
    },
    defaultState: "normal",
    category: "structure",
  });

  // Rusty Key - can unlock the cupboard
  worldSchema.defineObjectType({
    name: "rusty_key",
    description: "A rusty key",
    traits: ["takeable", "examinable", "hasKey"],  // hasKey allows unlocking
    states: {
      hidden: {
        description: "A rusty key lies hidden under the floorboard.",
      },
      revealed: {
        description: "A rusty key. It looks like it could fit the cupboard's padlock.",
        traits: ["takeable"],
      },
    },
    defaultState: "hidden",
    category: "key",
  });

  // Crowbar - can pry things open
  worldSchema.defineObjectType({
    name: "crowbar",
    description: "A sturdy iron crowbar",
    traits: ["takeable", "examinable", "hasCrowbar"],  // hasCrowbar allows prying
    states: {
      normal: {
        description: "A heavy iron crowbar. Good for prying things open.",
      },
    },
    defaultState: "normal",
    category: "tool",
  });

  // Raw Vegetables - need to be cooked
  worldSchema.defineObjectType({
    name: "vegetables",
    description: "Fresh vegetables",
    traits: ["takeable", "examinable", "choppable"],
    states: {
      raw: {
        description: "Fresh raw vegetables (carrots, onions, potatoes). They need to be chopped and cooked.",
        traits: ["choppable"],
      },
      chopped: {
        description: "Finely chopped vegetables, ready for cooking.",
        traits: ["cookable"],
        blockedTraits: ["choppable"],
      },
      cooked: {
        description: "Delicious cooked vegetables! They smell amazing.",
        traits: ["edible"],
        blockedTraits: ["choppable", "cookable"],
      },
    },
    defaultState: "raw",
    category: "food",
  });

  // Kitchen Knife - for chopping
  worldSchema.defineObjectType({
    name: "knife",
    description: "A sharp kitchen knife",
    traits: ["takeable", "examinable", "hasKnife"],
    states: {
      normal: {
        description: "A sharp kitchen knife. Perfect for chopping vegetables.",
      },
    },
    defaultState: "normal",
    category: "tool",
  });

  // Matches - for lighting the stove
  worldSchema.defineObjectType({
    name: "matches",
    description: "A box of matches",
    traits: ["takeable", "examinable", "hasMatches"],
    states: {
      normal: {
        description: "A box of dry matches. Can be used to light fires.",
      },
    },
    defaultState: "normal",
    category: "tool",
  });

  // Wood Stove - needs to be lit
  worldSchema.defineObjectType({
    name: "stove",
    description: "A cast iron wood stove",
    traits: ["examinable", "lightable"],
    states: {
      cold: {
        description: "The wood stove is COLD. You need MATCHES to light it.",
        traits: ["lightable"],
      },
      lit: {
        description: "The wood stove burns warmly, ready for cooking.",
        traits: ["heatsource"],
        blockedTraits: ["lightable"],
      },
    },
    defaultState: "cold",
    category: "appliance",
  });

  // Cooking Pan - hasPan trait will transfer to actor when picked up
  worldSchema.defineObjectType({
    name: "pan",
    description: "A cast iron cooking pan",
    traits: ["takeable", "examinable", "hasPan"],  // hasPan transfers to actor on take
    states: {
      normal: {
        description: "A heavy cast iron pan. Can be placed on the stove for cooking.",
      },
      on_stove: {
        description: "The pan sits on the hot stove, ready for ingredients.",
        traits: ["canCook"],
        blockedTraits: ["takeable"],
      },
    },
    defaultState: "normal",
    category: "tool",
  });
}

// =============================================================================
// REGISTER PUZZLE-SPECIFIC AFFORDANCES
// =============================================================================

function registerPuzzleAffordances(): void {
  // Register tool-specific take affordances that transfer the tool's trait to actor
  // Crowbar - grants hasCrowbar to actor
  worldSchema.defineAffordance({
    name: "take_crowbar",
    requires: ["takeable", "hasCrowbar"],  // Only matches items with hasCrowbar trait
    descriptionTemplate: "{actor.name} picks up {target.name}.",
    effects: [
      { type: "add_trait", target: "target", trait: "held" },
      { type: "remove_trait", target: "target", trait: "takeable" },
      { type: "add_trait", target: "actor", trait: "hasCrowbar" },  // Actor gains tool ability
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result", stimulusContent: "You pick up the crowbar. You can now pry things open!" },
    ],
  });

  // Knife - grants hasKnife to actor
  worldSchema.defineAffordance({
    name: "take_knife",
    requires: ["takeable", "hasKnife"],
    descriptionTemplate: "{actor.name} picks up {target.name}.",
    effects: [
      { type: "add_trait", target: "target", trait: "held" },
      { type: "remove_trait", target: "target", trait: "takeable" },
      { type: "add_trait", target: "actor", trait: "hasKnife" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result", stimulusContent: "You pick up the knife. You can now chop things!" },
    ],
  });

  // Key - grants hasKey to actor
  worldSchema.defineAffordance({
    name: "take_key",
    requires: ["takeable", "hasKey"],
    descriptionTemplate: "{actor.name} picks up {target.name}.",
    effects: [
      { type: "add_trait", target: "target", trait: "held" },
      { type: "remove_trait", target: "target", trait: "takeable" },
      { type: "add_trait", target: "actor", trait: "hasKey" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result", stimulusContent: "You pick up the rusty key. It might unlock something!" },
    ],
  });

  // Matches - grants hasMatches to actor
  worldSchema.defineAffordance({
    name: "take_matches",
    requires: ["takeable", "hasMatches"],
    descriptionTemplate: "{actor.name} picks up {target.name}.",
    effects: [
      { type: "add_trait", target: "target", trait: "held" },
      { type: "remove_trait", target: "target", trait: "takeable" },
      { type: "add_trait", target: "actor", trait: "hasMatches" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result", stimulusContent: "You pick up the matches. You can now light fires!" },
    ],
  });

  // Pan - grants hasPan to actor
  worldSchema.defineAffordance({
    name: "take_pan",
    requires: ["takeable"],
    actorRequires: [],
    descriptionTemplate: "{actor.name} picks up {target.name}.",
    effects: [
      { type: "add_trait", target: "target", trait: "held" },
      { type: "remove_trait", target: "target", trait: "takeable" },
      { type: "add_trait", target: "actor", trait: "hasPan" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result", stimulusContent: "You pick up the cooking pan." },
    ],
  });

  // Generic take for food items
  worldSchema.defineAffordance({
    name: "take_food",
    requires: ["takeable", "choppable"],  // Matches vegetables
    descriptionTemplate: "{actor.name} picks up {target.name}.",
    effects: [
      { type: "add_trait", target: "target", trait: "held" },
      { type: "remove_trait", target: "target", trait: "takeable" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result", stimulusContent: "You pick up the vegetables." },
    ],
  });

  // Pry open - requires hasCrowbar trait on actor
  worldSchema.defineAffordance({
    name: "pry",
    requires: ["pryable"],
    actorRequires: ["hasCrowbar"],
    descriptionTemplate: "{actor.name} pries open {target.name} with the crowbar.",
    effects: [
      { type: "set_state", target: "target", state: "pried" },
      {
        type: "emit_stimulus",
        target: "actor",
        stimulusType: "action_result",
        stimulusContent: "SUCCESS: You pry up the floorboard. There's a RUSTY KEY underneath!",
      },
    ],
  });

  // Unlock with key - requires hasKey trait on actor
  worldSchema.defineAffordance({
    name: "unlock",
    requires: ["lockable"],
    actorRequires: ["hasKey"],
    descriptionTemplate: "{actor.name} unlocks {target.name} with the key.",
    effects: [
      { type: "set_state", target: "target", state: "closed" },
      {
        type: "emit_stimulus",
        target: "actor",
        stimulusType: "action_result",
        stimulusContent: "SUCCESS: The rusty key fits! The cupboard is now unlocked.",
      },
    ],
  });

  // Chop - requires hasKnife trait on actor
  worldSchema.defineAffordance({
    name: "chop",
    requires: ["choppable"],
    actorRequires: ["hasKnife"],
    descriptionTemplate: "{actor.name} chops {target.name} with the knife.",
    effects: [
      { type: "set_state", target: "target", state: "chopped" },
      {
        type: "emit_stimulus",
        target: "actor",
        stimulusType: "action_result",
        stimulusContent: "SUCCESS: You chop the vegetables into small pieces.",
      },
    ],
  });

  // Light stove - requires hasMatches trait on actor, grants hasHeatSource
  worldSchema.defineAffordance({
    name: "light",
    requires: ["lightable"],
    actorRequires: ["hasMatches"],
    descriptionTemplate: "{actor.name} lights {target.name} with a match.",
    effects: [
      { type: "set_state", target: "target", state: "lit" },
      { type: "add_trait", target: "actor", trait: "hasHeatSource" },  // Actor can now cook!
      {
        type: "emit_stimulus",
        target: "actor",
        stimulusType: "action_result",
        stimulusContent: "SUCCESS: You strike a match and light the stove. Flames crackle to life! You can now cook.",
      },
    ],
  });

  // Place pan on stove - pan must be held, stove must be lit
  worldSchema.defineAffordance({
    name: "place_on_stove",
    requires: ["heatsource"],
    actorRequires: ["hasPan"],
    descriptionTemplate: "{actor.name} places the pan on {target.name}.",
    effects: [
      {
        type: "emit_stimulus",
        target: "actor",
        stimulusType: "action_result",
        stimulusContent: "SUCCESS: You place the pan on the hot stove. It starts to heat up.",
      },
    ],
  });

  // Cook vegetables - requires pan AND heat source (lit stove)
  worldSchema.defineAffordance({
    name: "cook",
    requires: ["cookable"],
    actorRequires: ["hasPan", "hasHeatSource"],  // Must have pan AND stove must be lit
    descriptionTemplate: "{actor.name} cooks {target.name} in the pan on the hot stove.",
    effects: [
      { type: "set_state", target: "target", state: "cooked" },
      {
        type: "emit_stimulus",
        target: "actor",
        stimulusType: "action_result",
        stimulusContent: "SUCCESS: The vegetables sizzle and cook to perfection! They smell delicious! Now EAT them!",
      },
    ],
  });

  // Eat - requires edible trait (only cooked food has this)
  worldSchema.defineAffordance({
    name: "eat",
    requires: ["edible"],
    descriptionTemplate: "{actor.name} eats {target.name}.",
    effects: [
      { type: "destroy", target: "target" },  // Food is consumed
      {
        type: "modify_component",
        target: "actor",
        modifications: [
          { component: "Needs", property: "hunger", operation: "set", value: 0.2 },  // Satisfy hunger
        ],
      },
      {
        type: "emit_stimulus",
        target: "actor",
        stimulusType: "action_result",
        stimulusContent: "SUCCESS: You devour the delicious cooked vegetables! Your hunger is satisfied! 🎉 PUZZLE COMPLETE!",
      },
    ],
  });
}

// =============================================================================
// SETUP WORLD
// =============================================================================

interface TestWorld {
  world: any;
  objectManager: ObjectManager;
  registry: any;
  agentEid: number;
  roomEid: number;
  objects: Map<string, number>;
}

function setupWorld(): TestWorld {
  const world = createWorld();
  const objectManager = new ObjectManager(world);
  const registry = createSystemRegistry();

  // Register puzzle types and affordances
  registerPuzzleObjectTypes();
  registerPuzzleAffordances();

  // Create the kitchen room
  const roomEid = addEntity(world);
  addComponent(world, roomEid, Room);
  addComponent(world, roomEid, Name);
  addComponent(world, roomEid, Description);
  Name.value[roomEid] = "Old Kitchen";
  Description.value[roomEid] = "An old kitchen with a wood stove, a cupboard, and loose floorboards.";
  Room.capacity[roomEid] = 20;
  Room.ambience[roomEid] = "Dust motes float in the dim light. Your stomach growls.";
  registerEntity(roomEid, "Old Kitchen");

  // Create agent
  const agentEid = addEntity(world);
  addComponent(world, agentEid, Agent);
  addComponent(world, agentEid, Mind);
  addComponent(world, agentEid, Name);
  addComponent(world, agentEid, Needs);
  addComponent(world, agentEid, Description);
  addComponent(world, agentEid, Traits);  // For tracking tool abilities
  addComponent(world, agentEid, OccupiesRoom(roomEid));

  Name.value[agentEid] = "Viktor";
  Traits.active[agentEid] = "[]";  // Initialize empty traits
  Description.value[agentEid] = "A starving traveler";
  Agent.role[agentEid] = "survivor";
  Agent.active[agentEid] = true;
  Agent.systemPrompt[agentEid] = `You are Viktor, a starving traveler trapped in an abandoned kitchen.

YOUR GOAL: Find food and eat it to survive. You are STARVING.

AVAILABLE ACTIONS (use "interact" with these exact verbs):
- take: Pick up an item (e.g., interact target="crowbar" content="take")
- pry: Pry something open (REQUIRES holding crowbar)
- unlock: Unlock something (REQUIRES holding key)
- open: Open a container
- chop: Chop vegetables (REQUIRES holding knife)
- light: Light the stove (REQUIRES holding matches)
- cook: Cook CHOPPED VEGETABLES (REQUIRES holding pan AND stove lit)
- eat: Eat edible food
- examine: Look at something closely

CRITICAL RULES:
1. READ YOUR FEEDBACK! If you see "FAILED" or "lacks trait", the action DID NOT WORK.
2. You must PICK UP tools before using them (take crowbar, THEN pry)
3. To chop vegetables, you need the KNIFE (take knife first!)
4. Raw vegetables must be CHOPPED before cooking
5. To cook, you need BOTH the pan AND the stove must be lit
6. Cook the VEGETABLES, not the stove!
7. DO NOT assume actions succeeded - wait for ✅ SUCCESS confirmation

PUZZLE STEPS:
1. Take crowbar -> Pry floorboard -> Get key
2. Take key -> Unlock cupboard -> Open cupboard -> Take vegetables
3. Take knife -> CHOP vegetables (target=vegetables, content=chop)
4. Take matches -> LIGHT stove (target=stove, content=light)
5. Take pan -> COOK vegetables (target=vegetables, content=cook)
6. EAT vegetables (target=vegetables, content=eat)`;

  Mind.mode[agentEid] = "active";
  Mind.arousal[agentEid] = 0.9;
  Mind.focus[agentEid] = "desperate for food";

  Needs.hunger[agentEid] = 0.95;
  Needs.energy[agentEid] = 0.4;

  initializeInventory(agentEid, 10, 50);
  registerEntity(agentEid, "Viktor");

  // Create goal
  const goalEid = addEntity(world);
  addComponent(world, goalEid, Goal);
  addComponent(world, agentEid, HasGoal(goalEid));
  Goal.description[goalEid] = "Find food, cook it, and eat it to survive";
  Goal.priority[goalEid] = 10;
  Goal.status[goalEid] = "active";

  // Spawn puzzle objects using ObjectManager
  const objects = new Map<string, number>();

  // Crowbar (available to pick up)
  const crowbarEid = objectManager.spawn("crowbar", {
    name: "iron crowbar",
    containedIn: roomEid,
  });
  if (crowbarEid) {
    objects.set("crowbar", crowbarEid);
    registerEntity(crowbarEid, "iron crowbar");
    addComponent(world, roomEid, Contains(crowbarEid));
  }

  // Floorboard
  const floorboardEid = objectManager.spawn("floorboard", {
    name: "loose floorboard",
    containedIn: roomEid,
  });
  if (floorboardEid) {
    objects.set("floorboard", floorboardEid);
    registerEntity(floorboardEid, "loose floorboard");
    addComponent(world, roomEid, Contains(floorboardEid));
  }

  // Key (hidden under floorboard - will be revealed when floorboard is pried)
  const keyEid = objectManager.spawn("rusty_key", {
    name: "rusty key",
    state: "hidden",
    containedIn: roomEid,
  });
  if (keyEid) {
    objects.set("key", keyEid);
    registerEntity(keyEid, "rusty key");
    // Note: hidden state means it's not takeable until revealed
  }

  // Cupboard (locked)
  const cupboardEid = objectManager.spawn("cupboard", {
    name: "wooden cupboard",
    state: "locked",
    containedIn: roomEid,
  });
  if (cupboardEid) {
    objects.set("cupboard", cupboardEid);
    registerEntity(cupboardEid, "wooden cupboard");
    addComponent(world, roomEid, Contains(cupboardEid));
  }

  // Vegetables (inside cupboard)
  const vegEid = objectManager.spawn("vegetables", {
    name: "fresh vegetables",
    state: "raw",
    containedIn: cupboardEid ?? roomEid,
  });
  if (vegEid) {
    objects.set("vegetables", vegEid);
    registerEntity(vegEid, "fresh vegetables");
  }

  // Knife
  const knifeEid = objectManager.spawn("knife", {
    name: "kitchen knife",
    containedIn: roomEid,
  });
  if (knifeEid) {
    objects.set("knife", knifeEid);
    registerEntity(knifeEid, "kitchen knife");
    addComponent(world, roomEid, Contains(knifeEid));
  }

  // Matches
  const matchesEid = objectManager.spawn("matches", {
    name: "box of matches",
    containedIn: roomEid,
  });
  if (matchesEid) {
    objects.set("matches", matchesEid);
    registerEntity(matchesEid, "box of matches");
    addComponent(world, roomEid, Contains(matchesEid));
  }

  // Stove
  const stoveEid = objectManager.spawn("stove", {
    name: "wood stove",
    state: "cold",
    containedIn: roomEid,
  });
  if (stoveEid) {
    objects.set("stove", stoveEid);
    registerEntity(stoveEid, "wood stove");
    addComponent(world, roomEid, Contains(stoveEid));
  }

  // Pan
  const panEid = objectManager.spawn("pan", {
    name: "cooking pan",
    containedIn: roomEid,
  });
  if (panEid) {
    objects.set("pan", panEid);
    registerEntity(panEid, "cooking pan");
    addComponent(world, roomEid, Contains(panEid));
  }

  return { world, objectManager, registry, agentEid, roomEid, objects };
}

// =============================================================================
// CHECK PUZZLE PROGRESS
// =============================================================================

function checkProgress(tw: TestWorld): {
  hasCrowbar: boolean;
  floorboardPried: boolean;
  hasKey: boolean;
  cupboardUnlocked: boolean;
  hasVegetables: boolean;
  hasKnife: boolean;
  vegetablesChopped: boolean;
  hasMatches: boolean;
  stoveLit: boolean;
  hasPan: boolean;
  vegetablesCooked: boolean;
  ate: boolean;
} {
  const { objectManager, objects, agentEid } = tw;

  // Check object states
  const floorboard = objects.get("floorboard");
  const cupboard = objects.get("cupboard");
  const vegetables = objects.get("vegetables");
  const stove = objects.get("stove");

  // Check if items are held (have "held" trait)
  const vegHeld = vegetables ? objectManager.hasTrait(vegetables, "held") : false;
  const panHeld = objects.get("pan") ? objectManager.hasTrait(objects.get("pan")!, "held") : false;

  // Get vegetable state (handle destroyed case)
  const vegState = vegetables ? ObjectState.current[vegetables] : undefined;
  const vegChopped = vegState === "chopped" || vegState === "cooked";  // cooked implies was chopped
  const vegCooked = vegState === "cooked";

  return {
    hasCrowbar: objectManager.hasTrait(agentEid, "hasCrowbar"),
    floorboardPried: floorboard ? ObjectState.current[floorboard] === "pried" : false,
    hasKey: objectManager.hasTrait(agentEid, "hasKey"),
    cupboardUnlocked: cupboard ? ObjectState.current[cupboard] !== "locked" : false,
    hasVegetables: vegHeld || vegChopped,  // Got them if held OR processed
    hasKnife: objectManager.hasTrait(agentEid, "hasKnife"),
    vegetablesChopped: vegChopped,  // Chopped if state is chopped OR cooked (cooked implies chopped)
    hasMatches: objectManager.hasTrait(agentEid, "hasMatches"),
    stoveLit: stove ? ObjectState.current[stove] === "lit" : false,
    hasPan: panHeld || objectManager.hasTrait(agentEid, "hasPan"),  // Got pan if held or have trait
    vegetablesCooked: vegCooked,
    ate: Needs.hunger[agentEid] < 0.5,
  };
}

// =============================================================================
// MAIN TEST
// =============================================================================

async function runRealEnginePuzzleTest(): Promise<void> {
  log.header("\n" + "═".repeat(70));
  log.header("  REAL ENGINE PUZZLE TEST - Testing Actual ArgOS Components");
  log.header("═".repeat(70));

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    log.error("\n❌ Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  const tw = setupWorld();

  log.info("\n[Setup] Using REAL engine components:");
  log.info("  - WorldSchema for object types and affordances");
  log.info("  - ObjectManager for spawning with traits/states");
  log.info("  - Cognition System for agent thinking");
  log.info("  - Effect Executor for action processing");
  log.info("  - Sensory System for perception\n");

  log.info("[Puzzle] Viktor (95% hunger) must solve:");
  log.info("  1. Find crowbar → pry floorboard");
  log.info("  2. Get key → unlock cupboard");
  log.info("  3. Get vegetables → chop → cook → eat\n");

  // Give agent initial perception
  queueStimulus({
    targetEid: tw.agentEid,
    type: "observation",
    content: `You are in the Old Kitchen. You are STARVING.

You see:
- A wooden cupboard (LOCKED with a padlock - needs a KEY)
- A loose floorboard (looks like something might be hidden underneath)
- An iron crowbar (for prying things open)
- A kitchen knife (for chopping)
- A box of matches (for lighting fires)
- A cooking pan
- A wood stove (COLD - needs matches to light)

Your goal: Find food, cook it, and eat it to survive!`,
    source: "observation",
    modality: "cognitive",
  });

  const MAX_CYCLES = 30;
  let cycles = 0;
  let solved = false;

  log.header("--- Running Cognition Cycles ---\n");

  for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
    cycles = cycle;

    // Check if puzzle is solved
    const progress = checkProgress(tw);
    if (progress.ate) {
      log.success(`\n🎉 PUZZLE SOLVED in ${cycle} cycles!`);
      solved = true;
      break;
    }

    log.header(`[Cycle ${cycle}]`);

    try {
      // Run REAL cognition cycle
      const actions = await runCognitionCycle(tw.world, tw.registry, { tick: cycle });

      // Execute actions through REAL effect executor
      executeActions(tw.world, actions, tw.registry);

      // Show what happened
      for (const { eid, action } of actions) {
        const name = Name.value[eid];
        const actionStr = `${action.type}${action.target ? ` → ${action.target}` : ""}`;
        log.action(`  ${name}: ${actionStr}`);
        if (action.content) {
          log.thought(`    "${action.content.slice(0, 60)}..."`);
        }
      }

      // Brief pause
      await new Promise(r => setTimeout(r, 500));

    } catch (error) {
      log.error(`  Error: ${error}`);
    }
  }

  // Final report
  const progress = checkProgress(tw);

  log.header("\n" + "═".repeat(70));
  log.header("  TEST RESULTS");
  log.header("═".repeat(70));

  log.info(`\n  Total cycles: ${cycles}`);
  log.info(`  Puzzle solved: ${solved ? "YES" : "NO"}`);

  log.header("\n  Progress:");
  const steps = [
    { name: "Got crowbar", done: progress.hasCrowbar },
    { name: "Pried floorboard", done: progress.floorboardPried },
    { name: "Got key", done: progress.hasKey },
    { name: "Unlocked cupboard", done: progress.cupboardUnlocked },
    { name: "Got vegetables", done: progress.hasVegetables },
    { name: "Got knife", done: progress.hasKnife },
    { name: "Chopped vegetables", done: progress.vegetablesChopped },
    { name: "Got matches", done: progress.hasMatches },
    { name: "Lit stove", done: progress.stoveLit },
    { name: "Got pan", done: progress.hasPan },
    { name: "Cooked vegetables", done: progress.vegetablesCooked },
    { name: "ATE THE FOOD!", done: progress.ate },
  ];

  let completed = 0;
  for (const step of steps) {
    const icon = step.done ? "✓" : "○";
    if (step.done) {
      log.success(`    ${icon} ${step.name}`);
      completed++;
    } else {
      log.info(`    ${icon} ${step.name}`);
    }
  }

  log.header("\n" + "═".repeat(70));
  if (solved) {
    log.success(`  ✓ TEST PASSED - Completed ${completed}/${steps.length} steps`);
  } else {
    log.error(`  ✗ TEST INCOMPLETE - Completed ${completed}/${steps.length} steps`);
    log.info("\n  NOTE: If the AI hallucinated or got stuck, this indicates");
    log.info("  an ENGINE issue to fix, not a test harness issue.");
  }
  log.header("═".repeat(70) + "\n");

  process.exit(solved ? 0 : 1);
}

runRealEnginePuzzleTest().catch(error => {
  log.error(`Fatal error: ${error}`);
  process.exit(1);
});
