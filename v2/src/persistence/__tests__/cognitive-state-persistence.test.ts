import { addComponent, addEntity, getRelationTargets, hasComponent, query, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Agent, Belief, ConversationTurn, EquipSlot, Impression, Memory, Mind, Name, ObjectState, Perception } from "../../ecs/components";
import { HasBelief, HasConversation, HasImpression, HasMemory, HasPerception, Knows } from "../../ecs/relations";
import { addBelief, addMemory, getAgentMemories, getImpressionOf, updateImpression } from "../../cognition/knowledge-graph";
import { addConversationTurn, addPerception, addThought, getAgentMemory } from "../../cognition/agent-mind";
import { attachToEntity, getComponent, registryCreateComponent } from "../../ecs/component-registry";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { setLocatedIn } from "../../ecs/location";
import { configureCharacterAppearance, registerGarment, snapshotCharacterAppearance, tryWearGarment } from "../../rendering/character-appearance";
import { deserializeWorld, restoreAgentMemory, serializeWorld, type SerializedAgentMemory } from "../world-persistence";

test("removed objects stay removed and private knowledge/runtime components survive rehydration", () => {
  const source = createArgosWorld("Source"); initializePrefabs(source);
  const room = createRoomEntity(source, { name: "Kitchen" });
  const mara = createAgentEntity(source, { name: "Mara", role: "keeper", systemPrompt: "test", roomId: room });
  const can = createObjectEntity(source, { name: "Red oil can", roomId: room, portable: true });
  ObjectState.current[can] = "full";
  removeEntity(source, can);
  const memory = addMemory(source, mara, { type: "episodic", content: "The oil is gone.", importance: 30, emotionalValence: 0, timestamp: 1 });
  addBelief(source, mara, { subject: "Red oil can", predicate: "location", object: "missing", confidence: 1, source: "observation", timestamp: 2 });
  registryCreateComponent({ name: "DemoTemperature", description: "Temperature", properties: { celsius: "number" } });
  attachToEntity(source, room, "DemoTemperature", { celsius: -3 });
  const saved = serializeWorld(source, createSystemRegistry());
  expect(saved.entities.some(e => e.name === "Red oil can")).toBe(false);
  expect(saved.entities.find(e => e.id === memory)?.components.ObjectState).toBeUndefined();
  const restored = createArgosWorld("Restored"); initializePrefabs(restored);
  deserializeWorld(restored, createSystemRegistry(), saved);
  const restoredMara = [...query(restored, [Agent, Name])].find(e => Name.value[e] === "Mara")!;
  const restoredRoom = [...query(restored, [Name])].find(e => Name.value[e] === "Kitchen")!;
  expect([...query(restored, [Name])].some(e => Name.value[e] === "Red oil can")).toBe(false);
  expect(getRelationTargets(restored, restoredMara, HasBelief).some(e => Belief.object[e] === "missing")).toBe(true);
  expect(getRelationTargets(restored, restoredMara, HasMemory)).toHaveLength(1);
  expect(hasComponent(restored, restoredRoom, getComponent("DemoTemperature"))).toBe(true);
  expect(getComponent("DemoTemperature").celsius[restoredRoom]).toBe(-3);
});

