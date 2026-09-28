import { jest } from "@jest/globals";
import { addComponent, addEntity, hasComponent, removeEntity } from "bitecs";
import { Agent, Container, Name, ObjectState, Surface, Traits, WorkingMemoryIdentity } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { captureCognitiveLocalView, formatCognitiveLocalView, isCognitiveLocalViewCurrent } from "../cognitive-local-view";
import { captureWorkingMemoryObservation } from "../working-memory-observation";
import { getWorkingMemory } from "../working-memory";
import { getAgentObservableEntities, getAgentTangibleEntities, getAgentVisibleEntities, getAgentVisualEntities,
  getAgentWorldCapabilities, isPublicContainerOpen, registerAgentWorldCapabilities } from "../world-capabilities";

function fixture() {
  const world = createArgosWorld("Perceptible surfaces"); initializePrefabs(world); world.meta.aiEnabled = false;
  const room = createRoomEntity(world, { name: "Study" }), remote = createRoomEntity(world, { name: "Vault" });
  const actor = createAgentEntity(world, { name: "Rin", role: "resident", roomId: room, systemPrompt: "Observe." });
  const peer = createAgentEntity(world, { name: "Sol", role: "resident", roomId: room, systemPrompt: "Observe." });
  const object = (name: string, parent = room, state = "normal") => {
    const id = createObjectEntity(world, { name, roomId: room, portable: true });
    ObjectState.current[id] = state; setLocatedIn(world, id, parent); return id;
  };
  const traits = (id: number, values: string[]) => { addComponent(world, id, Traits); Traits.active[id] = JSON.stringify(values); };
  let advertised: number[] = [];
  registerAgentWorldCapabilities(world, actor, { context: () => "", busy: () => false, ready: () => true,
    execute: () => false, visibleEntities: () => advertised });
  return { world, room, remote, actor, peer, object, traits, advertise: (ids: number[]) => { advertised = ids; } };
}
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Perception has no model dependency")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("native open-container traversal admits ordinary nested contents without a package-supplied list", () => {
  const f = fixture(), box = f.object("Box", f.room, "open"), inner = f.object("Pouch", box, "open");
  addComponent(f.world, box, Container); addComponent(f.world, inner, Container);
  const coin = f.object("Coin", inner);
  expect(getAgentVisualEntities(f.world, f.actor)).toEqual(expect.arrayContaining([f.peer, box, inner, coin]));
  expect(getAgentTangibleEntities(f.world, f.actor)).toEqual([]);
  expect(getAgentVisibleEntities(f.world, f.actor)).toEqual(getAgentObservableEntities(f.world, f.actor));
  captureWorkingMemoryObservation(f.world, f.actor);
  expect(getWorkingMemory(f.world, f.actor).facts).toContainEqual(expect.objectContaining({ subjectLabel: "Coin", predicate: "location", valueLabel: "Pouch" }));
});

test("a typed exposed table supports visible objects without being mislabeled an open box", () => {
  const f = fixture(), table = f.object("Table"), cup = f.object("Cup", table);
  addComponent(f.world, table, Surface);
  expect(getAgentVisualEntities(f.world, f.actor)).toContain(cup);
  addComponent(f.world, table, Container); ObjectState.current[table] = "closed";
  expect(getAgentVisualEntities(f.world, f.actor)).not.toContain(cup);
});

test("an open physical device does not expose nested Name-only message payloads", () => {
  const f = fixture(), device = f.object("Open device", f.room, "open");
  const data = addEntity(f.world); addComponent(f.world, data, Name); Name.value[data] = "UNREAD_MESSAGE_SENTINEL";
  addComponent(f.world, data, ObjectState); ObjectState.current[data] = "PRIVATE_MESSAGE_STATE";
  setLocatedIn(f.world, data, device); f.advertise([data]);
  expect(getAgentVisualEntities(f.world, f.actor)).not.toContain(data);
  captureWorkingMemoryObservation(f.world, f.actor);
  expect(hasComponent(f.world, data, WorkingMemoryIdentity)).toBe(false);
  expect(JSON.stringify(getWorkingMemory(f.world, f.actor))).not.toMatch(/UNREAD_MESSAGE|PRIVATE_MESSAGE/);
});

