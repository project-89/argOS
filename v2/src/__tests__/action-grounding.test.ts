import { createSystemRegistry, type SystemRegistry } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } from "../ecs/prefabs";
import { setLocatedIn } from "../ecs/location";
import { executeActions } from "../cognition/cognition-system";
import { getAgentPerceptions } from "../cognition/agent-mind";
import { Perception } from "../ecs/components";

describe("Action grounding (target validation)", () => {
  let world: ReturnType<typeof createArgosWorld>;
  let registry: SystemRegistry;

  beforeEach(() => {
    world = createArgosWorld("TestWorld");
    initializePrefabs(world);
    registry = createSystemRegistry();
  });

  it("adds a critical action_failed perception when examining a non-existent target", () => {
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

    executeActions(
      world,
      [{ eid: agentEid, action: { type: "examine", target: "kitchen" } }],
      registry
    );

    const perceptionEids = getAgentPerceptions(world, agentEid);
    const failure = perceptionEids.find((peid) => Perception.type[peid] === "action_failed");
    expect(failure).toBeDefined();
    expect(Perception.content[failure!]).toContain("🚨 CRITICAL - YOUR LAST ACTION FAILED");
    expect(Perception.content[failure!]).toContain('examine "kitchen"');
    expect(Perception.content[failure!]).toContain("Visible here:");
    expect(Perception.content[failure!]).toContain("Apple");
    expect(Perception.content[failure!]).toContain("DO NOT proceed as if this action succeeded");
  });

  it("adds a critical action_failed perception when moving to an unknown place", () => {
    const roomA = createRoomEntity(world, { name: "Room A" });
    const roomB = createRoomEntity(world, { name: "Room B" });
    const agentEid = createAgentEntity(world, {
      name: "Agent",
      role: "tester",
      systemPrompt: "test",
      roomId: roomA,
    });

    executeActions(
      world,
      [{ eid: agentEid, action: { type: "move", target: "Kitchen" } }],
      registry
    );

    const perceptionEids = getAgentPerceptions(world, agentEid);
    const failure = perceptionEids.find((peid) => Perception.type[peid] === "action_failed");
    expect(failure).toBeDefined();
    expect(Perception.content[failure!]).toContain("🚨 CRITICAL - YOUR LAST ACTION FAILED");
    expect(Perception.content[failure!]).toContain('move to "Kitchen"');
    expect(Perception.content[failure!]).toContain("Known places:");
    expect(Perception.content[failure!]).toContain("Room A");
    expect(Perception.content[failure!]).toContain("Room B");
  });

  it("adds a critical action_failed perception when interacting with a non-accessible target", () => {
    const roomA = createRoomEntity(world, { name: "Room A" });
    const roomB = createRoomEntity(world, { name: "Room B" });
    const agentEid = createAgentEntity(world, {
      name: "Agent",
      role: "tester",
      systemPrompt: "test",
      roomId: roomA,
    });

    createObjectEntity(world, { name: "Apple", portable: true, roomId: roomA, traits: ["takeable"] });
    createObjectEntity(world, { name: "Chest", portable: false, roomId: roomB, traits: ["openable", "container"] });

    executeActions(
      world,
      [{ eid: agentEid, action: { type: "interact", target: "Chest", content: "examine" } }],
      registry
    );

    const perceptionEids = getAgentPerceptions(world, agentEid);
    const failure = perceptionEids.find((peid) => Perception.type[peid] === "action_failed");
    expect(failure).toBeDefined();
    expect(Perception.content[failure!]).toContain("🚨 CRITICAL - YOUR LAST ACTION FAILED");
    expect(Perception.content[failure!]).toContain("not directly accessible here");
    expect(Perception.content[failure!]).toContain("Chest");
    expect(Perception.content[failure!]).toContain("Visible here:");
    expect(Perception.content[failure!]).toContain("Apple");
  });

  it("allows interacting with a target inside a nested carried container", () => {
    const roomEid = createRoomEntity(world, { name: "Room A" });
    const agentEid = createAgentEntity(world, {
      name: "Agent",
      role: "tester",
      systemPrompt: "test",
      roomId: roomEid,
    });

    const backpackEid = createObjectEntity(world, { name: "Backpack", portable: true, roomId: roomEid, traits: ["container"] });
    // Actor is carrying the backpack.
    setLocatedIn(world, backpackEid, agentEid);
    const appleEid = createObjectEntity(world, { name: "Apple", portable: true, roomId: roomEid, traits: ["takeable"] });
    // Apple is inside the backpack.
    setLocatedIn(world, appleEid, backpackEid);

    executeActions(
      world,
      [{ eid: agentEid, action: { type: "interact", target: "Apple", content: "examine" } }],
      registry
    );

    const perceptionEids = getAgentPerceptions(world, agentEid);
    const failure = perceptionEids.find((peid) => Perception.type[peid] === "action_failed");
    expect(failure).toBeUndefined();
  });
});
