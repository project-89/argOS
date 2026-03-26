import "dotenv/config";

import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { BehaviorPolicy, Name, Traits } from "../../ecs/components";
import { addEntity, addComponent } from "bitecs";
import { registerEntity } from "../cognition-system";
import { setAgentBehaviorPolicy, evaluateBehaviorPolicy, clearPolicyEvalHistory, validateBehaviorNode, type BehaviorNode } from "../behavior-policy";
import { setLocatedIn } from "../../ecs/location";
import {
  recordOutcome,
  growMemoryBranch,
  growAffordanceBranch,
  getReinforcementState,
  getTreeSize,
  getGrowthSummary,
  resetLearningState,
} from "../policy-learning";

function makeWorld() {
  const world = createArgosWorld("PolicyLearningTest") as any;
  initializePrefabs(world);
  return world;
}

function makeAgent(world: any, name: string, tree: BehaviorNode) {
  const room = createRoomEntity(world, { name: "TestRoom", description: "A test room" });
  registerEntity(room, "TestRoom");

  const agent = createAgentEntity(world, {
    name,
    role: "test",
    systemPrompt: `You are ${name}.`,
    roomId: room,
  });
  registerEntity(agent, name);
  setAgentBehaviorPolicy(world, agent, tree, true);
  clearPolicyEvalHistory(agent);
  return { agent, room };
}

const SIMPLE_TREE: BehaviorNode = {
  type: "selector",
  children: [
    {
      type: "weighted_random",
      choices: [
        { weight: 3, child: { type: "action", action: { type: "observe" } } },
        { weight: 3, child: { type: "interact_with_trait", trait: "forgeable", affordance: "forge", scope: "room" as const } },
        { weight: 2, child: { type: "action", action: { type: "think", content: "hmm" } } },
        { weight: 2, child: { type: "action", action: { type: "move", target: "Market" } } },
      ],
    },
  ],
};

beforeEach(() => {
  resetLearningState();
});

describe("Reinforcement", () => {
  test("successful actions increase weight in weighted_random", () => {
    const world = makeWorld();
    const { agent } = makeAgent(world, "Smith", SIMPLE_TREE);

    // Record 5 successful forge interactions
    for (let i = 0; i < 5; i++) {
      recordOutcome(world, {
        agentEid: agent,
        action: { type: "interact", target: "Anvil", content: "forge" },
        affordance: "forge",
        target: "Anvil",
        success: true,
      });
    }

    // Parse the mutated tree and check weights
    const raw = BehaviorPolicy.treeJson[agent];
    const tree = JSON.parse(raw);
    const forgeChoice = tree.children[0].choices.find(
      (c: any) => c.child.type === "interact_with_trait" && c.child.affordance === "forge"
    );

    expect(forgeChoice).toBeDefined();
    expect(forgeChoice.weight).toBeGreaterThan(3); // Was 3, should have increased
  });

  test("failed actions decrease weight in weighted_random", () => {
    const world = makeWorld();
    const { agent } = makeAgent(world, "Smith", SIMPLE_TREE);

    // Record 5 failed forge interactions
    for (let i = 0; i < 5; i++) {
      recordOutcome(world, {
        agentEid: agent,
        action: { type: "interact", target: "Anvil", content: "forge" },
        affordance: "forge",
        target: "Anvil",
        success: false,
        detail: "The anvil is broken",
      });
    }

    const raw = BehaviorPolicy.treeJson[agent];
    const tree = JSON.parse(raw);
    const forgeChoice = tree.children[0].choices.find(
      (c: any) => c.child.type === "interact_with_trait" && c.child.affordance === "forge"
    );

    expect(forgeChoice).toBeDefined();
    expect(forgeChoice.weight).toBeLessThan(3); // Was 3, should have decreased
  });

  test("reinforcement state tracks success rate", () => {
    const world = makeWorld();
    const { agent } = makeAgent(world, "Smith", SIMPLE_TREE);

    recordOutcome(world, { agentEid: agent, action: { type: "interact" }, affordance: "forge", success: true, target: "X" });
    recordOutcome(world, { agentEid: agent, action: { type: "interact" }, affordance: "forge", success: true, target: "X" });
    recordOutcome(world, { agentEid: agent, action: { type: "interact" }, affordance: "forge", success: false, target: "X" });

    const state = getReinforcementState(agent);
    expect(state).toBeDefined();
    const entry = state!.get("interact:forge");
    expect(entry).toBeDefined();
    expect(entry!.attempts).toBe(3);
    expect(entry!.successRate).toBeGreaterThan(0.4); // ~2/3 success
    expect(entry!.successRate).toBeLessThan(0.9);
  });

  test("weight stays within bounds", () => {
    const world = makeWorld();
    const { agent } = makeAgent(world, "Smith", SIMPLE_TREE);

    // Lots of failures — weight should not go below MIN_WEIGHT
    for (let i = 0; i < 20; i++) {
      recordOutcome(world, { agentEid: agent, action: { type: "interact" }, affordance: "forge", success: false, target: "X" });
    }

    const raw = BehaviorPolicy.treeJson[agent];
    const tree = JSON.parse(raw);
    const forgeChoice = tree.children[0].choices.find(
      (c: any) => c.child.type === "interact_with_trait" && c.child.affordance === "forge"
    );
    expect(forgeChoice.weight).toBeGreaterThanOrEqual(0.5); // MIN_WEIGHT
  });
});

