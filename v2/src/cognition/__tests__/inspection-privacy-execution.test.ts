import { jest } from "@jest/globals";
import { addComponent } from "bitecs";
import { Container, LastAction, ObjectState, Perception, Portal, Surface, Traits } from "../../ecs/components";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { setLocatedIn } from "../../ecs/location";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { createArgosWorld } from "../../ecs/world";
import { getAgentPerceptions, type AgentAction } from "../agent-mind";
import { executeActions, renderRoomPerception } from "../cognition-system";
import { getCurrentInspection } from "../inspection-memory";
import { drainPendingStimuli, peekPendingStimuli } from "../stimulus-queue";
import { getWorkingMemory } from "../working-memory";
import { getAgentVisualEntities, registerAgentWorldCapabilities } from "../world-capabilities";

function fixture() {
  const world = createArgosWorld("Native inspection privacy"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Study" });
  const actor = createAgentEntity(world, { name: "Rin", role: "resident", systemPrompt: "Act on experience", roomId: room });
  const registry = createSystemRegistry();
  const object = (name: string, parent = room, description = "A plain object.") => {
    const id = createObjectEntity(world, { name, description, roomId: room, portable: true });
    setLocatedIn(world, id, parent); return id;
  };
  const traits = (id: number, values: string[]) => { addComponent(world, id, Traits); Traits.active[id] = JSON.stringify(values); };
  const dispatch = (action: AgentAction) => executeActions(world, [{ eid: actor, action }], registry);
  const feedback = () => JSON.stringify({ pending: peekPendingStimuli(actor),
    perceptions: getAgentPerceptions(world, actor).map(id => Perception.content[id]), memory: getWorkingMemory(world, actor) });
  return { world, room, actor, object, traits, dispatch, feedback };
}

beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Inspection privacy is offline")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test.each(["observe", "examine"] as const)("native %s cannot inspect a concealed but physically reachable item", type => {
  const f = fixture(), target = f.object("Coin", f.room, "HIDDEN_DESCRIPTION_SENTINEL");
  ObjectState.current[target] = "HIDDEN_STATE_SENTINEL"; f.traits(target, ["hidden"]);
  expect(getAgentVisualEntities(f.world, f.actor)).not.toContain(target);
  f.dispatch({ type, target: "Coin" });
  expect(LastAction.success[f.actor]).toBe(false);
  expect(f.feedback()).not.toMatch(/HIDDEN_DESCRIPTION|HIDDEN_STATE/);
  expect(getCurrentInspection(f.world, f.actor, "Coin")).toBeUndefined();
  expect(peekPendingStimuli(f.actor).filter(event => ["observation", "examination"].includes(event.type))).toHaveLength(0);
});

test.each(["observe", "examine"] as const)("native %s of a person exposes public activity, not Agent ObjectState", type => {
  const f = fixture(), table = f.object("Work table"); addComponent(f.world, table, Surface);
  const peer = createAgentEntity(f.world, { name: "Sol", role: "resident", systemPrompt: "My private mind", roomId: f.room });
  addComponent(f.world, peer, ObjectState); ObjectState.current[peer] = "PRIVATE_INTENTION_SENTINEL";
  registerAgentWorldCapabilities(f.world, peer, { context: () => "", ready: () => true, busy: () => false, execute: () => false,
    publicActivity: () => ({ kind: "holding", targetEid: table }) });
  f.dispatch({ type, target: "Sol" });
  expect(LastAction.success[f.actor]).toBe(true);
  expect(f.feedback()).toContain("holding Work table");
  expect(f.feedback()).not.toContain("PRIVATE_INTENTION_SENTINEL");
  expect(getCurrentInspection(f.world, f.actor, "Sol")?.summary).toContain("holding Work table");
});

test("known own inventory and sealed contents do not become visual evidence through observe", () => {
  const f = fixture(), bag = f.object("Satchel", f.actor), paper = f.object("Paper", bag, "SEALED_TEXT_SENTINEL");
  addComponent(f.world, bag, Container); ObjectState.current[bag] = "closed";
  f.dispatch({ type: "observe", target: "Paper" });
  expect(LastAction.success[f.actor]).toBe(false); expect(f.feedback()).not.toContain("SEALED_TEXT_SENTINEL");
  setLocatedIn(f.world, paper, f.actor); f.traits(paper, ["hidden"]);
  f.dispatch({ type: "examine", target: "Paper" });
  expect(LastAction.success[f.actor]).toBe(false); expect(f.feedback()).not.toContain("SEALED_TEXT_SENTINEL");
});

test("blind own-touch knowledge cannot read a held item's visual description", () => {
  const f = fixture(); f.object("Phone", f.actor, "UNREAD_SCREEN_SENTINEL"); f.traits(f.actor, ["blind"]);
  f.dispatch({ type: "observe", target: "Phone" });
  expect(LastAction.success[f.actor]).toBe(false); expect(f.feedback()).not.toContain("UNREAD_SCREEN_SENTINEL");
  expect(getCurrentInspection(f.world, f.actor, "Phone")).toBeUndefined();
});

