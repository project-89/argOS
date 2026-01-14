/**
 * Multi-Step Puzzle Room Test
 *
 * A single room with a complex puzzle chain:
 * 1. Agent is STARVING
 * 2. Food is in a LOCKED cupboard
 * 3. Key is HIDDEN under a loose floorboard
 * 4. Floorboard needs to be pried up with a tool
 * 5. Once food is obtained, it must be COOKED:
 *    - Light the stove (need matches)
 *    - Chop ingredients (need knife)
 *    - Cook in pan on stove
 *    - Eat the cooked meal
 *
 * Tests:
 * - Multi-step planning and reasoning
 * - Object state tracking (locked, hidden, raw, cooked)
 * - Deterministic cooking system
 * - Goal decomposition
 */

import "dotenv/config";
import { createWorld, addEntity, addComponent, query, hasComponent, getRelationTargets } from "bitecs";
import {
  Agent, Mind, Name, Needs, Room, Goal, Description, Inventory,
  Item, AllComponents
} from "../ecs/components";
import {
  OccupiesRoom, HasGoal, Contains, AllRelations
} from "../ecs/relations";
import type { SystemContext, SystemDefinition } from "../ecs/dynamic-systems";
import {
  formatActionsForPrompt,
  getValidActionTypes,
  ActionRegistry,
} from "../cognition/action-registry";
import {
  agentThink,
  addPerception,
  type AgentAction,
} from "../cognition/agent-mind";

// =============================================================================
// TERMINAL COLORS
// =============================================================================

const c = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

const log = {
  header: (s: string) => console.log(`${c.bright}${c.white}${s}${c.reset}`),
  success: (s: string) => console.log(`${c.green}${s}${c.reset}`),
  error: (s: string) => console.log(`${c.red}${s}${c.reset}`),
  info: (s: string) => console.log(`${c.cyan}${s}${c.reset}`),
  thought: (s: string) => console.log(`${c.dim}${s}${c.reset}`),
  action: (s: string) => console.log(`${c.yellow}${s}${c.reset}`),
  agent: (s: string) => console.log(`${c.magenta}${s}${c.reset}`),
  system: (s: string) => console.log(`${c.blue}${s}${c.reset}`),
};

// =============================================================================
// PUZZLE STATE - Tracks all object states
// =============================================================================

interface PuzzleState {
  // Containers
  cupboardLocked: boolean;
  cupboardOpen: boolean;

  // Hidden items
  floorboardLifted: boolean;
  keyRevealed: boolean;

  // Cooking state
  stoveLit: boolean;
  panOnStove: boolean;
  ingredientsChopped: boolean;
  foodCooked: boolean;

  // Inventory tracking
  hasKey: boolean;
  hasKnife: boolean;
  hasPan: boolean;
  hasMatches: boolean;
  hasCrowbar: boolean;
  hasRawFood: boolean;
  hasChoppedFood: boolean;
  hasCookedFood: boolean;

  // Progress
  hungerSatisfied: boolean;

  // Action log
  actionsPerformed: string[];
}

function createInitialPuzzleState(): PuzzleState {
  return {
    cupboardLocked: true,
    cupboardOpen: false,
    floorboardLifted: false,
    keyRevealed: false,
    stoveLit: false,
    panOnStove: false,
    ingredientsChopped: false,
    foodCooked: false,
    hasKey: false,
    hasKnife: false,
    hasPan: false,
    hasMatches: false,
    hasCrowbar: false,
    hasRawFood: false,
    hasChoppedFood: false,
    hasCookedFood: false,
    hungerSatisfied: false,
    actionsPerformed: [],
  };
}

// =============================================================================
// PUZZLE WORLD SETUP
// =============================================================================

interface PuzzleWorld {
  world: any;
  agentEid: number;
  roomEid: number;
  state: PuzzleState;
  objects: Map<string, number>;
}

