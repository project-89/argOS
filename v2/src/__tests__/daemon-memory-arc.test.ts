/**
 * Unit Tests for Daemon Memory and Narrative Arc System
 *
 * Tests the mini-narrator functionality of daemons:
 * - Memory recording and management
 * - Narrative arc tracking
 * - Self-resolution when arcs stagnate
 */

import {
  // Memory types
  type DaemonState,
  type DaemonMemory,
  type DaemonNarrativeArc,
  type ThoughtSummary,
  type MemoryEntry,
  type PlanEntry,
  type NarrativeNudge,
  // Memory functions
  createEmptyDaemonMemory,
  createEmptyDaemonArc,
  recordThought,
  recordMemory,
  recordPlan,
  updatePlanStatus,
  recordRelationshipChange,
  recordCharacterMoment,
  getMemorySummary,
  pruneMemory,
  // Arc functions
  progressNarrativeArc,
  checkArcStagnation,
  attemptSelfResolution,
  completeNarrativeArc,
  startNarrativeArc,
  getArcSummary,
  increaseTension,
  decreaseTension,
} from "../spirits/agent-daemon";

// Helper to create a minimal daemon state for testing
function createTestDaemon(name: string = "TestCharacter"): DaemonState {
  return {
    daemonEid: 10001,
    agentEid: 1,
    agentName: name,
    lastObservation: 0,
    observationCount: 0,
    whisperCount: 0,
    reportCount: 0,
    lastAgentState: null,
    concernLevel: 0,
    lastWhisper: 0,
    lastReport: 0,
    active: true,
    narrativeConstraints: {
      maxDramaLevel: 0.5,
      allowConflict: true,
      allowRomance: true,
      preferredMood: "neutral",
      isFocusCharacter: false,
    },
    pendingNudges: [],
    growthMetrics: {
      lastGoalChange: Date.now(),
      lastBeliefChange: Date.now(),
      lastRelationshipChange: Date.now(),
      stagnationScore: 0,
    },
    memory: createEmptyDaemonMemory(),
    narrativeArc: createEmptyDaemonArc(name),
    lastArcCognition: 0,
    arcCognitionInterval: 60000,
  };
}

