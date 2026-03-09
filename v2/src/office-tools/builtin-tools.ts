import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { World } from "../ecs/world";
import { createDynamicComponent, getDynamicComponent, setDynamicComponentValue } from "../ecs/dynamic-components";
import { addComponent, addEntity, getRelationTargets, hasComponent, query } from "bitecs";
import { Agent, BehaviorPolicy, Goal, KanbanBoard, KanbanCard, KanbanColumn, LastToolResult, OrgGovernance, OrgStaffingGovernor, Room, ToolResult, Memory, Name, WikiDoc, Repo, PullRequest } from "../ecs/components";
import { getDirectContainer, listDirectContents, setLocatedIn } from "../ecs/location";
import { HasGoal, HasMemory, HasToolResult } from "../ecs/relations";
import { validateBehaviorNode } from "../cognition/behavior-policy";
import {
  registerOfficeTool,
  getOfficeToolMode,
  type OfficeToolContext,
  type OfficeToolResult,
} from "./tool-registry";
import * as fs from "node:fs";
import * as path from "node:path";
import { ensureOfficeDeviceSandboxDir } from "./sandbox";
import { enqueueOfficeProcessJob } from "./async-jobs";

function resetWorkspaceDir(absRoot: string, keepNames: Set<string> = new Set([".argos_sandbox", "tmp", "devices"])): void {
  fs.mkdirSync(absRoot, { recursive: true });
  for (const ent of fs.readdirSync(absRoot, { withFileTypes: true })) {
    if (keepNames.has(ent.name)) continue;
    const abs = path.join(absRoot, ent.name);
    fs.rmSync(abs, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(absRoot, "tmp"), { recursive: true });
}

function copyDirContents(srcDir: string, destDir: string, skipNames: Set<string> = new Set([".argos_sandbox", "tmp"])): void {
  fs.mkdirSync(destDir, { recursive: true });
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (skipNames.has(ent.name)) continue;
    const src = path.join(srcDir, ent.name);
    const dest = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      fs.cpSync(src, dest, { recursive: true, force: true });
    } else if (ent.isFile()) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }
}

function findRepoById(world: World, repoId: string): number | undefined {
  const want = String(repoId || "").trim();
  if (!want) return undefined;
  for (const eid of Array.from(query(world as any, [Repo] as any))) {
    if (String(Repo.repoId[eid] || "") === want) return eid;
  }
  return undefined;
}

function findPullRequestById(world: World, repoEid: number, prId: string): number | undefined {
  const want = String(prId || "").trim();
  if (!want) return undefined;
  for (const eid of Array.from(query(world as any, [PullRequest] as any))) {
    if (Number(PullRequest.repoEid[eid] ?? -1) !== Number(repoEid)) continue;
    if (String(PullRequest.prId[eid] || "") === want) return eid;
  }
  return undefined;
}

function safeFsName(input: string): string {
  const s = String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "repo";
}

function getRepoBaseDir(world: World, repoId: string, baseDeviceEid: number): string {
  const deviceRoot = ensureOfficeDeviceSandboxDir(world, baseDeviceEid);
  return path.join(deviceRoot, "repos", safeFsName(repoId), "base");
}

function getBuiltinWorkspaceFixtures(): Record<string, Record<string, string>> {
  return {
    node_bugfix_1: {
      // Keep the fixture CommonJS-only so it runs in a bare Node environment (no package.json needed).
      "math.cjs": "exports.add = (a, b) => a - b; // BUG\n",
      "test.cjs": `const assert = require("node:assert/strict");
const { add } = require("./math.cjs");

try {
  assert.equal(add(2, 1), 3);
  console.log("PASS");
  process.exit(0);
} catch (e) {
  console.log("FAIL");
  console.error(String(e && e.message ? e.message : e));
  process.exit(1);
}
`,
      "README.md": "# Fixture: node_bugfix_1\n\nGoal: make `node test.cjs` print PASS and exit 0.\n",
    },
    node_tests_pass_1: {
      "math.cjs": "exports.add = (a, b) => a + b; // OK\n",
      "test.cjs": `const assert = require("node:assert/strict");
const { add } = require("./math.cjs");

try {
  assert.equal(add(2, 1), 3);
  console.log("PASS");
  process.exit(0);
} catch (e) {
  console.log("FAIL");
  console.error(String(e && e.message ? e.message : e));
  process.exit(1);
}
`,
      "README.md": "# Fixture: node_tests_pass_1\n\nGoal: `node test.cjs` prints PASS and exits 0.\n",
    },
    office_incident_1: {
      "src/math.cjs": `exports.add = (a, b) => a + b;
exports.mul = (a, b) => a - b; // BUG: should multiply
`,
      "src/service.cjs": `const { add, mul } = require("./math.cjs");

exports.computeInvoiceTotal = (items) => {
  // items: [{price, qty}]
  let total = 0;
  for (const it of items) {
    total = add(total, mul(it.price, it.qty));
  }
  return total;
};
`,
      "test.cjs": `const assert = require("node:assert/strict");
const { add, mul } = require("./src/math.cjs");
const { computeInvoiceTotal } = require("./src/service.cjs");

try {
  assert.equal(add(2, 3), 5);
  assert.equal(mul(4, 3), 12);
  assert.equal(computeInvoiceTotal([{ price: 10, qty: 2 }, { price: 5, qty: 3 }]), 35);
  console.log("PASS");
  process.exit(0);
} catch (e) {
  console.log("FAIL");
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
}
`,
      "docs/incident.md": `# Incident Report: Invoice Totals Incorrect

## Summary
- Customer invoices were computed incorrectly for some orders.

## Root Cause
TBD

## Fix Summary
TBD

## Follow-ups
TBD
`,
      "docs/runbook.md": `# Runbook

## How to run CI
TBD
`,
      "ci.cjs": `const { spawnSync } = require("node:child_process");
const fs = require("node:fs");

function fail(msg) {
  console.log("CI FAIL");
  console.error(msg);
  process.exit(1);
}

function requireIncludes(path, needles) {
  const body = fs.readFileSync(path, "utf8");
  for (const n of needles) {
    if (!body.includes(n)) fail(\`\${path} missing required text: \${n}\`);
  }
}

const test = spawnSync("node test.cjs", { shell: true, encoding: "utf8" });
const out = String(test.stdout || "");
const err = String(test.stderr || "");
if (test.status !== 0) fail(\`tests failed (exit \${test.status})\\nstdout:\\n\${out}\\nstderr:\\n\${err}\`);
if (!out.includes("PASS")) fail("tests did not print PASS");

requireIncludes("docs/incident.md", ["## Root Cause", "## Fix Summary", "## Follow-ups"]);
requireIncludes("docs/runbook.md", ["## How to run CI", "node ci.cjs"]);

// Simple hygiene: reject TODO/HACK markers.
const files = ["src/math.cjs", "src/service.cjs", "docs/incident.md", "docs/runbook.md"];
for (const p of files) {
  const body = fs.readFileSync(p, "utf8");
  if (body.includes("TODO") || body.includes("HACK")) fail(\`\${p} contains TODO/HACK\`);
}

console.log("CI PASS");
process.exit(0);
`,
      "README.md": `# Fixture: office_incident_1

Run: \`node ci.cjs\`

Goal: Make CI pass by fixing code + updating docs.
`,
    },
    office_incident_2: {
      "src/math.cjs": `exports.add = (a, b) => a + b;
exports.mul = (a, b) => a - b; // BUG: should multiply
exports.percentOf = (total, pct) => total * pct;
`,
      "src/service.cjs": `const { add, mul, percentOf } = require("./math.cjs");

exports.computeInvoiceSubtotal = (items) => {
  // items: [{price, qty}]
  let total = 0;
  for (const it of items) {
    total = add(total, mul(it.price, it.qty));
  }
  return total;
};

exports.applyDiscount = (subtotal, discountPct) => {
  // BUG: discount should reduce total, not increase it
  return subtotal + percentOf(subtotal, discountPct);
};

exports.computeInvoiceTotal = (items, discountPct = 0) => {
  const subtotal = exports.computeInvoiceSubtotal(items);
  if (!discountPct) return subtotal;
  return exports.applyDiscount(subtotal, discountPct);
};
`,
      "test.cjs": `const assert = require("node:assert/strict");
const { add, mul } = require("./src/math.cjs");
const { computeInvoiceSubtotal, computeInvoiceTotal } = require("./src/service.cjs");

try {
  assert.equal(add(2, 3), 5);
  assert.equal(mul(4, 3), 12);

  const items = [{ price: 10, qty: 2 }, { price: 5, qty: 3 }]; // 20 + 15 = 35
  assert.equal(computeInvoiceSubtotal(items), 35);
  assert.equal(computeInvoiceTotal(items, 0.1), 31.5); // 10% discount

  console.log("PASS");
  process.exit(0);
} catch (e) {
  console.log("FAIL");
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
}
`,
      "docs/incident.md": `# Incident Report: Invoice Discounts Incorrect

## Summary
- Customer invoices were computed incorrectly for discounted orders.

## Root Cause
TBD

## Fix Summary
TBD

## Follow-ups
TBD
`,
      "docs/runbook.md": `# Runbook

## How to run CI
TBD
`,
      "docs/triage.md": `# Triage Guide

## Symptoms
TBD

## Quick Checks
TBD
`,
      "ci.cjs": `const { spawnSync } = require("node:child_process");
const fs = require("node:fs");

function fail(msg) {
  console.log("CI FAIL");
  console.error(msg);
  process.exit(1);
}

function requireIncludes(path, needles) {
  const body = fs.readFileSync(path, "utf8");
  for (const n of needles) {
    if (!body.includes(n)) fail(\`\${path} missing required text: \${n}\`);
  }
  return body;
}

const test = spawnSync("node test.cjs", { shell: true, encoding: "utf8" });
const out = String(test.stdout || "");
const err = String(test.stderr || "");
if (test.status !== 0) fail(\`tests failed (exit \${test.status})\\nstdout:\\n\${out}\\nstderr:\\n\${err}\`);
if (!out.includes("PASS")) fail("tests did not print PASS");

requireIncludes("docs/incident.md", ["## Root Cause", "## Fix Summary", "## Follow-ups"]);
requireIncludes("docs/runbook.md", ["## How to run CI", "node ci.cjs"]);
requireIncludes("docs/triage.md", ["## Symptoms", "## Quick Checks"]);

// Simple hygiene: reject TODO/HACK/TBD markers.
const files = ["src/math.cjs", "src/service.cjs", "docs/incident.md", "docs/runbook.md", "docs/triage.md"];
for (const p of files) {
  const body = fs.readFileSync(p, "utf8");
  if (body.includes("TODO") || body.includes("HACK") || body.includes("TBD")) fail(\`\${p} contains TODO/HACK/TBD\`);
}

console.log("CI PASS");
process.exit(0);
`,
      "README.md": `# Fixture: office_incident_2

Run: \`node ci.cjs\`

Goal: Make CI pass by fixing code + updating docs.
`,
    },
    office_incident_cli_1: {
      "src/math.cjs": `exports.add = (a, b) => a + b;
exports.mul = (a, b) => a - b; // BUG: should multiply
exports.percentOf = (total, pct) => total * pct;
`,
      "src/service.cjs": `const { add, mul, percentOf } = require("./math.cjs");

exports.computeInvoiceSubtotal = (items) => {
  // items: [{price, qty}]
  let total = 0;
  for (const it of items) {
    total = add(total, mul(it.price, it.qty));
  }
  return total;
};

exports.applyDiscount = (subtotal, discountPct) => {
  // BUG: discount should reduce total, not increase it
  return subtotal + percentOf(subtotal, discountPct);
};

exports.computeInvoiceTotal = (items, discountPct = 0) => {
  const subtotal = exports.computeInvoiceSubtotal(items);
  if (!discountPct) return subtotal;
  return exports.applyDiscount(subtotal, discountPct);
};
`,
      "test.cjs": `const assert = require("node:assert/strict");
const { add, mul } = require("./src/math.cjs");
const { computeInvoiceSubtotal, computeInvoiceTotal } = require("./src/service.cjs");

try {
  assert.equal(add(2, 3), 5);
  assert.equal(mul(4, 3), 12);

  const items = [{ price: 10, qty: 2 }, { price: 5, qty: 3 }]; // 20 + 15 = 35
  assert.equal(computeInvoiceSubtotal(items), 35);
  assert.equal(computeInvoiceTotal(items, 0.1), 31.5); // 10% discount

  console.log("PASS");
  process.exit(0);
} catch (e) {
  console.log("FAIL");
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
}
`,
      "ci.cjs": `const { spawnSync } = require("node:child_process");

function fail(msg) {
  console.log("CI FAIL");
  console.error(msg);
  process.exit(1);
}

const test = spawnSync("node test.cjs", { shell: true, encoding: "utf8" });
const out = String(test.stdout || "");
const err = String(test.stderr || "");
if (test.status !== 0) fail(\`tests failed (exit \${test.status})\\nstdout:\\n\${out}\\nstderr:\\n\${err}\`);
if (!out.includes("PASS")) fail("tests did not print PASS");

console.log("CI PASS");
process.exit(0);
`,
      "README.md": `# Fixture: office_incident_cli_1

Run: \`node ci.cjs\`

Goal: Make CI pass by fixing code.
`,
    },
    office_conflict_cli_1: {
      "src/math.cjs": `exports.add = (a, b) => a + b;
exports.mul = (a, b) => a * b;
exports.percentOf = (total, pct) => total * pct;
`,
      "src/service.cjs": `const { add, mul, percentOf } = require("./math.cjs");

exports.computeInvoiceSubtotal = (items) => {
  // items: [{price, qty}]
  let total = 0;
  for (const it of items) {
    total = add(total, mul(it.price, it.qty));
  }
  return total;
};

exports.applyDiscount = (subtotal, discountPct) => {
  // BUG: discount should reduce total, not increase it
  return subtotal + percentOf(subtotal, discountPct);
};

exports.computeInvoiceTotal = (items, discountPct = 0) => {
  const subtotal = exports.computeInvoiceSubtotal(items);
  if (!discountPct) return subtotal;
  return exports.applyDiscount(subtotal, discountPct);
};
`,
      "test.cjs": `const assert = require("node:assert/strict");
const { computeInvoiceSubtotal, computeInvoiceTotal } = require("./src/service.cjs");

try {
  const items = [{ price: 10, qty: 2 }, { price: 5, qty: 3 }]; // 20 + 15 = 35
  assert.equal(computeInvoiceSubtotal(items), 35);
  assert.equal(computeInvoiceTotal(items, 0.1), 31.5); // 10% discount

  console.log("PASS");
  process.exit(0);
} catch (e) {
  console.log("FAIL");
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
}
`,
      "ci.cjs": `const { spawnSync } = require("node:child_process");

function fail(msg) {
  console.log("CI FAIL");
  console.error(msg);
  process.exit(1);
}

const test = spawnSync("node test.cjs", { shell: true, encoding: "utf8" });
const out = String(test.stdout || "");
const err = String(test.stderr || "");
if (test.status !== 0) fail(\`tests failed (exit \${test.status})\\nstdout:\\n\${out}\\nstderr:\\n\${err}\`);
if (!out.includes("PASS")) fail("tests did not print PASS");

console.log("CI PASS");
process.exit(0);
`,
      "README.md": `# Fixture: office_conflict_cli_1

Run: \`node ci.cjs\`

Goal: Make CI pass by fixing discount logic.
`,
    },
    todo_app_mvp_1: {
      "server.cjs": `const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      if (!buf.trim()) return resolve(null);
      try {
        resolve(JSON.parse(buf));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function text(res, status, body, type = "text/plain; charset=utf-8") {
  res.statusCode = status;
  res.setHeader("content-type", type);
  res.end(body);
}

function startServer({ port = 0, dataFile = path.join(__dirname, "data", "todos.json") } = {}) {
  // TODO: implement a real todo app server:
  // - Serve / (HTML), /app.js, /style.css from ./public
  // - Implement a JSON API:
  //   GET /api/todos -> [{id,text,completed}]
  //   POST /api/todos {text} -> new todo
  //   PATCH /api/todos/:id {completed?} -> updated todo
  //   DELETE /api/todos/:id -> {ok:true}
  // - Persist to dataFile (create dirs as needed)
  // - Export { startServer }

  const server = http.createServer(async (req, res) => {
    if (req.url === "/health") return text(res, 200, "ok");
    return text(res, 501, "TODO: implement todo app");
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = addr && typeof addr === "object" ? addr.port : port;
      resolve({
        url: \`http://127.0.0.1:\${actualPort}\`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

module.exports = { startServer };

if (require.main === module) {
  startServer({ port: process.env.PORT ? Number(process.env.PORT) : 3000 }).then(({ url }) => {
    console.log(\`Todo app server listening at \${url}\`);
  });
}
`,
      "public/index.html": `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Todo App</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <main data-testid="app">
      <h1>Todo App</h1>
      <p class="hint">TODO: implement UI</p>
      <div id="root"></div>
    </main>
    <script src="/app.js"></script>
  </body>
</html>
`,
      "public/app.js": `// TODO: implement UI:
// - render list of todos (GET /api/todos)
// - add todo (POST /api/todos)
// - toggle completed (PATCH /api/todos/:id)
// - delete (DELETE /api/todos/:id)
console.log("todo app placeholder");
`,
      "public/style.css": `body { font-family: system-ui, sans-serif; margin: 24px; }
.hint { color: #666; }
`,
      "data/.gitkeep": "",
      "test.cjs": `const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { startServer } = require("./server.cjs");

async function fetchJson(url, opts) {
  const res = await fetch(url, { ...opts, headers: { "content-type": "application/json", ...(opts && opts.headers ? opts.headers : {}) } });
  const txt = await res.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch {}
  return { res, txt, json };
}

async function main() {
  const dataFile = path.join(__dirname, "data", "todos.json");
  try { fs.rmSync(dataFile, { force: true }); } catch {}

  const srv1 = await startServer({ port: 0, dataFile });
  const base = srv1.url;

  // HTML shell exists
  const htmlRes = await fetch(base + "/");
  assert.equal(htmlRes.status, 200, "GET / should return 200");
  const html = await htmlRes.text();
  assert.ok(html.includes("<title>Todo App</title>"), "HTML title should exist");

  // Static assets exist
  const jsRes = await fetch(base + "/app.js");
  assert.equal(jsRes.status, 200, "GET /app.js should return 200");
  const cssRes = await fetch(base + "/style.css");
  assert.equal(cssRes.status, 200, "GET /style.css should return 200");

  // Empty list
  const list0 = await fetchJson(base + "/api/todos");
  assert.equal(list0.res.status, 200, "GET /api/todos should return 200");
  assert.ok(Array.isArray(list0.json), "GET /api/todos should return array");
  assert.equal(list0.json.length, 0, "initial todos should be empty");

  // Create
  const created = await fetchJson(base + "/api/todos", { method: "POST", body: JSON.stringify({ text: "Buy milk" }) });
  assert.equal(created.res.status, 201, "POST /api/todos should return 201");
  assert.equal(created.json.text, "Buy milk");
  assert.equal(created.json.completed, false);
  assert.ok(created.json.id, "created todo should have id");

  // Toggle
  const toggled = await fetchJson(base + "/api/todos/" + encodeURIComponent(created.json.id), {
    method: "PATCH",
    body: JSON.stringify({ completed: true }),
  });
  assert.equal(toggled.res.status, 200, "PATCH should return 200");
  assert.equal(toggled.json.completed, true);

  // Delete
  const del = await fetchJson(base + "/api/todos/" + encodeURIComponent(created.json.id), { method: "DELETE" });
  assert.equal(del.res.status, 200, "DELETE should return 200");
  assert.equal(del.json.ok, true);

  await srv1.close();

  // Persistence: create todo, restart, it should still be there.
  const srv2 = await startServer({ port: 0, dataFile });
  const base2 = srv2.url;
  const created2 = await fetchJson(base2 + "/api/todos", { method: "POST", body: JSON.stringify({ text: "Persist me" }) });
  assert.equal(created2.res.status, 201);
  await srv2.close();

  const srv3 = await startServer({ port: 0, dataFile });
  const base3 = srv3.url;
  const list3 = await fetchJson(base3 + "/api/todos");
  assert.equal(list3.res.status, 200);
  assert.equal(list3.json.length, 1);
  assert.equal(list3.json[0].text, "Persist me");
  await srv3.close();

  console.log("PASS");
}

main().catch((e) => {
  console.log("FAIL");
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
`,
      "ci.cjs": `const { spawnSync } = require("node:child_process");
const fs = require("node:fs");

function fail(msg) {
  console.log("CI FAIL");
  console.error(msg);
  process.exit(1);
}

// No external deps allowed.
for (const p of ["server.cjs", "public/app.js"]) {
  const body = fs.readFileSync(p, "utf8");
  if (body.includes('require(\"express\")') || body.includes('from \"express\"') || body.includes(\"koa\") || body.includes(\"fastify\")) {
    fail(\`\${p} appears to use a framework (not allowed)\`);
  }
}

const test = spawnSync("node test.cjs", { shell: true, encoding: "utf8" });
const out = String(test.stdout || "");
const err = String(test.stderr || "");
if (test.status !== 0) fail(\`tests failed (exit \${test.status})\\nstdout:\\n\${out}\\nstderr:\\n\${err}\`);
if (!out.includes("PASS")) fail("tests did not print PASS");

if (!fs.existsSync("README.md")) fail("README.md missing");
const readme = fs.readFileSync("README.md", "utf8");
if (!readme.includes("How to run")) fail("README.md missing 'How to run' section");
if (!readme.includes("API")) fail("README.md missing 'API' section");

// Hygiene: fixture TODOs must be removed by the implementer.
for (const p of ["server.cjs", "public/app.js", "public/index.html"]) {
  const body = fs.readFileSync(p, "utf8");
  if (body.includes("TODO:")) fail(\`\${p} still contains TODO markers\`);
}

console.log("CI PASS");
process.exit(0);
`,
      "README.md": `# Todo App (MVP)

## How to run

- Run CI: \`node ci.cjs\`
- Run server: \`node server.cjs\` (defaults to port 3000)

## API

- \`GET /api/todos\` -> \`[{id,text,completed}]\`
- \`POST /api/todos\` body \`{text}\` -> \`201\` + new todo
- \`PATCH /api/todos/:id\` body \`{completed}\` -> updated todo
- \`DELETE /api/todos/:id\` -> \`{ok:true}\`
`,
    },
    todo_app_brand_v2_1: {
      "server.cjs": `const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      if (!buf.trim()) return resolve(null);
      try {
        resolve(JSON.parse(buf));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function text(res, status, body, type = "text/plain; charset=utf-8") {
  res.statusCode = status;
  res.setHeader("content-type", type);
  res.end(body);
}

function startServer({ port = 0, dataFile = path.join(__dirname, "data", "todos.json") } = {}) {
  // TODO: implement a real todo app server (v2):
  // - Serve / (HTML), /app.js, /style.css, and /assets/* from ./public
  // - Implement a JSON API:
  //   GET /api/todos -> [{id,text,completed}]
  //   GET /api/todos?completed=true|false -> filtered list
  //   POST /api/todos body {text} -> 201 + new todo
  //   PATCH /api/todos/:id body {completed?, text?} -> updated todo
  //   DELETE /api/todos/:id -> {ok:true}
  // - Persist to dataFile (create dirs as needed)
  // - Export { startServer }

  const server = http.createServer(async (req, res) => {
    if (req.url === "/health") return text(res, 200, "ok");
    return text(res, 501, "TODO: implement todo app");
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = addr && typeof addr === "object" ? addr.port : port;
      resolve({
        url: "http://127.0.0.1:" + actualPort,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

module.exports = { startServer };

if (require.main === module) {
  startServer({ port: process.env.PORT ? Number(process.env.PORT) : 3000 }).then(({ url }) => {
    console.log("Todo app server listening at " + url);
  });
}
`,
      "public/index.html": `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Todo App</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <main data-testid="app">
      <!-- TODO: add logo + improved layout -->
      <h1>Todo App</h1>
      <p class="hint">TODO: implement UI</p>
      <div id="root"></div>
    </main>
    <script src="/app.js"></script>
  </body>
</html>
`,
      "public/app.js": `// TODO: implement UI (v2):
// - render list of todos (GET /api/todos)
// - add todo (POST /api/todos)
// - toggle completed (PATCH /api/todos/:id)
// - edit todo text (PATCH /api/todos/:id)
// - delete (DELETE /api/todos/:id)
console.log("todo app placeholder");
`,
      "public/style.css": `body { font-family: system-ui, sans-serif; margin: 24px; }
.hint { color: #666; }
/* TODO: improve styling */
`,
      "public/assets/.gitkeep": "",
      "data/.gitkeep": "",
      "test.cjs": `const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { startServer } = require("./server.cjs");

async function fetchJson(url, opts) {
  const res = await fetch(url, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts && opts.headers ? opts.headers : {}) },
  });
  let json;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { res, json };
}

async function fetchText(url) {
  const res = await fetch(url);
  const body = await res.text();
  return { res, body };
}

async function fetchBytes(url) {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  return { res, buf };
}

async function main() {
  const dataFile = path.join(__dirname, "data", "todos.json");
  try {
    fs.unlinkSync(dataFile);
  } catch {}

  const srv = await startServer({ port: 0, dataFile });
  const base = srv.url;

  // Static content
  const idx = await fetchText(base + "/");
  assert.equal(idx.res.status, 200, "GET / should return 200");
  const appJs = await fetchText(base + "/app.js");
  assert.equal(appJs.res.status, 200, "GET /app.js should return 200");
  const css = await fetchText(base + "/style.css");
  assert.equal(css.res.status, 200, "GET /style.css should return 200");

  // Design asset (must exist)
  const logo = await fetchBytes(base + "/assets/logo.png");
  assert.equal(logo.res.status, 200, "GET /assets/logo.png should return 200");
  const ct = String(logo.res.headers.get("content-type") || "");
  assert.ok(ct.startsWith("image/"), "logo should be served as image/*");
  assert.ok(logo.buf.length > 100, "logo should not be empty");

  // API
  const list0 = await fetchJson(base + "/api/todos");
  assert.equal(list0.res.status, 200, "GET /api/todos should return 200");
  assert.ok(Array.isArray(list0.json), "GET /api/todos should return array");
  assert.equal(list0.json.length, 0, "initial todos should be empty");

  const bad = await fetchJson(base + "/api/todos", { method: "POST", body: JSON.stringify({}) });
  assert.equal(bad.res.status, 400, "POST /api/todos without text should return 400");

  const created = await fetchJson(base + "/api/todos", { method: "POST", body: JSON.stringify({ text: "Buy milk" }) });
  assert.equal(created.res.status, 201, "POST /api/todos should return 201");
  assert.ok(created.json && created.json.id, "created todo should have id");
  assert.equal(created.json.text, "Buy milk");
  assert.equal(created.json.completed, false);

  const toggled = await fetchJson(base + "/api/todos/" + encodeURIComponent(created.json.id), {
    method: "PATCH",
    body: JSON.stringify({ completed: true }),
  });
  assert.equal(toggled.res.status, 200, "PATCH /api/todos/:id should return 200");
  assert.equal(toggled.json.completed, true);

  const edited = await fetchJson(base + "/api/todos/" + encodeURIComponent(created.json.id), {
    method: "PATCH",
    body: JSON.stringify({ text: "Buy oat milk" }),
  });
  assert.equal(edited.res.status, 200, "PATCH /api/todos/:id (text) should return 200");
  assert.equal(edited.json.text, "Buy oat milk");

  const listAll = await fetchJson(base + "/api/todos");
  assert.equal(listAll.json.length, 1);

  const listDone = await fetchJson(base + "/api/todos?completed=true");
  assert.equal(listDone.res.status, 200);
  assert.equal(listDone.json.length, 1);

  const listOpen = await fetchJson(base + "/api/todos?completed=false");
  assert.equal(listOpen.res.status, 200);
  assert.equal(listOpen.json.length, 0);

  const del = await fetchJson(base + "/api/todos/" + encodeURIComponent(created.json.id), { method: "DELETE" });
  assert.equal(del.res.status, 200, "DELETE should return 200");
  assert.deepEqual(del.json, { ok: true });

  const list2 = await fetchJson(base + "/api/todos");
  assert.equal(list2.json.length, 0);

  await srv.close();

  // Persistence: create todo, restart, it should still be there.
  const srv2 = await startServer({ port: 0, dataFile });
  const base2 = srv2.url;
  const created2 = await fetchJson(base2 + "/api/todos", { method: "POST", body: JSON.stringify({ text: "Persist me" }) });
  assert.equal(created2.res.status, 201);
  await srv2.close();

  const srv3 = await startServer({ port: 0, dataFile });
  const base3 = srv3.url;
  const list3 = await fetchJson(base3 + "/api/todos");
  assert.equal(list3.res.status, 200);
  assert.equal(list3.json.length, 1);
  assert.equal(list3.json[0].text, "Persist me");
  await srv3.close();

  console.log("PASS");
}

main().catch((e) => {
  console.log("FAIL");
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
`,
      "ci.cjs": `const { spawnSync } = require("node:child_process");
const fs = require("node:fs");

function fail(msg) {
  console.log("CI FAIL");
  console.error(msg);
  process.exit(1);
}

// No external deps allowed.
for (const p of ["server.cjs", "public/app.js"]) {
  const body = fs.readFileSync(p, "utf8");
  if (body.includes('require("express")') || body.includes('from "express"') || body.includes("koa") || body.includes("fastify")) {
    fail(p + " appears to use a framework (not allowed)");
  }
}

const test = spawnSync("node test.cjs", { shell: true, encoding: "utf8" });
const out = String(test.stdout || "");
const err = String(test.stderr || "");
if (test.status !== 0) fail("tests failed (exit " + test.status + ")\\nstdout:\\n" + out + "\\nstderr:\\n" + err);
if (!out.includes("PASS")) fail("tests did not print PASS");

if (!fs.existsSync("README.md")) fail("README.md missing");
const readme = fs.readFileSync("README.md", "utf8");
if (!readme.includes("How to run")) fail("README.md missing 'How to run' section");
if (!readme.includes("API")) fail("README.md missing 'API' section");
if (!readme.includes("Design Assets")) fail("README.md missing 'Design Assets' section");

// Hygiene: fixture TODOs must be removed by the implementer.
for (const p of ["server.cjs", "public/app.js", "public/index.html", "public/style.css"]) {
  const body = fs.readFileSync(p, "utf8");
  if (body.includes("TODO:")) fail(p + " still contains TODO markers");
}

// Require a real logo asset.
if (!fs.existsSync("public/assets/logo.png")) fail("missing public/assets/logo.png");
const logoSize = fs.statSync("public/assets/logo.png").size;
if (logoSize <= 100) fail("logo is too small (expected >100 bytes)");
const html = fs.readFileSync("public/index.html", "utf8");
if (!html.includes("/assets/logo.png")) fail("public/index.html must reference /assets/logo.png");

console.log("CI PASS");
process.exit(0);
`,
      "README.md": `# Todo App (Brand V2)

## How to run

- Run CI: \`node ci.cjs\`
- Run server: \`node server.cjs\` (defaults to port 3000)

## API

- \`GET /api/todos\` -> \`[{id,text,completed}]\`
- \`GET /api/todos?completed=true|false\` -> filtered list
- \`POST /api/todos\` body \`{text}\` -> \`201\` + new todo
- \`PATCH /api/todos/:id\` body \`{completed?, text?}\` -> updated todo
- \`DELETE /api/todos/:id\` -> \`{ok:true}\`

## Design Assets

- \`public/assets/logo.png\` is required.
- Reference the logo from \`public/index.html\`.
`,
    },

  };
}

