/**
 * Behavioral Benchmark: CEO autoteams an org to resolve an office incident (multi-ticket)
 *
 * Goal:
 * - A CEO agent receives a single mission.
 * - CEO sets up governance + staffing governors + a Kanban backlog.
 * - Staffing governors spawn role-scoped workers who complete the tickets using grounded tools.
 *
 * Run:
 *   OFFICE_TOOLS_ALLOW_SHELL=1 npx tsx src/behavioral-tests/67-ceo-autoteam-incident-benchmark.ts
 *
 * Output:
 *   stress-test-output/ceo-autoteam-incident/<runId>/{events.jsonl,scores.jsonl}
 */
import "dotenv/config";

import * as fs from "node:fs";
import * as path from "node:path";

import { addComponent, addEntity, entityExists, hasComponent, query } from "bitecs";

import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../ecs/prefabs";
import { Agent, Goal, KanbanBoard, KanbanCard, KanbanColumn, Name, OrgStaffingGovernor, PendingToolJob } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { listDirectContents } from "../ecs/location";
import { ObjectManager, worldSchema } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { runPlanningSystem } from "../cognition/planning-system";
import { agentThink } from "../cognition/agent-mind";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { setOfficeToolMode } from "../office-tools/tool-registry";
import { createGoalEvaluationSystem } from "../systems/builtin-systems";
import { createOrgStaffingGovernorSystem } from "../systems/org-staffing-governor-system";
import { createOfficeToolJobSystem } from "../systems/office-tool-job-system";
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
  let maxTicks = 500;
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith("--outDir=")) outDir = raw.slice("--outDir=".length);
    if (raw.startsWith("--maxTicks=")) maxTicks = Math.max(50, Math.min(5000, Number(raw.slice("--maxTicks=".length)) || 500));
  }
  return { outDir, maxTicks };
}

