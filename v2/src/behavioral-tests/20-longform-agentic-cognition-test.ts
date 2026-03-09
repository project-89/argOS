/**
 * Long-Form Agentic Cognition E2E Test
 *
 * End-to-end scenario that exercises the "grounded substrate" cognition loop:
 * - runCognitionCycle (planning-enabled) → executeActions (affordances/inventory) → deterministic goal pursuit movement
 * - multi-step dependency chain grounded in ECS state (traits + states + containment)
 *
 * Scenario: "Office Demo Recovery"
 * - Retrieve a backup drive from a server rack and deliver it to Jordan in the Meeting Room.
 * - Requires passcode note + keycard + unlocking server door before rack access.
 *
 * Run (AI):
 *   npx tsx src/behavioral-tests/20-longform-agentic-cognition-test.ts
 *
 * Run (scripted, no LLM required):
 *   npx tsx src/behavioral-tests/20-longform-agentic-cognition-test.ts --mode=scripted
 *
 * Options:
 *   --maxCycles=160
 *   --mode=ai|scripted
 *   --quiet
 */
import "dotenv/config";

import { addComponent, addEntity, createWorld, getRelationTargets, hasComponent, query, removeEntity } from "bitecs";
import {
  Agent,
  AllComponents,
  Goal,
  Name,
  ObjectState,
  Room,
} from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { AllRelations } from "../ecs/relations";
import { getDirectContainer, getRoomForEntity, listDirectContents } from "../ecs/location";
import { createSystemRegistry, type SystemContext, type SystemRegistry } from "../ecs/dynamic-systems";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { worldSchema, ObjectManager } from "../world";
import {
  executeActions,
  initializeInventory,
  queueStimulus,
  registerEntity,
  runCognitionCycle,
} from "../cognition/cognition-system";
import { DETERMINISTIC_SYSTEM_DEFINITIONS } from "../systems/deterministic-behavior-systems";

// =============================================================================
// CLI
// =============================================================================

type Mode = "ai" | "scripted";

function parseArgs(argv: string[]) {
  const out: { maxCycles: number; mode: Mode; quiet: boolean } = {
    maxCycles: 160,
    mode: "ai",
    quiet: false,
  };

  for (const arg of argv) {
    if (arg.startsWith("--maxCycles=")) out.maxCycles = Number(arg.split("=", 2)[1] || out.maxCycles);
    if (arg.startsWith("--mode=")) out.mode = (arg.split("=", 2)[1] as Mode) || out.mode;
    if (arg === "--quiet") out.quiet = true;
  }

  if (!Number.isFinite(out.maxCycles) || out.maxCycles <= 0) out.maxCycles = 160;
  if (out.mode !== "ai" && out.mode !== "scripted") out.mode = "ai";
  return out;
}

// =============================================================================
// LOGGING
// =============================================================================

const c = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function makeLogger(quiet: boolean) {
  return {
    header: (s: string) => !quiet && console.log(`${c.bright}${s}${c.reset}`),
    info: (s: string) => !quiet && console.log(`${c.cyan}${s}${c.reset}`),
    warn: (s: string) => !quiet && console.log(`${c.yellow}${s}${c.reset}`),
    success: (s: string) => console.log(`${c.green}${s}${c.reset}`),
    error: (s: string) => console.log(`${c.red}${s}${c.reset}`),
    dim: (s: string) => !quiet && console.log(`${c.dim}${s}${c.reset}`),
  };
}

// =============================================================================
// WORLD SPEC
// =============================================================================

type RoomName = "Open Office" | "Break Room" | "Server Room" | "Meeting Room";

interface TestWorld {
  world: ReturnType<typeof createWorld>;
  registry: SystemRegistry;
  objectManager: ObjectManager;
  rooms: Record<RoomName, number>;
  agentEid: number;
  jordanEid: number;
  objects: {
    deskDrawer: number;
    coffeeTin: number;
    stickyNote: number;
    keycard: number;
    serverDoor: number;
    serverRack: number;
    backupDrive: number;
  };
}

