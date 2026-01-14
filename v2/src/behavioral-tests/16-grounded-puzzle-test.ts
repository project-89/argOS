/**
 * Grounded Multi-Step Puzzle Test
 *
 * Fixes the issues from the previous test:
 * 1. CLEAR ACTION FEEDBACK - AI sees exactly what happened (like tool use)
 * 2. PLANNING PHASE - AI can "think through" problems before acting
 * 3. STATE IN DESCRIPTIONS - Objects clearly describe their current state
 * 4. NO HALLUCINATION - Results are explicit and unambiguous
 *
 * The puzzle is the same, but the interaction model is grounded:
 * - AI proposes action
 * - System returns EXPLICIT result
 * - AI sees result before next thought
 * - AI can use "plan" action to reason without side effects
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
import {
  agentThink,
  addPerception,
  type AgentAction,
} from "../cognition/agent-mind";

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
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

const log = {
  header: (s: string) => console.log(`${c.bright}${s}${c.reset}`),
  success: (s: string) => console.log(`${c.green}${s}${c.reset}`),
  error: (s: string) => console.log(`${c.red}${s}${c.reset}`),
  info: (s: string) => console.log(`${c.cyan}${s}${c.reset}`),
  action: (s: string) => console.log(`${c.yellow}${s}${c.reset}`),
  result: (s: string) => console.log(`${c.blue}${s}${c.reset}`),
  thought: (s: string) => console.log(`${c.dim}${s}${c.reset}`),
  plan: (s: string) => console.log(`${c.magenta}${s}${c.reset}`),
};

// =============================================================================
// PUZZLE STATE WITH RICH DESCRIPTIONS
// =============================================================================

interface PuzzleState {
  // Object states
  cupboardLocked: boolean;
  floorboardLifted: boolean;
  stoveLit: boolean;
  panOnStove: boolean;
  vegetablesChopped: boolean;
  vegetablesCooked: boolean;

  // Inventory
  inventory: Set<string>;

  // Win condition
  hungerSatisfied: boolean;

  // Tracking
  actionsLog: string[];
  planningThoughts: string[];
}

function createState(): PuzzleState {
  return {
    cupboardLocked: true,
    floorboardLifted: false,
    stoveLit: false,
    panOnStove: false,
    vegetablesChopped: false,
    vegetablesCooked: false,
    inventory: new Set(),
    hungerSatisfied: false,
    actionsLog: [],
    planningThoughts: [],
  };
}

// =============================================================================
// GENERATE RICH STATE DESCRIPTION
// Objects clearly describe their state so AI can reason about them
// =============================================================================

function describeWorld(state: PuzzleState): string {
  const lines: string[] = [];

  lines.push("=== CURRENT SITUATION ===");
  lines.push("You are in an old kitchen. You are STARVING (95% hunger - CRITICAL).");
  lines.push("");

  // Cupboard - clearly states locked status and what's visible
  lines.push("CUPBOARD:");
  if (state.cupboardLocked) {
    lines.push("  - Status: LOCKED with a rusty padlock");
    lines.push("  - You can see through a crack: there are vegetables inside!");
    lines.push("  - The lock has a KEYHOLE - you need a KEY to open it");
    lines.push("  - (A crowbar won't work on this lock)");
  } else {
    if (!state.inventory.has("raw_vegetables")) {
      lines.push("  - Status: OPEN");
      lines.push("  - Contents: Raw vegetables (carrots, onions, potatoes)");
    } else {
      lines.push("  - Status: OPEN and EMPTY");
    }
  }
  lines.push("");

  // Floorboard - hints at something underneath
  lines.push("LOOSE FLOORBOARD:");
  if (!state.floorboardLifted) {
    lines.push("  - One floorboard is loose and slightly raised");
    lines.push("  - It looks like something might be hidden underneath");
    lines.push("  - You could pry it up with a tool like a crowbar");
  } else {
    if (!state.inventory.has("rusty_key")) {
      lines.push("  - The floorboard has been pried up");
      lines.push("  - Underneath: A RUSTY KEY!");
    } else {
      lines.push("  - The floorboard has been pried up (empty space underneath)");
    }
  }
  lines.push("");

  // Stove
  lines.push("WOOD STOVE:");
  if (!state.stoveLit) {
    lines.push("  - Status: COLD (not lit)");
    lines.push("  - You need MATCHES to light it");
  } else {
    lines.push("  - Status: BURNING (ready for cooking)");
  }
  if (state.panOnStove) {
    if (state.vegetablesCooked) {
      lines.push("  - The pan contains: COOKED VEGETABLES (ready to eat!)");
    } else if (state.vegetablesChopped && state.inventory.has("chopped_vegetables")) {
      lines.push("  - The pan is empty and hot");
    } else {
      lines.push("  - An empty pan is heating on the stove");
    }
  }
  lines.push("");

  // Tools available
  lines.push("TOOLS IN THE ROOM:");
  if (!state.inventory.has("crowbar")) {
    lines.push("  - CROWBAR: A sturdy iron crowbar (good for prying things)");
  }
  if (!state.inventory.has("matches")) {
    lines.push("  - MATCHES: A box of matches (for lighting fires)");
  }
  if (!state.inventory.has("knife")) {
    lines.push("  - KITCHEN KNIFE: Sharp knife (for cutting/chopping food)");
  }
  if (!state.inventory.has("pan") && !state.panOnStove) {
    lines.push("  - COOKING PAN: Cast iron pan (for cooking food)");
  }
  lines.push("");

  // Inventory
  lines.push("YOUR INVENTORY:");
  if (state.inventory.size === 0) {
    lines.push("  - (empty)");
  } else {
    for (const item of state.inventory) {
      const itemName = item.replace(/_/g, " ").toUpperCase();
      lines.push(`  - ${itemName}`);
    }
  }
  lines.push("");

  // Goal reminder
  lines.push("YOUR GOAL: Find food, cook it, and eat it to survive!");
  lines.push("");

  return lines.join("\n");
}

// =============================================================================
// ACTION PROCESSING WITH EXPLICIT RESULTS
// Returns clear, unambiguous feedback
// =============================================================================

interface ActionResult {
  success: boolean;
  message: string;
  stateChange?: string;
}

function processAction(state: PuzzleState, action: AgentAction): ActionResult {
  const type = action.type.toLowerCase();
  const target = (action.target || "").toLowerCase();
  const content = (action.content || "").toLowerCase();

  state.actionsLog.push(`${type} ${target} ${content}`.trim());

  // === PLAN/THINK ACTION - No side effects, just reasoning ===
  if (type === "think" || type === "plan" || type === "reflect") {
    state.planningThoughts.push(action.content || "");
    return {
      success: true,
      message: `[PLANNING] You think: "${action.content}"`,
    };
  }

  // === EXAMINE/OBSERVE ===
  if (type === "examine" || type === "observe") {
    if (target.includes("cupboard")) {
      if (state.cupboardLocked) {
        return { success: true, message: "EXAMINE RESULT: The cupboard is LOCKED. It has a rusty padlock with a keyhole. Through a crack, you can see vegetables inside. You need a KEY to open it - a crowbar won't work on this type of lock." };
      } else {
        return { success: true, message: "EXAMINE RESULT: The cupboard is OPEN. " + (state.inventory.has("raw_vegetables") ? "It's empty now." : "Raw vegetables are inside.") };
      }
    }
    if (target.includes("floorboard")) {
      if (!state.floorboardLifted) {
        return { success: true, message: "EXAMINE RESULT: The floorboard is loose. You could pry it up with something sturdy like a CROWBAR. There might be something hidden underneath." };
      } else {
        return { success: true, message: "EXAMINE RESULT: The floorboard has been pried up. " + (state.inventory.has("rusty_key") ? "The space underneath is empty." : "A RUSTY KEY is visible underneath!") };
      }
    }
    if (target.includes("stove")) {
      return { success: true, message: `EXAMINE RESULT: The wood stove is ${state.stoveLit ? "LIT and burning" : "COLD - needs matches to light"}. ${state.panOnStove ? "A pan is on it." : ""}` };
    }
    return { success: true, message: `EXAMINE RESULT: You look at ${action.target}.` };
  }

  // === PICKUP ===
  if (type === "pickup") {
    if (target.includes("crowbar") && !state.inventory.has("crowbar")) {
      state.inventory.add("crowbar");
      return { success: true, message: "PICKUP SUCCESS: You picked up the CROWBAR.", stateChange: "+crowbar" };
    }
    if (target.includes("matches") && !state.inventory.has("matches")) {
      state.inventory.add("matches");
      return { success: true, message: "PICKUP SUCCESS: You picked up the MATCHES.", stateChange: "+matches" };
    }
    if (target.includes("knife") && !state.inventory.has("knife")) {
      state.inventory.add("knife");
      return { success: true, message: "PICKUP SUCCESS: You picked up the KITCHEN KNIFE.", stateChange: "+knife" };
    }
    if (target.includes("pan") && !state.inventory.has("pan") && !state.panOnStove) {
      state.inventory.add("pan");
      return { success: true, message: "PICKUP SUCCESS: You picked up the COOKING PAN.", stateChange: "+pan" };
    }
    if (target.includes("key")) {
      if (!state.floorboardLifted) {
        return { success: false, message: "PICKUP FAILED: You don't see any key. (Maybe check under things?)" };
      }
      if (state.inventory.has("rusty_key")) {
        return { success: false, message: "PICKUP FAILED: You already have the key." };
      }
      state.inventory.add("rusty_key");
      return { success: true, message: "PICKUP SUCCESS: You picked up the RUSTY KEY from under the floorboard!", stateChange: "+rusty_key" };
    }
    if (target.includes("vegetable") || target.includes("food")) {
      if (state.cupboardLocked) {
        return { success: false, message: "PICKUP FAILED: The vegetables are inside the LOCKED cupboard. You need to UNLOCK it first with a KEY." };
      }
      if (state.inventory.has("raw_vegetables")) {
        return { success: false, message: "PICKUP FAILED: You already have the vegetables." };
      }
      state.inventory.add("raw_vegetables");
      return { success: true, message: "PICKUP SUCCESS: You took the RAW VEGETABLES from the cupboard.", stateChange: "+raw_vegetables" };
    }
    if (target.includes("cooked")) {
      if (!state.vegetablesCooked) {
        return { success: false, message: "PICKUP FAILED: There's no cooked food yet." };
      }
      state.inventory.add("cooked_meal");
      return { success: true, message: "PICKUP SUCCESS: You took the COOKED MEAL from the pan.", stateChange: "+cooked_meal" };
    }
    return { success: false, message: `PICKUP FAILED: Can't pick up "${action.target}".` };
  }

  // === USE ===
  if (type === "use" || type === "interact") {
    // Crowbar on floorboard
    if ((target.includes("crowbar") && content.includes("floor")) ||
        (target.includes("floor") && state.inventory.has("crowbar"))) {
      if (!state.inventory.has("crowbar")) {
        return { success: false, message: "USE FAILED: You don't have a crowbar. Pick it up first." };
      }
      if (state.floorboardLifted) {
        return { success: false, message: "USE FAILED: The floorboard is already pried up." };
      }
      state.floorboardLifted = true;
      return { success: true, message: "USE SUCCESS: You pry up the loose floorboard with the crowbar. Underneath you find a RUSTY KEY!", stateChange: "floorboard_lifted" };
    }

    // Crowbar on cupboard (should fail - needs key!)
    if (target.includes("crowbar") && content.includes("cupboard")) {
      return { success: false, message: "USE FAILED: The cupboard has a padlock with a keyhole. A crowbar won't work - you need a KEY to unlock it." };
    }
    if (target.includes("cupboard") && state.inventory.has("crowbar") && !content.includes("key")) {
      return { success: false, message: "USE FAILED: The cupboard has a padlock. You can't pry it open - you need a KEY." };
    }

    // Key on cupboard
    if ((target.includes("key") && content.includes("cupboard")) ||
        (target.includes("cupboard") && (content.includes("key") || state.inventory.has("rusty_key")))) {
      if (!state.inventory.has("rusty_key")) {
        return { success: false, message: "USE FAILED: You don't have a key. Find one first." };
      }
      if (!state.cupboardLocked) {
        return { success: false, message: "USE FAILED: The cupboard is already unlocked." };
      }
      state.cupboardLocked = false;
      return { success: true, message: "USE SUCCESS: The rusty key fits the padlock! You unlock and open the cupboard. Inside: RAW VEGETABLES!", stateChange: "cupboard_unlocked" };
    }

    // Matches on stove
    if ((target.includes("matches") && content.includes("stove")) ||
        (target.includes("stove") && state.inventory.has("matches"))) {
      if (!state.inventory.has("matches")) {
        return { success: false, message: "USE FAILED: You don't have matches. Pick them up first." };
      }
      if (state.stoveLit) {
        return { success: false, message: "USE FAILED: The stove is already lit." };
      }
      state.stoveLit = true;
      return { success: true, message: "USE SUCCESS: You strike a match and light the wood stove. Flames crackle to life!", stateChange: "stove_lit" };
    }

    // Pan on stove
    if ((target.includes("pan") && content.includes("stove")) ||
        (target.includes("stove") && target.includes("pan"))) {
      if (!state.inventory.has("pan")) {
        return { success: false, message: "USE FAILED: You don't have the pan. Pick it up first." };
      }
      if (!state.stoveLit) {
        return { success: false, message: "USE FAILED: Light the stove first before putting the pan on it." };
      }
      if (state.panOnStove) {
        return { success: false, message: "USE FAILED: The pan is already on the stove." };
      }
      state.panOnStove = true;
      state.inventory.delete("pan");
      return { success: true, message: "USE SUCCESS: You place the pan on the hot stove. It starts to heat up.", stateChange: "pan_on_stove" };
    }

    // Knife on vegetables (chop)
    if ((target.includes("knife") && (content.includes("vegetable") || content.includes("chop") || content.includes("cut"))) ||
        (target.includes("vegetable") && (content.includes("chop") || content.includes("cut") || content.includes("knife")))) {
      if (!state.inventory.has("knife")) {
        return { success: false, message: "USE FAILED: You don't have a knife. Pick it up first." };
      }
      if (!state.inventory.has("raw_vegetables")) {
        return { success: false, message: "USE FAILED: You don't have vegetables to chop. Get them from the cupboard first." };
      }
      if (state.vegetablesChopped) {
        return { success: false, message: "USE FAILED: The vegetables are already chopped." };
      }
      state.vegetablesChopped = true;
      state.inventory.delete("raw_vegetables");
      state.inventory.add("chopped_vegetables");
      return { success: true, message: "USE SUCCESS: You chop the vegetables into small pieces. They're ready to cook!", stateChange: "vegetables_chopped" };
    }

    // Cook chopped vegetables
    if ((target.includes("chop") || target.includes("vegetable")) &&
        (content.includes("cook") || content.includes("pan") || content.includes("stove"))) {
      if (!state.inventory.has("chopped_vegetables")) {
        return { success: false, message: "USE FAILED: You don't have chopped vegetables. Chop them first with the knife." };
      }
      if (!state.panOnStove) {
        return { success: false, message: "USE FAILED: Put a pan on the lit stove first." };
      }
      state.vegetablesCooked = true;
      state.inventory.delete("chopped_vegetables");
      return { success: true, message: "USE SUCCESS: You add the chopped vegetables to the hot pan. They sizzle and cook! COOKED MEAL is ready!", stateChange: "vegetables_cooked" };
    }

    // Eat cooked food
    if (target.includes("cooked") || target.includes("meal") || target.includes("eat")) {
      if (!state.vegetablesCooked && !state.inventory.has("cooked_meal")) {
        return { success: false, message: "USE FAILED: You don't have any cooked food yet." };
      }
      state.hungerSatisfied = true;
      return { success: true, message: "USE SUCCESS: You eat the hot, delicious meal! Warmth spreads through your body. YOUR HUNGER IS SATISFIED!", stateChange: "PUZZLE_COMPLETE" };
    }

    return { success: false, message: `USE FAILED: Can't use "${action.target}" that way. Try being more specific about what you want to do.` };
  }

  // === EAT ===
  if (type === "eat") {
    if (state.vegetablesCooked || state.inventory.has("cooked_meal")) {
      state.hungerSatisfied = true;
      return { success: true, message: "EAT SUCCESS: You devour the cooked meal! YOUR HUNGER IS SATISFIED!", stateChange: "PUZZLE_COMPLETE" };
    }
    if (state.inventory.has("raw_vegetables") || state.inventory.has("chopped_vegetables")) {
      return { success: false, message: "EAT FAILED: You can't eat raw/uncooked vegetables. Cook them first!" };
    }
    return { success: false, message: "EAT FAILED: You don't have any food to eat." };
  }

  return { success: true, message: `You ${type}${target ? " " + target : ""}.` };
}

// =============================================================================
// WORLD SETUP
// =============================================================================

interface TestWorld {
  world: any;
  agentEid: number;
  state: PuzzleState;
}

function setupWorld(): TestWorld {
  const world = createWorld();
  const state = createState();

  // Create room
  const roomEid = addEntity(world);
  addComponent(world, roomEid, Room);
  addComponent(world, roomEid, Name);
  Name.value[roomEid] = "Old Kitchen";
  Room.capacity[roomEid] = 10;

  // Create agent
  const agentEid = addEntity(world);
  addComponent(world, agentEid, Agent);
  addComponent(world, agentEid, Mind);
  addComponent(world, agentEid, Name);
  addComponent(world, agentEid, Needs);
  addComponent(world, agentEid, Inventory);
  addComponent(world, agentEid, OccupiesRoom(roomEid));

  Name.value[agentEid] = "Viktor";
  Agent.role[agentEid] = "survivor";
  Agent.active[agentEid] = true;
  Agent.systemPrompt[agentEid] = `You are Viktor, a starving traveler. You MUST find food and eat it to survive.

IMPORTANT RULES:
1. READ action results carefully - they tell you exactly what happened
2. If an action FAILS, the result will say "FAILED" and explain why
3. If an action SUCCEEDS, the result will say "SUCCESS" and what changed
4. Use "think" to plan your approach before acting
5. You need to PICKUP items before you can USE them
6. Pay attention to what items require (keys open locks, crowbars pry things, etc.)

Think step by step:
- What do I need? (food)
- Where is it? (locked cupboard)
- What do I need to access it? (a key)
- Where might a key be? (hidden somewhere)
- What tools might help? (look around)`;

  Mind.mode[agentEid] = "active";
  Mind.arousal[agentEid] = 0.9;
  Mind.focus[agentEid] = "desperate for food";

  Needs.hunger[agentEid] = 0.95;
  Needs.energy[agentEid] = 0.4;
  Needs.social[agentEid] = 0.1;
  Needs.comfort[agentEid] = 0.2;

  Inventory.items[agentEid] = "[]";
  Inventory.maxSlots[agentEid] = 10;

  // Goal
  const goalEid = addEntity(world);
  addComponent(world, goalEid, Goal);
  addComponent(world, agentEid, HasGoal(goalEid));
  Goal.description[goalEid] = "Find food, cook it, and eat it to survive";
  Goal.priority[goalEid] = 10;
  Goal.status[goalEid] = "active";

  return { world, agentEid, state };
}

// =============================================================================
// MAIN TEST
// =============================================================================

async function runGroundedPuzzleTest(): Promise<void> {
  log.header("\n" + "═".repeat(70));
  log.header("  GROUNDED PUZZLE TEST - Clear Feedback, No Hallucination");
  log.header("═".repeat(70));

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    log.error("\n❌ Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  const tw = setupWorld();

  log.info("\n[Setup] Viktor (95% hunger) must solve multi-step puzzle");
  log.info("  Chain: Find hidden key → Unlock cupboard → Get vegetables → Cook → Eat\n");

  // Initial perception with rich state description
  const initialWorld = describeWorld(tw.state);
  log.header("--- Initial World State ---");
  console.log(initialWorld);

  addPerception(tw.world, tw.agentEid, {
    type: "visual",
    content: initialWorld,
    source: "observation",
  });

  // Tracking
  const actions: AgentAction[] = [];
  const results: ActionResult[] = [];
  let planningSteps = 0;

  const MAX_CYCLES = 25;

  log.header("\n--- Solving the Puzzle ---\n");

  for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
    if (tw.state.hungerSatisfied) {
      log.success(`\n🎉 PUZZLE SOLVED in ${cycle - 1} steps! (${planningSteps} were planning)`);
      break;
    }

    log.header(`\n[Step ${cycle}]`);

    try {
      // Get action from AI
      const action = await agentThink(tw.world, tw.agentEid);
      actions.push(action);

      // Show thought if present
      if ((action as any).reasoning) {
        log.thought(`  💭 "${(action as any).reasoning.slice(0, 100)}..."`);
      }

      // Show action
      const actionStr = `${action.type}${action.target ? ` → ${action.target}` : ""}${action.content ? `: "${action.content.slice(0, 40)}..."` : ""}`;
      log.action(`  ACTION: ${actionStr}`);

      // Process action and get result
      const result = processAction(tw.state, action);
      results.push(result);

      // Track planning
      if (action.type === "think" || action.type === "plan" || action.type === "reflect") {
        planningSteps++;
        log.plan(`  ${result.message}`);
      } else {
        // Show result clearly
        if (result.success) {
          log.success(`  ${result.message}`);
          if (result.stateChange) {
            log.info(`  [STATE CHANGE: ${result.stateChange}]`);
          }
        } else {
          log.error(`  ${result.message}`);
        }
      }

      // === KEY: Feed result back to AI as perception ===
      // This is the grounding - AI MUST see what actually happened
      const worldUpdate = describeWorld(tw.state);
      const feedback = `
PREVIOUS ACTION: ${actionStr}
RESULT: ${result.message}

CURRENT STATE:
${worldUpdate}`;

      addPerception(tw.world, tw.agentEid, {
        type: "feedback",
        content: feedback,
        source: "action_result",
      });

      await new Promise(r => setTimeout(r, 500));

    } catch (error) {
      log.error(`  Error: ${error}`);
    }
  }

  // Final report
  log.header("\n" + "═".repeat(70));
  log.header("  TEST RESULTS");
  log.header("═".repeat(70));

  const solved = tw.state.hungerSatisfied;
  const successfulActions = results.filter(r => r.success && !r.message.includes("PLANNING")).length;
  const failedActions = results.filter(r => !r.success).length;

  log.info(`\n  Total steps: ${actions.length}`);
  log.info(`  Planning steps: ${planningSteps}`);
  log.info(`  Successful actions: ${successfulActions}`);
  log.info(`  Failed actions: ${failedActions}`);
  log.info(`  Puzzle solved: ${solved ? "YES" : "NO"}`);

  // Progress
  log.header("\n  Puzzle Progress:");
  const steps = [
    { name: "Got crowbar", done: tw.state.inventory.has("crowbar") || tw.state.floorboardLifted },
    { name: "Pried up floorboard", done: tw.state.floorboardLifted },
    { name: "Got key", done: tw.state.inventory.has("rusty_key") || !tw.state.cupboardLocked },
    { name: "Unlocked cupboard", done: !tw.state.cupboardLocked },
    { name: "Got vegetables", done: tw.state.inventory.has("raw_vegetables") || tw.state.inventory.has("chopped_vegetables") || tw.state.vegetablesChopped },
    { name: "Got knife", done: tw.state.inventory.has("knife") || tw.state.vegetablesChopped },
    { name: "Chopped vegetables", done: tw.state.vegetablesChopped },
    { name: "Got matches", done: tw.state.inventory.has("matches") || tw.state.stoveLit },
    { name: "Lit stove", done: tw.state.stoveLit },
    { name: "Got pan", done: tw.state.inventory.has("pan") || tw.state.panOnStove },
    { name: "Put pan on stove", done: tw.state.panOnStove },
    { name: "Cooked vegetables", done: tw.state.vegetablesCooked },
    { name: "ATE THE FOOD!", done: tw.state.hungerSatisfied },
  ];

  let completedSteps = 0;
  for (const step of steps) {
    const icon = step.done ? "✓" : "○";
    if (step.done) {
      log.success(`    ${icon} ${step.name}`);
      completedSteps++;
    } else {
      log.info(`    ${icon} ${step.name}`);
    }
  }

  log.header("\n" + "═".repeat(70));
  if (solved) {
    log.success(`  ✓ TEST PASSED - Completed ${completedSteps}/${steps.length} steps`);
  } else {
    log.error(`  ✗ TEST INCOMPLETE - Completed ${completedSteps}/${steps.length} steps`);
  }
  log.header("═".repeat(70) + "\n");

  process.exit(solved ? 0 : 1);
}

runGroundedPuzzleTest().catch(error => {
  log.error(`Fatal error: ${error}`);
  process.exit(1);
});