describe("Memory Branch Growth", () => {
  test("grows a new branch for an important memory", () => {
    const world = makeWorld();
    const { agent } = makeAgent(world, "Smith", SIMPLE_TREE);

    const sizeBefore = getTreeSize(world, agent);

    const grew = growMemoryBranch(
      world, agent, "threat",
      { type: "move", target: "Barracks" }
    );

    expect(grew).toBe(true);
    expect(getTreeSize(world, agent)).toBeGreaterThan(sizeBefore);

    // The tree should now contain a has_memory condition
    const raw = BehaviorPolicy.treeJson[agent];
    expect(raw).toContain("has_memory");
    expect(raw).toContain("threat");
  });

  test("doesn't grow duplicate branches for same keyword", () => {
    const world = makeWorld();
    const { agent } = makeAgent(world, "Smith", SIMPLE_TREE);

    const grew1 = growMemoryBranch(world, agent, "theft", { type: "observe" });
    const grew2 = growMemoryBranch(world, agent, "theft", { type: "observe" });

    expect(grew1).toBe(true);
    expect(grew2).toBe(false); // Duplicate
  });

  test("growth summary tracks memory branches", () => {
    const world = makeWorld();
    const { agent } = makeAgent(world, "Smith", SIMPLE_TREE);

    growMemoryBranch(world, agent, "danger", { type: "move", target: "Safe Room" });
    growMemoryBranch(world, agent, "friend", { type: "speak", content: "hello" });

    const summary = getGrowthSummary(agent);
    expect(summary.knownMemoryBranchCount).toBe(2);
  });
});

describe("Affordance Discovery", () => {
  test("grows an exploration branch for a new affordance", () => {
    const world = makeWorld();
    const { agent } = makeAgent(world, "Smith", SIMPLE_TREE);

    const sizeBefore = getTreeSize(world, agent);

    const grew = growAffordanceBranch(world, agent, "brew_potion", "brewable");

    expect(grew).toBe(true);
    expect(getTreeSize(world, agent)).toBeGreaterThan(sizeBefore);

    const raw = BehaviorPolicy.treeJson[agent];
    expect(raw).toContain("brew_potion");
    expect(raw).toContain("brewable");
  });

  test("doesn't grow duplicate branches for same affordance", () => {
    const world = makeWorld();
    const { agent } = makeAgent(world, "Smith", SIMPLE_TREE);

    const grew1 = growAffordanceBranch(world, agent, "brew_potion", "brewable");
    const grew2 = growAffordanceBranch(world, agent, "brew_potion", "brewable");

    expect(grew1).toBe(true);
    expect(grew2).toBe(false);
  });

  test("growth summary tracks affordances", () => {
    const world = makeWorld();
    const { agent } = makeAgent(world, "Smith", SIMPLE_TREE);

    growAffordanceBranch(world, agent, "brew_potion", "brewable");
    growAffordanceBranch(world, agent, "enchant", "enchantable");

    const summary = getGrowthSummary(agent);
    expect(summary.knownAffordanceCount).toBe(2);
  });
});

