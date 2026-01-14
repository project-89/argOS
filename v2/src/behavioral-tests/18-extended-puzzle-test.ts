/**
 * Extended Puzzle Test - Complex Multi-Step Discovery & Combination
 *
 * Tests the engine with a more elaborate puzzle requiring:
 * - Discovery mechanics (search, examine to reveal hidden items)
 * - Item preparation (oil rusty items, sharpen dull tools, dry wet items)
 * - Stacking/climbing to reach high places
 * - Combination mechanics (ingredients + recipe)
 * - Multi-step tool chains (need tool A to get tool B to do action C)
 *
 * PUZZLE CHAIN:
 *
 * Phase 1 - Getting the Crowbar:
 *   1. Crowbar is in a LOCKED TOOLBOX
 *   2. Toolbox key hangs on a HIGH HOOK (can't reach)
 *   3. Stack wooden crate → climb → reach hook → get toolbox key
 *   4. Unlock toolbox → get crowbar
 *
 * Phase 2 - Finding the Hidden Key:
 *   5. Pry floorboard with crowbar → find RUSTY KEY (too corroded to use!)
 *   6. Find oil can → oil the rusty key → key becomes usable
 *
 * Phase 3 - Unlocking Food Storage:
 *   7. Use oiled key → unlock cupboard
 *   8. Open cupboard → find vegetables + SEALED SPICE JAR
 *   9. Pry open spice jar → get spices
 *
 * Phase 4 - Preparing to Cook:
 *   10. Knife is DULL → find whetstone → sharpen knife
 *   11. Chop vegetables with sharp knife
 *   12. Matches are WET → find cloth → dry matches
 *   13. Light stove with dry matches
 *
 * Phase 5 - Cooking:
 *   14. Fill pot with water from bucket
 *   15. Place pot on stove
 *   16. Add vegetables + spices to pot → cook stew
 *   17. Eat stew → SURVIVE!
 *
 * This tests: discovery, item states, preparation chains, combinations, climbing
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
} from "../world";
import {
  runCognitionCycle,
  executeActions,
  registerEntity,
  queueStimulus,
  initializeInventory,
} from "../cognition/cognition-system";
import { createSystemRegistry, type SystemRegistry } from "../ecs/dynamic-systems";

// =============================================================================
// LOGGING HELPERS
// =============================================================================

const log = {
  header: (msg: string) => console.log(`\x1b[1m${msg}\x1b[0m`),
  info: (msg: string) => console.log(`\x1b[36m${msg}\x1b[0m`),
  success: (msg: string) => console.log(`\x1b[32m${msg}\x1b[0m`),
  warn: (msg: string) => console.log(`\x1b[33m${msg}\x1b[0m`),
  error: (msg: string) => console.log(`\x1b[31m${msg}\x1b[0m`),
  dim: (msg: string) => console.log(`\x1b[2m${msg}\x1b[0m`),
};

// =============================================================================
// REGISTER EXTENDED OBJECT TYPES
// =============================================================================

function registerExtendedObjectTypes(): void {
  // === PHASE 1: GETTING THE CROWBAR ===

  // Wooden Crate - can be stacked/climbed
  worldSchema.defineObjectType({
    name: "crate",
    description: "A sturdy wooden crate",
    traits: ["moveable", "stackable", "examinable"],
    states: {
      floor: {
        description: "A wooden crate sitting on the floor. Could be moved.",
      },
      stacked: {
        description: "The crate is stacked against the wall, creating a step up.",
        traits: ["climbable"],
        blockedTraits: ["moveable"],
      },
    },
    defaultState: "floor",
    category: "furniture",
  });

  // High Hook - unreachable without climbing
  worldSchema.defineObjectType({
    name: "hook",
    description: "A hook on the wall",
    traits: ["examinable"],
    states: {
      high: {
        description: "A hook mounted HIGH on the wall. Something glints on it, but you can't reach it.",
        traits: ["unreachable"],
      },
      reachable: {
        description: "Standing on the crate, you can now reach the hook. A small key hangs from it!",
        traits: ["hasKey"],  // Can now take the key
        blockedTraits: ["unreachable"],
      },
    },
    defaultState: "high",
    category: "fixture",
  });

  // Toolbox Key - hanging on the hook
  worldSchema.defineObjectType({
    name: "toolbox_key",
    description: "A small brass key",
    traits: ["examinable"],
    states: {
      hanging: {
        description: "A small brass key hanging from the hook. Too high to reach!",
        blockedTraits: ["takeable"],
      },
      reachable: {
        description: "The brass key is now within reach!",
        traits: ["takeable", "hasToolboxKey"],
      },
    },
    defaultState: "hanging",
    category: "key",
  });

  // Locked Toolbox - contains crowbar
  worldSchema.defineObjectType({
    name: "toolbox",
    description: "A metal toolbox",
    traits: ["examinable", "container", "lockable"],
    states: {
      locked: {
        description: "A sturdy metal toolbox. It's LOCKED with a small padlock.",
        traits: ["locked"],
        blockedTraits: ["openable"],
      },
      closed: {
        description: "The toolbox is unlocked but closed.",
        traits: ["openable"],
        blockedTraits: ["locked"],
      },
      open: {
        description: "The toolbox is open. Inside you see an iron crowbar!",
        traits: ["open"],
        blockedTraits: ["openable", "locked"],
      },
    },
    defaultState: "locked",
    category: "container",
  });

  // Crowbar - inside toolbox
  worldSchema.defineObjectType({
    name: "crowbar",
    description: "An iron crowbar",
    traits: ["examinable"],
    states: {
      inside_toolbox: {
        description: "An iron crowbar inside the toolbox.",
        blockedTraits: ["takeable"],  // Can't take until toolbox is open
      },
      available: {
        description: "A heavy iron crowbar. Good for prying things open.",
        traits: ["takeable", "hasCrowbar"],
      },
    },
    defaultState: "inside_toolbox",
    category: "tool",
  });

  // === PHASE 2: FINDING THE HIDDEN KEY ===

  // Loose Floorboard
  worldSchema.defineObjectType({
    name: "floorboard",
    description: "A loose wooden floorboard",
    traits: ["examinable", "pryable"],
    states: {
      normal: {
        description: "A loose floorboard. Something might be hidden underneath.",
        traits: ["pryable"],
      },
      pried: {
        description: "The floorboard has been pried up. A RUSTY KEY lies in the dust beneath!",
        blockedTraits: ["pryable"],
      },
    },
    defaultState: "normal",
    category: "fixture",
  });

  // Rusty Key - needs oil
  worldSchema.defineObjectType({
    name: "rusty_key",
    description: "A rusty key",
    traits: ["examinable"],
    states: {
      hidden: {
        description: "Hidden under the floorboard.",
        blockedTraits: ["takeable"],
      },
      rusty: {
        description: "A key covered in rust and corrosion. Too corroded to fit in any lock!",
        traits: ["takeable", "rusty", "oilable"],
      },
      oiled: {
        description: "The key has been oiled and the rust scraped away. It looks usable now!",
        traits: ["takeable", "hasKey"],
        blockedTraits: ["rusty", "oilable"],
      },
    },
    defaultState: "hidden",
    category: "key",
  });

  // Oil Can
  worldSchema.defineObjectType({
    name: "oil_can",
    description: "An oil can",
    traits: ["takeable", "examinable", "hasOil"],
    states: {
      normal: {
        description: "A small oil can with lubricating oil. Good for rusty things.",
      },
    },
    defaultState: "normal",
    category: "tool",
  });

  // === PHASE 3: UNLOCKING FOOD STORAGE ===

  // Cupboard
  worldSchema.defineObjectType({
    name: "cupboard",
    description: "A wooden cupboard",
    traits: ["examinable", "container", "lockable"],
    states: {
      locked: {
        description: "A wooden cupboard with a rusty padlock. LOCKED tight.",
        traits: ["locked"],
        blockedTraits: ["openable"],
      },
      closed: {
        description: "The cupboard is unlocked but closed.",
        traits: ["openable"],
        blockedTraits: ["locked"],
      },
      open: {
        description: "The cupboard is open! Inside: fresh vegetables and a SEALED SPICE JAR.",
        traits: ["open"],
        blockedTraits: ["openable", "locked"],
      },
    },
    defaultState: "locked",
    category: "container",
  });

  // Vegetables
  worldSchema.defineObjectType({
    name: "vegetables",
    description: "Fresh vegetables",
    traits: ["examinable"],
    states: {
      inside_cupboard: {
        description: "Fresh vegetables sitting in the cupboard.",
        blockedTraits: ["takeable"],
      },
      raw: {
        description: "Fresh raw vegetables (carrots, potatoes, onions). Need to be chopped.",
        traits: ["takeable", "choppable"],
      },
      chopped: {
        description: "Finely chopped vegetables, ready for the pot.",
        traits: ["cookable"],
        blockedTraits: ["choppable", "takeable"],
      },
    },
    defaultState: "inside_cupboard",
    category: "food",
  });

  // Sealed Spice Jar - needs to be pried open
  // With dynamic traits: hold the open jar = have hasSpices
  worldSchema.defineObjectType({
    name: "spice_jar",
    description: "A sealed spice jar",
    traits: ["examinable"],
    states: {
      inside_cupboard: {
        description: "A glass jar with spices, sealed with a stuck lid.",
        blockedTraits: ["takeable"],
      },
      sealed: {
        description: "A spice jar with a tightly sealed lid. Need something to pry it open.",
        traits: ["takeable", "pryable"],
      },
      pried: {
        // After prying, the jar is now open - "pried" is the result of the pry action
        description: "The spice jar lid has been pried off! Aromatic spices are ready to use. Pick it up!",
        traits: ["takeable", "hasSpices"],
        blockedTraits: ["pryable"],
      },
      open: {
        description: "The spice jar is open, releasing aromatic scents! Pick it up to use the spices.",
        traits: ["takeable", "hasSpices"],
        blockedTraits: ["pryable"],
      },
    },
    defaultState: "inside_cupboard",
    category: "food",
  });

  // === PHASE 4: PREPARING TO COOK ===

  // Dull Knife - needs sharpening
  worldSchema.defineObjectType({
    name: "knife",
    description: "A kitchen knife",
    traits: ["takeable", "examinable"],
    states: {
      dull: {
        description: "A kitchen knife, but the blade is DULL. Can't cut anything with this.",
        traits: ["sharpenable"],
        blockedTraits: ["hasKnife"],
      },
      sharp: {
        description: "A razor-sharp kitchen knife! Perfect for chopping.",
        traits: ["hasKnife"],
        blockedTraits: ["sharpenable"],
      },
    },
    defaultState: "dull",
    category: "tool",
  });

  // Whetstone
  worldSchema.defineObjectType({
    name: "whetstone",
    description: "A sharpening whetstone",
    traits: ["takeable", "examinable", "hasWhetstone"],
    states: {
      normal: {
        description: "A rough whetstone for sharpening blades.",
      },
    },
    defaultState: "normal",
    category: "tool",
  });

  // Wet Matches - need drying
  worldSchema.defineObjectType({
    name: "matches",
    description: "A box of matches",
    traits: ["takeable", "examinable"],
    states: {
      wet: {
        description: "A box of matches, but they're WET and won't light!",
        traits: ["dryable"],
        blockedTraits: ["hasMatches"],
      },
      dry: {
        description: "Dry matches, ready to strike!",
        traits: ["hasMatches"],
        blockedTraits: ["dryable"],
      },
    },
    defaultState: "wet",
    category: "tool",
  });

  // Dry Cloth
  worldSchema.defineObjectType({
    name: "cloth",
    description: "A dry cloth",
    traits: ["takeable", "examinable", "hasCloth"],
    states: {
      normal: {
        description: "A dry cotton cloth. Good for drying wet things.",
      },
    },
    defaultState: "normal",
    category: "tool",
  });

  // Wood Stove
  worldSchema.defineObjectType({
    name: "stove",
    description: "A wood stove",
    traits: ["examinable"],
    states: {
      cold: {
        description: "A wood stove, currently COLD. Needs matches to light.",
        traits: ["lightable"],
      },
      lit: {
        description: "The stove burns warmly, ready for cooking!",
        traits: ["heatsource"],
        blockedTraits: ["lightable"],
      },
    },
    defaultState: "cold",
    category: "appliance",
  });

  // === PHASE 5: COOKING ===

  // Water Bucket - takeable so agent can hold it and gain hasWater
  worldSchema.defineObjectType({
    name: "bucket",
    description: "A bucket of water",
    traits: ["examinable", "takeable", "hasWater"],
    states: {
      full: {
        description: "A wooden bucket full of fresh water. Pick it up to use the water.",
      },
    },
    defaultState: "full",
    category: "container",
  });

  // Cooking Pot
  worldSchema.defineObjectType({
    name: "pot",
    description: "A cooking pot",
    traits: ["takeable", "examinable"],
    states: {
      empty: {
        description: "An empty iron cooking pot.",
        traits: ["fillable"],
      },
      filled: {
        description: "A pot filled with water.",
        traits: ["hasPot"],
        blockedTraits: ["fillable"],
      },
      cooking: {
        description: "The pot bubbles on the stove, cooking a delicious stew!",
        blockedTraits: ["fillable"],
      },
      ready: {
        description: "A pot of steaming hot vegetable stew! Smells amazing!",
        traits: ["edible"],
        blockedTraits: ["fillable"],
      },
    },
    defaultState: "empty",
    category: "cookware",
  });
}

// =============================================================================
// REGISTER EXTENDED AFFORDANCES
// =============================================================================

function registerExtendedAffordances(): void {
  // === PHASE 1: CLIMBING & REACHING ===

  // Stack crate against wall
  worldSchema.defineAffordance({
    name: "stack",
    requires: ["stackable"],
    descriptionTemplate: "{actor.name} stacks {target.name} against the wall.",
    effects: [
      { type: "set_state", target: "target", state: "stacked" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result",
        stimulusContent: "SUCCESS: You stack the crate against the wall. Now you can climb it!" },
    ],
  });

  // Climb on stacked crate
  worldSchema.defineAffordance({
    name: "climb",
    requires: ["climbable"],
    descriptionTemplate: "{actor.name} climbs onto {target.name}.",
    effects: [
      { type: "add_trait", target: "actor", trait: "elevated" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result",
        stimulusContent: "SUCCESS: You climb onto the crate. You can now reach higher places!" },
    ],
  });

  // Reach the hook (when elevated)
  worldSchema.defineAffordance({
    name: "reach",
    requires: ["unreachable"],
    actorRequires: ["elevated"],
    descriptionTemplate: "{actor.name} reaches for {target.name}.",
    effects: [
      { type: "set_state", target: "target", state: "reachable" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result",
        stimulusContent: "SUCCESS: Standing on the crate, you can now reach the hook! A key hangs from it!" },
    ],
  });

  // Take toolbox key (now reachable)
  worldSchema.defineAffordance({
    name: "take_toolbox_key",
    requires: ["takeable", "hasToolboxKey"],
    descriptionTemplate: "{actor.name} takes {target.name} from the hook.",
    effects: [
      { type: "add_trait", target: "target", trait: "held" },
      { type: "remove_trait", target: "target", trait: "takeable" },
      { type: "add_trait", target: "actor", trait: "hasToolboxKey" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result",
        stimulusContent: "SUCCESS: You grab the small brass key from the hook!" },
    ],
  });

  // Unlock toolbox
  worldSchema.defineAffordance({
    name: "unlock_toolbox",
    requires: ["locked"],
    actorRequires: ["hasToolboxKey"],
    descriptionTemplate: "{actor.name} unlocks {target.name}.",
    effects: [
      { type: "set_state", target: "target", state: "closed" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result",
        stimulusContent: "SUCCESS: The small key fits! You unlock the toolbox." },
    ],
  });

  // Open toolbox
  worldSchema.defineAffordance({
    name: "open_toolbox",
    requires: ["openable"],
    descriptionTemplate: "{actor.name} opens {target.name}.",
    effects: [
      { type: "set_state", target: "target", state: "open" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result",
        stimulusContent: "SUCCESS: You open the toolbox. Inside is an iron crowbar!" },
    ],
  });

  // Standard take (for basic items)
  worldSchema.defineAffordance({
    name: "take",
    requires: ["takeable"],
    blockedBy: ["tooHeavy", "fixed"],
    descriptionTemplate: "{actor.name} picks up {target.name}.",
    effects: [
      { type: "add_trait", target: "target", trait: "held" },
      { type: "remove_trait", target: "target", trait: "takeable" },
    ],
  });

  // === PHASE 2: PRY & OIL ===

  // Pry floorboard (reveals rusty key)
  worldSchema.defineAffordance({
    name: "pry",
    requires: ["pryable"],
    actorRequires: ["hasCrowbar"],
    descriptionTemplate: "{actor.name} pries {target.name} with the crowbar.",
    effects: [
      { type: "set_state", target: "target", state: "pried" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result",
        stimulusContent: "SUCCESS: You pry it open! A RUSTY KEY lies beneath, covered in corrosion." },
    ],
  });

  // Oil rusty items
  worldSchema.defineAffordance({
    name: "oil",
    requires: ["oilable"],
    actorRequires: ["hasOil"],
    descriptionTemplate: "{actor.name} applies oil to {target.name}.",
    effects: [
      { type: "set_state", target: "target", state: "oiled" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result",
        stimulusContent: "SUCCESS: You oil and scrape away the rust. The key is now usable!" },
    ],
  });

  // === PHASE 3: UNLOCK CUPBOARD ===

  // Unlock cupboard with oiled key
  worldSchema.defineAffordance({
    name: "unlock",
    requires: ["locked"],
    actorRequires: ["hasKey"],
    descriptionTemplate: "{actor.name} unlocks {target.name}.",
    effects: [
      { type: "set_state", target: "target", state: "closed" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result",
        stimulusContent: "SUCCESS: The oiled key turns! You unlock the cupboard." },
    ],
  });

  // Open cupboard
  worldSchema.defineAffordance({
    name: "open",
    requires: ["openable"],
    descriptionTemplate: "{actor.name} opens {target.name}.",
    effects: [
      { type: "set_state", target: "target", state: "open" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result",
        stimulusContent: "SUCCESS: You open it! Inside: vegetables and a SEALED SPICE JAR." },
    ],
  });

  // === PHASE 4: SHARPEN & DRY ===

  // Sharpen knife with whetstone
  worldSchema.defineAffordance({
    name: "sharpen",
    requires: ["sharpenable"],
    actorRequires: ["hasWhetstone"],
    descriptionTemplate: "{actor.name} sharpens {target.name}.",
    effects: [
      { type: "set_state", target: "target", state: "sharp" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result",
        stimulusContent: "SUCCESS: You sharpen the blade until it's razor-sharp!" },
    ],
  });

  // Chop vegetables
  worldSchema.defineAffordance({
    name: "chop",
    requires: ["choppable"],
    actorRequires: ["hasKnife"],
    descriptionTemplate: "{actor.name} chops {target.name}.",
    effects: [
      { type: "set_state", target: "target", state: "chopped" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result",
        stimulusContent: "SUCCESS: You chop the vegetables into perfect pieces!" },
    ],
  });

  // Dry wet items with cloth
  worldSchema.defineAffordance({
    name: "dry",
    requires: ["dryable"],
    actorRequires: ["hasCloth"],
    descriptionTemplate: "{actor.name} dries {target.name}.",
    effects: [
      { type: "set_state", target: "target", state: "dry" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result",
        stimulusContent: "SUCCESS: You dry the matches thoroughly. They're ready to use!" },
    ],
  });

  // Light stove
  worldSchema.defineAffordance({
    name: "light",
    requires: ["lightable"],
    actorRequires: ["hasMatches"],
    descriptionTemplate: "{actor.name} lights {target.name}.",
    effects: [
      { type: "set_state", target: "target", state: "lit" },
      { type: "add_trait", target: "actor", trait: "hasHeatSource" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result",
        stimulusContent: "SUCCESS: You strike a match and light the stove! Flames crackle to life." },
    ],
  });

  // === PHASE 5: COOKING ===

  // Fill pot with water
  worldSchema.defineAffordance({
    name: "fill",
    requires: ["fillable"],
    actorRequires: ["hasWater"],
    descriptionTemplate: "{actor.name} fills {target.name} with water.",
    effects: [
      { type: "set_state", target: "target", state: "filled" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result",
        stimulusContent: "SUCCESS: You fill the pot with fresh water." },
    ],
  });

  // Place pot on stove and add ingredients to cook
  worldSchema.defineAffordance({
    name: "cook",
    requires: ["hasPot"],  // Pot must be filled
    actorRequires: ["hasHeatSource", "hasSpices"],  // Need lit stove and spices
    descriptionTemplate: "{actor.name} cooks stew in {target.name}.",
    effects: [
      { type: "set_state", target: "target", state: "ready" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result",
        stimulusContent: "SUCCESS: You add the vegetables and spices, let it simmer... A delicious stew is ready!" },
    ],
  });

  // Eat the stew
  worldSchema.defineAffordance({
    name: "eat",
    requires: ["edible"],
    descriptionTemplate: "{actor.name} eats from {target.name}.",
    effects: [
      { type: "modify_component", target: "actor",
        modifications: [{ component: "Needs", property: "hunger", operation: "set", value: 0.1 }] },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result",
        stimulusContent: "SUCCESS: You devour the delicious stew! Your hunger is completely satisfied! 🎉 PUZZLE COMPLETE!" },
    ],
  });

  // Generic examine
  worldSchema.defineAffordance({
    name: "examine",
    requires: ["examinable"],
    descriptionTemplate: "{actor.name} examines {target.name} closely.",
    effects: [],
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

  registerExtendedObjectTypes();
  registerExtendedAffordances();

  // Create room
  const roomEid = addEntity(world);
  addComponent(world, roomEid, Room);
  addComponent(world, roomEid, Name);
  addComponent(world, roomEid, Description);
  Name.value[roomEid] = "Abandoned Cellar";
  Description.value[roomEid] = "A dusty cellar with stone walls. Water drips somewhere in the darkness.";
  Room.capacity[roomEid] = 30;
  Room.ambience[roomEid] = "Cold and damp. Your stomach growls with desperate hunger.";
  registerEntity(roomEid, "Abandoned Cellar");

  // Create agent
  const agentEid = addEntity(world);
  addComponent(world, agentEid, Agent);
  addComponent(world, agentEid, Mind);
  addComponent(world, agentEid, Name);
  addComponent(world, agentEid, Needs);
  addComponent(world, agentEid, Description);
  addComponent(world, agentEid, Traits);
  addComponent(world, agentEid, OccupiesRoom(roomEid));

  Name.value[agentEid] = "Viktor";
  Traits.active[agentEid] = "[]";
  Description.value[agentEid] = "A desperate survivor trapped in a cellar";
  Agent.role[agentEid] = "survivor";
  Agent.active[agentEid] = true;
  Agent.systemPrompt[agentEid] = `You are Viktor, a starving survivor trapped in an abandoned cellar.

YOUR GOAL: Find food, prepare it, cook it, and eat it to survive. You are STARVING.

AVAILABLE ACTIONS (use "interact" with these exact verbs):
- examine: Look at something closely
- take: Pick up an item
- stack: Stack moveable objects to climb
- climb: Climb onto stacked objects
- reach: Reach high places (when elevated)
- unlock: Unlock locked containers (needs correct key)
- open: Open unlocked containers
- pry: Pry things open (needs crowbar)
- oil: Apply oil to rusty items (needs oil can)
- sharpen: Sharpen dull blades (needs whetstone)
- dry: Dry wet items (needs cloth)
- chop: Chop vegetables (needs sharp knife)
- light: Light the stove (needs dry matches)
- fill: Fill pot with water (needs water source)
- cook: Cook stew (needs: filled pot, lit stove, spices, chopped vegetables)
- eat: Eat prepared food

CRITICAL RULES:
1. READ YOUR FEEDBACK! If you see "FAILED", the action DID NOT WORK.
2. Items may need PREPARATION before use (oil rusty items, sharpen dull knives, dry wet matches)
3. You may need to CLIMB to reach high places
4. Cook the POT, not the stove!
5. Wait for ✅ SUCCESS confirmation before assuming an action worked.

PUZZLE HINTS:
- The crowbar is locked away... you need to find its key
- Some items are too high to reach
- Rusty things need oil, dull things need sharpening, wet things need drying
- To cook stew: filled pot + lit stove + spices + chopped vegetables`;

  Mind.mode[agentEid] = "active";
  Mind.arousal[agentEid] = 0.95;
  Mind.focus[agentEid] = "desperate survival";

  Needs.hunger[agentEid] = 0.98;  // Nearly starving!
  Needs.energy[agentEid] = 0.3;

  initializeInventory(agentEid, 15, 100);
  registerEntity(agentEid, "Viktor");

  // Create goal
  const goalEid = addEntity(world);
  addComponent(world, goalEid, Goal);
  addComponent(world, agentEid, HasGoal(goalEid));
  Goal.description[goalEid] = "Survive by cooking a spiced vegetable stew in this cellar";
  Goal.priority[goalEid] = 10;
  Goal.status[goalEid] = "active";

  // Spawn puzzle objects
  const objects = new Map<string, number>();

  // Phase 1 objects
  const crateEid = objectManager.spawn("crate", { name: "wooden crate", containedIn: roomEid });
  if (crateEid) { objects.set("crate", crateEid); registerEntity(crateEid, "wooden crate"); addComponent(world, roomEid, Contains(crateEid)); }

  const hookEid = objectManager.spawn("hook", { name: "high hook", containedIn: roomEid });
  if (hookEid) { objects.set("hook", hookEid); registerEntity(hookEid, "high hook"); addComponent(world, roomEid, Contains(hookEid)); }

  const toolboxKeyEid = objectManager.spawn("toolbox_key", { name: "brass key", containedIn: roomEid });
  if (toolboxKeyEid) { objects.set("toolbox_key", toolboxKeyEid); registerEntity(toolboxKeyEid, "brass key"); addComponent(world, roomEid, Contains(toolboxKeyEid)); }

  const toolboxEid = objectManager.spawn("toolbox", { name: "metal toolbox", containedIn: roomEid });
  if (toolboxEid) { objects.set("toolbox", toolboxEid); registerEntity(toolboxEid, "metal toolbox"); addComponent(world, roomEid, Contains(toolboxEid)); }

  const crowbarEid = objectManager.spawn("crowbar", { name: "iron crowbar", containedIn: roomEid });
  if (crowbarEid) { objects.set("crowbar", crowbarEid); registerEntity(crowbarEid, "iron crowbar"); addComponent(world, roomEid, Contains(crowbarEid)); }

  // Phase 2 objects
  const floorboardEid = objectManager.spawn("floorboard", { name: "loose floorboard", containedIn: roomEid });
  if (floorboardEid) { objects.set("floorboard", floorboardEid); registerEntity(floorboardEid, "loose floorboard"); addComponent(world, roomEid, Contains(floorboardEid)); }

  const rustyKeyEid = objectManager.spawn("rusty_key", { name: "rusty key", containedIn: roomEid });
  if (rustyKeyEid) { objects.set("rusty_key", rustyKeyEid); registerEntity(rustyKeyEid, "rusty key"); addComponent(world, roomEid, Contains(rustyKeyEid)); }

  const oilCanEid = objectManager.spawn("oil_can", { name: "oil can", containedIn: roomEid });
  if (oilCanEid) { objects.set("oil_can", oilCanEid); registerEntity(oilCanEid, "oil can"); addComponent(world, roomEid, Contains(oilCanEid)); }

  // Phase 3 objects
  const cupboardEid = objectManager.spawn("cupboard", { name: "wooden cupboard", containedIn: roomEid });
  if (cupboardEid) { objects.set("cupboard", cupboardEid); registerEntity(cupboardEid, "wooden cupboard"); addComponent(world, roomEid, Contains(cupboardEid)); }

  const vegetablesEid = objectManager.spawn("vegetables", { name: "fresh vegetables", containedIn: roomEid });
  if (vegetablesEid) { objects.set("vegetables", vegetablesEid); registerEntity(vegetablesEid, "fresh vegetables"); addComponent(world, roomEid, Contains(vegetablesEid)); }

  const spiceJarEid = objectManager.spawn("spice_jar", { name: "spice jar", containedIn: roomEid });
  if (spiceJarEid) { objects.set("spice_jar", spiceJarEid); registerEntity(spiceJarEid, "spice jar"); addComponent(world, roomEid, Contains(spiceJarEid)); }

  // Phase 4 objects
  const knifeEid = objectManager.spawn("knife", { name: "kitchen knife", containedIn: roomEid });
  if (knifeEid) { objects.set("knife", knifeEid); registerEntity(knifeEid, "kitchen knife"); addComponent(world, roomEid, Contains(knifeEid)); }

  const whetstoneEid = objectManager.spawn("whetstone", { name: "whetstone", containedIn: roomEid });
  if (whetstoneEid) { objects.set("whetstone", whetstoneEid); registerEntity(whetstoneEid, "whetstone"); addComponent(world, roomEid, Contains(whetstoneEid)); }

  const matchesEid = objectManager.spawn("matches", { name: "box of matches", containedIn: roomEid });
  if (matchesEid) { objects.set("matches", matchesEid); registerEntity(matchesEid, "box of matches"); addComponent(world, roomEid, Contains(matchesEid)); }

  const clothEid = objectManager.spawn("cloth", { name: "dry cloth", containedIn: roomEid });
  if (clothEid) { objects.set("cloth", clothEid); registerEntity(clothEid, "dry cloth"); addComponent(world, roomEid, Contains(clothEid)); }

  const stoveEid = objectManager.spawn("stove", { name: "wood stove", containedIn: roomEid });
  if (stoveEid) { objects.set("stove", stoveEid); registerEntity(stoveEid, "wood stove"); addComponent(world, roomEid, Contains(stoveEid)); }

  // Phase 5 objects
  const bucketEid = objectManager.spawn("bucket", { name: "water bucket", containedIn: roomEid });
  if (bucketEid) { objects.set("bucket", bucketEid); registerEntity(bucketEid, "water bucket"); addComponent(world, roomEid, Contains(bucketEid)); }

  const potEid = objectManager.spawn("pot", { name: "cooking pot", containedIn: roomEid });
  if (potEid) { objects.set("pot", potEid); registerEntity(potEid, "cooking pot"); addComponent(world, roomEid, Contains(potEid)); }

  return { world, objectManager, registry, agentEid, roomEid, objects };
}

// =============================================================================
// OBJECT STATE TRANSITIONS (triggered by actions)
// =============================================================================

function updateDependentStates(tw: TestWorld): void {
  const { objectManager, objects } = tw;

  // When toolbox opens, crowbar becomes available
  const toolbox = objects.get("toolbox");
  const crowbar = objects.get("crowbar");
  if (toolbox && crowbar && ObjectState.current[toolbox] === "open") {
    if (ObjectState.current[crowbar] === "inside_toolbox") {
      objectManager.transitionState(crowbar, "available");
    }
  }

  // When floorboard is pried, rusty key becomes available
  const floorboard = objects.get("floorboard");
  const rustyKey = objects.get("rusty_key");
  if (floorboard && rustyKey && ObjectState.current[floorboard] === "pried") {
    if (ObjectState.current[rustyKey] === "hidden") {
      objectManager.transitionState(rustyKey, "rusty");
    }
  }

  // When hook is reachable, toolbox key becomes takeable
  const hook = objects.get("hook");
  const toolboxKey = objects.get("toolbox_key");
  if (hook && toolboxKey && ObjectState.current[hook] === "reachable") {
    if (ObjectState.current[toolboxKey] === "hanging") {
      objectManager.transitionState(toolboxKey, "reachable");
    }
  }

  // When cupboard opens, vegetables and spice jar become available
  const cupboard = objects.get("cupboard");
  const vegetables = objects.get("vegetables");
  const spiceJar = objects.get("spice_jar");
  if (cupboard && ObjectState.current[cupboard] === "open") {
    if (vegetables && ObjectState.current[vegetables] === "inside_cupboard") {
      objectManager.transitionState(vegetables, "raw");
    }
    if (spiceJar && ObjectState.current[spiceJar] === "inside_cupboard") {
      objectManager.transitionState(spiceJar, "sealed");
    }
  }
}

// =============================================================================
// CHECK PUZZLE PROGRESS
// =============================================================================

interface PuzzleProgress {
  // Phase 1
  crateStacked: boolean;
  elevated: boolean;
  hookReached: boolean;
  hasToolboxKey: boolean;
  toolboxUnlocked: boolean;
  hasCrowbar: boolean;
  // Phase 2
  floorboardPried: boolean;
  hasRustyKey: boolean;
  keyOiled: boolean;
  // Phase 3
  cupboardUnlocked: boolean;
  hasVegetables: boolean;
  spiceJarOpened: boolean;
  // Phase 4
  knifeSharpened: boolean;
  vegetablesChopped: boolean;
  matchesDried: boolean;
  stoveLit: boolean;
  // Phase 5
  potFilled: boolean;
  stewCooked: boolean;
  ate: boolean;
}

function checkProgress(tw: TestWorld): PuzzleProgress {
  const { objectManager, objects, agentEid } = tw;

  const crate = objects.get("crate");
  const toolbox = objects.get("toolbox");
  const floorboard = objects.get("floorboard");
  const rustyKey = objects.get("rusty_key");
  const cupboard = objects.get("cupboard");
  const vegetables = objects.get("vegetables");
  const spiceJar = objects.get("spice_jar");
  const knife = objects.get("knife");
  const matches = objects.get("matches");
  const stove = objects.get("stove");
  const pot = objects.get("pot");

  const vegState = vegetables ? ObjectState.current[vegetables] : undefined;

  return {
    // Phase 1
    crateStacked: crate ? ObjectState.current[crate] === "stacked" : false,
    elevated: objectManager.hasTrait(agentEid, "elevated"),
    hookReached: objects.get("hook") ? ObjectState.current[objects.get("hook")!] === "reachable" : false,
    hasToolboxKey: objectManager.hasTrait(agentEid, "hasToolboxKey"),
    toolboxUnlocked: toolbox ? ObjectState.current[toolbox] !== "locked" : false,
    hasCrowbar: objectManager.hasTrait(agentEid, "hasCrowbar"),
    // Phase 2
    floorboardPried: floorboard ? ObjectState.current[floorboard] === "pried" : false,
    hasRustyKey: rustyKey ? objectManager.hasTrait(rustyKey, "held") || ObjectState.current[rustyKey] === "oiled" : false,
    keyOiled: rustyKey ? ObjectState.current[rustyKey] === "oiled" : false,
    // Phase 3
    cupboardUnlocked: cupboard ? ObjectState.current[cupboard] !== "locked" : false,
    hasVegetables: vegState === "raw" || vegState === "chopped",
    spiceJarOpened: spiceJar ? (ObjectState.current[spiceJar] === "open" || ObjectState.current[spiceJar] === "pried") : false,
    // Phase 4
    knifeSharpened: knife ? ObjectState.current[knife] === "sharp" : false,
    vegetablesChopped: vegState === "chopped",
    matchesDried: matches ? ObjectState.current[matches] === "dry" : false,
    stoveLit: stove ? ObjectState.current[stove] === "lit" : false,
    // Phase 5
    potFilled: pot ? ObjectState.current[pot] === "filled" || ObjectState.current[pot] === "ready" : false,
    stewCooked: pot ? ObjectState.current[pot] === "ready" : false,
    ate: Needs.hunger[agentEid] < 0.5,
  };
}

// =============================================================================
// MAIN TEST
// =============================================================================

async function runExtendedPuzzleTest(): Promise<void> {
  log.header("\n" + "═".repeat(70));
  log.header("  EXTENDED PUZZLE TEST - Discovery & Combination Mechanics");
  log.header("═".repeat(70));

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    log.error("\n❌ Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  const tw = setupWorld();

  log.info("\n[Setup] Extended puzzle with 5 phases:");
  log.info("  Phase 1: Stack crate → climb → reach hook → get key → unlock toolbox → get crowbar");
  log.info("  Phase 2: Pry floorboard → find rusty key → oil key");
  log.info("  Phase 3: Unlock cupboard → get vegetables → open spice jar");
  log.info("  Phase 4: Sharpen knife → chop vegetables → dry matches → light stove");
  log.info("  Phase 5: Fill pot → cook stew → eat!\n");

  // Give initial perception
  queueStimulus({
    targetEid: tw.agentEid,
    type: "observation",
    content: `You find yourself in an abandoned cellar. Your stomach growls painfully.

You see:
- A wooden CUPBOARD (LOCKED with a rusty padlock - needs a key)
- A metal TOOLBOX (LOCKED with a small padlock)
- A wooden CRATE sitting on the floor
- A HIGH HOOK on the wall - something glints on it but you can't reach
- A LOOSE FLOORBOARD
- A DULL kitchen knife
- A WHETSTONE
- WET matches (won't light!)
- A dry CLOTH
- A WOOD STOVE (cold)
- A WATER BUCKET
- An empty COOKING POT
- An OIL CAN

Goal: Find food, prepare it, cook it, and EAT to survive!`,
    source: "observation",
    modality: "cognitive",
  });

  const MAX_CYCLES = 80;  // More cycles for complex puzzle
  let solved = false;

  log.header("--- Running Cognition Cycles ---\n");

  for (let cycle = 1; cycle <= MAX_CYCLES && !solved; cycle++) {
    log.header(`[Cycle ${cycle}]`);

    const actions = await runCognitionCycle(tw.world, tw.registry, { tick: cycle });
    executeActions(tw.world, actions, tw.registry);

    // Update dependent states after each action
    updateDependentStates(tw);

    // Log actions
    for (const { eid, action } of actions) {
      const name = Name.value[eid];
      log.warn(`  ${name}: ${action.type}${action.target ? ` → ${action.target}` : ""}`);
      if (action.content) log.dim(`    "${action.content.slice(0, 60)}..."`);
    }

    // Check progress
    const progress = checkProgress(tw);
    if (progress.ate) {
      solved = true;
    }
  }

  // Final results
  log.header("\n" + "═".repeat(70));
  log.header("  TEST RESULTS");
  log.header("═".repeat(70));

  // DEBUG: Print all object states
  log.warn("\n  DEBUG - Object States:");
  for (const [name, eid] of tw.objects.entries()) {
    const state = ObjectState.current[eid];
    const traits = tw.objectManager.getTraits(eid);
    log.dim(`    ${name}: state="${state}" traits=[${traits.join(", ")}]`);
  }
  log.warn(`\n  DEBUG - Agent needs: hunger=${Needs.hunger[tw.agentEid].toFixed(2)}`);
  log.warn(`  DEBUG - Agent traits: [${tw.objectManager.getTraits(tw.agentEid).join(", ")}]`);

  const progress = checkProgress(tw);
  const steps = [
    { name: "Stacked crate", done: progress.crateStacked },
    { name: "Climbed up (elevated)", done: progress.elevated },
    { name: "Reached hook", done: progress.hookReached },
    { name: "Got toolbox key", done: progress.hasToolboxKey },
    { name: "Unlocked toolbox", done: progress.toolboxUnlocked },
    { name: "Got crowbar", done: progress.hasCrowbar },
    { name: "Pried floorboard", done: progress.floorboardPried },
    { name: "Got rusty key", done: progress.hasRustyKey },
    { name: "Oiled key", done: progress.keyOiled },
    { name: "Unlocked cupboard", done: progress.cupboardUnlocked },
    { name: "Got vegetables", done: progress.hasVegetables },
    { name: "Opened spice jar", done: progress.spiceJarOpened },
    { name: "Sharpened knife", done: progress.knifeSharpened },
    { name: "Chopped vegetables", done: progress.vegetablesChopped },
    { name: "Dried matches", done: progress.matchesDried },
    { name: "Lit stove", done: progress.stoveLit },
    { name: "Filled pot", done: progress.potFilled },
    { name: "Cooked stew", done: progress.stewCooked },
    { name: "ATE THE FOOD!", done: progress.ate },
  ];

  const completed = steps.filter(s => s.done).length;
  log.info(`\n  Total steps: ${steps.length}`);
  log.info(`  Puzzle solved: ${solved ? "YES" : "NO"}`);

  log.header("\n  Progress:");
  for (const step of steps) {
    if (step.done) {
      log.success(`    ✓ ${step.name}`);
    } else {
      log.info(`    ○ ${step.name}`);
    }
  }

  log.header("\n" + "═".repeat(70));
  if (solved) {
    log.success(`  ✓ TEST PASSED - Completed ${completed}/${steps.length} steps`);
  } else {
    log.error(`  ✗ TEST INCOMPLETE - Completed ${completed}/${steps.length} steps`);
    log.info("\n  NOTE: Complex puzzle - may need prompt tuning or more cycles.");
  }
  log.header("═".repeat(70) + "\n");

  process.exit(solved ? 0 : 1);
}

runExtendedPuzzleTest().catch(console.error);
