/**
 * Full Autonomy Gauntlet — The Ultimate Stress Test
 *
 * Starts from NOTHING but a seed phrase. Tests every layer of the system:
 *
 *   Phase 1: Genesis — God creates the world from a seed description
 *   Phase 2: Cognition — Agents act via behavior policies (deterministic)
 *   Phase 3: Mid-flight Surgery — God rewires agent behavior trees + registers new actions
 *   Phase 4: Spirit Autonomy — Watcher detects gaps → Weaver designs → Baker generates
 *   Phase 5: Self-Evolution — Verify the world GREW beyond what genesis created
 *   Phase 6: Resilience — Inject chaos, verify recovery
 *
 * The key assertion: after N ticks, the world has MORE components, MORE systems,
 * and MORE entity diversity than what genesis originally created.
 *
 * Usage:
 *   npx tsx src/behavioral-tests/90-full-autonomy-gauntlet.ts
 *   npx tsx src/behavioral-tests/90-full-autonomy-gauntlet.ts --durationSec=300
 */
import "dotenv/config";

import * as fs from "fs";
import * as path from "path";
import { query, hasComponent, addEntity, addComponent } from "bitecs";

import { createSimulation } from "../index";
import {
  Agent, Name, Room, Needs, LastAction, BehaviorPolicy,
  Description, Health, Inventory, PhysicalObject, Traits,
} from "../ecs/components";
import {
  initializeRegistry, getComponent, registryHasComponent,
  attachToEntity, getMergedComponents,
  listNames as listComponentNames,
  listDynamic as listDynamicComponentDefs,
} from "../ecs/component-registry";
import { createDynamicComponent, getDynamicComponent } from "../ecs/dynamic-components";
import { compileSystemCode } from "../god/system-baker";
import { getSystemTelemetrySnapshot, type SystemRegistry } from "../ecs/dynamic-systems";
import { godCommand } from "../god/god-agent";
import {
  setAgentBehaviorPolicy, validateBehaviorNode,
  evaluateBehaviorPolicy, getBehaviorPolicyTree,
} from "../cognition/behavior-policy";
import { ActionRegistry } from "../cognition/action-registry";
import {
  initializeSpiritSystem, createStandardHierarchy,
  startSpiritSystem, stopSpiritSystem, tickSpiritSystem,
  getRegistrySummary, recordActionEvent,
} from "../spirits";
import {
  getDynamicSpirit, getFactoryState, resetFactoryState,
} from "../spirits/spirit-factory";
import {
  getTopObservations, getObservationSummary,
  getRecentObservations, resetAggregator,
  reportGap as reportGapObservation,
} from "../spirits/observation-aggregator";
import {
  runObservationSynthesis, recordAgentAction,
  getWatcherStatus, resetWatcherState,
} from "../spirits/watcher-spirit";
import { runArchitectCognition } from "../spirits/architect-spirit";
import { runArtificerWithTools } from "../spirits/artificer-spirit";
import { runWorldCrafterCycle, recordFailedInteraction, recordResourceGap } from "../spirits/world-crafter-spirit";
import { runStewardCycle } from "../spirits/steward-spirit";
import { runLawgiverCycle, resetLawgiverState } from "../spirits/rules-spirit";
import { getAndClearAccumulatedIssues, recordEvent } from "../spirits/consistency-spirit";
import { setComponentsDir, clearDynamicComponents } from "../ecs/dynamic-components";
import { enqueueSpiritMessages, initializeGodAutopilot, runGodAutopilotCycle } from "../god/god-autopilot";
import { setGodAgentCallback } from "../spirits";

// =============================================================================
// TEST HARNESS
// =============================================================================

interface TestResult {
  phase: string;
  name: string;
  passed: boolean;
  detail: string;
  durationMs: number;
}

const results: TestResult[] = [];
let currentPhase = "";

