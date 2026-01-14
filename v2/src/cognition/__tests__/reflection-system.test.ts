/**
 * Unit Tests for Reflection System
 *
 * Tests:
 * - Reflection state initialization
 * - Importance accumulation
 * - Threshold-based reflection triggers
 * - Insight generation and storage
 */

import "dotenv/config";
import { addEntity, addComponent, hasComponent, getRelationTargets } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Name, Description, Agent, Mind, ReflectionState, Memory } from "../../ecs/components";
import { HasReflectionState, HasMemory } from "../../ecs/relations";
import {
  initializeReflectionState,
  getReflectionState,
  accumulateImportance,
  shouldReflect,
  generateReflection,
  storeReflectionResults,
  maybeReflect,
  runReflectionSystem,
  getRecentInsights,
  formatInsightsForContext,
  type ReflectionResult,
} from "../reflection-system";
import { addMemory } from "../knowledge-graph";

// =============================================================================
// TEST HELPERS
// =============================================================================

function createTestWorld() {
  return createArgosWorld("Test World");
}

function createTestAgent(world: ReturnType<typeof createArgosWorld>, name: string) {
  const eid = addEntity(world);
  addComponent(world, eid, Name);
  addComponent(world, eid, Description);
  addComponent(world, eid, Agent);
  addComponent(world, eid, Mind);

  Name.value[eid] = name;
  Description.value[eid] = `A test agent named ${name}`;
  Agent.role[eid] = "villager";
  Agent.active[eid] = true;
  Mind.arousal[eid] = 0.5;
  Mind.mode[eid] = "normal";

  return eid;
}

function addTestMemories(world: ReturnType<typeof createArgosWorld>, agentEid: number, count: number) {
  for (let i = 0; i < count; i++) {
    addMemory(world, agentEid, {
      type: "episodic",
      content: `Test memory ${i + 1}: Something happened.`,
      importance: 5 + Math.random() * 5,
      emotionalValence: Math.random() * 2 - 1,
      timestamp: Date.now() - i * 60000, // Spread out over time
    });
  }
}

// =============================================================================
// TESTS
// =============================================================================

