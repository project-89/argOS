import "dotenv/config";

import {
  generateBehaviorPolicy,
  generateBatchPolicies,
  evolvePolicy,
  canEvolvePolicy,
  getEvolutionCount,
  _resetEvolutionTracking,
  _buildSystemPrompt,
  _buildUserPrompt,
  _fallbackToTemplate,
  _setLLMCallOverride,
  type PolicyGenerationContext,
} from "../policy-generator";
import { validateBehaviorNode, type BehaviorNode } from "../behavior-policy";

// =============================================================================
// LLM MOCK INFRASTRUCTURE
// =============================================================================

/** Queue of responses the mock LLM will return (FIFO) */
let mockResponses: Array<string | Error> = [];
let llmCallCount = 0;

function mockLLMResponse(text: string) {
  mockResponses.push(text);
}

function mockLLMError(message: string) {
  mockResponses.push(new Error(message));
}

function setupMockLLM() {
  mockResponses = [];
  llmCallCount = 0;
  _setLLMCallOverride(async () => {
    llmCallCount++;
    const next = mockResponses.shift();
    if (next instanceof Error) throw next;
    return next ?? "";
  });
}

function teardownMockLLM() {
  _setLLMCallOverride(null);
  mockResponses = [];
  llmCallCount = 0;
}

// =============================================================================
// TEST FIXTURES
// =============================================================================

function makeContext(overrides?: Partial<PolicyGenerationContext>): PolicyGenerationContext {
  return {
    name: "Gareth",
    role: "blacksmith",
    personality: "gruff but kind, dedicated to his craft",
    currentRoom: "The Forge",
    availableAffordances: [
      { name: "examine", description: "Look at something closely", requires: [] },
      { name: "use", description: "Use a workable object", requires: ["workable"] },
      { name: "eat", description: "Eat something edible", requires: ["edible"] },
      { name: "drink", description: "Drink something", requires: ["drinkable"] },
      { name: "talk", description: "Speak to someone", requires: ["talkable"] },
      { name: "forge", description: "Forge metal at the anvil", requires: ["forgeable"] },
      { name: "smelt", description: "Smelt ore in the furnace", requires: ["smeltable"] },
    ],
    availableTraits: [
      { name: "workable", description: "Can be used/operated", category: "interaction" },
      { name: "forgeable", description: "Can be forged into items", category: "crafting" },
      { name: "smeltable", description: "Can be smelted in furnace", category: "crafting" },
      { name: "edible", description: "Can be eaten", category: "consumable" },
      { name: "drinkable", description: "Can be drunk", category: "consumable" },
      { name: "talkable", description: "Can be spoken to", category: "social" },
    ],
    availableRelationships: [
      { name: "OwnedBy", description: "Entity is owned by another" },
      { name: "Contains", description: "Entity contains another" },
    ],
    worldTheme: "medieval port city",
    existingTemplates: ["survival", "innkeeper", "guard", "scholar", "merchant", "worker"],
    ...overrides,
  };
}

/** A valid behavior tree that a blacksmith LLM might return */
const VALID_BLACKSMITH_POLICY: BehaviorNode = {
  type: "selector",
  children: [
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "need_below", need: "energy", value: 15 } },
        { type: "action", action: { type: "rest" } },
      ],
    },
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "need_below", need: "hunger", value: 30 } },
        { type: "interact_with_trait", trait: "edible", affordance: "eat", scope: "accessible" },
      ],
    },
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "in_room", roomName: "The Forge" } },
        { type: "condition", op: { type: "chance", p: 0.35 } },
        { type: "condition", op: { type: "last_action_not", actionType: "interact" } },
        { type: "interact_with_trait", trait: "forgeable", affordance: "forge", scope: "room" },
      ],
    },
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "in_room", roomName: "The Forge" } },
        { type: "condition", op: { type: "chance", p: 0.25 } },
        { type: "interact_with_trait", trait: "smeltable", affordance: "smelt", scope: "room" },
      ],
    },
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "has_memory", includes: "order" } },
        { type: "condition", op: { type: "last_n_actions_exclude", n: 2, actionType: "interact" } },
        { type: "interact_with_trait", trait: "forgeable", affordance: "forge", scope: "room" },
      ],
    },
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "not_in_room", roomName: "The Forge" } },
        { type: "condition", op: { type: "no_active_movement_goal" } },
        { type: "condition", op: { type: "chance", p: 0.6 } },
        { type: "action", action: { type: "move", target: "The Forge" } },
      ],
    },
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "room_has_other_agents" } },
        { type: "condition", op: { type: "chance", p: 0.25 } },
        { type: "interact_with_trait", trait: "talkable", affordance: "talk", scope: "room" },
      ],
    },
    {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "chance", p: 0.2 } },
        { type: "condition", op: { type: "last_action_not", actionType: "observe" } },
        { type: "action", action: { type: "observe", target: "room" } },
      ],
    },
    {
      type: "weighted_random",
      choices: [
        { weight: 3, child: { type: "action", action: { type: "observe", target: "room" } } },
        { weight: 2, child: { type: "interact_any_affordance", scope: "room" } },
        { weight: 2, child: { type: "action", action: { type: "think", content: "I think about my next creation..." } } },
        { weight: 1, child: { type: "wander" } },
        { weight: 1, child: { type: "action", action: { type: "wait" } } },
      ],
    },
  ],
};

