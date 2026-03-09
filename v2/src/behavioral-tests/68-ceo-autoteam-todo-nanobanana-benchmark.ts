/**
 * Behavioral Benchmark: CEO autoteams a product org to ship a branded Todo App (v2) with Nano Banana assets.
 *
 * Goal:
 * - CEO sets up governance + staffing + tickets.
 * - Team executes via grounded tools on shared devices (Kanban + Workstation).
 * - Design produces real image assets via Nano Banana (Gemini native image generation).
 * - Produces focused logs:
 *   - stress-test-output/ceo-autoteam/<runId>/agents/<agent>.jsonl
 *   - stress-test-output/ceo-autoteam/<runId>/comms.jsonl
 *
 * Run:
 *   OFFICE_TOOLS_ALLOW_SHELL=1 npx tsx src/behavioral-tests/68-ceo-autoteam-todo-nanobanana-benchmark.ts
 */
import "dotenv/config";

// Enable multimodal image attachments for office-benchmark roles (designer/engineer/pm/qa/ceo).
// This lets agents "see" generated UI assets without relying only on describe_image text.
process.env.COGNITION_ENABLE_MULTIMODAL_IMAGES ||= "1";
process.env.COGNITION_MULTIMODAL_IMAGE_ROLES ||= "designer,engineer,pm,qa,ceo";
process.env.COGNITION_MULTIMODAL_IMAGE_MAX ||= "2";

import * as fs from "node:fs";
import * as path from "node:path";

import { addComponent, addEntity, entityExists, getRelationTargets, hasComponent, query } from "bitecs";

import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../ecs/prefabs";
import { Agent, Goal, KanbanBoard, KanbanCard, KanbanColumn, Name, OrgStaffingGovernor, PendingToolJob, Plan, ToolResult, Thought, ConversationTurn } from "../ecs/components";
import { HasGoal, HasPlan, HasToolResult } from "../ecs/relations";
import { listDirectContents } from "../ecs/location";
import { ObjectManager, worldSchema } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { runPlanningSystem } from "../cognition/planning-system";
import { addPerception, agentThink, getAgentConversation, getAgentThoughts } from "../cognition/agent-mind";
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
  // Strip ANSI CSI sequences: ESC [ ... finalByte
  const noAnsi = s.replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, "");
  // Strip remaining C0/C1 control chars (keep \t, \n, \r).
  return noAnsi.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
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
  let maxTicks = 800;
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith("--outDir=")) outDir = raw.slice("--outDir=".length);
    if (raw.startsWith("--maxTicks=")) maxTicks = Math.max(50, Math.min(8000, Number(raw.slice("--maxTicks=".length)) || 800));
  }
  return { outDir, maxTicks };
}