describe("Tree Size Limits", () => {
  test("refuses to grow beyond MAX_TREE_NODES", () => {
    const world = makeWorld();
    // Create a tree near the limit (~100 nodes)
    const bigTree: BehaviorNode = {
      type: "selector",
      children: Array.from({ length: 30 }, (_, i) => ({
        type: "sequence" as const,
        children: [
          { type: "condition" as const, op: { type: "chance" as const, p: 0.5 } },
          { type: "action" as const, action: { type: "observe" as const } },
        ],
      })),
    };
    const { agent } = makeAgent(world, "Smith", bigTree);
    const startSize = getTreeSize(world, agent);

    // Try to grow many branches — should be capped before hitting MAX_TREE_NODES
    let grewCount = 0;
    for (let i = 0; i < 40; i++) {
      if (growMemoryBranch(world, agent, `memory${i}`, { type: "observe" })) {
        grewCount++;
      }
    }

    // Some should have grown, but not all
    expect(grewCount).toBeGreaterThan(0);
    expect(grewCount).toBeLessThan(40);
    // Tree shouldn't exceed limit (each branch adds ~3 nodes)
    expect(getTreeSize(world, agent)).toBeLessThanOrEqual(startSize + grewCount * 4);
  });
});

describe("Behavioral: Full Lifecycle", () => {
  test("agent tree evolves over 20 interactions", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Forge", description: "A forge" });
    registerEntity(room, "Forge");

    const anvil = addEntity(world);
    addComponent(world, anvil, Name as any);
    Name.value[anvil] = "Anvil";
    addComponent(world, anvil, Traits as any);
    Traits.active[anvil] = JSON.stringify(["forgeable"]);
    setLocatedIn(world, anvil, room);
    registerEntity(anvil, "Anvil");

    const agent = createAgentEntity(world, {
      name: "Smith", role: "blacksmith", systemPrompt: "Blacksmith.",
      roomId: room,
    });
    registerEntity(agent, "Smith");
    setAgentBehaviorPolicy(world, agent, SIMPLE_TREE, true);
    clearPolicyEvalHistory(agent);

    const sizeBefore = getTreeSize(world, agent);

    // Simulate 10 successful forges + 10 failed forges
    for (let i = 0; i < 10; i++) {
      recordOutcome(world, {
        agentEid: agent,
        action: { type: "interact", target: "Anvil", content: "forge" },
        affordance: "forge",
        target: "Anvil",
        success: true,
      });
    }
    for (let i = 0; i < 10; i++) {
      recordOutcome(world, {
        agentEid: agent,
        action: { type: "observe" },
        success: true, // observe always succeeds
      });
    }

    // Grow a memory branch
    growMemoryBranch(world, agent, "broken anvil", { type: "think", content: "I need to repair the anvil" });

    // Grow an affordance branch
    growAffordanceBranch(world, agent, "quench", "quenchable");

    const sizeAfter = getTreeSize(world, agent);
    const summary = getGrowthSummary(agent);

    // Tree should have grown
    expect(sizeAfter).toBeGreaterThan(sizeBefore);

    // Forge weight should have increased (10 successes)
    const raw = BehaviorPolicy.treeJson[agent];
    const tree = JSON.parse(raw);
    const forgeChoice = tree.children[0].choices?.find(
      (c: any) => c.child?.type === "interact_with_trait" && c.child?.affordance === "forge"
    );
    if (forgeChoice) {
      expect(forgeChoice.weight).toBeGreaterThan(3);
    }

    // Tree should contain new branches
    expect(raw).toContain("broken anvil");
    expect(raw).toContain("quench");

    // Growth summary should track everything
    expect(summary.knownMemoryBranchCount).toBe(1);
    expect(summary.knownAffordanceCount).toBe(1);
    expect(summary.reinforcementEntries).toBeGreaterThan(0);

    // Tree should still validate
    expect(validateBehaviorNode(tree).ok).toBe(true);
  });
});
