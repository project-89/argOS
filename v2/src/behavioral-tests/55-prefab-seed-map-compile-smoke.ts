/**
 * Smoke test: Prefab "seed" markers auto-define a WorldSchema type and spawn instances consistently.
 *
 * Run:
 *   npx tsx src/behavioral-tests/55-prefab-seed-map-compile-smoke.ts
 */
import { hasComponent } from "bitecs";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";
import { ObjectType, Description } from "../ecs/components";
import { compileMapIntoWorld } from "../world/map-compiler";
import { worldSchema } from "../world/schema";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  const world = createArgosWorld("PrefabSeedSmoke") as any;
  initializePrefabs(world);

  const seedName = `Magic Statue ${Date.now()}`;
  const typeId = seedName; // intentionally not snake_case to test normalization
  const description = "A mysterious statue that hums faintly with arcane energy.";

  const map = {
    id: "map_seed_smoke",
    name: "Seed Smoke Map",
    grid: { width: 16, height: 16, tileSize: 32 },
    zones: [],
    markers: [
      {
        id: "m1",
        kind: "spawn",
        spawnType: "object",
        name: "Statue A",
        typeId,
        x: 2,
        y: 3,
        meta: { description, traitHints: "scenery, examinable" },
      },
      {
        id: "m2",
        kind: "spawn",
        spawnType: "object",
        name: "Statue B",
        typeId,
        x: 4,
        y: 5,
        meta: { description, traitHints: "scenery, examinable" },
      },
    ],
  };

  const result = compileMapIntoWorld(world, map as any);

  assert(result.spawnedObjectEids.length === 2, `expected 2 objects, got ${result.spawnedObjectEids.length}`);
  assert(result.definedObjectTypes.length === 1, `expected 1 defined type, got ${result.definedObjectTypes.length}`);

  const normalizedTypeId = result.definedObjectTypes[0];
  assert(Boolean(worldSchema.getObjectType(normalizedTypeId)), `expected schema to contain type ${normalizedTypeId}`);

  for (const eid of result.spawnedObjectEids) {
    assert(hasComponent(world, eid, ObjectType), "expected ObjectType component");
    assert(ObjectType.typeId[eid] === normalizedTypeId, `expected object to have typeId=${normalizedTypeId}`);
    assert(hasComponent(world, eid, Description), "expected Description component");
    assert(String(Description.value[eid] || "").length > 0, "expected non-empty description");
  }

  console.log("✓ Prefab seed smoke passed");
  console.log(`  Defined type: ${normalizedTypeId}`);
  console.log(`  Spawned objects: ${result.spawnedObjectEids.join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

