/**
 * BT Compiler Real LLM Test — System 2 Trains System 1
 *
 * Demonstrates the full learning lifecycle with real Gemini API calls:
 *
 *   1. Agent starts with a basic template policy (System 1)
 *   2. Template can't handle a novel situation → falls through to LLM (System 2)
 *   3. LLM reasons and picks an action
 *   4. Action succeeds → BT Compiler creates a new branch from the LLM's reasoning
 *   5. Next time the same situation occurs → BT handles it (no LLM needed)
 *   6. Over many ticks, the BT grows richer and the agent needs the LLM less
 *
 * Run:
 *   cd v2 && npx tsx src/behavioral-tests/41-bt-compiler-real-llm-test.ts
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Agent, BehaviorPolicy, Name, Needs, Traits, Memory } from "../ecs/components";
import { HasMemory } from "../ecs/relations";
import { addEntity, addComponent, query, hasComponent } from "bitecs";
import { registerEntity, executeActions } from "../cognition/cognition-system";
import { agentThink } from "../cognition/agent-mind";
import { worldSchema, ObjectManager } from "../world";
import { registerAffordance } from "../world/schema";
import { registerTrait } from "../world/trait-registry";
import {
  setAgentBehaviorPolicy,
  evaluateBehaviorPolicy,
  clearPolicyEvalHistory,
  validateBehaviorNode,
  type BehaviorNode,
} from "../cognition/behavior-policy";
import { getCompilationStats, resetCompilerState } from "../cognition/bt-compiler";
import { getTreeSize, getGrowthSummary, resetLearningState, growAffordanceBranch } from "../cognition/policy-learning";
import { recordPolicyAction, getPolicyEffectiveness, resetAllPolicyMetrics } from "../cognition/policy-metrics";
import { recordAction, clearActionHistory } from "../cognition/agent-action-history";
import { setLocatedIn } from "../ecs/location";

// =============================================================================
// CONFIG
// =============================================================================

const TICKS = 10;  // Total cognition ticks per agent

function log(msg: string) { console.log(msg); }
function header(title: string) { log("\n" + "═".repeat(72)); log(`  ${title}`); log("═".repeat(72)); }
function sub(title: string) { log(`\n── ${title} ${"─".repeat(Math.max(0, 66 - title.length))}`); }
function pass(msg: string) { log(`  ✅ ${msg}`); }
function fail(msg: string) { log(`  ❌ ${msg}`); }
function info(msg: string) { log(`  ℹ  ${msg}`); }

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) { console.error("No API key"); process.exit(1); }

  header("BT COMPILER — SYSTEM 2 TRAINS SYSTEM 1");
  info(`API key: ${apiKey.slice(0, 6)}...`);
  info(`${TICKS} cognition ticks per agent`);

  resetCompilerState();
  resetLearningState();
  resetAllPolicyMetrics();
  clearActionHistory();

  // ─── World Setup ───────────────────────────────────────────────────────
  sub("WORLD SETUP");

  const world = createArgosWorld("BTCompilerTest") as any;
  initializePrefabs(world);

  // Rooms
  const forge = createRoomEntity(world, { name: "Forge", description: "A hot forge with an anvil and bellows" });
  registerEntity(forge, "Forge");
  const tavern = createRoomEntity(world, { name: "Tavern", description: "A warm tavern with ale and food" });
  registerEntity(tavern, "Tavern");
  const market = createRoomEntity(world, { name: "Market", description: "A busy market with stalls" });
  registerEntity(market, "Market");

  // Custom affordances
  registerAffordance({ name: "forge_weapon", description: "Forge a weapon", requires: ["forgeable"], effects: [], category: "craft" } as any);
  registerAffordance({ name: "serve_drink", description: "Serve a drink", requires: ["serveable"], effects: [], category: "service" } as any);
  registerAffordance({ name: "haggle", description: "Negotiate a price", requires: ["sellable"], effects: [], category: "social" } as any);
  registerTrait({ name: "forgeable", description: "Can be forged", category: "material" });
  registerTrait({ name: "serveable", description: "Can be served", category: "consumable" });
  registerTrait({ name: "sellable", description: "Can be traded", category: "economic" });

  // Objects with traits
  const anvil = addEntity(world);
  addComponent(world, anvil, Name as any); Name.value[anvil] = "Iron Anvil";
  addComponent(world, anvil, Traits as any); Traits.active[anvil] = JSON.stringify(["forgeable", "examinable"]);
  setLocatedIn(world, anvil, forge); registerEntity(anvil, "Iron Anvil");

  const barrel = addEntity(world);
  addComponent(world, barrel, Name as any); Name.value[barrel] = "Ale Barrel";
  addComponent(world, barrel, Traits as any); Traits.active[barrel] = JSON.stringify(["serveable", "drinkable", "examinable"]);
  setLocatedIn(world, barrel, tavern); registerEntity(barrel, "Ale Barrel");

  const stall = addEntity(world);
  addComponent(world, stall, Name as any); Name.value[stall] = "Merchant Stall";
  addComponent(world, stall, Traits as any); Traits.active[stall] = JSON.stringify(["sellable", "examinable"]);
  setLocatedIn(world, stall, market); registerEntity(stall, "Merchant Stall");

  // Agent with a MINIMAL template — forces LLM fallback for most situations
  const agent = createAgentEntity(world, {
    name: "Aldric",
    role: "blacksmith",
    systemPrompt: "You are Aldric, a gruff but skilled blacksmith. You take pride in your craft and care about your tools. You're known for making the finest swords in the region.",
    roomId: forge,
  });
  registerEntity(agent, "Aldric");

  // Minimal starting tree — survival only. Everything else falls through to LLM.
  // This forces the LLM to fire for most ticks, generating decisions that get compiled.
  const minimalTree: BehaviorNode = {
    type: "selector",
    children: [
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "need_below", need: "energy", value: 15 } },
          { type: "action", action: { type: "rest" } },
        ],
      },
      // LLM fallback — forces System 2 to handle everything except survival
      { type: "llm_fallback" },
    ],
  };

  setAgentBehaviorPolicy(world, agent, minimalTree, true);
  clearPolicyEvalHistory(agent);

  const treeSizeBefore = getTreeSize(world, agent);
  info(`Starting tree: ${treeSizeBefore} nodes`);
  info(`Starting compiled branches: ${getCompilationStats(agent).compiledBranches}`);

  // ─── Simulation Loop ──────────────────────────────────────────────────
  header("SIMULATION: 10 TICKS");

  const actionLog: string[] = [];
  const sourceLog: string[] = []; // "policy" or "llm"
  let llmCalls = 0;
  let policyCalls = 0;

  for (let tick = 0; tick < TICKS; tick++) {
    sub(`Tick ${tick + 1}/${TICKS}`);

    // Check if BT would handle this or fall through to LLM
    const policyResult = evaluateBehaviorPolicy(world, agent);
    clearPolicyEvalHistory(agent); // Don't let the pre-check pollute history

    const wouldUseLLM = policyResult.kind === "llm_fallback" || policyResult.kind === "none";

    // Run actual cognition (this calls the LLM if BT returns llm_fallback)
    const treeBeforeTick = BehaviorPolicy.treeJson[agent];
    const action = await agentThink(world, agent);
    const desc = `${action.type}${action.target ? "→" + action.target : ""}${action.content ? ` "${action.content.slice(0, 40)}"` : ""}`;
    const treeAfterTick = BehaviorPolicy.treeJson[agent];
    const treeGrew = treeAfterTick !== treeBeforeTick;

    if (wouldUseLLM) {
      info(`[LLM]    ${desc}${treeGrew ? " 📈 COMPILED" : ""}`);
      sourceLog.push("llm");
      llmCalls++;
    } else {
      info(`[POLICY] ${desc}`);
      sourceLog.push("policy");
      policyCalls++;
    }

    actionLog.push(desc);

    // Execute the action
    try {
      await executeActions(world, [{ eid: agent, action: action as any }] as any);
    } catch { /* ignore execution errors */ }

    // Record metrics
    recordPolicyAction(agent, action.type, wouldUseLLM);
    recordAction(agent, action.type);

    // Show tree growth
    const treeNow = getTreeSize(world, agent);
    const tickStats = getCompilationStats(agent);
    if (treeGrew) {
      info(`  📈 Tree grew to ${treeNow} nodes, ${tickStats.compiledBranches} compiled branches`);
    }
  }

  // ─── Also test affordance discovery ────────────────────────────────────
  sub("AFFORDANCE DISCOVERY");
  // Simulate a new affordance appearing mid-simulation
  const grewAff = growAffordanceBranch(world, agent, "quench_steel", "quenchable");
  info(`Grew quench_steel branch: ${grewAff}`);

  // ─── Also test memory-driven growth ────────────────────────────────────
  sub("MEMORY GROWTH");
  // Add an important memory
  const memEid = addEntity(world);
  addComponent(world, memEid, Memory as any);
  Memory.content[memEid] = "A thief stole my finest sword last night!";
  Memory.importance[memEid] = 90;
  Memory.timestamp[memEid] = Date.now();
  addComponent(world, agent, HasMemory(memEid));
  info("Added high-importance memory about theft");

  // ─── Results ───────────────────────────────────────────────────────────
  header("RESULTS");

  const treeSizeAfter = getTreeSize(world, agent);
  const stats = getCompilationStats(agent);
  const growth = getGrowthSummary(agent);
  const metrics = getPolicyEffectiveness(agent);
  const tree = JSON.parse(BehaviorPolicy.treeJson[agent]);
  const treeValid = validateBehaviorNode(tree);

  info(`Actions: ${actionLog.join(" | ")}`);
  info(`Sources: ${sourceLog.join(" | ")}`);
  log("");
  info(`LLM calls: ${llmCalls}/${TICKS} (${(llmCalls/TICKS*100).toFixed(0)}%)`);
  info(`Policy calls: ${policyCalls}/${TICKS} (${(policyCalls/TICKS*100).toFixed(0)}%)`);
  info(`Tree: ${treeSizeBefore} → ${treeSizeAfter} nodes (+${treeSizeAfter - treeSizeBefore})`);
  info(`Compiled branches: ${stats.compiledBranches}`);
  info(`Active branches: ${stats.activeBranches.join(", ") || "none"}`);
  info(`Memory branches: ${growth.knownMemoryBranchCount}`);
  info(`Affordance branches: ${growth.knownAffordanceCount}`);
  info(`Diversity: ${metrics?.actionDiversity.toFixed(2) ?? "n/a"}`);
  info(`Tree valid: ${treeValid.ok}`);

  // ─── Scoring ──────────────────────────────────────────────────────────
  header("SCORECARD");

  let score = 0;
  const maxScore = 50;

  // 1. Tree grew (10 pts)
  const grew = treeSizeAfter > treeSizeBefore;
  score += grew ? 10 : 0;
  grew ? pass(`Tree grew: ${treeSizeBefore} → ${treeSizeAfter} (+${treeSizeAfter - treeSizeBefore} nodes)`)
       : fail(`Tree didn't grow: still ${treeSizeAfter} nodes`);

  // 2. At least 1 branch compiled from LLM (10 pts)
  const compiled = stats.compiledBranches > 0;
  score += compiled ? 10 : 0;
  compiled ? pass(`${stats.compiledBranches} branches compiled from LLM decisions`)
           : fail("No branches compiled from LLM");

  // 3. Tree is valid (10 pts)
  score += treeValid.ok ? 10 : 0;
  treeValid.ok ? pass("Tree validates after growth")
               : fail(`Tree invalid: ${(treeValid as any).error}`);

  // 4. Affordance discovery worked (10 pts)
  score += grewAff ? 10 : 0;
  grewAff ? pass("Affordance discovery grew a branch")
          : fail("Affordance discovery failed");

  // 5. Action diversity (10 pts)
  const diverse = (metrics?.actionDiversity ?? 0) > 1.0;
  score += diverse ? 10 : 0;
  diverse ? pass(`Diversity: ${metrics?.actionDiversity.toFixed(2)}`)
          : fail(`Low diversity: ${metrics?.actionDiversity?.toFixed(2) ?? 0}`);

  log(`\n  TOTAL: ${score}/${maxScore}`);
  log(`  Grade: ${score >= 45 ? "A" : score >= 35 ? "B" : score >= 25 ? "C" : score >= 15 ? "D" : "F"}\n`);

  // Save results
  const evalDir = path.resolve(__dirname, "../../data/eval");
  fs.mkdirSync(evalDir, { recursive: true });
  fs.writeFileSync(path.join(evalDir, `bt-compiler-${Date.now()}.json`), JSON.stringify({
    timestamp: new Date().toISOString(),
    score, maxScore,
    treeSizeBefore, treeSizeAfter,
    compiledBranches: stats.compiledBranches,
    activeBranches: stats.activeBranches,
    actionLog, sourceLog,
    llmCalls, policyCalls,
    diversity: metrics?.actionDiversity,
    treeValid: treeValid.ok,
    affordanceGrew: grewAff,
    treeJson: BehaviorPolicy.treeJson[agent],
  }, null, 2));

  process.exit(score >= 25 ? 0 : 1);
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