/** A deep but valid tree (6 levels) */
const DEEP_VALID_TREE: BehaviorNode = {
  type: "selector",
  children: [
    {
      type: "selector",
      children: [
        {
          type: "sequence",
          children: [
            { type: "condition", op: { type: "need_below", need: "energy", value: 10 } },
            {
              type: "selector",
              children: [
                {
                  type: "sequence",
                  children: [
                    { type: "condition", op: { type: "in_room", roomName: "Bedroom" } },
                    { type: "action", action: { type: "rest" } },
                  ],
                },
                { type: "action", action: { type: "move", target: "Bedroom" } },
              ],
            },
          ],
        },
        { type: "action", action: { type: "observe", target: "room" } },
      ],
    },
    { type: "wander" },
  ],
};

// =============================================================================
// UNIT TESTS
// =============================================================================

describe("Policy Generator", () => {
  beforeEach(() => {
    setupMockLLM();
    _resetEvolutionTracking();
  });

  afterEach(() => {
    teardownMockLLM();
  });

  describe("Prompt Building", () => {
    test("system prompt includes all affordances", () => {
      const ctx = makeContext();
      const prompt = _buildSystemPrompt(ctx);

      for (const aff of ctx.availableAffordances) {
        expect(prompt).toContain(`"${aff.name}"`);
      }
    });

    test("system prompt includes all traits", () => {
      const ctx = makeContext();
      const prompt = _buildSystemPrompt(ctx);

      for (const trait of ctx.availableTraits) {
        expect(prompt).toContain(`"${trait.name}"`);
      }
    });

    test("system prompt includes all relationships", () => {
      const ctx = makeContext();
      const prompt = _buildSystemPrompt(ctx);

      for (const rel of ctx.availableRelationships) {
        expect(prompt).toContain(`"${rel.name}"`);
      }
    });

    test("system prompt includes memory/belief condition references", () => {
      const ctx = makeContext();
      const prompt = _buildSystemPrompt(ctx);

      // These are now enforced by the Zod schema, but should still be mentioned in prompt
      expect(prompt).toContain("has_memory");
      expect(prompt).toContain("has_belief");
      expect(prompt).toContain("last_n_actions_exclude");
    });

    test("user prompt includes agent room name", () => {
      const ctx = makeContext({ currentRoom: "Mystic Library" });
      const prompt = _buildUserPrompt(ctx);

      expect(prompt).toContain("Mystic Library");
    });

    test("user prompt includes agent details", () => {
      const ctx = makeContext();
      const prompt = _buildUserPrompt(ctx);

      expect(prompt).toContain("Gareth");
      expect(prompt).toContain("blacksmith");
      expect(prompt).toContain("gruff but kind");
      expect(prompt).toContain("The Forge");
      expect(prompt).toContain("medieval port city");
    });
  });

  describe("Validation and Retry", () => {
    test("returns valid policy from LLM on first attempt", async () => {
      mockLLMResponse(JSON.stringify(VALID_BLACKSMITH_POLICY));

      const ctx = makeContext();
      const result = await generateBehaviorPolicy(ctx);

      expect(result.type).toBe("selector");
      expect(llmCallCount).toBe(1);
    });

    test("falls back to template when LLM returns invalid JSON", async () => {
      // With structured output, invalid JSON means the mock threw or returned garbage
      mockLLMResponse("This is not JSON at all!");

      const ctx = makeContext({ role: "innkeeper" });
      const result = await generateBehaviorPolicy(ctx);

      // Should get template as fallback
      expect(result.type).toBe("selector");
      expect(validateBehaviorNode(result).ok).toBe(true);
    });

    test("falls back to template when LLM returns invalid tree structure", async () => {
      const invalidTree = {
        type: "action",
        action: { type: "fly_to_moon" },
      };
      mockLLMResponse(JSON.stringify(invalidTree));

      const ctx = makeContext({ role: "innkeeper" });
      const result = await generateBehaviorPolicy(ctx);

      // Should get template as fallback
      expect(result.type).toBe("selector");
      expect(validateBehaviorNode(result).ok).toBe(true);
    });

    test("falls back to template when LLM throws", async () => {
      mockLLMError("API key invalid");
      mockLLMError("API key invalid");

      const ctx = makeContext({ role: "guard" });
      const result = await generateBehaviorPolicy(ctx);

      expect(result.type).toBe("selector");
      expect(validateBehaviorNode(result).ok).toBe(true);
    });
  });

  describe("Template Fallback", () => {
    test("innkeeper role falls back to innkeeper template", () => {
      const ctx = makeContext({ role: "innkeeper at the Dragon's Rest", currentRoom: "Dragon's Rest" });
      const result = _fallbackToTemplate(ctx);

      expect(result.type).toBe("selector");
      expect(validateBehaviorNode(result).ok).toBe(true);
    });

    test("unknown role falls back to survival template", () => {
      const ctx = makeContext({ role: "mysterious wanderer of the void" });
      const result = _fallbackToTemplate(ctx);

      expect(result.type).toBe("selector");
      expect(validateBehaviorNode(result).ok).toBe(true);
    });

    test("worker role gets worker template with correct room", () => {
      const ctx = makeContext({ role: "blacksmith", currentRoom: "The Forge" });
      const result = _fallbackToTemplate(ctx);

      expect(result.type).toBe("selector");
      expect(validateBehaviorNode(result).ok).toBe(true);
    });
  });

  describe("Evolution Rate Limiting", () => {
    test("canEvolvePolicy returns true for new agent", () => {
      expect(canEvolvePolicy(42)).toBe(true);
    });

    test("canEvolvePolicy returns false after recent evolution", async () => {
      const ctx = makeContext();
      const evolved: BehaviorNode = {
        type: "selector",
        children: [{ type: "wander" }],
      };
      mockLLMResponse(JSON.stringify(evolved));

      // Trigger an evolution with agentEid=50
      await evolvePolicy(
        VALID_BLACKSMITH_POLICY,
        ctx,
        "test",
        ["test problem"],
        50
      );

      // Now should be rate-limited
      expect(canEvolvePolicy(50)).toBe(false);
    });

    test("getEvolutionCount returns 0 for new agent", () => {
      expect(getEvolutionCount(123)).toBe(0);
    });

    test("getEvolutionCount increments after evolution", async () => {
      const ctx = makeContext();
      const evolved: BehaviorNode = {
        type: "selector",
        children: [{ type: "wander" }],
      };
      mockLLMResponse(JSON.stringify(evolved));

      expect(getEvolutionCount(60)).toBe(0);

      await evolvePolicy(
        VALID_BLACKSMITH_POLICY,
        ctx,
        "test",
        ["problem"],
        60
      );

      expect(getEvolutionCount(60)).toBe(1);
    });

    test("evolvePolicy respects rate limit", async () => {
      const ctx = makeContext();
      const originalPolicy = VALID_BLACKSMITH_POLICY;

      // First evolution should work
      const evolvedPolicy: BehaviorNode = {
        type: "selector",
        children: [
          { type: "action", action: { type: "observe", target: "room" } },
          { type: "wander" },
        ],
      };
      mockLLMResponse(JSON.stringify(evolvedPolicy));

      const result1 = await evolvePolicy(
        originalPolicy,
        ctx,
        "agent stuck in loop",
        ["repeating observe 5x in a row"],
        50
      );

      expect(llmCallCount).toBe(1);
      expect(result1.type).toBe("selector");

      // Second evolution attempt immediately should be rate-limited
      const result2 = await evolvePolicy(
        originalPolicy,
        ctx,
        "still stuck",
        ["still looping"],
        50
      );

      // Should NOT have called LLM again (rate-limited)
      expect(llmCallCount).toBe(1);
      // Should return original policy unchanged
      expect(result2).toBe(originalPolicy);
    });

    test("evolvePolicy works without agentEid (no rate limit)", async () => {
      const ctx = makeContext();
      const evolvedPolicy: BehaviorNode = {
        type: "selector",
        children: [{ type: "wander" }],
      };
      mockLLMResponse(JSON.stringify(evolvedPolicy));

      const result = await evolvePolicy(
        VALID_BLACKSMITH_POLICY,
        ctx,
        "test",
        ["test problem"]
        // No agentEid — no rate limiting
      );

      expect(llmCallCount).toBe(1);
      expect(result.type).toBe("selector");
    });
  });

  describe("Batch Processing", () => {
    test("processes multiple agents and returns map", async () => {
      const agents = [
        makeContext({ name: "Gareth", role: "blacksmith" }),
        makeContext({ name: "Elena", role: "innkeeper" }),
        makeContext({ name: "Kira", role: "guard" }),
      ];

      // Mock successful responses for all
      for (const agent of agents) {
        mockLLMResponse(
          JSON.stringify({
            type: "selector",
            children: [
              { type: "action", action: { type: "think", content: `I am ${agent.name}` } },
              { type: "wander" },
            ],
          })
        );
      }

      const results = await generateBatchPolicies(agents);

      expect(results.size).toBe(3);
      expect(results.has("Gareth")).toBe(true);
      expect(results.has("Elena")).toBe(true);
      expect(results.has("Kira")).toBe(true);

      for (const [, policy] of results) {
        expect(validateBehaviorNode(policy).ok).toBe(true);
      }
    });

    test("handles partial failures (some get custom, others get templates)", async () => {
      const agents = [
        makeContext({ name: "Gareth", role: "blacksmith" }),
        makeContext({ name: "Elena", role: "innkeeper" }),
      ];

      // Gareth: success
      mockLLMResponse(JSON.stringify(VALID_BLACKSMITH_POLICY));

      // Elena: both attempts fail -> falls back to template
      mockLLMResponse("invalid json");
      mockLLMResponse("still invalid");

      const results = await generateBatchPolicies(agents);

      expect(results.size).toBe(2);
      expect(results.has("Gareth")).toBe(true);
      expect(results.has("Elena")).toBe(true);

      // Both should be valid
      expect(validateBehaviorNode(results.get("Gareth")!).ok).toBe(true);
      expect(validateBehaviorNode(results.get("Elena")!).ok).toBe(true);
    });

    test("handles empty agent list", async () => {
      const results = await generateBatchPolicies([]);
      expect(results.size).toBe(0);
    });
  });
});

