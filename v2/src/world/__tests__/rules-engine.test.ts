import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { ObjectManager } from "../object-manager";
import { RulesEngine } from "../rules-engine";
import { worldSchema } from "../schema";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";

describe("RulesEngine (RuleEffect compatibility)", () => {
  beforeEach(() => {
    // Ensure no lingering stimuli from other tests.
    drainPendingStimuli();
  });

  it("supports RuleEffect.action === 'emit_stimulus' by executing WorldSchema emit_stimulus effects", () => {
    const world = createArgosWorld("RulesTestWorld");
    initializePrefabs(world);

    const roomEid = createRoomEntity(world, { name: "Room A" });
    const agentEid = createAgentEntity(world, {
      name: "Agent",
      role: "tester",
      systemPrompt: "test",
      roomId: roomEid,
    });

    const objectManager = new ObjectManager(world);
    const rulesEngine = new RulesEngine(world, objectManager);

    // A deterministic rule that emits a stimulus to nearby agents.
    worldSchema.defineRule({
      name: "test_emit_stimulus_rule",
      description: "Test rule emits a stimulus event",
      enabled: true,
      priority: 1000,
      when: { event: "tick", condition: undefined },
      then: [
        {
          action: "emit_stimulus",
          target: "nearby",
          params: { stimulusType: "sound", stimulusContent: "A bell rings.", stimulusRadius: 5 },
        },
      ],
    });

    // Attach the rule to a concrete entity so RulesEngine has a sourceEid to use as actor.
    const bellEid = objectManager.spawn("object", { name: "Bell", containedIn: roomEid });
    expect(bellEid).not.toBeNull();

    // Run a tick; the rule should fire and queue a stimulus for the agent in the same room.
    rulesEngine.processTick(1);

    const drained = drainPendingStimuli();
    const forAgent = drained.filter((s) => s.targetEid === agentEid);
    expect(forAgent.length).toBeGreaterThan(0);
    expect(forAgent[0].type).toBe("sound");
    expect(forAgent[0].content).toContain("A bell rings.");
  });

  it("supports emit_event with params.type as an alias for params.event", () => {
    const world = createArgosWorld("RulesTestWorld");
    initializePrefabs(world);

    const roomEid = createRoomEntity(world, { name: "Room A" });
    const agentEid = createAgentEntity(world, {
      name: "Agent",
      role: "tester",
      systemPrompt: "test",
      roomId: roomEid,
    });
    void agentEid;

    const objectManager = new ObjectManager(world);
    const rulesEngine = new RulesEngine(world, objectManager);

    worldSchema.defineRule({
      name: "test_emit_event_type_alias",
      description: "Test rule emits an event using params.type",
      enabled: true,
      priority: 1000,
      when: { event: "tick", condition: undefined },
      then: [
        {
          action: "emit_event",
          target: "self",
          params: { type: "custom_event", content: "hello" },
        },
      ],
    });

    const sourceEid = objectManager.spawn("object", { name: "Source", containedIn: roomEid });
    expect(sourceEid).not.toBeNull();

    const events = rulesEngine.processTick(1);
    const hasCustom = events.some((e) => e.type === "custom_event");
    expect(hasCustom).toBe(true);
  });
});

