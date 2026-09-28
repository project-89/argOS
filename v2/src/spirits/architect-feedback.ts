/** Bounded author-only admission feedback. A rejected design is useful context
 * for a later cycle, never a construction citation or public NPC perception. */
import type { World } from "../ecs/world";
import { getCommittedEvents } from "../runtime/committed-events";
import { readSimulationTime } from "../ecs/simulation-time";

export interface ArchitectDesignFeedback {
  atSimMs: number;
  type: string;
  description: string;
  reason: string;
  problem?: string;
  requirementIds: string[];
}
type Entry = { feedback: ArchitectDesignFeedback; actor: object; sourceId: string; atWallMs: number; current: () => boolean };
const histories = new WeakMap<World, Entry[]>();
const MAX_ENTRIES = 20, MAX_AGE_MS = 120000;

export function recordArchitectDesignFeedback(world: World, actor: object,
  input: Omit<ArchitectDesignFeedback, "atSimMs">, current: () => boolean): void {
  const source = getCommittedEvents(world), at = readSimulationTime(world);
  if (source.stopped || !source.sourceId || !Number.isFinite(at) || !current()) return;
  const entries = histories.get(world) ?? [];
  entries.push({ actor, sourceId: source.sourceId, atWallMs: Date.now(), current,
    feedback: { atSimMs: at, type: input.type, description: input.description.slice(0, 500),
      reason: input.reason, problem: input.problem?.slice(0, 600), requirementIds: input.requirementIds.slice(0, 24) } });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  histories.set(world, entries);
}

export function getArchitectDesignFeedback(world: World, actor: object): ArchitectDesignFeedback[] {
  const source = getCommittedEvents(world), now = readSimulationTime(world), wall = Date.now();
  const entries = (histories.get(world) ?? []).filter(entry => {
    try { return !source.stopped && source.sourceId === entry.sourceId
      && now >= entry.feedback.atSimMs && now - entry.feedback.atSimMs <= MAX_AGE_MS
      && wall >= entry.atWallMs && wall - entry.atWallMs <= MAX_AGE_MS && entry.current(); }
    catch { return false; }
  });
  histories.set(world, entries);
  return entries.filter(entry => entry.actor === actor).slice(-8).map(entry => structuredClone(entry.feedback));
}
