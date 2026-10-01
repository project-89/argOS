/** Actor-owned physical working memory. Admission happens at the executor or
 * perception boundary; formatting never looks up the present world to fill gaps.
 * Speech, intentions and inferred conclusions are not physical evidence here. */
import { addComponent, entityExists, hasComponent } from "bitecs";
import { randomUUID } from "node:crypto";
import { Agent, Name, WorkingMemory, WorkingMemoryIdentity } from "../ecs/components";
import type { World } from "../ecs/world";
import { assertSimulationTaskActive } from "../runtime/task-scope";

export type WorkingMemoryProvenance = "own_action" | "witnessed_action" | "visible_observation" | "own_observation";
/** Private executor metadata, never inferred from a receipt's prose or supplied
 * on a witness projection. It identifies the concrete acted-on entity. */
export interface WorkingMemoryActionIdentity { type: string; targetKey: string; content?: string }
/** Historical motivation captured before execution, not a goal-success receipt
 * or authority to resume a command. Never project this onto witnesses. */
export interface WorkingMemoryActionContext {
  startedAtSimMs: number;
  purpose: string;
  intention?: { key: string; description: string; activityId?: string };
}
export interface WorkingMemoryFactInput {
  /** A caller-owned durable key, or an explicitly disambiguated observed label.
   * Never pass a numerical ECS ID: it would not survive a save/restore remap. */
  subject: string;
  subjectLabel?: string;
  predicate: "location" | "state" | "possession";
  /** Separates independent state fields, such as a relay's power and panel. */
  slot?: string;
  value: string;
  valueLabel?: string;
}
export interface WorkingMemoryEvidence {
  id: string;
  atMs: number;
  kind: "action" | "observation";
  provenance: WorkingMemoryProvenance;
  summary: string;
  /** Action evidence must explicitly say whether its effect committed. */
  succeeded?: boolean;
  action?: WorkingMemoryActionIdentity;
  executionContext?: WorkingMemoryActionContext;
  completedAtSimMs?: number;
  facts: WorkingMemoryFactInput[];
}
export interface WorkingMemoryFact extends WorkingMemoryFactInput {
  sourceId: string;
  observedAt: number;
  provenance: WorkingMemoryProvenance;
}
export interface WorkingMemoryReceipt extends Omit<WorkingMemoryEvidence, "facts"> {
  /** Only facts admitted from a confirmed action or actual observation. */
  facts: WorkingMemoryFactInput[];
}
export interface ActorWorkingMemory {
  facts: WorkingMemoryFact[];
  receipts: WorkingMemoryReceipt[];
  revision: number;
  evidenceFloorMs: number;
}

/** Assign only at a real observation/committed-action boundary, never while
 * formatting memory. The UUID belongs to the entity and persists in ECS saves. */
export function workingMemoryEntityRef(world: World, eid: number): { key: string; label: string } | undefined {
  assertSimulationTaskActive();
  if (!entityExists(world, eid) || !hasComponent(world, eid, Name) || !text(Name.value[eid])) return;
  if (!hasComponent(world, eid, WorkingMemoryIdentity)) {
    addComponent(world, eid, WorkingMemoryIdentity);
    WorkingMemoryIdentity.id[eid] = `entity:${randomUUID()}`;
  } else if (!text(WorkingMemoryIdentity.id[eid])) {
    WorkingMemoryIdentity.id[eid] = `entity:${randomUUID()}`;
  }
  return { key: WorkingMemoryIdentity.id[eid], label: Name.value[eid] };
}