function setupPuzzleWorld(): PuzzleWorld {
  const world = createWorld();
  const state = createInitialPuzzleState();
  const objects = new Map<string, number>();

  // Create the kitchen room
  const roomEid = addEntity(world);
  addComponent(world, roomEid, Room);
  addComponent(world, roomEid, Name);
  addComponent(world, roomEid, Description);
  Name.value[roomEid] = "Old Kitchen";
  Description.value[roomEid] = "A dusty old kitchen. You're starving and desperately need food.";
  Room.capacity[roomEid] = 10;
  Room.ambience[roomEid] = "Your stomach growls painfully. The smell of old wood fills the air.";

  // Create the agent - STARVING
  const agentEid = addEntity(world);
  addComponent(world, agentEid, Agent);
  addComponent(world, agentEid, Mind);
  addComponent(world, agentEid, Name);
  addComponent(world, agentEid, Needs);
  addComponent(world, agentEid, Description);
  addComponent(world, agentEid, Inventory);
  addComponent(world, agentEid, OccupiesRoom(roomEid));

  Name.value[agentEid] = "Viktor";
  Description.value[agentEid] = "Viktor, a hungry traveler trapped in an old kitchen";
  Agent.role[agentEid] = "survivor";
  Agent.active[agentEid] = true;
  Agent.systemPrompt[agentEid] = `You are Viktor, a traveler who hasn't eaten in days. You are STARVING.
You must find food and eat it to survive. Think step by step about what you need to do.
Examine your surroundings carefully. Some things may be hidden or locked.
You'll need to solve puzzles to access food, and then cook it properly before eating.`;

  Mind.mode[agentEid] = "active";
  Mind.arousal[agentEid] = 0.9; // High urgency
  Mind.focus[agentEid] = "desperate for food";
  Mind.lastUpdate[agentEid] = 0;

  Needs.hunger[agentEid] = 0.95; // CRITICAL hunger
  Needs.energy[agentEid] = 0.4;
  Needs.social[agentEid] = 0.1;
  Needs.comfort[agentEid] = 0.2;

  Inventory.items[agentEid] = "[]";
  Inventory.maxSlots[agentEid] = 10;
  Inventory.weight[agentEid] = 0;
  Inventory.maxWeight[agentEid] = 50;

  // Helper to create objects
  const createObject = (name: string, desc: string): number => {
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Description);
    addComponent(world, eid, Item);
    addComponent(world, roomEid, Contains(eid));

    Name.value[eid] = name;
    Description.value[eid] = desc;
    Item.category[eid] = "object";
    Item.quantity[eid] = 1;
    Item.weight[eid] = 1;
    Item.stackable[eid] = false;
    Item.maxStack[eid] = 1;

    objects.set(name.toLowerCase(), eid);
    return eid;
  };

  // === THE PUZZLE OBJECTS ===

  // The locked cupboard (contains food)
  createObject("Cupboard", "A tall wooden cupboard with a rusty lock. Through the crack you can see food inside!");

  // The loose floorboard (hides the key)
  createObject("Loose Floorboard", "One of the floorboards looks loose and slightly raised. Something might be underneath.");

  // Tools scattered around
  createObject("Crowbar", "A sturdy iron crowbar leaning against the wall. Useful for prying things.");
  createObject("Matches", "A box of matches on the windowsill.");
  createObject("Kitchen Knife", "A sharp kitchen knife on the counter.");
  createObject("Cooking Pan", "A cast iron pan hanging on a hook.");

  // The stove
  createObject("Wood Stove", "An old wood-burning stove. It's cold - needs to be lit.");

  // Food items (will be "revealed" when cupboard opens)
  createObject("Raw Vegetables", "Fresh carrots, onions, and potatoes. Need to be chopped and cooked.");
  // Note: Raw vegetables start "in cupboard" - agent can't get them until cupboard is unlocked

  // The key (hidden under floorboard - not directly visible until floorboard is lifted)
  createObject("Rusty Key", "A small rusty key. Looks like it might fit the cupboard lock.");

  // Create goal
  const goalEid = addEntity(world);
  addComponent(world, goalEid, Goal);
  addComponent(world, agentEid, HasGoal(goalEid));
  Goal.description[goalEid] = "Find food and eat to survive";
  Goal.priority[goalEid] = 10;
  Goal.status[goalEid] = "active";
  Goal.progress[goalEid] = 0;
  Goal.deadline[goalEid] = 0;

  return { world, agentEid, roomEid, state, objects };
}

