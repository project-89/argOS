import { addComponent, hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Agent, BehaviorPolicy, Name } from "../../ecs/components";
import {
  recordAgentAction,
  getAgentActivity,
  getAgentActionHistory,
  resetWatcherState,
  detectPolicyStuckAgents,
  canEvolvePolicyLocal,
  setLastPolicyEvolutionTime,
} from "../watcher-spirit";
import { setAgentBehaviorPolicy } from "../../cognition/behavior-policy";
import type { BehaviorNode } from "../../cognition/behavior-policy";
import {
  resetAggregator,
  getObservationsByCategory,
} from "../observation-aggregator";

// A trivial policy tree that always waits
const WAIT_POLICY: BehaviorNode = {
  type: "action",
  action: { type: "wait" },
};

// A simple valid policy tree
const SIMPLE_POLICY: BehaviorNode = {
  type: "selector",
  children: [
    { type: "action", action: { type: "observe" } },
    { type: "action", action: { type: "move", target: "Tavern" } },
    { type: "action", action: { type: "interact", target: "Table" } },
    { type: "action", action: { type: "think" } },
    { type: "action", action: { type: "speak", content: "Hello" } },
  ],
};

function createTestAgent(world: any, name: string, roomEid?: number): number {
  return createAgentEntity(world, {
    name,
    role: "villager",
    systemPrompt: "You are a test agent.",
    roomId: roomEid,
  });
}

