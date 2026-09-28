/** Short motor plans retain exact targets and source lifetime, not predicted
 * observations. Their runtime authority is deliberately not restored from JSON. */
import { randomUUID } from "node:crypto";
import { entityExists, hasComponent } from "bitecs";
import { Agent, Name, WorkingMemoryIdentity } from "../ecs/components";
import type { World } from "../ecs/world";
import { getCommittedEvents } from "../runtime/committed-events";
import { readSimulationTime } from "../ecs/simulation-time";
import { getAgentWorldCapabilityGeneration, getAgentObservableEntities } from "./world-capabilities";

type Step = { actionType: string; target?: string; content?: string };
const signature = (step: Step) => JSON.stringify([step.actionType, step.target, step.content]);
const scopes = new WeakMap<World, Map<string, { eid: number; until: number; steps: Set<string>;
  targets: readonly { eid: number; key: string; name: string }[]; current: () => boolean }>>();
export function createMotorPlanScope(world: World, eid: number, targets: readonly { eid: number; key: string; name: string }[], steps: readonly Step[]): string {
  const key = WorkingMemoryIdentity.id[eid], source = getCommittedEvents(world).sourceId;
  const persona = JSON.stringify([Name.value[eid], Agent.role[eid], Agent.systemPrompt[eid]]);
  const generation = getAgentWorldCapabilityGeneration(world, eid), start = readSimulationTime(world);
  let rows = scopes.get(world); if (!rows) { rows = new Map(); scopes.set(world, rows); }
  for (const [id, row] of rows) if (row.until < start || !row.current()) rows.delete(id);
  if (rows.size >= 1024) rows.delete(rows.keys().next().value!);
  const id = randomUUID(), until = start + 30_000;
  rows.set(id, { eid, until, targets: targets.map(t => ({ ...t })), steps: new Set(steps.map(signature)), current: () => !getCommittedEvents(world).stopped && getCommittedEvents(world).sourceId === source
    && readSimulationTime(world) >= start && readSimulationTime(world) <= until
    && entityExists(world, eid) && hasComponent(world, eid, Agent) && Agent.active[eid]
    && WorkingMemoryIdentity.id[eid] === key && getAgentWorldCapabilityGeneration(world, eid) === generation
    && JSON.stringify([Name.value[eid], Agent.role[eid], Agent.systemPrompt[eid]]) === persona
    && targets.every(target => entityExists(world, target.eid) && hasComponent(world, target.eid, WorkingMemoryIdentity)
      && WorkingMemoryIdentity.id[target.eid] === target.key && Name.value[target.eid] === target.name) });
  return id;
}
export function isMotorPlanScopeCurrent(world: World, eid: number, scope: unknown, step?: Step): boolean {
  const row = typeof scope === "string" ? scopes.get(world)?.get(scope) : undefined;
  if (!row || row.eid !== eid || !row.current()) return false;
  if (!step) return true;
  if (!row.steps.has(signature(step))) return false;
  const expected = row.targets.find(target => target.name === step.target);
  const reachable = getAgentObservableEntities(world, eid).filter(id => Name.value[id] === step.target);
  return !!expected && reachable.length === 1 && reachable[0] === expected.eid
    && WorkingMemoryIdentity.id[reachable[0]] === expected.key;
}
