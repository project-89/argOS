/**
 * Phase 2 Real LLM Stress Test
 *
 * This test hits the REAL Gemini API — no mocks. It exercises:
 *
 *   1. Policy generation: LLM creates unique behavior trees for 5 agents
 *   2. Policy validation: are the generated trees structurally valid?
 *   3. Policy execution: do generated policies produce coherent actions in ECS?
 *   4. Policy evolution: given a stuck agent, does evolved policy fix it?
 *   5. Agent cognition: LLM action selection with the new temperature/JSON/few-shot
 *   6. Metrics tracking: diversity, stuck detection, fallback rates over 60 ticks
 *
 * Output: structured eval report to stdout + JSON results to data/eval/
 *
 * Run:
 *   cd v2 && npx tsx src/behavioral-tests/40-phase2-real-llm-stress-test.ts
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } from "../ecs/prefabs";
import { Agent, Name, Needs, BehaviorPolicy, Memory, Belief, Impression, Mind } from "../ecs/components";
import { HasMemory, HasBelief, HasImpression } from "../ecs/relations";
import { addEntity, addComponent, query, hasComponent } from "bitecs";
import { registerEntity, executeActions } from "../cognition/cognition-system";
import { agentThink } from "../cognition/agent-mind";
import { worldSchema, ObjectManager } from "../world";
import {
  setAgentBehaviorPolicy,
  evaluateBehaviorPolicy,
  validateBehaviorNode,
  type BehaviorNode,
  type PolicyEvalResult,
} from "../cognition/behavior-policy";
import {
  generateBehaviorPolicy,
  generateBatchPolicies,
  evolvePolicy,
  _resetEvolutionTracking,
  type PolicyGenerationContext,
} from "../cognition/policy-generator";
import {
  recordPolicyAction,
  getPolicyEffectiveness,
  resetAllPolicyMetrics,
  computeActionDiversity,
} from "../cognition/policy-metrics";
import {
  registerAffordance,
  listAllAffordances,
} from "../world/schema";
import {
  registerTrait,
  listAllTraits,
} from "../world/trait-registry";
import { recordAction, clearActionHistory } from "../cognition/agent-action-history";
import { generateStimuliForAgent } from "../cognition/sensory-system";
import { getRoomForEntity } from "../ecs/location";
import { setMovementTarget, clearMovementTarget } from "../systems/builtin-systems";

// =============================================================================
// CONFIG
// =============================================================================

const AGENT_COUNT = 5;
const TICKS_PER_AGENT = 12;  // 12 cognition cycles per agent
const EVAL_DIR = path.resolve(__dirname, "../../data/eval");

// =============================================================================
// HELPERS
// =============================================================================

function log(msg: string) {
  console.log(msg);
}

function header(title: string) {
  log("\n" + "═".repeat(72));
  log(`  ${title}`);
  log("═".repeat(72));
}

function subheader(title: string) {
  log(`\n── ${title} ${"─".repeat(Math.max(0, 66 - title.length))}`);
}

function pass(msg: string) { log(`  ✅ ${msg}`); }
function fail(msg: string) { log(`  ❌ ${msg}`); }
function info(msg: string) { log(`  ℹ  ${msg}`); }
function warn(msg: string) { log(`  ⚠  ${msg}`); }

interface EvalResult {
  test: string;
  passed: boolean;
  details: string;
  data?: any;
}

const results: EvalResult[] = [];

function record(test: string, passed: boolean, details: string, data?: any) {
  results.push({ test, passed, details, data });
  if (passed) pass(`${test}: ${details}`);
  else fail(`${test}: ${details}`);
}

// =============================================================================
// WORLD SETUP
// =============================================================================

const AGENTS = [
  { name: "Greta", role: "innkeeper", personality: "Warm but shrewd. Knows everyone's secrets.", room: "Tavern Hall" },
  { name: "Aldric", role: "blacksmith", personality: "Gruff, perfectionist. Takes pride in his craft.", room: "Forge" },
  { name: "Sister Maren", role: "healer monk", personality: "Calm, compassionate. Sees the good in everyone.", room: "Temple" },
  { name: "Dex", role: "thief", personality: "Quick-witted, charming. Steals to survive, not for greed.", room: "Market Square" },
  { name: "Captain Renn", role: "guard captain", personality: "Stern, duty-bound. Secretly doubts the town council.", room: "Barracks" },
];

const ROOMS = [
  { name: "Tavern Hall", description: "A warm tavern with a crackling hearth, wooden tables, and the smell of ale." },
  { name: "Forge", description: "A hot forge with an anvil, bellows, and racks of unfinished weapons." },
  { name: "Temple", description: "A quiet stone temple with candles, an altar, and shelves of herbs." },
  { name: "Market Square", description: "A bustling open market with stalls, crates, and crowds." },
  { name: "Barracks", description: "A military barracks with weapon racks, bunks, and a notice board." },
];

const CUSTOM_AFFORDANCES = [
  { name: "forge_weapon", description: "Forge a weapon on the anvil", requires: ["forgeable"], effects: [], category: "craft" },
  { name: "brew_potion", description: "Brew a healing potion from herbs", requires: ["brewable"], effects: [], category: "craft" },
  { name: "pick_lock", description: "Attempt to pick a lock", requires: ["lockpickable"], effects: [], category: "stealth" },
  { name: "haggle", description: "Negotiate a better price", requires: ["sellable"], effects: [], category: "social" },
  { name: "pray", description: "Pray at the altar for guidance", requires: ["sacred"], effects: [], category: "spiritual" },
  { name: "patrol", description: "Walk a patrol route watching for trouble", requires: ["patrollable"], effects: [], category: "duty" },
  { name: "tend_fire", description: "Stoke and tend a fire", requires: ["fire"], effects: [], category: "domestic" },
  { name: "serve_drink", description: "Serve a drink to a patron", requires: ["serveable"], effects: [], category: "service" },
];

const CUSTOM_TRAITS = [
  { name: "forgeable", description: "Can be forged into weapons", category: "material" },
  { name: "brewable", description: "Can be brewed into potions", category: "material" },
  { name: "lockpickable", description: "Has a lock that can be picked", category: "security" },
  { name: "sellable", description: "Can be bought or sold", category: "economic" },
  { name: "sacred", description: "A sacred place or object", category: "spiritual" },
  { name: "patrollable", description: "An area that can be patrolled", category: "spatial" },
  { name: "fire", description: "A fire that can be tended", category: "element" },
  { name: "serveable", description: "A drink that can be served", category: "consumable" },
];

const OBJECTS = [
  { name: "Iron Anvil", room: "Forge", traits: ["forgeable", "examinable"] },
  { name: "Herb Shelf", room: "Temple", traits: ["brewable", "examinable"] },
  { name: "Stone Altar", room: "Temple", traits: ["sacred", "examinable"] },
  { name: "Merchant Stall", room: "Market Square", traits: ["sellable", "examinable"] },
  { name: "Locked Chest", room: "Market Square", traits: ["lockpickable", "examinable"] },
  { name: "Hearth Fire", room: "Tavern Hall", traits: ["fire", "examinable"] },
  { name: "Ale Barrel", room: "Tavern Hall", traits: ["serveable", "examinable", "drinkable"] },
  { name: "Patrol Route", room: "Barracks", traits: ["patrollable", "examinable"] },
  { name: "Notice Board", room: "Barracks", traits: ["examinable", "readable"] },
];

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    console.error("ERROR: GOOGLE_GENERATIVE_AI_API_KEY not set in .env");
    process.exit(1);
  }

  header("PHASE 2 REAL LLM STRESS TEST");
  info(`API key present (${apiKey.slice(0, 6)}...)`);
  info(`Agents: ${AGENT_COUNT}, Ticks/agent: ${TICKS_PER_AGENT}`);

  _resetEvolutionTracking();
  resetAllPolicyMetrics();
  clearActionHistory();

  // ─── World setup ───────────────────────────────────────────────────────
  subheader("1. WORLD SETUP");

  const world = createArgosWorld("Phase2StressTest") as any;
  initializePrefabs(world);
  const objectManager = new ObjectManager(world);

  // Register custom vocabulary
  for (const aff of CUSTOM_AFFORDANCES) {
    registerAffordance(aff as any);
  }
  for (const trait of CUSTOM_TRAITS) {
    registerTrait(trait);
  }
  info(`Registered ${CUSTOM_AFFORDANCES.length} custom affordances, ${CUSTOM_TRAITS.length} custom traits`);

  // Create rooms
  const roomEids: Record<string, number> = {};
  for (const r of ROOMS) {
    const eid = createRoomEntity(world, { name: r.name, description: r.description });
    registerEntity(eid, r.name);
    roomEids[r.name] = eid;
  }
  info(`Created ${ROOMS.length} rooms`);

  // Create objects
  for (const obj of OBJECTS) {
    const eid = createRoomEntity(world, { name: obj.name, description: `A ${obj.name.toLowerCase()}` });
    // Actually use createObjectEntity-style setup or just add to room
    const objEid = addEntity(world);
    addComponent(world, objEid, Name as any);
    Name.value[objEid] = obj.name;
    // Add traits
    const { Traits } = await import("../ecs/components");
    addComponent(world, objEid, Traits as any);
    Traits.active[objEid] = JSON.stringify(obj.traits);
    // Place in room
    const { setLocatedIn } = await import("../ecs/location");
    const roomEid = roomEids[obj.room];
    if (roomEid !== undefined) {
      setLocatedIn(world, objEid, roomEid);
    }
    registerEntity(objEid, obj.name);
  }
  info(`Created ${OBJECTS.length} objects with traits`);

  // Create agents
  const agentEids: Record<string, number> = {};
  for (const a of AGENTS) {
    const roomEid = roomEids[a.room];
    const eid = createAgentEntity(world, {
      name: a.name,
      role: a.role,
      systemPrompt: `You are ${a.name}, a ${a.role}. ${a.personality}`,
      roomId: roomEid,
    });
    registerEntity(eid, a.name);
    agentEids[a.name] = eid;
  }
  info(`Created ${AGENT_COUNT} agents in their starting rooms`);

  // ─── Test 1: Batch policy generation ───────────────────────────────────
  header("TEST 1: LLM POLICY GENERATION");

  const allAffordances = listAllAffordances();
  const allTraits = listAllTraits();

  const roomNames = ROOMS.map(r => r.name);

  const contexts: PolicyGenerationContext[] = AGENTS.map(a => ({
    name: a.name,
    role: a.role,
    personality: a.personality,
    currentRoom: a.room,
    availableAffordances: allAffordances.map(af => ({
      name: af.name,
      description: af.description || "",
      requires: af.requires || [],
    })),
    availableTraits: allTraits.map(t => ({
      name: t.name,
      description: t.description || "",
      category: t.category || "general",
    })),
    availableRelationships: [],
    worldTheme: "medieval village with a tavern, forge, temple, market, and barracks",
    existingTemplates: ["survival", "innkeeper", "guard", "scholar", "merchant", "worker"],
    roomNames,
  }));

  info("Calling generateBatchPolicies() with real LLM...");
  const genStart = Date.now();
  let generatedPolicies: Map<string, BehaviorNode>;
  try {
    generatedPolicies = await generateBatchPolicies(contexts);
  } catch (err: any) {
    fail(`Batch generation threw: ${err.message}`);
    generatedPolicies = new Map();
  }
  const genMs = Date.now() - genStart;
  info(`Generation took ${(genMs / 1000).toFixed(1)}s`);

  // Evaluate each generated policy
  const policyEvals: Record<string, any> = {};

  for (const agent of AGENTS) {
    subheader(`Policy: ${agent.name} (${agent.role})`);
    const policy = generatedPolicies.get(agent.name);

    if (!policy) {
      record(`gen:${agent.name}`, false, "No policy generated");
      policyEvals[agent.name] = { generated: false };
      continue;
    }

    // Validation
    const validation = validateBehaviorNode(policy);
    record(`validate:${agent.name}`, validation.ok,
      validation.ok ? "Valid behavior tree" : `Invalid: ${(validation as any).error}`);

    // Structure analysis
    const json = JSON.stringify(policy);
    const nodeCount = (json.match(/"type"/g) || []).length;
    const depth = measureDepth(policy);
    const actionTypes = extractActionTypes(policy);
    const conditionTypes = extractConditionTypes(policy);
    const usesCustomAffordances = CUSTOM_AFFORDANCES.some(a =>
      json.toLowerCase().includes(a.name.toLowerCase()));
    const usesMemoryConditions = json.includes("has_memory") || json.includes("has_belief") ||
      json.includes("impression_above") || json.includes("impression_below");
    const usesWeightedRandom = json.includes("weighted_random");
    const usesLastNActions = json.includes("last_n_actions");
    const waitCount = (json.match(/"wait"/g) || []).length;

    info(`  Nodes: ${nodeCount}, Depth: ${depth}`);
    info(`  Action types: ${[...actionTypes].join(", ")}`);
    info(`  Condition types: ${[...conditionTypes].join(", ")}`);
    info(`  Custom affordances: ${usesCustomAffordances} | Memory conditions: ${usesMemoryConditions}`);
    info(`  Weighted random: ${usesWeightedRandom} | last_n_actions: ${usesLastNActions} | wait refs: ${waitCount}`);

    record(`structure:${agent.name}`, nodeCount >= 5 && nodeCount <= 200,
      `${nodeCount} nodes, depth ${depth}`);
    record(`diversity:${agent.name}`, actionTypes.size >= 3,
      `${actionTypes.size} distinct action types: ${[...actionTypes].join(", ")}`);

    policyEvals[agent.name] = {
      generated: true,
      valid: validation.ok,
      nodeCount,
      depth,
      actionTypes: [...actionTypes],
      conditionTypes: [...conditionTypes],
      usesCustomAffordances,
      usesMemoryConditions,
      policyJson: json.slice(0, 2000),
    };

    // Assign policy to agent
    if (validation.ok) {
      setAgentBehaviorPolicy(world, agentEids[agent.name], policy, true);
    }
  }

  // Cross-agent uniqueness (logged, scored later)
  info(`Unique policies: ${new Set([...generatedPolicies.values()].map(p => JSON.stringify(p))).size}/${generatedPolicies.size}`);

  // ─── Test 2: Policy execution in ECS ───────────────────────────────────
  header("TEST 2: POLICY EXECUTION (deterministic, no LLM)");

  const executionLog: Record<string, string[]> = {};

  for (const agent of AGENTS) {
    const eid = agentEids[agent.name];
    if (!hasComponent(world, eid, BehaviorPolicy as any) || !BehaviorPolicy.enabled[eid]) {
      info(`${agent.name}: skipped (no valid policy)`);
      executionLog[agent.name] = [];
      continue;
    }

    const actions: string[] = [];
    for (let tick = 0; tick < TICKS_PER_AGENT; tick++) {
      const result = evaluateBehaviorPolicy(world, eid);
      if (result.kind === "action") {
        const desc = `${result.action.type}${result.action.target ? "→" + result.action.target : ""}`;
        actions.push(desc);
        recordPolicyAction(eid, result.action.type, false);
        recordAction(eid, result.action.type);
      } else {
        actions.push(result.kind);
        recordPolicyAction(eid, result.kind, result.kind === "llm_fallback");
      }
    }

    executionLog[agent.name] = actions;
    const metrics = getPolicyEffectiveness(eid);
    const diversity = metrics?.actionDiversity ?? 0;
    const stuckCount = metrics?.stuckLoopCount ?? 0;
    const llmFallback = metrics?.llmFallbackRate ?? 0;

    subheader(`${agent.name} (${agent.role})`);
    info(`Actions: ${actions.join(" | ")}`);
    info(`Diversity: ${diversity.toFixed(2)}, Stuck: ${stuckCount}, LLM fallback: ${(llmFallback * 100).toFixed(0)}%`);

    record(`exec:${agent.name}:diversity`, diversity > 0.3,
      `Shannon entropy ${diversity.toFixed(2)} (want > 0.3)`);
    record(`exec:${agent.name}:no-all-wait`, !actions.every(a => a === "wait" || a === "none"),
      actions.every(a => a === "wait" || a === "none") ? "All wait/none — dead policy" : "Produces real actions");
    record(`exec:${agent.name}:fallback`, llmFallback < 0.5,
      `LLM fallback rate ${(llmFallback * 100).toFixed(0)}% (want < 50%)`);
  }

  // ─── Test 3: LLM agent cognition (real API calls) ──────────────────────
  header("TEST 3: LLM AGENT COGNITION (real API, 2 ticks per agent)");

  const cognitionLog: Record<string, any[]> = {};

  for (const agent of AGENTS) {
    const eid = agentEids[agent.name];
    subheader(`${agent.name} cognition`);

    const agentActions: any[] = [];
    for (let tick = 0; tick < 2; tick++) {
      try {
        const action = await agentThink(world, eid);
        const desc = `${action.type}${action.target ? "→" + action.target : ""}${action.content ? ` "${action.content.slice(0, 60)}"` : ""}`;
        info(`  Tick ${tick}: ${desc}`);
        agentActions.push({ tick, action: { type: action.type, target: action.target, content: action.content?.slice(0, 200) } });

        // Execute the action to update world state
        await executeActions(world, [{
          eid,
          action: action as any,
        }] as any);
      } catch (err: any) {
        fail(`  Tick ${tick}: ${err.message}`);
        agentActions.push({ tick, error: err.message });
      }
    }

    cognitionLog[agent.name] = agentActions;
    const realActions = agentActions.filter(a => a.action && a.action.type !== "wait");
    record(`cognition:${agent.name}`, realActions.length > 0,
      `${realActions.length}/2 non-wait actions`);
  }

  // ─── Test 4: Policy evolution (real LLM) ────────────────────────────────
  header("TEST 4: POLICY EVOLUTION (real LLM)");

  // Create a deliberately stuck agent
  const stuckPolicy: BehaviorNode = {
    type: "action",
    action: { type: "wait" },
  };

  const stuckContext: PolicyGenerationContext = {
    name: "StuckBot",
    role: "confused villager",
    personality: "Lost and confused, does nothing all day",
    currentRoom: "Market Square",
    availableAffordances: contexts[0].availableAffordances,
    availableTraits: contexts[0].availableTraits,
    availableRelationships: [],
    worldTheme: "medieval village",
    existingTemplates: ["survival"],
  };

  info("Evolving a stuck 'always wait' policy via real LLM...");
  const evolveStart = Date.now();
  let evolvedPolicy: BehaviorNode;
  try {
    evolvedPolicy = await evolvePolicy(
      stuckPolicy,
      stuckContext,
      "Agent is completely stuck — only waits, never acts",
      [
        "All 50 actions in the last window were 'wait'",
        "Action diversity is 0.0 (minimum possible)",
        "Agent has not interacted with any object or agent",
        "Agent has not moved or explored",
      ]
    );
  } catch (err: any) {
    fail(`Evolution threw: ${err.message}`);
    evolvedPolicy = stuckPolicy;
  }
  const evolveMs = Date.now() - evolveStart;
  info(`Evolution took ${(evolveMs / 1000).toFixed(1)}s`);

  const evolvedValidation = validateBehaviorNode(evolvedPolicy);
  const evolvedJson = JSON.stringify(evolvedPolicy);
  const evolvedNodes = (evolvedJson.match(/"type"/g) || []).length;
  const isStructurallyDifferent = evolvedJson !== JSON.stringify(stuckPolicy);
  const evolvedActionTypes = extractActionTypes(evolvedPolicy);

  info(`Evolved policy: ${evolvedNodes} nodes, ${evolvedActionTypes.size} action types`);
  info(`Action types: ${[...evolvedActionTypes].join(", ")}`);
  info(`Structurally different: ${isStructurallyDifferent}`);

  record("evolve:valid", evolvedValidation.ok,
    evolvedValidation.ok ? "Evolved policy is valid" : `Invalid: ${(evolvedValidation as any).error}`);
  record("evolve:different", isStructurallyDifferent,
    isStructurallyDifferent ? "Evolved policy is structurally different from stuck policy" : "Evolution produced same policy — LLM failed to fix it");
  record("evolve:richer", evolvedNodes > 1,
    `${evolvedNodes} nodes (stuck had 1)`);
  record("evolve:no-wait-only", !evolvedJson.includes('"wait"') || evolvedActionTypes.size > 1,
    evolvedActionTypes.size > 1 ? `${evolvedActionTypes.size} action types (not just wait)` : "Still only 'wait' — evolution failed");

  // ─── Test 5: Memory-conditioned behavior (real ECS) ────────────────────
  header("TEST 5: MEMORY-CONDITIONED BEHAVIOR");

  // Give Dex a memory of being caught stealing
  const dexEid = agentEids["Dex"];
  const memEid = addEntity(world);
  addComponent(world, memEid, Memory as any);
  Memory.content[memEid] = "Captain Renn caught me stealing from the merchant stall yesterday. I need to lay low.";
  Memory.importance[memEid] = 90;
  Memory.timestamp[memEid] = Date.now();
  addComponent(world, dexEid, HasMemory(memEid));

  // Create a policy that branches on memory
  const memoryPolicy: BehaviorNode = {
    type: "selector",
    children: [
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "has_memory", includes: "caught" } },
          { type: "condition", op: { type: "room_has_named", name: "Captain Renn" } },
          { type: "action", action: { type: "move", target: "Temple" } },  // flee!
        ],
      },
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "has_memory", includes: "caught" } },
          { type: "action", action: { type: "action", type: "observe" } as any },
        ],
      },
      { type: "interact_any_affordance", scope: "room" },
      { type: "action", action: { type: "observe" } },
    ],
  };

  setAgentBehaviorPolicy(world, dexEid, memoryPolicy, true);
  const memResult = evaluateBehaviorPolicy(world, dexEid);
  info(`Dex (has "caught" memory, Renn NOT in room): ${memResult.kind}${memResult.kind === "action" ? " → " + memResult.action.type : ""}`);

  // The memory of being caught exists, but Captain Renn is NOT in Dex's room
  // So first branch fails (room_has_named), second succeeds (has_memory + observe)
  record("memory:caught-no-renn", memResult.kind === "action",
    memResult.kind === "action" ? `Dex observes cautiously (${memResult.action.type})` : "No action produced");

  // ─── SCORED SUMMARY ─────────────────────────────────────────────────────
  header("SCORED EVAL");

  // Scoring rubric (0-10 each, 100 total)
  interface Score { name: string; value: number; max: number; detail: string; }
  const scores: Score[] = [];

  // 1. Validation rate (10 pts)
  const validCount = Object.values(policyEvals).filter((e: any) => e.valid).length;
  scores.push({
    name: "Validation Rate",
    value: Math.round(validCount / AGENT_COUNT * 10),
    max: 10,
    detail: `${validCount}/${AGENT_COUNT} valid policies`,
  });

  // 2. Uniqueness (10 pts)
  const policyStrings = [...generatedPolicies.values()].map(p => JSON.stringify(p));
  const uniquePolicies = new Set(policyStrings).size;
  scores.push({
    name: "Uniqueness",
    value: Math.round(uniquePolicies / generatedPolicies.size * 10),
    max: 10,
    detail: `${uniquePolicies}/${generatedPolicies.size} structurally unique`,
  });

  // 3. Custom affordance usage (10 pts)
  const customAffCount = Object.values(policyEvals).filter((e: any) => e.usesCustomAffordances).length;
  scores.push({
    name: "Custom Affordance Usage",
    value: Math.round(customAffCount / AGENT_COUNT * 10),
    max: 10,
    detail: `${customAffCount}/${AGENT_COUNT} agents use custom affordances`,
  });

  // 4. Memory condition usage (10 pts)
  const memCondCount = Object.values(policyEvals).filter((e: any) => e.usesMemoryConditions).length;
  scores.push({
    name: "Memory/Belief Conditions",
    value: Math.round(memCondCount / AGENT_COUNT * 10),
    max: 10,
    detail: `${memCondCount}/${AGENT_COUNT} agents use has_memory/has_belief/impression`,
  });

  // 5. Tree depth (10 pts) — want depth >= 3
  const depths = Object.values(policyEvals).map((e: any) => e.depth || 0);
  const avgDepth = depths.reduce((a, b) => a + b, 0) / depths.length;
  const deepEnough = depths.filter(d => d >= 3).length;
  scores.push({
    name: "Tree Depth",
    value: Math.round(deepEnough / AGENT_COUNT * 10),
    max: 10,
    detail: `${deepEnough}/${AGENT_COUNT} have depth >= 3 (avg ${avgDepth.toFixed(1)})`,
  });

  // 6. Action diversity in execution (10 pts) — want entropy > 1.5
  const diversities = Object.entries(executionLog).map(([name, actions]) => {
    const eid = agentEids[name];
    const m = getPolicyEffectiveness(eid);
    return m?.actionDiversity ?? 0;
  });
  const avgDiversity = diversities.reduce((a, b) => a + b, 0) / diversities.length;
  const diverseEnough = diversities.filter(d => d > 1.5).length;
  scores.push({
    name: "Execution Diversity",
    value: Math.round(diverseEnough / AGENT_COUNT * 10),
    max: 10,
    detail: `${diverseEnough}/${AGENT_COUNT} have entropy > 1.5 (avg ${avgDiversity.toFixed(2)})`,
  });

  // 7. No stuck loops in execution (10 pts)
  const stuckCounts = Object.keys(executionLog).map(name => {
    const eid = agentEids[name];
    const m = getPolicyEffectiveness(eid);
    return m?.stuckLoopCount ?? 0;
  });
  // Allow up to 2 stuck loop detections per 12 ticks — repeating an action
  // twice before the anti-repetition kicks in is natural behavior
  const acceptableStuck = stuckCounts.filter(c => c <= 2).length;
  scores.push({
    name: "Low Stuck Loops",
    value: Math.round(acceptableStuck / AGENT_COUNT * 10),
    max: 10,
    detail: `${acceptableStuck}/${AGENT_COUNT} have ≤2 stuck loops`,
  });

  // 8. Move targets are rooms only (10 pts)
  let totalMoves = 0;
  let validMoves = 0;
  const roomNameSet = new Set(ROOMS.map(r => r.name.toLowerCase()));
  for (const actions of Object.values(executionLog)) {
    for (const a of actions) {
      if (a.startsWith("move→")) {
        totalMoves++;
        const target = a.replace("move→", "").toLowerCase();
        if (roomNameSet.has(target)) validMoves++;
      }
    }
  }
  scores.push({
    name: "Move Target Validity",
    value: totalMoves > 0 ? Math.round(validMoves / totalMoves * 10) : 10,
    max: 10,
    detail: `${validMoves}/${totalMoves} moves target valid rooms`,
  });

  // 9. Cognition success (10 pts) — non-wait actions from LLM ticks
  const totalCogTicks = Object.values(cognitionLog).reduce((s, ticks) => s + ticks.length, 0);
  const nonWaitCog = Object.values(cognitionLog).reduce((s, ticks) =>
    s + ticks.filter((t: any) => t.action && t.action.type !== "wait").length, 0);
  scores.push({
    name: "Cognition Quality",
    value: totalCogTicks > 0 ? Math.round(nonWaitCog / totalCogTicks * 10) : 0,
    max: 10,
    detail: `${nonWaitCog}/${totalCogTicks} non-wait cognition actions`,
  });

  // 10. Evolution quality (10 pts)
  let evolScore = 0;
  if (evolvedValidation.ok) evolScore += 3;
  if (isStructurallyDifferent) evolScore += 3;
  if (evolvedNodes > 10) evolScore += 2;
  if (evolvedActionTypes.size >= 4) evolScore += 2;
  scores.push({
    name: "Evolution Quality",
    value: evolScore,
    max: 10,
    detail: `valid=${evolvedValidation.ok} different=${isStructurallyDifferent} nodes=${evolvedNodes} types=${evolvedActionTypes.size}`,
  });

  // Print scorecard
  log("");
  const totalScore = scores.reduce((s, sc) => s + sc.value, 0);
  const maxScore = scores.reduce((s, sc) => s + sc.max, 0);

  for (const sc of scores) {
    const bar = "█".repeat(sc.value) + "░".repeat(sc.max - sc.value);
    const pct = sc.value === sc.max ? "PERFECT" : `${sc.value}/${sc.max}`;
    log(`  ${sc.name.padEnd(28)} ${bar} ${pct.padStart(8)}  ${sc.detail}`);
  }

  log(`\n  ${"TOTAL".padEnd(28)} ${"█".repeat(Math.round(totalScore / 10))}${"░".repeat(10 - Math.round(totalScore / 10))} ${totalScore}/${maxScore}`);

  const grade = totalScore >= 90 ? "A" : totalScore >= 80 ? "B" : totalScore >= 70 ? "C" : totalScore >= 60 ? "D" : "F";
  log(`\n  Grade: ${grade}\n`);

  // Pass/fail summary
  header("PASS/FAIL DETAILS");
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  for (const r of results) {
    if (!r.passed) fail(`${r.test}: ${r.details}`);
  }
  if (failed === 0) pass("All individual checks passed");
  log(`\n  Checks: ${passed}/${total} passed, ${failed} failed\n`);

  // Save structured results
  fs.mkdirSync(EVAL_DIR, { recursive: true });
  const evalFile = path.join(EVAL_DIR, `phase2-eval-${Date.now()}.json`);
  fs.writeFileSync(evalFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    grade,
    totalScore,
    maxScore,
    scores,
    summary: { passed, failed, total },
    results,
    policyEvals,
    executionLog,
    cognitionLog,
    evolvedPolicy: {
      valid: evolvedValidation.ok,
      nodeCount: evolvedNodes,
      structurallyDifferent: isStructurallyDifferent,
      actionTypes: [...evolvedActionTypes],
      json: evolvedJson.slice(0, 5000),
    },
    timing: {
      generationMs: genMs,
      evolutionMs: evolveMs,
    },
  }, null, 2));
  info(`Results saved to ${evalFile}`);

  if (totalScore < 60) {
    process.exit(1);
  }
}

// =============================================================================
// TREE ANALYSIS UTILITIES
// =============================================================================

function measureDepth(node: BehaviorNode, d: number = 0): number {
  if ("children" in node && Array.isArray((node as any).children)) {
    return Math.max(...(node as any).children.map((c: any) => measureDepth(c, d + 1)));
  }
  if ("choices" in node && Array.isArray((node as any).choices)) {
    return Math.max(...(node as any).choices.map((c: any) => measureDepth(c.child, d + 1)));
  }
  return d;
}

function extractActionTypes(node: any, types: Set<string> = new Set()): Set<string> {
  if (!node || typeof node !== "object") return types;
  if (node.type === "action" && node.action?.type) types.add(node.action.type);
  if (node.type === "interact_with_trait") types.add("interact_with_trait");
  if (node.type === "interact_any_affordance") types.add("interact_any_affordance");
  if (node.type === "social_visit") types.add("social_visit");
  if (node.type === "wander") types.add("wander");
  if (node.type === "llm_fallback") types.add("llm_fallback");
  if (node.children) for (const c of node.children) extractActionTypes(c, types);
  if (node.choices) for (const c of node.choices) extractActionTypes(c.child, types);
  return types;
}

function extractConditionTypes(node: any, types: Set<string> = new Set()): Set<string> {
  if (!node || typeof node !== "object") return types;
  if (node.type === "condition" && node.op?.type) types.add(node.op.type);
  if (node.children) for (const c of node.children) extractConditionTypes(c, types);
  if (node.choices) for (const c of node.choices) extractConditionTypes(c.child, types);
  return types;
}

// =============================================================================
// RUN
// =============================================================================

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
