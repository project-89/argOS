/**
 * Smoke Test: Gemini CLI generates a git diff; engine applies it via grounded tools.
 *
 * This is a controlled “multi-step” loop where:
 * - Gemini (non-interactive) produces a patch artifact (single-shot)
 * - The engine applies the patch deterministically (workspace.git_apply)
 * - The engine verifies the outcome by reading the file (workspace.read_file)
 *
 * Requirements:
 * - `gemini` CLI installed (it is on this machine)
 * - `.env` has `GOOGLE_GENERATIVE_AI_API_KEY` (gemini-cli needs GEMINI_API_KEY; tool bridges it)
 * - `OFFICE_TOOLS_ALLOW_GEMINI_CLI=1`
 * - `OFFICE_TOOLS_ALLOW_GIT_APPLY=1`
 *
 * Run:
 *   OFFICE_TOOLS_ALLOW_GEMINI_CLI=1 OFFICE_TOOLS_ALLOW_GIT_APPLY=1 npx tsx src/behavioral-tests/40-gemini-codegen-patch-loop-smoke.ts
 */
import "dotenv/config";

import * as fs from "node:fs";
import * as path from "node:path";

import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { worldSchema, ObjectManager } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { setOfficeToolMode } from "../office-tools/tool-registry";
import { createOfficeToolJobSystem } from "../systems/office-tool-job-system";
import { yieldForOfficeToolJobs } from "./helpers/office-async";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

function extractGeminiCliResponseJson(toolStdout: string): any {
  // Our gemini.cli wrapper returns a small JSON object with `response` as a string.
  const cleaned = toolStdout.replace(/\n…\(truncated\)\s*$/m, "").trim();
  const outer = JSON.parse(cleaned);
  const raw =
    typeof outer?.response === "string" && outer.response.trim()
      ? String(outer.response).trim()
      : typeof outer?.responseFile === "string" && outer.responseFile.trim()
        ? fs.readFileSync(path.resolve(process.cwd(), String(outer.responseFile)), "utf8").trim()
        : "";
  // Be tolerant of leading/trailing whitespace or accidental code fences.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) throw new Error("gemini.cli response did not contain a JSON object");
  const candidate = raw.slice(start, end + 1);
  return JSON.parse(candidate);
}

function extractStdoutSection(toolResultContent: string): string {
  const m = toolResultContent.match(/stdout:\n([\s\S]*?)(?:\n\nstderr:|\s*$)/);
  return m ? m[1] : "";
}

