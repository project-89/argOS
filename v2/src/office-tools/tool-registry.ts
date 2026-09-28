import type { World } from "../ecs/world";

export type OfficeToolMode = "scripted" | "shell";
/** Host authorization, separate from an NPC's fictional device traits. */
export type HostOfficeToolsPolicy = boolean | readonly string[];

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
// Deliberately not ECS/world metadata: generated components and loaded snapshots
// cannot grant host authority. A new world must be explicitly authorized again.
const worldPolicies = new WeakMap<World, true | ReadonlySet<string>>();

export function setWorldOfficeToolPolicy(world: World, policy: HostOfficeToolsPolicy): void {
  if (policy === false) { worldPolicies.delete(world); return; }
  if (policy === true) { worldPolicies.set(world, true); return; }
  if (!Array.isArray(policy) || policy.length > 128
    || policy.some(id => typeof id !== "string" || !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(id)))
    throw new TypeError("hostOfficeTools must be false, true, or a bounded exact tool-ID allowlist");
  worldPolicies.set(world, new Set(policy));
}

export function isWorldOfficeToolAllowed(world: World, toolId: string): boolean {
  const policy = worldPolicies.get(world);
  return policy === true || !!policy?.has(toolId);
}

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
  // Gate before handler lookup/invocation: even read/list tools can create real
  // workspace directories, and "scripted" mode does not disable those tools.
  if (!isWorldOfficeToolAllowed(ctx.world, toolId)) {
    return { ok: false, summary: `Host office tool denied for this world: ${toolId}`,
      stderr: "Fictional devices do not authorize host access. The host must explicitly enable this tool for this world.", exitCode: 126 };
  }
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
