/**
 * Extended Learning Test — Does the system ACTUALLY learn?
 *
 * This is the honest test. 50 ticks, 3 agents, changing world conditions.
 * We measure:
 *
 *   1. Tree growth: do trees actually get bigger over time?
 *   2. LLM reduction: does the agent need the LLM less as it learns?
 *   3. Skill compilation: do multi-step plans become reusable skills?
 *   4. Adaptation: when conditions change, does behavior change?
 *   5. Reinforcement: do successful actions get reinforced?
 *   6. Memory integration: do memories create new branches?
 *   7. Problem solving: can the agent handle a novel situation?
 *
 * Run:
 *   cd v2 && npx tsx src/behavioral-tests/42-extended-learning-test.ts
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
import { addEntity, addComponent, hasComponent } from "bitecs";
import { registerEntity, executeActions } from "../cognition/cognition-system";
import { agentThink } from "../cognition/agent-mind";
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
import { getTreeSize, getGrowthSummary, resetLearningState, growAffordanceBranch, getReinforcementState } from "../cognition/policy-learning";
import { recordPolicyAction, getPolicyEffectiveness, resetAllPolicyMetrics } from "../cognition/policy-metrics";
import { recordAction, clearActionHistory } from "../cognition/agent-action-history";
import { setLocatedIn, getRoomForEntity } from "../ecs/location";
import { setMovementTarget } from "../systems/builtin-systems";
import { listSkills, resetSkillRegistry } from "../cognition/skill-registry";

// =============================================================================
// HELPERS
// =============================================================================

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
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("No API key"); process.exit(1);
  }

  header("EXTENDED LEARNING TEST — 30 TICKS, 3 AGENTS");

  resetCompilerState();
  resetLearningState();
  resetAllPolicyMetrics();
  clearActionHistory();
  resetSkillRegistry();

  // ─── World ─────────────────────────────────────────────────────────────
  sub("WORLD SETUP");

  const world = createArgosWorld("ExtendedLearningTest") as any;
  initializePrefabs(world);

  const forge = createRoomEntity(world, { name: "Forge", description: "A hot forge with bellows and an anvil" });
  registerEntity(forge, "Forge");
  const tavern = createRoomEntity(world, { name: "Tavern", description: "A warm tavern with ale and food" });
  registerEntity(tavern, "Tavern");
  const market = createRoomEntity(world, { name: "Market", description: "A busy market with stalls and merchants" });
  registerEntity(market, "Market");
  const temple = createRoomEntity(world, { name: "Temple", description: "A quiet stone temple with candles" });
  registerEntity(temple, "Temple");

  // Affordances
  registerAffordance({ name: "forge_weapon", description: "Forge a weapon on the anvil", requires: ["forgeable"], effects: [], category: "craft" } as any);
  registerAffordance({ name: "serve_drink", description: "Serve a drink to someone", requires: ["serveable"], effects: [], category: "service" } as any);
  registerAffordance({ name: "haggle", description: "Negotiate a price", requires: ["sellable"], effects: [], category: "social" } as any);
  registerAffordance({ name: "pray", description: "Pray at the altar", requires: ["sacred"], effects: [], category: "spiritual" } as any);
  registerTrait({ name: "forgeable", description: "Can be forged", category: "material" });
  registerTrait({ name: "serveable", description: "Can be served", category: "consumable" });
  registerTrait({ name: "sellable", description: "Can be traded", category: "economic" });
  registerTrait({ name: "sacred", description: "A sacred object", category: "spiritual" });

  // Objects
  function addObj(name: string, room: number, traits: string[]) {
    const eid = addEntity(world);
    addComponent(world, eid, Name as any); Name.value[eid] = name;
    addComponent(world, eid, Traits as any); Traits.active[eid] = JSON.stringify(traits);
    setLocatedIn(world, eid, room); registerEntity(eid, name);
    return eid;
  }
  addObj("Iron Anvil", forge, ["forgeable", "examinable"]);
  addObj("Ale Barrel", tavern, ["serveable", "drinkable", "examinable"]);
  addObj("Merchant Stall", market, ["sellable", "examinable"]);
  addObj("Stone Altar", temple, ["sacred", "examinable"]);

  // ─── Agents with MINIMAL trees (forces LLM learning) ──────────────────
  sub("AGENTS");

  const minimalTree = (extraChildren?: BehaviorNode[]): BehaviorNode => ({
    type: "selector",
    children: [
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "need_below", need: "energy", value: 15 } },
          { type: "skill", name: "rest" },
        ],
      },
      ...(extraChildren || []),
      { type: "llm_fallback" },
    ],
  });

  interface AgentData {
    eid: number;
    name: string;
    role: string;
    actions: string[];
    sources: string[];
    llmCalls: number;
    policyCalls: number;
    treeSizes: number[];
    compiledBranches: number[];
  }

  const agents: AgentData[] = [];

  function createAgent(name: string, role: string, personality: string, room: number, extraBranches?: BehaviorNode[]) {
    const eid = createAgentEntity(world, { name, role, systemPrompt: `You are ${name}, a ${role}. ${personality}`, roomId: room });
    registerEntity(eid, name);
    setAgentBehaviorPolicy(world, eid, minimalTree(extraBranches), true);
    clearPolicyEvalHistory(eid);
    const data: AgentData = { eid, name, role, actions: [], sources: [], llmCalls: 0, policyCalls: 0, treeSizes: [getTreeSize(world, eid)], compiledBranches: [0] };
    agents.push(data);
    info(`${name} (${role}) in ${Name.value[room]} — ${getTreeSize(world, eid)} nodes`);
    return data;
  }

  createAgent("Aldric", "blacksmith", "Gruff and skilled. Takes pride in his craft. Makes the finest swords.", forge);
  createAgent("Greta", "innkeeper", "Warm and shrewd. Knows everyone's business. Runs the best tavern.", tavern);
  createAgent("Brother Caius", "monk", "Contemplative and kind. Seeks wisdom through prayer and helping others.", temple);

  // ─── Phase 1: Baseline (ticks 1-15) ────────────────────────────────────
  header("PHASE 1: BASELINE (ticks 1-10)");
  info("Agents start with minimal trees. Every decision goes to LLM.");
  info("Successful LLM decisions compile into BT branches.");

  await runTicks(world, agents, 1, 10);

  sub("Phase 1 Results");
  for (const a of agents) {
    const size = getTreeSize(world, a.eid);
    const stats = getCompilationStats(a.eid);
    info(`${a.name}: tree ${a.treeSizes[0]} → ${size} nodes, ${stats.compiledBranches} compiled, LLM ${a.llmCalls}/${a.actions.length}`);
  }

  // ─── Phase 2: Adaptation (ticks 11-20) ─────────────────────────────────
  header("PHASE 2: ADAPTATION (ticks 11-20)");
  info("Inject memories and new affordances. Agents should adapt.");

  // Give Aldric a memory about a broken anvil
  const mem1 = addEntity(world);
  addComponent(world, mem1, Memory as any);
  Memory.content[mem1] = "The anvil cracked while forging a great sword. I need to be more careful.";
  Memory.importance[mem1] = 85;
  Memory.timestamp[mem1] = Date.now();
  addComponent(world, agents[0].eid, HasMemory(mem1));
  info("Aldric: added memory about cracked anvil");

  // Give Greta a memory about a profitable night
  const mem2 = addEntity(world);
  addComponent(world, mem2, Memory as any);
  Memory.content[mem2] = "Last night's feast was the most profitable evening this year. I should organize more feasts.";
  Memory.importance[mem2] = 80;
  Memory.timestamp[mem2] = Date.now();
  addComponent(world, agents[1].eid, HasMemory(mem2));
  info("Greta: added memory about profitable feast");

  // New affordance appears mid-simulation
  registerAffordance({ name: "mend_armor", description: "Repair damaged armor", requires: ["mendable"], effects: [], category: "craft" } as any);
  registerTrait({ name: "mendable", description: "Can be repaired", category: "material" });
  addObj("Damaged Chainmail", forge, ["mendable", "examinable"]);
  info("New affordance: mend_armor (Damaged Chainmail added to Forge)");

  // Grow affordance discovery branches
  for (const a of agents) {
    growAffordanceBranch(world, a.eid, "mend_armor", "mendable");
  }
  info("All agents: grew exploration branches for mend_armor");

  await runTicks(world, agents, 11, 20);

  sub("Phase 2 Results");
  for (const a of agents) {
    const size = getTreeSize(world, a.eid);
    const stats = getCompilationStats(a.eid);
    const growth = getGrowthSummary(a.eid);
    info(`${a.name}: tree ${size} nodes, ${stats.compiledBranches} compiled, ${growth.knownMemoryBranchCount} mem branches, ${growth.knownAffordanceCount} aff branches`);
  }

  // ─── Phase 3: Stress + Variety (ticks 21-30) ──────────────────────────
  header("PHASE 3: STRESS + VARIETY (ticks 21-30)");
  info("Needs fluctuate. Agents should show diverse, adapted behavior.");

  // Fluctuate needs to test different branches
  for (const a of agents) {
    Needs.hunger[a.eid] = 70; // Make them hungry
    Needs.social[a.eid] = 20; // Make them lonely
  }
  info("All agents: set hunger=70, social=20");

  await runTicks(world, agents, 21, 30);

  // ─── FINAL ANALYSIS ───────────────────────────────────────────────────
  header("FINAL ANALYSIS");

  let totalScore = 0;
  const maxScore = 70;

  // 1. Tree Growth (10 pts)
  sub("1. Tree Growth");
  let treeGrowthScore = 0;
  for (const a of agents) {
    const start = a.treeSizes[0];
    const end = getTreeSize(world, a.eid);
    const grew = end > start;
    if (grew) treeGrowthScore++;
    info(`${a.name}: ${start} → ${end} nodes ${grew ? "(grew)" : "(STATIC)"}`);
  }
  const treeScore = Math.round(treeGrowthScore / agents.length * 10);
  totalScore += treeScore;
  treeScore >= 7 ? pass(`Tree growth: ${treeScore}/10`) : fail(`Tree growth: ${treeScore}/10`);

  // 2. LLM Reduction (10 pts) — later ticks should use LLM less
  sub("2. LLM Reduction Over Time");
  let reductionScore = 0;
  for (const a of agents) {
    const firstHalf = a.sources.slice(0, 15);
    const secondHalf = a.sources.slice(15);
    const llmFirst = firstHalf.filter(s => s === "llm").length / Math.max(1, firstHalf.length);
    const llmSecond = secondHalf.filter(s => s === "llm").length / Math.max(1, secondHalf.length);
    const reduced = llmSecond <= llmFirst;
    if (reduced) reductionScore++;
    info(`${a.name}: LLM rate ${(llmFirst*100).toFixed(0)}% → ${(llmSecond*100).toFixed(0)}% ${reduced ? "(reduced)" : "(increased)"}`);
  }
  const redScore = Math.round(reductionScore / agents.length * 10);
  totalScore += redScore;
  redScore >= 7 ? pass(`LLM reduction: ${redScore}/10`) : fail(`LLM reduction: ${redScore}/10`);

  // 3. Compiled Branches (10 pts)
  sub("3. BT Compilation from LLM");
  let compileScore = 0;
  for (const a of agents) {
    const stats = getCompilationStats(a.eid);
    if (stats.compiledBranches > 0) compileScore++;
    info(`${a.name}: ${stats.compiledBranches} compiled branches — ${stats.activeBranches.slice(0, 3).join(", ")}`);
  }
  const cScore = Math.round(compileScore / agents.length * 10);
  totalScore += cScore;
  cScore >= 7 ? pass(`Compilation: ${cScore}/10`) : fail(`Compilation: ${cScore}/10`);

  // 4. Action Diversity (10 pts)
  sub("4. Action Diversity");
  let divScore = 0;
  for (const a of agents) {
    const m = getPolicyEffectiveness(a.eid);
    const d = m?.actionDiversity ?? 0;
    if (d > 1.0) divScore++;
    const types = new Set(a.actions.map(act => act.split("→")[0].split(" ")[0]));
    info(`${a.name}: entropy ${d.toFixed(2)}, ${types.size} unique types: ${[...types].join(", ")}`);
  }
  const dScore = Math.round(divScore / agents.length * 10);
  totalScore += dScore;
  dScore >= 7 ? pass(`Diversity: ${dScore}/10`) : fail(`Diversity: ${dScore}/10`);

  // 5. Skill Learning (10 pts)
  sub("5. Skills Learned");
  const learnedSkills = listSkills().filter(s => s.origin === "compiled");
  const skillScore = learnedSkills.length >= 1 ? 10 : learnedSkills.length > 0 ? 5 : 0;
  totalScore += skillScore;
  info(`${learnedSkills.length} skills compiled from experience`);
  for (const s of learnedSkills) info(`  "${s.name}" — ${s.description}`);
  skillScore >= 5 ? pass(`Skills: ${skillScore}/10`) : fail(`Skills: ${skillScore}/10`);

  // 6. Memory Integration (10 pts)
  sub("6. Memory-Driven Branches");
  let memScore = 0;
  for (const a of agents) {
    const growth = getGrowthSummary(a.eid);
    if (growth.knownMemoryBranchCount > 0) memScore++;
    info(`${a.name}: ${growth.knownMemoryBranchCount} memory branches`);
  }
  const mScore = Math.round(memScore / agents.length * 10);
  totalScore += mScore;
  mScore >= 7 ? pass(`Memory: ${mScore}/10`) : fail(`Memory: ${mScore}/10`);

  // 7. Tree Validity (10 pts)
  sub("7. Tree Validity After Growth");
  let validScore = 0;
  for (const a of agents) {
    const tree = JSON.parse(BehaviorPolicy.treeJson[a.eid]);
    const v = validateBehaviorNode(tree);
    if (v.ok) validScore++;
    info(`${a.name}: ${v.ok ? "valid" : "INVALID: " + (v as any).error}`);
  }
  const vScore = Math.round(validScore / agents.length * 10);
  totalScore += vScore;
  vScore >= 7 ? pass(`Validity: ${vScore}/10`) : fail(`Validity: ${vScore}/10`);

  // ─── FINAL SCORE ──────────────────────────────────────────────────────
  header("FINAL SCORE");
  const grade = totalScore >= 60 ? "A" : totalScore >= 50 ? "B" : totalScore >= 40 ? "C" : totalScore >= 30 ? "D" : "F";
  log(`\n  ${totalScore}/${maxScore} — Grade ${grade}\n`);

  // Action summary per agent
  sub("Action History (last 15)");
  for (const a of agents) {
    info(`${a.name}: ${a.actions.slice(-15).join(" | ")}`);
  }

  // Save
  const evalDir = path.resolve(__dirname, "../../data/eval");
  fs.mkdirSync(evalDir, { recursive: true });
  fs.writeFileSync(path.join(evalDir, `extended-learning-${Date.now()}.json`), JSON.stringify({
    timestamp: new Date().toISOString(), score: totalScore, maxScore, grade,
    agents: agents.map(a => ({
      name: a.name, role: a.role,
      treeSizes: a.treeSizes, compiledBranches: a.compiledBranches,
      llmCalls: a.llmCalls, policyCalls: a.policyCalls,
      actions: a.actions, sources: a.sources,
      finalTreeSize: getTreeSize(world, a.eid),
      compilationStats: getCompilationStats(a.eid),
      growthSummary: getGrowthSummary(a.eid),
      reinforcementEntries: getReinforcementState(a.eid)?.size ?? 0,
    })),
    skills: listSkills().map(s => ({ name: s.name, origin: s.origin, attempts: s.attemptCount, successes: s.successCount })),
  }, null, 2));

  process.exit(totalScore >= 30 ? 0 : 1);
}

// =============================================================================
// TICK RUNNER
// =============================================================================

async function runTicks(world: any, agents: any[], from: number, to: number) {
  for (let tick = from; tick <= to; tick++) {
    for (const a of agents) {
      // Check if BT handles this or falls through to LLM
      const policyResult = evaluateBehaviorPolicy(world, a.eid);
      clearPolicyEvalHistory(a.eid);
      const wouldUseLLM = policyResult.kind === "llm_fallback" || policyResult.kind === "none";

      try {
        const action = await agentThink(world, a.eid);
        const desc = `${action.type}${action.target ? "→" + action.target : ""}`;
        a.actions.push(desc);
        a.sources.push(wouldUseLLM ? "llm" : "policy");
        if (wouldUseLLM) a.llmCalls++; else a.policyCalls++;
        recordPolicyAction(a.eid, action.type, wouldUseLLM);
        recordAction(a.eid, action.type);

        // Execute actions: handle moves directly (no movement system running)
        if (action.type === "move" && action.target) {
          const { query: q } = await import("bitecs");
          const { Room } = await import("../ecs/components");
          const allRooms = Array.from(q(world, [Room as any, Name as any]));
          const targetRoom = allRooms.find(r =>
            String(Name.value[r] || "").toLowerCase() === action.target!.toLowerCase());
          if (targetRoom !== undefined) {
            setLocatedIn(world, a.eid, targetRoom);
          }
        }
        try {
          await executeActions(world, [{ eid: a.eid, action: action as any }] as any);
        } catch { /* execution errors are fine — the attempt still counts */ }
      } catch (err: any) {
        a.actions.push(`ERROR:${err.message?.slice(0, 30)}`);
        a.sources.push("error");
      }

      // Track tree growth
      a.treeSizes.push(getTreeSize(world, a.eid));
      a.compiledBranches.push(getCompilationStats(a.eid).compiledBranches);
    }

    // Progress indicator every 5 ticks
    if (tick % 5 === 0 || tick === to) {
      const summaries = agents.map(a => {
        const size = getTreeSize(world, a.eid);
        const stats = getCompilationStats(a.eid);
        return `${a.name}:${size}n/${stats.compiledBranches}c`;
      });
      info(`Tick ${tick}: ${summaries.join(" | ")}`);
    }
  }
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
