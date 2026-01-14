/**
 * Focused Affordance & Cognition Behavioral Test
 *
 * Tests the dynamic affordance system, goal-based planning, and AI cognition
 * with specific focused scenarios that push the system hard.
 *
 * SCENARIOS:
 * 1. Solo Survival: One NPC in complex room with objects, critical needs
 * 2. Cooperation Puzzle: Two NPCs must trade and coordinate to solve a problem
 * 3. Social Dynamics: Multiple NPCs with different goals in shared space
 *
 * Each scenario validates:
 * - AI only uses valid actions from affordance system
 * - Goals are created and pursued by deterministic systems
 * - Dynamic prompt includes correct objects/people/locations
 * - Planning and problem-solving emerge from the system
 */

import "dotenv/config";
import { createWorld, addEntity, addComponent, removeComponent, query, hasComponent, getRelationTargets } from "bitecs";
import {
  Agent, Mind, Name, Needs, Room, Goal, Description, Health, Inventory,
  Item, StimulusSource, Appearance, AllComponents
} from "../ecs/components";
import {
  OccupiesRoom, HasGoal, Contains, AllRelations
} from "../ecs/relations";
import type { SystemContext } from "../ecs/dynamic-systems";
import {
  DETERMINISTIC_SYSTEM_DEFINITIONS,
} from "../systems/deterministic-behavior-systems";
import {
  formatActionsForPrompt,
  getValidActionTypes,
  buildAvailableActionsContext,
  ActionRegistry,
} from "../cognition/action-registry";
import {
  agentThink,
  addPerception,
  type AgentAction,
} from "../cognition/agent-mind";
import {
  createMovementGoal,
  getActiveGoals,
} from "../cognition/cognition-system";

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
};

// =============================================================================
// TEST INFRASTRUCTURE
// =============================================================================

interface TestWorld {
  world: any;
  entities: Map<string, number>;
  rooms: Map<string, number>;
}

interface ScenarioResult {
  name: string;
  passed: boolean;
  cognitiveActions: AgentAction[];
  goalsCreated: number;
  goalsCompleted: number;
  invalidActions: string[];
  affordancePrompts: string[];
  details: string[];
}

function createTestWorld(): TestWorld {
  const world = createWorld();
  return {
    world,
    entities: new Map(),
    rooms: new Map(),
  };
}

function createRoom(tw: TestWorld, name: string, description: string): number {
  const eid = addEntity(tw.world);
  addComponent(tw.world, eid, Room);
  addComponent(tw.world, eid, Name);
  addComponent(tw.world, eid, Description);

  Name.value[eid] = name;
  Description.value[eid] = description;
  Room.capacity[eid] = 20;
  Room.ambience[eid] = "ambient";

  tw.rooms.set(name.toLowerCase(), eid);
  tw.entities.set(name, eid);
  return eid;
}

function createAgent(
  tw: TestWorld,
  name: string,
  role: string,
  roomName: string,
  options: {
    hunger?: number;
    energy?: number;
    social?: number;
    hasHealth?: boolean;
    hasInventory?: boolean;
    systemPrompt?: string;
  } = {}
): number {
  const eid = addEntity(tw.world);
  addComponent(tw.world, eid, Agent);
  addComponent(tw.world, eid, Mind);
  addComponent(tw.world, eid, Name);
  addComponent(tw.world, eid, Needs);
  addComponent(tw.world, eid, Description);

  Name.value[eid] = name;
  Description.value[eid] = `${name}, a ${role}`;
  Agent.role[eid] = role;
  Agent.active[eid] = true;
  Agent.systemPrompt[eid] = options.systemPrompt || `You are ${name}, a ${role}. Act naturally based on your needs and goals.`;

  Mind.mode[eid] = "active";
  Mind.arousal[eid] = 0.5;
  Mind.focus[eid] = "starting";
  Mind.lastUpdate[eid] = 0;

  // Set needs (0-1 scale, higher = more urgent)
  Needs.hunger[eid] = options.hunger ?? 0.3;
  Needs.energy[eid] = options.energy ?? 0.7;
  Needs.social[eid] = options.social ?? 0.3;
  Needs.comfort[eid] = 0.5;

  // Optional components
  if (options.hasHealth) {
    addComponent(tw.world, eid, Health);
    Health.current[eid] = 100;
    Health.max[eid] = 100;
  }

  if (options.hasInventory) {
    addComponent(tw.world, eid, Inventory);
    Inventory.items[eid] = "[]";
    Inventory.maxSlots[eid] = 10;
    Inventory.weight[eid] = 0;
    Inventory.maxWeight[eid] = 50;
  }

  // Place in room
  const roomKey = roomName.toLowerCase();
  const roomEid = tw.rooms.get(roomKey);
  if (roomEid !== undefined) {
    addComponent(tw.world, eid, OccupiesRoom(roomEid));
  }

  tw.entities.set(name, eid);
  return eid;
}