describe("Watcher Policy Evolution", () => {
  let world: any;

  beforeEach(() => {
    resetWatcherState();
    resetAggregator();
    world = createArgosWorld("TestWorld");
    initializePrefabs(world);
  });

  // =========================================================================
  // UNIT TESTS: Agent Activity Accessors
  // =========================================================================

  describe("getAgentActivity", () => {
    it("returns undefined for an untracked agent", () => {
      expect(getAgentActivity(999)).toBeUndefined();
    });

    it("returns correct activity record after recording actions", () => {
      recordAgentAction(42, "observe");
      recordAgentAction(42, "move");
      recordAgentAction(42, "interact");

      const record = getAgentActivity(42);
      expect(record).toBeDefined();
      expect(record!.lastActions).toEqual(["observe", "move", "interact"]);
      expect(record!.socialInteractions).toBe(0);
      expect(record!.stuckCounter).toBe(0);
    });

    it("tracks social interactions via speak/talk", () => {
      recordAgentAction(42, "observe");
      recordAgentAction(42, "speak");
      recordAgentAction(42, "talk");

      const record = getAgentActivity(42);
      expect(record!.socialInteractions).toBe(2);
    });
  });

  describe("getAgentActionHistory", () => {
    it("returns empty array for untracked agent", () => {
      expect(getAgentActionHistory(999)).toEqual([]);
    });

    it("returns the action list", () => {
      recordAgentAction(10, "observe");
      recordAgentAction(10, "move");
      recordAgentAction(10, "think");

      const history = getAgentActionHistory(10);
      expect(history).toEqual(["observe", "move", "think"]);
    });

    it("returns a copy (not a reference to internal state)", () => {
      recordAgentAction(10, "observe");
      const history1 = getAgentActionHistory(10);
      history1.push("injected");

      const history2 = getAgentActionHistory(10);
      expect(history2).toEqual(["observe"]);
    });

    it("caps at 20 actions (circular buffer)", () => {
      for (let i = 0; i < 25; i++) {
        recordAgentAction(10, `action_${i}`);
      }
      const history = getAgentActionHistory(10);
      expect(history.length).toBe(20);
      expect(history[0]).toBe("action_5");
      expect(history[19]).toBe("action_24");
    });
  });

  // =========================================================================
  // UNIT TESTS: Stuck Detection
  // =========================================================================

  describe("detectPolicyStuckAgents", () => {
    it("detects stuck agent with 10 identical observe actions", () => {
      const roomEid = createRoomEntity(world, { name: "Test Room" });
      const agentEid = createTestAgent(world, "StuckBot", roomEid);
      setAgentBehaviorPolicy(world, agentEid, SIMPLE_POLICY, true);

      // Record 10 identical "observe" actions
      for (let i = 0; i < 10; i++) {
        recordAgentAction(agentEid, "observe");
      }

      detectPolicyStuckAgents(world);

      const gaps = getObservationsByCategory("behavioral_gap");
      const stuckGap = gaps.find(g =>
        g.title.includes("StuckBot") && g.title.includes("low action diversity")
      );
      expect(stuckGap).toBeDefined();
      expect(stuckGap!.detail).toContain(`eid:${agentEid}`);
      expect(stuckGap!.detail).toContain("observe,observe,observe");
    });

    it("detects alternating move,observe pattern", () => {
      const roomEid = createRoomEntity(world, { name: "Test Room" });
      const agentEid = createTestAgent(world, "PingPong", roomEid);
      setAgentBehaviorPolicy(world, agentEid, SIMPLE_POLICY, true);

      // Record alternating "move,observe" x 10
      for (let i = 0; i < 10; i++) {
        recordAgentAction(agentEid, "move");
        recordAgentAction(agentEid, "observe");
      }

      detectPolicyStuckAgents(world);

      const gaps = getObservationsByCategory("behavioral_gap");
      const stuckGap = gaps.find(g =>
        g.title.includes("PingPong") && g.title.includes("low action diversity")
      );
      expect(stuckGap).toBeDefined();
      expect(stuckGap!.detail).toContain(`eid:${agentEid}`);
    });

    it("reports high severity when stuck for 20+ actions", () => {
      const roomEid = createRoomEntity(world, { name: "Test Room" });
      const agentEid = createTestAgent(world, "VeryStuck", roomEid);
      setAgentBehaviorPolicy(world, agentEid, SIMPLE_POLICY, true);

      // Record 20 identical "observe" actions (buffer caps at 20)
      for (let i = 0; i < 20; i++) {
        recordAgentAction(agentEid, "observe");
      }

      detectPolicyStuckAgents(world);

      const gaps = getObservationsByCategory("behavioral_gap");
      const stuckGap = gaps.find(g =>
        g.title.includes("VeryStuck") && g.title.includes("low action diversity")
      );
      expect(stuckGap).toBeDefined();
      expect(stuckGap!.severity).toBe("high");
    });

    it("does not flag agents without behavior policy", () => {
      const roomEid = createRoomEntity(world, { name: "Test Room" });
      const agentEid = createTestAgent(world, "NoPolicyBot", roomEid);
      // No behavior policy set

      for (let i = 0; i < 10; i++) {
        recordAgentAction(agentEid, "observe");
      }

      detectPolicyStuckAgents(world);

      const gaps = getObservationsByCategory("behavioral_gap");
      const stuckGap = gaps.find(g => g.title.includes("NoPolicyBot"));
      expect(stuckGap).toBeUndefined();
    });

    it("does not flag agents with diverse actions", () => {
      const roomEid = createRoomEntity(world, { name: "Test Room" });
      const agentEid = createTestAgent(world, "HealthyBot", roomEid);
      setAgentBehaviorPolicy(world, agentEid, SIMPLE_POLICY, true);

      const actions = ["observe", "move", "interact", "think", "speak", "observe", "move", "interact", "think", "speak"];
      for (const a of actions) {
        recordAgentAction(agentEid, a);
      }

      detectPolicyStuckAgents(world);

      const gaps = getObservationsByCategory("behavioral_gap");
      const stuckGap = gaps.find(g =>
        g.title.includes("HealthyBot") && g.title.includes("low action diversity")
      );
      expect(stuckGap).toBeUndefined();
    });
  });

  // =========================================================================
  // UNIT TESTS: Rate Limiting
  // =========================================================================

  describe("canEvolvePolicyLocal", () => {
    it("returns true when no previous evolution", () => {
      expect(canEvolvePolicyLocal(42)).toBe(true);
    });

    it("returns false within 5 minutes of last evolution", () => {
      setLastPolicyEvolutionTime(42, Date.now());
      expect(canEvolvePolicyLocal(42)).toBe(false);
    });

    it("returns true after 5 minutes", () => {
      // Set last evolution to 6 minutes ago
      setLastPolicyEvolutionTime(42, Date.now() - 6 * 60 * 1000);
      expect(canEvolvePolicyLocal(42)).toBe(true);
    });

    it("tracks per-agent independently", () => {
      setLastPolicyEvolutionTime(1, Date.now()); // Recent
      setLastPolicyEvolutionTime(2, Date.now() - 10 * 60 * 1000); // Old

      expect(canEvolvePolicyLocal(1)).toBe(false);
      expect(canEvolvePolicyLocal(2)).toBe(true);
    });
  });

  // =========================================================================
  // BEHAVIORAL TESTS: Stuck Agent Detection End-to-End
  // =========================================================================

  describe("behavioral: stuck agent with bad policy", () => {
    it("reports behavioral_gap with high severity after 20 wait actions", () => {
      const roomEid = createRoomEntity(world, { name: "Dungeon" });
      const agentEid = createTestAgent(world, "LazyGuard", roomEid);
      setAgentBehaviorPolicy(world, agentEid, WAIT_POLICY, true);

      // Record 20 "wait" actions
      for (let i = 0; i < 20; i++) {
        recordAgentAction(agentEid, "wait");
      }

      detectPolicyStuckAgents(world);

      const gaps = getObservationsByCategory("behavioral_gap");
      const stuckGap = gaps.find(g =>
        g.title.includes("LazyGuard") && g.title.includes("low action diversity")
      );
      expect(stuckGap).toBeDefined();
      expect(stuckGap!.severity).toBe("high");
      expect(stuckGap!.detail).toContain(`eid:${agentEid}`);
      expect(stuckGap!.detail).toContain("wait,wait,wait");
    });
  });

  describe("behavioral: only stuck agent triggers detection", () => {
    it("flags stuck agent but not healthy agent", () => {
      const roomEid = createRoomEntity(world, { name: "Village Square" });
      const stuckEid = createTestAgent(world, "StuckVillager", roomEid);
      const healthyEid = createTestAgent(world, "HappyVillager", roomEid);

      setAgentBehaviorPolicy(world, stuckEid, WAIT_POLICY, true);
      setAgentBehaviorPolicy(world, healthyEid, SIMPLE_POLICY, true);

      // Stuck agent: 15 identical actions
      for (let i = 0; i < 15; i++) {
        recordAgentAction(stuckEid, "observe");
      }

      // Healthy agent: diverse actions
      const diverse = ["observe", "move", "interact", "think", "speak",
                       "observe", "interact", "move", "think", "speak",
                       "observe", "move", "interact", "think", "speak"];
      for (const a of diverse) {
        recordAgentAction(healthyEid, a);
      }

      detectPolicyStuckAgents(world);

      const gaps = getObservationsByCategory("behavioral_gap");

      // Stuck agent should be flagged
      const stuckGap = gaps.find(g =>
        g.title.includes("StuckVillager") && g.title.includes("low action diversity")
      );
      expect(stuckGap).toBeDefined();

      // Healthy agent should NOT be flagged
      const healthyGap = gaps.find(g =>
        g.title.includes("HappyVillager") && g.title.includes("low action diversity")
      );
      expect(healthyGap).toBeUndefined();
    });
  });

  // =========================================================================
  // UNIT TEST: resetWatcherState clears evolution tracking
  // =========================================================================

  describe("resetWatcherState", () => {
    it("clears agent activity and evolution tracking", () => {
      recordAgentAction(42, "observe");
      setLastPolicyEvolutionTime(42, Date.now());

      expect(getAgentActivity(42)).toBeDefined();
      expect(canEvolvePolicyLocal(42)).toBe(false);

      resetWatcherState();

      expect(getAgentActivity(42)).toBeUndefined();
      expect(canEvolvePolicyLocal(42)).toBe(true);
    });
  });
});
