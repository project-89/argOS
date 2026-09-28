import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { Needs, WorkingMemoryIdentity } from "../../ecs/components";
import { addEntity, removeEntity, hasComponent } from "bitecs";
import { setLocatedIn } from "../../ecs/location";
import { executeActions } from "../../cognition/cognition-system";
import { advanceSimulationTimeline } from "../../runtime/simulation-timeline";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { ObjectManager } from "../../world/object-manager";
import { BakeryOutcomeEvidence, observeBakeryOutcomes, hasBakeryOutcomeFeedback, hasBakeryServiceFeedback, bakeryFoodExists, completedSpeechAfter, type BakeryObservation } from "../bakery-outcome";
import { gatherArchitectContext } from "../../spirits/architect-spirit";
import { workingMemoryEntityRef } from "../../cognition/working-memory";
import { getCommittedEvents } from "../../runtime/committed-events";

function fixture(sharedService = false) {
  const world = createArgosWorld("Bakery evidence"); initializePrefabs(world); startCommittedEvents(world);
  world.meta.aiEnabled = false; world.meta.timedActions = true; world.meta.timedSpeech = true;
  const registry = createSystemRegistry(), room = createRoomEntity(world, { name: "Bakery" });
  const actor = createAgentEntity(world, { name: "Ada", role: "visitor", systemPrompt: "Choose", roomId: room });
  const baker = createAgentEntity(world, { name: "Leo", role: "baker", systemPrompt: "Choose", roomId: room });
  const food = new ObjectManager(world).spawn("food_item", { name: "Loaf", containedIn: room })!;
  Needs.hunger[actor] = 70;
  const observations: BakeryObservation[] = [], observer = observeBakeryOutcomes(world, actor, [food], value => observations.push(value),
    sharedService ? { providerId: baker, roomId: room } : undefined);
  const advance = () => advanceSimulationTimeline(world, 10000, { integrate: () => {} });
  const act = (eid: number, action: any) => { executeActions(world, [{ eid, action }], registry); advance(); };
  return { world, room, actor, baker, food, observations, observer, advance, act };
}

test("post-meal speech counts native terminal speech, not fragments, proposals or an earlier utterance", () => {
  const f = fixture(true);
  f.act(f.actor, { type: "interact", target: "Loaf", content: "eat" });
  const mealAt = f.observer.evidence.meals[0].atSimMs;
  f.act(f.baker, { type: "speak", content: "I hope that was good." });
  const events = getCommittedEvents(f.world).events;
  const endings = events.filter(e => completedSpeechAfter(e, f.baker, mealAt));
  expect(endings).toHaveLength(1);
  const end = endings[0];
  expect(end.kind).toBe("speech");
  expect(completedSpeechAfter({ ...end, kind: "action" }, f.baker, mealAt)).toBe(false);
  expect(completedSpeechAfter({ ...end, text: "good." }, f.baker, mealAt)).toBe(false);
  expect(completedSpeechAfter({ ...end, status: "pending" }, f.baker, mealAt)).toBe(false);
  expect(completedSpeechAfter({ ...end, status: "failed" }, f.baker, mealAt)).toBe(false);
  expect(completedSpeechAfter(end, f.actor, mealAt)).toBe(false);
  expect(completedSpeechAfter(end, f.baker, end.startedAtSimMs!)).toBe(false);
});

