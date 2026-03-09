/**
 * Behavioral Test: God/Spirit tool grounding should not depend on manual entity registration.
 *
 * Verifies:
 * - `listEntities()` returns real world entities created via prefabs/ObjectManager (even if not registered).
 * - `getEntityByName()` can resolve those entities by name (world-backed lookup).
 *
 * Run:
 *   npx tsx src/behavioral-tests/46-god-registry-grounding.ts
 */
import "dotenv/config";

import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createRoomEntity, createAgentEntity } from "../ecs/prefabs";
import { createGodAgent } from "../god/god-agent";
import { ObjectManager, worldSchema } from "../world";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  const world = createArgosWorld("GodRegistryGroundingTest") as any;
  initializePrefabs(world);

  const god = createGodAgent(world as any, {
    name: "The Weaver",
    worldName: "GodRegistryGroundingTest",
    narrative: "Test world",
  });

  // Create entities directly via prefabs/ObjectManager (do NOT register with god.registry manually).
  const room = createRoomEntity(world as any, { name: "Office", description: "An office." });
  createAgentEntity(world as any, { name: "Ari", role: "tester", systemPrompt: "You are Ari.", roomId: room });

  const objectManager = new ObjectManager(world as any);
  worldSchema.defineObjectType({
    name: "test_box_46",
    description: "A box.",
    traits: ["examinable"],
    states: { idle: { description: "A box.", traits: ["examinable"] } },
    defaultState: "idle",
    category: "container",
  });
  objectManager.spawn("test_box_46", { name: "Box", containedIn: room });

  const listed = god.tools.listEntities().result as Array<{ name: string; id: number }>;
  assert(Array.isArray(listed) && listed.length > 0, "expected listEntities to return real entities");

  const names = new Set(listed.map((e) => e.name));
  assert(names.has("Office"), "expected Office to appear in listEntities()");
  assert(names.has("Ari"), "expected Ari to appear in listEntities()");
  assert(names.has("Box"), "expected Box to appear in listEntities()");

  const office = god.tools.getEntityByName({ name: "Office" });
  assert(office.success && Number.isFinite(office.result?.id), "expected getEntityByName(Office) to resolve");
  const box = god.tools.getEntityByName({ name: "Box" });
  assert(box.success && Number.isFinite(box.result?.id), "expected getEntityByName(Box) to resolve");

  console.log("✓ PASS");
}

main().catch((e) => {
  console.error("✗ FAIL", e);
  process.exit(1);
});

