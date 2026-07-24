/**
 * AUTONOMOUS GOALS TEST — Phase 3.1 Behavioral Validation
 *
 * 100 ticks, 3 agents with minimal BTs. Tests that agents:
 *   1. Generate their own goals autonomously (via LLM)
 *   2. Goals drive meaningful actions (not just observe/wait)
 *   3. Goals complete → skills compile
 *   4. Each agent pursues 1+ self-generated goals over 50 ticks
 *
 * Run:
 *   cd v2 && npx tsx src/behavioral-tests/60-autonomous-goals-test.ts
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Agent, BehaviorPolicy, Name, Needs, Traits, Room, Goal } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { addEntity, addComponent, query, hasComponent, getRelationTargets } from "bitecs";
import { registerEntity, executeActions, getActiveGoals } from "../cognition/cognition-system";
import { agentThink } from "../cognition/agent-mind";
import { registerAffordance } from "../world/schema";
import { registerTrait } from "../world/trait-registry";
import {
  setAgentBehaviorPolicy,
  clearPolicyEvalHistory,
  type BehaviorNode,
} from "../cognition/behavior-policy";
import { getCompilationStats, resetCompilerState } from "../cognition/bt-compiler";
import { getTreeSize, resetLearningState, initializeAffordanceDiscovery } from "../cognition/policy-learning";
import { resetAllPolicyMetrics } from "../cognition/policy-metrics";
import { clearActionHistory } from "../cognition/agent-action-history";
import { listSkills, resetSkillRegistry } from "../cognition/skill-registry";
import { setLocatedIn, getRoomForEntity } from "../ecs/location";
import { addMemory } from "../cognition/knowledge-graph";
import { addPerception } from "../cognition/agent-mind";
import { getAspirations } from "../cognition/goal-learning";
import { resetAutonomousGoals, expireStaleGoals, advanceGoalTick } from "../cognition/autonomous-goals";
import { chronicle } from "../cognition/simulation-chronicle";

// =============================================================================
// CONFIG
// =============================================================================

const TOTAL_TICKS = 50;

function log(msg: string) { console.log(msg); }
function header(title: string) { log("\n" + "═".repeat(72)); log(`  ${title}`); log("═".repeat(72)); }
function sub(title: string) { log(`\n── ${title} ${"─".repeat(Math.max(0, 66 - title.length))}`); }
function info(msg: string) { log(`  ℹ  ${msg}`); }

// =============================================================================
// TRACKING
// =============================================================================

interface GoalEvent {
  agent: string;
  goal: string;
  kind: string;
  tick: number;
}

const goalsGenerated: GoalEvent[] = [];
const goalsCompleted: GoalEvent[] = [];
const agentActions: Map<string, string[]> = new Map();

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("No API key"); process.exit(1);
  }

  header(`AUTONOMOUS GOALS TEST — ${TOTAL_TICKS} TICKS, 3 AGENTS`);
  chronicle.reset();
  resetCompilerState();
  resetLearningState();
  resetAllPolicyMetrics();
  clearActionHistory();
  resetSkillRegistry();
  resetAutonomousGoals();

  // ─── WORLD ─────────────────────────────────────────────────────────────
  sub("WORLD CREATION");

  const world = createArgosWorld("GoalTest") as any;
  initializePrefabs(world);
  initializeAffordanceDiscovery(world);

  chronicle.record("world_seed", { seed: "medieval village — autonomous goals test" });

  // Rooms
  const rooms: Record<string, number> = {};
  function makeRoom(name: string, desc: string): number {
    const eid = createRoomEntity(world, { name, description: desc });
    registerEntity(eid, name);
    rooms[name] = eid;
    return eid;
  }

  makeRoom("Forge", "A blacksmith's forge with a roaring fire, iron anvil, and racks of unfinished weapons.");
  makeRoom("Tavern", "A warm tavern with wooden tables, ale barrels, and the smell of roasted meat.");
  makeRoom("Market", "A busy open-air market with merchant stalls and crates of goods.");
  makeRoom("Temple", "A quiet stone temple with candles, an altar, and shelves of dried herbs.");

  // Traits + Affordances
  for (const t of ["forgeable", "edible", "drinkable", "sellable", "sacred", "examinable"])
    registerTrait({ name: t, description: `Object is ${t}`, category: "general", enablesAffordances: [], incompatibleWith: [] });

  registerAffordance({
    name: "forge_weapon", description: "Forge a weapon at the anvil", requires: ["forgeable"],
    effects: [
      { type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "energy", operation: "subtract", value: 10 }] },
      { type: "emit_stimulus", target: "nearby", stimulusContent: "{actor} hammers metal at the anvil!", stimulusType: "observation" },
    ],
  } as any);
  registerAffordance({
    name: "eat", description: "Eat food to reduce hunger", requires: ["edible"],
    effects: [
      { type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "hunger", operation: "subtract", value: 25 }] },
    ],
  } as any);
  registerAffordance({
    name: "drink", description: "Drink to quench thirst", requires: ["drinkable"],
    effects: [
      { type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "comfort", operation: "add", value: 15 }] },
    ],
  } as any);
  registerAffordance({
    name: "pray", description: "Pray at the altar for guidance", requires: ["sacred"],
    effects: [
      { type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "comfort", operation: "add", value: 20 }] },
    ],
  } as any);
  registerAffordance({
    name: "haggle", description: "Negotiate a price at a market stall", requires: ["sellable"],
    effects: [
      { type: "emit_stimulus", target: "nearby", stimulusContent: "{actor} haggles at {target}.", stimulusType: "observation" },
    ],
  } as any);

  // Objects
  function addObj(name: string, room: string, objTraits: string[]) {
    const eid = addEntity(world);
    addComponent(world, eid, Name as any); Name.value[eid] = name;
    addComponent(world, eid, Traits as any); Traits.active[eid] = JSON.stringify(objTraits);
    setLocatedIn(world, eid, rooms[room]); registerEntity(eid, name);
  }

  addObj("Iron Anvil", "Forge", ["forgeable", "examinable"]);
  addObj("Ale Barrel", "Tavern", ["drinkable", "examinable"]);
  addObj("Roast Mutton", "Tavern", ["edible", "examinable"]);
  addObj("Merchant Stall", "Market", ["sellable", "examinable"]);
  addObj("Bread Loaf", "Market", ["edible", "sellable", "examinable"]);
  addObj("Stone Altar", "Temple", ["sacred", "examinable"]);

  info("4 rooms, 6 objects, 5 affordances");

  // ─── AGENTS ────────────────────────────────────────────────────────────
  sub("AGENTS");

  // Minimal BT: rest when exhausted, then LLM fallback
  // (no hardcoded behavior — autonomous goals should drive everything)
  const minimalTree: BehaviorNode = {
    type: "selector",
    children: [
      { type: "sequence", children: [
        { type: "condition", op: { type: "need_below", need: "energy", value: 15 } },
        { type: "skill", name: "rest" },
      ]},
      { type: "llm_fallback" },
    ],
  };

  interface AgentInfo { eid: number; name: string; role: string; }
  const agents: AgentInfo[] = [];

  function makeAgent(name: string, role: string, desc: string, room: string) {
    const eid = createAgentEntity(world, {
      name, role,
      systemPrompt: `You are ${name}, a ${role}. ${desc}. You live in a medieval village. Act in character. Pursue your dreams and interact with the world.`,
      description: desc,
      roomId: rooms[room],
    });
    registerEntity(eid, name);
    setAgentBehaviorPolicy(world, eid, minimalTree, true);
    clearPolicyEvalHistory(eid);
    agents.push({ eid, name, role });
    agentActions.set(name, []);

    // Log aspirations
    const aspirations = getAspirations(eid);
    info(`${name} (${role}) — Aspirations: ${aspirations.join("; ")}`);
  }

  makeAgent("Aldric", "blacksmith", "A gruff but skilled blacksmith dedicated to his craft", "Forge");
  makeAgent("Greta", "innkeeper", "A warm and shrewd innkeeper who knows everyone's business", "Tavern");
  makeAgent("Dex", "merchant", "A charming merchant always looking for a good deal", "Market");

  // ─── SIMULATION LOOP ──────────────────────────────────────────────────
  sub("SIMULATION");
  const startTime = Date.now();

  for (let tick = 1; tick <= TOTAL_TICKS; tick++) {
    chronicle.setTick(tick);
    advanceGoalTick(); // Keep autonomous goal cooldown in sync

    // Run all agents in parallel
    const results = await Promise.allSettled(
      agents.map(async (a) => {
        const action = await agentThink(world, a.eid);
        return { a, action };
      })
    );

    // Execute actions + track
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { a, action } = result.value;

      // Track action
      agentActions.get(a.name)?.push(action.type);

      // executeActions now handles move → setLocatedIn directly (no GoalPursuitSystem needed)
      try {
        await executeActions(world, [{ eid: a.eid, action: action as any }] as any);
      } catch {}

      // Need decay
      Needs.hunger[a.eid] = Math.min(100, (Needs.hunger[a.eid] || 0) + 2);
      Needs.energy[a.eid] = Math.max(0, (Needs.energy[a.eid] || 100) - 1);
      Needs.social[a.eid] = Math.max(0, (Needs.social[a.eid] || 50) - 1);

      // Expire stale goals every 15 ticks (20s expiry for test pace)
      if (tick % 15 === 0) {
        const expired = expireStaleGoals(world, a.eid, 20 * 1000);
        if (expired > 0) info(`${a.name}: ${expired} goal(s) expired — ready for new goals`);
      }
    }

    // Track autonomous goals from chronicle
    const recentEvents = chronicle.getEventsForTick(tick);
    for (const evt of recentEvents) {
      if (evt.type === "autonomous_goal") {
        goalsGenerated.push({
          agent: (evt.data as any).agent,
          goal: (evt.data as any).goal,
          kind: (evt.data as any).kind,
          tick,
        });
      }
      if (evt.type === "goal_skill_compiled") {
        goalsCompleted.push({
          agent: (evt.data as any).agent,
          goal: (evt.data as any).goal,
          kind: "compiled",
          tick,
        });
      }
    }

    // Periodic status
    if (tick % 20 === 0 || tick === TOTAL_TICKS) {
      const status = agents.map(a => {
        const active = getActiveGoals(world, a.eid);
        const goalStr = active.length > 0 ? active.map(g => g.description).join(", ") : "none";
        return `${a.name}: goals=[${goalStr}] tree=${getTreeSize(world, a.eid)}`;
      });
      info(`Tick ${tick}:`);
      for (const s of status) info(`  ${s}`);
    }
  }

  // ─── ANALYSIS ──────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  header(`RESULTS — ${elapsed}s`);

  sub("GOALS GENERATED");
  if (goalsGenerated.length === 0) {
    log("  ❌ NO GOALS GENERATED! The autonomous goal system didn't fire.");
  } else {
    for (const g of goalsGenerated) {
      log(`  tick ${g.tick}: ${g.agent} → "${g.goal}" (${g.kind})`);
    }
  }

  sub("GOALS COMPLETED (→ skill)");
  if (goalsCompleted.length > 0) {
    for (const g of goalsCompleted) {
      log(`  tick ${g.tick}: ${g.agent} → "${g.goal}"`);
    }
  } else {
    log("  (none compiled into skills yet — may need longer run)");
  }

  sub("AGENT ACTION DISTRIBUTIONS");
  for (const a of agents) {
    const actions = agentActions.get(a.name) || [];
    const counts: Record<string, number> = {};
    for (const act of actions) counts[act] = (counts[act] || 0) + 1;
    const total = actions.length;
    const dist = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${type}:${count}(${((count/total)*100).toFixed(0)}%)`)
      .join(" ");
    log(`  ${a.name}: ${dist}`);
  }

  sub("AGENT ASPIRATIONS vs GOALS");
  for (const a of agents) {
    const aspirations = getAspirations(a.eid);
    const agentGoals = goalsGenerated.filter(g => g.agent === a.name);
    log(`  ${a.name}:`);
    log(`    Aspirations: ${aspirations.join("; ")}`);
    log(`    Goals set: ${agentGoals.length} — ${agentGoals.map(g => g.goal).join("; ") || "none"}`);
  }

  sub("BT GROWTH");
  for (const a of agents) {
    const size = getTreeSize(world, a.eid);
    const stats = getCompilationStats(a.eid);
    log(`  ${a.name}: ${size} nodes, ${stats.compiledBranches} compiled branches`);
  }

  sub("SKILLS LEARNED");
  const skills = listSkills().filter(s => s.origin !== "builtin");
  if (skills.length > 0) {
    for (const s of skills) log(`  ${s.name} (${s.origin}): ${s.description}`);
  } else {
    log("  (no non-builtin skills compiled — goals may not have completed yet)");
  }

  // ─── SCORING ──────────────────────────────────────────────────────────
  header("SCORECARD");

  let score = 0;
  const maxScore = 50;
  const checks: Array<{ name: string; pass: boolean; points: number; detail: string }> = [];

  function check(name: string, pass: boolean, points: number, detail: string) {
    checks.push({ name, pass, points, detail });
    if (pass) score += points;
  }

  // 1. Goals were generated (15 points)
  const totalGoals = goalsGenerated.length;
  check("Goals generated", totalGoals >= 3, 10, `${totalGoals} goals generated (need ≥3)`);
  check("Multiple agents set goals", new Set(goalsGenerated.map(g => g.agent)).size >= 2, 5,
    `${new Set(goalsGenerated.map(g => g.agent)).size} agents set goals (need ≥2)`);

  // 2. Goal variety (10 points)
  const goalKinds = new Set(goalsGenerated.map(g => g.kind));
  check("Goal kind variety", goalKinds.size >= 2, 5, `${goalKinds.size} kinds: ${[...goalKinds].join(", ")}`);
  const uniqueGoals = new Set(goalsGenerated.map(g => g.goal));
  check("Unique goals", uniqueGoals.size >= 3, 5, `${uniqueGoals.size} unique goals`);

  // 3. Goals drive actions (10 points)
  const nonPassiveRate = agents.reduce((sum, a) => {
    const actions = agentActions.get(a.name) || [];
    const active = actions.filter(t => t !== "wait" && t !== "observe").length;
    return sum + (actions.length > 0 ? active / actions.length : 0);
  }, 0) / agents.length;
  check("Active action rate >30%", nonPassiveRate > 0.3, 5, `${(nonPassiveRate * 100).toFixed(0)}% active`);

  const moveCount = agents.reduce((sum, a) => {
    return sum + (agentActions.get(a.name) || []).filter(t => t === "move").length;
  }, 0);
  check("Agents moved rooms", moveCount >= 3, 5, `${moveCount} moves (need ≥3)`);

  // 4. BT growth (10 points)
  const avgGrowth = agents.reduce((sum, a) => sum + getTreeSize(world, a.eid), 0) / agents.length;
  check("BT trees grew", avgGrowth > 5, 5, `avg ${avgGrowth.toFixed(0)} nodes`);
  const compiledBranches = agents.reduce((sum, a) => sum + getCompilationStats(a.eid).compiledBranches, 0);
  check("BT branches compiled", compiledBranches >= 2, 5, `${compiledBranches} compiled branches`);

  // 5. Aspirations assigned (5 points)
  const aspirationsAssigned = agents.every(a => getAspirations(a.eid).length > 0);
  check("All agents have aspirations", aspirationsAssigned, 5,
    agents.map(a => `${a.name}:${getAspirations(a.eid).length}`).join(", "));

  // Report
  log("");
  for (const c of checks) {
    log(`  ${c.pass ? "✅" : "❌"} [${c.points}pts] ${c.name} — ${c.detail}`);
  }
  log("");
  log(`  SCORE: ${score}/${maxScore} (${((score/maxScore)*100).toFixed(0)}%)`);
  const grade = score >= 45 ? "A+" : score >= 40 ? "A" : score >= 35 ? "B+" : score >= 30 ? "B" : score >= 25 ? "C" : "F";
  log(`  GRADE: ${grade}`);

  // Save chronicle
  const chronicleDir = path.resolve(__dirname, "../../data/chronicles");
  fs.mkdirSync(chronicleDir, { recursive: true });
  const runId = `goals-${Date.now()}`;
  chronicle.saveReport(`${chronicleDir}/${runId}.json`);
  info(`Chronicle saved: ${chronicleDir}/${runId}.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