test.each([false, true])("native provider release and meal prove shared-room service (visitor picks up: %s), not a handoff or table placement", pickup => {
  const f = fixture(true);
  f.act(f.baker, { type: "pickup", target: "Loaf" }); f.act(f.baker, { type: "drop", target: "Loaf" });
  expect(f.observer.evidence.sharedReleases).toHaveLength(1);
  if (pickup) f.act(f.actor, { type: "pickup", target: "Loaf" });
  f.act(f.actor, { type: "interact", target: "Loaf", content: "eat" });
  expect(f.observer.evidence.serviceMeals).toHaveLength(1);
  expect(f.observer.evidence.serviceMeals[0]).toMatchObject({ path: "shared_room", roomId: f.room });
  expect(f.observer.evidence.handoffThenMeal).toBe(false);
  expect(f.observer.evidence.serviceMeals[0]).not.toHaveProperty("surfaceId");
});
test("initial loose stock remains a meal, not provider-mediated service", () => {
  const f = fixture(true); f.act(f.actor, { type: "interact", target: "Loaf", content: "eat" });
  expect(f.observer.evidence.meals).toHaveLength(1); expect(f.observer.evidence.serviceMeals).toEqual([]);
});
test("reused numeric slots never count as remaining finite food, and observation does not assign identities", () => {
  const f = fixture(), food = { eid: f.food, key: workingMemoryEntityRef(f.world, f.food)!.key };
  expect(bakeryFoodExists(f.world, food)).toBe(true);
  removeEntity(f.world, f.food); const replacement = addEntity(f.world);
  expect(replacement).toBe(f.food);
  expect(bakeryFoodExists(f.world, food)).toBe(false);
  expect(hasComponent(f.world, replacement, WorkingMemoryIdentity)).toBe(false);
});
test.each(["give", "drop"])("prospective service feedback requires exact %s and meal receipts from actual spirit snapshots", async method => {
  const f = fixture(true); f.act(f.baker, { type: "pickup", target: "Loaf" });
  f.act(f.baker, method === "give" ? { type: "give", target: "Ada", content: "Loaf" } : { type: "drop", target: "Loaf" });
  const supplied = await gatherArchitectContext(f.world, createSystemRegistry());
  f.act(f.actor, { type: "interact", target: "Loaf", content: "eat" });
  const eaten = await gatherArchitectContext(f.world, createSystemRegistry());
  expect(f.observer.evidence.serviceMeals[0].path).toBe(method === "give" ? "direct_handoff" : "shared_room");
  expect(hasBakeryServiceFeedback(f.observer.evidence, [supplied, eaten])).toBe(true);
  expect(hasBakeryServiceFeedback(f.observer.evidence, [supplied])).toBe(false);
  f.advance(); f.advance(); f.advance(); f.advance();
  const expired = await gatherArchitectContext(f.world, createSystemRegistry());
  expect(hasBakeryServiceFeedback(f.observer.evidence, [expired])).toBe(false);
  expect(hasBakeryServiceFeedback(f.observer.evidence, [supplied, eaten, expired])).toBe(true);
});
test("observed intervening third-party custody invalidates an earlier shared release", () => {
  const f = fixture(true), third = createAgentEntity(f.world, { name: "Other", role: "visitor", systemPrompt: "Choose", roomId: f.room });
  f.act(f.baker, { type: "pickup", target: "Loaf" }); f.act(f.baker, { type: "drop", target: "Loaf" });
  f.act(third, { type: "pickup", target: "Loaf" }); f.act(third, { type: "drop", target: "Loaf" });
  f.act(f.actor, { type: "interact", target: "Loaf", content: "eat" });
  expect(f.observer.evidence.meals).toHaveLength(1); expect(f.observer.evidence.serviceMeals).toEqual([]);
});
test("shared service cannot consume in another room or after an unreceipted pickup", () => {
  for (const remote of [true, false]) {
    const f = fixture(true); f.act(f.baker, { type: "pickup", target: "Loaf" }); f.act(f.baker, { type: "drop", target: "Loaf" });
    setLocatedIn(f.world, f.food, f.actor);
    if (remote) setLocatedIn(f.world, f.actor, createRoomEntity(f.world, { name: "Elsewhere" }));
    f.act(f.actor, { type: "interact", target: "Loaf", content: "eat" });
    expect(f.observer.evidence.serviceMeals).toEqual([]);
  }
});
test.each(["source", "provider", "room", "target", "failed", "pendingOnly", "notReleased", "missingSnapshot"])(
  "shared service rejects invalid release evidence: %s", change => {
    const f = fixture(true); f.act(f.baker, { type: "pickup", target: "Loaf" }); f.act(f.baker, { type: "drop", target: "Loaf" });
    f.act(f.actor, { type: "interact", target: "Loaf", content: "eat" });
    const scope = { sourceId: getCommittedEvents(f.world).sourceId!, providerId: f.baker,
      providerKey: workingMemoryEntityRef(f.world, f.baker)!.key, roomId: f.room, roomKey: workingMemoryEntityRef(f.world, f.room)!.key };
    const evidence = new BakeryOutcomeEvidence(workingMemoryEntityRef(f.world, f.actor)!.key, f.actor, scope);
    for (const raw of f.observations) {
      const row = structuredClone(raw);
      if (row.event.action === "drop") {
        if (change === "source") row.event = { ...row.event, sourceId: "another-world" };
        if (change === "provider") row.event = { ...row.event, actorKey: "replacement-provider" };
        if (change === "room") row.event = { ...row.event, roomKey: "replacement-room" };
        if (change === "target") row.event = { ...row.event, targetKey: "another-food" };
        if (change === "failed" && row.event.status === "succeeded") row.event = { ...row.event, status: "failed" };
        if (change === "pendingOnly" && row.event.status === "succeeded") continue;
        if (change === "notReleased") row.foods[0].holder = f.baker;
        if (change === "missingSnapshot") row.foods = [];
      }
      evidence.observe(row);
    }
    expect(evidence.serviceMeals).toEqual([]);
  });
