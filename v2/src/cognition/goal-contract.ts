import type { World } from "../ecs/world";
import { hasComponent } from "bitecs";
import { Goal } from "../ecs/components";

export type GoalKind = "move_to_room" | "use_affordance" | "acquire_trait" | "scheduled_activity" | "custom";

export type GoalSuccessV1 =
  | { type: "all_of"; conditions: GoalSuccessV1[] }
  | { type: "any_of"; conditions: GoalSuccessV1[] }
  | { type: "in_room"; roomName: string }
  | { type: "productive_time"; roomName: string; atLeastMs: number }
  | { type: "did_action_type"; actionType: "speak" | "observe" | "wait" | "move" | "interact"; targetName?: string }
  | { type: "did_interact"; targetName: string; affordance: string }
  | { type: "did_interact_affordance"; affordance: string }
  | { type: "need_at_most"; need: "hunger" | "energy" | "social" | "comfort"; atMost: number }
  | { type: "need_at_least"; need: "hunger" | "energy" | "social" | "comfort"; atLeast: number }
  | { type: "has_trait"; trait: string }
  | { type: "in_inventory"; itemName: string }
  | { type: "entity_in_room"; entityName: string; roomName: string; uncarried?: boolean }
  | { type: "entity_component_equals"; entityName: string; component: string; field: string; equals: string | number | boolean }
  | { type: "kanban_card_in_column"; boardName?: string; cardTitle: string; columnName: string }
  | { type: "doc_contains"; title: string; includes: string }
  | { type: "repo_file_contains"; path: string; includes: string }
  | { type: "tool_exit_code_equals"; toolId: string; commandIncludes?: string; equals: number }
  | { type: "tool_stdout_includes"; toolId: string; commandIncludes?: string; includes: string }
  | { type: "custom"; description: string };

export type GoalContractV1 = {
  version: 1;
  kind: GoalKind;
  params: Record<string, unknown>;
  success: GoalSuccessV1;
  /** Optional human-readable description (kept out of the signature). */
  description?: string;
};

/** Interpret the legacy schedule writer's room-plus-interaction proof without
 * rewriting saved history or accepting that interaction as productive work. */
export function readGoalSuccessContract(goalEid: number): GoalSuccessV1 | null {
  try {
    const proof = JSON.parse(Goal.successJson[goalEid] || "null");
    if (!proof || typeof proof !== "object") return null;
    const params = JSON.parse(Goal.paramsJson[goalEid] || "{}");
    if (Goal.kind[goalEid] === "scheduled_activity" && params?.activityType === "work_block"
      && proof.type === "all_of" && Array.isArray(proof.conditions) && proof.conditions.length === 2
      && proof.conditions.some((c: any) => c?.type === "in_room" && c.roomName === params.roomName)
      && proof.conditions.some((c: any) => c?.type === "did_action_type" && c.actionType === "interact" && !c.targetName)) {
      if (typeof params.roomName !== "string" || !params.roomName.trim()) return null;
      return { type: "productive_time", roomName: params.roomName,
        atLeastMs: Number.isFinite(params.durationHours) && params.durationHours > 0
          ? Math.min(24, params.durationHours) * 3600_000 : 3600_000 };
    }
    return proof;
  } catch { return null; }
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableNormalize(value: any): any {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value).sort()) {
      const v = stableNormalize(value[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  // Drop non-JSONable types (functions/symbols).
  return String(value);
}

export function stableJsonStringify(value: any): string {
  return JSON.stringify(stableNormalize(value));
}

export function computeGoalSignature(contract: GoalContractV1): string {
  const canonical = stableJsonStringify({
    version: contract.version,
    kind: contract.kind,
    params: contract.params,
    success: contract.success,
  });
  const hash = fnv1a32(canonical);
  return `goalv1:${contract.kind}|${hash}`;
}

export function goalSignatureId(goalSignature: string): string {
  return fnv1a32(String(goalSignature || ""));
}

export function setGoalContract(world: World, goalEid: number, contract: GoalContractV1): string {
  if (!hasComponent(world as any, goalEid, Goal as any)) {
    throw new Error("setGoalContract: goalEid missing Goal component");
  }

  const desc = String(contract.description || Goal.description[goalEid] || "").trim();
  if (desc) Goal.description[goalEid] = desc;

  Goal.kind[goalEid] = contract.kind;
  Goal.paramsJson[goalEid] = stableJsonStringify(contract.params || {});
  Goal.successJson[goalEid] = stableJsonStringify(contract.success || { type: "custom", description: "unknown" });
  const sig = computeGoalSignature(contract);
  Goal.signature[goalEid] = sig;
  return sig;
}

export function ensureGoalSignature(world: World, goalEid: number): string | null {
  if (!hasComponent(world as any, goalEid, Goal as any)) return null;
  const existing = String(Goal.signature[goalEid] || "").trim();

  const kind = String(Goal.kind[goalEid] || "").trim();
  const paramsJson = String(Goal.paramsJson[goalEid] || "").trim();
  const successJson = String(Goal.successJson[goalEid] || "").trim();
  if (!kind) return existing || null;

  // Recompute from the authoritative fields, even when a signature is cached.
  // World edits can change a contract in place; the previous macro must then stop matching.
  let params: Record<string, unknown> = {};
  let success: GoalSuccessV1 = { type: "custom", description: "unknown" };
  try {
    if (paramsJson) {
      const parsed = JSON.parse(paramsJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) params = parsed;
    }
  } catch { return null; }
  try {
    if (successJson) {
      const parsed = JSON.parse(successJson);
      if (parsed && typeof parsed === "object") success = parsed as any;
    }
  } catch { return null; }

  const sig = computeGoalSignature({ version: 1, kind: kind as GoalKind, params, success, description: Goal.description[goalEid] });
  Goal.signature[goalEid] = sig;
  return sig;
}
