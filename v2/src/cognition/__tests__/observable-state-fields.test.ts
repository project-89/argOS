import { jest } from "@jest/globals";
import { addComponent, hasComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Container, ObjectState, Traits, WorkingMemoryIdentity } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { getAgentWorldCapabilityGeneration, getAgentWorldCapabilities, getObservedStateFields, registerAgentWorldCapabilities, type ObservableStateField } from "../world-capabilities";
import { captureWorkingMemoryAction, captureWorkingMemoryObservation, recordWorkingMemoryAction } from "../working-memory-observation";
import { getWorkingMemory, workingMemoryEntityRef } from "../working-memory";

const cleanup: Array<() => void> = [];
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Observable fields are entirely offline")); });
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
function fixture() {
  const world = createArgosWorld("Typed surfaces"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Hall" }), remote = createRoomEntity(world, { name: "Remote" });
  const actor = createAgentEntity(world, { name: "Reader", role: "resident", roomId: room, systemPrompt: "Observe." });
  const other = createAgentEntity(world, { name: "Other", role: "resident", roomId: room, systemPrompt: "Observe." });
  const panel = createObjectEntity(world, { name: "Signal panel", roomId: room, portable: false });
  const hidden = createObjectEntity(world, { name: "Hidden panel", roomId: remote, portable: false });
  let fields: unknown = [{ key: "ready", type: "boolean", value: false }, { key: "route", type: "enum", values: ["off", "north", "south"], value: "off" }];
  let surface: number[] = [];
  const hook = jest.fn((_target: number) => fields as ObservableStateField[]);
  cleanup.push(registerAgentWorldCapabilities(world, actor, { context: () => "", ready: () => true, busy: () => false,
    execute: () => false, observableState: hook, visibleEntities: () => surface }));
  return { world, room, remote, actor, other, panel, hidden, hook, setFields: (value: unknown) => { fields = value; },
    setVisible: (value: number[]) => { surface = value; },
    fields: (target = panel) => getObservedStateFields(world, actor, target),
    observe: () => captureWorkingMemoryObservation(world, actor) };
}

test("pure catalog requires an already observed target identity and does not create memory", () => {
  const f = fixture(), before = getWorkingMemory(f.world, f.actor);
  expect(hasComponent(f.world, f.panel, WorkingMemoryIdentity)).toBe(false);
  expect(f.fields()).toEqual([]); expect(f.hook).not.toHaveBeenCalled();
  expect(hasComponent(f.world, f.panel, WorkingMemoryIdentity)).toBe(false);
  expect(getWorkingMemory(f.world, f.actor)).toEqual(before);
  f.observe();
  const known = getWorkingMemory(f.world, f.actor), fields = f.fields();
  expect(fields).toEqual([
    { subject: WorkingMemoryIdentity.id[f.panel], subjectLabel: "Signal panel", slot: "Observable.ready", type: "boolean", value: "false", allowedValues: ["false", "true"] },
    { subject: WorkingMemoryIdentity.id[f.panel], subjectLabel: "Signal panel", slot: "Observable.route", type: "enum", value: "off", allowedValues: ["off", "north", "south"] },
  ]);
  expect(Object.isFrozen(fields)).toBe(true); expect(Object.isFrozen(fields[0])).toBe(true);
  expect(Object.isFrozen(fields[1].allowedValues)).toBe(true); expect(getWorkingMemory(f.world, f.actor)).toEqual(known);
});

test("actual sensing admits exact independent scalar facts, not a parsed display sentence", () => {
  const f = fixture(); ObjectState.current[f.panel] = "misleading display prose: ready and routed south";
  f.observe();
  let facts = getWorkingMemory(f.world, f.actor).facts.filter(fact => fact.subject === WorkingMemoryIdentity.id[f.panel]);
  expect(facts.find(fact => fact.slot === "Observable.ready")?.value).toBe("false");
  expect(facts.find(fact => fact.slot === "Observable.route")?.value).toBe("off");
  const count = getWorkingMemory(f.world, f.actor).receipts.length; f.observe();
  expect(getWorkingMemory(f.world, f.actor).receipts).toHaveLength(count);
  f.setFields([{ key: "ready", type: "boolean", value: true }]);
  // A catalog view is not an admission and does not update last-known values.
  expect(f.fields()[0].value).toBe("true");
  expect(getWorkingMemory(f.world, f.actor).facts.find(fact => fact.subject === WorkingMemoryIdentity.id[f.panel] && fact.slot === "Observable.ready")?.value).toBe("false");
  const snapshot = f.observe()!;
  expect(snapshot.facts.find(fact => fact.subject === WorkingMemoryIdentity.id[f.panel] && fact.slot === "Observable.ready"))
    .toMatchObject({ value: "true", provenance: "visible_observation" });
});

test("no producer query or current fact refresh for blind, remote, hidden or opaque-contained targets", () => {
  const f = fixture(); f.observe(); workingMemoryEntityRef(f.world, f.hidden); f.hook.mockClear();
  f.setVisible([f.hidden]); expect(f.fields(f.hidden)).toEqual([]); expect(f.hook).not.toHaveBeenCalled();
  addComponent(f.world, f.actor, Traits); Traits.active[f.actor] = '["blind"]';
  expect(f.fields()).toEqual([]); expect(f.hook).not.toHaveBeenCalled(); Traits.active[f.actor] = "[]";
  addComponent(f.world, f.panel, Traits); Traits.active[f.panel] = '["hidden"]';
  expect(f.fields()).toEqual([]); expect(f.hook).not.toHaveBeenCalled(); Traits.active[f.panel] = "[]";
  const box = createObjectEntity(f.world, { name: "Opaque box", roomId: f.room, portable: false });
  addComponent(f.world, box, Container); ObjectState.current[box] = "closed";
  setLocatedIn(f.world, f.panel, box); f.setVisible([f.panel]);
  expect(f.fields()).toEqual([]); expect(f.hook).not.toHaveBeenCalled();
  ObjectState.current[box] = "open"; expect(f.fields()).toHaveLength(2);
  setLocatedIn(f.world, f.panel, f.other); f.hook.mockClear();
  expect(f.fields()).toEqual([]); expect(f.hook).not.toHaveBeenCalled();
});

test("a replacement actor identity and a different world cannot inherit the old producer", () => {
  const f = fixture(); f.observe(); f.hook.mockClear();
  const otherWorld = createArgosWorld("Different world");
  expect(getObservedStateFields(otherWorld, f.actor, f.panel)).toEqual([]);
  WorkingMemoryIdentity.id[f.actor] = "entity:replacement";
  expect(f.fields()).toEqual([]); expect(f.hook).not.toHaveBeenCalled();
});

test("same-object re-registration creates new authority and stale cleanup cannot remove it", () => {
  const f = fixture();
  const capability = { context: () => "", ready: () => true, busy: () => false, execute: () => false };
  expect(getAgentWorldCapabilityGeneration(f.world, f.other)).toBeUndefined();
  const removeFirst = registerAgentWorldCapabilities(f.world, f.other, capability);
  const first = getAgentWorldCapabilityGeneration(f.world, f.other);
  expect(first).toBeDefined(); expect(Object.isFrozen(first)).toBe(true);
  removeFirst(); expect(getAgentWorldCapabilityGeneration(f.world, f.other)).toBeUndefined();
  const removeSecond = registerAgentWorldCapabilities(f.world, f.other, capability); cleanup.push(removeSecond);
  const second = getAgentWorldCapabilityGeneration(f.world, f.other);
  expect(second).toBeDefined(); expect(second).not.toBe(first);
  removeFirst();
  expect(getAgentWorldCapabilityGeneration(f.world, f.other)).toBe(second);
  expect(getAgentWorldCapabilities(f.world, f.other)).toBe(capability);
});

test("producer-time replacement, disappearance and loss of sight invalidate the returned values", () => {
  const f = fixture(); f.observe();
  f.hook.mockImplementationOnce(() => { WorkingMemoryIdentity.id[f.panel] = "entity:substitute"; return [{ key: "ready", type: "boolean", value: true }]; });
  expect(f.fields()).toEqual([]);
  f.hook.mockImplementationOnce(() => { setLocatedIn(f.world, f.panel, f.remote); return [{ key: "ready", type: "boolean", value: true }]; });
  expect(f.fields()).toEqual([]);
  setLocatedIn(f.world, f.panel, f.room);
  f.hook.mockImplementationOnce(() => { removeEntity(f.world, f.panel); return [{ key: "ready", type: "boolean", value: true }]; });
  expect(f.fields()).toEqual([]);
});

test("actor replacement partway through a multi-target projection discards the entire sensing pass", () => {
  const f = fixture(); f.observe();
  f.hook.mockImplementation(target => {
    if (target === f.panel) WorkingMemoryIdentity.id[f.actor] = "entity:changed-during-projection";
    return [{ key: "ready", type: "boolean", value: true }];
  });
  expect(f.observe()).toBeUndefined();
  expect(getWorkingMemory(f.world, f.actor).facts).toEqual([]);
});

test.each([null, {}, "raw component", [{ key: "ready", type: "boolean", value: "true" }],
  [{ key: "ready", type: "boolean", value: 1 }], [{ key: "ready", type: "number", value: 1 }],
  [{ key: "ready", type: "enum", values: ["on", "off"], value: "invented" }],
  [{ key: "ready", type: "enum", values: ["on", "on"], value: "on" }],
  [{ key: "ObjectState.current", type: "boolean", value: true }],
  [{ key: "ready", type: "boolean", value: true, secret: "do not expose" }],
  [{ key: "ready", type: "boolean", value: true }, { key: "ready", type: "boolean", value: false }],
  Array.from({ length: 9 }, (_, i) => ({ key: `f${i}`, type: "boolean", value: true }))]
  .map(fields => ({ fields })))("invalid or ambiguous producer schema fails closed (%j)", ({ fields }) => {
    const f = fixture(); f.observe(); f.setFields(fields); expect(f.fields()).toEqual([]);
  });

test("successful own action receipts admit real target fields; failure proposals cannot mint effects", () => {
  const f = fixture(); f.observe();
  const action = { type: "interact", target: "Signal panel", content: "activate" } as const;
  const before = captureWorkingMemoryAction(f.world, f.actor, action);
  recordWorkingMemoryAction(f.world, f.actor, action, false, { before });
  expect(getWorkingMemory(f.world, f.actor).receipts.filter(r => r.kind === "action").at(-1)?.facts).toEqual([]);
  f.setFields([{ key: "ready", type: "boolean", value: true }]);
  recordWorkingMemoryAction(f.world, f.actor, action, true, { before });
  expect(getWorkingMemory(f.world, f.actor).receipts.filter(r => r.kind === "action").at(-1)?.facts)
    .toEqual(expect.arrayContaining([expect.objectContaining({ slot: "Observable.ready", value: "true" })]));
});
