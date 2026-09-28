import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createGodAgentEntity } = await import("../../ecs/prefabs");
const { createEntityRegistry } = await import("../../ecs/tools");
const { createSpiritRegistry, createSpirit, sendMessage, getMessagesForGodAI, forwardSpiritMessage } = await import("../spirit-registry");
const { runSpiritCognition } = await import("../spirit-cognition");
const { startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { removeEntity } = await import("bitecs");
const { WorkingMemoryIdentity } = await import("../../ecs/components");
const { initializeSpiritSystem, startSpiritSystem, deliverPendingMessagesToGod, tickSpiritSystem } = await import("../spirit-system");

function fixture() {
  const world = createArgosWorld("Queued supervisor messages"); initializePrefabs(world); startCommittedEvents(world);
  const registry = createSpiritRegistry(world), entities = createEntityRegistry();
  const definition = { domain: "narrative" as const, rank: "archangel" as const, model: "flash" as const, systemPrompt: "Observe actual state.", observationInterval: 1000 };
  const sender = createSpirit(registry, { ...definition, name: "Original Reporter" });
  const receiver = createSpirit(registry, { ...definition, name: "Receiver" });
  const god = createGodAgentEntity(world, { name: "God", worldName: "Queued supervisor messages" }); registry.godAgentEid = god;
  const send = (to = god) => sendMessage(registry, sender.eid, to, "report", "QUEUED_EVIDENCE", "The earlier inspection completed.");
  return { world, registry, entities, sender, receiver, god, send };
}
beforeEach(() => { generate.mockReset().mockResolvedValue({ text: "{}" }); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No live calls")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test.each(["stop", "restart", "receiver", "owner", "removed", "copy", "retarget", "reauthor"])("%s invalidates queued God report at consumption", change => {
  const f = fixture(), message = f.send();
  if (change === "stop") stopCommittedEvents(f.world);
  if (change === "restart") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (change === "receiver") f.registry.godAgentEid = f.receiver.eid;
  if (change === "owner") WorkingMemoryIdentity.id[f.god] = "new-god";
  if (change === "removed") removeEntity(f.world, f.god);
  if (change === "copy") f.registry.messageQueue = [{ ...message }];
  if (change === "retarget") message.to = f.receiver.eid;
  if (change === "reauthor") message.from = f.receiver.eid;
  expect(getMessagesForGodAI(f.registry)).toEqual([]);
});

test("current report is delivered once and does not depend on continuing sender presence", () => {
  const f = fixture(), message = f.send(); removeEntity(f.world, f.sender.eid); f.registry.spirits.delete(f.sender.eid);
  expect(getMessagesForGodAI(f.registry)).toEqual([message]);
  expect(getMessagesForGodAI(f.registry)).toEqual([]);
});

test("restarted-world inbox is filtered before inference, while new input remains", async () => {
  const f = fixture(); f.send(f.receiver.eid); stopCommittedEvents(f.world); startCommittedEvents(f.world);
  sendMessage(f.registry, f.sender.eid, f.receiver.eid, "report", "CURRENT_EVIDENCE", "A new observation.");
  await runSpiritCognition(f.receiver, f.world, f.entities, f.registry);
  expect(generate.mock.calls[0][0].prompt).not.toContain("QUEUED_EVIDENCE");
  expect(generate.mock.calls[0][0].prompt).toContain("CURRENT_EVIDENCE");
});

test("an old inbox moved to a replacement spirit is not its received evidence", async () => {
  const f = fixture(); f.send(f.receiver.eid);
  const replacement = { ...f.receiver }; f.registry.spirits.set(replacement.eid, replacement);
  await runSpiritCognition(replacement, f.world, f.entities, f.registry);
  expect(generate.mock.calls[0][0].prompt).not.toContain("QUEUED_EVIDENCE");
});

test("a peer report is attributed to its original sender, not upgraded to superior instructions", async () => {
  const f = fixture(); f.send(f.receiver.eid); f.sender.definition.name = "Changed Reporter";
  await runSpiritCognition(f.receiver, f.world, f.entities, f.registry);
  const prompt = generate.mock.calls[0][0].prompt;
  expect(prompt).toContain("From Original Reporter (report): QUEUED_EVIDENCE");
  expect(prompt).not.toContain("From superior: QUEUED_EVIDENCE");
});

test.each(["explicit", "tick"])("%s delivery failure retains valid reports plus arrivals without immediate retry", async mode => {
  const f = fixture(), first = f.send();
  const state = initializeSpiritSystem(f.world, { godAgentEid: f.god, autoCreateNarrator: false });
  state.registry = f.registry; state.running = true; state.lastTick = Date.now();
  let fail!: (error: Error) => void;
  const callback = jest.fn<(...args: any[]) => Promise<void>>().mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  state.godAgentCallback = callback;
  const pending = mode === "explicit" ? deliverPendingMessagesToGod() : tickSpiritSystem(f.world, f.entities);
  const later = f.send(), rejected = expect(pending).rejects.toThrow("Consumer failed");
  fail(new Error("Consumer failed")); await rejected;
  expect(f.registry.messageQueue).toEqual([first, later]); expect(callback).toHaveBeenCalledTimes(1);
});

test("intentional forwarding issues a new recipient-bound receipt with historical attribution", async () => {
  const f = fixture(), original = f.send();
  const forwarded = forwardSpiritMessage(f.registry, original, f.receiver.eid)!;
  expect(forwarded.id).not.toBe(original.id); expect(forwarded.responseTo).toBe(original.id);
  expect(forwarded.senderLabel).toBe("Original Reporter");
  await runSpiritCognition(f.receiver, f.world, f.entities, f.registry);
  expect(generate.mock.calls[0][0].prompt).toContain("QUEUED_EVIDENCE");
});

test("forwarding cannot revive an old-session receipt", () => {
  const f = fixture(), original = f.send(); stopCommittedEvents(f.world); startCommittedEvents(f.world);
  expect(forwardSpiritMessage(f.registry, original, f.receiver.eid)).toBeUndefined();
  expect(f.receiver.inbox).toEqual([]);
});

test("overlapping deliveries leave arrivals queued, and failure permits a later normal retry", async () => {
  const f = fixture(), first = f.send();
  const state = initializeSpiritSystem(f.world, { autoCreateNarrator: false }); state.registry = f.registry;
  let fail!: (error: Error) => void;
  const callback = jest.fn<(...args: any[]) => Promise<void>>().mockImplementationOnce(messages => {
    messages.length = 0; // A consumer's local batch edits cannot erase receipts.
    return new Promise((_, reject) => { fail = reject; });
  }).mockResolvedValueOnce(undefined);
  state.godAgentCallback = callback;
  const pending = deliverPendingMessagesToGod(), later = f.send();
  expect(await deliverPendingMessagesToGod()).toBe(0);
  expect(f.registry.messageQueue).toEqual([later]); expect(callback).toHaveBeenCalledTimes(1);
  const rejected = expect(pending).rejects.toThrow("Consumer failed"); fail(new Error("Consumer failed")); await rejected;
  expect(f.registry.messageQueue).toEqual([first, later]);
  expect(await deliverPendingMessagesToGod()).toBe(2);
  expect(callback.mock.calls[1][0]).toEqual([first, later]); expect(f.registry.messageQueue).toEqual([]);
});

test("failure after a source restart does not restore obsolete receipts over new arrivals", async () => {
  const f = fixture(); f.send();
  const state = initializeSpiritSystem(f.world, { autoCreateNarrator: false }); state.registry = f.registry;
  let fail!: (error: Error) => void;
  state.godAgentCallback = () => new Promise((_, reject) => { fail = reject; });
  const pending = deliverPendingMessagesToGod(); stopCommittedEvents(f.world); startCommittedEvents(f.world);
  // The host restarts both world and managed spirit lifetimes before accepting
  // new reports. Merely reviving the source leaves the old spirit run retired.
  startSpiritSystem(f.world);
  const later = f.send(), rejected = expect(pending).rejects.toThrow("Consumer failed"); fail(new Error("Consumer failed")); await rejected;
  expect(f.registry.messageQueue).toEqual([later]);
});
