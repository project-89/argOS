import { addComponent, entityExists, hasComponent } from "bitecs";
import { Agent, CommunicationMemory, Name, WorkingMemoryIdentity } from "../ecs/components";
import type { World } from "../ecs/world";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { workingMemoryEntityRef } from "./working-memory";

export interface PrivateCommunicationReceipt {
  id: string; medium: "text"; channel: string; speaker: string; target: string;
  content: string; own: boolean; atMs: number; atSimMs: number;
  sentAtSimMs: number; deliveredAtSimMs?: number;
  room?: never; simulation?: never;
}
const bounded = (v: unknown, n = 300): v is string => typeof v === "string" && !!v.trim() && v.length <= n;
const time = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
export function isPrivateCommunicationReceipt(v: any): v is PrivateCommunicationReceipt {
  return !!v && v.medium === "text" && bounded(v.id) && bounded(v.channel) && bounded(v.speaker)
    && bounded(v.target) && bounded(v.content, 2000) && typeof v.own === "boolean"
    && time(v.atMs) && time(v.atSimMs) && time(v.sentAtSimMs) && v.sentAtSimMs <= v.atSimMs
    && (v.deliveredAtSimMs === undefined ? v.own : time(v.deliveredAtSimMs)
      && v.deliveredAtSimMs >= v.sentAtSimMs && v.deliveredAtSimMs <= v.atSimMs)
    && v.room === undefined && v.simulation === undefined;
}
export function getPrivateCommunications(world: World, eid: number): PrivateCommunicationReceipt[] {
  if (!entityExists(world, eid) || !hasComponent(world, eid, Agent) || !hasComponent(world, eid, CommunicationMemory)
    || !hasComponent(world, eid, WorkingMemoryIdentity) || CommunicationMemory.ownerKey[eid] !== WorkingMemoryIdentity.id[eid]) return [];
  try {
    const rows = JSON.parse(CommunicationMemory.receiptsJson[eid]);
    return Array.isArray(rows) && rows.length <= 64 && rows.every(isPrivateCommunicationReceipt) ? rows : [];
  } catch { return []; }
}
/** Trusted transport boundary only: invoke after actual send or personal read.
 * It records evidence, never delivers a message, chooses a goal or speaks. */
export function recordPrivateCommunication(world: World, eid: number, input: {
  sourceId: string; messageKey: string; channel: string; kind: "sent" | "read";
  other: string; content: string; sentAtSimMs: number; deliveredAtSimMs?: number;
}): PrivateCommunicationReceipt | undefined {
  assertSimulationTaskActive();
  const tape = getCommittedEvents(world);
  if (!entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid]
    || tape.stopped || input.sourceId !== tape.sourceId || !bounded(input.messageKey, 180)
    || !["sent", "read"].includes(input.kind)) return;
  const own = input.kind === "sent";
  const row: PrivateCommunicationReceipt = { id: `text:${input.messageKey}:${input.kind}`, medium: "text", channel: input.channel,
    speaker: own ? Name.value[eid] : input.other, target: own ? input.other : Name.value[eid], content: input.content,
    own, atMs: Date.now(), atSimMs: readSimulationTime(world), sentAtSimMs: input.sentAtSimMs,
    ...(input.deliveredAtSimMs === undefined ? {} : { deliveredAtSimMs: input.deliveredAtSimMs }) };
  if (!isPrivateCommunicationReceipt(row)) return;
  const rows = getPrivateCommunications(world, eid), existing = rows.find(r => r.id === row.id);
  if (existing) return; // replay cannot rewrite a personally observed receipt
  workingMemoryEntityRef(world, eid);
  addComponent(world, eid, CommunicationMemory);
  CommunicationMemory.ownerKey[eid] = WorkingMemoryIdentity.id[eid];
  CommunicationMemory.receiptsJson[eid] = JSON.stringify([...rows, row].slice(-64));
  return structuredClone(row);
}
