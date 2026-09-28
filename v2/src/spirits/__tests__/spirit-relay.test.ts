import { jest } from "@jest/globals";
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createGodAgentEntity } = await import("../../ecs/prefabs");
const { startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { createSpirit, getMessagesForGodAI } = await import("../spirit-registry");
const { isCurrentSpiritMessage } = await import("../spirit-message-delivery");
const { initializeSpiritSystem, injectOperatorSpiritMessage, setGodAgentCallback, deliverPendingMessagesToGod } = await import("../spirit-system");

function fixture() {
  const world = createArgosWorld("Relay"); initializePrefabs(world); startCommittedEvents(world);
  const god = createGodAgentEntity(world, { name: "God" });
  const system = initializeSpiritSystem(world, { godAgentEid: god });
  const registry = system.registry;
  const narrator = registry.spirits.get(registry.byName.get("The Narrator")!)!;
  const watcher = createSpirit(registry, { name: "The Watcher", domain: "guardian", rank: "archangel", model: "flash", systemPrompt: "Watch", observationInterval: 10_000 })!;
  return { world, god, registry, narrator, watcher };
}
beforeEach(() => jest.spyOn(console, "log").mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

test("an operator message reaches a named spirit's inbox as a scoped, current receipt", () => {
  const f = fixture();
  expect(injectOperatorSpiritMessage(f.world, { message: "Lean on the Hale thread tonight.", targetSpiritName: "The Narrator", priority: "high" }, f.god)).toEqual(["The Narrator"]);
  const [message] = f.narrator.inbox;
  expect(message).toMatchObject({ from: f.god, to: f.narrator.eid, type: "directive", priority: "high", content: "Lean on the Hale thread tonight." });
  expect(isCurrentSpiritMessage(f.registry, message, f.narrator.eid)).toBe(true);
  expect(f.watcher.inbox).toEqual([]);
  stopCommittedEvents(f.world); expect(isCurrentSpiritMessage(f.registry, message, f.narrator.eid)).toBe(false);
});

test("without a target the message is broadcast to every active spirit; God's own id reaches God's review queue", async () => {
  const f = fixture();
  expect(injectOperatorSpiritMessage(f.world, { message: "The town feels quiet." }, f.god).sort()).toEqual(["The Narrator", "The Watcher"]);
  expect(f.narrator.inbox).toHaveLength(1); expect(f.watcher.inbox).toHaveLength(1);
  const received: string[] = [];
  setGodAgentCallback(async messages => { received.push(...messages.map(m => m.content)); }, f.world);
  expect(injectOperatorSpiritMessage(f.world, { message: "Stage something at the Net House.", targetSpiritId: f.god }, f.god)).toEqual(["God"]);
  expect(await deliverPendingMessagesToGod(f.world)).toBe(1);
  expect(received).toEqual(["Stage something at the Net House."]);
  expect(getMessagesForGodAI(f.registry)).toEqual([]);
});

test("unknown targets, empty text and stopped worlds are refused", () => {
  const f = fixture();
  expect(() => injectOperatorSpiritMessage(f.world, { message: "Hello", targetSpiritName: "The Nobody" }, f.god)).toThrow("Unknown spirit");
  expect(() => injectOperatorSpiritMessage(f.world, { message: "   " }, f.god)).toThrow("non-empty");
  stopCommittedEvents(f.world);
  expect(() => injectOperatorSpiritMessage(f.world, { message: "Hello" }, f.god)).toThrow();
});