describe("Daemon Memory System", () => {
  describe("createEmptyDaemonMemory", () => {
    it("should create empty memory with all arrays initialized", () => {
      const memory = createEmptyDaemonMemory();

      expect(memory.recentThoughts).toEqual([]);
      expect(memory.keyMemories).toEqual([]);
      expect(memory.activePlans).toEqual([]);
      expect(memory.relationshipHistory).toEqual([]);
      expect(memory.characterMoments).toEqual([]);
      expect(memory.lastPruning).toBeGreaterThan(0);
    });
  });

  describe("recordThought", () => {
    it("should add a thought to memory", () => {
      const daemon = createTestDaemon();

      recordThought(daemon, "the mystery", "Wondering about the missing items", "curious", 0.5);

      expect(daemon.memory.recentThoughts.length).toBe(1);
      expect(daemon.memory.recentThoughts[0].focus).toBe("the mystery");
      expect(daemon.memory.recentThoughts[0].content).toBe("Wondering about the missing items");
      expect(daemon.memory.recentThoughts[0].emotionalTone).toBe("curious");
      expect(daemon.memory.recentThoughts[0].significance).toBe(0.5);
    });

    it("should keep only last 20 thoughts", () => {
      const daemon = createTestDaemon();

      // Add 25 thoughts
      for (let i = 0; i < 25; i++) {
        recordThought(daemon, `focus_${i}`, `thought_${i}`, "neutral", 0.3);
      }

      expect(daemon.memory.recentThoughts.length).toBe(20);
      // First 5 should be gone, should have focus_5 through focus_24
      expect(daemon.memory.recentThoughts[0].focus).toBe("focus_5");
      expect(daemon.memory.recentThoughts[19].focus).toBe("focus_24");
    });

    it("should clamp significance between 0 and 1", () => {
      const daemon = createTestDaemon();

      recordThought(daemon, "test", "test", "neutral", -0.5);
      expect(daemon.memory.recentThoughts[0].significance).toBe(0);

      recordThought(daemon, "test", "test", "neutral", 1.5);
      expect(daemon.memory.recentThoughts[1].significance).toBe(1);
    });
  });

  describe("recordMemory", () => {
    it("should add a memory entry", () => {
      const daemon = createTestDaemon();

      const memory = recordMemory(
        daemon,
        "discovery",
        "Found a hidden passage",
        ["Alice", "Bob"],
        "The Tavern",
        0.8,
        0.7
      );

      expect(daemon.memory.keyMemories.length).toBe(1);
      expect(memory.type).toBe("discovery");
      expect(memory.content).toBe("Found a hidden passage");
      expect(memory.participants).toEqual(["Alice", "Bob"]);
      expect(memory.location).toBe("The Tavern");
      expect(memory.emotionalImpact).toBe(0.8);
      expect(memory.narrativeWeight).toBe(0.7);
      expect(memory.resolved).toBe(false);
    });

    it("should progress narrative arc for high-weight memories", () => {
      const daemon = createTestDaemon();
      daemon.narrativeArc.drivingGoal = "Find the truth";
      daemon.narrativeArc.status = "setup";

      // Low weight - no progression
      recordMemory(daemon, "event", "Minor event", [], undefined, 0, 0.3);
      expect(daemon.narrativeArc.completedBeats.length).toBe(0);

      // High weight - should progress
      recordMemory(daemon, "event", "Major discovery", [], undefined, 0, 0.8);
      expect(daemon.narrativeArc.completedBeats.length).toBe(1);
      expect(daemon.narrativeArc.completedBeats[0]).toBe("Major discovery");
    });
  });

  describe("recordPlan", () => {
    it("should add a plan to memory", () => {
      const daemon = createTestDaemon();

      const plan = recordPlan(
        daemon,
        "Investigate the tavern",
        ["Talk to barkeep", "Check cellar", "Look for clues"],
        0.8
      );

      expect(daemon.memory.activePlans.length).toBe(1);
      expect(plan.goal).toBe("Investigate the tavern");
      expect(plan.steps).toHaveLength(3);
      expect(plan.status).toBe("planned");
      expect(plan.priority).toBe(0.8);
    });

    it("should set narrative arc driving goal for high-priority plans", () => {
      const daemon = createTestDaemon();
      expect(daemon.narrativeArc.drivingGoal).toBe("");

      recordPlan(daemon, "Find the killer", [], 0.9);

      expect(daemon.narrativeArc.drivingGoal).toBe("Find the killer");
      expect(daemon.narrativeArc.status).toBe("setup");
    });
  });

  describe("updatePlanStatus", () => {
    it("should update plan status", () => {
      const daemon = createTestDaemon();
      const plan = recordPlan(daemon, "Test goal", [], 0.5);

      updatePlanStatus(daemon, plan.id, "active");
      expect(daemon.memory.activePlans[0].status).toBe("active");

      updatePlanStatus(daemon, plan.id, "blocked", "Missing key");
      expect(daemon.memory.activePlans[0].status).toBe("blocked");
      expect(daemon.memory.activePlans[0].blockedReason).toBe("Missing key");
    });

    it("should record character moment on completion", () => {
      const daemon = createTestDaemon();
      const plan = recordPlan(daemon, "Test goal", [], 0.5);

      updatePlanStatus(daemon, plan.id, "completed");

      // Should have a character moment recorded
      expect(daemon.memory.characterMoments.length).toBe(1);
      expect(daemon.memory.characterMoments[0].type).toBe("growth");
    });

    it("should return false for non-existent plan", () => {
      const daemon = createTestDaemon();
      const result = updatePlanStatus(daemon, "non_existent", "active");
      expect(result).toBe(false);
    });
  });

  describe("recordRelationshipChange", () => {
    it("should record relationship change", () => {
      const daemon = createTestDaemon();

      recordRelationshipChange(
        daemon,
        "Bob",
        "stranger",
        "acquaintance",
        "Shared a drink",
        0.5
      );

      expect(daemon.memory.relationshipHistory.length).toBe(1);
      expect(daemon.memory.relationshipHistory[0].otherCharacter).toBe("Bob");
      expect(daemon.memory.relationshipHistory[0].previousState).toBe("stranger");
      expect(daemon.memory.relationshipHistory[0].newState).toBe("acquaintance");
    });

    it("should create character moment for significant changes", () => {
      const daemon = createTestDaemon();

      recordRelationshipChange(daemon, "Bob", "friend", "enemy", "Betrayal", 0.9);

      expect(daemon.memory.characterMoments.length).toBe(1);
      expect(daemon.memory.characterMoments[0].type).toBe("transformation");
    });
  });

  describe("getMemorySummary", () => {
    it("should return formatted memory summary", () => {
      const daemon = createTestDaemon();

      recordThought(daemon, "mystery", "Thinking about clues", "curious", 0.5);
      recordMemory(daemon, "event", "Found a clue", [], undefined, 0, 0.5);
      recordPlan(daemon, "Investigate", [], 0.5);

      const summary = getMemorySummary(daemon);

      expect(summary).toContain("Recent thoughts:");
      expect(summary).toContain("Unresolved matters:");
      expect(summary).toContain("Current plans:");
    });

    it("should return empty string for empty memory", () => {
      const daemon = createTestDaemon();
      const summary = getMemorySummary(daemon);
      expect(summary).toBe("");
    });
  });

  describe("pruneMemory", () => {
    it("should remove old low-significance thoughts", () => {
      const daemon = createTestDaemon();

      // Add an old low-significance thought
      recordThought(daemon, "old", "Old thought", "neutral", 0.3);
      daemon.memory.recentThoughts[0].timestamp = Date.now() - (2 * 60 * 60 * 1000); // 2 hours ago

      // Add a recent thought
      recordThought(daemon, "new", "New thought", "neutral", 0.3);

      pruneMemory(daemon);

      expect(daemon.memory.recentThoughts.length).toBe(1);
      expect(daemon.memory.recentThoughts[0].focus).toBe("new");
    });

    it("should keep old high-significance thoughts", () => {
      const daemon = createTestDaemon();

      recordThought(daemon, "important", "Important thought", "intense", 0.9);
      daemon.memory.recentThoughts[0].timestamp = Date.now() - (2 * 60 * 60 * 1000);

      pruneMemory(daemon);

      expect(daemon.memory.recentThoughts.length).toBe(1);
    });
  });
});

