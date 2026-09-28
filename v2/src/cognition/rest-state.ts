/** Rest is an ongoing physical state. Choosing it does not instantly restore energy. */
import { addComponent, entityExists, hasComponent, query } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, InCombat, Needs, RestState } from "../ecs/components";
import { queueStimulus } from "./stimulus-queue";

export const REST_ENERGY_PER_SECOND = 2;

/** Read-only, including when used by foreground eligibility and other systems. */
export function isResting(world: World, eid: number): boolean {
  return entityExists(world, eid) && hasComponent(world, eid, Agent) && Agent.active[eid]
    && hasComponent(world, eid, Needs) && hasComponent(world, eid, RestState) && RestState.active[eid] === true
    && !(hasComponent(world, eid, InCombat) && InCombat.targetEid[eid] >= 0);
}

/** Called only after native action admission; records intent/state, not completion proof. */
export function beginRest(world: World, eid: number): boolean {
  if (!entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid]
    || !hasComponent(world, eid, Needs) || !Number.isFinite(Needs.energy[eid])
    || (hasComponent(world, eid, InCombat) && InCombat.targetEid[eid] >= 0)) return false;
  if (isResting(world, eid)) return true;
  addComponent(world, eid, RestState);
  RestState.active[eid] = true;
  RestState.startedAt[eid] = Date.now();
  RestState.lastUpdatedAt[eid] = Date.now();
  RestState.recoveryNotified[eid] = Needs.energy[eid] >= 100;
  return true;
}

/** An admitted competing action can stop recovery without claiming it finished. */
export function endRest(world: World, eid: number): void {
  if (!entityExists(world, eid) || !hasComponent(world, eid, RestState)) return;
  RestState.active[eid] = false;
  RestState.lastUpdatedAt[eid] = Date.now();
}

/** Called once per ECS tick with simulation milliseconds, not wall-clock pause time.
 * Fractional and large steps integrate the same rate. Nothing accrues while the
 * simulation is stopped, and loading a snapshot does not replay missed time. */
export function updateRestState(world: World, deltaMs: number): void {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
  for (const eid of query(world, [Agent, Needs, RestState])) {
    if (!RestState.active[eid]) continue;
    if (!isResting(world, eid) || !Number.isFinite(Needs.energy[eid])) { endRest(world, eid); continue; }
    const previousEnergy = Needs.energy[eid];
    Needs.energy[eid] = Math.min(100, Math.max(0, previousEnergy) + REST_ENERGY_PER_SECOND * deltaMs / 1000);
    RestState.lastUpdatedAt[eid] = Date.now();
    if (previousEnergy < 100 && Needs.energy[eid] >= 100 && !RestState.recoveryNotified[eid]) {
      RestState.recoveryNotified[eid] = true;
      queueStimulus(world, { targetEid: eid, type: "rest_complete", modality: "cognitive", source: "body",
        content: "You feel rested. Your energy has recovered.", intensity: 0.4 });
    }
    // Recovery is not an instruction to get up. Rest remains inhabited until
    // an admitted competing action ends it, so idle need decay cannot create
    // a recover/stand/fatigue/recover loop at the full-energy threshold.
  }
}
