import { jest } from "@jest/globals";
import { addEntity, removeEntity } from "bitecs";
import { Needs, ObjectState, WorkingMemoryIdentity } from "../../ecs/components";
import { getDirectContainer, getRoomForEntity, setLocatedIn } from "../../ecs/location";
import { createArgosWorld } from "../../ecs/world";
import { createObjectEntity, initializePrefabs } from "../../ecs/prefabs";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { attachToEntity, getComponent } from "../../ecs/component-registry";
import { buildAgentContext, getAgentMemory } from "../../cognition/agent-mind";
import { commitPreparedAffectUpdate, prepareAffectUpdate, snapshotAffect } from "../../cognition/affect-state";
import { getAgentVisualEntities, getAgentWorldCapabilities, getObservedStateFields } from "../../cognition/world-capabilities";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { snapshotAttentionSignals } from "../../cognition/unresolved-attention";
import { getCommittedEvents, startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { deserializeWorld, serializeWorld } from "../../persistence/world-persistence";
import { ApartmentSitcom, type SitcomCharacter } from "../apartment-sitcom";

let testbed: ApartmentSitcom | undefined;
beforeEach(() => {
  drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("World alternatives are offline physical-law tests, never model or H3 calls."));
});
afterEach(() => {
  testbed?.stop(); testbed = undefined;
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli();
});
async function create() {
  testbed = await ApartmentSitcom.create({ scenario: "duet", live: false, outsideTextAtMs: null });
  await testbed.start(); return testbed;
}
function move(t: ApartmentSitcom, actor: SitcomCharacter, destination: string, id: number) {
  const from = getRoomForEntity(t.sim.world, t.ids[actor]);
  t.dispatch(actor, { type: "move", target: destination }); t.advance(2999);
  expect(getRoomForEntity(t.sim.world, t.ids[actor])).toBe(from);
  t.advance(1); expect(getRoomForEntity(t.sim.world, t.ids[actor])).toBe(id);
}
function take(t: ApartmentSitcom, actor: SitcomCharacter, target: string, id: number) {
  const from = getDirectContainer(t.sim.world, id);
  t.dispatch(actor, { type: "pickup", target }); t.advance(799);
  expect(getDirectContainer(t.sim.world, id)).toBe(from);
  t.advance(1); expect(getDirectContainer(t.sim.world, id)).toBe(t.ids[actor]);
}
function pour(t: ApartmentSitcom, actor: SitcomCharacter = "Elaine") {
  t.dispatch(actor, { type: "interact", target: "Coffee pot", content: "pour" });
}
function drink(t: ApartmentSitcom, actor: SitcomCharacter = "Elaine", target = "Blue mug") {
  t.dispatch(actor, { type: "interact", target, content: "drink" });
}
async function heldMug() {
  const t = await create(); move(t, "Elaine", "Kitchen", t.ids.kitchen);
  take(t, "Elaine", "Blue mug", t.ids.blueMug); return t;
}
function menu(t: ApartmentSitcom, actor: SitcomCharacter, target: number) {
  return getAgentWorldCapabilities(t.sim.world, t.ids[actor])!.affordances!(target).map(value => value.name);
}
function successes(t: ApartmentSitcom, verb: string) {
  const operation = verb === "pour" ? "pouring" : "drinking";
  return getCommittedEvents(t.sim.world).events.filter(event => event.kind === "action" && event.status === "succeeded" && event.operation === operation);
}
function cues(t: ApartmentSitcom, actor: SitcomCharacter) {
  return t.snapshot().events.filter(event => event.kind === "perception" && event.actor === actor && event.text.includes("double vibration"));
}

test("four real scenes expose local finite coffee, not remote props or a compulsory new activity", async () => {
  const t = await create(), scenes = t.scenes();
  expect(scenes.map(scene => scene.room.name).sort()).toEqual(["Hallway", "Kitchen", "Living Room", "Street"]);
  expect(scenes.find(scene => scene.room.id === t.ids.kitchen)!.props.map(prop => prop.id)).toEqual(expect.arrayContaining([t.ids.coffee, t.ids.blueMug, t.ids.redMug]));
  for (const actor of t.characters) {
    expect(getAgentVisualEntities(t.sim.world, t.ids[actor])).not.toContain(t.ids.coffee);
    expect(menu(t, actor, t.ids.coffee)).not.toContain("pour");
    expect(getObservedStateFields(t.sim.world, t.ids[actor], t.ids.coffee)).toEqual([]);
  }
  expect(t.coffee.portions[t.ids.coffee]).toBe(4);
  for (const mug of [t.ids.blueMug, t.ids.redMug]) {
    expect(t.cup.filled[mug]).toBe(false); expect(t.cup.drinks[mug]).toBe(0);
    expect(getDirectContainer(t.sim.world, mug)).toBe(t.ids.counter);
  }
  t.advance(20_000);
  expect(t.coffee.portions[t.ids.coffee]).toBe(4);
  expect(getRoomForEntity(t.sim.world, t.ids.Elaine)).toBe(t.ids.living);
  expect(t.snapshot().events.some(event => event.kind === "action" && event.status === "succeeded")).toBe(false);
});

