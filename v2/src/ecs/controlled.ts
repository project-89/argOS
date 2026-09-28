/** Operator possession: a human drives this body. While `Controlled` is present
 * the resident's own foreground cognition, subconscious planning/review and
 * daemon whispers do not run; perception, heard speech, social memory and
 * experience appraisal keep accumulating so the resident remembers what its
 * body lived through. Control confers no extra world power: every act still
 * goes through the same native executors and admission checks.
 *
 * The component is session state (see components.ts): never persisted. */
import { addComponent, entityExists, hasComponent, query, removeComponent } from "bitecs";
import type { World } from "./world";
import { Agent, Controlled, Mind } from "./components";
import { readSimulationTime } from "./simulation-time";

export type Controller = "operator";

/** The one choke point readiness probes call. */
export function isOperatorControlled(world: World, eid: number): boolean {
  return entityExists(world, eid) && hasComponent(world, eid, Controlled);
}

/** A body with no mind of its own (e.g. the operator's visitor) or a possessed
 * one: in both cases nothing but the operator should decide or whisper for it. */
export function hasOwnMindSuspended(world: World, eid: number): boolean {
  return isOperatorControlled(world, eid) || (entityExists(world, eid) && hasComponent(world, eid, Agent) && !hasComponent(world, eid, Mind));
}

export function getControlledBodies(world: World): number[] {
  return [...query(world, [Agent, Controlled])].filter(eid => entityExists(world, eid));
}

/** Possess exactly one body. Any previous operator body is released first. */
export function takeControl(world: World, eid: number, controller: Controller = "operator"): number[] {
  if (!entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid]) throw Error("Only a present, active body can be controlled");
  const released = getControlledBodies(world).filter(other => other !== eid);
  for (const other of released) releaseControl(world, other);
  if (!hasComponent(world, eid, Controlled)) {
    addComponent(world, eid, Controlled);
    Controlled.controller[eid] = controller;
    Controlled.sinceSimMs[eid] = readSimulationTime(world);
  }
  return released;
}

export function releaseControl(world: World, eid: number): boolean {
  if (!entityExists(world, eid) || !hasComponent(world, eid, Controlled)) return false;
  removeComponent(world, eid, Controlled);
  // Sparse SoA residue must not look like control for a recycled EID.
  delete Controlled.controller[eid]; delete Controlled.sinceSimMs[eid];
  return true;
}
