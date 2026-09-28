/** Native terminal-effect projection into the existing actor-owned ledger.
 * Kept below action/planning admission: the world executor must not import a
 * controller (or its module-initialization graph) merely to record an outcome. */
import { entityExists, hasComponent, query } from "bitecs";
import { randomUUID } from "node:crypto";
import type { World } from "../ecs/world";
import { Agent, WorkingMemoryIdentity } from "../ecs/components";
import { isEntityPresent } from "../ecs/entity-presence";
import { getRoomForEntity } from "../ecs/location";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { getAgentSensoryCapabilities } from "./sensory-capabilities";
import { getAgentVisibleEntities, getAgentVisualEntities, getObservedHeldItemExteriors, getAgentWorldCapabilityGeneration } from "./world-capabilities";
import { getWorkingMemory, recordWorkingMemoryEvidence, workingMemoryEntityRef } from "./working-memory";

const liveActor = (world: World, eid: number) => isEntityPresent(world, eid) && hasComponent(world, eid, Agent) && Agent.active[eid];

/** Capture visibility BEFORE native destruction, then admit only after that
 * exact lifetime ends. No command arguments, inferred cause or execution credit.
 * Ordinary missing targets and failed/pending interactions never call this hook. */
export function captureWorkingMemoryRemoval(world: World, target: number, actorEid?: number): () => void {
  assertSimulationTaskActive();
  if (!isEntityPresent(world, target)) return () => {};
  const item = workingMemoryEntityRef(world, target); if (!item) return () => {};
  const source = getCommittedEvents(world), time = readSimulationTime(world);
  if (source.stopped) return () => {};
  const observers = [...query(world, [Agent])].flatMap(eid => {
    if (!liveActor(world, eid)) return [];
    const own = eid === actorEid && getAgentVisibleEntities(world, eid).includes(target);
    const seen = getAgentVisualEntities(world, eid).includes(target)
      || getObservedHeldItemExteriors(world, eid).some(item => item.eid === target);
    if (!own && !seen) return [];
    const ref = workingMemoryEntityRef(world, eid); if (!ref) return [];
    return [{ eid, key: ref.key, room: getRoomForEntity(world, eid), own, generation: getAgentWorldCapabilityGeneration(world, eid) }];
  });
  let available = true;
  queueMicrotask(() => { available = false; }); // Never a deferred observation authority.
  return () => {
    assertSimulationTaskActive();
    if (!available) return; available = false;
    const current = getCommittedEvents(world);
    // The native caller records immediately after removeEntity, before any
    // allocation. A changed/missing identity on a still-live slot is NOT proof
    // of destruction; do not infer removal from arbitrary component edits.
    if (current.stopped || current.sourceId !== source.sourceId || readSimulationTime(world) !== time || entityExists(world, target)) return;
    const id = `removal:${randomUUID()}`;
    for (const observer of observers) {
      if (!liveActor(world, observer.eid) || !hasComponent(world, observer.eid, WorkingMemoryIdentity)
        || WorkingMemoryIdentity.id[observer.eid] !== observer.key || getRoomForEntity(world, observer.eid) !== observer.room
        || getAgentWorldCapabilityGeneration(world, observer.eid) !== observer.generation
        || !observer.own && getAgentSensoryCapabilities(world, observer.eid).visual <= 0) continue;
      const memory = getWorkingMemory(world, observer.eid);
      // Same ordering convention as ordinary physical observations, including
      // restored evidence and multiple outcomes in one wall-clock millisecond.
      const atMs = Math.max(Date.now(), memory.evidenceFloorMs + .001,
        ...memory.facts.map(f => f.observedAt + .001), ...memory.receipts.map(r => r.atMs + .001));
      recordWorkingMemoryEvidence(world, observer.eid, { id, atMs, kind: "action", succeeded: true,
        provenance: observer.own ? "own_action" : "witnessed_action",
        summary: `${item.label} was removed; that object is no longer available.`,
        facts: [{ subject: item.key, subjectLabel: item.label, predicate: "state", slot: "Entity.lifecycle", value: "removed" }] });
    }
  };
}
