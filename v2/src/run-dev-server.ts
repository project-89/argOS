/**
 * ArgOS v2 - Development Server (No Auto-Simulation)
 *
 * Starts the server with an empty world, ready for simulation creation via UI.
 */

import "dotenv/config";
import { createArgosWorld } from "./ecs/world";
import { initializePrefabs } from "./ecs/prefabs";
import {
  createGodAgent,
  godThink,
  runWorldTickAt,
} from "./god/god-agent";
import { createSimulationServer } from "./server/simulation-server";
import { registerAllBuiltinSystems } from "./systems/builtin-systems";
import {
  initializeSpiritSystem,
  createStandardHierarchy,
  startSpiritSystem,
  getAllSpirits,
  tickSpiritSystem,
  recordActionEvent,
  getSpiritSystemState,
  getSpiritByName,
  type DivineMessage,
} from "./spirits";
import { runWorldCrafterCycle, getPendingInteractions } from "./spirits/world-crafter-spirit";
import {
  runStewardCycle,
  requestRoomPopulation,
  getPendingRoomRequests,
} from "./spirits/steward-spirit";
import {
  getPendingProposals,
  approveProposal,
  getApprovedProposals,
  getSpiritsByType,
} from "./spirits/spirit-factory";
import { executeAllApprovedProposals, runArchitectCognition } from "./spirits/architect-spirit";
import { runArtificerWithTools } from "./spirits/artificer-spirit";
import type {
  GodCommandInjection,
  SpiritMessageInjection,
  SimulationStartInjection,
} from "./bus/simulation-bus";
import { query, getRelationTargets, hasComponent } from "bitecs";
import { Agent, Room, Name, Description, Mind, StimulusSource, Memory, Thought, GridPosition } from "./ecs/components";
import { HasMemory, HasThought } from "./ecs/relations";
import { getRoomForEntity } from "./ecs/location";
import { runCognitionCycle, executeActions } from "./cognition/cognition-system";
import { getAgentThoughts } from "./cognition/agent-mind";
import { compileMapIntoWorld } from "./world/map-compiler";
import {
  createDaemonRegistry,
  createDaemonsForAllAgents,
  runDaemonSystem,
  setDaemonSuperior,
  setSimulationTension,
  collectDaemonPovStories,
} from "./spirits/agent-daemon";
import {
  consumeLogs,
  consumeSystemErrors,
  getSystemTelemetrySnapshot,
} from "./ecs/dynamic-systems";

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║         ArgOS v2 - Development Server                        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  const port = Number(process.env.ARGOS_DEV_PORT || 3456);
  const server = createSimulationServer(port);

  // Create empty world
  const world = createArgosWorld("Empty World");
  initializePrefabs(world);

  // Create god agent with minimal config (no preset simulation)
  const god = createGodAgent(world, {
    name: "The Architect",
    worldName: "New Simulation",
    narrative: "An empty canvas awaiting creation.",
  });
  // Register builtin systems (deterministic substrate: movement, room arrival, needs, schedules, etc.)
  // Without this, UI-launched simulations look "stuck" (agents set movement targets but never physically move).
  registerAllBuiltinSystems(god.systemRegistry);

  // Initialize the spirit system with the standard hierarchy
  const spiritSystem = initializeSpiritSystem(world, {
    godAgentEid: god.eid,
    tickInterval: 5000, // Spirits observe every 5 seconds
    autoCreateNarrator: false, // We'll create via standard hierarchy
  });
  createStandardHierarchy(god.eid);
  // Don't auto-start spirit system - wait for user to start simulation
  // startSpiritSystem();
  console.log("[SpiritSystem] Spirits initialized (paused, waiting for simulation start)");

  // Initialize daemon registry so each agent gets a guardian narrator.
  const daemonRegistry = createDaemonRegistry(
    5000, // observation interval
    30000, // whisper cooldown
    90000, // challenge cooldown
    60000 // report cooldown
  );
  setDaemonSuperior(daemonRegistry, god.eid);
  setSimulationTension(daemonRegistry, 0.1);
  const initialDaemons = createDaemonsForAllAgents(daemonRegistry, world);
  console.log(`[DaemonSystem] Initialized ${initialDaemons} daemons`);

  let tick = 0;
  let paused = true; // Start paused - simulation only runs when user starts it
  let spiritSystemStarted = false; // Track if spirit system has been started
  const emittedSpiritObsCount = new Map<number, number>();
  const emittedSpiritOutboxCount = new Map<number, number>();

  server.setSimulationState({
    world,
    registry: god.systemRegistry,
    tick: 0,
    events: [],
    logs: [],
    daemonRegistry,
  });
  server.setGodAgent(god);

  // Helper to emit arbitrary events without strict type checking
  const busEmit = (event: Record<string, any>) => server.bus.emit(event as any);

  // Helper to emit world state to the bus
  function emitWorldState() {
    const agentEids = query(world, [Agent]);
    const roomEids = query(world, [Room]);
    const stimulusSourceEids = query(world, [StimulusSource]);
    const namedEids = query(world, [Name]);
    const systemCount = god.systemRegistry.systems.size;

    // Build agent summaries
    const agents = Array.from(agentEids).map(eid => {
      const roomEid = getRoomForEntity(world, eid);

      // Get agent's memories (limit to 20 most recent)
      const memoryEids = getRelationTargets(world, eid, HasMemory);
      const memories = memoryEids
        .filter(memEid => Memory.content[memEid])
        .map(memEid => ({
          id: memEid,
          type: Memory.type[memEid] || "unknown",
          content: Memory.content[memEid] || "",
          importance: Memory.importance[memEid] || 0,
          emotionalValence: Memory.emotionalValence[memEid] || 0,
          timestamp: Memory.timestamp[memEid] || 0,
        }))
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 20);

      // Get current thought if any
      const thoughtEids = getRelationTargets(world, eid, HasThought);
      const latestThought = thoughtEids
        .filter(tEid => Thought.content[tEid])
        .map(tEid => ({ content: Thought.content[tEid], ts: Thought.timestamp[tEid] || 0 }))
        .sort((a, b) => b.ts - a.ts)[0];

      // Get grid position if available
      const hasGridPos = hasComponent(world, eid, GridPosition);
      const gridPosition = hasGridPos ? {
        x: GridPosition.x[eid] || 0,
        y: GridPosition.y[eid] || 0,
        facing: GridPosition.facing[eid] || "down",
      } : null;

      return {
        id: eid,
        name: Name.value[eid] || `Agent ${eid}`,
        description: Description.value[eid] || "",
        role: Agent.role[eid] || "",
        room: roomEid ? Name.value[roomEid] : null,
        gridPosition,
        mind: {
          mode: Mind.mode[eid] || "idle",
          arousal: Mind.arousal[eid] || 0,
          focus: Mind.focus[eid] || "",
        },
        memories,
        currentThought: latestThought?.content || null,
      };
    });

    // Build room summaries
    const rooms = Array.from(roomEids).map(eid => {
      // Find agents in this room
      const occupants = Array.from(agentEids).filter(agentEid => {
        return getRoomForEntity(world, agentEid) === eid;
      }).map(agentEid => Name.value[agentEid] || `Agent ${agentEid}`);

      return {
        id: eid,
        name: Name.value[eid] || `Room ${eid}`,
        description: Description.value[eid] || "",
        capacity: Room.capacity[eid] || 10,
        ambience: Room.ambience[eid] || "",
        occupants,
      };
    });

    // Build stimulus source summaries
    const stimulusSources = Array.from(stimulusSourceEids).map(eid => {
      const roomEid = getRoomForEntity(world, eid);
      return {
        id: eid,
        name: Name.value[eid] || `Source ${eid}`,
        description: Description.value[eid] || "",
        room: roomEid ? Name.value[roomEid] : null,
        type: StimulusSource.stimulusType[eid] || "ambient",
      };
    });

    // Build summaries for non-agent, non-room, non-stimulus named entities so
    // UI can surface dynamically created world objects/components.
    const excluded = new Set<number>([
      ...Array.from(agentEids),
      ...Array.from(roomEids),
      ...Array.from(stimulusSourceEids),
    ]);
    const entities = Array.from(namedEids)
      .filter((eid) => !excluded.has(eid))
      .map((eid) => {
        const roomEid = getRoomForEntity(world, eid);
        const hasGridPos = hasComponent(world, eid, GridPosition);
        return {
          id: eid,
          name: Name.value[eid] || `Entity ${eid}`,
          description: Description.value[eid] || "",
          room: roomEid ? Name.value[roomEid] : null,
          type: "entity",
          gridPosition: hasGridPos
            ? {
                x: GridPosition.x[eid] || 0,
                y: GridPosition.y[eid] || 0,
                facing: GridPosition.facing[eid] || "down",
              }
            : null,
        };
      });

    // Build system summaries
    const systems = Array.from(god.systemRegistry.systems.entries()).map(([name, sys]) => ({
      name,
      description: sys.description || "",
      frequency: sys.frequency || 1000,
      active: sys.active !== false,
    }));
    emitSystemMeta();

    // Build spirit summaries
    const activeSpirits = getAllSpirits();
    const spirits = activeSpirits.map(spirit => ({
      id: spirit.eid,
      name: spirit.definition.name,
      domain: spirit.definition.domain,
      rank: spirit.definition.rank,
      description: spirit.definition.description,
      observationInterval: spirit.definition.observationInterval,
      lastObservation: spirit.lastObservationTime,
      inboxSize: spirit.inbox.length,
      observationsCount: spirit.observations.length,
    }));

    // Ensure each agent has a daemon, then collect daemon POV narrative snippets.
    createDaemonsForAllAgents(daemonRegistry, world);
    const povStories = collectDaemonPovStories(daemonRegistry, {
      maxStories: Math.max(3, daemonRegistry.daemons.size),
      minScore: 0,
    });
    const storyByAgent = new Map(povStories.map((story) => [story.agentName, story]));
    const daemons = Array.from(daemonRegistry.daemons.values()).map((daemon) => {
      const story = storyByAgent.get(daemon.agentName);
      return {
        agentEid: daemon.agentEid,
        agentName: daemon.agentName,
        observationCount: daemon.observationCount,
        whisperCount: daemon.whisperCount,
        reportCount: daemon.reportCount,
        concernLevel: daemon.concernLevel,
        pendingNudges: daemon.pendingNudges.length,
        memory: {
          thoughtCount: daemon.memory.recentThoughts.length,
          memoryCount: daemon.memory.keyMemories.length,
          planCount: daemon.memory.activePlans.length,
          characterMoments: daemon.memory.characterMoments.length,
          recentThoughts: daemon.memory.recentThoughts.slice(-5).reverse(),
        },
        growthMetrics: daemon.growthMetrics,
        lastObservation: daemon.lastObservation,
        lastWhisper: daemon.lastWhisper,
        lastReport: daemon.lastReport,
        active: daemon.active,
        // Optional narrative payload for richer daemon UI output.
        latestPovStory: story?.prose,
        arcStatus: daemon.narrativeArc.status,
        arcTension: daemon.narrativeArc.tension,
      };
    });

    const event = {
      type: "world:state" as const,
      timestamp: Date.now(),
      tick: tick,
      agentCount: agentEids.length,
      roomCount: roomEids.length,
      systemCount: systemCount,
      spiritCount: spirits.length,
      daemonCount: daemons.length,
      tension: daemonRegistry.simulationTension,
      // Include full entity data
      agents,
      rooms,
      stimulusSources,
      entities,
      systems,
      spirits,
      daemons,
    };

    console.log(
      `[WorldState] Emitting: tick=${tick}, agents=${agentEids.length}, rooms=${roomEids.length}, systems=${systemCount}, spirits=${spirits.length}, daemons=${daemons.length}`
    );
    server.bus.emit(event);
  }

  // Track if we're currently running cognition
  let runningCognition = false;
  let runningSpiritTick = false;
  let runningDaemonTick = false;
  let lastArchitectRun = 0;
  let lastArtificerRun = 0;
  const architectCadenceMs = Math.max(5000, Number(process.env.SPIRIT_ARCHITECT_CADENCE_MS || 30000));
  const artificerCadenceMs = Math.max(5000, Number(process.env.SPIRIT_ARTIFICER_CADENCE_MS || 45000));
  const maxProposalExecPerCycle = Math.max(1, Number(process.env.SPIRIT_EXEC_BUDGET_PER_CYCLE || 1));
  const recentEcsEvents = new Set<string>();
  const seenSystems = new Set<string>();
  const lastSystemRuns = new Map<string, number>();
  const lastDaemonStorySignature = new Map<string, string>();

  function emitSystemCreated(systemName: string, description: string, frequency: number) {
    if (seenSystems.has(systemName)) return;
    seenSystems.add(systemName);
    busEmit({
      type: "system:created",
      timestamp: Date.now(),
      systemName,
      description,
      frequency,
    } as any);
  }

  function emitSystemExecutionTelemetry() {
    const telemetry = getSystemTelemetrySnapshot();
    for (const t of telemetry) {
      const prevRuns = lastSystemRuns.get(t.systemName) ?? 0;
      if (t.runs <= prevRuns) continue;
      lastSystemRuns.set(t.systemName, t.runs);
      busEmit({
        type: "system:executed",
        timestamp: t.lastTimestamp || Date.now(),
        systemName: t.systemName,
        duration: t.lastDurationMs,
        entitiesProcessed: t.lastEmitCount,
        logCount: t.lastLogCount,
        tick: t.lastTick,
      } as any);
    }
  }

  function emitSystemLogs() {
    const logs = consumeLogs(god.systemRegistry);
    for (const line of logs) {
      // Typical format: [tick] [SystemName] message
      const withSystem = line.match(/^\[(\d+)\]\s+\[([^\]]+)\]\s*(.*)$/);
      if (withSystem) {
        busEmit({
          type: "system:log",
          timestamp: Date.now(),
          tick: Number(withSystem[1]),
          systemName: withSystem[2],
          message: withSystem[3] || "",
        } as any);
        continue;
      }

      const generic = line.match(/^\[(\d+)\]\s*(.*)$/);
      busEmit({
        type: "system:log",
        timestamp: Date.now(),
        tick: generic ? Number(generic[1]) : tick,
        systemName: "System",
        message: generic ? generic[2] : line,
      } as any);
    }
  }

  function emitSystemErrors() {
    const errors = consumeSystemErrors(god.systemRegistry);
    for (const err of errors) {
      busEmit({
        type: "system:error",
        timestamp: err.timestamp || Date.now(),
        systemName: err.systemName,
        error: err.error,
        errorCount: err.errorCount,
        disabled: god.systemRegistry.systems.get(err.systemName)?.active === false,
      } as any);
    }
  }

  function emitSystemMeta() {
    for (const [name, system] of god.systemRegistry.systems.entries()) {
      emitSystemCreated(name, system.description || "", system.frequency || 1000);
    }
  }

  function shouldEmitEcsEvent(dedupeKey: string, ttlMs: number): boolean {
    if (recentEcsEvents.has(dedupeKey)) return false;
    recentEcsEvents.add(dedupeKey);
    const t: any = setTimeout(() => recentEcsEvents.delete(dedupeKey), ttlMs);
    if (typeof t?.unref === "function") t.unref();
    return true;
  }

  function findAgentEidByName(agentName: string): number | undefined {
    const agentEids = query(world, [Agent, Name]);
    for (const eid of agentEids) {
      if (Name.value[eid] === agentName) return eid;
    }
    return undefined;
  }

  function findRoomEidByName(roomName: string): number | undefined {
    const roomEids = query(world, [Room, Name]);
    for (const eid of roomEids) {
      if (Name.value[eid] === roomName) return eid;
    }
    return undefined;
  }

  function emitEcsEventsToBus(events: Array<{ type: string; data: any; timestamp: number }>) {
    for (const evt of events) {
      const ts = evt.timestamp || Date.now();
      const data = evt.data || {};

      switch (evt.type) {
        case "agent_moved": {
          const agentName = String(data.agent || "");
          const agentId = agentName ? findAgentEidByName(agentName) : undefined;
          if (!agentName || agentId === undefined) break;
          const from = data.from ? `${data.from.x},${data.from.y}` : "";
          const to = data.to ? `${data.to.x},${data.to.y}` : "";
          const target = data.target ? String(data.target) : undefined;
          const key = `moved:${agentId}:${from}->${to}:${target || ""}:${Math.floor(ts / 250)}`;
          if (!shouldEmitEcsEvent(key, 500)) break;
          busEmit({
            type: "agent:action",
            timestamp: ts,
            agentId,
            agentName,
            action: "move",
            target,
            result: from && to ? `${from} -> ${to}` : undefined,
          });
          break;
        }
        case "movement_complete": {
          const agentName = String(data.agent || "");
          const agentId = agentName ? findAgentEidByName(agentName) : undefined;
          if (!agentName || agentId === undefined) break;
          busEmit({
            type: "agent:action",
            timestamp: ts,
            agentId,
            agentName,
            action: "move_complete",
            target: data.target ? String(data.target) : undefined,
            result: "arrived",
          });
          recordActionEvent(agentName, "arrive", `Arrived at ${data.target ? String(data.target) : "destination"}`, data.target ? String(data.target) : undefined);
          break;
        }
        case "room_entered": {
          const agentName = String(data.agent || "");
          const roomName = String(data.room || "");
          if (!agentName || !roomName) break;
          const roomId = findRoomEidByName(roomName);
          if (roomId === undefined) break;
          const key = `enter:${agentName}:${roomId}:${Math.floor(ts / 1000)}`;
          if (!shouldEmitEcsEvent(key, 1500)) break;
          busEmit({
            type: "room:activity",
            timestamp: ts,
            roomId,
            roomName,
            activityType: "enter",
            actor: agentName,
            content: `${agentName} entered ${roomName}`,
          });
          recordActionEvent(agentName, "enter", `Entered ${roomName}`, roomName);
          break;
        }
        case "room_left": {
          const agentName = String(data.agent || "");
          const roomName = String(data.room || "");
          if (!agentName || !roomName) break;
          const roomId = findRoomEidByName(roomName);
          if (roomId === undefined) break;
          const key = `leave:${agentName}:${roomId}:${Math.floor(ts / 1000)}`;
          if (!shouldEmitEcsEvent(key, 1500)) break;
          busEmit({
            type: "room:activity",
            timestamp: ts,
            roomId,
            roomName,
            activityType: "leave",
            actor: agentName,
            content: `${agentName} left ${roomName}`,
          });
          recordActionEvent(agentName, "leave", `Left ${roomName}`, roomName);
          break;
        }
        case "goal_completed": {
          const agentName = String(data.agent || "");
          const agentId = agentName ? findAgentEidByName(agentName) : undefined;
          if (!agentName || agentId === undefined) break;
          const goal = data.goal ? String(data.goal) : "goal";
          const key = `goal_completed:${agentId}:${goal}:${Math.floor(ts / 1000)}`;
          if (!shouldEmitEcsEvent(key, 2000)) break;
          busEmit({
            type: "agent:think",
            timestamp: ts,
            agentId,
            agentName,
            thoughtType: "reflection",
            thought: `Completed goal: ${goal}`,
          });
          break;
        }
        default:
          break;
      }
    }
  }


  // Run cognition cycle (every 5 seconds when agents exist)
  async function runCognitionTick() {
    const agentEids = query(world, [Agent]);
    if (agentEids.length === 0 || runningCognition) return;

    runningCognition = true;
    try {
      console.log(`[Cognition] Running cognitive cycle for ${agentEids.length} agents...`);

      // Run the cognition cycle
      const actions = await runCognitionCycle(world, god.systemRegistry, { tick });

      // Emit events for each agent's action and thought
      for (const { eid, action } of actions) {
        const name = Name.value[eid] || `Agent ${eid}`;

        // Get the agent's most recent thought
        const thoughtEids = getAgentThoughts(world, eid);
        const latestThoughtEid = thoughtEids[thoughtEids.length - 1];
        const latestThought = latestThoughtEid ? Thought.content[latestThoughtEid] : null;

        // Emit thought event if there's a new thought
        if (latestThought) {
          busEmit({
            type: "agent:think",
            timestamp: Date.now(),
            agentId: eid,
            agentName: name,
            thoughtType: "decision",
            thought: latestThought,
          });
        }

        // Emit action event
        busEmit({
          type: "agent:action",
          timestamp: Date.now(),
          agentId: eid,
          agentName: name,
          action: action.type,
          target: action.target,
          content: action.content,
        });

        console.log(`  [${name}] ${action.type}${action.target ? ` -> ${action.target}` : ""}${action.content ? `: ${action.content.substring(0, 50)}...` : ""}`);

        // Feed action trace into SpiritSystem so Narrative/Coherence spirits can observe grounded behavior
        recordActionEvent(name, action.type, action.content || "", action.target);
      }

      // Execute the actions
      if (actions.length > 0) {
        executeActions(world, actions, god.systemRegistry);
      }
    } catch (error) {
      console.error("[Cognition] Error:", error);
    } finally {
      runningCognition = false;
    }
  }
  // Run deterministic ECS systems on a fast loop.
  // This is the execution substrate that makes NPC actions (move/interact) actually change the world.
  const ECS_TICK_MS = 250;
  setInterval(() => {
    if (paused) return;
    tick++;
    const ecsEvents = runWorldTickAt(god, tick, ECS_TICK_MS);
    emitEcsEventsToBus(ecsEvents);
    emitSystemExecutionTelemetry();
    emitSystemLogs();
    emitSystemErrors();
  }, ECS_TICK_MS);

  // Emit world state periodically (UI rendering + dashboards)
  setInterval(() => {
    if (paused) return;
    emitWorldState();
  }, 500);

  // Run cognition cycle periodically (every 5 seconds when agents exist)
  setInterval(() => {
    if (paused) return;
    runCognitionTick();
  }, 5000);

  // Run daemon guardian cycle periodically and emit daemon bus events.
  setInterval(async () => {
    if (paused) return;
    if (runningDaemonTick) return;
    runningDaemonTick = true;

    try {
      createDaemonsForAllAgents(daemonRegistry, world);

      const before = new Map(
        Array.from(daemonRegistry.daemons.values()).map((d) => [
          d.agentEid,
          {
            observationCount: d.observationCount,
            whisperCount: d.whisperCount,
            reportCount: d.reportCount,
            pendingNudges: d.pendingNudges.length,
          },
        ])
      );

      const result = await runDaemonSystem(
        world,
        daemonRegistry,
        getSpiritSystemState()?.registry
      );
      let emittedDaemonStory = false;
      const stories = collectDaemonPovStories(daemonRegistry, {
        maxStories: Math.max(3, daemonRegistry.daemons.size),
        minScore: 0,
      });
      const storyByAgent = new Map(stories.map((s) => [s.agentName, s]));

      for (const daemon of daemonRegistry.daemons.values()) {
        const prev = before.get(daemon.agentEid);
        const story = storyByAgent.get(daemon.agentName);
        if (!prev) continue;

        // Emit daemon POV stream when the narrative signature changes.
        if (story && lastDaemonStorySignature.get(daemon.agentName) !== story.signature) {
          lastDaemonStorySignature.set(daemon.agentName, story.signature);
          emittedDaemonStory = true;
          busEmit({
            type: "daemon:observe",
            timestamp: Date.now(),
            agentId: daemon.agentEid,
            agentName: daemon.agentName,
            observation: story.prose,
          } as any);
        } else if (daemon.observationCount > prev.observationCount) {
          busEmit({
            type: "daemon:observe",
            timestamp: Date.now(),
            agentId: daemon.agentEid,
            agentName: daemon.agentName,
            observation: `${daemon.agentName} was observed in ${daemon.lastAgentState?.room || "the world"}.`,
          } as any);
        }

        if (daemon.whisperCount > prev.whisperCount) {
          busEmit({
            type: "daemon:whisper",
            timestamp: Date.now(),
            agentId: daemon.agentEid,
            agentName: daemon.agentName,
            whisperType: "guidance",
            content:
              daemon.lastAgentState?.focus
                ? `Guidance: stay focused on ${daemon.lastAgentState.focus}.`
                : `Guidance issued to ${daemon.agentName}.`,
          } as any);
        }

        if (daemon.reportCount > prev.reportCount) {
          busEmit({
            type: "daemon:report",
            timestamp: Date.now(),
            agentId: daemon.agentEid,
            agentName: daemon.agentName,
            subject: "Character status",
            summary:
              story?.prose ||
              `${daemon.agentName} concern ${(daemon.concernLevel * 100).toFixed(0)}%`,
            urgency:
              daemon.concernLevel > 0.7
                ? "high"
                : daemon.concernLevel > 0.4
                ? "normal"
                : "low",
          } as any);
        }

        if (daemon.pendingNudges.length > prev.pendingNudges) {
          const latestNudge = daemon.pendingNudges[daemon.pendingNudges.length - 1];
          if (latestNudge) {
            busEmit({
              type: "daemon:nudge",
              timestamp: Date.now(),
              agentId: daemon.agentEid,
              agentName: daemon.agentName,
              nudgeType: latestNudge.type,
              action: latestNudge.action,
              reason: latestNudge.reason,
            } as any);
          }
        }
      }

      if (
        emittedDaemonStory ||
        result.observations > 0 ||
        result.whispers > 0 ||
        result.challenges > 0 ||
        result.reports > 0
      ) {
        emitWorldState();
      }
    } catch (error) {
      console.error("[Daemons] Tick error:", error);
    } finally {
      runningDaemonTick = false;
    }
  }, 5000);

  // Run spirit system tick periodically (every 10 seconds)
  setInterval(async () => {
    if (paused) return;
    if (runningSpiritTick) return;
    runningSpiritTick = true;
    try {
      // Use god.registry which is a proper EntityRegistry with byName and byId maps
      const result = await tickSpiritSystem(world, god.registry);

      if (result.spiritsProcessed > 0) {
        console.log(`[Spirits] Processed ${result.spiritsProcessed} spirits`);
      }

      // Emit spirit observation and message events.
      // Important: flush even when `spiritsProcessed === 0` so any queued reports/outbox items
      // become visible to the UI (e.g. long-running LLM cycles, delayed interval ticks).
      const spirits = getAllSpirits();
      const narratorEid = spirits.find((s) => s.definition.name === "The Narrator")?.eid;
      for (const spirit of spirits) {
        // Emit any new observations since the last bus flush.
        const prevObsCount = emittedSpiritObsCount.get(spirit.eid) ?? 0;
        for (const obs of spirit.observations.slice(prevObsCount)) {
          busEmit({
            type: "spirit:observe",
            timestamp: obs.timestamp || Date.now(),
            spiritId: spirit.eid,
            spiritName: spirit.definition.name,
            spiritType: `${spirit.definition.domain}:${spirit.definition.rank}`,
            observation: obs.content || "Observation made",
            recommendations: (obs as any).metadata?.recommendations,
            // Extra fields used by some UI panels
            domain: spirit.definition.domain,
            rank: spirit.definition.rank,
            observationType: obs.type || "observation",
            content: obs.content || "Observation made",
            entities: obs.entities || [],
            location: obs.location,
            significance: obs.significance || 0.5,
          } as any);
        }
        emittedSpiritObsCount.set(spirit.eid, spirit.observations.length);

        // Emit any new outbox messages since the last bus flush.
        const outbox = spirit.outbox ?? [];
        const prevOutboxCount = emittedSpiritOutboxCount.get(spirit.eid) ?? 0;
        for (const msg of outbox.slice(prevOutboxCount)) {
          busEmit({
            type: "spirit:message",
            timestamp: msg.timestamp || Date.now(),
            from: (msg as any).from ?? spirit.eid,
            to: (msg as any).to,
            messageType: msg.type,
            content: msg.content || msg.subject,
            priority: msg.priority || "normal",
            // Extra fields used by some UI panels
            spiritId: spirit.eid,
            spiritName: spirit.definition.name,
            subject: msg.subject,
            toSpiritId: (msg as any).to,
          } as any);
        }
        emittedSpiritOutboxCount.set(spirit.eid, outbox.length);
      }

      // Emit narrative prose if any
      for (const prose of result.narrativeProse) {
        busEmit({
          type: "spirit:message",
          timestamp: Date.now(),
          from: narratorEid ?? god.eid,
          messageType: "story",
          content: prose,
          priority: "normal",
          spiritName: "The Narrator",
          spiritId: narratorEid,
        } as any);
      }

      // Run World Crafter cycle - creates entities for failed agent interactions
      // Also runs periodically to check for evolution opportunities
      const state = getSpiritSystemState();
      if (state) {
        const pendingInteractions = getPendingInteractions();
        const shouldRunCrafter = pendingInteractions.length > 0 ||
          (Date.now() - (state as any).lastEvolutionCheck > 120000); // Run at least every 2 min

        if (pendingInteractions.length > 0) {
          console.log(`[WorldCrafter] Processing ${pendingInteractions.length} pending failed interactions...`);
        }

        if (shouldRunCrafter) {
          const crafterResult = await runWorldCrafterCycle(world, state.registry, god);

          if (crafterResult.entitiesCreated > 0) {
            console.log(`[WorldCrafter] Created ${crafterResult.entitiesCreated} entities`);
            busEmit({
              type: "spirit:message",
              timestamp: Date.now(),
              spiritName: "The Crafter",
              content: `Materialized ${crafterResult.entitiesCreated} entities to meet agent needs`,
              messageType: "creation",
              priority: "normal",
            });
            // Emit updated world state after creating entities
            emitWorldState();
          }
          if (crafterResult.recommendationsSent > 0) {
            console.log(`[WorldCrafter] Sent ${crafterResult.recommendationsSent} system recommendations to The Weaver`);
          }
          if (crafterResult.evolutionProposalsSent > 0) {
            console.log(`[WorldCrafter] Sent ${crafterResult.evolutionProposalsSent} evolution proposals to The Weaver`);
            busEmit({
              type: "spirit:message",
              timestamp: Date.now(),
              spiritName: "The Crafter",
              content: `Proposed ${crafterResult.evolutionProposalsSent} world evolution(s) to address resource gaps`,
              messageType: "evolution",
              priority: "high",
            });
          }
        }

        // Run The Steward cycle - populates rooms with entities
        const pendingRoomRequests = getPendingRoomRequests();
        if (pendingRoomRequests.length > 0) {
          console.log(`[Steward] Processing ${pendingRoomRequests.length} room population requests...`);
          const stewardResult = await runStewardCycle(world, state.registry);

          if (stewardResult.roomsPopulated > 0) {
            console.log(`[Steward] Populated ${stewardResult.roomsPopulated} rooms with ${stewardResult.entitiesGenerated} entities`);
            busEmit({
              type: "spirit:message",
              timestamp: Date.now(),
              spiritName: "The Steward",
              content: `Furnished ${stewardResult.roomsPopulated} rooms with ${stewardResult.entitiesGenerated} entities`,
              messageType: "population",
              priority: "normal",
            });
            // Emit updated world state after populating rooms
            emitWorldState();
          }
          if (stewardResult.systemRequestsSent > 0) {
            console.log(`[Steward] Sent ${stewardResult.systemRequestsSent} system requests to The Weaver`);
          }
        }

        const now = Date.now();
        if (now - lastArchitectRun >= architectCadenceMs) {
          const architects = getSpiritsByType("architect");
          if (architects.length > 0) {
            console.log(`[Architect] Running ${architects.length} architect cycle(s)...`);
            for (const architect of architects) {
              const proposals = await runArchitectCognition(
                world,
                god.systemRegistry,
                state.registry,
                architect
              );
              if (proposals.length > 0) {
                busEmit({
                  type: "spirit:message",
                  timestamp: Date.now(),
                  spiritName: architect.definition.name,
                  content: `Proposed ${proposals.length} architecture change(s)`,
                  messageType: "proposal_created",
                  priority: "normal",
                });
              }
            }
          }
          lastArchitectRun = now;
        }

        if (now - lastArtificerRun >= artificerCadenceMs) {
          const artificers = getSpiritsByType("artificer");
          if (artificers.length > 0) {
            console.log(`[Artificer] Running ${artificers.length} maintenance cycle(s)...`);
            for (const artificer of artificers) {
              const report = await runArtificerWithTools(
                world,
                god.systemRegistry,
                state.registry,
                artificer
              );
              if (report.repairsAttempted.length > 0 || report.criticalSystems > 0) {
                busEmit({
                  type: "spirit:message",
                  timestamp: Date.now(),
                  spiritName: artificer.definition.name,
                  content: `Maintenance report: repairs=${report.repairsAttempted.length}, critical=${report.criticalSystems}`,
                  messageType: "maintenance",
                  priority: report.criticalSystems > 0 ? "high" : "normal",
                });
              }
            }
          }
          lastArtificerRun = now;
        }

        // Process spirit proposals - auto-approve system/component/entity proposals
        const pendingProposals = getPendingProposals();
        if (pendingProposals.length > 0) {
          console.log(`[Proposals] ${pendingProposals.length} pending proposals`);
          for (const proposal of pendingProposals) {
            const autoApprove =
              proposal.type === "system" ||
              proposal.type === "component" ||
              proposal.type === "entity";

            if (autoApprove) {
              approveProposal(proposal.id, god.eid);
              console.log(`[Proposals] ✅ Auto-approved: ${proposal.name} (${proposal.type})`);
              busEmit({
                type: "spirit:message",
                timestamp: Date.now(),
                spiritName: "System",
                content: `Approved proposal: ${proposal.name}`,
                messageType: "proposal_approved",
                priority: "high",
              });
            } else {
              console.log(`[Proposals] ⏸️ Pending review: ${proposal.name} (${proposal.type})`);
            }
          }
        }

        // Execute approved proposals (bakes new systems, creates entities, etc.)
        const approvedProposals = getApprovedProposals();
        if (approvedProposals.length > 0) {
          console.log(`[Proposals] Executing ${approvedProposals.length} approved proposals...`);
          const { executed, failed } = await executeAllApprovedProposals(world, god.systemRegistry, {
            maxProposals: maxProposalExecPerCycle,
          });
          if (executed.length > 0) {
            console.log(`[Proposals] 🔧 Executed: ${executed.join(", ")}`);
            for (const name of executed) {
              busEmit({
                type: "spirit:message",
                timestamp: Date.now(),
                spiritName: "The Weaver",
                content: `System created: ${name}`,
                messageType: "system_baked",
                priority: "high",
              });
            }
            // Emit updated world state after baking systems
            emitWorldState();
          }
          if (failed.length > 0) {
            console.log(`[Proposals] ❌ Failed: ${failed.join(", ")}`);
          }
        }
      }
    } catch (error) {
      console.error("[Spirits] Tick error:", error);
    } finally {
      runningSpiritTick = false;
    }
  }, 5000);

  // Register injection handlers for the SimulationBus
  server.bus.registerInjectionHandler("inject:god_command", async (msg) => {
    const injection = msg as GodCommandInjection;
    console.log(`[God Command] ${injection.command}`);

    // Emit command started
    busEmit({
      type: "god:command",
      timestamp: Date.now(),
      command: injection.command,
      status: "started",
    });

    try {
      const result = await godThink(god, injection.command);

      // Emit response
      busEmit({
        type: "god:response",
        timestamp: Date.now(),
        command: injection.command,
        thinking: result.thinking,
        actions: result.actions,
      });

      // Emit updated world state after changes
      emitWorldState();
    } catch (error) {
      // Emit error
      busEmit({
        type: "god:error",
        timestamp: Date.now(),
        command: injection.command,
        error: String(error),
      });
    }
  });

  // Register spirit message injection handler
  server.bus.registerInjectionHandler("inject:spirit_message", async (msg) => {
    const injection = msg as SpiritMessageInjection;
    console.log(`[Spirit Message] To: ${injection.targetSpiritName || injection.targetSpiritId} - ${injection.message.slice(0, 50)}...`);

    const state = getSpiritSystemState();
    if (!state) {
      console.error("[Spirit Message] Spirit system not initialized");
      return;
    }

    // Find target spirit
    let targetSpirit;
    if (injection.targetSpiritName) {
      targetSpirit = getSpiritByName(state.registry, injection.targetSpiritName);
    } else if (injection.targetSpiritId) {
      targetSpirit = state.registry.spirits.get(injection.targetSpiritId);
    }

    if (!targetSpirit) {
      console.error(`[Spirit Message] Spirit not found: ${injection.targetSpiritName || injection.targetSpiritId}`);
      busEmit({
        type: "spirit:message",
        timestamp: Date.now(),
        spiritName: "System",
        content: `Could not find spirit: ${injection.targetSpiritName || injection.targetSpiritId}`,
        messageType: "error",
        priority: "high",
      });
      return;
    }

    // Create message for spirit's inbox
    const message: DivineMessage = {
      id: `user_msg_${Date.now()}`,
      timestamp: Date.now(),
      from: god.eid, // From the god/user
      to: targetSpirit.eid,
      type: "directive",
      domain: targetSpirit.definition.domain,
      priority: injection.priority || "normal",
      subject: injection.subject || "User Message",
      content: injection.message,
      requiresResponse: true,
    };

    // Add to spirit's inbox
    targetSpirit.inbox.push(message);
    console.log(`[Spirit Message] Added to ${targetSpirit.definition.name}'s inbox (${targetSpirit.inbox.length} messages)`);

    // Emit event to confirm message was received
    busEmit({
      type: "spirit:message",
      timestamp: Date.now(),
      spiritName: targetSpirit.definition.name,
      spiritId: targetSpirit.eid,
      content: `Received message: "${injection.message.slice(0, 100)}..."`,
      messageType: "received",
      priority: injection.priority || "normal",
    });
  });

  // Register simulation control handlers
  server.bus.registerInjectionHandler("inject:simulation_pause", async () => {
    console.log("[Simulation] Pausing...");
    paused = true;
    busEmit({
      type: "simulation:status",
      timestamp: Date.now(),
      status: "paused",
      tick,
    });
  });

  server.bus.registerInjectionHandler("inject:simulation_resume", async () => {
    console.log("[Simulation] Resuming...");

    // Start spirit system on first resume if not started
    if (!spiritSystemStarted) {
      startSpiritSystem();
      spiritSystemStarted = true;
      console.log("[SpiritSystem] Started on simulation resume");
    }

    paused = false;
    busEmit({
      type: "simulation:status",
      timestamp: Date.now(),
      status: "running",
      tick,
    });
    emitWorldState();
  });

  server.bus.registerInjectionHandler("inject:simulation_stop", async () => {
    console.log("[Simulation] Stopping...");
    paused = true;
    tick = 0;
    busEmit({
      type: "simulation:status",
      timestamp: Date.now(),
      status: "stopped",
      tick,
    });
  });

  // Register simulation start handler - creates entities from map data
  server.bus.registerInjectionHandler("inject:simulation_start", async (msg) => {
    const injection = msg as SimulationStartInjection;
    const mapData = (injection as any).map;
    if (!mapData) {
      console.log("[Simulation] Starting without map payload (resume existing world)");
      paused = false;
      busEmit({
        type: "simulation:status",
        timestamp: Date.now(),
        status: "running",
        tick,
      });
      emitWorldState();
      return;
    }
    console.log(`[Simulation] Starting from map: ${mapData.name}`);

    try {
      const compiled = compileMapIntoWorld(world, mapData as any);
      console.log(
        `[Simulation] Map compiled: rooms=${compiled.roomByZoneId.size + 1}, agents=${compiled.spawnedAgentEids.length}, objects=${compiled.spawnedObjectEids.length}, newTypes=${compiled.definedObjectTypes.length}`
      );


      // Queue room population requests for each zone so The Steward can furnish the map quickly.
      // This makes UI demos feel alive without requiring manual spirit commands.
      const zones = (mapData.zones ?? []) as any[];
      for (const zone of zones) {
        const roomName = String(zone?.name || "").trim();
        if (!roomName) continue;
        const roomType = String(zone?.roomType || "general").trim() || "general";
        requestRoomPopulation(
          roomType,
          roomName,
          { worldTheme: "slice_of_life", primaryFunction: `A ${roomType}` },
          { maxItems: 12 },
          god.eid
        );
      }

      // Start the spirit system if not started
      if (!spiritSystemStarted) {
        startSpiritSystem();
        spiritSystemStarted = true;
        console.log("[SpiritSystem] Started on simulation start");
      }

      // Speed up spirit observation for UI demos (otherwise key spirits run only every 1-2 minutes).
      const spiritState = getSpiritSystemState();
      if (spiritState) {
        // Ask The Narrator to produce readable prose every cycle for UI demos.
        const narrator = getSpiritByName(spiritState.registry, "The Narrator");
        if (narrator) {
          narrator.inbox.push({
            id: `demo_narrator_${Date.now()}`,
            timestamp: Date.now(),
            from: god.eid,
            to: narrator.eid,
            type: "directive",
            domain: narrator.definition.domain,
            priority: "high",
            subject: "Demo narration",
            content:
              "For this demo, always write 1-3 sentences of vivid present-tense story prose describing the last few grounded actions and room activities you observed. Even if nothing dramatic happened, write a short atmospheric line about the village's moment.",
            requiresResponse: false,
          } as any);
        }
        for (const spirit of getAllSpirits()) {
          const name = spirit.definition.name;
          if (name === "The Narrator") spirit.definition.observationInterval = 10000;
          if (name === "The Weaver") spirit.definition.observationInterval = 30000;
          if (name === "The Steward") spirit.definition.observationInterval = 20000;
          if (name === "The Crafter") spirit.definition.observationInterval = 20000;
          if (name === "The Tinker") spirit.definition.observationInterval = 30000;
          if (name === "The Arbiter") spirit.definition.observationInterval = 30000;
          if (name === "The Lawgiver") spirit.definition.observationInterval = 60000;
        }
      }

      // Start the simulation
      paused = false;

      busEmit({
        type: "simulation:status",
        timestamp: Date.now(),
        status: "running",
        tick,
      });

      // Emit updated world state
      emitWorldState();

      console.log(`[Simulation] Started successfully`);
    } catch (error) {
      console.error("[Simulation] Start failed:", error);
      busEmit({
        type: "simulation:error",
        timestamp: Date.now(),
        error: String(error),
      });
    }
  });

  server.start();

  console.log("\n✨ Server ready - use the UI to create a simulation\n");
}

main().catch(console.error);
