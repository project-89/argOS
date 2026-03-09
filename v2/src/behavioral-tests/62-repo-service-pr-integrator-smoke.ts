/**
 * Behavioral Test: Repo service + PR integrator (patch-based merge).
 *
 * Purpose:
 * - Prove agents can use an in-world "repo server" + "workstations" to:
 *   - initialize a shared repo fixture
 *   - submit a PR as a unified diff patch
 *   - have the RepoIntegratorSystem apply + CI + merge
 *   - verify another workstation can checkout and pass CI
 *
 * Run:
 *   OFFICE_TOOLS_ALLOW_SHELL=1 npx tsx src/behavioral-tests/62-repo-service-pr-integrator-smoke.ts
 */
import "dotenv/config";

import { addComponent, addEntity, query } from "bitecs";

import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Goal, PullRequest } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { ObjectManager } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { setGoalContract } from "../cognition/goal-contract";
import { createGoalEvaluationSystem } from "../systems/builtin-systems";
import { createOfficeToolJobSystem } from "../systems/office-tool-job-system";
import { createRepoIntegratorSystem } from "../systems/repo-integrator-system";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { setOfficeToolMode } from "../office-tools/tool-registry";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

function findSinglePullRequest(world: any): number {
  const prs = Array.from(query(world as any, [PullRequest] as any));
  assert(prs.length === 1, `expected 1 PR, found ${prs.length}`);
  return prs[0]!;
}

async function tick(world: any, registry: any, i: number, delayMs = 25): Promise<void> {
  runSystems(world as any, registry as any, i, 16);
  drainPendingStimuli();
  await new Promise<void>((r) => setTimeout(r, delayMs));
}

async function main() {
  if (process.env.OFFICE_TOOLS_ALLOW_SHELL !== "1") {
    console.log("SKIP: set OFFICE_TOOLS_ALLOW_SHELL=1 to run this shell-backed e2e test");
    process.exit(0);
  }

  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  setOfficeToolMode("shell");
  registerBuiltinOfficeTools();

  const world = createArgosWorld("RepoServicePrIntegratorSmoke") as any;
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

  const room = createRoomEntity(world as any, { name: "Office", description: "An office with computers." });
  registerEntity(room, "Office");

  const repoServer = objectManager.spawn("computer", { name: "RepoServer", state: "powered_on", containedIn: room })!;
  const wsA = objectManager.spawn("computer", { name: "WorkstationA", state: "powered_on", containedIn: room })!;
  const wsB = objectManager.spawn("computer", { name: "WorkstationB", state: "powered_on", containedIn: room })!;
  registerEntity(repoServer, "RepoServer");
  registerEntity(wsA, "WorkstationA");
  registerEntity(wsB, "WorkstationB");

  const npc = createAgentEntity(world as any, { name: "Noah", role: "npc", systemPrompt: "x", roomId: room });
  registerEntity(npc, "Noah");

  const repoId = "incident_cli_1";
  const initArgs = JSON.stringify({ repoId, fixtureId: "office_incident_cli_1", ciCommand: "node ci.cjs", force: true });
  executeActions(world as any, [{ eid: npc, action: { type: "interact", target: "RepoServer", content: `repo_init ${initArgs}` } as any }], registry as any);

  const checkoutArgs = JSON.stringify({ repoId });
  executeActions(world as any, [{ eid: npc, action: { type: "interact", target: "WorkstationA", content: `repo_checkout ${checkoutArgs}` } as any }], registry as any);

  const patch = [
    "diff --git a/src/math.cjs b/src/math.cjs",
    "index 0000000..0000000 100644",
    "--- a/src/math.cjs",
    "+++ b/src/math.cjs",
    "@@ -1,3 +1,3 @@",
    " exports.add = (a, b) => a + b;",
    "-exports.mul = (a, b) => a - b; // BUG: should multiply",
    "+exports.mul = (a, b) => a * b;",
    " exports.percentOf = (total, pct) => total * pct;",
    "diff --git a/src/service.cjs b/src/service.cjs",
    "index 0000000..0000000 100644",
    "--- a/src/service.cjs",
    "+++ b/src/service.cjs",
    "@@ -12,4 +12,4 @@",
    " exports.applyDiscount = (subtotal, discountPct) => {",
    "   // BUG: discount should reduce total, not increase it",
    "-  return subtotal + percentOf(subtotal, discountPct);",
    "+  return subtotal - percentOf(subtotal, discountPct);",
    " };",
    "",
  ].join("\n");

  const prArgs = JSON.stringify({
    repoId,
    title: "Fix invoice arithmetic",
    description: "Fix mul() and applyDiscount() so CI passes.",
    patch,
  });
  executeActions(world as any, [{ eid: npc, action: { type: "interact", target: "WorkstationA", content: `repo_submit_pr ${prArgs}` } as any }], registry as any);

  const prEid = findSinglePullRequest(world as any);

  for (let i = 0; i < 400; i++) {
    const status = String(PullRequest.status[prEid] || "");
    if (status === "merged") break;
    if (status === "failed") {
      const stderr = String(PullRequest.lastStderr[prEid] || "");
      throw new Error(`PR failed to merge: ${stderr.slice(0, 1200)}`);
    }
    await tick(world as any, registry as any, i, 25);
  }

  assert(String(PullRequest.status[prEid] || "") === "merged", "expected PR to merge");

  // Verify another workstation can checkout and pass CI.
  executeActions(world as any, [{ eid: npc, action: { type: "interact", target: "WorkstationB", content: `repo_checkout ${checkoutArgs}` } as any }], registry as any);

  const goalEid = addEntity(world as any);
  addComponent(world as any, goalEid, Goal as any);
  addComponent(world as any, npc, HasGoal(goalEid) as any);
  Goal.description[goalEid] = "On WorkstationB, run CI and ensure it passes.";
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

  executeActions(world as any, [{ eid: npc, action: { type: "interact", target: "WorkstationB", content: "run_command node ci.cjs" } as any }], registry as any);

  for (let i = 0; i < 200; i++) {
    if (String(Goal.status[goalEid] || "") === "completed") break;
    await tick(world as any, registry as any, i + 1000, 25);
  }

  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;

  assert(String(Goal.status[goalEid] || "") === "completed", "expected WorkstationB CI to pass after merge");
  console.log("✓ repo service PR integrator smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
