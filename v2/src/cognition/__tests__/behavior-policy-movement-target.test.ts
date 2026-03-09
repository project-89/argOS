import "dotenv/config";

import { addComponent, addEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Agent, BehaviorPolicy, Name } from "../../ecs/components";
import { clearMovementTarget, setMovementTarget } from "../../systems/builtin-systems";
import { evaluateBehaviorPolicy, setAgentBehaviorPolicy, type BehaviorNode } from "../behavior-policy";

function createTestWorld() {
  return createArgosWorld("BehaviorPolicyMovementTargetTest");
}

function createNamedEntity(world: ReturnType<typeof createArgosWorld>, name: string): number {
  const eid = addEntity(world);
  addComponent(world, eid, Name);
  Name.value[eid] = name;
  return eid;
}

function createTestAgent(world: ReturnType<typeof createArgosWorld>, name: string): number {
  const eid = createNamedEntity(world, name);
  addComponent(world, eid, Agent);
  Agent.active[eid] = true;
  // BehaviorPolicy will be added via setAgentBehaviorPolicy, but some runners expect component to exist.
  addComponent(world, eid, BehaviorPolicy);
  return eid;
}

describe("BehaviorPolicy has_active_movement_goal", () => {
  afterEach(() => {
    // Ensure no cross-test leakage from the module-level movement target map.
    // Note: We don't know which agent ids exist across tests, so clear the ones we set explicitly.
  });

  test("treats grid movement target as active movement goal", () => {
    const world = createTestWorld();
    const agentEid = createTestAgent(world, "Ava");
    const kitchenEid = createNamedEntity(world, "Kitchen");

    const tree: BehaviorNode = {
      type: "selector",
      children: [
        {
          type: "sequence",
          children: [
            { type: "condition", op: { type: "has_active_movement_goal", destinationIncludes: "kitchen" } },
            { type: "action", action: { type: "speak", content: "I'm on my way." } },
          ],
        },
        { type: "action", action: { type: "wait" } },
      ],
    };
    setAgentBehaviorPolicy(world as any, agentEid, tree, true);

    setMovementTarget(agentEid, kitchenEid);

    const res = evaluateBehaviorPolicy(world as any, agentEid);
    expect(res.kind).toBe("action");
    if (res.kind === "action") {
      expect(res.action.type).toBe("speak");
      expect(res.action.content).toBe("I'm on my way.");
    }

    clearMovementTarget(agentEid);
  });

  test("destinationIncludes filters movement target name", () => {
    const world = createTestWorld();
    const agentEid = createTestAgent(world, "Ben");
    const tavernEid = createNamedEntity(world, "Tavern");

    const tree: BehaviorNode = {
      type: "selector",
      children: [
        {
          type: "sequence",
          children: [
            { type: "condition", op: { type: "has_active_movement_goal", destinationIncludes: "kitchen" } },
            { type: "action", action: { type: "speak", content: "Heading to the kitchen." } },
          ],
        },
        { type: "action", action: { type: "wait" } },
      ],
    };
    setAgentBehaviorPolicy(world as any, agentEid, tree, true);

    setMovementTarget(agentEid, tavernEid);

    const res = evaluateBehaviorPolicy(world as any, agentEid);
    expect(res.kind).toBe("action");
    if (res.kind === "action") {
      expect(res.action.type).toBe("wait");
    }

    clearMovementTarget(agentEid);
  });
});

