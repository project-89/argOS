/**
 * Behavioral Benchmark: Product-team swarm (PM + Designer + Engineer + QA)
 *
 * Goal:
 * - Prove "useful work" emerges through shared org substrate (Kanban + Wiki) + grounded tools (Computer workspace/terminal).
 * - Exercise action grounding: agents must complete deterministic goal contracts using in-world affordances.
 * - Exercise learning: completed plans compile into reusable macros; a second pass should succeed with no plans/LLMs.
 *
 * Run:
 *   OFFICE_TOOLS_ALLOW_SHELL=1 npx tsx src/behavioral-tests/56-product-team-swarm-benchmark.ts
 *
 * Output:
 *   stress-test-output/product-team-swarm/<runId>/{events.jsonl,scores.jsonl}
 */
import "dotenv/config";

import * as fs from "node:fs";
import * as path from "node:path";

import { addComponent, addEntity, entityExists } from "bitecs";

import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Goal, PendingToolJob } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { ObjectManager, worldSchema } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { setGoalContract } from "../cognition/goal-contract";
import { createGoalEvaluationSystem } from "../systems/builtin-systems";
import { createOfficeToolJobSystem } from "../systems/office-tool-job-system";
import { createPlanEntity, getNextPlannedAction } from "../cognition/planning-system";
import { agentThink } from "../cognition/agent-mind";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { setOfficeToolMode } from "../office-tools/tool-registry";
import { yieldForOfficeToolJobs } from "./helpers/office-async";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

function stripControlAndAnsi(input: string): string {
  const s = String(input ?? "");
  // Strip ANSI escape sequences (CSI + OSC).
  const noAnsi = s
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
  // Strip remaining control characters except tab/newline/carriage-return.
  return noAnsi.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");
}

function sanitizeJsonl(value: any): any {
  if (typeof value === "string") return stripControlAndAnsi(value);
  if (Array.isArray(value)) return value.map(sanitizeJsonl);
  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeJsonl(v);
    return out;
  }
  return value;
}

function writeJsonlLine(filePath: string, obj: any): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(sanitizeJsonl(obj)) + "\n", { encoding: "utf8" });
}

function parseArgs(): { outDir?: string; maxTicks: number } {
  let outDir: string | undefined;
  let maxTicks = 220;
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith("--outDir=")) outDir = raw.slice("--outDir=".length);
    if (raw.startsWith("--maxTicks=")) maxTicks = Math.max(50, Math.min(2000, Number(raw.slice("--maxTicks=".length)) || 220));
  }
  return { outDir, maxTicks };
}

function createGoal(world: any, agentEid: number, description: string, contract: any): number {
  const goalEid = addEntity(world as any);
  addComponent(world as any, goalEid, Goal as any);
  addComponent(world as any, agentEid, HasGoal(goalEid) as any);
  Goal.description[goalEid] = description;
  Goal.priority[goalEid] = 10;
  Goal.status[goalEid] = "active";
  Goal.progress[goalEid] = 0;
  Goal.deadline[goalEid] = 0;
  Goal.createdAt[goalEid] = Date.now();
  setGoalContract(world as any, goalEid, contract);
  return goalEid;
}

function isGoalCompleted(world: any, goalEid: number): boolean {
  return String(Goal.status[goalEid] || "") === "completed";
}

function clearAllGoals(world: any, goalEids: number[]): void {
  for (const gid of goalEids) {
    if (!entityExists(world as any, gid)) continue;
    Goal.status[gid] = "completed";
  }
  // Relations cleanup isn't required for this benchmark; we only use fresh goals for Phase B.
  // Keeping old goal entities avoids churn in bitecs arrays.
}

