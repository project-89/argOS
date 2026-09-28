import { jest } from "@jest/globals";
import { addComponent, hasComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Container, Description, Name, ObjectState, Traits, WorkingMemoryIdentity } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { executeActions } from "../cognition-system";
import { buildAvailableActionsContext, formatActionsForPrompt, getValidActionTypes } from "../action-registry";
import { getWorkingMemory } from "../working-memory";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { drainPendingStimuli } from "../stimulus-queue";

const cleanup: Array<() => void> = [];
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Action visibility tests stay offline")); });
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); drainPendingStimuli(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
function fixture() {
  const world = createArgosWorld("Perceptible action targets"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Study" }), remote = createRoomEntity(world, { name: "Annex" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Observe", roomId: room });
  const other = createAgentEntity(world, { name: "Visible companion", role: "resident", systemPrompt: "Private", roomId: room });
  const object = (name: string, parent = room, traits: string[] = ["takeable"]) => {
    const eid = createObjectEntity(world, { name, portable: true, roomId: room, traits }); setLocatedIn(world, eid, parent); return eid;
  };
  const box = (name: string, state: string, parent = room, traits: string[] = []) => {
    const eid = object(name, parent, traits); addComponent(world, eid, Container); ObjectState.current[eid] = state; return eid;
  };
  const hook = jest.fn((target: number) => [{ name: `operate ${Name.value[target]}`, description: "Read the current labelled control", requires: [] }]);
  let supplied: number[] = [];
  cleanup.push(registerAgentWorldCapabilities(world, actor, { ready: () => true, busy: () => false, context: () => "",
    execute: () => false, visibleEntities: () => supplied, affordances: hook }));
  return { world, room, remote, actor, other, object, box, hook, expose: (...targets: number[]) => { supplied = targets; },
    context: () => buildAvailableActionsContext(world, actor), prompt: () => formatActionsForPrompt(world, actor) };
}

test.each(["hidden", "invisible", "concealed"])("%s people and objects cannot appear in action discovery", trait => {
  const f = fixture();
  const person = createAgentEntity(f.world, { name: "UNSEEN_PERSON", role: "PRIVATE_ROLE", systemPrompt: "Private", roomId: f.room });
  addComponent(f.world, person, Traits); Traits.active[person] = JSON.stringify([trait, "hostile"]);
  const secret = f.object("UNSEEN_OBJECT", f.room, [trait, "takeable"]);
  ObjectState.current[secret] = "UNSEEN_STATE"; Description.value[secret] = "UNSEEN_DESCRIPTION";
  const ordinary = f.object("Visible apple"); f.expose(person, secret, ordinary);
  const context = f.context(), prompt = f.prompt();
  expect(context.socialAffordances.some(a => a.target === "Visible companion")).toBe(true);
  expect(context.objectAffordances.some(a => a.target === "Visible apple" && a.action === "pickup")).toBe(true);
  expect(JSON.stringify(context)).not.toMatch(/UNSEEN_|PRIVATE_ROLE/);
  expect(prompt).not.toMatch(/UNSEEN_|PRIVATE_ROLE/);
  expect(f.hook.mock.calls.some(([target]) => target === secret || target === person)).toBe(false);
  expect(getValidActionTypes(f.world, f.actor)).toContain("interact");
});

test("open public containers reveal ordinary nested targets, never hidden descendants or foreign inventory", () => {
  const f = fixture(), publicBox = f.box("Public box", "open"), nestedBox = f.box("Open tray", "open", publicBox);
  const visibleChild = f.object("Visible nested tool", nestedBox), secret = f.object("UNSEEN_CHILD", nestedBox, ["takeable", "hidden"]);
  const carriedBox = f.box("UNSEEN_FOREIGN_BAG", "open", f.other), foreign = f.object("UNSEEN_FOREIGN_TOOL", carriedBox);
  const remote = f.object("UNSEEN_REMOTE_TOOL", f.remote);
  // An authored package list is not authority to see through someone else's body.
  f.expose(secret, carriedBox, foreign, remote);
  const context = f.context();
  expect(context.objectAffordances).toContainEqual(expect.objectContaining({ action: "pickup", target: "Visible nested tool" }));
  expect(f.prompt()).not.toContain("UNSEEN_");
  for (const target of [secret, carriedBox, foreign, remote]) expect(f.hook.mock.calls.some(([id]) => id === target)).toBe(false);
  expect(f.hook.mock.calls.some(([id]) => id === visibleChild)).toBe(true);
});