describe("Daemon Narrative Arc System", () => {
  describe("createEmptyDaemonArc", () => {
    it("should create arc with dormant status", () => {
      const arc = createEmptyDaemonArc("TestCharacter");

      expect(arc.theme).toBe("daily life");
      expect(arc.status).toBe("dormant");
      expect(arc.drivingGoal).toBe("");
      expect(arc.tension).toBe(0.2);
      expect(arc.completedBeats).toEqual([]);
      expect(arc.previousArcs).toEqual([]);
    });
  });

  describe("startNarrativeArc", () => {
    it("should start a new arc", () => {
      const daemon = createTestDaemon();

      startNarrativeArc(
        daemon,
        "revenge",
        "Avenge my brother",
        "The villain is brought to justice",
        { toGain: "peace of mind", toLose: "innocence" }
      );

      expect(daemon.narrativeArc.theme).toBe("revenge");
      expect(daemon.narrativeArc.status).toBe("setup");
      expect(daemon.narrativeArc.drivingGoal).toBe("Avenge my brother");
      expect(daemon.narrativeArc.desiredResolution).toBe("The villain is brought to justice");
      expect(daemon.narrativeArc.stakes.toGain).toBe("peace of mind");
      expect(daemon.narrativeArc.tension).toBe(0.3);
    });

    it("should complete existing arc as transformed before starting new", () => {
      const daemon = createTestDaemon();

      // Start first arc
      startNarrativeArc(daemon, "discovery", "Find treasure", "", { toGain: "", toLose: "" });
      daemon.narrativeArc.status = "rising";

      // Start second arc
      startNarrativeArc(daemon, "survival", "Escape the dungeon", "", { toGain: "", toLose: "" });

      expect(daemon.narrativeArc.previousArcs.length).toBe(1);
      expect(daemon.narrativeArc.previousArcs[0].resolution).toBe("transformed");
      expect(daemon.narrativeArc.theme).toBe("survival");
    });
  });

  describe("progressNarrativeArc", () => {
    it("should add beat and reset stagnation", () => {
      const daemon = createTestDaemon();
      daemon.narrativeArc.drivingGoal = "Find the truth";
      daemon.narrativeArc.ticksSinceProgress = 5;
      daemon.narrativeArc.needsSelfResolution = true;

      progressNarrativeArc(daemon, "Discovered a clue");

      expect(daemon.narrativeArc.completedBeats).toContain("Discovered a clue");
      expect(daemon.narrativeArc.ticksSinceProgress).toBe(0);
      expect(daemon.narrativeArc.needsSelfResolution).toBe(false);
    });

    it("should advance arc status through stages", () => {
      const daemon = createTestDaemon();
      startNarrativeArc(daemon, "mystery", "Solve the case", "", { toGain: "", toLose: "" });

      expect(daemon.narrativeArc.status).toBe("setup");

      // Progress through setup to rising
      progressNarrativeArc(daemon, "Beat 1");
      progressNarrativeArc(daemon, "Beat 2");
      expect(daemon.narrativeArc.status).toBe("rising");

      // Increase tension to trigger crisis
      daemon.narrativeArc.tension = 0.75;
      progressNarrativeArc(daemon, "Beat 3");
      expect(daemon.narrativeArc.status).toBe("crisis");
    });

    it("should keep only last 20 beats", () => {
      const daemon = createTestDaemon();
      daemon.narrativeArc.drivingGoal = "test";

      for (let i = 0; i < 25; i++) {
        progressNarrativeArc(daemon, `Beat ${i}`);
      }

      expect(daemon.narrativeArc.completedBeats.length).toBe(20);
      expect(daemon.narrativeArc.completedBeats[0]).toBe("Beat 5");
    });
  });

  describe("checkArcStagnation", () => {
    it("should not stagnate dormant arcs", () => {
      const daemon = createTestDaemon();
      daemon.narrativeArc.status = "dormant";

      const isStagnating = checkArcStagnation(daemon);

      expect(isStagnating).toBe(false);
    });

    it("should detect stagnation after threshold", () => {
      const daemon = createTestDaemon();
      startNarrativeArc(daemon, "test", "Test goal", "", { toGain: "", toLose: "" });
      daemon.narrativeArc.ticksSinceProgress = 8; // Two under threshold of 10
      daemon.narrativeArc.stagnationThreshold = 10;

      // Should not be stagnating yet (tick 9)
      let isStagnating = checkArcStagnation(daemon);
      expect(isStagnating).toBe(false);
      expect(daemon.narrativeArc.ticksSinceProgress).toBe(9);

      // Still not stagnating (tick 10 = threshold, but stagnation triggers at >=)
      isStagnating = checkArcStagnation(daemon);
      expect(isStagnating).toBe(true); // Triggers at threshold
      expect(daemon.narrativeArc.needsSelfResolution).toBe(true);
    });
  });

  describe("attemptSelfResolution", () => {
    it("should return null if not needing resolution", () => {
      const daemon = createTestDaemon();
      daemon.narrativeArc.needsSelfResolution = false;

      const nudge = attemptSelfResolution(daemon);
      expect(nudge).toBeNull();
    });

    it("should return appropriate nudge based on arc status", () => {
      const daemon = createTestDaemon();
      startNarrativeArc(daemon, "test", "Test goal", "", { toGain: "", toLose: "" });
      daemon.narrativeArc.needsSelfResolution = true;
      daemon.narrativeArc.status = "rising";

      const nudge = attemptSelfResolution(daemon);

      expect(nudge).not.toBeNull();
      expect(nudge!.type).toBe("escalate");
      expect(nudge!.source).toBe("god");
      expect(nudge!.priority).toBe("high");
    });

    it("should abandon arc after too many attempts", () => {
      const daemon = createTestDaemon();
      startNarrativeArc(daemon, "test", "Test goal", "", { toGain: "", toLose: "" });
      daemon.narrativeArc.needsSelfResolution = true;
      daemon.narrativeArc.selfResolutionAttempts = 3;

      const nudge = attemptSelfResolution(daemon);

      expect(nudge).toBeNull();
      expect(daemon.narrativeArc.status).toBe("dormant"); // Arc was abandoned
      expect(daemon.narrativeArc.previousArcs.length).toBe(1);
      expect(daemon.narrativeArc.previousArcs[0].resolution).toBe("abandoned");
    });
  });

  describe("completeNarrativeArc", () => {
    it("should archive arc and reset state", () => {
      const daemon = createTestDaemon();
      startNarrativeArc(daemon, "revenge", "Get revenge", "", { toGain: "", toLose: "" });
      progressNarrativeArc(daemon, "Started planning");
      progressNarrativeArc(daemon, "Confronted enemy");

      completeNarrativeArc(daemon, "success");

      expect(daemon.narrativeArc.previousArcs.length).toBe(1);
      expect(daemon.narrativeArc.previousArcs[0].theme).toBe("revenge");
      expect(daemon.narrativeArc.previousArcs[0].resolution).toBe("success");

      // Should be reset
      expect(daemon.narrativeArc.theme).toBe("daily life");
      expect(daemon.narrativeArc.status).toBe("dormant");
      expect(daemon.narrativeArc.drivingGoal).toBe("");
      expect(daemon.narrativeArc.completedBeats).toEqual([]);
    });

    it("should keep only last 5 previous arcs", () => {
      const daemon = createTestDaemon();

      for (let i = 0; i < 7; i++) {
        startNarrativeArc(daemon, `arc_${i}`, `Goal ${i}`, "", { toGain: "", toLose: "" });
        completeNarrativeArc(daemon, "success");
      }

      expect(daemon.narrativeArc.previousArcs.length).toBe(5);
    });

    it("should not archive dormant arcs", () => {
      const daemon = createTestDaemon();
      daemon.narrativeArc.status = "dormant";

      completeNarrativeArc(daemon, "success");

      expect(daemon.narrativeArc.previousArcs.length).toBe(0);
    });
  });

  describe("tension management", () => {
    it("should increase tension clamped to 1", () => {
      const daemon = createTestDaemon();
      daemon.narrativeArc.tension = 0.9;

      increaseTension(daemon, 0.2);

      expect(daemon.narrativeArc.tension).toBe(1);
    });

    it("should decrease tension clamped to 0", () => {
      const daemon = createTestDaemon();
      daemon.narrativeArc.tension = 0.1;

      decreaseTension(daemon, 0.2);

      expect(daemon.narrativeArc.tension).toBe(0);
    });
  });

  describe("getArcSummary", () => {
    it("should return formatted arc summary", () => {
      const daemon = createTestDaemon("Alice");
      startNarrativeArc(daemon, "mystery", "Find the killer", "Justice served",
        { toGain: "closure", toLose: "innocence" });
      progressNarrativeArc(daemon, "Found first clue");

      const summary = getArcSummary(daemon);

      expect(summary).toContain("Alice's Story Arc");
      expect(summary).toContain("Theme: mystery");
      expect(summary).toContain("Driving Goal: Find the killer");
      expect(summary).toContain("Desired Resolution: Justice served");
      expect(summary).toContain("Found first clue");
    });

    it("should indicate stagnation", () => {
      const daemon = createTestDaemon();
      startNarrativeArc(daemon, "test", "Test", "", { toGain: "", toLose: "" });
      daemon.narrativeArc.needsSelfResolution = true;

      const summary = getArcSummary(daemon);

      expect(summary).toContain("ARC STAGNATING");
    });
  });
});

