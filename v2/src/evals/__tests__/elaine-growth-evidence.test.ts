import { completedArrival, completedPhoneRead, completedPhoneReply, observedDiningIntention } from "../elaine-growth-evidence";
import type { ActorIntentionEvidence } from "../../spirits/actor-intention-evidence";
import type { PublicCommittedEvent } from "../../runtime/committed-events";
import type { SitcomEvent } from "../../demo/apartment-sitcom";
import { ApartmentSitcom } from "../../demo/apartment-sitcom";
import { getCommittedEvents, subscribeCommittedEvents } from "../../runtime/committed-events";
import { workingMemoryEntityRef } from "../../cognition/working-memory";
import type { ActorContinuation } from "../../cognition/actor-continuation";
import { integrateActorContinuation, snapshotActorContinuation } from "../../cognition/actor-continuation";
import { createIntentGoal } from "../../cognition/cognition-system";
import { captureActorIntentionEvidence } from "../../spirits/actor-intention-evidence";

const intention: ActorIntentionEvidence = { ref: "intention:one", causalKey: "basis:one", actor: "Elaine", actorKey: "elaine",
  observedRoom: "Kitchen", kind: "goal", goalKey: "goal:dining", description: "Choose a nearby restaurant for dinner" };
const phone: SitcomEvent = { sequence: 1, tick: 2, atSimMs: 1000, kind: "phone_read", visibility: "private",
  actor: "Elaine", text: "read", status: "succeeded", messageId: 10 };
const arrival = { id: "event:1", sequence: 1, sourceId: "world:1", actorKey: "elaine", actorId: 1, kind: "action",
  action: "move", status: "succeeded", atSimMs: 6000, startedAtSimMs: 3000, completedAtSimMs: 6000,
  targetKey: "restaurant" } as PublicCommittedEvent;
const scope = { sourceId: "world:1", actorKey: "elaine", destinationKey: "restaurant", afterSimMs: 1000, minTravelMs: 3000 };
const selected: ActorContinuation = { revision: 1, purpose: "Go outside to find somewhere to eat", actionType: "move", target: "Street",
  status: "dispatched", observedAtSimMs: 2000, integratedAtSimMs: 2500, goalKey: "goal:dining", goalId: 12 };
const travel = { departure: { ...arrival, targetKey: "street" }, sourceId: "world:1", streetKey: "street", streetName: "Street", selected };

test("a notification, foreign actor purpose or cookie intention is not an observed dining intention", () => {
  expect(observedDiningIntention([intention], "elaine", undefined)).toBeUndefined();
  expect(observedDiningIntention([intention], "other", 1000)).toBeUndefined();
  expect(observedDiningIntention([{ ...intention, description: "Resolve the cookie dispute" }], "elaine", 1000)).toBeUndefined();
});
test.each(["Reply to Alex and coordinate our dinner plans", "Choose a nearby restaurant for dinner"])("a saved goal alone is not a chosen physical destination: %s", description => {
  expect(observedDiningIntention([{ ...intention, description }], "elaine", 1000)).toBeUndefined();
});
test("demand requires native outward travel serving the actor's fresh selected dining intention", () => {
  const purpose = { ...intention, kind: "selected_purpose" as const, ref: "intention:two", description: selected.purpose };
  const rows = Object.freeze([purpose, intention]);
  expect(observedDiningIntention(rows, "elaine", 1000, travel)).toBe(intention);
  const independent = { ...purpose, goalKey: undefined, description: "Go out to find a restaurant" };
  expect(observedDiningIntention([independent], "elaine", 1000, {
    ...travel, selected: { ...selected, goalKey: undefined, goalId: undefined, purpose: independent.description },
  })).toBe(independent);
});
test.each(["phone action", "unselected goal", "old choice", "future choice", "invalidated choice", "other target", "foreign source", "uncompleted travel"])("demand discovery rejects %s without authorizing growth", invalid => {
  const observed = structuredClone(travel);
  if (invalid === "phone action") observed.selected.actionType = "interact";
  if (invalid === "unselected goal") observed.selected.goalKey = "other-goal";
  if (invalid === "old choice") observed.selected.observedAtSimMs = 0;
  if (invalid === "future choice") observed.selected.integratedAtSimMs = 7000;
  if (invalid === "invalidated choice") observed.selected.status = "needs_revision";
  if (invalid === "other target") observed.selected.target = "Kitchen";
  if (invalid === "foreign source") observed.departure.sourceId = "world:other";
  if (invalid === "uncompleted travel") observed.departure.status = "pending";
  expect(observedDiningIntention([intention], "elaine", 1000, observed)).toBeUndefined();
});
test("read/reply require native completion and the right message/actor/time", () => {
  expect(completedPhoneRead([phone], 10, 500)).toBe(phone);
  for (const patch of [{ messageId: 11 }, { actor: "Jerry" as const }, { status: "pending" as const }, { atSimMs: 400 }])
    expect(completedPhoneRead([{ ...phone, ...patch }], 10, 500)).toBeUndefined();
  expect(completedPhoneReply([{ ...phone, kind: "reply_typed" }], 500)).toHaveLength(1);
  expect(completedPhoneReply([{ ...phone, kind: "reply_typed", status: "failed" }, phone], 500)).toEqual([]);
  expect(completedPhoneReply([{ ...phone, kind: "reply_typed" }], 2000)).toEqual([]);
});
test("native arrival requires same source/actor/destination and actual elapsed movement", () => {
  expect(completedArrival(arrival, scope)).toBe(true);
  for (const patch of [{ sourceId: "foreign" }, { actorKey: "replacement" }, { targetKey: "old-room" },
    { status: "pending" as const }, { action: "speak" }, { completedAtSimMs: undefined },
    { startedAtSimMs: 5000 }, { startedAtSimMs: 0 }])
    expect(completedArrival({ ...arrival, ...patch }, scope)).toBe(false);
});

