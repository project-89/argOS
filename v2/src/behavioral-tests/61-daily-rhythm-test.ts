/**
 * DAILY RHYTHM TEST — Phase 3.2 Behavioral Validation
 *
 * 80 ticks across a full day cycle (morning→midday→evening→night).
 * 3 agents with autonomous goals. Verifies:
 *   1. Agents shift behavior by time of day (work morning, socialize evening)
 *   2. World events override rhythm (festival → everyone socializes)
 *   3. Goals respond to time context
 *   4. Agents move between rooms based on time/events
 *
 * Run:
 *   cd v2 && npx tsx src/behavioral-tests/61-daily-rhythm-test.ts
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
import { addEntity, addComponent, query, hasComponent } from "bitecs";
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
import { resetSkillRegistry } from "../cognition/skill-registry";
import { setLocatedIn, getRoomForEntity } from "../ecs/location";
import { getAspirations } from "../cognition/goal-learning";
import { resetAutonomousGoals, advanceGoalTick, expireStaleGoals } from "../cognition/autonomous-goals";
import {
  createWorldClock,
  advanceWorldClock,
  getCurrentPeriod,
  getClockState,
  createWorldEvent,
  getActiveWorldEvents,
  expireWorldEvents,
  formatWorldTimeForContext,
} from "../systems/world-clock";
import { chronicle } from "../cognition/simulation-chronicle";

// =============================================================================
// CONFIG
// =============================================================================

const TICKS_PER_PERIOD = 20;
const TOTAL_TICKS = TICKS_PER_PERIOD * 4; // Full day: 80 ticks

function log(msg: string) { console.log(msg); }
function header(title: string) { log("\n" + "═".repeat(72)); log(`  ${title}`); log("═".repeat(72)); }
function sub(title: string) { log(`\n── ${title} ${"─".repeat(Math.max(0, 66 - title.length))}`); }
function info(msg: string) { log(`  ℹ  ${msg}`); }

// =============================================================================
// TRACKING
// =============================================================================

interface GoalByPeriod { period: string; agent: string; goal: string; kind: string; }
const goalsByPeriod: GoalByPeriod[] = [];
const actionsByPeriod: Map<string, Map<string, string[]>> = new Map(); // period → agent → actions

function trackAction(period: string, agent: string, actionType: string) {
  if (!actionsByPeriod.has(period)) actionsByPeriod.set(period, new Map());
  const periodMap = actionsByPeriod.get(period)!;
  if (!periodMap.has(agent)) periodMap.set(agent, []);
  periodMap.get(agent)!.push(actionType);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("No API key"); process.exit(1);
  }

  header(`DAILY RHYTHM TEST — ${TOTAL_TICKS} TICKS (${TICKS_PER_PERIOD}/period), 3 AGENTS`);
  chronicle.reset();
  resetCompilerState();
  resetLearningState();
  resetAllPolicyMetrics();
  clearActionHistory();
  resetSkillRegistry();
  resetAutonomousGoals();

  // ─── WORLD ─────────────────────────────────────────────────────────────
  sub("WORLD CREATION");

  const world = createArgosWorld("RhythmTest") as any;
  initializePrefabs(world);
  initializeAffordanceDiscovery(world);

  // Create world clock
  const clockEid = createWorldClock(world, { ticksPerPeriod: TICKS_PER_PERIOD });
  info(`World clock created: ${TICKS_PER_PERIOD} ticks/period, starting morning Day 1`);

  // Rooms
  const rooms: Record<string, number> = {};
  function makeRoom(name: string, desc: string): number {
    const eid = createRoomEntity(world, { name, description: desc });
    registerEntity(eid, name);
    rooms[name] = eid;
    return eid;
  }

  makeRoom("Forge", "A blacksmith's forge with a roaring fire and iron anvil.");
  makeRoom("Tavern", "A warm tavern with ale barrels, roast mutton, and a crackling hearth.");
  makeRoom("Market", "An open-air market with merchant stalls and goods.");
  makeRoom("Temple", "A quiet stone temple with candles and an altar.");

  // Traits + Affordances
  for (const t of ["forgeable", "edible", "drinkable", "sellable", "sacred", "examinable"])
    registerTrait({ name: t, description: `Object is ${t}`, category: "general", enablesAffordances: [], incompatibleWith: [] });

  registerAffordance({ name: "forge_weapon", description: "Forge a weapon", requires: ["forgeable"],
    effects: [{ type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "energy", operation: "subtract", value: 10 }] }] } as any);
  registerAffordance({ name: "eat", description: "Eat food", requires: ["edible"],
    effects: [{ type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "hunger", operation: "subtract", value: 25 }] }] } as any);
  registerAffordance({ name: "drink", description: "Drink", requires: ["drinkable"],
    effects: [{ type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "comfort", operation: "add", value: 15 }] }] } as any);
  registerAffordance({ name: "pray", description: "Pray at the altar", requires: ["sacred"],
    effects: [{ type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "comfort", operation: "add", value: 20 }] }] } as any);
  registerAffordance({ name: "haggle", description: "Negotiate a price", requires: ["sellable"],
    effects: [] } as any);

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
  addObj("Stone Altar", "Temple", ["sacred", "examinable"]);

  info("4 rooms, 5 objects, 5 affordances");

  // ─── AGENTS ────────────────────────────────────────────────────────────
  sub("AGENTS");

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
      systemPrompt: `You are ${name}, a ${role}. ${desc}. You live in a medieval village. Act in character. Pay attention to the time of day and any events happening.`,
      description: desc,
      roomId: rooms[room],
    });
    registerEntity(eid, name);
    setAgentBehaviorPolicy(world, eid, minimalTree, true);
    clearPolicyEvalHistory(eid);
    agents.push({ eid, name, role });
  }

  makeAgent("Aldric", "blacksmith", "A dedicated blacksmith who works at the forge", "Forge");
  makeAgent("Greta", "innkeeper", "A warm innkeeper who runs the tavern", "Tavern");
  makeAgent("Dex", "merchant", "A charming merchant who trades at the market", "Market");

  for (const a of agents) {
    const aspirations = getAspirations(a.eid);
    info(`${a.name} (${a.role}) — Aspirations: ${aspirations.join("; ")}`);
  }

  // ─── SIMULATION LOOP ──────────────────────────────────────────────────
  const startTime = Date.now();

  for (let tick = 1; tick <= TOTAL_TICKS; tick++) {
    chronicle.setTick(tick);
    advanceGoalTick();

    // Advance world clock
    const periodChanged = advanceWorldClock(world);
    const clock = getClockState(world);

    // Log period transitions
    if (periodChanged) {
      sub(`${periodChanged.toUpperCase()} — Day ${clock.day}`);
    }

    // Inject festival event at evening
    if (periodChanged === "evening") {
      createWorldEvent(world, {
        name: "Evening Gathering",
        eventType: "festival",
        description: "The villagers gather at the Tavern to share stories, drink ale, and celebrate the day's work.",
        priority: 70,
        duration: TICKS_PER_PERIOD, // Lasts the evening
        affectsGoals: { social: 3, craft: -2 },
        location: "Tavern",
      });
      info("Evening Gathering event started at Tavern");
    }

    // Expire events
    expireWorldEvents(world);

    // Run agents
    const results = await Promise.allSettled(
      agents.map(async (a) => {
        const action = await agentThink(world, a.eid);
        return { a, action };
      })
    );

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { a, action } = result.value;

      trackAction(clock.period, a.name, action.type);

      try {
        await executeActions(world, [{ eid: a.eid, action: action as any }] as any);
      } catch {}

      // Need decay
      Needs.hunger[a.eid] = Math.min(100, (Needs.hunger[a.eid] || 0) + 2);
      Needs.energy[a.eid] = Math.max(0, (Needs.energy[a.eid] || 100) - 1);
      Needs.social[a.eid] = Math.max(0, (Needs.social[a.eid] || 50) - 1);

      // Expire stale goals
      if (tick % 15 === 0) expireStaleGoals(world, a.eid, 25 * 1000);
    }

    // Track goals by period
    const recentEvents = chronicle.getEventsForTick(tick);
    for (const evt of recentEvents) {
      if (evt.type === "autonomous_goal") {
        goalsByPeriod.push({
          period: clock.period,
          agent: (evt.data as any).agent,
          goal: (evt.data as any).goal,
          kind: (evt.data as any).kind,
        });
      }
    }

    // Status every period transition
    if (tick % TICKS_PER_PERIOD === 0) {
      for (const a of agents) {
        const room = getRoomForEntity(world, a.eid);
        const roomName = room !== undefined ? String(Name.value[room] || "") : "?";
        const goals = getActiveGoals(world, a.eid);
        info(`${a.name} in ${roomName} — goals: ${goals.map(g => g.description).join(", ") || "none"}`);
      }
    }
  }

  // ─── ANALYSIS ──────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  header(`RESULTS — ${elapsed}s`);

  sub("GOALS BY TIME PERIOD");
  for (const period of ["morning", "midday", "evening", "night"]) {
    const periodGoals = goalsByPeriod.filter(g => g.period === period);
    if (periodGoals.length > 0) {
      log(`  ${period.toUpperCase()}:`);
      for (const g of periodGoals) log(`    ${g.agent}: "${g.goal}" (${g.kind})`);
    } else {
      log(`  ${period.toUpperCase()}: (no new goals)`);
    }
  }

  sub("ACTIONS BY TIME PERIOD");
  for (const period of ["morning", "midday", "evening", "night"]) {
    const periodMap = actionsByPeriod.get(period);
    if (!periodMap) { log(`  ${period.toUpperCase()}: (no data)`); continue; }
    log(`  ${period.toUpperCase()}:`);
    for (const a of agents) {
      const actions = periodMap.get(a.name) || [];
      const counts: Record<string, number> = {};
      for (const act of actions) counts[act] = (counts[act] || 0) + 1;
      const dist = Object.entries(counts).sort((a, b) => b[1] - a[1])
        .map(([t, c]) => `${t}:${c}`).join(" ");
      log(`    ${a.name}: ${dist || "(none)"}`);
    }
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

  // 1. Goals generated across periods (10 pts)
  const periodsWithGoals = new Set(goalsByPeriod.map(g => g.period));
  check("Goals in 3+ periods", periodsWithGoals.size >= 3, 5,
    `Goals in: ${[...periodsWithGoals].join(", ")}`);
  check("Total goals ≥ 6", goalsByPeriod.length >= 6, 5,
    `${goalsByPeriod.length} goals generated`);

  // 2. Time-appropriate goals (10 pts)
  const morningGoals = goalsByPeriod.filter(g => g.period === "morning");
  const eveningGoals = goalsByPeriod.filter(g => g.period === "evening");
  const morningWorkGoals = morningGoals.filter(g => g.kind === "craft" || g.kind === "improve" || g.kind === "acquire");
  const eveningSocialGoals = eveningGoals.filter(g => g.kind === "social");

  check("Morning favors work goals", morningWorkGoals.length > 0, 5,
    `${morningWorkGoals.length}/${morningGoals.length} morning goals are work-type`);
  check("Evening favors social goals", eveningSocialGoals.length > 0, 5,
    `${eveningSocialGoals.length}/${eveningGoals.length} evening goals are social-type`);

  // 3. Behavior shifts by period (10 pts)
  const morningActions = actionsByPeriod.get("morning");
  const eveningActions = actionsByPeriod.get("evening");

  const morningInteractRate = morningActions ?
    [...morningActions.values()].flat().filter(a => a === "interact").length /
    Math.max(1, [...morningActions.values()].flat().length) : 0;
  const eveningSpeakRate = eveningActions ?
    [...eveningActions.values()].flat().filter(a => a === "speak").length /
    Math.max(1, [...eveningActions.values()].flat().length) : 0;

  check("Morning has interactions", morningInteractRate > 0.1, 5,
    `${(morningInteractRate * 100).toFixed(0)}% interact in morning`);
  check("Evening has speech", eveningSpeakRate > 0.05, 5,
    `${(eveningSpeakRate * 100).toFixed(0)}% speak in evening`);

  // 4. Movement between rooms (10 pts)
  const moveEvents = chronicle.getByType("action_success")
    .filter((e: any) => e.data?.action?.startsWith("move→"));
  check("Agents moved rooms", moveEvents.length >= 2, 5,
    `${moveEvents.length} room transitions`);

  const uniqueMovers = new Set(moveEvents.map((e: any) => e.data?.agent));
  check("Multiple agents moved", uniqueMovers.size >= 2, 5,
    `${uniqueMovers.size} agents moved rooms`);

  // 5. BT growth (10 pts)
  const avgGrowth = agents.reduce((sum, a) => sum + getTreeSize(world, a.eid), 0) / agents.length;
  check("BT trees grew", avgGrowth > 5, 5, `avg ${avgGrowth.toFixed(0)} nodes`);
  const totalCompiled = agents.reduce((sum, a) => sum + getCompilationStats(a.eid).compiledBranches, 0);
  check("Branches compiled", totalCompiled >= 3, 5, `${totalCompiled} compiled`);

  // Report
  log("");
  for (const c of checks) {
    log(`  ${c.pass ? "✅" : "❌"} [${c.points}pts] ${c.name} — ${c.detail}`);
  }
  log("");
  log(`  SCORE: ${score}/${maxScore} (${((score/maxScore)*100).toFixed(0)}%)`);
  const grade = score >= 45 ? "A+" : score >= 40 ? "A" : score >= 35 ? "B+" : score >= 30 ? "B" : score >= 25 ? "C" : "F";
  log(`  GRADE: ${grade}`);
}

main().catch(err => { console.error(err); process.exit(1); });
