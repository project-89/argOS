import { addComponent, hasComponent, removeComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { ObjectState, ObjectType, Removed, Traits } from "../../ecs/components";
import { getDirectContainer, setLocatedIn } from "../../ecs/location";
import { tryAddToInventory } from "../../ecs/inventory";
import { canUseAffordance, executeAffordance } from "../effect-executor";
import { setTraits, transitionObjectState } from "../object-state";
import { BASE_AFFORDANCES, worldSchema, type AffordanceDefinition } from "../schema";

function fixture() {
  const world = createArgosWorld("Lazy actor requirements"); initializePrefabs(world); world.meta.aiEnabled = false;
  const room = createRoomEntity(world, { name: "Workshop" });
  const actor = createAgentEntity(world, { name: "Mara", role: "neighbor", roomId: room, systemPrompt: "Choose from the world." });
  const target = createObjectEntity(world, { name: "Cabinet", roomId: room, traits: ["lockable"] });
  const key = createObjectEntity(world, { name: "Key", roomId: room, traits: ["hasKey"] });
  return { world, room, actor, target, key,
    check: (affordance: AffordanceDefinition) => canUseAffordance(world, affordance, actor, target),
    act: (name: string, targetEid = key) => executeAffordance(name, { world, actorEid: actor, targetEid, worldSchema,
      registry: { byName: new Map(), byId: new Map() } }),
  };
}

/** Count the actual underlying SoA reads without replacing an ESM export or
 * changing execution authority. Restore the shared component descriptor even
 * when an assertion fails. */
function countTraitReads(eid: number, run: (reads: () => number) => void) {
  const descriptor = Object.getOwnPropertyDescriptor(Traits.active, eid)!;
  let count = 0;
  Object.defineProperty(Traits.active, eid, { configurable: true, enumerable: descriptor.enumerable,
    get: () => { count++; return descriptor.value; } });
  try { run(() => count); } finally { Object.defineProperty(Traits.active, eid, descriptor); }
}

test.each([undefined, []])("no inventory traversal for absent or empty actor requirements: %j", actorRequires => {
  const f = fixture(); expect(tryAddToInventory(f.world, f.actor, f.key).success).toBe(true);
  countTraitReads(f.actor, actorReads => countTraitReads(f.key, toolReads => {
    expect(f.check({ name: "observe", requires: ["lockable"], actorRequires })).toEqual({ available: true });
    expect(actorReads()).toBe(0); expect(toolReads()).toBe(0);
  }));
});

test.each(["missing", "blocked"])("target %s rejection does not inspect unrelated actor inventory", kind => {
  const f = fixture(); expect(tryAddToInventory(f.world, f.actor, f.key).success).toBe(true);
  const affordance = { name: "use", requires: kind === "missing" ? ["edible"] : ["lockable"],
    blockedBy: kind === "blocked" ? ["lockable"] : [], actorRequires: ["hasKey"] };
  countTraitReads(f.actor, actorReads => countTraitReads(f.key, toolReads => {
    expect(f.check(affordance)).toMatchObject({ available: false, reason: expect.stringMatching(kind === "missing" ? /^Target lacks trait: edible/ : /^Blocked by trait: lockable/) });
    expect(actorReads()).toBe(0); expect(toolReads()).toBe(0);
  }));
});

test("legacy target canonicalization remains available without inspecting or promoting unrelated carried objects", () => {
  const f = fixture(); setLocatedIn(f.world, f.key, f.actor);
  removeComponent(f.world, f.target, Traits); removeComponent(f.world, f.key, Traits);
  expect(f.check({ name: "observe", requires: ["lockable"] })).toEqual({ available: true });
  expect(hasComponent(f.world, f.target, Traits)).toBe(true);
  expect(hasComponent(f.world, f.key, Traits)).toBe(false);
  expect(f.check(BASE_AFFORDANCES.unlock)).toEqual({ available: true });
  expect(hasComponent(f.world, f.key, Traits)).toBe(true);
});

test("native pickup and drop change actor requirements immediately with no cross-call cache", () => {
  const f = fixture();
  expect(f.check(BASE_AFFORDANCES.unlock)).toMatchObject({ available: false, reason: expect.stringContaining("Actor lacks trait: hasKey") });
  expect(f.act("take").success).toBe(true); expect(getDirectContainer(f.world, f.key)).toBe(f.actor);
  expect(f.check(BASE_AFFORDANCES.unlock)).toEqual({ available: true });
  expect(f.act("drop").success).toBe(true); expect(getDirectContainer(f.world, f.key)).toBe(f.room);
  expect(f.check(BASE_AFFORDANCES.unlock)).toMatchObject({ available: false, reason: expect.stringContaining("hasKey") });
  expect(f.act("drop")).toMatchObject({ success: false, message: "You are not holding that" });
});

test("tool state transitions add and remove capabilities on every eligible check", () => {
  const f = fixture(); setLocatedIn(f.world, f.key, f.actor); ObjectType.typeId[f.key] = "test_tool";
  const schema = { getObjectType: () => ({ traits: ["takeable"], defaultState: "sharp",
    states: { sharp: { traits: ["hasKnife"] }, dull: { traits: [], blockedTraits: ["hasKnife"] } } }) };
  const sharpen = (state: string) => transitionObjectState(f.world, f.key, state, { world: f.world, worldSchema: schema });
  const cut = { name: "cut", requires: ["lockable"], actorRequires: ["hasKnife"] };
  expect(sharpen("sharp").ok).toBe(true); expect(f.check(cut)).toEqual({ available: true });
  expect(sharpen("dull").ok).toBe(true); expect(ObjectState.current[f.key]).toBe("dull");
  expect(f.check(cut)).toMatchObject({ available: false, reason: expect.stringContaining("hasKnife") });
  expect(sharpen("sharp").ok).toBe(true); expect(f.check(cut)).toEqual({ available: true });
});

test("nested tools, their removal and fresh actor traits still control eligible admission", () => {
  const f = fixture(), bag = createObjectEntity(f.world, { name: "Bag", roomId: f.room });
  setLocatedIn(f.world, bag, f.actor); setLocatedIn(f.world, f.key, bag);
  expect(f.check(BASE_AFFORDANCES.unlock)).toEqual({ available: true });
  setLocatedIn(f.world, f.key, f.room);
  expect(f.check(BASE_AFFORDANCES.unlock).available).toBe(false);
  setLocatedIn(f.world, f.key, bag); addComponent(f.world, f.key, Removed);
  expect(f.check(BASE_AFFORDANCES.unlock).available).toBe(false);
  setTraits(f.world, f.actor, new Set(["hasKey"]));
  expect(f.check(BASE_AFFORDANCES.unlock)).toEqual({ available: true });
  setTraits(f.world, f.actor, new Set());
  expect(f.check(BASE_AFFORDANCES.unlock).available).toBe(false);
});

test("new target blockers still take precedence over held capabilities", () => {
  const f = fixture(); setLocatedIn(f.world, f.key, f.actor);
  const action = { name: "unlock", requires: ["lockable"], blockedBy: ["broken"], actorRequires: ["hasKey"] };
  expect(f.check(action)).toEqual({ available: true });
  setTraits(f.world, f.target, new Set(["lockable", "broken"]));
  expect(f.check(action)).toEqual({ available: false, reason: "Blocked by trait: broken" });
  setTraits(f.world, f.target, new Set());
  expect(f.check(action)).toMatchObject({ available: false, reason: expect.stringContaining("Target lacks trait: lockable") });
});
