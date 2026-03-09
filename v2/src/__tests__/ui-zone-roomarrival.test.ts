import { createSystemRegistry, registerSystem, runSystems, type SystemRegistry } from "../ecs/dynamic-systems";
import { createArgosWorld, type WorldContext } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";
import { query } from "bitecs";
import { Agent, Name, GridPosition } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { compileMapIntoWorld } from "../world/map-compiler";
import { createRoomArrivalSystem } from "../systems/builtin-systems";

describe("RoomArrival (zone-based)", () => {
  let world: WorldContext;
  let registry: SystemRegistry;
  let tick: number;

  beforeEach(() => {
    world = createArgosWorld("ZoneRoomArrivalTest");
    initializePrefabs(world);
    registry = createSystemRegistry();
    tick = 0;
  });

  it("prefers zone containment over proximity to the World room center", () => {
    const map = {
      id: "demo-map",
      name: "Demo Map",
      grid: { width: 30, height: 20, tileSize: 32 },
      zones: [
        { id: "z1", name: "Town Square", roomType: "market", shape: { kind: "rect", x: 2, y: 2, w: 12, h: 10 } },
        { id: "z2", name: "The Golden Wheat", roomType: "tavern", shape: { kind: "rect", x: 16, y: 2, w: 12, h: 10 } },
      ],
      markers: [
        // Place Dorian inside Town Square but close to the World's center (15,10)
        { id: "a1", kind: "spawn", spawnType: "agent", name: "Dorian", x: 13, y: 8 },
      ],
    } as any;

    compileMapIntoWorld(world as any, map);

    const dorians = query(world as any, [Agent, Name]);
    const dEid = dorians.find((eid) => Name.value[eid] === "Dorian");
    expect(dEid).toBeDefined();

    // Sanity: position is the one we set.
    expect(GridPosition.x[dEid!]).toBe(13);
    expect(GridPosition.y[dEid!]).toBe(8);

    const roomArrival = createRoomArrivalSystem();
    roomArrival.lastRun = 0;
    registerSystem(registry, roomArrival);

    tick++;
    runSystems(world as any, registry, tick, 1000);

    const roomEid = getRoomForEntity(world as any, dEid!);
    const roomName = roomEid !== undefined ? Name.value[roomEid] : undefined;
    expect(roomName).toBe("Town Square");
  });
});