function createObject(
  tw: TestWorld,
  name: string,
  description: string,
  roomName: string,
  options: {
    isItem?: boolean;
    isObservable?: boolean;
  } = {}
): number {
  const eid = addEntity(tw.world);
  addComponent(tw.world, eid, Name);
  addComponent(tw.world, eid, Description);

  Name.value[eid] = name;
  Description.value[eid] = description;

  if (options.isItem) {
    addComponent(tw.world, eid, Item);
    Item.category[eid] = "object";
    Item.quantity[eid] = 1;
    Item.weight[eid] = 1;
    Item.stackable[eid] = false;
    Item.maxStack[eid] = 1;
  }

  if (options.isObservable) {
    addComponent(tw.world, eid, StimulusSource);
    StimulusSource.stimulusType[eid] = "visual";
    StimulusSource.template[eid] = `You notice ${name}`;
    StimulusSource.interval[eid] = 5000;
    StimulusSource.lastEmit[eid] = 0;
  }

  // Place in room via Contains relation
  const roomKey = roomName.toLowerCase();
  const roomEid = tw.rooms.get(roomKey);
  if (roomEid !== undefined) {
    addComponent(tw.world, roomEid, Contains(eid));
  }

  tw.entities.set(name, eid);
  return eid;
}

function createGoal(tw: TestWorld, agentName: string, description: string, priority: number = 5): number {
  const agentEid = tw.entities.get(agentName);
  if (!agentEid) throw new Error(`Agent ${agentName} not found`);

  const goalEid = addEntity(tw.world);
  addComponent(tw.world, goalEid, Goal);
  addComponent(tw.world, agentEid, HasGoal(goalEid));

  Goal.description[goalEid] = description;
  Goal.priority[goalEid] = priority;
  Goal.status[goalEid] = "active";
  Goal.progress[goalEid] = 0;
  Goal.deadline[goalEid] = 0;

  tw.entities.set(`goal_${agentName}_${description.slice(0, 20)}`, goalEid);
  return goalEid;
}

function createSystemContext(world: any, elapsed: number): SystemContext {
  const events: Array<{ type: string; data: any }> = [];
  return {
    tick: Math.floor(elapsed / 1000),
    delta: 1000,
    elapsed,
    emit: (type, data) => events.push({ type, data }),
    log: (msg) => console.log(`  [System] ${msg}`),
    query: (w, components) => query(w, components),
    hasComponent: (w, eid, comp) => hasComponent(w, eid, comp),
    getRelationTargets: (w, eid, rel) => getRelationTargets(w, eid, rel),
    addEntity: (w) => addEntity(w),
    addComponent: (w, eid, comp) => addComponent(w, eid, comp),
    removeEntity: () => {},
    components: AllComponents,
    relations: AllRelations,
    ai: null as any,
    grid: null as any,
    cognitive: null as any,
  };
}

// =============================================================================
// SCENARIO 1: SOLO SURVIVAL IN COMPLEX ROOM
// =============================================================================