test("private conversations, perceptions, knowledge and impression stores follow remapped actor IDs", () => {
  const source = createArgosWorld("Social source"); initializePrefabs(source);
  const room = createRoomEntity(source, { name: "Lantern room" });
  const agents = ["Mara", "Ivo", "Fen"].map(name =>
    createAgentEntity(source, { name, role: "keeper", systemPrompt: "test", roomId: room }));
  const [mara, ivo] = agents;
  for (const [index, eid] of agents.entries()) {
    const secret = `Private signal ${index}`;
    addConversationTurn(source, eid, "user", secret);
    addConversationTurn(source, eid, "assistant", `I will remember ${secret}.`);
    addPerception(source, eid, { type: "speech", content: secret, source: "whisper", intensity: 0.25 });
    addThought(source, eid, { content: `Considering ${secret}` });
    addMemory(source, eid, { type: "episodic", content: secret, importance: 0.4, emotionalValence: 0, timestamp: index });
    addBelief(source, eid, { subject: secret, predicate: "known by", object: Name.value[eid], confidence: 0.8, source: "whisper", timestamp: index });
  }
  const impression = updateImpression(source, mara, "Ivo", "patient", 0.6, 0.9, "Waited for my signal.");
  HasImpression(impression).lastUpdated[mara] = 123;
  const knows = Knows(ivo);
  addComponent(source, mara, knows);
  knows.familiarity[mara] = 0.75;
  knows.sentiment[mara] = 0.6;
  knows.lastInteraction[mara] = 321;
  const expected = agents.map(eid => getAgentMemory(source, eid));
  const saved = JSON.parse(JSON.stringify(serializeWorld(source, createSystemRegistry())));
  const restored = createArgosWorld("Social restored"); initializePrefabs(restored);
  addEntity(restored); // Loading need not preserve the original entity offsets.
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved);
  const restoredAgents = agents.map(eid => oldToNewId.get(eid)!);
  for (const [index, eid] of restoredAgents.entries()) {
    expect(eid).not.toBe(agents[index]);
    expect(getAgentMemory(restored, eid)).toEqual(expected[index]);
    expect(getAgentMemories(restored, eid).map(id => Memory.content[id])).toEqual([`Private signal ${index}`]);
    expect(getRelationTargets(restored, eid, HasBelief).map(id => Belief.subject[id])).toEqual([`Private signal ${index}`]);
    expect(getRelationTargets(restored, eid, HasConversation)).toHaveLength(2);
    const perception = getRelationTargets(restored, eid, HasPerception)[0];
    expect(Perception.intensity[perception]).toBe(0.25);
  }
  const restoredMara = restoredAgents[0];
  const restoredIvo = restoredAgents[1];
  const restoredImpression = oldToNewId.get(impression)!;
  expect(getRelationTargets(restored, restoredMara, HasImpression)).toEqual([restoredImpression]);
  expect(getImpressionOf(restored, restoredMara, "Ivo")?.traits[0].trait).toBe("patient");
  expect(Impression.basis[restoredImpression]).toBe("Waited for my signal.");
  expect(HasImpression(restoredImpression).sentiment[restoredMara]).toBe(0.6);
  expect(HasImpression(restoredImpression).lastUpdated[restoredMara]).toBe(123);
  expect(getRelationTargets(restored, restoredMara, Knows)).toEqual([restoredIvo]);
  expect(Knows(restoredIvo).familiarity[restoredMara]).toBe(0.75);
  expect(Knows(restoredIvo).sentiment[restoredMara]).toBe(0.6);
  expect(Knows(restoredIvo).lastInteraction[restoredMara]).toBe(321);
  expect(getImpressionOf(restored, restoredIvo, "Ivo")).toBeUndefined();
});

test("new saves preserve duplicate display names and never resurrect missing targets from summaries", () => {
  const source = createArgosWorld("Twins"); initializePrefabs(source);
  const twins = [0, 1].map(() => createAgentEntity(source, { name: "Echo", role: "keeper", systemPrompt: "test" }));
  const turns = twins.map((eid, index) => addConversationTurn(source, eid, "user", `Only echo ${index} heard this.`));
  const perception = addPerception(source, twins[0], { type: "speech", content: "Discarded whisper", source: "wind" });
  const impression = updateImpression(source, twins[0], "Echo", "quiet", 0.2, 0.4, "Did not speak.");
  const saved = serializeWorld(source, createSystemRegistry());
  expect(Object.values(saved.agentMemories).map(memory => memory.agentId)).toEqual(expect.arrayContaining(twins));
  expect(Object.keys(saved.agentMemories)).toHaveLength(2);
  expect(Object.values(saved.agentMemories).flatMap(memory => memory.conversationHistory || [])).toHaveLength(2);
  // A save editor or partial recovery can remove targets while leaving stale links.
  saved.entities = saved.entities.filter(entity => ![turns[0], perception, impression].includes(entity.id));
  const restored = createArgosWorld("Restored twins"); initializePrefabs(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved);
  const first = oldToNewId.get(twins[0])!;
  const second = oldToNewId.get(twins[1])!;
  expect(getAgentMemory(restored, first).conversationHistory).toEqual([]);
  expect(getAgentMemory(restored, first).perceptions).toEqual([]);
  expect(getRelationTargets(restored, first, HasImpression)).toEqual([]);
  expect(getAgentMemory(restored, second).conversationHistory).toEqual([
    { role: "user", content: "Only echo 1 heard this." },
  ]);
});

