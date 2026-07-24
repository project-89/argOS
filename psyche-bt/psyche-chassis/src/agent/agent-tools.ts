/**
 * Agent Tools — Tool definitions for the standalone Swarm-BT agent.
 *
 * These are the "hands" of the agent. The swarm decides WHICH tools to use
 * and in WHAT ORDER. The BT learns to compile tool sequences for known tasks.
 *
 * Tool categories:
 *   - Thinking: scratchpad for working memory
 *   - Computation: safe math evaluation
 *   - Filesystem: read/write/list files
 *   - Execution: run code snippets
 *   - Analysis: text analysis utilities
 */

import { registerTool } from "../tools/registry.js";
import type { ToolResult } from "../tools/registry.js";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { dirname } from "path";

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

export function registerAgentTools(): void {
  // ── Thinking ───────────────────────────────────────────────────────────────
  registerTool({
    name: "think",
    description: "Private scratchpad for reasoning. Use this to work through problems step-by-step before giving a final answer. Output is NOT shown to the user.",
    params: {
      thought: { type: "string", description: "Your reasoning, analysis, or working notes", required: true },
    },
    execute: async (params): Promise<ToolResult> => ({
      success: true,
      output: `[Thought recorded: ${(params.thought as string).length} chars]`,
      data: { thought: params.thought },
      durationMs: 0,
    }),
  });

  // ── Computation ────────────────────────────────────────────────────────────
  registerTool({
    name: "calculate",
    description: "Evaluate a mathematical expression safely. Supports basic arithmetic, Math functions, and simple JS expressions.",
    params: {
      expression: { type: "string", description: "Math expression to evaluate (e.g., '(15 * 3) + Math.sqrt(144)')", required: true },
    },
    execute: async (params): Promise<ToolResult> => {
      const expr = params.expression as string;
      // Whitelist: only allow numbers, operators, Math.*, parentheses, spaces
      const safe = /^[\d\s+\-*/().,%^]+$|^Math\.\w+\([\d\s+\-*/().,%^]*\)$/;
      // More permissive: allow chained Math calls and basic expressions
      const sanitized = expr.replace(/[^0-9+\-*/().,%\s^a-zA-Z_]/g, "");
      try {
        // Use Function constructor for safe-ish eval (no globals access)
        const fn = new Function("Math", `"use strict"; return (${sanitized})`);
        const result = fn(Math);
        return { success: true, output: String(result), data: { result }, durationMs: 0 };
      } catch (e: any) {
        return { success: false, output: "", error: `Calculation error: ${e.message}`, durationMs: 0 };
      }
    },
  });

  // ── Filesystem ─────────────────────────────────────────────────────────────
  registerTool({
    name: "read_file",
    description: "Read the contents of a file. Returns the text content.",
    params: {
      path: { type: "string", description: "Absolute or relative path to the file", required: true },
    },
    execute: async (params): Promise<ToolResult> => {
      try {
        const content = readFileSync(params.path as string, "utf-8");
        const truncated = content.length > 15000 ? content.slice(0, 15000) + "\n... [truncated]" : content;
        return { success: true, output: truncated, durationMs: 0 };
      } catch (e: any) {
        return { success: false, output: "", error: `File read error: ${e.message}`, durationMs: 0 };
      }
    },
  });

  registerTool({
    name: "write_file",
    description: "Write content to a file. Creates parent directories if needed.",
    params: {
      path: { type: "string", description: "Path to write to", required: true },
      content: { type: "string", description: "Content to write", required: true },
    },
    execute: async (params): Promise<ToolResult> => {
      try {
        const dir = dirname(params.path as string);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(params.path as string, params.content as string, "utf-8");
        return { success: true, output: `Written ${(params.content as string).length} bytes to ${params.path}`, durationMs: 0 };
      } catch (e: any) {
        return { success: false, output: "", error: `File write error: ${e.message}`, durationMs: 0 };
      }
    },
  });

  registerTool({
    name: "list_files",
    description: "List contents of a directory.",
    params: {
      path: { type: "string", description: "Directory path to list", required: true },
    },
    execute: async (params): Promise<ToolResult> => {
      try {
        const entries = readdirSync(params.path as string, { withFileTypes: true });
        const listing = entries.map(e => `${e.isDirectory() ? "[dir]" : "[file]"} ${e.name}`).join("\n");
        return { success: true, output: listing || "(empty directory)", durationMs: 0 };
      } catch (e: any) {
        return { success: false, output: "", error: `List error: ${e.message}`, durationMs: 0 };
      }
    },
  });

  // ── Code Execution ─────────────────────────────────────────────────────────
  registerTool({
    name: "run_code",
    description: "Execute a JavaScript code snippet and return the output. Writes to a temp file first (no escaping issues). Use console.log() to produce output.",
    params: {
      code: { type: "string", description: "JavaScript code to execute", required: true },
      filename: { type: "string", description: "Optional filename (default: _swarm_tmp.js)", required: false },
    },
    execute: async (params): Promise<ToolResult> => {
      const code = params.code as string;
      const filename = (params.filename as string) || "./_swarm_tmp.js";
      try {
        // Write code to file first — avoids all escaping issues
        const dir = dirname(filename);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(filename, code, "utf-8");

        const result = execSync(`node ${filename}`, {
          timeout: 15000,
          maxBuffer: 100 * 1024,
          encoding: "utf-8",
        });
        const output = result.length > 5000 ? result.slice(0, 5000) + "\n... [truncated]" : result;
        return { success: true, output: output || "(no output)", durationMs: 0 };
      } catch (e: any) {
        const stderr = e.stderr?.toString().slice(0, 2000) || e.message;
        return { success: false, output: e.stdout?.toString().slice(0, 2000) || "", error: stderr, durationMs: 0 };
      }
    },
  });

  // ── Search ─────────────────────────────────────────────────────────────────
  registerTool({
    name: "search_files",
    description: "Search for a text pattern across files using grep. Returns matching lines with file paths and line numbers.",
    params: {
      pattern: { type: "string", description: "Text pattern to search for", required: true },
      path: { type: "string", description: "Directory or file to search in (default: .)", required: false },
      include: { type: "string", description: "File glob to filter (e.g., '*.ts', '*.py')", required: false },
    },
    execute: async (params): Promise<ToolResult> => {
      const pattern = params.pattern as string;
      const searchPath = (params.path as string) || ".";
      const include = params.include ? `--include='${params.include}'` : "";
      try {
        const result = execSync(
          `grep -rnI ${include} ${JSON.stringify(pattern)} ${JSON.stringify(searchPath)} 2>/dev/null | head -50`,
          { timeout: 10000, maxBuffer: 100 * 1024, encoding: "utf-8" }
        );
        return { success: true, output: result || "(no matches)", durationMs: 0 };
      } catch (e: any) {
        if (e.status === 1) return { success: true, output: "(no matches)", durationMs: 0 };
        return { success: false, output: "", error: e.message, durationMs: 0 };
      }
    },
  });

  // ── Shell ──────────────────────────────────────────────────────────────────
  registerTool({
    name: "shell",
    description: "Execute a shell command and return stdout+stderr. Use for system operations, git, running tests, etc.",
    params: {
      command: { type: "string", description: "Shell command to execute", required: true },
      cwd: { type: "string", description: "Working directory (default: .)", required: false },
    },
    execute: async (params): Promise<ToolResult> => {
      try {
        const result = execSync(params.command as string, {
          timeout: 30000,
          maxBuffer: 200 * 1024,
          encoding: "utf-8",
          cwd: (params.cwd as string) || undefined,
        });
        const output = result.length > 5000 ? result.slice(0, 5000) + "\n... [truncated]" : result;
        return { success: true, output: output || "(no output)", durationMs: 0 };
      } catch (e: any) {
        return { success: false, output: e.stdout?.toString().slice(0, 2000) || "", error: e.stderr?.toString().slice(0, 2000) || e.message, durationMs: 0 };
      }
    },
  });
}

// =============================================================================
// TOOL PROMPT — formatted for injection into LLM prompts
// =============================================================================

export const AGENT_TOOL_PROMPT = `You have access to these tools. To use a tool, respond with a JSON block:
\`\`\`json
{"tool": "tool_name", "params": {"param1": "value1"}}
\`\`\`

Available tools:
- think(thought): Private scratchpad for step-by-step reasoning. Use freely.
- calculate(expression): Evaluate math expressions safely.
- read_file(path): Read a file's contents.
- write_file(path, content): Write content to a file.
- list_files(path): List directory contents.
- search_files(pattern, path?, include?): Search for text across files (grep).
- run_code(code, filename?): Write JS code to a file and execute it. Use console.log() for output.
- shell(command, cwd?): Run a shell command with output capture.

You can call multiple tools in sequence. After each tool call, you'll receive the result and can continue reasoning.
When you have your final answer, respond WITHOUT a tool call — just give the answer directly.`;
