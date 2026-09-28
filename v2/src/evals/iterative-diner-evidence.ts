/** Read-only diagnostic checks. These do not decide what spirits/NPCs do. */
import type { AutopilotRunResult, GodAutopilotMessage } from "../god/god-autopilot";
import type { FastRuntimeHealthSnapshot } from "../runtime/fast-system-health";
import type { SystemHealthReport } from "../ecs/dynamic-systems";

export type DinerIdentity = { key: string; name: string; kind: "room" | "object" | "agent"; roomKey?: string; removed: boolean };
export type DinerReview = { before: GodAutopilotMessage[]; result: AutopilotRunResult };

/** A successful unrelated proposal approval is NOT an outcome review. With no
 * proposals and every input included, the native successful batch guard proves
 * that this specific receipt remained current throughout the review. */
export function dinerReviewIncludesMeal(review: DinerReview, eventId: string): boolean {
  return review.result.executed && review.result.messagesIncluded === review.before.length
    && review.before.length > 0 && !review.before.some(m => typeof m.data?.proposal?.id === "string")
    && review.before.some(m => m.data?.recentEvents?.some((e: any) => e.id === eventId
      && e.action === "interact" && e.status === "succeeded"));
}

const normalized = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/** Eval construction ceiling, checked before allocation. A rejected proposal
 * remains failed evidence, never rewritten into the shape needed by the test. */
export function assertDinerRepairFits(spec: { type?: unknown; roomEid?: unknown }, roomEid: number, additions: number): void {
  if (!Number.isSafeInteger(additions) || additions < 0 || additions >= 3) throw Error("Diner addition budget exhausted");
  if (!["object", "agent", "stimulus_source"].includes(String(spec.type)) || spec.roomEid !== roomEid)
    throw Error("Diner repair proposed a replacement destination instead of an addition to the existing room");
}

export function dinerRuntimeHealthy(fast: FastRuntimeHealthSnapshot | undefined, systems: SystemHealthReport[]): boolean {
  return !!fast && fast.sourceCurrent && fast.lifecycle === "running" && fast.status === "passing"
    && fast.totalFailures === 0 && fast.omittedSystems === 0 && systems.length > 0
    && systems.every(s => s.totalErrors === 0 && !s.disabledReason);
}
/** Construction history includes consumed identities, unlike today's inventory.
 * Exact names are a negative control, not proof against semantic duplication. */
export function dinerContinuityFailures(initial: DinerIdentity[], current: DinerIdentity[], additions: DinerIdentity[]): string[] {
  const failures: string[] = [];
  const room = initial.find(e => e.kind === "room");
  if (!room || initial.filter(e => e.kind === "room").length !== 1) return ["invalid_initial_room"];
  if (current.filter(e => e.kind === "room").length !== 1 || !current.some(e => e.kind === "room" && e.key === room.key && !e.removed))
    failures.push("room_replaced_or_duplicated");
  for (const original of initial.filter(e => e.kind !== "agent")) {
    const now = current.find(e => e.key === original.key);
    if (!now || now.name !== original.name || now.removed !== original.removed || now.roomKey !== original.roomKey)
      failures.push(`initial_identity_changed:${original.name}`);
  }
  const names = new Set(initial.map(e => normalized(e.name))), keys = new Set(initial.map(e => e.key));
  for (const addition of additions) {
    if (names.has(normalized(addition.name)) || keys.has(addition.key)) failures.push(`repeated_construction:${addition.name}`);
    if (addition.kind === "room" || addition.roomKey !== room.key) failures.push(`addition_outside_original_room:${addition.name}`);
    names.add(normalized(addition.name)); keys.add(addition.key);
  }
  return failures;
}
