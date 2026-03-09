import "dotenv/config";

import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { addPerception, agentThink } from "../agent-mind";
import { setAgentBehaviorPolicy } from "../behavior-policy";

describe("agentThink recovery escalation", () => {
  test("does not return recovery 'wait' when LLM key is present and a policy action exists", async () => {
    const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "dummy";
    try {
      const world = createArgosWorld("AgentMindEscalation") as any;
      initializePrefabs(world);

      const room = createRoomEntity(world, { name: "Room" });
      const agent = createAgentEntity(world, { name: "Morgan", role: "npc", systemPrompt: "x", roomId: room });

      // A recent critical failure with no actionable hints will cause deterministic recovery to
      // (eventually) suggest "wait". With an LLM key configured, agentThink should treat that as
      // "no deterministic recovery found" and continue to the policy layer instead.
      addPerception(world, agent, {
        type: "action_failed",
        source: "interaction",
        content: `🚨 CRITICAL - YOUR LAST ACTION FAILED\nFAILED: Something.\n⛔ DO NOT proceed as if this action succeeded.`,
        intensity: 1,
      });

      setAgentBehaviorPolicy(
        world,
        agent,
        { type: "action", action: { type: "speak", content: "Trying a different approach." } } as any,
        true
      );

      const action = await agentThink(world as any, agent);
      expect(action.type).toBe("speak");
    } finally {
      if (prevKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      else process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;
    }
  });
});

