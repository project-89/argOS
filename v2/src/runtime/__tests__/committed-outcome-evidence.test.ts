import { jest } from "@jest/globals";
import { entityExists, hasComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { Name, Needs, PhysicalObject, WorkingMemoryIdentity } from "../../ecs/components";
import { ObjectManager } from "../../world/object-manager";
import { executeActions } from "../../cognition/cognition-system";
import { gatherArchitectContext } from "../../spirits/architect-spirit";
import { advanceSimulationTimeline, clearSimulationTimeline } from "../simulation-timeline";
import { getCommittedEvents, publishCommittedEvent, startCommittedEvents, stopCommittedEvents } from "../committed-events";

function fixture() {
  const world = createArgosWorld("Outcome identity"); initializePrefabs(world); startCommittedEvents(world);
  world.meta.aiEnabled = false; world.meta.timedActions = true;
  const registry = createSystemRegistry(), room = createRoomEntity(world, { name: "Diner" });
  const actor = createAgentEntity(world, { name: "Ada", role: "visitor", systemPrompt: "PRIVATE_SELF", roomId: room });
  const objects = new ObjectManager(world), food = objects.spawn("food_item", { name: "Club sandwich", containedIn: room })!;
  Needs.hunger[actor] = 70;
  const advance = (ms = 1000) => advanceSimulationTimeline(world, ms, { integrate: () => {} });
  const eat = () => executeActions(world, [{ eid: actor, action: { type: "interact", target: "Club sandwich", content: "eat" } }], registry);
  return { world, registry, room, actor, objects, food, advance, eat };
}
beforeEach(() => jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline only")));
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("a native consumed target keeps event-time identity, operation and interval through the Weaver projection", async () => {
  const f = fixture(); f.eat(); const pending = getCommittedEvents(f.world).events.at(-1)!;
  expect(pending).toMatchObject({ targetId: f.food, targetName: "Club sandwich", operation: "eating", status: "pending" });
  f.advance(); const done = getCommittedEvents(f.world).events.at(-1)!;
  // Native memory/thought allocation can immediately reuse the deleted slot.
  expect(hasComponent(f.world, f.food, PhysicalObject)).toBe(false); expect(Needs.hunger[f.actor]).toBeLessThan(70);
  expect(done).toMatchObject({ targetKey: pending.targetKey, targetName: "Club sandwich", actorName: "Ada", roomName: "Diner",
    operation: "eating", executionId: pending.executionId, status: "succeeded", startedAtSimMs: 0, completedAtSimMs: 1000 });
  expect(done).not.toHaveProperty("targetId"); // Never a dereferenceable tombstone/recycled ID.
  const replacement = f.objects.spawn("object", { name: "Replacement radio", containedIn: f.room })!;
  const before = WorkingMemoryIdentity.id[replacement];
  const context = await gatherArchitectContext(f.world, f.registry);
  expect(context.recentEvents.find(e => e.id === done.id)).toMatchObject({ targetKey: pending.targetKey,
    targetName: "Club sandwich", actorName: "Ada", operation: "eating", status: "succeeded",
    executionId: pending.executionId, startedAtSimMs: 0, completedAtSimMs: 1000 });
  expect(WorkingMemoryIdentity.id[replacement]).toBe(before);
  expect(JSON.stringify(context.recentEvents)).not.toMatch(/Replacement radio|PRIVATE_SELF/);
  f.advance(31000); expect((await gatherArchitectContext(f.world, f.registry)).recentEvents).toEqual([]);
});

test("removed/recycled targets fail native work but retain the original event meaning", () => {
  const f = fixture(); f.eat(); const pending = getCommittedEvents(f.world).events.at(-1)!;
  removeEntity(f.world, f.food);
  const replacement = f.objects.spawn("food_item", { name: "Club sandwich", containedIn: f.room })!;
  f.advance(); const done = getCommittedEvents(f.world).events.at(-1)!;
  expect(done).toMatchObject({ status: "failed", targetKey: pending.targetKey, operation: "eating" });
  expect(done).not.toHaveProperty("targetId"); expect(entityExists(f.world, replacement)).toBe(true);
  expect(Needs.hunger[f.actor]).toBe(70);
});

test("historical names stay at admission time, without accepting command/private text as event fields", () => {
  const f = fixture();
  const input = { executionId: "native:1", kind: "action" as const, actorId: f.actor, roomId: f.room,
    targetId: f.food, action: "interact", operation: "typing" as const, status: "pending" as const, startedAtSimMs: 0 };
  const pending = publishCommittedEvent(f.world, { ...input, targetName: "PRIVATE_BODY", content: "PRIVATE_BODY", thought: "PRIVATE_BODY" } as any);
  Name.value[f.food] = "Renamed phone"; f.advance();
  const done = publishCommittedEvent(f.world, { ...input, status: "succeeded", completedAtSimMs: 1000 });
  expect(done.targetName).toBe(pending.targetName); expect(JSON.stringify(getCommittedEvents(f.world))).not.toContain("PRIVATE_BODY");
  expect(() => publishCommittedEvent(f.world, { ...input, status: "succeeded", operation: "eating" })).toThrow("rebind");
});

test.each(["source", "actor", "world"])("historical target evidence cannot cross a changed %s", boundary => {
  const f = fixture(); f.eat(); const pending = getCommittedEvents(f.world).events.at(-1)!;
  let target = f;
  if (boundary === "source") { clearSimulationTimeline(f.world); stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (boundary === "actor") WorkingMemoryIdentity.id[f.actor] = "different-actor";
  if (boundary === "world") target = fixture();
  const event = publishCommittedEvent(target.world, { executionId: pending.executionId, kind: "action", actorId: target.actor,
    roomId: target.room, action: "interact", status: "failed", startedAtSimMs: 0 });
  expect(event.targetKey).toBeUndefined(); expect(event.targetName).toBeUndefined();
});