function ensureRepoFileComponent(): void {
  if (getDynamicComponent("RepoFile")) return;
  createDynamicComponent({
    name: "RepoFile",
    description: "In-world repo file (for deterministic office tooling tests)",
    properties: { path: "string", content: "string" },
  });
}

function findRepoFileByPath(world: World, path: string): number | undefined {
  ensureRepoFileComponent();
  const RepoFile = getDynamicComponent("RepoFile")!;
  // For now, scan named entities (sufficient for deterministic behavioral tests).
  for (const eid of Array.from(query(world as any, [Name] as any))) {
    const p = RepoFile.path?.[eid];
    if (typeof p === "string" && p === path) return eid;
  }
  return undefined;
}

function addAgentMemory(
  ctx: OfficeToolContext,
  data: { type: "episodic" | "semantic" | "procedural"; content: string; importance?: number; emotionalValence?: number }
): number | undefined {
  const actorEid = ctx.actorEid;
  if (actorEid === undefined) return undefined;
  if (!hasComponent(ctx.world as any, actorEid, Agent as any)) return undefined;

  const memoryEid = addEntity(ctx.world as any);
  addComponent(ctx.world as any, memoryEid, Memory as any);
  addComponent(ctx.world as any, actorEid, HasMemory(memoryEid) as any);

  Memory.type[memoryEid] = data.type;
  Memory.content[memoryEid] = data.content;
  Memory.importance[memoryEid] = data.importance ?? 0.6;
  Memory.emotionalValence[memoryEid] = data.emotionalValence ?? 0;
  Memory.timestamp[memoryEid] = Date.now();
  Memory.lastRecalled[memoryEid] = Date.now();
  Memory.recallCount[memoryEid] = 0;

  return memoryEid;
}

function findNamedChildWithComponent(world: World, containerEid: number, name: string, component: any): number | undefined {
  for (const child of listDirectContents(world, containerEid)) {
    if (!hasComponent(world as any, child, component as any)) continue;
    if (String(Name.value[child] || "") === name) return child;
  }
  return undefined;
}

function ensureKanbanBoard(world: World, boardEid: number, project?: string): void {
  if (!hasComponent(world as any, boardEid, KanbanBoard as any)) {
    addComponent(world as any, boardEid, KanbanBoard as any);
    KanbanBoard.createdAt[boardEid] = Date.now();
  }
  if (project && !String(KanbanBoard.project[boardEid] || "").trim()) KanbanBoard.project[boardEid] = project;
}

function listKanbanColumns(world: World, boardEid: number): Array<{ eid: number; name: string; position: number }> {
  const cols: Array<{ eid: number; name: string; position: number }> = [];
  for (const child of listDirectContents(world, boardEid)) {
    if (!hasComponent(world as any, child, KanbanColumn as any)) continue;
    cols.push({
      eid: child,
      name: String(Name.value[child] || KanbanColumn.name[child] || ""),
      position: Number(KanbanColumn.position[child] || 0),
    });
  }
  cols.sort((a, b) => a.position - b.position);
  return cols;
}

function findKanbanCard(world: World, boardEid: number, title: string): { cardEid: number; columnEid: number } | undefined {
  for (const col of listDirectContents(world, boardEid)) {
    if (!hasComponent(world as any, col, KanbanColumn as any)) continue;
    for (const child of listDirectContents(world, col)) {
      if (!hasComponent(world as any, child, KanbanCard as any)) continue;
      if (String(Name.value[child] || KanbanCard.title[child] || "") === title) return { cardEid: child, columnEid: col };
    }
  }
  return undefined;
}

function findWikiDoc(world: World, title: string): number | undefined {
  // For now, scan named entities. (Deterministic and sufficient for behavioral tests.)
  for (const eid of Array.from(query(world as any, [Name] as any))) {
    if (!hasComponent(world as any, eid, WikiDoc as any)) continue;
    if (String(Name.value[eid] || WikiDoc.title[eid] || "") === title) return eid;
  }
  return undefined;
}

function normalizeName(s: string): string {
  return String(s || "").trim();
}

function findNamedEntity(world: World, name: string): number | undefined {
  const wanted = normalizeName(name);
  if (!wanted) return undefined;
  for (const eid of Array.from(query(world as any, [Name] as any))) {
    if (normalizeName(Name.value[eid] || "") === wanted) return eid;
  }
  return undefined;
}

function findFirstRoomEid(world: World): number | undefined {
  for (const eid of Array.from(query(world as any, [Room] as any))) {
    return eid;
  }
  return undefined;
}

function findOrgGovernance(world: World, name?: string): number | undefined {
  const wanted = normalizeName(name || "");
  for (let eid = 0; eid < (OrgGovernance.enabled as any).length; eid++) {
    if (!hasComponent(world as any, eid, OrgGovernance as any)) continue;
    if (!wanted) return eid;
    if (normalizeName(Name.value[eid] || "") === wanted) return eid;
  }
  return undefined;
}

function findOrgStaffingGovernor(world: World, name?: string): number | undefined {
  const wanted = normalizeName(name || "");
  for (let eid = 0; eid < (OrgStaffingGovernor.enabled as any).length; eid++) {
    if (!hasComponent(world as any, eid, OrgStaffingGovernor as any)) continue;
    if (!wanted) return eid;
    if (normalizeName(Name.value[eid] || "") === wanted) return eid;
  }
  return undefined;
}

function getOrgGovernanceConfig(world: World): {
  enabled: boolean;
  wipLimit: number;
  doneRequiresToolId: string;
  doneRequiresCommandIncludes: string;
  doneRequiresReview: boolean;
  reviewColumnName: string;
} | null {
  for (let eid = 0; eid < (OrgGovernance.enabled as any).length; eid++) {
    if (!hasComponent(world as any, eid, OrgGovernance as any)) continue;
    if (OrgGovernance.enabled[eid] === false) continue;
    return {
      enabled: true,
      wipLimit: Number.isFinite(Number(OrgGovernance.wipLimit[eid])) ? Number(OrgGovernance.wipLimit[eid]) : 0,
      doneRequiresToolId: String(OrgGovernance.doneRequiresToolId[eid] || "terminal.run"),
      doneRequiresCommandIncludes: String(OrgGovernance.doneRequiresCommandIncludes[eid] || "test"),
      doneRequiresReview: OrgGovernance.doneRequiresReview?.[eid] === true,
      reviewColumnName: String(OrgGovernance.reviewColumnName?.[eid] || "Review") || "Review",
    };
  }
  return null;
}

function countOwnedCardsInColumn(world: World, ownerEid: number, boardEid: number, columnName: string): number {
  const colEid = findNamedChildWithComponent(world, boardEid, columnName, KanbanColumn as any);
  if (colEid === undefined) return 0;
  let count = 0;
  for (const card of listDirectContents(world, colEid)) {
    if (!hasComponent(world as any, card, KanbanCard as any)) continue;
    if (Number(KanbanCard.ownerEid[card] ?? -1) !== Number(ownerEid)) continue;
    count++;
  }
  return count;
}

