/** Reconcile an execution that raced an asynchronous plan proposal. This is
 * evidence of a prior own action, never a fictional execution or goal verdict. */
import { entityExists, hasComponent } from "bitecs";
import { Agent, WorkingMemoryIdentity } from "../ecs/components";
import type { World } from "../ecs/world";
import { getWorkingMemory, WORKING_MEMORY_LIMITS, type WorkingMemoryFactInput, type WorkingMemoryReceipt } from "./working-memory";

export interface PlanActionEvidenceFence {
  readonly ownerKey: string;
  readonly capturedAt: number;
  readonly evidenceAfter: number;
  readonly receiptIds: readonly string[];
  /** Personally known identities when the plan request began, not a later
   * global name lookup or knowledge invented by the generated proposal. */
  readonly knownEntities: readonly { readonly key: string; readonly label: string }[];
}
export interface PlanActionEvidenceStep {
  actionType: string; target?: string; content?: string;
  /** A fresh repetition is an objective in its own right and is not covered. */
  repeat?: boolean;
}
export interface PlanActionEvidenceResolution {
  kind: "action_evidence"; sourceId: string; resolvedAt: number; summary: string;
}
const normalize = (s: string) => s.trim().toLocaleLowerCase();
const text = (s: unknown, limit = 240): s is string => typeof s === "string" && s.trim().length > 0 && s.length <= limit;
const time = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const slotKey = (fact: WorkingMemoryFactInput) => JSON.stringify([fact.subject, fact.predicate, fact.slot || ""]);
const sameValue = (a: WorkingMemoryFactInput, b: WorkingMemoryFactInput) => a.value === b.value && a.valueLabel === b.valueLabel;
const supported = new Set(["interact", "use", "pickup", "drop"]);
function ownerKey(world: World, eid: number): string | undefined {
  return entityExists(world, eid) && hasComponent(world, eid, Agent) && Agent.active[eid]
    && hasComponent(world, eid, WorkingMemoryIdentity) && text(WorkingMemoryIdentity.id[eid]) ? WorkingMemoryIdentity.id[eid] : undefined;
}
function validFence(fence: PlanActionEvidenceFence | undefined): fence is PlanActionEvidenceFence {
  return !!fence && text(fence.ownerKey) && time(fence.capturedAt) && time(fence.evidenceAfter)
    && Array.isArray(fence.receiptIds) && fence.receiptIds.length <= WORKING_MEMORY_LIMITS.receipts && fence.receiptIds.every(id => text(id))
    && Array.isArray(fence.knownEntities) && fence.knownEntities.length <= WORKING_MEMORY_LIMITS.facts * 2
    && fence.knownEntities.every(ref => ref && text(ref.key) && text(ref.label));
}
/** Capture at the asynchronous request boundary, never after generated output
 * arrives. Reads are pure; no identity assignment or extra sensing is performed. */
