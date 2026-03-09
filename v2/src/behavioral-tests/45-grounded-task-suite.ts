/**
 * Grounded Task Suite Runner
 *
 * A repeatable, scored benchmark harness for grounded agent cognition in the ECS world.
 *
 * Goals are evaluated deterministically via typed success contracts (`GoalEvaluationSystem`),
 * while action selection can be:
 * - deterministic (contract-driven) or
 * - LLM-driven (with deterministic safety rails in `executeActions`)
 *
 * Run:
 *   npx tsx src/behavioral-tests/45-grounded-task-suite.ts
 *
 * Options:
 *   --mode=contract|llm|llm_plan
 *   --runs=3
 *   --tasks=terminal_echo,org_kanban_wiki
 *   --out=stress-test-output/grounded-task-suite-custom
 */
import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import { addComponent, addEntity } from "bitecs";
import { getRelationTargets, hasComponent } from "bitecs";

import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../ecs/prefabs";
import { Goal } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { HasConversation } from "../ecs/relations";
import { ConversationTurn } from "../ecs/components";
import { worldSchema, ObjectManager } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli, queueStimulus } from "../cognition/stimulus-queue";
import { setGoalContract } from "../cognition/goal-contract";
import { createGoalEvaluationSystem, createGoalPursuitSystem } from "../systems/builtin-systems";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { registerOfficeTool, setOfficeToolMode } from "../office-tools/tool-registry";
import { generatePlanForGoal, createPlanEntity } from "../cognition/planning-system";
import { processAgentCognition, agentThink } from "../cognition/agent-mind";
import { generateStimuliForAgent } from "../cognition/sensory-system";
import { setLocatedIn } from "../ecs/location";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

type Mode = "contract" | "llm" | "llm_plan";

type TaskSetupResult = {
  world: any;
  registry: any;
  objectManager: ObjectManager;
  agentEid: number;
  goalEid: number;
  roomEid: number;
  taskArtifacts?: Record<string, any>;
};

type TaskDefinition = {
  id: string;
  title: string;
  supportedModes: Mode[];
  maxSteps: number;
  setup: (opts: { runId: string }) => Promise<TaskSetupResult> | TaskSetupResult;
};

