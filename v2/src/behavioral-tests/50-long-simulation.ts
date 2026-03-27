/**
 * LONG SIMULATION RUN — Full Pipeline Stress Test
 *
 * 200 ticks, 5 agents, 4 phases of escalating complexity.
 * Everything real — Gemini API, ECS mutations, spirit-style evolution.
 * Chronicle captures all meaningful events for analysis.
 *
 * Phase 1 (ticks 1-50):   ESTABLISH — Learn basic routines
 * Phase 2 (ticks 51-100):  CRISIS — Famine + plague
 * Phase 3 (ticks 101-150): EVOLVE — New affordances appear, agents adapt
 * Phase 4 (ticks 151-200): THRIVE — Recovery, building, social bonds
 *
 * Run:
 *   cd v2 && npx tsx src/behavioral-tests/50-long-simulation.ts
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Agent, BehaviorPolicy, Name, Needs, Traits, Memory, Room, Description } from "../ecs/components";
import { HasMemory } from "../ecs/relations";
import { addEntity, addComponent, query, hasComponent } from "bitecs";
import { registerEntity, executeActions } from "../cognition/cognition-system";
import { agentThink } from "../cognition/agent-mind";
import { registerAffordance } from "../world/schema";
import { registerTrait } from "../world/trait-registry";
import { registryCreateComponent, attachToEntity, getComponent } from "../ecs/component-registry";
import {
  setAgentBehaviorPolicy,
  evaluateBehaviorPolicy,
  clearPolicyEvalHistory,
  type BehaviorNode,
} from "../cognition/behavior-policy";
import { getCompilationStats, resetCompilerState } from "../cognition/bt-compiler";
import { getTreeSize, getGrowthSummary, resetLearningState, initializeAffordanceDiscovery } from "../cognition/policy-learning";
import { resetAllPolicyMetrics } from "../cognition/policy-metrics";
import { clearActionHistory } from "../cognition/agent-action-history";
import { listSkills, resetSkillRegistry } from "../cognition/skill-registry";
import { setLocatedIn, getRoomForEntity } from "../ecs/location";
import { addMemory } from "../cognition/knowledge-graph";
import { addPerception } from "../cognition/agent-mind";
import { chronicle, type ChronicleSnapshot } from "../cognition/simulation-chronicle";

// =============================================================================
// CONFIG
// =============================================================================

const TOTAL_TICKS = 200;
const SNAPSHOT_INTERVAL = 10;
const CHRONICLE_DIR = path.resolve(__dirname, "../../data/chronicles");

function log(msg: string) { console.log(msg); }
function header(title: string) { log("\n" + "═".repeat(72)); log(`  ${title}`); log("═".repeat(72)); }
function sub(title: string) { log(`\n── ${title} ${"─".repeat(Math.max(0, 66 - title.length))}`); }
function info(msg: string) { log(`  ℹ  ${msg}`); }

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("No API key"); process.exit(1);
  }

  header(`LONG SIMULATION — ${TOTAL_TICKS} TICKS, 5 AGENTS`);
  chronicle.reset();

  resetCompilerState();
  resetLearningState();
  resetAllPolicyMetrics();
  clearActionHistory();
  resetSkillRegistry();

  // ─── WORLD ─────────────────────────────────────────────────────────────
  sub("WORLD CREATION");

  const world = createArgosWorld("LongSimulation") as any;
  initializePrefabs(world);
  initializeAffordanceDiscovery(world);

  chronicle.record("world_seed", { seed: "medieval village with forge, tavern, temple, market, farm" });

  // Rooms
  const rooms: Record<string, number> = {};
  function makeRoom(name: string, desc: string): number {
    const eid = createRoomEntity(world, { name, description: desc });
    registerEntity(eid, name);
    rooms[name] = eid;
    chronicle.record("room_created", { name, description: desc });
    return eid;
  }

  makeRoom("Forge", "A blacksmith's forge with a roaring fire, iron anvil, and racks of unfinished weapons.");
  makeRoom("Tavern", "A warm tavern with wooden tables, a crackling hearth, ale barrels, and the smell of roasted meat.");
  makeRoom("Temple", "A quiet stone temple with candles, an altar, shelves of dried herbs, and ancient scrolls.");
  makeRoom("Market", "A busy open-air market with merchant stalls, crates of goods, and the hum of commerce.");
  makeRoom("Farm", "Tilled fields with crops, a well, a barn, and a few chickens pecking at the ground.");

  // Traits
  const traits = ["forgeable", "edible", "drinkable", "serveable", "sacred", "sellable", "farmable", "examinable", "readable"];
  for (const t of traits) registerTrait({ name: t, description: `Object is ${t}`, category: "general", enablesAffordances: [], incompatibleWith: [] });

  // Affordances WITH EFFECTS
  registerAffordance({
    name: "forge_weapon", description: "Forge a weapon at the anvil", requires: ["forgeable"],
    effects: [
      { type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "energy", operation: "subtract", value: 10 }] },
      { type: "emit_stimulus", target: "nearby", stimulusContent: "{actor} hammers metal at the anvil, sparks flying!", stimulusType: "observation" },
    ],
  } as any);
  registerAffordance({
    name: "eat", description: "Eat food to reduce hunger", requires: ["edible"],
    effects: [
      { type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "hunger", operation: "subtract", value: 25 }] },
      { type: "emit_stimulus", target: "nearby", stimulusContent: "{actor} eats {target}.", stimulusType: "observation" },
    ],
  } as any);
  registerAffordance({
    name: "drink", description: "Drink to quench thirst", requires: ["drinkable"],
    effects: [
      { type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "comfort", operation: "add", value: 15 }] },
      { type: "emit_stimulus", target: "nearby", stimulusContent: "{actor} drinks from {target}.", stimulusType: "observation" },
    ],
  } as any);
  registerAffordance({
    name: "pray", description: "Pray at the altar for guidance", requires: ["sacred"],
    effects: [
      { type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "comfort", operation: "add", value: 20 }] },
      { type: "emit_stimulus", target: "nearby", stimulusContent: "{actor} kneels and prays at {target}.", stimulusType: "observation" },
    ],
  } as any);
  registerAffordance({
    name: "haggle", description: "Negotiate a price at a market stall", requires: ["sellable"],
    effects: [
      { type: "emit_stimulus", target: "nearby", stimulusContent: "{actor} haggles with the merchant at {target}.", stimulusType: "observation" },
    ],
  } as any);
  registerAffordance({
    name: "harvest", description: "Harvest crops from the field", requires: ["farmable"],
    effects: [
      { type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "energy", operation: "subtract", value: 8 }] },
      { type: "emit_stimulus", target: "nearby", stimulusContent: "{actor} harvests crops from {target}.", stimulusType: "observation" },
    ],
  } as any);
  registerAffordance({
    name: "serve_drink", description: "Serve a drink to a patron", requires: ["serveable"],
    effects: [
      { type: "emit_stimulus", target: "nearby", stimulusContent: "{actor} serves a drink from {target}.", stimulusType: "observation" },
    ],
  } as any);

  for (const a of ["forge_weapon", "eat", "drink", "pray", "haggle", "harvest", "serve_drink"]) {
    chronicle.record("affordance_created", { name: a, effectCount: 1 });
  }

  // Objects
  function addObj(name: string, room: string, objTraits: string[]) {
    const eid = addEntity(world);
    addComponent(world, eid, Name as any); Name.value[eid] = name;
    addComponent(world, eid, Traits as any); Traits.active[eid] = JSON.stringify(objTraits);
    setLocatedIn(world, eid, rooms[room]); registerEntity(eid, name);
    chronicle.record("object_created", { name, room, traits: objTraits });
    return eid;
  }

  addObj("Iron Anvil", "Forge", ["forgeable", "examinable"]);
  addObj("Bellows", "Forge", ["examinable"]);
  addObj("Ale Barrel", "Tavern", ["serveable", "drinkable", "examinable"]);
  addObj("Roast Mutton", "Tavern", ["edible", "examinable"]);
  addObj("Stone Altar", "Temple", ["sacred", "examinable"]);
  addObj("Herb Shelf", "Temple", ["examinable", "readable"]);
  addObj("Merchant Stall", "Market", ["sellable", "examinable"]);
  addObj("Bread Loaf", "Market", ["edible", "sellable", "examinable"]);
  addObj("Wheat Field", "Farm", ["farmable", "examinable"]);
  addObj("Well", "Farm", ["drinkable", "examinable"]);

  info(`5 rooms, 10 objects, 7 affordances with effects`);

  // ─── AGENTS (minimal trees — learn everything) ─────────────────────────
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

  interface AgentInfo { eid: number; name: string; role: string; room: string; }
  const agents: AgentInfo[] = [];

  function makeAgent(name: string, role: string, personality: string, room: string) {
    const eid = createAgentEntity(world, {
      name, role,
      systemPrompt: `You are ${name}, a ${role}. ${personality}\n\nYou live in a medieval village. Act in character. Interact with objects around you. Use available affordances. If hungry, find food. If tired, rest. If lonely, talk to people.`,
      roomId: rooms[room],
    });
    registerEntity(eid, name);
    setAgentBehaviorPolicy(world, eid, minimalTree, true);
    clearPolicyEvalHistory(eid);
    agents.push({ eid, name, role, room });
    chronicle.record("agent_created", { name, role, room });
    info(`${name} (${role}) in ${room}`);
  }

  makeAgent("Aldric", "blacksmith", "Gruff, prideful, dedicated to craft. Judges people by their work ethic. Makes the finest swords.", "Forge");
  makeAgent("Greta", "innkeeper", "Warm, shrewd, gossip-loving. Knows everyone's secrets. Serves the best ale.", "Tavern");
  makeAgent("Brother Caius", "monk healer", "Contemplative, compassionate, wise. Heals the sick, counsels the troubled, grows herbs.", "Temple");
  makeAgent("Mira", "farmer", "Practical, kind, hardworking. Feeds the village. Worried about the harvest.", "Farm");
  makeAgent("Dex", "merchant thief", "Quick-witted, charming. Trades by day, steals by night. Loyal to friends.", "Market");

  // ─── SIMULATION LOOP ──────────────────────────────────────────────────
  const startTime = Date.now();

  // Phase 1: ESTABLISH
  header("PHASE 1: ESTABLISH (ticks 1-50)");
  chronicle.record("phase_change", { phase: 1, name: "ESTABLISH" });
  await runPhase(world, agents, 1, 50);

  // Phase 2: CRISIS
  header("PHASE 2: CRISIS (ticks 51-100)");
  chronicle.record("phase_change", { phase: 2, name: "CRISIS" });
  injectFamine(world, agents);
  await runPhase(world, agents, 51, 100);

  // Phase 3: EVOLVE
  header("PHASE 3: EVOLVE (ticks 101-150)");
  chronicle.record("phase_change", { phase: 3, name: "EVOLVE" });
  injectEvolution(world, agents);
  await runPhase(world, agents, 101, 150);

  // Phase 4: THRIVE
  header("PHASE 4: THRIVE (ticks 151-200)");
  chronicle.record("phase_change", { phase: 4, name: "THRIVE" });
  injectRecovery(world, agents);
  await runPhase(world, agents, 151, 200);

  // ─── SAVE ──────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  header(`COMPLETE — ${elapsed} minutes`);

  const runId = `run-${Date.now()}`;
  fs.mkdirSync(CHRONICLE_DIR, { recursive: true });
  chronicle.saveReport(`${CHRONICLE_DIR}/${runId}.json`);
  chronicle.save(`${CHRONICLE_DIR}/${runId}-full.json`);

  info(`Chronicle saved: ${CHRONICLE_DIR}/${runId}.json`);
  info(`Full data saved: ${CHRONICLE_DIR}/${runId}-full.json`);
  info(`Report saved: ${CHRONICLE_DIR}/${runId}.md`);

  // Print the markdown report
  const report = fs.readFileSync(`${CHRONICLE_DIR}/${runId}.md`, "utf8");
  log("\n" + report);
}

// =============================================================================
// PHASE RUNNER
// =============================================================================

async function runPhase(world: any, agents: AgentInfo[], from: number, to: number) {
  for (let tick = from; tick <= to; tick++) {
    chronicle.setTick(tick);

    // All agents think in PARALLEL — BT-handled agents are instant,
    // LLM-requiring agents run concurrently. This is the dual-loop:
    // fast ECS tick + parallel async LLM.
    const results = await Promise.allSettled(
      agents.map(async (a) => {
        const action = await agentThink(world, a.eid);
        return { a, action };
      })
    );

    // Execute all actions (sequential — ECS mutations aren't thread-safe)
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { a, action } = result.value;

      try {
        // Handle movement
        if (action.type === "move" && action.target) {
          const allRooms = Array.from(query(world, [Room as any, Name as any]));
          const targetRoom = allRooms.find(r =>
            String(Name.value[r] || "").toLowerCase() === action.target!.toLowerCase());
          if (targetRoom !== undefined) setLocatedIn(world, a.eid, targetRoom);
        }

        // Execute for affordance resolution + BT compilation
        try {
          await executeActions(world, [{ eid: a.eid, action: action as any }] as any);
        } catch {}
      } catch {}

      // Simulate need decay
      Needs.hunger[a.eid] = Math.min(100, (Needs.hunger[a.eid] || 0) + 2);
      Needs.energy[a.eid] = Math.max(0, (Needs.energy[a.eid] || 100) - 1);
      Needs.social[a.eid] = Math.max(0, (Needs.social[a.eid] || 50) - 1);
    }

    // Snapshot
    if (tick % SNAPSHOT_INTERVAL === 0 || tick === to) {
      const snap = takeSnapshot(world, agents, tick);
      chronicle.addSnapshot(snap);
      const summaries = agents.map(a =>
        `${a.name}:${getTreeSize(world, a.eid)}n/${getCompilationStats(a.eid).compiledBranches}c`);
      info(`Tick ${tick}: ${summaries.join(" | ")}`);
    }
  }
}

// =============================================================================
// CRISIS INJECTION
// =============================================================================

function injectFamine(world: any, agents: AgentInfo[]) {
  sub("INJECTING FAMINE");

  registryCreateComponent({
    name: "Famine",
    description: "The village is in famine",
    properties: { severity: { type: "number", default: 0 } },
  });
  chronicle.record("component_created", { name: "Famine" });

  for (const a of agents) {
    attachToEntity(world, a.eid, "Famine", { severity: 80 });
    Needs.hunger[a.eid] = 90;
    addPerception(world, a.eid, {
      type: "event",
      content: "URGENT: The crops have failed! A terrible famine grips the village. Food stores are nearly empty. People are starving. The Forest outside the village may have wild food — berries, mushrooms, and herbs that can be foraged.",
      source: "village_crisis",
      intensity: 1,
    });
    addMemory(world, a.eid, {
      type: "episodic", content: "The famine has begun. The crops failed and everyone is starving.",
      importance: 95, emotionalValence: -0.9, timestamp: Date.now(),
    });
  }

  // Add forest
  const forest = createRoomEntity(world, { name: "Forest", description: "A dense forest outside the village with wild berries, mushrooms, and medicinal herbs." });
  registerEntity(forest, "Forest");
  chronicle.record("room_created", { name: "Forest", description: "Wild food source during famine" });

  registerAffordance({
    name: "forage", description: "Forage for wild food", requires: ["forageable"],
    effects: [
      { type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "hunger", operation: "subtract", value: 20 }] },
      { type: "emit_stimulus", target: "nearby", stimulusContent: "{actor} forages for wild food at {target}.", stimulusType: "observation" },
    ],
  } as any);
  registerTrait({ name: "forageable", description: "Can be foraged for food", category: "natural", enablesAffordances: [], incompatibleWith: [] });
  chronicle.record("affordance_evolved", { name: "forage", description: "Forage for wild food" });

  const berries = addEntity(world);
  addComponent(world, berries, Name as any); Name.value[berries] = "Wild Berries";
  addComponent(world, berries, Traits as any); Traits.active[berries] = JSON.stringify(["forageable", "edible", "examinable"]);
  setLocatedIn(world, berries, forest); registerEntity(berries, "Wild Berries");

  const herbs = addEntity(world);
  addComponent(world, herbs, Name as any); Name.value[herbs] = "Medicinal Herbs";
  addComponent(world, herbs, Traits as any); Traits.active[herbs] = JSON.stringify(["forageable", "examinable"]);
  setLocatedIn(world, herbs, forest); registerEntity(herbs, "Medicinal Herbs");

  chronicle.record("crisis_event", { description: "Famine strikes the village. Forest added with forageable food." });
  info("Famine injected: all agents hungry=90, Forest created with forageable items");
}

function injectEvolution(world: any, agents: AgentInfo[]) {
  sub("INJECTING EVOLUTION");

  // New affordances the spirits "would have created"
  registerAffordance({
    name: "brew_remedy", description: "Brew a healing remedy from herbs", requires: ["brewable"],
    effects: [
      { type: "spawn", spawnName: "Herbal Remedy", containerName: "room" },
      { type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "energy", operation: "subtract", value: 5 }] },
      { type: "emit_stimulus", target: "nearby", stimulusContent: "{actor} brews a remedy from herbs!", stimulusType: "observation" },
    ],
  } as any);
  registerTrait({ name: "brewable", description: "Can be brewed into remedies", category: "craft", enablesAffordances: [], incompatibleWith: [] });
  chronicle.record("affordance_evolved", { name: "brew_remedy", description: "Brew healing remedy (spirit-created)" });

  // Add brewing station to temple
  const cauldron = addEntity(world);
  addComponent(world, cauldron, Name as any); Name.value[cauldron] = "Herb Cauldron";
  addComponent(world, cauldron, Traits as any); Traits.active[cauldron] = JSON.stringify(["brewable", "examinable"]);
  const temple = Array.from(query(world, [Room as any, Name as any])).find(r => String(Name.value[r] || "").includes("Temple"));
  if (temple) setLocatedIn(world, cauldron, temple);
  registerEntity(cauldron, "Herb Cauldron");

  registerAffordance({
    name: "build_shelter", description: "Build a simple shelter for protection", requires: ["buildable"],
    effects: [
      { type: "spawn", spawnName: "Simple Shelter", containerName: "room" },
      { type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "energy", operation: "subtract", value: 20 }] },
      { type: "remove_trait", target: "target", trait: "buildable" },
      { type: "emit_stimulus", target: "nearby", stimulusContent: "{actor} builds a shelter!", stimulusType: "observation" },
    ],
  } as any);
  registerTrait({ name: "buildable", description: "Land where a shelter can be built", category: "construction", enablesAffordances: [], incompatibleWith: [] });
  chronicle.record("affordance_evolved", { name: "build_shelter", description: "Build shelter (spirit-created)" });

  // Add buildable land
  const forest = Array.from(query(world, [Room as any, Name as any])).find(r => String(Name.value[r] || "").includes("Forest"));
  if (forest) {
    const clearing = addEntity(world);
    addComponent(world, clearing, Name as any); Name.value[clearing] = "Forest Clearing";
    addComponent(world, clearing, Traits as any); Traits.active[clearing] = JSON.stringify(["buildable", "examinable"]);
    setLocatedIn(world, clearing, forest);
    registerEntity(clearing, "Forest Clearing");
  }

  for (const a of agents) {
    addPerception(world, a.eid, {
      type: "event",
      content: "Brother Caius has set up an Herb Cauldron in the Temple for brewing remedies. There's also a clearing in the Forest where shelters can be built.",
      source: "village_news", intensity: 0.8,
    });
  }

  chronicle.record("crisis_event", { description: "Evolution: brew_remedy and build_shelter affordances added" });
  info("Evolution: brew_remedy + build_shelter affordances, Herb Cauldron + Forest Clearing added");
}

function injectRecovery(world: any, agents: AgentInfo[]) {
  sub("INJECTING RECOVERY");

  const famineComp = getComponent("Famine");
  for (const a of agents) {
    if (famineComp) famineComp.severity[a.eid] = 0;
    Needs.hunger[a.eid] = 20;
    Needs.social[a.eid] = 10; // Very lonely from crisis isolation
    Needs.comfort[a.eid] = 30;

    addPerception(world, a.eid, {
      type: "event",
      content: "The famine is over! Food is returning. The village elder has declared a festival. Visit the Tavern to celebrate with your neighbors. Share stories of how you survived.",
      source: "village_celebration", intensity: 1,
    });
    addMemory(world, a.eid, {
      type: "episodic", content: "We survived the famine! The village is celebrating. I feel grateful to be alive and want to reconnect with my neighbors.",
      importance: 90, emotionalValence: 0.9, timestamp: Date.now(),
    });
  }

  registryCreateComponent({
    name: "Festival",
    description: "A celebration is happening",
    properties: { joy: { type: "number", default: 0 } },
  });
  for (const a of agents) {
    attachToEntity(world, a.eid, "Festival", { joy: 80 });
  }
  chronicle.record("component_created", { name: "Festival" });
  chronicle.record("crisis_event", { description: "Recovery: Famine ended, Festival declared, social needs high" });
  info("Recovery: famine=0, hunger=20, social=10 (lonely), Festival component attached");
}

// =============================================================================
// SNAPSHOT
// =============================================================================

function takeSnapshot(world: any, agents: AgentInfo[], tick: number): ChronicleSnapshot {
  const allRooms = Array.from(query(world, [Room as any]));
  const allEntities = Array.from(query(world, [Name as any]));
  const skills = listSkills();

  return {
    tick,
    timestamp: Date.now(),
    agents: agents.map(a => {
      const roomEid = getRoomForEntity(world, a.eid);
      const currentRoom = roomEid !== undefined ? String(Name.value[roomEid] || "") : "unknown";
      const stats = getCompilationStats(a.eid);
      const growth = getGrowthSummary(a.eid);
      return {
        name: a.name,
        role: a.role,
        room: currentRoom,
        treeSize: getTreeSize(world, a.eid),
        compiledBranches: stats.compiledBranches,
        llmCallsTotal: chronicle.getLLMCalls(a.name),
        policyCallsTotal: chronicle.getPolicyCalls(a.name),
        skillCount: growth.knownAffordanceCount,
        memoryBranchCount: growth.knownMemoryBranchCount,
      };
    }),
    worldStats: {
      rooms: allRooms.length,
      entities: allEntities.length,
      affordances: 7 + chronicle.getByType("affordance_evolved").length,
      components: 2 + chronicle.getByType("component_created").length, // Agent + Room + dynamic
      systems: 0,
      skills: skills.filter(s => s.origin === "compiled").length,
    },
  };
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
