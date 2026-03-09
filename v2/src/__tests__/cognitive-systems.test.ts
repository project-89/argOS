/**
 * Tests for the cognitive systems:
 * - Memory Consolidation
 * - Belief Revision
 * - Schedule Adaptation
 */

import { addEntity, addComponent, query } from "bitecs";
import { createArgosWorld, type WorldContext } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Agent, Mind, Memory, Belief, Schedule, Goal, Needs } from "../ecs/components";
import { HasMemory, HasBelief, HasSchedule, HasGoal } from "../ecs/relations";

// Memory Consolidation
import {
  calculateRetention,
  calculateStability,
  applyMemoryDecay,
  consolidateAgentMemories,
  runMemoryConsolidation,
  recallMemory,
  LONG_TERM_THRESHOLD,
  MIN_IMPORTANCE_THRESHOLD,
} from "../cognition/memory-consolidation";

// Belief Revision
import {
  beliefsMatch,
  beliefsContradict,
  calculateUpdatedConfidence,
  applyBeliefDecay,
  reviseAgentBeliefs,
  runBeliefRevision,
  updateBeliefWithEvidence,
  FIRM_BELIEF_THRESHOLD,
  MIN_CONFIDENCE_THRESHOLD as BELIEF_MIN_CONFIDENCE,
} from "../cognition/belief-revision";

// Schedule Adaptation
import {
  buildAdaptationContext,
  decideAdaptation,
  NEED_OVERRIDE_THRESHOLDS,
} from "../cognition/schedule-adaptation";

import { initializeSchedule, createDefaultSchedule } from "../cognition/schedule-system";

describe("Memory Consolidation", () => {
  let world: WorldContext;

  beforeEach(() => {
    world = createArgosWorld("TestWorld");
    initializePrefabs(world);
  });

  describe("calculateRetention", () => {
    it("should return 1.0 for recently recalled memories", () => {
      const retention = calculateRetention(0, 1.0);
      expect(retention).toBeCloseTo(1.0, 2);
    });

    it("should decay over time", () => {
      const oneHour = 1000 * 60 * 60;
      const retention = calculateRetention(oneHour, 0.5);
      expect(retention).toBeLessThan(1.0);
      expect(retention).toBeGreaterThan(0);
    });

    it("should decay faster with lower stability", () => {
      const time = 1000 * 60 * 60 * 6; // 6 hours
      const highStability = calculateRetention(time, 1.0);
      const lowStability = calculateRetention(time, 0.3);
      expect(highStability).toBeGreaterThan(lowStability);
    });
  });

  describe("calculateStability", () => {
    it("should increase with importance", () => {
      const lowImportance = calculateStability(0.3, 0, 0);
      const highImportance = calculateStability(0.9, 0, 0);
      expect(highImportance).toBeGreaterThan(lowImportance);
    });

    it("should increase with recall count", () => {
      const noRecalls = calculateStability(0.5, 0, 0);
      const manyRecalls = calculateStability(0.5, 10, 0);
      expect(manyRecalls).toBeGreaterThan(noRecalls);
    });

    it("should increase with emotional valence (absolute)", () => {
      const neutral = calculateStability(0.5, 0, 0);
      const positive = calculateStability(0.5, 0, 0.8);
      const negative = calculateStability(0.5, 0, -0.8);
      expect(positive).toBeGreaterThan(neutral);
      expect(negative).toBeGreaterThan(neutral);
    });
  });

  describe("applyMemoryDecay", () => {
    it("should reduce importance over time", () => {
      const original = 0.8;
      const decayed = applyMemoryDecay(original, 1000 * 60 * 60 * 24, 0.5); // 24 hours
      expect(decayed).toBeLessThan(original);
    });

    it("should not reduce below floor", () => {
      const decayed = applyMemoryDecay(0.5, 1000 * 60 * 60 * 24 * 30, 0.1); // 30 days
      expect(decayed).toBeGreaterThanOrEqual(0);
    });
  });

  describe("recallMemory", () => {
    it("should increase recall count and boost importance", () => {
      const agentId = createAgentEntity(world, {
        name: "TestAgent",
        role: "test",
        systemPrompt: "test",
      });

      const memEid = addEntity(world);
      addComponent(world, memEid, Memory);
      addComponent(world, agentId, HasMemory(memEid));

      Memory.type[memEid] = "episodic";
      Memory.content[memEid] = "Test memory";
      Memory.importance[memEid] = 0.5;
      Memory.recallCount[memEid] = 0;
      Memory.lastRecalled[memEid] = Date.now() - 10000;

      const oldCount = Memory.recallCount[memEid];
      const oldImportance = Memory.importance[memEid];

      recallMemory(world, memEid);

      expect(Memory.recallCount[memEid]).toBe(oldCount + 1);
      expect(Memory.importance[memEid]).toBeGreaterThan(oldImportance);
    });
  });

  describe("consolidateAgentMemories", () => {
    it("should process agent memories without crashing", () => {
      const agentId = createAgentEntity(world, {
        name: "TestAgent",
        role: "test",
        systemPrompt: "test",
      });

      // Add some memories
      for (let i = 0; i < 5; i++) {
        const memEid = addEntity(world);
        addComponent(world, memEid, Memory);
        addComponent(world, agentId, HasMemory(memEid));
        Memory.type[memEid] = "episodic";
        Memory.content[memEid] = `Memory ${i}`;
        Memory.importance[memEid] = 0.5;
        Memory.emotionalValence[memEid] = 0;
        Memory.timestamp[memEid] = Date.now() - i * 1000 * 60 * 60;
        Memory.lastRecalled[memEid] = Date.now() - i * 1000 * 60 * 60;
        Memory.recallCount[memEid] = 0;
      }

      expect(() => consolidateAgentMemories(world, agentId)).not.toThrow();
    });
  });
});

