/**
 * Challenge: Repo PR conflict + rebase loop (EXPECTED TO FAIL today)
 *
 * Desired future behavior:
 * - Two PRs created against the same base can conflict.
 * - The integrator should NOT hard-fail the PR forever; it should:
 *   - mark it as "needs_rebase" (or similar)
 *   - emit a clear message/artifact explaining the conflict
 *   - allow the author to rebase (checkout latest base, regenerate patch) and resubmit
 *   - then apply+CI+merge the rebased PR
 *
 * Today’s behavior:
 * - PR2 will usually go to "failed" when `git apply` can’t apply cleanly.
 *
 * Run:
 *   OFFICE_TOOLS_ALLOW_SHELL=1 npx tsx src/behavioral-tests/64-repo-service-conflict-rebase-challenge.ts
 */
import "dotenv/config";

import { query } from "bitecs";

import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { PullRequest } from "../ecs/components";
import { ObjectManager } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { createOfficeToolJobSystem } from "../systems/office-tool-job-system";
import { createRepoIntegratorSystem } from "../systems/repo-integrator-system";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { setOfficeToolMode } from "../office-tools/tool-registry";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

function findPRs(world: any): number[] {
  return Array.from(query(world as any, [PullRequest] as any));
}

async function tick(world: any, registry: any, i: number, delayMs = 25): Promise<void> {
  runSystems(world as any, registry as any, i, 16);
  drainPendingStimuli();
  await new Promise<void>((r) => setTimeout(r, delayMs));
}

async function main() {
  if (process.env.OFFICE_TOOLS_ALLOW_SHELL !== "1") {
    console.log("SKIP: set OFFICE_TOOLS_ALLOW_SHELL=1 to run this shell-backed challenge");
    process.exit(0);
  }

  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  setOfficeToolMode("shell");
  registerBuiltinOfficeTools();

  const world = createArgosWorld("RepoServiceConflictRebaseChallenge") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

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

  const alice = createAgentEntity(world as any, { name: "Alice", role: "engineer", systemPrompt: "x", roomId: room });
  const bob = createAgentEntity(world as any, { name: "Bob", role: "engineer", systemPrompt: "x", roomId: room });
  registerEntity(alice, "Alice");
  registerEntity(bob, "Bob");

  const repoId = "conflict_rebase_incident";
  executeActions(
    world as any,
    [
      {
        eid: alice,
        action: {
          type: "interact",
          target: "RepoServer",
          content: `repo_init ${JSON.stringify({ repoId, fixtureId: "office_conflict_cli_1", ciCommand: "node ci.cjs", force: true })}`,
        } as any,
      },
      { eid: alice, action: { type: "interact", target: "WorkstationA", content: `repo_checkout ${JSON.stringify({ repoId })}` } as any },
      { eid: bob, action: { type: "interact", target: "WorkstationB", content: `repo_checkout ${JSON.stringify({ repoId })}` } as any },
    ] as any,
    registry as any
  );

  // PR1 fixes applyDiscount line (will merge).
  const pr1Patch = [
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

  // PR2 ALSO targets the same exact old line, but replaces it differently.
  // Once PR1 merges, this patch should fail to apply cleanly.
  const pr2Patch = [
    "diff --git a/src/service.cjs b/src/service.cjs",
    "index 0000000..0000000 100644",
    "--- a/src/service.cjs",
    "+++ b/src/service.cjs",
    "@@ -12,4 +12,4 @@",
    " exports.applyDiscount = (subtotal, discountPct) => {",
    "   // BUG: discount should reduce total, not increase it",
    "-  return subtotal + percentOf(subtotal, discountPct);",
    "+  return subtotal - (subtotal * discountPct);",
    " };",
    "",
  ].join("\n");

  executeActions(
    world as any,
    [
      {
        eid: alice,
        action: {
          type: "interact",
          target: "WorkstationA",
          content: `repo_submit_pr ${JSON.stringify({ repoId, title: "PR1: Fix discount math", patch: pr1Patch })}`,
        } as any,
      },
      {
        eid: bob,
        action: {
          type: "interact",
          target: "WorkstationB",
          content: `repo_submit_pr ${JSON.stringify({ repoId, title: "PR2: Alternate discount fix", patch: pr2Patch })}`,
        } as any,
      },
    ] as any,
    registry as any
  );

  // Wait until both PRs have terminal statuses (merged/failed/needs_rebase/etc).
  for (let i = 0; i < 400; i++) {
    const prs = findPRs(world as any);
    if (prs.length >= 2) {
      const statuses = prs.map((eid) => String(PullRequest.status[eid] || ""));
      const allTerminal = statuses.every((s) => ["merged", "failed", "needs_rebase"].includes(s));
      if (allTerminal) break;
    }
    await tick(world as any, registry as any, i, 25);
  }

  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;

  const prs = findPRs(world as any);
  assert(prs.length >= 2, `expected >=2 PRs, found ${prs.length}`);

  const byTitle = new Map<string, number>();
  for (const prEid of prs) byTitle.set(String(PullRequest.title[prEid] || ""), prEid);
  const pr1 = byTitle.get("PR1: Fix discount math");
  const pr2 = byTitle.get("PR2: Alternate discount fix");
  assert(typeof pr1 === "number" && typeof pr2 === "number", "expected both PR titles to exist");

  const s1 = String(PullRequest.status[pr1!] || "");
  const s2 = String(PullRequest.status[pr2!] || "");

  if (s1 !== "merged") {
    throw new Error(`Expected PR1 to merge first; got status=${s1} stderr=${String(PullRequest.lastStderr[pr1!] || "").slice(0, 800)}`);
  }

  if (s2 !== "needs_rebase") {
    throw new Error(`Expected PR2 to require rebase; got status=${s2} stderr=${String(PullRequest.lastStderr[pr2!] || "").slice(0, 800)}`);
  }

  // Rebase/resubmit PR2 against the updated base (which now contains PR1).
  const pr2Id = String(PullRequest.prId[pr2!] || "").trim();
  assert(!!pr2Id, "Expected PR2 to have a prId");
  const rebasedPatch = [
    "diff --git a/src/service.cjs b/src/service.cjs",
    "index 0000000..0000000 100644",
    "--- a/src/service.cjs",
    "+++ b/src/service.cjs",
    "@@ -12,4 +12,4 @@",
    " exports.applyDiscount = (subtotal, discountPct) => {",
    "   // BUG: discount should reduce total, not increase it",
    "-  return subtotal - percentOf(subtotal, discountPct);",
    "+  return subtotal - (subtotal * discountPct);",
    " };",
    "",
  ].join("\n");

  executeActions(
    world as any,
    [
      {
        eid: bob,
        action: {
          type: "interact",
          target: "WorkstationB",
          content: `repo_submit_pr ${JSON.stringify({ repoId, prId: pr2Id, title: "PR2: Alternate discount fix", patch: rebasedPatch })}`,
        } as any,
      },
    ] as any,
    registry as any
  );

  for (let i = 0; i < 400; i++) {
    const st = String(PullRequest.status[pr2!] || "");
    if (st === "merged") break;
    if (st === "failed") {
      throw new Error(`PR2 rebased submission failed: ${String(PullRequest.lastStderr[pr2!] || "").slice(0, 1000)}`);
    }
    await tick(world as any, registry as any, i + 1000, 25);
  }

  const final2 = String(PullRequest.status[pr2!] || "");
  assert(final2 === "merged", `Expected PR2 to merge after rebase; got ${final2}`);
  console.log("✓ repo conflict + rebase challenge passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