test("served meal selection retains every causal chain, not only the first course", () => {
  const evidence = new BakeryOutcomeEvidence("Ada", 1);
  const meal = (foodKey: string, atSimMs: number) => ({ foodKey, atSimMs, eventId: `meal-${foodKey}`, executionId: `eat-${foodKey}`, hungerBefore: 70, hungerAfter: 40 });
  const handoff = (foodKey: string, atSimMs: number) => ({ foodKey, atSimMs, eventId: `give-${foodKey}`, executionId: `give-${foodKey}`, giverId: 2 });
  evidence.meals.push(meal("first", 10000), meal("second", 55000), meal("self-service", 60000), meal("given-too-late", 65000));
  evidence.handoffs.push(handoff("first", 5000), handoff("second", 50000), handoff("given-too-late", 70000));
  const before = structuredClone(evidence.meals);
  expect(evidence.servedMeals.map(m => m.eventId)).toEqual(["meal-first", "meal-second"]);
  const recent = [{ id: "meal-second", status: "succeeded" }];
  expect(evidence.servedMeals.some(m => recent.some(r => r.id === m.eventId && r.status === "succeeded"))).toBe(true);
  expect(evidence.meals).toEqual(before); expect(evidence.handoffThenMeal).toBe(true);
});
test("native pickup, give and generic eat prove a real handoff and meal without invented eat labels", () => {
  const f = fixture(); f.act(f.baker, { type: "pickup", target: "Loaf" });
  f.act(f.baker, { type: "give", target: "Ada", content: "Loaf" });
  expect(f.observer.evidence.handoffs).toHaveLength(1); expect(f.observer.evidence.handoffThenMeal).toBe(false);
  f.act(f.actor, { type: "interact", target: "Loaf", content: "eat" });
  expect(f.observer.evidence.handoffThenMeal).toBe(true); expect(f.observer.evidence.meals).toHaveLength(1);
  expect(Needs.hunger[f.actor]).toBe(40); expect(f.observer.errors).toEqual([]);
  expect(f.observations.some(row => row.event.action === "eat")).toBe(false);
});
test("spoken service and failed inaccessible consumption are not food outcomes", () => {
  const f = fixture(); f.act(f.baker, { type: "pickup", target: "Loaf" });
  f.act(f.baker, { type: "speak", content: "Here is your bread. You have eaten it." });
  f.act(f.actor, { type: "interact", target: "Loaf", content: "eat" });
  expect(f.observer.evidence.handoffs).toEqual([]); expect(f.observer.evidence.meals).toEqual([]);
});
test("self-service can prove eating but cannot satisfy the separate handoff gate", () => {
  const f = fixture(); f.act(f.actor, { type: "interact", target: "Loaf", content: "eat" });
  expect(f.observer.evidence.meals).toHaveLength(1); expect(f.observer.evidence.handoffThenMeal).toBe(false);
});
test("a changed target during a timed meal cannot count as successful consumption", () => {
  const f = fixture(); executeActions(f.world, [{ eid: f.actor, action: { type: "interact", target: "Loaf", content: "eat" } }], createSystemRegistry());
  setLocatedIn(f.world, f.food, f.baker); f.advance();
  expect(f.observer.evidence.meals).toEqual([]);
});
test("feedback must contain the actual meal and handoff receipts before they expire", async () => {
  const f = fixture(), registry = createSystemRegistry(); f.act(f.baker, { type: "pickup", target: "Loaf" });
  f.act(f.baker, { type: "give", target: "Ada", content: "Loaf" });
  const given = await gatherArchitectContext(f.world, registry);
  f.act(f.actor, { type: "interact", target: "Loaf", content: "eat" });
  const eaten = await gatherArchitectContext(f.world, registry);
  expect(hasBakeryOutcomeFeedback(f.observer.evidence, [given, eaten], true)).toBe(true);
  expect(hasBakeryOutcomeFeedback(f.observer.evidence, [given], true)).toBe(false);
  expect(hasBakeryOutcomeFeedback(f.observer.evidence, [{ recentEvents: [{ id: "unrelated-speech", status: "succeeded" }] }], false)).toBe(false);
  advanceSimulationTimeline(f.world, 31000, { integrate: () => {} });
  const expired = await gatherArchitectContext(f.world, registry);
  expect(hasBakeryOutcomeFeedback(f.observer.evidence, [expired], false)).toBe(false);
  expect(hasBakeryOutcomeFeedback(f.observer.evidence, [given, eaten, expired], true)).toBe(true);
  stopCommittedEvents(f.world);
  expect(hasBakeryOutcomeFeedback(f.observer.evidence, [await gatherArchitectContext(f.world, registry)], false)).toBe(false);
});
test.each(["wrongActor", "wrongSource", "wrongExecution", "wrongTarget", "wrongTerminalTarget", "failed", "pendingOnly", "noHungerChange", "foodStillExists", "missingFoodTelemetry"])(
  "meal evidence rejects %s", change => {
    const f = fixture(); f.act(f.actor, { type: "interact", target: "Loaf", content: "eat" });
    const rows = f.observations.filter(row => row.event.action === "interact");
    const before = structuredClone(rows.find(row => row.event.status === "pending")!);
    const after = structuredClone(rows.find(row => row.event.status === "succeeded")!);
    const evidence = new BakeryOutcomeEvidence(before.event.actorKey, f.actor);
    if (change === "wrongActor") after.event = { ...after.event, actorKey: "other", actorId: f.baker };
    if (change === "wrongSource") after.event = { ...after.event, sourceId: "other" };
    if (change === "wrongExecution") after.event = { ...after.event, executionId: "other" };
    if (change === "wrongTarget") before.event = { ...before.event, targetKey: "other" };
    if (change === "wrongTerminalTarget") after.event = { ...after.event, targetKey: "other" };
    if (change === "failed") after.event = { ...after.event, status: "failed" };
    if (change === "noHungerChange") after.hunger = before.hunger;
    if (change === "foodStillExists") after.foods[0].exists = true;
    if (change === "missingFoodTelemetry") after.foods = [];
    evidence.observe(before); if (change !== "pendingOnly") evidence.observe(after);
    expect(evidence.meals).toEqual([]);
  });
