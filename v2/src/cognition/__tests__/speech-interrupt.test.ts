import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { drainPendingStimuli } from "../stimulus-queue";
import { executeActions } from "../cognition-system";
import { Mind } from "../../ecs/components";

describe("Speech interruption (directed speech stimuli)", () => {
  beforeEach(() => {
    drainPendingStimuli();
  });

  it("queues a direct 'speech' stimulus to the target agent when speak has a target", () => {
    const world = createArgosWorld("SpeechWorld");
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
    const direct = drained.filter((s) => s.targetEid === bob && s.type === "speech");
    expect(direct.length).toBeGreaterThan(0);
    expect(direct[0].content).toContain("says to you");
    expect(direct[0].content).toContain("Good morning, Bob!");

    expect(Mind.focus[bob]).toContain("respond to");
    expect(Mind.arousal[bob]).toBeGreaterThanOrEqual(0.5);
  });
});

