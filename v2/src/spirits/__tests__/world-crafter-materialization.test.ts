import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createRoomEntity } from "../../ecs/prefabs";
import { listDirectContents } from "../../ecs/location";
import { findEntityByName } from "../../cognition/cognition-system";
import { Traits } from "../../ecs/components";
import { materializeEntityForInteraction, type FailedInteraction } from "../world-crafter-spirit";

describe("WorldCrafter materialization (grounded)", () => {
  it("materializes edible food for eat interactions", () => {
    const world = createArgosWorld("TestWorld");
    initializePrefabs(world);

    createRoomEntity(world, { name: "Test Kitchen" });

    const interaction: FailedInteraction = {
      timestamp: Date.now(),
      agentName: "Alice",
      agentEid: 1,
      roomName: "Test Kitchen",
      actionType: "eat",
      targetName: "apple",
      originalContent: "eat apple",
    };

    const created = materializeEntityForInteraction(world, interaction);
    expect(created).not.toBeNull();
    expect(created!.typeId).toBe("food_item");

    const roomEid = findEntityByName(world, "Test Kitchen")!;
    const contents = listDirectContents(world, roomEid);
    expect(contents).toContain(created!.eid);

    const traits = JSON.parse(Traits.active[created!.eid] || "[]") as string[];
    expect(traits).toEqual(expect.arrayContaining(["edible", "takeable"]));

    expect(findEntityByName(world, "apple")).toBe(created!.eid);
  });

  it("materializes drinkable objects for drink interactions", () => {
    const world = createArgosWorld("TestWorld");
    initializePrefabs(world);

    createRoomEntity(world, { name: "Test Tavern" });

    const interaction: FailedInteraction = {
      timestamp: Date.now(),
      agentName: "Bob",
      agentEid: 2,
      roomName: "Test Tavern",
      actionType: "drink",
      targetName: "test_water",
      originalContent: "drink water",
    };

    const created = materializeEntityForInteraction(world, interaction);
    expect(created).not.toBeNull();

    const traits = JSON.parse(Traits.active[created!.eid] || "[]") as string[];
    expect(traits).toEqual(expect.arrayContaining(["drinkable", "takeable"]));
  });
});