function hasRecentPassingToolEvidence(world: World, actorEid: number, toolId: string, commandIncludes: string, withinMs: number = 15 * 60_000): boolean {
  const since = Date.now() - withinMs;
  const toolEids = getRelationTargets(world as any, actorEid, HasToolResult as any) as number[];
  for (const eid of toolEids) {
    if (!hasComponent(world as any, eid, ToolResult as any)) continue;
    if (Number(ToolResult.timestamp[eid] || 0) < since) continue;
    if (String(ToolResult.toolId[eid] || "") !== toolId) continue;
    const cmd = String(ToolResult.command[eid] || "");
    if (commandIncludes && !cmd.includes(commandIncludes)) continue;
    if (Number(ToolResult.exitCode[eid] ?? 1) !== 0) continue;
    if (!ToolResult.ok[eid]) continue;
    return true;
  }
  return false;
}

function getFirstActiveGoalDescription(world: World, actorEid: number): string {
  const goalEids = getRelationTargets(world as any, actorEid, HasGoal as any) as number[];
  for (const gid of goalEids) {
    if (!hasComponent(world as any, gid, Goal as any)) continue;
    if (String(Goal.status[gid] || "") !== "active") continue;
    const desc = String(Goal.description[gid] || "").trim();
    if (desc) return desc;
  }
  return "";
}

function parseWritesHint(goalDesc: string): string[] {
  const desc = String(goalDesc || "");
  const m = desc.match(/Writes\s*:\s*([^\n|]+)/i);
  if (!m || !m[1]) return [];
  return m[1]
    .split(",")
    .map((s) => String(s || "").trim())
    .map((s) => s.replace(/^`/, "").replace(/`$/, ""))
    .map((s) => (s.includes(" ") ? s.slice(0, s.indexOf(" ")) : s))
    .map((s) => s.replace(/[.]+$/, ""))
    .filter(Boolean)
    .slice(0, 24);
}

