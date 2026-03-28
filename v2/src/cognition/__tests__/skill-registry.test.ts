import "dotenv/config";

import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Name, Traits } from "../../ecs/components";
import { addEntity, addComponent } from "bitecs";
import { registerEntity } from "../cognition-system";
import { setAgentBehaviorPolicy, evaluateBehaviorPolicy, clearPolicyEvalHistory, validateBehaviorNode, type BehaviorNode } from "../behavior-policy";
import { setLocatedIn } from "../../ecs/location";
import {
  registerSkill,
  getSkill,
  getSkillTree,
  listSkills,
  hasSkill,
  upsertSkill,
  compileSequenceToSkill,
  recordSkillOutcome,
  getSkillSuccessRate,
  resetSkillRegistry,
} from "../skill-registry";
import { resetCompilerState } from "../bt-compiler";
import { resetLearningState } from "../policy-learning";

function makeWorld() {
  const world = createArgosWorld("SkillTest") as any;
  initializePrefabs(world);
  return world;
}

beforeEach(() => {
  resetSkillRegistry();
  resetCompilerState();
  resetLearningState();
});

describe("Skill Registry", () => {
  test("builtin skills are registered on init", () => {
    expect(hasSkill("explore")).toBe(true);
    expect(hasSkill("socialize")).toBe(true);
    expect(hasSkill("rest")).toBe(true);
    expect(hasSkill("reflect")).toBe(true);
  });

  test("can register a custom skill", () => {
    const registered = registerSkill({
      name: "forge_sword",
      description: "Multi-step sword forging",
      origin: "generated",
      tree: {
        type: "sequence",
        children: [
          { type: "action", action: { type: "interact", target: "Anvil", content: "forge" } },
          { type: "action", action: { type: "interact", target: "Bucket", content: "quench" } },
        ],
      },
    });

    expect(registered).toBe(true);
    expect(hasSkill("forge_sword")).toBe(true);
    expect(getSkill("forge_sword")?.description).toBe("Multi-step sword forging");
  });

  test("won't register duplicate skill names", () => {
    registerSkill({ name: "test", description: "1", origin: "builtin", tree: { type: "noop" } });
    const duplicate = registerSkill({ name: "test", description: "2", origin: "builtin", tree: { type: "noop" } });
    expect(duplicate).toBe(false);
  });

  test("upsertSkill overwrites existing", () => {
    registerSkill({ name: "evolving", description: "v1", origin: "learned", tree: { type: "noop" } });
    upsertSkill({ name: "evolving", description: "v2", origin: "learned", tree: { type: "action", action: { type: "observe" } } });

    expect(getSkill("evolving")?.description).toBe("v2");
  });

  test("tracks success rate", () => {
    registerSkill({ name: "tracked", description: "test", origin: "builtin", tree: { type: "noop" } });

    recordSkillOutcome("tracked", true);
    recordSkillOutcome("tracked", true);
    recordSkillOutcome("tracked", false);

    expect(getSkillSuccessRate("tracked")).toBeCloseTo(2 / 3);
  });

  test("listSkills returns all skills", () => {
    const all = listSkills();
    expect(all.length).toBeGreaterThanOrEqual(4); // At least the builtins
    expect(all.some(s => s.name === "explore")).toBe(true);
  });
});