test.each(["observe", "interact"] as const)("%s failure hints share the observer's actual visible surface", type => {
  const f = fixture(), hidden = f.object("HIDDEN_RECOVERY_SENTINEL"); f.traits(hidden, ["hidden"]);
  const peer = createAgentEntity(f.world, { name: "HIDDEN_PERSON_SENTINEL", role: "resident", systemPrompt: "Private", roomId: f.room });
  f.traits(peer, ["invisible"]);
  const table = f.object("Desk"); addComponent(f.world, table, Surface); f.object("Visible cup", table);
  f.dispatch({ type, target: "Zyxwv absent", ...(type === "interact" ? { content: "open" } : {}) });
  expect(LastAction.success[f.actor]).toBe(false);
  expect(f.feedback()).toContain("Visible cup");
  expect(f.feedback()).not.toMatch(/HIDDEN_RECOVERY|HIDDEN_PERSON/);
});

test("an ordinary visible tabletop item still supports successful native inspection", () => {
  const f = fixture(), table = f.object("Desk"); addComponent(f.world, table, Surface);
  f.object("Cup", table, "A chipped blue cup."); f.dispatch({ type: "observe", target: "Cup" });
  expect(LastAction.success[f.actor]).toBe(true);
  expect(f.feedback()).toContain("A chipped blue cup.");
  expect(getCurrentInspection(f.world, f.actor, "Cup")).toMatchObject({ outcome: "observed" });
});

test("native interact/examine cannot bypass visual privacy, while nonvisual own drop remains valid", () => {
  const f = fixture(), target = f.object("Phone", f.actor, "UNREAD_SCREEN_SENTINEL"); f.traits(target, ["hidden"]);
  f.dispatch({ type: "interact", target: "Phone", content: "examine" });
  expect(LastAction.success[f.actor]).toBe(false);
  expect(getCurrentInspection(f.world, f.actor, "Phone")).toBeUndefined();
  expect(f.feedback()).not.toContain("UNREAD_SCREEN_SENTINEL");
  f.dispatch({ type: "interact", target: "Phone", content: "drop" });
  expect(LastAction.success[f.actor]).toBe(true);
});

test("native interact/examine of a visible surface still records an inspection", () => {
  const f = fixture(), target = f.object("Cupboard"); addComponent(f.world, target, Container); ObjectState.current[target] = "open";
  f.dispatch({ type: "interact", target: "Cupboard", content: "examine" });
  expect(LastAction.success[f.actor]).toBe(true);
  expect(getCurrentInspection(f.world, f.actor, "Cupboard")).toMatchObject({ outcome: "empty" });
});

test("failed native inspection does not disclose a hidden resolver-canonical name", () => {
  const f = fixture(), hidden = f.object("Copper miniature key"); f.traits(hidden, ["hidden"]);
  f.dispatch({ type: "observe", target: "Copper" });
  expect(LastAction.success[f.actor]).toBe(false);
  expect(f.feedback()).not.toContain("Copper miniature key");
});

test("legacy room rendering shares sight and public activity without foreign inventory or reverse-portal discovery", () => {
  const f = fixture(), table = f.object("Desk"); addComponent(f.world, table, Surface); f.object("Visible cup", table);
  const hidden = f.object("HIDDEN_LEGACY_SENTINEL"); f.traits(hidden, ["hidden"]);
  const peer = createAgentEntity(f.world, { name: "Sol", role: "resident", systemPrompt: "Private", roomId: f.room });
  addComponent(f.world, peer, ObjectState); ObjectState.current[peer] = "PRIVATE_AGENT_SENTINEL";
  f.object("PRIVATE_INVENTORY_SENTINEL", peer);
  registerAgentWorldCapabilities(f.world, peer, { context: () => "", ready: () => true, busy: () => false, execute: () => false,
    publicActivity: () => ({ kind: "holding", targetEid: table }) });
  const unknownRoom = createRoomEntity(f.world, { name: "UNKNOWN_REMOTE_ROOM_SENTINEL" });
  addComponent(f.world, unknownRoom, Portal); Portal.destinationRoom[unknownRoom] = f.room;
  const text = renderRoomPerception(f.world, f.actor, f.room);
  expect(text).toContain("Visible cup"); expect(text).toContain("holding Desk");
  expect(text).not.toMatch(/HIDDEN_LEGACY|PRIVATE_AGENT|PRIVATE_INVENTORY|UNKNOWN_REMOTE_ROOM/);
  expect(renderRoomPerception(f.world, f.actor, unknownRoom)).not.toContain("UNKNOWN_REMOTE_ROOM");
  f.traits(f.actor, ["blind"]);
  expect(renderRoomPerception(f.world, f.actor, f.room)).toBe("No current visual perception.");
});

test("package dispatch cannot bypass visual aliases, but authored nonvisual read commands retain their authority", () => {
  const f = fixture(), target = f.object("Phone", f.actor); f.traits(target, ["hidden"]);
  const execute = jest.fn<((action: AgentAction) => boolean)>(() => false);
  registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false, execute });
  for (const action of [
    { type: "observe", target: "Phone" },
    { type: "examine", target: "Phone" },
    { type: "interact", target: "Phone", content: "examine" },
    { type: "interact", target: "Phone", content: "inspect" },
  ] as AgentAction[]) {
    f.dispatch(action); expect(LastAction.success[f.actor]).toBe(false);
  }
  expect(execute).not.toHaveBeenCalled();
  f.traits(target, []); f.dispatch({ type: "observe", target: "Phone" });
  expect(execute).toHaveBeenCalledTimes(1); expect(LastAction.success[f.actor]).toBe(true);
  execute.mockClear(); execute.mockImplementation(() => true); f.traits(target, ["hidden"]);
  f.dispatch({ type: "interact", target: "Phone", content: "read_message" });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0][0]).toMatchObject({ type: "interact", content: "read_message" });
});
