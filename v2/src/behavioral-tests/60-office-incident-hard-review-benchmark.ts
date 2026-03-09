/**
 * Behavioral Benchmark: Hard office incident (multi-ticket, shared workspace, strict governance)
 *
 * Harder than 59:
 * - Multi-file code fix required (src/math.cjs + src/service.cjs)
 * - Extra role ticket (SRE) for operational docs (docs/triage.md)
 * - Governance requires: ticket ownership, WIP, CI must pass, AND card must pass through Review before Done
 *
 * Run:
 *   OFFICE_TOOLS_ALLOW_SHELL=1 npx tsx src/behavioral-tests/60-office-incident-hard-review-benchmark.ts
 */
import "dotenv/config";

import * as fs from "node:fs";
import * as path from "node:path";

import { addComponent, addEntity, entityExists, hasComponent, query } from "bitecs";

import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../ecs/prefabs";
import { Agent, KanbanBoard, KanbanCard, KanbanColumn, Name, OrgGovernance, OrgStaffingGovernor, PendingToolJob } from "../ecs/components";
import { listDirectContents } from "../ecs/location";
import { ObjectManager, worldSchema } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { setOfficeToolMode } from "../office-tools/tool-registry";
import { createGoalEvaluationSystem } from "../systems/builtin-systems";
import { createOrgStaffingGovernorSystem } from "../systems/org-staffing-governor-system";
import { createOfficeToolJobSystem } from "../systems/office-tool-job-system";
import { runPlanningSystem, getNextPlannedAction } from "../cognition/planning-system";
import { agentThink } from "../cognition/agent-mind";
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
  let maxTicks = 340;
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith("--outDir=")) outDir = raw.slice("--outDir=".length);
    if (raw.startsWith("--maxTicks=")) maxTicks = Math.max(50, Math.min(5000, Number(raw.slice("--maxTicks=".length)) || 340));
  }
  return { outDir, maxTicks };
}

function isBoardInitialized(world: any, boardName: string): boolean {
  for (const eid of Array.from(query(world as any, [KanbanBoard] as any))) {
    if (!entityExists(world as any, eid)) continue;
    if (String(Name.value[eid] || "") === boardName) return true;
  }
  return false;
}

function isCardInColumn(world: any, boardName: string, cardTitle: string, columnName: string): boolean {
  let boardEid: number | undefined;
  for (const eid of Array.from(query(world as any, [KanbanBoard] as any))) {
    if (!entityExists(world as any, eid)) continue;
    if (String(Name.value[eid] || "") === boardName) {
      boardEid = eid;
      break;
    }
  }
  if (boardEid === undefined) return false;

  let colEid: number | undefined;
  for (const child of listDirectContents(world as any, boardEid)) {
    if (!entityExists(world as any, child)) continue;
    if (!hasComponent(world as any, child, KanbanColumn as any)) continue;
    if (String(Name.value[child] || KanbanColumn.name[child] || "") === columnName) {
      colEid = child;
      break;
    }
  }
  if (colEid === undefined) return false;

  for (const child of listDirectContents(world as any, colEid)) {
    if (!entityExists(world as any, child)) continue;
    if (!hasComponent(world as any, child, KanbanCard as any)) continue;
    const title = String(Name.value[child] || KanbanCard.title[child] || "");
    if (title === cardTitle) return true;
  }
  return false;
}

