/**
 * Behavioral Test: LocationIntegrity grounds orphaned physical objects into nearby rooms.
 *
 * Repro class: items can exist with GridPosition but no LocatedIn parent ("null-space leak"),
 * which makes interaction/perception drift because containment is canonical.
 *
 * Run:
 *   npx tsx src/behavioral-tests/48-location-integrity-grounding.ts
 */
import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createRoomEntity, createObjectEntity } from "../ecs/prefabs";
import { getDirectContainer } from "../ecs/location";
import { createLocationIntegritySystem } from "../systems/builtin-systems";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  const world = createArgosWorld("LocationIntegrityGrounding") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();

  const room = createRoomEntity(world as any, {
    name: "Test Room",
    description: "A room.",
    x: 100,
    y: 100,
  });

  // Create an orphaned object near the room: has GridPosition but no roomId/LocatedIn.
  const orphan = createObjectEntity(world as any, {
    name: "Orphan Apple",
    description: "An apple that should be in the room.",
    roomId: undefined,
    gridPosition: { x: 5, y: 5 },
  });

  // Ensure the room has a matching GridPosition (createRoomEntity sets one based on x/y).
  // Place the orphan close enough to be grounded by LocationIntegrity (<= 3.5 tiles).
  // Room grid is floor(x/20), floor(y/20) -> (5,5) for (100,100).
  assert(getDirectContainer(world as any, orphan) === undefined, "expected orphan to start without LocatedIn");

  const sys = createLocationIntegritySystem();
  sys.frequency = 0;
  registerSystem(registry as any, sys as any);
  runSystems(world as any, registry as any, 0, 16);

  assert(getDirectContainer(world as any, orphan) === room, "expected LocationIntegrity to ground orphan into nearest room");
  console.log("✓ LocationIntegrity grounded orphaned object");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

