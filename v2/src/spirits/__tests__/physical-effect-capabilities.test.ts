import { jest } from "@jest/globals";
const ai = await import("ai"), generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs } = await import("../../ecs/prefabs");
const { createEntityRegistry, createEcsTools } = await import("../../ecs/tools");
const { createSpiritRegistry, createSpirit } = await import("../spirit-registry");
const { runSpiritCognition } = await import("../spirit-cognition");
const { setSpiritRegistryActive } = await import("../spirit-cycle-scope");
const { parsePhysicalEffectCommand, captureSpiritPhysicalEffects } = await import("../physical-effect-capabilities");
const { createSpatialWeather } = await import("../../demo/spatial-weather");
const { workingMemoryEntityRef } = await import("../../cognition/working-memory");
const { Mind, WorkingMemoryIdentity } = await import("../../ecs/components");
const { startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { drainPendingStimuli } = await import("../../cognition/stimulus-queue");

function fixture() {
  const world = createArgosWorld("Narrator native capability"); initializePrefabs(world); startCommittedEvents(world);
  const entities = createEntityRegistry(), ecs = createEcsTools(world, entities);
  const room = ecs.createRoom({ name: "Square" }).result.entityId, home = ecs.createRoom({ name: "Home" }).result.entityId;
  const actor = ecs.createAgent({ name: "Mara", role: "resident", systemPrompt: "I make my own decisions.", roomName: "Square" }).result.entityId;
  const registry = createSpiritRegistry(world);
  const narrator = createSpirit(registry, { name: "The Narrator", domain: "narrative", rank: "archangel", model: "flash", systemPrompt: "Observe actual events.", observationInterval: 1000, canInjectEvents: true });
  const other = createSpirit(registry, { name: "Other narrator", domain: "narrative", rank: "archangel", model: "flash", systemPrompt: "Observe actual events.", observationInterval: 1000, canInjectEvents: true });
  const receipts: unknown[] = [];
  const weather = createSpatialWeather({ world, outdoorRooms: [{ id: room, key: workingMemoryEntityRef(world, room)!.key }], running: () => true, record: receipt => receipts.push(receipt) });
  const unregister = weather.registerNarrator(registry, narrator);
  let resolve!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
  const run = (spirit = narrator) => runSpiritCognition(spirit, world, entities, registry);
  const ids = (kind = "place", subject = "Square") => (JSON.parse(generate.mock.calls.at(-1)![0].prompt.match(/ISSUED_INTERVENTION_EVIDENCE:\n([^\n]+)/)![1]).records as any[])
    .filter(record => record.kind === kind && record.subject === subject).map(record => record.id);
  const complete = (overrides: Record<string, unknown> = {}) => resolve({ text: JSON.stringify({ intervention: { needed: true,
    type: "world_effect", targetType: "room", target: "Square", evidenceIds: ids(), content: '{"operation":"weather","condition":"rain"}', reason: "Optional world variation", ...overrides } }) });
  return { world, room, home, actor, registry, narrator, other, receipts, weather, unregister, run, ids, complete };
}
beforeEach(() => { generate.mockReset(); drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("No physical effect live inference")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test("actual spirit output invokes an issued, grounded native operation", async () => {
  const f = fixture(), pending = f.run();
  expect(generate.mock.calls[0][0].prompt).toContain("=== WHAT YOU CAN DO ===");
  expect(generate.mock.calls[0][0].prompt).toContain("Optional native world_effect");
  f.complete(); const output = await pending;
  expect(output.interventions[0].result).toBe("applied"); expect(f.weather.view().rooms[0].condition).toBe("rain");
  expect(f.receipts).toHaveLength(1);
  expect(drainPendingStimuli().map(s => [s.targetEid, s.modality])).toEqual([
    [f.actor, "visual"], [f.actor, "auditory"], [f.actor, "tactile"], [f.actor, "olfactory"],
  ]); f.weather.close();
});
test("actual spirit object-valued content invokes the same issued native operation as JSON text", async () => {
  const f = fixture(), pending = f.run();
  f.complete({ content: { operation: "weather", condition: "rain" } });
  const output = await pending;
  expect(output.interventions[0].result).toBe("applied"); expect(f.weather.view().rooms[0].condition).toBe("rain");
  expect(f.receipts).toHaveLength(1);
  expect(drainPendingStimuli().map(s => [s.targetEid, s.modality])).toEqual([
    [f.actor, "visual"], [f.actor, "auditory"], [f.actor, "tactile"], [f.actor, "olfactory"],
  ]); f.weather.close();
});
test.each(["weather", "tree_damage"])("%s object and JSON text normalize to separate frozen exact commands", operation => {
  const content = operation === "weather" ? { operation, condition: "cloudy" } : { operation, tree: "Common tree 1" };
  const parsed = parsePhysicalEffectCommand(content);
  expect(parsed).toEqual(content); expect(parsed).toEqual(parsePhysicalEffectCommand(JSON.stringify(content)));
  expect(parsed).not.toBe(content); expect(Object.isFrozen(parsed)).toBe(true);
  if ("condition" in content) content.condition = "rain"; else content.tree = "Other tree";
  expect(parsed).toEqual(operation === "weather" ? { operation, condition: "cloudy" } : { operation, tree: "Common tree 1" });
});
test.each(["extra", "missing", "wrong-operation", "number-tree", "object-tree", "condition-object", "array", "number", "null", "whitespace", "long-tree"])("object transport still rejects %s", kind => {
  const input: Record<string, unknown> = {
    extra: { operation: "tree_damage", tree: "Common tree 1", actorAction: "clear it" }, missing: { operation: "tree_damage" },
    "wrong-operation": { operation: "spawn", tree: "Common tree 1" }, "number-tree": { operation: "tree_damage", tree: 1 },
    "object-tree": { operation: "tree_damage", tree: { name: "Common tree 1" } }, "condition-object": { operation: "weather", condition: { value: "rain" } },
    array: ["tree_damage", "Common tree 1"], number: 123, null: null, whitespace: { operation: "tree_damage", tree: " Common tree 1" },
    "long-tree": { operation: "tree_damage", tree: "t".repeat(121) },
  };
  expect(parsePhysicalEffectCommand(input[kind])).toBeUndefined();
});
test("accessors, custom prototypes, symbols, hidden keys and proxies never execute during normalization", () => {
  const getter = jest.fn(() => "rain");
  const accessor = Object.defineProperty({ operation: "weather" }, "condition", { get: getter, enumerable: true });
  const inherited = Object.assign(Object.create({ condition: "rain" }), { operation: "weather", ignored: "field" });
  const customPrototype = Object.assign(Object.create({ malicious: true }), { operation: "weather", condition: "rain" });
  const nullPrototype = Object.assign(Object.create(null), { operation: "weather", condition: "rain" });
  const hidden = Object.defineProperty({ operation: "weather", condition: "rain" }, "secret", { value: true });
  const hiddenField = Object.defineProperty({ operation: "weather" }, "condition", { value: "rain", enumerable: false });
  const symbol = { operation: "weather", condition: "rain", [Symbol("secret")]: true };
  const trap = jest.fn(() => { throw Error("A proxy trap must not execute"); });
  const proxy = new Proxy({ operation: "weather", condition: "rain" }, { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
  for (const content of [accessor, inherited, customPrototype, nullPrototype, hidden, hiddenField, symbol, proxy])
    expect(parsePhysicalEffectCommand(content)).toBeUndefined();
  expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
});
test.each(["extra-field", "tree-without-grant", "wrong-place", "stale-source"])("structured %s cannot broaden native authority", async kind => {
  const f = fixture(), pending = f.run();
  if (kind === "stale-source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  f.complete(kind === "extra-field" ? { content: { operation: "weather", condition: "rain", actorAction: "run indoors" } }
    : kind === "tree-without-grant" ? { content: { operation: "tree_damage", tree: "Common tree 1" } }
    : kind === "wrong-place" ? { content: { operation: "weather", condition: "rain" }, target: "Home", evidenceIds: f.ids("place", "Home") }
    : { content: { operation: "weather", condition: "rain" } });
  const output = await pending;
  expect(output.interventions.every(row => row.result !== "applied")).toBe(true);
  expect(f.weather.view().changes).toBe(0); expect(f.receipts).toEqual([]); f.weather.close();
});
test.each(["invented-prose", "extra-field", "wrong-operation", "wrong-condition", "missing-field", "array"])("strict parser rejects %s", kind => {
  const content = ({ "invented-prose": "Make it rain and force everyone indoors", "extra-field": '{"operation":"weather","condition":"rain","actorAction":"run"}',
    "wrong-operation": '{"operation":"spawn","condition":"rain"}', "wrong-condition": '{"operation":"weather","condition":"tornado"}',
    "missing-field": '{"condition":"rain"}', "array": '["weather","rain"]' })[kind]!;
  expect(parsePhysicalEffectCommand(content)).toBeUndefined();
});
test.each(["other-spirit", "indoor-room", "mismatched-place", "malformed-json"])("%s cannot use outdoor authority", async kind => {
  const f = fixture(), pending = f.run(kind === "other-spirit" ? f.other : f.narrator);
  f.complete(kind === "indoor-room" ? { target: "Home", evidenceIds: f.ids("place", "Home") }
    : kind === "mismatched-place" ? { evidenceIds: f.ids("actor_presence", "Mara") }
    : kind === "malformed-json" ? { content: "A storm appears." } : {});
  const output = await pending; expect(output.interventions[0].result).not.toBe("applied");
  expect(f.weather.view().changes).toBe(0); expect(f.receipts).toEqual([]); expect(drainPendingStimuli()).toEqual([]); f.weather.close();
});
test.each(["inject_stimulus", "modify_mood"])("restricted profile rejects legacy %s, including after close", async type => {
  const f = fixture(), arousal = Mind.arousal[f.actor], pending = f.run(); f.weather.close();
  f.complete({ type, ...(type === "modify_mood" ? { target: "Mara", targetType: "agent", evidenceIds: f.ids("actor_presence", "Mara"), content: "arousal: 0.99" } : { content: "A stranger arrives carrying a weapon." }) });
  const output = await pending; expect(output.interventions[0].result).toBe("rejected_physical_effect_policy");
  expect(Mind.arousal[f.actor]).toBe(arousal); expect(f.receipts).toEqual([]); expect(drainPendingStimuli()).toEqual([]);
});
test("an optional actor consideration remains advisory, not a physical event", async () => {
  const f = fixture(), pending = f.run(), arousal = Mind.arousal[f.actor];
  f.complete({ type: "inject_stimulus", target: "Mara", targetType: "agent", evidenceIds: f.ids("actor_presence", "Mara"), content: "Would spending some time outdoors appeal to you?" });
  const output = await pending; expect(output.interventions[0].result).toBe("accepted");
  expect(f.weather.view().changes).toBe(0); expect(Mind.arousal[f.actor]).toBe(arousal); f.weather.close();
});
test.each(["close", "unregister", "source", "room-owner", "weather-revision", "sender-definition", "registry-restart"])("%s while inference waits rejects late physical output", async kind => {
  const f = fixture(), pending = f.run();
  if (kind === "close") f.weather.close();
  if (kind === "unregister") f.unregister();
  if (kind === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (kind === "room-owner") WorkingMemoryIdentity.id[f.room] = "replaced-room";
  if (kind === "weather-revision") f.weather.set("cloudy", f.room);
  if (kind === "sender-definition") f.narrator.definition.systemPrompt = "Changed supervisor";
  if (kind === "registry-restart") { setSpiritRegistryActive(f.registry, false); setSpiritRegistryActive(f.registry, true); }
  f.complete(); const output = await pending;
  expect(output.interventions.every(row => row.result !== "applied")).toBe(true);
  expect(f.weather.component.condition[f.room]).toBe(kind === "weather-revision" ? "cloudy" : "clear");
  expect(f.receipts).toHaveLength(kind === "weather-revision" ? 1 : 0); f.weather.close();
});
test("creation-time host grant survives first startup but in-flight capture cannot survive restart", () => {
  const f = fixture(); setSpiritRegistryActive(f.registry, true);
  const first = captureSpiritPhysicalEffects(f.world, f.narrator, f.registry);
  expect(first.description).toContain("Optional native world_effect");
  setSpiritRegistryActive(f.registry, false); setSpiritRegistryActive(f.registry, true);
  expect(first.execute('{"operation":"weather","condition":"rain"}', f.room, () => true).status).toBe("rejected");
  const next = captureSpiritPhysicalEffects(f.world, f.narrator, f.registry);
  expect(next.execute('{"operation":"weather","condition":"rain"}', f.room, () => true).status).toBe("applied"); f.weather.close();
});
test("registering a different narrator by role or forging an evidence callback grants no authority", () => {
  const f = fixture(); expect(() => f.weather.registerNarrator(f.registry, f.other)).toThrow(/Narrator/);
  const capability = captureSpiritPhysicalEffects(f.world, f.narrator, f.registry);
  expect(capability.execute('{"operation":"weather","condition":"rain"}', f.room, () => false).status).toBe("rejected");
  expect(f.receipts).toEqual([]); f.weather.close();
});
test("a granted sender object cannot transfer authority to another entity slot", () => {
  const f = fixture(); f.registry.spirits.delete(f.narrator.eid);
  f.narrator.eid = f.other.eid; f.registry.spirits.set(f.other.eid, f.narrator);
  const capability = captureSpiritPhysicalEffects(f.world, f.narrator, f.registry);
  expect(capability.execute('{"operation":"weather","condition":"rain"}', f.room, () => true).status).toBe("rejected");
  expect(f.weather.view().changes).toBe(0); f.weather.close();
});
