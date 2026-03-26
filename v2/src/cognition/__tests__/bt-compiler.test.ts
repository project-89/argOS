import "dotenv/config";

import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Agent, BehaviorPolicy, Name, Needs, Traits } from "../../ecs/components";
import { addEntity, addComponent, query, hasComponent } from "bitecs";
import { registerEntity } from "../cognition-system";
import { setAgentBehaviorPolicy, evaluateBehaviorPolicy, clearPolicyEvalHistory, validateBehaviorNode, type BehaviorNode } from "../behavior-policy";
import { setLocatedIn } from "../../ecs/location";
import {
  captureLLMDecision,
  resolveDecision,
  pruneStaleBranches,
  getCompilationStats,
  resetCompilerState,
} from "../bt-compiler";
import { resetLearningState } from "../policy-learning";

function makeWorld() {
  const world = createArgosWorld("BTCompilerTest") as any;
  initializePrefabs(world);
  return world;
}

const BASE_TREE: BehaviorNode = {
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
      type: "weighted_random",
      choices: [
        { weight: 3, child: { type: "action", action: { type: "observe" } } },
        { weight: 2, child: { type: "action", action: { type: "think", content: "hmm" } } },
      ],
    },
  ],
};

beforeEach(() => {
  resetCompilerState();
  resetLearningState();
});

describe("BT Compiler: Capture + Resolve", () => {
  test("successful LLM decision gets compiled into BT branch", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Tavern", description: "A tavern" });
    registerEntity(room, "Tavern");
    const agent = createAgentEntity(world, { name: "Smith", role: "blacksmith", systemPrompt: "Blacksmith.", roomId: room });
    registerEntity(agent, "Smith");
    setAgentBehaviorPolicy(world, agent, BASE_TREE, true);

    // Simulate LLM deciding to speak
    captureLLMDecision(world, agent, "I see someone new, I should greet them",
      { type: "speak", content: "Welcome to the tavern!" });

    // Resolve as success
    resolveDecision(world, agent, true);

    // Tree should have grown
    const raw = BehaviorPolicy.treeJson[agent];
    expect(raw).toContain("speak");
    expect(raw).toContain("Welcome");

    const tree = JSON.parse(raw);
    expect(validateBehaviorNode(tree).ok).toBe(true);

    // Stats should reflect compilation
    const stats = getCompilationStats(agent);
    expect(stats.compiledBranches).toBe(1);
  });

  test("failed LLM decision is NOT compiled", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Forge", description: "A forge" });
    registerEntity(room, "Forge");
    const agent = createAgentEntity(world, { name: "Smith", role: "blacksmith", systemPrompt: "Blacksmith.", roomId: room });
    registerEntity(agent, "Smith");
    setAgentBehaviorPolicy(world, agent, BASE_TREE, true);

    const treeBefore = BehaviorPolicy.treeJson[agent];

    captureLLMDecision(world, agent, "I'll try to forge a sword",
      { type: "interact", target: "Broken Anvil", content: "forge" }, "forge");

    resolveDecision(world, agent, false);

    // Tree should NOT have changed
    expect(BehaviorPolicy.treeJson[agent]).toBe(treeBefore);
    expect(getCompilationStats(agent).compiledBranches).toBe(0);
  });

  test("duplicate decisions are not compiled twice", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Tavern", description: "A tavern" });
    registerEntity(room, "Tavern");
    const agent = createAgentEntity(world, { name: "Smith", role: "blacksmith", systemPrompt: "Blacksmith.", roomId: room });
    registerEntity(agent, "Smith");
    setAgentBehaviorPolicy(world, agent, BASE_TREE, true);

    // Same decision twice
    captureLLMDecision(world, agent, "greet", { type: "speak", content: "hi" });
    resolveDecision(world, agent, true);

    captureLLMDecision(world, agent, "greet again", { type: "speak", content: "hi" });
    resolveDecision(world, agent, true);

    expect(getCompilationStats(agent).compiledBranches).toBe(1); // Not 2
  });

  test("compiled interact branch is location-independent (no in_room)", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Forge", description: "A forge" });
    registerEntity(room, "Forge");
    const agent = createAgentEntity(world, { name: "Smith", role: "blacksmith", systemPrompt: "Blacksmith.", roomId: room });
    registerEntity(agent, "Smith");
    setAgentBehaviorPolicy(world, agent, BASE_TREE, true);

    captureLLMDecision(world, agent, "I should forge at the anvil",
      { type: "interact", target: "Anvil", content: "forge" }, "forge");
    resolveDecision(world, agent, true);

    const raw = BehaviorPolicy.treeJson[agent];
    // Interact branches should NOT have in_room — they work anywhere with matching traits
    expect(raw).not.toContain("in_room");
    // But should contain the affordance
    expect(raw).toContain("forge");
  });

  test("compiled speak branch includes room condition", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Tavern", description: "A tavern" });
    registerEntity(room, "Tavern");
    const other = createAgentEntity(world, { name: "Other", role: "npc", systemPrompt: "NPC.", roomId: room });
    registerEntity(other, "Other");
    const agent = createAgentEntity(world, { name: "Greta", role: "innkeeper", systemPrompt: "Innkeeper.", roomId: room });
    registerEntity(agent, "Greta");
    setAgentBehaviorPolicy(world, agent, BASE_TREE, true);

    captureLLMDecision(world, agent, "I should greet the newcomer",
      { type: "speak", content: "Welcome!" });
    resolveDecision(world, agent, true);

    const raw = BehaviorPolicy.treeJson[agent];
    // Speak branches ARE room-specific
    expect(raw).toContain("in_room");
    expect(raw).toContain("Tavern");
  });

  test("compiled branch includes need conditions when relevant", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Tavern", description: "A tavern" });
    registerEntity(room, "Tavern");
    const agent = createAgentEntity(world, { name: "Smith", role: "blacksmith", systemPrompt: "Blacksmith.", roomId: room });
    registerEntity(agent, "Smith");
    setAgentBehaviorPolicy(world, agent, BASE_TREE, true);

    // Set high hunger before capture
    Needs.hunger[agent] = 80;

    captureLLMDecision(world, agent, "I'm starving, need food",
      { type: "move", target: "Market" });
    resolveDecision(world, agent, true);

    const raw = BehaviorPolicy.treeJson[agent];
    expect(raw).toContain("need_above");
    expect(raw).toContain("hunger");
  });
});

