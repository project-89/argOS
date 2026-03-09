/**
 * Unit tests for canonical inventory via LocatedIn
 *
 * Ensures pickup/drop mutate the containment graph (LocatedIn),
 * with Inventory.items treated as a compatibility cache only.
 */

import { getRelationTargets } from "bitecs";
import { createSystemRegistry, type SystemRegistry } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } from "../ecs/prefabs";
import { Inventory, ObjectState, Perception } from "../ecs/components";
import { LocatedIn } from "../ecs/relations";
import { getDirectContainer, listDirectContents, setLocatedIn } from "../ecs/location";
import { executeActions } from "../cognition/cognition-system";
import { getAgentPerceptions } from "../cognition/agent-mind";

describe("Inventory via LocatedIn", () => {
  let world: ReturnType<typeof createArgosWorld>;
  let registry: SystemRegistry;

  beforeEach(() => {
    world = createArgosWorld("TestWorld");
    initializePrefabs(world);
    registry = createSystemRegistry();
  });

  it("pickup moves item from room to agent; drop moves item back to room", () => {
    const roomEid = createRoomEntity(world, { name: "Room" });
    const agentEid = createAgentEntity(world, {
      name: "Agent",
      role: "tester",
      systemPrompt: "test",
      roomId: roomEid,
    });

    const appleEid = createObjectEntity(world, {
      name: "Apple",
      portable: true,
      roomId: roomEid,
      traits: ["takeable"],
    });

    expect(getDirectContainer(world, appleEid)).toBe(roomEid);
    expect(getRelationTargets(world, appleEid, LocatedIn)).toContain(roomEid);

    executeActions(world, [{ eid: agentEid, action: { type: "pickup", target: "Apple" } }], registry);

    expect(getDirectContainer(world, appleEid)).toBe(agentEid);
    expect(listDirectContents(world, roomEid)).not.toContain(appleEid);
    expect(listDirectContents(world, agentEid)).toContain(appleEid);

    // Compatibility cache updated
    expect(JSON.parse(Inventory.items[agentEid] || "[]")).toContain(appleEid);

    executeActions(world, [{ eid: agentEid, action: { type: "drop", target: "Apple" } }], registry);

    expect(getDirectContainer(world, appleEid)).toBe(roomEid);
    expect(listDirectContents(world, roomEid)).toContain(appleEid);
    expect(listDirectContents(world, agentEid)).not.toContain(appleEid);

    // Compatibility cache updated
    expect(JSON.parse(Inventory.items[agentEid] || "[]")).not.toContain(appleEid);
  });

  it("pickup resolves sensory-style targets with state annotations (e.g., 'food [fresh]')", () => {
    const roomEid = createRoomEntity(world, { name: "Room" });
    const agentEid = createAgentEntity(world, {
      name: "Agent",
      role: "tester",
      systemPrompt: "test",
      roomId: roomEid,
    });

    const foodEid = createObjectEntity(world, {
      name: "food",
      portable: true,
      roomId: roomEid,
      traits: ["takeable"],
    });
    // Sensory output formats state as `name [state]`.
    // This used to break name resolution for actions targeting the perceived string.
    ObjectState.current[foodEid] = "fresh";

    executeActions(world, [{ eid: agentEid, action: { type: "pickup", target: "food [fresh]" } }], registry);

    expect(getDirectContainer(world, foodEid)).toBe(agentEid);
    expect(listDirectContents(world, agentEid)).toContain(foodEid);
  });

  it("pickup can match a base noun even when the object name includes adjectives", () => {
    const roomEid = createRoomEntity(world, { name: "Room" });
    const agentEid = createAgentEntity(world, {
      name: "Agent",
      role: "tester",
      systemPrompt: "test",
      roomId: roomEid,
    });

    const foodEid = createObjectEntity(world, {
      name: "fresh food",
      portable: true,
      roomId: roomEid,
      traits: ["takeable"],
    });
    ObjectState.current[foodEid] = "fresh";

    executeActions(world, [{ eid: agentEid, action: { type: "pickup", target: "food [fresh]" } }], registry);

    expect(getDirectContainer(world, foodEid)).toBe(agentEid);
  });

  it("blocks immediate repeats of the same failed pickup (forces recovery)", () => {
    const roomEid = createRoomEntity(world, { name: "Room" });
    const agentEid = createAgentEntity(world, {
      name: "Agent",
      role: "tester",
      systemPrompt: "test",
      roomId: roomEid,
    });

    const chestEid = createObjectEntity(world, {
      name: "Chest",
      portable: false,
      roomId: roomEid,
      traits: ["container"],
    });
    const appleEid = createObjectEntity(world, {
      name: "Apple",
      portable: true,
      roomId: roomEid,
      traits: ["takeable"],
    });
    // Apple is inside the chest (so pickup should fail as "not directly accessible")
    setLocatedIn(world, appleEid, chestEid);

    executeActions(world, [{ eid: agentEid, action: { type: "pickup", target: "Apple" } }], registry);
    executeActions(world, [{ eid: agentEid, action: { type: "pickup", target: "Apple" } }], registry);

    const perceptionEids = getAgentPerceptions(world, agentEid);
    const failures = perceptionEids
      .filter((peid) => Perception.type[peid] === "action_failed")
      .map((peid) => Perception.content[peid]);

    expect(failures.some((c) => c.includes("repeating the same action"))).toBe(true);
  });
});