describe("Belief Revision", () => {
  let world: WorldContext;

  beforeEach(() => {
    world = createArgosWorld("TestWorld");
    initializePrefabs(world);
  });

  describe("beliefsMatch", () => {
    it("should match beliefs with same subject and predicate", () => {
      const belief1 = { subject: "Bob", predicate: "is friendly" };
      const belief2 = { subject: "bob", predicate: "Is Friendly" }; // Different case
      expect(beliefsMatch(belief1, belief2)).toBe(true);
    });

    it("should not match beliefs with different subjects", () => {
      const belief1 = { subject: "Bob", predicate: "is friendly" };
      const belief2 = { subject: "Alice", predicate: "is friendly" };
      expect(beliefsMatch(belief1, belief2)).toBe(false);
    });
  });

  describe("beliefsContradict", () => {
    it("should detect contradicting beliefs", () => {
      const belief1 = { subject: "Bob", predicate: "is", object: "friendly" };
      const belief2 = { subject: "Bob", predicate: "is", object: "hostile" };
      expect(beliefsContradict(belief1, belief2)).toBe(true);
    });

    it("should not flag matching beliefs as contradicting", () => {
      const belief1 = { subject: "Bob", predicate: "is", object: "friendly" };
      const belief2 = { subject: "Bob", predicate: "is", object: "friendly" };
      expect(beliefsContradict(belief1, belief2)).toBe(false);
    });
  });

  describe("calculateUpdatedConfidence", () => {
    it("should increase confidence with supporting evidence", () => {
      const original = 0.5;
      const updated = calculateUpdatedConfidence(original, "observation", 2, 0);
      expect(updated).toBeGreaterThan(original);
    });

    it("should decrease confidence with contradicting evidence", () => {
      const original = 0.8;
      const updated = calculateUpdatedConfidence(original, "observation", 0, 2);
      expect(updated).toBeLessThan(original);
    });
  });

  describe("applyBeliefDecay", () => {
    it("should not decay firm beliefs", () => {
      const firmConfidence = FIRM_BELIEF_THRESHOLD + 0.1;
      const decayed = applyBeliefDecay(firmConfidence, "observation", 10);
      expect(decayed).toBe(firmConfidence);
    });

    it("should decay uncertain beliefs", () => {
      const uncertainConfidence = FIRM_BELIEF_THRESHOLD - 0.2;
      const decayed = applyBeliefDecay(uncertainConfidence, "rumor", 10);
      expect(decayed).toBeLessThan(uncertainConfidence);
    });
  });

  describe("updateBeliefWithEvidence", () => {
    it("should create new belief if none exists", () => {
      const agentId = createAgentEntity(world, {
        name: "TestAgent",
        role: "test",
        systemPrompt: "test",
      });

      updateBeliefWithEvidence(world, agentId, "Bob", "is", "friendly", "observation");

      const beliefs = query(world, [Belief]);
      expect(beliefs.length).toBe(1);
      expect(Belief.subject[beliefs[0]]).toBe("Bob");
      expect(Belief.object[beliefs[0]]).toBe("friendly");
    });

    it("should boost confidence for supporting evidence", () => {
      const agentId = createAgentEntity(world, {
        name: "TestAgent",
        role: "test",
        systemPrompt: "test",
      });

      // Create initial belief
      updateBeliefWithEvidence(world, agentId, "Bob", "is", "friendly", "observation");

      const beliefs = query(world, [Belief]);
      const initialConfidence = Belief.confidence[beliefs[0]];

      // Add supporting evidence
      updateBeliefWithEvidence(world, agentId, "Bob", "is", "friendly", "observation");

      expect(Belief.confidence[beliefs[0]]).toBeGreaterThan(initialConfidence);
    });
  });
});