test("pour and drink commit once at their actual 2s/3s boundaries; drinking is not grief resolution", async () => {
  const t = await heldMug(), w = t.sim.world, eid = t.ids.Elaine;
  const affect = prepareAffectUpdate(w, eid, { feeling: "hurt and grieving", valence: -.8, arousal: .8,
    reason: "PRIVATE_GRIEF_STILL_MATTERS", expression: "lips pressed" });
  expect(affect).not.toBeNull(); expect(commitPreparedAffectUpdate(w, eid, affect!)).toBe(true);
  const before = snapshotAffect(w, eid); Needs.energy[eid] = 50;
  expect(menu(t, "Elaine", t.ids.coffee)).toContain("pour");
  expect(menu(t, "Jerry", t.ids.coffee)).not.toContain("pour");
  expect(getObservedStateFields(w, eid, t.ids.coffee)).toEqual([expect.objectContaining({ slot: "Observable.coffee_available", value: "true" })]);
  expect(getObservedStateFields(w, eid, t.ids.blueMug)).toEqual([expect.objectContaining({ slot: "Observable.coffee_filled", value: "false" })]);
  pour(t); t.advance(1999);
  expect(t.coffee.portions[t.ids.coffee]).toBe(4); expect(t.cup.filled[t.ids.blueMug]).toBe(false);
  t.advance(1);
  expect(t.coffee.portions[t.ids.coffee]).toBe(3); expect(t.cup.filled[t.ids.blueMug]).toBe(true);
  expect(getObservedStateFields(w, eid, t.ids.blueMug)).toEqual([expect.objectContaining({ slot: "Observable.coffee_filled", value: "true" })]);
  expect(menu(t, "Elaine", t.ids.coffee)).not.toContain("pour"); expect(menu(t, "Elaine", t.ids.blueMug)).toContain("drink");
  drink(t); t.advance(2999);
  expect(t.cup.filled[t.ids.blueMug]).toBe(true); expect(t.cup.drinks[t.ids.blueMug]).toBe(0); expect(Needs.energy[eid]).toBe(50);
  t.advance(1);
  expect(t.cup.filled[t.ids.blueMug]).toBe(false); expect(t.cup.drinks[t.ids.blueMug]).toBe(1); expect(Needs.energy[eid]).toBe(52);
  expect(ObjectState.current[t.ids.blueMug]).toBe("empty"); expect(snapshotAffect(w, eid)).toEqual(before);
  expect(getObservedStateFields(w, eid, t.ids.blueMug)).toEqual([expect.objectContaining({ slot: "Observable.coffee_filled", value: "false" })]);
  expect(successes(t, "pour")).toHaveLength(1); expect(successes(t, "drink")).toHaveLength(1);
  expect(JSON.stringify(t.scenes())).not.toContain("PRIVATE_GRIEF_STILL_MATTERS");
  expect(buildAgentContext(w, t.ids.Jerry)).not.toContain("PRIVATE_GRIEF_STILL_MATTERS");
  expect(JSON.stringify(getObservedStateFields(w, eid))).not.toContain("PRIVATE_GRIEF_STILL_MATTERS");
  t.advance(10_000); expect(t.cup.drinks[t.ids.blueMug]).toBe(1); expect(t.coffee.portions[t.ids.coffee]).toBe(3);
});

test("four portions are conserved, energy clamps at 100, and an empty pot or cup cannot create another effect", async () => {
  const t = await heldMug(); Needs.energy[t.ids.Elaine] = 99;
  for (let remaining = 3; remaining >= 0; remaining--) {
    pour(t); t.advance(2000); expect(t.coffee.portions[t.ids.coffee]).toBe(remaining);
    drink(t); t.advance(3000); expect(Needs.energy[t.ids.Elaine]).toBe(100);
  }
  expect(t.cup.drinks[t.ids.blueMug]).toBe(4); expect(successes(t, "pour")).toHaveLength(4); expect(successes(t, "drink")).toHaveLength(4);
  pour(t); t.advance(2000); drink(t); t.advance(3000);
  expect(t.coffee.portions[t.ids.coffee]).toBe(0); expect(t.cup.filled[t.ids.blueMug]).toBe(false); expect(t.cup.drinks[t.ids.blueMug]).toBe(4);
  expect(successes(t, "pour")).toHaveLength(4); expect(successes(t, "drink")).toHaveLength(4);
});