describe("Reflection System", () => {
  describe("Reflection State Initialization", () => {
    test("should initialize reflection state for agent", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Alice");

      const stateEid = initializeReflectionState(world, agentEid);

      expect(hasComponent(world, stateEid, ReflectionState)).toBe(true);
      expect(ReflectionState.importanceAccum[stateEid]).toBe(0);
      expect(ReflectionState.reflectionThreshold[stateEid]).toBe(100);
      expect(ReflectionState.reflectionCount[stateEid]).toBe(0);
    });

    test("should link state to agent via relation", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Bob");

      initializeReflectionState(world, agentEid);

      const stateTargets = getRelationTargets(world, agentEid, HasReflectionState);
      expect(stateTargets.length).toBe(1);
    });

    test("should not create duplicate states", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Charlie");

      const state1 = initializeReflectionState(world, agentEid);
      const state2 = initializeReflectionState(world, agentEid);

      expect(state1).toBe(state2);

      const stateTargets = getRelationTargets(world, agentEid, HasReflectionState);
      expect(stateTargets.length).toBe(1);
    });

    test("should use custom threshold", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Diana");

      const stateEid = initializeReflectionState(world, agentEid, 50);

      expect(ReflectionState.reflectionThreshold[stateEid]).toBe(50);
    });
  });

  describe("Importance Accumulation", () => {
    test("should accumulate importance", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Eve");
      const stateEid = initializeReflectionState(world, agentEid);

      accumulateImportance(world, agentEid, 10);
      expect(ReflectionState.importanceAccum[stateEid]).toBe(10);

      accumulateImportance(world, agentEid, 25);
      expect(ReflectionState.importanceAccum[stateEid]).toBe(35);

      accumulateImportance(world, agentEid, 5);
      expect(ReflectionState.importanceAccum[stateEid]).toBe(40);
    });

    test("should handle missing reflection state gracefully", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Frank");

      // Should not throw
      expect(() => accumulateImportance(world, agentEid, 10)).not.toThrow();
    });
  });

  describe("Threshold Checking", () => {
    test("should not trigger reflection below threshold", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Grace");
      initializeReflectionState(world, agentEid, 100);

      accumulateImportance(world, agentEid, 50);
      expect(shouldReflect(world, agentEid)).toBe(false);

      accumulateImportance(world, agentEid, 49);
      expect(shouldReflect(world, agentEid)).toBe(false);
    });

    test("should trigger reflection at threshold", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Henry");
      initializeReflectionState(world, agentEid, 100);

      accumulateImportance(world, agentEid, 100);
      expect(shouldReflect(world, agentEid)).toBe(true);
    });

    test("should trigger reflection above threshold", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Ivy");
      initializeReflectionState(world, agentEid, 50);

      accumulateImportance(world, agentEid, 75);
      expect(shouldReflect(world, agentEid)).toBe(true);
    });

    test("should return false for agent without state", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Jack");

      expect(shouldReflect(world, agentEid)).toBe(false);
    });
  });

  describe("Reflection Results Storage", () => {
    test("should store reflection results", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Kate");
      const stateEid = initializeReflectionState(world, agentEid);

      // Set up some accumulated importance
      accumulateImportance(world, agentEid, 100);

      const mockResult: ReflectionResult = {
        insights: [
          {
            insight: "I realize I should be more careful.",
            importance: 8,
            relatedMemories: ["Previous mishap"],
            category: "self",
          },
          {
            insight: "People seem to appreciate honesty.",
            importance: 7,
            relatedMemories: ["Conversation with merchant"],
            category: "social",
          },
        ],
        questionsRaised: ["What should I do next?"],
        emotionalSummary: "Contemplative",
      };

      storeReflectionResults(world, agentEid, mockResult);

      // Importance should be reset
      expect(ReflectionState.importanceAccum[stateEid]).toBe(0);

      // Reflection count should increment
      expect(ReflectionState.reflectionCount[stateEid]).toBe(1);

      // Insights should be stored
      const insightsJson = ReflectionState.insights[stateEid];
      const insights = JSON.parse(insightsJson);
      expect(insights.length).toBe(2);
    });

    test("should get recent insights", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Luna");
      initializeReflectionState(world, agentEid);

      const mockResult: ReflectionResult = {
        insights: [
          { insight: "Insight 1", importance: 5, relatedMemories: [], category: "self" },
          { insight: "Insight 2", importance: 6, relatedMemories: [], category: "world" },
          { insight: "Insight 3", importance: 7, relatedMemories: [], category: "goal" },
        ],
        questionsRaised: [],
        emotionalSummary: "Thoughtful",
      };

      storeReflectionResults(world, agentEid, mockResult);

      const recent = getRecentInsights(world, agentEid, 2);
      expect(recent.length).toBe(2);
      expect(recent).toContain("Insight 1");
      expect(recent).toContain("Insight 2");
    });
  });

  describe("Context Formatting", () => {
    test("should format insights for context", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Mike");
      initializeReflectionState(world, agentEid);

      const mockResult: ReflectionResult = {
        insights: [
          { insight: "The world is full of opportunities.", importance: 8, relatedMemories: [], category: "world" },
        ],
        questionsRaised: [],
        emotionalSummary: "Optimistic",
      };

      storeReflectionResults(world, agentEid, mockResult);

      const context = formatInsightsForContext(world, agentEid);
      expect(context).toContain("RECENT REALIZATIONS");
      expect(context).toContain("The world is full of opportunities");
    });

    test("should return empty string when no insights", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Nina");
      initializeReflectionState(world, agentEid);

      const context = formatInsightsForContext(world, agentEid);
      expect(context).toBe("");
    });
  });

  describe("LLM Reflection Generation", () => {
    test("should generate reflection with memories", async () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Oscar");

      // Add some test memories
      addTestMemories(world, agentEid, 5);

      const result = await generateReflection(world, agentEid);

      expect(result).not.toBeNull();
      expect(result!.insights.length).toBeGreaterThanOrEqual(1);
      expect(result!.insights.length).toBeLessThanOrEqual(4);

      for (const insight of result!.insights) {
        expect(insight.insight.length).toBeGreaterThan(0);
        expect(["self", "social", "world", "goal"]).toContain(insight.category);
      }
    }, 30000);

    test("should return null when no memories", async () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Petra");

      const result = await generateReflection(world, agentEid);
      expect(result).toBeNull();
    });
  });

  describe("Maybe Reflect", () => {
    test("should not reflect when below threshold", async () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Quinn");
      initializeReflectionState(world, agentEid, 100);

      accumulateImportance(world, agentEid, 50);
      addTestMemories(world, agentEid, 3);

      const reflected = await maybeReflect(world, agentEid);
      expect(reflected).toBe(false);
    });

    test("should reflect when at threshold with memories", async () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Rachel");
      const stateEid = initializeReflectionState(world, agentEid, 50);

      accumulateImportance(world, agentEid, 60);
      addTestMemories(world, agentEid, 5);

      const reflected = await maybeReflect(world, agentEid);
      expect(reflected).toBe(true);

      // Importance should be reset
      expect(ReflectionState.importanceAccum[stateEid]).toBe(0);
    }, 30000);
  });

  describe("Run Reflection System", () => {
    test("should run reflection for all qualifying agents", async () => {
      const world = createTestWorld();

      // Create agents with different importance levels
      const agent1 = createTestAgent(world, "Sam");
      const agent2 = createTestAgent(world, "Tina");
      const agent3 = createTestAgent(world, "Uma");

      initializeReflectionState(world, agent1, 50);
      initializeReflectionState(world, agent2, 50);
      initializeReflectionState(world, agent3, 50);

      // Agent 1: Above threshold with memories
      accumulateImportance(world, agent1, 60);
      addTestMemories(world, agent1, 5);

      // Agent 2: Below threshold
      accumulateImportance(world, agent2, 30);
      addTestMemories(world, agent2, 3);

      // Agent 3: Above threshold with memories
      accumulateImportance(world, agent3, 75);
      addTestMemories(world, agent3, 4);

      const reflectionCount = await runReflectionSystem(world);

      // Agents 1 and 3 should have reflected
      expect(reflectionCount).toBe(2);
    }, 60000);
  });
});
