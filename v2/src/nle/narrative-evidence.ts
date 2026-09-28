/** Bounded director evidence, not the operator's omniscient cognition snapshot.
 * Completed dialogue remains attributed and scoped to its actual observer.
 * No private messages, goals, thoughts, motives, unfinished scripts/prefixes or
 * process-global chronicle are read. No per-word/time counters enter the basis. */
import { createHash } from "node:crypto";
import { entityExists, hasComponent, query } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Name, ObjectState, PhysicalObject, Room, WorkingMemoryIdentity } from "../ecs/components";
import { getDirectContainer, getRoomForEntity } from "../ecs/location";
import { getSocialDialogue } from "../cognition/social-memory";
import { getAgentVisualEntities, getAgentWorldCapabilityGeneration } from "../cognition/world-capabilities";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { getCommittedEvents } from "../runtime/committed-events";
import { readSimulationTime } from "../ecs/simulation-time";
import { assertSimulationTaskActive } from "../runtime/task-scope";

export interface NarrativeEntityRef { id: number; key: string; name: string }
export interface NarrativeEvidenceRecord {
  id: string;
  kind: "place" | "actor_presence" | "visible_actor" | "visible_object" | "completed_dialogue";
  /** Actor whose physical view or personally delivered ledger supplies this row. */
  observer?: NarrativeEntityRef;
  subject?: NarrativeEntityRef;
  room?: NarrativeEntityRef;
  container?: NarrativeEntityRef;
  state?: string;
  dialogue?: { receiptId: string; speakerLabel: string; targetLabel?: string; words: string;
    own: boolean; atSimMs?: number; atSourceMs: number; executionId?: string };
}
export interface NarrativeEvidenceSnapshot {
  sourceId: string | null;
  actors: NarrativeEntityRef[];
  records: NarrativeEvidenceRecord[];
  omittedActors: number;
  omittedRecords: number;
  basis: string;
}
const MAX_ACTORS = 16, MAX_RECORDS = 192;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const named = (world: World, eid: number) => entityExists(world, eid) && hasComponent(world, eid, Name)
  && typeof Name.value[eid] === "string" && Name.value[eid].trim().length > 0 && Name.value[eid].length <= 240;

/** Allocating identity belongs to snapshot issuance; freshness reads never do it. */
function collect(world: World, issueIdentities: boolean, recipientKey?: string): NarrativeEvidenceSnapshot | undefined {
  const tape = getCommittedEvents(world); if (tape.stopped) return;
  const ref = (eid: number | undefined): NarrativeEntityRef | undefined => {
    if (eid === undefined || !named(world, eid)) return;
    const key = issueIdentities ? workingMemoryEntityRef(world, eid)?.key
      : hasComponent(world, eid, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[eid] : undefined;
    return key ? { id: eid, key, name: Name.value[eid] } : undefined;
  };
  const allActors = [...query(world, [Agent, Name])].filter(id => named(world, id)
    && (!recipientKey || hasComponent(world, id, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[id] === recipientKey)).sort((a, b) => a - b);
  const actors = allActors.slice(0, MAX_ACTORS).flatMap(id => { const value = ref(id); return value ? [value] : []; });
  const records: NarrativeEvidenceRecord[] = [];
  for (const id of (recipientKey ? [] : [...query(world, [Room, Name])].sort((a, b) => a - b).slice(0, 32))) {
    const subject = ref(id); if (subject) records.push({ id: `place:${subject.key}`, kind: "place", subject });
  }
  for (const actor of actors) {
    const room = ref(getRoomForEntity(world, actor.id));
    if (room) records.push({ id: `presence:${actor.key}`, kind: "actor_presence", observer: actor, subject: actor, room });
    for (const id of getAgentVisualEntities(world, actor.id).filter(id => id !== actor.id && (hasComponent(world, id, PhysicalObject) || hasComponent(world, id, Agent))).slice(0, 16)) {
      const subject = ref(id), container = ref(getDirectContainer(world, id));
      if (!subject || !room) continue;
      const state = hasComponent(world, id, ObjectState) ? ObjectState.current[id] : undefined;
      records.push({ id: `visible:${actor.key}:${subject.key}`, kind: hasComponent(world, id, Agent) ? "visible_actor" : "visible_object", observer: actor, subject, room,
        ...(container ? { container } : {}), ...(typeof state === "string" && state.length <= 1000 ? { state } : {}) });
    }
    for (const turn of getSocialDialogue(world, actor.id).slice(-8)) {
      const completion = turn.simulation ? turn.simulation.completedAtSimMs : turn.atSimMs;
      if (!turn.id || turn.id.length > 200 || !turn.content.trim() || turn.content.length > 2000
        || turn.speaker.length > 240 || (turn.target?.length ?? 0) > 240
        || turn.simulation && completion === undefined
        || completion !== undefined && (!Number.isFinite(completion) || completion < 0 || completion > readSimulationTime(world))) continue;
      // Historical names are labels, not permission to bind an old speaker to
      // a newly spawned person with the same name. Only the observer is bound.
      records.push({ id: `dialogue:${actor.key}:${turn.id}`, kind: "completed_dialogue", observer: actor,
        dialogue: { receiptId: turn.id, speakerLabel: turn.speaker, ...(turn.target ? { targetLabel: turn.target } : {}),
          words: turn.content, own: turn.own, atSourceMs: turn.atMs,
          ...(turn.simulation ? { atSimMs: turn.simulation.completedAtSimMs, executionId: turn.simulation.executionId }
            : turn.atSimMs !== undefined ? { atSimMs: turn.atSimMs } : {}) } });
    }
  }
  // Prioritize actual completed evidence when the physical catalog is large.
  records.sort((a, b) => Number(b.kind === "completed_dialogue") - Number(a.kind === "completed_dialogue") || a.id.localeCompare(b.id));
  const view = { sourceId: tape.sourceId, actors, records: records.slice(0, MAX_RECORDS),
    omittedActors: Math.max(0, allActors.length - actors.length), omittedRecords: Math.max(0, records.length - MAX_RECORDS) };
  return { ...view, basis: hash(view) };
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function capture(world: World, recipientKey?: string): { snapshot: NarrativeEvidenceSnapshot; current(): boolean } | undefined {
  assertSimulationTaskActive();
  const at = readSimulationTime(world), snapshot = collect(world, true, recipientKey);
  if (!snapshot) return;
  const generations = snapshot.actors.map(actor => ({ id: actor.id, generation: getAgentWorldCapabilityGeneration(world, actor.id),
    active: Agent.active[actor.id], persona: Agent.systemPrompt[actor.id], role: Agent.role[actor.id] }));
  return { snapshot: freeze(structuredClone(snapshot)), current: () => readSimulationTime(world) >= at
    && generations.every(row => entityExists(world, row.id) && hasComponent(world, row.id, Agent)
      && Agent.active[row.id] === row.active && Agent.systemPrompt[row.id] === row.persona && Agent.role[row.id] === row.role
      && getAgentWorldCapabilityGeneration(world, row.id) === row.generation)
    && collect(world, false, recipientKey)?.basis === snapshot.basis };
}
export function captureNarrativeEvidence(world: World) { return capture(world); }
/** Same authority fence, only this exact observer's local view and receipts. */
export function captureRecipientNarrativeEvidence(world: World, recipientKey: string) {
  assertSimulationTaskActive();
  if (typeof recipientKey !== "string" || !recipientKey.trim() || [...query(world, [Agent, WorkingMemoryIdentity])]
    .filter(id => WorkingMemoryIdentity.id[id] === recipientKey).length !== 1) return;
  return capture(world, recipientKey);
}
