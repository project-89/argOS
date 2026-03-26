/**
 * Phase 2 Integration Test
 *
 * Exercises the full generative behavior policy pipeline:
 *   1. Policy generator creates behavior trees (with mocked LLM)
 *   2. Behavior policy evaluator executes trees including new memory/belief/impression conditions
 *   3. Policy metrics track effectiveness as actions are chosen
 *   4. Watcher detects stuck agents and flags behavioral gaps
 *   5. Evolution produces structurally different policies
 *
 * This is NOT a unit test — it wires together all Phase 2 modules and
 * runs a simulated 100-tick scenario.
 */

import "dotenv/config";

import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } from "../../ecs/prefabs";
import { Needs, Agent, Memory, Belief, Impression } from "../../ecs/components";
import { HasMemory, HasBelief, HasImpression } from "../../ecs/relations";
import { addEntity, addComponent } from "bitecs";
import { registerEntity } from "../cognition-system";
import {
  setAgentBehaviorPolicy,
  evaluateBehaviorPolicy,
  clearPolicyEvalHistory,
  type BehaviorNode,
  type PolicyEvalResult,
} from "../behavior-policy";
import {
  generateBehaviorPolicy,
  evolvePolicy,
  _setLLMCallOverride,
  _resetEvolutionTracking,
  canEvolvePolicy,
  getEvolutionCount,
  type PolicyGenerationContext,
} from "../policy-generator";
import {
  recordPolicyAction,
  getPolicyEffectiveness,
  resetAllPolicyMetrics,
  computeActionDiversity,
  detectStuckLoop,
} from "../policy-metrics";
import {
  recordAgentAction,
  resetWatcherState,
  getAgentActivity,
  getAgentActionHistory,
} from "../../spirits/watcher-spirit";
import { recordAction as recordSharedAction, getRecentActions, clearActionHistory } from "../agent-action-history";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorld() {
  const world = createArgosWorld("Phase2IntegrationTest") as any;
  initializePrefabs(world);
  return world;
}

function makeContext(overrides: Partial<PolicyGenerationContext> = {}): PolicyGenerationContext {
  return {
    name: "TestAgent",
    role: "blacksmith",
    personality: "gruff but fair",
    currentRoom: "Forge",
    availableAffordances: [
      { name: "forge_weapon", description: "Forge a weapon at the anvil", requires: ["forgeable"] },
      { name: "quench_steel", description: "Quench hot steel in water", requires: ["quenchable"] },
    ],
    availableTraits: [
      { name: "forgeable", description: "Can be forged", category: "material" },
      { name: "quenchable", description: "Can be quenched", category: "material" },
    ],
    availableRelationships: [
      { name: "Apprentice", description: "Apprentice-master relationship" },
    ],
    worldTheme: "medieval village",
    existingTemplates: ["survival", "worker", "guard"],
    ...overrides,
  };
}

// A valid policy that the "LLM" returns
const MOCK_BLACKSMITH_POLICY: BehaviorNode = {
  type: "selector",
  children: [
    // Survival: rest when exhausted
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "need_above", need: "energy", value: 80 } },
        { type: "action", action: { type: "rest" } },
      ],
    },
    // Role: forge if in Forge
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "in_room", roomName: "Forge" } },
        { type: "condition", op: { type: "last_action_not", actionType: "interact" } },
        { type: "interact_with_trait", trait: "forgeable", affordance: "forge_weapon" },
      ],
    },
    // Social: speak if others present
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "room_has_other_agents" } },
        { type: "condition", op: { type: "chance", p: 0.3 } },
        { type: "action", action: { type: "speak", content: "greeting" } },
      ],
    },
    // Memory-driven: if remembers theft, report
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "has_memory", includes: "theft" } },
        { type: "action", action: { type: "speak", content: "I must report the theft!" } },
      ],
    },
    // Fallback: observe
    { type: "action", action: { type: "observe" } },
  ],
};

// A deliberately BAD policy that always waits
const BAD_STUCK_POLICY: BehaviorNode = {
  type: "action",
  action: { type: "wait" },
};

// An evolved version of the bad policy
const EVOLVED_POLICY: BehaviorNode = {
  type: "selector",
  children: [
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "chance", p: 0.5 } },
        { type: "action", action: { type: "observe" } },
      ],
    },
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "room_has_other_agents" } },
        { type: "action", action: { type: "speak", content: "hello" } },
      ],
    },
    { type: "action", action: { type: "think", content: "what should I do?" } },
  ],
};

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  _setLLMCallOverride(null);
  _resetEvolutionTracking();
  resetAllPolicyMetrics();
  resetWatcherState();
  clearActionHistory();
});

