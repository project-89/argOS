/**
 * Behavioral Test 70: Self-Evolution Stress Test
 *
 * Exercises the complete autonomous feedback loop:
 *   Spirits observe → Aggregator collects → Watcher synthesizes →
 *   Architect designs → System Baker generates → World evolves
 *
 * Metrics tracked:
 * - Gap observations reported (by category, source)
 * - Watcher synthesis cycles and proposals sent
 * - Architect proposals designed and executed
 * - Systems baked (success/failure, quality validation)
 * - Agent behavior diversity before/after evolution
 * - System health (errors, performance, emit-only)
 *
 * Usage:
 *   npx tsx src/behavioral-tests/70-self-evolution-stress-test.ts
 *   npx tsx src/behavioral-tests/70-self-evolution-stress-test.ts --durationSec=180 --noLLM
 */
import "dotenv/config";

import * as fs from "fs";
import * as path from "path";
import { query, hasComponent } from "bitecs";

import { createSimulation } from "../index";
import { Agent, Name, Needs, BehaviorPolicy } from "../ecs/components";
import { getSystemTelemetrySnapshot, type SystemRegistry } from "../ecs/dynamic-systems";
import { validateSystemCode } from "../god/system-baker";
import { setAgentBehaviorPolicy } from "../cognition/behavior-policy";
import { inferPolicyFromRole, getPolicyTemplate } from "../cognition/behavior-templates";

import {
  initializeSpiritSystem,
  createStandardHierarchy,
  startSpiritSystem,
  stopSpiritSystem,
  setGodAgentCallback,
  tickSpiritSystem,
  getRegistrySummary,
  recordActionEvent,
} from "../spirits";
import {
  createDynamicSpirit,
  getDynamicSpirit,
  getFactoryState,
  getPendingProposals,
  approveProposal,
  getApprovedProposals,
  resetFactoryState,
  type DynamicSpiritState,
} from "../spirits/spirit-factory";
import {
  getTopObservations,
  getObservationSummary,
  getRecentObservations,
  resetAggregator,
  reportGap as reportGapObservation,
  type AggregatedObservation,
} from "../spirits/observation-aggregator";
import {
  runObservationSynthesis,
  recordAgentAction,
  getWatcherStatus,
  resetWatcherState,
} from "../spirits/watcher-spirit";
import { runArchitectCognition, executeAllApprovedProposals, queueAllApprovedProposals } from "../spirits/architect-spirit";
import { runArtificerWithTools } from "../spirits/artificer-spirit";
import { runWorldCrafterCycle, recordFailedInteraction, recordResourceGap } from "../spirits/world-crafter-spirit";
import { runStewardCycle } from "../spirits/steward-spirit";
import { runLawgiverCycle, resetLawgiverState } from "../spirits/rules-spirit";
import { getAndClearAccumulatedIssues, recordEvent } from "../spirits/consistency-spirit";
import { setComponentsDir, clearDynamicComponents } from "../ecs/dynamic-components";
import { enqueueSpiritMessages, initializeGodAutopilot, runGodAutopilotCycle } from "../god/god-autopilot";

// =============================================================================
// CONFIG
// =============================================================================

interface Config {
  durationSec: number;
  noLLM: boolean;
  outputDir: string;
  evalIntervalMs: number;
  watcherIntervalMs: number;
  architectIntervalMs: number;
  crafterIntervalMs: number;
  artificerIntervalMs: number;
  lawgiverIntervalMs: number;
  stewardIntervalMs: number;
}

const DEFAULTS: Config = {
  durationSec: 120,
  noLLM: false,
  outputDir: "./stress-test-output",
  evalIntervalMs: 15_000,
  watcherIntervalMs: 20_000,
  architectIntervalMs: 30_000,
  crafterIntervalMs: 15_000,
  artificerIntervalMs: 25_000,
  lawgiverIntervalMs: 25_000,
  stewardIntervalMs: 20_000,
};

function parseArgs(): Partial<Config> {
  const args: Partial<Config> = {};
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith("--durationSec=")) args.durationSec = parseInt(raw.split("=")[1], 10);
    if (raw === "--noLLM") args.noLLM = true;
    if (raw.startsWith("--output=")) args.outputDir = raw.split("=")[1];
  }
  return args;
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// =============================================================================
// SNAPSHOT TYPES
// =============================================================================

