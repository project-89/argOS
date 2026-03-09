/**
 * Behavioral Benchmark: Build a functional Todo app via repo-service + PR integrator + CLI coding agent.
 *
 * What this exercises:
 * - Shared repo substrate: RepoServer base + Workstation checkouts
 * - Real "app" behavior: HTTP server + UI + persistence validated by deterministic CI
 * - CLI coding agent loop: gemini_cli -> git_apply_from_last_gemini -> run CI -> submit PR -> integrator merges -> QA verifies
 *
 * Requirements:
 * - OFFICE_TOOLS_ALLOW_SHELL=1
 * - OFFICE_TOOLS_ALLOW_GEMINI_CLI=1
 * - OFFICE_TOOLS_ALLOW_GIT_APPLY=1
 * - GOOGLE_GENERATIVE_AI_API_KEY set (planner/coder)
 *
 * Run:
 *   OFFICE_TOOLS_ALLOW_SHELL=1 OFFICE_TOOLS_ALLOW_GEMINI_CLI=1 OFFICE_TOOLS_ALLOW_GIT_APPLY=1 npx tsx src/behavioral-tests/65-todo-app-cli-coder-repo-benchmark.ts
 */
import "dotenv/config";

import { addComponent, addEntity, getRelationTargets, hasComponent, query } from "bitecs";

import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Goal, PendingToolJob, PullRequest, ToolResult } from "../ecs/components";
import { HasGoal, HasToolResult } from "../ecs/relations";
import { ObjectManager } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { setGoalContract } from "../cognition/goal-contract";
import { createGoalEvaluationSystem } from "../systems/builtin-systems";
import { createOfficeToolJobSystem } from "../systems/office-tool-job-system";
import { createRepoIntegratorSystem } from "../systems/repo-integrator-system";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { setOfficeToolMode } from "../office-tools/tool-registry";
import { yieldForOfficeToolJobs } from "./helpers/office-async";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

function latestGeminiToolResult(world: any, actorEid: number): number | undefined {
  const toolEids = getRelationTargets(world as any, actorEid, HasToolResult as any) as number[];
  let best: number | undefined;
  let bestTs = -1;
  for (const eid of toolEids) {
    if (String(ToolResult.toolId[eid] || "") !== "gemini.cli") continue;
    const ts = Number(ToolResult.timestamp[eid] || 0);
    if (ts >= bestTs) {
      bestTs = ts;
      best = eid;
    }
  }
  return best;
}

function latestToolResult(world: any, actorEid: number, toolId: string): number | undefined {
  const toolEids = getRelationTargets(world as any, actorEid, HasToolResult as any) as number[];
  let best: number | undefined;
  let bestTs = -1;
  for (const eid of toolEids) {
    if (String(ToolResult.toolId[eid] || "") !== toolId) continue;
    const ts = Number(ToolResult.timestamp[eid] || 0);
    if (ts >= bestTs) {
      bestTs = ts;
      best = eid;
    }
  }
  return best;
}

function extractUnifiedDiff(text: string): string | null {
  const s = String(text || "");
  const idx = s.indexOf("diff --git ");
  if (idx < 0) return null;
  const patch = s.slice(idx).trim();
  if (!patch.startsWith("diff --git ")) return null;
  return patch;
}

async function tick(world: any, registry: any, tickNo: number): Promise<void> {
  runSystems(world as any, registry as any, tickNo, 16);
  drainPendingStimuli();
  await yieldForOfficeToolJobs(world as any, 50);
}

