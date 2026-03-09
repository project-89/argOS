import * as fs from "node:fs";
import * as path from "node:path";

import { addComponent, entityExists, getRelationTargets, hasComponent, query } from "bitecs";
import type { World } from "../ecs/world";
import type { SystemContext, SystemDefinition } from "../ecs/dynamic-systems";
import { Name, PendingToolJob, PullRequest, Repo, ToolResult } from "../ecs/components";
import { HasToolResult } from "../ecs/relations";
import { ensureOfficeDeviceSandboxDir, ensureOfficeSandboxDir } from "../office-tools/sandbox";
import { enqueueOfficeProcessJob, getOfficeProcessJob } from "../office-tools/async-jobs";

function safeFsName(input: string): string {
  const s = String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "repo";
}

function resetDir(absDir: string): void {
  fs.rmSync(absDir, { recursive: true, force: true });
  fs.mkdirSync(absDir, { recursive: true });
  fs.mkdirSync(path.join(absDir, "tmp"), { recursive: true });
}

function copyDirContents(srcDir: string, destDir: string, skipNames: Set<string> = new Set([".git", "tmp"])): void {
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

function getRepoBaseDir(world: World, repoId: string, baseDeviceEid: number): string {
  const deviceRoot = ensureOfficeDeviceSandboxDir(world, baseDeviceEid);
  return path.join(deviceRoot, "repos", safeFsName(repoId), "base");
}

function getIntegratorRootDir(world: World, repoId: string): string {
  const root = path.join(ensureOfficeSandboxDir(world), "repo-service", safeFsName(repoId));
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function findToolResult(world: World, actorEid: number, toolId: string, sinceMs: number): number | undefined {
  const toolEids = getRelationTargets(world as any, actorEid, HasToolResult as any) as number[];
  let best: number | undefined;
  let bestTs = sinceMs;
  for (const eid of toolEids) {
    if (!entityExists(world as any, eid)) continue;
    if (!hasComponent(world as any, eid, ToolResult as any)) continue;
    if (String(ToolResult.toolId[eid] || "") !== toolId) continue;
    const ts = Number(ToolResult.timestamp[eid] || 0);
    if (ts >= bestTs) {
      bestTs = ts;
      best = eid;
    }
  }
  return best;
}

function updateLastResult(world: World, prEid: number, toolEid: number): void {
  PullRequest.lastExitCode[prEid] = Number.isFinite(Number(ToolResult.exitCode[toolEid])) ? Number(ToolResult.exitCode[toolEid]) : ToolResult.ok[toolEid] ? 0 : 1;
  PullRequest.lastStdout[prEid] = String(ToolResult.stdout[toolEid] || "");
  PullRequest.lastStderr[prEid] = String(ToolResult.stderr[toolEid] || "");
  PullRequest.lastUpdatedAt[prEid] = Date.now();
}

function looksLikePatchConflict(stderr: string): boolean {
  const s = String(stderr || "");
  if (!s.trim()) return false;
  return /patch failed:/i.test(s) || /patch does not apply/i.test(s) || /already exists in working directory/i.test(s);
}

function setPending(prEid: number, phase: "apply" | "ci" | "merge", toolId: string, jobId: string): void {
  PullRequest.pendingPhase[prEid] = phase;
  PullRequest.pendingToolId[prEid] = toolId;
  PullRequest.pendingJobId[prEid] = jobId;
  PullRequest.pendingStartedAt[prEid] = Date.now();
}

function clearPending(prEid: number): void {
  PullRequest.pendingPhase[prEid] = "";
  PullRequest.pendingToolId[prEid] = "";
  PullRequest.pendingJobId[prEid] = "";
  PullRequest.pendingStartedAt[prEid] = 0;
}

export function createRepoIntegratorSystem(): SystemDefinition {
  return {
    name: "RepoIntegratorSystem",
    description: "Applies, tests, and merges PR patches into shared repos (non-blocking via async jobs)",
    frequency: 250,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, _ctx: SystemContext) => {
      const prs = Array.from(query(world as any, [PullRequest] as any));
      if (!prs.length) return;

      // Deterministic: process one PR at a time.
      prs.sort((a, b) => (PullRequest.createdAt[a] || 0) - (PullRequest.createdAt[b] || 0));

      for (const prEid of prs) {
        const status = String(PullRequest.status[prEid] || "");
        if (status === "merged" || status === "failed" || status === "needs_rebase") continue;

        const repoEid = Number(PullRequest.repoEid[prEid] ?? -1);
        if (!entityExists(world as any, repoEid) || !hasComponent(world as any, repoEid, Repo as any)) {
          PullRequest.status[prEid] = "failed";
          PullRequest.lastStderr[prEid] = "PR repoEid invalid or missing Repo component";
          PullRequest.lastUpdatedAt[prEid] = Date.now();
          continue;
        }

        const repoId = String(Repo.repoId[repoEid] || "").trim() || `repo-${repoEid}`;
        const baseDeviceEid = Number(Repo.baseDeviceEid[repoEid] ?? -1);
        const ciCommand = String(Repo.ciCommand[repoEid] || "node ci.cjs").trim() || "node ci.cjs";
        if (!Number.isFinite(baseDeviceEid) || baseDeviceEid < 0) {
          PullRequest.status[prEid] = "failed";
          PullRequest.lastStderr[prEid] = `Repo ${repoId} has invalid baseDeviceEid`;
          PullRequest.lastUpdatedAt[prEid] = Date.now();
          continue;
        }

        const baseDir = getRepoBaseDir(world, repoId, baseDeviceEid);
        try {
          fs.statSync(baseDir);
        } catch {
          PullRequest.status[prEid] = "failed";
          PullRequest.lastStderr[prEid] = `Repo base dir missing: ${baseDir}`;
          PullRequest.lastUpdatedAt[prEid] = Date.now();
          continue;
        }

        if (!hasComponent(world as any, prEid, Name as any)) addComponent(world as any, prEid, Name as any);
        if (!String(Name.value[prEid] || "").trim()) Name.value[prEid] = `PR:${repoId}:${String(PullRequest.prId[prEid] || "").slice(0, 8)}`;

        const prId = String(PullRequest.prId[prEid] || "").trim() || `pr-${prEid}`;
        const integratorRoot = getIntegratorRootDir(world, repoId);
        const prRoot = path.join(integratorRoot, "prs", safeFsName(prId));
        const workDir = path.join(prRoot, "work");

        const pendingJobId = String(PullRequest.pendingJobId[prEid] || "");
        const pendingToolId = String(PullRequest.pendingToolId[prEid] || "");
        const pendingSince = Number(PullRequest.pendingStartedAt[prEid] || 0);

        if (pendingJobId && getOfficeProcessJob(pendingJobId)) {
          // Still running.
          return;
        }

        if (pendingToolId && pendingSince) {
          const toolEid = findToolResult(world, prEid, pendingToolId, pendingSince);
          if (toolEid === undefined) {
            // Job finished but tool result hasn't been drained yet.
            return;
          }

          updateLastResult(world, prEid, toolEid);
          const ok = !!ToolResult.ok[toolEid];
          const phase = String(PullRequest.pendingPhase[prEid] || "");
          clearPending(prEid);

          if (!ok) {
            const stderr = String(PullRequest.lastStderr[prEid] || "");
            if (phase === "apply" && looksLikePatchConflict(stderr)) {
              PullRequest.status[prEid] = "needs_rebase";
              PullRequest.lastStderr[prEid] =
                `${stderr.trim()}\n\n` +
                `Integrator guidance: This PR no longer applies cleanly to the updated base. Rebase by checking out the latest repo, generating a new patch against it, and resubmitting with the same prId.`;
            } else {
              PullRequest.status[prEid] = "failed";
            }
            PullRequest.lastUpdatedAt[prEid] = Date.now();
            return;
          }

          if (phase === "apply") {
            PullRequest.status[prEid] = "testing";
          } else if (phase === "ci") {
            PullRequest.status[prEid] = "merging";
          } else if (phase === "merge") {
            PullRequest.status[prEid] = "merged";
            Repo.lastUpdatedAt[repoEid] = Date.now();
          }

          // State advanced; schedule the next phase on the next tick for determinism.
          return;
        }

        const nextStatus = String(PullRequest.status[prEid] || "");
        const patch = String(PullRequest.patch[prEid] || "");

        if (nextStatus === "open" || nextStatus === "applying") {
          PullRequest.status[prEid] = "applying";
          PullRequest.workDir[prEid] = workDir;
          PullRequest.lastUpdatedAt[prEid] = Date.now();

          resetDir(workDir);
          copyDirContents(baseDir, workDir);
          fs.mkdirSync(prRoot, { recursive: true });
          const normalizedPatch = String(patch || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
          fs.writeFileSync(path.join(prRoot, "pr.patch"), normalizedPatch.endsWith("\n") ? normalizedPatch : normalizedPatch + "\n", {
            encoding: "utf8",
            flag: "w",
          });

          const env: Record<string, string> = {
            ...process.env,
            HOME: workDir,
            TMPDIR: path.join(workDir, "tmp"),
            ARGOS_OFFICE_SANDBOX_DIR: workDir,
            GIT_CEILING_DIRECTORIES: workDir,
            GIT_DISCOVERY_ACROSS_FILESYSTEM: "0",
          };

          const { jobId } = enqueueOfficeProcessJob({
            toolId: "repo.integrator.apply",
            actorEid: prEid,
            deviceEid: baseDeviceEid,
            command: "bash",
            args: ["-lc", "set -euo pipefail; git init -q . >/dev/null 2>&1 || true; git apply -p1 --no-index --whitespace=nowarn ../pr.patch"],
            cwd: workDir,
            env,
            shell: false,
            timeoutMs: 30_000,
            maxBufferBytes: 2 * 1024 * 1024,
            dedupKey: `repo.integrator.apply|${repoId}|${prId}`,
          });

          setPending(prEid, "apply", "repo.integrator.apply", jobId);
          if (!hasComponent(world as any, prEid, PendingToolJob as any)) addComponent(world as any, prEid, PendingToolJob as any);
          PendingToolJob.jobId[prEid] = jobId;
          PendingToolJob.toolId[prEid] = "repo.integrator.apply";
          PendingToolJob.command[prEid] = "apply";
          PendingToolJob.startedAt[prEid] = Date.now();
          return;
        }

        if (nextStatus === "testing") {
          const env: Record<string, string> = {
            ...process.env,
            HOME: workDir,
            TMPDIR: path.join(workDir, "tmp"),
            ARGOS_OFFICE_SANDBOX_DIR: workDir,
            GIT_CEILING_DIRECTORIES: workDir,
            GIT_DISCOVERY_ACROSS_FILESYSTEM: "0",
          };

          const { jobId } = enqueueOfficeProcessJob({
            toolId: "repo.integrator.ci",
            actorEid: prEid,
            deviceEid: baseDeviceEid,
            command: "bash",
            args: ["-lc", `set -euo pipefail; ${ciCommand}`],
            cwd: workDir,
            env,
            shell: false,
            timeoutMs: 60_000,
            maxBufferBytes: 2 * 1024 * 1024,
            dedupKey: `repo.integrator.ci|${repoId}|${prId}`,
          });

          setPending(prEid, "ci", "repo.integrator.ci", jobId);
          if (!hasComponent(world as any, prEid, PendingToolJob as any)) addComponent(world as any, prEid, PendingToolJob as any);
          PendingToolJob.jobId[prEid] = jobId;
          PendingToolJob.toolId[prEid] = "repo.integrator.ci";
          PendingToolJob.command[prEid] = "ci";
          PendingToolJob.startedAt[prEid] = Date.now();
          return;
        }

        if (nextStatus === "merging") {
          const prPatchPath = path.join(prRoot, "pr.patch");
          const env: Record<string, string> = {
            ...process.env,
            HOME: baseDir,
            TMPDIR: path.join(baseDir, "tmp"),
            ARGOS_OFFICE_SANDBOX_DIR: baseDir,
            GIT_CEILING_DIRECTORIES: baseDir,
            GIT_DISCOVERY_ACROSS_FILESYSTEM: "0",
          };

          const { jobId } = enqueueOfficeProcessJob({
            toolId: "repo.integrator.merge",
            actorEid: prEid,
            deviceEid: baseDeviceEid,
            command: "bash",
            args: ["-lc", `set -euo pipefail; git init -q . >/dev/null 2>&1 || true; git apply -p1 --no-index --whitespace=nowarn ${JSON.stringify(prPatchPath)}; ${ciCommand}`],
            cwd: baseDir,
            env,
            shell: false,
            timeoutMs: 60_000,
            maxBufferBytes: 2 * 1024 * 1024,
            dedupKey: `repo.integrator.merge|${repoId}|${prId}`,
          });

          setPending(prEid, "merge", "repo.integrator.merge", jobId);
          if (!hasComponent(world as any, prEid, PendingToolJob as any)) addComponent(world as any, prEid, PendingToolJob as any);
          PendingToolJob.jobId[prEid] = jobId;
          PendingToolJob.toolId[prEid] = "repo.integrator.merge";
          PendingToolJob.command[prEid] = "merge";
          PendingToolJob.startedAt[prEid] = Date.now();
          return;
        }

        // Unknown state: fail fast.
        PullRequest.status[prEid] = "failed";
        PullRequest.lastStderr[prEid] = `Unknown PR status: ${nextStatus}`;
        PullRequest.lastUpdatedAt[prEid] = Date.now();
        return;
      }
    },
  };
}