export function registerBuiltinOfficeTools(): void {
	  registerOfficeTool("terminal.run", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
	    const command = typeof params?.command === "string" ? params.command : "";
	    if (!command.trim()) return { ok: false, summary: "Missing command", stderr: "terminal.run requires {command}" };

    const toolMode = getOfficeToolMode();
    if (toolMode !== "shell") {
      return {
        ok: false,
        summary: "Shell execution disabled (scripted mode)",
        stderr: "Set office tool mode to 'shell' to execute real commands",
      };
    }

    if (process.env.OFFICE_TOOLS_ALLOW_SHELL !== "1") {
      return {
        ok: false,
        summary: "Shell execution blocked by policy",
        stderr: "Set OFFICE_TOOLS_ALLOW_SHELL=1 to enable terminal.run",
      };
    }

	    const sandboxCwd = ensureOfficeDeviceSandboxDir(ctx.world, ctx.deviceEid);
	    const env = {
	      ...process.env,
	      HOME: sandboxCwd,
	      TMPDIR: path.join(sandboxCwd, "tmp"),
	      NODE_NO_WARNINGS: "1",
	      ARGOS_OFFICE_SANDBOX_DIR: sandboxCwd,
	      // Prevent accidental discovery of the parent repo's .git when running from inside this workspace.
	      GIT_CEILING_DIRECTORIES: sandboxCwd,
	      GIT_DISCOVERY_ACROSS_FILESYSTEM: "0",
	    } as Record<string, string>;

	    const { jobId } = enqueueOfficeProcessJob({
	      toolId: "terminal.run",
	      actorEid: ctx.actorEid,
	      deviceEid: ctx.deviceEid,
	      command,
	      cwd: sandboxCwd,
	      env,
	      shell: true,
	      timeoutMs: 30_000,
	      maxBufferBytes: 2 * 1024 * 1024,
	      dedupKey: `terminal.run|${ctx.actorEid}|${ctx.deviceEid}|${command}`,
	      postProcess: (raw) => ({
	        ok: raw.exitCode === 0 && !raw.timedOut,
	        summary: `terminal.run (${raw.exitCode}) in ${raw.durationMs}ms${raw.timedOut ? " (timeout)" : ""}`,
	        stdout: raw.stdout,
	        stderr: raw.stderr,
	        exitCode: raw.exitCode,
	      }),
	    });

	    return { ok: true, pending: true, jobId, summary: `terminal.run queued (${jobId})` };
	  });

  registerOfficeTool("gemini.cli", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    // Allow either plain strings or a JSON string payload passed through affordanceArgs:
    // gemini_cli {"prompt":"...","files":["src/a.cjs"],"outputFormat":"text"}
    let raw =
      typeof params?.prompt === "string"
        ? params.prompt
        : typeof params?.input === "string"
          ? params.input
          : typeof params?.command === "string"
            ? params.command
            : "";
    raw = String(raw || "");
    if (!raw.trim()) {
      const goalDesc = getFirstActiveGoalDescription(ctx.world, ctx.actorEid);
      if (!goalDesc) return { ok: false, summary: "Missing prompt", stderr: "gemini.cli requires {prompt} (or an active goal to infer it from)" };
      const writes = parseWritesHint(goalDesc);
      const inferred = {
        prompt:
          "You are operating inside a sandboxed workspace directory.\n" +
          "TASK:\n" +
          goalDesc +
          "\n\n" +
          "CONSTRAINTS:\n" +
          "- Make `node ci.cjs` pass (or the Run: command in the ticket).\n" +
          "- Do not add external dependencies.\n" +
          "- Keep changes minimal; remove any TODO markers the fixture requires.\n" +
          "- Prefer editing existing files in-place.\n" +
          (writes.length ? `\nAllowed focus files (from ticket Writes:): ${writes.join(", ")}\n` : ""),
        files: writes,
        outputFormat: "text",
        sandbox: true,
        approvalMode: "yolo",
        timeoutMs: 180000,
      };
      raw = JSON.stringify(inferred);
    }

    let parsed: any = undefined;
    if (raw.trim().startsWith("{")) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = undefined;
      }
    }

    const prompt =
      typeof parsed?.prompt === "string"
        ? parsed.prompt
        : typeof parsed?.input === "string"
          ? parsed.input
          : typeof parsed?.command === "string"
            ? parsed.command
            : raw;
    if (!String(prompt || "").trim()) return { ok: false, summary: "Missing prompt", stderr: "gemini.cli requires a non-empty prompt" };

    const toolMode = getOfficeToolMode();
    if (toolMode !== "shell") {
      return {
        ok: false,
        summary: "Gemini CLI disabled (scripted mode)",
        stderr: "Set office tool mode to 'shell' to run gemini.cli",
      };
    }

    if (process.env.OFFICE_TOOLS_ALLOW_GEMINI_CLI !== "1") {
      return {
        ok: false,
        summary: "Gemini CLI blocked by policy",
        stderr: "Set OFFICE_TOOLS_ALLOW_GEMINI_CLI=1 to enable gemini.cli",
      };
    }

    const model = typeof parsed?.model === "string" ? parsed.model : (typeof params?.model === "string" ? params.model : undefined);
    const timeoutCap = Number.isFinite(Number(process.env.OFFICE_TOOLS_GEMINI_TIMEOUT_MAX_MS))
      ? Math.max(5_000, Number(process.env.OFFICE_TOOLS_GEMINI_TIMEOUT_MAX_MS))
      : 60_000;
    const timeoutMs = Number.isFinite(Number(parsed?.timeoutMs ?? params?.timeoutMs))
      ? Math.max(5_000, Math.min(timeoutCap, Number(parsed?.timeoutMs ?? params?.timeoutMs)))
      : timeoutCap;

    const outputFormat = typeof parsed?.outputFormat === "string" ? parsed.outputFormat : (typeof params?.outputFormat === "string" ? params.outputFormat : "json");
    const sandbox = (parsed?.sandbox === false || params?.sandbox === false) ? false : true;
    let approvalMode =
      parsed?.approvalMode === "auto_edit" || parsed?.approvalMode === "yolo" || parsed?.approvalMode === "default"
        ? parsed.approvalMode
        : params?.approvalMode === "auto_edit" || params?.approvalMode === "yolo" || params?.approvalMode === "default"
          ? params.approvalMode
        : "default";

    // Office tools run gemini-cli non-interactively via stdio pipes; interactive approvals deadlock these jobs.
    // Force a non-interactive approval mode for stability in simulation runs.
    if (approvalMode === "default" || (sandbox && approvalMode === "auto_edit")) approvalMode = "yolo";

    const args: string[] = [];
    if (model && model.trim()) args.push("--model", model.trim());
    args.push("--output-format", outputFormat === "text" ? "text" : "json");
    if (sandbox) args.push("--sandbox");
    args.push("--approval-mode", approvalMode);
    // Use positional prompt. (The -p/--prompt flag is deprecated in gemini-cli.)
    const sandboxCwd = ctx.deviceEid !== undefined ? ensureOfficeDeviceSandboxDir(ctx.world, ctx.deviceEid) : process.cwd();

    // Optionally include file contents from the workstation sandbox to ground the coding agent.
    const files: string[] = Array.isArray(parsed?.files) ? parsed.files.map((s: any) => String(s || "").trim()).filter(Boolean) : [];
    let fullPrompt = String(prompt || "");
    if (files.length) {
      const parts: string[] = [];
      parts.push(fullPrompt);
      parts.push("\nFILES (workspace-relative):");
      for (const rel of files.slice(0, 12)) {
        const abs = path.resolve(sandboxCwd, rel);
        let content = "";
        try {
          content = fs.readFileSync(abs, "utf8");
        } catch (e: any) {
          content = `<<ERROR reading ${rel}: ${String(e?.message || e)}>>`;
        }
        parts.push(`\n--- ${rel}\n${content}`);
      }
      fullPrompt = parts.join("\n");
    }
    args.push(fullPrompt);

	    const env = {
	      ...process.env,
	      // gemini-cli requires GEMINI_API_KEY; allow using existing project env names.
	      GEMINI_API_KEY:
	        process.env.GEMINI_API_KEY ||
	        process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
	        process.env.GOOGLE_API_KEY ||
	        "",
	      HOME: sandboxCwd,
	      TMPDIR: path.join(sandboxCwd, "tmp"),
	      ARGOS_OFFICE_SANDBOX_DIR: sandboxCwd,
	      // Prevent accidental discovery of the parent repo's .git when running from inside this workspace.
	      GIT_CEILING_DIRECTORIES: sandboxCwd,
	      GIT_DISCOVERY_ACROSS_FILESYSTEM: "0",
	    } as Record<string, string>;

    const { jobId } = enqueueOfficeProcessJob({
      toolId: "gemini.cli",
      actorEid: ctx.actorEid,
      deviceEid: ctx.deviceEid,
      command: "gemini",
      args,
      cwd: sandboxCwd,
      env,
      shell: false,
      timeoutMs,
      maxBufferBytes: 4 * 1024 * 1024,
      dedupKey: `gemini.cli|${ctx.actorEid}|${ctx.deviceEid}|${String(fullPrompt).slice(0, 2000)}`,
      postProcess: (raw) => {
        const stdout = String(raw.stdout || "");
        const stderr = String(raw.stderr || "");
        const exitCode = raw.exitCode;

        let extractedJson: string | undefined;
        if (outputFormat !== "text") {
          const combined = `${stdout}\n${stderr}`;

          const safeParseJson = (s: string): any | undefined => {
            const t = String(s || "").trim();
            if (!t.startsWith("{")) return undefined;
            try {
              return JSON.parse(t);
            } catch {
              // Try to parse a prefix ending at the last closing brace.
              let end = t.lastIndexOf("}");
              while (end > 0) {
                const prefix = t.slice(0, end + 1);
                try {
                  return JSON.parse(prefix);
                } catch {
                  end = t.lastIndexOf("}", end - 1);
                }
              }
              return undefined;
            }
          };

          const responseTextFromParsed = (obj: any): string => {
            if (!obj || typeof obj !== "object") return "";
            if (typeof obj.response === "string") return obj.response;
            if (typeof obj.output_text === "string") return obj.output_text;
            if (typeof obj.outputText === "string") return obj.outputText;
            if (typeof obj.text === "string") return obj.text;
            const parts = obj?.candidates?.[0]?.content?.parts;
            if (Array.isArray(parts)) {
              const texts = parts.map((p: any) => (p && typeof p.text === "string" ? p.text : "")).filter(Boolean);
              if (texts.length) return texts.join("\n");
            }
            return "";
          };



          const extractUnifiedDiffish = (s: string): string | undefined => {


            const raw = String(s || "");



            const attempt = (t: string): string | undefined => {
  const decodeJsonEscapes = (input: string): string => {
    let out = "";
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i] ?? "";
      if (ch !== "\\") {
        out += ch;
        continue;
      }
      const esc = input[i + 1] ?? "";
      if (!esc) break;
      i += 1;
      if (esc === '"') out += '"';
      else if (esc === "\\") out += "\\";
      else if (esc === "/") out += "/";
      else if (esc === "b") out += "\b";
      else if (esc === "f") out += "\f";
      else if (esc === "n") out += "\n";
      else if (esc === "r") out += "\r";
      else if (esc === "t") out += "\t";
      else if (esc === "u") {
        const hex = input.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else {
          out += "u";
        }
      } else {
        out += esc;
      }
    }
    return out;
  };

  let idx = t.indexOf("diff --git ");
  const alt = t.search(/^\s*---\s+(?:a\/|\/dev\/null)/m);
  if (idx < 0 && alt >= 0) idx = alt;
  if (idx < 0) return undefined;

  let patch = t.slice(idx);

  // Some gemini-cli JSON modes can emit a fully-escaped patch (single line with literal `\\n`).
  // Decode it before applying fence stripping and hunk parsing.
  const looksFullyEscaped = patch.includes("\\ndiff --git ") && !patch.includes("\ndiff --git ");
  if (looksFullyEscaped) patch = decodeJsonEscapes(patch);

  patch = patch.replace(/^\s*```[a-zA-Z]*\s*\n/, "").replace(/\n\s*```\s*$/, "");
  patch = patch.replace(/^\s*~~~[a-zA-Z]*\s*\n/, "").replace(/\n\s*~~~\s*$/, "");
  patch = patch
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");
  if (!patch.endsWith("\n")) patch += "\n";
  return patch;
};



            const direct = attempt(raw);


            if (direct) return direct;



            const extractJsonStringField = (t: string, field: string): string | undefined => {


              const key = `"${field}"`;


              let i = t.indexOf(key);


              if (i < 0) return undefined;


              i = t.indexOf(":", i + key.length);


              if (i < 0) return undefined;


              i += 1;


              while (i < t.length && /\s/.test(t[i] ?? "")) i += 1;


              if ((t[i] ?? "") !== '"') return undefined;


              i += 1;



              let out = "";


              while (i < t.length) {


                const ch = t[i++] ?? "";


                if (ch === '"') return out;


                if (ch !== "\\") {


                  out += ch;


                  continue;


                }


                if (i >= t.length) break;


                const esc = t[i++] ?? "";


                if (esc === '"') out += '"';


                else if (esc === "\\") out += "\\";


                else if (esc === "/") out += "/";


                else if (esc === "b") out += "\b";


                else if (esc === "f") out += "\f";


                else if (esc === "n") out += "\n";


                else if (esc === "r") out += "\r";


                else if (esc === "t") out += "\t";


                else if (esc === "u") {


                  const hex = t.slice(i, i + 4);


                  if (/^[0-9a-fA-F]{4}$/.test(hex)) {


                    out += String.fromCharCode(parseInt(hex, 16));


                    i += 4;


                  } else {


                    out += "u";


                  }


                } else {


                  out += esc;


                }


              }


              return out || undefined;


            };



            const decoded =


              extractJsonStringField(raw, "response") ||


              extractJsonStringField(raw, "output_text") ||


              extractJsonStringField(raw, "outputText") ||


              extractJsonStringField(raw, "text");



            if (decoded) {


              const fromDecoded = attempt(decoded);


              if (fromDecoded) return fromDecoded;


            }



            const unescaped = raw


              .replace(/(?<!\\)\\n/g, "\n")


              .replace(/(?<!\\)\\r/g, "\r")


              .replace(/(?<!\\)\\t/g, "\t");



            return attempt(unescaped);


          };




          const writeArtifact = (base: string, suffix: string, content: string): string | undefined => {
            if (!content) return undefined;
            try {
              const dir = path.join(process.cwd(), "stress-test-output", "tool-artifacts", "gemini-cli");
              fs.mkdirSync(dir, { recursive: true });
              const safeBase = String(base || `resp_${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, "_");
              const file = path.join(dir, `${safeBase}.${suffix}`);
              fs.writeFileSync(file, content, "utf8");
              return path.relative(process.cwd(), file);
            } catch {
              return undefined;
            }
          };

          const parsed = safeParseJson(stdout) ?? safeParseJson(combined);
          const sessionIdRaw = parsed?.session_id ?? parsed?.sessionId ?? parsed?.session ?? "";
          const sessionId = typeof sessionIdRaw === "string" ? sessionIdRaw : String(sessionIdRaw || "");
          const response = parsed ? responseTextFromParsed(parsed) : "";

          const patchish = extractUnifiedDiffish(response) ?? extractUnifiedDiffish(stdout) ?? extractUnifiedDiffish(combined);

          const minimal: any = { session_id: sessionId || undefined };
          if (patchish) {
            const file = writeArtifact(sessionId || jobId || "gemini", "response.txt", patchish);
            if (file) minimal.responseFile = file;
            else minimal.response = patchish.slice(0, 1200);
          } else if (response) {
            const file = writeArtifact(sessionId || jobId || "gemini", "response.txt", response);
            if (file) minimal.responseFile = file;
            else minimal.response = response.slice(0, 1200);
          } else {
            const rawFile = writeArtifact(sessionId || jobId || "gemini", "raw.txt", combined);
            if (rawFile) minimal.rawFile = rawFile;
          }

          const modelKeys = parsed?.stats?.models ? Object.keys(parsed.stats.models) : [];
          if (modelKeys.length) minimal.model = modelKeys[0];
          if (!minimal.model && typeof parsed?.model === "string") minimal.model = parsed.model;
          if (parsed?.error) minimal.error = parsed.error;

          extractedJson = JSON.stringify(minimal);
        }

        return {
          ok: exitCode === 0 && !raw.timedOut,
          summary: `gemini.cli (${exitCode}) in ${raw.durationMs}ms${raw.timedOut ? " (timeout)" : ""}`,
          stdout: extractedJson ?? stdout,
          stderr,
          exitCode,
          artifacts: extractedJson ? [{ kind: "gemini_json", uri: "inline://gemini.json" }] : undefined,
        };
      },
    });

    return { ok: true, pending: true, jobId, summary: `gemini.cli queued (${jobId})` };
  });

  registerOfficeTool("nano_banana.generate_image", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const toolMode = getOfficeToolMode();
    if (toolMode !== "shell") {
      return {
        ok: false,
        summary: "Image generation disabled (scripted mode)",
        stderr: "Set office tool mode to 'shell' to run nano_banana.generate_image",
      };
    }

    if (process.env.OFFICE_TOOLS_ALLOW_NANO_BANANA !== "1") {
      return {
        ok: false,
        summary: "Image generation blocked by policy",
        stderr: "Set OFFICE_TOOLS_ALLOW_NANO_BANANA=1 to enable nano_banana.generate_image",
      };
    }

    // Accept either JSON args (preferred) or a JSON string passed through affordanceArgs.
    let parsed: any = params;
    const raw =
      typeof params?.input === "string"
        ? params.input
        : typeof params?.command === "string"
          ? params.command
          : "";
    if (typeof raw === "string" && raw.trim().startsWith("{")) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        // ignore
      }
    }

    const prompt = typeof parsed?.prompt === "string" ? parsed.prompt : "";
    const outPath = typeof parsed?.outPath === "string" ? parsed.outPath : typeof parsed?.path === "string" ? parsed.path : "";
    const model = typeof parsed?.model === "string" && parsed.model.trim() ? parsed.model.trim() : "gemini-2.5-flash-image";
    const aspectRatio = typeof parsed?.aspectRatio === "string" && parsed.aspectRatio.trim() ? parsed.aspectRatio.trim() : undefined;
    const imageSize = typeof parsed?.imageSize === "string" && parsed.imageSize.trim() ? parsed.imageSize.trim() : undefined;

    if (!String(prompt || "").trim()) return { ok: false, summary: "Missing prompt", stderr: "nano_banana.generate_image requires {prompt}" };
    if (!String(outPath || "").trim()) return { ok: false, summary: "Missing outPath", stderr: "nano_banana.generate_image requires {outPath}" };

    const sandboxCwd = ensureOfficeDeviceSandboxDir(ctx.world, ctx.deviceEid);
    const absOut = path.resolve(sandboxCwd, outPath);
    if (!absOut.startsWith(sandboxCwd + path.sep) && absOut !== sandboxCwd) {
      return { ok: false, summary: "Path blocked", stderr: "outPath must be within the workspace" };
    }
    const relOut = path.relative(sandboxCwd, absOut).split(path.sep).join("/");

    const apiKey =
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      "";
    if (!String(apiKey || "").trim()) {
      return {
        ok: false,
        summary: "Missing API key",
        stderr: "Set GOOGLE_GENERATIVE_AI_API_KEY (or GEMINI_API_KEY) to enable Nano Banana",
      };
    }

    const payload = JSON.stringify({
      prompt: String(prompt),
      model,
      aspectRatio,
      imageSize,
      absOutPath: absOut,
      relOutPath: relOut,
    });

    const script = [
      '(async () => {',
      '  const fs = require("node:fs");',
      '  const path = require("node:path");',
      '  const payload = JSON.parse(process.env.ARGOS_NANO_BANANA_PAYLOAD || "{}");',
      '  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";',
      '  if (!apiKey) { console.error("Missing API key"); process.exit(2); }',
      '  const model = payload.model || "gemini-2.5-flash-image";',
      '  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent";',
      '  const genCfg = { responseModalities: ["IMAGE"] };',
      '  if (payload.aspectRatio || payload.imageSize) {',
      '    genCfg.imageConfig = {};',
      '    if (payload.aspectRatio) genCfg.imageConfig.aspectRatio = payload.aspectRatio;',
      '    if (payload.imageSize) genCfg.imageConfig.imageSize = payload.imageSize;',
      '  }',
      '  const body = { contents: [{ parts: [{ text: String(payload.prompt || "") }] }], generationConfig: genCfg };',
      '  const res = await fetch(endpoint, {',
      '    method: "POST",',
      '    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },',
      '    body: JSON.stringify(body),',
      '  });',
      '  const json = await res.json().catch(() => ({}));',
      '  if (!res.ok) { console.error("HTTP " + res.status + " " + JSON.stringify(json)); process.exit(3); }',
      '  const parts = (json && json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];',
      '  const imgPart = parts.find((p) => p && p.inlineData && p.inlineData.data);',
      '  if (!imgPart) { console.error("No inlineData in response"); process.exit(4); }',
      '  const mimeType = (imgPart.inlineData && imgPart.inlineData.mimeType) || "application/octet-stream";',
      '  const buf = Buffer.from(String(imgPart.inlineData.data || ""), "base64");',
      '  const absOut = String(payload.absOutPath || "");',
      '  if (!absOut) { console.error("Missing absOutPath"); process.exit(5); }',
      '  fs.mkdirSync(path.dirname(absOut), { recursive: true });',
      '  fs.writeFileSync(absOut, buf);',
      '  console.log(JSON.stringify({ ok: true, model, mimeType, bytes: buf.length, outPath: String(payload.relOutPath || "") }));',
      '})().catch((e) => { console.error(String(e && e.stack ? e.stack : e)); process.exit(1); });',
    ].join("\n");

    const env = {
      ...process.env,
      GOOGLE_GENERATIVE_AI_API_KEY: apiKey,
      HOME: sandboxCwd,
      TMPDIR: path.join(sandboxCwd, "tmp"),
      ARGOS_OFFICE_SANDBOX_DIR: sandboxCwd,
      ARGOS_NANO_BANANA_PAYLOAD: payload,
      // Prevent accidental discovery of the parent repo's .git when running from inside this workspace.
      GIT_CEILING_DIRECTORIES: sandboxCwd,
      GIT_DISCOVERY_ACROSS_FILESYSTEM: "0",
    } as Record<string, string>;

    const { jobId } = enqueueOfficeProcessJob({
      toolId: "nano_banana.generate_image",
      actorEid: ctx.actorEid,
      deviceEid: ctx.deviceEid,
      command: process.execPath,
      args: ["-e", script],
      cwd: sandboxCwd,
      env,
      timeoutMs: 120_000,
      maxBufferBytes: 2 * 1024 * 1024,
      dedupKey: `nano_banana.generate_image|${ctx.actorEid}|${ctx.deviceEid}|${model}|${relOut}|${String(prompt).slice(0, 200)}`,
      postProcess: (raw) => {
        const stdout = String(raw.stdout || "").trim();
        let parsedOut: any = undefined;
        try {
          if (stdout.startsWith("{")) parsedOut = JSON.parse(stdout);
        } catch {
          parsedOut = undefined;
        }

        const out = {
          ok: raw.exitCode == 0 && !raw.timedOut,
          summary: `nano_banana.generate_image (${raw.exitCode}) in ${raw.durationMs}ms${raw.timedOut ? " (timeout)" : ""}`,
          stdout: stdout,
          stderr: raw.stderr,
          exitCode: raw.exitCode,
          artifacts: parsedOut?.outPath ? [{ kind: "image", uri: `workspace://${parsedOut.outPath}` }] : undefined,
        } satisfies OfficeToolResult;
        return out;
      },
    });

    return { ok: true, pending: true, jobId, summary: `nano_banana.generate_image queued (${jobId})` };
  });

	  

  registerOfficeTool("nano_banana.edit_image", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const toolMode = getOfficeToolMode();
    if (toolMode !== "shell") {
      return {
        ok: false,
        summary: "Image editing disabled (scripted mode)",
        stderr: "Set office tool mode to 'shell' to run nano_banana.edit_image",
      };
    }

    if (process.env.OFFICE_TOOLS_ALLOW_NANO_BANANA !== "1") {
      return {
        ok: false,
        summary: "Image editing blocked by policy",
        stderr: "Set OFFICE_TOOLS_ALLOW_NANO_BANANA=1 to enable nano_banana.edit_image",
      };
    }

    let parsed: any = params;
    const raw =
      typeof params?.input === "string"
        ? params.input
        : typeof params?.command === "string"
          ? params.command
          : "";
    if (typeof raw === "string" && raw.trim().startsWith("{")) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        // ignore
      }
    }

    const prompt = typeof parsed?.prompt === "string" ? parsed.prompt : "";
    const inPath = typeof parsed?.inPath === "string" ? parsed.inPath : typeof parsed?.path === "string" ? parsed.path : "";
    const outPath = typeof parsed?.outPath === "string" ? parsed.outPath : inPath;
    const model = typeof parsed?.model === "string" && parsed.model.trim() ? parsed.model.trim() : "gemini-2.5-flash-image";
    const aspectRatio = typeof parsed?.aspectRatio === "string" && parsed.aspectRatio.trim() ? parsed.aspectRatio.trim() : "";
    const imageSize = typeof parsed?.imageSize === "string" && parsed.imageSize.trim() ? parsed.imageSize.trim() : "";

    if (!String(prompt || "").trim()) return { ok: false, summary: "Missing prompt", stderr: "nano_banana.edit_image requires {prompt}" };
    if (!String(inPath || "").trim()) return { ok: false, summary: "Missing inPath", stderr: "nano_banana.edit_image requires {inPath} (workspace-relative)" };
    if (!String(outPath || "").trim()) return { ok: false, summary: "Missing outPath", stderr: "nano_banana.edit_image requires {outPath} (workspace-relative)" };

    const sandboxCwd = ensureOfficeDeviceSandboxDir(ctx.world, ctx.deviceEid);
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
    if (!apiKey) return { ok: false, summary: "Missing API key", stderr: "Set GOOGLE_GENERATIVE_AI_API_KEY (or GEMINI_API_KEY/GOOGLE_API_KEY)" };

    const relIn = path.normalize(String(inPath).trim()).replace(/^(\.\.[/\\])+/, "");
    const relOut = path.normalize(String(outPath).trim()).replace(/^(\.\.[/\\])+/, "");
    const absIn = path.resolve(sandboxCwd, relIn);
    const absOut = path.resolve(sandboxCwd, relOut);
    if (!absIn.startsWith(sandboxCwd + path.sep) && absIn !== sandboxCwd) return { ok: false, summary: "Path blocked", stderr: "inPath must be within the workspace" };
    if (!absOut.startsWith(sandboxCwd + path.sep) && absOut !== sandboxCwd) return { ok: false, summary: "Path blocked", stderr: "outPath must be within the workspace" };

    try {
      fs.statSync(absIn);
    } catch {
      return { ok: false, summary: `Missing input image: ${relIn}`, stderr: "Input image does not exist in the workspace" };
    }

    const ext = path.extname(relIn).toLowerCase();
    const mimeType =
      ext === ".png"
        ? "image/png"
        : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".gif"
              ? "image/gif"
              : "application/octet-stream";

    const payload = JSON.stringify({
      prompt,
      model,
      mimeType,
      aspectRatio: aspectRatio || undefined,
      imageSize: imageSize || undefined,
      absInPath: absIn,
      absOutPath: absOut,
      relOutPath: relOut,
    });

    const script = [
      '(async () => {',
      '  const fs = require("node:fs");',
      '  const path = require("node:path");',
      '  const payload = JSON.parse(process.env.ARGOS_NANO_BANANA_EDIT_PAYLOAD || "{}");',
      '  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";',
      '  if (!apiKey) { console.error("Missing API key"); process.exit(2); }',
      '  const model = payload.model || "gemini-2.5-flash-image";',
      '  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent";',
      '  const absIn = String(payload.absInPath || "");',
      '  if (!absIn) { console.error("Missing absInPath"); process.exit(5); }',
      '  const inBuf = fs.readFileSync(absIn);',
      '  const inB64 = inBuf.toString("base64");',
      '  const genCfg = { responseModalities: ["IMAGE"] };',
      '  if (payload.aspectRatio || payload.imageSize) {',
      '    genCfg.imageConfig = {};',
      '    if (payload.aspectRatio) genCfg.imageConfig.aspectRatio = payload.aspectRatio;',
      '    if (payload.imageSize) genCfg.imageConfig.imageSize = payload.imageSize;',
      '  }',
      '  const body = {',
      '    contents: [{ parts: [',
      '      { text: String(payload.prompt || "") },',
      '      { inlineData: { mimeType: String(payload.mimeType || "application/octet-stream"), data: inB64 } }',
      '    ] }],',
      '    generationConfig: genCfg,',
      '  };',
      '  const res = await fetch(endpoint, {',
      '    method: "POST",',
      '    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },',
      '    body: JSON.stringify(body),',
      '  });',
      '  const json = await res.json().catch(() => ({}));',
      '  if (!res.ok) { console.error("HTTP " + res.status + " " + JSON.stringify(json)); process.exit(3); }',
      '  const parts = (json && json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];',
      '  const imgPart = parts.find((p) => p && p.inlineData && p.inlineData.data);',
      '  if (!imgPart) { console.error("No inlineData in response"); process.exit(4); }',
      '  const mimeType = (imgPart.inlineData && imgPart.inlineData.mimeType) || "application/octet-stream";',
      '  const buf = Buffer.from(String(imgPart.inlineData.data || ""), "base64");',
      '  const absOut = String(payload.absOutPath || "");',
      '  if (!absOut) { console.error("Missing absOutPath"); process.exit(6); }',
      '  fs.mkdirSync(path.dirname(absOut), { recursive: true });',
      '  fs.writeFileSync(absOut, buf);',
      '  console.log(JSON.stringify({ ok: true, model, mimeType, bytes: buf.length, outPath: String(payload.relOutPath || "") }));',
      '})().catch((e) => { console.error(String(e && e.stack ? e.stack : e)); process.exit(1); });',
    ].join("\n");

    const env = {
      ...process.env,
      GOOGLE_GENERATIVE_AI_API_KEY: apiKey,
      HOME: sandboxCwd,
      TMPDIR: path.join(sandboxCwd, "tmp"),
      ARGOS_OFFICE_SANDBOX_DIR: sandboxCwd,
      ARGOS_NANO_BANANA_EDIT_PAYLOAD: payload,
      // Prevent accidental discovery of the parent repo's .git when running from inside this workspace.
      GIT_CEILING_DIRECTORIES: sandboxCwd,
      GIT_DISCOVERY_ACROSS_FILESYSTEM: "0",
    } as Record<string, string>;

    const { jobId } = enqueueOfficeProcessJob({
      toolId: "nano_banana.edit_image",
      actorEid: ctx.actorEid,
      deviceEid: ctx.deviceEid,
      command: process.execPath,
      args: ["-e", script],
      cwd: sandboxCwd,
      env,
      timeoutMs: 180_000,
      maxBufferBytes: 2 * 1024 * 1024,
      dedupKey: `nano_banana.edit_image|${ctx.actorEid}|${ctx.deviceEid}|${model}|${relIn}|${relOut}|${String(prompt).slice(0, 200)}`,
      postProcess: (raw) => {
        const stdout = String(raw.stdout || "").trim();
        let parsedOut: any = undefined;
        try {
          if (stdout.startsWith("{")) parsedOut = JSON.parse(stdout);
        } catch {
          parsedOut = undefined;
        }

        const out = {
          ok: raw.exitCode == 0 && !raw.timedOut,
          summary: `nano_banana.edit_image (${raw.exitCode}) in ${raw.durationMs}ms${raw.timedOut ? " (timeout)" : ""}`,
          stdout: stdout,
          stderr: raw.stderr,
          exitCode: raw.exitCode,
          artifacts: parsedOut?.outPath ? [{ kind: "image", uri: `workspace://${parsedOut.outPath}` }] : undefined,
        } satisfies OfficeToolResult;
        return out;
      },
    });

    return { ok: true, pending: true, jobId, summary: `nano_banana.edit_image queued (${jobId})` };
  });

  registerOfficeTool("vision.describe_image", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const toolMode = getOfficeToolMode();
    if (toolMode !== "shell") {
      return {
        ok: false,
        summary: "Vision disabled (scripted mode)",
        stderr: "Set office tool mode to 'shell' to run vision.describe_image",
      };
    }

    if (process.env.OFFICE_TOOLS_ALLOW_VISION !== "1" && process.env.OFFICE_TOOLS_ALLOW_NANO_BANANA !== "1") {
      return {
        ok: false,
        summary: "Vision blocked by policy",
        stderr: "Set OFFICE_TOOLS_ALLOW_VISION=1 (or OFFICE_TOOLS_ALLOW_NANO_BANANA=1) to enable vision.describe_image",
      };
    }

    let parsed: any = params;
    const raw =
      typeof params?.input === "string"
        ? params.input
        : typeof params?.command === "string"
          ? params.command
          : "";
    if (typeof raw === "string" && raw.trim().startsWith("{")) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        // ignore
      }
    }

    let imgPath = typeof parsed?.path === "string" ? parsed.path : typeof parsed?.inPath === "string" ? parsed.inPath : "";
    if (!String(imgPath || "").trim() && typeof raw === "string" && raw.trim() && !raw.trim().startsWith("{")) {
      imgPath = raw.trim().split(/\s+/)[0] || "";
    }
    const prompt =
      typeof parsed?.prompt === "string" && parsed.prompt.trim()
        ? parsed.prompt
        : "Describe this image for a teammate. If it is a logo or UI asset, critique clarity, style, and fit for a Todo app in 3-6 bullets.";
    const model = typeof parsed?.model === "string" && parsed.model.trim() ? parsed.model.trim() : "gemini-2.0-flash";

    if (!String(imgPath || "").trim()) return { ok: false, summary: "Missing path", stderr: "vision.describe_image requires {path} (workspace-relative)" };

    const sandboxCwd = ensureOfficeDeviceSandboxDir(ctx.world, ctx.deviceEid);
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
    if (!apiKey) return { ok: false, summary: "Missing API key", stderr: "Set GOOGLE_GENERATIVE_AI_API_KEY (or GEMINI_API_KEY/GOOGLE_API_KEY)" };

    const rel = path.normalize(String(imgPath).trim()).replace(/^(\.\.[/\\])+/, "");
    const abs = path.resolve(sandboxCwd, rel);
    if (!abs.startsWith(sandboxCwd + path.sep) && abs !== sandboxCwd) return { ok: false, summary: "Path blocked", stderr: "path must be within the workspace" };

    try {
      fs.statSync(abs);
    } catch {
      return { ok: false, summary: `Missing image: ${rel}`, stderr: "Image does not exist in the workspace" };
    }

    const ext = path.extname(rel).toLowerCase();
    const mimeType =
      ext === ".png"
        ? "image/png"
        : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".gif"
              ? "image/gif"
              : "application/octet-stream";

    const payload = JSON.stringify({
      prompt,
      model,
      mimeType,
      absInPath: abs,
      relInPath: rel,
    });

    const script = [
      '(async () => {',
      '  const fs = require("node:fs");',
      '  const payload = JSON.parse(process.env.ARGOS_VISION_PAYLOAD || "{}");',
      '  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";',
      '  if (!apiKey) { console.error("Missing API key"); process.exit(2); }',
      '  const model = payload.model || "gemini-2.0-flash";',
      '  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent";',
      '  const absIn = String(payload.absInPath || "");',
      '  if (!absIn) { console.error("Missing absInPath"); process.exit(5); }',
      '  const inBuf = fs.readFileSync(absIn);',
      '  const inB64 = inBuf.toString("base64");',
      '  const body = {',
      '    contents: [{ parts: [',
      '      { text: String(payload.prompt || "") },',
      '      { inlineData: { mimeType: String(payload.mimeType || "application/octet-stream"), data: inB64 } }',
      '    ] }],',
      '  };',
      '  const res = await fetch(endpoint, {',
      '    method: "POST",',
      '    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },',
      '    body: JSON.stringify(body),',
      '  });',
      '  const json = await res.json().catch(() => ({}));',
      '  if (!res.ok) { console.error("HTTP " + res.status + " " + JSON.stringify(json)); process.exit(3); }',
      '  const parts = (json && json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];',
      '  const texts = parts.map((p) => (p && p.text ? String(p.text) : "")).filter(Boolean);',
      '  const out = texts.join(String.fromCharCode(10)).trim();',
      '  if (!out) { console.error("No text in response"); process.exit(4); }',
      '  console.log(out);',
      '})().catch((e) => { console.error(String(e && e.stack ? e.stack : e)); process.exit(1); });',
    ].join("\n");

    const env = {
      ...process.env,
      GOOGLE_GENERATIVE_AI_API_KEY: apiKey,
      HOME: sandboxCwd,
      TMPDIR: path.join(sandboxCwd, "tmp"),
      ARGOS_OFFICE_SANDBOX_DIR: sandboxCwd,
      ARGOS_VISION_PAYLOAD: payload,
      GIT_CEILING_DIRECTORIES: sandboxCwd,
      GIT_DISCOVERY_ACROSS_FILESYSTEM: "0",
    } as Record<string, string>;

    const { jobId } = enqueueOfficeProcessJob({
      toolId: "vision.describe_image",
      actorEid: ctx.actorEid,
      deviceEid: ctx.deviceEid,
      command: process.execPath,
      args: ["-e", script],
      cwd: sandboxCwd,
      env,
      timeoutMs: 120_000,
      maxBufferBytes: 2 * 1024 * 1024,
      dedupKey: `vision.describe_image|${ctx.actorEid}|${ctx.deviceEid}|${model}|${rel}|${String(prompt).slice(0, 200)}`,
      postProcess: (raw) => {
        const stdout = String(raw.stdout || "").trim();
        return {
          ok: raw.exitCode === 0 && !raw.timedOut,
          summary: `vision.describe_image (${raw.exitCode}) in ${raw.durationMs}ms${raw.timedOut ? " (timeout)" : ""}`,
          stdout,
          stderr: raw.stderr,
          exitCode: raw.exitCode,
          artifacts: [{ kind: "image", uri: `workspace://${rel}` }],
        } satisfies OfficeToolResult;
      },
    });

    return { ok: true, pending: true, jobId, summary: `vision.describe_image queued (${jobId})` };
  });
