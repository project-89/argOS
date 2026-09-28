import { addEntity, addComponent, getAllEntities, hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Room, Name, Position, Inventory, GridPosition, Agent, Mind, Needs, Health, ObjectType, ObjectState, Traits, PhysicalObject } from "../../ecs/components";
import { getAspirations } from "../../cognition/goal-learning";
import { getNarrativeHistory } from "../../cognition/narrative-memory";
import { validateAuthoredEntityBlueprint } from "../place-materialization";
import { tryAddToInventory, getInventoryItems } from "../../ecs/inventory";
import { initializeRegistry, registryCreateComponent, getComponent } from "../../ecs/component-registry";
import { getRoomForEntity } from "../../ecs/location";
import { materializeApprovedEntity, type MaterializedEntitySpec } from "../entity-materialization";
import { enableRoomRouteTopology, getRoomRouteTargets } from "../../runtime/room-routes";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { executeActions } from "../../cognition/cognition-system";
import { advanceSimulationTimeline } from "../../runtime/simulation-timeline";

function setup() {
  const world = createArgosWorld("Apartment"); initializeRegistry(world);
  const room = addEntity(world); addComponent(world, room, Room); addComponent(world, room, Name); Name.value[room] = "Kitchen";
  const spec: MaterializedEntitySpec = { name: "Sink valve", description: "A brass shutoff valve in the kitchen.", type: "object", roomEid: room, components: [] };
  return { world, room, spec };
}
test("materializes real static and dynamic components and canonical room membership", () => {
  const f = setup(); registryCreateComponent({ name: "Valve", description: "Water supply", properties: { open: "boolean", rate: "number" }, defaults: { open: true, rate: 2 } });
  f.spec.components = [{ name: "Position", values: { x: 2, y: 1, z: 0 } }, { name: "GridPosition", values: { x: 2, y: 1 } },
    { name: "Inventory", values: {} }, { name: "Valve", values: { open: false } }];
  const id = materializeApprovedEntity(f.world, f.spec);
  expect(hasComponent(f.world, id, Position)).toBe(true); expect(Position.x[id]).toBe(2);
  expect(hasComponent(f.world, id, GridPosition)).toBe(true); expect(hasComponent(f.world, id, Inventory)).toBe(true);
  expect(getRoomForEntity(f.world, id)).toBe(f.room);
  expect(getComponent("Valve").open[id]).toBe(false); expect(getComponent("Valve").rate[id]).toBe(2);
});

test("a generated prop receives the same usable object baseline as an authored prop", () => {
  const f = setup();
  const id = materializeApprovedEntity(f.world,f.spec);
  for (const component of [PhysicalObject,ObjectType,ObjectState,Traits,GridPosition]) expect(hasComponent(f.world,id,component)).toBe(true);
  expect(ObjectType.typeId[id]).toBe("object"); expect(ObjectState.current[id]).toBe("normal");
  expect(JSON.parse(Traits.active[id])).toEqual(expect.arrayContaining(["examinable","takeable"]));
  expect(PhysicalObject.portable[id]).toBe(true);
});
test.each([
  { name: "MissingPhysics", values: {} }, { name: "Position", values: { x: "2" } },
  { name: "Position", values: { secretExtraField: 2 } }, { name: "Position", values: { x: Infinity } },
])("invalid requested components leave no partial entity: %j", component => {
  const f = setup(); const before = [...getAllEntities(f.world)];
  expect(() => materializeApprovedEntity(f.world, { ...f.spec, components: [component] })).toThrow(/Unknown component|Invalid type or unknown field/);
  expect([...getAllEntities(f.world)]).toEqual(before);
});
test("physical objects cannot be reported created without a real room", () => {
  const f = setup(); const before = [...getAllEntities(f.world)];
  expect(() => materializeApprovedEntity(f.world, { ...f.spec, roomEid: undefined })).toThrow(/roomEid/);
  expect([...getAllEntities(f.world)]).toEqual(before);
});

test("generated inhabitants receive the normal physical, cognitive and interaction baseline", () => {
  const f = setup();
  addComponent(f.world, f.room, GridPosition); GridPosition.x[f.room] = 24; GridPosition.y[f.room] = 36;
  const actor = materializeApprovedEntity(f.world, { name: "Nora", description: "A local baker.", type: "agent", roomEid: f.room,
    components: [{ name: "Agent", values: { role: "baker" } }, { name: "Needs", values: { hunger: 35 } }, { name: "Inventory", values: { maxSlots: 4 } }] });
  for (const component of [Agent, Mind, Needs, Health, Inventory, GridPosition, ObjectType, ObjectState, Traits])
    expect(hasComponent(f.world, actor, component)).toBe(true);
  expect(Agent.active[actor]).toBe(true); expect(Agent.systemPrompt[actor]).toContain("Nora");
  expect(Needs.hunger[actor]).toBe(35); expect(Needs.energy[actor]).toBe(100);
  expect(Inventory.maxSlots[actor]).toBe(4); expect(Inventory.maxWeight[actor]).toBe(50);
  expect(ObjectType.typeId[actor]).toBe("npc"); expect(ObjectState.current[actor]).toBe("idle");
  expect(JSON.parse(Traits.active[actor])).toContain("talkable");
  expect(getAspirations(f.world, actor).length).toBeGreaterThan(0);
  expect(Math.abs(GridPosition.x[actor] - GridPosition.x[f.room])).toBeLessThanOrEqual(1);
  expect(Math.abs(GridPosition.y[actor] - GridPosition.y[f.room])).toBeLessThanOrEqual(1);
  const item = materializeApprovedEntity(f.world, f.spec);
  expect(tryAddToInventory(f.world, actor, item)).toEqual({ success: true });
  expect(getInventoryItems(f.world, actor)).toEqual([item]);
  expect(getRoomForEntity(f.world, item)).toBe(f.room);
});

