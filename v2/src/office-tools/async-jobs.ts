import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { OfficeToolResult } from "./tool-registry";

type JobStatus = "running" | "completed";

export type OfficeProcessJobSpec = {
  toolId: string;
  actorEid: number;
  deviceEid: number;
  command: string;
  args?: string[];
  cwd: string;
  env: Record<string, string>;
  shell?: boolean;
  timeoutMs?: number;
  maxBufferBytes?: number;
  dedupKey?: string;
  postProcess?: (raw: {
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
    timedOut: boolean;
    signal: NodeJS.Signals | null;
  }) => OfficeToolResult;
};

export type OfficeProcessJob = {
  jobId: string;
  toolId: string;
  actorEid: number;
  deviceEid: number;
  command: string;
  cwd: string;
  startedAt: number;
  status: JobStatus;
  result?: OfficeToolResult;
  raw?: {
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
    timedOut: boolean;
    signal: NodeJS.Signals | null;
  };
};

const runningByJobId = new Map<string, OfficeProcessJob>();
const runningByDedupKey = new Map<string, string>();
const completedQueue: OfficeProcessJob[] = [];

function clampOutput(existing: string, chunk: string, max: number): string {
  if (max <= 0) return "";
  const next = existing + chunk;
  if (next.length <= max) return next;
  // Keep tail (most recent output tends to include error).
  return next.slice(next.length - max);
}

export function enqueueOfficeProcessJob(spec: OfficeProcessJobSpec): { jobId: string; alreadyRunning: boolean } {
  const dedupKey = String(spec.dedupKey || "").trim();
  if (dedupKey) {
    const existing = runningByDedupKey.get(dedupKey);
    if (existing && runningByJobId.has(existing)) return { jobId: existing, alreadyRunning: true };
  }

  const jobId = randomUUID();
  const startedAt = Date.now();
  const job: OfficeProcessJob = {
    jobId,
    toolId: spec.toolId,
    actorEid: spec.actorEid,
    deviceEid: spec.deviceEid,
    command: spec.command,
    cwd: spec.cwd,
    startedAt,
    status: "running",
  };

  runningByJobId.set(jobId, job);
  if (dedupKey) runningByDedupKey.set(dedupKey, jobId);

  const timeoutMs = Number.isFinite(Number(spec.timeoutMs)) ? Math.max(1_000, Number(spec.timeoutMs)) : 60_000;
  const maxBuffer = Number.isFinite(Number(spec.maxBufferBytes)) ? Math.max(16_384, Number(spec.maxBufferBytes)) : 4 * 1024 * 1024;

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let signal: NodeJS.Signals | null = null;
  let finalized = false;

  // Keep child jobs attached to this process; this avoids orphaned background tools
  // that can outlive simulation runs and interfere with repeatability.
  const detached = false;
  const child = spawn(spec.command, Array.isArray(spec.args) ? spec.args : [], {
    shell: spec.shell === true,
    cwd: spec.cwd,
    env: spec.env,
    detached,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const killTimer = setTimeout(() => {
    timedOut = true;
    try {
      // Kill the whole process group when detached (prevents orphaned child processes).
      if (detached && typeof child.pid === "number") {
        try {
          process.kill(-child.pid, "SIGKILL");
          return;
        } catch {
          // fall through
        }
      }
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }, timeoutMs);

  child.stdout?.on("data", (buf: Buffer) => {
    stdout = clampOutput(stdout, buf.toString("utf8"), maxBuffer);
  });
  child.stderr?.on("data", (buf: Buffer) => {
    stderr = clampOutput(stderr, buf.toString("utf8"), maxBuffer);
  });

  const finalize = (exitCode: number, sig: NodeJS.Signals | null): void => {
    if (finalized) return;
    finalized = true;
    clearTimeout(killTimer);
    signal = sig;

    const durationMs = Date.now() - startedAt;
    const raw = { stdout, stderr, exitCode, durationMs, timedOut, signal };
    job.raw = raw;
    job.status = "completed";

    const processed = spec.postProcess ? spec.postProcess(raw) : undefined;
    job.result =
      processed ??
      ({
        ok: exitCode === 0 && !timedOut,
        summary: `${spec.toolId} (${exitCode}) in ${durationMs}ms${timedOut ? " (timeout)" : ""}`,
        stdout,
        stderr,
        exitCode,
      } satisfies OfficeToolResult);

    runningByJobId.delete(jobId);
    if (dedupKey && runningByDedupKey.get(dedupKey) === jobId) runningByDedupKey.delete(dedupKey);
    completedQueue.push(job);
  };

  child.on("error", (err: Error) => {
    stderr = clampOutput(
      stderr,
      `\nSpawn error for ${spec.command}: ${String(err?.message || err)}`,
      maxBuffer
    );
    finalize(timedOut ? 124 : 127, signal);
  });

  child.on("exit", (code: number | null, sig: NodeJS.Signals | null) => {
    const exitCode = typeof code === "number" ? code : timedOut ? 124 : 1;
    finalize(exitCode, sig);
  });

  return { jobId, alreadyRunning: false };
}

export function getOfficeProcessJob(jobId: string): OfficeProcessJob | undefined {
  return runningByJobId.get(jobId);
}

export function drainCompletedOfficeJobs(): OfficeProcessJob[] {
  const out = completedQueue.splice(0, completedQueue.length);
  return out;
}