interface EvolutionSnapshot {
  ts: number;
  elapsedSec: number;
  tick: number;

  // Observation aggregator state
  observations: {
    totalRaw: number;
    totalAggregated: number;
    byCategory: Record<string, number>;
    bySource: Record<string, number>;
    topPriority: number;
    topTitle: string;
  };

  // Agent activity
  agents: {
    total: number;
    active: number;
    actionCounts: Record<string, number>;
    uniqueActionTypes: number;
    diversityScore: number; // 0-1, higher = more diverse action mix
  };

  // System health
  systems: {
    total: number;
    active: number;
    bakedThisCycle: number;
    bakedTotal: number;
    errorsTotal: number;
    autoDisabled: number;
    emitOnly: number;
    avgDurationMs: number;
  };

  // Spirit activity
  spirits: {
    watcherSyntheses: number;
    proposalsSent: number;
    architectProposals: number;
    proposalsExecuted: number;
    crafterMaterializations: number;
    consistencyIssues: number;
  };

  // Evolution quality
  quality: {
    score: number; // 0-100
    recommendations: string[];
  };
}

// =============================================================================
// WORLD CONFIG
// =============================================================================

function buildWorldConfig() {
  return {
    rooms: [
      { name: "Town Square", roomType: "square", autoPopulate: true, description: "A cobbled square with a fountain at its center." },
      { name: "Tavern", roomType: "tavern", autoPopulate: true, description: "A warm tavern with hearty food and ale." },
      { name: "Marketplace", roomType: "market", autoPopulate: true, description: "Bustling stalls with fresh produce and wares." },
      { name: "Forge", roomType: "blacksmith", autoPopulate: true, description: "A hot forge ringing with hammer blows." },
      { name: "Library", roomType: "library", autoPopulate: true, description: "A quiet library filled with ancient tomes." },
      { name: "Farm", roomType: "farm", autoPopulate: true, description: "Fields of wheat and vegetable patches." },
    ],
    agents: [
      { name: "Elara", role: "innkeeper", startRoom: "Tavern", description: "Warm and welcoming, knows everyone's story." },
      { name: "Grimjaw", role: "blacksmith", startRoom: "Forge", description: "Gruff and skilled, takes pride in his craft." },
      { name: "Pip", role: "street urchin", startRoom: "Town Square", description: "Curious and mischievous, always looking for fun." },
      { name: "Sage", role: "scholar", startRoom: "Library", description: "Contemplative, with vast knowledge of history." },
      { name: "Hilda", role: "farmer", startRoom: "Farm", description: "Practical and generous, loves the land." },
      { name: "Celia", role: "merchant", startRoom: "Marketplace", description: "Sharp-eyed trader with connections everywhere." },
    ],
    objects: [
      { name: "Bread Loaf", room: "Tavern", description: "Fresh bread.", traits: ["edible"] },
      { name: "Ale Barrel", room: "Tavern", description: "A barrel of ale.", traits: ["drinkable"] },
      { name: "Tavern Cot", room: "Tavern", description: "A cot for travelers.", traits: ["sleepable"], portable: false },
      { name: "Apple Basket", room: "Marketplace", description: "Fresh apples.", traits: ["edible"] },
      { name: "Iron Anvil", room: "Forge", description: "A heavy anvil.", traits: ["examinable"], portable: false },
      { name: "Workshop Cot", room: "Forge", description: "A cot by the forge.", traits: ["sleepable"], portable: false },
      { name: "Ancient Tome", room: "Library", description: "A tome of lore.", traits: ["readable", "examinable"] },
      { name: "Library Bench", room: "Library", description: "A reading bench.", traits: ["sleepable"], portable: false },
      { name: "Fresh Carrot", room: "Farm", description: "Just pulled from the soil.", traits: ["edible"] },
      { name: "Hay Bed", room: "Farm", description: "Soft hay for resting.", traits: ["sleepable"], portable: false },
      { name: "Notice Board", room: "Town Square", description: "Town announcements.", traits: ["readable", "examinable"] },
      { name: "Village Bench", room: "Town Square", description: "A bench for sitting.", traits: ["sleepable"], portable: false },
    ],
  };
}

