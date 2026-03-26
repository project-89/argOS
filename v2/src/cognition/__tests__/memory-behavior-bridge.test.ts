import { addEntity, addComponent, hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Agent, BehaviorPolicy, Memory, Belief, Impression, Name } from "../../ecs/components";
import { HasMemory, HasBelief, HasImpression } from "../../ecs/relations";
import { setLocatedIn } from "../../ecs/location";
import {
  evaluateBehaviorPolicy,
  setAgentBehaviorPolicy,
  validateBehaviorNode,
  type BehaviorNode,
  type ConditionOp,
} from "../behavior-policy";
import { recordAction, clearActionHistory } from "../agent-action-history";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorld() {
  const world = createArgosWorld("MemoryBridgeTest") as any;
  initializePrefabs(world);
  return world;
}

function makeAgent(world: any, name: string, roomId?: number) {
  return createAgentEntity(world, {
    name,
    role: "NPC",
    systemPrompt: `You are ${name}.`,
    roomId,
  });
}

function attachMemory(world: any, agentEid: number, content: string): number {
  const eid = addEntity(world);
  addComponent(world, eid, Memory);
  addComponent(world, agentEid, (HasMemory as any)(eid));
  Memory.type[eid] = "episodic";
  Memory.content[eid] = content;
  Memory.emotionalValence[eid] = 0;
  Memory.importance[eid] = 0.5;
  Memory.timestamp[eid] = Date.now();
  Memory.lastRecalled[eid] = Date.now();
  Memory.recallCount[eid] = 0;
  return eid;
}

function attachBelief(world: any, agentEid: number, subject: string, predicate: string, object: string): number {
  const eid = addEntity(world);
  addComponent(world, eid, Belief);
  addComponent(world, agentEid, (HasBelief as any)(eid));
  Belief.subject[eid] = subject;
  Belief.predicate[eid] = predicate;
  Belief.object[eid] = object;
  Belief.confidence[eid] = 0.8;
  Belief.source[eid] = "observation";
  Belief.timestamp[eid] = Date.now();
  return eid;
}

function attachImpression(world: any, agentEid: number, targetName: string, valence: number): number {
  const eid = addEntity(world);
  addComponent(world, eid, Impression);
  addComponent(world, agentEid, (HasImpression as any)(eid));
  Impression.targetName[eid] = targetName;
  Impression.trait[eid] = "general";
  Impression.valence[eid] = valence;
  Impression.confidence[eid] = 0.7;
  Impression.basis[eid] = "observation";
  return eid;
}

// ---------------------------------------------------------------------------
// Unit tests: has_memory
// ---------------------------------------------------------------------------

describe("has_memory condition", () => {
  test("returns true when agent has a matching memory", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Hall" });
    const agent = makeAgent(world, "Alice", room);
    attachMemory(world, agent, "I was robbed last night in the alley");

    const tree: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "has_memory", includes: "robbed" } },
        { type: "action", action: { type: "speak", content: "I need help!" } },
      ],
    };
    setAgentBehaviorPolicy(world, agent, tree);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
    if (result.kind === "action") {
      expect(result.action.type).toBe("speak");
    }
  });

  test("returns false when no matching memory", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Hall" });
    const agent = makeAgent(world, "Bob", room);
    attachMemory(world, agent, "Had a nice dinner with friends");

    const tree: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "has_memory", includes: "robbed" } },
        { type: "action", action: { type: "speak", content: "Help!" } },
      ],
    };
    setAgentBehaviorPolicy(world, agent, tree);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("none");
  });

  test("is case-insensitive", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Hall" });
    const agent = makeAgent(world, "Carol", room);
    attachMemory(world, agent, "The DRAGON was terrifying");

    const tree: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "has_memory", includes: "dragon" } },
        { type: "action", action: { type: "think", content: "dragons..." } },
      ],
    };
    setAgentBehaviorPolicy(world, agent, tree);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
  });
});

// ---------------------------------------------------------------------------
// Unit tests: has_belief
// ---------------------------------------------------------------------------

