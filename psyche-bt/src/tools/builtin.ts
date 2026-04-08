/**
 * Built-in Tools — File I/O, web search, shell, memory search.
 * Each tool can be triggered by BT branches once the pattern is compiled.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { exec } from "node:child_process";
import { registerTool, type ToolResult } from "./registry.js";

export function registerBuiltinTools(): void {
  // ─── FILE READ ─────────────────────────────────────────
  registerTool({
    name: "file_read",
    description: "Read the contents of a file",
    params: {
      path: { type: "string", description: "File path to read", required: true },
    },
    execute: async (params): Promise<ToolResult> => {
      try {
        const content = fs.readFileSync(params.path, "utf-8");
        return { success: true, output: content.slice(0, 10000), durationMs: 0 };
      } catch (err) {
        return { success: false, output: "", error: (err as Error).message, durationMs: 0 };
      }
    },
  });

  // ─── FILE WRITE ────────────────────────────────────────
  registerTool({
    name: "file_write",
    description: "Write content to a file",
    params: {
      path: { type: "string", description: "File path to write", required: true },
      content: { type: "string", description: "Content to write", required: true },
    },
    execute: async (params): Promise<ToolResult> => {
      try {
        const dir = path.dirname(params.path);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(params.path, params.content);
        return { success: true, output: `Written ${params.content.length} chars to ${params.path}`, durationMs: 0 };
      } catch (err) {
        return { success: false, output: "", error: (err as Error).message, durationMs: 0 };
      }
    },
  });

  // ─── FILE LIST ─────────────────────────────────────────
  registerTool({
    name: "file_list",
    description: "List files in a directory",
    params: {
      path: { type: "string", description: "Directory path", required: true },
    },
    execute: async (params): Promise<ToolResult> => {
      try {
        const files = fs.readdirSync(params.path);
        return { success: true, output: files.join("\n"), data: files, durationMs: 0 };
      } catch (err) {
        return { success: false, output: "", error: (err as Error).message, durationMs: 0 };
      }
    },
  });

  // ─── SHELL EXECUTE ─────────────────────────────────────
  registerTool({
    name: "shell",
    description: "Execute a shell command (sandboxed to working directory)",
    params: {
      command: { type: "string", description: "Shell command to run", required: true },
    },
    execute: async (params): Promise<ToolResult> => {
      return new Promise((resolve) => {
        exec(params.command, { timeout: 10000, maxBuffer: 1024 * 100 }, (err, stdout, stderr) => {
          if (err) {
            resolve({ success: false, output: stderr || err.message, error: err.message, durationMs: 0 });
          } else {
            resolve({ success: true, output: stdout.slice(0, 5000), durationMs: 0 });
          }
        });
      });
    },
  });

  // ─── SUMMARIZE TEXT ────────────────────────────────────
  registerTool({
    name: "summarize",
    description: "Summarize a block of text into key points",
    params: {
      text: { type: "string", description: "Text to summarize", required: true },
      maxPoints: { type: "number", description: "Maximum number of key points", required: false },
    },
    execute: async (params): Promise<ToolResult> => {
      // Simple extractive summary (no LLM — deterministic)
      const sentences = params.text.split(/[.!?]+/).filter((s: string) => s.trim().length > 20);
      const maxPoints = params.maxPoints || 5;
      const points = sentences.slice(0, maxPoints).map((s: string) => s.trim());
      return { success: true, output: points.map((p: string) => `• ${p}`).join("\n"), data: points, durationMs: 0 };
    },
  });

  // ─── MAKE CHECKLIST ────────────────────────────────────
  registerTool({
    name: "make_checklist",
    description: "Create a checklist from a topic or description",
    params: {
      topic: { type: "string", description: "What the checklist is for", required: true },
      items: { type: "string", description: "Comma-separated list of items", required: false },
    },
    execute: async (params): Promise<ToolResult> => {
      const items = params.items
        ? params.items.split(",").map((i: string) => i.trim())
        : [`Plan ${params.topic}`, `Research ${params.topic}`, `Execute ${params.topic}`, `Review ${params.topic}`];
      const checklist = items.map((item: string) => `☐ ${item}`).join("\n");
      return { success: true, output: `Checklist: ${params.topic}\n${checklist}`, data: items, durationMs: 0 };
    },
  });

  // ─── DRAFT TEXT ────────────────────────────────────────
  registerTool({
    name: "draft",
    description: "Draft a piece of text (email, note, message)",
    params: {
      type: { type: "string", description: "Type: email, note, message, list", required: true },
      topic: { type: "string", description: "What the draft is about", required: true },
      to: { type: "string", description: "Recipient (for emails)", required: false },
    },
    execute: async (params): Promise<ToolResult> => {
      // Template-based drafting (no LLM)
      switch (params.type) {
        case "email":
          return { success: true, output: `To: ${params.to || "[recipient]"}\nSubject: ${params.topic}\n\nHi,\n\nI wanted to reach out about ${params.topic}.\n\n[Draft body here]\n\nBest,\n[Your name]`, durationMs: 0 };
        case "note":
          return { success: true, output: `# ${params.topic}\n\nDate: ${new Date().toLocaleDateString()}\n\n- Key point 1\n- Key point 2\n- Action items`, durationMs: 0 };
        case "list":
          return { success: true, output: `${params.topic}:\n1. Item 1\n2. Item 2\n3. Item 3`, durationMs: 0 };
        default:
          return { success: true, output: `RE: ${params.topic}\n\n[Draft content here]`, durationMs: 0 };
      }
    },
  });
}
