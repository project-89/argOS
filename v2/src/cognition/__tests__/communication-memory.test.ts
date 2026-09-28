import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { CommunicationMemory, WorkingMemoryIdentity } from "../../ecs/components";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { deserializeWorld, serializeWorld } from "../../persistence/world-persistence";
import { startCommittedEvents, getCommittedEvents } from "../../runtime/committed-events";
import { getPrivateCommunications, recordPrivateCommunication } from "../communication-memory";
import { applyCoordinationReviews, getCoordinationMemory, formatCoordinationContext } from "../coordination-memory";
import { getSocialDialogue } from "../social-memory";

function fixture() {
  const world = createArgosWorld("Private correspondence"); initializePrefabs(world); world.meta.aiEnabled = false;
  const room = createRoomEntity(world, { name: "Kitchen" });
  const make = (name: string) => createAgentEntity(world, { name, role: "resident", systemPrompt: "Act on evidence", roomId: room });
  const actor = make("Ada"), peer = make("Bea"), sourceId = startCommittedEvents(world);
  const input = { sourceId, messageKey: "message:one", channel: "phone:one", kind: "sent" as const,
    other: "Alex", content: "I will bring the book.", sentAtSimMs: 0 };
  return { world, actor, peer, input };
}
test("a personally sent text supports an optional undertaking but never audible dialogue or peer knowledge", () => {
  const f = fixture(), receipt = recordPrivateCommunication(f.world, f.actor, f.input)!;
  expect(receipt).toBeDefined();
  expect(getCoordinationMemory(f.world, f.actor).items).toEqual([]);
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: receipt.id, task: "Bring the book" }])).toBe(1);
  expect(getCoordinationMemory(f.world, f.actor).items[0]).toMatchObject({ own: true, localStatus: "not_started", undertaking: { medium: "text" } });
  expect(getCoordinationMemory(f.world, f.peer).items).toEqual([]);
  expect(getSocialDialogue(f.world, f.actor)).toEqual([]);
  expect(getSocialDialogue(f.world, f.peer)).toEqual([]);
  expect(getCommittedEvents(f.world).events).toEqual([]);
  expect(formatCoordinationContext(f.world, f.actor)).toContain("private text to");
  expect(formatCoordinationContext(f.world, f.peer)).not.toContain("bring the book");
});
test("an undertaking retains its original temporal wording after recent communications roll off", () => {
  const f = fixture(), words = "Of course I am! Leaving soon, see you there.";
  const receipt = recordPrivateCommunication(f.world, f.actor, { ...f.input, content: words })!;
  applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: receipt.id, task: "Meet Alex for dinner" }]);
  for (let i = 0; i < 7; i++) recordPrivateCommunication(f.world, f.actor, {
    ...f.input, messageKey: `later:${i}`, content: `Unrelated later exchange ${i}`,
  });
  const before = getCoordinationMemory(f.world, f.actor);
  const context = formatCoordinationContext(f.world, f.actor);
  expect(context).toContain(words);
  expect(context).toContain("at simulation 0ms");
  expect(formatCoordinationContext(f.world, f.peer)).not.toContain(words);
  expect(getCoordinationMemory(f.world, f.actor)).toEqual(before);
  expect(before.items[0].localStatus).toBe("not_started");
});
test("unsent IDs, personally read messages and another actor's sent text cannot become own undertakings", () => {
  const f = fixture();
  expect(recordPrivateCommunication(f.world, f.actor, { ...f.input, sourceId: "old-source" })).toBeUndefined();
  const sent = recordPrivateCommunication(f.world, f.actor, f.input)!;
  expect(applyCoordinationReviews(f.world, f.peer, [{ kind: "undertake", speechId: sent.id, task: "Bring book" }])).toBe(0);
  const read = recordPrivateCommunication(f.world, f.actor, { ...f.input, messageKey: "incoming", kind: "read", deliveredAtSimMs: 0 })!;
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: read.id, task: "Bring book" }])).toBe(0);
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: "unsent", task: "Bring book" }])).toBe(0);
});
test("invalid timing, replay mutation and replacement ownership do not authorize receipt writes", () => {
  const f = fixture();
  expect(recordPrivateCommunication(f.world, f.actor, { ...f.input, sentAtSimMs: 1 })).toBeUndefined();
  expect(recordPrivateCommunication(f.world, f.actor, { ...f.input, kind: "read" })).toBeUndefined();
  recordPrivateCommunication(f.world, f.actor, f.input);
  expect(recordPrivateCommunication(f.world, f.actor, { ...f.input, content: "changed" })).toBeUndefined();
  expect(getPrivateCommunications(f.world, f.actor)[0].content).toBe(f.input.content);
  WorkingMemoryIdentity.id[f.actor] = "replacement";
  expect(getPrivateCommunications(f.world, f.actor)).toEqual([]);
});
test("private receipts and reviewed undertakings survive ECS remapping without becoming speech", () => {
  const f = fixture(), r = recordPrivateCommunication(f.world, f.actor, f.input)!;
  applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: r.id, task: "Bring book" }]);
  const saved = structuredClone(serializeWorld(f.world, createSystemRegistry()));
  const restored = createArgosWorld("Restored correspondence");
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved);
  const actor = oldToNewId.get(f.actor)!;
  expect(getPrivateCommunications(restored, actor)).toEqual([r]);
  expect(getCoordinationMemory(restored, actor).items[0].undertaking).toEqual(r);
  expect(getSocialDialogue(restored, actor)).toEqual([]);
  CommunicationMemory.receiptsJson[actor] = "malformed";
  expect(getPrivateCommunications(restored, actor)).toEqual([]);
});