describe("has_belief condition", () => {
  test("returns true when belief subject+predicate+object matches", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Square" });
    const agent = makeAgent(world, "Dave", room);
    attachBelief(world, agent, "The King", "is", "corrupt");

    const tree: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "has_belief", includes: "corrupt" } },
        { type: "action", action: { type: "speak", content: "Down with the king!" } },
      ],
    };
    setAgentBehaviorPolicy(world, agent, tree);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
  });

  test("returns false with no matching belief", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Square" });
    const agent = makeAgent(world, "Eve", room);
    attachBelief(world, agent, "The weather", "is", "nice");

    const tree: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "has_belief", includes: "corrupt" } },
        { type: "action", action: { type: "speak" } },
      ],
    };
    setAgentBehaviorPolicy(world, agent, tree);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("none");
  });

  test("matches across subject+predicate+object concatenation", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Library" });
    const agent = makeAgent(world, "Fay", room);
    attachBelief(world, agent, "Goblins", "are", "dangerous");

    const tree: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "has_belief", includes: "goblins" } },
        { type: "action", action: { type: "think", content: "careful..." } },
      ],
    };
    setAgentBehaviorPolicy(world, agent, tree);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
  });
});

// ---------------------------------------------------------------------------
// Unit tests: impression_above / impression_below
// ---------------------------------------------------------------------------

describe("impression_above condition", () => {
  test("returns true when impression valence >= threshold", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Tavern" });
    const agent = makeAgent(world, "Greg", room);
    attachImpression(world, agent, "Hilda", 0.8);

    const tree: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "impression_above", targetName: "Hilda", threshold: 0.5 } },
        { type: "action", action: { type: "speak", target: "Hilda", content: "Hello friend!" } },
      ],
    };
    setAgentBehaviorPolicy(world, agent, tree);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
  });

  test("returns false when impression valence < threshold", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Tavern" });
    const agent = makeAgent(world, "Ivy", room);
    attachImpression(world, agent, "Jack", 0.2);

    const tree: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "impression_above", targetName: "Jack", threshold: 0.5 } },
        { type: "action", action: { type: "speak", target: "Jack" } },
      ],
    };
    setAgentBehaviorPolicy(world, agent, tree);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("none");
  });

  test("returns false when no impression exists for target", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Tavern" });
    const agent = makeAgent(world, "Kay", room);
    // No impressions attached

    const tree: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "impression_above", targetName: "Nobody", threshold: 0 } },
        { type: "action", action: { type: "speak" } },
      ],
    };
    setAgentBehaviorPolicy(world, agent, tree);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("none");
  });
});

describe("impression_below condition", () => {
  test("returns true when impression valence <= threshold", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Gate" });
    const agent = makeAgent(world, "Leo", room);
    attachImpression(world, agent, "Mordred", -0.5);

    const tree: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "impression_below", targetName: "Mordred", threshold: 0 } },
        { type: "action", action: { type: "think", content: "I don't trust Mordred" } },
      ],
    };
    setAgentBehaviorPolicy(world, agent, tree);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
  });

  test("returns false when valence > threshold", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Gate" });
    const agent = makeAgent(world, "Mia", room);
    attachImpression(world, agent, "Nina", 0.9);

    const tree: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "impression_below", targetName: "Nina", threshold: 0 } },
        { type: "action", action: { type: "think" } },
      ],
    };
    setAgentBehaviorPolicy(world, agent, tree);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// Unit tests: last_n_actions_include / last_n_actions_exclude
// ---------------------------------------------------------------------------

describe("last_n_actions_include condition", () => {
  beforeEach(() => clearActionHistory());

  test("returns true when action type found in last N", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Camp" });
    const agent = makeAgent(world, "Olga", room);

    recordAction(agent, "observe");
    recordAction(agent, "interact");
    recordAction(agent, "speak");

    const tree: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "last_n_actions_include", n: 3, actionType: "observe" } },
        { type: "action", action: { type: "think", content: "I already observed" } },
      ],
    };
    setAgentBehaviorPolicy(world, agent, tree);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
  });

  test("returns false when action type not in last N", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Camp" });
    const agent = makeAgent(world, "Pete", room);

    recordAction(agent, "interact");
    recordAction(agent, "speak");
    recordAction(agent, "move");

    const tree: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "last_n_actions_include", n: 3, actionType: "observe" } },
        { type: "action", action: { type: "think" } },
      ],
    };
    setAgentBehaviorPolicy(world, agent, tree);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("none");
  });
});