describe("Integration: Memory and Arc", () => {
  it("should track character development through memory and arc", () => {
    const daemon = createTestDaemon("Emma");

    // Emma starts with a goal
    startNarrativeArc(daemon, "investigation", "Find out who stole the jewels",
      "Recover the jewels and clear my name",
      { toGain: "reputation", toLose: "freedom" });

    // Emma thinks about it
    recordThought(daemon, "the theft", "Who could have done this?", "anxious", 0.7);

    // Emma makes a plan
    recordPlan(daemon, "Investigate the servants", ["Talk to the butler", "Check the maid's quarters"], 0.8);

    // Emma discovers something
    recordMemory(daemon, "discovery", "Found a muddy footprint in the garden", ["Emma"], "Garden", 0.5, 0.75);

    // Arc should have progressed
    expect(daemon.narrativeArc.completedBeats.length).toBeGreaterThan(0);

    // Emma's relationship changes
    recordRelationshipChange(daemon, "The Butler", "trusted", "suspicious", "Found him near the safe", 0.7);

    // Should have character moment
    expect(daemon.memory.characterMoments.length).toBeGreaterThan(0);

    // Memory should reflect all this
    const summary = getMemorySummary(daemon);
    expect(summary).toContain("Who could have done this"); // Thought content, not focus
    expect(summary).toContain("Investigate the servants");
  });

  it("should handle arc stagnation and self-resolution flow", () => {
    const daemon = createTestDaemon("Bob");

    // Bob starts an arc
    startNarrativeArc(daemon, "escape", "Escape the prison",
      "Freedom", { toGain: "freedom", toLose: "life" });

    // Simulate stagnation
    daemon.narrativeArc.stagnationThreshold = 3;

    checkArcStagnation(daemon); // tick 1
    checkArcStagnation(daemon); // tick 2
    checkArcStagnation(daemon); // tick 3 - stagnating

    expect(daemon.narrativeArc.needsSelfResolution).toBe(true);

    // Self-resolution should generate a nudge
    const nudge = attemptSelfResolution(daemon);
    expect(nudge).not.toBeNull();
    expect(nudge!.priority).toBe("high");

    // Simulating the nudge being applied - progress happens
    progressNarrativeArc(daemon, "Found a loose bar in the window");
    expect(daemon.narrativeArc.needsSelfResolution).toBe(false);
  });
});