function normalize(s: string): string {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function findBoardEid(world: any, boardName: string): number | undefined {
  const wanted = normalize(boardName);
  for (const eid of Array.from(query(world as any, [KanbanBoard] as any))) {
    if (!entityExists(world as any, eid)) continue;
    if (normalize(Name.value[eid] || "") === wanted) return eid;
  }
  for (const eid of Array.from(query(world as any, [Name] as any))) {
    if (!entityExists(world as any, eid)) continue;
    if (normalize(Name.value[eid] || "") === wanted) return eid;
  }
  return undefined;
}

function findColumnEid(world: any, boardEid: number, columnName: string): number | undefined {
  const wanted = normalize(columnName);
  for (const col of listDirectContents(world as any, boardEid)) {
    if (!entityExists(world as any, col)) continue;
    if (!hasComponent(world as any, col, KanbanColumn as any)) continue;
    const n = normalize(String(Name.value[col] || KanbanColumn.name[col] || ""));
    if (n === wanted) return col;
  }
  return undefined;
}

function countCards(world: any, colEid: number): number {
  let n = 0;
  for (const child of listDirectContents(world as any, colEid)) {
    if (!entityExists(world as any, child)) continue;
    if (!hasComponent(world as any, child, KanbanCard as any)) continue;
    n++;
  }
  return n;
}

function countCardsOnBoard(world: any, boardEid: number): number {
  let n = 0;
  for (const col of listDirectContents(world as any, boardEid)) {
    if (!entityExists(world as any, col)) continue;
    if (!hasComponent(world as any, col, KanbanColumn as any)) continue;
    n += countCards(world, col);
  }
  return n;
}

function isAllTicketsDone(world: any, boardName: string, minCards: number): boolean {
  const boardEid = findBoardEid(world, boardName);
  if (boardEid === undefined || !entityExists(world as any, boardEid)) return false;

  const backlog = findColumnEid(world, boardEid, "Backlog");
  const inProgress = findColumnEid(world, boardEid, "In Progress");
  const review = findColumnEid(world, boardEid, "Review");
  const done = findColumnEid(world, boardEid, "Done");
  if (backlog === undefined || inProgress === undefined || review === undefined || done === undefined) return false;

  const total = countCardsOnBoard(world, boardEid);
  if (total < minCards) return false;
  return countCards(world, backlog) === 0 && countCards(world, inProgress) === 0 && countCards(world, review) === 0 && countCards(world, done) === total;
}

async function main() {
  if (process.env.OFFICE_TOOLS_ALLOW_SHELL !== "1") {
    console.log("SKIP: set OFFICE_TOOLS_ALLOW_SHELL=1 to run this shell-backed benchmark");
    process.exit(0);
  }
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
    console.log("SKIP: set GOOGLE_GENERATIVE_AI_API_KEY to run this LLM-backed benchmark");
    process.exit(0);
  }
  process.env.ARGOS_DISABLE_KNOWLEDGE_EXTRACTION = "1";
  // This benchmark is meant to exercise: LLM planning → deterministic execution.
  // Disable per-tick freeform LLM action selection (it tends to misuse `gemini_cli` as a shell).
  process.env.COGNITION_DISABLE_LLM_ACTION_SELECTION = "1";
  // Allow LLM coding via gemini.cli in the office tool sandbox.
  process.env.OFFICE_TOOLS_ALLOW_GEMINI_CLI = "1";
  // Allow applying unified diffs produced by gemini_cli inside the sandbox workspace.
  process.env.OFFICE_TOOLS_ALLOW_GIT_APPLY = "1";
  // Keep CLI rounds bounded so one stuck call does not consume the whole benchmark budget.
  process.env.OFFICE_TOOLS_GEMINI_TIMEOUT_MAX_MS = "60000";

  const args = parseArgs();
  const runId = `ceo-autoteam-incident-${Date.now()}`;
  const outDir = path.resolve(args.outDir || path.join(process.cwd(), "stress-test-output", "ceo-autoteam-incident", runId));
  const eventsPath = path.join(outDir, "events.jsonl");
  const scoresPath = path.join(outDir, "scores.jsonl");

  setOfficeToolMode("shell");
  registerBuiltinOfficeTools();

  const unique = String(Date.now());
  const boardType = `kanban_board_device_ceo_incident_${unique}`;
  worldSchema.defineObjectType({
    name: boardType,
    description: "A shared kanban board device",
    traits: ["kanban_board", "examinable"],
    states: { idle: { description: "A kanban board is ready.", traits: ["kanban_board"] } },
    defaultState: "idle",
    category: "office",
  } as any);
  worldSchema.defineAffordance({
    name: "kanban_init",
    requires: ["kanban_board"],
    effects: [{ type: "run_tool", toolId: "kanban.init", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
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

  const orgConsoleType = `org_console_device_${unique}`;
  worldSchema.defineObjectType({
    name: orgConsoleType,
    description: "An org console for configuring governance and staffing",
    traits: ["org_console", "examinable"],
    states: { idle: { description: "An org console for configuring governance and staffing.", traits: ["org_console"] } },
    defaultState: "idle",
    category: "office",
  } as any);
  worldSchema.defineAffordance({
    name: "org_set_governance",
    requires: ["org_console"],
    effects: [{ type: "run_tool", toolId: "org.set_governance", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  } as any);
  worldSchema.defineAffordance({
    name: "org_upsert_staffing_governor",
    requires: ["org_console"],
    effects: [{ type: "run_tool", toolId: "org.upsert_staffing_governor", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  } as any);

  const world = createArgosWorld("CeoAutoteamIncidentBenchmark") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  const goalEval = createGoalEvaluationSystem();
  goalEval.frequency = 0;
  registerSystem(registry as any, goalEval as any);

  const officeJobs = createOfficeToolJobSystem();
  officeJobs.frequency = 0;
  registerSystem(registry as any, officeJobs as any);

  const staffingSystem = createOrgStaffingGovernorSystem();
  staffingSystem.frequency = 0;
  registerSystem(registry as any, staffingSystem as any);

  writeJsonlLine(scoresPath, { ts: Date.now(), kind: "run_start", runId, maxTicks: args.maxTicks });

  const office = createRoomEntity(world as any, { name: "Office", description: "A shared office for a small product team." });
  registerEntity(office, "Office");
  const board = objectManager.spawn(boardType, { name: "Team Board", containedIn: office })!;
  registerEntity(board, "Team Board");
  const orgConsole = objectManager.spawn(orgConsoleType, { name: "Org Console", containedIn: office })!;
  registerEntity(orgConsole, "Org Console");
  const workstation = objectManager.spawn("computer", { name: "Workstation", state: "powered_on", containedIn: office })!;
  registerEntity(workstation, "Workstation");

  // Seed fixture and initial failing CI check before governance gates are configured.
  const admin = createAgentEntity(world as any, { name: "Admin", role: "admin", systemPrompt: "x", roomId: office });
  registerEntity(admin, "Admin");
  Agent.active[admin] = false;
  executeActions(
    world as any,
    [
      { eid: admin, action: { type: "interact", target: "Workstation", content: 'init_workspace_fixture {"fixtureId":"office_incident_1"}' } },
      { eid: admin, action: { type: "interact", target: "Workstation", content: "run_command node ci.cjs" } },
    ] as any,
    registry as any
  );

  const ceo = createAgentEntity(world as any, { name: "Casey", role: "ceo", systemPrompt: "x", roomId: office });
  registerEntity(ceo, "Casey");

  const missionGoal = addEntity(world as any);
  addComponent(world as any, missionGoal, Goal as any);
  addComponent(world as any, ceo, HasGoal(missionGoal) as any);
  Goal.description[missionGoal] =
    "Mission: Resolve an office incident in the shared Workstation (workspace fixture already initialized). " +
    "The workspace has failing CI (`node ci.cjs`). You must coordinate through Team Board and Org Console. " +
    "Deliverables: (a) fix the invoice math bug, (b) write an incident report + runbook update, (c) QA verifies CI passes and closes. " +
    "Steps you must do first: " +
    "(1) Initialize the Team Board columns Backlog, In Progress, Review, Done using JSON args. " +
    "(2) Configure org governance with WIP limit 2, Done requires recent passing `terminal.run` of `node ci.cjs`, and require Review before Done. " +
    "(3) Create staffing governors (Org Console) for each role prefix you introduce, with boardName set to Team Board. Use prefixes [ENG], [PM], [QA]. " +
    "(4) Create 3 tickets in Backlog (ENG fix, PM docs, QA verify). " +
    "Ticket descriptions: include the sentence 'Do not re-init the workspace fixture.' and mention `node ci.cjs`. " +
    "Also include a separate line that starts with the word Writes then a colon then ONLY a comma-separated list of file paths (no extra prose). " +
    "Use DependsOn lines to sequence: QA depends on ENG and PM; PM may depend on ENG if needed. " +
    "After setup, stop creating/updating cards and let the team execute.";
  Goal.priority[missionGoal] = 20;
  Goal.status[missionGoal] = "active";
  Goal.progress[missionGoal] = 0;
  Goal.deadline[missionGoal] = 0;
  Goal.createdAt[missionGoal] = Date.now();

  writeJsonlLine(scoresPath, { ts: Date.now(), kind: "phase_start", phase: "run" });

  let actions = 0;
  let toolResults = 0;
  let toolFailures = 0;
  let ceoBootstrapComplete = false;

  const started = Date.now();
  for (let tick = 0; tick < args.maxTicks; tick++) {
    runSystems(world as any, registry as any, tick, 16);

    const staffingCount = Array.from(query(world as any, [OrgStaffingGovernor] as any)).filter((eid) => entityExists(world as any, eid)).length;
    const boardEid = findBoardEid(world as any, "Team Board");
    const cardCount = boardEid !== undefined && entityExists(world as any, boardEid) ? countCardsOnBoard(world as any, boardEid) : 0;
    if (!ceoBootstrapComplete && staffingCount >= 2 && cardCount >= 3) {
      ceoBootstrapComplete = true;
      Goal.status[missionGoal] = "completed";
      Agent.active[ceo] = false;
      writeJsonlLine(scoresPath, { ts: Date.now(), kind: "milestone", tick, milestone: "ceo_bootstrap_complete", staffingCount, cardCount });
    }

    if (tick === 0 || tick % 16 === 0) {
      await runPlanningSystem(world as any);
    }

    const agents = Array.from(query(world as any, [Agent] as any))
      .filter((eid) => entityExists(world as any, eid))
      .filter((eid) => Agent.active[eid] !== false)
      .filter((eid) => String(Name.value[eid] || "") !== "Admin");

    const batch: Array<{ eid: number; action: any }> = [];
    for (const eid of agents) {
      let action = await agentThink(world as any, eid);
      // Avoid noisy duplicate actions while async tool jobs are pending (terminal/CLI).
      if (
        action?.type === "interact" &&
        typeof action.content === "string" &&
        action.content.trim() &&
        hasComponent(world as any, eid, PendingToolJob as any)
      ) {
        const token = action.content.trim().split(/\s+/)[0] || "";
        const aff = token.trim().toLowerCase().replace(/[^a-z0-9_-]+$/g, "");
        const expectedToolId = aff === "run_command" ? "terminal.run" : aff === "gemini_cli" ? "gemini.cli" : "";
        if (expectedToolId && String(PendingToolJob.toolId[eid] || "") === expectedToolId) {
          action = { type: "wait" };
        }
      }

      if (action && action.type && action.type !== "wait") batch.push({ eid, action });
    }
    if (batch.length) {
      actions += batch.length;
      writeJsonlLine(eventsPath, { ts: Date.now(), kind: "actions", tick, actions: batch });
      executeActions(world as any, batch as any, registry as any);
    }

    const stimuli = drainPendingStimuli();
    for (const s of stimuli) {
      if (s.type === "tool_result") {
        toolResults++;
        if (typeof s.content === "string" && s.content.includes("ok: false")) toolFailures++;
      }
      writeJsonlLine(eventsPath, { ts: Date.now(), kind: "stimulus", tick, ...s });
    }

    runSystems(world as any, registry as any, tick, 16);
    const pendingJobs = Array.from(query(world as any, [PendingToolJob] as any)).filter((eid) => entityExists(world as any, eid)).length > 0;
    const yieldMs = pendingJobs && batch.length === 0 ? 200 : 50;
    await yieldForOfficeToolJobs(world as any, yieldMs);

    if (tick % 25 === 0) {
      writeJsonlLine(scoresPath, {
        ts: Date.now(),
        kind: "tick",
        tick,
        staffingGovernors: staffingCount,
        agents: agents.map((eid) => ({ name: String(Name.value[eid] || ""), role: String(Agent.role[eid] || "") })),
      });
    }

    if (isAllTicketsDone(world as any, "Team Board", 3)) {
      writeJsonlLine(scoresPath, { ts: Date.now(), kind: "milestone", tick, milestone: "all_tickets_done" });
      break;
    }
  }

  const durationMs = Date.now() - started;
  const completed = isAllTicketsDone(world as any, "Team Board", 3);
  const rawScore = Math.max(0, Math.round(100 - toolFailures * 8 - Math.max(0, durationMs / 1000 - 90) * 0.2));
  const score = completed ? rawScore : Math.min(49, rawScore);
  writeJsonlLine(scoresPath, { ts: Date.now(), kind: "phase_end", phase: "run", durationMs, actions, toolResults, toolFailures, rawScore, score, completed });

  assert(completed, "expected CEO-created tickets to be completed (all cards in Done)");
  console.log(`✓ CEO autoteam incident benchmark passed. Output: ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