async function runSoloSurvivalScenario(): Promise<ScenarioResult> {
  log.header("\n" + "=".repeat(70));
  log.header("  SCENARIO 1: SOLO SURVIVAL");
  log.header("  One hungry, tired NPC in a room full of objects");
  log.header("=".repeat(70));

  const result: ScenarioResult = {
    name: "Solo Survival",
    passed: false,
    cognitiveActions: [],
    goalsCreated: 0,
    goalsCompleted: 0,
    invalidActions: [],
    affordancePrompts: [],
    details: [],
  };

  // Setup world
  const tw = createTestWorld();

  // Create rooms
  createRoom(tw, "Cottage", "A small but cozy cottage with a fireplace");
  createRoom(tw, "Garden", "A small vegetable garden outside");
  createRoom(tw, "Well", "A stone well with fresh water");

  // Create the solo agent with CRITICAL needs
  const agentEid = createAgent(tw, "Mira", "peasant", "Cottage", {
    hunger: 0.85,  // VERY hungry
    energy: 0.25,  // VERY tired
    social: 0.1,   // Not lonely (alone is fine)
    hasInventory: true,
    hasHealth: true,
    systemPrompt: `You are Mira, a peasant. You are EXTREMELY hungry and tired.
You must find food and rest. Look around and use the objects in your environment.
Your survival depends on satisfying your needs using what's available.`,
  });

  // Create objects in the cottage
  createObject(tw, "Bread Loaf", "A fresh loaf of bread on the table", "Cottage", { isItem: true });
  createObject(tw, "Cheese Wheel", "A round wheel of aged cheese", "Cottage", { isItem: true });
  createObject(tw, "Wooden Bed", "A simple but comfortable bed with wool blankets", "Cottage", { isObservable: true });
  createObject(tw, "Fireplace", "A warm hearth with crackling flames", "Cottage", { isObservable: true });
  createObject(tw, "Locked Chest", "A sturdy wooden chest, locked tight", "Cottage", { isObservable: true });
  createObject(tw, "Iron Key", "A small iron key hanging on a hook", "Cottage", { isItem: true });
  createObject(tw, "Water Bucket", "A wooden bucket filled with fresh water", "Cottage", { isItem: true });
  createObject(tw, "Cooking Pot", "A cast iron pot for cooking", "Cottage", { isItem: true });

  // Create objects in garden
  createObject(tw, "Carrot Patch", "Fresh carrots ready to harvest", "Garden", { isItem: true });
  createObject(tw, "Herb Garden", "Various cooking herbs growing", "Garden", { isObservable: true });

  // Give Mira a goal
  createGoal(tw, "Mira", "Satisfy hunger and get some rest", 9);

  // Add initial perception
  addPerception(tw.world, agentEid, {
    type: "internal",
    content: "Your stomach growls painfully. You can barely keep your eyes open. You need food and rest urgently.",
    source: "self",
  });

  log.info("\n[Setup] Created Mira (hungry: 85%, energy: 25%) in Cottage with many objects\n");

  // Test 1: Verify affordance prompt is correct
  log.info("--- Testing Affordance Prompt Generation ---\n");
  const affordancePrompt = formatActionsForPrompt(tw.world, agentEid);
  result.affordancePrompts.push(affordancePrompt);

  console.log(affordancePrompt);

  // Validate prompt contains expected elements
  const promptChecks = [
    { check: affordancePrompt.includes("AVAILABLE ACTIONS"), desc: "Has actions header" },
    { check: affordancePrompt.includes("move"), desc: "Has move action" },
    { check: affordancePrompt.includes("pickup"), desc: "Has pickup action (has Inventory)" },
    { check: affordancePrompt.includes("PLACES YOU CAN GO"), desc: "Has locations section" },
    { check: affordancePrompt.includes("Garden") || affordancePrompt.includes("Well"), desc: "Lists other rooms" },
    { check: affordancePrompt.includes("YOUR NEEDS"), desc: "Shows needs status" },
    { check: affordancePrompt.includes("CRITICAL") || affordancePrompt.includes("85%"), desc: "Shows critical hunger" },
  ];

  for (const pc of promptChecks) {
    const status = pc.check ? "PASS" : "FAIL";
    log.info(`  [${status}] ${pc.desc}`);
    result.details.push(`Prompt check - ${pc.desc}: ${status}`);
  }

  // Test 2: Get valid action types
  const validTypes = getValidActionTypes(tw.world, agentEid);
  log.info(`\n  Valid action types: ${validTypes.join(", ")}`);
  result.details.push(`Valid types: ${validTypes.join(", ")}`);

  // Test 3: Run cognitive cycles and track actions
  log.info("\n--- Running Cognitive Cycles ---\n");

  const MAX_CYCLES = 5;
  for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
    log.agent(`\n[Cycle ${cycle + 1}] Mira thinks...\n`);

    try {
      const action = await agentThink(tw.world, agentEid);
      result.cognitiveActions.push(action);

      // Log the action
      log.action(`  Action: ${action.type}${action.target ? ` -> ${action.target}` : ""}${action.content ? `: "${action.content.slice(0, 50)}..."` : ""}`);

      // Validate action type is in valid list
      if (!validTypes.includes(action.type)) {
        result.invalidActions.push(action.type);
        log.error(`  INVALID ACTION TYPE: ${action.type}`);
      }

      // Check if goals were created
      const goals = getActiveGoals(tw.world, agentEid);
      result.goalsCreated = Math.max(result.goalsCreated, goals.length);

      // Simulate deterministic system execution
      const ctx = createSystemContext(tw.world, cycle * 1000);
      for (const systemDef of DETERMINISTIC_SYSTEM_DEFINITIONS) {
        try {
          systemDef.run(tw.world, ctx);
        } catch (e) {
          // Ignore system errors for this test
        }
      }

      // Small delay between cycles
      await new Promise(r => setTimeout(r, 500));

    } catch (error) {
      log.error(`  Cognition error: ${error}`);
      result.details.push(`Cycle ${cycle + 1} error: ${error}`);
    }
  }

  // Evaluate results
  result.passed =
    result.invalidActions.length === 0 &&
    result.cognitiveActions.length >= 3 &&
    promptChecks.every(pc => pc.check);

  log.header("\n--- Scenario 1 Results ---");
  log.info(`  Actions taken: ${result.cognitiveActions.length}`);
  log.info(`  Invalid actions: ${result.invalidActions.length}`);
  log.info(`  Goals active: ${result.goalsCreated}`);
  log[result.passed ? "success" : "error"](`  Status: ${result.passed ? "PASSED" : "FAILED"}`);

  return result;
}

