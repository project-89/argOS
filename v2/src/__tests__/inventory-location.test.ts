/**
 * Unit tests for canonical inventory via LocatedIn
 *
 * Ensures pickup/drop mutate the containment graph (LocatedIn),
 * with Inventory.items treated as a compatibility cache only.
 */

import { addComponent, getRelationTargets } from "bitecs";
import { createSystemRegistry, type SystemRegistry } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } from "../ecs/prefabs";
import { Container, Inventory, ObjectState, Perception, Surface } from "../ecs/components";
import { syncInventoryCache, tryAddToInventory, tryRemoveFromInventory } from "../ecs/inventory";
import { LocatedIn } from "../ecs/relations";
import { getDirectContainer, listDirectContents, setLocatedIn } from "../ecs/location";
import { executeActions } from "../cognition/cognition-system";
import { getAgentPerceptions } from "../cognition/agent-mind";
import { getAgentVisualEntities } from "../cognition/world-capabilities";

describe("Inventory via LocatedIn", () => {
  let world: ReturnType<typeof createArgosWorld>;
  let registry: SystemRegistry;

  beforeEach(() => {
    world = createArgosWorld("TestWorld");
    initializePrefabs(world);
    registry = createSystemRegistry();
  });

  it("keeps non-agent container counts consistent across real transfers", () => {
    const room = createRoomEntity(world, { name: "Room" });
    const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "test", roomId: room });
    const cupboard = createObjectEntity(world, { name: "Cupboard", roomId: room, portable: false });
    const table = createObjectEntity(world, { name: "Table", roomId: room, portable: false });
    const fuse = createObjectEntity(world, { name: "Fuse", roomId: room, portable: true });
    addComponent(world, cupboard, Container); addComponent(world, table, Surface);
    setLocatedIn(world, fuse, cupboard); syncInventoryCache(world, cupboard); syncInventoryCache(world, table);
    expect(Container.currentCount[cupboard]).toBe(1);
    expect(tryAddToInventory(world, actor, fuse).success).toBe(true);
    expect(Container.currentCount[cupboard]).toBe(0);
    expect(tryRemoveFromInventory(world, actor, fuse, table).success).toBe(true);
    expect(Surface.currentCount[table]).toBe(1);
    expect(getDirectContainer(world, fuse)).toBe(table);
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

  it("physically picks up a visible item from a typed tabletop without a fake open trait", () => {
    const room = createRoomEntity(world, { name: "Room" });
    const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "test", roomId: room });
    const table = createObjectEntity(world, { name: "Table", roomId: room, portable: false });
    const phone = createObjectEntity(world, { name: "Phone", roomId: room, portable: true, traits: ["takeable"] });
    addComponent(world, table, Surface);
    setLocatedIn(world, phone, table);
    syncInventoryCache(world, table);
    expect(getAgentVisualEntities(world, actor)).toContain(phone);
    expect(Surface.currentCount[table]).toBe(1);

    executeActions(world, [{ eid: actor, action: { type: "pickup", target: "Phone" } }], registry);

    expect(getDirectContainer(world, phone)).toBe(actor);
    expect(JSON.parse(Inventory.items[actor])).toContain(phone);
    expect(Surface.currentCount[table]).toBe(0);
  });

  it.each(["closed", "locked"])("%s enclosure state blocks pickup despite a stale open trait", state => {
    const room = createRoomEntity(world, { name: "Room" });
    const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "test", roomId: room });
    const chest = createObjectEntity(world, { name: "Chest", roomId: room, portable: false, traits: ["open"] });
    const key = createObjectEntity(world, { name: "Key", roomId: room, portable: true, traits: ["takeable"] });
    addComponent(world, chest, Container);
    ObjectState.current[chest] = state;
    setLocatedIn(world, key, chest);
    syncInventoryCache(world, chest);
    expect(getAgentVisualEntities(world, actor)).not.toContain(key);

    executeActions(world, [{ eid: actor, action: { type: "pickup", target: "Key" } }], registry);

    expect(getDirectContainer(world, key)).toBe(chest);
    expect(JSON.parse(Inventory.items[actor] || "[]")).not.toContain(key);
    expect(Container.currentCount[chest]).toBe(1);
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