function parseArgs(argv: string[]): {
  mode: Mode;
  runs: number;
  tasks?: string[];
  out?: string;
} {
  const out: any = { mode: "contract" as Mode, runs: 3 };
  for (const arg of argv) {
    if (arg.startsWith("--mode=")) out.mode = String(arg.split("=")[1]) as Mode;
    if (arg.startsWith("--runs=")) out.runs = Number(arg.split("=")[1] || "3");
    if (arg.startsWith("--tasks=")) out.tasks = String(arg.split("=")[1] || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (arg.startsWith("--out=")) out.out = String(arg.split("=")[1] || "").trim();
  }
  if (!["contract", "llm", "llm_plan"].includes(out.mode)) out.mode = "contract";
  if (!Number.isFinite(out.runs) || out.runs <= 0) out.runs = 1;
  return out;
}

function isoDirStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function safeIdent(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function writeJsonlLine(fp: string, obj: any): void {
  fs.appendFileSync(fp, JSON.stringify(obj) + "\n");
}

function disableKnowledgeExtractionForBenchmarks(): void {
  // Keeps benchmark costs stable: the suite measures planning/action selection, not background memory extraction.
  process.env.ARGOS_DISABLE_KNOWLEDGE_EXTRACTION = "1";
}

async function withTempGoogleApiKey<T>(key: string | undefined, fn: () => Promise<T> | T): Promise<T> {
  const prev = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (key === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  else process.env.GOOGLE_GENERATIVE_AI_API_KEY = key;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    else process.env.GOOGLE_GENERATIVE_AI_API_KEY = prev;
  }
}

function countConversationTurns(world: any, agentEid: number): number {
  const targets = getRelationTargets(world, agentEid, HasConversation);
  return targets.filter((eid: number) => hasComponent(world, eid, ConversationTurn)).length;
}

async function runOneTask(
  task: TaskDefinition,
  mode: Mode,
  runId: string,
  outDir: string,
  runIndex: number
): Promise<{ status: "passed" | "failed" | "skipped"; steps: number; llmDecisions: number; planGenerated: boolean; actions: any[] }> {
  const startedAt = Date.now();
  const eventsPath = path.join(outDir, "events.jsonl");
  const scoresPath = path.join(outDir, "scores.jsonl");

  if (!task.supportedModes.includes(mode)) {
    writeJsonlLine(scoresPath, { ts: Date.now(), kind: "task", taskId: task.id, mode, runIndex, status: "skipped", reason: "unsupported_mode" });
    return { status: "skipped", steps: 0, llmDecisions: 0, planGenerated: false, actions: [] };
  }

  if ((mode === "llm" || mode === "llm_plan") && !process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
    writeJsonlLine(scoresPath, { ts: Date.now(), kind: "task", taskId: task.id, mode, runIndex, status: "skipped", reason: "missing_google_key" });
    return { status: "skipped", steps: 0, llmDecisions: 0, planGenerated: false, actions: [] };
  }

  const setup = await task.setup({ runId });
  const { world, registry, agentEid, goalEid } = setup;

  // Optional plan generation (LLM)
  let planGenerated = false;
  if (mode === "llm_plan") {
    const generated = await generatePlanForGoal(world, agentEid, goalEid);
    if (generated) {
      createPlanEntity(world, agentEid, goalEid, generated);
      planGenerated = true;
    }
  }

  const actions: any[] = [];
  let llmDecisions = 0;
  let eventCursor = 0;

  // Step loop: generate grounded stimuli, pick action, execute deterministically, evaluate goal deterministically.
  for (let step = 0; step < task.maxSteps; step++) {
    if (String(Goal.status[goalEid] || "") === "completed") {
      const dur = Date.now() - startedAt;
      writeJsonlLine(scoresPath, {
        ts: Date.now(),
        kind: "task",
        taskId: task.id,
        title: task.title,
        mode,
        runIndex,
        status: "passed",
        steps: step,
        llmDecisions,
        planGenerated,
        durationMs: dur,
      });
      return { status: "passed", steps: step, llmDecisions, planGenerated, actions };
    }

    const pending = drainPendingStimuli()
      .filter((s) => s.targetEid === agentEid)
      .map((s) => ({
        modality: (s.modality as any) || "cognitive",
        type: s.type,
        content: s.content,
        source: s.source,
        intensity: s.intensity,
      }));

    const stimuli = generateStimuliForAgent(world, agentEid, pending);
    const inputs = stimuli.map((s) => ({ type: s.type, content: s.content, source: s.source }));

    let action: any;
    if (mode === "contract") {
      // Deterministic: contract-driven selection happens inside agentThink before any LLM call.
      action = await withTempGoogleApiKey(undefined, () => agentThink(world, agentEid));
    } else {
      const beforeTurns = countConversationTurns(world, agentEid);

      action = await processAgentCognition(world, agentEid, inputs);

      // Detect if the LLM ran by checking conversation entity growth.
      const afterTurns = countConversationTurns(world, agentEid);
      if (afterTurns > beforeTurns) llmDecisions++;
    }

    actions.push({ step, ...action });
    writeJsonlLine(eventsPath, { ts: Date.now(), kind: "action", taskId: task.id, mode, runIndex, step, action });

    executeActions(world, [{ eid: agentEid, action }], registry);
    runSystems(world, registry, step, 16);

    // Bridge system-emitted stimuli into the agent stimulus queue (so "arrived at X" and other system feedback
    // becomes grounded perceptions next step).
    const evts = Array.isArray(registry.events) ? registry.events : [];
    for (; eventCursor < evts.length; eventCursor++) {
      const evt = evts[eventCursor];
      if (!evt || evt.type !== "stimulus") continue;
      const data = evt.data || {};
      const targetEid = Number(data.targetEid);
      if (!Number.isFinite(targetEid)) continue;
      const type = String(data.type || "event");
      const modality =
        type === "visual" || type === "auditory" || type === "olfactory" || type === "tactile" || type === "cognitive"
          ? (type as any)
          : ("cognitive" as any);
      queueStimulus({
        targetEid,
        type: type === "cognitive" ? "system" : type,
        content: String(data.content || ""),
        source: String(data.source || "system"),
        modality,
      });
    }
  }

  const dur = Date.now() - startedAt;
  writeJsonlLine(scoresPath, {
    ts: Date.now(),
    kind: "task",
    taskId: task.id,
    title: task.title,
    mode,
    runIndex,
    status: "failed",
    reason: "timeout",
    steps: task.maxSteps,
    llmDecisions,
    planGenerated,
    durationMs: dur,
  });
  return { status: "failed", steps: task.maxSteps, llmDecisions, planGenerated, actions };
}

function makeTasks(): TaskDefinition[] {
  const tasks: TaskDefinition[] = [];

  tasks.push({
    id: "terminal_echo",
    title: "Use a workstation terminal to run `echo hello`",
    supportedModes: ["contract", "llm", "llm_plan"],
    maxSteps: 20,
    setup: ({ runId }) => {
      setOfficeToolMode("scripted");
      registerBuiltinOfficeTools();

      // Scripted terminal.run: succeed for echo hello.
      registerOfficeTool("terminal.run", (params) => {
        const command = String(params?.command ?? "");
        const trimmed = command.trim();
        if (
          trimmed === "echo hello" ||
          trimmed === "`echo hello`" ||
          trimmed === "\"echo hello\"" ||
          trimmed.includes("echo hello")
        ) {
          return { ok: true, summary: "echo hello", stdout: "hello\n", exitCode: 0 };
        }
        return { ok: true, summary: `ran: ${command}`, stdout: "", exitCode: 0 };
      });

      const world = createArgosWorld(`Suite:${runId}:terminal`) as any;
      initializePrefabs(world);
      const registry = createSystemRegistry();
      const objectManager = new ObjectManager(world);

      const goalEval = createGoalEvaluationSystem();
      goalEval.frequency = 0;
      registerSystem(registry as any, goalEval as any);
      const goalPursuit = createGoalPursuitSystem();
      goalPursuit.frequency = 0;
      registerSystem(registry as any, goalPursuit as any);

      const room = createRoomEntity(world, { name: "Office", description: "An office with a workstation." });
      registerEntity(room, "Office");

      const unique = `${runId}_terminal`;
      worldSchema.defineObjectType({
        name: `computer_suite_${unique}`,
        description: "A workstation computer",
        traits: ["computer", "examinable"],
        states: { idle: { description: "A workstation computer is on.", traits: ["computer"] } },
        defaultState: "idle",
        category: "device",
      });
      worldSchema.defineAffordance({
        name: "run_command",
        requires: ["computer"],
        effects: [{ type: "run_tool", toolId: "terminal.run", toolInputFrom: "affordanceArgs", toolResultType: "tool_result" }],
      });

      const computer = objectManager.spawn(`computer_suite_${unique}`, { name: "Workstation", containedIn: room })!;
      registerEntity(computer, "Workstation");

      const agent = createAgentEntity(world, { name: "Noah", role: "npc", systemPrompt: "You are an NPC that uses tools.", roomId: room });
      registerEntity(agent, "Noah");

      const goalEid = addEntity(world);
      addComponent(world, goalEid, Goal);
      addComponent(world, agent, HasGoal(goalEid) as any);
      Goal.description[goalEid] = "On the Workstation, run the command echo hello using the run_command affordance.";
      Goal.priority[goalEid] = 10;
      Goal.status[goalEid] = "active";
      Goal.progress[goalEid] = 0;
      Goal.deadline[goalEid] = 0;
      Goal.createdAt[goalEid] = Date.now();
      setGoalContract(world, goalEid, {
        version: 1,
        kind: "custom",
        params: { command: "echo hello" },
        success: {
          type: "all_of",
          conditions: [
            { type: "tool_exit_code_equals", toolId: "terminal.run", commandIncludes: "echo hello", equals: 0 },
            { type: "tool_stdout_includes", toolId: "terminal.run", commandIncludes: "echo hello", includes: "hello" },
          ],
        },
        description: Goal.description[goalEid],
      });

      return { world, registry, objectManager, agentEid: agent, goalEid, roomEid: room };
    },
  });

  tasks.push({
    id: "terminal_echo_mult_room",
    title: "Navigate to another room and run `echo hello` on a workstation",
    supportedModes: ["contract", "llm", "llm_plan"],
    maxSteps: 35,
    setup: ({ runId }) => {
      setOfficeToolMode("scripted");
      registerBuiltinOfficeTools();

      registerOfficeTool("terminal.run", (params) => {
        const command = String(params?.command ?? "");
        const trimmed = command.trim();
        if (
          trimmed === "echo hello" ||
          trimmed === "`echo hello`" ||
          trimmed === "\"echo hello\"" ||
          trimmed.includes("echo hello")
        ) {
          return { ok: true, summary: "echo hello", stdout: "hello\n", exitCode: 0 };
        }
        return { ok: true, summary: `ran: ${command}`, stdout: "", exitCode: 0 };
      });

      const world = createArgosWorld(`Suite:${runId}:terminal-multi`) as any;
      initializePrefabs(world);
      const registry = createSystemRegistry();
      const objectManager = new ObjectManager(world);

      const goalEval = createGoalEvaluationSystem();
      goalEval.frequency = 0;
      registerSystem(registry as any, goalEval as any);
      const goalPursuit = createGoalPursuitSystem();
      goalPursuit.frequency = 0;
      registerSystem(registry as any, goalPursuit as any);

      const lobby = createRoomEntity(world, { name: "Lobby", description: "A building lobby." });
      const office = createRoomEntity(world, { name: "Office", description: "An office with a workstation." });
      registerEntity(lobby, "Lobby");
      registerEntity(office, "Office");

      const unique = `${runId}_terminal_multi`;
      worldSchema.defineObjectType({
        name: `computer_suite_${unique}`,
        description: "A workstation computer",
        traits: ["computer", "examinable"],
        states: { idle: { description: "A workstation computer is on.", traits: ["computer"] } },
        defaultState: "idle",
        category: "device",
      });
      worldSchema.defineAffordance({
        name: "run_command",
        requires: ["computer"],
        effects: [{ type: "run_tool", toolId: "terminal.run", toolInputFrom: "affordanceArgs", toolResultType: "tool_result" }],
      });

      const computer = objectManager.spawn(`computer_suite_${unique}`, { name: "Workstation", containedIn: office })!;
      registerEntity(computer, "Workstation");

      const agent = createAgentEntity(world, { name: "Noah", role: "npc", systemPrompt: "You are an NPC that uses tools.", roomId: lobby });
      registerEntity(agent, "Noah");

      const goalEid = addEntity(world);
      addComponent(world, goalEid, Goal);
      addComponent(world, agent, HasGoal(goalEid) as any);
      Goal.description[goalEid] = "In the Office, on the Workstation run the command echo hello using the run_command affordance.";
      Goal.priority[goalEid] = 10;
      Goal.status[goalEid] = "active";
      Goal.progress[goalEid] = 0;
      Goal.deadline[goalEid] = 0;
      Goal.createdAt[goalEid] = Date.now();
      setGoalContract(world, goalEid, {
        version: 1,
        kind: "custom",
        params: { command: "echo hello", destination: "Office" },
        success: {
          type: "all_of",
          conditions: [
            { type: "tool_exit_code_equals", toolId: "terminal.run", commandIncludes: "echo hello", equals: 0 },
            { type: "tool_stdout_includes", toolId: "terminal.run", commandIncludes: "echo hello", includes: "hello" },
          ],
        },
        description: Goal.description[goalEid],
      });

      return { world, registry, objectManager, agentEid: agent, goalEid, roomEid: lobby };
    },
  });

  tasks.push({
    id: "org_kanban_wiki",
    title: "Use Kanban + Wiki tools to complete a small workflow",
    supportedModes: ["contract", "llm", "llm_plan"],
    maxSteps: 40,
    setup: ({ runId }) => {
      setOfficeToolMode("scripted");
      registerBuiltinOfficeTools();

      const world = createArgosWorld(`Suite:${runId}:org`) as any;
      initializePrefabs(world);
      const registry = createSystemRegistry();
      const objectManager = new ObjectManager(world);

      const goalEval = createGoalEvaluationSystem();
      goalEval.frequency = 0;
      registerSystem(registry as any, goalEval as any);
      const goalPursuit = createGoalPursuitSystem();
      goalPursuit.frequency = 0;
      registerSystem(registry as any, goalPursuit as any);

      const room = createRoomEntity(world, { name: "Office", description: "An office." });
      registerEntity(room, "Office");

      const unique = `${runId}_org`;
      worldSchema.defineObjectType({
        name: `kanban_board_device_suite_${unique}`,
        description: "A shared kanban board device",
        traits: ["kanban_board", "examinable"],
        states: { idle: { description: "A kanban board is ready.", traits: ["kanban_board"] } },
        defaultState: "idle",
        category: "device",
      });
      worldSchema.defineObjectType({
        name: `wiki_terminal_device_suite_${unique}`,
        description: "A shared wiki terminal",
        traits: ["wiki_terminal", "examinable"],
        states: { idle: { description: "A wiki terminal is ready.", traits: ["wiki_terminal"] } },
        defaultState: "idle",
        category: "device",
      });

      worldSchema.defineAffordance({
        name: "kanban_init",
        requires: ["kanban_board"],
        effects: [{ type: "run_tool", toolId: "kanban.init", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
      });
      worldSchema.defineAffordance({
        name: "kanban_list",
        requires: ["kanban_board"],
        effects: [{ type: "run_tool", toolId: "kanban.list", toolInputFrom: "static", toolInput: {}, toolResultType: "tool_result" }],
      });
      worldSchema.defineAffordance({
        name: "kanban_upsert_card",
        requires: ["kanban_board"],
        effects: [{ type: "run_tool", toolId: "kanban.upsert_card", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
      });
      worldSchema.defineAffordance({
        name: "kanban_move_card",
        requires: ["kanban_board"],
        effects: [{ type: "run_tool", toolId: "kanban.move_card", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
      });
      worldSchema.defineAffordance({
        name: "wiki_upsert_doc",
        requires: ["wiki_terminal"],
        effects: [{ type: "run_tool", toolId: "wiki.upsert_doc", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
      });
      worldSchema.defineAffordance({
        name: "wiki_read",
        requires: ["wiki_terminal"],
        effects: [{ type: "run_tool", toolId: "wiki.read", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
      });
      worldSchema.defineAffordance({
        name: "wiki_ensure_contains",
        requires: ["wiki_terminal"],
        effects: [{ type: "run_tool", toolId: "wiki.ensure_contains", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
      });

      const board = objectManager.spawn(`kanban_board_device_suite_${unique}`, { name: "Team Board", containedIn: room })!;
      const wiki = objectManager.spawn(`wiki_terminal_device_suite_${unique}`, { name: "Wiki", containedIn: room })!;
      registerEntity(board, "Team Board");
      registerEntity(wiki, "Wiki");

      const agent = createAgentEntity(world, { name: "Ari", role: "Engineer", systemPrompt: "x", roomId: room });
      registerEntity(agent, "Ari");

      const goalEid = addEntity(world);
      addComponent(world, goalEid, Goal);
      addComponent(world, agent, HasGoal(goalEid) as any);
      Goal.description[goalEid] = "Use the board and wiki to complete the task.";
      Goal.priority[goalEid] = 10;
      Goal.status[goalEid] = "active";
      Goal.progress[goalEid] = 0;
      Goal.deadline[goalEid] = 0;
      Goal.createdAt[goalEid] = Date.now();
      setGoalContract(world, goalEid, {
        version: 1,
        kind: "custom",
        params: { workflow: "kanban_wiki" },
        success: {
          type: "all_of",
          conditions: [
            { type: "kanban_card_in_column", boardName: "Team Board", cardTitle: "Fix add()", columnName: "Done" },
            { type: "doc_contains", title: "Spec: Fix add()", includes: "Acceptance Criteria" },
          ],
        },
        description: Goal.description[goalEid],
      });

      return { world, registry, objectManager, agentEid: agent, goalEid, roomEid: room };
    },
  });

  tasks.push({
    id: "pickup_keycard",
    title: "Pick up a keycard into inventory",
    supportedModes: ["contract", "llm", "llm_plan"],
    maxSteps: 25,
    setup: ({ runId }) => {
      setOfficeToolMode("scripted");
      registerBuiltinOfficeTools();

      const world = createArgosWorld(`Suite:${runId}:pickup`) as any;
      initializePrefabs(world);
      const registry = createSystemRegistry();
      const objectManager = new ObjectManager(world);

      const goalEval = createGoalEvaluationSystem();
      goalEval.frequency = 0;
      registerSystem(registry as any, goalEval as any);
      const goalPursuit = createGoalPursuitSystem();
      goalPursuit.frequency = 0;
      registerSystem(registry as any, goalPursuit as any);

      const room = createRoomEntity(world, { name: "Office", description: "An office." });
      registerEntity(room, "Office");

      const keycard = createObjectEntity(world, {
        name: "Keycard",
        description: "A plastic keycard with a magnetic strip.",
        roomId: room,
        portable: true,
        traits: ["takeable", "examinable"],
      });
      registerEntity(keycard, "Keycard");

      const agent = createAgentEntity(world, { name: "Maya", role: "npc", systemPrompt: "x", roomId: room });
      registerEntity(agent, "Maya");

      const goalEid = addEntity(world);
      addComponent(world, goalEid, Goal);
      addComponent(world, agent, HasGoal(goalEid) as any);
      Goal.description[goalEid] = "Acquire the Keycard and hold it in your inventory.";
      Goal.priority[goalEid] = 10;
      Goal.status[goalEid] = "active";
      Goal.progress[goalEid] = 0;
      Goal.deadline[goalEid] = 0;
      Goal.createdAt[goalEid] = Date.now();
      setGoalContract(world, goalEid, {
        version: 1,
        kind: "custom",
        params: { item: "Keycard" },
        success: { type: "in_inventory", itemName: "Keycard" },
        description: Goal.description[goalEid],
      });

      return { world, registry, objectManager, agentEid: agent, goalEid, roomEid: room };
    },
  });

  tasks.push({
    id: "drawer_keycard",
    title: "Retrieve a keycard from a drawer (open → pickup)",
    supportedModes: ["contract", "llm", "llm_plan"],
    maxSteps: 35,
    setup: ({ runId }) => {
      setOfficeToolMode("scripted");
      registerBuiltinOfficeTools();

      const world = createArgosWorld(`Suite:${runId}:drawer`) as any;
      initializePrefabs(world);
      const registry = createSystemRegistry();
      const objectManager = new ObjectManager(world);

      const goalEval = createGoalEvaluationSystem();
      goalEval.frequency = 0;
      registerSystem(registry as any, goalEval as any);
      const goalPursuit = createGoalPursuitSystem();
      goalPursuit.frequency = 0;
      registerSystem(registry as any, goalPursuit as any);

      const room = createRoomEntity(world, { name: "Office", description: "An office with a desk." });
      registerEntity(room, "Office");

      // Drawer device
      const drawerType = `drawer_suite_${safeIdent(runId)}`;
      worldSchema.defineObjectType({
        name: drawerType,
        description: "A desk drawer.",
        traits: ["drawer_openable", "examinable"],
        states: { closed: { description: "A desk drawer is closed.", traits: ["drawer_openable"] } },
        defaultState: "closed",
        category: "container",
      });
      // Opening the drawer transfers the Keycard into the room (simple, benchmark-focused).
      worldSchema.defineAffordance({
        name: `open_${drawerType}`,
        requires: ["drawer_openable"],
        effects: [{ type: "transfer", target: "Keycard", containerName: "room" }],
      });

      const drawer = objectManager.spawn(drawerType, { name: "Desk Drawer", containedIn: room })!;
      registerEntity(drawer, "Desk Drawer");

      const keycard = createObjectEntity(world, {
        name: "Keycard",
        description: "A plastic keycard with a magnetic strip.",
        portable: true,
        traits: ["takeable", "examinable"],
      });
      registerEntity(keycard, "Keycard");
      // Put the keycard inside the drawer.
      setLocatedIn(world, keycard, drawer);

      const agent = createAgentEntity(world, { name: "Maya", role: "npc", systemPrompt: "x", roomId: room });
      registerEntity(agent, "Maya");

      const goalEid = addEntity(world);
      addComponent(world, goalEid, Goal);
      addComponent(world, agent, HasGoal(goalEid) as any);
      Goal.description[goalEid] = "Retrieve the Keycard from the Desk Drawer and hold it in your inventory.";
      Goal.priority[goalEid] = 10;
      Goal.status[goalEid] = "active";
      Goal.progress[goalEid] = 0;
      Goal.deadline[goalEid] = 0;
      Goal.createdAt[goalEid] = Date.now();
      setGoalContract(world, goalEid, {
        version: 1,
        kind: "custom",
        params: { item: "Keycard", container: "Desk Drawer" },
        success: { type: "in_inventory", itemName: "Keycard" },
        description: Goal.description[goalEid],
      });

      return { world, registry, objectManager, agentEid: agent, goalEid, roomEid: room };
    },
  });

  tasks.push({
    id: "lockbox_secret_mult_room",
    title: "Retrieve a secret from a locked box (travel for key → unlock → open → pickup)",
    supportedModes: ["contract", "llm", "llm_plan"],
    maxSteps: 60,
    setup: ({ runId }) => {
      setOfficeToolMode("scripted");
      registerBuiltinOfficeTools();

      const world = createArgosWorld(`Suite:${runId}:lockbox`) as any;
      initializePrefabs(world);
      const registry = createSystemRegistry();
      const objectManager = new ObjectManager(world);

      const goalEval = createGoalEvaluationSystem();
      goalEval.frequency = 0;
      registerSystem(registry as any, goalEval as any);
      const goalPursuit = createGoalPursuitSystem();
      goalPursuit.frequency = 0;
      registerSystem(registry as any, goalPursuit as any);

      const hallway = createRoomEntity(world, { name: "Hallway", description: "A quiet hallway." });
      const office = createRoomEntity(world, { name: "Office", description: "An office with a lockbox." });
      registerEntity(hallway, "Hallway");
      registerEntity(office, "Office");

      // Key (must be carried to satisfy unlock's actorRequires hasKey)
      const key = createObjectEntity(world, {
        name: "Small Key",
        description: "A small brass key.",
        roomId: hallway,
        portable: true,
        traits: ["takeable", "examinable", "hasKey"],
      });
      registerEntity(key, "Small Key");

      const unique = safeIdent(runId);
      const lockboxType = `lockbox_suite_${unique}`;
      worldSchema.defineObjectType({
        name: lockboxType,
        description: "A small lockbox.",
        traits: ["lockable", "examinable"],
        states: {
          // When locked, you can unlock it, but you cannot open/close it.
          locked: { description: "A lockbox sits here, locked.", traits: ["lockable", "locked", "examinable"] },
          // When closed, it becomes openable.
          closed: { description: "A lockbox sits here, closed.", traits: ["lockable", "openable", "examinable"] },
          open: { description: "A lockbox sits here, open.", traits: ["lockable", "openable", "open", "examinable"] },
        },
        defaultState: "locked",
        category: "container",
      });

      const lockbox = objectManager.spawn(lockboxType, { name: "Lockbox", containedIn: office })!;
      registerEntity(lockbox, "Lockbox");

      const secret = createObjectEntity(world, {
        name: "Secret Note",
        description: "A folded note with sensitive information.",
        portable: true,
        traits: ["takeable", "examinable"],
      });
      registerEntity(secret, "Secret Note");
      setLocatedIn(world, secret, lockbox);

      const agent = createAgentEntity(world, { name: "Rin", role: "npc", systemPrompt: "x", roomId: office });
      registerEntity(agent, "Rin");

      const goalEid = addEntity(world);
      addComponent(world, goalEid, Goal);
      addComponent(world, agent, HasGoal(goalEid) as any);
      Goal.description[goalEid] =
        "Obtain the Secret Note from the Lockbox. If you need a key, travel to get it, then unlock and open the Lockbox and retrieve the note.";
      Goal.priority[goalEid] = 10;
      Goal.status[goalEid] = "active";
      Goal.progress[goalEid] = 0;
      Goal.deadline[goalEid] = 0;
      Goal.createdAt[goalEid] = Date.now();
      setGoalContract(world, goalEid, {
        version: 1,
        kind: "custom",
        params: { item: "Secret Note", container: "Lockbox", key: "Small Key" },
        success: { type: "in_inventory", itemName: "Secret Note" },
        description: Goal.description[goalEid],
      });

      return { world, registry, objectManager, agentEid: agent, goalEid, roomEid: office };
    },
  });

  return tasks;
}

async function main() {
  disableKnowledgeExtractionForBenchmarks();

  const args = parseArgs(process.argv.slice(2));
  const runIdBase = isoDirStamp();
  const outDir = args.out?.trim() ? args.out.trim() : path.join("stress-test-output", `grounded-task-suite-${runIdBase}`);
  ensureDir(outDir);

  const tasks = makeTasks().filter((t) => (!args.tasks?.length ? true : args.tasks.includes(t.id)));
  assert(tasks.length > 0, "No tasks selected");

  const suiteMeta = { ts: Date.now(), kind: "suite_start", mode: args.mode, runs: args.runs, tasks: tasks.map((t) => t.id) };
  writeJsonlLine(path.join(outDir, "scores.jsonl"), suiteMeta);

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (let runIndex = 0; runIndex < args.runs; runIndex++) {
    const runId = `${runIdBase}_run${runIndex}`;
    for (const task of tasks) {
      const res = await runOneTask(task, args.mode, runId, outDir, runIndex);
      if (res.status === "passed") passed++;
      else if (res.status === "failed") failed++;
      else skipped++;
    }
  }

  writeJsonlLine(path.join(outDir, "scores.jsonl"), { ts: Date.now(), kind: "suite_end", mode: args.mode, passed, failed, skipped });

  console.log(`[Suite] Done. mode=${args.mode} passed=${passed} failed=${failed} skipped=${skipped} out=${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
