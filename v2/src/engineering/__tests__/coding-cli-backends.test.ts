import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { cliChildPath, resolveCodingCli } from "../cli-resolve";
import { claudeBuilderArgs, runClaudeWorker, CLAUDE_BUILDER_TOOLS } from "../claude-transport";

function script(path: string, body: string) { writeFileSync(path, `#!/bin/sh\n${body}\n`); chmodSync(path, 0o755); return path; }

describe("coding CLI resolution", () => {
  test("finds a CLI installed under another nvm Node when it is not on PATH", () => {
    const home = mkdtempSync(join(tmpdir(), "argos-home-"));
    const old = join(home, ".nvm", "versions", "node", "v23.3.0", "bin"); mkdirSync(old, { recursive: true });
    const codex = script(join(old, "codex"), "echo codex");
    expect(resolveCodingCli("codex", { home, path: "/nonexistent" })).toBe(codex);
    expect(cliChildPath(codex, "/usr/bin").split(delimiter)[0]).toBe(old); // runs under its own Node
  });
  test("PATH wins over version-manager copies; an explicit absolute path is authoritative", () => {
    const home = mkdtempSync(join(tmpdir(), "argos-home-")), bin = mkdtempSync(join(tmpdir(), "argos-bin-"));
    const onPath = script(join(bin, "claude"), "echo claude");
    const nvm = join(home, ".nvm", "versions", "node", "v26.0.0", "bin"); mkdirSync(nvm, { recursive: true }); script(join(nvm, "claude"), "echo old");
    expect(resolveCodingCli("claude", { home, path: bin })).toBe(onPath);
    expect(resolveCodingCli("claude", { home, path: bin, explicit: join(bin, "missing") })).toBeUndefined();
  });
});

describe("Claude Code builder transport", () => {
  const run = (body: string, signal = new AbortController().signal) => {
    const dir = mkdtempSync(join(tmpdir(), "argos-claude-")), progress: string[] = [], diagnostics: any[] = [];
    const command = script(join(dir, "fake-claude"), body);
    return { progress, diagnostics, promise: runClaudeWorker({ command, args: claudeBuilderArgs("sonnet"), directory: dir, env: { PATH: process.env.PATH }, input: "build",
      signal, progress: m => progress.push(m), diagnostics: async d => { diagnostics.push(d); } }) };
  };
  test("succeeds only on a successful result frame and reports tool progress", async () => {
    const r = run(`cat >/dev/null
echo '{"type":"system","subtype":"init"}'
echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write"}]}}'
echo '{"type":"result","subtype":"success","is_error":false,"result":"Built and validated."}'`);
    await expect(r.promise).resolves.toEqual({ resultText: "Built and validated." });
    expect(r.progress).toContain("Claude Write");
    expect(r.diagnostics[0]).toMatchObject({ completed: true, failureCode: null });
  });
  test.each([
    ["an error result", `cat >/dev/null; echo '{"type":"result","subtype":"error_max_turns","is_error":true}'`, "turn_failed"],
    ["no result at all", `cat >/dev/null; echo '{"type":"system"}'`, "incomplete_turn"],
    ["a crash", `cat >/dev/null; exit 3`, "process_failed"],
    ["garbage output", `cat >/dev/null; echo 'not json'`, "protocol_error"],
  ])("fails closed on %s", async (_label, body, code) => {
    await expect(run(body).promise).rejects.toMatchObject({ code });
  });
  test("cancellation kills the worker", async () => {
    const controller = new AbortController(), r = run(`cat >/dev/null; sleep 30`, controller.signal);
    setTimeout(() => controller.abort(), 100);
    await expect(r.promise).rejects.toMatchObject({ code: "cancelled" });
  });
  test("builder args keep the worker offline and inside its workspace", () => {
    const args = claudeBuilderArgs("sonnet");
    expect(args).toEqual(expect.arrayContaining(["-p", "--output-format", "stream-json", "--strict-mcp-config", "--model", "sonnet"]));
    expect(args.slice(args.indexOf("--tools") + 1, args.indexOf("--permission-mode"))).toEqual(["Read", "Write", "Edit", "Glob", "Grep", "Bash"]);
    expect(args).not.toContain("--bare");
    expect(CLAUDE_BUILDER_TOOLS).toEqual(["Read", "Write", "Edit", "Glob", "Grep", "Bash(node validate.mjs)"]);
    expect(args.slice(args.indexOf("--disallowedTools"))).toEqual(expect.arrayContaining(["WebFetch", "WebSearch"]));
  });
});
