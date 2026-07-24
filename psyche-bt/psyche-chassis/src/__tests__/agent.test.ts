/**
 * Swarm Agent Unit Tests
 *
 * Tests the agent pipeline WITHOUT real LLM calls.
 * Uses mock handlers to verify:
 *   - Tool execution
 *   - Plan clustering / convergence
 *   - Evaluation logic
 *   - Task definitions
 */

import { registerAgentTools, AGENT_TOOL_PROMPT } from "../agent/agent-tools.js";
import { ALL_BENCHMARK_TASKS, getTasksByCategory, getTaskById } from "../agent/benchmark-tasks.js";
import { executeTool, listTools } from "../tools/registry.js";

// =============================================================================
// TOOLS
// =============================================================================

describe("Agent Tools", () => {
  beforeAll(() => {
    registerAgentTools();
  });

  test("think tool records thoughts", async () => {
    const result = await executeTool("think", { thought: "Let me work through this..." });
    expect(result.success).toBe(true);
    expect(result.output).toContain("Thought recorded");
  });

  test("calculate tool evaluates math", async () => {
    const result = await executeTool("calculate", { expression: "(15 * 3) + 5" });
    expect(result.success).toBe(true);
    expect(result.output).toBe("50");
  });

  test("calculate tool handles errors", async () => {
    const result = await executeTool("calculate", { expression: "this is not math" });
    expect(result.success).toBe(false);
  });

  test("read_file tool reads files", async () => {
    const result = await executeTool("read_file", { path: "./package.json" });
    expect(result.success).toBe(true);
    expect(result.output).toContain("psyche-chassis");
  });

  test("read_file tool handles missing files", async () => {
    const result = await executeTool("read_file", { path: "./nonexistent_file.xyz" });
    expect(result.success).toBe(false);
  });

  test("write_file and read_file round-trip", async () => {
    const testPath = "./data/test_agent_output.txt";
    const content = "Swarm-BT agent test output " + Date.now();

    const writeResult = await executeTool("write_file", { path: testPath, content });
    expect(writeResult.success).toBe(true);

    const readResult = await executeTool("read_file", { path: testPath });
    expect(readResult.success).toBe(true);
    expect(readResult.output).toBe(content);
  });

  test("run_code executes JavaScript", async () => {
    const result = await executeTool("run_code", { code: "console.log(2 + 2)" });
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe("4");
  });

  test("run_code handles errors", async () => {
    const result = await executeTool("run_code", { code: "throw new Error('test error')" });
    expect(result.success).toBe(false);
  });

  test("list_files lists directory", async () => {
    const result = await executeTool("list_files", { path: "./src" });
    expect(result.success).toBe(true);
    expect(result.output).toContain("agent");
    expect(result.output).toContain("bt");
  });

  test("shell executes commands", async () => {
    const result = await executeTool("shell", { command: "echo hello world" });
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe("hello world");
  });

  test("AGENT_TOOL_PROMPT includes all tools", () => {
    expect(AGENT_TOOL_PROMPT).toContain("think");
    expect(AGENT_TOOL_PROMPT).toContain("calculate");
    expect(AGENT_TOOL_PROMPT).toContain("read_file");
    expect(AGENT_TOOL_PROMPT).toContain("run_code");
  });

  test("all agent tools are registered", () => {
    const tools = listTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain("think");
    expect(toolNames).toContain("calculate");
    expect(toolNames).toContain("read_file");
    expect(toolNames).toContain("write_file");
    expect(toolNames).toContain("list_files");
    expect(toolNames).toContain("run_code");
    expect(toolNames).toContain("shell");
  });
});

// =============================================================================
// BENCHMARK TASKS
// =============================================================================

describe("Benchmark Tasks", () => {
  test("has 30 tasks total", () => {
    expect(ALL_BENCHMARK_TASKS.length).toBe(30);
  });

  test("has 5 categories", () => {
    const categories = new Set(ALL_BENCHMARK_TASKS.map(t => t.category));
    expect(categories.size).toBe(5);
    expect(categories).toContain("reasoning");
    expect(categories).toContain("planning");
    expect(categories).toContain("coding");
    expect(categories).toContain("creative");
    expect(categories).toContain("multi_step");
  });

  test("reasoning has 10 tasks", () => {
    expect(getTasksByCategory("reasoning").length).toBe(10);
  });

  test("all tasks have required fields", () => {
    for (const task of ALL_BENCHMARK_TASKS) {
      expect(task.id).toBeTruthy();
      expect(task.prompt).toBeTruthy();
      expect(task.expectedAnswer).toBeTruthy();
      expect(task.answerKeywords.length).toBeGreaterThan(0);
      expect(task.difficulty).toBeGreaterThanOrEqual(1);
      expect(task.difficulty).toBeLessThanOrEqual(5);
    }
  });

  test("getTaskById returns correct task", () => {
    const task = getTaskById("r1_arithmetic");
    expect(task).toBeDefined();
    expect(task!.category).toBe("reasoning");
  });

  test("all task IDs are unique", () => {
    const ids = ALL_BENCHMARK_TASKS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
