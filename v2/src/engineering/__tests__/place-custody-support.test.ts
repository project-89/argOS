import { getAllEntities } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializeRegistry } from "../../ecs/component-registry";
import { initializePrefabs } from "../../ecs/prefabs";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { getDirectContainer, setLocatedIn } from "../../ecs/location";
import { startCommittedEvents, stopCommittedEvents, getCommittedEvents } from "../../runtime/committed-events";
import { executeAffordance } from "../../world/effect-executor";
import { worldSchema } from "../../world/schema";
import { getPlaceBuildStatus, materializePlaceBlueprint, type RoomBlueprint } from "../place-materialization";
import { placeSupportRequirementsSchema, validatePlaceSupportDesign } from "../place-support";

const worlds: ReturnType<typeof createArgosWorld>[] = [];
afterEach(() => worlds.splice(0).forEach(stopCommittedEvents));
function fixture() {
  const world = createArgosWorld("Initial custody"); worlds.push(world);
  initializeRegistry(world); initializePrefabs(world); startCommittedEvents(world);
  const registry = createSystemRegistry();
  const requirements = [
    { id: "owner", kind: "entity", entityType: "agent", description: "The resident" },
    { id: "guest", kind: "entity", entityType: "agent", description: "Another resident" },
    { id: "stock", kind: "entity", entityType: "object", objectType: "food_item", description: "Finite food" },
    { id: "supply", kind: "initial_custody", item: "stock", holder: "owner", description: "Resident starts with stock" },
  ];
  const spec: RoomBlueprint = { name: "Kitchen", description: "A staffed kitchen", type: "room", components: [], contents: [
    { id: "owner", entity: { name: "Leo", type: "agent", description: "A cook", components: [] } },
    { id: "guest", entity: { name: "Jo", type: "agent", description: "A diner", components: [] } },
    { id: "stock", carriedBy: "owner", entity: { name: "Bread", type: "object", description: "Fresh bread", components: [
      { name: "ObjectType", values: { typeId: "food_item" } }, { name: "PhysicalObject", values: { portable: true, weight: 0.2 } },
    ] } },
  ] };
  return { world, registry, requirements, spec };
}

test.each(["absent_item", "absent_holder", "room_holder", "object_holder", "agent_item", "existing_holder", "existing_item", "duplicate_item", "conflicting_holder", "unknown_authority"])(
  "initial custody rejects invalid or overlapping authority before allocation: %s", boundary => {
    const f = fixture(), input: any[] = structuredClone(f.requirements), custody = input[3];
    if (boundary === "absent_item") custody.item = "missing";
    if (boundary === "absent_holder") custody.holder = "missing";
    if (boundary === "room_holder") custody.holder = "room";
    if (boundary === "object_holder") custody.holder = "stock";
    if (boundary === "agent_item") custody.item = "guest";
    if (boundary === "existing_holder") input[0] = { id: "owner", kind: "existing_actor", intentionRef: "intention:outside", description: "Existing person" };
    if (boundary === "existing_item") input[2] = { id: "stock", kind: "existing_actor", intentionRef: "intention:outside", description: "Existing person" };
    if (boundary === "duplicate_item" || boundary === "conflicting_holder") input.push({ ...custody, id: "second", holder: boundary === "duplicate_item" ? "owner" : "guest" });
    if (boundary === "unknown_authority") custody.alwaysRestock = true;
    const before = getAllEntities(f.world).length;
    expect(placeSupportRequirementsSchema.safeParse(input).success).toBe(false);
    expect(() => materializePlaceBlueprint(f.world, f.spec, undefined, input as any)).toThrow();
    expect(getAllEntities(f.world)).toHaveLength(before);
    expect(getPlaceBuildStatus(f.world, f.registry)).toEqual([]);
  });

test.each(["omitted", "changed", "prose_only"])("detailed design cannot weaken required initial custody: %s", boundary => {
  const f = fixture(), stock = f.spec.contents[2];
  if (boundary === "changed") stock.carriedBy = "guest";
  else delete stock.carriedBy;
  if (boundary === "prose_only") stock.entity.description = "Leo owns this bread and will hand it to Jo.";
  expect(() => validatePlaceSupportDesign(f.spec, f.requirements)).toThrow(/support requirement supply/);
  const before = getAllEntities(f.world).length;
  expect(() => materializePlaceBlueprint(f.world, f.spec, undefined, f.requirements as any)).toThrow();
  expect(getAllEntities(f.world)).toHaveLength(before);
});

test("native initial custody is historical evidence, never a replayed handoff or replenishment policy", () => {
  const f = fixture(), support = placeSupportRequirementsSchema.parse(f.requirements);
  f.world.time.elapsed = 4500;
  materializePlaceBlueprint(f.world, f.spec, undefined, support);
  const initial = getPlaceBuildStatus(f.world, f.registry)[0];
  const owner = initial.members.find(m => m.id === "owner")!, guest = initial.members.find(m => m.id === "guest")!, stock = initial.members.find(m => m.id === "stock")!;
  expect(getDirectContainer(f.world, stock.eid)).toBe(owner.eid);
  expect(initial.initialCustody).toEqual([{ item: "stock", holder: "owner", itemKey: stock.key, holderKey: owner.key, atSimMs: 4500 }]);
  expect(initial.support.status).toBe("available");
  expect(getCommittedEvents(f.world).events.filter(e => e.action === "give")).toEqual([]);
  // Test-only movement exercises post-construction observation, not NPC agency.
  setLocatedIn(f.world, stock.eid, guest.eid);
  const transferred = getPlaceBuildStatus(f.world, f.registry)[0];
  expect(transferred.initialCustody).toEqual(initial.initialCustody);
  expect(transferred.support.status).toBe("available");
  const result = executeAffordance("eat", { world: f.world, worldSchema, registry: {
    byName: new Map([[guest.name, guest.eid], [stock.name, stock.eid]]), byId: new Map([[guest.eid, guest.name], [stock.eid, stock.name]]),
  }, actorEid: guest.eid, targetEid: stock.eid });
  expect(result.success).toBe(true);
  const count = getAllEntities(f.world).length, consumed = getPlaceBuildStatus(f.world, f.registry)[0];
  expect(consumed.initialCustody).toEqual(initial.initialCustody);
  expect(consumed.support).toMatchObject({ status: "unavailable", unmet: [{ id: "stock", reason: "member_unavailable" }] });
  expect(getAllEntities(f.world)).toHaveLength(count);
  initial.initialCustody.splice(0); support.splice(0);
  expect(getPlaceBuildStatus(f.world, f.registry)[0].initialCustody).toHaveLength(1);
  expect(getPlaceBuildStatus(fixture().world, f.registry)).toEqual([]);
});