function normalize(s: string): string {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function safeFileSlug(s: string): string {
  const base = String(s || "agent")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "agent";
}

function findBoardEid(world: any, boardName: string): number | undefined {
  const wanted = normalize(boardName);
  for (const eid of Array.from(query(world as any, [KanbanBoard] as any))) {
    if (!entityExists(world as any, eid)) continue;
    if (normalize(Name.value[eid] || "") === wanted) return eid;
  }
  // Board might exist but not initialized; allow selecting by name only.
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

function listCardsInColumn(world: any, colEid: number): number[] {
  const out: number[] = [];
  for (const child of listDirectContents(world as any, colEid)) {
    if (!entityExists(world as any, child)) continue;
    if (!hasComponent(world as any, child, KanbanCard as any)) continue;
    out.push(child);
  }
  return out;
}

function countCardsOnBoard(world: any, boardEid: number): number {
  let n = 0;
  for (const col of listDirectContents(world as any, boardEid)) {
    if (!entityExists(world as any, col)) continue;
    if (!hasComponent(world as any, col, KanbanColumn as any)) continue;
    n += listCardsInColumn(world as any, col).length;
  }
  return n;
}

function isAllTicketsDone(world: any, boardName: string, expectedCardCount: number): boolean {
  const boardEid = findBoardEid(world, boardName);
  if (boardEid === undefined || !entityExists(world as any, boardEid)) return false;
  const doneCol = findColumnEid(world, boardEid, "Done");
  if (doneCol === undefined) return false;
  const total = countCardsOnBoard(world, boardEid);
  if (total < expectedCardCount) return false;
  const done = listCardsInColumn(world, doneCol).length;
  return done >= expectedCardCount;
}

function snapshotBoard(world: any, boardName: string): any {
  const boardEid = findBoardEid(world, boardName);
  const cols: Record<string, any[]> = {};
  if (boardEid === undefined || !entityExists(world as any, boardEid)) return { boardName, ok: false, reason: "board_not_found" };

  for (const col of ["Backlog", "In Progress", "Review", "Done"]) {
    const colEid = findColumnEid(world, boardEid, col);
    cols[col] = [];
    if (colEid === undefined) continue;
    for (const cardEid of listCardsInColumn(world, colEid)) {
      const title = String(KanbanCard.title[cardEid] || "");
      const ownerEid = Number(KanbanCard.ownerEid[cardEid] || 0);
      const owner = ownerEid > 0 ? String(Name.value[ownerEid] || "") : "";

      let goalStatus = "";
      let goalDesc = "";
      let toolEvidence: any[] = [];

      if (ownerEid && entityExists(world as any, ownerEid)) {
        const goalEids = getRelationTargets(world as any, ownerEid, HasGoal as any) as number[];
        const needle = title.toLowerCase().slice(0, 32);
        for (const goalEid of goalEids) {
          if (!entityExists(world as any, goalEid)) continue;
          if (!hasComponent(world as any, goalEid, Goal as any)) continue;
          const desc = String(Goal.description[goalEid] || "").toLowerCase();
          if (!desc.includes(needle)) continue;
          goalStatus = String(Goal.status[goalEid] || "");
          goalDesc = String(Goal.description[goalEid] || "");
          break;
        }

        const toolEids = getRelationTargets(world as any, ownerEid, HasToolResult as any) as number[];
        const recent = toolEids
          .filter((eid) => entityExists(world as any, eid))
          .filter((eid) => hasComponent(world as any, eid, ToolResult as any))
          .sort((a, b) => Number(ToolResult.timestamp[b] || 0) - Number(ToolResult.timestamp[a] || 0))
          .slice(0, 5);
        toolEvidence = recent.map((eid) => ({
          toolId: String(ToolResult.toolId[eid] || ""),
          command: String(ToolResult.command[eid] || ""),
          exitCode: Number(ToolResult.exitCode[eid] ?? 0),
          ok: !!ToolResult.ok[eid],
          summary: String(ToolResult.summary[eid] || ""),
        }));
      }

      cols[col].push({ title, owner, ownerEid, goalStatus, goalDesc, toolEvidence });
    }
  }
  return { boardName, ok: true, cols };
}

function snapshotAgent(world: any, eid: number): any {
  const name = String(Name.value[eid] || `agent_${eid}`);
  const role = String(Agent.role[eid] || "");

  const goals: any[] = [];
  for (const goalEid of getRelationTargets(world as any, eid, HasGoal as any) as number[]) {
    if (!entityExists(world as any, goalEid)) continue;
    if (!hasComponent(world as any, goalEid, Goal as any)) continue;
    goals.push({
      goalEid,
      status: String(Goal.status[goalEid] || ""),
      priority: Number(Goal.priority[goalEid] || 0),
      description: String(Goal.description[goalEid] || ""),
    });
  }

  let plan: any = null;
  for (const planEid of getRelationTargets(world as any, eid, HasPlan as any) as number[]) {
    if (!entityExists(world as any, planEid)) continue;
    if (!hasComponent(world as any, planEid, Plan as any)) continue;
    const stepsRaw = String(Plan.steps[planEid] || "");
    let steps: any[] = [];
    try {
      const parsed = JSON.parse(stepsRaw);
      if (Array.isArray(parsed)) steps = parsed;
    } catch {
      // ignore
    }
    plan = {
      planEid,
      status: String(Plan.status[planEid] || ""),
      currentStep: Number(Plan.currentStep[planEid] || 0),
      stepsPreview: steps.slice(0, 8),
      totalSteps: steps.length,
    };
    break;
  }

  let pending: any = null;
  if (hasComponent(world as any, eid, PendingToolJob as any)) {
    pending = {
      toolId: String(PendingToolJob.toolId[eid] || ""),
      jobId: String(PendingToolJob.jobId[eid] || ""),
      command: String(PendingToolJob.command[eid] || ""),
      startedAt: Number(PendingToolJob.startedAt[eid] || 0),
    };
  }

  const toolEids = getRelationTargets(world as any, eid, HasToolResult as any) as number[];
  const recentTools = toolEids
    .filter((tr) => entityExists(world as any, tr))
    .filter((tr) => hasComponent(world as any, tr, ToolResult as any))
    .sort((a, b) => Number(ToolResult.timestamp[b] || 0) - Number(ToolResult.timestamp[a] || 0))
    .slice(0, 3)
    .map((tr) => ({
      toolId: String(ToolResult.toolId[tr] || ""),
      ok: !!ToolResult.ok[tr],
      exitCode: Number(ToolResult.exitCode[tr] ?? 0),
      command: String(ToolResult.command[tr] || ""),
      summary: String(ToolResult.summary[tr] || ""),
    }));

  return { eid, name, role, goals, plan, pendingToolJob: pending, recentTools };
}

async function main() {
  if (process.env.OFFICE_TOOLS_ALLOW_SHELL !== "1") {
    console.log("SKIP: set OFFICE_TOOLS_ALLOW_SHELL=1 to run this shell-backed benchmark");
    process.exit(0);
  }
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() && !process.env.GEMINI_API_KEY?.trim() && !process.env.GOOGLE_API_KEY?.trim()) {
    console.log("SKIP: set GOOGLE_GENERATIVE_AI_API_KEY (or GEMINI_API_KEY) to run this LLM-backed benchmark");
    process.exit(0);
  }

  // Keep benchmarks focused/stable.
  process.env.ARGOS_DISABLE_KNOWLEDGE_EXTRACTION = "1";
  process.env.COGNITION_DISABLE_LLM_ACTION_SELECTION = "1";
  process.env.OFFICE_TOOLS_ALLOW_GIT_APPLY = "1";
  process.env.OFFICE_TOOLS_ALLOW_GEMINI_CLI = "1";
  process.env.OFFICE_TOOLS_ALLOW_NANO_BANANA = "1";

  const args = parseArgs();
  const runId = `ceo-autoteam-nanobanana-${Date.now()}`;
  const outDir = path.resolve(args.outDir || path.join(process.cwd(), "stress-test-output", "ceo-autoteam", runId));
  const eventsPath = path.join(outDir, "events.jsonl");
  const scoresPath = path.join(outDir, "scores.jsonl");
  const commsPath = path.join(outDir, "comms.jsonl");
  const agentsDir = path.join(outDir, "agents");
  const thoughtsPath = path.join(outDir, "thoughts.jsonl");

  fs.mkdirSync(outDir, { recursive: true });
  // Ensure focused log files exist even if no entries are written.
  fs.writeFileSync(commsPath, "", { encoding: "utf8" });
  fs.writeFileSync(thoughtsPath, "", { encoding: "utf8" });

  setOfficeToolMode("shell");
  registerBuiltinOfficeTools();

  const unique = String(Date.now());
  const boardType = `kanban_board_device_ceo_${unique}`;
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

  const world = createArgosWorld("CeoAutoteamTodoNanoBananaBenchmark") as any;
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
  const workstation = objectManager.spawn("workstation", { name: "Workstation", state: "unoccupied", containedIn: office })!;
  registerEntity(workstation, "Workstation");

  // Seed the shared workspace fixture before governance gates are configured.
  const admin = createAgentEntity(world as any, { name: "Admin", role: "admin", systemPrompt: "x", roomId: office });
  registerEntity(admin, "Admin");
  Agent.active[admin] = false;
  executeActions(
    world as any,
    [
      { eid: admin, action: { type: "interact", target: "Workstation", content: 'init_workspace_fixture {"fixtureId":"todo_app_brand_v2_1"}' } },
      { eid: admin, action: { type: "interact", target: "Workstation", content: "run_command node ci.cjs" } },
    ] as any,
    registry as any
  );

  const ceo = createAgentEntity(world as any, {
    name: "Casey",
    role: "ceo",
    systemPrompt:
      "You are the CEO. Your job is to set up the team and process to deliver the mission via a Kanban board. Keep things simple and grounded.",
    roomId: office,
  });
  registerEntity(ceo, "Casey");

  const missionGoal = addEntity(world as any);
  addComponent(world as any, missionGoal, Goal as any);
  addComponent(world as any, ceo, HasGoal(missionGoal) as any);
  Goal.description[missionGoal] =
    "Mission: Ship the branded Todo App (Brand V2) in the shared Workstation (workspace fixture already initialized). " +
    "Workspace files you may touch for implementation/UX/design: server.cjs, public/index.html, public/app.js, public/style.css, public/assets/logo.png, README.md, data/todos.json (create dirs as needed). " +
    "Tests/CI: run `node ci.cjs` (which runs `node test.cjs`). Do not add external dependencies. " +
    "Use the Org Console and Team Board to set up a small product team that can complete the work. " +
    "Steps you must do first: " +
    "(1) Initialize the Team Board with columns Backlog, In Progress, Review, Done using JSON args like " +
    "`kanban_init {\"project\":\"Todo\",\"columns\":[\"Backlog\",\"In Progress\",\"Review\",\"Done\"]}`. " +
    "(2) Configure org governance with WIP limit 2 and a Definition of Done gate that requires a recent passing `terminal.run` of `node ci.cjs`, and require Review before Done. " +
    "Use JSON keys wipLimit, doneRequiresToolId, doneRequiresCommandIncludes, doneRequiresReview, reviewColumnName. " +
    "(3) Create staffing governors using `org_upsert_staffing_governor` for each role prefix you introduce. " +
    "Use ticket title prefixes like [ENG], [QA], [PM], [DESIGN] as needed. Tool JSON keys: boardName, defaultRole, claimTitlePrefix, maxAgents, wipPerAgent, spawnRoomName. " +
    "Set boardName to the literal string Team Board. " +
    "(4) Create 4 tickets in Backlog via `kanban_upsert_card` that together deliver: implementation, brand assets, a product/spec doc, and a QA narrative report. " +
    "In each ticket description, include a separate line that starts with the word Writes then a colon and then ONLY a comma-separated list of file paths (no extra prose on that line). " +
    "Also mention `node ci.cjs` in the ticket description so the system runs CI. " +
    "For sequencing, include a separate line that starts with DependsOn then a colon and then a comma-separated list of exact ticket titles. " +
    "Include the sentence 'Do not re-init the workspace fixture.' in any ticket that uses the Workstation. " +
    "Tickets you must create (use these exact titles so dependencies work): " +
    "(A) [DESIGN] Generate Brand Assets (Nano Banana) — Create public/assets/logo.png using the Workstation's `generate_image` affordance (Nano Banana). " +
    "Use JSON args like `generate_image {\"prompt\":\"A clean minimalist logo icon for a todo app...\",\"outPath\":\"public/assets/logo.png\",\"model\":\"gemini-2.5-flash-image\",\"aspectRatio\":\"1:1\"}`. " +
    "Ensure the file exists and is not empty. " +
    "Writes: public/assets/logo.png. " +
    "(B) [ENG] Implement Todo App Brand V2 (CLI) — UseCLI: true. Requirements: remove all TODO markers in server.cjs, public/app.js, public/index.html, public/style.css; implement server + API using only Node core modules (NO express/koa/fastify); preserve `module.exports = { startServer }`; implement required endpoints exactly as tests expect (/api/todos, filtering, PATCH text); serve /assets/logo.png; update HTML to reference /assets/logo.png; update README sections. Do not re-init the workspace fixture. " +
    "Writes: server.cjs, public/app.js, public/index.html, public/style.css, README.md, data/todos.json. " +
    "DependsOn: [DESIGN] Generate Brand Assets (Nano Banana). " +
    "(C) [PM] Product Spec — depends on ENG. Write a short spec doc at docs/spec.md describing the user stories + acceptance criteria (mention `node ci.cjs`). " +
    "Writes: docs/spec.md. " +
    "DependsOn: [ENG] Implement Todo App Brand V2 (CLI). " +
    "(D) [QA] Verify + Report — depends on ENG + PM. Run CI and write a narrative QA report at docs/qa-report.md (what was tested, results, and suggested follow-ups). " +
    "Writes: docs/qa-report.md. " +
    "DependsOn: [ENG] Implement Todo App Brand V2 (CLI), [PM] Product Spec. " +
    "After setup, stop editing tickets and let the team execute.";
  Goal.priority[missionGoal] = 20;
  Goal.status[missionGoal] = "active";
  Goal.createdAt[missionGoal] = Date.now();

  writeJsonlLine(scoresPath, { ts: Date.now(), kind: "phase_start", phase: "run" });

  const lastAgentSnap = new Map<number, string>();
  const getAgentLogPath = (eid: number) => {
    const name = String(Name.value[eid] || `agent_${eid}`);
    return path.join(agentsDir, `${safeFileSlug(name)}.jsonl`);
  };

  const getAgentThoughtLogPath = (eid: number) => {
    const name = String(Name.value[eid] || `agent_${eid}`);
    return path.join(agentsDir, `${safeFileSlug(name)}.thoughts.jsonl`);
  };

  let actions = 0;
  let toolResults = 0;
  let toolFailures = 0;
  let visionToolResults = 0;

  const lastInnerThoughtAt = new Map<number, number>();
  const lastConversationAt = new Map<number, number>();
  let imageAssetStimuli = 0;

  const started = Date.now();
  for (let tick = 0; tick < args.maxTicks; tick++) {
    runSystems(world as any, registry as any, tick, 16);

    // Replan periodically (CEO + workers) to incorporate tool failures and evolving ticket state.
    if (tick === 0 || tick % 20 === 0) {
      await runPlanningSystem(world as any);
    }

    const staffingCount = Array.from(query(world as any, [OrgStaffingGovernor] as any)).filter((eid) => entityExists(world as any, eid)).length;
    const boardEid = findBoardEid(world as any, "Team Board");
    const cardCount = boardEid !== undefined && entityExists(world as any, boardEid) ? countCardsOnBoard(world as any, boardEid) : 0;

    // Let active agents think and propose actions.
    const agents = Array.from(query(world as any, [Agent] as any)).filter((eid) => entityExists(world as any, eid) && Agent.active[eid]);

    const batch: any[] = [];
    for (const eid of agents) {
      let action: any = await agentThink(world as any, eid);

      // Emit inner thoughts + multimodal image attachment markers (if any).
      const prevThoughtAt = lastInnerThoughtAt.get(eid) || 0;
      let maxThoughtAt = prevThoughtAt;
      for (const teid of getAgentThoughts(world as any, eid)) {
        const ts = Number(Thought.timestamp[teid] || 0);
        if (!ts || ts <= prevThoughtAt) continue;
        maxThoughtAt = Math.max(maxThoughtAt, ts);
        const payload = {
          ts: Date.now(),
          kind: "inner_thought",
          tick,
          from: String(Name.value[eid] || `agent_${eid}`),
          eid,
          thoughtTs: ts,
          content: String(Thought.content[teid] || "").slice(0, 2000),
        };
        writeJsonlLine(getAgentThoughtLogPath(eid), payload);
        writeJsonlLine(thoughtsPath, payload);
      }
      if (maxThoughtAt > prevThoughtAt) lastInnerThoughtAt.set(eid, maxThoughtAt);

      const prevConvoAt = lastConversationAt.get(eid) || 0;
      let maxConvoAt = prevConvoAt;
      for (const ceid of getAgentConversation(world as any, eid)) {
        const ts = Number(ConversationTurn.timestamp[ceid] || 0);
        if (!ts || ts <= prevConvoAt) continue;
        maxConvoAt = Math.max(maxConvoAt, ts);
        const role = String(ConversationTurn.role[ceid] || "");
        const text = String(ConversationTurn.content[ceid] || "");
        if (role === "user" && text.includes("[Images attached:")) {
          const m = text.match(/\[Images attached: ([^\]]+)\]/);
          const payload = {
            ts: Date.now(),
            kind: "images_attached",
            tick,
            from: String(Name.value[eid] || `agent_${eid}`),
            eid,
            attached: m ? m[1] : "",
          };
          writeJsonlLine(getAgentThoughtLogPath(eid), payload);
          writeJsonlLine(eventsPath, payload);
        }
      }
      if (maxConvoAt > prevConvoAt) lastConversationAt.set(eid, maxConvoAt);



      // Suppress duplicate async tool actions when a PendingToolJob is already in-flight.
      if (action && action.type === "interact" && typeof action.content === "string" && action.content.trim() && hasComponent(world as any, eid, PendingToolJob as any)) {
        const token = action.content.trim().split(/\s+/)[0] || "";
        const aff = token.trim().toLowerCase().replace(/[^a-z0-9_-]+$/g, "");
        const expectedToolId =
          aff === "run_command"
            ? "terminal.run"
            : aff === "gemini_cli"
              ? "gemini.cli"
              : aff === "generate_image"
                ? "nano_banana.generate_image"
                : aff === "edit_image"
                  ? "nano_banana.edit_image"
                  : aff === "describe_image"
                    ? "vision.describe_image"
                    : "";
        if (expectedToolId && String(PendingToolJob.toolId[eid] || "") === expectedToolId) {
          action = { type: "wait" };
        }
      }

      if (action && action.type && action.type !== "wait") batch.push({ eid, action });
    }

    if (batch.length) {
      actions += batch.length;
      writeJsonlLine(eventsPath, { ts: Date.now(), kind: "actions", tick, actions: batch });

      // Focused logs: per-agent actions + comms.
      for (const item of batch) {
        const eid = Number(item.eid || 0);
        const action = item.action;
        const agentLog = getAgentLogPath(eid);
        writeJsonlLine(agentLog, { ts: Date.now(), kind: "action", tick, action });
        if (action?.type === "think") {
          const from = String(Name.value[eid] || `agent_${eid}`);
          const payload = { ts: Date.now(), kind: "thought", tick, from, eid, content: action.content || "" };
          writeJsonlLine(agentLog, payload);
          writeJsonlLine(getAgentThoughtLogPath(eid), payload);
          writeJsonlLine(thoughtsPath, payload);
        }
        if (action?.type === "speak") {
          const from = String(Name.value[eid] || `agent_${eid}`);
          writeJsonlLine(commsPath, { ts: Date.now(), kind: "speak", tick, from, target: action.target ?? null, content: action.content || "" });
        }
      }

      executeActions(world as any, batch as any, registry as any);
    }

    const stimuli = drainPendingStimuli();
    for (const s of stimuli) {
      if (s.type === "tool_result") {
        toolResults++;
        if (typeof s.content === "string" && s.content.includes("ok: false")) toolFailures++;
      }
      if (s.type === "image_asset") {
        imageAssetStimuli++;
      }
      if (s.type === "tool_result" && typeof s.content === "string" && s.content.startsWith("[Tool:vision.describe_image]")) {
        visionToolResults++;
      }

      writeJsonlLine(eventsPath, { ts: Date.now(), kind: "stimulus", tick, ...s });

      const targetEid = typeof (s as any).targetEid === "number" ? (s as any).targetEid : undefined;
      if (typeof targetEid === "number" && targetEid > 0 && entityExists(world as any, targetEid) && hasComponent(world as any, targetEid, Agent as any)) {
        // Persist stimuli as Perception so agents can react (and multimodal image attachments can see image_asset).
        addPerception(world as any, targetEid, {
          type: String((s as any).type || ""),
          content: String((s as any).content ?? ""),
          source: String((s as any).source || ""),
          intensity: typeof (s as any).intensity === "number" ? (s as any).intensity : 1,
        });
        const agentLog = getAgentLogPath(targetEid);
        writeJsonlLine(agentLog, { ts: Date.now(), kind: "stimulus", tick, ...s });
        if (String((s as any).modality || "").toLowerCase() === "cognitive") {
          const from = String((s as any).source || "");
          const payload = { ts: Date.now(), kind: "cognitive_stimulus", tick, from, eid: targetEid, type: String((s as any).type || ""), content: (s as any).content ?? "" };
          writeJsonlLine(getAgentThoughtLogPath(targetEid), payload);
          writeJsonlLine(thoughtsPath, payload);
        }
      }
    }

    // Focused logs: structured agent snapshots (only when changed).
    for (const eid of agents) {
      const snap = snapshotAgent(world as any, eid);
      const serialized = JSON.stringify(sanitizeJsonl(snap));
      if (lastAgentSnap.get(eid) !== serialized) {
        lastAgentSnap.set(eid, serialized);
        writeJsonlLine(getAgentLogPath(eid), { ts: Date.now(), kind: "snapshot", tick, ...snap });
      }
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
        cardCount,
        agents: agents.map((eid) => ({ name: String(Name.value[eid] || ""), role: String(Agent.role[eid] || "") })),
      });
    }

    if (isAllTicketsDone(world as any, "Team Board", 4)) {
      writeJsonlLine(scoresPath, { ts: Date.now(), kind: "milestone", tick, milestone: "all_tickets_done" });
      break;
    }
  }

  const durationMs = Date.now() - started;
  const completed = isAllTicketsDone(world as any, "Team Board", 4);
  const score = Math.max(0, Math.round(100 - toolFailures * 5 - Math.max(0, durationMs / 1000 - 160) * 0.2));
  writeJsonlLine(scoresPath, { ts: Date.now(), kind: "phase_end", phase: "run", durationMs, actions, toolResults, toolFailures, visionToolResults, imageAssetStimuli, score, completed });

  if (!completed) {
    const snap = snapshotBoard(world as any, "Team Board");
    writeJsonlLine(scoresPath, { ts: Date.now(), kind: "debug_board", ...snap });
    console.log(`[DEBUG] Team Board snapshot: ${JSON.stringify(snap, null, 2)}`);
  }

  assert(completed, "expected CEO-created tickets to be completed (all cards in Done)");
  assert(visionToolResults > 0, "expected at least one vision.describe_image tool result");
  assert(imageAssetStimuli > 0, "expected at least one image_asset visual stimulus broadcast");
  console.log(`✓ CEO autoteam Nano Banana todo benchmark passed. Output: ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