export const WORKING_MEMORY_LIMITS = { facts: 64, receipts: 96, factsPerEvidence: 32 } as const;
const validProvenance = new Set<unknown>(["own_action", "witnessed_action", "visible_observation", "own_observation"]);
const actor = (world: World, eid: number) => entityExists(world, eid) && hasComponent(world, eid, Agent);
const text = (value: unknown, limit = 240): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= limit;
const optionalText = (value: unknown, limit = 240) => value === undefined || text(value, limit);
const timestamp = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
/** End of this exact entity lifetime, not absence from a view or a hidden move. */
const removedLifetime = (fact: WorkingMemoryFactInput) => fact.predicate === "state" && fact.slot === "Entity.lifecycle" && fact.value === "removed";
const ownsMemory = (world: World, eid: number) => actor(world, eid) && hasComponent(world, eid, WorkingMemory)
  && hasComponent(world, eid, WorkingMemoryIdentity) && text(WorkingMemoryIdentity.id[eid])
  && WorkingMemory.ownerKey[eid] === WorkingMemoryIdentity.id[eid];
function array(raw: string | undefined): unknown[] {
  try { const value = JSON.parse(raw || "[]"); return Array.isArray(value) ? value : []; } catch { return []; }
}
function validFact(value: unknown): value is WorkingMemoryFactInput {
  const f = value as WorkingMemoryFactInput;
  return !!f && text(f.subject) && optionalText(f.subjectLabel) && ["location", "state", "possession"].includes(f.predicate)
    && optionalText(f.slot, 100) && text(f.value) && optionalText(f.valueLabel);
}
function validEvidence(value: unknown): value is WorkingMemoryEvidence {
  const e = value as WorkingMemoryEvidence;
  if (!e || !text(e.id) || !timestamp(e.atMs) || !text(e.summary, 1000) || !validProvenance.has(e.provenance)
    || !Array.isArray(e.facts) || e.facts.length > WORKING_MEMORY_LIMITS.factsPerEvidence || !e.facts.every(validFact)) return false;
  if (e.kind !== "action" && e.facts.some(removedLifetime)) return false;
  if (e.action !== undefined && (e.kind !== "action" || e.provenance !== "own_action" || !text(e.action?.type, 80)
    || !text(e.action?.targetKey) || e.action.content !== undefined && !text(e.action.content, 2000))) return false;
  const context = e.executionContext;
  if (e.completedAtSimMs !== undefined && (e.kind !== "action" || e.provenance !== "own_action" || !timestamp(e.completedAtSimMs))) return false;
  if (context !== undefined && (e.kind !== "action" || e.provenance !== "own_action" || !timestamp(context?.startedAtSimMs)
    || !text(context.purpose, 400) || !timestamp(e.completedAtSimMs) || context.startedAtSimMs > e.completedAtSimMs
    || context.intention !== undefined && (!text(context.intention?.key) || !text(context.intention?.description, 2000)
      || !optionalText(context.intention.activityId)))) return false;
  return e.kind === "action" ? ["own_action", "witnessed_action"].includes(e.provenance) && typeof e.succeeded === "boolean"
    : e.kind === "observation" && ["visible_observation", "own_observation"].includes(e.provenance) && e.succeeded === undefined;
}
function validStoredFact(value: unknown): value is WorkingMemoryFact {
  const f = value as WorkingMemoryFact;
  return validFact(f) && text(f.sourceId) && timestamp(f.observedAt) && validProvenance.has(f.provenance)
    && (!removedLifetime(f) || f.provenance === "own_action" || f.provenance === "witnessed_action");
}
function factKey(f: WorkingMemoryFactInput): string { return JSON.stringify([f.subject, f.predicate, f.slot || ""]); }
function order(a: { atMs: number; id: string }, b: { atMs: number; id: string }): number {
  return a.atMs - b.atMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function factOrder(a: WorkingMemoryFact, b: WorkingMemoryFact): number {
  return order({ atMs: a.observedAt, id: a.sourceId }, { atMs: b.observedAt, id: b.sourceId }) || factKey(a).localeCompare(factKey(b));
}
function copyFact(f: WorkingMemoryFactInput): WorkingMemoryFactInput {
  // Copy only schema fields; an untrusted producer cannot smuggle a mutable
  // object, extra hidden state, or an arbitrary model confidence into storage.
  return { subject: f.subject, ...(f.subjectLabel === undefined ? {} : { subjectLabel: f.subjectLabel }), predicate: f.predicate,
    ...(f.slot === undefined ? {} : { slot: f.slot }), value: f.value, ...(f.valueLabel === undefined ? {} : { valueLabel: f.valueLabel }) };
}

/** Parsed, validated and ordered memory, kept per actor while its stored text is unchanged. Reads vastly
 * outnumber writes (every observation reads; few change anything), and re-parsing the whole memory on each read
 * slowed a busy town's every tick — worse as memories filled. Entries are frozen: shared, never mutated. */
type ParsedMemory = { factsJson: string; receiptsJson: string; facts: readonly WorkingMemoryFact[]; receipts: readonly WorkingMemoryReceipt[] };
const parsedMemories = new WeakMap<World, Map<number, ParsedMemory>>();
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const v of Object.values(value)) deepFreeze(v); }
  return value;
}
function parsedMemory(world: World, eid: number): ParsedMemory {
  const factsJson = WorkingMemory.factsJson[eid] || "[]", receiptsJson = WorkingMemory.receiptsJson[eid] || "[]";
  let byActor = parsedMemories.get(world); if (!byActor) parsedMemories.set(world, byActor = new Map());
  const hit = byActor.get(eid);
  if (hit && hit.factsJson === factsJson && hit.receiptsJson === receiptsJson) return hit;
  const parsed: ParsedMemory = { factsJson, receiptsJson,
    facts: deepFreeze(array(factsJson).filter(validStoredFact).sort(factOrder).slice(-WORKING_MEMORY_LIMITS.facts)),
    receipts: deepFreeze(array(receiptsJson).filter(validEvidence).sort(order).slice(-WORKING_MEMORY_LIMITS.receipts)) };
  byActor.set(eid, parsed);
  return parsed;
}

