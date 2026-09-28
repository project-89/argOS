import { getAllEntities } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createRoomEntity, createAgentEntity } from "../../ecs/prefabs";
import { materializeApprovedEntity } from "../../engineering/entity-materialization";
import { startCommittedEvents } from "../../runtime/committed-events";
import { enableRoomRouteTopology } from "../../runtime/room-routes";
import { snapshotInhabitedWorld } from "../inhabited-world-observation";

test("growth evidence discovers newly materialized inhabitants and real routes without claiming use", () => {
  const world = createArgosWorld("Inhabited evidence"); initializePrefabs(world); startCommittedEvents(world);
  const street = createRoomEntity(world, { name: "Street" });
  const visitor = createAgentEntity(world, { name: "Visitor", role: "guest", systemPrompt: "Choose your own evening.", roomId: street });
  const disable = enableRoomRouteTopology(world);
  try {
    const before = snapshotInhabitedWorld(world);
    const venue = materializeApprovedEntity(world, { type: "room", name: "Workshop", description: "A local workshop.", components: [], connectToRoomEids: [street] });
    const host = materializeApprovedEntity(world, { type: "agent", name: "Owner", description: "The workshop owner.", roomEid: venue, components: [] });
    const ids = [...getAllEntities(world)];
    const after = snapshotInhabitedWorld(world);
    expect([...getAllEntities(world)]).toEqual(ids);
    expect(before.entities).toHaveLength(2);
    expect(after.entities).toHaveLength(4);
    expect(after.entities.find(e => e.id === host)).toMatchObject({ kind: "agent", roomId: venue, actor: { active: true } });
    expect(after.entities.find(e => e.id === venue)?.routes).toEqual([street]);
    expect(after.entities.find(e => e.id === street)?.routes).toEqual([venue]);
    expect(after.entities.find(e => e.id === visitor)?.roomId).toBe(street);
    expect(after).not.toHaveProperty("success");
    expect(after.construction.admitted).toBe(4);
  } finally { disable(); }
});