test.each(["hidden", "invisible", "concealed", " HIDDEN "])("concealment applies to leaves and ancestors despite package advertising: %s", trait => {
  const f = fixture(), hidden = f.object("Hidden thing"), box = f.object("Secret box", f.room, "open");
  const child = f.object("Private contents", box); f.traits(hidden, [trait]); f.traits(box, [trait]); f.traits(f.peer, [trait]);
  f.advertise([hidden, box, child, f.peer]);
  // Authoring now binds NPC aspirations to an identity. Seeing nothing must
  // neither mint identities for unseen props nor replace an authored NPC key.
  const identities = [hidden, box, child, f.peer].map(id => ({ present: hasComponent(f.world, id, WorkingMemoryIdentity), key: WorkingMemoryIdentity.id[id] }));
  const before = getWorkingMemory(f.world, f.actor);
  expect(getAgentVisualEntities(f.world, f.actor)).toEqual([]);
  expect(getWorkingMemory(f.world, f.actor)).toEqual(before);
  expect([hidden, box, child, f.peer].map(id => ({ present: hasComponent(f.world, id, WorkingMemoryIdentity), key: WorkingMemoryIdentity.id[id] }))).toEqual(identities);
  for (const id of [hidden, box, child]) expect(hasComponent(f.world, id, WorkingMemoryIdentity)).toBe(false);
});

test.each(["closed", "locked", "closed; latched"])("physical %s beats stale open traits with or without Container marker", state => {
  const f = fixture();
  for (const marked of [true, false]) {
    const box = f.object(`Box ${marked}`, f.room, state), child = f.object(`Private ${marked}`, box);
    if (marked) addComponent(f.world, box, Container); f.traits(box, ["open"]); f.advertise([box, child]);
    expect(isPublicContainerOpen(f.world, box)).toBe(false);
    expect(getAgentVisualEntities(f.world, f.actor)).toContain(box);
    expect(getAgentVisualEntities(f.world, f.actor)).not.toContain(child);
  }
});

test("unknown enclosures and foreign inventory are not public surfaces", () => {
  const f = fixture(), box = f.object("Unknown box"), privateItem = f.object("Private", box), held = f.object("Other phone", f.peer);
  f.advertise([privateItem, held]);
  expect(getAgentVisualEntities(f.world, f.actor)).toEqual(expect.arrayContaining([f.peer, box]));
  expect(getAgentVisualEntities(f.world, f.actor)).not.toEqual(expect.arrayContaining([privateItem, held]));
  ObjectState.current[box] = "open";
  expect(getAgentVisualEntities(f.world, f.actor)).toContain(privateItem);
  expect(getAgentVisualEntities(f.world, f.actor)).not.toContain(held);
});

test("hidden own possessions remain tangible without making their raw state or contents visible", () => {
  const f = fixture(), bag = f.object("My bag", f.actor, "PRIVATE_SCREEN_SENTINEL"), secret = f.object("Unseen inner document", bag);
  f.traits(bag, ["hidden", "open"]); f.advertise([bag, secret]);
  expect(getAgentTangibleEntities(f.world, f.actor)).toEqual([bag]);
  expect(getAgentVisualEntities(f.world, f.actor)).not.toEqual(expect.arrayContaining([bag, secret]));
  const view = captureCognitiveLocalView(f.world, f.actor);
  expect(formatCognitiveLocalView(view)).toContain("My bag");
  expect(formatCognitiveLocalView(view)).not.toMatch(/PRIVATE_SCREEN|Unseen inner/);
  expect(JSON.stringify(getWorkingMemory(f.world, f.actor))).not.toMatch(/PRIVATE_SCREEN|Unseen inner/);
  expect(hasComponent(f.world, secret, WorkingMemoryIdentity)).toBe(false);
  ObjectState.current[bag] = "ANOTHER_PRIVATE_SCREEN";
  expect(isCognitiveLocalViewCurrent(f.world, f.actor, view)).toBe(true);
});

