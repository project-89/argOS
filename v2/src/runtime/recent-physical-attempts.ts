/** Read-only public executor evidence. Neither a goal verdict nor an emotion. */
import { entityExists, hasComponent } from "bitecs";
import { Agent, WorkingMemoryIdentity } from "../ecs/components";
import type { World } from "../ecs/world";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "./committed-events";

export type RecentPhysicalAttempts = {
  consecutiveFailures: number;
  status: "pending" | "succeeded" | "failed";
  executionId: string;
};

export function getRecentPhysicalAttempts(world: World, actorId: number): RecentPhysicalAttempts | undefined {
  if (!entityExists(world, actorId) || !hasComponent(world, actorId, Agent)
    || !hasComponent(world, actorId, WorkingMemoryIdentity)) return undefined;
  const source = getCommittedEvents(world), now = readSimulationTime(world);
  if (source.stopped) return undefined;
  const owner = WorkingMemoryIdentity.id[actorId];
  const attempts = source.events.filter(event => event.kind === "action" && event.actorId === actorId && event.actorKey === owner
    && event.sourceId === source.sourceId && event.atSimMs <= now && now - event.atSimMs <= 60_000).slice(-32).reverse();
  if (!attempts[0]) return undefined;
  const seen = new Set<string>(); let consecutiveFailures = 0;
  for (const attempt of attempts) {
    if (seen.has(attempt.executionId)) continue;
    seen.add(attempt.executionId);
    if (attempt.status !== "failed") break;
    consecutiveFailures++;
  }
  return { consecutiveFailures, status: attempts[0].status, executionId: attempts[0].executionId };
}

export function hasRepeatedPhysicalFailures(attempts?: RecentPhysicalAttempts): boolean {
  return attempts?.status === "failed" && attempts.consecutiveFailures >= 2;
}