async function main(): Promise<void> {
  if (process.env.OFFICE_TOOLS_ALLOW_SHELL !== "1") {
    console.log("SKIP: set OFFICE_TOOLS_ALLOW_SHELL=1 to run this benchmark");
    process.exit(0);
  }
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
    console.log("SKIP: set GOOGLE_GENERATIVE_AI_API_KEY to run this LLM-backed benchmark");
    process.exit(0);
  }

  const args = parseArgs();
  const runId = `office-incident-hard-${Date.now()}`;
  const outDir = path.resolve(args.outDir || path.join(process.cwd(), "stress-test-output", "office-incident", runId));
  const eventsPath = path.join(outDir, "events.jsonl");
  const scoresPath = path.join(outDir, "scores.jsonl");

  setOfficeToolMode("shell");
  registerBuiltinOfficeTools();

  // Board device type + affordances for kanban tooling.
  const unique = String(Date.now());
  const boardType = `kanban_board_device_incident_hard_${unique}`;
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

  const world = createArgosWorld("OfficeIncidentHardBenchmark") as any;
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

  const room = createRoomEntity(world as any, { name: "Office", description: "An office war room for an incident." });
  registerEntity(room, "Office");

  const board = objectManager.spawn(boardType, { name: "Team Board", containedIn: room })!;
  registerEntity(board, "Team Board");

  const workstation = objectManager.spawn("computer", { name: "Workstation", state: "powered_on", containedIn: room })!;
  registerEntity(workstation, "Workstation");

  const admin = createAgentEntity(world as any, { name: "Admin", role: "admin", systemPrompt: "x", roomId: room });
  registerEntity(admin, "Admin");

  // Seed fixture and initial backlog BEFORE governance gates enable work-tool blocking.
  executeActions(
    world as any,
    [
      { eid: admin, action: { type: "interact", target: "Workstation", content: 'init_workspace_fixture {"fixtureId":"office_incident_2"}' } },
      {
        eid: admin,
        action: { type: "interact", target: "Team Board", content: 'kanban_init {"project":"Incident","columns":["Backlog","In Progress","Review","Done"]}' },
      },
      {
        eid: admin,
        action: {
          type: "interact",
          target: "Team Board",
          content:
            'kanban_upsert_card {"title":"[ENG] Fix invoice discount math","column":"Backlog","description":"Bug: discounted invoices are wrong because src/math.cjs exports.mul uses subtraction, and src/service.cjs applyDiscount adds the discount instead of subtracting it.\\nFixes (use replace_in_file with exact matches):\\n- In src/math.cjs, find `a - b` and replace with `a * b` in exports.mul.\\n- In src/service.cjs, find `return subtotal + percentOf(subtotal, discountPct);` and replace with `return subtotal - percentOf(subtotal, discountPct);`\\nWrites: src/math.cjs, src/service.cjs\\nRun `node ci.cjs` until CI PASS. Do not edit ci.cjs or test.cjs. Do not re-init the workspace fixture."}',
        },
      },
      {
        eid: admin,
        action: {
          type: "interact",
          target: "Team Board",
          content:
            'kanban_upsert_card {"title":"[PM] Write postmortem + update runbook","column":"Backlog","description":"Fill in docs/incident.md (Root Cause, Fix Summary, Follow-ups) with real content (remove all TBD). Update docs/runbook.md so it includes the exact command `node ci.cjs` under How to run CI (remove TBD).\\nWrites: docs/incident.md, docs/runbook.md\\nRun `node ci.cjs` until CI PASS. Do not edit ci.cjs or test.cjs. Do not re-init the workspace fixture."}',
        },
      },
      {
        eid: admin,
        action: {
          type: "interact",
          target: "Team Board",
          content:
            'kanban_upsert_card {"title":"[SRE] Write triage guide","column":"Backlog","description":"Update docs/triage.md so it has concrete Symptoms and Quick Checks content (remove all TBD).\\nWrites: docs/triage.md\\nRun `node ci.cjs` until CI PASS. Do not edit ci.cjs or test.cjs. Do not re-init the workspace fixture."}',
        },
      },
      {
        eid: admin,
        action: {
          type: "interact",
          target: "Team Board",
          content:
            'kanban_upsert_card {"title":"[QA] Verify CI and close","column":"Backlog","description":"DependsOn: [ENG] Fix invoice discount math, [PM] Write postmortem + update runbook, [SRE] Write triage guide\\nRun `node ci.cjs` and close this incident."}',
        },
      },
    ] as any,
    registry as any
  );

  const seedStimuli = drainPendingStimuli();
  for (const s of seedStimuli) writeJsonlLine(eventsPath, { ts: Date.now(), kind: "stimulus", phase: "seed", ...s });

  // Enable governance after seeding.
  const orgEid = addEntity(world as any);
  addComponent(world as any, orgEid, Name as any);
  addComponent(world as any, orgEid, OrgGovernance as any);
  Name.value[orgEid] = "Org Governance";
  OrgGovernance.enabled[orgEid] = true;
  OrgGovernance.requireTicketForWork[orgEid] = true;
  OrgGovernance.wipLimit[orgEid] = 3;
  OrgGovernance.doneRequiresToolId[orgEid] = "terminal.run";
  OrgGovernance.doneRequiresCommandIncludes[orgEid] = "node ci.cjs";
  OrgGovernance.doneRequiresReview[orgEid] = true;
  OrgGovernance.reviewColumnName[orgEid] = "Review";

  // Role-scoped staffing governors.
  const addGovernor = (name: string, role: string, prefix: string) => {
    const g = addEntity(world as any);
    addComponent(world as any, g, Name as any);
    addComponent(world as any, g, OrgStaffingGovernor as any);
    Name.value[g] = name;
    OrgStaffingGovernor.enabled[g] = true;
    OrgStaffingGovernor.boardName[g] = "Team Board";
    OrgStaffingGovernor.spawnRoomName[g] = "Office";
    OrgStaffingGovernor.defaultRole[g] = role;
    OrgStaffingGovernor.maxAgents[g] = 1;
    OrgStaffingGovernor.wipPerAgent[g] = 1;
    OrgStaffingGovernor.claimTitlePrefix[g] = prefix;
  };
  addGovernor("Staffing ENG", "engineer", "[ENG]");
  addGovernor("Staffing PM", "pm", "[PM]");
  addGovernor("Staffing SRE", "sre", "[SRE]");
  addGovernor("Staffing QA", "qa", "[QA]");

  writeJsonlLine(scoresPath, { ts: Date.now(), kind: "phase_start", phase: "incident" });

  const started = Date.now();
  let actions = 0;
  let toolResults = 0;
  let toolFailures = 0;

  for (let tick = 0; tick < args.maxTicks; tick++) {
    runSystems(world as any, registry as any, tick, 16);

    // Slow planning loop.
    if (tick === 0 || tick % 12 === 0) {
      await runPlanningSystem(world as any);
    }

    // Let all non-admin agents act once per tick.
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
    if (tick === 0 && batch.length === 0) {
      const debug = agents.map((eid) => ({ name: String(Name.value[eid] || ""), nextPlan: getNextPlannedAction(world as any, eid) }));
      writeJsonlLine(eventsPath, { ts: Date.now(), kind: "debug", tick, note: "no actions on tick 0", debug });
    }

    if (batch.length) {
      actions += batch.length;
      writeJsonlLine(eventsPath, { ts: Date.now(), kind: "actions", phase: "incident", tick, actions: batch });
      executeActions(world as any, batch as any, registry as any);
    }

    const stimuli = drainPendingStimuli();
    for (const s of stimuli) {
      if (s.type === "tool_result") {
        toolResults++;
        if (typeof s.content === "string" && s.content.includes("ok: false")) toolFailures++;
      }
      writeJsonlLine(eventsPath, { ts: Date.now(), kind: "stimulus", phase: "incident", tick, ...s });
    }

    runSystems(world as any, registry as any, tick, 16);

    // Yield to the event loop so async tool jobs (terminal/gemini) can progress.
    const pendingJobs = Array.from(query(world as any, [PendingToolJob] as any)).filter((eid) => entityExists(world as any, eid)).length > 0;
    const yieldMs = pendingJobs && batch.length === 0 ? 200 : 50;
    await yieldForOfficeToolJobs(world as any, yieldMs);

    if (isBoardInitialized(world, "Team Board") && isCardInColumn(world, "Team Board", "[QA] Verify CI and close", "Done")) {
      writeJsonlLine(scoresPath, { ts: Date.now(), kind: "milestone", tick, milestone: "qa_done" });
      break;
    }
  }

  const durationMs = Date.now() - started;
  const score = Math.max(0, Math.round(100 - toolFailures * 10 - Math.max(0, durationMs / 1000 - 80) * 0.2));
  writeJsonlLine(scoresPath, { ts: Date.now(), kind: "phase_end", phase: "incident", durationMs, ticks: args.maxTicks, actions, toolResults, toolFailures, score });

  console.log(`✓ office incident (hard) benchmark complete. Output: ${outDir}`);

  assert(isCardInColumn(world, "Team Board", "[ENG] Fix invoice discount math", "Done"), "expected ENG ticket to be Done");
  assert(isCardInColumn(world, "Team Board", "[PM] Write postmortem + update runbook", "Done"), "expected PM ticket to be Done");
  assert(isCardInColumn(world, "Team Board", "[SRE] Write triage guide", "Done"), "expected SRE ticket to be Done");
  assert(isCardInColumn(world, "Team Board", "[QA] Verify CI and close", "Done"), "expected QA ticket to be Done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
