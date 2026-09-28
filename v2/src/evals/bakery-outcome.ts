/** Read-only evaluation evidence, not a controller or production event schema.
 * Generic interactions publish `interact`, not their private command arguments.
 * Bind native intervals to before/after physical state instead of parsing prose. */
import { entityExists, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Needs, WorkingMemoryIdentity } from "../ecs/components";
import { getDirectContainer } from "../ecs/location";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { getCommittedEvents, subscribeCommittedEvents, type PublicCommittedEvent } from "../runtime/committed-events";

type FoodState = { eid: number; key: string; exists: boolean; holder?: number };
/** Native speech completes on the speech lane, not as an action-lane receipt.
 * Word fragments and speech that began before the outcome are not a new reply. */
export function completedSpeechAfter(event: PublicCommittedEvent, actorId: number, afterSimMs: number): boolean {
  return event.actorId === actorId && event.kind === "speech" && event.action === "speak"
    && event.status === "succeeded" && event.text === undefined && Number.isFinite(afterSimMs)
    && event.startedAtSimMs !== undefined && event.startedAtSimMs > afterSimMs
    && event.completedAtSimMs !== undefined && event.completedAtSimMs >= event.startedAtSimMs
    && event.atSimMs === event.completedAtSimMs;
}
/** A freed ECS slot can be reused by the consumption feedback itself. Do not
 * count the new occupant as remaining stock or assign it a fresh identity. */
export function bakeryFoodExists(world: World, food: { eid: number; key: string }): boolean {
  return entityExists(world, food.eid) && hasComponent(world, food.eid, WorkingMemoryIdentity)
    && WorkingMemoryIdentity.id[food.eid] === food.key;
}
export type BakeryObservation = { event: PublicCommittedEvent; hunger: number; foods: FoodState[] };
export type BakeryServiceScope = { sourceId: string; providerId: number; providerKey: string; roomId: number; roomKey: string };
type Meal = { eventId: string; executionId: string; foodKey: string; hungerBefore: number; hungerAfter: number; atSimMs: number;
  roomId?: number; roomKey?: string };
type Release = { eventId: string; executionId: string; foodKey: string; providerId: number; roomId: number; atSimMs: number };
export class BakeryOutcomeEvidence {
  private pending = new Map<string, BakeryObservation>();
  private completed = new Set<string>();
  private sharedStock = new Map<string, { release: Release; holder: number }>();
  private sharedMeals: (Meal & { path: "shared_room"; serviceEventId: string; roomId: number })[] = [];
  private lastSequence = 0;
  private lastSimMs = -1;
  private scope?: BakeryServiceScope;
  readonly handoffs: { eventId: string; executionId: string; foodKey: string; giverId: number; atSimMs: number }[] = [];
  readonly meals: Meal[] = [];
  readonly sharedReleases: Release[] = [];
  constructor(private actorKey: string, private actorId: number, scope?: BakeryServiceScope) { this.scope = scope && { ...scope }; }
  observe(observation: BakeryObservation): void {
    const { event } = observation;
    if (this.scope) {
      if (event.sourceId !== this.scope.sourceId || event.sequence <= this.lastSequence || event.atSimMs < this.lastSimMs) return;
      this.lastSequence = event.sequence; this.lastSimMs = event.atSimMs;
    }
    if (event.kind !== "action") { this.observeSharedStock(observation); return; }
    const id = `${event.sourceId}/${event.actorKey}/${event.executionId}`;
    if (this.completed.has(id)) return;
    if (event.status === "pending") {
      if (!this.pending.has(id)) this.pending.set(id, observation);
      this.observeSharedStock(observation);
      return;
    }
    this.completed.add(id);
    const before = this.pending.get(id); this.pending.delete(id);
    if (!before || event.status !== "succeeded" || before.event.action !== event.action || before.event.actorId !== event.actorId
      || event.atSimMs < before.event.atSimMs) { this.observeSharedStock(observation); return; }
    if (event.action === "give" && before.event.targetKey === this.actorKey && event.targetKey === this.actorKey
      && (!this.scope || event.actorId === this.scope.providerId && event.actorKey === this.scope.providerKey
        && this.inServiceRoom(event) && this.inServiceRoom(before.event))) {
      for (const food of before.foods) {
        const after = observation.foods.find(item => item.key === food.key);
        if (food.exists && food.holder === event.actorId && after?.exists && after.holder === this.actorId)
          this.handoffs.push({ eventId: event.id, executionId: event.executionId, foodKey: food.key, giverId: event.actorId, atSimMs: event.atSimMs });
      }
    }
    this.observeSharedStock(observation, before);
    if (event.action !== "interact" || event.actorKey !== this.actorKey || event.actorId !== this.actorId
      || event.targetKey !== undefined && event.targetKey !== before.event.targetKey
      || !Number.isFinite(before.hunger) || !Number.isFinite(observation.hunger)
      || observation.hunger < 0 || observation.hunger >= before.hunger) return;
    const food = before.foods.find(item => item.key === before.event.targetKey && item.exists);
    const after = food && observation.foods.find(item => item.key === food.key);
    // This fixture uses the native food_item eat effect: hunger decreases and
    // that exact food entity is consumed. Missing telemetry is not consumption.
    if (food && after && !after.exists) {
      this.meals.push({ eventId: event.id, executionId: event.executionId, foodKey: food.key, hungerBefore: before.hunger,
        hungerAfter: observation.hunger, atSimMs: event.atSimMs, roomId: event.roomId, roomKey: event.roomKey });
      const available = this.sharedStock.get(food.key);
      if (available && this.inServiceRoom(before.event) && this.inServiceRoom(event) && available.holder === food.holder)
        this.sharedMeals.push({ ...this.meals.at(-1)!, path: "shared_room", serviceEventId: available.release.eventId, roomId: this.scope!.roomId });
      this.sharedStock.delete(food.key);
    }
  }
  private inServiceRoom(event: PublicCommittedEvent) {
    return !!this.scope && event.roomId === this.scope.roomId && event.roomKey === this.scope.roomKey;
  }
  /** Track observed custody, not an inferred promise. Only a native visitor
   * pickup may carry released stock away from the shared room into their hands.
   * No claim about a counter/surface is made by a room-level drop receipt. */
  private observeSharedStock(observation: BakeryObservation, before?: BakeryObservation) {
    if (!this.scope) return;
    const { event } = observation;
    const sameTarget = before && before.event.targetKey === event.targetKey;
    for (const [key, stock] of this.sharedStock) {
      const food = observation.foods.find(f => f.key === key);
      if (food?.exists && food.holder === stock.holder) continue;
      const prior = before?.foods.find(f => f.key === key && f.exists && f.holder === stock.holder);
      const visitor = before && this.inServiceRoom(before.event) && this.inServiceRoom(event)
        && event.actorId === this.actorId && event.actorKey === this.actorKey && before.event.targetKey === key;
      if (visitor && prior && event.action === "pickup" && sameTarget && food?.exists && food.holder === this.actorId
        && stock.holder === this.scope.roomId) { stock.holder = this.actorId; continue; }
      // Leave the final consumption candidate for the independently checked
      // native meal below; missing snapshots are never consumption evidence.
      if (visitor && prior && event.action === "interact" && (event.targetKey === undefined || sameTarget) && food && !food.exists) continue;
      this.sharedStock.delete(key);
    }
    if (!before || event.action !== "drop" || !sameTarget || !this.inServiceRoom(before.event) || !this.inServiceRoom(event)
      || event.actorId !== this.scope.providerId || event.actorKey !== this.scope.providerKey) return;
    const food = before.foods.find(f => f.key === event.targetKey && f.exists && f.holder === this.scope!.providerId);
    const after = food && observation.foods.find(f => f.key === food.key && f.exists && f.holder === this.scope!.roomId);
    if (!food || !after) return;
    const release = { eventId: event.id, executionId: event.executionId, foodKey: food.key,
      providerId: event.actorId, roomId: event.roomId, atSimMs: event.atSimMs };
    this.sharedReleases.push(release); this.sharedStock.set(food.key, { release, holder: this.scope.roomId });
  }
  get handoffThenMeal(): boolean {
    return this.servedMeals.length > 0;
  }
  get servedMeals() {
    return this.meals.filter(meal => this.handoffs.some(handoff => handoff.foodKey === meal.foodKey && handoff.atSimMs <= meal.atSimMs));
  }
  /** Prospective v3 only. Legacy servedMeals/handoffThenMeal keep their meaning. */
  get serviceMeals() {
    const direct = this.servedMeals.filter(meal => !this.scope || meal.roomId === this.scope.roomId && meal.roomKey === this.scope.roomKey)
      .map(meal => ({ ...meal, path: "direct_handoff" as const,
        serviceEventId: this.handoffs.find(h => h.foodKey === meal.foodKey && h.atSimMs <= meal.atSimMs)!.eventId }));
    return [...direct, ...this.sharedMeals.filter(meal => !direct.some(d => d.eventId === meal.eventId))];
  }
}

