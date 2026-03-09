import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } from "../../ecs/prefabs";
import { formatActionsForPrompt, getValidActionTypes } from "../action-registry";

describe("Action registry (grounded available actions)", () => {
  it("includes 'interact' in valid action types", () => {
    const world = createArgosWorld("TestWorld");
    initializePrefabs(world);

    const roomEid = createRoomEntity(world, { name: "Room A" });
    const agentEid = createAgentEntity(world, {
      name: "Agent",
      role: "tester",
      systemPrompt: "test",
      roomId: roomEid,
    });

    const validTypes = getValidActionTypes(world, agentEid);
    expect(validTypes).toContain("interact");
  });

  it("lists grounded pickup and interact affordances for takeable objects", () => {
    const world = createArgosWorld("TestWorld");
    initializePrefabs(world);

    const roomEid = createRoomEntity(world, { name: "Room A" });
    const agentEid = createAgentEntity(world, {
      name: "Agent",
      role: "tester",
      systemPrompt: "test",
      roomId: roomEid,
    });

    createObjectEntity(world, {
      name: "Apple",
      portable: true,
      roomId: roomEid,
      traits: ["takeable"],
    });

    const prompt = formatActionsForPrompt(world, agentEid);
    expect(prompt).toContain("OBJECTS YOU CAN INTERACT WITH:");
    expect(prompt).toContain("Apple");
    expect(prompt).toContain("pickup");
    expect(prompt).toContain("interact via:");
    expect(prompt).toContain("take");
  });

  it("does not invent location affordance targets from room name", () => {
    const world = createArgosWorld("TestWorld");
    initializePrefabs(world);

    const roomEid = createRoomEntity(world, { name: "The Rusty Tavern" });
    const agentEid = createAgentEntity(world, {
      name: "Agent",
      role: "tester",
      systemPrompt: "test",
      roomId: roomEid,
    });

    const prompt = formatActionsForPrompt(world, agentEid);
    expect(prompt.toLowerCase()).not.toContain("innkeeper");
    expect(prompt.toLowerCase()).not.toContain("merchant");
    expect(prompt.toLowerCase()).not.toContain("altar");
    expect(prompt.toLowerCase()).not.toContain("bar");
  });
});