const authoredPast = {background:"PRIVATE: I grew up above my aunt's bakery",drives:["Feed people well"],memories:[{
  recollection:"PRIVATE: My aunt shared her last loaf with me",period:"Age ten",emotionalTone:"warmth",importance:0.9,
  selfBelief:"Food can be kindness",meaning:"I want people to feel welcome",cues:["bread"],provenance:"authored-history" as const}]};
test("generated inhabitants receive private formative history through canonical creation",()=>{
  const f=setup();startCommittedEvents(f.world);
  const spec=validateAuthoredEntityBlueprint({name:"Nora",description:"A flour-dusted baker",type:"agent",roomEid:f.room,past:authoredPast,
    components:[{name:"Agent",values:{role:"baker",systemPrompt:"You are Nora."}}]});
  const actor=materializeApprovedEntity(f.world,spec);
  expect(Agent.systemPrompt[actor]).toContain(authoredPast.background);
  expect(getAspirations(f.world, actor)).toContain("Feed people well");
  expect(JSON.stringify(getNarrativeHistory(f.world,actor))).toContain(authoredPast.memories[0].recollection);
  expect(getComponent("Description").value[actor]).not.toContain("PRIVATE");
});
test.each(["object","invalid memory","last place member"])("invalid biography %s fails before allocation",variant=>{
  const f=setup(),before=[...getAllEntities(f.world)];
  const resident={name:"Nora",description:"Baker",type:"agent",components:[],past:authoredPast};
  const input=variant==="last place member"?{name:"Bakery",description:"Shop",type:"room",components:[],contents:[
    {id:"baker",entity:resident},{id:"bad",entity:{...resident,name:"Invalid",past:{...authoredPast,memories:[]}}}]}:
    {...resident,type:variant==="object"?"object":"agent",roomEid:f.room,past:variant==="invalid memory"?{...authoredPast,memories:[]}:authoredPast};
  expect(()=>validateAuthoredEntityBlueprint(input)).toThrow();expect([...getAllEntities(f.world)]).toEqual(before);
});

test("generated rooms have the same spatial and affordance baseline as authored rooms", () => {
  const f = setup();
  const room = materializeApprovedEntity(f.world, { name: "Workshop", description: "A place to work.", type: "room",
    components: [{ name: "Room", values: { capacity: 6 } }, { name: "Position", values: { x: 320, y: 160 } }] });
  for (const component of [Room, Position, GridPosition, ObjectType, ObjectState, Traits]) expect(hasComponent(f.world, room, component)).toBe(true);
  expect(Room.capacity[room]).toBe(6); expect(Room.ambience[room]).toBe("neutral");
  expect(Position.x[room]).toBe(320); expect(Position.y[room]).toBe(160);
  expect(GridPosition.x[room]).toBe(16); expect(GridPosition.y[room]).toBe(8);
  expect(ObjectType.typeId[room]).toBe("room"); expect(JSON.parse(Traits.active[room])).toContain("location");
});

test("invalid generated inhabitants fail before allocating or initializing an NPC", () => {
  const f = setup(), before = [...getAllEntities(f.world)];
  expect(() => materializeApprovedEntity(f.world, { ...f.spec, type: "agent", components: [{ name: "Needs", values: { energy: "awake" } }] })).toThrow(/Invalid type/);
  expect([...getAllEntities(f.world)]).toEqual(before);
});

test("a generated room is reachable by the same timed native route as authored destinations", () => {
  const f = setup(); startCommittedEvents(f.world); const disable = enableRoomRouteTopology(f.world);
  try {
    const actor = materializeApprovedEntity(f.world, { name: "Nora", description: "A local baker.", type: "agent", roomEid: f.room, components: [] });
    const destination = materializeApprovedEntity(f.world, { name: "Workshop", description: "A place to work.", type: "room", components: [], connectToRoomEids: [f.room] });
    expect(getRoomRouteTargets(f.world, actor)).toEqual([destination]);
    executeActions(f.world, [{ eid: actor, action: { type: "move", target: "Workshop" } }], createSystemRegistry());
    advanceSimulationTimeline(f.world, 2999, { integrate: () => {} });
    expect(getRoomForEntity(f.world, actor)).toBe(f.room);
    advanceSimulationTimeline(f.world, 1, { integrate: () => {} });
    expect(getRoomForEntity(f.world, actor)).toBe(destination);
    expect(getRoomRouteTargets(f.world, actor)).toEqual([f.room]);
  } finally { disable(); stopCommittedEvents(f.world); }
});

test.each(["missing", "duplicate", "too_many", "unopted", "stopped", "wrong_type"])("invalid route authoring (%s) cannot leave a partial room", boundary => {
  const f = setup(); startCommittedEvents(f.world);
  const disable = boundary === "unopted" ? undefined : enableRoomRouteTopology(f.world);
  try {
    const spec: MaterializedEntitySpec = { name: "Workshop", description: "A place to work.", type: "room", components: [], connectToRoomEids: [f.room] };
    if (boundary === "missing") spec.connectToRoomEids = [9999999];
    if (boundary === "duplicate") spec.connectToRoomEids = [f.room, f.room];
    if (boundary === "too_many") spec.connectToRoomEids = Array.from({ length: 9 }, (_, i) => i);
    if (boundary === "stopped") stopCommittedEvents(f.world);
    if (boundary === "wrong_type") { spec.type = "object"; spec.roomEid = f.room; }
    const before = [...getAllEntities(f.world)];
    expect(() => materializeApprovedEntity(f.world, spec)).toThrow();
    expect([...getAllEntities(f.world)]).toEqual(before);
  } finally { disable?.(); stopCommittedEvents(f.world); }
});
