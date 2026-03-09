/**
 * Behavioral Test / Harness: Orchestrated bake→run→evaluate→repair loop
 *
 * What this adds vs. previous stress tests:
 * - Repeatable run (seeded RNG)
 * - Periodic scoring snapshots (systems + NPC activity + grounding + coherence)
 * - Automated repair loop using existing spirits:
 *   - WorldCrafter: materialize missing interaction targets
 *   - Artificer: repair/disable broken systems
 *   - Architect: propose new deterministic systems
 *   - Lawgiver: propose rules
 * - Optional GodAI steering messages when scores stall
 *
 * Usage:
 *   npx tsx src/behavioral-tests/33-orchestration-eval-repair-harness.ts
 *   npx tsx src/behavioral-tests/33-orchestration-eval-repair-harness.ts --durationSec=60 --seed=123
 */
import "dotenv/config";

import * as fs from "fs";
import * as path from "path";
import { query, getRelationTargets, hasComponent } from "bitecs";

import { createSimulation } from "../index";
import { Agent, Name, Needs, Perception } from "../ecs/components";
import { getSystemTelemetrySnapshot, type SystemRegistry } from "../ecs/dynamic-systems";
import { HasPerception } from "../ecs/relations";
import { validateSystemCode } from "../god/system-baker";
import { enqueueSpiritMessages, initializeGodAutopilot, runGodAutopilotCycle } from "../god/god-autopilot";
import { setAgentBehaviorPolicy, type BehaviorNode } from "../cognition/behavior-policy";

import {
  initializeSpiritSystem,
  createStandardHierarchy,
  startSpiritSystem,
  stopSpiritSystem,
  setGodAgentCallback,
  deliverPendingMessagesToGod,
  tickSpiritSystem,
  getRegistrySummary,
  recordActionEvent,
} from "../spirits";
import {
  createDynamicSpirit,
  getPendingProposals,
  approveProposal,
  resetFactoryState,
  type DynamicSpiritState,
} from "../spirits/spirit-factory";
import { runWatcherCognition } from "../spirits/system-watcher";
import { runArchitectCognition, queueAllApprovedProposals } from "../spirits/architect-spirit";
import { runArtificerWithTools } from "../spirits/artificer-spirit";
import { getAndClearAccumulatedIssues, recordEvent } from "../spirits/consistency-spirit";
import { requestRule, runLawgiverCycle, getPendingRuleRequests, resetLawgiverState } from "../spirits/rules-spirit";
import { getPendingInteractions, runWorldCrafterCycle } from "../spirits/world-crafter-spirit";
import { collectDaemonPovStories } from "../spirits/agent-daemon";

type Config = {
  durationSec: number;
  seed: number;
  outputDir: string;
  evalIntervalMs: number;
  spiritTickIntervalMs: number;
  daemonPovIntervalMs: number;
  autopilotIntervalMs: number;
  watcherIntervalMs: number;
  architectIntervalMs: number;
  lawgiverIntervalMs: number;
  artificerIntervalMs: number;
  crafterIntervalMs: number;
  minNpcActionsPerEval: number;
};

const DEFAULTS: Config = {
  durationSec: 90,
  seed: 12345,
  outputDir: "./stress-test-output",
  evalIntervalMs: 10_000,
  spiritTickIntervalMs: 10_000,
  daemonPovIntervalMs: 9_000,
  autopilotIntervalMs: 12_000,
  watcherIntervalMs: 12_000,
  architectIntervalMs: 15_000,
  lawgiverIntervalMs: 18_000,
  artificerIntervalMs: 14_000,
  crafterIntervalMs: 8_000,
  minNpcActionsPerEval: 2,
};

function parseArgs(): Partial<Config> {
  const args: Partial<Config> = {};
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith("--durationSec=")) args.durationSec = parseInt(raw.split("=")[1], 10);
    if (raw.startsWith("--seed=")) args.seed = parseInt(raw.split("=")[1], 10);
    if (raw.startsWith("--output=")) args.outputDir = raw.split("=")[1];
    if (raw.startsWith("--evalMs=")) args.evalIntervalMs = parseInt(raw.split("=")[1], 10);
    if (raw.startsWith("--spiritMs=")) args.spiritTickIntervalMs = parseInt(raw.split("=")[1], 10);
    if (raw.startsWith("--daemonPovMs=")) args.daemonPovIntervalMs = parseInt(raw.split("=")[1], 10);
    if (raw.startsWith("--autopilotMs=")) args.autopilotIntervalMs = parseInt(raw.split("=")[1], 10);
  }
  return args;
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForStreamClose(stream: fs.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.closed) return resolve();
    stream.on("close", () => resolve());
    stream.on("error", () => resolve());
  });
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

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

