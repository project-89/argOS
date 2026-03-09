import { createSystemRegistry, registerSystem, runSystems, type SystemRegistry } from "../ecs/dynamic-systems";
import { createArgosWorld, type WorldContext } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";
import { query } from "bitecs";
import { Agent, Name, GridPosition, Room } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { compileMapIntoWorld } from "../world/map-compiler";
import { createMovementSystem, createRoomArrivalSystem, setMovementTarget } from "../systems/builtin-systems";

describe("Zone movement transitions", () => {
  let world: WorldContext;
  let registry: SystemRegistry;
  let tick: number;

  beforeEach(() => {
    world = createArgosWorld("ZoneMovementTransitionTest");
    initializePrefabs(world);
    registry = createSystemRegistry();
    tick = 0;
  });

  it("agent crosses zones and updates containment via zone geometry", () => {
    const map = {
      id: "demo-map",
      name: "Demo Map",
      grid: { width: 40, height: 20, tileSize: 32 },
      zones: [
        { id: "z1", name: "Town Square", roomType: "market", shape: { kind: "rect", x: 2, y: 2, w: 10, h: 10 } },
        { id: "z2", name: "The Golden Wheat", roomType: "tavern", shape: { kind: "rect", x: 26, y: 2, w: 10, h: 10 } },
      ],
      markers: [
        { id: "a1", kind: "spawn", spawnType: "agent", name: "Ada", x: 4, y: 4 },
      ],
    } as any;

    compileMapIntoWorld(world as any, map);

    const agentEids = query(world as any, [Agent, Name]);
    const agentEid = agentEids.find((eid) => Name.value[eid] === "Ada");
    expect(agentEid).toBeDefined();

    const roomEids = query(world as any, [Room, Name]);
    const targetRoomEid = roomEids.find((eid) => Name.value[eid] === "The Golden Wheat");
    expect(targetRoomEid).toBeDefined();

    const movement = createMovementSystem();
    const roomArrival = createRoomArrivalSystem();
    movement.lastRun = 0;
    roomArrival.lastRun = 0;
    registerSystem(registry, movement);
    registerSystem(registry, roomArrival);

    setMovementTarget(agentEid!, targetRoomEid!);

    const seenRooms = new Set<string>();

    for (let i = 0; i < 60; i++) {
      // Force systems to run each iteration (runSystems is wall-clock gated).
      movement.lastRun = 0;
      roomArrival.lastRun = 0;
      tick++;
      runSystems(world as any, registry, tick, 1000);

      const currentRoom = getRoomForEntity(world as any, agentEid!);
      const roomName = currentRoom !== undefined ? Name.value[currentRoom] : "<none>";
      if (roomName) seenRooms.add(roomName);

      // Stop early once we arrive.
      if (roomName === "The Golden Wheat") break;
    }

    // Should have moved significantly toward the far room.
    expect(GridPosition.x[agentEid!]).toBeGreaterThan(10);

    // Should eventually arrive at destination zone.
    const finalRoom = getRoomForEntity(world as any, agentEid!);
    const finalRoomName = finalRoom !== undefined ? Name.value[finalRoom] : undefined;
    expect(finalRoomName).toBe("The Golden Wheat");

    // Typically passes through the fallback World room between zones.
    expect(seenRooms.has("World")).toBe(true);
    expect(seenRooms.has("Town Square")).toBe(true);
  });
});