test("a pour requires exactly one held empty mug, not an empty mug elsewhere or ambiguous vessels", async () => {
  const t = await create(); move(t, "Elaine", "Kitchen", t.ids.kitchen);
  expect(menu(t, "Elaine", t.ids.coffee)).not.toContain("pour"); pour(t); t.advance(2000);
  expect(t.coffee.portions[t.ids.coffee]).toBe(4);
  take(t, "Elaine", "Blue mug", t.ids.blueMug); take(t, "Elaine", "Red mug", t.ids.redMug);
  expect(menu(t, "Elaine", t.ids.coffee)).not.toContain("pour"); t.advance(5000); pour(t); t.advance(2000);
  expect(t.coffee.portions[t.ids.coffee]).toBe(4); expect(t.cup.filled[t.ids.blueMug]).toBe(false); expect(t.cup.filled[t.ids.redMug]).toBe(false);
});

test.each(["drop mug", "change supply", "move pot support", "remove pot", "replace pot identity", "replace mug identity", "leave room", "replace owner", "restart source", "stop source"] as const)(
  "a pending pour cannot survive %s", async cause => {
    const t = await heldMug(), w = t.sim.world, { coffee, blueMug, Elaine, kitchen } = t.ids;
    pour(t); t.advance(500);
    if (cause === "drop mug") setLocatedIn(w, blueMug, t.ids.counter);
    if (cause === "change supply") t.coffee.portions[coffee] = 3;
    if (cause === "move pot support") setLocatedIn(w, coffee, kitchen);
    if (cause === "remove pot") removeEntity(w, coffee);
    if (cause === "replace pot identity") WorkingMemoryIdentity.id[coffee] = "replacement-pot-lifetime";
    if (cause === "replace mug identity") WorkingMemoryIdentity.id[blueMug] = "replacement-mug-lifetime";
    if (cause === "leave room") setLocatedIn(w, Elaine, t.ids.living);
    if (cause === "replace owner") WorkingMemoryIdentity.id[Elaine] = "replacement-person-lifetime";
    if (cause === "restart source" || cause === "stop source") stopCommittedEvents(w);
    if (cause === "restart source") startCommittedEvents(w);
    t.advance(1500);
    expect(t.coffee.portions[coffee]).toBe(cause === "change supply" ? 3 : 4);
    expect(t.cup.filled[blueMug]).toBe(false); expect(t.cup.drinks[blueMug]).toBe(0); expect(successes(t, "pour")).toHaveLength(0);
  },
);

test("removing a pending mug and creating a same-named replacement cannot fill the replacement", async () => {
  const t = await heldMug(), w = t.sim.world; pour(t); t.advance(500);
  removeEntity(w, t.ids.blueMug);
  const replacement = createObjectEntity(w, { name: "Blue mug", roomId: t.ids.kitchen, portable: true, traits: ["takeable"] });
  attachToEntity(w, replacement, "SitcomCup", { filled: false, drinks: 0 }); setLocatedIn(w, replacement, t.ids.Elaine);
  t.advance(1500); expect(t.coffee.portions[t.ids.coffee]).toBe(4); expect(t.cup.filled[replacement]).toBe(false);
  expect(t.cup.drinks[replacement]).toBe(0); expect(successes(t, "pour")).toHaveLength(0);
});

test.each(["drop mug", "edit drinks", "replace mug identity"] as const)("a pending drink revalidates %s without caffeine or false completion", async cause => {
  const t = await heldMug(); pour(t); t.advance(2000); Needs.energy[t.ids.Elaine] = 50;
  drink(t); t.advance(500);
  if (cause === "drop mug") setLocatedIn(t.sim.world, t.ids.blueMug, t.ids.counter);
  if (cause === "edit drinks") t.cup.drinks[t.ids.blueMug] = 7;
  if (cause === "replace mug identity") WorkingMemoryIdentity.id[t.ids.blueMug] = "new-mug";
  t.advance(2500); expect(t.cup.filled[t.ids.blueMug]).toBe(true); expect(Needs.energy[t.ids.Elaine]).toBe(50);
  expect(t.cup.drinks[t.ids.blueMug]).toBe(cause === "edit drinks" ? 7 : 0); expect(successes(t, "drink")).toHaveLength(0);
});

