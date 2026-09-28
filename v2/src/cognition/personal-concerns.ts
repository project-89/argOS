import { addComponent, entityExists, hasComponent } from "bitecs";
import { Agent, PersonalConcerns, WorkingMemoryIdentity } from "../ecs/components";
import type { World } from "../ecs/world";
import { readSimulationTime } from "../ecs/simulation-time";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { getCommittedEvents } from "../runtime/committed-events";

/** Latest private interpretation per experienced channel. Importance ranks recall;
 * it does not decide whether an ordinary experience may prompt deliberation. */
export interface PersonalConcern {
  channel: string; evidenceIds: string[]; appraisal: string; significance: string;
  importance: number; appraisedAtSimMs: number;
  /** Receipt time, not inference completion time. Absent in legacy saves. */
  experiencedAtSimMs?: number;
  integration?: "current" | "historical_only";
}
function actor(world: World, eid: number): boolean {
  return entityExists(world, eid) && hasComponent(world, eid, Agent) && Agent.active[eid]
    && hasComponent(world, eid, WorkingMemoryIdentity) && !!WorkingMemoryIdentity.id[eid];
}
function valid(c: PersonalConcern): boolean {
  return !!c && typeof c.channel === "string" && c.channel.length > 0 && c.channel.length <= 128
    && typeof c.appraisal === "string" && c.appraisal.trim().length > 0 && c.appraisal.length <= 800
    && typeof c.significance === "string" && c.significance.length <= 300
    && Number.isFinite(c.importance) && c.importance >= 0 && c.importance <= 1
    && Number.isFinite(c.appraisedAtSimMs) && c.appraisedAtSimMs >= 0
    && (c.experiencedAtSimMs === undefined || Number.isFinite(c.experiencedAtSimMs)
      && c.experiencedAtSimMs >= 0 && c.experiencedAtSimMs <= c.appraisedAtSimMs)
    && (c.integration === undefined || c.integration === "current" || c.integration === "historical_only")
    && Array.isArray(c.evidenceIds) && c.evidenceIds.length > 0 && c.evidenceIds.length <= 8
    && c.evidenceIds.every(id => typeof id === "string" && id.length > 0 && id.length <= 160);
}
export function getPersonalConcerns(world: World, eid: number): PersonalConcern[] {
  if (!actor(world, eid) || !hasComponent(world, eid, PersonalConcerns) || PersonalConcerns.ownerKey[eid] !== WorkingMemoryIdentity.id[eid]) return [];
  try {
    const rows = JSON.parse(PersonalConcerns.itemsJson[eid]);
    return Array.isArray(rows) ? rows.filter(c => valid(c) && c.appraisedAtSimMs <= readSimulationTime(world)).slice(-8) : [];
  } catch { return []; }
}
/** Trusted appraisal commit only. Caller supplies actual receipt IDs, never an
 * unread message or a foreground assertion. No goal, action, or public event. */
export function recordPersonalConcern(world: World, eid: number, input: PersonalConcern): boolean {
  assertSimulationTaskActive();
  if (!actor(world, eid) || getCommittedEvents(world).stopped || !valid(input) || input.appraisedAtSimMs > readSimulationTime(world)) return false;
  const previous = getPersonalConcerns(world, eid);
  if (previous.some(c => c.channel === input.channel && c.appraisedAtSimMs > input.appraisedAtSimMs)) return false;
  const prior = previous.find(c => c.channel === input.channel);
  if (prior && (prior.evidenceIds.length === input.evidenceIds.length && prior.evidenceIds.every(id => input.evidenceIds.includes(id))
    || prior.experiencedAtSimMs !== undefined && input.experiencedAtSimMs !== undefined
      && input.experiencedAtSimMs < prior.experiencedAtSimMs)) return false;
  const rows = previous.filter(c => c.channel !== input.channel);
  // A calm interpretation replaces an intense one without erasing the evidence
  // before personal review can consider it. This small latest-channel buffer is
  // not the long-term memory store. New experience wins retention, not arousal.
  rows.push(structuredClone(input));
  rows.sort((a, b) => a.appraisedAtSimMs - b.appraisedAtSimMs);
  addComponent(world, eid, PersonalConcerns); PersonalConcerns.ownerKey[eid] = WorkingMemoryIdentity.id[eid];
  PersonalConcerns.itemsJson[eid] = JSON.stringify(rows.slice(-8));
  return true;
}
/** Prompt-only projection. Age does not mutate the concern or its review
 * revision. Legacy receipt age is unknown; wall-clock latency is never lived time. */
export function personalConcernContext(world: World, eid: number) {
  const now = readSimulationTime(world);
  return getPersonalConcerns(world, eid).map(c => ({ ...c,
    experienceAgeSeconds: c.experiencedAtSimMs === undefined ? null : Math.max(0, Math.floor((now - c.experiencedAtSimMs) / 1000)),
    appraisalAgeSeconds: Math.max(0, Math.floor((now - c.appraisedAtSimMs) / 1000)),
  }));
}
export function formatPersonalConcerns(world: World, eid: number): string {
  const rows = personalConcernContext(world, eid).sort((a, b) => b.importance - a.importance || b.appraisedAtSimMs - a.appraisedAtSimMs).slice(0, 3);
  return rows.length ? `RECENT PERSONAL APPRAISALS (private interpretations, not current facts about others):\n`
    + rows.map(c => JSON.stringify(c)).join("\n")
    + "\nA paused next step need not settle what this experience means to you. Other people only know what they actually perceived; keeping it private, seeking company, or choosing another response remain your decisions."
    : "";
}
