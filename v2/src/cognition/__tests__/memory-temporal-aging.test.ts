import { jest } from "@jest/globals";
import { addEntity, addComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Memory, Name } from "../../ecs/components";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { simulationAge } from "../../ecs/temporal-age";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { addMemory } from "../knowledge-graph";
import { consolidateAgentMemories, recallMemory } from "../memory-consolidation";
import { createMemoryStore, addEpisodicMemory, addSemanticMemory, consolidateMemories,
  advanceMemoryStoreTime, bindMemoryStoreToWorld, memorySimulationTime } from "../enhanced-memory";

beforeEach(() => jest.useFakeTimers().setSystemTime(1_800_000_000_000));
afterEach(() => jest.useRealTimers());

function fixture(importance = 0.5) {
  const world = createArgosWorld(), actor = addEntity(world);
  addComponent(world, actor, Name); Name.value[actor] = "Rememberer";
  const memory = addMemory(world, actor, { type: "episodic", content: "I found a key.", importance, emotionalValence: 0, timestamp: Date.now() });
  return { world, actor, memory };
}

test("native memory decay is invariant to accelerated step size and repeated maintenance polls", () => {
  function run(deltas: number[]) {
    const { world, actor, memory } = fixture();
    for (const delta of deltas) {
      advanceSimulationTime(world, world.time.tick + 1, delta); consolidateAgentMemories(world, actor);
    }
    const after = Memory.importance[memory];
    jest.setSystemTime(Date.now() + 86_400_000);
    for (let i = 0; i < 20; i++) consolidateAgentMemories(world, actor);
    expect(Memory.importance[memory]).toBe(after);
    return after;
  }
  expect(run([3_600_000])).toBeCloseTo(run(Array(60).fill(60_000)), 12);
});

test("promotion is a one-time state transition, not a bonus per timer callback", () => {
  function run(deltas: number[]) {
    const { world, actor, memory } = fixture(0.8); Memory.recallCount[memory] = 3;
    let promotions = 0;
    for (const delta of deltas) {
      advanceSimulationTime(world, world.time.tick + 1, delta);
      promotions += consolidateAgentMemories(world, actor).promoted;
    }
    expect(promotions).toBe(1);
    return Memory.importance[memory];
  }
  expect(run([600_000])).toBeCloseTo(run(Array(10).fill(60_000)), 12);
});

test("native forgetting curve and original memory source survive save/restore", () => {
  const { world, actor, memory } = fixture();
  advanceSimulationTime(world, 1, 600_000); consolidateAgentMemories(world, actor);
  const sourceTimestamp = Memory.timestamp[memory];
  const saved = serializeWorld(world, createSystemRegistry());
  jest.setSystemTime(Date.now() + 86_400_000);
  const restored = createArgosWorld(), map = deserializeWorld(restored, createSystemRegistry(), saved).oldToNewId;
  const target = map.get(memory)!, targetActor = map.get(actor)!;
  advanceSimulationTime(restored, 2, 600_000); consolidateAgentMemories(restored, targetActor);
  advanceSimulationTime(world, 2, 600_000); consolidateAgentMemories(world, actor);
  expect(Memory.importance[target]).toBeCloseTo(Memory.importance[memory], 12);
  expect(Memory.timestamp[target]).toBe(sourceTimestamp);
});

test("genuine recall renews lived recall age without rewriting historical event time", () => {
  const { world, actor, memory } = fixture();
  advanceSimulationTime(world, 1, 600_000); consolidateAgentMemories(world, actor);
  const at = Memory.timestamp[memory]; recallMemory(world, memory);
  advanceSimulationTime(world, 2, 5000); consolidateAgentMemories(world, actor);
  expect(simulationAge(world, memory, "Memory.lastRecalled", Memory.lastRecalled[memory])).toBe(5000);
  expect(simulationAge(world, memory, "Memory.timestamp", at)).toBe(605_000);
  expect(Memory.timestamp[memory]).toBe(at);
});

function enhanced(world?: ReturnType<typeof createArgosWorld>) {
  const store = createMemoryStore(world);
  addEpisodicMemory(store, { timestamp: Date.now(), location: "Room", participants: [], event: "Found key", myRole: "finder", emotionalImpact: 0.5, importance: 0.5 });
  addSemanticMemory(store, { category: "fact", subject: "key", content: "Key fits lock", confidence: 0.9, sources: [] });
  return store;
}

test("standalone enhanced stores require explicit lived time and ignore wall jumps", () => {
  const store = enhanced(), before = store.episodicMemories[0].strength;
  jest.setSystemTime(Date.now() + 86_400_000); consolidateMemories(store);
  expect(store.episodicMemories[0].strength).toBe(before);
  advanceMemoryStoreTime(store, 3_600_000); consolidateMemories(store);
  expect(store.episodicMemories[0].strength).toBeCloseTo(before - 0.005);
  expect(() => advanceMemoryStoreTime(store, -1)).toThrow();
});

test("world-bound enhanced stores have exactly one clock and no double advancement", () => {
  const world = createArgosWorld(), store = enhanced(world);
  advanceSimulationTime(world, 1, 3_600_000); consolidateMemories(store);
  expect(memorySimulationTime(store)).toBe(3_600_000);
  expect(() => advanceMemoryStoreTime(store, 1)).toThrow("second clock");
  const restored = structuredClone(store); bindMemoryStoreToWorld(restored, world);
  expect(memorySimulationTime(restored)).toBe(3_600_000);
  const before = restored.episodicMemories[0].strength;
  consolidateMemories(restored);
  expect(restored.episodicMemories[0].strength).toBe(before);
});

test("enhanced linear decay/reinforcement and seven-day grace are step-size independent", () => {
  function run(deltas: number[]) {
    const store = enhanced(); store.episodicMemories[0].recallCount = 6;
    for (const delta of deltas) { advanceMemoryStoreTime(store, delta); consolidateMemories(store); }
    return [store.episodicMemories[0].strength, store.semanticMemories[0].confidence];
  }
  const coarse = run([10 * 86_400_000]), fine = run(Array(240).fill(3_600_000));
  expect(coarse[0]).toBeCloseTo(fine[0], 12);
  expect(coarse[1]).toBeCloseTo(fine[1], 12);
  expect(coarse[1]).toBeCloseTo(0.87);
});