function defineScenarioSchema(): void {
  // Object types
  worldSchema.defineObjectType({
    name: "desk_drawer",
    description: "A desk drawer with a keypad lock",
    traits: ["examinable", "drawer"],
    states: {
      locked: {
        description: "A desk drawer locked with a keypad. You might need a passcode.",
        traits: ["drawer_locked"],
        blockedTraits: ["drawer_openable"],
      },
      closed: {
        description: "The desk drawer is unlocked but closed.",
        traits: ["drawer_openable"],
        blockedTraits: ["drawer_locked"],
      },
      open: {
        description: "The desk drawer is open. Something inside can be retrieved.",
        traits: ["drawer_open"],
        blockedTraits: ["drawer_openable", "drawer_locked"],
      },
    },
    defaultState: "locked",
    category: "container",
  });

  worldSchema.defineObjectType({
    name: "coffee_tin",
    description: "A coffee tin",
    traits: ["examinable", "tin"],
    states: {
      closed: {
        description: "A closed coffee tin. It rattles faintly if shaken.",
        traits: ["tin_openable"],
      },
      open: {
        description: "The coffee tin is open. Something small might be inside.",
        traits: ["tin_open"],
        blockedTraits: ["tin_openable"],
      },
    },
    defaultState: "closed",
    category: "container",
  });

  worldSchema.defineObjectType({
    name: "sticky_note",
    description: "A sticky note with handwritten digits",
    traits: ["examinable"],
    states: {
      inside_tin: {
        description: "A sticky note tucked inside the tin (you can't take it yet).",
        blockedTraits: ["takeable", "hasPasscode"],
      },
      available: {
        description: "A sticky note that reads: PASSCODE = 0420.",
        traits: ["takeable", "hasPasscode"],
      },
    },
    defaultState: "inside_tin",
    category: "clue",
  });

  worldSchema.defineObjectType({
    name: "keycard",
    description: "A plastic keycard with an RFID strip",
    traits: ["examinable"],
    states: {
      in_drawer: {
        description: "A keycard stashed in the drawer (not accessible yet).",
        blockedTraits: ["takeable", "hasKeycard"],
      },
      available: {
        description: "A keycard labeled: SERVER ACCESS.",
        traits: ["takeable", "hasKeycard"],
      },
    },
    defaultState: "in_drawer",
    category: "key",
  });

  worldSchema.defineObjectType({
    name: "server_door",
    description: "A heavy server room door",
    traits: ["examinable", "door"],
    states: {
      locked: {
        description: "A server room door with a badge reader and keypad. It's LOCKED.",
        traits: ["door_locked"],
        blockedTraits: ["door_unlocked"],
      },
      unlocked: {
        description: "The server room door is UNLOCKED.",
        traits: ["door_unlocked"],
        blockedTraits: ["door_locked"],
      },
    },
    defaultState: "locked",
    category: "door",
  });

  worldSchema.defineObjectType({
    name: "server_rack",
    description: "A server rack with a locked front panel",
    traits: ["examinable", "rack"],
    states: {
      closed: {
        description: "A server rack with a closed front panel.",
        traits: ["rack_openable"],
      },
      open: {
        description: "The rack is open. A drive bay is visible.",
        traits: ["rack_open"],
        blockedTraits: ["rack_openable"],
      },
    },
    defaultState: "closed",
    category: "machine",
  });

  worldSchema.defineObjectType({
    name: "backup_drive",
    description: "An encrypted backup drive",
    traits: ["examinable"],
    states: {
      in_rack: {
        description: "A backup drive seated in the rack (not accessible yet).",
        blockedTraits: ["takeable", "hasBackupDrive"],
      },
      available: {
        description: "An encrypted backup drive (handle with care).",
        traits: ["takeable", "hasBackupDrive"],
      },
    },
    defaultState: "in_rack",
    category: "item",
  });

  // Affordances (variants only; "open"/"unlock" will resolve to a usable variant)
  worldSchema.defineAffordance({
    name: "open_coffee_tin",
    requires: ["tin_openable"],
    descriptionTemplate: "{actor.name} opens the coffee tin.",
    effects: [
      { type: "set_state", target: "target", state: "open" },
      { type: "set_state", target: "sticky note", state: "available" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result", stimulusContent: "SUCCESS: You open the tin. A sticky note with a passcode is now accessible." },
    ],
  });

  worldSchema.defineAffordance({
    name: "unlock_desk_drawer",
    requires: ["drawer_locked"],
    actorRequires: ["hasPasscode"],
    descriptionTemplate: "{actor.name} enters a passcode and unlocks the desk drawer.",
    effects: [
      { type: "set_state", target: "target", state: "closed" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result", stimulusContent: "SUCCESS: The drawer clicks—unlocked." },
    ],
  });

  worldSchema.defineAffordance({
    name: "open_desk_drawer",
    requires: ["drawer_openable"],
    descriptionTemplate: "{actor.name} opens the desk drawer.",
    effects: [
      { type: "set_state", target: "target", state: "open" },
      { type: "set_state", target: "keycard", state: "available" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result", stimulusContent: "SUCCESS: The drawer is open. A keycard is now accessible." },
    ],
  });

  worldSchema.defineAffordance({
    name: "unlock_server_door",
    requires: ["door_locked"],
    actorRequires: ["hasKeycard", "hasPasscode"],
    descriptionTemplate: "{actor.name} badges in and enters the passcode to unlock the server door.",
    effects: [
      { type: "set_state", target: "target", state: "unlocked" },
      { type: "add_trait", target: "actor", trait: "serverAccessGranted" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result", stimulusContent: "SUCCESS: The server door unlocks. Access granted." },
    ],
  });

  worldSchema.defineAffordance({
    name: "open_server_rack",
    requires: ["rack_openable"],
    actorRequires: ["serverAccessGranted"],
    descriptionTemplate: "{actor.name} opens the server rack front panel.",
    effects: [
      { type: "set_state", target: "target", state: "open" },
      { type: "set_state", target: "backup drive", state: "available" },
      { type: "emit_stimulus", target: "actor", stimulusType: "action_result", stimulusContent: "SUCCESS: The rack is open. The backup drive can be removed." },
    ],
  });
}

function setupWorld(): TestWorld {
  const world = createWorld();
  initializePrefabs(world);

  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world);

  defineScenarioSchema();

  const rooms: TestWorld["rooms"] = {
    "Open Office": createRoomEntity(world, { name: "Open Office", description: "Desks, monitors, and a locked drawer.", capacity: 10, ambience: "office", gridPosition: { x: 2, y: 2 } }),
    "Break Room": createRoomEntity(world, { name: "Break Room", description: "Coffee machine, snacks, and a suspicious tin.", capacity: 6, ambience: "office", gridPosition: { x: 10, y: 2 } }),
    "Server Room": createRoomEntity(world, { name: "Server Room", description: "Loud fans and a secured rack.", capacity: 4, ambience: "industrial", gridPosition: { x: 10, y: 10 } }),
    "Meeting Room": createRoomEntity(world, { name: "Meeting Room", description: "A conference table where the demo will happen.", capacity: 8, ambience: "office", gridPosition: { x: 2, y: 10 } }),
  };

  for (const [name, eid] of Object.entries(rooms)) {
    registerEntity(eid, name);
  }

  const agentEid = createAgentEntity(world, {
    name: "Maya",
    role: "Senior Developer",
    description: "A focused engineer under deadline pressure.",
    roomId: rooms["Open Office"],
    systemPrompt: `You are Maya, a senior developer in an office simulation.
Your job is to complete the mission by taking grounded actions that change the ECS world state.

Mission: retrieve the backup drive from the server rack and deliver it to Jordan in the Meeting Room.

Rules:
- You can only act on entities that exist in your room or you are holding.
- Prefer actions that physically change the world (pickup, move, interact).
- If an action fails, change strategy (observe/examine/move) instead of repeating.`,
    gridPosition: { x: 2, y: 2 },
  });
  initializeInventory(agentEid, 10, 25);
  registerEntity(agentEid, "Maya");

  const jordanEid = createAgentEntity(world, {
    name: "Jordan",
    role: "Product Manager",
    description: "Waiting anxiously for the demo materials.",
    roomId: rooms["Meeting Room"],
    systemPrompt: "You are Jordan. You mostly wait for others to deliver things to you.",
    gridPosition: { x: 2, y: 10 },
  });
  // Keep cognition focused on Maya for this test (Jordan still receives items/messages).
  Agent.active[jordanEid] = false;
  initializeInventory(jordanEid, 10, 25);
  registerEntity(jordanEid, "Jordan");

  // Mission objects
  const deskDrawer = objectManager.spawn("desk_drawer", { name: "desk drawer", containedIn: rooms["Open Office"] });
  const keycard = objectManager.spawn("keycard", { name: "keycard", containedIn: rooms["Open Office"] });

  const coffeeTin = objectManager.spawn("coffee_tin", { name: "coffee tin", containedIn: rooms["Break Room"] });
  const stickyNote = objectManager.spawn("sticky_note", { name: "sticky note", containedIn: rooms["Break Room"] });

  const serverDoor = objectManager.spawn("server_door", { name: "server door", containedIn: rooms["Server Room"] });
  const serverRack = objectManager.spawn("server_rack", { name: "server rack", containedIn: rooms["Server Room"] });
  const backupDrive = objectManager.spawn("backup_drive", { name: "backup drive", containedIn: rooms["Server Room"] });

  if (!deskDrawer || !keycard || !coffeeTin || !stickyNote || !serverDoor || !serverRack || !backupDrive) {
    throw new Error("Failed to spawn one or more scenario objects");
  }

  // Register for effect executor lookups (affordance effects refer to these by name).
  registerEntity(deskDrawer, "desk drawer");
  registerEntity(coffeeTin, "coffee tin");
  registerEntity(stickyNote, "sticky note");
  registerEntity(keycard, "keycard");
  registerEntity(serverDoor, "server door");
  registerEntity(serverRack, "server rack");
  registerEntity(backupDrive, "backup drive");

  // Goal (drives planning system).
  const goalEid = addEntity(world);
  addComponent(world, goalEid, Goal);
  addComponent(world, agentEid, HasGoal(goalEid));
  Goal.description[goalEid] = "Deliver the backup drive to Jordan in the Meeting Room";
  Goal.priority[goalEid] = 10;
  Goal.status[goalEid] = "active";
  Goal.progress[goalEid] = 0;

  // Initial briefing stimulus.
  queueStimulus({
    targetEid: agentEid,
    type: "mission_brief",
    modality: "cognitive",
    source: "briefing",
    content: `Urgent: Meridian demo in 3 days.
Objective: retrieve the BACKUP DRIVE from the SERVER RACK and deliver it to JORDAN in the MEETING ROOM.

Hints:
- The desk drawer is keypad-locked. A passcode exists somewhere.
- The server door requires a keycard and passcode.
- The rack requires access to open safely.`,
  });

  return {
    world,
    registry,
    objectManager,
    rooms,
    agentEid,
    jordanEid,
    objects: { deskDrawer, coffeeTin, stickyNote, keycard, serverDoor, serverRack, backupDrive },
  };
}

// =============================================================================
// DETERMINISTIC SYSTEM TICK (movement goals, needs decay, etc.)
// =============================================================================

function runDeterministicSystems(tw: TestWorld, cycle: number): void {
  // Keep the deterministic step model simple and stable for a test:
  // - Always run GoalPursuit and Needs decay/satisfaction (if present).
  const elapsed = cycle * 1000;
  const delta = 1000;

  // Minimal context that supports the deterministic behavior systems.
  const ctx: SystemContext = {
    tick: cycle,
    delta,
    elapsed,
    emit: (type: string, data: any) => {
      if (type === "stimulus" && data && typeof data.targetEid === "number") {
        const modality =
          data.type === "visual" ? "visual" :
          data.type === "auditory" ? "auditory" :
          data.type === "cognitive" ? "cognitive" :
          "cognitive";
        queueStimulus({
          targetEid: data.targetEid,
          type: data.type || "stimulus",
          content: data.content || "",
          source: data.source || "system",
          modality,
        });
      } else {
        tw.registry.events.push({ type, data, timestamp: Date.now() });
      }
    },
    log: (msg: string) => tw.registry.logs.push(msg),
    query,
    hasComponent,
    getRelationTargets,
    addEntity,
    addComponent,
    removeEntity,
    components: AllComponents as any,
    relations: AllRelations as any,
    ai: null as any,
    grid: null as any,
    location: { getDirectContainer, getRoomForEntity, listDirectContents } as any,
    cognitive: null as any,
  } as any;

  const runnable = new Set([
    "GoalPursuitSystem",
    "NeedsDecaySystem",
    "LocationNeedSatisfactionSystem",
    "GoalCleanupSystem",
  ]);

  if (cycle === 1) {
    tw.registry.logs.push(`[DeterministicTick] cycle=1 starting`);
  }

  for (const def of DETERMINISTIC_SYSTEM_DEFINITIONS) {
    if (!runnable.has(def.name)) continue;
    if (cycle === 1) tw.registry.logs.push(`[DeterministicTick] running ${def.name}`);
    try {
      def.run(tw.world as any, ctx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      tw.registry.logs.push(`[DeterministicError] ${def.name}: ${msg}`);
    }
  }
}

// =============================================================================
// PROGRESS / ASSERTIONS
// =============================================================================

function isSolved(tw: TestWorld): boolean {
  const drive = tw.objects.backupDrive;
  const container = getDirectContainer(tw.world as any, drive);
  return container === tw.jordanEid || container === tw.rooms["Meeting Room"];
}

function describeProgress(tw: TestWorld): string {
  const room = getRoomForEntity(tw.world as any, tw.agentEid);
  const roomName = room !== undefined ? (Name.value[room] || `room:${room}`) : "unknown";

  const driveContainer = getDirectContainer(tw.world as any, tw.objects.backupDrive);
  const driveContainerName = driveContainer !== undefined ? (Name.value[driveContainer] || `entity:${driveContainer}`) : "nowhere";

  return `location=${roomName}, backup_drive@${driveContainerName}`;
}

function listAgentGoals(tw: TestWorld): Array<{ description: string; status: string; progress: number }> {
  const goals = getRelationTargets(tw.world as any, tw.agentEid, HasGoal);
  return goals
    .filter((geid) => hasComponent(tw.world as any, geid, Goal))
    .map((geid) => ({
      description: Goal.description[geid] || "",
      status: Goal.status[geid] || "",
      progress: Goal.progress[geid] || 0,
    }));
}

// =============================================================================
// SCRIPTED FALLBACK (no LLM)
// =============================================================================

function nextScriptedAction(tw: TestWorld): { eid: number; action: { type: any; target?: string; content?: string } } | null {
  const room = getRoomForEntity(tw.world as any, tw.agentEid);
  const roomName = room !== undefined ? (Name.value[room] || "") : "";

  const inInv = (itemEid: number) => getDirectContainer(tw.world as any, itemEid) === tw.agentEid;
  const inRoom = (itemEid: number) => getDirectContainer(tw.world as any, itemEid) === room;

  if (!inInv(tw.objects.stickyNote)) {
    if (!roomName.toLowerCase().includes("break room")) {
      return { eid: tw.agentEid, action: { type: "move", target: "Break Room", content: "get the passcode note" } };
    }
    const noteState = ObjectState.current[tw.objects.stickyNote];
    if (noteState === "available" && inRoom(tw.objects.stickyNote)) {
      return { eid: tw.agentEid, action: { type: "pickup", target: "sticky note" } };
    }
    const tinState = ObjectState.current[tw.objects.coffeeTin];
    if (tinState === "closed" && inRoom(tw.objects.coffeeTin)) {
      return { eid: tw.agentEid, action: { type: "open", target: "coffee tin" } };
    }
    return { eid: tw.agentEid, action: { type: "observe", target: "coffee tin" } };
  }

  if (!inInv(tw.objects.keycard)) {
    if (!roomName.toLowerCase().includes("open office")) {
      return { eid: tw.agentEid, action: { type: "move", target: "Open Office", content: "retrieve the keycard" } };
    }
    const drawerState = ObjectState.current[tw.objects.deskDrawer];
    if (drawerState === "locked") {
      return { eid: tw.agentEid, action: { type: "unlock", target: "desk drawer" } };
    }
    if (drawerState !== "open") {
      return { eid: tw.agentEid, action: { type: "open", target: "desk drawer" } };
    }
    // Drawer is open; keycard should be available now.
    return { eid: tw.agentEid, action: { type: "pickup", target: "keycard" } };
  }

  // If keycard is already held, proceed.

  if (!inInv(tw.objects.backupDrive)) {
    if (!roomName.toLowerCase().includes("server room")) {
      return { eid: tw.agentEid, action: { type: "move", target: "Server Room", content: "retrieve the backup drive" } };
    }
    const doorState = ObjectState.current[tw.objects.serverDoor];
    if (doorState === "locked") {
      return { eid: tw.agentEid, action: { type: "unlock", target: "server door" } };
    }
    const rackState = ObjectState.current[tw.objects.serverRack];
    if (rackState === "closed") {
      return { eid: tw.agentEid, action: { type: "open", target: "server rack" } };
    }
    const driveState = ObjectState.current[tw.objects.backupDrive];
    if (driveState === "available") {
      return { eid: tw.agentEid, action: { type: "pickup", target: "backup drive" } };
    }
    return { eid: tw.agentEid, action: { type: "observe", target: "server rack" } };
  }

  if (!roomName.toLowerCase().includes("meeting room")) {
    return { eid: tw.agentEid, action: { type: "move", target: "Meeting Room", content: "deliver the backup drive" } };
  }

  // Prefer giving; fallback to drop (either satisfies test).
  if (getDirectContainer(tw.world as any, tw.objects.backupDrive) === tw.agentEid) {
    return { eid: tw.agentEid, action: { type: "drop", target: "backup drive" } };
  }

  return null;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = makeLogger(args.quiet);

  log.header("\n" + "═".repeat(70));
  log.header("  LONG-FORM AGENTIC COGNITION E2E TEST");
  log.header("═".repeat(70));

  if (args.mode === "ai" && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    log.error("\n❌ GOOGLE_GENERATIVE_AI_API_KEY not set (use --mode=scripted to run without an LLM)");
    process.exit(1);
  }

  const tw = setupWorld();
  const start = Date.now();

  log.info(`Mode: ${args.mode}`);
  log.info(`Max cycles: ${args.maxCycles}`);
  log.info(`Goal: ${Goal.description[getRelationTargets(tw.world, tw.agentEid, HasGoal)[0]]}`);

  let solved = false;

  for (let cycle = 1; cycle <= args.maxCycles; cycle++) {
    if (!args.quiet) log.header(`\n[Cycle ${cycle}]`);

    if (args.mode === "ai") {
      const actions = await runCognitionCycle(tw.world as any, tw.registry, { tick: cycle, maxAgents: 1 });
      executeActions(tw.world as any, actions, tw.registry);

      for (const { eid, action } of actions) {
        const name = Name.value[eid] || `Agent-${eid}`;
        log.warn(`  ${name}: ${action.type}${action.target ? ` → ${action.target}` : ""}${action.content ? ` (${action.content.slice(0, 60)})` : ""}`);
      }
    } else {
      const scripted = nextScriptedAction(tw);
      if (scripted) {
        executeActions(tw.world as any, [scripted as any], tw.registry);
        log.warn(`  scripted: ${scripted.action.type}${scripted.action.target ? ` → ${scripted.action.target}` : ""}${scripted.action.content ? ` (${scripted.action.content})` : ""}`);
      } else {
        log.dim("  scripted: (no action)");
      }
    }

    // Deterministic fast loop tick (movement goals, needs, etc.)
    runDeterministicSystems(tw, cycle);

    if (isSolved(tw)) {
      solved = true;
      log.success(`\n✓ SOLVED at cycle ${cycle} (${describeProgress(tw)})`);
      break;
    }

    log.dim(`  ${describeProgress(tw)}`);
    if (!args.quiet && args.mode === "scripted") {
      const goals = listAgentGoals(tw).filter((g) => g.status === "active");
      if (goals.length > 0) log.dim(`  active goals: ${goals.map((g) => `"${g.description}"`).join("; ")}`);
    }
  }

  const durationMs = Date.now() - start;

  log.header("\n" + "═".repeat(70));
  log.header("  RESULTS");
  log.header("═".repeat(70));
  log.info(`Solved: ${solved ? "YES" : "NO"}`);
  log.info(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
  log.info(describeProgress(tw));
  if (!solved) {
    const tail = tw.registry.logs.slice(-20);
    if (tail.length > 0) {
      log.info(`\nLast ${tail.length} system logs:`);
      for (const line of tail) log.info(`  ${line}`);
    }
  }

  process.exit(solved ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
