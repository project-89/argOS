/**
 * Behavioral Test: Stale registry should not cause "ghost objects"
 *
 * Reproduces a common failure mode:
 * - An entity name is cached in entityRegistry, then that entity is removed without unregistering.
 * - A new entity with the same name exists in the room (and is perceivable), but lookup returns the stale eid.
 *
 * Verifies:
 * - findEntityByNameWithScope discards stale registry hits and can still resolve the current entity
 * - pickup succeeds deterministically
 *
 * Run:
 *   npx tsx src/behavioral-tests/31-stale-registry-pickup-test.ts
 */
import "dotenv/config";

import { removeEntity } from "bitecs";
import { createSystemRegistry } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Name } from "../ecs/components";
import { worldSchema, ObjectManager } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  STALE REGISTRY PICKUP TEST");
  console.log("═".repeat(70) + "\n");

  const world = createArgosWorld("StaleRegistryPickupTest") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  const room = createRoomEntity(world as any, {
    name: "Kitchen",
    description: "A kitchen.",
    capacity: 10,
    ambience: "office",
    gridPosition: { x: 1, y: 1 },
  });

  const agent = createAgentEntity(world as any, {
    name: "Alex",
    role: "Tester",
    systemPrompt: "You are Alex.",
    roomId: room,
    gridPosition: { x: 1, y: 1 },
  });

  const typeId = "test_food_item_31";
  worldSchema.defineObjectType({
    name: typeId,
    description: "A test takeable item.",
    traits: ["takeable"],
    states: { idle: { description: "A test item.", traits: ["takeable"] } },
    defaultState: "idle",
    category: "item",
  });

  // Spawn an item and register it, then remove it without unregistering → stale registry.
  const stale = objectManager.spawn(typeId, { name: "Food", containedIn: room })!;
  registerEntity(stale, "Food");
  removeEntity(world as any, stale);

  // Spawn a new item with the same name, but do NOT register it.
  const current = objectManager.spawn(typeId, { name: "Food", containedIn: room })!;
  assert(Name.value[current] === "Food", "expected current Food entity to have name");

  executeActions(world as any, [{ eid: agent, action: { type: "pickup", target: "Food" } as any }], registry);
  const pending = drainPendingStimuli();

  assert(pending.some((s) => s.type === "inventory" && String(s.content || "").includes("pick up")), "expected successful pickup inventory stimulus");

  console.log("✓ PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ FAIL", e);
  process.exit(1);
});