// =============================================================================
// SCENARIO 2: COOPERATION PUZZLE
// =============================================================================

async function runCooperationScenario(): Promise<ScenarioResult> {
  log.header("\n" + "=".repeat(70));
  log.header("  SCENARIO 2: COOPERATION PUZZLE");
  log.header("  Two NPCs must work together - one has key, other knows location");
  log.header("=".repeat(70));

  const result: ScenarioResult = {
    name: "Cooperation Puzzle",
    passed: false,
    cognitiveActions: [],
    goalsCreated: 0,
    goalsCompleted: 0,
    invalidActions: [],
    affordancePrompts: [],
    details: [],
  };

  // Setup world
  const tw = createTestWorld();

  // Create rooms
  createRoom(tw, "Town Square", "The central gathering place");
  createRoom(tw, "Old Mill", "An abandoned mill at the edge of town");
  createRoom(tw, "Basement", "A dark basement beneath the mill");

  // Agent 1: Has the key but doesn't know where the treasure is
  const alricEid = createAgent(tw, "Alric", "locksmith", "Town Square", {
    hunger: 0.2,
    energy: 0.8,
    social: 0.6,  // Wants to talk
    hasInventory: true,
    systemPrompt: `You are Alric, a locksmith. You found a mysterious golden key yesterday.
You've heard rumors of hidden treasure but don't know where it is.
You're looking for someone who might know more. Share information and work together.`,
  });

  // Agent 2: Knows where treasure is but needs a key
  const bellaEid = createAgent(tw, "Bella", "explorer", "Town Square", {
    hunger: 0.3,
    energy: 0.7,
    social: 0.7,  // Very social
    hasInventory: true,
    systemPrompt: `You are Bella, an explorer. You discovered a locked treasure chest in the Old Mill basement.
You need a key to open it. You're looking for someone who might have one.
Work together with others to solve this puzzle.`,
  });

  // Create objects
  createObject(tw, "Golden Key", "A mysterious golden key with intricate engravings", "Town Square", { isItem: true });
  createObject(tw, "Town Fountain", "A beautiful fountain in the center of the square", "Town Square", { isObservable: true });
  createObject(tw, "Treasure Chest", "An ornate locked chest covered in dust", "Basement", { isObservable: true });
  createObject(tw, "Old Millstone", "A massive grinding stone, long unused", "Old Mill", { isObservable: true });

  // Give them complementary goals
  createGoal(tw, "Alric", "Find out where the treasure is hidden", 8);
  createGoal(tw, "Bella", "Find a key to open the treasure chest", 8);

  // Add perceptions about each other
  addPerception(tw.world, alricEid, {
    type: "visual",
    content: "You see Bella, an explorer, looking around the square with interest. She might know something.",
    source: "observation",
  });

  addPerception(tw.world, bellaEid, {
    type: "visual",
    content: "You see Alric, a locksmith, examining something in his hand. He might be able to help.",
    source: "observation",
  });

  log.info("\n[Setup] Alric (has key) and Bella (knows location) in Town Square\n");

  // Test affordances for both agents
  log.info("--- Affordance Prompts ---\n");

  for (const [name, eid] of [["Alric", alricEid], ["Bella", bellaEid]] as const) {
    log.agent(`${name}'s available actions:`);
    const prompt = formatActionsForPrompt(tw.world, eid);
    result.affordancePrompts.push(prompt);

    // Check social affordances
    const hasSocialAffordances = prompt.includes("PEOPLE YOU CAN INTERACT WITH");
    const canSpeak = prompt.includes("speak");
    const canGive = prompt.includes("give");

    log.info(`  Social affordances: ${hasSocialAffordances ? "YES" : "NO"}`);
    log.info(`  Can speak: ${canSpeak ? "YES" : "NO"}`);
    log.info(`  Can give items: ${canGive ? "YES" : "NO"}`);

    result.details.push(`${name} - social: ${hasSocialAffordances}, speak: ${canSpeak}, give: ${canGive}`);
  }

  // Run alternating cognitive cycles
  log.info("\n--- Running Alternating Cognitive Cycles ---\n");

  const agents = [
    { name: "Alric", eid: alricEid },
    { name: "Bella", eid: bellaEid },
  ];

  const validTypesAlric = getValidActionTypes(tw.world, alricEid);
  const validTypesBella = getValidActionTypes(tw.world, bellaEid);

  const MAX_CYCLES = 4;
  for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
    for (const agent of agents) {
      log.agent(`\n[Cycle ${cycle + 1}] ${agent.name} thinks...\n`);

      try {
        const action = await agentThink(tw.world, agent.eid);
        result.cognitiveActions.push(action);

        log.action(`  ${agent.name}: ${action.type}${action.target ? ` -> ${action.target}` : ""}${action.content ? `: "${action.content.slice(0, 60)}..."` : ""}`);

        // Validate action
        const validTypes = agent.name === "Alric" ? validTypesAlric : validTypesBella;
        if (!validTypes.includes(action.type)) {
          result.invalidActions.push(`${agent.name}: ${action.type}`);
          log.error(`  INVALID ACTION TYPE`);
        }

        // If speaking, the other agent should "hear" it
        if (action.type === "speak" && action.content) {
          const otherAgent = agents.find(a => a.name !== agent.name)!;
          addPerception(tw.world, otherAgent.eid, {
            type: "auditory",
            content: `${agent.name} says: "${action.content}"`,
            source: agent.name,
          });
          log.thought(`  (${otherAgent.name} hears this)`);
        }

        // Run deterministic systems
        const ctx = createSystemContext(tw.world, cycle * 1000);
        for (const systemDef of DETERMINISTIC_SYSTEM_DEFINITIONS) {
          try {
            systemDef.run(tw.world, ctx);
          } catch (e) {}
        }

        await new Promise(r => setTimeout(r, 300));

      } catch (error) {
        log.error(`  Error: ${error}`);
      }
    }
  }

  // Check for cooperation indicators
  const speakActions = result.cognitiveActions.filter(a => a.type === "speak");
  const observeActions = result.cognitiveActions.filter(a => a.type === "observe");
  const moveActions = result.cognitiveActions.filter(a => a.type === "move");

  result.passed =
    result.invalidActions.length === 0 &&
    speakActions.length >= 2 && // They talked to each other
    result.cognitiveActions.length >= 6;

  log.header("\n--- Scenario 2 Results ---");
  log.info(`  Total actions: ${result.cognitiveActions.length}`);
  log.info(`  Speak actions: ${speakActions.length}`);
  log.info(`  Observe actions: ${observeActions.length}`);
  log.info(`  Move actions: ${moveActions.length}`);
  log.info(`  Invalid actions: ${result.invalidActions.length}`);
  log[result.passed ? "success" : "error"](`  Status: ${result.passed ? "PASSED" : "FAILED"}`);

  return result;
}