describe("Skill Node Evaluation", () => {
  test("skill node evaluates the referenced sub-tree", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    registerEntity(room, "Room");
    const agent = createAgentEntity(world, { name: "Agent", role: "test", systemPrompt: "Test.", roomId: room });
    registerEntity(agent, "Agent");

    // Register a simple skill
    registerSkill({
      name: "greet",
      description: "Say hello",
      origin: "builtin",
      tree: { type: "action", action: { type: "speak", content: "Hello!" } },
    });

    // Create a BT that references the skill
    const tree: BehaviorNode = {
      type: "selector",
      children: [
        { type: "skill", name: "greet" },
      ],
    };

    setAgentBehaviorPolicy(world, agent, tree, true);
    clearPolicyEvalHistory(agent);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
    if (result.kind === "action") {
      expect(result.action.type).toBe("speak");
      expect(result.action.content).toBe("Hello!");
    }
  });

  test("skill node returns none if skill not found", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    registerEntity(room, "Room");
    const agent = createAgentEntity(world, { name: "Agent", role: "test", systemPrompt: "Test.", roomId: room });
    registerEntity(agent, "Agent");

    const tree: BehaviorNode = {
      type: "selector",
      children: [
        { type: "skill", name: "nonexistent_skill" },
        { type: "action", action: { type: "observe" } }, // fallback
      ],
    };

    setAgentBehaviorPolicy(world, agent, tree, true);
    clearPolicyEvalHistory(agent);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
    if (result.kind === "action") {
      expect(result.action.type).toBe("observe"); // Fell through to fallback
    }
  });

  test("llm_skill node returns llm_fallback", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    registerEntity(room, "Room");
    const agent = createAgentEntity(world, { name: "Agent", role: "test", systemPrompt: "Test.", roomId: room });
    registerEntity(agent, "Agent");

    const tree: BehaviorNode = {
      type: "selector",
      children: [
        { type: "llm_skill", purpose: "have a conversation" },
      ],
    };

    setAgentBehaviorPolicy(world, agent, tree, true);
    clearPolicyEvalHistory(agent);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("llm_fallback");
  });

  test("skill validates correctly", () => {
    expect(validateBehaviorNode({ type: "skill", name: "explore" }).ok).toBe(true);
    expect(validateBehaviorNode({ type: "skill", name: "" }).ok).toBe(false);
    expect(validateBehaviorNode({ type: "llm_skill", purpose: "negotiate" }).ok).toBe(true);
    expect(validateBehaviorNode({ type: "llm_skill", purpose: "" }).ok).toBe(false);
  });
});

describe("Skill Composition", () => {
  test("skills can reference other skills (composition)", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Forge", description: "A forge" });
    registerEntity(room, "Forge");
    const agent = createAgentEntity(world, { name: "Smith", role: "blacksmith", systemPrompt: "Smith.", roomId: room });
    registerEntity(agent, "Smith");

    // Register a "warmup" skill
    registerSkill({
      name: "warmup",
      description: "Warm up before work",
      origin: "builtin",
      tree: { type: "action", action: { type: "observe" } },
    });

    // Register a "work" skill that uses warmup first
    registerSkill({
      name: "forge_session",
      description: "A forging session — warmup then work",
      origin: "generated",
      tree: {
        type: "selector",
        children: [
          { type: "skill", name: "warmup" },
        ],
      },
    });

    // Agent's BT references the composite skill
    const tree: BehaviorNode = {
      type: "selector",
      children: [
        { type: "skill", name: "forge_session" },
      ],
    };

    setAgentBehaviorPolicy(world, agent, tree, true);
    clearPolicyEvalHistory(agent);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
    if (result.kind === "action") {
      expect(result.action.type).toBe("observe"); // From warmup skill
    }
  });
});

describe("Sequence-to-Skill Compilation", () => {
  test("compileSequenceToSkill creates a valid skill", () => {
    const compiled = compileSequenceToSkill(
      "forge_and_quench",
      "Forge then quench",
      [
        { type: "interact", affordance: "forge_weapon", trait: "forgeable" },
        { type: "interact", affordance: "quench", trait: "quenchable" },
      ],
    );

    expect(compiled).toBe(true);
    const skill = getSkill("forge_and_quench");
    expect(skill).toBeDefined();
    expect(skill!.origin).toBe("compiled");
    expect(validateBehaviorNode(skill!.tree).ok).toBe(true);
  });

  // trackActionForSkill removed — skills now only compile from goal completion
  // See goal-learning.ts onGoalCompleted()
});
