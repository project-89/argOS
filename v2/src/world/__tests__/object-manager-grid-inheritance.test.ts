import { hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createRoomEntity } from "../../ecs/prefabs";
import { GridPosition } from "../../ecs/components";
import { ObjectManager } from "../object-manager";

describe("ObjectManager GridPosition inheritance", () => {
  it("inherits GridPosition from container when spawning into a room without explicit position", () => {
    const world = createArgosWorld("TestWorld");
    initializePrefabs(world);

    const roomEid = createRoomEntity(world, { name: "Room" });
    const roomX = GridPosition.x[roomEid];
    const roomY = GridPosition.y[roomEid];

    const originalRandom = Math.random;
    Math.random = () => 0.5; // offset 0
    try {
      const objectManager = new ObjectManager(world);
      const foodEid = objectManager.spawn("food_item", {
        containedIn: roomEid,
        // no position
        properties: { foodType: "bread" },
      });

      expect(foodEid).not.toBeNull();
      expect(hasComponent(world, foodEid!, GridPosition)).toBe(true);
      expect(GridPosition.x[foodEid!]).toBe(roomX);
      expect(GridPosition.y[foodEid!]).toBe(roomY);
    } finally {
      Math.random = originalRandom;
    }
  });

  it("does not override explicit position when provided", () => {
    const world = createArgosWorld("TestWorld");
    initializePrefabs(world);

    const roomEid = createRoomEntity(world, { name: "Room" });

    const objectManager = new ObjectManager(world);
    const eid = objectManager.spawn("food_item", {
      containedIn: roomEid,
      position: { x: 123, y: 456 },
      properties: { foodType: "bread" },
    });

    expect(eid).not.toBeNull();
    expect(hasComponent(world, eid!, GridPosition)).toBe(true);
    expect(GridPosition.x[eid!]).toBe(123);
    expect(GridPosition.y[eid!]).toBe(456);
  });
});

