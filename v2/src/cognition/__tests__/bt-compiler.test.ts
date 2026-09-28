import "dotenv/config";
import { jest } from "@jest/globals";

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
import { worldSchema } from "../../world/schema";
import { clearActionHistory, recordAction } from "../agent-action-history";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { deserializeWorld, serializeWorld } from "../../persistence/world-persistence";

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
  clearActionHistory();
});

afterEach(() => jest.useRealTimers());

describe("BT Compiler: Capture + Resolve", () => {
  test("successful LLM decision gets compiled into BT branch", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Tavern", description: "A tavern" });
    registerEntity(room, "Tavern");
    const agent = createAgentEntity(world, { name: "Smith", role: "blacksmith", systemPrompt: "Blacksmith.", roomId: room });
    registerEntity(agent, "Smith");
    setAgentBehaviorPolicy(world, agent, BASE_TREE, true);

    captureLLMDecision(world, agent, "I should inspect my surroundings",
      { type: "observe" });

    // Resolve as success
    resolveDecision(world, agent, true);

    // Tree should have grown
    const raw = BehaviorPolicy.treeJson[agent];
    expect(raw).toContain("observe");

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
    captureLLMDecision(world, agent, "look", { type: "observe" });
    resolveDecision(world, agent, true);

    captureLLMDecision(world, agent, "look again", { type: "observe" });
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

  test("compiled interactions use a schema trait, not a guessed affordance name", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Forge", description: "A forge" });
    const anvil = addEntity(world);
    addComponent(world, anvil, Name); Name.value[anvil] = "Proof Anvil";
    addComponent(world, anvil, Traits); Traits.active[anvil] = JSON.stringify(["proof_forgeable"]);
    setLocatedIn(world, anvil, room);
    worldSchema.defineAffordance({
      name: "proof_forge",
      requires: ["proof_forgeable"],
      descriptionTemplate: "{actor.name} forges.",
      effects: [],
    });
    const agent = createAgentEntity(world, { name: "Smith", role: "blacksmith", systemPrompt: "Blacksmith.", roomId: room });
    setAgentBehaviorPolicy(world, agent, BASE_TREE, true);

    captureLLMDecision(world, agent, "Forge the steel",
      { type: "interact", target: "Proof Anvil", content: "proof_forge steel" }, "proof_forge");
    resolveDecision(world, agent, true);

    const raw = BehaviorPolicy.treeJson[agent];
    expect(raw).toContain('"trait":"proof_forgeable"');
    expect(raw).toContain('"args":"steel"');
    expect(raw).not.toContain('"trait":"proof_forge"');
  });

  test("successful dialogue is not compiled into a context-free literal reply", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Tavern", description: "A tavern" });
    registerEntity(room, "Tavern");
    const other = createAgentEntity(world, { name: "Other", role: "npc", systemPrompt: "NPC.", roomId: room });
    registerEntity(other, "Other");
    const agent = createAgentEntity(world, { name: "Greta", role: "innkeeper", systemPrompt: "Innkeeper.", roomId: room });
    registerEntity(agent, "Greta");
    setAgentBehaviorPolicy(world, agent, BASE_TREE, true);
    const before = BehaviorPolicy.treeJson[agent];

    captureLLMDecision(world, agent, "I should greet the newcomer",
      { type: "speak", target: "Other", content: "Welcome!" });
    resolveDecision(world, agent, true);

    const raw = BehaviorPolicy.treeJson[agent];
    expect(raw).toBe(before);
    expect(getCompilationStats(agent, world)).toMatchObject({ compiledBranches: 0, pendingDecision: false });
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
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
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

    // A fresh branch gets a durable grace period; it is stale only after the age window.
    expect(pruneStaleBranches(world, agent)).toBe(0);
    jest.setSystemTime(10 * 60 * 1000 + 1_001);
    const removed = pruneStaleBranches(world, agent);
    expect(removed).toBeGreaterThan(0);

    const tree = JSON.parse(BehaviorPolicy.treeJson[agent]);
    expect(validateBehaviorNode(tree).ok).toBe(true);
  });

  test("rebuilds duplicate/pruning state from the persisted tree", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    const agent = createAgentEntity(world, { name: "Agent", role: "test", systemPrompt: "Test.", roomId: room });
    setAgentBehaviorPolicy(world, agent, BASE_TREE, true);
    captureLLMDecision(world, agent, "Look carefully", { type: "observe" });
    resolveDecision(world, agent, true);
    const before = BehaviorPolicy.treeJson[agent];

    resetCompilerState(); // Simulate a fresh process around durable ECS state.
    expect(getCompilationStats(agent, world).compiledBranches).toBe(1);
    captureLLMDecision(world, agent, "Look carefully again", { type: "observe" });
    resolveDecision(world, agent, true);
    expect(BehaviorPolicy.treeJson[agent]).toBe(before);
  });

  test("compiled branch metadata survives world serialization", () => {
    const source = makeWorld();
    const room = createRoomEntity(source, { name: "Room" });
    const agent = createAgentEntity(source, { name: "Agent", role: "test", systemPrompt: "Test.", roomId: room });
    setAgentBehaviorPolicy(source, agent, BASE_TREE, true);
    captureLLMDecision(source, agent, "Look carefully", { type: "observe" });
    resolveDecision(source, agent, true);
    const saved = serializeWorld(source, createSystemRegistry());

    resetCompilerState();
    const restored = makeWorld();
    const ids = deserializeWorld(restored, createSystemRegistry(), saved).oldToNewId;
    const restoredAgent = ids.get(agent)!;
    expect(getCompilationStats(restoredAgent, restored)).toMatchObject({ compiledBranches: 1, pendingDecision: false });
    expect(BehaviorPolicy.treeJson[restoredAgent]).toContain("_compiledAt");
  });

  test("pending decisions with the same EID stay isolated by world", () => {
    const worldA = makeWorld(); const roomA = createRoomEntity(worldA, { name: "A" });
    const actorA = createAgentEntity(worldA, { name: "A", role: "test", systemPrompt: "A", roomId: roomA });
    setAgentBehaviorPolicy(worldA, actorA, BASE_TREE, true);
    const worldB = makeWorld(); const roomB = createRoomEntity(worldB, { name: "B" });
    const actorB = createAgentEntity(worldB, { name: "B", role: "test", systemPrompt: "B", roomId: roomB });
    setAgentBehaviorPolicy(worldB, actorB, BASE_TREE, true);
    expect(actorB).toBe(actorA);

    captureLLMDecision(worldA, actorA, "Observe A", { type: "observe" });
    captureLLMDecision(worldB, actorB, "Speak B", { type: "speak", content: "B" });
    resolveDecision(worldA, actorA, true);
    expect(getCompilationStats(actorA, worldA).pendingDecision).toBe(false);
    expect(getCompilationStats(actorB, worldB).pendingDecision).toBe(true);
    resolveDecision(worldB, actorB, false);
    expect(getCompilationStats(actorB, worldB).pendingDecision).toBe(false);
  });

  test("anti-repetition history with the same EID stays isolated by world", () => {
    const worldA = makeWorld(); const roomA = createRoomEntity(worldA, { name: "A" });
    const actorA = createAgentEntity(worldA, { name: "A", role: "test", systemPrompt: "A", roomId: roomA });
    const worldB = makeWorld(); const roomB = createRoomEntity(worldB, { name: "B" });
    const actorB = createAgentEntity(worldB, { name: "B", role: "test", systemPrompt: "B", roomId: roomB });
    expect(actorB).toBe(actorA);
    const policy: BehaviorNode = { type: "sequence", children: [
      { type: "condition", op: { type: "last_n_actions_exclude", n: 3, actionType: "observe" } },
      { type: "action", action: { type: "think", content: "Fresh" } },
    ] };
    setAgentBehaviorPolicy(worldA, actorA, policy, true);
    setAgentBehaviorPolicy(worldB, actorB, policy, true);
    recordAction(actorA, "observe", worldA);

    expect(evaluateBehaviorPolicy(worldA, actorA).kind).toBe("none");
    expect(evaluateBehaviorPolicy(worldB, actorB)).toMatchObject({ kind: "action", action: { type: "think" } });
  });

  test("legacy unscoped history is adopted once rather than leaking across worlds", () => {
    const worldA = makeWorld(); const roomA = createRoomEntity(worldA, { name: "A" });
    const actorA = createAgentEntity(worldA, { name: "A", role: "test", systemPrompt: "A", roomId: roomA });
    const worldB = makeWorld(); const roomB = createRoomEntity(worldB, { name: "B" });
    const actorB = createAgentEntity(worldB, { name: "B", role: "test", systemPrompt: "B", roomId: roomB });
    expect(actorB).toBe(actorA);
    const policy: BehaviorNode = { type: "sequence", children: [
      { type: "condition", op: { type: "last_n_actions_exclude", n: 3, actionType: "observe" } },
      { type: "action", action: { type: "think", content: "Fresh" } },
    ] };
    setAgentBehaviorPolicy(worldA, actorA, policy, true);
    setAgentBehaviorPolicy(worldB, actorB, policy, true);

    // Original public API: no world argument. The first explicit consumer owns
    // the staged history; a second world reusing the EID must remain clean.
    recordAction(actorA, "observe");
    expect(evaluateBehaviorPolicy(worldA, actorA).kind).toBe("none");
    expect(evaluateBehaviorPolicy(worldB, actorB)).toMatchObject({ kind: "action", action: { type: "think" } });
  });
});