describe("BT Compiler: Pruning", () => {
  test("prunes branches that never fire", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    registerEntity(room, "Room");
    const agent = createAgentEntity(world, { name: "Agent", role: "test", systemPrompt: "Test.", roomId: room });
    registerEntity(agent, "Agent");
    setAgentBehaviorPolicy(world, agent, BASE_TREE, true);

    // Compile 3 distinct branches (different action types → different signatures)
    const actions: Array<{ type: "speak" | "observe" | "move", content?: string, target?: string }> = [
      { type: "speak", content: "hello" },
      { type: "move", target: "Market" },
      { type: "observe" },
    ];
    for (const action of actions) {
      captureLLMDecision(world, agent, `decision`, action);
      resolveDecision(world, agent, true);
    }

    const branchCount = getCompilationStats(agent).compiledBranches;
    expect(branchCount).toBeGreaterThanOrEqual(2); // At least 2 distinct branches

    // Prune with 0ms age (everything is stale)
    const removed = pruneStaleBranches(world, agent);
    expect(removed).toBeGreaterThan(0);

    const tree = JSON.parse(BehaviorPolicy.treeJson[agent]);
    expect(validateBehaviorNode(tree).ok).toBe(true);
  });
});

describe("BT Compiler: Compiled branches are evaluable", () => {
  test("compiled branch actually fires when conditions match", () => {
    const world = makeWorld();
    const tavern = createRoomEntity(world, { name: "Tavern", description: "A tavern" });
    registerEntity(tavern, "Tavern");
    const forge = createRoomEntity(world, { name: "Forge", description: "A forge" });
    registerEntity(forge, "Forge");

    const agent = createAgentEntity(world, { name: "Smith", role: "blacksmith", systemPrompt: "Blacksmith.", roomId: tavern });
    registerEntity(agent, "Smith");

    // Simple tree with just a fallback
    const simpleTree: BehaviorNode = {
      type: "selector",
      children: [
        { type: "action", action: { type: "observe" } },
      ],
    };
    setAgentBehaviorPolicy(world, agent, simpleTree, true);
    clearPolicyEvalHistory(agent);

    // Before compilation: agent always observes
    const r1 = evaluateBehaviorPolicy(world, agent);
    expect(r1.kind).toBe("action");
    if (r1.kind === "action") expect(r1.action.type).toBe("observe");

    // Compile a "move to Forge" branch with no conditions (always fires)
    // We'll insert it manually since captureLLMDecision adds chance gates
    const raw = BehaviorPolicy.treeJson[agent];
    const tree = JSON.parse(raw);
    tree.children.splice(0, 0, {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "always" } },
        { type: "action", action: { type: "move", target: "Forge" } },
      ],
    });
    BehaviorPolicy.treeJson[agent] = JSON.stringify(tree);
    clearPolicyEvalHistory(agent);

    // After: agent should move to Forge (new branch fires first)
    const r2 = evaluateBehaviorPolicy(world, agent);
    expect(r2.kind).toBe("action");
    if (r2.kind === "action") {
      expect(r2.action.type).toBe("move");
      expect(r2.action.target).toBe("Forge");
    }
  });
});

describe("BT Compiler: Growth lifecycle", () => {
  test("tree grows through multiple successful LLM decisions", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Market", description: "A market" });
    registerEntity(room, "Market");
    const agent = createAgentEntity(world, { name: "Trader", role: "merchant", systemPrompt: "Merchant.", roomId: room });
    registerEntity(agent, "Trader");
    setAgentBehaviorPolicy(world, agent, BASE_TREE, true);

    const sizeBefore = JSON.stringify(BASE_TREE).length;

    // Simulate 5 different successful LLM decisions
    const decisions = [
      { reasoning: "I should haggle", action: { type: "interact" as const, target: "Stall", content: "haggle" }, aff: "haggle" },
      { reasoning: "That customer needs help", action: { type: "speak" as const, content: "Can I help you?" } },
      { reasoning: "I need to restock", action: { type: "move" as const, target: "Warehouse" } },
      { reasoning: "Let me check my inventory", action: { type: "observe" as const } },
      { reasoning: "I'm hungry, time for lunch", action: { type: "move" as const, target: "Tavern" } },
    ];

    for (const d of decisions) {
      captureLLMDecision(world, agent, d.reasoning, d.action, d.aff);
      resolveDecision(world, agent, true);
    }

    const sizeAfter = JSON.stringify(JSON.parse(BehaviorPolicy.treeJson[agent])).length;
    const stats = getCompilationStats(agent);

    // Tree should have grown
    expect(sizeAfter).toBeGreaterThan(sizeBefore);
    expect(stats.compiledBranches).toBeGreaterThanOrEqual(3); // Some might dedupe

    // Tree should still be valid
    const tree = JSON.parse(BehaviorPolicy.treeJson[agent]);
    expect(validateBehaviorNode(tree).ok).toBe(true);
  });
});