registerOfficeTool("workspace.git_apply", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const patchText =
      typeof params?.patch === "string"
        ? params.patch
        : typeof params?.input === "string"
          ? params.input
          : typeof params?.command === "string"
            ? params.command
            : "";
    if (!patchText.trim()) return { ok: false, summary: "Missing patch", stderr: "workspace.git_apply requires {patch} or {input}" };

    const toolMode = getOfficeToolMode();
    if (toolMode !== "shell") {
      return {
        ok: false,
        summary: "git apply disabled (scripted mode)",
        stderr: "Set office tool mode to 'shell' to run workspace.git_apply",
      };
    }

    if (process.env.OFFICE_TOOLS_ALLOW_GIT_APPLY !== "1") {
      return {
        ok: false,
        summary: "git apply blocked by policy",
        stderr: "Set OFFICE_TOOLS_ALLOW_GIT_APPLY=1 to enable workspace.git_apply",
      };
    }

	    const sandboxCwd = ensureOfficeDeviceSandboxDir(ctx.world, ctx.deviceEid);
	    const started = Date.now();

	    // Ensure git doesn't "discover" the parent repo and treat this as a subdirectory.
	    // A local repo in the sandbox keeps `git apply` scoped to this workspace.
	    try {
	      fs.statSync(path.join(sandboxCwd, ".git"));
	    } catch {
	      try {
	        spawnSync("git", ["init"], {
	          shell: false,
	          cwd: sandboxCwd,
	          env: {
	            ...process.env,
	            HOME: sandboxCwd,
	            TMPDIR: path.join(sandboxCwd, "tmp"),
	            ARGOS_OFFICE_SANDBOX_DIR: sandboxCwd,
	          },
	          encoding: "utf8",
	          timeout: 30_000,
	          maxBuffer: 1 * 1024 * 1024,
	        });
	      } catch {
	        // ignore; git apply may still succeed without a repo depending on the environment
	      }
	    }

	    // In the sandbox, treat it as the repo root. (No prefix rewriting.)
	    const directoryArg: string[] = [];

	    const check = spawnSync("git", ["apply", "--check", "--verbose", "--whitespace=nowarn", ...directoryArg, "-"], {
	      shell: false,
	      cwd: sandboxCwd,
	      env: {
	        ...process.env,
	        HOME: sandboxCwd,
	        TMPDIR: path.join(sandboxCwd, "tmp"),
	        ARGOS_OFFICE_SANDBOX_DIR: sandboxCwd,
	        GIT_CEILING_DIRECTORIES: sandboxCwd,
	        GIT_DISCOVERY_ACROSS_FILESYSTEM: "0",
	      },
	      encoding: "utf8",
	      input: patchText,
	      timeout: 60_000,
	      maxBuffer: 4 * 1024 * 1024,
	    });
    const checkStderr = check.stderr ? String(check.stderr) : "";
    const checkExit = typeof check.status === "number" ? check.status : (check.error ? 1 : 0);
    if (checkExit !== 0 || /Skipped patch/i.test(checkStderr)) {
      return {
        ok: false,
        summary: `workspace.git_apply check failed (${checkExit})`,
        stdout: check.stdout ? String(check.stdout) : "",
        stderr: (check.error ? `${checkStderr}\n${check.error.message}` : checkStderr).trim(),
        exitCode: checkExit || 1,
      };
    }

	    const res = spawnSync("git", ["apply", "--verbose", "--whitespace=nowarn", ...directoryArg, "-"], {
	      shell: false,
	      cwd: sandboxCwd,
	      env: {
	        ...process.env,
	        HOME: sandboxCwd,
	        TMPDIR: path.join(sandboxCwd, "tmp"),
	        ARGOS_OFFICE_SANDBOX_DIR: sandboxCwd,
	        GIT_CEILING_DIRECTORIES: sandboxCwd,
	        GIT_DISCOVERY_ACROSS_FILESYSTEM: "0",
	      },
	      encoding: "utf8",
	      input: patchText,
	      timeout: 60_000,
	      maxBuffer: 4 * 1024 * 1024,
	    });
    const duration = Date.now() - started;

    const stdout = res.stdout ? String(res.stdout) : "";
    const stderr = res.stderr ? String(res.stderr) : "";
    const exitCode = typeof res.status === "number" ? res.status : (res.error ? 1 : 0);
    const skipped = /Skipped patch/i.test(stderr);

    return {
      ok: exitCode === 0 && !skipped,
      summary: `workspace.git_apply (${skipped ? 1 : exitCode}) in ${duration}ms`,
      stdout,
      stderr: res.error ? `${stderr}\n${res.error.message}`.trim() : stderr,
      exitCode: exitCode === 0 && skipped ? 1 : exitCode,
      artifacts: [{ kind: "git_patch", uri: "inline://git.patch" }],
    };
  });

	  registerOfficeTool("workspace.git_apply_from_last_gemini", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
	    const actorEid = ctx.actorEid;
	    if (actorEid === undefined) return { ok: false, summary: "No actor", stderr: "workspace.git_apply_from_last_gemini requires an actorEid" };

    if (process.env.OFFICE_TOOLS_ALLOW_GIT_APPLY !== "1") {
      return {
        ok: false,
        summary: "git apply blocked by policy",
        stderr: "Set OFFICE_TOOLS_ALLOW_GIT_APPLY=1 to enable workspace.git_apply_from_last_gemini",
      };
    }

    // Optional allowlist: specify expected paths to constrain the patch surface.
    const raw = typeof params?.input === "string" ? params.input.trim() : (typeof params?.command === "string" ? params.command.trim() : "");
    const allowPaths = raw ? raw.split(/\s+/).map((s: string) => s.trim()).filter(Boolean) : [];

	    // Use append-only ToolResult evidence (not LastToolResult) so other tools can run in-between
    // without breaking patch application.
    const toolEids = getRelationTargets(ctx.world as any, actorEid, HasToolResult as any) as number[];

    const looksLikeDiff = (s: string): boolean => {
      const t = String(s || "");
      if (t.includes("diff --git ")) return true;
      if (/^\s*---\s+(?:a\/|\/dev\/null)/m.test(t)) return true;
      if (/^\s*---\s+\/dev\/null/m.test(t)) return true;
      if (t.includes("\\ndiff --git ") || t.includes("\\n--- a/") || t.includes("\\n--- /dev/null")) return true;
      return false;
    };

    const unescapeOnceIfNeeded = (s: string): string => {
      const t = String(s || "");
      if ((t.includes("\\ndiff --git ") || t.includes("\\n--- a/") || t.includes("\\n--- /dev/null")) && !t.includes("\ndiff --git ") && !/^\s*---\s+(?:a\/|\/dev\/null)/m.test(t)) {
        return t.replace(/(?<!\\)\\n/g, "\n").replace(/(?<!\\)\\r/g, "\r").replace(/(?<!\\)\\t/g, "\t");
      }
      return t;
    };

    const tryLoadGeminiOutputText = (stdoutRaw: string, stderrRaw: string): { text: string; stderrText: string } => {
      let t = String(stdoutRaw || "");
      const err = String(stderrRaw || "");

      const readRel = (rel: string): string | undefined => {
        if (!rel) return undefined;
        const abs = path.resolve(process.cwd(), rel);
        if (!fs.existsSync(abs)) return undefined;
        try {
          return fs.readFileSync(abs, "utf8");
        } catch {
          return undefined;
        }
      };

      const tryResolveSessionResponseFile = (sessionId: string): string | undefined => {
        const base = String(sessionId || "").replace(/[^a-zA-Z0-9._-]/g, "_");
        if (!base) return undefined;
        const candidate = path.join(process.cwd(), "stress-test-output", "tool-artifacts", "gemini-cli", `${base}.response.txt`);
        return fs.existsSync(candidate) ? candidate : undefined;
      };

      if (t.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(t);
          const responseFile = typeof parsed?.responseFile === "string" ? parsed.responseFile : "";
          const rawFile = typeof parsed?.rawFile === "string" ? parsed.rawFile : "";
          const response = typeof parsed?.response === "string" ? parsed.response : "";
          const sessionId = typeof parsed?.session_id === "string" ? parsed.session_id : (typeof parsed?.sessionId === "string" ? parsed.sessionId : "");

          const fromFile = readRel(responseFile) ?? readRel(rawFile);
          if (fromFile) t = fromFile;
          else if (response) t = response;
          else {
            const abs = sessionId ? tryResolveSessionResponseFile(sessionId) : undefined;
            if (abs) t = fs.readFileSync(abs, "utf8");
          }
        } catch {
          // fall back to raw
        }
      }

      return { text: t, stderrText: err };
    };

    const candidates = toolEids
      .filter((eid) => hasComponent(ctx.world as any, eid, ToolResult as any))
      .filter((eid) => String(ToolResult.toolId[eid] || "") === "gemini.cli")
      .map((eid) => ({
        eid,
        ts: Number(ToolResult.timestamp[eid] || 0),
        ok: !!ToolResult.ok[eid],
        exitCode: Number(ToolResult.exitCode[eid] ?? 0),
        summary: String(ToolResult.summary[eid] || ""),
        stdout: String(ToolResult.stdout[eid] || ""),
        stderr: String(ToolResult.stderr[eid] || ""),
      }))
      .sort((a, b) => b.ts - a.ts);

    let text = "";
    let stderrText = "";
    for (const c of candidates) {
      if (!c.ok || c.exitCode !== 0) continue;
      if (c.summary.toLowerCase().includes("queued")) continue;
      const loaded = tryLoadGeminiOutputText(c.stdout, c.stderr);
      const maybe = unescapeOnceIfNeeded(loaded.text);
      if (looksLikeDiff(maybe) || looksLikeDiff(loaded.stderrText)) {
        text = maybe;
        stderrText = loaded.stderrText;
        break;
      }
    }

    if (!text) {
      if (!candidates.length) {
        return { ok: false, summary: "No prior gemini output", stderr: "Run gemini_cli first (gemini.cli tool result required)" };
      }
      return {
        ok: false,
        summary: "No unified diff found",
        stderr: "gemini.cli output must include a unified diff (prefer `diff --git`, but `--- a/...` style is accepted)",
        exitCode: 1,
      };
    }

    // Extract a unified diff from the output.
    // Prefer "diff --git", but allow minimal unified diffs that start with "--- a/<path>".
    let diffIdx = text.indexOf("diff --git ");
    const altIdx = text.search(/^\s*---\s+(?:a\/|\/dev\/null)/m);
    if (diffIdx < 0 && altIdx >= 0) diffIdx = altIdx;
    if (diffIdx < 0 && stderrText) {
      // Some runs emit the model response on stderr alongside startup logs.
      diffIdx = stderrText.indexOf("diff --git ");
      const altIdx2 = stderrText.search(/^\s*---\s+(?:a\/|\/dev\/null)/m);
      if (diffIdx < 0 && altIdx2 >= 0) diffIdx = altIdx2;
      if (diffIdx >= 0) text = stderrText;
    }

    // Do NOT `.trim()` here: unified diffs can legitimately contain whitespace-only lines (e.g. a trailing
    // blank line represented as a single `" "` context line). Trimming can corrupt hunk line counts.
    let patchText = diffIdx >= 0 ? text.slice(diffIdx) : text;