describe("BT Compiler: Compiled branches are evaluable", () => {
  test("selector and sequence propagate a procedure request", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room" });
    const agent = createAgentEntity(world, { name: "Agent", role: "test", systemPrompt: "Test.", roomId: room });
    setAgentBehaviorPolicy(world, agent, {
      type: "selector",
      children: [{ type: "sequence", children: [
        { type: "condition", op: { type: "always" } },
        { type: "use_procedure", signature: "goalid:proof|123", minSuccesses: 1 },
      ] }],
    }, true);
    expect(evaluateBehaviorPolicy(world, agent)).toMatchObject({
      kind: "start_procedure", signature: "goalid:proof|123", minSuccesses: 1,
    });
  });

  test("a compiled branch firing writes a durable watermark", () => {
    jest.useFakeTimers(); jest.setSystemTime(10_000);
    const world = makeWorld();
    const tavern = createRoomEntity(world, { name: "Tavern" });
    const forge = createRoomEntity(world, { name: "Forge" });
    const agent = createAgentEntity(world, { name: "Smith", role: "test", systemPrompt: "Test.", roomId: tavern });
    setAgentBehaviorPolicy(world, agent, BASE_TREE, true);
    captureLLMDecision(world, agent, "Go forge", { type: "move", target: "Forge" });
    resolveDecision(world, agent, true);
    const tree = JSON.parse(BehaviorPolicy.treeJson[agent]);
    const branch = tree.children.find((child: any) => child._compiled);
    const chance = branch.children.find((child: any) => child.op?.type === "chance");
    chance.op.p = 1;
    BehaviorPolicy.treeJson[agent] = JSON.stringify(tree);

    expect(evaluateBehaviorPolicy(world, agent)).toMatchObject({ kind: "action", action: { type: "move", target: "Forge" } });
    const persisted = JSON.parse(BehaviorPolicy.treeJson[agent]).children.find((child: any) => child._compiled);
    expect(persisted._lastFiredAt).toBe(10_000);
  });

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