export function capturePlanActionEvidenceFence(world: World, eid: number): PlanActionEvidenceFence | undefined {
  const owner = ownerKey(world, eid); if (!owner) return;
  const memory = getWorkingMemory(world, eid), entities = new Map<string, { key: string; label: string }>();
  for (const fact of memory.facts) {
    if (fact.subjectLabel) entities.set(JSON.stringify([fact.subject, fact.subjectLabel]), { key: fact.subject, label: fact.subjectLabel });
    if (["location", "possession"].includes(fact.predicate) && fact.valueLabel && fact.value !== "unknown") {
      entities.set(JSON.stringify([fact.value, fact.valueLabel]), { key: fact.value, label: fact.valueLabel });
    }
  }
  return Object.freeze({ ownerKey: owner, capturedAt: Date.now(), evidenceAfter: Math.max(Date.now(), memory.evidenceFloorMs,
    ...memory.facts.map(f => f.observedAt), ...memory.receipts.map(r => r.atMs)),
    receiptIds: Object.freeze(memory.receipts.map(r => r.id)),
    knownEntities: Object.freeze([...entities.values()].map(ref => Object.freeze(ref))) });
}
function resolveKnownTarget(fence: PlanActionEvidenceFence, target: string): string | undefined {
  const exact = new Set(fence.knownEntities.filter(ref => ref.key === target).map(ref => ref.key));
  if (exact.size === 1) return target;
  const matches = new Set(fence.knownEntities.filter(ref => normalize(ref.label) === normalize(target)).map(ref => ref.key));
  return matches.size === 1 ? [...matches][0] : undefined;
}
function effectsStillKnown(receipt: WorkingMemoryReceipt, memory: ReturnType<typeof getWorkingMemory>): boolean {
  if (!receipt.facts.length) return false;
  const effects = new Map(receipt.facts.map(f => [slotKey(f), f]));
  if (effects.size !== receipt.facts.length) return false;
  for (const [key, effect] of effects) {
    const current = memory.facts.filter(f => slotKey(f) === key);
    if (current.length !== 1 || current[0].observedAt < receipt.atMs || !sameValue(current[0], effect)) return false;
  }
  // Reversal followed by an observation of the original value does not prove
  // this action's old effect endured. A genuinely new successful action can.
  for (const later of memory.receipts) {
    if (later.id === receipt.id || later.atMs < receipt.atMs) continue;
    if (later.kind === "action" && later.provenance === "own_action" && later.succeeded === false
      && later.action?.type === receipt.action?.type && later.action?.targetKey === receipt.action?.targetKey
      && later.action?.content === receipt.action?.content) return false;
    if (later.facts.some(fact => { const old = effects.get(slotKey(fact)); return old && !sameValue(old, fact); })) return false;
  }
  return true;
}
/** Pure bounded resolution. One receipt may cover only one occurrence in a plan;
 * callers pass the sources already used by prior step resolutions. Historical
 * untyped receipts and mere matching action/result prose are never proof. */
export function resolvePlanActionEvidence(world: World, eid: number, fence: PlanActionEvidenceFence | undefined,
  step: PlanActionEvidenceStep, options: { consumedSourceIds?: readonly string[] } = {}): PlanActionEvidenceResolution | undefined {
  if (!validFence(fence) || fence.ownerKey !== ownerKey(world, eid) || Date.now() < fence.capturedAt
    || !step || !supported.has(step.actionType) || !text(step.target)
    || step.content !== undefined && !text(step.content, 2000) || step.repeat !== undefined && typeof step.repeat !== "boolean"
    || step.repeat === true || options.consumedSourceIds !== undefined && (!Array.isArray(options.consumedSourceIds) || options.consumedSourceIds.length > 128
      || !options.consumedSourceIds.every(id => text(id)))) return;
  const targetKey = resolveKnownTarget(fence, step.target); if (!targetKey) return;
  const memory = getWorkingMemory(world, eid);
  // New knowledge of a same-name substitute makes name-based matching ambiguous.
  // Stable-key steps can still identify the original personally known object.
  if (step.target !== targetKey && memory.facts.some(f => f.subjectLabel && normalize(f.subjectLabel) === normalize(step.target!) && f.subject !== targetKey)) return;
  const candidates = memory.receipts.filter(receipt => receipt.kind === "action" && receipt.provenance === "own_action" && receipt.succeeded === true
    && receipt.atMs >= fence.evidenceAfter && !fence.receiptIds.includes(receipt.id) && !options.consumedSourceIds?.includes(receipt.id)
    && receipt.action?.type === step.actionType && receipt.action.targetKey === targetKey && receipt.action.content === step.content);
  for (const receipt of candidates.reverse()) {
    if (!effectsStillKnown(receipt, memory)) continue;
    return { kind: "action_evidence", sourceId: receipt.id, resolvedAt: Date.now(),
      summary: `Your matching action completed after this plan was requested; its admitted effects remain in your current evidence: ${receipt.summary}`.slice(0, 1000) };
  }
}
