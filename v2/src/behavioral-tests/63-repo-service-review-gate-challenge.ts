/**
 * Challenge: Repo PR review gate (EXPECTED TO FAIL today)
 *
 * Why this exists:
 * - Our repo/PR substrate can already auto-apply → CI → merge.
 * - A “CrewAI/product team” org needs governance: PRs must not merge until reviewed/approved.
 *
 * This test is intentionally written to fail until we add:
 * - A review/approval state machine for PRs (request_changes / approve)
 * - A gating rule in RepoIntegratorSystem: CI pass is necessary but not sufficient to merge
 *
 * Run:
 *   OFFICE_TOOLS_ALLOW_SHELL=1 npx tsx src/behavioral-tests/63-repo-service-review-gate-challenge.ts
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
    console.log("SKIP: set OFFICE_TOOLS_ALLOW_SHELL=1 to run this shell-backed challenge");
    process.exit(0);
  }

  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  setOfficeToolMode("shell");
  registerBuiltinOfficeTools();

  const world = createArgosWorld("RepoServiceReviewGateChallenge") as any;
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
  const ws = objectManager.spawn("computer", { name: "Workstation", state: "powered_on", containedIn: room })!;
  registerEntity(repoServer, "RepoServer");
  registerEntity(ws, "Workstation");

  const npc = createAgentEntity(world as any, { name: "Noah", role: "engineer", systemPrompt: "x", roomId: room });
  registerEntity(npc, "Noah");

  const repoId = "review_gate_incident";
  executeActions(
    world as any,
    [
      {
        eid: npc,
        action: {
          type: "interact",
          target: "RepoServer",
          content: `repo_init ${JSON.stringify({ repoId, fixtureId: "office_incident_cli_1", ciCommand: "node ci.cjs", force: true })}`,
        } as any,
      },
      { eid: npc, action: { type: "interact", target: "Workstation", content: `repo_checkout ${JSON.stringify({ repoId })}` } as any },
    ] as any,
    registry as any
  );

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

  executeActions(
    world as any,
    [
      {
        eid: npc,
        action: {
          type: "interact",
          target: "Workstation",
          content: `repo_submit_pr ${JSON.stringify({ repoId, title: "Fix invoice arithmetic", patch })}`,
        } as any,
      },
    ] as any,
    registry as any
  );

  const prEid = findSinglePullRequest(world as any);

  // Let the integrator run. Today it will merge automatically after CI passes.
  // This challenge expects the opposite: no merge until explicit review approval.
  for (let i = 0; i < 250; i++) {
    const status = String(PullRequest.status[prEid] || "");
    if (status === "failed") break;
    if (status === "merged") break;
    await tick(world as any, registry as any, i, 25);
  }

  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;

  const status = String(PullRequest.status[prEid] || "");
  if (status === "merged") {
    throw new Error(
      'EXPECTED FAIL: PR merged without review approval. Add a review gate (e.g. repo.request_changes/repo.approve + RepoIntegratorSystem merge gating) to pass this challenge.'
    );
  }

  // If it didn’t merge, we still fail (this is a challenge stub): we need a real review mechanism to proceed.
  throw new Error(`EXPECTED FAIL: review gating not implemented (current PR status: ${status || "(empty)"})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