afterAll(() => {
  _setLLMCallOverride(null);
});

// ===========================================================================
// TESTS
// ===========================================================================

describe("Phase 2 Integration: Full Pipeline", () => {

  // -------------------------------------------------------------------------
  // 1. Policy Generation + Evaluation
  // -------------------------------------------------------------------------

  test("generate → assign → evaluate produces coherent actions", async () => {
    // Mock LLM to return the blacksmith policy
    _setLLMCallOverride(async () => JSON.stringify(MOCK_BLACKSMITH_POLICY));

    const context = makeContext();
    const policy = await generateBehaviorPolicy(context);

    // Verify structure
    expect(policy.type).toBe("selector");
    expect((policy as any).children.length).toBeGreaterThanOrEqual(3);

    // Now evaluate it in a real ECS world
    const world = makeWorld();
    const forge = createRoomEntity(world, { name: "Forge", description: "A hot forge" });
    registerEntity(forge, "Forge");

    const agent = createAgentEntity(world, {
      name: "Thorin",
      role: "blacksmith",
      systemPrompt: "You are a blacksmith.",
      roomId: forge,
    });
    registerEntity(agent, "Thorin");

    setAgentBehaviorPolicy(world, agent, policy, true);

    // Low energy → should rest
    Needs.energy[agent] = 90;
    const result1 = evaluateBehaviorPolicy(world, agent);
    expect(result1.kind).toBe("action");
    if (result1.kind === "action") {
      expect(result1.action.type).toBe("rest");
    }

    // Normal energy, in Forge → should forge (if last action wasn't interact)
    Needs.energy[agent] = 30;
    const result2 = evaluateBehaviorPolicy(world, agent);
    expect(["action", "llm_fallback"]).toContain(result2.kind);
    if (result2.kind === "action") {
      // Could be forge or observe depending on last-action state
      expect(["interact", "observe", "speak"]).toContain(result2.action.type);
    }
  });

  test("policy generator falls back to template on LLM failure", async () => {
    _setLLMCallOverride(async () => {
      throw new Error("LLM unavailable");
    });

    const context = makeContext({ role: "innkeeper" });
    const policy = await generateBehaviorPolicy(context);

    // Should get a valid template
    expect(policy.type).toBe("selector");
    // Should be evaluable
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Tavern", description: "A tavern" });
    registerEntity(room, "Tavern");
    const agent = createAgentEntity(world, {
      name: "Barkeep",
      role: "innkeeper",
      systemPrompt: "You are a barkeep.",
      roomId: room,
    });
    registerEntity(agent, "Barkeep");
    setAgentBehaviorPolicy(world, agent, policy, true);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(["action", "llm_fallback"]).toContain(result.kind);
  });

  // -------------------------------------------------------------------------
  // 2. Memory-to-Behavior Bridge in a full tree
  // -------------------------------------------------------------------------

  test("has_memory condition drives behavior branching", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Hall", description: "A hall" });
    registerEntity(room, "Hall");

    const agent = createAgentEntity(world, {
      name: "Witness",
      role: "villager",
      systemPrompt: "You witnessed a theft.",
      roomId: room,
    });
    registerEntity(agent, "Witness");

    // Create a memory entity and relate it to the agent
    const memEid = addEntity(world);
    addComponent(world, memEid, Memory as any);
    Memory.content[memEid] = "I saw the blacksmith commit theft of gold coins";
    addComponent(world, agent, HasMemory(memEid));

    // Policy: if has_memory("theft") → speak about it, else observe
    const policy: BehaviorNode = {
      type: "selector",
      children: [
        {
          type: "sequence",
          children: [
            { type: "condition", op: { type: "has_memory", includes: "theft" } },
            { type: "action", action: { type: "speak", content: "I must report the theft!" } },
          ],
        },
        { type: "action", action: { type: "observe" } },
      ],
    };

    setAgentBehaviorPolicy(world, agent, policy, true);
    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
    if (result.kind === "action") {
      expect(result.action.type).toBe("speak");
      expect(result.action.content).toContain("theft");
    }
  });

  test("has_memory returns false when no matching memory, falls through to observe", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Hall", description: "A hall" });
    registerEntity(room, "Hall");

    const agent = createAgentEntity(world, {
      name: "Innocent",
      role: "villager",
      systemPrompt: "A peaceful villager.",
      roomId: room,
    });
    registerEntity(agent, "Innocent");

    // Same policy but no memory
    const policy: BehaviorNode = {
      type: "selector",
      children: [
        {
          type: "sequence",
          children: [
            { type: "condition", op: { type: "has_memory", includes: "theft" } },
            { type: "action", action: { type: "speak", content: "Report theft!" } },
          ],
        },
        { type: "action", action: { type: "observe" } },
      ],
    };

    setAgentBehaviorPolicy(world, agent, policy, true);
    clearPolicyEvalHistory(agent);
    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
    if (result.kind === "action") {
      // Without the theft memory, the has_memory condition fails → falls through to observe
      // (anti-repetition might substitute think/reflect if observe was recently used)
      expect(["observe", "think", "reflect"]).toContain(result.action.type);
    }
  });

  test("last_n_actions_exclude enforces variety", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Square", description: "Town square" });
    registerEntity(room, "Square");

    const agent = createAgentEntity(world, {
      name: "Explorer",
      role: "explorer",
      systemPrompt: "Curious explorer.",
      roomId: room,
    });
    registerEntity(agent, "Explorer");

    // Record 5 observe actions so last_n_actions_exclude("observe", 5) is false
    for (let i = 0; i < 5; i++) {
      recordSharedAction(agent, "observe");
    }

    // Policy: if hasn't observed in last 5 → observe; else think
    const policy: BehaviorNode = {
      type: "selector",
      children: [
        {
          type: "sequence",
          children: [
            { type: "condition", op: { type: "last_n_actions_exclude", n: 5, actionType: "observe" } },
            { type: "action", action: { type: "observe" } },
          ],
        },
        { type: "action", action: { type: "think", content: "What else can I do?" } },
      ],
    };

    setAgentBehaviorPolicy(world, agent, policy, true);
    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
    if (result.kind === "action") {
      // last_n_actions_exclude("observe",5) is FALSE because we DID observe in last 5
      // So the sequence fails, falls through to think
      expect(result.action.type).toBe("think");
    }
  });

  // -------------------------------------------------------------------------
  // 3. Policy Metrics Tracking
  // -------------------------------------------------------------------------

  test("metrics track diversity and detect stuck loops across 50 actions", () => {
    const agentEid = 42;

    // Simulate a stuck agent: alternating move/observe
    for (let i = 0; i < 50; i++) {
      const actionType = i % 2 === 0 ? "move" : "observe";
      recordPolicyAction(agentEid, actionType, false);
    }

    const metrics = getPolicyEffectiveness(agentEid);
    expect(metrics).toBeDefined();

    // Only 2 action types → low diversity (Shannon entropy of uniform(2) = 1.0)
    expect(metrics!.actionDiversity).toBeCloseTo(1.0, 1);

    // Should detect the alternating pattern as stuck
    expect(metrics!.stuckLoopCount).toBeGreaterThan(0);

    // No LLM fallbacks
    expect(metrics!.llmFallbackRate).toBe(0);
  });

  test("metrics track healthy diverse agent correctly", () => {
    const agentEid = 43;
    const actionTypes = ["observe", "speak", "move", "interact", "think", "rest", "reflect", "wait"];

    for (let i = 0; i < 50; i++) {
      const actionType = actionTypes[i % actionTypes.length];
      recordPolicyAction(agentEid, actionType, false);
    }

    const metrics = getPolicyEffectiveness(agentEid);
    expect(metrics).toBeDefined();

    // 8 action types → high diversity (Shannon entropy of uniform(8) = 3.0)
    expect(metrics!.actionDiversity).toBeGreaterThan(2.5);

    // Even distribution of 8 types shouldn't trigger stuck loop
    // (the pattern length is 8, which exceeds the windowSize=3 check)
    expect(metrics!.stuckLoopCount).toBe(0);
  });

  test("LLM fallback rate tracks correctly", () => {
    const agentEid = 44;

    for (let i = 0; i < 50; i++) {
      // 40 out of 50 are LLM fallbacks
      const wasLlmFallback = i < 40;
      recordPolicyAction(agentEid, "observe", wasLlmFallback);
    }

    const metrics = getPolicyEffectiveness(agentEid);
    expect(metrics).toBeDefined();
    expect(metrics!.llmFallbackRate).toBe(0.8);
  });

  // -------------------------------------------------------------------------
  // 4. Watcher Agent Activity Tracking
  // -------------------------------------------------------------------------

  test("watcher tracks agent actions and exposes history", () => {
    const agentEid = 100;
    recordAgentAction(agentEid, "observe");
    recordAgentAction(agentEid, "move");
    recordAgentAction(agentEid, "speak");

    const activity = getAgentActivity(agentEid);
    expect(activity).toBeDefined();
    expect(activity!.lastActions).toContain("observe");
    expect(activity!.lastActions).toContain("move");
    expect(activity!.lastActions).toContain("speak");

    const history = getAgentActionHistory(agentEid);
    expect(history).toEqual(["observe", "move", "speak"]);
  });

  // -------------------------------------------------------------------------
  // 5. Policy Evolution Pipeline
  // -------------------------------------------------------------------------

  test("evolvePolicy produces structurally different tree", async () => {
    _setLLMCallOverride(async () => JSON.stringify(EVOLVED_POLICY));

    const context = makeContext();
    const evolved = await evolvePolicy(
      BAD_STUCK_POLICY,
      context,
      "Agent is stuck in a wait loop",
      ["All 20 actions were 'wait'", "Zero diversity"],
      999
    );

    // Should be structurally different
    expect(evolved.type).not.toBe(BAD_STUCK_POLICY.type);
    expect(evolved.type).toBe("selector");
    expect((evolved as any).children.length).toBeGreaterThan(1);

    // Evolution count should increment
    expect(getEvolutionCount(999)).toBe(1);

    // Should be rate-limited now
    expect(canEvolvePolicy(999)).toBe(false);
  });

  test("evolvePolicy returns valid policy even on LLM failure", async () => {
    _setLLMCallOverride(async () => {
      throw new Error("API down");
    });

    const context = makeContext();
    const result = await evolvePolicy(
      BAD_STUCK_POLICY,
      context,
      "stuck",
      ["looping"],
      998
    );

    // Should return either original or a template fallback — both are valid
    const { validateBehaviorNode: validate } = await import("../behavior-policy");
    expect(validate(result).ok).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 6. Full 100-tick Simulation Scenario
  // -------------------------------------------------------------------------

  test("100-tick scenario: healthy agent maintains diversity, stuck agent is detected", () => {
    const healthyAgent = 200;
    const stuckAgent = 201;

    const actionTypes = ["observe", "speak", "move", "interact", "think"];

    // Simulate 100 ticks
    for (let tick = 0; tick < 100; tick++) {
      // Healthy agent: diverse actions
      const healthyAction = actionTypes[tick % actionTypes.length];
      recordPolicyAction(healthyAgent, healthyAction, false);
      recordAgentAction(healthyAgent, healthyAction);
      recordSharedAction(healthyAgent, healthyAction);

      // Stuck agent: always waits
      recordPolicyAction(stuckAgent, "wait", false);
      recordAgentAction(stuckAgent, "wait");
      recordSharedAction(stuckAgent, "wait");
    }

    // Check healthy agent
    const healthyMetrics = getPolicyEffectiveness(healthyAgent);
    expect(healthyMetrics).toBeDefined();
    expect(healthyMetrics!.actionDiversity).toBeGreaterThan(2.0);
    expect(healthyMetrics!.stuckLoopCount).toBe(0);

    const healthyHistory = getAgentActionHistory(healthyAgent);
    expect(healthyHistory!.length).toBeGreaterThan(0);

    // Check stuck agent
    const stuckMetrics = getPolicyEffectiveness(stuckAgent);
    expect(stuckMetrics).toBeDefined();
    expect(stuckMetrics!.actionDiversity).toBe(0); // Only one action type
    expect(stuckMetrics!.stuckLoopCount).toBeGreaterThan(0);

    const stuckHistory = getAgentActionHistory(stuckAgent);
    expect(stuckHistory!.every((a: string) => a === "wait")).toBe(true);

    // Shared action history should reflect last N actions
    const sharedHealthy = getRecentActions(healthyAgent);
    expect(sharedHealthy.length).toBeGreaterThan(0);
    expect(new Set(sharedHealthy).size).toBeGreaterThan(1);

    const sharedStuck = getRecentActions(stuckAgent);
    expect(sharedStuck.every((a) => a === "wait")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 7. Batch Policy Generation
  // -------------------------------------------------------------------------

  test("batch generation handles mixed success/failure", async () => {
    let callCount = 0;
    _setLLMCallOverride(async ({ prompt }) => {
      callCount++;
      // First agent succeeds, second fails
      if (prompt.includes("blacksmith")) {
        return JSON.stringify(MOCK_BLACKSMITH_POLICY);
      }
      throw new Error("LLM overloaded");
    });

    const { generateBatchPolicies } = await import("../policy-generator");

    const agents = [
      makeContext({ name: "Smith", role: "blacksmith" }),
      makeContext({ name: "Baker", role: "baker" }),
    ];

    const policies = await generateBatchPolicies(agents);

    expect(policies.size).toBe(2);
    // Smith got the LLM-generated policy
    expect(policies.get("Smith")!.type).toBe("selector");
    // Baker fell back to template (baker is retried once, then falls back)
    expect(policies.get("Baker")).toBeDefined();
    expect(policies.get("Baker")!.type).toBe("selector"); // template is also a selector
  });
});