test("real offline phone and route receipts satisfy the observer without inventing actor effects", async () => {
  const t = await ApartmentSitcom.create({ live: false, scenario: "cookie", openNeighborhood: true, outsideTextAtMs: null });
  const events: SitcomEvent[] = [];
  const native: PublicCommittedEvent[] = [];
  const unsubscribe = subscribeCommittedEvents(t.sim.world, event => native.push(event));
  try {
    t.onEvent(event => events.push(event)); await t.start();
    const id = t.text("Would you like to meet for dinner?"); t.advance(200);
    const walk = (target: string) => { t.dispatch("Elaine", { type: "move", target }); t.advance(3000); };
    walk("Kitchen"); t.dispatch("Elaine", { type: "pickup", target: "Elaine's phone" }); t.advance(800);
    t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: "read_phone" }); t.advance(1200);
    const read = completedPhoneRead(events, id, 0)!; expect(read).toBeDefined();
    t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: `reply ${JSON.stringify({ replyTo: id, text: "On my way." })}` });
    t.advance(8000);
    const reply = completedPhoneReply(events, read.atSimMs)[0]; expect(reply).toBeDefined();
    expect(t.snapshot().phone.find(m => m.id === reply.messageId)).toMatchObject({ direction: "out", replyTo: id, status: "delivered" });
    walk("Living Room"); walk("Hallway");
    const goal = createIntentGoal(t.sim.world, t.ids.Elaine, "Choose a nearby restaurant for dinner", 7);
    const goalKey = captureActorIntentionEvidence(t.sim.world).records.find(r => r.kind === "goal" && r.description === "Choose a nearby restaurant for dinner")!.goalKey;
    expect(goalKey).toBeDefined();
    integrateActorContinuation(t.sim.world, t.ids.Elaine, { purpose: "Go out to find somewhere to eat", actionType: "move", target: "Street",
      goalId: goal, goalKey, observedAtSimMs: t.elapsedMs });
    const choice = snapshotActorContinuation(t.sim.world, t.ids.Elaine)!;
    walk("Street");
    const ledger = getCommittedEvents(t.sim.world);
    expect(ledger.events.some(event => completedArrival(event, { sourceId: ledger.sourceId!,
      actorKey: workingMemoryEntityRef(t.sim.world, t.ids.Elaine)!.key,
      destinationKey: workingMemoryEntityRef(t.sim.world, t.ids.street)!.key, afterSimMs: read.atSimMs, minTravelMs: 3000 }))).toBe(true);
    const actorKey = workingMemoryEntityRef(t.sim.world, t.ids.Elaine)!.key, streetKey = workingMemoryEntityRef(t.sim.world, t.ids.street)!.key;
    const departure = ledger.events.find(event => completedArrival(event, { sourceId: ledger.sourceId!, actorKey, destinationKey: streetKey,
      afterSimMs: read.atSimMs, minTravelMs: 3000 }))!;
    expect(observedDiningIntention(captureActorIntentionEvidence(t.sim.world).records, actorKey, read.atSimMs,
      { departure, sourceId: ledger.sourceId!, streetKey, streetName: "Street", selected: choice })?.description).toBe("Choose a nearby restaurant for dinner");
    t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: `reply ${JSON.stringify({ replyTo: id, text: "This second reply is still being typed when the world stops." })}` });
    t.advance(100); const stoppedAt = t.elapsedMs; t.stop(); await t.sim.drainPendingOperations();
    expect(t.elapsedMs).toBe(stoppedAt);
    expect(completedPhoneReply(events, read.atSimMs)).toEqual([reply]);
    expect(native.some(e => e.actorId === t.ids.Elaine && e.kind === "action" && e.operation === "typing" && e.status === "failed")).toBe(true);
    expect(t.snapshot().phone.filter(m => m.direction === "out")).toHaveLength(1);
  } finally { t.stop(); unsubscribe(); }
});