// =============================================================================
// DETERMINISTIC PUZZLE SYSTEMS
// =============================================================================

/**
 * Process an action and update puzzle state
 * Returns a description of what happened
 */
function processPuzzleAction(
  pw: PuzzleWorld,
  action: AgentAction
): { success: boolean; result: string; stateChanges: string[] } {
  const state = pw.state;
  const changes: string[] = [];

  const actionKey = `${action.type}:${action.target || ""}`.toLowerCase();
  state.actionsPerformed.push(actionKey);

  // === EXAMINE ACTIONS ===
  if (action.type === "examine" || action.type === "observe") {
    const target = (action.target || "").toLowerCase();

    if (target.includes("cupboard")) {
      if (state.cupboardLocked) {
        return { success: true, result: "The cupboard is locked tight. You can see food through the crack - vegetables! But you need a key.", stateChanges: [] };
      } else if (state.cupboardOpen) {
        return { success: true, result: "The cupboard is open. Inside you see raw vegetables.", stateChanges: [] };
      }
    }

    if (target.includes("floorboard")) {
      if (!state.floorboardLifted) {
        return { success: true, result: "The floorboard is loose. You could pry it up with something sturdy like a crowbar.", stateChanges: [] };
      } else {
        if (state.keyRevealed && !state.hasKey) {
          return { success: true, result: "Under the lifted floorboard, you see a rusty key!", stateChanges: [] };
        }
        return { success: true, result: "The floorboard has been pried up. The space underneath is empty now.", stateChanges: [] };
      }
    }

    if (target.includes("stove")) {
      if (state.stoveLit) {
        return { success: true, result: "The stove is burning nicely, ready for cooking.", stateChanges: [] };
      }
      return { success: true, result: "The wood stove is cold. You'll need matches to light it.", stateChanges: [] };
    }

    if (target.includes("key") && state.keyRevealed) {
      return { success: true, result: "A rusty key that might fit the cupboard lock.", stateChanges: [] };
    }

    return { success: true, result: `You examine the ${action.target}.`, stateChanges: [] };
  }

  // === PICKUP ACTIONS ===
  if (action.type === "pickup") {
    const target = (action.target || "").toLowerCase();

    if (target.includes("crowbar") && !state.hasCrowbar) {
      state.hasCrowbar = true;
      changes.push("Picked up crowbar");
      return { success: true, result: "You pick up the sturdy crowbar. This could pry things open.", stateChanges: changes };
    }

    if (target.includes("matches") && !state.hasMatches) {
      state.hasMatches = true;
      changes.push("Picked up matches");
      return { success: true, result: "You pick up the box of matches.", stateChanges: changes };
    }

    if (target.includes("knife") && !state.hasKnife) {
      state.hasKnife = true;
      changes.push("Picked up knife");
      return { success: true, result: "You pick up the sharp kitchen knife.", stateChanges: changes };
    }

    if (target.includes("pan") && !state.hasPan) {
      state.hasPan = true;
      changes.push("Picked up pan");
      return { success: true, result: "You take the cast iron pan off its hook.", stateChanges: changes };
    }

    if (target.includes("key") && state.keyRevealed && !state.hasKey) {
      state.hasKey = true;
      changes.push("Picked up key");
      return { success: true, result: "You pick up the rusty key from under the floorboard!", stateChanges: changes };
    }

    if (target.includes("vegetable") || target.includes("food")) {
      if (!state.cupboardOpen) {
        return { success: false, result: "The vegetables are inside the locked cupboard. You can't reach them.", stateChanges: [] };
      }
      if (!state.hasRawFood) {
        state.hasRawFood = true;
        changes.push("Got raw vegetables");
        return { success: true, result: "You take the raw vegetables from the cupboard.", stateChanges: changes };
      }
    }

    return { success: false, result: `You can't pick up ${action.target} right now.`, stateChanges: [] };
  }

  // === USE/INTERACT ACTIONS ===
  if (action.type === "use" || action.type === "interact") {
    const target = (action.target || "").toLowerCase();
    const content = (action.content || "").toLowerCase();

    // Use crowbar on floorboard
    if ((target.includes("crowbar") && content.includes("floorboard")) ||
        (target.includes("floorboard") && state.hasCrowbar)) {
      if (!state.hasCrowbar) {
        return { success: false, result: "You need a crowbar to pry up the floorboard.", stateChanges: [] };
      }
      if (!state.floorboardLifted) {
        state.floorboardLifted = true;
        state.keyRevealed = true;
        changes.push("Floorboard lifted", "Key revealed");
        return { success: true, result: "You pry up the loose floorboard with the crowbar. Underneath, you discover a rusty key!", stateChanges: changes };
      }
      return { success: false, result: "The floorboard is already lifted.", stateChanges: [] };
    }

    // Use key on cupboard
    if ((target.includes("key") && content.includes("cupboard")) ||
        (target.includes("cupboard") && state.hasKey)) {
      if (!state.hasKey) {
        return { success: false, result: "You need a key to unlock the cupboard.", stateChanges: [] };
      }
      if (state.cupboardLocked) {
        state.cupboardLocked = false;
        state.cupboardOpen = true;
        changes.push("Cupboard unlocked", "Cupboard opened");
        return { success: true, result: "The rusty key fits! You unlock and open the cupboard, revealing raw vegetables inside!", stateChanges: changes };
      }
      return { success: false, result: "The cupboard is already unlocked.", stateChanges: [] };
    }

    // Light stove with matches
    if ((target.includes("matches") && content.includes("stove")) ||
        (target.includes("stove") && state.hasMatches)) {
      if (!state.hasMatches) {
        return { success: false, result: "You need matches to light the stove.", stateChanges: [] };
      }
      if (!state.stoveLit) {
        state.stoveLit = true;
        changes.push("Stove lit");
        return { success: true, result: "You strike a match and light the wood stove. Flames crackle to life!", stateChanges: changes };
      }
      return { success: false, result: "The stove is already lit.", stateChanges: [] };
    }

    // Put pan on stove
    if (target.includes("pan") && (content.includes("stove") || target.includes("stove"))) {
      if (!state.hasPan) {
        return { success: false, result: "You need to pick up the pan first.", stateChanges: [] };
      }
      if (!state.stoveLit) {
        return { success: false, result: "The stove isn't lit. Light it first.", stateChanges: [] };
      }
      if (!state.panOnStove) {
        state.panOnStove = true;
        changes.push("Pan on stove");
        return { success: true, result: "You place the pan on the hot stove. It starts to heat up.", stateChanges: changes };
      }
      return { success: false, result: "The pan is already on the stove.", stateChanges: [] };
    }

    // Cook chopped vegetables in pan (CHECK THIS FIRST - before chop)
    // Matches: "use chopped vegetables in pan", "cook vegetables", etc.
    if ((target.includes("chopped") || (target.includes("vegetable") && state.hasChoppedFood)) &&
        (content.includes("cook") || content.includes("pan") || content.includes("stove") || state.panOnStove)) {
      if (!state.hasChoppedFood) {
        return { success: false, result: "You need chopped vegetables to cook.", stateChanges: [] };
      }
      if (!state.panOnStove) {
        return { success: false, result: "You need to put a pan on the lit stove first.", stateChanges: [] };
      }
      if (!state.foodCooked) {
        state.foodCooked = true;
        state.hasChoppedFood = false;
        state.hasCookedFood = true;
        changes.push("Food cooked!");
        return { success: true, result: "The vegetables sizzle in the pan. After a few minutes, you have a delicious cooked meal!", stateChanges: changes };
      }
      return { success: false, result: "The food is already cooked.", stateChanges: [] };
    }

    // Chop vegetables with knife (only if we have RAW food, not chopped)
    if ((target.includes("knife") && (content.includes("vegetable") || content.includes("chop"))) ||
        (target.includes("vegetable") && state.hasKnife && state.hasRawFood)) {
      if (!state.hasKnife) {
        return { success: false, result: "You need a knife to chop the vegetables.", stateChanges: [] };
      }
      if (!state.hasRawFood) {
        return { success: false, result: "You don't have any raw vegetables to chop.", stateChanges: [] };
      }
      if (!state.ingredientsChopped) {
        state.ingredientsChopped = true;
        state.hasRawFood = false;
        state.hasChoppedFood = true;
        changes.push("Vegetables chopped");
        return { success: true, result: "You skillfully chop the vegetables into small pieces, ready for cooking.", stateChanges: changes };
      }
      return { success: false, result: "The vegetables are already chopped.", stateChanges: [] };
    }

    // Eat cooked food
    if (target.includes("cooked") || (target.includes("food") && state.hasCookedFood) ||
        (target.includes("meal") && state.hasCookedFood)) {
      if (!state.hasCookedFood) {
        return { success: false, result: "You don't have any cooked food to eat.", stateChanges: [] };
      }
      state.hasCookedFood = false;
      state.hungerSatisfied = true;
      changes.push("HUNGER SATISFIED!");
      return { success: true, result: "You devour the hot meal. Warmth spreads through your body. You're no longer starving!", stateChanges: changes };
    }

    // Try to eat raw food (should fail)
    if (target.includes("raw") || (target.includes("vegetable") && state.hasRawFood && !state.hasChoppedFood)) {
      return { success: false, result: "You can't eat raw vegetables like this. You need to chop and cook them first.", stateChanges: [] };
    }
  }

  // === EAT ACTION ===
  if (action.type === "eat") {
    if (state.hasCookedFood) {
      state.hasCookedFood = false;
      state.hungerSatisfied = true;
      changes.push("HUNGER SATISFIED!");
      return { success: true, result: "You eat the delicious cooked meal. Your hunger is finally satisfied!", stateChanges: changes };
    }
    if (state.hasChoppedFood) {
      return { success: false, result: "The vegetables are chopped but raw. You should cook them first.", stateChanges: [] };
    }
    if (state.hasRawFood) {
      return { success: false, result: "You can't eat raw vegetables. Chop and cook them first.", stateChanges: [] };
    }
    return { success: false, result: "You don't have any food to eat.", stateChanges: [] };
  }

  return { success: true, result: `You ${action.type}${action.target ? ` ${action.target}` : ""}.`, stateChanges: [] };
}

