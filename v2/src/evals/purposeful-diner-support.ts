/** Bounded evaluation plumbing. Uses the production proposal stage; it never
 * approves proposals, chooses an NPC action, or manufactures an outcome. */
import { hasComponent, query } from "bitecs";
import { Agent, Name, Needs, PhysicalObject, Removed, Room, WorkingMemoryIdentity } from "../ecs/components";
import type { World } from "../ecs/world";
import { getDirectContainer, getRoomForEntity } from "../ecs/location";
import { ObjectManager } from "../world/object-manager";
import { getCommittedEvents, subscribeCommittedEvents } from "../runtime/committed-events";
import { createEvolutionCoordinator, type EvolutionCoordinatorContext } from "../runtime/evolution-coordinator";
import { executeAllApprovedProposals, getCurrentObservedProposals } from "../spirits/architect-spirit";
import { assertDinerRepairFits, type DinerIdentity } from "./iterative-diner-evidence";
import { BakeryOutcomeEvidence, bakeryFoodExists, type BakeryObservation } from "./bakery-outcome";

/** Numeric storage slots retain data after removal. A value without component
 * membership is not this entity's identity; observation must not mint one. */
export function observeDinerIdentity(world: World, eid: number): DinerIdentity {
  const key = (id: number | undefined) => id !== undefined && hasComponent(world, id, WorkingMemoryIdentity)
    ? WorkingMemoryIdentity.id[id] || undefined : undefined;
  return { key: key(eid) ?? `unidentified:${eid}`, name: Name.value[eid],
    kind: hasComponent(world, eid, Room) ? "room" : hasComponent(world, eid, Agent) ? "agent" : "object",
    roomKey: hasComponent(world, eid, Room) ? undefined : key(getRoomForEntity(world, eid)),
    removed: hasComponent(world, eid, Removed) };
}

/** Stop native intervals while their scope is still active, then cancel async
 * work. Return a shutdown error to the evidence writer, never lose the verdict
 * to an exception escaping the observer's timer callback. */
export function stopDinerDiagnostic(controller: AbortController, reason: Error, stopRuntime: () => void): unknown {
  try { stopRuntime(); } catch (error) { return error; }
  finally { controller.abort(reason); }
}

export function createDinerProposalDispatch(context: EvolutionCoordinatorContext, room: number, additions: () => number) {
  const currentApproved = () => getCurrentObservedProposals(context.world).filter(p => p.status === "approved");
  const disabled = Number.MAX_SAFE_INTEGER;
  const coordinator = createEvolutionCoordinator({ autoApproveProposals: false, maxProposalExecutions: 1,
    proposalInterval: 1, crafterInterval: disabled, stewardInterval: disabled, architectInterval: disabled,
    artificerInterval: disabled, lawgiverInterval: disabled, fileRepairInterval: disabled }, {
    getApprovedProposals: currentApproved,
    executeProposals: async (world, registry, options) => {
      // The native executor drains the world's approved queue, including work
      // approved after its originating Weaver cycle. Preflight the whole queue.
      for (const p of currentApproved()) assertDinerRepairFits(p.specification, room, additions());
      return executeAllApprovedProposals(world, registry, options);
    },
  });
  let tick = 0;
  return async () => {
    const approved = currentApproved();
    const status = await coordinator.run(++tick, context);
    if (status.recentErrors.length) throw Error(JSON.stringify(status.recentErrors));
    return { executed: approved.filter(p => p.status === "executed").map(p => p.id),
      failed: approved.filter(p => p.status === "failed").map(p => p.id), status };
  };
}

/** Install before authoring. Native pending events have already minted target
 * identities but have not applied the effect. Discover there as well as after
 * construction, retaining keys after deletion/slot reuse. No identity writes. */
export function observeNewDinerFood(world: World, actor: number, initialKeys: ReadonlySet<string>,
  record: (row: BakeryObservation) => void, onScan: () => void = () => {}) {
  const actorKey = WorkingMemoryIdentity.id[actor], source = getCommittedEvents(world).sourceId;
  if (!actorKey || !source) throw Error("Food observation requires an active source and native actor identity");
  const evidence = new BakeryOutcomeEvidence(actorKey, actor), errors: string[] = [];
  const foods = new Map<string, { eid: number; key: string }>(), objects = new ObjectManager(world);
  const scan = () => {
    if (getCommittedEvents(world).sourceId !== source) throw Error("Food observation source changed");
    onScan();
    for (const eid of query(world, [PhysicalObject, WorkingMemoryIdentity])) {
      const key = WorkingMemoryIdentity.id[eid];
      if (key && !initialKeys.has(key) && !foods.has(key) && !hasComponent(world, eid, Removed) && objects.hasTrait(eid, "edible"))
        foods.set(key, { eid, key });
    }
  };
  const stop = subscribeCommittedEvents(world, event => {
    try {
      if (event.sourceId !== source) throw Error("Food event source changed");
      scan();
      const row: BakeryObservation = { event, hunger: Needs.hunger[actor], foods: [...foods.values()].map(food => {
        const exists = bakeryFoodExists(world, food);
        return { ...food, exists, holder: exists ? getDirectContainer(world, food.eid) : undefined };
      }) };
      evidence.observe(row); record(row);
    } catch (error) { errors.push(String(error)); }
  });
  return { evidence, errors, scan, stop };
}
