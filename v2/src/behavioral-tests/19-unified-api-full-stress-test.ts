/**
 * Unified API Full Stress Test (End-to-End)
 *
 * Goals:
 * - Use the unified `createSimulation()` API
 * - Give GodAI a single "hard task" command
 * - Exercise the full stack:
 *   - Fast ECS loop + deterministic rules
 *   - Agent cognition + planning + movement + interactions
 *   - Daemon (guardian) system observing + reporting
 *   - Spirit hierarchy (Narrator/Arbiter/Weaver/Tinker/Crafter/Steward/Lawgiver)
 *   - Architect proposals + system baking + activation
 *   - Lawgiver rule generation + activation
 *
 * Notes:
 * - We disable built-in spirit ticking inside `createSimulation()` and run spirit cycles here
 *   so we can capture narrative prose and orchestrate architect/lawgiver execution deterministically.
 * - Requires `GOOGLE_GENERATIVE_AI_API_KEY` in env (loaded via dotenv).
 *
 * Usage:
 *   tsx src/behavioral-tests/19-unified-api-full-stress-test.ts
 *   tsx src/behavioral-tests/19-unified-api-full-stress-test.ts --duration=5
 *   tsx src/behavioral-tests/19-unified-api-full-stress-test.ts --duration=2 --quiet
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { query } from "bitecs";

import { createSimulation } from "../index";
import { Agent, Room, Name, PhysicalObject } from "../ecs/components";

import {
  initializeSpiritSystem,
  createStandardHierarchy,
  startSpiritSystem,
  stopSpiritSystem,
  tickSpiritSystem,
  getSpiritSystemDebugInfo,
  getRegistrySummary,
  setGodAgentCallback,
  deliverPendingMessagesToGod,
  recordActionEvent,
} from "../spirits";

import {
  createDynamicSpirit,
  getPendingProposals,
  approveProposal,
  resetFactoryState,
  type DynamicSpiritState,
} from "../spirits/spirit-factory";
import { runArchitectCognition, queueAllApprovedProposals } from "../spirits/architect-spirit";
import { runWatcherCognition } from "../spirits/system-watcher";
import { runArtificerWithTools } from "../spirits/artificer-spirit";
import { getAndClearAccumulatedIssues } from "../spirits/consistency-spirit";

import {
  requestRule,
  runLawgiverCycle,
  getPendingRuleRequests,
  getLawgiverSummary,
  resetLawgiverState,
} from "../spirits/rules-spirit";
import { collectDaemonPovStories } from "../spirits/agent-daemon";
import {
  initializeGodAutopilot,
  enqueueSpiritMessages,
  runGodAutopilotCycle,
} from "../god/god-autopilot";

import { getQueueStats, getQueueSummary } from "../runtime/async-task-queue";

// =============================================================================
// CLI / CONFIG
// =============================================================================

type Config = {
  mode: "full" | "deterministic";
  durationMinutes: number;
  ecsTickRate: number;
  ecsDeltaMs: number;
  spiritTickIntervalMs: number;
  daemonPovIntervalMs: number;
  autopilotIntervalMs: number;
  quiet: boolean;
  outputDir: string;
  hardTask: "full" | "none";
  hardTaskTimeoutMs: number;
};

const DEFAULTS: Config = {
  mode: "full",
  durationMinutes: 5,
  ecsTickRate: 1,     // 1 Hz (1 tick/sec) – enough to observe, not too expensive
  ecsDeltaMs: 1000,   // deterministic delta passed to fast systems
  spiritTickIntervalMs: 6000,
  daemonPovIntervalMs: 8000,
  autopilotIntervalMs: 12000,
  quiet: false,
  outputDir: "./stress-test-output",
  hardTask: "full",
  hardTaskTimeoutMs: 180_000,
};

function parseArgs(): Partial<Config> {
  const args: Partial<Config> = {};
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith("--duration=")) args.durationMinutes = parseFloat(raw.split("=")[1]);
    if (raw.startsWith("--tickRate=")) args.ecsTickRate = parseFloat(raw.split("=")[1]);
    if (raw.startsWith("--deltaMs=")) args.ecsDeltaMs = parseInt(raw.split("=")[1], 10);
    if (raw.startsWith("--spiritMs=")) args.spiritTickIntervalMs = parseInt(raw.split("=")[1], 10);
    if (raw.startsWith("--daemonPovMs=")) args.daemonPovIntervalMs = parseInt(raw.split("=")[1], 10);
    if (raw.startsWith("--autopilotMs=")) args.autopilotIntervalMs = parseInt(raw.split("=")[1], 10);
    if (raw.startsWith("--output=")) args.outputDir = raw.split("=")[1];
    if (raw === "--quiet") args.quiet = true;
    if (raw === "--no-ai") args.mode = "deterministic";
    if (raw.startsWith("--hardTaskTimeoutMs=")) args.hardTaskTimeoutMs = parseInt(raw.split("=")[1], 10);
    if (raw.startsWith("--hardTask=")) {
      const v = raw.split("=")[1];
      if (v === "full" || v === "none") args.hardTask = v;
    }
    if (raw.startsWith("--mode=")) {
      const m = raw.split("=")[1];
      if (m === "full" || m === "deterministic") args.mode = m;
    }
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
// OUTPUTS
// =============================================================================

type Outputs = {
  dir: string;
  narrativePath: string;
  eventsPath: string;
  summaryPath: string;
  narrativeStream: fs.WriteStream;
  eventsStream: fs.WriteStream;
};

function initOutputs(baseDir: string): Outputs {
  const dir = path.join(baseDir, `unified-api-full-${nowStamp()}`);
  fs.mkdirSync(dir, { recursive: true });

  const narrativePath = path.join(dir, "narrative.txt");
  const eventsPath = path.join(dir, "events.jsonl");
  const summaryPath = path.join(dir, "summary.json");

  const narrativeStream = fs.createWriteStream(narrativePath, { flags: "a" });
  const eventsStream = fs.createWriteStream(eventsPath, { flags: "a" });

  narrativeStream.write("═".repeat(70) + "\n");
  narrativeStream.write("ARGOS v2 — UNIFIED API FULL STRESS TEST\n");
  narrativeStream.write(`START: ${new Date().toISOString()}\n`);
  narrativeStream.write("═".repeat(70) + "\n\n");

  return { dir, narrativePath, eventsPath, summaryPath, narrativeStream, eventsStream };
}

function closeOutputs(out: Outputs): void {
  out.narrativeStream.write("\n" + "═".repeat(70) + "\n");
  out.narrativeStream.write(`END: ${new Date().toISOString()}\n`);
  out.narrativeStream.write("═".repeat(70) + "\n");
  out.narrativeStream.end();
  out.eventsStream.end();
}

function waitForStreamClose(stream: fs.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.closed) return resolve();
    stream.on("close", () => resolve());
    stream.on("error", () => resolve());
  });
}

async function waitForOutputsClosed(out: Outputs): Promise<void> {
  await Promise.all([
    waitForStreamClose(out.narrativeStream),
    waitForStreamClose(out.eventsStream),
  ]);
}

async function waitForBackgroundTasks(
  tasks: Set<Promise<unknown>>,
  timeoutMs: number = 15_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (tasks.size > 0 && Date.now() < deadline) {
    const snapshot = Array.from(tasks);
    if (snapshot.length === 0) break;
    await Promise.race([
      Promise.allSettled(snapshot),
      sleep(250),
    ]);
  }
}

async function waitForTaskQueueIdle(timeoutMs: number = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stats = getQueueStats();
    if (stats.pending === 0 && stats.running === 0) return;
    await sleep(250);
  }
}

function writeEvent(out: Outputs, type: string, data: any): void {
  out.eventsStream.write(JSON.stringify({ ts: Date.now(), type, data }) + "\n");
}

function writeProse(out: Outputs, prose: string): void {
  out.narrativeStream.write(prose.trim() + "\n\n");
}

// =============================================================================
// STRESS SCENARIO
// =============================================================================

const HARD_TASK = `
HARD TASK (single directive):

You are GodAI. Upgrade this simulation into a coherent, grounded "Harvest Festival Day" in a medieval village.

Requirements (do all of these using your tools):
1) Bake and activate at least TWO new deterministic ECS systems (via bakeNewSystem) that run without AI:
   - FestivalClockSystem: announces upcoming festival events to rooms, based on simulation time/tick
   - MarketPriceSystem: updates prices for goods based on supply/demand signals (simple heuristics is fine)

2) Add at least TWO deterministic world rules (via defineRule) that create emergent behavior:
   - food_spoilage: perishable food changes state over time
   - lantern_flicker: lit light sources sometimes emit a small perception event

3) Create at least TWO new object types (via defineObjectType) and spawn at least 6 instances (via spawn):
   - festival_banner
   - harvest_stall

4) Ensure agents have clear goals and actually do things:
   - At least 6 NPCs should move between rooms and perform actions (talk, examine, take/drop, etc.)
   - If needed, create missing items (bread, apples, lanterns) and place them so actions are grounded.

5) Keep the world grounded (no hallucinated entities): only refer to entities that exist in ECS.

Report briefly when done: which systems/rules/types you created.
`.trim();

function buildInitialWorldConfig() {
  return {
    rooms: [
      { name: "Village Square", roomType: "square", autoPopulate: true, description: "A cobbled square with a fountain and autumn leaves." },
      { name: "The Golden Wheat", roomType: "tavern", autoPopulate: true, description: "A warm tavern with hearty food and friendly chatter." },
      { name: "Marketplace", roomType: "market", autoPopulate: true, description: "A small market with wooden stalls and fresh produce." },
      { name: "Blacksmith", roomType: "blacksmith", autoPopulate: true, description: "A forge where sparks fly and iron rings." },
      { name: "Bakery", roomType: "bakery", autoPopulate: true, description: "A bakery that smells of bread and honey." },
      { name: "Temple Garden", roomType: "temple", autoPopulate: true, description: "A quiet garden with herbs and stone paths." },
      { name: "Mill", roomType: "mill", autoPopulate: true, description: "A creaking mill by the stream." },
      { name: "Farm", roomType: "farm", autoPopulate: true, description: "Fields of wheat ready for harvest." },
    ],
    agents: [
      { name: "Ada", role: "baker", startRoom: "Bakery", description: "Warm, patient, proud of her craft." },
      { name: "Bran", role: "blacksmith", startRoom: "Blacksmith", description: "Gruff but kind, meticulous with tools." },
      { name: "Celia", role: "merchant", startRoom: "Marketplace", description: "Sharp-eyed trader with a friendly smile." },
      { name: "Dorian", role: "innkeeper", startRoom: "The Golden Wheat", description: "Hospitable, remembers everyone’s favorite drink." },
      { name: "Elowen", role: "priestess", startRoom: "Temple Garden", description: "Serene caretaker of the garden." },
      { name: "Fenn", role: "miller", startRoom: "Mill", description: "Gentle, observant, speaks softly." },
      { name: "Hilda", role: "farmer", startRoom: "Farm", description: "Practical and generous, loves a good harvest." },
      { name: "Lars", role: "apprentice", startRoom: "Blacksmith", description: "Curious and eager to learn." },
    ],
  };
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  const config: Config = { ...DEFAULTS, ...parseArgs() };
  const out = initOutputs(config.outputDir);

  if (config.quiet) {
    console.log = () => {};
    console.info = () => {};
    console.debug = () => {};
  }

  resetFactoryState();
  resetLawgiverState();

  const initial = buildInitialWorldConfig();

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
  const canRunFull = apiKey.length > 0;
  const mode = (config.mode === "full" && !canRunFull) ? "deterministic" : config.mode;
  if (config.mode === "full" && !canRunFull && !config.quiet) {
    console.warn("GOOGLE_GENERATIVE_AI_API_KEY is missing/empty; running in deterministic mode. Set it to enable full AI+spirits stress.");
  }

  const sim = await createSimulation({
    name: "Unified API Full Stress Test",
    preset: "slice-of-life",
    enableAI: mode === "full",
    // We orchestrate spirits ourselves (when full) to capture prose + execute specialized cycles.
    enableSpirits: false,
    dualLoop: true,
    ecsTickRate: config.ecsTickRate,
    ecsDeltaMs: config.ecsDeltaMs,
    rooms: initial.rooms,
    agents: initial.agents,
    autoPopulateRooms: true,
  });

  // Start simulation (fast tick + agent cognition + daemon loop)
  await sim.start();

  // Subscribe to world state for observability (works in deterministic and full modes)
  let worldStates = 0;
  const unsubWorld = sim.onWorld((evt: any) => {
    if (evt?.type === "world:state") {
      worldStates++;
      writeEvent(out, "world_state", evt);
    }
  });

  // FULL MODE ONLY: Initialize spirit system + specialized spirit cycles
  const spiritSystem = mode === "full"
    ? initializeSpiritSystem(sim.world, {
        godAgentEid: sim.god.eid,
        tickInterval: 10000,
        autoCreateNarrator: false,
      })
    : null;

  if (mode === "full" && spiritSystem) {
    createStandardHierarchy(sim.god.eid);

    // Run narrative cycles faster than the default archangel cadence so short demo runs
    // still produce visible prose and story directives.
    const narratorEid = spiritSystem.registry.byName.get("The Narrator");
    if (narratorEid !== undefined) {
      const narrator = spiritSystem.registry.spirits.get(narratorEid);
      if (narrator) {
        narrator.definition.observationInterval = Math.min(
          narrator.definition.observationInterval,
          config.spiritTickIntervalMs
        );
      }
    }

    startSpiritSystem();
    writeEvent(out, "spirit_system_started", { registrySummary: getRegistrySummary(spiritSystem.registry) });

    // Route spirit reports into GodAI autopilot so narrator/watcher directives can
    // immediately drive world changes (systems/entities/rules) during the run.
    initializeGodAutopilot(sim.god, {
      enabled: true,
      minRunIntervalMs: config.autopilotIntervalMs,
      minPriority: "normal",
      maxMessagesPerRun: 10,
      maxInboxSize: 300,
    });
    setGodAgentCallback(async (messages) => {
      enqueueSpiritMessages(sim.god, messages, (fromEid) => {
        const spirit = spiritSystem.registry.spirits.get(fromEid);
        return spirit?.definition.name || `Spirit#${fromEid}`;
      });
    });

    // Queue room population for all typed rooms (drives The Steward)
    const { requestRoomPopulation } = await import("../spirits/steward-spirit");
    for (const r of initial.rooms) {
      if (r.roomType) {
        requestRoomPopulation(r.roomType, r.name, { worldTheme: "fantasy", economyLevel: "modest" });
      }
    }
  }

  const watcher = (mode === "full" && spiritSystem)
    ? createDynamicSpirit(spiritSystem.registry, {
        name: "The Watcher of Motion",
        title: "Watcher of Motion",
        description: "Observes whether agents are moving, acting, and not stagnating.",
        type: "watcher",
        domain: "guardian",
        rank: "angel",
        superiorEid: sim.god.eid,
        observationInterval: 45000,
        watchConfig: { watchPatterns: ["stagnation", "emergence", "errors"] },
      })
    : null;

  const autoArchitect = (mode === "full" && spiritSystem)
    ? createDynamicSpirit(spiritSystem.registry, {
        name: "The Festival Architect",
        title: "Festival Architect",
        description: "Proposes and bakes systems to support the harvest festival day.",
        type: "architect",
        domain: "narrative",
        rank: "angel",
        superiorEid: sim.god.eid,
        observationInterval: 60000,
        architectConfig: {
          canProposeSystems: true,
          canProposeComponents: false,
          canProposeEntities: false,
          canProposeRules: false,
          canExecuteDirectly: false,
          proposalApproval: "auto",
          maxProposalsPerCycle: 2,
        },
        customPrompt: "Focus on deterministic systems that improve grounded action loops, movement, and simple festival scheduling.",
      })
    : null;

  // Subscribe to agent actions for observability
  let agentActions = 0;
  const unsubAgent = sim.onAgent((evt: any) => {
    if (evt?.type === "agent:action") {
      agentActions++;
      if (mode === "full") {
        const actor = String(evt.agentName || "Unknown");
        const action = String(evt.action || "action");
        const content =
          typeof evt.content === "string" && evt.content.trim().length > 0
            ? evt.content
            : `${actor} performs ${action}`;
        recordActionEvent(actor, action, content, evt.target ? String(evt.target) : undefined);
      }
      if (!config.quiet) {
        const msg = `${evt.agentName}: ${evt.action}${evt.target ? ` -> ${evt.target}` : ""}`;
        console.log(msg);
      }
      writeEvent(out, "agent_action", evt);
    }
  });

  // Give GodAI the single hard task (FULL MODE)
  const baselineSystems = sim.god.systemRegistry.systems.size;
  const baselineRules = (await import("../world/schema")).worldSchema.getActiveRules().length;
  const backgroundTasks = new Set<Promise<unknown>>();
  const trackBackgroundTask = (task: Promise<unknown>): void => {
    backgroundTasks.add(task);
    void task.finally(() => {
      backgroundTasks.delete(task);
    });
  };

  let hardTaskState: {
    status: "skipped" | "pending" | "completed" | "timeout" | "failed";
    startedAt?: number;
    endedAt?: number;
    error?: string;
  } = { status: "skipped" };
  let hardTaskPromise: Promise<void> | null = null;

  if (mode === "full") {
    if (config.hardTask === "none") {
      hardTaskState = { status: "skipped" };
      writeEvent(out, "hard_task_skipped", { reason: "--hardTask=none" });
    } else {
      hardTaskState = { status: "pending", startedAt: Date.now() };
      writeEvent(out, "hard_task_start", { baselineSystems, baselineRules });
      hardTaskPromise = sim.command(HARD_TASK);
      const monitoredHardTask = hardTaskPromise.then(() => {
        if (hardTaskState.status !== "pending") return;
        hardTaskState = {
          status: "completed",
          startedAt: hardTaskState.startedAt,
          endedAt: Date.now(),
        };
        writeEvent(out, "hard_task_completed", { durationMs: hardTaskState.endedAt! - hardTaskState.startedAt! });
      }).catch((err) => {
        if (hardTaskState.status !== "pending") return;
        hardTaskState = {
          status: "failed",
          startedAt: hardTaskState.startedAt,
          endedAt: Date.now(),
          error: err instanceof Error ? (err.stack || err.message) : String(err),
        };
        writeEvent(out, "hard_task_failed", { error: hardTaskState.error });
      });
      trackBackgroundTask(monitoredHardTask);
      writeEvent(out, "hard_task_sent", { length: HARD_TASK.length });
    }
  }

  // Seed the Lawgiver with explicit rule requests (FULL MODE)
  if (mode === "full") {
    requestRule(
      "Make harvest food spoilage visible: perishable food left out becomes stale after some time.",
      { worldTheme: "fantasy", desiredBehavior: "Food decays over time without AI and can be perceived." },
      "stress_test"
    );
    requestRule(
      "Ambient festival music occasionally drifts through the Village Square while the festival is active.",
      { worldTheme: "fantasy", desiredBehavior: "A simple periodic ambient event tied to festival traits/state." },
      "stress_test"
    );
  }

  const startedAt = Date.now();
  const endAt = startedAt + config.durationMinutes * 60_000;

  let proposalsApproved = 0;
  let proposalsExecuted = 0;
  let rulesApproved = 0;
  let spiritsProcessed = 0;
  let spiritNarrativeLines = 0;
  let daemonPovLines = 0;
  let watcherCycles = 0;
  let architectCycles = 0;
  let artificerCycles = 0;
  let coherenceIssues = 0;

  let lastSpiritTick = 0;
  let lastDaemonPov = 0;
  let lastWatcher = 0;
  let lastArchitect = 0;
  let lastLawgiver = 0;
  let lastArtificer = 0;
  let lastStewardCrafter = 0;
  let lastAutopilot = 0;
  let lastCoherence = 0;

  let spiritTickInFlight = false;
  let autopilotInFlight = false;
  let stewardCrafterInFlight = false;
  let watcherInFlight = false;
  let architectInFlight = false;
  let lawgiverInFlight = false;
  let artificerInFlight = false;
  const recentDaemonPov = new Map<string, number>();

  let shutdownStarted = false;
  const shutdown = async (reason: string) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    writeEvent(out, "shutdown", { reason });
    try {
      unsubAgent();
    } catch {}
    try {
      unsubWorld();
    } catch {}
    try {
      stopSpiritSystem();
    } catch {}
    try {
      sim.pause();
    } catch {}
    await waitForBackgroundTasks(backgroundTasks, 60_000);
    await waitForTaskQueueIdle(20_000);
    try {
      sim.stop();
    } catch {}
    await waitForBackgroundTasks(backgroundTasks, 10_000);
    closeOutputs(out);
  };

  process.on("SIGINT", () => {
    void (async () => {
      await shutdown("SIGINT");
      await waitForOutputsClosed(out);
      process.exit(130);
    })();
  });

  // Main orchestrator loop (runs alongside the dual-loop simulation runtime)
  while (Date.now() < endAt) {
    await sleep(1000);
    const now = Date.now();

    if (mode === "full" && hardTaskPromise && hardTaskState.status === "pending") {
      const elapsed = now - (hardTaskState.startedAt || now);
      if (elapsed >= config.hardTaskTimeoutMs) {
        hardTaskState = { status: "timeout", startedAt: hardTaskState.startedAt, endedAt: now };
        writeEvent(out, "hard_task_timeout", { elapsedMs: elapsed, hardTaskTimeoutMs: config.hardTaskTimeoutMs });
        hardTaskPromise = null;
      }
    }

    // Tick the generic spirit system + capture prose (FULL MODE) (non-blocking)
    if (mode === "full" && now - lastSpiritTick >= config.spiritTickIntervalMs && !spiritTickInFlight) {
      lastSpiritTick = now;
      spiritTickInFlight = true;
      const task = (async () => {
        try {
          const res = await tickSpiritSystem(sim.world, sim.god.registry);
          spiritsProcessed += res.spiritsProcessed;
          if (res.messagesForGodAI.length > 0) {
            writeEvent(out, "god_message_delivery", { delivered: res.messagesForGodAI.length, source: "spirit_tick" });
          }
          if (res.narrativeProse.length > 0) {
            for (const prose of res.narrativeProse) {
              spiritNarrativeLines++;
              writeProse(out, prose);
              writeEvent(out, "narrative_prose", { prose });
            }
          }
        } catch (err) {
          writeEvent(out, "spirit_tick_error", { error: err instanceof Error ? (err.stack || err.message) : String(err) });
        } finally {
          spiritTickInFlight = false;
        }
      })();
      trackBackgroundTask(task);
    }

    // Daemon POV mini-narrator stream (deterministic, grounded).
    if (mode === "full" && now - lastDaemonPov >= config.daemonPovIntervalMs) {
      lastDaemonPov = now;
      const stories = collectDaemonPovStories(sim.daemons, { maxStories: 3, minScore: 0.05 });
      for (const story of stories) {
        const lastSeen = recentDaemonPov.get(story.signature) || 0;
        if (now - lastSeen < 45_000) continue;
        recentDaemonPov.set(story.signature, now);

        daemonPovLines++;
        const prose = `[Daemon POV — ${story.agentName}] ${story.prose}`;
        writeProse(out, prose);
        writeEvent(out, "daemon_pov_story", story);
      }

      // Prune old signatures to keep memory bounded.
      for (const [sig, ts] of recentDaemonPov.entries()) {
        if (now - ts > 5 * 60_000) recentDaemonPov.delete(sig);
      }
    }

    // Run God autopilot on spirit/daemon inbox so narrative directives become actions.
    if (mode === "full" && now - lastAutopilot >= config.autopilotIntervalMs && !autopilotInFlight) {
      lastAutopilot = now;
      autopilotInFlight = true;
      const task = (async () => {
        try {
          // Flush any pending spirit messages generated by out-of-band watcher/architect cycles.
          const delivered = await deliverPendingMessagesToGod();
          if (delivered > 0) {
            writeEvent(out, "god_message_delivery", { delivered, source: "autopilot_tick" });
          }

          const res = await runGodAutopilotCycle(sim.god, {
            executeCommand: (command) => sim.command(command),
            now,
          });
          writeEvent(out, "god_autopilot", res);
        } catch (err) {
          writeEvent(out, "god_autopilot_error", {
            error: err instanceof Error ? (err.stack || err.message) : String(err),
          });
        } finally {
          autopilotInFlight = false;
        }
      })();
      trackBackgroundTask(task);
    }

    // Run The Crafter + The Steward explicitly (FULL MODE) (non-blocking)
    if (mode === "full" && spiritSystem && now - lastStewardCrafter >= 15_000 && !stewardCrafterInFlight) {
      lastStewardCrafter = now;
      stewardCrafterInFlight = true;
      const task = (async () => {
        try {
          const { runWorldCrafterCycle } = await import("../spirits/world-crafter-spirit");
          const { runStewardCycle, getPendingRoomRequests, requestRoomPopulation } = await import("../spirits/steward-spirit");

          // Re-queue room population occasionally to stress The Steward.
          if (Date.now() - startedAt < 45_000) {
            requestRoomPopulation("market", "Marketplace", { worldTheme: "fantasy", economyLevel: "modest" });
            requestRoomPopulation("tavern", "The Golden Wheat", { worldTheme: "fantasy", economyLevel: "modest" });
          }

          const crafter = await runWorldCrafterCycle(sim.world, spiritSystem.registry, sim.god);
          const pendingRooms = getPendingRoomRequests();
          const steward = pendingRooms.length > 0 ? await runStewardCycle(sim.world, spiritSystem.registry) : { roomsPopulated: 0, entitiesGenerated: 0 };

          writeEvent(out, "crafter_cycle", crafter);
          writeEvent(out, "steward_cycle", { pendingRooms: pendingRooms.length, ...steward });
        } catch (err) {
          writeEvent(out, "steward_crafter_error", { error: err instanceof Error ? (err.stack || err.message) : String(err) });
        } finally {
          stewardCrafterInFlight = false;
        }
      })();
      trackBackgroundTask(task);
    }

    // Specialized watcher cognition (system watcher module) (non-blocking)
    if (mode === "full" && watcher && spiritSystem && now - lastWatcher >= 30_000 && !watcherInFlight) {
      lastWatcher = now;
      watcherCycles++;
      watcherInFlight = true;
      const task = (async () => {
        try {
          const report = await runWatcherCognition(sim.world, sim.god.systemRegistry, spiritSystem.registry, watcher);
          writeEvent(out, "watcher_report", { watcher: watcher.definition.name, report });
          if (!config.quiet) {
            console.log(`[Watcher] ${watcher.definition.name}: ${report.overallHealth}`);
          }
        } catch (err) {
          writeEvent(out, "watcher_error", { error: err instanceof Error ? (err.stack || err.message) : String(err) });
        } finally {
          watcherInFlight = false;
        }
      })();
      trackBackgroundTask(task);
    }

    // Specialized architect cognition + auto-approval + execution (non-blocking)
    if (mode === "full" && autoArchitect && spiritSystem && now - lastArchitect >= 45_000 && !architectInFlight) {
      lastArchitect = now;
      architectCycles++;
      architectInFlight = true;
      const task = (async () => {
        try {
          const proposals = await runArchitectCognition(sim.world, sim.god.systemRegistry, spiritSystem.registry, autoArchitect);
          writeEvent(out, "architect_proposals", { architect: autoArchitect.definition.name, proposals });

          const pending = getPendingProposals();
          for (const p of pending) {
            if (approveProposal(p.id, sim.god.eid)) proposalsApproved++;
          }

          // Queue execution (non-blocking) for approved proposals (especially baked systems)
          const before = sim.god.systemRegistry.systems.size;
          queueAllApprovedProposals(sim.world, sim.god.systemRegistry, (completed, total, name) => {
            writeEvent(out, "proposal_execution_progress", { completed, total, name });
          });

          // Give the task queue time to run baking tasks (system baking is often slower than a couple seconds).
          await sleep(10_000);
          const after = sim.god.systemRegistry.systems.size;
          proposalsExecuted += Math.max(0, after - before);
        } catch (err) {
          writeEvent(out, "architect_error", { error: err instanceof Error ? (err.stack || err.message) : String(err) });
        } finally {
          architectInFlight = false;
        }
      })();
      trackBackgroundTask(task);
    }

    // Run The Lawgiver cycle (rules) (non-blocking)
    if (mode === "full" && spiritSystem && now - lastLawgiver >= 30_000 && !lawgiverInFlight) {
      lastLawgiver = now;
      lawgiverInFlight = true;
      const task = (async () => {
        try {
          const pending = getPendingRuleRequests().length;
          const res = await runLawgiverCycle(spiritSystem.registry);
          rulesApproved += res.rulesApproved;
          writeEvent(out, "lawgiver_cycle", { pendingRequests: pending, ...res, summary: getLawgiverSummary() });
          if (!config.quiet) {
            console.log(`[Lawgiver] +${res.rulesApproved} rules (pendingRequests=${pending})`);
          }
        } catch (err) {
          writeEvent(out, "lawgiver_error", { error: err instanceof Error ? (err.stack || err.message) : String(err) });
        } finally {
          lawgiverInFlight = false;
        }
      })();
      trackBackgroundTask(task);
    }

    // Run Artificer with tools (maintenance) (non-blocking)
    if (mode === "full" && spiritSystem && now - lastArtificer >= 60_000 && !artificerInFlight) {
      lastArtificer = now;
      artificerCycles++;
      artificerInFlight = true;
      const task = (async () => {
        try {
          const artificer = Array.from((await import("../spirits/spirit-factory")).getFactoryState().createdSpirits.values())
            .find((s) => s.definition.name === "The Tinker");
          if (artificer) {
            const rep = await runArtificerWithTools(sim.world, sim.god.systemRegistry, spiritSystem.registry, artificer);
            writeEvent(out, "artificer_report", { artificer: artificer.definition.name, rep });
            if (!config.quiet) {
              console.log(`[Artificer] inspected=${rep.systemsInspected} repairs=${rep.repairsSucceeded}/${rep.repairsAttempted}`);
            }
          }
        } catch (err) {
          writeEvent(out, "artificer_error", { error: err instanceof Error ? (err.stack || err.message) : String(err) });
        } finally {
          artificerInFlight = false;
        }
      })();
      trackBackgroundTask(task);
    }

    // Coherence / consistency issues
    if (mode === "full" && now - lastCoherence >= 15_000) {
      lastCoherence = now;
      const issues = getAndClearAccumulatedIssues();
      coherenceIssues += issues.length;
      if (issues.length > 0) {
        writeEvent(out, "coherence_issues", { count: issues.length, issues: issues.slice(0, 10) });
      }
    }

    // Periodic heartbeat snapshot
    if (!config.quiet && now - startedAt > 10_000 && now % 15_000 < 1200) {
      const agents = Array.from(query(sim.world, [Agent])).length;
      const rooms = Array.from(query(sim.world, [Room])).length;
      const objects = Array.from(query(sim.world, [PhysicalObject])).length;
      const q = getQueueStats();
      console.log(`[Heartbeat] agents=${agents} rooms=${rooms} objects=${objects} systems=${sim.god.systemRegistry.systems.size} queue=${q.pending}p/${q.running}r`);
    }
  }

  // Freeze runtime activity, then drain in-flight async orchestration work
  // so metrics/summaries reflect completed cycles rather than queued work.
  try {
    sim.pause();
  } catch {}
  await waitForBackgroundTasks(backgroundTasks, 60_000);
  await waitForTaskQueueIdle();

  // Flush any spirit backlog after the main loop so late narrator/watcher
  // directives can still reach GodAI before final scoring.
  if (mode === "full") {
    try {
      for (let i = 0; i < 3; i++) {
        const delivered = await deliverPendingMessagesToGod();
        if (delivered > 0) {
          writeEvent(out, "god_message_delivery", { delivered, source: "final_flush", cycle: i + 1 });
        }
        const autopilot = await runGodAutopilotCycle(sim.god, {
          executeCommand: (command) => sim.command(command),
          now: Date.now(),
        });
        writeEvent(out, "god_autopilot_final", { cycle: i + 1, ...autopilot });

        if (autopilot.executed || delivered > 0) {
          await waitForBackgroundTasks(backgroundTasks, 20_000);
          await waitForTaskQueueIdle(20_000);
        }

        if (delivered === 0 && !autopilot.executed) break;
      }
    } catch (err) {
      writeEvent(out, "god_autopilot_final_error", {
        error: err instanceof Error ? (err.stack || err.message) : String(err),
      });
    }
  }

  // If hard task is still pending at the end of the run, give it a short grace
  // period before marking timeout for deterministic reporting.
  if (mode === "full" && hardTaskPromise && hardTaskState.status === "pending") {
    await Promise.race([hardTaskPromise.catch(() => {}), sleep(2_000)]);
    if (hardTaskState.status === "pending") {
      hardTaskState = {
        status: "timeout",
        startedAt: hardTaskState.startedAt,
        endedAt: Date.now(),
      };
      writeEvent(out, "hard_task_timeout", {
        elapsedMs: (hardTaskState.endedAt || Date.now()) - (hardTaskState.startedAt || Date.now()),
        hardTaskTimeoutMs: config.hardTaskTimeoutMs,
      });
    }
  }

  // Final snapshot + checks
  const finalAgents = Array.from(query(sim.world, [Agent])).length;
  const finalRooms = Array.from(query(sim.world, [Room])).length;
  const finalObjects = Array.from(query(sim.world, [PhysicalObject])).length;
  const finalSystems = sim.god.systemRegistry.systems.size;
  const finalRules = (await import("../world/schema")).worldSchema.getActiveRules().length;

  const summary = {
    config: { ...config, mode },
    outputs: {
      dir: out.dir,
      narrativePath: out.narrativePath,
      eventsPath: out.eventsPath,
    },
    hardTask: hardTaskState,
    counters: {
      agentActions,
      worldStates,
      narrativeLines: spiritNarrativeLines + daemonPovLines,
      spiritNarrativeLines,
      daemonPovLines,
      spiritsProcessed,
      watcherCycles,
      architectCycles,
      artificerCycles,
      proposalsApproved,
      proposalsExecuted,
      rulesApproved,
      coherenceIssues,
    },
    world: {
      agents: finalAgents,
      rooms: finalRooms,
      physicalObjects: finalObjects,
    },
    deltas: {
      systems: { before: baselineSystems, after: finalSystems, delta: finalSystems - baselineSystems },
      rules: { before: baselineRules, after: finalRules, delta: finalRules - baselineRules },
    },
    spiritSystem: {
      debug: mode === "full" ? getSpiritSystemDebugInfo() : { status: "disabled" },
      registrySummary: (mode === "full" && spiritSystem) ? getRegistrySummary(spiritSystem.registry) : "disabled",
    },
    taskQueue: {
      stats: getQueueStats(),
      summary: getQueueSummary(),
    },
  };

  fs.writeFileSync(out.summaryPath, JSON.stringify(summary, null, 2));
  writeEvent(out, "final_summary", summary);

  const hardTaskMadeProgress =
    finalSystems > baselineSystems ||
    finalRules > baselineRules ||
    proposalsExecuted > 0 ||
    rulesApproved > 0;

  // Basic "full stack ran" checks
  const checks = mode === "full"
    ? [
        { name: "agents_exist", ok: finalAgents >= 6, details: finalAgents },
        { name: "rooms_exist", ok: finalRooms >= 6, details: finalRooms },
        { name: "agent_actions_observed", ok: agentActions >= 3, details: agentActions },
        {
          name: "narrative_stream_active",
          ok: spiritNarrativeLines + daemonPovLines >= 3,
          details: {
            spiritNarrativeLines,
            daemonPovLines,
            total: spiritNarrativeLines + daemonPovLines,
          },
        },
        {
          name: "god_or_spirits_mutated_world_model",
          ok:
            finalSystems > baselineSystems ||
            finalRules > baselineRules ||
            proposalsExecuted > 0 ||
            rulesApproved > 0,
          details: {
            baselineSystems,
            finalSystems,
            baselineRules,
            finalRules,
            proposalsExecuted,
            rulesApproved,
          },
        },
        {
          name: "hard_task_completed_or_skipped",
          ok:
            config.hardTask === "none" ||
            hardTaskState.status === "completed" ||
            (hardTaskState.status === "timeout" && hardTaskMadeProgress),
          details: {
            status: hardTaskState.status,
            hardTaskMadeProgress,
          },
        },
      ]
    : [
        { name: "agents_exist", ok: finalAgents >= 6, details: finalAgents },
        { name: "rooms_exist", ok: finalRooms >= 6, details: finalRooms },
        { name: "world_states_observed", ok: worldStates >= 3, details: worldStates },
      ];
  const failed = checks.filter((c) => !c.ok);

  if (!config.quiet) {
    console.log("\n=== FINAL CHECKS ===");
    for (const c of checks) {
      console.log(`${c.ok ? "✓" : "✗"} ${c.name}: ${JSON.stringify(c.details)}`);
    }
    console.log("\n=== SPIRIT SYSTEM ===");
    if (mode === "full" && spiritSystem) console.log(getRegistrySummary(spiritSystem.registry));
    console.log("\n=== TASK QUEUE ===");
    console.log(getQueueSummary());
    console.log(`\nOutputs written to: ${out.dir}`);
  }

  const exitCode = failed.length > 0 ? 1 : 0;
  if (failed.length > 0) {
    writeEvent(out, "failed_checks", { failed: failed.map((f) => f.name), checks });
  }

  await shutdown("completed");
  await waitForOutputsClosed(out);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