test("legacy short-term summaries restore bounded context only to an unambiguous actor in the destination world", () => {
  const source = createArgosWorld("Legacy source"); initializePrefabs(source);
  const mara = createAgentEntity(source, { name: "Mara", role: "keeper", systemPrompt: "test" });
  const twins = [0, 1].map(() => createAgentEntity(source, { name: "Echo", role: "keeper", systemPrompt: "test" }));
  const saved = serializeWorld(source, createSystemRegistry());
  saved.version = "1.0.0";
  delete saved.cognitionStorage;
  const summary: SerializedAgentMemory = {
    recentActions: [],
    thoughts: Array.from({ length: 15 }, (_, index) => ({ content: `Thought ${index}`, timestamp: index })),
    perceptions: Array.from({ length: 25 }, (_, index) => ({ type: "speech", content: `Whisper ${index}`, source: "wind" })),
    conversationHistory: Array.from({ length: 25 }, (_, index) => ({ role: "user", content: `Turn ${index}` })),
  };
  saved.agentMemories = { Mara: summary, Echo: summary };
  const restored = createArgosWorld("Legacy restored"); initializePrefabs(restored);
  for (let index = 0; index < 8; index++) addEntity(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved);
  const restoredMara = oldToNewId.get(mara)!;
  const memory = getAgentMemory(restored, restoredMara);
  expect(memory.thoughts).toHaveLength(10);
  expect(memory.thoughts[0].content).toBe("Thought 5");
  expect(memory.perceptions).toHaveLength(20);
  expect(memory.conversationHistory).toHaveLength(20);
  expect(memory.conversationHistory[0].content).toBe("Turn 5");
  expect(memory.conversationHistory[19].content).toBe("Turn 24");
  expect(Mind.arousal[restoredMara]).toBe(Mind.arousal[mara]);
  for (const twin of twins) expect(getAgentMemory(restored, oldToNewId.get(twin)!).conversationHistory).toEqual([]);

  restoreAgentMemory(restored, restoredMara, summary);
  expect(getAgentMemory(restored, restoredMara)).toEqual(memory); // Idempotent; ECS context wins.
  const before = [...query(source, [ConversationTurn])].length;
  restoreAgentMemory(source, restoredMara, summary); // Actor belongs to a different world.
  expect([...query(source, [ConversationTurn])]).toHaveLength(before);
  expect(getAgentMemory(source, mara).conversationHistory).toEqual([]);
});

test("equipment ownership remaps to the physical wearer and invalid saved claims are cleared", () => {
  const source = createArgosWorld("Wardrobe source"); initializePrefabs(source);
  const room = createRoomEntity(source, { name: "Kitchen" });
  const mara = createAgentEntity(source, { name: "Mara", role: "keeper", systemPrompt: "test", roomId: room });
  configureCharacterAppearance(source, mara, { clothing: "charcoal trousers" });
  const coat = createObjectEntity(source, { name: "Yellow raincoat", roomId: room, portable: true });
  registerGarment(source, coat, { slot: "outerwear" });
  setLocatedIn(source, coat, mara);
  expect(tryWearGarment(source, mara, coat).success).toBe(true);
  const invalid = ["Unpossessed hat", "Missing owner scarf", "Non-character owner gloves"].map(name => {
    const garment = createObjectEntity(source, { name, roomId: room, portable: true });
    registerGarment(source, garment, { slot: "accessory" });
    return garment;
  });
  EquipSlot.equippedBy[invalid[0]] = mara;
  EquipSlot.equippedBy[invalid[1]] = 999_999;
  EquipSlot.equippedBy[invalid[2]] = room;
  const saved = JSON.parse(JSON.stringify(serializeWorld(source, createSystemRegistry())));
  const restored = createArgosWorld("Wardrobe restored"); initializePrefabs(restored);
  for (let index = 0; index < 8; index++) addEntity(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved);
  const restoredMara = oldToNewId.get(mara)!;
  const restoredCoat = oldToNewId.get(coat)!;
  expect(restoredMara).not.toBe(mara);
  expect(EquipSlot.equippedBy[restoredCoat]).toBe(restoredMara);
  expect(snapshotCharacterAppearance(restored, restoredMara)!.wornGarments.map(item => item.eid)).toEqual([restoredCoat]);
  for (const garment of invalid) expect(EquipSlot.equippedBy[oldToNewId.get(garment)!]).toBe(-1);
  setLocatedIn(restored, restoredCoat, oldToNewId.get(room)!);
  expect(EquipSlot.equippedBy[restoredCoat]).toBe(-1);
  setLocatedIn(restored, restoredCoat, restoredMara);
  expect(snapshotCharacterAppearance(restored, restoredMara)!.wornGarments).toEqual([]);
});
