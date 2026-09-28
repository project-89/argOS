import { jest } from "@jest/globals";
import { addComponent, removeComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { ObjectState, Removed, SimulationAge } from "../../ecs/components";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { getStampedSimulationTime } from "../../ecs/temporal-age";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { initializeRegistry } from "../../ecs/component-registry";
import { initializePrefabs, createObjectEntity, createRoomEntity, createAgentEntity } from "../../ecs/prefabs";
import { materializeApprovedEntity } from "../../engineering/entity-materialization";
import { ObjectManager } from "../object-manager";
import { RulesEngine } from "../rules-engine";
import { transitionObjectState } from "../effect-executor";
import { worldSchema } from "../schema";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { validateRuleCandidate } from "../../spirits/rule-admission";

const lifetime = 6 * 60 * 60 * 1000;
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
function fixture() {
  const world = createArgosWorld(); initializeRegistry(world);
  const objects = new ObjectManager(world), rules = new RulesEngine(world, objects);
  const step = (ms: number) => { advanceSimulationTime(world, world.time.tick + 1, ms); rules.processTick(world.time.tick); };
  return { world, objects, rules, step };
}
test.each([1, 6, 120])("fresh food ages by lived time under %s tick partitions, not random callback counts", parts => {
  const f = fixture(); f.step(100_000);
  const food = f.objects.spawn("food_item")!;
  jest.spyOn(Math, "random").mockReturnValue(0);
  for (let i = 0; i < parts; i++) f.step((lifetime - 1) / parts);
  expect(ObjectState.current[food]).toBe("fresh");
  f.step(1.001); expect(ObjectState.current[food]).toBe("stale");
  f.step(lifetime); expect(ObjectState.current[food]).toBe("stale"); // No new rot mechanic.
});
test("wall jumps, paused callbacks and repeated same-state writes do not reset or advance lived age", () => {
  jest.useFakeTimers().setSystemTime(1_800_000_000_000);
  const f = fixture(), food = f.objects.spawn("food_item")!;
  f.step(lifetime - 1); const marks = SimulationAge.marksJson[food];
  jest.setSystemTime(Date.now() + 30 * 86_400_000);
  for (let i = 0; i < 20; i++) f.step(0);
  expect(f.objects.transitionState(food, "fresh")).toBe(true);
  expect(SimulationAge.marksJson[food]).toBe(marks);
  expect(ObjectState.current[food]).toBe("fresh");
  f.step(1); expect(ObjectState.current[food]).toBe("stale");
});
test("both native state writers start a new state episode, and invalid writes preserve it", () => {
  const f = fixture(), food = f.objects.spawn("food_item", { state: "stale" })!;
  f.step(1000); expect(f.objects.transitionState(food, "fresh")).toBe(true);
  expect(getStampedSimulationTime(f.world, food, "ObjectState.current", 0, "fresh")).toBe(1000);
  f.step(1000);
  const context = { world: f.world, worldSchema, registry: { byName: new Map(), byId: new Map() } };
  expect(transitionObjectState(f.world, food, "stale", context).ok).toBe(true);
  expect(getStampedSimulationTime(f.world, food, "ObjectState.current", 0, "stale")).toBe(2000);
  const marks = SimulationAge.marksJson[food];
  f.step(1000); expect(transitionObjectState(f.world, food, "stale", context).ok).toBe(true);
  expect(transitionObjectState(f.world, food, "nonexistent", context).ok).toBe(false);
  expect(SimulationAge.marksJson[food]).toBe(marks);
});
test("generic native constructors and validated initial overrides receive their actual birth time", () => {
  const f = fixture(); initializePrefabs(f.world); f.step(3210);
  const room = createRoomEntity(f.world, { name: "Hall" });
  const actor = createAgentEntity(f.world, { name: "Ada", role: "visitor", systemPrompt: "Choose", roomId: room });
  const object = createObjectEntity(f.world, { name: "Parcel", roomId: room });
  const made = materializeApprovedEntity(f.world, { name: "Marked parcel", description: "A parcel", type: "object", roomEid: room,
    components: [{ name: "ObjectState", values: { current: "marked" } }] });
  for (const [eid, state] of [[room, "normal"], [actor, "idle"], [object, "normal"], [made, "marked"]] as const)
    expect(getStampedSimulationTime(f.world, eid, "ObjectState.current", 0, state)).toBe(3210);
});
test("state age survives save/reload; a legacy unknown age starts at restore, not at time zero", () => {
  const f = fixture(), food = f.objects.spawn("food_item")!; f.step(lifetime - 1000);
  const saved = serializeWorld(f.world, createSystemRegistry());
  for (const legacy of [false, true]) {
    const data = structuredClone(saved);
    if (legacy) delete data.entities.find(e => e.id === food)!.components.SimulationAge;
    const restored = fixture(), id = deserializeWorld(restored.world, createSystemRegistry(), data).oldToNewId.get(food)!;
    const before = SimulationAge.marksJson[id];
    restored.step(999); expect(ObjectState.current[id]).toBe("fresh");
    expect(SimulationAge.marksJson[id]).toBe(before);
    restored.step(1); expect(ObjectState.current[id]).toBe(legacy ? "fresh" : "stale");
    if (legacy) { restored.step(lifetime - 1000); expect(ObjectState.current[id]).toBe("stale"); }
  }
});
test.each(["missing", "changed", "removed"])("aged rules do not invent proof for %s state metadata", kind => {
  const f = fixture(), food = f.objects.spawn("food_item", { state: kind === "changed" ? "stale" : "fresh" })!;
  if (kind === "missing") removeComponent(f.world, food, SimulationAge);
  if (kind === "changed") ObjectState.current[food] = "fresh"; // Untracked external edit is not birth evidence.
  if (kind === "removed") addComponent(f.world, food, Removed);
  const before = SimulationAge.marksJson[food];
  f.step(lifetime * 2);
  expect(ObjectState.current[food]).toBe("fresh"); expect(SimulationAge.marksJson[food]).toBe(before);
});
test("state age conditions have bounded native admission and conflicting ages fail closed", () => {
  const draft = (conditions: unknown[]) => ({ name: "age_gate", description: "Age in a native state", trigger: "tick", conditions,
    effects: [{ action: "transition_state", params: { state: "stale" } }] });
  expect(validateRuleCandidate(draft([{ inState: "fresh" }, { minStateAgeMs: lifetime }])).when.condition)
    .toEqual({ inState: "fresh", minStateAgeMs: lifetime });
  for (const minStateAgeMs of [-1, Infinity, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1])
    expect(() => validateRuleCandidate(draft([{ inState: "fresh", minStateAgeMs }]))).toThrow();
  expect(() => validateRuleCandidate(draft([{ minStateAgeMs: 0 }]))).toThrow();
  expect(() => validateRuleCandidate(draft([{ inState: "fresh", minStateAgeMs: 1 }, { minStateAgeMs: 2 }]))).toThrow();
});