const copyStoredFact = (f: WorkingMemoryFact): WorkingMemoryFact => ({ ...f });
const copyReceipt = (r: WorkingMemoryReceipt): WorkingMemoryReceipt => ({ ...r, facts: r.facts.map(f => ({ ...f })),
  ...(r.action ? { action: { ...r.action } } : {}),
  ...(r.executionContext ? { executionContext: { ...r.executionContext, ...(r.executionContext.intention ? { intention: { ...r.executionContext.intention } } : {}) } } : {}) });
/** The shared, frozen read (no copy): for this module's own read-only use. */
function readMemory(world: World, eid: number): { facts: readonly WorkingMemoryFact[]; receipts: readonly WorkingMemoryReceipt[]; revision: number; evidenceFloorMs: number } {
  if (!ownsMemory(world, eid)) return { facts: [], receipts: [], revision: 0, evidenceFloorMs: -1 };
  const { facts, receipts } = parsedMemory(world, eid);
  return { facts, receipts, revision: integer(WorkingMemory.revision[eid]) ? WorkingMemory.revision[eid] : 0,
    evidenceFloorMs: timestamp(WorkingMemory.evidenceFloorMs[eid]) ? WorkingMemory.evidenceFloorMs[eid] : -1 };
}

/** Returns detached values (copies a caller may change) and performs no mutation, even for malformed saves. */
export function getWorkingMemory(world: World, eid: number): ActorWorkingMemory {
  const memory = readMemory(world, eid);
  return { facts: memory.facts.map(copyStoredFact), receipts: memory.receipts.map(copyReceipt), revision: memory.revision, evidenceFloorMs: memory.evidenceFloorMs };
}
export function getWorkingMemoryRevision(world: World, eid: number): number {
  return ownsMemory(world, eid) && integer(WorkingMemory.revision[eid]) ? WorkingMemory.revision[eid] : 0;
}
function initialize(world: World, eid: number) {
  const owner = workingMemoryEntityRef(world, eid); if (!owner) return false;
  if (ownsMemory(world, eid)) return true;
  if (!hasComponent(world, eid, WorkingMemory)) addComponent(world, eid, WorkingMemory);
  WorkingMemory.factsJson[eid] = "[]"; WorkingMemory.receiptsJson[eid] = "[]";
  WorkingMemory.ownerKey[eid] = owner.key;
  WorkingMemory.revision[eid] = 0; WorkingMemory.evidenceFloorMs[eid] = -1;
  return true;
}

