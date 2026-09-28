/** Field-scoped observations issued before inference. Model citations select
 * host-owned guards; they never supply expected state or execution authority. */
import { randomUUID } from "node:crypto";
import { entityExists, hasComponent, query } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Description, Name, ObjectState, PhysicalObject, Removed, Room, StimulusSource, WorkingMemoryIdentity } from "../ecs/components";
import { getDirectContainer, getRoomForEntity } from "../ecs/location";
import { workingMemoryEntityRef } from "../cognition/working-memory";

export interface SpiritEvidenceRecord {
  id: string;
  kind: "actor_presence" | "place" | "object_state" | "object_placement" | "object_description" | "attributed_report";
  subject: string;
  value: string | { room: string | null; container: string | null };
}
export interface SpiritInterventionEvidence {
  records: readonly SpiritEvidenceRecord[];
  omittedRecords: number;
  bind(ids: unknown): (() => boolean) | undefined;
  /** Optional citations: issued IDs are enforced, anything else is ignored. */
  bindCited(ids: unknown): { current: () => boolean; cited: number };
  /** Guard for the issued record of one kind and subject, if any. */
  guardFor(kind: SpiritEvidenceRecord["kind"], subject: string): (() => boolean) | undefined;
}

const LIMIT = 192;
export function captureSpiritInterventionEvidence(world: World,
  reports: readonly { sender: string; subject: string; content: string }[] = []): SpiritInterventionEvidence {
  const records: SpiritEvidenceRecord[] = [], guards = new Map<string, () => boolean>();
  let omittedRecords = 0;
  const reference = (eid: number | undefined) => {
    if (eid === undefined || !entityExists(world, eid) || hasComponent(world, eid, Removed)) return;
    const ref = workingMemoryEntityRef(world, eid); if (!ref) return;
    return { name: ref.label, current: () => entityExists(world, eid) && !hasComponent(world, eid, Removed)
      && hasComponent(world, eid, Name) && Name.value[eid] === ref.label
      && hasComponent(world, eid, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[eid] === ref.key };
  };
  const issue = (kind: SpiritEvidenceRecord["kind"], subject: string, value: SpiritEvidenceRecord["value"], current: () => boolean) => {
    if (records.length >= LIMIT) { omittedRecords++; return; }
    // Short, per-capture random IDs keep the prompt compact; guards are per capture.
    const id = `observation:${randomUUID().slice(0, 13)}`;
    records.push(Object.freeze({ id, kind, subject, value: typeof value === "object" ? Object.freeze(value) : value }));
    guards.set(id, current);
  };
  // A received account remains historical evidence after inbox acknowledgement.
  // It does not establish that its content is true now, or known by an NPC.
  // Only prompt-visible text is copied; arbitrary report data is never exposed.
  for (const report of reports.slice(-16)) {
    if (typeof report.sender !== "string" || report.sender.length > 240
      || typeof report.subject !== "string" || report.subject.length > 240
      || typeof report.content !== "string" || report.content.length > 1000) continue;
    issue("attributed_report", report.sender, JSON.stringify({ subject: report.subject, content: report.content }), () => true);
  }
  omittedRecords += Math.max(0, reports.length - 16);
  for (const eid of query(world, [Agent, Name])) {
    if (!Agent.active[eid]) continue;
    const actor = reference(eid), roomEid = getRoomForEntity(world, eid), room = reference(roomEid);
    if (!actor || roomEid !== undefined && !room) continue;
    issue("actor_presence", actor.name, { room: room?.name ?? null, container: null }, () => actor.current()
      && hasComponent(world, eid, Agent) && Agent.active[eid] && getRoomForEntity(world, eid) === roomEid
      && (roomEid === undefined || !!room?.current() && hasComponent(world, roomEid, Room)));
  }
  for (const eid of query(world, [Room, Name])) {
    const room = reference(eid);
    if (room) issue("place", room.name, room.name, () => room.current() && hasComponent(world, eid, Room));
  }
  const objects = new Set([...query(world, [PhysicalObject, Name]), ...query(world, [StimulusSource, Name])]);
  for (const eid of objects) {
    if (hasComponent(world, eid, Agent)) continue;
    const object = reference(eid); if (!object) continue;
    const currentObject = () => object.current() && (hasComponent(world, eid, PhysicalObject) || hasComponent(world, eid, StimulusSource));
    const roomEid = getRoomForEntity(world, eid), room = reference(roomEid);
    const containerEid = getDirectContainer(world, eid), container = reference(containerEid);
    if ((roomEid === undefined || room) && (containerEid === undefined || container)) {
      issue("object_placement", object.name, { room: room?.name ?? null, container: container?.name ?? null }, () => currentObject()
        && getRoomForEntity(world, eid) === roomEid && getDirectContainer(world, eid) === containerEid
        && (roomEid === undefined || !!room?.current() && hasComponent(world, roomEid, Room))
        && (containerEid === undefined || !!container?.current()));
    }
    const state = hasComponent(world, eid, ObjectState) ? ObjectState.current[eid] : undefined;
    if (typeof state === "string" && state.length <= 128) issue("object_state", object.name, state,
      () => currentObject() && hasComponent(world, eid, ObjectState) && ObjectState.current[eid] === state);
    const description = hasComponent(world, eid, Description) ? Description.value[eid] : undefined;
    if (typeof description === "string" && description.length <= 1000) issue("object_description", object.name, description,
      () => currentObject() && hasComponent(world, eid, Description) && Description.value[eid] === description);
  }
  return {
    records: Object.freeze(records), omittedRecords,
    bind(ids) {
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 8 || new Set(ids).size !== ids.length
        || ids.some(id => typeof id !== "string" || !guards.has(id))) return;
      // Copy the actual predicates, not a mutable model response array.
      const selected = ids.map(id => guards.get(id)!);
      return () => { try { return selected.every(current => current()); } catch { return false; } };
    },
    bindCited(ids) {
      const valid = Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === "string" && guards.has(id)))].slice(0, 8) : [];
      const selected = valid.map(id => guards.get(id)!);
      return { cited: selected.length, current: () => { try { return selected.every(current => current()); } catch { return false; } } };
    },
    guardFor(kind, subject) {
      const record = records.find(row => row.kind === kind && row.subject === subject);
      return record ? guards.get(record.id) : undefined;
    },
  };
}