async function main() {
  if (process.env.OFFICE_TOOLS_ALLOW_SHELL !== "1") {
    console.log("SKIP: set OFFICE_TOOLS_ALLOW_SHELL=1 to run this shell-backed benchmark");
    process.exit(0);
  }

  // Keep benchmarks stable: focus on grounded planning/action, not background knowledge extraction.
  process.env.ARGOS_DISABLE_KNOWLEDGE_EXTRACTION = "1";

  const args = parseArgs();
  const runId = `product-team-swarm-${Date.now()}`;
  const outDir = path.resolve(args.outDir || path.join(process.cwd(), "stress-test-output", "product-team-swarm", runId));
  const eventsPath = path.join(outDir, "events.jsonl");
  const scoresPath = path.join(outDir, "scores.jsonl");

  setOfficeToolMode("shell");
  registerBuiltinOfficeTools();

  // Define minimal “org substrate” devices as world-schema object types for this benchmark run.
  const unique = String(Date.now());
  const boardType = `kanban_board_device_swarm_${unique}`;
  const wikiType = `wiki_terminal_device_swarm_${unique}`;
  worldSchema.defineObjectType({
    name: boardType,
    description: "A shared kanban board device",
    traits: ["kanban_board", "examinable"],
    states: { idle: { description: "A kanban board is ready.", traits: ["kanban_board"] } },
    defaultState: "idle",
    category: "office",
  } as any);
  worldSchema.defineObjectType({
    name: wikiType,
    description: "A shared wiki terminal",
    traits: ["wiki_terminal", "examinable"],
    states: { idle: { description: "A wiki terminal is ready.", traits: ["wiki_terminal"] } },
    defaultState: "idle",
    category: "office",
  } as any);
  worldSchema.defineAffordance({
    name: "kanban_init",
    requires: ["kanban_board"],
    effects: [{ type: "run_tool", toolId: "kanban.init", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  } as any);
  worldSchema.defineAffordance({
    name: "kanban_list",
    requires: ["kanban_board"],
    effects: [{ type: "run_tool", toolId: "kanban.list", toolInputFrom: "static", toolInput: {}, toolResultType: "tool_result" }],
  } as any);
  worldSchema.defineAffordance({
    name: "kanban_upsert_card",
    requires: ["kanban_board"],
    effects: [{ type: "run_tool", toolId: "kanban.upsert_card", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  } as any);
  worldSchema.defineAffordance({
    name: "kanban_move_card",
    requires: ["kanban_board"],
    effects: [{ type: "run_tool", toolId: "kanban.move_card", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  } as any);
  worldSchema.defineAffordance({
    name: "wiki_upsert_doc",
    requires: ["wiki_terminal"],
    effects: [{ type: "run_tool", toolId: "wiki.upsert_doc", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  } as any);
  worldSchema.defineAffordance({
    name: "wiki_read",
    requires: ["wiki_terminal"],
    effects: [{ type: "run_tool", toolId: "wiki.read", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  } as any);
  worldSchema.defineAffordance({
    name: "wiki_ensure_contains",
    requires: ["wiki_terminal"],
    effects: [{ type: "run_tool", toolId: "wiki.ensure_contains", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  } as any);
  worldSchema.defineAffordance({
    name: "wiki_append",
    requires: ["wiki_terminal"],
    effects: [{ type: "run_tool", toolId: "wiki.append", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  } as any);

  const world = createArgosWorld("ProductTeamSwarmBenchmark") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  const goalEval = createGoalEvaluationSystem();
  goalEval.frequency = 0;
  registerSystem(registry as any, goalEval as any);

  const officeJobs = createOfficeToolJobSystem();
  officeJobs.frequency = 0;
  registerSystem(registry as any, officeJobs as any);

  writeJsonlLine(scoresPath, { ts: Date.now(), kind: "run_start", runId, maxTicks: args.maxTicks });

  const room = createRoomEntity(world as any, { name: "Office", description: "A small office with shared devices." });
  registerEntity(room, "Office");

  const board = objectManager.spawn(boardType, { name: "Team Board", containedIn: room })!;
  registerEntity(board, "Team Board");
  const wiki = objectManager.spawn(wikiType, { name: "Wiki", containedIn: room })!;
  registerEntity(wiki, "Wiki");

  const workstation = objectManager.spawn("computer", { name: "Workstation", state: "powered_on", containedIn: room })!;
  registerEntity(workstation, "Workstation");

  // Agents (roles are narrative-only right now; coordination happens through shared ECS tools).
  const pm = createAgentEntity(world as any, { name: "Parker", role: "pm", systemPrompt: "x", roomId: room });
  registerEntity(pm, "Parker");
  const designer = createAgentEntity(world as any, { name: "Drew", role: "designer", systemPrompt: "x", roomId: room });
  registerEntity(designer, "Drew");
  const engineer = createAgentEntity(world as any, { name: "Evan", role: "engineer", systemPrompt: "x", roomId: room });
  registerEntity(engineer, "Evan");
  const qa = createAgentEntity(world as any, { name: "Quinn", role: "qa", systemPrompt: "x", roomId: room });
  registerEntity(qa, "Quinn");

  // ------------------------
  // Phase A: Scripted plans
  // ------------------------
  writeJsonlLine(scoresPath, { ts: Date.now(), kind: "phase_start", phase: "A_scripted_plans" });

  const pmGoal = createGoal(world, pm, "Initialize the board and create the task card.", {
    version: 1,
    kind: "custom",
    params: { workflow: "kanban_wiki" },
    success: { type: "kanban_card_in_column", boardName: "Team Board", cardTitle: "Fix add()", columnName: "Backlog" },
    description: "Create a kanban card titled Fix add() in Backlog.",
  });

  const designerGoal = createGoal(world, designer, "Write a spec with acceptance criteria.", {
    version: 1,
    kind: "custom",
    params: { workflow: "kanban_wiki" },
    success: {
      type: "all_of",
      conditions: [
        { type: "doc_contains", title: "Fix add() Spec", includes: "Acceptance Criteria" },
        { type: "doc_contains", title: "Fix add() Spec", includes: "PASS" },
      ],
    },
    description: "Write a wiki doc Fix add() Spec with acceptance criteria.",
  });

  const engineerGoal = createGoal(world, engineer, "Fix the bug in add() so the test passes.", {
    version: 1,
    kind: "custom",
    params: {},
    success: {
      type: "all_of",
      conditions: [
        { type: "tool_exit_code_equals", toolId: "terminal.run", commandIncludes: "node test.cjs", equals: 0 },
        { type: "tool_stdout_includes", toolId: "terminal.run", commandIncludes: "node test.cjs", includes: "PASS" },
        { type: "kanban_card_in_column", boardName: "Team Board", cardTitle: "Fix add()", columnName: "Review" },
      ],
    },
    description: "Make `node test.cjs` pass in the workspace.",
  });

  const qaGoal = createGoal(world, qa, "Verify the fix and move the card to Done.", {
    version: 1,
    kind: "custom",
    params: {},
    success: {
      type: "all_of",
      conditions: [
        { type: "tool_exit_code_equals", toolId: "terminal.run", commandIncludes: "node test.cjs", equals: 0 },
        { type: "kanban_card_in_column", boardName: "Team Board", cardTitle: "Fix add()", columnName: "Done" },
      ],
    },
    description: "Run tests and move Fix add() to Done.",
  });

  createPlanEntity(world as any, pm, pmGoal, {
    steps: [
      { description: "Initialize the kanban board columns.", actionType: "interact", target: "Team Board", content: 'kanban_init {"project":"Swarm","columns":["Backlog","In Progress","Review","Done"]}' },
      { description: "Create the task card in Backlog.", actionType: "interact", target: "Team Board", content: 'kanban_upsert_card {"title":"Fix add()","column":"Backlog","description":"Fix add() so tests pass."}' },
    ],
  } as any);

  createPlanEntity(world as any, designer, designerGoal, {
    steps: [
      { description: "Draft the spec doc.", actionType: "interact", target: "Wiki", content: 'wiki_upsert_doc {"title":"Fix add() Spec","body":"# Fix add() Spec\\n\\n## Acceptance Criteria\\n- `node test.cjs` prints PASS and exits 0\\n\\n## Notes\\n- The add() function must return a+b.\\n","status":"draft"}' },
      { description: "Append a quick QA hint.", actionType: "interact", target: "Wiki", content: 'wiki_append {"title":"Fix add() Spec","text":"\\n## Verification\\n- Run `node test.cjs` and confirm it prints PASS\\n"}' },
    ],
  } as any);

  createPlanEntity(world as any, engineer, engineerGoal, {
    steps: [
      { description: "Ensure the board has workflow columns.", actionType: "interact", target: "Team Board", content: 'kanban_init {"project":"Swarm","columns":["Backlog","In Progress","Review","Done"]}' },
      { description: "Initialize workspace fixture.", actionType: "interact", target: "Workstation", content: 'init_workspace_fixture {"fixtureId":"node_bugfix_1"}' },
      { description: "Run failing test.", actionType: "interact", target: "Workstation", content: "run_command node test.cjs", allowFailure: true },
      { description: "Read buggy file.", actionType: "interact", target: "Workstation", content: 'read_file {"path":"math.cjs"}' },
      { description: "Fix add().", actionType: "interact", target: "Workstation", content: 'write_file {"path":"math.cjs","content":"exports.add = (a, b) => a + b;\\n"}' },
      { description: "Rerun test.", actionType: "interact", target: "Workstation", content: "run_command node test.cjs" },
      { description: "Move card to Review.", actionType: "interact", target: "Team Board", content: 'kanban_move_card {"title":"Fix add()","toColumn":"Review"}' },
    ],
  } as any);

  createPlanEntity(world as any, qa, qaGoal, {
    steps: [
      { description: "Verify test passes.", actionType: "interact", target: "Workstation", content: "run_command node test.cjs" },
      { description: "Move card to Done.", actionType: "interact", target: "Team Board", content: 'kanban_move_card {"title":"Fix add()","toColumn":"Done"}' },
      { description: "Mark spec as done.", actionType: "interact", target: "Wiki", content: 'wiki_upsert_doc {"title":"Fix add() Spec","status":"done"}' },
    ],
  } as any);

  const agents = [
    { eid: pm, name: "Parker", goalEid: pmGoal },
    { eid: designer, name: "Drew", goalEid: designerGoal },
    { eid: engineer, name: "Evan", goalEid: engineerGoal },
    { eid: qa, name: "Quinn", goalEid: qaGoal },
  ];

  let toolResults = 0;
  let toolFailures = 0;
  let actions = 0;
  let ticksA = 0;

  const tickPhaseAStart = Date.now();
  for (let tick = 0; tick < args.maxTicks; tick++) {
    ticksA = tick + 1;
    if (agents.every((a) => isGoalCompleted(world, a.goalEid))) break;

    const batch: Array<{ eid: number; action: any }> = [];
    for (const a of agents) {
      if (isGoalCompleted(world, a.goalEid)) continue;
      if (a.eid === qa && !isGoalCompleted(world, engineerGoal)) continue;
      const step = getNextPlannedAction(world as any, a.eid);
      if (!step) continue;
      const action = { type: step.actionType, target: step.target, content: step.content };
      if (
        action.type === "interact" &&
        typeof action.content === "string" &&
        action.content.trim() &&
        hasComponent(world as any, a.eid, PendingToolJob as any)
      ) {
        const token = action.content.trim().split(/\s+/)[0] || "";
        const aff = token.trim().toLowerCase().replace(/[^a-z0-9_-]+$/g, "");
        const expectedToolId = aff === "run_command" ? "terminal.run" : aff === "gemini_cli" ? "gemini.cli" : "";
        if (expectedToolId && String(PendingToolJob.toolId[a.eid] || "") === expectedToolId) continue;
      }
      batch.push({ eid: a.eid, action });
    }
    if (batch.length) {
      actions += batch.length;
      writeJsonlLine(eventsPath, { ts: Date.now(), kind: "actions", phase: "A", tick, actions: batch });
      executeActions(world as any, batch as any, registry as any);
    }

    const stimuli = drainPendingStimuli();
    for (const s of stimuli) {
      if (s.type === "tool_result") {
        toolResults++;
        if (typeof s.content === "string" && s.content.includes("ok: false")) toolFailures++;
      }
      writeJsonlLine(eventsPath, { ts: Date.now(), kind: "stimulus", phase: "A", tick, ...s });
    }

    runSystems(world as any, registry as any, tick, 16);
    const pendingJobs = Array.from(query(world as any, [PendingToolJob] as any)).filter((eid) => entityExists(world as any, eid)).length > 0;
    const yieldMs = pendingJobs && batch.length === 0 ? 200 : 50;
    await yieldForOfficeToolJobs(world as any, yieldMs);
  }

  const tickPhaseADuration = Date.now() - tickPhaseAStart;
  const scoreA = Math.max(0, Math.round(100 - toolFailures * 25 - Math.max(0, ticksA - 60) * 0.5));
  writeJsonlLine(scoresPath, {
    ts: Date.now(),
    kind: "phase_end",
    phase: "A_scripted_plans",
    durationMs: tickPhaseADuration,
    ticks: ticksA,
    actions,
    toolResults,
    toolFailures,
    score: scoreA,
    completed: agents.map((a) => ({ name: a.name, goalCompleted: isGoalCompleted(world, a.goalEid) })),
  });

  assert(agents.every((a) => isGoalCompleted(world, a.goalEid)), "Phase A failed: expected all agents to complete their goal contracts");

  // --------------------------------
  // Phase B: No plans (macro reuse)
  // --------------------------------
  writeJsonlLine(scoresPath, { ts: Date.now(), kind: "phase_start", phase: "B_macro_reuse_no_plans" });

  // Reset shared org state (keep entities, just re-open workflow).
  // This benchmark relies on deterministic contract evaluation and learned macros to restore state.
  // - Move card back to Backlog by re-upserting it there.
  // - Clear the doc contents by overwriting it (and setting draft).
  executeActions(
    world as any,
    [
      { eid: pm, action: { type: "interact", target: "Team Board", content: 'kanban_upsert_card {"title":"Fix add()","column":"Backlog","description":"Fix add() so tests pass."}' } },
      { eid: designer, action: { type: "interact", target: "Wiki", content: 'wiki_upsert_doc {"title":"Fix add() Spec","body":"","status":"draft"}' } },
    ] as any,
    registry as any
  );
  drainPendingStimuli();
  runSystems(world as any, registry as any, 0, 16);

  clearAllGoals(world, [pmGoal, designerGoal, engineerGoal, qaGoal]);

  const pmGoalB = createGoal(world, pm, "Initialize the board and create the task card.", {
    version: 1,
    kind: "custom",
    params: { workflow: "kanban_wiki" },
    success: { type: "kanban_card_in_column", boardName: "Team Board", cardTitle: "Fix add()", columnName: "Backlog" },
    description: "Create a kanban card titled Fix add() in Backlog.",
  });
  const designerGoalB = createGoal(world, designer, "Write a spec with acceptance criteria.", {
    version: 1,
    kind: "custom",
    params: { workflow: "kanban_wiki" },
    success: {
      type: "all_of",
      conditions: [
        { type: "doc_contains", title: "Fix add() Spec", includes: "Acceptance Criteria" },
        { type: "doc_contains", title: "Fix add() Spec", includes: "PASS" },
      ],
    },
    description: "Write a wiki doc Fix add() Spec with acceptance criteria.",
  });
  const engineerGoalB = createGoal(world, engineer, "Fix the bug in add() so the test passes.", {
    version: 1,
    kind: "custom",
    params: {},
    success: {
      type: "all_of",
      conditions: [
        { type: "tool_exit_code_equals", toolId: "terminal.run", commandIncludes: "node test.cjs", equals: 0 },
        { type: "tool_stdout_includes", toolId: "terminal.run", commandIncludes: "node test.cjs", includes: "PASS" },
        { type: "kanban_card_in_column", boardName: "Team Board", cardTitle: "Fix add()", columnName: "Review" },
      ],
    },
    description: "Make `node test.cjs` pass in the workspace.",
  });
  const qaGoalB = createGoal(world, qa, "Verify the fix and move the card to Done.", {
    version: 1,
    kind: "custom",
    params: {},
    success: {
      type: "all_of",
      conditions: [
        { type: "tool_exit_code_equals", toolId: "terminal.run", commandIncludes: "node test.cjs", equals: 0 },
        { type: "kanban_card_in_column", boardName: "Team Board", cardTitle: "Fix add()", columnName: "Done" },
      ],
    },
    description: "Run tests and move Fix add() to Done.",
  });

  const phaseBAgents = [
    { eid: pm, name: "Parker", goalEid: pmGoalB },
    { eid: designer, name: "Drew", goalEid: designerGoalB },
    { eid: engineer, name: "Evan", goalEid: engineerGoalB },
    { eid: qa, name: "Quinn", goalEid: qaGoalB },
  ];

  let actionsB = 0;
  let toolResultsB = 0;
  let toolFailuresB = 0;
  let ticksB = 0;

  const tickPhaseBStart = Date.now();
  for (let tick = 0; tick < args.maxTicks; tick++) {
    ticksB = tick + 1;
    if (phaseBAgents.every((a) => isGoalCompleted(world, a.goalEid))) break;
    const batch: Array<{ eid: number; action: any }> = [];
    for (const a of phaseBAgents) {
      if (isGoalCompleted(world, a.goalEid)) continue;
      if (a.eid === qa && !isGoalCompleted(world, engineerGoalB)) continue;
      let action = await agentThink(world as any, a.eid);
      if (!action || action.type === "wait") continue;
      if (
        action.type === "interact" &&
        typeof action.content === "string" &&
        action.content.trim() &&
        hasComponent(world as any, a.eid, PendingToolJob as any)
      ) {
        const token = action.content.trim().split(/\s+/)[0] || "";
        const aff = token.trim().toLowerCase().replace(/[^a-z0-9_-]+$/g, "");
        const expectedToolId = aff === "run_command" ? "terminal.run" : aff === "gemini_cli" ? "gemini.cli" : "";
        if (expectedToolId && String(PendingToolJob.toolId[a.eid] || "") === expectedToolId) continue;
      }
      batch.push({ eid: a.eid, action });
    }
    if (batch.length) {
      actionsB += batch.length;
      writeJsonlLine(eventsPath, { ts: Date.now(), kind: "actions", phase: "B", tick, actions: batch });
      executeActions(world as any, batch as any, registry as any);
    }

    const stimuli = drainPendingStimuli();
    for (const s of stimuli) {
      if (s.type === "tool_result") {
        toolResultsB++;
        if (typeof s.content === "string" && s.content.includes("ok: false")) toolFailuresB++;
      }
      writeJsonlLine(eventsPath, { ts: Date.now(), kind: "stimulus", phase: "B", tick, ...s });
    }

    runSystems(world as any, registry as any, tick, 16);
    const pendingJobs = Array.from(query(world as any, [PendingToolJob] as any)).filter((eid) => entityExists(world as any, eid)).length > 0;
    const yieldMs = pendingJobs && batch.length === 0 ? 200 : 50;
    await yieldForOfficeToolJobs(world as any, yieldMs);
  }
  const tickPhaseBDuration = Date.now() - tickPhaseBStart;
  const scoreB = Math.max(0, Math.round(100 - toolFailuresB * 25 - Math.max(0, ticksB - 80) * 0.5));
  writeJsonlLine(scoresPath, {
    ts: Date.now(),
    kind: "phase_end",
    phase: "B_macro_reuse_no_plans",
    durationMs: tickPhaseBDuration,
    ticks: ticksB,
    actions: actionsB,
    toolResults: toolResultsB,
    toolFailures: toolFailuresB,
    score: scoreB,
    completed: phaseBAgents.map((a) => ({ name: a.name, goalCompleted: isGoalCompleted(world, a.goalEid) })),
  });

  assert(phaseBAgents.every((a) => isGoalCompleted(world, a.goalEid)), "Phase B failed: expected macro reuse to complete goals without plans/LLMs");

  const overallScore = Math.round((scoreA + scoreB) / 2);
  writeJsonlLine(scoresPath, { ts: Date.now(), kind: "run_end", runId, outDir, score: overallScore, phases: { A: scoreA, B: scoreB } });
  console.log(`✓ Product team swarm benchmark passed. Output: ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
