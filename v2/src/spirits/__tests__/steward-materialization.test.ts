import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createRoomEntity } from "../../ecs/prefabs";
import { listDirectContents } from "../../ecs/location";
import { Traits } from "../../ecs/components";
import { materializeRoomFromSchemaPlan, type RoomCreationRequest } from "../steward-spirit";
import { ObjectType } from "../../ecs/components";
import { worldSchema } from "../../world/schema";
import { configureWorldConstructionBudget, getWorldConstructionStatus } from "../../runtime/world-construction-budget";

describe("Steward schema materialization", () => {
  it("rejects a known oversized population before schema or partial entity writes", () => {
    const world = createArgosWorld("No partial population"); initializePrefabs(world);
    const room = createRoomEntity(world, { name: "Street" }); configureWorldConstructionBudget(world, 2);
    const request: RoomCreationRequest = { id: "bounded_street", timestamp: Date.now(), requestedBy: 0,
      roomType: "general", roomName: "Street", context: {} };
    const plan = { newTypes: [{ name: "bounded_street_fixture", traits: ["examinable"] }],
      entities: [{ type: "bounded_street_fixture" }], ambientStimuli: [{ type: "sound", template: "Traffic." }] };
    expect(() => materializeRoomFromSchemaPlan(world, request, room, plan)).toThrow(/construction budget/);
    expect(listDirectContents(world, room)).toEqual([]);
    expect(worldSchema.getObjectType("bounded_street_fixture")).toBeUndefined();
    expect(getWorldConstructionStatus(world).admitted).toBe(1);
  });
  it("enforces the request's total item bound even in an unbounded world", () => {
    const world = createArgosWorld("Request bound"); initializePrefabs(world);
    const room = createRoomEntity(world, { name: "Hallway" });
    const request: RoomCreationRequest = { id: "item_bound", timestamp: 1, requestedBy: 0,
      roomType: "general", roomName: "Hallway", context: {}, constraints: { maxItems: 1 } };
    expect(() => materializeRoomFromSchemaPlan(world, request, room, {
      entities: [{ type: "chair" }], ambientStimuli: [{ type: "sound", template: "Footsteps." }],
    })).toThrow(/maxItems/);
    expect(listDirectContents(world, room)).toEqual([]);
  });
  it("includes native food fallback in preflight, without charging a fallback when edible food is planned", () => {
    const world = createArgosWorld("Food allowance"); initializePrefabs(world);
    const room = createRoomEntity(world, { name: "Bakery" }); configureWorldConstructionBudget(world, 2);
    const request: RoomCreationRequest = { id: "food_bound", timestamp: 1, requestedBy: 0,
      roomType: "bakery", roomName: "Bakery", context: {}, constraints: { maxItems: 1 } };
    expect(() => materializeRoomFromSchemaPlan(world, request, room, { entities: [{ type: "chair" }] })).toThrow(/maxItems/);
    expect(listDirectContents(world, room)).toEqual([]);
    // The normal materializer resolves this spelling via food_item, not a new type.
    const result = materializeRoomFromSchemaPlan(world, request, room, { entities: [{ type: "Food Item", state: "fresh" }] });
    expect(result.entityIds).toHaveLength(1);
    expect(getWorldConstructionStatus(world).admitted).toBe(2);
  });
  it("admits an exact fit including its ambient allocation", () => {
    const world = createArgosWorld("Exact fit"); initializePrefabs(world);
    const room = createRoomEntity(world, { name: "Hallway" }); configureWorldConstructionBudget(world, 3);
    const result = materializeRoomFromSchemaPlan(world, { id: "exact", timestamp: 1, requestedBy: 0,
      roomType: "general", roomName: "Hallway", context: {}, constraints: { maxItems: 2 } },
    room, { entities: [{ type: "chair" }], ambientStimuli: [{ type: "sound", template: "Footsteps." }] });
    expect(result.entityIds).toHaveLength(1); expect(result.ambientEntityIds).toHaveLength(1);
    expect(getWorldConstructionStatus(world).admitted).toBe(3);
  });
  it("counts food fallback from actual state traits, not a type's base traits alone", () => {
    const world = createArgosWorld("State traits"); initializePrefabs(world);
    const room = createRoomEntity(world, { name: "Bakery" }); configureWorldConstructionBudget(world, 2);
    const request: RoomCreationRequest = { id: "state_food", timestamp: 1, requestedBy: 0,
      roomType: "bakery", roomName: "Bakery", context: {}, constraints: { maxItems: 1 } };
    expect(() => materializeRoomFromSchemaPlan(world, request, room, {
      entities: [{ type: "food_item", state: "rotten" }],
    })).toThrow(/maxItems/);
    expect(listDirectContents(world, room)).toEqual([]);
    const result = materializeRoomFromSchemaPlan(world, request, room, {
      newTypes: [{ name: "state_edible_fixture", traits: ["examinable"], defaultState: "ready",
        states: { ready: { description: "An edible portion.", traits: ["edible"] } } }],
      entities: [{ type: "state_edible_fixture" }],
    });
    expect(result.entityIds).toHaveLength(1);
    expect(getWorldConstructionStatus(world).admitted).toBe(2);
  });
  it("spawns entities from a schema plan into the target room", () => {
    const world = createArgosWorld("TestWorld");
    initializePrefabs(world);

    const roomEid = createRoomEntity(world, { name: "Test Bakery" });

    const request: RoomCreationRequest = {
      id: "room_test",
      timestamp: Date.now(),
      requestedBy: 0,
      roomType: "bakery",
      roomName: "Test Bakery",
      context: {},
      constraints: {},
    };

    const result = materializeRoomFromSchemaPlan(
      world,
      request,
      roomEid,
      {
        newTypes: [],
        entities: [
          { type: "table" },
          { type: "food_item", state: "fresh", properties: { foodType: "bread", adjective: "fresh" } },
        ],
        ambientStimuli: [],
      }
    );

    expect(result.roomName).toBe("Test Bakery");
    expect(result.entityIds.length).toBeGreaterThanOrEqual(2);

    const contents = listDirectContents(world, roomEid);
    for (const eid of result.entityIds) {
      expect(contents).toContain(eid);
    }

    const foodEid = result.entityIds.find(eid => ObjectType.typeId[eid] === "food_item");
    expect(foodEid).toBeDefined();
    expect(JSON.parse(Traits.active[foodEid!] || "[]")).toEqual(
      expect.arrayContaining(["edible", "takeable"])
    );
  });

  it("ensures at least one edible item in food-centric rooms", () => {
    const world = createArgosWorld("TestWorld");
    initializePrefabs(world);

    const roomEid = createRoomEntity(world, { name: "Empty Tavern" });

    const request: RoomCreationRequest = {
      id: "room_test_2",
      timestamp: Date.now(),
      requestedBy: 0,
      roomType: "tavern",
      roomName: "Empty Tavern",
      context: {},
      constraints: {},
    };

    const result = materializeRoomFromSchemaPlan(
      world,
      request,
      roomEid,
      { newTypes: [], entities: [{ type: "chair" }], ambientStimuli: [] }
    );

    const hasEdible = result.entityIds.some(eid =>
      (JSON.parse(Traits.active[eid] || "[]") as string[]).includes("edible")
    );
    expect(hasEdible).toBe(true);
  });
});