test("two actors cannot pour concurrently from one pot and manufacture a second portion", async () => {
  const t = await heldMug(); move(t, "Jerry", "Kitchen", t.ids.kitchen); take(t, "Jerry", "Red mug", t.ids.redMug);
  pour(t, "Elaine"); pour(t, "Jerry"); t.advance(1999);
  expect(t.coffee.portions[t.ids.coffee]).toBe(4); expect(t.cup.filled[t.ids.blueMug]).toBe(false); expect(t.cup.filled[t.ids.redMug]).toBe(false);
  t.advance(1); expect(t.coffee.portions[t.ids.coffee]).toBe(3); expect(t.cup.filled[t.ids.blueMug]).toBe(true); expect(t.cup.filled[t.ids.redMug]).toBe(false);
  expect(successes(t, "pour")).toHaveLength(1);
  expect(t.snapshot().events.some(event => event.actor === "Jerry" && event.action?.content === "pour" && event.status === "failed")).toBe(true);
});

test("carried phone follows real room transitions; hallway/street cues are local and never reveal unread contents", async () => {
  const t = await create(), w = t.sim.world, secret = "PRIVATE_UNREAD_STREET_661";
  move(t, "Elaine", "Kitchen", t.ids.kitchen); take(t, "Elaine", "Elaine's phone", t.ids.phone);
  move(t, "Elaine", "Living Room", t.ids.living); move(t, "Elaine", "Hallway", t.ids.hallway);
  expect(getRoomForEntity(w, t.ids.phone)).toBe(t.ids.hallway);
  t.text(secret); t.advance(200);
  expect(cues(t, "Elaine")).toHaveLength(1); expect(cues(t, "Jerry")).toHaveLength(0);
  t.advance(6000); expect(cues(t, "Elaine")).toHaveLength(2); expect(cues(t, "Jerry")).toHaveLength(0);
  move(t, "Jerry", "Hallway", t.ids.hallway); t.advance(3000);
  expect(cues(t, "Jerry")).toHaveLength(1);
  move(t, "Elaine", "Street", t.ids.street); const jerryBefore = cues(t, "Jerry").length;
  t.advance(6000); expect(cues(t, "Jerry")).toHaveLength(jerryBefore); expect(cues(t, "Elaine").length).toBeGreaterThan(3);
  expect(getRoomForEntity(w, t.ids.phone)).toBe(t.ids.street);
  expect(t.scenes().find(scene => scene.room.id === t.ids.street)!.props).toEqual(expect.arrayContaining([expect.objectContaining({ id: t.ids.phone, heldBy: t.ids.Elaine })]));
  for (const actor of t.characters) {
    expect(snapshotAttentionSignals(w, t.ids[actor]).some(signal => signal.source === "phone vibration")).toBe(true);
    const knowledge = [t.context(actor), buildAgentContext(w, t.ids[actor]), JSON.stringify(getAgentMemory(w, t.ids[actor]))].join("\n");
    expect(knowledge).not.toContain(secret);
  }
  expect(JSON.stringify(t.scenes())).not.toContain(secret);
});

test("open Kitchen/Living Room doorway still carries a phone cue to both sides", async () => {
  const t = await create(); move(t, "Elaine", "Kitchen", t.ids.kitchen);
  t.text("PRIVATE_ACROSS_DOORWAY"); t.advance(200);
  expect(cues(t, "Elaine")).toHaveLength(1); expect(cues(t, "Jerry")).toHaveLength(1);
  expect(cues(t, "Jerry")[0].text).toContain("from the Kitchen");
  expect(t.context("Jerry")).not.toContain("PRIVATE_ACROSS_DOORWAY");
});

test("completed finite cup/coffee state and actual possession survive serialization and entity remapping", async () => {
  const t = await heldMug(); pour(t); t.advance(2000); drink(t); t.advance(3000); pour(t); t.advance(2000);
  const saved = JSON.parse(JSON.stringify(serializeWorld(t.sim.world, t.sim.god.systemRegistry)));
  // This proves completed ECS state persistence, not resumption of a class callback or pending operation.
  t.stop(); const restored = createArgosWorld("Restored coffee state"); initializePrefabs(restored);
  for (let index = 0; index < 100; index++) addEntity(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved);
  const mug = oldToNewId.get(t.ids.blueMug)!, pot = oldToNewId.get(t.ids.coffee)!, actor = oldToNewId.get(t.ids.Elaine)!;
  expect(mug).not.toBe(t.ids.blueMug); expect(getComponent("SitcomCoffee")!.portions[pot]).toBe(2);
  expect(getComponent("SitcomCup")!.filled[mug]).toBe(true); expect(getComponent("SitcomCup")!.drinks[mug]).toBe(1);
  expect(getDirectContainer(restored, mug)).toBe(actor); expect(ObjectState.current[mug]).toBe("filled with coffee");
});