type HarnessSnapshot = {
  ts: number;
  mode: "full" | "deterministic";
  tick: number;
  score: number;
  systems: {
    total: number;
    active: number;
    errorsTotal: number;
    autoDisabled: number;
    emitOnly: number;
    avgDurationMs: number;
    p95DurationMs: number;
  };
  npcs: {
    agents: number;
    activeAgents: number;
    actionsTotal: number;
    actionsNonWait: number;
    moves: number;
    interacts: number;
    speaks: number;
    waits: number;
    thrashAgents: number;
    newSuccess: number;
    newFailure: number;
    agentsWithSuccess: number;
    agentsWithFailure: number;
  };
  grounding: {
    pendingFailedInteractions: number;
    coherenceIssues: number;
    pendingRuleRequests: number;
    pendingProposals: number;
  };
  recommendations: string[];
};

type RecentAction = { ts: number; type: string; target?: string; content?: string };
type AgentActionWindow = { agentName: string; actions: RecentAction[] };

function computeSystemStats(registry: SystemRegistry): HarnessSnapshot["systems"] {
  const systems = Array.from(registry.systems.values());
  const total = systems.length;
  const active = systems.filter((s) => s.active).length;
  const errorsTotal = Array.from(registry.errorCounts.values()).reduce((a, b) => a + b, 0);
  const autoDisabled = systems.filter((s) => !s.active && (registry.errorCounts.get(s.name) || 0) >= 3).length;

  let emitOnly = 0;
  for (const sys of systems) {
    if (!sys.code) continue;
    const analysis = validateSystemCode(sys.code, {
      name: sys.name,
      purpose: sys.description || "",
      inputs: [],
      modifiedComponents: [],
      outputs: [],
      pseudocode: sys.pseudocode || "",
      frequency: sys.frequency,
    } as any);
    if (!analysis.valid && analysis.issues.some((i) => i.includes("NO STATE MODIFICATIONS"))) emitOnly++;
  }

  const telemetry = getSystemTelemetrySnapshot();
  const durations = telemetry.map((t) => t.lastDurationMs).filter((n) => Number.isFinite(n)) as number[];
  durations.sort((a, b) => a - b);
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const p95 = durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))] : 0;

  return { total, active, errorsTotal, autoDisabled, emitOnly, avgDurationMs: Math.round(avg), p95DurationMs: Math.round(p95) };
}

function countNewPerceptions(
  world: any,
  agentEid: number,
  sinceMs: number,
  type: "action_result" | "action_failed"
): number {
  const per = getRelationTargets(world, agentEid, HasPerception as any) as number[];
  let c = 0;
  for (const peid of per) {
    if (!hasComponent(world, peid, Perception as any)) continue;
    if (String(Perception.type[peid] || "") !== type) continue;
    const ts = Perception.timestamp[peid] || 0;
    if (ts > sinceMs) c++;
  }
  return c;
}

