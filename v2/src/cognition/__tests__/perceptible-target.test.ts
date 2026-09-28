import { jest } from "@jest/globals";
import { addComponent, addEntity, entityExists, hasComponent, removeEntity } from "bitecs";
import { Agent, Container, Name, ObjectState, Removed, Surface, Traits, WorkingMemoryIdentity } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { getAgentVisualEntities, getAgentWorldCapabilities, isAgentVisualEntity, registerAgentWorldCapabilities } from "../world-capabilities";

function fixture() {
  const world = createArgosWorld("Direct visual membership"); initializePrefabs(world); world.meta.aiEnabled = false;
  const room = createRoomEntity(world, { name: "Common" }), remote = createRoomEntity(world, { name: "Private" });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", roomId: room, systemPrompt: "Observe." });
  const peer = createAgentEntity(world, { name: "Ivo", role: "resident", roomId: room, systemPrompt: "Observe." });
  const ids = [room, remote, actor, peer];
  const object = (name: string, parent = room, state = "normal", physical = true) => {
    const id = physical ? createObjectEntity(world, { name, roomId: room, portable: true }) : addEntity(world);
    if (!physical) { addComponent(world, id, Name); Name.value[id] = name; addComponent(world, id, ObjectState); }
    ObjectState.current[id] = state; setLocatedIn(world, id, parent); ids.push(id); return id;
  };
  const traits = (id: number, values: string[]) => { addComponent(world, id, Traits); Traits.active[id] = JSON.stringify(values); };
  const unregister = registerAgentWorldCapabilities(world, actor, { context: () => "", busy: () => false, ready: () => true, execute: () => false });
  const compare = () => {
    const visible = new Set(getAgentVisualEntities(world, actor));
    for (const id of ids) expect({ target: Name.value[id], visible: isAgentVisualEntity(world, actor, id) })
      .toEqual({ target: Name.value[id], visible: visible.has(id) });
  };
  return { world, room, remote, actor, peer, ids, object, traits, unregister, compare };
}

beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No model calls in native sight")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("direct membership exactly matches a crowded native scene without adding identities", () => {
  const f = fixture();
  for (let i = 0; i < 70; i++) {
    const parent = f.object(`Container ${i}`, i % 9 === 0 ? f.remote : f.room, i % 3 === 0 ? "closed" : "open");
    addComponent(f.world, parent, Container);
    const child = f.object(`Child ${i}`, parent), inner = f.object(`Inner ${i}`, child, "open");
    if (i % 7 === 0) f.traits(parent, ["hidden"]);
    if (i % 11 === 0) f.traits(inner, ["concealed"]);
    f.object(`Unread payload ${i}`, inner, "PRIVATE_SENTINEL", false);
  }
  const identities = f.ids.map(id => hasComponent(f.world, id, WorkingMemoryIdentity));
  f.compare(); f.compare();
  expect(f.ids.map(id => hasComponent(f.world, id, WorkingMemoryIdentity))).toEqual(identities);
});

test("open surfaces, opaque/locked enclosures and stale open traits retain exact privacy boundaries", () => {
  const f = fixture(), table = f.object("Table"), cup = f.object("Cup", table);
  addComponent(f.world, table, Surface); f.compare(); expect(isAgentVisualEntity(f.world, f.actor, cup)).toBe(true);
  addComponent(f.world, table, Container);
  for (const state of ["closed", "locked", "closed; latched", "unknown", "open"]) {
    ObjectState.current[table] = state; f.compare();
  }
  f.traits(table, ["open"]); ObjectState.current[table] = "closed"; f.compare();
  expect(isAgentVisualEntity(f.world, f.actor, cup)).toBe(false);
  ObjectState.current[table] = "open";
  for (const trait of ["hidden", "invisible", " HIDDEN ", "concealed"]) { f.traits(table, [trait]); f.compare(); }
});

test("foreign inventory and nested message records remain private; own direct legacy possessions remain compatible", () => {
  const f = fixture(), own = f.object("Own phone", f.actor), foreign = f.object("Foreign phone", f.peer);
  const ownData = f.object("Legacy direct possession", f.actor, "normal", false);
  const roomData = f.object("Legacy room record", f.room, "normal", false);
  const open = f.object("Open device", f.room, "open"), payload = f.object("Unread text", open, "PRIVATE_MESSAGE", false);
  const untyped = f.object("Untyped nested enclosure", open, "open", false), leaf = f.object("Leaf", untyped);
  f.compare();
  for (const target of [own, ownData, roomData]) expect(isAgentVisualEntity(f.world, f.actor, target)).toBe(true);
  for (const target of [foreign, payload, untyped, leaf]) expect(isAgentVisualEntity(f.world, f.actor, target)).toBe(false);
  f.traits(own, ["hidden"]); f.compare();
  expect(isAgentVisualEntity(f.world, f.actor, own)).toBe(false);
});