// =============================================================================
// METRICS
// =============================================================================

let totalBaked = 0;
let bakedThisCycle = 0;
let watcherSyntheses = 0;
let proposalsSent = 0;
let architectProposals = 0;
let proposalsExecuted = 0;
let crafterMaterializations = 0;
let consistencyIssues = 0;

const agentActionCounts: Record<string, number> = {};

function recordAgentActionMetric(actionType: string): void {
  agentActionCounts[actionType] = (agentActionCounts[actionType] || 0) + 1;
}

function computeDiversityScore(counts: Record<string, number>): number {
  const values = Object.values(counts).filter(v => v > 0);
  if (values.length <= 1) return 0;
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  // Shannon entropy normalized to [0,1]
  const entropy = -values.reduce((sum, v) => {
    const p = v / total;
    return sum + (p > 0 ? p * Math.log2(p) : 0);
  }, 0);
  const maxEntropy = Math.log2(values.length);
  return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

function computeSystemStats(registry: SystemRegistry): EvolutionSnapshot["systems"] {
  const systems = Array.from(registry.systems.values());
  const total = systems.length;
  const active = systems.filter(s => s.active).length;
  const errorsTotal = Array.from(registry.errorCounts.values()).reduce((a, b) => a + b, 0);
  const autoDisabled = systems.filter(s => !s.active && (registry.errorCounts.get(s.name) || 0) >= 3).length;

  let emitOnly = 0;
  for (const sys of systems) {
    if (!sys.code) continue;
    const analysis = validateSystemCode(sys.code, {
      name: sys.name, purpose: sys.description || "", inputs: [], modifiedComponents: [],
      outputs: [], pseudocode: sys.pseudocode || "", frequency: sys.frequency,
    } as any);
    if (!analysis.valid && analysis.issues.some(i => i.includes("NO STATE MODIFICATIONS"))) emitOnly++;
  }

  const telemetry = getSystemTelemetrySnapshot();
  const durations = telemetry.map(t => t.lastDurationMs).filter(n => Number.isFinite(n)) as number[];
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  return { total, active, bakedThisCycle, bakedTotal: totalBaked, errorsTotal, autoDisabled, emitOnly, avgDurationMs: Math.round(avg) };
}

function computeObservationStats(): EvolutionSnapshot["observations"] {
  const top = getTopObservations(20);
  const byCategory: Record<string, number> = {};
  const bySource: Record<string, number> = {};

  for (const obs of top) {
    byCategory[obs.category] = (byCategory[obs.category] || 0) + obs.occurrences;
    for (const reporter of obs.reporters) {
      bySource[reporter] = (bySource[reporter] || 0) + 1;
    }
  }

  const recent = getRecentObservations(100);

  return {
    totalRaw: recent.length,
    totalAggregated: top.length,
    byCategory,
    bySource,
    topPriority: top[0]?.priorityScore || 0,
    topTitle: top[0]?.title || "(none)",
  };
}

function computeQualityScore(snapshot: Partial<EvolutionSnapshot>): { score: number; recommendations: string[] } {
  const rec: string[] = [];
  let score = 50; // Start neutral

  // Agent diversity bonus (max +20)
  const diversity = snapshot.agents?.diversityScore || 0;
  score += diversity * 20;
  if (diversity < 0.3) rec.push("Agent actions lack diversity — behavior policies may be too narrow");

  // System health (max +20)
  const sys = snapshot.systems;
  if (sys) {
    const healthRatio = sys.active / Math.max(1, sys.total);
    score += healthRatio * 10;
    if (sys.errorsTotal === 0) score += 5;
    if (sys.emitOnly === 0) score += 5;
    if (sys.errorsTotal > 5) { score -= 10; rec.push(`${sys.errorsTotal} system errors — Tinker should repair`); }
    if (sys.emitOnly > 0) rec.push(`${sys.emitOnly} emit-only systems — need real state modifications`);
    if (sys.autoDisabled > 0) rec.push(`${sys.autoDisabled} systems auto-disabled`);
  }

  // Evolution activity bonus (max +15)
  const spirits = snapshot.spirits;
  if (spirits) {
    if (spirits.watcherSyntheses > 0) score += 3;
    if (spirits.proposalsSent > 0) score += 3;
    if (spirits.architectProposals > 0) score += 3;
    if (spirits.proposalsExecuted > 0) score += 6;
    if (spirits.watcherSyntheses === 0) rec.push("Watcher hasn't synthesized yet — no gap observations?");
  }

  // New systems baked bonus (max +10)
  if (totalBaked > 0) score += Math.min(10, totalBaked * 3);

  // Observation coverage bonus (max +5)
  const obs = snapshot.observations;
  if (obs) {
    const sources = Object.keys(obs.bySource).length;
    if (sources >= 3) score += 5;
    else if (sources >= 2) score += 3;
    if (sources === 0) rec.push("No spirit observations reported — aggregator not wired?");
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), recommendations: rec };
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  const config: Config = { ...DEFAULTS, ...parseArgs() };
  const hasAPI = !config.noLLM && (process.env.GOOGLE_GENERATIVE_AI_API_KEY || "").trim().length > 0;
  const mode = hasAPI ? "full" : "deterministic";

  console.log(`\n${"=".repeat(70)}`);
  console.log("=== SELF-EVOLUTION STRESS TEST ===");
  console.log(`${"=".repeat(70)}`);
  console.log(`Mode: ${mode} | Duration: ${config.durationSec}s | LLM: ${hasAPI ? "Gemini" : "DISABLED"}`);
  console.log();

  // Output setup — each run gets its own isolated sandbox directory
  const dir = path.join(config.outputDir, `self-evolution-${nowStamp()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "components"), { recursive: true });
  fs.mkdirSync(path.join(dir, "systems"), { recursive: true });

  // Isolate dynamic components to this run's directory
  setComponentsDir(path.join(dir, "components"));
  clearDynamicComponents();

  const eventsStream = fs.createWriteStream(path.join(dir, "events.jsonl"), { flags: "a" });
  const scoresStream = fs.createWriteStream(path.join(dir, "snapshots.jsonl"), { flags: "a" });
  const emitEvent = (type: string, data: Record<string, unknown>): void => {
    eventsStream.write(JSON.stringify({ ts: Date.now(), type, ...data }) + "\n");
  };

  // Reset state
  resetFactoryState();
  resetLawgiverState();
  resetAggregator();
  resetWatcherState();

  // Create simulation
  const worldConfig = buildWorldConfig();
  const sim = await createSimulation({
    name: "Self-Evolution Test",
    preset: "slice-of-life",
    enableAI: hasAPI,
    enableSpirits: false, // We manage spirits manually
    enablePlanning: false,
    dualLoop: true,
    ecsTickRate: 2,
    ecsDeltaMs: 500,
    autoPopulateRooms: true,
    rooms: worldConfig.rooms,
    agents: worldConfig.agents,
    objects: worldConfig.objects,
  });

  await sim.start();
  const baselineSystems = sim.god.systemRegistry.systems.size;
  console.log(`World created: ${worldConfig.agents.length} agents, ${worldConfig.rooms.length} rooms, ${worldConfig.objects.length} objects`);
  console.log(`Baseline systems: ${baselineSystems}`);

  // Assign behavior policies to agents
  const agentEids = Array.from(query(sim.world, [Agent] as any)) as number[];
  for (const eid of agentEids) {
    const agentName = String(Name.value[eid] || "");
    const agentConfig = worldConfig.agents.find(a => a.name === agentName);
    if (agentConfig) {
      const { template, params } = inferPolicyFromRole(agentConfig.role);
      const roomName = agentConfig.startRoom || "";
      const tree = getPolicyTemplate(template, { ...params, room: roomName, workplace: roomName });
      if (tree) {
        setAgentBehaviorPolicy(sim.world as any, eid, tree, true);
      }
    }
    // Prime needs so agents have interesting decisions to make
    Needs.hunger[eid] = 50 + Math.floor(Math.random() * 30);
    Needs.energy[eid] = 30 + Math.floor(Math.random() * 40);
  }
  console.log(`Behavior policies assigned to ${agentEids.length} agents\n`);

  // Initialize spirit system
  const spiritSystem = initializeSpiritSystem(sim.world, {
    godAgentEid: sim.god.eid,
    tickInterval: 10000,
    autoCreateNarrator: false,
  });

  createStandardHierarchy(sim.god.eid);
  startSpiritSystem();
  emitEvent("init", { agents: worldConfig.agents.length, rooms: worldConfig.rooms.length, baselineSystems, mode });

  // Seed some deliberate gaps to exercise the observation pipeline
  // 1. Record a few "failed interactions" that the Crafter would normally detect
  recordFailedInteraction("Pip", 15, "Town Square", "use", "Fishing Rod", "trying to fish");
  recordFailedInteraction("Celia", 18, "Marketplace", "trade", "Trading Scale", "trying to weigh goods");

  // 2. Record a resource gap
  recordResourceGap("fishing_rod", "Pip", "Town Square");

  // 3. Directly seed some observations for testing the synthesis pipeline
  reportGapObservation("The Crafter", "resource_gap", "No fishing equipment available", "Agents near water have no way to fish. Consider adding fishing rod objects or a fishing system.", "medium");
  reportGapObservation("The Steward", "environmental_gap", "Marketplace lacks trade infrastructure", "The marketplace has goods but no trading mechanism. Agents can't buy or sell.", "high");
  reportGapObservation("The Arbiter", "rule_missing", "No day/night cycle affects behavior", "Time progresses but has no effect on agent behavior, room ambience, or available activities.", "medium");
  reportGapObservation("The Tinker", "system_missing", "No weather or seasonal system", "The world has no weather variation. This limits environmental storytelling and activity diversity.", "low");

  console.log("  Seeded 4 gap observations + 2 failed interactions for pipeline testing\n");

  // Get architect spirit reference from the factory (where DynamicSpiritState lives)
  const weaverEid = spiritSystem.registry.byName.get("The Weaver");
  let architectState: DynamicSpiritState | null = null;
  if (weaverEid !== undefined) {
    const dynamicState = getDynamicSpirit(weaverEid);
    if (dynamicState) {
      architectState = dynamicState;
      console.log(`  Architect config: canExecuteDirectly=${dynamicState.architectConfig?.canExecuteDirectly}, approval=${dynamicState.architectConfig?.proposalApproval}`);
    } else {
      console.warn(`  WARNING: The Weaver (eid ${weaverEid}) not found in spirit factory — architect cognition will fail`);
    }
  }

  // Initialize autopilot if in full mode
  if (hasAPI) {
    initializeGodAutopilot(sim.god, {
      enabled: true,
      minRunIntervalMs: 30000,
      minPriority: "normal",
      maxMessagesPerRun: 5,
    });
    setGodAgentCallback(async (messages) => {
      enqueueSpiritMessages(sim.god, messages, (fromEid) => {
        const spirit = spiritSystem.registry.spirits.get(fromEid);
        return spirit?.definition.name || `Spirit#${fromEid}`;
      });
    });
  }

  // Track agent actions — feed both metrics, watcher, and event buffer
  let currentTick = 0;
  const unsubAgent = sim.onAgent((evt: any) => {
    try {
      if (evt?.type === "agent:action" && evt.action) {
        const action = String(evt.action);
        recordAgentActionMetric(action);
        const actor = String(evt.agentName || evt.agentId);
        const content = typeof evt.content === "string" && evt.content.trim().length > 0
          ? evt.content : `${actor} performs ${action}`;
        recordActionEvent(actor, action, content, evt.target ? String(evt.target) : undefined);

        // Feed the Watcher's behavioral analysis
        if (typeof evt.agentId === "number") {
          recordAgentAction(evt.agentId, action);
        }

        // Feed the consistency spirit's event buffer
        recordEvent(action, {
          agent: actor,
          target: evt.target ? String(evt.target) : undefined,
          content: typeof evt.content === "string" ? evt.content : undefined,
        }, actor);
      }
    } catch {}
  });
  const unsubWorld = sim.onWorld((evt: any) => {
    if (evt?.type === "world:state" && typeof evt.tick === "number") {
      currentTick = evt.tick;
    }
  });

  // ==========================================================================
  // MAIN LOOP
  // ==========================================================================

  const startTime = Date.now();
  const endTime = startTime + config.durationSec * 1000;
  const snapshots: EvolutionSnapshot[] = [];

  let lastEval = 0;
  let lastWatcher = 0;
  let lastArchitect = 0;
  let lastCrafter = 0;
  let lastArtificer = 0;
  let lastLawgiver = 0;
  let lastSteward = 0;
  let cycleCount = 0;

  console.log("--- Running simulation ---\n");

  while (Date.now() < endTime) {
    const now = Date.now();
    const elapsed = (now - startTime) / 1000;

    // Spirit tick (runs all spirits including The Watcher via the system)
    try {
      await tickSpiritSystem(sim.world, {} as any);
    } catch (e: any) {
      emitEvent("spirit_tick_error", { error: e.message });
    }

    // === WATCHER SYNTHESIS ===
    if (now - lastWatcher >= config.watcherIntervalMs) {
      lastWatcher = now;
      try {
        const watcherEid = spiritSystem.registry.byName.get("The Watcher");
        if (watcherEid !== undefined) {
          const result = runObservationSynthesis(sim.world, spiritSystem.registry, watcherEid);
          watcherSyntheses++;
          proposalsSent += result.proposalsSent;
          emitEvent("watcher_synthesis", { proposalsSent: result.proposalsSent, summary: result.summary });
          console.log(`  [${elapsed.toFixed(0)}s] Watcher: ${result.proposalsSent} proposals sent`);
        }
      } catch (e: any) {
        emitEvent("watcher_error", { error: e.message });
      }
    }

    // === ARCHITECT COGNITION ===
    if (hasAPI && now - lastArchitect >= config.architectIntervalMs) {
      lastArchitect = now;
      if (architectState) {
        try {
          const beforeSystems = sim.god.systemRegistry.systems.size;
          const beforeExecCount = getFactoryState().executionLog.length;
          const beforeProposalCount = getFactoryState().pendingProposals.filter(p => p.status === "executed").length;

          const proposals = await runArchitectCognition(
            sim.world,
            sim.god.systemRegistry,
            spiritSystem.registry,
            architectState
          );
          architectProposals += proposals.length;

          // runArchitectCognition already executes auto-approved proposals internally,
          // so track execution by comparing factory state before/after
          const afterSystems = sim.god.systemRegistry.systems.size;
          const afterExecCount = getFactoryState().executionLog.length;
          const afterProposalCount = getFactoryState().pendingProposals.filter(p => p.status === "executed").length;
          const newExecutions = afterProposalCount - beforeProposalCount;
          const newSystems = afterSystems - beforeSystems;

          totalBaked += newSystems;
          bakedThisCycle = newSystems;
          proposalsExecuted += newExecutions;

          emitEvent("architect_cognition", {
            proposals: proposals.length,
            names: proposals.map(p => p.name),
            executed: newExecutions,
            newSystems,
          });
          console.log(`  [${elapsed.toFixed(0)}s] Architect: ${proposals.length} proposals, ${newExecutions} executed, ${newSystems} new systems`);
        } catch (e: any) {
          emitEvent("architect_error", { error: e.message });
          console.log(`  [${elapsed.toFixed(0)}s] Architect error: ${e.message?.slice(0, 80)}`);
        }
      }
    }

    // === WORLD CRAFTER ===
    if (hasAPI && now - lastCrafter >= config.crafterIntervalMs) {
      lastCrafter = now;
      try {
        await runWorldCrafterCycle(sim.world, sim.god.systemRegistry, spiritSystem.registry);
      } catch (e: any) {
        emitEvent("crafter_error", { error: e.message });
      }
    }

    // === ARTIFICER (system repair) ===
    if (now - lastArtificer >= config.artificerIntervalMs) {
      lastArtificer = now;
      try {
        await runArtificerWithTools(sim.world, sim.god.systemRegistry, spiritSystem.registry);
      } catch (e: any) {
        emitEvent("artificer_error", { error: e.message });
      }
    }

    // === LAWGIVER ===
    if (hasAPI && now - lastLawgiver >= config.lawgiverIntervalMs) {
      lastLawgiver = now;
      try {
        await runLawgiverCycle(sim.world, sim.god.systemRegistry, spiritSystem.registry);
      } catch (e: any) {
        emitEvent("lawgiver_error", { error: e.message });
      }
    }

    // === STEWARD (room population) ===
    if (hasAPI && now - lastSteward >= config.stewardIntervalMs) {
      lastSteward = now;
      try {
        await runStewardCycle(sim.world, sim.god.systemRegistry, spiritSystem.registry);
      } catch (e: any) {
        emitEvent("steward_error", { error: e.message });
      }
    }

    // === EVALUATION SNAPSHOT ===
    if (now - lastEval >= config.evalIntervalMs) {
      lastEval = now;
      bakedThisCycle = 0;

      const issues = getAndClearAccumulatedIssues();
      consistencyIssues += issues.length;

      const obsStats = computeObservationStats();
      const sysStats = computeSystemStats(sim.god.systemRegistry);
      const activeAgents = agentEids.filter(eid => Agent.active[eid]).length;

      const partialSnapshot: Partial<EvolutionSnapshot> = {
        observations: obsStats,
        agents: {
          total: agentEids.length,
          active: activeAgents,
          actionCounts: { ...agentActionCounts },
          uniqueActionTypes: Object.keys(agentActionCounts).length,
          diversityScore: computeDiversityScore(agentActionCounts),
        },
        systems: sysStats,
        spirits: {
          watcherSyntheses,
          proposalsSent,
          architectProposals,
          proposalsExecuted,
          crafterMaterializations,
          consistencyIssues,
        },
      };

      const quality = computeQualityScore(partialSnapshot);
      const snapshot: EvolutionSnapshot = {
        ts: now,
        elapsedSec: Math.round(elapsed),
        tick: currentTick,
        observations: obsStats,
        agents: partialSnapshot.agents!,
        systems: sysStats,
        spirits: partialSnapshot.spirits!,
        quality,
      };

      snapshots.push(snapshot);
      scoresStream.write(JSON.stringify(snapshot) + "\n");

      // Print progress
      const totalActions = Object.values(agentActionCounts).reduce((a, b) => a + b, 0);
      console.log(`\n  [EVAL ${elapsed.toFixed(0)}s] Score: ${quality.score}/100 | Systems: ${sysStats.total} (${sysStats.active} active, ${totalBaked} baked) | Actions: ${totalActions} | Observations: ${obsStats.totalAggregated}`);
      if (quality.recommendations.length > 0) {
        console.log(`    Recommendations: ${quality.recommendations[0]}`);
      }
    }

    cycleCount++;
    await sleep(2000); // Main loop cadence: 2s
  }

  // ==========================================================================
  // FINAL REPORT
  // ==========================================================================

  stopSpiritSystem();
  sim.stop();
  unsubAgent();
  unsubWorld();

  console.log(`\n${"=".repeat(70)}`);
  console.log("=== SELF-EVOLUTION STRESS TEST REPORT ===");
  console.log(`${"=".repeat(70)}\n`);

  const finalElapsed = (Date.now() - startTime) / 1000;
  const finalSystems = sim.god.systemRegistry.systems.size;
  const totalActions = Object.values(agentActionCounts).reduce((a, b) => a + b, 0);
  const finalDiversity = computeDiversityScore(agentActionCounts);

  console.log(`Duration: ${finalElapsed.toFixed(0)}s | Cycles: ${cycleCount}`);
  console.log(`Mode: ${mode}`);
  console.log();

  // System evolution
  console.log("--- System Evolution ---");
  console.log(`  Baseline systems: ${baselineSystems}`);
  console.log(`  Final systems: ${finalSystems} (${finalSystems - baselineSystems} new)`);
  console.log(`  Systems baked: ${totalBaked}`);
  console.log(`  System errors: ${Array.from(sim.god.systemRegistry.errorCounts.values()).reduce((a, b) => a + b, 0)}`);

  // List all systems with status + save generated code to run directory
  console.log("\n  System Registry:");
  for (const [name, sys] of sim.god.systemRegistry.systems) {
    const errors = sim.god.systemRegistry.errorCounts.get(name) || 0;
    const status = sys.active ? "ACTIVE" : errors >= 3 ? "DISABLED(errors)" : "inactive";
    const baked = sys.code ? " [baked]" : "";
    console.log(`    ${status}: ${name}${baked} (freq: ${sys.frequency}ms, errors: ${errors})`);

    // Save generated system code to run directory for inspection
    if (sys.code) {
      const systemFile = path.join(dir, "systems", `${name}.js`);
      const pseudocodeComment = (sys.pseudocode || "").split("\n").map((l: string) => `// ${l}`).join("\n");
      fs.writeFileSync(systemFile, `// ${name}\n// ${sys.description || ""}\n// Frequency: ${sys.frequency}ms\n// Design:\n${pseudocodeComment}\n\n${sys.code}`);
    }
  }

  // Observation aggregator
  console.log("\n--- Observation Aggregator ---");
  console.log(`  ${getObservationSummary()}`);

  // Watcher
  console.log("\n--- Watcher Status ---");
  console.log(`  Synthesis cycles: ${watcherSyntheses}`);
  console.log(`  Proposals sent to Architect: ${proposalsSent}`);
  console.log(`  ${getWatcherStatus()}`);

  // Spirit activity
  console.log("\n--- Spirit Activity ---");
  console.log(`  Architect proposals: ${architectProposals}`);
  console.log(`  Proposals executed: ${proposalsExecuted}`);
  console.log(`  Consistency issues: ${consistencyIssues}`);

  // Agent behavior
  console.log("\n--- Agent Behavior ---");
  console.log(`  Total actions: ${totalActions}`);
  console.log(`  Action mix:`);
  const sortedActions = Object.entries(agentActionCounts).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedActions) {
    const pct = ((count / totalActions) * 100).toFixed(1);
    console.log(`    ${type}: ${count} (${pct}%)`);
  }
  console.log(`  Diversity score: ${finalDiversity.toFixed(2)} (0=uniform, 1=even mix)`);

  // Score progression
  console.log("\n--- Score Progression ---");
  for (const snap of snapshots) {
    console.log(`  [${snap.elapsedSec}s] Score: ${snap.quality.score} | Systems: ${snap.systems.total} | Baked: ${snap.systems.bakedTotal} | Observations: ${snap.observations.totalAggregated}`);
  }

  // Final quality
  const lastSnapshot = snapshots[snapshots.length - 1];
  const finalScore = lastSnapshot?.quality.score || 0;
  console.log(`\n--- Final Score: ${finalScore}/100 ---`);
  if (lastSnapshot?.quality.recommendations.length) {
    console.log("  Recommendations:");
    for (const rec of lastSnapshot.quality.recommendations) {
      console.log(`    - ${rec}`);
    }
  }

  // Checks
  console.log("\n--- Checks ---");
  const checks = [
    { name: "Agents active", pass: agentEids.some(eid => Agent.active[eid]) },
    { name: "Actions diverse (>3 types)", pass: Object.keys(agentActionCounts).length > 3 },
    { name: "Observations reported", pass: getRecentObservations(100).length > 0 },
    { name: "Watcher synthesized", pass: watcherSyntheses > 0 },
    { name: "Proposals sent to Architect", pass: proposalsSent > 0 },
    { name: "Architect designed proposals", pass: architectProposals > 0 || !hasAPI },
    { name: "Proposals executed (evolution)", pass: proposalsExecuted > 0 || !hasAPI },
    { name: "No critical system failures", pass: !Array.from(sim.god.systemRegistry.systems.values()).some(s => (sim.god.systemRegistry.errorCounts.get(s.name) || 0) > 10) },
    { name: "Score >= 40", pass: finalScore >= 40 },
  ];

  let passed = 0;
  for (const check of checks) {
    const icon = check.pass ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${check.name}`);
    if (check.pass) passed++;
  }
  console.log(`\n  Result: ${passed}/${checks.length} checks passed`);

  // Write summary
  const summary = {
    mode,
    durationSec: Math.round(finalElapsed),
    cycles: cycleCount,
    baselineSystems,
    finalSystems,
    systemsBaked: totalBaked,
    totalActions,
    diversityScore: finalDiversity,
    watcherSyntheses,
    proposalsSent,
    architectProposals,
    proposalsExecuted,
    consistencyIssues,
    finalScore,
    checksPassed: passed,
    checksTotal: checks.length,
    snapshots: snapshots.length,
  };
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));

  eventsStream.end();
  scoresStream.end();

  console.log(`\nOutput: ${dir}`);
  process.exit(passed >= checks.length - 2 ? 0 : 1);
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
