import type { World } from "../ecs/world";

export type OfficeToolMode = "scripted" | "shell";

export interface OfficeToolContext {
  world: World;
  actorEid: number;
  deviceEid: number;
}

export interface OfficeToolResult {
  ok: boolean;
  summary: string;
  stdout?: string;
  stderr?: string;
  artifacts?: Array<{ kind: string; uri: string }>;
  exitCode?: number;
  /** When true, the tool has been started asynchronously and will emit a later tool_result on completion. */
  pending?: boolean;
  /** ID of the async job (when pending). */
  jobId?: string;
}

export type OfficeToolHandler = (params: any, ctx: OfficeToolContext) => OfficeToolResult;

const handlers = new Map<string, OfficeToolHandler>();
let mode: OfficeToolMode = "scripted";

export function setOfficeToolMode(next: OfficeToolMode): void {
  mode = next;
}

export function getOfficeToolMode(): OfficeToolMode {
  return mode;
}

export function registerOfficeTool(toolId: string, handler: OfficeToolHandler): void {
  handlers.set(toolId, handler);
}

export function unregisterOfficeTool(toolId: string): void {
  handlers.delete(toolId);
}

export function runOfficeTool(toolId: string, params: any, ctx: OfficeToolContext): OfficeToolResult {
  const handler = handlers.get(toolId);
  if (!handler) {
    return { ok: false, summary: `Unknown tool: ${toolId}`, stderr: `No handler registered for ${toolId}` };
  }

  try {
    return handler(params, ctx);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, summary: `Tool error: ${toolId}`, stderr: msg };
  }
}