test("the native predicate agrees on the exact depth fence, cycles and detached locations", () => {
  const f = fixture(); let parent = f.room;
  const chain: number[] = [];
  for (let i = 0; i < 20; i++) { parent = f.object(`Nested ${i}`, parent, "open"); chain.push(parent); }
  f.compare();
  expect(isAgentVisualEntity(f.world, f.actor, chain[15])).toBe(true);
  expect(isAgentVisualEntity(f.world, f.actor, chain[16])).toBe(false);
  setLocatedIn(f.world, chain[0], chain[2]); f.compare();
  setLocatedIn(f.world, chain[0], undefined); f.compare();
});

test("raw moves, removal, tombstones, blindness and inactive actors are immediately reflected without a cache", () => {
  const f = fixture(), box = f.object("Box", f.room, "open"), child = f.object("Child", box);
  f.compare(); setLocatedIn(f.world, child, f.remote); f.compare(); setLocatedIn(f.world, child, box); f.compare();
  addComponent(f.world, box, Removed); f.compare(); expect(isAgentVisualEntity(f.world, f.actor, child)).toBe(false);
  const deleted = f.object("Deleted"); removeEntity(f.world, deleted); f.compare();
  expect(entityExists(f.world, deleted)).toBe(false);
  const replacement = f.object("Replacement", f.remote); f.compare();
  expect(isAgentVisualEntity(f.world, f.actor, replacement)).toBe(false);
  f.traits(f.actor, ["blind"]); f.compare(); f.traits(f.actor, []);
  Agent.active[f.actor] = false; f.compare(); Agent.active[f.actor] = true;
  setLocatedIn(f.world, f.actor, undefined); f.compare();
});

test("world scope, no registered package and malformed target IDs cannot borrow visibility", () => {
  const f = fixture(), local = f.object("Local"); f.unregister(); f.compare();
  const other = createArgosWorld("Other world");
  expect(isAgentVisualEntity(other, f.actor, local)).toBe(false);
  for (const target of [-1, NaN, Infinity, .5, 999999]) expect(isAgentVisualEntity(f.world, f.actor, target)).toBe(false);
  expect(isAgentVisualEntity(f.world, f.actor, f.actor)).toBe(false);
  expect(isAgentVisualEntity(f.world, f.actor, f.room)).toBe(false);
});

test("source stop and restart do not revive a former room or reuse a visibility snapshot", () => {
  const f = fixture(), local = f.object("Local"); startCommittedEvents(f.world);
  expect(isAgentVisualEntity(f.world, f.actor, local)).toBe(true);
  stopCommittedEvents(f.world); f.compare();
  // Visibility is a read of the retained physical world, not execution authority.
  setLocatedIn(f.world, local, f.remote); f.compare();
  startCommittedEvents(f.world); f.compare();
  expect(isAgentVisualEntity(f.world, f.actor, local)).toBe(false);
});

test("custom visual producers keep the full enumeration path and mutation fences", () => {
  const f = fixture(), lamp = f.object("Lamp"), hook = jest.fn(() => [lamp]);
  getAgentWorldCapabilities(f.world, f.actor)!.visibleEntities = hook;
  f.compare(); expect(hook).toHaveBeenCalled();
  hook.mockImplementation(() => { f.traits(lamp, ["hidden"]); return [lamp]; });
  expect(isAgentVisualEntity(f.world, f.actor, lamp)).toBe(false);
  f.traits(lamp, []);
  hook.mockImplementation(() => { setLocatedIn(f.world, f.actor, f.remote); return [lamp]; });
  expect(isAgentVisualEntity(f.world, f.actor, lamp)).toBe(false);
  setLocatedIn(f.world, f.actor, f.room);
  hook.mockImplementation(() => { throw new Error("Broken visual producer"); });
  expect(() => isAgentVisualEntity(f.world, f.actor, lamp)).toThrow("Broken visual producer");
});
