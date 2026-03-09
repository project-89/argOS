import "dotenv/config";

import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Needs } from "../../ecs/components";
import { clearMovementTarget } from "../../systems/builtin-systems";
import { executeActions, registerEntity } from "../cognition-system";
import { agentThink } from "../agent-mind";
import { setAgentBehaviorPolicy, type BehaviorNode } from "../behavior-policy";

describe("Cognition policy guardrails", () => {
  test("policy stops spamming move once movement target is set", async () => {
    const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    const world = createArgosWorld("PolicyMoveSpamTest") as any;
    initializePrefabs(world);
    const registry = createSystemRegistry();

    const kitchen = createRoomEntity(world, { name: "Kitchen", description: "A kitchen." });
    registerEntity(kitchen, "Kitchen");

    const agent = createAgentEntity(world, {
      name: "Morgan",
      role: "NPC",
      systemPrompt: "You are Morgan.",
      // Intentionally do NOT set roomId: we want the grid-based no-current-room move path.
      gridPosition: { x: 1, y: 1 },
    });
    registerEntity(agent, "Morgan");

    // Ensure the room is a valid grid target.
    // createRoomEntity already sets GridPosition.

    // Hunger high so policy tries to move to Kitchen.
    Needs.hunger[agent] = 90;

    const tree: BehaviorNode = {
      type: "selector",
      children: [
        {
          type: "sequence",
          children: [
            { type: "condition", op: { type: "need_above", need: "hunger", value: 60 } },
            { type: "condition", op: { type: "has_active_movement_goal", destinationIncludes: "Kitchen" } },
            { type: "action", action: { type: "wait" } },
          ],
        },
        {
          type: "sequence",
          children: [
            { type: "condition", op: { type: "need_above", need: "hunger", value: 60 } },
            { type: "action", action: { type: "move", target: "Kitchen" } },
          ],
        },
        { type: "action", action: { type: "wait" } },
      ],
    };
    setAgentBehaviorPolicy(world, agent, tree, true);

    // First think: choose move.
    const first = await agentThink(world, agent);
    expect(first.type).toBe("move");
    expect(first.target).toBe("Kitchen");

    executeActions(world, [{ eid: agent, action: first as any }], registry);

    // Second think: should see movement target and choose wait (not spam move).
    const second = await agentThink(world, agent);
    expect(second.type).toBe("wait");

    clearMovementTarget(agent);
    if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;
  });
});