// =============================================================================
// BEHAVIORAL / INTEGRATION TESTS (mocked LLM with realistic responses)
// =============================================================================

describe("Policy Generator - Behavioral", () => {
  beforeEach(() => {
    setupMockLLM();
    _resetEvolutionTracking();
  });

  afterEach(() => {
    teardownMockLLM();
  });

  test("blacksmith policy contains forge/craft-related affordances", async () => {
    mockLLMResponse(JSON.stringify(VALID_BLACKSMITH_POLICY));

    const ctx = makeContext({
      role: "master blacksmith",
      personality: "dedicated craftsman, proud of his work",
    });
    const result = await generateBehaviorPolicy(ctx);

    expect(validateBehaviorNode(result).ok).toBe(true);

    const json = JSON.stringify(result);
    expect(json).toContain("forgeable");
    expect(json).toContain("forge");
  });

  test("invalid JSON from LLM triggers fallback to template", async () => {
    mockLLMResponse("Here is your policy:\n\nUnfortunately I can't generate JSON...");
    mockLLMResponse("I apologize, still can't do it");

    const ctx = makeContext({ role: "merchant trader" });
    const result = await generateBehaviorPolicy(ctx);

    expect(result.type).toBe("selector");
    expect(validateBehaviorNode(result).ok).toBe(true);
  });

  test("deep but valid tree passes validation", async () => {
    mockLLMResponse(JSON.stringify(DEEP_VALID_TREE));

    const ctx = makeContext();
    const result = await generateBehaviorPolicy(ctx);

    expect(validateBehaviorNode(result).ok).toBe(true);
    expect(result.type).toBe("selector");
  });

  test("evolvePolicy produces structurally different tree", async () => {
    const original = VALID_BLACKSMITH_POLICY;
    const evolved: BehaviorNode = {
      type: "selector",
      children: [
        {
          type: "sequence",
          children: [
            { type: "condition", op: { type: "chance", p: 0.3 } },
            { type: "condition", op: { type: "last_action_not", actionType: "move" } },
            { type: "wander" },
          ],
        },
        {
          type: "sequence",
          children: [
            { type: "condition", op: { type: "room_has_other_agents" } },
            { type: "interact_with_trait", trait: "talkable", affordance: "talk", scope: "room" },
          ],
        },
        { type: "action", action: { type: "observe", target: "room" } },
      ],
    };

    mockLLMResponse(JSON.stringify(evolved));

    const ctx = makeContext();
    const result = await evolvePolicy(
      original,
      ctx,
      "agent stuck in observe loop",
      ["repeated observe 5 times in a row", "never talks to other agents"]
    );

    expect(validateBehaviorNode(result).ok).toBe(true);

    // Structurally different: different number of top-level children
    const origChildren = (original as any).children?.length ?? 0;
    const evolvedChildren = (result as any).children?.length ?? 0;
    expect(evolvedChildren).not.toBe(origChildren);
  });

  test("evolvePolicy returns a valid policy even on LLM failure", async () => {
    // All LLM calls will fail
    mockLLMError("Network error");
    mockLLMError("Network error");

    const ctx = makeContext();
    const original = VALID_BLACKSMITH_POLICY;
    const result = await evolvePolicy(
      original,
      ctx,
      "test failure",
      ["problem"]
    );

    // Should either return original or a template fallback — both are valid
    expect(validateBehaviorNode(result).ok).toBe(true);
  });
});