// =============================================================================
// SCENARIO 3: SOCIAL DYNAMICS
// =============================================================================

async function runSocialDynamicsScenario(): Promise<ScenarioResult> {
  log.header("\n" + "=".repeat(70));
  log.header("  SCENARIO 3: SOCIAL DYNAMICS");
  log.header("  Three NPCs in a tavern with different motivations");
  log.header("=".repeat(70));

  const result: ScenarioResult = {
    name: "Social Dynamics",
    passed: false,
    cognitiveActions: [],
    goalsCreated: 0,
    goalsCompleted: 0,
    invalidActions: [],
    affordancePrompts: [],
    details: [],
  };

  // Setup world
  const tw = createTestWorld();

  // Create rooms
  createRoom(tw, "Tavern Main", "The main hall of the Rusty Nail tavern, warm and noisy");
  createRoom(tw, "Tavern Kitchen", "The kitchen where food is prepared");
  createRoom(tw, "Tavern Cellar", "A cool cellar with barrels of ale");
  createRoom(tw, "Street Outside", "The muddy street outside the tavern");

  // Agent 1: Innkeeper - wants everyone happy, serving food
  const gregEid = createAgent(tw, "Greg", "innkeeper", "Tavern Main", {
    hunger: 0.1,
    energy: 0.9,
    social: 0.8,
    hasInventory: true,
    systemPrompt: `You are Greg, the innkeeper of the Rusty Nail. You want to keep your guests happy.
Greet newcomers, serve food and drink, and maintain a welcoming atmosphere.
If there's tension, try to defuse it with hospitality.`,
  });

  // Agent 2: Merchant - wants to make a deal, somewhat pushy
  const marlaEid = createAgent(tw, "Marla", "merchant", "Tavern Main", {
    hunger: 0.4,
    energy: 0.6,
    social: 0.9, // Very social, wants to negotiate
    hasInventory: true,
    systemPrompt: `You are Marla, a traveling merchant. You're trying to sell rare spices.
You're looking for buyers and love to haggle. Be persistent but not rude.
Strike up conversations and look for business opportunities.`,
  });

  // Agent 3: Scholar - wants peace and quiet, slightly annoyed
  const edmundEid = createAgent(tw, "Edmund", "scholar", "Tavern Main", {
    hunger: 0.5,
    energy: 0.4, // Tired
    social: 0.2, // Wants to be left alone
    hasInventory: true,
    hasHealth: true,
    systemPrompt: `You are Edmund, a scholar trying to read an important manuscript.
The tavern is too noisy for your liking. You might move somewhere quieter,
or politely ask others to keep it down. You're not unfriendly, just focused.`,
  });

  // Create objects
  createObject(tw, "Ale Barrel", "A large barrel of fresh ale", "Tavern Main", { isItem: false, isObservable: true });
  createObject(tw, "Fireplace", "A roaring fire keeping the room warm", "Tavern Main", { isObservable: true });
  createObject(tw, "Ancient Manuscript", "Edmund's precious manuscript spread on a table", "Tavern Main", { isObservable: true });
  createObject(tw, "Spice Box", "Marla's box of exotic spices from the east", "Tavern Main", { isItem: true });
  createObject(tw, "Quiet Corner", "A secluded corner with a comfortable chair", "Tavern Kitchen", { isObservable: true });

  // Give them goals reflecting their personalities
  createGoal(tw, "Greg", "Make sure all guests are comfortable and served", 7);
  createGoal(tw, "Marla", "Find a buyer for your spices", 8);
  createGoal(tw, "Edmund", "Find a quiet place to study the manuscript", 6);

  // Initial perceptions
  addPerception(tw.world, gregEid, {
    type: "visual",
    content: "You see Marla, a merchant, setting up at a table. Edmund, a scholar, looks frustrated with the noise.",
    source: "observation",
  });

  addPerception(tw.world, marlaEid, {
    type: "visual",
    content: "Greg the innkeeper seems busy but friendly. Edmund is hunched over papers - maybe he'd like some exotic tea spices?",
    source: "observation",
  });

  addPerception(tw.world, edmundEid, {
    type: "auditory",
    content: "The tavern is quite loud. You hear Marla loudly describing her wares. Perhaps the kitchen would be quieter.",
    source: "environment",
  });

  log.info("\n[Setup] Greg (innkeeper), Marla (merchant), Edmund (scholar) in Tavern\n");
  log.info("  Greg: social, wants happy guests");
  log.info("  Marla: very social, wants to sell");
  log.info("  Edmund: antisocial, wants quiet\n");

  // Check affordances show all three can see each other
  log.info("--- Checking Social Affordances ---\n");

  const agentList = [
    { name: "Greg", eid: gregEid },
    { name: "Marla", eid: marlaEid },
    { name: "Edmund", eid: edmundEid },
  ];

  for (const agent of agentList) {
    const context = buildAvailableActionsContext(tw.world, agent.eid);
    const otherNames = agentList.filter(a => a.name !== agent.name).map(a => a.name);

    const seesOthers = otherNames.every(name =>
      context.socialAffordances.some(aff => aff.target === name)
    );

    log.info(`  ${agent.name} sees others: ${seesOthers ? "YES" : "NO"}`);
    log.info(`    Social affordances: ${context.socialAffordances.map(a => a.target).join(", ")}`);
    log.info(`    Available locations: ${context.availableLocations.join(", ")}`);

    result.details.push(`${agent.name} sees: ${context.socialAffordances.map(a => a.target).join(", ")}`);
    result.affordancePrompts.push(formatActionsForPrompt(tw.world, agent.eid));
  }

  // Run interleaved cognitive cycles
  log.info("\n--- Running Social Interaction Cycles ---\n");

  const MAX_CYCLES = 3;
  for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
    log.header(`\n=== Cycle ${cycle + 1} ===`);

    for (const agent of agentList) {
      log.agent(`\n${agent.name} (${Agent.role[agent.eid]}) thinks...`);

      try {
        const validTypes = getValidActionTypes(tw.world, agent.eid);
        const action = await agentThink(tw.world, agent.eid);
        result.cognitiveActions.push({ ...action, reason: agent.name } as any);

        const actionStr = `${action.type}${action.target ? ` -> ${action.target}` : ""}${action.content ? `: "${action.content.slice(0, 50)}..."` : ""}`;
        log.action(`  → ${actionStr}`);

        // Validate
        if (!validTypes.includes(action.type)) {
          result.invalidActions.push(`${agent.name}: ${action.type}`);
          log.error(`  INVALID`);
        }

        // Propagate effects
        if (action.type === "speak" && action.content) {
          // Everyone in the room hears it
          for (const other of agentList) {
            if (other.eid !== agent.eid) {
              addPerception(tw.world, other.eid, {
                type: "auditory",
                content: `${agent.name} says: "${action.content}"`,
                source: agent.name,
              });
            }
          }
        }

        if (action.type === "move" && action.target) {
          // Update room occupancy would happen via goal system
          log.thought(`  (intends to move to ${action.target})`);
        }

        // Run systems
        const ctx = createSystemContext(tw.world, cycle * 1000);
        for (const systemDef of DETERMINISTIC_SYSTEM_DEFINITIONS) {
          try {
            systemDef.run(tw.world, ctx);
          } catch (e) {}
        }

        await new Promise(r => setTimeout(r, 300));

      } catch (error) {
        log.error(`  Error: ${error}`);
      }
    }
  }

  // Analyze social dynamics
  const actionsByAgent = new Map<string, AgentAction[]>();
  for (const action of result.cognitiveActions) {
    const agentName = (action as any).reason || "unknown";
    if (!actionsByAgent.has(agentName)) actionsByAgent.set(agentName, []);
    actionsByAgent.get(agentName)!.push(action);
  }

  log.header("\n--- Scenario 3 Analysis ---");

  for (const [name, actions] of actionsByAgent) {
    const speaks = actions.filter(a => a.type === "speak").length;
    const moves = actions.filter(a => a.type === "move").length;
    const observes = actions.filter(a => a.type === "observe").length;
    log.info(`  ${name}: ${speaks} speaks, ${moves} moves, ${observes} observes`);
  }

  // Edmund should try to move (seeking quiet) or at least think about it
  const edmundActions = actionsByAgent.get("Edmund") || [];
  const edmundSoughtQuiet = edmundActions.some(a =>
    a.type === "move" ||
    (a.type === "think" && a.content?.toLowerCase().includes("quiet"))
  );

  // Marla should speak a lot (trying to sell)
  const marlaActions = actionsByAgent.get("Marla") || [];
  const marlaSocialCount = marlaActions.filter(a => a.type === "speak" || a.type === "observe").length;

  result.passed =
    result.invalidActions.length === 0 &&
    result.cognitiveActions.length >= 6 &&
    marlaSocialCount >= 1; // At least some social behavior

  log.header("\n--- Scenario 3 Results ---");
  log.info(`  Total actions: ${result.cognitiveActions.length}`);
  log.info(`  Invalid actions: ${result.invalidActions.length}`);
  log.info(`  Edmund sought quiet: ${edmundSoughtQuiet ? "YES" : "NO"}`);
  log.info(`  Marla social actions: ${marlaSocialCount}`);
  log[result.passed ? "success" : "error"](`  Status: ${result.passed ? "PASSED" : "FAILED"}`);

  return result;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  log.header("\n" + "═".repeat(70));
  log.header("  AFFORDANCE & COGNITION BEHAVIORAL TEST SUITE");
  log.header("  Testing: Dynamic Affordances, Goals, Planning, Social AI");
  log.header("═".repeat(70));

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    log.error("\n❌ Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  // Show registered actions
  log.info("\n--- Registered Actions ---");
  const allActions = ActionRegistry.getAllActions();
  log.info(`  Core + Component actions: ${allActions.length}`);
  const byCategory = new Map<string, number>();
  for (const action of allActions) {
    byCategory.set(action.category, (byCategory.get(action.category) || 0) + 1);
  }
  for (const [cat, count] of byCategory) {
    log.info(`    ${cat}: ${count}`);
  }

  const results: ScenarioResult[] = [];

  // Run scenarios
  try {
    results.push(await runSoloSurvivalScenario());
  } catch (error) {
    log.error(`Scenario 1 crashed: ${error}`);
    if (error instanceof Error) console.error(error.stack);
  }

  try {
    results.push(await runCooperationScenario());
  } catch (error) {
    log.error(`Scenario 2 crashed: ${error}`);
    if (error instanceof Error) console.error(error.stack);
  }

  try {
    results.push(await runSocialDynamicsScenario());
  } catch (error) {
    log.error(`Scenario 3 crashed: ${error}`);
    if (error instanceof Error) console.error(error.stack);
  }

  // Final summary
  log.header("\n" + "═".repeat(70));
  log.header("  FINAL TEST RESULTS");
  log.header("═".repeat(70));

  let allPassed = true;
  let totalActions = 0;
  let totalInvalid = 0;

  for (const result of results) {
    const status = result.passed ? "✓ PASS" : "✗ FAIL";
    const statusFn = result.passed ? log.success : log.error;
    statusFn(`\n  ${status}: ${result.name}`);
    log.info(`    Actions: ${result.cognitiveActions.length}`);
    log.info(`    Invalid: ${result.invalidActions.length}`);

    totalActions += result.cognitiveActions.length;
    totalInvalid += result.invalidActions.length;
    if (!result.passed) allPassed = false;
  }

  log.header("\n" + "-".repeat(70));
  log.info(`  Total cognitive actions: ${totalActions}`);
  log.info(`  Total invalid actions: ${totalInvalid}`);
  log.info(`  Action validity rate: ${((totalActions - totalInvalid) / totalActions * 100).toFixed(1)}%`);

  log.header("\n" + "═".repeat(70));
  if (allPassed) {
    log.success("  ALL SCENARIOS PASSED");
  } else {
    log.error("  SOME SCENARIOS FAILED");
  }
  log.header("═".repeat(70) + "\n");

  process.exit(allPassed ? 0 : 1);
}

main().catch(error => {
  log.error(`Fatal error: ${error}`);
  process.exit(1);
});
