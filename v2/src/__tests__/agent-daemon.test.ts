/**
 * Unit tests for Agent Daemon System
 *
 * Tests the guardian spirit (daemon) system that watches over agents,
 * sends whispers/challenges, and reports to the GodAI.
 */

// @ts-nocheck - Ignoring type errors from codebase inconsistencies
import { addComponent, query } from "bitecs";
import {
  createDaemonRegistry,
  createDaemonForAgent,
  createDaemonsForAllAgents,
  setDaemonSuperior,
  removeDaemon,
  getDaemonsNeedingObservation,
  collectAgentState,
  detectConcerns,
  detectGrowthOpportunities,
  observeAgent,
  getDaemonSummary,
  type DaemonRegistry,
  type DaemonState,
  type AgentStateSnapshot,
} from "../spirits/agent-daemon";
import { createArgosWorld, type WorldContext } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Agent, Mind, Health, Goal, Name, GridPosition } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { addEntity } from "bitecs";

describe("Agent Daemon System", () => {
  let world: WorldContext;
  let registry: DaemonRegistry;
  let roomId: number;

  beforeEach(() => {
    world = createArgosWorld("TestWorld");
    initializePrefabs(world);
    registry = createDaemonRegistry(10000, 30000, 60000);

    // Create a test room
    roomId = createRoomEntity(world, {
      name: "Test Room",
      description: "A room for testing",
      capacity: 10,
      ambience: "quiet",
    });
  });

  describe("Daemon Registry", () => {
    it("should create an empty registry with specified intervals", () => {
      // Args: observationInterval, whisperCooldown, challengeCooldown, reportCooldown
      const customRegistry = createDaemonRegistry(5000, 15000, 60000, 30000);

      expect(customRegistry.daemons.size).toBe(0);
      expect(customRegistry.observationInterval).toBe(5000);
      expect(customRegistry.whisperCooldown).toBe(15000);
      expect(customRegistry.reportCooldown).toBe(30000);
    });

    it("should use default intervals when not specified", () => {
      const defaultRegistry = createDaemonRegistry();

      expect(defaultRegistry.observationInterval).toBe(10000);
      expect(defaultRegistry.whisperCooldown).toBe(30000);
      expect(defaultRegistry.reportCooldown).toBe(60000);
    });

    it("should set superior spirit", () => {
      setDaemonSuperior(registry, 12345);
      expect(registry.superiorSpiritEid).toBe(12345);
    });
  });

  describe("Daemon Creation", () => {
    it("should create a daemon for an agent", () => {
      const agentId = createAgentEntity(world, {
        name: "Test Agent",
        role: "villager",
        systemPrompt: "You are a test agent",
        description: "A test agent",
        roomId,
      });

      const daemon = createDaemonForAgent(registry, world, agentId);

      expect(daemon).not.toBeNull();
      expect(daemon?.agentEid).toBe(agentId);
      expect(daemon?.agentName).toBe("Test Agent");
      expect(daemon?.active).toBe(true);
      expect(daemon?.observationCount).toBe(0);
      expect(daemon?.whisperCount).toBe(0);
      expect(daemon?.reportCount).toBe(0);
      expect(daemon?.concernLevel).toBe(0);
    });

    it("should not create duplicate daemons for same agent", () => {
      const agentId = createAgentEntity(world, {
        name: "Test Agent",
        role: "villager",
        systemPrompt: "You are a test agent",
        description: "A test agent",
        roomId,
      });

      const daemon1 = createDaemonForAgent(registry, world, agentId);
      const daemon2 = createDaemonForAgent(registry, world, agentId);

      expect(daemon1).toBe(daemon2);
      expect(registry.daemons.size).toBe(1);
    });

    it("should return null for non-existent agent", () => {
      const daemon = createDaemonForAgent(registry, world, 99999);
      expect(daemon).toBeNull();
    });

    it("should remove a daemon", () => {
      const agentId = createAgentEntity(world, {
        name: "Test Agent",
        role: "villager",
        systemPrompt: "You are a test agent",
        description: "A test agent",
        roomId,
      });

      createDaemonForAgent(registry, world, agentId);
      expect(registry.daemons.size).toBe(1);

      removeDaemon(registry, agentId);
      expect(registry.daemons.size).toBe(0);
    });
  });

  describe("Staggered Daemon Creation", () => {
    it("should stagger initial observation times for multiple agents", () => {
      // Create multiple agents
      const agents: number[] = [];
      for (let i = 0; i < 5; i++) {
        agents.push(createAgentEntity(world, {
          name: `Agent ${i}`,
          role: "villager",
          systemPrompt: "Test",
          description: "Test",
          roomId,
        }));
      }

      const count = createDaemonsForAllAgents(registry, world);

      expect(count).toBe(5);
      expect(registry.daemons.size).toBe(5);

      // Check that lastObservation times are staggered
      const daemons = Array.from(registry.daemons.values());
      const observationTimes = daemons.map(d => d.lastObservation);

      // All times should be different (staggered)
      const uniqueTimes = new Set(observationTimes);
      expect(uniqueTimes.size).toBe(5);

      // Times should be staggered - verify they're spread apart
      const sortedTimes = [...observationTimes].sort((a, b) => a - b);
      for (let i = 1; i < sortedTimes.length; i++) {
        // Each daemon's lastObservation should differ from the previous
        expect(sortedTimes[i]).not.toBe(sortedTimes[i - 1]);
      }
    });

    it("should not trigger all daemons at once after staggering", () => {
      // Create 10 agents with 30-second observation interval
      const customRegistry = createDaemonRegistry(30000, 60000, 120000);

      for (let i = 0; i < 10; i++) {
        createAgentEntity(world, {
          name: `Agent ${i}`,
          role: "villager",
          systemPrompt: "Test",
          description: "Test",
          roomId,
        });
      }

      createDaemonsForAllAgents(customRegistry, world);

      // With 30s interval and 10 agents, stagger is 3s each
      // Only some should need observation immediately
      const needingObservation = getDaemonsNeedingObservation(customRegistry);

      // Should not be all 10 at once
      expect(needingObservation.length).toBeLessThan(10);
    });
  });

  describe("Agent State Collection", () => {
    it("should collect agent state", () => {
      const agentId = createAgentEntity(world, {
        name: "Test Agent",
        role: "villager",
        systemPrompt: "Test",
        description: "Test",
        roomId,
      });

      // Set some state
      Mind.arousal[agentId] = 0.7;
      Mind.focus[agentId] = "testing";
      Mind.mode[agentId] = "proactive";
      Health.current[agentId] = 80;
      Health.max[agentId] = 100;

      const state = collectAgentState(world, agentId);

      expect(state).not.toBeNull();
      expect(state?.arousal).toBe(0.7);
      expect(state?.focus).toBe("testing");
      expect(state?.mode).toBe("proactive");
      expect(state?.health).toBe(80);
      expect(state?.active).toBe(true);
    });

    it("should return null for non-existent agent", () => {
      const state = collectAgentState(world, 99999);
      expect(state).toBeNull();
    });
  });

  describe("Concern Detection", () => {
    it("should detect low arousal concern", () => {
      const state: AgentStateSnapshot = {
        timestamp: Date.now(),
        arousal: 0.1, // Very low
        focus: "",
        mode: "reactive",
        active: true,
        goalCount: 1,
        thoughtCount: 0,
        stuckTicks: 0,
      };

      const concerns = detectConcerns(state, null, "Test Agent");

      expect(concerns.some(c => c.type === "low_arousal")).toBe(true);
    });

    it("should detect high arousal concern", () => {
      const state: AgentStateSnapshot = {
        timestamp: Date.now(),
        arousal: 0.95, // Very high
        focus: "",
        mode: "reactive",
        active: true,
        goalCount: 1,
        thoughtCount: 0,
        stuckTicks: 0,
      };

      const concerns = detectConcerns(state, null, "Test Agent");

      expect(concerns.some(c => c.type === "high_arousal")).toBe(true);
    });

    it("should detect danger from low health", () => {
      const state: AgentStateSnapshot = {
        timestamp: Date.now(),
        arousal: 0.5,
        focus: "",
        mode: "reactive",
        active: true,
        health: 5, // Critically low (< 10 is "high" severity)
        goalCount: 1,
        thoughtCount: 0,
        stuckTicks: 0,
      };

      const concerns = detectConcerns(state, null, "Test Agent");

      expect(concerns.some(c => c.type === "danger")).toBe(true);
      expect(concerns.find(c => c.type === "danger")?.severity).toBe("high");
    });

    it("should detect goal drift when no goals", () => {
      const state: AgentStateSnapshot = {
        timestamp: Date.now(),
        arousal: 0.5,
        focus: "",
        mode: "reactive",
        active: true,
        goalCount: 0, // No goals
        thoughtCount: 0,
        stuckTicks: 0,
      };

      const concerns = detectConcerns(state, null, "Test Agent");

      expect(concerns.some(c => c.type === "goal_drift")).toBe(true);
    });

    it("should detect stuck agent", () => {
      const previous: AgentStateSnapshot = {
        timestamp: Date.now() - 10000,
        position: { x: 5, y: 5 },
        arousal: 0.5,
        focus: "waiting",
        mode: "reactive",
        active: true,
        goalCount: 1,
        thoughtCount: 0,
        stuckTicks: 5, // Already stuck for a while
      };

      const current: AgentStateSnapshot = {
        timestamp: Date.now(),
        position: { x: 5, y: 5 }, // Same position
        arousal: 0.5,
        focus: "waiting", // Same focus
        mode: "reactive",
        active: true,
        goalCount: 1,
        thoughtCount: 0,
        stuckTicks: 0,
      };

      const concerns = detectConcerns(current, previous, "Test Agent");

      expect(concerns.some(c => c.type === "stuck")).toBe(true);
    });
  });

  describe("Growth Opportunity Detection", () => {
    it("should detect ready_for_challenge when agent is healthy and stable", () => {
      const state: AgentStateSnapshot = {
        timestamp: Date.now(),
        arousal: 0.5,
        focus: "exploring",
        mode: "proactive",
        active: true,
        health: 90, // High health
        goalCount: 2,
        thoughtCount: 5,
        stuckTicks: 0,
      };

      const opportunities = detectGrowthOpportunities(state, null, "Test Agent", 0.1);

      expect(opportunities.some(o => o.type === "ready_for_challenge")).toBe(true);
    });

    it("should detect breakthrough_possible during high arousal flow state", () => {
      const state: AgentStateSnapshot = {
        timestamp: Date.now(),
        arousal: 0.75, // High but not overwhelming
        focus: "creating",
        mode: "proactive",
        active: true,
        health: 70,
        goalCount: 1,
        thoughtCount: 10,
        stuckTicks: 0,
      };

      const opportunities = detectGrowthOpportunities(state, null, "Test Agent", 0.1);

      expect(opportunities.some(o => o.type === "breakthrough_possible")).toBe(true);
    });

    it("should detect needs_conflict when arousal is flat", () => {
      const state: AgentStateSnapshot = {
        timestamp: Date.now(),
        arousal: 0.45, // Mid-range, flat
        focus: "nothing",
        mode: "reactive",
        active: true,
        health: 80,
        goalCount: 1,
        thoughtCount: 2,
        stuckTicks: 0,
      };

      const opportunities = detectGrowthOpportunities(state, null, "Test Agent", 0.1);

      expect(opportunities.some(o => o.type === "needs_conflict")).toBe(true);
    });

    it("should include suggested challenges", () => {
      const state: AgentStateSnapshot = {
        timestamp: Date.now(),
        arousal: 0.5,
        focus: "exploring",
        mode: "proactive",
        active: true,
        health: 90,
        goalCount: 2,
        thoughtCount: 5,
        stuckTicks: 0,
      };

      const opportunities = detectGrowthOpportunities(state, null, "Test Agent", 0.1);

      for (const opp of opportunities) {
        expect(opp.suggestedChallenge).toBeDefined();
        expect(opp.suggestedChallenge.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Daemon Observation", () => {
    it("should observe an agent and update daemon state", () => {
      const agentId = createAgentEntity(world, {
        name: "Observable Agent",
        role: "villager",
        systemPrompt: "Test",
        description: "Test",
        roomId,
      });

      Mind.arousal[agentId] = 0.6;
      Mind.focus[agentId] = "observing";

      const daemon = createDaemonForAgent(registry, world, agentId);
      expect(daemon?.observationCount).toBe(0);
      expect(daemon?.lastAgentState).toBeNull();

      const observation = observeAgent(world, daemon!);

      expect(observation).not.toBeNull();
      expect(observation?.agentName).toBe("Observable Agent");
      expect(observation?.currentState.arousal).toBe(0.6);
      expect(daemon?.observationCount).toBe(1);
      expect(daemon?.lastAgentState).not.toBeNull();
    });

    it("should track stuck ticks across observations", () => {
      const agentId = createAgentEntity(world, {
        name: "Stuck Agent",
        role: "villager",
        systemPrompt: "Test",
        description: "Test",
        roomId,
      });

      // Set position and focus - stuck detection requires BOTH to be the same
      GridPosition.x[agentId] = 5;
      GridPosition.y[agentId] = 5;
      Mind.focus[agentId] = "waiting";

      const daemon = createDaemonForAgent(registry, world, agentId);

      // First observation
      observeAgent(world, daemon!);
      expect(daemon?.lastAgentState?.stuckTicks).toBe(0);

      // Second observation - same state, should increment
      const obs2 = observeAgent(world, daemon!);
      expect(obs2?.currentState.stuckTicks).toBe(1);

      // Third observation - same state, should increment again
      const obs3 = observeAgent(world, daemon!);
      expect(obs3?.currentState.stuckTicks).toBe(2);
    });
  });

  describe("Daemon Summary", () => {
    it("should generate a summary of all daemons", () => {
      for (let i = 0; i < 3; i++) {
        const agentId = createAgentEntity(world, {
          name: `Agent ${i}`,
          role: "villager",
          systemPrompt: "Test",
          description: "Test",
          roomId,
        });
        createDaemonForAgent(registry, world, agentId);
      }

      const summary = getDaemonSummary(registry);

      expect(summary).toContain("Daemon Registry");
      expect(summary).toContain("Total daemons: 3");
      expect(summary).toContain("Agent 0");
      expect(summary).toContain("Agent 1");
      expect(summary).toContain("Agent 2");
    });
  });
});