test("blind or detached actors retain only their direct own possessions", () => {
  const f = fixture(), satchel = f.object("Satchel", f.actor, "open"), inner = f.object("Inner", satchel);
  f.traits(f.actor, ["blind"]);
  expect(getAgentVisualEntities(f.world, f.actor)).toEqual([]);
  expect(getAgentObservableEntities(f.world, f.actor)).toEqual([satchel]);
  expect(getAgentObservableEntities(f.world, f.actor)).not.toContain(inner);
  setLocatedIn(f.world, f.actor, undefined);
  expect(getAgentTangibleEntities(f.world, f.actor)).toEqual([satchel]);
  f.traits(f.actor, []); expect(getAgentVisualEntities(f.world, f.actor)).toEqual([]);
});

test("opening changes the actual local view, but a sealed interior mutation does not", () => {
  const f = fixture(), box = f.object("Box", f.room, "closed"), inner = f.object("Private inner", box);
  const view = captureCognitiveLocalView(f.world, f.actor);
  ObjectState.current[inner] = "secret changed";
  expect(isCognitiveLocalViewCurrent(f.world, f.actor, view)).toBe(true);
  expect(hasComponent(f.world, inner, WorkingMemoryIdentity)).toBe(false);
  ObjectState.current[box] = "open";
  expect(isCognitiveLocalViewCurrent(f.world, f.actor, view)).toBe(false);
  expect(hasComponent(f.world, inner, WorkingMemoryIdentity)).toBe(false);
  captureWorkingMemoryObservation(f.world, f.actor);
  expect(hasComponent(f.world, inner, WorkingMemoryIdentity)).toBe(true);
});

test("deleted, remote, cyclic and excessive-depth package candidates cannot acquire visual authority", () => {
  const f = fixture(), remote = f.object("Remote", f.remote), deleted = f.object("Deleted"), a = f.object("A", f.room, "open"), b = f.object("B", a, "open");
  removeEntity(f.world, deleted); setLocatedIn(f.world, a, b);
  let parent = f.room;
  const chain: number[] = [];
  for (let i = 0; i < 20; i++) { parent = f.object(`Nested ${i}`, parent, "open"); chain.push(parent); }
  f.advertise([remote, deleted, a, b, ...chain]);
  const visible = getAgentVisualEntities(f.world, f.actor);
  for (const id of [remote, a, b, chain.at(-1)!]) expect(visible).not.toContain(id);
});

test("inactive actors have no current perceptible surface", () => {
  const f = fixture(); Agent.active[f.actor] = false;
  expect(getAgentVisualEntities(f.world, f.actor)).toEqual([]); expect(getAgentTangibleEntities(f.world, f.actor)).toEqual([]);
});

test("a package that moves its observer during projection confers no old-room view", () => {
  const f = fixture();
  const identity = { present: hasComponent(f.world, f.peer, WorkingMemoryIdentity), key: WorkingMemoryIdentity.id[f.peer] };
  getAgentWorldCapabilities(f.world, f.actor)!.visibleEntities = () => { setLocatedIn(f.world, f.actor, f.remote); return [f.peer]; };
  expect(getAgentVisualEntities(f.world, f.actor)).toEqual([]);
  expect({ present: hasComponent(f.world, f.peer, WorkingMemoryIdentity), key: WorkingMemoryIdentity.id[f.peer] }).toEqual(identity);
});

test("a package that conceals a formerly native surface cannot return that stale visible entry", () => {
  const f = fixture(), lamp = f.object("Lamp");
  getAgentWorldCapabilities(f.world, f.actor)!.visibleEntities = () => { f.traits(lamp, ["hidden"]); return [lamp]; };
  expect(getAgentVisualEntities(f.world, f.actor)).not.toContain(lamp);
  expect(hasComponent(f.world, lamp, WorkingMemoryIdentity)).toBe(false);
});
