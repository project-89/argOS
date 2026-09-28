import { spawn } from "node:child_process";

export type WorkerFailureCode = "spawn_failed" | "cancelled" | "output_budget" | "protocol_error" | "turn_failed" | "process_failed" | "incomplete_turn";
export class CodingWorkerError extends Error {
  constructor(readonly code: WorkerFailureCode, message: string) { super(`Coding worker ${code}: ${message}`); this.name = "CodingWorkerError"; }
}
export interface WorkerDiagnostics {
  stdoutBytes: number; stderrBytes: number; frames: number; oversizedFrames: number;
  largestFrameBytes: number; lastEventType: string | null; completed: boolean;
  exitCode: number | null; exitSignal: string | null; failureCode: WorkerFailureCode | null;
}

/** Newline framing is bounded independently from session output. Tool-result
 * events can contain a large file: drain those advisory frames, not the worker.
 * Completion/error frames are never silently discarded. No payload is retained. */
export class CodexJsonFrames {
  private pending = "";
  private frameBytes = 0;
  private discarding = false;
  private oversizedType: string | null = null;
  readonly diagnostics: WorkerDiagnostics = { stdoutBytes: 0, stderrBytes: 0, frames: 0, oversizedFrames: 0,
    largestFrameBytes: 0, lastEventType: null, completed: false, exitCode: null, exitSignal: null, failureCode: null };
  constructor(private readonly onEvent: (event: any) => void, private readonly maxFrameBytes = 1_000_000,
    private readonly maxOutputBytes = 64_000_000) {}
  push(chunk: string): void {
    this.diagnostics.stdoutBytes += Buffer.byteLength(chunk);
    if (this.diagnostics.stdoutBytes > this.maxOutputBytes) throw new CodingWorkerError("output_budget", `stdout exceeded ${this.maxOutputBytes} bytes`);
    let cursor = 0;
    while (cursor < chunk.length) {
      const newline = chunk.indexOf("\n", cursor);
      const end = newline < 0 ? chunk.length : newline;
      const part = chunk.slice(cursor, end);
      this.frameBytes += Buffer.byteLength(part);
      this.diagnostics.largestFrameBytes = Math.max(this.diagnostics.largestFrameBytes, this.frameBytes);
      if (!this.discarding) {
        if (this.frameBytes > this.maxFrameBytes) {
          const prefix = (this.pending + part.slice(0, 512)).slice(0, 512);
          this.oversizedType = prefix.match(/^\s*\{\s*"type"\s*:\s*"([a-z_.]+)"/)?.[1] ?? null;
          if (this.oversizedType !== "item.completed" && this.oversizedType !== "item.started" && this.oversizedType !== "item.updated") {
            throw new CodingWorkerError("protocol_error", "oversized non-advisory JSON frame");
          }
          this.pending = ""; this.discarding = true;
        } else this.pending += part;
      }
      if (newline >= 0) this.finishFrame();
      cursor = newline < 0 ? chunk.length : newline + 1;
    }
  }
  private finishFrame(): void {
    this.diagnostics.largestFrameBytes = Math.max(this.diagnostics.largestFrameBytes, this.frameBytes);
    if (this.discarding) {
      this.diagnostics.frames++; this.diagnostics.oversizedFrames++;
      this.diagnostics.lastEventType = this.oversizedType;
    } else if (this.pending.trim()) {
      let event: any;
      try { event = JSON.parse(this.pending); } catch { throw new CodingWorkerError("protocol_error", "invalid JSON frame"); }
      if (!event || typeof event.type !== "string") throw new CodingWorkerError("protocol_error", "frame has no event type");
      this.diagnostics.frames++; this.diagnostics.lastEventType = event.type.slice(0, 100);
      if (event.type === "turn.completed") this.diagnostics.completed = true;
      if (event.type === "turn.failed" || event.type === "error") throw new CodingWorkerError("turn_failed", event.type);
      this.onEvent(event);
    }
    this.pending = ""; this.frameBytes = 0; this.discarding = false; this.oversizedType = null;
  }
  end(): void { if (this.frameBytes || this.pending || this.discarding) this.finishFrame(); }
}

export async function runCodexWorker(options: {
  command: string; args: string[]; directory: string; env: NodeJS.ProcessEnv; input: string;
  signal: AbortSignal; progress: (message: string) => void; diagnostics: (value: WorkerDiagnostics) => Promise<void>;
  maxFrameBytes?: number; maxOutputBytes?: number;
}): Promise<void> {
  const frames = new CodexJsonFrames(event => {
    if (event.type === "item.completed" || event.type === "turn.completed") options.progress(`Codex ${event.item?.type ?? event.type}`);
  }, options.maxFrameBytes, options.maxOutputBytes);
  let failure: CodingWorkerError | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(options.command, options.args, { cwd: options.directory, env: options.env,
        stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
      const kill = () => {
        try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* exited */ }
      };
      const cancel = () => { failure ??= new CodingWorkerError("cancelled", "host abort signal"); kill(); };
      options.signal.addEventListener("abort", cancel, { once: true });
      if (options.signal.aborted) cancel();
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", chunk => { if (failure) return; try { frames.push(chunk); } catch (error) { failure = error as CodingWorkerError; kill(); } });
      child.stderr.on("data", chunk => { frames.diagnostics.stderrBytes += chunk.length; });
      child.once("error", () => { failure ??= new CodingWorkerError("spawn_failed", "could not start executable"); });
      child.once("close", (code, signal) => {
        options.signal.removeEventListener("abort", cancel);
        frames.diagnostics.exitCode = code; frames.diagnostics.exitSignal = signal;
        if (!failure) { try { frames.end(); } catch (error) { failure = error as CodingWorkerError; } }
        if (!failure && code !== 0) failure = new CodingWorkerError("process_failed", `exit ${code}, signal ${signal ?? "none"}`);
        if (!failure && !frames.diagnostics.completed) failure = new CodingWorkerError("incomplete_turn", "no turn.completed receipt");
        if (failure) reject(failure); else resolve();
      });
      child.stdin.on("error", () => {}); child.stdin.end(options.input);
    });
  } finally {
    frames.diagnostics.failureCode = failure?.code ?? null;
    await options.diagnostics({ ...frames.diagnostics });
  }
}