/** Receipt identity, not a nonempty context containing unrelated conversation.
 * Inputs are snapshots actually gathered while running, never a reconstructed
 * claim that a spirit saw an event after its freshness window expired. */
export function hasBakeryOutcomeFeedback(evidence: BakeryOutcomeEvidence,
  observations: { recentEvents: { id: string; status: string }[] }[], requireHandoff: boolean): boolean {
  const seen = new Set(observations.flatMap(context => context.recentEvents.filter(event => event.status === "succeeded").map(event => event.id)));
  return evidence.meals.some(meal => seen.has(meal.eventId) && (!requireHandoff || evidence.handoffs.some(handoff =>
    handoff.foodKey === meal.foodKey && handoff.atSimMs <= meal.atSimMs && seen.has(handoff.eventId))));
}

export function hasBakeryServiceFeedback(evidence: BakeryOutcomeEvidence,
  observations: { recentEvents: { id: string; status: string }[] }[]): boolean {
  const seen = new Set(observations.flatMap(context => context.recentEvents.filter(e => e.status === "succeeded").map(e => e.id)));
  return evidence.serviceMeals.some(meal => seen.has(meal.eventId) && seen.has(meal.serviceEventId));
}

export function observeBakeryOutcomes(world: World, actorId: number, foodIds: number[],
  record: (observation: BakeryObservation) => void, service?: { providerId: number; roomId: number }) {
  const scope = service && { ...service, sourceId: getCommittedEvents(world).sourceId!,
    providerKey: workingMemoryEntityRef(world, service.providerId)!.key, roomKey: workingMemoryEntityRef(world, service.roomId)!.key };
  if (scope && !scope.sourceId) throw Error("Service observation needs an active committed source");
  const evidence = new BakeryOutcomeEvidence(workingMemoryEntityRef(world, actorId)!.key, actorId, scope);
  const foods = foodIds.map(eid => ({ eid, key: workingMemoryEntityRef(world, eid)!.key }));
  const errors: string[] = [];
  const stop = subscribeCommittedEvents(world, event => {
    try {
      const observation: BakeryObservation = { event, hunger: Needs.hunger[actorId], foods: foods.map(food => {
        const exists = bakeryFoodExists(world, food);
        return { ...food, exists, ...(exists ? { holder: getDirectContainer(world, food.eid) } : {}) };
      }) };
      record(observation); evidence.observe(observation);
    } catch (error) { errors.push(String(error)); }
  });
  return { evidence, errors, stop };
}