describe("last_n_actions_exclude condition", () => {
  beforeEach(() => clearActionHistory());

  test("returns true when action type NOT in last N", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Garden" });
    const agent = makeAgent(world, "Quinn", room);

    recordAction(agent, "interact");
    recordAction(agent, "speak");
    recordAction(agent, "move");

    const tree: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "last_n_actions_exclude", n: 5, actionType: "observe" } },
        { type: "action", action: { type: "observe" } },
      ],
    };
    setAgentBehaviorPolicy(world, agent, tree);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
    if (result.kind === "action") {
      expect(result.action.type).toBe("observe");
    }
  });

  test("returns false when action type IS in last N", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Garden" });
    const agent = makeAgent(world, "Rosa", room);

    recordAction(agent, "observe");
    recordAction(agent, "speak");
    recordAction(agent, "interact");

    const tree: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "last_n_actions_exclude", n: 5, actionType: "observe" } },
        { type: "action", action: { type: "observe" } },
      ],
    };
    setAgentBehaviorPolicy(world, agent, tree);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// Validation tests
// ---------------------------------------------------------------------------

describe("validateBehaviorNode for new condition types", () => {
  test("accepts has_memory condition", () => {
    const node: BehaviorNode = {
      type: "condition",
      op: { type: "has_memory", includes: "robbed" },
    };
    expect(validateBehaviorNode(node)).toEqual({ ok: true });
  });

  test("accepts has_belief condition", () => {
    const node: BehaviorNode = {
      type: "condition",
      op: { type: "has_belief", includes: "corrupt" },
    };
    expect(validateBehaviorNode(node)).toEqual({ ok: true });
  });

  test("accepts impression_above condition", () => {
    const node: BehaviorNode = {
      type: "condition",
      op: { type: "impression_above", targetName: "Alice", threshold: 0.5 },
    };
    expect(validateBehaviorNode(node)).toEqual({ ok: true });
  });

  test("accepts impression_below condition", () => {
    const node: BehaviorNode = {
      type: "condition",
      op: { type: "impression_below", targetName: "Bob", threshold: -0.3 },
    };
    expect(validateBehaviorNode(node)).toEqual({ ok: true });
  });

  test("accepts last_n_actions_include condition", () => {
    const node: BehaviorNode = {
      type: "condition",
      op: { type: "last_n_actions_include", n: 5, actionType: "observe" },
    };
    expect(validateBehaviorNode(node)).toEqual({ ok: true });
  });

  test("accepts last_n_actions_exclude condition", () => {
    const node: BehaviorNode = {
      type: "condition",
      op: { type: "last_n_actions_exclude", n: 3, actionType: "speak" },
    };
    expect(validateBehaviorNode(node)).toEqual({ ok: true });
  });

  test("rejects has_memory with empty includes", () => {
    const result = validateBehaviorNode({
      type: "condition",
      op: { type: "has_memory", includes: "" },
    });
    expect(result).toEqual({ ok: false, error: "has_memory.includes required" });
  });

  test("rejects impression_above with missing targetName", () => {
    const result = validateBehaviorNode({
      type: "condition",
      op: { type: "impression_above", targetName: "", threshold: 0.5 },
    });
    expect(result).toEqual({ ok: false, error: "impression_above.targetName required" });
  });

  test("rejects impression_below with non-finite threshold", () => {
    const result = validateBehaviorNode({
      type: "condition",
      op: { type: "impression_below", targetName: "X", threshold: NaN },
    });
    expect(result).toEqual({ ok: false, error: "impression_below.threshold must be a finite number" });
  });

  test("rejects last_n_actions_include with n=0", () => {
    const result = validateBehaviorNode({
      type: "condition",
      op: { type: "last_n_actions_include", n: 0, actionType: "observe" },
    });
    expect(result).toEqual({ ok: false, error: "last_n_actions_include.n must be a number 1..100" });
  });

  test("rejects last_n_actions_exclude with empty actionType", () => {
    const result = validateBehaviorNode({
      type: "condition",
      op: { type: "last_n_actions_exclude", n: 5, actionType: "" },
    });
    expect(result).toEqual({ ok: false, error: "last_n_actions_exclude.actionType required" });
  });
});

// ---------------------------------------------------------------------------
// Behavioral tests: full behavior tree scenarios
// ---------------------------------------------------------------------------