/** Returns true for a newly admitted source event, not a declaration of success.
 * The caller must have checked ownership/sensory access before supplying evidence.
 * Failed actions retain a receipt, but never install their proposed fact changes. */
export function recordWorkingMemoryEvidence(world: World, observerEid: number, input: WorkingMemoryEvidence): boolean {
  assertSimulationTaskActive();
  if (!actor(world, observerEid) || !validEvidence(input)) return false;
  const previous = readMemory(world, observerEid); // read-only here: no copy
  if (input.atMs <= previous.evidenceFloorMs
    || previous.receipts.some(r => r.id === input.id) || previous.facts.some(f => f.sourceId === input.id)) return false;
  // Duplicate slots within one event are ambiguous rather than independent proof.
  const inputKeys = input.facts.map(factKey);
  if (new Set(inputKeys).size !== inputKeys.length) return false;
  const admittedFacts = input.kind === "action" && input.succeeded !== true ? [] : input.facts.map(copyFact);
  const receipt: WorkingMemoryReceipt = { id: input.id, atMs: input.atMs, kind: input.kind, provenance: input.provenance,
    summary: input.summary, ...(input.succeeded === undefined ? {} : { succeeded: input.succeeded }), facts: admittedFacts,
    ...(input.completedAtSimMs === undefined ? {} : { completedAtSimMs: input.completedAtSimMs }),
    ...(input.executionContext === undefined ? {} : { executionContext: {
      startedAtSimMs: input.executionContext.startedAtSimMs, purpose: input.executionContext.purpose,
      ...(input.executionContext.intention ? { intention: { key: input.executionContext.intention.key,
        description: input.executionContext.intention.description,
        ...(input.executionContext.intention.activityId ? { activityId: input.executionContext.intention.activityId } : {}) } } : {}),
    } }),
    ...(input.action === undefined ? {} : { action: { type: input.action.type, targetKey: input.action.targetKey,
      ...(input.action.content === undefined ? {} : { content: input.action.content }) } }) };
  const facts = new Map(previous.facts.map(f => [factKey(f), f]));
  // Native terminal outcomes retire availability for one durable identity.
  // Keep old receipts as history, but never let a delayed pre-removal fact make
  // that same lifetime available again. A replacement has a different identity.
  const retired = new Set([...previous.facts.filter(removedLifetime),
    ...previous.receipts.filter(r => r.kind === "action" && r.succeeded).flatMap(r => r.facts.filter(removedLifetime))].map(f => f.subject));
  if (input.kind === "action" && input.succeeded === true)
    for (const f of admittedFacts.filter(removedLifetime)) retired.add(f.subject);
  let changed = false;
  for (const [key, f] of facts) if (retired.has(f.subject) && !removedLifetime(f)) { facts.delete(key); changed = true; }
  for (const f of admittedFacts) {
    if (removedLifetime(f) && !(input.kind === "action" && input.succeeded === true)) continue;
    if (retired.has(f.subject) && !removedLifetime(f)) continue;
    const old = facts.get(factKey(f));
    if (old && order({ atMs: old.observedAt, id: old.sourceId }, input) >= 0) continue;
    if (!old || old.value !== f.value || old.valueLabel !== f.valueLabel || old.subjectLabel !== f.subjectLabel) changed = true;
    facts.set(factKey(f), { ...f, sourceId: input.id, observedAt: input.atMs, provenance: input.provenance });
  }
  const nextFacts = [...facts.values()].sort(factOrder).slice(-WORKING_MEMORY_LIMITS.facts);
  const allReceipts = [...previous.receipts, receipt].sort(order);
  const droppedReceipts = allReceipts.slice(0, Math.max(0, allReceipts.length - WORKING_MEMORY_LIMITS.receipts));
  const floor = droppedReceipts.reduce((oldest, r) => Math.max(oldest, r.atMs), previous.evidenceFloorMs);
  if (!initialize(world, observerEid)) return false;
  WorkingMemory.factsJson[observerEid] = JSON.stringify(nextFacts);
  WorkingMemory.receiptsJson[observerEid] = JSON.stringify(allReceipts.slice(-WORKING_MEMORY_LIMITS.receipts));
  // Repeated confirmations may refresh age, but do not masquerade as a changed
  // belief and wake a resting character on every visual refresh.
  WorkingMemory.revision[observerEid] = previous.revision + (changed ? 1 : 0);
  WorkingMemory.evidenceFloorMs[observerEid] = floor;
  return true;
}