test.each(["closed", "locked", "closed; locked"])("%s state defeats a stale open trait and an overbroad package list", state => {
  const f = fixture(), container = f.box("Opaque cupboard", state, f.room, ["open"]), child = f.object("UNSEEN_LOCKED_TOOL", container);
  f.expose(container, child);
  expect(f.prompt()).not.toContain("UNSEEN_LOCKED_TOOL");
  expect(f.hook.mock.calls.some(([target]) => target === child)).toBe(false);
  ObjectState.current[container] = "open";
  expect(f.context().objectAffordances).toContainEqual(expect.objectContaining({ target: "UNSEEN_LOCKED_TOOL", action: "pickup" }));
});

test("concealed ancestors and cyclic package candidates fail closed without hiding a legitimate surface", () => {
  const f = fixture(), ancestor = f.box("UNSEEN_COVER", "open", f.room, ["concealed"]), hiddenChild = f.object("UNSEEN_COVERED_TOOL", ancestor);
  const a = f.box("UNSEEN_CYCLE_A", "open"), b = f.box("UNSEEN_CYCLE_B", "open", a);
  setLocatedIn(f.world, a, b); const cycleChild = f.object("UNSEEN_CYCLE_TOOL", a);
  const gone = f.object("REMOVED_TOOL"); removeEntity(f.world, gone);
  const valid = f.object("Visible wrench"); f.expose(ancestor, hiddenChild, a, b, cycleChild, gone, NaN, -1, 900000, valid);
  expect(f.prompt()).not.toMatch(/UNSEEN_|REMOVED_TOOL/);
  expect(f.prompt()).toContain("Visible wrench");
  for (const target of [ancestor, hiddenChild, a, b, cycleChild]) expect(f.hook.mock.calls.some(([id]) => id === target)).toBe(false);
});

test.each([false, true])("blind own possessions remain tangible without disclosing labels or contents (detached=%s)", detached => {
  const f = fixture(), own = f.box("My satchel", "open", f.actor, ["hidden"]), child = f.object("UNSEEN_SATCHEL_CONTENTS", own);
  const bell = f.object("My bell", f.actor), nearby = f.object("UNSEEN_NEARBY_TOOL");
  addComponent(f.world, f.actor, Traits); Traits.active[f.actor] = '["blind"]';
  f.expose(own, child, bell, nearby);
  if (detached) setLocatedIn(f.world, f.actor, undefined);
  const context = f.context(), prompt = f.prompt();
  expect(context.objectAffordances).toEqual([
    expect.objectContaining({ target: "My satchel", action: "drop" }),
    expect.objectContaining({ target: "My bell", action: "drop" }),
  ]);
  expect(prompt).toContain("My satchel: drop (your possession)");
  expect(prompt).not.toMatch(/UNSEEN_|Visible companion|operate My|observe:|examine:/);
  expect(f.hook).not.toHaveBeenCalled();
  expect(getValidActionTypes(f.world, f.actor)).toEqual(expect.arrayContaining(["interact", "use", "drop", "speak"]));
});

test("formatting and canonical action hints allocate no observed identities, receipts or new knowledge", () => {
  const f = fixture(), open = f.box("Open chest", "open"), visible = f.object("Visible artifact", open), secret = f.object("UNSEEN_ARTIFACT", open, ["hidden"]);
  const before = JSON.stringify(getWorkingMemory(f.world, f.actor));
  expect(hasComponent(f.world, visible, WorkingMemoryIdentity)).toBe(false);
  for (let n = 0; n < 3; n++) { f.context(); f.prompt(); getValidActionTypes(f.world, f.actor); }
  expect(JSON.stringify(getWorkingMemory(f.world, f.actor))).toBe(before);
  expect(hasComponent(f.world, visible, WorkingMemoryIdentity)).toBe(false);
  expect(hasComponent(f.world, secret, WorkingMemoryIdentity)).toBe(false);
});

test("an explicit remembered target can still reach the executor without becoming a discoverable menu target", () => {
  const world = createArgosWorld("Known deliberate attempt"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Hall" }), actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Observe", roomId: room });
  const hidden = createObjectEntity(world, { name: "Remembered panel", roomId: room, traits: ["hidden"] });
  const execute = jest.fn(() => true);
  cleanup.push(registerAgentWorldCapabilities(world, actor, { context: () => "", ready: () => true, busy: () => false,
    visibleEntities: () => [hidden], execute }));
  expect(formatActionsForPrompt(world, actor)).not.toContain("Remembered panel");
  executeActions(world, [{ eid: actor, action: { type: "interact", target: "Remembered panel", content: "press" } }], createSystemRegistry());
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: "interact", target: "Remembered panel", content: "press" }));
});