async function main() {
  if (process.env.OFFICE_TOOLS_ALLOW_SHELL !== "1") {
    console.log("SKIP: set OFFICE_TOOLS_ALLOW_SHELL=1 to run this benchmark");
    process.exit(0);
  }
  if (process.env.OFFICE_TOOLS_ALLOW_GEMINI_CLI !== "1") {
    console.log("SKIP: set OFFICE_TOOLS_ALLOW_GEMINI_CLI=1 to run this benchmark");
    process.exit(0);
  }
  if (process.env.OFFICE_TOOLS_ALLOW_GIT_APPLY !== "1") {
    console.log("SKIP: set OFFICE_TOOLS_ALLOW_GIT_APPLY=1 to run this benchmark");
    process.exit(0);
  }
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
    console.log("SKIP: set GOOGLE_GENERATIVE_AI_API_KEY to run this LLM-backed benchmark");
    process.exit(0);
  }

  setOfficeToolMode("shell");
  registerBuiltinOfficeTools();

  const world = createArgosWorld("TodoAppCliCoderRepoBenchmark") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  const goalEval = createGoalEvaluationSystem();
  goalEval.frequency = 0;
  registerSystem(registry as any, goalEval as any);

  const officeJobs = createOfficeToolJobSystem();
  officeJobs.frequency = 0;
  registerSystem(registry as any, officeJobs as any);

  const integrator = createRepoIntegratorSystem();
  integrator.frequency = 0;
  registerSystem(registry as any, integrator as any);

  const room = createRoomEntity(world as any, { name: "Office", description: "A small office with a repo server and workstations." });
  registerEntity(room, "Office");

  const repoServer = objectManager.spawn("computer", { name: "RepoServer", state: "powered_on", containedIn: room })!;
  const wsEng = objectManager.spawn("computer", { name: "WorkstationENG", state: "powered_on", containedIn: room })!;
  const wsQa = objectManager.spawn("computer", { name: "WorkstationQA", state: "powered_on", containedIn: room })!;
  registerEntity(repoServer, "RepoServer");
  registerEntity(wsEng, "WorkstationENG");
  registerEntity(wsQa, "WorkstationQA");

  const eng = createAgentEntity(world as any, { name: "Evan", role: "engineer", systemPrompt: "x", roomId: room });
  const qa = createAgentEntity(world as any, { name: "Quinn", role: "qa", systemPrompt: "x", roomId: room });
  registerEntity(eng, "Evan");
  registerEntity(qa, "Quinn");

  const repoId = "todo_app_mvp";

  executeActions(
    world as any,
    [
      { eid: eng, action: { type: "interact", target: "RepoServer", content: `repo_init ${JSON.stringify({ repoId, fixtureId: "todo_app_mvp_1", ciCommand: "node ci.cjs", force: true })}` } },
      { eid: eng, action: { type: "interact", target: "WorkstationENG", content: `repo_checkout ${JSON.stringify({ repoId })}` } },
    ] as any,
    registry as any
  );

  // Initialize a local git repo inside the workstation sandbox so we can compute a clean patch via `git diff`.
  executeActions(
    world as any,
    [
      {
        eid: eng,
        action: {
          type: "interact",
          target: "WorkstationENG",
          content:
            'run_command printf \".argos_sandbox\\ntmp/\\nrepos/\\n\" > .gitignore && git init -q . && git add -A && git -c user.email=bench@example.com -c user.name=bench commit -qm \"base\"',
        },
      },
    ] as any,
    registry as any
  );

  // Engineer: run CI (expected to fail), then use gemini to generate patch, apply, rerun CI to green.
  const goalEid = addEntity(world as any);
  addComponent(world as any, goalEid, Goal as any);
  addComponent(world as any, eng, HasGoal(goalEid) as any);
  Goal.description[goalEid] = "Make node ci.cjs pass for the Todo App repo (implement server, UI, and persistence).";
  Goal.priority[goalEid] = 10;
  Goal.status[goalEid] = "active";
  Goal.progress[goalEid] = 0;
  Goal.deadline[goalEid] = 0;
  Goal.createdAt[goalEid] = Date.now();
  setGoalContract(world as any, goalEid, {
    version: 1,
    kind: "custom",
    params: {},
    success: {
      type: "all_of",
      conditions: [
        { type: "tool_exit_code_equals", toolId: "terminal.run", commandIncludes: "node ci.cjs", equals: 0 },
        { type: "tool_stdout_includes", toolId: "terminal.run", commandIncludes: "node ci.cjs", includes: "CI PASS" },
      ],
    },
    description: Goal.description[goalEid],
  });

  executeActions(world as any, [{ eid: eng, action: { type: "interact", target: "WorkstationENG", content: "run_command node ci.cjs" } } as any], registry as any);

  for (let i = 0; i < 40; i++) await tick(world as any, registry as any, i);

  const prompt = {
    prompt:
      "You are fixing a small Node.js todo app.\n" +
      "Constraints:\n" +
      "- Do not add external dependencies (no npm install).\n" +
      "- Make `node ci.cjs` pass.\n" +
      "- Implement server.cjs to serve /, /app.js, /style.css and the JSON API described in README.\n" +
      "- Persist todos to data/todos.json (create directories as needed).\n" +
      "- Remove all 'TODO:' markers from server.cjs, public/app.js, public/index.html.\n\n" +
      "You may edit files directly in the workspace. Do not output extra prose.",
    files: ["server.cjs", "public/index.html", "public/app.js", "public/style.css", "test.cjs", "ci.cjs", "README.md"],
    outputFormat: "text",
    timeoutMs: 180000,
    approvalMode: "yolo",
    sandbox: true,
  };

  executeActions(
    world as any,
    [
      {
        eid: eng,
        action: { type: "interact", target: "WorkstationENG", content: `gemini_cli ${JSON.stringify(prompt)}` },
      },
    ] as any,
    registry as any
  );

  // Wait for the async gemini CLI job to complete and publish a ToolResult.
  let gemEid: number | undefined;
  const geminiTimeoutMs = Number(prompt.timeoutMs || 180000);
  const maxWaitMs = geminiTimeoutMs + 30_000;
  const maxIters = Math.ceil(maxWaitMs / 50);
  for (let i = 0; i < maxIters; i++) {
    await tick(world as any, registry as any, i + 100);
    gemEid = latestGeminiToolResult(world as any, eng);
    if (gemEid !== undefined) break;
  }
  if (gemEid === undefined) {
    const pending = hasComponent(world as any, eng, PendingToolJob as any);
    throw new Error(`gemini_cli did not produce a ToolResult within the timeout (pending=${pending})`);
  }

  executeActions(
    world as any,
    [
      { eid: eng, action: { type: "interact", target: "WorkstationENG", content: "run_command node ci.cjs" } },
    ] as any,
    registry as any
  );

  for (let i = 0; i < 200; i++) {
    if (String(Goal.status[goalEid] || "") === "completed") break;
    await tick(world as any, registry as any, i + 400);
  }

  if (String(Goal.status[goalEid] || "") !== "completed") {
    const runEid = latestToolResult(world as any, eng, "terminal.run");
    if (runEid !== undefined) {
      console.log("\n[DEBUG] Last terminal.run stdout:\n" + String(ToolResult.stdout[runEid] || "").slice(0, 1200));
      console.log("\n[DEBUG] Last terminal.run stderr:\n" + String(ToolResult.stderr[runEid] || "").slice(0, 1200));
    }
    throw new Error("expected engineer to make local CI pass");
  }

  // Compute a PR patch from git diff (relative paths, clean unified diff).
  executeActions(
    world as any,
    [
      {
        eid: eng,
        action: {
          type: "interact",
          target: "WorkstationENG",
          content: "run_command git diff",
        },
      },
    ] as any,
    registry as any
  );
  for (let i = 0; i < 100; i++) await tick(world as any, registry as any, i + 700);

  const diffEid = latestToolResult(world as any, eng, "terminal.run");
  assert(diffEid !== undefined, "expected terminal.run to capture a diff");
  const patch = extractUnifiedDiff(String(ToolResult.stdout[diffEid!] || ""));
  assert(!!patch, "expected git diff output to contain a unified diff");

  executeActions(
    world as any,
    [
      {
        eid: eng,
        action: {
          type: "interact",
          target: "WorkstationENG",
          content: `repo_submit_pr ${JSON.stringify({ repoId, title: "Implement Todo App MVP", description: "Implements server, UI, and persistence; makes CI pass.", patch })}`,
        },
      },
    ] as any,
    registry as any
  );

  // Wait for merge.
  let prEid: number | undefined;
  for (let i = 0; i < 1200; i++) {
    const prs = Array.from(query(world as any, [PullRequest] as any)) as number[];
    prEid = prs[0];
    if (typeof prEid === "number") {
      const st = String(PullRequest.status[prEid] || "");
      if (st === "merged") break;
      if (st === "failed" || st === "needs_rebase") {
        throw new Error(`PR did not merge: status=${st} stderr=${String(PullRequest.lastStderr[prEid] || "").slice(0, 1200)}`);
      }
      if (i % 50 === 0) {
        console.log(
          `[PR] status=${st} pending=${String(PullRequest.pendingToolId[prEid] || "")}:${String(PullRequest.pendingJobId[prEid] || "")}`.trim()
        );
      }
    }
    await tick(world as any, registry as any, i + 900);
  }
  if (prEid === undefined) throw new Error("expected PR to be created");
  const finalStatus = String(PullRequest.status[prEid] || "");
  if (finalStatus !== "merged") {
    throw new Error(
      `expected PR to merge; status=${finalStatus} pending=${String(PullRequest.pendingToolId[prEid] || "")}:${String(PullRequest.pendingJobId[prEid] || "")} stderr=${String(
        PullRequest.lastStderr[prEid] || ""
      ).slice(0, 1200)}`
    );
  }

  // QA verifies on a clean checkout.
  executeActions(
    world as any,
    [
      { eid: qa, action: { type: "interact", target: "WorkstationQA", content: `repo_checkout ${JSON.stringify({ repoId })}` } },
    ] as any,
    registry as any
  );

  // QA writes and runs a deterministic HTTP/persistence test that also produces a report artifact.
  const qaScript = `const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { startServer } = require("./server.cjs");

const uncaught = [];
process.on("uncaughtException", (err) => {
  uncaught.push(err);
});
process.on("unhandledRejection", (err) => {
  uncaught.push(err);
});
function takeUncaught() {
  const out = uncaught.slice();
  uncaught.length = 0;
  return out;
}

async function fetchText(url, opts) {
  const started = performance.now();
  const res = await fetch(url, opts);
  const txt = await res.text();
  const ms = Math.round((performance.now() - started) * 10) / 10;
  return { res, txt, ms };
}

async function fetchJson(url, opts) {
  const started = performance.now();
  const res = await fetch(url, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts && opts.headers ? opts.headers : {}) },
  });
  const txt = await res.text();
  const ms = Math.round((performance.now() - started) * 10) / 10;
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch {}
  return { res, txt, json, ms };
}

function section(title, body) {
  return "## " + title + "\\n\\n" + body + "\\n";
}

async function main() {
  const startedAt = new Date().toISOString();
  const node = process.version;
  const reportDir = path.join(__dirname, "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, "qa-report.md");

  const checks = [];
  const record = (severity, name, ok, detail) => checks.push({ severity, name, ok, detail: detail || "" });

  const dataFile = path.join(__dirname, "data", "todos.qa.json");
  try { fs.rmSync(dataFile, { force: true }); } catch {}

  let srv = null;
  let createdId = null;
  const timings = [];
  try {
    srv = await startServer({ port: 0, dataFile });
    const base = srv.url;

    // Page loads
    const htmlRes = await fetchText(base + "/");
    timings.push({ name: "GET /", ms: htmlRes.ms, status: htmlRes.res.status });
    record("critical", "GET / returns 200", htmlRes.res.status === 200, "status=" + htmlRes.res.status);
    record("critical", "GET / includes <title>Todo App</title>", htmlRes.txt.includes("<title>Todo App</title>"), "checks HTML shell");

    // Static assets
    const jsRes = await fetchText(base + "/app.js");
    timings.push({ name: "GET /app.js", ms: jsRes.ms, status: jsRes.res.status });
    record("critical", "GET /app.js returns 200", jsRes.res.status === 200, "status=" + jsRes.res.status);
    const cssRes = await fetchText(base + "/style.css");
    timings.push({ name: "GET /style.css", ms: cssRes.ms, status: cssRes.res.status });
    record("critical", "GET /style.css returns 200", cssRes.res.status === 200, "status=" + cssRes.res.status);

    // API happy path
    const list0 = await fetchJson(base + "/api/todos");
    timings.push({ name: "GET /api/todos", ms: list0.ms, status: list0.res.status });
    record("critical", "GET /api/todos returns 200", list0.res.status === 200, "status=" + list0.res.status);
    record("critical", "GET /api/todos returns [] initially", Array.isArray(list0.json) && list0.json.length === 0, JSON.stringify(list0.json));
    const ct0 = String(list0.res.headers.get("content-type") || "");
    record("warning", "GET /api/todos returns application/json", ct0.includes("application/json"), "content-type=" + ct0);

    const created = await fetchJson(base + "/api/todos", { method: "POST", body: JSON.stringify({ text: "Buy milk" }) });
    timings.push({ name: "POST /api/todos", ms: created.ms, status: created.res.status });
    record("critical", "POST /api/todos returns 201", created.res.status === 201, "status=" + created.res.status);
    record("critical", "Created todo has id + echoes text", !!(created.json && created.json.id && created.json.text === "Buy milk"), JSON.stringify(created.json));
    if (created.json && created.json.id) createdId = String(created.json.id);

    const toggled = await fetchJson(base + "/api/todos/" + encodeURIComponent(createdId), { method: "PATCH", body: JSON.stringify({ completed: true }) });
    timings.push({ name: "PATCH /api/todos/:id", ms: toggled.ms, status: toggled.res.status });
    record("critical", "PATCH toggles completed=true", toggled.res.status === 200 && toggled.json && toggled.json.completed === true, JSON.stringify(toggled.json));

    const del = await fetchJson(base + "/api/todos/" + encodeURIComponent(createdId), { method: "DELETE" });
    timings.push({ name: "DELETE /api/todos/:id", ms: del.ms, status: del.res.status });
    record("critical", "DELETE removes todo", del.res.status === 200 && del.json && del.json.ok === true, JSON.stringify(del.json));

    // Negative paths (non-blocking, but included in the write-up as warnings).
    const emptyText = await fetchJson(base + "/api/todos", { method: "POST", body: JSON.stringify({ text: "" }) });
    record("warning", "POST empty text returns 4xx", emptyText.res.status >= 400 && emptyText.res.status < 500, "status=" + emptyText.res.status);
    const missingText = await fetchJson(base + "/api/todos", { method: "POST", body: JSON.stringify({}) });
    record("warning", "POST missing text returns 4xx", missingText.res.status >= 400 && missingText.res.status < 500, "status=" + missingText.res.status);
    const notFoundId = "does-not-exist";
    const patch404 = await fetchJson(base + "/api/todos/" + encodeURIComponent(notFoundId), { method: "PATCH", body: JSON.stringify({ completed: true }) });
    record("warning", "PATCH unknown id returns 4xx", patch404.res.status >= 400 && patch404.res.status < 500, "status=" + patch404.res.status);
    const del404 = await fetchJson(base + "/api/todos/" + encodeURIComponent(notFoundId), { method: "DELETE" });
    record("warning", "DELETE unknown id returns 4xx", del404.res.status >= 400 && del404.res.status < 500, "status=" + del404.res.status);

    await srv.close();
    srv = null;

    // Persistence: create todo, restart, verify it remains.
    const srv2 = await startServer({ port: 0, dataFile });
    const base2 = srv2.url;
    const created2 = await fetchJson(base2 + "/api/todos", { method: "POST", body: JSON.stringify({ text: "Persist me" }) });
    record("critical", "POST persists todo (201)", created2.res.status === 201, "status=" + created2.res.status);
    await srv2.close();

	    const srv3 = await startServer({ port: 0, dataFile });
	    const base3 = srv3.url;
	    const list3 = await fetchJson(base3 + "/api/todos");
	    record("critical", "Restart keeps todo", list3.res.status === 200 && Array.isArray(list3.json) && list3.json.length === 1 && list3.json[0].text === "Persist me", JSON.stringify(list3.json));
	    await srv3.close();

	    // Invalid JSON robustness check (runs last; some implementations may throw in-process).
	    const dataFileInvalid = path.join(__dirname, "data", "todos.qa.invalid.json");
	    try { fs.rmSync(dataFileInvalid, { force: true }); } catch {}
	    const srvNeg = await startServer({ port: 0, dataFile: dataFileInvalid });
	    const baseNeg = srvNeg.url;
	    takeUncaught();
	    let badStatus = null;
	    try {
	      const started = performance.now();
	      const res = await fetch(baseNeg + "/api/todos", {
	        method: "POST",
	        headers: { "content-type": "application/json" },
	        body: "{ this is not json",
	      });
	      badStatus = res.status;
	      try { await res.text(); } catch {}
	      const ms = Math.round((performance.now() - started) * 10) / 10;
	      timings.push({ name: "POST /api/todos (invalid JSON)", ms, status: badStatus });
	    } catch {}
	    await new Promise((r) => setTimeout(r, 25));
	    const unc = takeUncaught();
	    record("warning", "POST invalid JSON does not raise uncaught exception", unc.length === 0, unc.length ? String(unc[0] && unc[0].message ? unc[0].message : unc[0]) : "");
	    record("warning", "POST invalid JSON returns 4xx", typeof badStatus === "number" && badStatus >= 400 && badStatus < 500, "status=" + String(badStatus));
	    try { await srvNeg.close(); } catch {}
	  } catch (e) {
	    record("critical", "QA runner exception", false, String(e && e.stack ? e.stack : e));
	    try { if (srv) await srv.close(); } catch {}
	  }

  const criticalFailed = checks.filter(c => c.severity === "critical" && !c.ok);
  const warnings = checks.filter(c => c.severity === "warning" && !c.ok);
  const passed = checks.filter(c => c.ok).length;
  const failed = checks.filter(c => !c.ok).length;
  const outcome = criticalFailed.length === 0 ? "PASS" : "FAIL";

  const lines = [];
  lines.push("# Todo App QA Report");
  lines.push("");
  lines.push("## Executive Summary");
  lines.push("");
  if (outcome === "PASS") {
    lines.push("Core end-to-end flows are working: the UI shell loads, the API supports create/toggle/delete, and todos persist across restart.");
    if (warnings.length > 0) {
      lines.push("Edge-case behavior around invalid input / unknown ids is not fully aligned with typical production expectations; see warnings and recommendations.");
    } else {
      lines.push("No edge-case issues were detected in the limited set of negative checks included in this run.");
    }
  } else {
    lines.push("One or more critical checks failed in the core flow. The application is not ready for broader usage until those are addressed.");
  }
  lines.push("");

  lines.push("## Product Intent (Expected Behavior)");
  lines.push("");
  lines.push("A user should be able to load the Todo App, create a todo, mark it complete/incomplete, delete it, and have the list persist across a server restart.");
  lines.push("");

  lines.push("## Test Environment");
  lines.push("");
  lines.push("- Started: " + startedAt);
  lines.push("- Node: " + node);
  lines.push("- Persistence file: " + path.relative(process.cwd(), dataFile));
  lines.push("- Server: startServer({ port: 0 }) (ephemeral port)");
  lines.push("");

  lines.push("## Test Scope");
  lines.push("");
  lines.push("- UI shell: GET / returns HTML with expected title");
  lines.push("- Static assets: GET /app.js, GET /style.css");
  lines.push("- API happy path: GET/POST/PATCH/DELETE /api/todos");
  lines.push("- Persistence: create todo, restart server, verify todo remains");
  lines.push("- Negative-path sanity (non-blocking): invalid JSON, missing/empty text, unknown id");
  lines.push("");

  lines.push("## Results & Observations");
  lines.push("");
  lines.push("- Outcome: **" + outcome + "**");
  lines.push("- Checks: " + passed + " passed, " + failed + " failed (" + criticalFailed.length + " critical, " + warnings.length + " warning)");
  lines.push("");

  if (timings.length) {
    const timingLines = timings
      .slice()
      .sort((a, b) => b.ms - a.ms)
      .map(t => "- " + t.name + " — " + t.status + " in " + t.ms + "ms")
      .join("\\n");
    lines.push(section("Endpoint Timing Snapshot", timingLines));
  }

  const criticalTable = checks
    .filter(c => c.severity === "critical")
    .map(c => "- [" + (c.ok ? "x" : " ") + "] " + c.name + (c.detail ? " — " + c.detail : ""))
    .join("\\n");
  lines.push(section("Core Flow Checks (Critical)", criticalTable || "- (none)"));

  const warningTable = checks
    .filter(c => c.severity === "warning")
    .map(c => "- [" + (c.ok ? "x" : " ") + "] " + c.name + (c.detail ? " — " + c.detail : ""))
    .join("\\n");
  lines.push(section("Edge-Case Checks (Warnings)", warningTable || "- (none)"));

  lines.push("## Recommendations (Next QA Pass)");
  lines.push("");
  if (warnings.length === 0 && outcome === "PASS") {
    lines.push("- Add automated browser coverage (Playwright) to validate actual UI interactions and DOM updates.");
    lines.push("- Add negative tests for malformed bodies, large payloads, and concurrency.");
    lines.push("- Add structured request logging and clearer error payloads to aid debugging.");
  } else {
    const recs = [];
    if (warnings.some(w => w.name.includes("invalid JSON"))) recs.push("- Return a clear 400 with a JSON error payload when request JSON is malformed.");
    if (warnings.some(w => w.name.includes("empty text")) || warnings.some(w => w.name.includes("missing text"))) {
      recs.push("- Validate todo text (non-empty, reasonable length) and respond with 400/422 and a helpful message.");
    }
    if (warnings.some(w => w.name.includes("unknown id"))) recs.push("- For unknown ids, prefer a consistent 404 response and error body.");
    recs.push("- Keep these checks in CI so the contract stays stable as features evolve.");
    lines.push(recs.join("\\n"));
  }
  lines.push("");

  lines.push("## Notes / Limitations");
  lines.push("");
  lines.push("- This run uses Node's fetch() as a black-box HTTP check; it does not simulate a real browser.");
  lines.push("- Timing numbers here are a rough snapshot, not a performance benchmark.");
  lines.push("");

  fs.writeFileSync(reportPath, lines.join("\\n"), "utf8");

  console.log("QA REPORT " + outcome);
  console.log("QA_REPORT_PATH=" + path.relative(process.cwd(), reportPath));
  process.exit(outcome === "PASS" ? 0 : 1);
}

main();\n`;

  executeActions(
    world as any,
    [
      { eid: qa, action: { type: "interact", target: "WorkstationQA", content: 'write_file {"path":"qa-e2e.cjs","content":' + JSON.stringify(qaScript) + "}" } },
      { eid: qa, action: { type: "interact", target: "WorkstationQA", content: "run_command node qa-e2e.cjs" } },
      // Also print the report to stdout so humans can read it from the log/tool evidence.
      { eid: qa, action: { type: "interact", target: "WorkstationQA", content: "run_command cat reports/qa-report.md" } },
    ] as any,
    registry as any
  );

  const qaGoal = addEntity(world as any);
  addComponent(world as any, qaGoal, Goal as any);
  addComponent(world as any, qa, HasGoal(qaGoal) as any);
  Goal.description[qaGoal] = "On WorkstationQA, run the QA e2e script and produce a report (PASS).";
  Goal.priority[qaGoal] = 10;
  Goal.status[qaGoal] = "active";
  Goal.progress[qaGoal] = 0;
  Goal.deadline[qaGoal] = 0;
  Goal.createdAt[qaGoal] = Date.now();
  setGoalContract(world as any, qaGoal, {
    version: 1,
    kind: "custom",
    params: {},
    success: {
      type: "all_of",
      conditions: [
        { type: "tool_exit_code_equals", toolId: "terminal.run", commandIncludes: "node qa-e2e.cjs", equals: 0 },
        { type: "tool_stdout_includes", toolId: "terminal.run", commandIncludes: "node qa-e2e.cjs", includes: "QA REPORT PASS" },
      ],
    },
    description: Goal.description[qaGoal],
  });

  for (let i = 0; i < 200; i++) {
    if (String(Goal.status[qaGoal] || "") === "completed") break;
    await tick(world as any, registry as any, i + 1300);
  }

  assert(String(Goal.status[qaGoal] || "") === "completed", "expected QA to verify CI pass");
  console.log("✓ todo app CLI-coder repo benchmark passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
