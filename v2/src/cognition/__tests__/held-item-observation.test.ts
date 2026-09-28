import { jest } from "@jest/globals";
import { addComponent, addEntity, hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { EquipSlot, Name, ObjectState, Description, Traits, WorkingMemoryIdentity } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { ObjectManager } from "../../world/object-manager";
import { executeEffect } from "../../world/effect-executor";
import { worldSchema } from "../../world/schema";
import { executeActions } from "../cognition-system";
import { getAgentVisualEntities, getObservedHeldItemExteriors } from "../world-capabilities";
import { captureWorkingMemoryObservation } from "../working-memory-observation";
import { getWorkingMemory, workingMemoryEntityRef, formatWorkingMemoryContext } from "../working-memory";
import { generateStimuliForAgent, getAgentSensoryFingerprint } from "../sensory-system";
import { captureCognitiveLocalView, formatCognitiveLocalView, areLocalDependenciesCurrent } from "../cognitive-local-view";
import { advanceSimulationTimeline, reserveSimulationResources, releaseSimulationResources } from "../../runtime/simulation-timeline";
import { startCommittedEvents } from "../../runtime/committed-events";
import { snapshotCharacterAppearance, tryHoldCarriedItem, tryStowCarriedItem } from "../../rendering/character-appearance";
import { getAvailableAffordances } from "../../world/affordance-availability";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";

function fixture() {
  const world = createArgosWorld("Held item witnesses"); initializePrefabs(world); world.meta.aiEnabled = false;
  world.meta.timedActions = true; startCommittedEvents(world);
  const registry = createSystemRegistry(), room = createRoomEntity(world, { name: "Bakery" }), away = createRoomEntity(world, { name: "Outside" });
  const actor = (name: string, roomId = room) => createAgentEntity(world, { name, roomId, role: "resident", systemPrompt: "Choose" });
  const ada = actor("Ada"), baker = actor("Julian"), blind = actor("Blind"), remote = actor("Remote", away);
  addComponent(world, blind, Traits); Traits.active[blind] = '["blind"]';
  const food = new ObjectManager(world).spawn("food_item", { name: "Bread", containedIn: baker })!;
  const key = workingMemoryEntityRef(world, food)!.key;
  const facts = (who: number) => getWorkingMemory(world, who).facts.filter(f => f.subject === key);
  const advance = () => advanceSimulationTimeline(world, world.time.elapsed + 2000, { integrate: () => {} });
  const act = (who: number, action: any) => { executeActions(world, [{ eid: who, action }], registry); advance(); };
  const destroy = () => executeEffect({ type: "destroy", target: "target" }, { world, actorEid: ada, targetEid: food, worldSchema,
    registry: { byName: new Map([["Bread", food]]), byId: new Map([[food, "Bread"]]) } });
  return { world, registry, room, away, ada, baker, blind, remote, food, key, facts, advance, act, destroy };
}
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("No live calls")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("native handoff then timed eating updates a sighted witness, not blind or remote observers", () => {
  const f = fixture(); f.act(f.baker, { type: "give", target: "Ada", content: "Bread" });
  expect(snapshotCharacterAppearance(f.world, f.ada)?.heldItems.map(i => i.eid)).toContain(f.food);
  captureWorkingMemoryObservation(f.world, f.baker);
  expect(f.facts(f.baker)).toContainEqual(expect.objectContaining({ predicate: "location", valueLabel: "Ada" }));
  executeActions(f.world, [{ eid: f.ada, action: { type: "interact", target: "Bread", content: "eat" } }], f.registry);
  expect(f.facts(f.baker).some(f => f.slot === "Entity.lifecycle")).toBe(false);
  f.advance();
  for (const eid of [f.ada, f.baker]) expect(f.facts(eid)).toEqual([expect.objectContaining({ slot: "Entity.lifecycle", value: "removed" })]);
  for (const eid of [f.blind, f.remote]) expect(f.facts(eid)).toEqual([]);
});

test("a held object's exterior enters perception and memory without its private state, description or children", () => {
  const f = fixture(); setLocatedIn(f.world, f.food, f.ada); expect(tryHoldCarriedItem(f.world, f.ada, f.food).success).toBe(true);
  ObjectState.current[f.food] = "PRIVATE_PHONE_STATE"; Description.value[f.food] = "PRIVATE_SCREEN_CONTENT";
  const secret = addEntity(f.world); addComponent(f.world, secret, Name); Name.value[secret] = "PRIVATE_MESSAGE"; setLocatedIn(f.world, secret, f.food);
  const forgotten = new ObjectManager(f.world).spawn("object", { name: "PRIVATE_STOWED", containedIn: f.ada })!;
  captureWorkingMemoryObservation(f.world, f.baker);
  const prose = JSON.stringify(generateStimuliForAgent(f.world, f.baker, []));
  expect(prose).toContain("Bread"); expect(prose).toContain("holding");
  const context = [prose, formatWorkingMemoryContext(f.world, f.baker), formatCognitiveLocalView(captureCognitiveLocalView(f.world, f.baker))].join("\n");
  expect(context).toContain("Bread"); expect(context).not.toContain("PRIVATE_");
  expect(getAgentVisualEntities(f.world, f.baker)).not.toContain(f.food); // Exterior is not readable contents/access authority.
  expect(getAvailableAffordances(f.world, f.baker, f.food)).toEqual([]); // No permission to eat/read someone else's object.
  expect(hasComponent(f.world, secret, WorkingMemoryIdentity)).toBe(false);
  expect(hasComponent(f.world, forgotten, WorkingMemoryIdentity)).toBe(false);
  f.destroy(); expect(f.facts(f.baker)).toEqual([expect.objectContaining({ slot: "Entity.lifecycle", value: "removed" })]);
  expect(JSON.stringify(getWorkingMemory(f.world, f.baker))).not.toContain("PRIVATE_");
});

test("held-item changes invalidate physical dependencies, while private contents do not", () => {
  const f = fixture(); setLocatedIn(f.world, f.food, f.ada); tryHoldCarriedItem(f.world, f.ada, f.food);
  const view = captureCognitiveLocalView(f.world, f.baker)!;
  const dependency = `entity:${workingMemoryEntityRef(f.world, f.ada)!.key}`;
  const sensory = getAgentSensoryFingerprint(f.world, f.baker);
  ObjectState.current[f.food] = "PRIVATE_STATE_CHANGE"; Description.value[f.food] = "PRIVATE_SCREEN_CHANGE";
  expect(areLocalDependenciesCurrent(f.world, f.baker, view, [dependency])).toBe(true);
  expect(getAgentSensoryFingerprint(f.world, f.baker)).toBe(sensory);
  tryStowCarriedItem(f.world, f.ada, f.food);
  expect(areLocalDependenciesCurrent(f.world, f.baker, view, [dependency])).toBe(false);
});

test("exterior reads are pure and stale manual target identities cannot expose a replacement", () => {
  const f = fixture(); setLocatedIn(f.world, f.food, f.ada);
  reserveSimulationResources(f.world, f.ada, "manual", ["body"], { activity: { kind: "operating", operation: "typing", targetEid: f.food } });
  const before = JSON.stringify(getWorkingMemory(f.world, f.baker));
  expect(getObservedHeldItemExteriors(f.world, f.baker).map(item => item.eid)).toContain(f.food);
  expect(JSON.stringify(getWorkingMemory(f.world, f.baker))).toBe(before);
  WorkingMemoryIdentity.id[f.food] = "replacement:unrelated-item";
  expect(getObservedHeldItemExteriors(f.world, f.baker)).toEqual([]);
  expect(snapshotCharacterAppearance(f.world, f.ada)?.heldItems).toEqual([]);
});

test("physical equipment survives save/reload and native consumption still reaches the witness", () => {
  const f = fixture(); f.act(f.baker, { type: "give", target: "Ada", content: "Bread" });
  const saved = serializeWorld(f.world, f.registry);
  const restored = createArgosWorld("Restored handoff"); initializePrefabs(restored);
  const registry = createSystemRegistry(), { oldToNewId } = deserializeWorld(restored, registry, saved);
  startCommittedEvents(restored);
  const ada = oldToNewId.get(f.ada)!, baker = oldToNewId.get(f.baker)!, food = oldToNewId.get(f.food)!;
  expect(getObservedHeldItemExteriors(restored, baker).map(item => item.eid)).toContain(food);
  executeActions(restored, [{ eid: ada, action: { type: "interact", target: "Bread", content: "eat" } }], registry);
  advanceSimulationTimeline(restored, restored.time.elapsed + 2000, { integrate: () => {} });
  expect(getWorkingMemory(restored, baker).facts.filter(fact => fact.subject === f.key))
    .toEqual([expect.objectContaining({ slot: "Entity.lifecycle", value: "removed" })]);
});

test("stowing, concealment and a hidden holder end exterior observation without inferring deletion", () => {
  const f = fixture(); setLocatedIn(f.world, f.food, f.ada); tryHoldCarriedItem(f.world, f.ada, f.food);
  const held = getAgentSensoryFingerprint(f.world, f.baker);
  expect(JSON.stringify(generateStimuliForAgent(f.world, f.baker, []))).toContain("holding Bread");
  tryStowCarriedItem(f.world, f.ada, f.food);
  expect(getAgentSensoryFingerprint(f.world, f.baker)).not.toBe(held);
  expect(JSON.stringify(generateStimuliForAgent(f.world, f.baker, []))).not.toContain("holding Bread");
  f.destroy(); expect(f.facts(f.baker)).toEqual([]);
});

test.each(["item", "holder", "remote"])("%s concealment prevents held-item witness admission", kind => {
  const f = fixture(); setLocatedIn(f.world, f.food, f.ada); tryHoldCarriedItem(f.world, f.ada, f.food);
  if (kind === "remote") setLocatedIn(f.world, f.ada, f.away);
  else { const target = kind === "item" ? f.food : f.ada; addComponent(f.world, target, Traits); Traits.active[target] = '["concealed"]'; }
  captureWorkingMemoryObservation(f.world, f.baker); f.destroy(); expect(f.facts(f.baker)).toEqual([]);
});

test("an active native manual operation exposes only its own portable target for its actual lifetime", () => {
  const f = fixture(); setLocatedIn(f.world, f.food, f.ada);
  expect(reserveSimulationResources(f.world, f.ada, "manual", ["body"], { activity: { kind: "operating", operation: "eating", targetEid: f.food } })).toBe(true);
  expect(snapshotCharacterAppearance(f.world, f.ada)?.heldItems.map(i => i.eid)).toContain(f.food);
  captureWorkingMemoryObservation(f.world, f.baker); expect(f.facts(f.baker)).toContainEqual(expect.objectContaining({ predicate: "location", valueLabel: "Ada" }));
  releaseSimulationResources(f.world, f.ada, "manual"); f.destroy();
  expect(f.facts(f.baker).some(f => f.slot === "Entity.lifecycle")).toBe(false);
});

test("stale equipment on an object inside a bag is not a visible hand item", () => {
  const f = fixture(), bag = new ObjectManager(f.world).spawn("object", { name: "Bag", containedIn: f.ada })!;
  setLocatedIn(f.world, f.food, bag); addComponent(f.world, f.food, EquipSlot);
  EquipSlot.slot[f.food] = "mainHand"; EquipSlot.equippedBy[f.food] = f.ada;
  captureWorkingMemoryObservation(f.world, f.baker); f.destroy(); expect(f.facts(f.baker)).toEqual([]);
});