describe("behavioral: memory-driven branching", () => {
  test("agent with 'was robbed' memory reports to guard; agent without does routine", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Town Square" });
    const victim = makeAgent(world, "Victim", room);
    const bystander = makeAgent(world, "Bystander", room);

    attachMemory(world, victim, "I was robbed in the alley by a masked figure");

    const tree: BehaviorNode = {
      type: "selector",
      children: [
        {
          type: "sequence",
          children: [
            { type: "condition", op: { type: "has_memory", includes: "robbed" } },
            { type: "action", action: { type: "speak", content: "Guard! I was robbed!" } },
          ],
        },
        { type: "action", action: { type: "observe" } },
      ],
    };

    setAgentBehaviorPolicy(world, victim, tree);
    setAgentBehaviorPolicy(world, bystander, tree);

    const victimResult = evaluateBehaviorPolicy(world, victim);
    expect(victimResult.kind).toBe("action");
    if (victimResult.kind === "action") {
      expect(victimResult.action.type).toBe("speak");
      expect(victimResult.action.content).toBe("Guard! I was robbed!");
    }

    const bystanderResult = evaluateBehaviorPolicy(world, bystander);
    expect(bystanderResult.kind).toBe("action");
    if (bystanderResult.kind === "action") {
      expect(bystanderResult.action.type).toBe("observe");
    }
  });
});

describe("behavioral: impression-driven social decisions", () => {
  test("agent only speaks to NPCs with positive impression", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Market" });
    const agent = makeAgent(world, "Shopper", room);

    attachImpression(world, agent, "Friendly Vendor", 0.7);
    attachImpression(world, agent, "Rude Vendor", -0.4);

    // Tree: speak to Friendly Vendor if impression > 0, else think about avoiding
    const tree: BehaviorNode = {
      type: "selector",
      children: [
        {
          type: "sequence",
          children: [
            { type: "condition", op: { type: "impression_above", targetName: "Friendly Vendor", threshold: 0.3 } },
            { type: "action", action: { type: "speak", target: "Friendly Vendor", content: "Nice to see you!" } },
          ],
        },
        { type: "action", action: { type: "think", content: "better avoid some folks" } },
      ],
    };
    setAgentBehaviorPolicy(world, agent, tree);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
    if (result.kind === "action") {
      expect(result.action.type).toBe("speak");
      expect(result.action.target).toBe("Friendly Vendor");
    }

    // Swap tree to check Rude Vendor: should fall through
    const tree2: BehaviorNode = {
      type: "selector",
      children: [
        {
          type: "sequence",
          children: [
            { type: "condition", op: { type: "impression_above", targetName: "Rude Vendor", threshold: 0.3 } },
            { type: "action", action: { type: "speak", target: "Rude Vendor" } },
          ],
        },
        { type: "action", action: { type: "think", content: "avoid the rude one" } },
      ],
    };
    setAgentBehaviorPolicy(world, agent, tree2);

    const result2 = evaluateBehaviorPolicy(world, agent);
    expect(result2.kind).toBe("action");
    if (result2.kind === "action") {
      expect(result2.action.type).toBe("think");
    }
  });
});

describe("behavioral: action variety via last_n_actions_exclude", () => {
  beforeEach(() => clearActionHistory());

  test("if agent hasn't observed in last 5 actions, observe; otherwise interact", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Workshop" });
    const agent = makeAgent(world, "Worker", room);

    // Simulate 5 non-observe actions
    recordAction(agent, "interact");
    recordAction(agent, "speak");
    recordAction(agent, "move");
    recordAction(agent, "interact");
    recordAction(agent, "think");

    const tree: BehaviorNode = {
      type: "selector",
      children: [
        {
          type: "sequence",
          children: [
            { type: "condition", op: { type: "last_n_actions_exclude", n: 5, actionType: "observe" } },
            { type: "action", action: { type: "observe" } },
          ],
        },
        { type: "action", action: { type: "interact", target: "Anvil", content: "hammer" } },
      ],
    };
    setAgentBehaviorPolicy(world, agent, tree);

    // Should observe since no observe in last 5
    const result1 = evaluateBehaviorPolicy(world, agent);
    expect(result1.kind).toBe("action");
    if (result1.kind === "action") {
      expect(result1.action.type).toBe("observe");
    }

    // Now record an observe
    recordAction(agent, "observe");

    // Should fall through to interact since observe IS in last 5
    const result2 = evaluateBehaviorPolicy(world, agent);
    expect(result2.kind).toBe("action");
    if (result2.kind === "action") {
      expect(result2.action.type).toBe("interact");
    }
  });
});
