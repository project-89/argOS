import "dotenv/config";
import { jest } from "@jest/globals";
import { addEntity, addComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Agent, BehaviorPolicy, Memory, Name } from "../../ecs/components";
import { setAgentBehaviorPolicy } from "../behavior-policy";
import {
  addMemory, getAgentMemories, getKnowledgeSummary, getRelevantMemories, normalizeMemoryImportance, pruneMemoriesIfNeeded,
} from "../knowledge-graph";
import { resetLearningState } from "../policy-learning";

function fixture() {
  const world = createArgosWorld("Memory scale regression");
  const actor = addEntity(world);
  addComponent(world, actor, Agent);
  addComponent(world, actor, Name);
  Agent.active[actor] = 1;
  Name.value[actor] = "Morgan";
  return { world, actor };
}

describe("memory importance and explicit learning", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-04T12:00:00Z"));
    resetLearningState();
  });
  afterEach(() => jest.useRealTimers());

  test.each([[0.9, 0.9], [90, 0.9], [100, 1], [500, 1], [-5, 0], [NaN, 0], [Infinity, 0]])(
    "normalizes importance %s to %s", (input, expected) => {
      expect(normalizeMemoryImportance(input)).toBe(expected);
    },
  );

  test("explicit scales resolve values that cannot be inferred", () => {
    expect(normalizeMemoryImportance(1)).toBe(1);
    expect(normalizeMemoryImportance(1, 100)).toBe(0.01);
    expect(normalizeMemoryImportance(8, 10)).toBe(0.8);
    expect(normalizeMemoryImportance(8, 100)).toBe(0.08);
    expect(normalizeMemoryImportance(1.2, 1)).toBe(1);
  });

  test("0.9 and 90 are stored as equally important experiences", () => {
    const { world, actor } = fixture();
    for (const importance of [0.9, 90]) {
      const eid = addMemory(world, actor, {
        type: "episodic", content: "The same experience.", importance,
        emotionalValence: 0, timestamp: Date.now(),
      });
      expect(Memory.importance[eid]).toBe(0.9);
    }
    const reflection = addMemory(world, actor, {
      type: "semantic", content: "An important reflection.", importance: 8, importanceScale: 10,
      emotionalValence: 0, timestamp: Date.now(),
    });
    expect(Memory.importance[reflection]).toBe(0.8);
  });

  test("authored background cannot drown a directly relevant observation by scale alone", () => {
    const { world, actor } = fixture();
    const background = addMemory(world, actor, {
      type: "semantic", content: "The lighthouse matters to my family.", importance: 90,
      emotionalValence: 0, timestamp: Date.now(),
    });
    const observation = addMemory(world, actor, {
      type: "episodic", content: "My phone was moved to the landing.", importance: 0.9,
      emotionalValence: 0, timestamp: Date.now(),
    });
    expect(getRelevantMemories(world, actor, "phone", 2)).toEqual([observation, background]);
    // Restored snapshots may still contain historical 0–100 component values.
    Memory.importance[background] = 90;
    expect(getRelevantMemories(world, actor, "phone", 2)).toEqual([observation, background]);
  });

  test("pruning compares native and restored legacy memories on the same scale", () => {
    const { world, actor } = fixture();
    const background = addMemory(world, actor, {
      type: "semantic", content: "An older authored setup.", importance: 85,
      emotionalValence: 0, timestamp: Date.now(),
    });
    const observation = addMemory(world, actor, {
      type: "episodic", content: "A critical new observation.", importance: 0.95,
      emotionalValence: 0, timestamp: Date.now(),
    });
    Memory.importance[background] = 85;
    pruneMemoriesIfNeeded(world, actor, 1);
    expect(getAgentMemories(world, actor)).toEqual([observation]);
  });

  test.each([0.9, 90])("recording importance %s does not silently rewrite an actor's behavior tree", importance => {
    const { world, actor } = fixture();
    setAgentBehaviorPolicy(world, actor, { type: "selector", children: [{ type: "action", action: { type: "observe" } }] }, true);
    const before = BehaviorPolicy.treeJson[actor];
    addMemory(world, actor, {
      type: "episodic", content: "Someone threatened me near the old bridge.", importance,
      emotionalValence: -0.5, timestamp: Date.now(),
    });
    expect(BehaviorPolicy.treeJson[actor]).toBe(before);
  });

  test.each([0.9, 90])("explicit learning grows the memory branch at importance %s", importance => {
    const { world, actor } = fixture();
    setAgentBehaviorPolicy(world, actor, { type: "selector", children: [{ type: "action", action: { type: "observe" } }] }, true);
    const before = BehaviorPolicy.treeJson[actor];
    addMemory(world, actor, {
      type: "episodic", content: "I remember the danger at the old bridge.", importance, learnPolicy: true,
      emotionalValence: -0.5, timestamp: Date.now(),
    });
    expect(BehaviorPolicy.treeJson[actor]).not.toBe(before);
    expect(BehaviorPolicy.treeJson[actor]).toContain("has_memory");
    expect(BehaviorPolicy.treeJson[actor]).toContain("danger");
  });

  test("native recall retains older relevant evidence through a burst of newer irrelevant memories", () => {
    const { world, actor } = fixture();
    const clue = addMemory(world, actor, {
      type: "episodic", content: "I left my phone in the bedroom desk drawer.", importance: 0.9,
      emotionalValence: 0, timestamp: Date.now() - 3_600_000,
    });
    for (let i = 0; i < 8; i++) {
      addMemory(world, actor, {
        type: "episodic", content: `I noticed decorative wall pattern ${i}.`, importance: 0.5,
        emotionalValence: 0, timestamp: Date.now() + i,
      });
    }
    const before = { count: Memory.recallCount[clue], recalled: Memory.lastRecalled[clue], importance: Memory.importance[clue] };
    const legacySummary = getKnowledgeSummary(world, actor);
    expect(legacySummary).not.toContain("phone");
    const recalled = getKnowledgeSummary(world, actor, { context: "Find my phone upstairs", limit: 5 });
    expect(recalled).toContain("phone in the bedroom desk drawer");
    expect(recalled).toContain("wall pattern 7");
    expect(recalled).toContain("wall pattern 6");
    expect(recalled.match(/\[(?:episodic|semantic); remembered /g)).toHaveLength(5);
    expect(recalled).toContain("remembered 2026-09-04T11:00:00.000Z");
    expect(recalled).toContain("current observations may supersede them");
    expect({ count: Memory.recallCount[clue], recalled: Memory.lastRecalled[clue], importance: Memory.importance[clue] }).toEqual(before);
  });

  test("contextual recall remains actor-private and respects its requested limit", () => {
    const { world, actor } = fixture();
    const other = addEntity(world);
    addComponent(world, other, Agent);
    addMemory(world, other, {
      type: "semantic", content: "The secret phone password is raven-seven.", importance: 1,
      emotionalValence: 0, timestamp: Date.now(),
    });
    for (let i = 0; i < 6; i++) {
      addMemory(world, actor, {
        type: "episodic", content: `Public phone observation ${i}.`, importance: 0.5,
        emotionalValence: 0, timestamp: Date.now() + i,
      });
    }
    const summary = getKnowledgeSummary(world, actor, { context: "phone password", limit: 3 });
    expect(summary).not.toContain("raven-seven");
    expect(summary.match(/\[(?:episodic|semantic); remembered /g)).toHaveLength(3);
  });
});
