/** Completed inspections answer a specific local question. Their evidence is
 * actor-owned and retained; reading it never performs another world query. */
import { entityExists, hasComponent } from "bitecs";
import { createHash, randomUUID } from "node:crypto";
import { Agent, Container, Description, Name, ObjectState, ObjectType, PhysicalObject, Room, Surface, Traits, WorkingMemoryIdentity } from "../ecs/components";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import type { World } from "../ecs/world";
import { getCommittedEvents } from "../runtime/committed-events";
import { getAvailableAffordances } from "../world/affordance-availability";
import { isStructuralGeometry } from "../world/structural-geometry";
import { getAgentSensoryCapabilities } from "./sensory-capabilities";
import { getAgentVisualEntities, getObservedPublicActivity, isPublicContainerOpen } from "./world-capabilities";
import { getWorkingMemory, recordWorkingMemoryEvidence, workingMemoryEntityRef,
  WORKING_MEMORY_LIMITS, type WorkingMemoryFactInput } from "./working-memory";

export interface InspectionMemory {
  sourceId: string;
  observedAt: number;
  subject: string;
  subjectLabel: string;
  question: string;
  summary: string;
  outcome: "observed" | "empty" | "contents" | "not_observable";
  /** Native inspection content/source signature; not an inference or success claim. */
  evidenceBasis?: string;
}
const slots = { result: "Inspection.result", basis: "Inspection.basis", question: "Inspection.question", exterior: "Inspection.exterior", contents: "Container.visibleContents" } as const;
const normalize = (text?: string) => (text || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
const questionKey = (question?: string) => {
  const value = normalize(question);
  // Native aliases sometimes arrive in observe.content. A bare action verb
  // asks no new question; arguments and real questions remain distinct.
  return !value || ["observe", "examine", "inspect"].includes(value) ? "general inspection" : value;
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Keep both signatures in the existing machine-only slot, not prompt facts.
 * Older saved inspections contain only their physical-state digest. */
function readBasis(value?: string): { physical?: string; evidence?: string } {
  try {
    const parsed = JSON.parse(value || "null");
    if (Array.isArray(parsed) && parsed.length === 2 && parsed.every(item => typeof item === "string" && /^[a-f0-9]{64}$/.test(item)))
      return { physical: parsed[0], evidence: parsed[1] };
  } catch { /* Legacy plain digest. */ }
  return { physical: value };
}
const bounded = (value: string, length = 240) => value.length > length ? `${value.slice(0, length - 1)}…` : value;
const stateFact = (subject: { key: string; label: string }, slot: string, value: string, valueLabel?: string): WorkingMemoryFactInput => ({
  subject: subject.key, subjectLabel: subject.label, predicate: "state", slot, value, ...(valueLabel ? { valueLabel } : {}),
});
function traits(world: World, eid: number): string[] {
  if (!hasComponent(world, eid, Traits)) return [];
  try { const value = JSON.parse(Traits.active[eid] || "[]"); return Array.isArray(value) ? value.filter(v => typeof v === "string").map(normalize) : []; }
  catch { return []; }
}
function readableActor(world: World, eid: number) {
  return entityExists(world, eid) && hasComponent(world, eid, Agent) && Agent.active[eid] && getAgentSensoryCapabilities(world, eid).visual > 0;
}
function visibleTarget(world: World, actor: number, target: number): boolean {
  return readableActor(world, actor) && entityExists(world, target) && hasComponent(world, target, Name)
    && !traits(world, target).some(trait => ["hidden", "invisible", "concealed"].includes(trait))
    && (target === getRoomForEntity(world, actor) || getAgentVisualEntities(world, actor).includes(target));
}
function timestamp(world: World, actor: number, explicit?: number): number {
  if (explicit !== undefined) return explicit;
  const memory = getWorkingMemory(world, actor);
  return Math.max(Date.now(), memory.evidenceFloorMs + 0.001,
    ...memory.facts.map(f => f.observedAt + 0.001), ...memory.receipts.map(r => r.atMs + 0.001));
}
function basis(facts: WorkingMemoryFactInput[], subject: string): string {
  return digest(facts.filter(f => f.subject === subject && f.predicate === "state"
    && ["ObjectState.current", "PublicActivity.current", "Entity.kind", "ObjectType.typeId", "Container.present", slots.exterior, slots.contents].includes(f.slot || ""))
    .map(f => [f.slot, f.value]).sort((a, b) => a[0]!.localeCompare(b[0]!)));
}

/** A typed physical container is an inspection surface, not permission to scan
 * nested inventory. A character, even with Container attached, remains private. */
function captureSurface(world: World, actor: number, target: number) {
  if (!visibleTarget(world, actor, target)) return;
  const ref = workingMemoryEntityRef(world, target); if (!ref) return;
  const facts: WorkingMemoryFactInput[] = [];
  const person = hasComponent(world, target, Agent);
  const container = hasComponent(world, target, Container), surface = hasComponent(world, target, Surface), room = hasComponent(world, target, Room);
  const structural = isStructuralGeometry(world, target);
  const type = !person && hasComponent(world, target, ObjectType) ? ObjectType.typeId[target] : undefined;
  // Identity and actual surface semantics belong to the same native receipt as
  // its state. An opaque authored label alone is not evidence of storage.
  facts.push(stateFact(ref, "Entity.kind", person ? "person" : room ? "room" : structural ? "structural_geometry" : container ? "container" : surface ? "surface" : "object"));
  if (!person) {
    if (type) facts.push(stateFact(ref, "ObjectType.typeId", bounded(type)));
    facts.push(stateFact(ref, "Container.present", String(container)));
  }
  const currentState = person ? getObservedPublicActivity(world, actor, target)
    : hasComponent(world, target, ObjectState) ? ObjectState.current[target] : undefined;
  facts.push(stateFact(ref, person ? "PublicActivity.current" : "ObjectState.current", bounded(currentState || "unknown"),
    currentState ? undefined : "No visible state established."));
  // A closed lid hides its contents, not its own visible scratches or paint.
  // Description is the object's public exterior, never a license to inspect
  // descendants or an Agent's potentially private authored identity. Hash the
  // full value so a later locally observed change beyond the text cap still
  // invalidates the old answer; the label is the bounded readable evidence.
  const exterior = !person && hasComponent(world, target, Description) ? (Description.value[target] || "").trim() : "";
  if (!person) facts.push(stateFact(ref, slots.exterior, digest(exterior), bounded(exterior) || "No authored visible detail established."));
  let outcome: InspectionMemory["outcome"] = "observed";
  let summary = `Inspected ${ref.label}${currentState ? `: ${currentState}` : "; no further visible state was revealed"}.`;
  if (structural && !container && !surface && !room) summary = `Inspected ${ref.label} (${type === "structural_wall" ? "structural wall" : "structural geometry"}; not a container): ${currentState || "no further visible state established"}. This is a structural surface, not an inspection of storage contents.`;
  if (!hasComponent(world, target, Agent) && (container || surface || room)) {
    const open = room || isPublicContainerOpen(world, target);
    if (!open) {
      outcome = "not_observable";
      summary = `Inspected ${ref.label}: ${currentState || "closed"}; contents are not observable, not established as empty.`;
      facts.push(stateFact(ref, slots.contents, "not_observable", "Contents not observable; whether empty is unknown."));
    } else {
      // Explicitly examining an open physical container reveals its direct
      // physical surface. It does not reveal a closed box within it, someone's
      // pocket, an unread message entity, or a hidden/invisible item.
      const visible = new Set(getAgentVisualEntities(world, actor));
      const contents = listDirectContents(world, target).filter(child => visible.has(child) && child !== actor && entityExists(world, child)
        && hasComponent(world, child, Name) && (hasComponent(world, child, PhysicalObject) || hasComponent(world, child, Agent))
        && !traits(world, child).some(trait => ["hidden", "invisible", "concealed"].includes(trait)))
        .flatMap(child => { const item = workingMemoryEntityRef(world, child); return item ? [item] : []; });
      outcome = contents.length ? "contents" : "empty";
      const description = contents.length ? `${room ? "Visible here" : "Visible contents"}: ${contents.map(item => item.label).join(", ")}.`
        : room ? "No other people or physical items are visible here." : "Visibly empty; no items are visible inside.";
      summary = `Inspected ${ref.label}. ${description}`;
      facts.push(stateFact(ref, slots.contents, digest(contents.map(item => item.key).sort()), bounded(description)));
      // Limit one record without turning the truncation into a false empty set.
      const itemBudget = Math.min(24, WORKING_MEMORY_LIMITS.factsPerEvidence - facts.length - 3);
      for (const item of contents.slice(0, itemBudget)) facts.push({ subject: item.key, subjectLabel: item.label,
        predicate: "location", value: ref.key, valueLabel: ref.label });
    }
  }
  if (exterior) summary = `Visible description: ${bounded(exterior, 600)} ${summary}`;
  return { ref, facts, outcome, summary: bounded(summary, 1000) };
}

/** Call only after a real, successful visual observe/examine action. The helper
 * rechecks sensory/local access, so a remote target cannot turn success prose
 * into physical evidence. It never takes the model's proposed result as input. */
export function recordInspectionResult(world: World, actor: number, target: number,
  options: { question?: string; atMs?: number } = {}): InspectionMemory | undefined {
  const surface = captureSurface(world, actor, target); if (!surface) return;
  const question = questionKey(options.question);
  if (question.length > 240) return; // Do not conflate different truncated questions.
  // Computed only at explicit inspection, not by ambient refresh or memory
  // readers. Retain genuine changed descriptions/operations as well as the
  // physical basis; do not mistake receipt timestamps for new information.
  const evidenceBasis = digest([getCommittedEvents(world).sourceId, Name.value[actor], Agent.role[actor], Agent.systemPrompt[actor],
    surface.ref.key, surface.ref.label, question, surface.summary, basis(surface.facts, surface.ref.key),
    hasComponent(world, target, Description) ? Description.value[target] : null,
    getAvailableAffordances(world, actor, target).map(a => a.name).sort()]);
  const atMs = timestamp(world, actor, options.atMs), id = `inspection:${randomUUID()}`;
  const facts = [...surface.facts,
    stateFact(surface.ref, slots.result, surface.outcome, bounded(surface.summary)),
    stateFact(surface.ref, slots.basis, JSON.stringify([basis(surface.facts, surface.ref.key), evidenceBasis]), "Valid for the state and visible contents established by this inspection."),
    stateFact(surface.ref, slots.question, question)];
  if (!recordWorkingMemoryEvidence(world, actor, { id, atMs, kind: "action", provenance: "own_action", succeeded: true,
    summary: surface.summary, facts })) return;
  return { sourceId: id, observedAt: atMs, subject: surface.ref.key, subjectLabel: surface.ref.label,
    question, summary: surface.summary, outcome: surface.outcome, evidenceBasis };
}

/** Pure actor-owned lookup: no name resolver, live containment query, UUID
 * assignment, elapsed-time expiry or hidden-world invalidation. */
export function getCurrentInspection(world: World, actor: number, target: string, question?: string): InspectionMemory | undefined {
  const memory = getWorkingMemory(world, actor);
  // A newly observed same-name substitute is not the previously checked object.
  const namedSubjects = new Set(memory.facts.filter(f => normalize(f.subjectLabel) === normalize(target)).map(f => f.subject));
  if (namedSubjects.size > 1 && !memory.facts.some(f => f.subject === target)) return;
  const matched = memory.facts.filter(f => f.predicate === "state" && f.slot === slots.result
    && (f.subject === target || normalize(f.subjectLabel) === normalize(target)));
  if (matched.length !== 1) return; // Same-name entities are not interchangeable.
  const result = matched[0];
  if (result.provenance !== "own_action" || !["observed", "empty", "contents", "not_observable"].includes(result.value)) return;
  const owned = (slot: string) => memory.facts.find(f => f.subject === result.subject && f.slot === slot
    && f.predicate === "state" && f.sourceId === result.sourceId && f.provenance === "own_action");
  const questionFact = owned(slots.question), basisFact = owned(slots.basis);
  const storedBasis = readBasis(basisFact?.value);
  if (questionFact?.value !== questionKey(question) || storedBasis.physical !== basis(memory.facts, result.subject)) return;
  return { sourceId: result.sourceId, observedAt: result.observedAt, subject: result.subject,
    subjectLabel: result.subjectLabel || result.subject, question: questionFact.value,
    summary: result.valueLabel || result.value, outcome: result.value as InspectionMemory["outcome"],
    ...(storedBasis.evidence ? { evidenceBasis: storedBasis.evidence } : {}) };
}

/** At actual perception admission, a previously inspected visible surface may
 * have changed. Only local, sighted evidence invalidates the old answer; reading
 * memory in another room leaves it historical rather than omniscient. */
export function refreshKnownInspectionEvidence(world: World, actor: number): void {
  if (!readableActor(world, actor)) return;
  const previous = getWorkingMemory(world, actor);
  const checked = previous.facts.filter(f => f.predicate === "state" && f.slot === slots.result);
  if (!checked.length) return;
  const room = getRoomForEntity(world, actor);
  const accessible = [...getAgentVisualEntities(world, actor), ...(room === undefined ? [] : [room])];
  for (const result of checked) {
    const target = accessible.find(eid => hasComponent(world, eid, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[eid] === result.subject);
    if (target === undefined) continue;
    const surface = captureSurface(world, actor, target); if (!surface) continue;
    const basisFact = previous.facts.find(f => f.subject === result.subject && f.predicate === "state" && f.slot === slots.basis);
    const oldFacts = new Map(previous.facts.map(f => [JSON.stringify([f.subject, f.predicate, f.slot]), f]));
    const changes = surface.facts.filter(f => { const old = oldFacts.get(JSON.stringify([f.subject, f.predicate, f.slot]));
      return !old || old.value !== f.value || old.valueLabel !== f.valueLabel; });
    if (result.value !== "stale" && readBasis(basisFact?.value).physical !== basis(surface.facts, result.subject)) changes.push(stateFact(surface.ref,
      slots.result, "stale", "Previous inspection is outdated after an observed local change; inspect again if needed."));
    if (!changes.length) continue;
    recordWorkingMemoryEvidence(world, actor, { id: `inspection-observation:${randomUUID()}`, atMs: timestamp(world, actor),
      kind: "observation", provenance: "visible_observation", summary: `Observed the previously inspected ${surface.ref.label}.`, facts: changes });
  }
}