// =============================================================================
// DYNAMIC PERCEPTION BASED ON STATE
// =============================================================================

function generateStatePerception(pw: PuzzleWorld): string {
  const state = pw.state;
  const lines: string[] = [];

  lines.push("You look around the old kitchen:");

  // Cupboard state
  if (state.cupboardLocked) {
    lines.push("- A tall CUPBOARD with a rusty lock. You can see food through the crack!");
  } else if (state.cupboardOpen) {
    if (state.hasRawFood || state.hasChoppedFood || state.hasCookedFood) {
      lines.push("- The CUPBOARD is open and empty now.");
    } else {
      lines.push("- The CUPBOARD is open. Raw vegetables are visible inside.");
    }
  }

  // Floorboard state
  if (!state.floorboardLifted) {
    lines.push("- A LOOSE FLOORBOARD that looks like it could be pried up.");
  } else if (state.keyRevealed && !state.hasKey) {
    lines.push("- The floorboard is lifted. A RUSTY KEY glints underneath!");
  } else {
    lines.push("- A lifted floorboard with an empty space beneath.");
  }

  // Tools
  if (!state.hasCrowbar) lines.push("- A sturdy CROWBAR leaning against the wall.");
  if (!state.hasMatches) lines.push("- A box of MATCHES on the windowsill.");
  if (!state.hasKnife) lines.push("- A sharp KITCHEN KNIFE on the counter.");
  if (!state.hasPan) lines.push("- A COOKING PAN hanging on a hook.");

  // Stove state
  if (state.stoveLit) {
    if (state.panOnStove) {
      lines.push("- The WOOD STOVE is burning with a hot pan on it.");
    } else {
      lines.push("- The WOOD STOVE is burning, ready for cooking.");
    }
  } else {
    lines.push("- A cold WOOD STOVE that needs to be lit.");
  }

  // Inventory
  const inv: string[] = [];
  if (state.hasKey) inv.push("rusty key");
  if (state.hasCrowbar) inv.push("crowbar");
  if (state.hasMatches) inv.push("matches");
  if (state.hasKnife) inv.push("knife");
  if (state.hasPan && !state.panOnStove) inv.push("pan");
  if (state.hasRawFood) inv.push("raw vegetables");
  if (state.hasChoppedFood) inv.push("chopped vegetables");
  if (state.hasCookedFood) inv.push("cooked meal");

  if (inv.length > 0) {
    lines.push(`\nYou are carrying: ${inv.join(", ")}`);
  }

  // NO HINTS - let the AI figure it out!
  // The AI must reason from:
  // - Visual descriptions of objects and their states
  // - Its critical hunger need
  // - What it's carrying
  // - Feedback from previous actions

  return lines.join("\n");
}

