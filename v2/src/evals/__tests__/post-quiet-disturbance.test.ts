import { addComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Description, ObjectState, ObjectType, StateTransition } from "../../ecs/components";
import { worldSchema } from "../../world/schema";
import { PostQuietDisturbanceGate, reopenFixtureValve } from "../post-quiet-disturbance";
import { getWorkingMemory } from "../../cognition/working-memory";
import { getAgentPerceptions } from "../../cognition/agent-mind";
import { getCommittedEvents, startCommittedEvents } from "../../runtime/committed-events";

const base = { remainingWallMs: 200_000, remainingSimMs: 200_000, sourceId: "source:a", reviewKey: "plan:1",
  mechanicActive: true, valveClosed: true };
test("requires a continuous minute of eligible simulation time and fires only once", () => {
  const gate = new PostQuietDisturbanceGate();
  expect(gate.consider({ ...base, simMs: 0 })).toBe(false);
  expect(gate.consider({ ...base, simMs: 59_999 })).toBe(false);
  expect(gate.consider({ ...base, simMs: 60_000 })).toBe(true);
  expect(gate.consider({ ...base, simMs: 160_000 })).toBe(false);
});
test.each([{ mechanicActive: false }, { valveClosed: false }, { sourceId: null }, { reviewKey: null }])(
  "ineligible samples reset the quiet interval: %p", change => {
    const gate = new PostQuietDisturbanceGate();
    gate.consider({ ...base, simMs: 0 }); gate.consider({ ...base, ...change, simMs: 40_000 });
    expect(gate.consider({ ...base, simMs: 60_000 })).toBe(false);
    expect(gate.consider({ ...base, simMs: 120_000 })).toBe(true);
  });
test.each([{ sourceId: "source:b" }, { reviewKey: "plan:2" }])("changed identity cannot inherit quiet time: %p", change => {
  const gate = new PostQuietDisturbanceGate(); gate.consider({ ...base, simMs: 0 });
  expect(gate.consider({ ...base, ...change, simMs: 60_000 })).toBe(false);
  expect(gate.consider({ ...base, ...change, simMs: 120_000 })).toBe(true);
});
test("clock rewind restarts the interval; wall time cannot stand in for simulation time", () => {
  const gate = new PostQuietDisturbanceGate(); gate.consider({ ...base, simMs: 40_000 });
  gate.consider({ ...base, simMs: 50_000 });
  expect(gate.consider({ ...base, simMs: 0 })).toBe(false);
  expect(gate.consider({ ...base, simMs: 59_000 })).toBe(false);
});
test.each([{ remainingWallMs: 89_999 }, { remainingSimMs: 89_999 }, { remainingWallMs: NaN }])(
  "late eligibility never removes the response window: %p", change => {
    const gate = new PostQuietDisturbanceGate(); gate.consider({ ...base, simMs: 0 });
    expect(gate.consider({ ...base, ...change, simMs: 60_000 })).toBe(false);
  });
test("the fault uses the native state transition and updates public appearance", () => {
  const world = createArgosWorld("Fixture fault"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Plant room" });
  const actor = createAgentEntity(world, { name: "Ivo", role: "caretaker", roomId: room, systemPrompt: "Choose my own actions." });
  startCommittedEvents(world);
  const before = JSON.stringify(getWorkingMemory(world, actor));
  const perceptions = [...getAgentPerceptions(world, actor)];
  const valve = createObjectEntity(world, { name: "Valve", roomId: room, portable: false });
  worldSchema.defineObjectType({ name: "post_quiet_test_valve", description: "Valve", traits: ["openable"], defaultState: "closed",
    states: { closed: { description: "The valve is closed." }, open: { description: "The valve is open; water flows." } } });
  addComponent(world, valve, ObjectType); ObjectType.typeId[valve] = "post_quiet_test_valve";
  addComponent(world, valve, ObjectState); ObjectState.current[valve] = "closed";
  const result = reopenFixtureValve({ world, worldSchema, registry: { byName: new Map(), byId: new Map() } }, valve);
  expect(result).toEqual({ ok: true, oldState: "closed" });
  expect(ObjectState.current[valve]).toBe("open"); expect(ObjectState.previous[valve]).toBe("closed");
  expect(Description.value[valve]).toBe("The valve is open; water flows.");
  expect(StateTransition.triggeredBy[valve]).toBe("diagnostic physical fault");
  expect(JSON.stringify(getWorkingMemory(world, actor))).toBe(before);
  expect(getAgentPerceptions(world, actor)).toEqual(perceptions);
  expect(getCommittedEvents(world).events).toHaveLength(0);
});
