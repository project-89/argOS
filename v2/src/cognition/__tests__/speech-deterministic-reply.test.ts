import "dotenv/config";

import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { drainPendingStimuli } from "../stimulus-queue";
import { executeActions } from "../cognition-system";
import { processAgentCognition } from "../agent-mind";

describe("Deterministic speech replies (no LLM key)", () => {
  beforeEach(() => {
    drainPendingStimuli();
  });

  it("replies once to directed speech when no LLM key is present", async () => {
    const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    const world = createArgosWorld("SpeechReplyWorld") as any;
    initializePrefabs(world);
    const registry = createSystemRegistry();

    const roomEid = createRoomEntity(world, { name: "Room" });
    const alice = createAgentEntity(world, { name: "Alice", role: "speaker", systemPrompt: "test", roomId: roomEid });
    const bob = createAgentEntity(world, { name: "Bob", role: "listener", systemPrompt: "test", roomId: roomEid });

    executeActions(
      world,
      [{ eid: alice, action: { type: "speak", target: "Bob", content: "Good morning, Bob!" } }],
      registry
    );

    const drained = drainPendingStimuli();
    const toBob = drained.filter((s) => s.targetEid === bob && s.type === "speech");
    expect(toBob.length).toBeGreaterThan(0);

    const action = await processAgentCognition(
      world,
      bob,
      toBob.map((s) => ({ type: s.type, content: String(s.content || ""), source: String(s.source || "") }))
    );

    expect(action.type).toBe("speak");
    expect(action.target).toBe("Alice");
    expect(String(action.content || "").toLowerCase()).toContain("good morning");

    if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;
  });
});