async function main() {
  if (process.env.OFFICE_TOOLS_ALLOW_GEMINI_CLI !== "1") throw new Error("Set OFFICE_TOOLS_ALLOW_GEMINI_CLI=1");
  if (process.env.OFFICE_TOOLS_ALLOW_GIT_APPLY !== "1") throw new Error("Set OFFICE_TOOLS_ALLOW_GIT_APPLY=1");

  setOfficeToolMode("shell");
  registerBuiltinOfficeTools();

  const world = createArgosWorld("GeminiCodegenPatchLoopSmoke") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  const officeJobs = createOfficeToolJobSystem();
  officeJobs.frequency = 0;
  registerSystem(registry as any, officeJobs as any);

  const room = createRoomEntity(world as any, { name: "Office" });
  registerEntity(room, "Office");

  // A workstation with 3 affordances: ask gemini, apply patch, read file.
  worldSchema.defineObjectType({
    name: "workstation_40",
    description: "A workstation computer",
    traits: ["computer", "examinable"],
    // Include "usable"+"typeable" so built-in computer affordances (write_file/read_file) are available.
    states: { idle: { description: "A workstation computer is on.", traits: ["computer", "usable", "typeable"] } },
    defaultState: "idle",
    category: "device",
  });
  worldSchema.defineAffordance({
    name: "ask_gemini",
    requires: ["computer"],
    effects: [{ type: "run_tool", toolId: "gemini.cli", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });
  worldSchema.defineAffordance({
    name: "apply_git_patch",
    requires: ["computer"],
    effects: [{ type: "run_tool", toolId: "workspace.git_apply", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });
  worldSchema.defineAffordance({
    name: "read_workspace_file",
    requires: ["computer"],
    effects: [{ type: "run_tool", toolId: "workspace.read_file", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });

  const computer = objectManager.spawn("workstation_40", { name: "Workstation", containedIn: room })!;
  registerEntity(computer, "Workstation");

  const agent = createAgentEntity(world as any, { name: "Orin", role: "Spirit", systemPrompt: "x", roomId: room });
  registerEntity(agent, "Orin");

  // Create a temp file for patching INSIDE the workstation sandbox (office tools are sandboxed per device).
  const relPath = `gemini_codegen_${Date.now()}.txt`;
  executeActions(
    world as any,
    [
      {
        eid: agent,
        action: { type: "interact", target: "Workstation", content: `write_file ${JSON.stringify({ path: relPath, content: "before\n" })}` } as any,
      },
    ],
    registry as any
  );
  drainPendingStimuli();

  const prompt = [
    "Return ONLY a JSON object with keys:",
    "- patchLines: string[] (each entry is one line of a git unified diff; no embedded newlines in strings)",
    "- note: string",
    "",
    `The file currently contains exactly: "before\\n"`,
    `The patch MUST change the file ${relPath} so its entire content becomes exactly:`,
    "after",
    "(with a trailing newline).",
    "",
    "The patch MUST be git-apply compatible and include these headers:",
    `- diff --git a/${relPath} b/${relPath}`,
    `- --- a/${relPath}`,
    `- +++ b/${relPath}`,
  ].join("\n");

  executeActions(
    world as any,
    [
      {
        eid: agent,
        action: {
          type: "interact",
          target: "Workstation",
          content: `ask_gemini ${JSON.stringify({ prompt, outputFormat: "json", sandbox: true, approvalMode: "default", timeoutMs: 120000 })}`,
        } as any,
      },
    ],
    registry as any
  );

  let ask: any | undefined;
  const askStart = Date.now();
  for (let tick = 0; tick < 5000; tick++) {
    if (Date.now() - askStart > 180_000) break;
    runSystems(world as any, registry as any, tick, 16);
    const askStimuli = drainPendingStimuli();
    // Wait for the completed tool_result (not just the immediate "queued" placeholder).
    ask = askStimuli.find((s) => s.type === "tool_result" && s.content.includes("[Tool:gemini.cli]") && s.content.includes("stdout:\n"));
    if (ask) break;
    await yieldForOfficeToolJobs(world as any, 75);
    // Even if the pending marker is missing, yield a little to let subprocess IO flow.
    await new Promise<void>((r) => setTimeout(r, 10));
  }
  assert(ask, "Expected tool_result from gemini.cli");

  const stdoutMatch = ask!.content.match(/stdout:\n([\s\S]*?)(?:\n\nstderr:|\s*$)/);
  assert(stdoutMatch, "Expected gemini.cli stdout in tool_result");
  const inner = extractGeminiCliResponseJson(stdoutMatch![1]);
  let lines: string[] = [];
  if (Array.isArray(inner?.patchLines)) {
    lines = inner.patchLines.map((s: any) => String(s));
  } else if (typeof inner?.patch === "string") {
    lines = String(inner.patch).split(/\r?\n/);
  } else if (typeof inner?.diff === "string") {
    lines = String(inner.diff).split(/\r?\n/);
  }

  if (lines.length <= 3) {
    console.error("Gemini response JSON (unexpected shape):", JSON.stringify(inner).slice(0, 1200));
  }
  assert(lines.length >= 4, "Expected patchLines (or patch/diff) to be a non-trivial diff");

  let patch = lines.join("\n").trimEnd() + "\n";
  // If Gemini gave us a generic unified diff (---/+++ without diff --git),
  // normalize it to a git-style patch so `git apply` accepts it reliably.
  if (!patch.startsWith("diff --git ") && patch.startsWith("--- ")) {
    const normalized = [
      `diff --git a/${relPath} b/${relPath}`,
      `--- a/${relPath}`,
      `+++ b/${relPath}`,
      ...lines.filter((l) => !l.startsWith("--- ") && !l.startsWith("+++ ")),
    ].join("\n").trimEnd() + "\n";
    patch = normalized;
  }

  executeActions(
    world as any,
    [
      {
        eid: agent,
        action: {
          type: "interact",
          target: "Workstation",
          content: `apply_git_patch ${JSON.stringify({ patch })}`,
        } as any,
      },
    ],
    registry as any
  );

  const applyStimuli = drainPendingStimuli();
  const applied = applyStimuli.find((s) => s.type === "tool_result" && s.content.includes("[Tool:workspace.git_apply]"));
  assert(applied, "Expected tool_result from workspace.git_apply");
  if (!applied!.content.includes("workspace.git_apply (0)")) {
    console.error(applied!.content.slice(0, 1000));
    console.error("Patch head:\n" + patch.split("\n").slice(0, 30).join("\n"));
    throw new Error("Expected workspace.git_apply exitCode 0");
  }

  executeActions(
    world as any,
    [
      {
        eid: agent,
        action: {
          type: "interact",
          target: "Workstation",
          content: `read_workspace_file ${JSON.stringify({ path: relPath })}`,
        } as any,
      },
    ],
    registry as any
  );
  const readStimuli = drainPendingStimuli();
  const read = readStimuli.find((s) => s.type === "tool_result" && s.content.includes("[Tool:workspace.read_file]"));
  assert(read, "Expected tool_result from workspace.read_file");
  const fileStdout = extractStdoutSection(read!.content);
  const normalized = fileStdout.replace(/\r\n/g, "\n");
  if (!(normalized === "after\n" || normalized.trimEnd() === "after")) {
    console.error("workspace.read_file stdout:", JSON.stringify(normalized).slice(0, 500));
    console.error("workspace.git_apply tool_result:", applied!.content.slice(0, 1200));
    throw new Error("Expected file content to be 'after'");
  }

  console.log("✓ Gemini codegen patch loop smoke test passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