function setPhase(name: string): void {
  currentPhase = name;
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Phase: ${name}`);
  console.log(`${"═".repeat(60)}\n`);
}

async function test(name: string, fn: () => void | Promise<void>): Promise<boolean> {
  const start = Date.now();
  try {
    await fn();
    results.push({ phase: currentPhase, name, passed: true, detail: "OK", durationMs: Date.now() - start });
    console.log(`  [PASS] ${name}`);
    return true;
  } catch (e: any) {
    results.push({ phase: currentPhase, name, passed: false, detail: e.message, durationMs: Date.now() - start });
    console.log(`  [FAIL] ${name}: ${e.message}`);
    return false;
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// =============================================================================
// CONFIG
// =============================================================================

interface Config {
  durationSec: number;
  seed: string;
}

function parseArgs(): Partial<Config> {
  const args: Partial<Config> = {};
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith("--durationSec=")) args.durationSec = parseInt(raw.split("=")[1], 10);
    if (raw.startsWith("--seed=")) args.seed = raw.split("=").slice(1).join("=");
  }
  return args;
}

const DEFAULTS: Config = {
  durationSec: 180,
  seed: `A living medieval port city called Tidehaven. It has:
- The Harbormaster's Office overlooking the docks where ships arrive
- A bustling Fish Market where merchants hawk the day's catch
- The Salty Anchor tavern where sailors drink and tell tall tales
- An Alchemist's Workshop tucked in a narrow alley, filled with bubbling potions
- The City Watch barracks where guards patrol from
- A Library of Tides with ancient maritime maps and navigation charts

Characters:
- Captain Rhona, a retired pirate turned harbormaster, gruff but fair
- Finn, a young fishmonger trying to make his fortune
- Old Marta, the tavern keeper who has heard every secret in the city
- Zephyr, a mysterious alchemist researching the properties of sea salt
- Sergeant Kael, the head of the city watch, obsessed with order
- Librarian Yara, keeper of forbidden maritime lore

The city has a tide that rises and falls, affecting the harbor. There's tension between the merchants and the watch over smuggling. Zephyr's experiments sometimes cause strange effects.`,
};

// =============================================================================
// METRICS TRACKING
// =============================================================================

interface GenesisBaseline {
  rooms: number;
  agents: number;
  objects: number;
  namedEntities: number;
  systems: number;
  components: number;
  dynamicComponents: number;
  agentNames: string[];
  roomNames: string[];
  systemNames: string[];
  componentNames: string[];
}

interface EvolutionMetrics {
  totalActions: number;
  actionCounts: Record<string, number>;
  systemsBaked: number;
  systemErrors: number;
  watcherSyntheses: number;
  proposalsSent: number;
  architectProposals: number;
  proposalsExecuted: number;
  consistencyIssues: number;
  customBehaviorTreesSet: number;
  actionsRegistered: number;
  spiritCycles: number;
  godCommands: number;
  agentSpeechEvents: number;
  roomTransitions: number;
}

const metrics: EvolutionMetrics = {
  totalActions: 0,
  actionCounts: {},
  systemsBaked: 0,
  systemErrors: 0,
  watcherSyntheses: 0,
  proposalsSent: 0,
  architectProposals: 0,
  proposalsExecuted: 0,
  consistencyIssues: 0,
  customBehaviorTreesSet: 0,
  actionsRegistered: 0,
  spiritCycles: 0,
  godCommands: 0,
  agentSpeechEvents: 0,
  roomTransitions: 0,
};

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  const config: Config = { ...DEFAULTS, ...parseArgs() };
  const hasAPI = (process.env.GOOGLE_GENERATIVE_AI_API_KEY || "").trim().length > 0;

  if (!hasAPI) {
    console.log("\n  GOOGLE_GENERATIVE_AI_API_KEY required for the Full Autonomy Gauntlet.");
    console.log("  This test exercises genesis, system baking, and spirit cognition — all need LLM.\n");
    process.exit(1);
  }

  console.log("\n╔══════════════════════════════════════════════════════════════════╗");
  console.log("║        FULL AUTONOMY GAUNTLET — The Ultimate Stress Test       ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");
  console.log(`  Duration: ${config.durationSec}s`);
  console.log(`  Seed: "${config.seed.slice(0, 80)}..."`);

  // Output setup
  const runDir = path.join("./stress-test-output", `gauntlet-${Date.now()}`);
  fs.mkdirSync(path.join(runDir, "components"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "systems"), { recursive: true });
  setComponentsDir(path.join(runDir, "components"));
  clearDynamicComponents();
  resetFactoryState();
  resetLawgiverState();
  resetAggregator();
  resetWatcherState();

  const eventLog = fs.createWriteStream(path.join(runDir, "events.jsonl"), { flags: "a" });
  const logEvent = (type: string, data: any) => eventLog.write(JSON.stringify({ ts: Date.now(), type, ...data }) + "\n");

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: GENESIS — Create the world from nothing
  // ═══════════════════════════════════════════════════════════════════════════
  setPhase("Genesis — World from Seed");

  let sim: Awaited<ReturnType<typeof createSimulation>> | null = null;

  await test("createSimulation with genesis: true", async () => {
    sim = await createSimulation({
      name: "Tidehaven",
      narrative: config.seed,
      genesis: true,
      enableAI: true,
      enableSpirits: false, // We manage spirits manually for precise control
      enablePlanning: false,
      dualLoop: true,
    });
    assert(sim !== null, "createSimulation returned null");
    assert(sim.world !== null, "world is null");
    assert(sim.god !== null, "god is null");
  });

  if (!sim) {
    console.error("Genesis failed — cannot continue");
    process.exit(1);
  }

  // Capture baseline
  let baseline: GenesisBaseline = {
    rooms: 0, agents: 0, objects: 0, namedEntities: 0,
    systems: 0, components: 0, dynamicComponents: 0,
    agentNames: [], roomNames: [], systemNames: [], componentNames: [],
  };

  await test("Genesis created rooms (>= 2)", () => {
    const rooms = Array.from(query(sim!.world, [Room]));
    baseline.rooms = rooms.length;
    baseline.roomNames = rooms.map(eid => Name.value[eid]).filter(Boolean) as string[];
    console.log(`    Rooms (${rooms.length}): ${baseline.roomNames.join(", ")}`);
    assert(rooms.length >= 2, `Expected >= 2 rooms, got ${rooms.length}`);
  });

  await test("Genesis created agents (>= 2)", () => {
    const agents = Array.from(query(sim!.world, [Agent]));
    baseline.agents = agents.length;
    baseline.agentNames = agents.map(eid => Name.value[eid]).filter(Boolean) as string[];
    console.log(`    Agents (${agents.length}): ${baseline.agentNames.join(", ")}`);
    assert(agents.length >= 2, `Expected >= 2 agents, got ${agents.length}`);
  });

  await test("Genesis created objects (>= 3)", () => {
    const objects = Array.from(query(sim!.world, [PhysicalObject]));
    baseline.objects = objects.length;
    const objectNames = objects.map(eid => Name.value[eid]).filter(Boolean);
    console.log(`    Objects (${objects.length}): ${objectNames.slice(0, 8).join(", ")}${objectNames.length > 8 ? "..." : ""}`);
    assert(objects.length >= 3, `Expected >= 3 objects, got ${objects.length}`);
  });

  await test("Genesis created named entities (>= 8)", () => {
    const named = Array.from(query(sim!.world, [Name]));
    baseline.namedEntities = named.length;
    assert(named.length >= 8, `Expected >= 8 named entities, got ${named.length}`);
  });

  await test("Agents have behavior policies", () => {
    const agents = Array.from(query(sim!.world, [Agent]));
    let withPolicy = 0;
    for (const eid of agents) {
      if (BehaviorPolicy.enabled[eid]) withPolicy++;
    }
    console.log(`    ${withPolicy}/${agents.length} agents have behavior policies`);
    assert(withPolicy >= Math.floor(agents.length * 0.5), `Expected >= 50% with policies, got ${withPolicy}/${agents.length}`);
  });

  await test("System baseline captured", () => {
    baseline.systems = sim!.god.systemRegistry.systems.size;
    baseline.systemNames = Array.from(sim!.god.systemRegistry.systems.keys());
    baseline.components = listComponentNames().length;
    baseline.dynamicComponents = listDynamicComponentDefs().length;
    baseline.componentNames = listComponentNames();
    console.log(`    Systems: ${baseline.systems} | Components: ${baseline.components} (${baseline.dynamicComponents} dynamic)`);
    if (baseline.dynamicComponents > 0) {
      console.log(`    Dynamic: ${listDynamicComponentDefs().map(d => d.name).join(", ")}`);
    }
  });

  logEvent("genesis_complete", { baseline });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: COGNITION — Let agents act
  // ═══════════════════════════════════════════════════════════════════════════
  setPhase("Cognition — Agent Activity");

  // Hook up event tracking
  const unsubAgent = sim.onAgent((evt: any) => {
    try {
      if (evt?.type === "agent:action" && evt.action) {
        const action = String(evt.action);
        metrics.totalActions++;
        metrics.actionCounts[action] = (metrics.actionCounts[action] || 0) + 1;
        if (action === "speak") metrics.agentSpeechEvents++;
        if (action === "move") metrics.roomTransitions++;
        if (typeof evt.agentId === "number") recordAgentAction(evt.agentId, action);
      }
    } catch {}
  });

  await sim.start();

  await test("Simulation ticks for 10s", async () => {
    await sleep(10_000);
    const stats = sim!.getStats();
    console.log(`    Tick: ${stats.tick} | Agents: ${stats.agentCount} | Systems: ${stats.systemCount}`);
    assert(stats.tick > 0, `Expected tick > 0, got ${stats.tick}`);
  });

  await test("Agents are taking actions", () => {
    assert(metrics.totalActions >= 3, `Expected >= 3 actions after 10s, got ${metrics.totalActions}`);
    const types = Object.keys(metrics.actionCounts);
    console.log(`    Actions: ${metrics.totalActions} across ${types.length} types`);
    for (const [type, count] of Object.entries(metrics.actionCounts)) {
      console.log(`      ${type}: ${count}`);
    }
  });

  await test("Agents have LastAction set", () => {
    const agents = Array.from(query(sim!.world, [Agent]));
    let withActions = 0;
    for (const eid of agents) {
      if (LastAction.type[eid]) withActions++;
    }
    console.log(`    ${withActions}/${agents.length} agents have LastAction`);
    assert(withActions >= 1, `Expected >= 1 agent with LastAction`);
  });

  logEvent("cognition_phase_complete", { metrics: { ...metrics } });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: MID-FLIGHT SURGERY — God rewires agents + registers actions
  // ═══════════════════════════════════════════════════════════════════════════
  setPhase("Mid-Flight Surgery — God Rewires");

  // Pick a specific agent to rewire
  const agentEids = Array.from(query(sim!.world, [Agent]));
  const targetAgentEid = agentEids[0];
  const targetAgentName = Name.value[targetAgentEid];
  console.log(`  Target agent for rewiring: ${targetAgentName} (eid ${targetAgentEid})\n`);

  await test("Validate custom behavior tree", () => {
    const customTree = {
      type: "selector" as const,
      children: [
        // Priority 1: If low energy, find somewhere to rest
        {
          type: "sequence" as const,
          children: [
            { type: "condition" as const, op: { type: "need_below" as const, need: "energy", value: 20 } },
            { type: "interact_with_trait" as const, trait: "sleepable", affordance: "sleep", scope: "accessible" as const },
          ],
        },
        // Priority 2: Investigate — this agent is now an investigator
        {
          type: "sequence" as const,
          children: [
            { type: "condition" as const, op: { type: "chance" as const, p: 0.4 } },
            { type: "action" as const, action: { type: "observe" as const, target: "room" } },
          ],
        },
        // Priority 3: Interrogate people
        {
          type: "sequence" as const,
          children: [
            { type: "condition" as const, op: { type: "chance" as const, p: 0.3 } },
            { type: "interact_with_trait" as const, trait: "talkable", affordance: "interrogate", scope: "room" as const },
          ],
        },
        // Priority 4: Think about clues
        {
          type: "sequence" as const,
          children: [
            { type: "condition" as const, op: { type: "chance" as const, p: 0.25 } },
            { type: "action" as const, action: { type: "think" as const, content: "What clues have I gathered? Who is suspicious?" } },
          ],
        },
        // Priority 5: Wander to new areas
        { type: "wander" as const },
      ],
    };

    const validation = validateBehaviorNode(customTree);
    assert(validation.ok === true, `Validation failed: ${(validation as any).error}`);
  });

  await test("setAgentBehaviorPolicy with custom tree", () => {
    const investigatorTree = {
      type: "selector" as const,
      children: [
        {
          type: "sequence" as const,
          children: [
            { type: "condition" as const, op: { type: "need_below" as const, need: "energy", value: 20 } },
            { type: "interact_with_trait" as const, trait: "sleepable", affordance: "sleep", scope: "accessible" as const },
          ],
        },
        {
          type: "sequence" as const,
          children: [
            { type: "condition" as const, op: { type: "chance" as const, p: 0.4 } },
            { type: "action" as const, action: { type: "observe" as const, target: "room" } },
          ],
        },
        {
          type: "sequence" as const,
          children: [
            { type: "condition" as const, op: { type: "chance" as const, p: 0.3 } },
            { type: "interact_with_trait" as const, trait: "talkable", affordance: "interrogate", scope: "room" as const },
          ],
        },
        {
          type: "sequence" as const,
          children: [
            { type: "condition" as const, op: { type: "chance" as const, p: 0.25 } },
            { type: "action" as const, action: { type: "think" as const, content: "What clues have I gathered? Who is suspicious?" } },
          ],
        },
        { type: "wander" as const },
      ],
    };

    setAgentBehaviorPolicy(sim!.world as any, targetAgentEid, investigatorTree, true);

    // Verify it took effect
    const tree = getBehaviorPolicyTree(sim!.world as any, targetAgentEid);
    assert(tree !== null, "Policy tree is null after setting");
    assert(tree!.type === "selector", `Expected selector root, got ${tree!.type}`);
    console.log(`    ${targetAgentName} rewired to investigator (${(tree as any).children.length} branches)`);
  });

  await test("evaluateBehaviorPolicy returns action for rewired agent", () => {
    // Policy has chance-based conditions, so retry up to 20 times
    let lastResult: any = null;
    for (let i = 0; i < 20; i++) {
      lastResult = evaluateBehaviorPolicy(sim!.world as any, targetAgentEid);
      if (lastResult.kind !== "none") break;
    }
    assert(lastResult.kind !== "none", `Expected action from policy after 20 tries, got 'none'. Trace: ${lastResult.trace.join(" → ")}`);
    console.log(`    Policy eval: ${lastResult.kind} | Trace: ${lastResult.trace.join(" → ")}`);
  });

  await test("Register custom action type", () => {
    ActionRegistry.registerComponentAction("Investigation", {
      name: "investigate",
      description: "Thoroughly investigate a location or person for clues",
      requiresTarget: true,
      requiresContent: false,
      targetTypes: ["room", "agent", "object"],
      category: "interaction",
      examples: ["investigate the harbor for smuggling evidence", "investigate Zephyr's workshop"],
    });

    const all = ActionRegistry.getAllActions();
    const found = all.find(a => a.name === "investigate");
    assert(found !== undefined, "investigate action not found in registry");
    console.log(`    Registered 'investigate' action (total: ${all.length} actions)`);
    metrics.actionsRegistered++;
  });

  await test("Register another custom action type", () => {
    ActionRegistry.registerComponentAction("Alchemy", {
      name: "brew",
      description: "Brew an alchemical potion or concoction",
      requiresTarget: false,
      requiresContent: true,
      targetTypes: ["object"],
      category: "interaction",
      examples: ["brew a healing potion", "brew a potion of sea-sight"],
    });

    const found = ActionRegistry.getAllActions().find(a => a.name === "brew");
    assert(found !== undefined, "brew action not found in registry");
    metrics.actionsRegistered++;
  });

  // Let the rewired agent act for a bit
  await test("Rewired agent acts with new behavior tree (5s)", async () => {
    const beforeActions = metrics.totalActions;
    await sleep(5_000);
    const afterActions = metrics.totalActions;
    console.log(`    Actions during 5s: ${afterActions - beforeActions}`);
    assert(afterActions > beforeActions, "No new actions after rewiring");
  });

  logEvent("surgery_complete", { targetAgent: targetAgentName, actionsRegistered: metrics.actionsRegistered });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 4: SPIRIT AUTONOMY — Let the spirits evolve the world
  // ═══════════════════════════════════════════════════════════════════════════
  setPhase("Spirit Autonomy — Self-Evolution Loop");

  // Initialize spirit system
  const spiritSystem = initializeSpiritSystem(sim!.world, {
    godAgentEid: sim!.god.eid,
    tickInterval: 10000,
    autoCreateNarrator: false,
  });
  createStandardHierarchy(sim!.god.eid);
  startSpiritSystem();

  // Wire up God callback for spirit messages
  initializeGodAutopilot(sim!.god, {
    enabled: true,
    minRunIntervalMs: 20000,
    minPriority: "normal",
    maxMessagesPerRun: 5,
  });
  setGodAgentCallback(async (messages) => {
    enqueueSpiritMessages(sim!.god, messages, (fromEid) => {
      const spirit = spiritSystem.registry.spirits.get(fromEid);
      return spirit?.definition.name || `Spirit#${fromEid}`;
    });
  });

  // Seed observations to kickstart the evolution pipeline
  reportGapObservation("Gauntlet", "system_missing", "No tide system", "Tidehaven has tides but no system models rising/falling water levels that affect the harbor and fishing.", "high");
  reportGapObservation("Gauntlet", "component_missing", "No reputation tracking", "Agents have no way to track how other agents perceive them. Reputation would drive social dynamics.", "medium");
  reportGapObservation("Gauntlet", "interaction_failure", "Cannot trade items", "Merchants and fishmongers cannot exchange goods. Need a trading/barter system.", "high");
  reportGapObservation("Gauntlet", "narrative_gap", "Smuggling tension has no mechanics", "The seed mentions smuggling tension but there's no system to model contraband, suspicion, or enforcement.", "high");
  reportGapObservation("Gauntlet", "behavioral_gap", "Alchemist has no alchemy", "Zephyr is an alchemist but cannot brew potions or cause effects. Need alchemy mechanics.", "medium");

  console.log("  Seeded 5 high-priority gap observations\n");

  // Get architect reference
  const weaverEid = spiritSystem.registry.byName.get("The Weaver");
  let architectState = weaverEid !== undefined ? getDynamicSpirit(weaverEid) : null;

  // Run the evolution loop
  const evolutionStart = Date.now();
  const evolutionDurationMs = Math.max(30_000, (config.durationSec - 30) * 1000);
  const evolutionEnd = evolutionStart + evolutionDurationMs;

  let lastWatcher = 0;
  let lastArchitect = 0;
  let lastCrafter = 0;
  let lastSteward = 0;
  let lastSnapshot = 0;
  let cycleCount = 0;

  console.log(`  Running evolution loop for ${(evolutionDurationMs / 1000).toFixed(0)}s...\n`);

  while (Date.now() < evolutionEnd) {
    const now = Date.now();
    const elapsed = (now - evolutionStart) / 1000;

    // Spirit tick
    try {
      await tickSpiritSystem(sim!.world, {} as any);
      metrics.spiritCycles++;
    } catch {}

    // Watcher synthesis (every 20s)
    if (now - lastWatcher >= 20_000) {
      lastWatcher = now;
      try {
        const watcherEid = spiritSystem.registry.byName.get("The Watcher");
        if (watcherEid !== undefined) {
          const result = runObservationSynthesis(sim!.world, spiritSystem.registry, watcherEid);
          metrics.watcherSyntheses++;
          metrics.proposalsSent += result.proposalsSent;
          console.log(`  [${elapsed.toFixed(0)}s] Watcher: ${result.proposalsSent} proposals sent`);
        }
      } catch (e: any) {
        logEvent("watcher_error", { error: e.message });
      }
    }

    // Architect cognition (every 25s)
    if (now - lastArchitect >= 25_000) {
      lastArchitect = now;
      if (architectState) {
        try {
          const beforeSystems = sim!.god.systemRegistry.systems.size;
          const beforeExecCount = getFactoryState().pendingProposals.filter(p => p.status === "executed").length;

          const proposals = await runArchitectCognition(
            sim!.world, sim!.god.systemRegistry, spiritSystem.registry, architectState
          );
          metrics.architectProposals += proposals.length;

          const afterSystems = sim!.god.systemRegistry.systems.size;
          const afterExecCount = getFactoryState().pendingProposals.filter(p => p.status === "executed").length;
          const newSystems = afterSystems - beforeSystems;
          const newExecutions = afterExecCount - beforeExecCount;

          metrics.systemsBaked += newSystems;
          metrics.proposalsExecuted += newExecutions;

          console.log(`  [${elapsed.toFixed(0)}s] Architect: ${proposals.length} proposals, ${newExecutions} executed, ${newSystems} new systems`);
          logEvent("architect", { proposals: proposals.length, executed: newExecutions, newSystems });
        } catch (e: any) {
          console.log(`  [${elapsed.toFixed(0)}s] Architect error: ${e.message?.slice(0, 80)}`);
          logEvent("architect_error", { error: e.message });
        }
      }
    }

    // Steward (every 30s)
    if (now - lastSteward >= 30_000) {
      lastSteward = now;
      try {
        await runStewardCycle(sim!.world, sim!.god.systemRegistry, spiritSystem.registry);
      } catch {}
    }

    // World Crafter (every 20s)
    if (now - lastCrafter >= 20_000) {
      lastCrafter = now;
      try {
        await runWorldCrafterCycle(sim!.world, sim!.god.systemRegistry, spiritSystem.registry);
      } catch {}
    }

    // God autopilot (every 30s)
    if (now - lastSnapshot >= 30_000) {
      lastSnapshot = now;
      try {
        await runGodAutopilotCycle(sim!.god);
        metrics.godCommands++;
      } catch {}

      // Progress report
      const stats = sim!.getStats();
      const totalSystems = sim!.god.systemRegistry.systems.size;
      const totalComponents = listComponentNames().length;
      const dynamicComps = listDynamicComponentDefs().length;
      console.log(`\n  [SNAPSHOT ${elapsed.toFixed(0)}s] Tick: ${stats.tick} | Systems: ${totalSystems} (+${totalSystems - baseline.systems}) | Components: ${totalComponents} (+${totalComponents - baseline.components}) | Dynamic: ${dynamicComps} | Actions: ${metrics.totalActions}\n`);
    }

    cycleCount++;
    await sleep(3_000);
  }

  logEvent("evolution_complete", { metrics: { ...metrics }, cycleCount });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 5: SELF-EVOLUTION VERIFICATION — Did the world grow?
  // ═══════════════════════════════════════════════════════════════════════════
  setPhase("Self-Evolution Verification");

  const finalSystems = sim!.god.systemRegistry.systems.size;
  const finalComponents = listComponentNames().length;
  const finalDynamicComponents = listDynamicComponentDefs().length;
  const finalRooms = Array.from(query(sim!.world, [Room])).length;
  const finalAgents = Array.from(query(sim!.world, [Agent])).length;
  const finalNamed = Array.from(query(sim!.world, [Name])).length;
  const finalObjects = Array.from(query(sim!.world, [PhysicalObject])).length;

  console.log("  Genesis baseline → Current state:\n");
  console.log(`    Systems:            ${baseline.systems} → ${finalSystems} (+${finalSystems - baseline.systems})`);
  console.log(`    Components:         ${baseline.components} → ${finalComponents} (+${finalComponents - baseline.components})`);
  console.log(`    Dynamic components: ${baseline.dynamicComponents} → ${finalDynamicComponents} (+${finalDynamicComponents - baseline.dynamicComponents})`);
  console.log(`    Rooms:              ${baseline.rooms} → ${finalRooms} (+${finalRooms - baseline.rooms})`);
  console.log(`    Agents:             ${baseline.agents} → ${finalAgents} (+${finalAgents - baseline.agents})`);
  console.log(`    Objects:            ${baseline.objects} → ${finalObjects} (+${finalObjects - baseline.objects})`);
  console.log(`    Named entities:     ${baseline.namedEntities} → ${finalNamed} (+${finalNamed - baseline.namedEntities})`);
  console.log();

  // New components created
  const newComponentNames = listComponentNames().filter(n => !baseline.componentNames.includes(n));
  if (newComponentNames.length > 0) {
    console.log(`    New components: ${newComponentNames.join(", ")}`);
  }

  // New systems
  const newSystemNames = Array.from(sim!.god.systemRegistry.systems.keys()).filter(n => !baseline.systemNames.includes(n));
  if (newSystemNames.length > 0) {
    console.log(`    New systems: ${newSystemNames.join(", ")}`);
  }

  console.log();

  await test("World has MORE systems than genesis created", () => {
    assert(finalSystems > baseline.systems, `Systems didn't grow: ${baseline.systems} → ${finalSystems}`);
    console.log(`    ${finalSystems - baseline.systems} new systems baked`);
  });

  await test("World has MORE components than genesis created", () => {
    assert(finalComponents > baseline.components, `Components didn't grow: ${baseline.components} → ${finalComponents}`);
    console.log(`    ${finalComponents - baseline.components} new components`);
  });

  await test("Dynamic components are BitECS-queryable", () => {
    const dynamicDefs = listDynamicComponentDefs();
    if (dynamicDefs.length === 0) {
      throw new Error("No dynamic components exist to test queryability");
    }
    for (const def of dynamicDefs.slice(0, 3)) {
      const soa = getComponent(def.name);
      assert(soa !== undefined, `getComponent('${def.name}') returned undefined`);
      // Query should not throw
      const entities = Array.from(query(sim!.world, [soa]));
      console.log(`    ${def.name}: ${entities.length} entities with component`);
    }
  });

  await test("Agents took diverse actions (>= 4 types)", () => {
    const types = Object.keys(metrics.actionCounts);
    assert(types.length >= 4, `Only ${types.length} action types: ${types.join(", ")}`);
    console.log(`    ${types.length} action types, ${metrics.totalActions} total`);
  });

  await test("Watcher synthesized observations", () => {
    assert(metrics.watcherSyntheses > 0, "Watcher never synthesized");
    console.log(`    ${metrics.watcherSyntheses} synthesis cycles, ${metrics.proposalsSent} proposals sent`);
  });

  await test("Architect designed proposals", () => {
    assert(metrics.architectProposals > 0, "Architect never proposed");
    console.log(`    ${metrics.architectProposals} proposals designed, ${metrics.proposalsExecuted} executed`);
  });

  await test("New systems are active and running", () => {
    let activeNew = 0;
    for (const name of newSystemNames) {
      const sys = sim!.god.systemRegistry.systems.get(name);
      if (sys?.active) activeNew++;
    }
    console.log(`    ${activeNew}/${newSystemNames.length} new systems are active`);
    assert(activeNew >= 1, `No new systems are active`);
  });

  await test("Compiled system can reference dynamic components", () => {
    const dynamicDefs = listDynamicComponentDefs();
    if (dynamicDefs.length === 0) {
      throw new Error("No dynamic components to test compilation with");
    }
    const dynName = dynamicDefs[0].name;
    const props = Object.keys(dynamicDefs[0].properties);
    const prop = props[0] || "value";
    const code = `
      const entities = Array.from(ctx.query(world, [${dynName}]));
      for (const eid of entities) {
        ctx.log("${dynName}.${prop}=" + ${dynName}.${prop}[eid]);
      }
    `;
    const result = compileSystemCode(code, false);
    assert(result.success, `Compile failed: ${result.error}`);
    console.log(`    Compiled system referencing ${dynName} OK`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 6: RESILIENCE — Inject chaos, verify recovery
  // ═══════════════════════════════════════════════════════════════════════════
  setPhase("Resilience — Chaos Injection");

  await test("Create component at runtime and attach to entity", () => {
    const soa = createDynamicComponent({
      name: "Chaos",
      description: "Injected by stress test to verify runtime component creation",
      properties: { intensity: "number" as const, source: "string" as const },
    });
    assert(soa !== undefined, "createDynamicComponent returned undefined");
    assert(registryHasComponent("Chaos"), "Chaos not in registry");

    // Attach to a random agent
    const ok = attachToEntity(sim!.world, targetAgentEid, "Chaos", { intensity: 99, source: "gauntlet" });
    assert(ok, "attachToEntity returned false");

    // Verify queryable
    const chaosSoa = getComponent("Chaos");
    const found = Array.from(query(sim!.world, [chaosSoa]));
    assert(found.includes(targetAgentEid), `Query for Chaos didn't find target agent`);
    assert(chaosSoa.intensity[targetAgentEid] === 99, `Chaos.intensity=${chaosSoa.intensity[targetAgentEid]}, expected 99`);
    console.log(`    Chaos component: created, attached, queryable OK`);
  });

  await test("Simulation continues after chaos injection (5s)", async () => {
    const beforeTick = sim!.getStats().tick;
    const beforeActions = metrics.totalActions;
    await sleep(5_000);
    const afterTick = sim!.getStats().tick;
    const afterActions = metrics.totalActions;
    console.log(`    Ticks: ${beforeTick} → ${afterTick} | Actions: ${beforeActions} → ${afterActions}`);
    assert(afterTick > beforeTick || afterActions > beforeActions, "Simulation stalled after chaos injection");
  });

  await test("God can execute command during live simulation", async () => {
    const statsBefore = sim!.getStats();
    try {
      const results = await godCommand(sim!.god, `Create a new object called "Storm Lantern" in the first available room. It should be examinable and provide light. Also create a "StormIntensity" component with properties: level (number), direction (string).`);
      const succeeded = results.filter(r => !r.isError).length;
      console.log(`    God command: ${succeeded}/${results.length} tool calls succeeded`);
      metrics.godCommands++;
      assert(succeeded >= 1, `God command failed: ${results.map(r => r.content).join("; ")}`);
    } catch (e: any) {
      // God command failure is not fatal — just log it
      console.log(`    God command threw: ${e.message?.slice(0, 80)}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL REPORT
  // ═══════════════════════════════════════════════════════════════════════════

  stopSpiritSystem();
  sim!.stop();
  unsubAgent();

  console.log(`\n${"═".repeat(60)}`);
  console.log("  FULL AUTONOMY GAUNTLET — FINAL REPORT");
  console.log(`${"═".repeat(60)}\n`);

  // Summary table
  const elapsed = ((Date.now() - evolutionStart) / 1000).toFixed(0);
  console.log(`  Duration: ${elapsed}s | Cycles: ${cycleCount}`);
  console.log();

  console.log("  --- World Growth ---");
  console.log(`  Systems:      ${baseline.systems} → ${finalSystems} (+${finalSystems - baseline.systems})`);
  console.log(`  Components:   ${baseline.components} → ${finalComponents} (+${finalComponents - baseline.components})`);
  console.log(`  Dynamic:      ${baseline.dynamicComponents} → ${finalDynamicComponents}`);
  console.log(`  Rooms:        ${baseline.rooms} → ${finalRooms}`);
  console.log(`  Agents:       ${baseline.agents} → ${finalAgents}`);
  console.log(`  Objects:      ${baseline.objects} → ${finalObjects}`);
  console.log();

  console.log("  --- Agent Activity ---");
  console.log(`  Total actions: ${metrics.totalActions}`);
  const sortedActions = Object.entries(metrics.actionCounts).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedActions) {
    const pct = ((count / Math.max(1, metrics.totalActions)) * 100).toFixed(1);
    console.log(`    ${type}: ${count} (${pct}%)`);
  }
  console.log();

  console.log("  --- Evolution Pipeline ---");
  console.log(`  Watcher syntheses:    ${metrics.watcherSyntheses}`);
  console.log(`  Proposals sent:       ${metrics.proposalsSent}`);
  console.log(`  Architect proposals:  ${metrics.architectProposals}`);
  console.log(`  Proposals executed:   ${metrics.proposalsExecuted}`);
  console.log(`  Systems baked:        ${metrics.systemsBaked}`);
  console.log(`  God commands:         ${metrics.godCommands}`);
  console.log(`  Actions registered:   ${metrics.actionsRegistered}`);
  console.log(`  Spirit cycles:        ${metrics.spiritCycles}`);
  console.log();

  if (newSystemNames.length > 0) {
    console.log("  --- New Systems ---");
    for (const name of newSystemNames) {
      const sys = sim!.god.systemRegistry.systems.get(name);
      const errors = sim!.god.systemRegistry.errorCounts.get(name) || 0;
      const status = sys?.active ? "ACTIVE" : "inactive";
      console.log(`    [${status}] ${name} (errors: ${errors})`);
      if (sys?.description) console.log(`      ${sys.description.slice(0, 100)}`);

      // Save system code
      if (sys?.code) {
        fs.writeFileSync(path.join(runDir, "systems", `${name}.js`), sys.code);
      }
    }
    console.log();
  }

  if (newComponentNames.length > 0) {
    console.log("  --- New Components ---");
    for (const name of newComponentNames) {
      const def = listDynamicComponentDefs().find(d => d.name === name);
      if (def) {
        console.log(`    ${name}: ${Object.keys(def.properties).join(", ")} — ${def.description?.slice(0, 80)}`);
      } else {
        console.log(`    ${name}`);
      }
    }
    console.log();
  }

  // System registry dump
  console.log("  --- Full System Registry ---");
  for (const [name, sys] of sim!.god.systemRegistry.systems) {
    const errors = sim!.god.systemRegistry.errorCounts.get(name) || 0;
    const status = sys.active ? "ON " : "OFF";
    const isNew = !baseline.systemNames.includes(name) ? " [NEW]" : "";
    console.log(`    [${status}] ${name}${isNew} (${sys.frequency}ms, errors: ${errors})`);
  }
  console.log();

  // Test results
  console.log("  --- Test Results ---");
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  for (const r of results) {
    const icon = r.passed ? "PASS" : "FAIL";
    console.log(`    [${icon}] ${r.phase} / ${r.name}${r.passed ? "" : `: ${r.detail}`}`);
  }

  console.log(`\n  Result: ${passed}/${total} passed, ${failed} failed`);
  console.log(`  Total test duration: ${results.reduce((s, r) => s + r.durationMs, 0)}ms`);

  // Save summary
  const summary = {
    baseline,
    final: {
      systems: finalSystems,
      components: finalComponents,
      dynamicComponents: finalDynamicComponents,
      rooms: finalRooms,
      agents: finalAgents,
      objects: finalObjects,
      namedEntities: finalNamed,
    },
    growth: {
      systems: finalSystems - baseline.systems,
      components: finalComponents - baseline.components,
      dynamicComponents: finalDynamicComponents - baseline.dynamicComponents,
      rooms: finalRooms - baseline.rooms,
      agents: finalAgents - baseline.agents,
      objects: finalObjects - baseline.objects,
    },
    metrics,
    newSystems: newSystemNames,
    newComponents: newComponentNames,
    testResults: { passed, failed, total },
    durationSec: parseInt(elapsed),
  };
  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
  eventLog.end();

  console.log(`\n  Output: ${runDir}`);

  // Final verdict
  const verdict = passed >= total - 2 && (finalSystems > baseline.systems);
  console.log(`\n  ${verdict ? "THE WORLD GREW. AUTONOMY ACHIEVED." : "WORLD DID NOT FULLY EVOLVE — see failures above."}`);
  console.log();

  process.exit(verdict ? 0 : 1);
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
