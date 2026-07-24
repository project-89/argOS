/**
 * Tool Registry — Tools that the agent can use, integrated with the BT.
 *
 * Tools are actions the agent can take beyond conversation:
 * file I/O, web search, shell execution, API calls.
 *
 * The BT learns WHEN to use each tool. The first time the big model
 * decides "search the web for X", the pattern compiles into the BT.
 * Next time, Flash Lite triggers the tool directly — no reasoning needed.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface Tool {
  name: string;
  description: string;
  /** Parameter schema — what the tool expects */
  params: Record<string, { type: string; description: string; required?: boolean }>;
  /** Execute the tool and return the result */
  execute: (params: Record<string, any>) => Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  data?: any;
  error?: string;
  durationMs: number;
}

// =============================================================================
// REGISTRY
// =============================================================================

const tools = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
  tools.set(tool.name, tool);
}

export function getTool(name: string): Tool | undefined {
  return tools.get(name);
}

export function listTools(): Tool[] {
  return Array.from(tools.values());
}

export function formatToolsForLLM(): string {
  const toolList = listTools();
  if (toolList.length === 0) return "No tools available.";

  return toolList.map(t => {
    const params = Object.entries(t.params)
      .map(([name, p]) => `${name} (${p.type}${p.required ? ", required" : ""}): ${p.description}`)
      .join(", ");
    return `- ${t.name}: ${t.description}. Params: ${params || "none"}`;
  }).join("\n");
}

/**
 * Execute a tool by name with given params.
 * Returns the result including timing.
 */
export async function executeTool(name: string, params: Record<string, any>): Promise<ToolResult> {
  const tool = tools.get(name);
  if (!tool) {
    return { success: false, output: "", error: `Unknown tool: ${name}`, durationMs: 0 };
  }

  const start = Date.now();
  try {
    const result = await tool.execute(params);
    result.durationMs = Date.now() - start;
    return result;
  } catch (err) {
    return {
      success: false,
      output: "",
      error: (err as Error).message,
      durationMs: Date.now() - start,
    };
  }
}