// Configuration
const ENABLE_HINTS = false; // Set to true for easy mode

// =============================================================================
// MAIN TEST
// =============================================================================

async function runPuzzleRoomTest(): Promise<void> {
  log.header("\n" + "═".repeat(70));
  log.header("  MULTI-STEP PUZZLE ROOM TEST");
  log.header("  Locked cupboard → Hidden key → Cook food → Eat");
  log.header("═".repeat(70));

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    log.error("\n❌ Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  // Setup
  const pw = setupPuzzleWorld();

  log.info("\n[Setup] Viktor (95% hunger - CRITICAL) in Old Kitchen");
  log.info("  Puzzle: Food locked in cupboard → Key hidden under floorboard");
  log.info("  Goal: Find key, unlock cupboard, get food, cook it, eat it\n");

  // Show initial state
  log.header("--- Initial Room State ---");
  const initialPerception = generateStatePerception(pw);
  console.log(initialPerception);

  // Add perception to agent
  addPerception(pw.world, pw.agentEid, {
    type: "visual",
    content: initialPerception,
    source: "observation",
  });

  // Show affordances
  log.header("\n--- Available Actions ---");
  const affordancePrompt = formatActionsForPrompt(pw.world, pw.agentEid);
  console.log(affordancePrompt);

  const validTypes = getValidActionTypes(pw.world, pw.agentEid);
  log.info(`Valid action types: ${validTypes.join(", ")}`);

  // Run cognitive cycles until puzzle is solved or max cycles
  log.header("\n--- Solving the Puzzle ---\n");

  const MAX_CYCLES = 20;
  const actions: AgentAction[] = [];
  const invalidActions: string[] = [];

  for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
    if (pw.state.hungerSatisfied) {
      log.success(`\n🎉 PUZZLE SOLVED in ${cycle - 1} steps!`);
      break;
    }

    log.agent(`\n[Step ${cycle}] Viktor thinks...\n`);

    // Update perception based on current state
    const currentPerception = generateStatePerception(pw);
    addPerception(pw.world, pw.agentEid, {
      type: "visual",
      content: currentPerception,
      source: "observation",
    });

    try {
      const action = await agentThink(pw.world, pw.agentEid);
      actions.push(action);

      // Validate action type
      if (!validTypes.includes(action.type)) {
        invalidActions.push(action.type);
        log.error(`  INVALID ACTION TYPE: ${action.type}`);
      }

      // Show thought
      log.thought(`  💭 "${(action as any).reasoning?.slice(0, 80) || "thinking..."}"`);

      // Show action
      const actionStr = `${action.type}${action.target ? ` → ${action.target}` : ""}${action.content ? `: "${action.content.slice(0, 40)}..."` : ""}`;
      log.action(`  → ${actionStr}`);

      // Process the action through puzzle system
      const result = processPuzzleAction(pw, action);

      // Show result
      if (result.success) {
        log.success(`  ✓ ${result.result}`);
      } else {
        log.error(`  ✗ ${result.result}`);
      }

      // Show state changes
      if (result.stateChanges.length > 0) {
        log.system(`  [State] ${result.stateChanges.join(", ")}`);
      }

      // Add result as perception for next cycle
      addPerception(pw.world, pw.agentEid, {
        type: "feedback",
        content: result.result,
        source: "action_result",
      });

      // Small delay between cycles
      await new Promise(r => setTimeout(r, 500));

    } catch (error) {
      log.error(`  Error: ${error}`);
    }
  }

  // Final report
  log.header("\n" + "═".repeat(70));
  log.header("  TEST RESULTS");
  log.header("═".repeat(70));

  const solved = pw.state.hungerSatisfied;

  log.info(`\n  Total actions: ${actions.length}`);
  log.info(`  Invalid actions: ${invalidActions.length}`);
  log.info(`  Puzzle solved: ${solved ? "YES" : "NO"}`);

  // Show puzzle progress
  log.header("\n  Puzzle Progress:");
  const steps = [
    { name: "Found crowbar", done: pw.state.hasCrowbar || pw.state.floorboardLifted },
    { name: "Lifted floorboard", done: pw.state.floorboardLifted },
    { name: "Got key", done: pw.state.hasKey || !pw.state.cupboardLocked },
    { name: "Unlocked cupboard", done: !pw.state.cupboardLocked },
    { name: "Got vegetables", done: pw.state.hasRawFood || pw.state.hasChoppedFood || pw.state.hasCookedFood || pw.state.hungerSatisfied },
    { name: "Got knife", done: pw.state.hasKnife || pw.state.ingredientsChopped },
    { name: "Chopped vegetables", done: pw.state.ingredientsChopped || pw.state.hasCookedFood || pw.state.hungerSatisfied },
    { name: "Got matches", done: pw.state.hasMatches || pw.state.stoveLit },
    { name: "Lit stove", done: pw.state.stoveLit },
    { name: "Put pan on stove", done: pw.state.panOnStove },
    { name: "Cooked food", done: pw.state.foodCooked || pw.state.hungerSatisfied },
    { name: "ATE THE FOOD", done: pw.state.hungerSatisfied },
  ];

  for (const step of steps) {
    const icon = step.done ? "✓" : "○";
    const color = step.done ? log.success : log.info;
    color(`    ${icon} ${step.name}`);
  }

  // Action sequence
  log.header("\n  Action Sequence:");
  for (let i = 0; i < Math.min(actions.length, 15); i++) {
    const a = actions[i];
    log.info(`    ${i + 1}. ${a.type}${a.target ? ` → ${a.target}` : ""}`);
  }
  if (actions.length > 15) {
    log.info(`    ... and ${actions.length - 15} more`);
  }

  log.header("\n" + "═".repeat(70));
  if (solved) {
    log.success("  ✓ TEST PASSED - Viktor solved the puzzle and ate!");
  } else {
    log.error("  ✗ TEST INCOMPLETE - Viktor didn't finish the puzzle");
    log.info("  (This is expected if AI needs more guidance on multi-step puzzles)");
  }
  log.header("═".repeat(70) + "\n");

  process.exit(solved ? 0 : 1);
}

// Run the test
runPuzzleRoomTest().catch(error => {
  log.error(`Fatal error: ${error}`);
  process.exit(1);
});