describe("Schedule Adaptation", () => {
  let world: WorldContext;

  beforeEach(() => {
    world = createArgosWorld("TestWorld");
    initializePrefabs(world);
  });

  describe("buildAdaptationContext", () => {
    it("should build context for agent with schedule", () => {
      const agentId = createAgentEntity(world, {
        name: "TestAgent",
        role: "test",
        systemPrompt: "test",
      });

      // Initialize schedule
      const activities = createDefaultSchedule("test");
      initializeSchedule(world, agentId, activities, 0.5);

      const context = buildAdaptationContext(world, agentId);
      expect(context).not.toBeNull();
      expect(context!.agentName).toBe("TestAgent");
      expect(context!.flexibility).toBe(0.5);
    });

    it("should include needs in context", () => {
      const agentId = createAgentEntity(world, {
        name: "TestAgent",
        role: "test",
        systemPrompt: "test",
      });

      // Set specific needs
      Needs.hunger[agentId] = 80;
      Needs.energy[agentId] = 30;

      const activities = createDefaultSchedule("test");
      initializeSchedule(world, agentId, activities, 0.5);

      const context = buildAdaptationContext(world, agentId);
      expect(context!.needs.hunger).toBeCloseTo(0.8, 1);
      expect(context!.needs.energy).toBeCloseTo(0.3, 1);
    });
  });

  describe("decideAdaptation", () => {
    it("should trigger adaptation for critical hunger", () => {
      const context = {
        agentEid: 1,
        agentName: "Test",
        currentActivity: null,
        nextActivity: null,
        flexibility: 0.5,
        needs: { hunger: 0.9, energy: 0.8, social: 0.3 },
        activeGoals: [],
        socialContext: { othersInRoom: 0, roomAmbience: "neutral" },
      };

      const decision = decideAdaptation(context);
      expect(decision.shouldAdapt).toBe(true);
      expect(decision.reason).toContain("hunger");
    });

    it("should trigger adaptation for exhaustion", () => {
      const context = {
        agentEid: 1,
        agentName: "Test",
        currentActivity: null,
        nextActivity: null,
        flexibility: 0.5,
        needs: { hunger: 0.3, energy: 0.1, social: 0.3 },
        activeGoals: [],
        socialContext: { othersInRoom: 0, roomAmbience: "neutral" },
      };

      const decision = decideAdaptation(context);
      expect(decision.shouldAdapt).toBe(true);
      expect(decision.reason).toContain("rest");
    });

    it("should not adapt when needs are satisfied", () => {
      const context = {
        agentEid: 1,
        agentName: "Test",
        currentActivity: null,
        nextActivity: null,
        flexibility: 0.5,
        needs: { hunger: 0.3, energy: 0.7, social: 0.3 },
        activeGoals: [],
        socialContext: { othersInRoom: 0, roomAmbience: "neutral" },
      };

      const decision = decideAdaptation(context);
      expect(decision.shouldAdapt).toBe(false);
    });

    it("should trigger adaptation for high-priority goals", () => {
      const context = {
        agentEid: 1,
        agentName: "Test",
        currentActivity: null,
        nextActivity: null,
        flexibility: 0.5,
        needs: { hunger: 0.3, energy: 0.7, social: 0.3 },
        activeGoals: [{ description: "Urgent task", priority: 9 }],
        socialContext: { othersInRoom: 0, roomAmbience: "neutral" },
      };

      const decision = decideAdaptation(context);
      expect(decision.shouldAdapt).toBe(true);
      expect(decision.reason).toContain("goal");
    });
  });
});

describe("Integration: runMemoryConsolidation", () => {
  it("should run consolidation for all agents", () => {
    const world = createArgosWorld("TestWorld");
    initializePrefabs(world);

    // Create multiple agents
    for (let i = 0; i < 3; i++) {
      createAgentEntity(world, {
        name: `Agent${i}`,
        role: "test",
        systemPrompt: "test",
      });
    }

    const result = runMemoryConsolidation(world);
    expect(result.agentsProcessed).toBe(3);
  });
});

describe("Integration: runBeliefRevision", () => {
  it("should run belief revision for all agents", () => {
    const world = createArgosWorld("TestWorld");
    initializePrefabs(world);

    // Create multiple agents
    for (let i = 0; i < 3; i++) {
      createAgentEntity(world, {
        name: `Agent${i}`,
        role: "test",
        systemPrompt: "test",
      });
    }

    const result = runBeliefRevision(world);
    expect(result.agentsProcessed).toBe(3);
  });
});
