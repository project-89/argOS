import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createRoomEntity } from "../../ecs/prefabs";
import { listDirectContents } from "../../ecs/location";
import { Traits } from "../../ecs/components";
import { materializeRoomFromSchemaPlan, type RoomCreationRequest } from "../steward-spirit";
import { ObjectType } from "../../ecs/components";

describe("Steward schema materialization", () => {
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

