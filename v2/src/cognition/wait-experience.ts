/** In-session elapsed experience of an actual wait, not an event prediction or
 * a scheduler lease. Restore deliberately begins a new observation interval. */
import { entityExists, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Name, WorkingMemoryIdentity } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { isSimulationResourceBusy } from "../runtime/simulation-timeline";
import { getAgentWorldCapabilities, getAgentWorldCapabilityGeneration } from "./world-capabilities";
import { workingMemoryEntityRef } from "./working-memory";
import { snapshotActorContinuation } from "./actor-continuation";
import { snapshotOngoingActivity } from "./ongoing-activity";

type Scope = { basis: string; generation: object | undefined };
type Episode = Scope & { startedAtSimMs: number; lastWaitAtSimMs: number; waitChoices: number };
const episodes = new WeakMap<World, Map<number, Episode>>();
// These native acts can accompany waiting in place. This classifies elapsed
// experience, not motor permission, listening authority or a future event.
const waitAccompaniments = new Set(["think", "reflect", "observe", "examine", "speak"]);
function scope(world: World, eid: number): Scope | undefined {
  const source = getCommittedEvents(world);
  if (source.stopped || !entityExists(world, eid) || !hasComponent(world, eid, Agent)
    || !Agent.active[eid] || !hasComponent(world, eid, WorkingMemoryIdentity)) return;
  const room = getRoomForEntity(world, eid);
  const activity = snapshotOngoingActivity(world, eid);
  return { basis: JSON.stringify([source.sourceId, WorkingMemoryIdentity.id[eid], Name.value[eid],
    Agent.role[eid], Agent.systemPrompt[eid], room, room === undefined ? null : WorkingMemoryIdentity.id[room],
    snapshotActorContinuation(world, eid)?.goalKey,
    activity && [activity.id, activity.status, activity.needsRevalidation]]),
    generation: getAgentWorldCapabilityGeneration(world, eid) };
}
function current(world: World, eid: number): Episode | undefined {
  const row = episodes.get(world)?.get(eid), now = readSimulationTime(world), basis = scope(world, eid);
  if (row && basis && row.basis === basis.basis && row.generation === basis.generation && now >= row.lastWaitAtSimMs) return row;
  // Once an intervening change is observed, returning to the old room/activity
  // cannot resurrect that earlier interval.
  if (row) episodes.get(world)?.delete(eid);
}
export function recordWaitExperience(world: World, eid: number, action: { type: string }, outcome: { succeeded: boolean; pending: boolean }): void {
  assertSimulationTaskActive();
  if (action.type !== "wait") {
    if (waitAccompaniments.has(action.type)) current(world, eid);
    else episodes.get(world)?.delete(eid);
    return;
  }
  if (!outcome.succeeded || outcome.pending) return;
  if (!workingMemoryEntityRef(world, eid)) return;
  const room = getRoomForEntity(world, eid);
  // Capture place identity when the interval begins, not lazily during a later
  // look (which would otherwise appear to replace the room under a valid wait).
  if (room !== undefined && !workingMemoryEntityRef(world, room)) return;
  const basis = scope(world, eid); if (!basis) return;
  const now = readSimulationTime(world), prior = current(world, eid);
  let rows = episodes.get(world); if (!rows) { rows = new Map(); episodes.set(world, rows); }
  rows.set(eid, { ...basis, startedAtSimMs: prior?.startedAtSimMs ?? now,
    lastWaitAtSimMs: now, waitChoices: (prior?.waitChoices ?? 0) + 1 });
}
export function snapshotWaitExperience(world: World, eid: number) {
  const row = current(world, eid);
  if (!row || isSimulationResourceBusy(world, eid, "body") || getAgentWorldCapabilities(world, eid)?.busy()) return;
  return { startedAtSimMs: row.startedAtSimMs, elapsedSimMs: readSimulationTime(world) - row.startedAtSimMs,
    waitChoices: row.waitChoices };
}
export function formatWaitExperience(world: World, eid: number): string {
  const value = snapshotWaitExperience(world, eid); if (!value) return "";
  return `CURRENT WAIT (your own elapsed experience): ${JSON.stringify(value)}\nElapsed simulation time and repeated wait choices do not establish that an expected event is scheduled or will occur.`;
}
