/** Claude Code as a coding daemon: `claude -p` in the candidate workspace, driven
 * over stream-json. Mirrors the Codex worker's contract: bounded output, a process
 * group killed on cancel, and success only on an explicit successful result frame. */
import { spawn } from "node:child_process";
import { CodingWorkerError, type WorkerDiagnostics } from "./codex-transport";

/** Tools the builder may use inside its workspace. No network, no arbitrary shell. */
// Only the bundled validator may run: `node -e` would otherwise reach the network,
// which Codex's workspace sandbox also forbids.
export const CLAUDE_BUILDER_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash(node validate.mjs)"] as const;
export const CLAUDE_BUILDER_DENIED = ["WebFetch", "WebSearch", "Bash(curl:*)", "Bash(wget:*)", "Bash(npm:*)", "Bash(npx:*)", "Bash(git:*)"] as const;

export function claudeBuilderArgs(model?: string): string[] {
  // --tools limits what exists in the session at all (no subagents, workflows,
  // remote triggers); --allowedTools then narrows Bash to the validator.
  // Not --bare: that mode forces API-key billing instead of the user's subscription.
  return ["-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--strict-mcp-config",
    "--tools", "Read", "Write", "Edit", "Glob", "Grep", "Bash",
    "--permission-mode", "acceptEdits", "--allowedTools", ...CLAUDE_BUILDER_TOOLS, "--disallowedTools", ...CLAUDE_BUILDER_DENIED,
    ...(model ? ["--model", model] : [])];
}

export async function runClaudeWorker(options: {
  command: string; args: string[]; directory: string; env: NodeJS.ProcessEnv; input: string;
  signal: AbortSignal; progress: (message: string) => void; diagnostics: (value: WorkerDiagnostics) => Promise<void>;
  maxFrameBytes?: number; maxOutputBytes?: number;
}): Promise<{ resultText: string }> {
  const maxFrame = options.maxFrameBytes ?? 4_000_000, maxOutput = options.maxOutputBytes ?? 64_000_000;
  const d: WorkerDiagnostics = { stdoutBytes: 0, stderrBytes: 0, frames: 0, oversizedFrames: 0, largestFrameBytes: 0,
    lastEventType: null, completed: false, exitCode: null, exitSignal: null, failureCode: null };
  let pending = "", failure: CodingWorkerError | undefined, resultText = "";
  const frame = (line: string) => {
    if (!line.trim()) return;
    d.largestFrameBytes = Math.max(d.largestFrameBytes, Buffer.byteLength(line));
    if (Buffer.byteLength(line) > maxFrame) { d.oversizedFrames++; return; } // advisory tool output; never a result frame
    let event: any;
    try { event = JSON.parse(line); } catch { throw new CodingWorkerError("protocol_error", "invalid JSON frame"); }
    if (!event || typeof event.type !== "string") throw new CodingWorkerError("protocol_error", "frame has no event type");
    d.frames++; d.lastEventType = String(event.type).slice(0, 100);
    if (event.type === "assistant") {
      const tools = (event.message?.content ?? []).filter((part: any) => part?.type === "tool_use").map((part: any) => part.name);
      if (tools.length) options.progress(`Claude ${tools.join(", ")}`.slice(0, 200));
    }
    if (event.type === "result") {
      if (event.subtype !== "success" || event.is_error) throw new CodingWorkerError("turn_failed", String(event.subtype ?? "error"));
      d.completed = true; resultText = typeof event.result === "string" ? event.result.slice(0, 20000) : "";
    }
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(options.command, options.args, { cwd: options.directory, env: options.env,
        stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
      const kill = () => { try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* exited */ } };
      const cancel = () => { failure ??= new CodingWorkerError("cancelled", "host abort signal"); kill(); };
      options.signal.addEventListener("abort", cancel, { once: true });
      if (options.signal.aborted) cancel();
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (failure) return;
        try {
          d.stdoutBytes += Buffer.byteLength(chunk);
          if (d.stdoutBytes > maxOutput) throw new CodingWorkerError("output_budget", `stdout exceeded ${maxOutput} bytes`);
          pending += chunk;
          let newline: number;
          while ((newline = pending.indexOf("\n")) >= 0) { const line = pending.slice(0, newline); pending = pending.slice(newline + 1); frame(line); }
          if (Buffer.byteLength(pending) > maxFrame * 2) pending = "";
        } catch (error) { failure = error as CodingWorkerError; kill(); }
      });
      child.stderr.on("data", chunk => { d.stderrBytes += chunk.length; });
      child.once("error", () => { failure ??= new CodingWorkerError("spawn_failed", "could not start executable"); });
      child.once("close", (code, signal) => {
        options.signal.removeEventListener("abort", cancel);
        d.exitCode = code; d.exitSignal = signal;
        if (!failure) { try { frame(pending); pending = ""; } catch (error) { failure = error as CodingWorkerError; } }
        if (!failure && code !== 0) failure = new CodingWorkerError("process_failed", `exit ${code}, signal ${signal ?? "none"}`);
        if (!failure && !d.completed) failure = new CodingWorkerError("incomplete_turn", "no successful result frame");
        if (failure) reject(failure); else resolve();
      });
      child.stdin.on("error", () => {}); child.stdin.end(options.input);
    });
  } finally {
    d.failureCode = failure?.code ?? null;
    await options.diagnostics({ ...d });
  }
  return { resultText };
}