// Strip common markdown fences that break `git apply`, without discarding the patch content.
    patchText = patchText.replace(/^\s*```[a-zA-Z]*\s*\n/, "");
    patchText = patchText.replace(/\n\s*```\s*$/, "");
    patchText = patchText.replace(/^\s*~~~[a-zA-Z]*\s*\n/, "");
    patchText = patchText.replace(/\n\s*~~~\s*$/, "");
    // Remove any remaining fence-only lines.
    patchText = patchText
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !(t === "```" || t.startsWith("```") || t === "~~~" || t.startsWith("~~~"));
      })
      .join("\n")
      // Only remove leading/trailing newlines (not whitespace-only diff lines).
      .replace(/^\n+/, "")
      .replace(/\n+$/, "");

    // Truncate trailing non-diff chatter if the model included commentary after the patch.
    // Keep only lines that match the unified diff grammar once we've started.
    const patchLines = patchText.split("\n");
    const kept: string[] = [];
    let inPatch = false;
    for (const line of patchLines) {
      if (!inPatch) {
        if (line.startsWith("diff --git ") || line.startsWith("--- a/")) inPatch = true;
        else continue;
      }
      const ok =
        line.trim() === "" ||
        line.startsWith("diff --git ") ||
        line.startsWith("index ") ||
        line.startsWith("new file mode ") ||
        line.startsWith("deleted file mode ") ||
        line.startsWith("similarity index ") ||
        line.startsWith("rename from ") ||
        line.startsWith("rename to ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line.startsWith("@@") ||
        line.startsWith("\\ No newline at end of file") ||
        line.startsWith("+") ||
        line.startsWith("-") ||
        line.startsWith(" ");
      if (!ok) break;
      kept.push(line);
    }
    patchText = kept.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");

    if (!patchText.startsWith("diff --git ") && !/^\s*---\s+(?:a\/|\/dev\/null)/m.test(patchText)) {
      return {
        ok: false,
        summary: "No unified diff found",
        stderr: "gemini.cli output must include a unified diff (prefer `diff --git`, but `--- a/...` style is accepted)",
        exitCode: 1,
      };
    }
	    // Normalize line endings and ensure trailing newline so `git apply` doesn't treat the last hunk as truncated.
	    patchText = patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	    if (!patchText.endsWith("\n")) patchText += "\n";

	    // Some LLMs emit unified diffs with incorrect hunk line counts (the `@@ -a,b +c,d @@` header).
	    // `git apply` treats that as a corrupt patch even when the hunk body is otherwise valid.
	    // Repair by recomputing the old/new line counts from the hunk body, preserving start offsets.
	    const fixUnifiedDiffHunkCounts = (input: string): string => {
	      const lines = input.split("\n");
	      const out: string[] = [];
	      const hunkRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
	      let i = 0;
	      while (i < lines.length) {
	        const line = lines[i] ?? "";
	        const m = line.match(hunkRe);
	        if (!m) {
	          out.push(line);
	          i++;
	          continue;
	        }
	        const oldStart = Number(m[1] || 0);
	        const newStart = Number(m[3] || 0);
	        let oldCount = 0;
	        let newCount = 0;
	        const hunkLines: string[] = [];
	        i++; // consume header
	        while (i < lines.length) {
	          const l = lines[i] ?? "";
	          if (hunkRe.test(l) || l.startsWith("diff --git ") || l.startsWith("--- ") || l.startsWith("+++ ")) break;
	          if (l.startsWith("\\ No newline at end of file")) {
	            hunkLines.push(l);
	            i++;
	            continue;
	          }
	          const prefix = l[0] || "";
	          if (prefix === "+") newCount++;
	          else if (prefix === "-") oldCount++;
	          else if (prefix === " ") {
	            oldCount++;
	            newCount++;
	          } else if (l === "") {
	            // Empty string here means we hit the trailing split separator; don't count.
	          } else {
	            // Non-standard line inside a hunk; keep it, but don't count it to avoid making headers worse.
	          }
	          hunkLines.push(l);
	          i++;
	        }
	        out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
	        out.push(...hunkLines);
	      }
	      return out.join("\n");
	    };
	    patchText = fixUnifiedDiffHunkCounts(patchText);

	    const splitFileSections = (input: string): Array<{ filePath: string; lines: string[] }> => {
	      const lines = input.split("\n");
	      const starts: Array<{ idx: number; path: string }> = [];
	      for (let i = 0; i < lines.length; i++) {
	        const line = lines[i] || "";
	        if (line.startsWith("diff --git ")) {
	          const m = line.match(/^diff --git a\/(\S+)\s+b\/(\S+)/);
	          const p = m?.[2] || m?.[1] || "";
	          if (p) starts.push({ idx: i, path: p });
	        } else if (line.startsWith("--- a/")) {
	          const m = line.match(/^--- a\/(\S+)/);
	          const p = m?.[1] || "";
	          if (p) starts.push({ idx: i, path: p });
	        }
	      }
	      if (!starts.length) return [];
	      const out: Array<{ filePath: string; lines: string[] }> = [];
	      for (let j = 0; j < starts.length; j++) {
	        const start = starts[j]!;
	        const end = j + 1 < starts.length ? starts[j + 1]!.idx : lines.length;
	        out.push({ filePath: start.path, lines: lines.slice(start.idx, end) });
	      }
	      return out;
	    };

	    // If allowPaths provided, keep only the allowed sections.
	    if (allowPaths.length) {
	      const sections = splitFileSections(patchText);
	      if (sections.length) {
	        const kept = sections.filter((s) => allowPaths.includes(s.filePath));
	        const removed = sections.filter((s) => !allowPaths.includes(s.filePath)).map((s) => s.filePath);
	        if (!kept.length) {
	          return {
	            ok: false,
	            summary: "Patch touches disallowed files",
	            stderr: `Disallowed paths in patch: ${removed.join(", ")} (allowed: ${allowPaths.join(", ")})`,
	            exitCode: 1,
	          };
	        }
	        if (removed.length) {
	          patchText = kept.map((s) => s.lines.join("\n")).join("\n").replace(/\n+$/, "") + "\n";
	        }
	      }
	    }

    const toolMode = getOfficeToolMode();
    if (toolMode !== "shell") {
      return {
        ok: false,
        summary: "git apply disabled (scripted mode)",
        stderr: "Set office tool mode to 'shell' to run workspace.git_apply_from_last_gemini",
      };
    }

	    const sandboxCwd = ensureOfficeDeviceSandboxDir(ctx.world, ctx.deviceEid);
	    const started = Date.now();

	    // Ensure git doesn't "discover" the parent repo and treat this as a subdirectory.
	    try {
	      fs.statSync(path.join(sandboxCwd, ".git"));
	    } catch {
	      try {
	        spawnSync("git", ["init"], {
	          shell: false,
	          cwd: sandboxCwd,
	          env: {
	            ...process.env,
	            HOME: sandboxCwd,
	            TMPDIR: path.join(sandboxCwd, "tmp"),
	            ARGOS_OFFICE_SANDBOX_DIR: sandboxCwd,
	          },
	          encoding: "utf8",
	          timeout: 30_000,
	          maxBuffer: 1 * 1024 * 1024,
	        });
	      } catch {
	        // ignore
	      }
	    }

	    const runGitCheck = (input: string) =>
	      spawnSync("git", ["apply", "--no-index", "--check", "--verbose", "--whitespace=nowarn", "-"], {
	        shell: false,
	        cwd: sandboxCwd,
	        env: {
	          ...process.env,
	          HOME: sandboxCwd,
	          TMPDIR: path.join(sandboxCwd, "tmp"),
	          ARGOS_OFFICE_SANDBOX_DIR: sandboxCwd,
	          GIT_CEILING_DIRECTORIES: sandboxCwd,
	          GIT_DISCOVERY_ACROSS_FILESYSTEM: "0",
	        },
	        encoding: "utf8",
	        input,
	        timeout: 60_000,
	        maxBuffer: 4 * 1024 * 1024,
	      });

	    const parseFailedFiles = (errText: string): string[] => {
	      const out = new Set<string>();
	      for (const m of errText.matchAll(/patch failed:\s+([^\s:]+):\d+/g)) {
	        const p = String(m[1] || "").trim();
	        if (p) out.add(p);
	      }
	      for (const m of errText.matchAll(/error:\s+([^\s:]+):\s+patch does not apply/g)) {
	        const p = String(m[1] || "").trim();
	        if (p) out.add(p);
	      }
	      return Array.from(out);
	    };

	    const stripAlreadyAppliedNewFileSections = (input: string, failedFiles: string[]): { next?: string; removed: string[] } => {
	      if (!failedFiles.length) return { removed: [] };
	      const sections = splitFileSections(input);
	      if (!sections.length) return { removed: [] };
	      const keep: string[] = [];
	      const removed: string[] = [];

	      for (const section of sections) {
	        if (!failedFiles.includes(section.filePath)) {
	          keep.push(...section.lines);
	          continue;
	        }
	        const hunkHeaderIdx = section.lines.findIndex((l) => l.startsWith("@@"));
	        const hunkHeader = hunkHeaderIdx >= 0 ? section.lines[hunkHeaderIdx] : "";
	        const newFileHunk = /^@@ -0,0 \+\d+(?:,\d+)? @@/.test(hunkHeader);
	        const hasDeletions = section.lines.some((l) => l.startsWith("-") && !l.startsWith("--- "));
	        if (!newFileHunk || hasDeletions) {
	          keep.push(...section.lines);
	          continue;
	        }

	        const abs = path.resolve(sandboxCwd, section.filePath);
	        if (!abs.startsWith(sandboxCwd + path.sep) && abs !== sandboxCwd) {
	          keep.push(...section.lines);
	          continue;
	        }
	        if (!fs.existsSync(abs)) {
	          keep.push(...section.lines);
	          continue;
	        }

	        const bodyLines: string[] = [];
	        let inHunk = false;
	        for (const l of section.lines) {
	          if (l.startsWith("@@")) {
	            inHunk = true;
	            continue;
	          }
	          if (!inHunk) continue;
	          if (l.startsWith("+") && !l.startsWith("+++ ")) bodyLines.push(l.slice(1));
	        }
	        const expected = bodyLines.join("\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	        const actual = fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	        if (actual.trimEnd() === expected.trimEnd()) {
	          removed.push(section.filePath);
	          continue;
	        }
	        keep.push(...section.lines);
	      }
	      if (!removed.length) return { removed: [] };
	      return { next: keep.join("\n").replace(/\n+$/, "") + "\n", removed };
	    };

	    const stripBlankContextLinesInFailedFiles = (input: string, failedFiles: string[]): string | undefined => {
	      if (!failedFiles.length) return undefined;
	      const sections = splitFileSections(input);
	      if (!sections.length) return undefined;
	      const out: string[] = [];
	      let changed = false;
	      for (const section of sections) {
	        if (!failedFiles.includes(section.filePath)) {
	          out.push(...section.lines);
	          continue;
	        }
	        let inHunk = false;
	        for (const l of section.lines) {
	          if (l.startsWith("@@")) inHunk = true;
	          // Remove whitespace-only *context* lines (exactly `" "`) inside hunks; LLMs sometimes hallucinate
	          // them, making hunks fail to match files that don't actually have a blank line there.
	          if (inHunk && l === " ") {
	            changed = true;
	            continue;
	          }
	          out.push(l);
	        }
	      }
	      if (!changed) return undefined;
	      const next = out.join("\n").replace(/\n+$/, "") + "\n";
	      return fixUnifiedDiffHunkCounts(next);
	    };
	    	    const stripBlankDeletionLinesInFailedFiles = (input: string, failedFiles: string[]): string | undefined => {
	      if (!failedFiles.length) return undefined;
	      const sections = splitFileSections(input);
	      if (!sections.length) return undefined;
	      const out: string[] = [];
	      let changed = false;

	      for (const section of sections) {
	        if (!failedFiles.includes(section.filePath)) {
	          out.push(...section.lines);
	          continue;
	        }

	        let inHunk = false;
	        let sawContext = false;
	        let sawAddition = false;

	        for (let i = 0; i < section.lines.length; i++) {
	          const l = section.lines[i] ?? "";

	          if (l.startsWith("@@")) {
	            inHunk = true;
	            sawContext = false;
	            sawAddition = false;
	            out.push(l);
	            continue;
	          }

	          if (!inHunk) {
	            out.push(l);
	            continue;
	          }

	          if (l.startsWith(" ")) sawContext = true;
	          if (l.startsWith("+") && !l.startsWith("+++ ")) sawAddition = true;

	          // LLMs sometimes hallucinate a deletion of a blank line (`-` on its own) when replacing a file,
	          // especially due to treating the trailing newline as an extra empty line.
	          // If we haven't seen any context or additions yet, and the next line begins the additions,
	          // drop that blank deletion to make the patch apply across both file variants.
	          if (l === "-" && !sawContext && !sawAddition) {
	            const next = section.lines[i + 1] ?? "";
	            if (next.startsWith("+") && !next.startsWith("+++ ")) {
	              changed = true;
	              continue;
	            }
	          }

	          out.push(l);
	        }
	      }

	      if (!changed) return undefined;
	      const next = out.join("\n").replace(/\n+$/, "") + "\n";
	      return fixUnifiedDiffHunkCounts(next);
	    };

// Repair common LLM errors in hunk headers before running git checks.
	    patchText = fixUnifiedDiffHunkCounts(patchText);


	    const check1 = runGitCheck(patchText);
	    const check1Exit = typeof check1.status === "number" ? check1.status : (check1.error ? 1 : 0);
	    if (check1Exit !== 0) {
	      const stderr1 = String(check1.stderr || "");
	      const failed = parseFailedFiles(stderr1);

	      const strippedNew = stripAlreadyAppliedNewFileSections(patchText, failed);
	      if (strippedNew.next) patchText = strippedNew.next;

	      const check2 = runGitCheck(patchText);
	      const check2Exit = typeof check2.status === "number" ? check2.status : (check2.error ? 1 : 0);
	      if (check2Exit !== 0) {
	        const stderr2 = String(check2.stderr || "");
	        const failed2 = parseFailedFiles(stderr2);
	        const loosened = stripBlankContextLinesInFailedFiles(patchText, failed2);
	        if (loosened) patchText = loosened;
	        const loosenedDel = stripBlankDeletionLinesInFailedFiles(patchText, failed2);
	        if (loosenedDel) patchText = loosenedDel;
	      }

	      const check3 = runGitCheck(patchText);
	      const check3Exit = typeof check3.status === "number" ? check3.status : (check3.error ? 1 : 0);
	      if (check3Exit !== 0) {
	        const stderr = String(check3.stderr || "");
	        const head = patchText.split("\n").slice(0, 40).join("\n");
	        return {
	          ok: false,
	          summary: `workspace.git_apply_from_last_gemini check failed (${check3Exit})`,
	          stdout: check3.stdout ? String(check3.stdout) : "",
	          stderr: `${(check3.error ? `${stderr}\n${check3.error.message}` : stderr).trim()}\n\n--- PATCH HEAD ---\n${head}\n--- END PATCH HEAD ---`.trim(),
	          exitCode: check3Exit || 1,
	        };
	      }
	    }

	    const res = spawnSync("git", ["apply", "--no-index", "--verbose", "--whitespace=nowarn", "-"], {
	      shell: false,
	      cwd: sandboxCwd,
	      env: {
	        ...process.env,
	        HOME: sandboxCwd,
	        TMPDIR: path.join(sandboxCwd, "tmp"),
	        ARGOS_OFFICE_SANDBOX_DIR: sandboxCwd,
	        GIT_CEILING_DIRECTORIES: sandboxCwd,
	        GIT_DISCOVERY_ACROSS_FILESYSTEM: "0",
	      },
	      encoding: "utf8",
	      input: patchText,
	      timeout: 60_000,
	      maxBuffer: 4 * 1024 * 1024,
	    });
    const duration = Date.now() - started;

    const stdout = res.stdout ? String(res.stdout) : "";
    const stderr = res.stderr ? String(res.stderr) : "";
    const exitCode = typeof res.status === "number" ? res.status : (res.error ? 1 : 0);

    return {
      ok: exitCode === 0,
      summary: `workspace.git_apply_from_last_gemini (${exitCode}) in ${duration}ms`,
      stdout,
      stderr: res.error ? `${stderr}\n${res.error.message}`.trim() : stderr,
      exitCode,
      artifacts: [{ kind: "git_patch", uri: "inline://git.patch" }],
    };
  });

  registerOfficeTool("workspace.read_file", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const parsePath = (): string => {
      if (typeof params?.path === "string" && params.path.trim()) return params.path.trim();
      const raw = typeof params?.input === "string" ? params.input.trim() : (typeof params?.command === "string" ? params.command.trim() : "");
      if (!raw) return "";
      if (raw.startsWith("{")) {
        try {
          const obj = JSON.parse(raw);
          if (obj && typeof obj.path === "string") return String(obj.path).trim();
        } catch {
          // fall through to raw parsing
        }
      }
      // Simple format: "path/to/file"
      return raw.split(/\s+/)[0]?.trim() || "";
    };

    const filePath = parsePath();
    if (!filePath) return { ok: false, summary: "Missing path", stderr: "workspace.read_file requires a path (JSON or plain string)" };

    const absRoot = ensureOfficeDeviceSandboxDir(ctx.world, ctx.deviceEid);
    const abs = path.resolve(absRoot, filePath);
    if (!abs.startsWith(absRoot + path.sep) && abs !== absRoot) {
      return { ok: false, summary: "Path blocked", stderr: "Path must be within the workspace" };
    }

    try {
      const content = fs.readFileSync(abs, "utf8");
      return { ok: true, summary: `Read ${filePath}`, stdout: content };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, summary: `Read failed: ${filePath}`, stderr: msg };
    }
  });

  registerOfficeTool("workspace.list_dir", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const parsePath = (): string => {
      if (typeof params?.path === "string" && params.path.trim()) return params.path.trim();
      const raw = typeof params?.input === "string" ? params.input.trim() : (typeof params?.command === "string" ? params.command.trim() : "");
      if (!raw) return ".";
      if (raw.startsWith("{")) {
        try {
          const obj = JSON.parse(raw);
          if (obj && typeof obj.path === "string") return String(obj.path).trim() || ".";
        } catch {
          // fall through
        }
      }
      return raw.split(/\s+/)[0]?.trim() || ".";
    };

    const rel = parsePath();
    const absRoot = ensureOfficeDeviceSandboxDir(ctx.world, ctx.deviceEid);
    const abs = path.resolve(absRoot, rel);
    if (!abs.startsWith(absRoot + path.sep) && abs !== absRoot) {
      return { ok: false, summary: "Path blocked", stderr: "Path must be within the workspace" };
    }

    try {
      const maxEntries = Number.isFinite(Number(params?.maxEntries))
        ? Math.max(1, Math.min(500, Number(params.maxEntries)))
        : 200;
      const recursive = params?.recursive === true;
      const out: string[] = [];

      const walk = (dir: string, prefix: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const ent of entries) {
          if (out.length >= maxEntries) return;
          const name = ent.name;
          const relPath = prefix ? path.posix.join(prefix, name) : name;
          out.push(ent.isDirectory() ? `${relPath}/` : relPath);
          if (recursive && ent.isDirectory()) {
            walk(path.join(dir, name), relPath);
          }
        }
      };

      walk(abs, path.relative(absRoot, abs).replace(/\\/g, "/"));
      const normalized = out
        .map((p) => p.replace(/^\.\//, "").replace(/^workspace\//, ""))
        .filter((p) => p !== "");

      return {
        ok: true,
        summary: `Listed ${normalized.length} entries`,
        stdout: normalized.length ? normalized.join("\n") : "(empty)",
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, summary: `List failed: ${rel}`, stderr: msg };
    }
  });

  registerOfficeTool("workspace.write_file", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const parseArgs = (): { filePath: string; content: string; append: boolean } => {
      const append = params?.append === true;
      if (typeof params?.path === "string" && params.path.trim()) {
        return { filePath: params.path.trim(), content: typeof params?.content === "string" ? params.content : "", append };
      }

      const raw = typeof params?.input === "string" ? String(params.input) : (typeof params?.command === "string" ? String(params.command) : "");
      const trimmed = raw.trim();
      if (!trimmed) return { filePath: "", content: "", append };

      // JSON form: {"path":"...","content":"..."}
      if (trimmed.startsWith("{")) {
        try {
          const obj = JSON.parse(trimmed);
          if (obj && typeof obj.path === "string") {
            return { filePath: String(obj.path).trim(), content: typeof obj.content === "string" ? String(obj.content) : "", append: obj.append === true };
          }
        } catch {
          // fall through to plain form
        }
      }

      // Plain form:
      // - Preferred: "<path>\n<content...>"
      // - Fallback: "<path> <content...>"
      const nlIdx = raw.indexOf("\n");
      if (nlIdx >= 0) {
        const p = raw.slice(0, nlIdx).trim();
        const c = raw.slice(nlIdx + 1);
        return { filePath: p, content: c, append };
      }
      const firstSpace = raw.search(/\s/);
      if (firstSpace < 0) return { filePath: raw.trim(), content: "", append };
      const p = raw.slice(0, firstSpace).trim();
      const c = raw.slice(firstSpace).replace(/^\s+/, "");
      return { filePath: p, content: c, append };
    };

    const { filePath, content, append } = parseArgs();
    if (!filePath) return { ok: false, summary: "Missing path", stderr: "workspace.write_file requires a path (JSON or plain '<path>\\n<content>')" };

    const absRoot = ensureOfficeDeviceSandboxDir(ctx.world, ctx.deviceEid);
    const abs = path.resolve(absRoot, filePath);
    if (!abs.startsWith(absRoot + path.sep) && abs !== absRoot) {
      return { ok: false, summary: "Path blocked", stderr: "Path must be within the workspace" };
    }

    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, { encoding: "utf8", flag: append ? "a" : "w" });
      return { ok: true, summary: `${append ? "Appended" : "Wrote"} ${filePath}` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, summary: `Write failed: ${filePath}`, stderr: msg };
    }
  });

  registerOfficeTool("workspace.replace_in_file", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const parse = (): { path: string; find: string; replace: string; all: boolean } | null => {
      if (typeof params?.path === "string" && typeof params?.find === "string" && typeof params?.replace === "string") {
        return {
          path: params.path.trim(),
          find: String(params.find),
          replace: String(params.replace),
          all: params?.all === true,
        };
      }
      const raw = typeof params?.input === "string" ? params.input.trim() : (typeof params?.command === "string" ? params.command.trim() : "");
      if (!raw.startsWith("{")) return null;
      try {
        const obj = JSON.parse(raw);
        if (!obj || typeof obj.path !== "string" || typeof obj.find !== "string" || typeof obj.replace !== "string") return null;
        return { path: String(obj.path).trim(), find: String(obj.find), replace: String(obj.replace), all: obj.all === true };
      } catch {
        return null;
      }
    };

    const parsed = parse();
    if (!parsed || !parsed.path) {
      return { ok: false, summary: "Missing params", stderr: 'workspace.replace_in_file requires {"path","find","replace"}' };
    }

    const absRoot = ensureOfficeDeviceSandboxDir(ctx.world, ctx.deviceEid);
    const abs = path.resolve(absRoot, parsed.path);
    if (!abs.startsWith(absRoot + path.sep) && abs !== absRoot) {
      return { ok: false, summary: "Path blocked", stderr: "Path must be within the workspace" };
    }

    try {
      const original = fs.readFileSync(abs, "utf8");
      if (!original.includes(parsed.find)) {
        return { ok: false, summary: `No match in ${parsed.path}`, stderr: "find string not present", exitCode: 1 };
      }
      const updated = parsed.all ? original.split(parsed.find).join(parsed.replace) : original.replace(parsed.find, parsed.replace);
      fs.writeFileSync(abs, updated, { encoding: "utf8", flag: "w" });
      return { ok: true, summary: `Replaced text in ${parsed.path}` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, summary: `Replace failed: ${parsed.path}`, stderr: msg };
    }
  });

	  registerOfficeTool("workspace.init_fixture", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
	    const fixtureId = typeof params?.fixtureId === "string" ? params.fixtureId : "";
	    if (!fixtureId.trim()) return { ok: false, summary: "Missing fixtureId", stderr: "workspace.init_fixture requires {fixtureId}" };

	    const absRoot = ensureOfficeDeviceSandboxDir(ctx.world, ctx.deviceEid);
	    const files = getBuiltinWorkspaceFixtures()[fixtureId.trim()];
	    if (!files) {
	      return { ok: false, summary: "Unknown fixture", stderr: `Unknown fixtureId: ${fixtureId}` };
	    }

    try {
      for (const [rel, content] of Object.entries(files)) {
        const abs = path.resolve(absRoot, rel);
        if (!abs.startsWith(absRoot + path.sep) && abs !== absRoot) continue;
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, { encoding: "utf8", flag: "w" });
      }

      // Initialize a git repo so downstream CLI coding agents can apply unified diffs with `git apply`.
      // (Without a repo, many git versions will silently "skip" patches.)
      const init = spawnSync("git", ["init"], {
        shell: false,
        cwd: absRoot,
        env: {
          ...process.env,
          HOME: absRoot,
          TMPDIR: path.join(absRoot, "tmp"),
          ARGOS_OFFICE_SANDBOX_DIR: absRoot,
        },
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      });
      const initExit = typeof init.status === "number" ? init.status : (init.error ? 1 : 0);
      if (initExit !== 0) {
        const stderr = init.stderr ? String(init.stderr) : "";
        return {
          ok: false,
          summary: `Init fixture failed: ${fixtureId}`,
          stderr: `git init failed (${initExit}): ${(init.error ? `${stderr}\n${init.error.message}` : stderr).trim()}`,
        };
      }
      return { ok: true, summary: `Initialized fixture ${fixtureId}` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, summary: `Init fixture failed: ${fixtureId}`, stderr: msg };
    }
	  });

  registerOfficeTool("repo.init", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const repoId = typeof params?.repoId === "string" ? params.repoId.trim() : "";
    const fixtureId = typeof params?.fixtureId === "string" ? params.fixtureId.trim() : "";
    const ciCommand = typeof params?.ciCommand === "string" ? params.ciCommand.trim() : "node ci.cjs";
    const force = params?.force === true;
    if (!repoId) return { ok: false, summary: "Missing repoId", stderr: "repo.init requires {repoId, fixtureId}" };
    if (!fixtureId) return { ok: false, summary: "Missing fixtureId", stderr: "repo.init requires {repoId, fixtureId}" };
    if (ctx.deviceEid === undefined) return { ok: false, summary: "No device", stderr: "repo.init requires a device context" };

    const fixtures = getBuiltinWorkspaceFixtures();
    const files = fixtures[fixtureId];
    if (!files) return { ok: false, summary: "Unknown fixture", stderr: `Unknown fixtureId: ${fixtureId}` };

    const existing = findRepoById(ctx.world, repoId);
    const repoEid = existing ?? addEntity(ctx.world as any);
    if (!existing) addComponent(ctx.world as any, repoEid, Repo as any);

    Repo.repoId[repoEid] = repoId;
    Repo.baseDeviceEid[repoEid] = ctx.deviceEid;
    Repo.fixtureId[repoEid] = fixtureId;
    Repo.ciCommand[repoEid] = ciCommand;
    Repo.createdAt[repoEid] = Repo.createdAt[repoEid] || Date.now();
    Repo.lastUpdatedAt[repoEid] = Date.now();

    if (!hasComponent(ctx.world as any, repoEid, Name as any)) addComponent(ctx.world as any, repoEid, Name as any);
    if (!String(Name.value[repoEid] || "").trim()) Name.value[repoEid] = `Repo:${repoId}`;

    const baseDir = getRepoBaseDir(ctx.world, repoId, ctx.deviceEid);
    try {
      if (force) fs.rmSync(baseDir, { recursive: true, force: true });
      fs.mkdirSync(path.join(baseDir, "tmp"), { recursive: true });
      // Reset base dir contents (except tmp) for a clean fixture seed.
      resetWorkspaceDir(baseDir, new Set(["tmp"]));

      for (const [rel, content] of Object.entries(files)) {
        const abs = path.resolve(baseDir, rel);
        if (!abs.startsWith(baseDir + path.sep) && abs !== baseDir) continue;
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, { encoding: "utf8", flag: "w" });
      }

      // Initialize a git repo so unified diffs can be applied reliably in this workspace.
      const init = spawnSync("git", ["init"], {
        shell: false,
        cwd: baseDir,
        env: {
          ...process.env,
          HOME: baseDir,
          TMPDIR: path.join(baseDir, "tmp"),
          ARGOS_OFFICE_SANDBOX_DIR: baseDir,
          GIT_CEILING_DIRECTORIES: baseDir,
          GIT_DISCOVERY_ACROSS_FILESYSTEM: "0",
        } as Record<string, string>,
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      });
      const initExit = typeof init.status === "number" ? init.status : init.error ? 1 : 0;
      if (initExit !== 0) {
        const stderr = init.stderr ? String(init.stderr) : "";
        return {
          ok: false,
          summary: `repo.init failed: git init (${initExit})`,
          stderr: (init.error ? `${stderr}\n${init.error.message}` : stderr).trim(),
        };
      }

      return { ok: true, summary: `Initialized repo ${repoId} (fixture ${fixtureId})`, stdout: `repoEid=${repoEid}` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, summary: `repo.init failed: ${repoId}`, stderr: msg };
    }
  });

  registerOfficeTool("repo.checkout", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const repoId = typeof params?.repoId === "string" ? params.repoId.trim() : "";
    const clean = params?.clean !== false;
    if (!repoId) return { ok: false, summary: "Missing repoId", stderr: "repo.checkout requires {repoId}" };
    if (ctx.deviceEid === undefined) return { ok: false, summary: "No device", stderr: "repo.checkout requires a device context" };

    const repoEid = findRepoById(ctx.world, repoId);
    if (repoEid === undefined) return { ok: false, summary: "Repo not found", stderr: `Unknown repoId: ${repoId}` };

    const baseDeviceEid = Number(Repo.baseDeviceEid[repoEid] ?? -1);
    if (!Number.isFinite(baseDeviceEid) || baseDeviceEid < 0) {
      return { ok: false, summary: "Repo misconfigured", stderr: `Repo ${repoId} has no baseDeviceEid` };
    }

    const baseDir = getRepoBaseDir(ctx.world, repoId, baseDeviceEid);
    try {
      fs.statSync(baseDir);
    } catch {
      return { ok: false, summary: "Repo missing on disk", stderr: `Repo base dir not found: ${baseDir}` };
    }

    const deviceRoot = ensureOfficeDeviceSandboxDir(ctx.world, ctx.deviceEid);
    try {
      if (clean) resetWorkspaceDir(deviceRoot, new Set([".argos_sandbox", "tmp", "repos"]));
      copyDirContents(baseDir, deviceRoot, new Set([".git", "tmp"]));
      return { ok: true, summary: `Checked out ${repoId} onto device ${ctx.deviceEid}` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, summary: `repo.checkout failed: ${repoId}`, stderr: msg };
    }
  });

  registerOfficeTool("repo.submit_pr", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const repoId = typeof params?.repoId === "string" ? params.repoId.trim() : "";
    const title = typeof params?.title === "string" ? params.title.trim() : "";
    const description = typeof params?.description === "string" ? params.description.trim() : "";
    let patch = typeof params?.patch === "string" ? params.patch : "";
    if (!repoId) return { ok: false, summary: "Missing repoId", stderr: "repo.submit_pr requires {repoId, patch}" };
    if (!patch.trim()) return { ok: false, summary: "Missing patch", stderr: "repo.submit_pr requires {repoId, patch}" };

    const repoEid = findRepoById(ctx.world, repoId);
    if (repoEid === undefined) return { ok: false, summary: "Repo not found", stderr: `Unknown repoId: ${repoId}` };

    if (!/diff --git\s+a\//.test(patch)) {
      return { ok: false, summary: "Invalid patch", stderr: "Patch must be a unified diff (expected lines starting with 'diff --git a/... b/...')" };
    }

    // Normalize patch line endings and ensure trailing newline for `git apply`.
    patch = patch.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!patch.endsWith("\n")) patch += "\n";

    const prId = typeof params?.prId === "string" && params.prId.trim() ? params.prId.trim() : randomUUID();
    const existing = findPullRequestById(ctx.world, repoEid, prId);
    const prEid = existing ?? addEntity(ctx.world as any);
    if (!existing) {
      addComponent(ctx.world as any, prEid, PullRequest as any);
      addComponent(ctx.world as any, prEid, Name as any);
      setLocatedIn(ctx.world, prEid, repoEid);
      PullRequest.createdAt[prEid] = Date.now();
    }

    Name.value[prEid] = title ? `PR:${title}` : `PR:${repoId}`;
    PullRequest.repoEid[prEid] = repoEid;
    PullRequest.prId[prEid] = prId;
    PullRequest.title[prEid] = title || PullRequest.title[prEid] || `PR ${prId.slice(0, 8)}`;
    PullRequest.description[prEid] = description;
    PullRequest.authorEid[prEid] = typeof ctx.actorEid === "number" ? ctx.actorEid : -1;
    PullRequest.patch[prEid] = patch;
    PullRequest.status[prEid] = "open";
    PullRequest.workDir[prEid] = "";
    PullRequest.pendingPhase[prEid] = "";
    PullRequest.pendingToolId[prEid] = "";
    PullRequest.pendingJobId[prEid] = "";
    PullRequest.pendingStartedAt[prEid] = 0;
    PullRequest.lastUpdatedAt[prEid] = Date.now();

    const verb = existing ? "Resubmitted" : "Submitted";
    return { ok: true, summary: `${verb} PR ${prId} to ${repoId}`, stdout: `prEid=${prEid}` };
  });

  registerOfficeTool("repo.apply_patch", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const path = typeof params?.path === "string" ? params.path : "";
    const content = typeof params?.content === "string" ? params.content : "";
    if (!path) return { ok: false, summary: "Missing path", stderr: "repo.apply_patch requires {path, content}" };

    ensureRepoFileComponent();
    const RepoFile = getDynamicComponent("RepoFile")!;
    const eid = findRepoFileByPath(ctx.world, path);
    if (eid === undefined) {
      return { ok: false, summary: "File not found", stderr: `No RepoFile entity for path: ${path}` };
    }
    setDynamicComponentValue("RepoFile", eid, "content", content);
    return { ok: true, summary: `Updated ${path}` };
  });

  registerOfficeTool("repo.read_file", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const path = typeof params?.path === "string" ? params.path : "";
    if (!path) return { ok: false, summary: "Missing path", stderr: "repo.read_file requires {path}" };

    ensureRepoFileComponent();
    const RepoFile = getDynamicComponent("RepoFile")!;
    const eid = findRepoFileByPath(ctx.world, path);
    if (eid === undefined) {
      return { ok: false, summary: "File not found", stderr: `No RepoFile entity for path: ${path}` };
    }
    const content = RepoFile.content?.[eid] ?? "";
    return { ok: true, summary: `Read ${path}`, stdout: String(content) };
  });

  registerOfficeTool("notes.append", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const raw = typeof params?.note === "string" ? params.note : (typeof params?.input === "string" ? params.input : "");
    const note = raw.trim();
    if (!note) return { ok: false, summary: "Missing note", stderr: "notes.append requires {note} or {input}" };

    const memId = addAgentMemory(ctx, {
      type: "semantic",
      content: `[Note] ${note}`,
      importance: 0.7,
      emotionalValence: 0,
    });

    if (memId === undefined) {
      return { ok: false, summary: "No actor for note", stderr: "notes.append requires an actorEid" };
    }

    return { ok: true, summary: "Note saved", stdout: `[memory:${memId}] ${note}` };
  });

  registerOfficeTool("notes.list_recent", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const actorEid = ctx.actorEid;
    if (actorEid === undefined) return { ok: false, summary: "No actor", stderr: "notes.list_recent requires an actorEid" };
    if (!hasComponent(ctx.world as any, actorEid, Agent as any)) {
      return { ok: false, summary: "Actor is not an agent", stderr: "notes.list_recent can only be used by agents" };
    }

    const limit = Number.isFinite(Number(params?.limit)) ? Math.max(1, Math.min(20, Number(params.limit))) : 5;
    const memoryEids = getRelationTargets(ctx.world as any, actorEid, HasMemory as any)
      .filter((eid: number) => hasComponent(ctx.world as any, eid, Memory as any))
      .sort((a: number, b: number) => (Memory.timestamp[b] || 0) - (Memory.timestamp[a] || 0));

    const notes = memoryEids
      .map((eid: number) => String(Memory.content[eid] || ""))
      .filter((c: string) => c.startsWith("[Note] "))
      .slice(0, limit)
      .map((c: string) => `- ${c.slice("[Note] ".length)}`);

    return {
      ok: true,
      summary: `Notes (${notes.length})`,
      stdout: notes.length ? notes.join("\n") : "(no notes)",
    };
  });

  registerOfficeTool("policy.set", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const actorEid = ctx.actorEid;
    if (actorEid === undefined) return { ok: false, summary: "No actor", stderr: "policy.set requires an actorEid" };
    if (!hasComponent(ctx.world as any, actorEid, Agent as any)) {
      return { ok: false, summary: "Actor is not an agent", stderr: "policy.set can only be used by agents" };
    }

    const raw =
      typeof params?.treeJson === "string"
        ? params.treeJson
        : typeof params?.tree === "string"
          ? params.tree
          : typeof params?.input === "string"
            ? params.input
            : "";

    let tree: any;
    try {
      tree = typeof params?.tree === "object" && params.tree ? params.tree : JSON.parse(raw);
    } catch {
      return { ok: false, summary: "Invalid policy JSON", stderr: "policy.set requires JSON (string or {tree})" };
    }

    if (!tree || typeof tree.type !== "string") {
      return { ok: false, summary: "Invalid policy", stderr: "Policy root must have a string 'type' field" };
    }
    const validated = validateBehaviorNode(tree);
    if (!validated.ok) {
      return { ok: false, summary: "Invalid policy", stderr: validated.error };
    }

    addComponent(ctx.world as any, actorEid, BehaviorPolicy as any);
    BehaviorPolicy.enabled[actorEid] = true;
    BehaviorPolicy.treeJson[actorEid] = JSON.stringify(tree);
    BehaviorPolicy.version[actorEid] = (BehaviorPolicy.version[actorEid] || 0) + 1;
    BehaviorPolicy.lastUpdatedAt[actorEid] = Date.now();

    return { ok: true, summary: `Policy set (v${BehaviorPolicy.version[actorEid] || 0})` };
  });

  // ---------------------------------------------------------------------------
  // Kanban + Wiki (optional office-style coordination tools)
  // ---------------------------------------------------------------------------

  registerOfficeTool("kanban.init", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const boardEid = ctx.deviceEid;
    if (boardEid === undefined) return { ok: false, summary: "No board device", stderr: "kanban.init requires a deviceEid" };

    const project = typeof params?.project === "string" ? params.project : "";
    const columns = Array.isArray(params?.columns) ? params.columns.map((c: any) => String(c)).filter(Boolean) : [];
    const colNames = columns.length ? columns : ["Backlog", "In Progress", "Done"];

    ensureKanbanBoard(ctx.world, boardEid, project);

    const existing = new Set(listKanbanColumns(ctx.world, boardEid).map((c) => c.name));
    let created = 0;
    colNames.forEach((name: any, idx: any) => {
      if (existing.has(name)) return;
      const colEid = addEntity(ctx.world as any);
      addComponent(ctx.world as any, colEid, Name as any);
      addComponent(ctx.world as any, colEid, KanbanColumn as any);
      Name.value[colEid] = name;
      KanbanColumn.name[colEid] = name;
      KanbanColumn.position[colEid] = idx;
      KanbanColumn.createdAt[colEid] = Date.now();
      setLocatedIn(ctx.world, colEid, boardEid);
      created++;
    });

    const cols = listKanbanColumns(ctx.world, boardEid);
    return {
      ok: true,
      summary: `Kanban initialized (${cols.length} columns, +${created})`,
      stdout: cols.map((c) => `- ${c.name}`).join("\n"),
      artifacts: [{ kind: "kanban_board", uri: `world://kanban/board/${boardEid}` }],
    };
  });

  registerOfficeTool("kanban.create_card", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const boardEid = ctx.deviceEid;
    if (boardEid === undefined) return { ok: false, summary: "No board device", stderr: "kanban.create_card requires a deviceEid" };

    const title = typeof params?.title === "string" ? params.title.trim() : "";
    if (!title) return { ok: false, summary: "Missing title", stderr: "kanban.create_card requires {title}" };

    const columnName = typeof params?.column === "string" ? params.column : "Backlog";
    let desc = typeof params?.description === "string" ? params.description : "";
    // Optional dependency hint: allow callers to pass {dependsOn:[...]} and embed it into the description
    // so downstream contract parsers can enforce sequencing deterministically.
    const dependsRaw = params?.dependsOn ?? params?.depends_on ?? params?.depends;
    const dependsOnTitles: string[] = [];
    if (Array.isArray(dependsRaw)) {
      for (const t of dependsRaw) {
        const s = String(t || "").trim();
        if (s) dependsOnTitles.push(s);
      }
    } else if (typeof dependsRaw === "string") {
      dependsRaw
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean)
        .forEach((t: string) => dependsOnTitles.push(t));
    }
    if (dependsOnTitles.length && !/(^|\n)\s*DependsOn\s*:/i.test(desc)) {
      const trimmed = desc.trimEnd();
      desc = `${trimmed}${trimmed ? "\n" : ""}DependsOn: ${dependsOnTitles.join(", ")}`;
    }

    ensureKanbanBoard(ctx.world, boardEid);
    const colEid = findNamedChildWithComponent(ctx.world, boardEid, columnName, KanbanColumn as any);
    if (colEid === undefined) {
      return { ok: false, summary: "Column not found", stderr: `No column "${columnName}" on board` };
    }

    const existing = findKanbanCard(ctx.world, boardEid, title);
    if (existing) {
      return { ok: false, summary: "Card exists", stderr: `Card "${title}" already exists` };
    }

    const cardEid = addEntity(ctx.world as any);
    addComponent(ctx.world as any, cardEid, Name as any);
    addComponent(ctx.world as any, cardEid, KanbanCard as any);
    Name.value[cardEid] = title;
    KanbanCard.title[cardEid] = title;
    KanbanCard.description[cardEid] = desc;
    KanbanCard.ownerEid[cardEid] = -1;
    KanbanCard.createdAt[cardEid] = Date.now();
    KanbanCard.updatedAt[cardEid] = Date.now();
    setLocatedIn(ctx.world, cardEid, colEid);

    return {
      ok: true,
      summary: `Card created: ${title} (${columnName})`,
      artifacts: [{ kind: "kanban_card", uri: `world://kanban/card/${cardEid}` }],
    };
  });

  registerOfficeTool("kanban.upsert_card", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const boardEid = ctx.deviceEid;
    if (boardEid === undefined) return { ok: false, summary: "No board device", stderr: "kanban.upsert_card requires a deviceEid" };

    const title = typeof params?.title === "string" ? params.title.trim() : "";
    if (!title) return { ok: false, summary: "Missing title", stderr: "kanban.upsert_card requires {title}" };

    const desc = typeof params?.description === "string" ? params.description : "";

    ensureKanbanBoard(ctx.world, boardEid);
    const existing = findKanbanCard(ctx.world, boardEid, title);
    const columnParam = typeof params?.column === "string" ? params.column.trim() : "";
    const columnName =
      columnParam ||
      (existing && existing.columnEid !== undefined
        ? String(Name.value[existing.columnEid] || KanbanColumn.name[existing.columnEid] || "")
        : "Backlog");

    let colEid = findNamedChildWithComponent(ctx.world, boardEid, columnName, KanbanColumn as any);
    if (colEid === undefined) {
      // Create missing column (keeps tool idempotent and reduces brittleness in tests).
      const existingCols = listKanbanColumns(ctx.world, boardEid);
      colEid = addEntity(ctx.world as any);
      addComponent(ctx.world as any, colEid, Name as any);
      addComponent(ctx.world as any, colEid, KanbanColumn as any);
      Name.value[colEid] = columnName;
      KanbanColumn.name[colEid] = columnName;
      KanbanColumn.position[colEid] = existingCols.length;
      KanbanColumn.createdAt[colEid] = Date.now();
      setLocatedIn(ctx.world, colEid, boardEid);
    }

    if (existing) {
      if (desc.trim()) KanbanCard.description[existing.cardEid] = desc;
      KanbanCard.updatedAt[existing.cardEid] = Date.now();
      // Ensure location matches requested column.
      setLocatedIn(ctx.world, existing.cardEid, colEid);
      return { ok: true, summary: `Card updated: ${title} (${columnName})`, artifacts: [{ kind: "kanban_card", uri: `world://kanban/card/${existing.cardEid}` }] };
    }

    const cardEid = addEntity(ctx.world as any);
    addComponent(ctx.world as any, cardEid, Name as any);
    addComponent(ctx.world as any, cardEid, KanbanCard as any);
    Name.value[cardEid] = title;
    KanbanCard.title[cardEid] = title;
    KanbanCard.description[cardEid] = desc;
    KanbanCard.ownerEid[cardEid] = -1;
    KanbanCard.createdAt[cardEid] = Date.now();
    KanbanCard.updatedAt[cardEid] = Date.now();
    setLocatedIn(ctx.world, cardEid, colEid);

    return { ok: true, summary: `Card created: ${title} (${columnName})`, artifacts: [{ kind: "kanban_card", uri: `world://kanban/card/${cardEid}` }] };
  });

  registerOfficeTool("kanban.move_card", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const boardEid = ctx.deviceEid;
    if (boardEid === undefined) return { ok: false, summary: "No board device", stderr: "kanban.move_card requires a deviceEid" };

    const title = typeof params?.title === "string" ? params.title.trim() : "";
    const toColumn = typeof params?.toColumn === "string" ? params.toColumn : "";
    if (!title || !toColumn) {
      return { ok: false, summary: "Missing params", stderr: "kanban.move_card requires {title, toColumn}" };
    }

    ensureKanbanBoard(ctx.world, boardEid);
    const found = findKanbanCard(ctx.world, boardEid, title);
    if (!found) return { ok: false, summary: "Card not found", stderr: `No card "${title}" on board` };

    const colEid = findNamedChildWithComponent(ctx.world, boardEid, toColumn, KanbanColumn as any);
    if (colEid === undefined) return { ok: false, summary: "Column not found", stderr: `No column "${toColumn}" on board` };

    // Optional governance gates
    const gov = getOrgGovernanceConfig(ctx.world);
    if (gov?.enabled) {
      if (toColumn === "In Progress" || toColumn === "Review") {
        const wipLimit = gov.wipLimit;
        if (wipLimit > 0) {
          const owned =
            countOwnedCardsInColumn(ctx.world, ctx.actorEid, boardEid, "In Progress") +
            countOwnedCardsInColumn(ctx.world, ctx.actorEid, boardEid, "Review");
          const alreadyOwned = Number(KanbanCard.ownerEid[found.cardEid] ?? -1) === Number(ctx.actorEid);
          if (!alreadyOwned && owned >= wipLimit) {
            return {
              ok: false,
              summary: "WIP limit reached",
              stderr: `WIP limit ${wipLimit} reached for In Progress/Review`,
            };
          }
        }
        KanbanCard.ownerEid[found.cardEid] = ctx.actorEid;
      }

      if (toColumn === "Done") {
        if (gov.doneRequiresReview) {
          const currentColEid = getDirectContainer(ctx.world, found.cardEid);
          const currentColName =
            currentColEid !== undefined
              ? String(Name.value[currentColEid] || KanbanColumn.name[currentColEid] || "")
              : "";
          if (currentColName !== gov.reviewColumnName) {
            return {
              ok: false,
              summary: "Review gate blocked",
              stderr: `Card must be in "${gov.reviewColumnName}" before moving to Done`,
            };
          }
        }

        const owner = Number(KanbanCard.ownerEid[found.cardEid] ?? -1);
        // Closing a ticket should always be attributable to an owner (prevents "drive-by" closures).
        if (owner < 0) {
          return { ok: false, summary: "Unowned ticket", stderr: "Ticket must be owned before moving to Done (move to In Progress to claim it)" };
        }
        if (owner !== Number(ctx.actorEid)) {
          return { ok: false, summary: "Not owner", stderr: "Only the ticket owner may move this card to Done" };
        }

        // Optional dependency gate: if the card declares DependsOn, enforce those cards are already Done.
        const desc = String(KanbanCard.description[found.cardEid] || "");
        const deps: string[] = [];
        for (const line of desc.split(/\r?\n/)) {
          const m = line.match(/^\s*DependsOn\s*:\s*(.+)\s*$/i);
          if (!m || !m[1]) continue;
          m[1]
            .split(",")
            .map((s) => s.trim().replace(/^`/, "").replace(/`$/, "").replace(/[.]+$/, ""))
            .filter(Boolean)
            .forEach((t) => deps.push(t));
        }
        for (const title of deps) {
          const d = findKanbanCard(ctx.world, boardEid, title);
          const depColName =
            d && d.columnEid !== undefined
              ? String(Name.value[d.columnEid] || KanbanColumn.name[d.columnEid] || "")
              : "";
          if (!d || depColName !== "Done") {
            return { ok: false, summary: "Blocked by dependencies", stderr: `DependsOn not satisfied: ${title}` };
          }
        }

        const ok = hasRecentPassingToolEvidence(ctx.world, ctx.actorEid, gov.doneRequiresToolId, gov.doneRequiresCommandIncludes);
        if (!ok) {
          return {
            ok: false,
            summary: "DoD gate blocked",
            stderr: `Need recent passing ${gov.doneRequiresToolId} run (command includes "${gov.doneRequiresCommandIncludes}")`,
          };
        }
      }
    }

    setLocatedIn(ctx.world, found.cardEid, colEid);
    KanbanCard.updatedAt[found.cardEid] = Date.now();

    return { ok: true, summary: `Moved card: ${title} -> ${toColumn}` };
  });

  registerOfficeTool("org.set_governance", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const name = typeof params?.name === "string" ? params.name.trim() : "Org Governance";
    const enabled = params?.enabled !== undefined ? Boolean(params.enabled) : true;
    const requireTicketForWork =
      params?.requireTicketForWork !== undefined
        ? Boolean(params.requireTicketForWork)
        : params?.require_ticket_for_work !== undefined
          ? Boolean(params.require_ticket_for_work)
          : true;
    const wipLimitRaw = params?.wipLimit ?? params?.wip_limit ?? params?.wip ?? params?.wipLimit;
    const wipLimit = Number.isFinite(Number(wipLimitRaw)) ? Number(wipLimitRaw) : 0;

	    let doneRequiresToolId =
	      typeof params?.doneRequiresToolId === "string"
	        ? params.doneRequiresToolId
	        : typeof params?.done_requires_tool_id === "string"
	          ? params.done_requires_tool_id
	          : "terminal.run";
	    let doneRequiresCommandIncludes =
	      typeof params?.doneRequiresCommandIncludes === "string"
	        ? params.doneRequiresCommandIncludes
	        : typeof params?.done_requires_command_includes === "string"
	          ? params.done_requires_command_includes
	          : "node ci.cjs";
	    doneRequiresCommandIncludes = doneRequiresCommandIncludes
	      .trim()
	      .replace(/^['"`]+/, "")
	      .replace(/['"`]+$/, "")
	      .trim();

	    // Common compact form: { do_gate: "terminal.run node ci.cjs" }
	    const doGate = typeof params?.do_gate === "string" ? params.do_gate : (typeof params?.dodGate === "string" ? params.dodGate : "");
	    if (doGate.trim()) {
	      const parts = doGate.trim().split(/\s+/);
	      if (parts.length >= 2) {
	        doneRequiresToolId = parts[0];
	        doneRequiresCommandIncludes = doGate.trim().slice(doneRequiresToolId.length).trim();
	      }
	    }
	    // Normalize common mistakes: sometimes agents provide a device name (e.g. "Workstation")
	    // when they really mean "terminal.run" with a command string.
	    const normTool = String(doneRequiresToolId || "").trim();
	    if (/^workstation$/i.test(normTool) || /^run_command$/i.test(normTool) || /^terminal$/i.test(normTool)) {
	      doneRequiresToolId = "terminal.run";
	    }
	    // If the configured tool id doesn't look like a tool id (no namespace), fall back to terminal.run.
	    if (!String(doneRequiresToolId || "").includes(".")) doneRequiresToolId = "terminal.run";
	    doneRequiresCommandIncludes = doneRequiresCommandIncludes
	      .trim()
	      .replace(/^['"`]+/, "")
	      .replace(/['"`]+$/, "")
	      .trim();

    const doneRequiresReview =
      params?.doneRequiresReview !== undefined
        ? Boolean(params.doneRequiresReview)
        : params?.require_review_before_done !== undefined
          ? Boolean(params.require_review_before_done)
          : false;
    const reviewColumnName =
      typeof params?.reviewColumnName === "string"
        ? params.reviewColumnName
        : typeof params?.review_column_name === "string"
          ? params.review_column_name
          : "Review";

    let govEid = findOrgGovernance(ctx.world, name);
    if (govEid === undefined) {
      govEid = addEntity(ctx.world as any);
      addComponent(ctx.world as any, govEid, Name as any);
      addComponent(ctx.world as any, govEid, OrgGovernance as any);
      Name.value[govEid] = name;
    }

    OrgGovernance.enabled[govEid] = enabled;
    OrgGovernance.requireTicketForWork[govEid] = requireTicketForWork;
    OrgGovernance.wipLimit[govEid] = wipLimit;
    OrgGovernance.doneRequiresToolId[govEid] = doneRequiresToolId;
    OrgGovernance.doneRequiresCommandIncludes[govEid] = doneRequiresCommandIncludes;
    OrgGovernance.doneRequiresReview[govEid] = doneRequiresReview;
    OrgGovernance.reviewColumnName[govEid] = reviewColumnName;

    return {
      ok: true,
      summary: `Org governance set: enabled=${enabled} wipLimit=${wipLimit} doneRequires=${doneRequiresToolId}(${doneRequiresCommandIncludes}) reviewGate=${doneRequiresReview}`,
      artifacts: [{ kind: "org_governance", uri: `world://org/governance/${govEid}` }],
    };
  });

  registerOfficeTool("org.upsert_staffing_governor", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const name = typeof params?.name === "string" ? params.name.trim() : "";
    let boardName = typeof params?.boardName === "string" ? params.boardName.trim() : "";
    const spawnRoomName = typeof params?.spawnRoomName === "string" ? params.spawnRoomName.trim() : "";
    const defaultRole = typeof params?.defaultRole === "string" ? params.defaultRole.trim() : (typeof params?.role === "string" ? params.role.trim() : "");
    const claimTitlePrefix =
      typeof params?.claimTitlePrefix === "string"
        ? params.claimTitlePrefix.trim()
        : typeof params?.rolePrefix === "string"
          ? params.rolePrefix.trim()
        : typeof params?.role_prefix === "string"
          ? params.role_prefix.trim()
          : typeof params?.prefix === "string"
            ? params.prefix.trim()
            : "";
    if (!boardName) {
      // Convenience: if there's a canonical board, use it.
      if (findNamedEntity(ctx.world, "Team Board") !== undefined) boardName = "Team Board";
    }
    if (!boardName) return { ok: false, summary: "Missing boardName", stderr: "org.upsert_staffing_governor requires {boardName}" };
    const inferredRole = (() => {
      const p = claimTitlePrefix.toUpperCase();
      if (p.startsWith("[ENG")) return "engineer";
      if (p.startsWith("[QA")) return "qa";
      if (p.startsWith("[PM")) return "pm";
      if (p.startsWith("[DESIGN")) return "designer";
      return "";
    })();
    const roleFinal = defaultRole || inferredRole || "worker";

    const maxAgentsRaw = params?.maxAgents ?? params?.max_agents ?? params?.max;
    const wipPerAgentRaw = params?.wipPerAgent ?? params?.wip_per_agent ?? params?.wip;
    const maxAgents = Number.isFinite(Number(maxAgentsRaw)) ? Math.max(1, Number(maxAgentsRaw)) : 1;
    const wipPerAgent = Number.isFinite(Number(wipPerAgentRaw)) ? Math.max(1, Number(wipPerAgentRaw)) : 1;
    const enabled = params?.enabled !== undefined ? Boolean(params.enabled) : true;

    // If boardName doesn't resolve to a named entity, try to fall back to the single kanban board in the world.
    if (!findNamedEntity(ctx.world, boardName)) {
      const boards = Array.from(query(ctx.world as any, [KanbanBoard] as any))
        .map((eid) => String(Name.value[eid] || "").trim())
        .filter(Boolean);
      if (boards.length === 1) boardName = boards[0];
      else if (findNamedEntity(ctx.world, "Team Board") !== undefined) boardName = "Team Board";
    }

    const inferredName = name || `Staffing ${roleFinal}${claimTitlePrefix ? " " + claimTitlePrefix : ""}`.trim();
    let govEid = findOrgStaffingGovernor(ctx.world, inferredName);
    if (govEid === undefined) {
      govEid = addEntity(ctx.world as any);
      addComponent(ctx.world as any, govEid, Name as any);
      addComponent(ctx.world as any, govEid, OrgStaffingGovernor as any);
      Name.value[govEid] = inferredName;
    }

    OrgStaffingGovernor.enabled[govEid] = enabled;
    OrgStaffingGovernor.boardName[govEid] = boardName;
    OrgStaffingGovernor.spawnRoomName[govEid] = spawnRoomName || "Office";
    OrgStaffingGovernor.defaultRole[govEid] = roleFinal;
    OrgStaffingGovernor.maxAgents[govEid] = maxAgents;
    OrgStaffingGovernor.wipPerAgent[govEid] = wipPerAgent;
    OrgStaffingGovernor.claimTitlePrefix[govEid] = claimTitlePrefix;

    // If spawnRoomName doesn't resolve, fall back to the first Room in the world.
    if (!findNamedEntity(ctx.world, OrgStaffingGovernor.spawnRoomName[govEid] || "")) {
      const firstRoom = findFirstRoomEid(ctx.world);
      if (firstRoom !== undefined) OrgStaffingGovernor.spawnRoomName[govEid] = String(Name.value[firstRoom] || "Office");
    }

    return {
      ok: true,
      summary: `Staffing governor upserted: role=${roleFinal} prefix=${claimTitlePrefix || "(any)"} maxAgents=${maxAgents} wip=${wipPerAgent} board=${boardName}`,
      artifacts: [{ kind: "org_staffing_governor", uri: `world://org/staffing/${govEid}` }],
    };
  });

  registerOfficeTool("kanban.list", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const boardEid = ctx.deviceEid;
    if (boardEid === undefined) return { ok: false, summary: "No board device", stderr: "kanban.list requires a deviceEid" };
    if (!hasComponent(ctx.world as any, boardEid, KanbanBoard as any)) {
      return { ok: false, summary: "Not a Kanban board", stderr: "Call kanban.init first" };
    }

    const lines: string[] = [];
    for (const col of listKanbanColumns(ctx.world, boardEid)) {
      lines.push(`# ${col.name}`);
      const cards = listDirectContents(ctx.world, col.eid).filter((eid) => hasComponent(ctx.world as any, eid, KanbanCard as any));
      if (!cards.length) lines.push("(empty)");
      for (const card of cards) lines.push(`- ${String(Name.value[card] || KanbanCard.title[card] || `card:${card}`)}`);
      lines.push("");
    }

    return { ok: true, summary: "Kanban board", stdout: lines.join("\n").trimEnd() };
  });

  registerOfficeTool("wiki.create_doc", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const deviceEid = ctx.deviceEid;
    if (deviceEid === undefined) return { ok: false, summary: "No wiki device", stderr: "wiki.create_doc requires a deviceEid" };

    const title = typeof params?.title === "string" ? params.title.trim() : "";
    if (!title) return { ok: false, summary: "Missing title", stderr: "wiki.create_doc requires {title}" };

    if (findWikiDoc(ctx.world, title) !== undefined) {
      return { ok: false, summary: "Doc exists", stderr: `Doc "${title}" already exists` };
    }

    const body = typeof params?.body === "string" ? params.body : "";
    const status = typeof params?.status === "string" ? params.status : "draft";

    const docEid = addEntity(ctx.world as any);
    addComponent(ctx.world as any, docEid, Name as any);
    addComponent(ctx.world as any, docEid, WikiDoc as any);
    Name.value[docEid] = title;
    WikiDoc.title[docEid] = title;
    WikiDoc.body[docEid] = body;
    WikiDoc.status[docEid] = status;
    WikiDoc.createdAt[docEid] = Date.now();
    WikiDoc.updatedAt[docEid] = Date.now();
    setLocatedIn(ctx.world, docEid, deviceEid);

    return {
      ok: true,
      summary: `Doc created: ${title}`,
      artifacts: [{ kind: "wiki_doc", uri: `world://wiki/doc/${docEid}` }],
    };
  });

  registerOfficeTool("wiki.upsert_doc", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const deviceEid = ctx.deviceEid;
    if (deviceEid === undefined) return { ok: false, summary: "No wiki device", stderr: "wiki.upsert_doc requires a deviceEid" };

    const title = typeof params?.title === "string" ? params.title.trim() : "";
    if (!title) return { ok: false, summary: "Missing title", stderr: "wiki.upsert_doc requires {title}" };

    const status = typeof params?.status === "string" ? params.status : undefined;
    const body = typeof params?.body === "string" ? params.body : undefined;

    const existing = findWikiDoc(ctx.world, title);
    if (existing !== undefined) {
      if (typeof body === "string") WikiDoc.body[existing] = body;
      if (typeof status === "string") WikiDoc.status[existing] = status;
      WikiDoc.updatedAt[existing] = Date.now();
      return { ok: true, summary: `Doc updated: ${title}`, artifacts: [{ kind: "wiki_doc", uri: `world://wiki/doc/${existing}` }] };
    }

    const docEid = addEntity(ctx.world as any);
    addComponent(ctx.world as any, docEid, Name as any);
    addComponent(ctx.world as any, docEid, WikiDoc as any);
    Name.value[docEid] = title;
    WikiDoc.title[docEid] = title;
    WikiDoc.body[docEid] = typeof body === "string" ? body : "";
    WikiDoc.status[docEid] = typeof status === "string" ? status : "draft";
    WikiDoc.createdAt[docEid] = Date.now();
    WikiDoc.updatedAt[docEid] = Date.now();
    setLocatedIn(ctx.world, docEid, deviceEid);

    return { ok: true, summary: `Doc created: ${title}`, artifacts: [{ kind: "wiki_doc", uri: `world://wiki/doc/${docEid}` }] };
  });

  registerOfficeTool("wiki.append", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const title = typeof params?.title === "string" ? params.title.trim() : "";
    const text = typeof params?.text === "string" ? params.text : (typeof params?.input === "string" ? params.input : "");
    if (!title || !text) return { ok: false, summary: "Missing params", stderr: "wiki.append requires {title, text}" };

    const docEid = findWikiDoc(ctx.world, title);
    if (docEid === undefined) return { ok: false, summary: "Doc not found", stderr: `No doc "${title}"` };

    const prev = String(WikiDoc.body[docEid] || "");
    WikiDoc.body[docEid] = prev ? `${prev}\n${text}` : text;
    WikiDoc.updatedAt[docEid] = Date.now();

    return { ok: true, summary: `Doc updated: ${title}` };
  });

  registerOfficeTool("wiki.ensure_contains", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const title = typeof params?.title === "string" ? params.title.trim() : "";
    const includes = typeof params?.includes === "string" ? params.includes : "";
    const textIfMissing = typeof params?.textIfMissing === "string" ? params.textIfMissing : includes;
    if (!title || !includes) return { ok: false, summary: "Missing params", stderr: "wiki.ensure_contains requires {title, includes, textIfMissing?}" };

    const docEid = findWikiDoc(ctx.world, title);
    if (docEid === undefined) return { ok: false, summary: "Doc not found", stderr: `No doc "${title}"` };

    const body = String(WikiDoc.body[docEid] || "");
    if (body.includes(includes)) return { ok: true, summary: `Doc already contains: ${title}` };

    WikiDoc.body[docEid] = body ? `${body}\n${textIfMissing}` : textIfMissing;
    WikiDoc.updatedAt[docEid] = Date.now();
    return { ok: true, summary: `Doc updated: ${title}` };
  });

  registerOfficeTool("wiki.read", (params: any, ctx: OfficeToolContext): OfficeToolResult => {
    const title = typeof params?.title === "string" ? params.title.trim() : "";
    if (!title) return { ok: false, summary: "Missing title", stderr: "wiki.read requires {title}" };

    const docEid = findWikiDoc(ctx.world, title);
    if (docEid === undefined) return { ok: false, summary: "Doc not found", stderr: `No doc "${title}"` };

    return { ok: true, summary: `Doc: ${title}`, stdout: String(WikiDoc.body[docEid] || "") };
  });
}
