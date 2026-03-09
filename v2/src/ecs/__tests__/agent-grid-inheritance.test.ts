import { createArgosWorld } from "../world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../prefabs";
import { GridPosition } from "../components";
import { getRoomForEntity } from "../location";

describe("agent spawn grid inheritance", () => {
  it("spawns agents near their start room when roomId is provided", () => {
    const world = createArgosWorld("TestWorld");
    initializePrefabs(world);

    const roomEid = createRoomEntity(world as any, {
      name: "Start Room",
      description: "A room for testing",
      x: 10,
      y: 12,
    });

    const agentEid = createAgentEntity(world as any, {
      name: "Alice",
      role: "tester",
      systemPrompt: "You are Alice",
      roomId: roomEid,
    });

    // LocatedIn chain resolves to the room immediately.
    expect(getRoomForEntity(world as any, agentEid)).toBe(roomEid);

    // GridPosition should be near the room's GridPosition so RoomArrival won't clear LocatedIn.
    const dx = Math.abs((GridPosition.x[agentEid] ?? 0) - (GridPosition.x[roomEid] ?? 0));
    const dy = Math.abs((GridPosition.y[agentEid] ?? 0) - (GridPosition.y[roomEid] ?? 0));
    expect(dx).toBeLessThanOrEqual(2);
    expect(dy).toBeLessThanOrEqual(2);
  });
});