function computeNpcStats(world: any, sinceMs: number): HarnessSnapshot["npcs"] {
  const agents = Array.from(query(world, [Agent] as any)) as number[];
  let activeAgents = 0;
  let newSuccess = 0;
  let newFailure = 0;
  let agentsWithSuccess = 0;
  let agentsWithFailure = 0;

  for (const eid of agents) {
    if (!Agent.active[eid]) continue;
    activeAgents++;
    const s = countNewPerceptions(world, eid, sinceMs, "action_result");
    const f = countNewPerceptions(world, eid, sinceMs, "action_failed");
    newSuccess += s;
    newFailure += f;
    if (s > 0) agentsWithSuccess++;
    if (f > 0) agentsWithFailure++;
  }

  return {
    agents: agents.length,
    activeAgents,
    actionsTotal: 0,
    actionsNonWait: 0,
    moves: 0,
    interacts: 0,
    speaks: 0,
    waits: 0,
    thrashAgents: 0,
    newSuccess,
    newFailure,
    agentsWithSuccess,
    agentsWithFailure,
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function computeScore(snapshot: Omit<HarnessSnapshot, "score">): { score: number; recommendations: string[] } {
  const rec: string[] = [];
  const sys = snapshot.systems;
  const npc = snapshot.npcs;
  const g = snapshot.grounding;

  const sysHealth =
    1 -
    clamp01(sys.errorsTotal / 10) * 0.6 -
    clamp01(sys.autoDisabled / Math.max(1, sys.total)) * 0.6 -
    clamp01(sys.emitOnly / Math.max(1, sys.total)) * 0.4;

  const perfHealth = 1 - clamp01(sys.p95DurationMs / 50) * 0.4;

  // NPC activity has two layers:
  // - actionsNonWait: raw action throughput (bus-level)
  // - newSuccess: grounded success feedback (Perception action_result)
  const actionRate = clamp01(npc.actionsNonWait / Math.max(1, npc.activeAgents * 2));
  const groundedRate = clamp01(npc.newSuccess / Math.max(1, npc.activeAgents * 1));
  const npcActivity = clamp01(0.6 * actionRate + 0.4 * groundedRate);

  if (npc.actionsNonWait < Math.max(2, npc.activeAgents)) {
    rec.push("NPCs are not acting enough (non-wait); investigate cognition scheduling/policies and ensure agents can resolve their room + affordances.");
  }
  if (npc.newSuccess < 2) {
    rec.push("NPC grounded successes are low; ensure agents can interact (eat/sleep/take) and that actions produce action_result perceptions.");
  }
  if (npc.thrashAgents > 0) {
    rec.push("Some NPCs are thrashing (repeating the same action); add failure recovery / goal progress checks to prevent loops.");
  }

  const grounding = 1 - clamp01(g.pendingFailedInteractions / 10) * 0.7 - clamp01(g.coherenceIssues / 10) * 0.5;
  if (g.pendingFailedInteractions > 0) rec.push("Materialize missing interaction targets (WorldCrafter) to eliminate failed interactions.");
  if (sys.emitOnly > 0) rec.push("Some systems are emit-only; improve them to modify real ECS state or disable them.");
  if (sys.autoDisabled > 0) rec.push("Some systems auto-disabled due to errors; repair or replace them (Artificer).");

  const overall = 100 * (0.45 * sysHealth + 0.15 * perfHealth + 0.25 * npcActivity + 0.15 * grounding);
  return { score: Math.round(overall), recommendations: rec };
}

const HARD_TASK = `
HARD TASK (single directive):

Upgrade this simulation into a grounded loop where NPCs reliably DO THINGS without needing constant LLM calls.

Requirements:
1) Bake and activate a deterministic system that installs/updates a BehaviorPolicy for all NPC agents.
   - Hunger high → eat any edible in room
   - Energy low → rest/sleep if sleepable present
   - If no target in room, move to a plausible room (market/tavern/kitchen)

2) Ensure room population guarantees edible objects exist in common rooms (tavern/market/bakery).

3) Repair or disable any systems that are erroring or emit-only.

Report: system names you created/modified and what they do.
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
    objects: [
      // Food + rest are intentionally abundant so the harness measures *behavior* (move→interact→succeed),
      // not resource starvation (which would force thrashy movement loops once a few foods are destroyed).
      { name: "Bread Loaf", room: "The Golden Wheat", description: "A warm loaf with a crackling crust.", traits: ["edible"] },
      { name: "Stew Bowl", room: "The Golden Wheat", description: "A hearty bowl of stew.", traits: ["edible"] },
      { name: "Ale Mug", room: "The Golden Wheat", description: "A frothy mug of ale.", traits: ["drinkable"] },
      { name: "Simple Cot", room: "The Golden Wheat", description: "A plain cot for weary travelers.", traits: ["sleepable"], portable: false },
      { name: "Spare Cot", room: "The Golden Wheat", description: "A second cot, creaky but serviceable.", traits: ["sleepable"], portable: false },

      { name: "Apple Basket", room: "Marketplace", description: "A basket piled high with red apples.", traits: ["edible"] },
      { name: "Dried Fruit", room: "Marketplace", description: "A pouch of dried fruit slices.", traits: ["edible"] },
      { name: "Canvas Bedroll", room: "Marketplace", description: "A bedroll laid out for a quick rest.", traits: ["sleepable"], portable: false },

      { name: "Honey Bun", room: "Bakery", description: "A sweet bun glazed with honey.", traits: ["edible"] },
      { name: "Crusty Biscuit", room: "Bakery", description: "A hard biscuit, but filling.", traits: ["edible"] },
      { name: "Bakery Cot", room: "Bakery", description: "A tiny cot tucked behind the ovens.", traits: ["sleepable"], portable: false },

      { name: "Dried Jerky", room: "Blacksmith", description: "A strip of salted jerky.", traits: ["edible"] },
      { name: "Iron Ingot", room: "Blacksmith", description: "A heavy iron ingot, still faintly warm.", traits: [] },
      { name: "Workshop Cot", room: "Blacksmith", description: "A cot beside the forge for breaks.", traits: ["sleepable"], portable: false },

      { name: "Herbal Tea", room: "Temple Garden", description: "A calming cup of herbal tea.", traits: ["drinkable"] },
      { name: "Garden Bench", room: "Temple Garden", description: "A quiet bench among the flowers.", traits: ["sleepable"], portable: false },

      { name: "Warm Porridge", room: "Mill", description: "A bowl of porridge for mill workers.", traits: ["edible"] },
      { name: "Mill Cot", room: "Mill", description: "A cot in the mill loft.", traits: ["sleepable"], portable: false },

      { name: "Fresh Carrot", room: "Farm", description: "A crisp carrot pulled from the soil.", traits: ["edible"] },
      { name: "Hay Bed", room: "Farm", description: "A makeshift bed of hay.", traits: ["sleepable"], portable: false },

      { name: "Village Water Jug", room: "Village Square", description: "A jug of cool water for passersby.", traits: ["drinkable"] },
      { name: "Village Bench", room: "Village Square", description: "A bench in the square.", traits: ["sleepable"], portable: false },
    ],
  };
}

const BASELINE_POLICY: BehaviorNode = {
  type: "selector",
  children: [
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "need_above", need: "hunger", value: 60 } },
        { type: "interact_with_trait", trait: "edible", affordance: "eat", scope: "room" },
      ],
    },
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "need_above", need: "hunger", value: 60 } },
        { type: "condition", op: { type: "has_active_movement_goal", destinationIncludes: "Marketplace" } },
        { type: "action", action: { type: "wait" } },
      ],
    },
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "need_above", need: "hunger", value: 60 } },
        { type: "action", action: { type: "move", target: "Marketplace" } },
      ],
    },
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "need_below", need: "energy", value: 35 } },
        { type: "interact_with_trait", trait: "sleepable", affordance: "sleep", scope: "room" },
      ],
    },
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "need_below", need: "energy", value: 35 } },
        { type: "condition", op: { type: "has_active_movement_goal", destinationIncludes: "The Golden Wheat" } },
        { type: "action", action: { type: "wait" } },
      ],
    },
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "need_below", need: "energy", value: 35 } },
        { type: "action", action: { type: "move", target: "The Golden Wheat" } },
      ],
    },
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "chance", p: 0.12 } },
        { type: "action", action: { type: "move", target: "Village Square", content: "socialize" } },
      ],
    },
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "chance", p: 0.18 } },
        { type: "action", action: { type: "speak", content: "Anyone up for a chat or a bit of news?" } },
      ],
    },
    { type: "action", action: { type: "wait" } },
  ],
};

async function main(): Promise<void> {
  const config: Config = { ...DEFAULTS, ...parseArgs() };

  const dir = path.join(config.outputDir, `orchestration-harness-${nowStamp()}`);
  fs.mkdirSync(dir, { recursive: true });
  const eventsPath = path.join(dir, "events.jsonl");
  const scoresPath = path.join(dir, "scores.jsonl");
  const prosePath = path.join(dir, "narrative.txt");
  const summaryPath = path.join(dir, "summary.json");
  const eventsStream = fs.createWriteStream(eventsPath, { flags: "a" });
  const scoresStream = fs.createWriteStream(scoresPath, { flags: "a" });
  const proseStream = fs.createWriteStream(prosePath, { flags: "a" });
  const emitEvent = (type: string, data: Record<string, unknown>): void => {
    eventsStream.write(JSON.stringify({ ts: Date.now(), type, ...data }) + "\n");
  };

  const originalRandom = Math.random;
  Math.random = mulberry32(config.seed);

  resetFactoryState();
  resetLawgiverState();

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
  const mode: HarnessSnapshot["mode"] = apiKey.trim().length > 0 ? "full" : "deterministic";

  const initial = buildInitialWorldConfig();
  const sim = await createSimulation({
    name: "Orchestration Harness",
    preset: "slice-of-life",
    enableAI: mode === "full",
    enableSpirits: false,
    enablePlanning: false,
    dualLoop: true,
    ecsTickRate: 2,
    ecsDeltaMs: 500,
    autoPopulateRooms: true,
    rooms: initial.rooms,
    agents: initial.agents,
    objects: initial.objects,
  });

  await sim.start();
  const baselineSystems = sim.god.systemRegistry.systems.size;

  // This harness is intended to measure cognition→action→world-change loops.
  // Disable "auto-satisfaction" deterministic systems that satisfy needs without any agent actions,
  // otherwise agents become idle immediately and the test loses signal.
  for (const sysName of ["FoodService", "SimpleConsumption", "NeedsSatisfaction", "RestRecovery"] as const) {
    const sys = sim.god.systemRegistry.systems.get(sysName);
    if (sys) sys.active = false;
  }

  // Prime basic needs so we observe real interactions early in the run.
  for (const eid of Array.from(query(sim.world, [Agent] as any)) as number[]) {
    Needs.hunger[eid] = 70 + Math.floor(Math.random() * 25);
    Needs.energy[eid] = 25 + Math.floor(Math.random() * 30);
    setAgentBehaviorPolicy(sim.world as any, eid, BASELINE_POLICY, true);
  }

  let currentTick = 0;

  // Rolling action windows for robustness metrics.
  const agentWindows = new Map<number, AgentActionWindow>();

  const unsubAgent = sim.onAgent((evt: any) => {
    try {
      if (evt?.type === "agent:action" && typeof evt.agentId === "number") {
        const window = agentWindows.get(evt.agentId) ?? { agentName: String(evt.agentName || evt.agentId), actions: [] };
        window.agentName = String(evt.agentName || window.agentName);
        const actor = String(evt.agentName || evt.agentId);
        const action = String(evt.action || "action");
        const content =
          typeof evt.content === "string" && evt.content.trim().length > 0
            ? evt.content
            : `${actor} performs ${action}`;

        recordActionEvent(actor, action, content, evt.target ? String(evt.target) : undefined);

        window.actions.push({
          ts: Date.now(),
          type: action,
          target: evt.target ? String(evt.target) : undefined,
          content: typeof evt.content === "string" ? evt.content : undefined,
        });
        // Keep bounded window (~2 minutes at 2Hz + some buffer).
        if (window.actions.length > 300) window.actions = window.actions.slice(-300);
        agentWindows.set(evt.agentId, window);
      }
    } catch {}
    emitEvent("agent", { evt });
  });
  const unsubWorld = sim.onWorld((evt: any) => {
    if (evt?.type === "world:state" && typeof evt.tick === "number") {
      currentTick = evt.tick;
    }
    emitEvent("world", { evt });
  });

  const spiritSystem = mode === "full"
    ? initializeSpiritSystem(sim.world, { godAgentEid: sim.god.eid, tickInterval: 10000, autoCreateNarrator: false })
    : null;

  let behaviorArchitect: DynamicSpiritState | null = null;
  let systemsWatcher: DynamicSpiritState | null = null;
  let artificer: DynamicSpiritState | null = null;
  let autopilotInFlight = false;
  let autopilotCycles = 0;
  let spiritNarrativeLines = 0;
  let daemonPovLines = 0;
  const recentDaemonPov = new Map<string, number>();
  const snapshots: HarnessSnapshot[] = [];
  const backgroundTasks = new Set<Promise<unknown>>();
  const trackBackgroundTask = (task: Promise<unknown>): void => {
    backgroundTasks.add(task);
    void task.finally(() => {
      backgroundTasks.delete(task);
    });
  };

  if (mode === "full" && spiritSystem) {
    createStandardHierarchy(sim.god.eid);

    // Faster narrator cadence keeps short harness runs story-rich.
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
    emitEvent("spirit_system_started", { summary: getRegistrySummary(spiritSystem.registry) });

    // Route spirit messages into the GodAI autopilot inbox.
    initializeGodAutopilot(sim.god, {
      enabled: true,
      minRunIntervalMs: config.autopilotIntervalMs,
      minPriority: "normal",
      maxMessagesPerRun: 8,
    });
    setGodAgentCallback(async (messages) => {
      enqueueSpiritMessages(sim.god, messages, (fromEid) => {
        const spirit = spiritSystem.registry.spirits.get(fromEid);
        return spirit?.definition.name || `Spirit#${fromEid}`;
      });
    });

    systemsWatcher = createDynamicSpirit(spiritSystem.registry, {
      name: "Harness Watcher",
      type: "watcher",
      domain: "guardian",
      rank: "angel",
      superiorEid: sim.god.eid,
      watchConfig: { watchPatterns: ["stagnation", "errors", "missing_system"] },
      observationInterval: 12000,
    });

    behaviorArchitect = createDynamicSpirit(spiritSystem.registry, {
      name: "Behavior Architect",
      type: "architect",
      domain: "guardian",
      rank: "angel",
      superiorEid: sim.god.eid,
      architectConfig: {
        canProposeSystems: true,
        canProposeComponents: false,
        canProposeEntities: false,
        canProposeRules: true,
        canExecuteDirectly: false,
        proposalApproval: "godai",
        maxProposalsPerCycle: 3,
      },
      observationInterval: 15000,
      customPrompt: "Focus on deterministic NPC behavior systems (needs→move/interact) and grounding fixes.",
    });

    artificer = createDynamicSpirit(spiritSystem.registry, {
      name: "Harness Artificer",
      type: "artificer",
      domain: "guardian",
      rank: "angel",
      superiorEid: sim.god.eid,
      artificerConfig: {
        inspectionInterval: 14000,
        maxErrorsBeforeDisable: 3,
        autoFixEnabled: true,
        ignoreSystems: [],
      },
      observationInterval: 14000,
      customPrompt: "Prioritize fixing broken systems and improving emit-only systems into real ECS state-changing systems.",
    });

    // Seed a few rule requests so the loop has something concrete to do.
    requestRule(
      "Food spoilage: food transitions fresh→stale→rotten over time (deterministic).",
      { desiredBehavior: "Without AI, food decays and is perceivable." },
      "harness"
    );

    // Kick off a single directive to GodAI.
    const task = sim.command(HARD_TASK).catch(() => {});
    trackBackgroundTask(task);
  }

  let lastEval = Date.now();
  let lastSpiritTick = 0;
  let lastDaemonPov = 0;
  let lastWatcher = 0;
  let lastArchitect = 0;
  let lastLawgiver = 0;
  let lastArtificer = 0;
  let lastCrafter = 0;
  let lastAutopilot = 0;
  let lastGodNudge = 0;

  let lastEvalStampMs = Date.now();

  const start = Date.now();
  const end = start + config.durationSec * 1000;

  while (Date.now() < end) {
    await sleep(500);
    const now = Date.now();

    if (mode === "full" && spiritSystem && now - lastSpiritTick >= config.spiritTickIntervalMs) {
      lastSpiritTick = now;
      const task = (async () => {
        try {
          const res = await tickSpiritSystem(sim.world, sim.god.registry);
          if (res.messagesForGodAI.length > 0) {
            emitEvent("god_message_delivery", { delivered: res.messagesForGodAI.length, source: "spirit_tick" });
          }
          for (const prose of res.narrativeProse) {
            spiritNarrativeLines++;
            proseStream.write(prose.trim() + "\n\n");
            emitEvent("narrative_prose", { prose });
          }
        } catch (err) {
          emitEvent("spirit_tick_error", {
            error: err instanceof Error ? (err.stack || err.message) : String(err),
          });
        }
      })();
      trackBackgroundTask(task);
    }

    if (mode === "full" && now - lastDaemonPov >= config.daemonPovIntervalMs) {
      lastDaemonPov = now;
      const stories = collectDaemonPovStories(sim.daemons, { maxStories: 3, minScore: 0.05 });
      for (const story of stories) {
        const lastSeen = recentDaemonPov.get(story.signature) || 0;
        if (now - lastSeen < 45_000) continue;
        recentDaemonPov.set(story.signature, now);

        daemonPovLines++;
        const prose = `[Daemon POV — ${story.agentName}] ${story.prose}`;
        proseStream.write(prose + "\n\n");
        emitEvent("daemon_pov_story", { story });
      }
      for (const [sig, ts] of recentDaemonPov.entries()) {
        if (now - ts > 5 * 60_000) recentDaemonPov.delete(sig);
      }
    }

    if (mode === "full" && now - lastAutopilot >= config.autopilotIntervalMs && !autopilotInFlight) {
      lastAutopilot = now;
      autopilotInFlight = true;
      const task = (async () => {
        try {
          const delivered = await deliverPendingMessagesToGod();
          if (delivered > 0) {
            emitEvent("god_message_delivery", { delivered, source: "autopilot_tick" });
          }
          const res = await runGodAutopilotCycle(sim.god, {
            executeCommand: (command) => sim.command(command),
            now,
          });
          autopilotCycles++;
          emitEvent("god_autopilot", { res });
        } catch (err) {
          emitEvent("god_autopilot_error", {
            error: err instanceof Error ? (err.stack || err.message) : String(err),
          });
        } finally {
          autopilotInFlight = false;
        }
      })();
      trackBackgroundTask(task);
    }

    if (mode === "full" && spiritSystem && systemsWatcher && now - lastWatcher >= config.watcherIntervalMs) {
      lastWatcher = now;
      const task = runWatcherCognition(sim.world, sim.god.systemRegistry, spiritSystem.registry, systemsWatcher)
        .then((report) => {
          if (!report) return;
          emitEvent("watcher_report", { watcher: systemsWatcher?.definition.name, report });
          // Ensure watcher messages reach GodAI promptly even if the spirit tick interval hasn't elapsed.
          // If messages were delivered, opportunistically run the autopilot cycle immediately so it can act.
          const deliveryTask = deliverPendingMessagesToGod()
            .then((delivered) => {
              emitEvent("god_message_delivery", { delivered, source: "watcher_report" });
              if (!delivered) return;
              if (autopilotInFlight) return;
              autopilotInFlight = true;
              const ts = Date.now();
              return runGodAutopilotCycle(sim.god, {
                executeCommand: (command) => sim.command(command),
                now: ts,
              }).then((res) => {
                autopilotCycles++;
                emitEvent("god_autopilot", { res, source: "watcher_report" });
              }).catch((err) => {
                emitEvent("god_autopilot_error", {
                  error: err instanceof Error ? (err.stack || err.message) : String(err),
                  source: "watcher_report",
                });
              }).finally(() => {
                autopilotInFlight = false;
              });
            })
            .catch((err) => {
              emitEvent("god_message_delivery_error", {
                error: err instanceof Error ? (err.stack || err.message) : String(err),
                source: "watcher_report",
              });
            });
          trackBackgroundTask(deliveryTask);
        })
        .catch((err) => {
          emitEvent("watcher_error", {
            error: err instanceof Error ? (err.stack || err.message) : String(err),
          });
        });
      trackBackgroundTask(task);
    }

    if (mode === "full" && spiritSystem && behaviorArchitect && now - lastArchitect >= config.architectIntervalMs) {
      lastArchitect = now;
      const task = (async () => {
        const proposals = await runArchitectCognition(sim.world, sim.god.systemRegistry, spiritSystem.registry, behaviorArchitect);
        const pending = getPendingProposals();
        for (const p of pending) {
          // Auto-approve harness-origin proposals to keep the loop moving.
          approveProposal(p.id, sim.god.eid);
        }
        emitEvent("architect_cycle", {
          architect: behaviorArchitect.definition.name,
          proposalsCreated: proposals.length,
          pendingProposals: pending.length,
        });
        queueAllApprovedProposals(sim.world, sim.god.systemRegistry, (completed, total, name) => {
          emitEvent("proposal_execution_progress", { completed, total, name });
        });
      })().catch(() => {});
      trackBackgroundTask(task);
    }

    if (mode === "full" && now - lastLawgiver >= config.lawgiverIntervalMs) {
      lastLawgiver = now;
      if (spiritSystem) {
        const task = runLawgiverCycle(spiritSystem.registry)
          .then((res) => {
            emitEvent("lawgiver_cycle", { res });
          })
          .catch(() => {});
        trackBackgroundTask(task);
      }
    }

    if (mode === "full" && artificer && now - lastArtificer >= config.artificerIntervalMs) {
      lastArtificer = now;
      if (spiritSystem) {
        const task = runArtificerWithTools(sim.world, sim.god.systemRegistry, spiritSystem.registry, artificer)
          .then((report) => {
            emitEvent("artificer_report", {
              artificer: artificer.definition.name,
              systemsInspected: report.systemsInspected,
              healthySystems: report.healthySystems,
              warningSystems: report.warningSystems,
              criticalSystems: report.criticalSystems,
              repairsAttempted: report.repairsAttempted.length,
            });
          })
          .catch(() => {});
        trackBackgroundTask(task);
      }
    }

    if (mode === "full" && now - lastCrafter >= config.crafterIntervalMs) {
      lastCrafter = now;
      if (spiritSystem) {
        const task = runWorldCrafterCycle(sim.world, spiritSystem.registry, sim.god)
          .then((res) => {
            emitEvent("world_crafter_cycle", { res });
          })
          .catch(() => {});
        trackBackgroundTask(task);
      }
    }

    // Evaluate + score
    if (now - lastEval >= config.evalIntervalMs) {
      const issues = getAndClearAccumulatedIssues();
      const pendingInteractions = getPendingInteractions();
      const pendingRules = getPendingRuleRequests().length;
      const pendingProposals = getPendingProposals().length;

      // Action metrics from the bus window (since last eval stamp).
      let actionsTotal = 0;
      let actionsNonWait = 0;
      let moves = 0;
      let interacts = 0;
      let speaks = 0;
      let waits = 0;
      let thrashAgents = 0;

      for (const win of agentWindows.values()) {
        const recent = win.actions.filter((a) => a.ts > lastEvalStampMs);
        if (recent.length === 0) continue;
        actionsTotal += recent.length;

        // Thrash heuristic: same (type,target,contentPrefix) repeated 3+ times in a row.
        let streak = 1;
        let lastSig = "";
        let agentIsThrashing = false;
        for (const a of recent) {
          if (a.type === "wait") waits++;
          else actionsNonWait++;
          if (a.type === "move") moves++;
          if (a.type === "interact") interacts++;
          if (a.type === "speak") speaks++;

          // Ignore pure idling for thrash detection; we care about repeated *attempted* work (move/interact/etc).
          if (a.type === "wait") {
            streak = 1;
            lastSig = "";
            continue;
          }

          const sig = `${a.type}|${a.target || ""}|${(a.content || "").slice(0, 16)}`;
          if (sig && sig === lastSig) {
            streak++;
            if (streak >= 3) agentIsThrashing = true;
          } else {
            streak = 1;
            lastSig = sig;
          }
        }
        if (agentIsThrashing) thrashAgents++;
      }

      const snapshotBase: Omit<HarnessSnapshot, "score"> = {
        ts: now,
        mode,
        tick: currentTick,
        systems: computeSystemStats(sim.god.systemRegistry),
        npcs: {
          ...computeNpcStats(sim.world, lastEvalStampMs),
          actionsTotal,
          actionsNonWait,
          moves,
          interacts,
          speaks,
          waits,
          thrashAgents,
        },
        grounding: {
          pendingFailedInteractions: pendingInteractions.length,
          coherenceIssues: issues.length,
          pendingRuleRequests: pendingRules,
          pendingProposals,
        },
        recommendations: [],
      };

      const { score, recommendations } = computeScore(snapshotBase);
      const snapshot: HarnessSnapshot = { ...snapshotBase, score, recommendations };
      snapshots.push(snapshot);
      scoresStream.write(JSON.stringify(snapshot) + "\n");

      recordEvent("harness_score", snapshot, "harness");
      emitEvent("harness_score", { snapshot });

      // Repair driver heuristics
      if (pendingInteractions.length > 0) {
        recordEvent("harness_action", { kind: "run_world_crafter", pending: pendingInteractions.length }, "harness");
        if (mode === "full" && spiritSystem) {
          const task = runWorldCrafterCycle(sim.world, spiritSystem.registry, sim.god).catch(() => {});
          trackBackgroundTask(task);
        }
      }

      if (snapshot.systems.errorsTotal > 0 || snapshot.systems.autoDisabled > 0 || snapshot.systems.emitOnly > 0) {
        recordEvent(
          "harness_action",
          { kind: "run_artificer", errors: snapshot.systems.errorsTotal, autoDisabled: snapshot.systems.autoDisabled, emitOnly: snapshot.systems.emitOnly },
          "harness"
        );
        if (mode === "full" && artificer && spiritSystem) {
          const task = runArtificerWithTools(sim.world, sim.god.systemRegistry, spiritSystem.registry, artificer).catch(() => {});
          trackBackgroundTask(task);
        }
      }

      // If NPC activity is low, nudge GodAI periodically with a concrete directive.
      if (mode === "full" && snapshot.npcs.newSuccess < config.minNpcActionsPerEval && now - lastGodNudge >= 25_000) {
        lastGodNudge = now;
        const message = `HARNESS ALERT: NPC activity is low.\n\nLast score=${snapshot.score}.\nSystems: errors=${snapshot.systems.errorsTotal}, emitOnly=${snapshot.systems.emitOnly}, autoDisabled=${snapshot.systems.autoDisabled}.\nGrounding: pendingFailedInteractions=${snapshot.grounding.pendingFailedInteractions}, coherenceIssues=${snapshot.grounding.coherenceIssues}.\n\nPlease bake/activate a deterministic NPC behavior system that installs BehaviorPolicy for all agents (needs→move/interact), and repair/disable broken systems.`;
        const task = sim.command(message).catch(() => {});
        trackBackgroundTask(task);
      }

      lastEval = now;
      lastEvalStampMs = now;
    }
  }

  try { sim.pause(); } catch {}
  await waitForBackgroundTasks(backgroundTasks, 60_000);
  try { unsubAgent(); } catch {}
  try { unsubWorld(); } catch {}
  try { stopSpiritSystem(); } catch {}
  try { sim.stop(); } catch {}
  await waitForBackgroundTasks(backgroundTasks, 20_000);

  const finalAgents = Array.from(query(sim.world, [Agent] as any)).length;
  const finalSystems = sim.god.systemRegistry.systems.size;
  const latestSnapshot = snapshots[snapshots.length - 1] || null;
  const scoreStats = {
    snapshots: snapshots.length,
    latest: latestSnapshot?.score ?? null,
    min: snapshots.length ? Math.min(...snapshots.map((s) => s.score)) : null,
    max: snapshots.length ? Math.max(...snapshots.map((s) => s.score)) : null,
    avg: snapshots.length
      ? Math.round(snapshots.reduce((acc, s) => acc + s.score, 0) / snapshots.length)
      : null,
  };

  const checks = mode === "full"
    ? [
        { name: "score_snapshots_exist", ok: snapshots.length >= 2, details: snapshots.length },
        { name: "score_reaches_demo_threshold", ok: (scoreStats.max ?? 0) >= 70, details: scoreStats.max },
        { name: "narrative_stream_active", ok: spiritNarrativeLines + daemonPovLines >= 3, details: { spiritNarrativeLines, daemonPovLines } },
        { name: "god_autopilot_active", ok: autopilotCycles >= 1, details: autopilotCycles },
        { name: "systems_grew_or_stayed_healthy", ok: finalSystems >= baselineSystems, details: { baselineSystems, finalSystems } },
        { name: "grounded_npc_success_present", ok: (latestSnapshot?.npcs.newSuccess ?? 0) >= 1, details: latestSnapshot?.npcs.newSuccess ?? 0 },
      ]
    : [
        { name: "score_snapshots_exist", ok: snapshots.length >= 2, details: snapshots.length },
        { name: "agents_exist", ok: finalAgents >= 6, details: finalAgents },
      ];
  const failed = checks.filter((c) => !c.ok);

  const summary = {
    config,
    mode,
    outputs: { dir, eventsPath, scoresPath, prosePath, summaryPath },
    counters: {
      autopilotCycles,
      spiritNarrativeLines,
      daemonPovLines,
      narrativeLines: spiritNarrativeLines + daemonPovLines,
    },
    scoreStats,
    world: {
      agents: finalAgents,
    },
    systems: {
      baseline: baselineSystems,
      final: finalSystems,
      delta: finalSystems - baselineSystems,
    },
    latestSnapshot,
    checks,
    passed: failed.length === 0,
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  emitEvent("final_summary", { summary });
  if (failed.length > 0) {
    emitEvent("failed_checks", { failed: failed.map((f) => f.name), checks });
  }

  try { eventsStream.end(); } catch {}
  try { scoresStream.end(); } catch {}
  try { proseStream.end(); } catch {}
  await Promise.allSettled([
    waitForStreamClose(eventsStream),
    waitForStreamClose(scoresStream),
    waitForStreamClose(proseStream),
  ]);

  Math.random = originalRandom;

  const exitCode = failed.length > 0 ? 1 : 0;
  console.log(`Harness complete. Output: ${dir}`);
  process.exit(exitCode);
}

main().catch((e) => {
  console.error("✗ FAIL", e);
  process.exit(1);
});
