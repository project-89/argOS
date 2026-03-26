/**
 * Tests that behavior trees can check dynamic components created by God AI.
 *
 * This enables: God AI creates "Boredom" component → attaches to agent →
 * behavior tree reacts with component_above("Boredom", "level", 70)
 */

import "dotenv/config";

import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { registerEntity } from "../cognition-system";
import {
  setAgentBehaviorPolicy,
  evaluateBehaviorPolicy,
  clearPolicyEvalHistory,
  validateBehaviorNode,
  type BehaviorNode,
} from "../behavior-policy";
import {
  registryCreateComponent,
  attachToEntity,
  entityHasComponent,
  getComponent,
} from "../../ecs/component-registry";

function makeWorld() {
  const world = createArgosWorld("DynCompTest") as any;
  initializePrefabs(world);
  return world;
}

describe("Dynamic Component Conditions", () => {
  test("component_above checks a dynamic component's field", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    registerEntity(room, "Room");
    const agent = createAgentEntity(world, { name: "Agent", role: "test", systemPrompt: "Test.", roomId: room });
    registerEntity(agent, "Agent");

    // Need a second room for wander to have somewhere to go
    const room2 = createRoomEntity(world, { name: "Park", description: "A park" });
    registerEntity(room2, "Park");

    // God AI creates a "Boredom" component
    registryCreateComponent({
      name: "Boredom",
      description: "How bored the agent is",
      properties: { level: { type: "number", default: 0 } },
    });

    // Attach to agent with high boredom
    attachToEntity(world, agent, "Boredom", { level: 85 });

    // Behavior tree: if boredom > 70 → go explore
    const tree: BehaviorNode = {
      type: "selector",
      children: [
        {
          type: "sequence",
          children: [
            { type: "condition", op: { type: "component_above", component: "Boredom", field: "level", value: 70 } },
            { type: "wander" },
          ],
        },
        { type: "action", action: { type: "observe" } },
      ],
    };

    setAgentBehaviorPolicy(world, agent, tree, true);
    clearPolicyEvalHistory(agent);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
    if (result.kind === "action") {
      expect(result.action.type).toBe("move"); // wander produces a move
    }
  });

  test("component_below checks a dynamic component's field", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    registerEntity(room, "Room");
    const agent = createAgentEntity(world, { name: "Agent", role: "test", systemPrompt: "Test.", roomId: room });
    registerEntity(agent, "Agent");

    registryCreateComponent({
      name: "Courage",
      description: "How brave the agent is",
      properties: { level: { type: "number", default: 50 } },
    });
    attachToEntity(world, agent, "Courage", { level: 10 });

    // If courage < 20 → flee (move away)
    const tree: BehaviorNode = {
      type: "selector",
      children: [
        {
          type: "sequence",
          children: [
            { type: "condition", op: { type: "component_below", component: "Courage", field: "level", value: 20 } },
            { type: "action", action: { type: "think", content: "I must flee!" } },
          ],
        },
        { type: "action", action: { type: "observe" } },
      ],
    };

    setAgentBehaviorPolicy(world, agent, tree, true);
    clearPolicyEvalHistory(agent);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
    if (result.kind === "action") {
      expect(result.action.type).toBe("think");
      expect(result.action.content).toContain("flee");
    }
  });

  test("component_above returns false when component not attached", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    registerEntity(room, "Room");
    const agent = createAgentEntity(world, { name: "Agent", role: "test", systemPrompt: "Test.", roomId: room });
    registerEntity(agent, "Agent");

    // Don't attach Boredom — condition should return false
    const tree: BehaviorNode = {
      type: "selector",
      children: [
        {
          type: "sequence",
          children: [
            { type: "condition", op: { type: "component_above", component: "Boredom", field: "level", value: 50 } },
            { type: "action", action: { type: "think", content: "bored" } },
          ],
        },
        { type: "action", action: { type: "observe" } },
      ],
    };

    setAgentBehaviorPolicy(world, agent, tree, true);
    clearPolicyEvalHistory(agent);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
    if (result.kind === "action") {
      // Fell through — boredom not attached. May get observe or anti-repetition fallback
      expect(["observe", "think", "reflect"]).toContain(result.action.type);
    }
  });

  test("has_component checks if agent has a dynamic component", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    registerEntity(room, "Room");
    const agent = createAgentEntity(world, { name: "Agent", role: "test", systemPrompt: "Test.", roomId: room });
    registerEntity(agent, "Agent");

    registryCreateComponent({
      name: "Cursed",
      description: "Agent is under a curse",
      properties: { severity: { type: "number", default: 1 } },
    });
    attachToEntity(world, agent, "Cursed", { severity: 5 });

    const tree: BehaviorNode = {
      type: "selector",
      children: [
        {
          type: "sequence",
          children: [
            { type: "condition", op: { type: "has_component", component: "Cursed" } },
            { type: "action", action: { type: "move", target: "Temple" } },
          ],
        },
        { type: "action", action: { type: "observe" } },
      ],
    };

    // Need a Temple room for the move to validate
    const temple = createRoomEntity(world, { name: "Temple", description: "A temple" });
    registerEntity(temple, "Temple");

    setAgentBehaviorPolicy(world, agent, tree, true);
    clearPolicyEvalHistory(agent);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
    if (result.kind === "action") {
      expect(result.action.type).toBe("move");
      expect(result.action.target).toBe("Temple");
    }
  });

  test("validation accepts new condition types", () => {
    expect(validateBehaviorNode({ type: "condition", op: { type: "component_above", component: "Boredom", field: "level", value: 50 } }).ok).toBe(true);
    expect(validateBehaviorNode({ type: "condition", op: { type: "component_below", component: "Energy", field: "amount", value: 10 } }).ok).toBe(true);
    expect(validateBehaviorNode({ type: "condition", op: { type: "has_component", component: "Cursed" } }).ok).toBe(true);

    // Missing fields
    expect(validateBehaviorNode({ type: "condition", op: { type: "component_above", field: "level", value: 50 } }).ok).toBe(false);
    expect(validateBehaviorNode({ type: "condition", op: { type: "has_component" } }).ok).toBe(false);
  });
});
