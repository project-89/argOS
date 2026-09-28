/** Opt-in evaluation perturbation. Changes physical truth, never actor cognition. */
import { ObjectState, WorkingMemoryIdentity } from "../ecs/components";
import { getCommittedEvents } from "../runtime/committed-events";
import { getSimulationBodyActivity } from "../runtime/simulation-timeline";
import type { ApartmentSitcom } from "./apartment-sitcom";

export class CoffeeIntervention {
  private applied?: { status: "applied"; sourceId: string; atSimMs: number; actorId: number;
    executionId: string; targetId: number; targetKey: string; before: number; after: number };
  snapshot() { return this.applied ? { ...this.applied } : { status: "not_triggered" as const }; }

  poll(t: ApartmentSitcom): boolean {
    if (this.applied || !t.running) return false;
    const world = t.sim.world, ledger = getCommittedEvents(world), target = t.ids.coffee;
    if (ledger.stopped || !ledger.sourceId || !(t.coffee.portions[target] > 0)) return false;
    // Inspect the newest action per actor. A historical pending row is not
    // authority to interrupt a later action, nor evidence that a pour is live.
    const seen = new Set<number>();
    for (const event of [...ledger.events].reverse()) {
      if (event.kind !== "action" || seen.has(event.actorId)) continue;
      seen.add(event.actorId);
      if (event.status !== "pending" || event.operation !== "pouring" || event.targetId !== target
        || event.sourceId !== ledger.sourceId || event.actorKey !== WorkingMemoryIdentity.id[event.actorId]
        || event.targetKey !== WorkingMemoryIdentity.id[target]
        || event.expectedEndSimMs === undefined || event.expectedEndSimMs <= t.elapsedMs) continue;
      const body = getSimulationBodyActivity(world, event.actorId);
      if (body?.kind !== "operating" || body.operation !== "pouring" || body.targetEid !== target) continue;
      this.applied = { status: "applied", sourceId: ledger.sourceId, atSimMs: t.elapsedMs,
        actorId: event.actorId, executionId: event.executionId, targetId: target,
        targetKey: event.targetKey!, before: t.coffee.portions[target], after: 0 };
      t.coffee.portions[target] = 0;
      ObjectState.current[target] = "empty";
      return true;
    }
    return false;
  }
}