/** One bounded actor-owned action window for prompt display and review citations.
 * Witnessed outcomes remain attributed observations, not the observer's work. */
export function recentWorkingMemoryActions(memory: ActorWorkingMemory): WorkingMemoryReceipt[] {
  return memory.receipts.filter(r => r.kind === "action").slice(-8);
}

/** Last known is deliberately distinct from an omniscient current-state query. */
export function formatWorkingMemoryContext(world: World, eid: number, now = Date.now(), options: { fullReceiptIds?: boolean } = {}): string {
  const memory = getWorkingMemory(world, eid), { facts, receipts } = memory;
  if (!facts.length && !receipts.length) return "WHAT YOU'VE SEEN AND DONE: nothing recorded yet.";
  const age = (at: number) => `${Math.max(0, Math.round((now - at) / 1000))}s ago`;
  const shortSource = (id: string) => {
    const uuid = /[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/i.exec(id);
    return uuid ? `${id.slice(0, uuid.index)}${uuid[0].slice(0, 8)}` : id.length > 32 ? `${id.slice(0, 20)}…${id.slice(-8)}` : id;
  };
  const describeFact = (f: WorkingMemoryFact) => `[${shortSource(f.sourceId)}; ${age(f.observedAt)}; ${f.provenance}] ${JSON.stringify(f.subjectLabel || f.subject)} ${f.predicate}${f.slot ? `.${f.slot}` : ""}: ${JSON.stringify(f.valueLabel || f.value)}`;
  // Acted-on items remain relevant after an ambient visual refresh replaces
  // their latest source. This priority reads actor-owned receipts, never ECS.
  const actedOn = new Set(receipts.filter(r => r.kind === "action" && r.succeeded).flatMap(r => r.facts.map(f => f.subject)));
  const priority = (f: WorkingMemoryFact) => removedLifetime(f) ? 4 : actedOn.has(f.subject) ? f.predicate === "location" ? 3 : 2 : 0;
  // Dependency hashes and question keys are machine bookkeeping. The completed
  // inspection's readable result and visible contents are the cognitive input.
  const selected = facts.filter(f => !["Inspection.basis", "Inspection.question"].includes(f.slot || ""))
    .sort((a, b) => priority(b) - priority(a) || factOrder(b, a)).slice(0, 32);
  const actions = recentWorkingMemoryActions(memory);
  return `WHAT YOU'VE SEEN AND DONE (newest first wins; things may have changed where you can't see):
${selected.map(describeFact).join("\n") || "No physical facts recorded."}
RECENT ACTION RECEIPTS (past events, not current possession):
${actions.map(r => `[${options.fullReceiptIds ? r.id : shortSource(r.id)}; ${age(r.atMs)}; ${r.provenance}; ${r.succeeded ? "committed" : "failed"}] ${JSON.stringify(r.summary)}${r.executionContext ? ` Attempted purpose: ${JSON.stringify(r.executionContext.purpose)}${r.executionContext.intention ? `; then serving: ${JSON.stringify(r.executionContext.intention.description)}` : ""}. This outcome is not whole-goal success.` : ""}`).join("\n") || "No recent action receipts."}`;
}
