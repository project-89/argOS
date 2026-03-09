import "dotenv/config";

import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createObjectEntity, createRoomEntity } from "../../ecs/prefabs";
import { addPerception } from "../agent-mind";
import { selectFailureRecoveryAction } from "../failure-recovery";
import { worldSchema } from "../../world/schema";

describe("Failure recovery ladder", () => {
  test("picks up an explicitly hinted item", () => {
    const world = createArgosWorld("FailureRecoveryPickup") as any;
    initializePrefabs(world);

    const room = createRoomEntity(world, { name: "Room" });
    const agent = createAgentEntity(world, { name: "Morgan", role: "npc", systemPrompt: "x", roomId: room });

    createObjectEntity(world, { name: "Keycard", roomId: room, traits: ["takeable"] });

    addPerception(world, agent, {
      type: "action_failed",
      source: "interaction",
      content: `🚨 CRITICAL - YOUR LAST ACTION FAILED
FAILED: You cannot unlock server door.
→ PICK UP "Keycard" first to gain hasKeycard
⛔ DO NOT proceed as if this action succeeded.`,
      intensity: 1,
    });

    const rec = selectFailureRecoveryAction(world, agent);
    expect(rec).not.toBeNull();
    expect(rec?.type).toBe("pickup");
    if (rec && rec.type === "pickup") {
      expect(rec.target).toBe("Keycard");
    }
  });

  test("opens/unlocks a hinted container when target appears inside it", () => {
    const world = createArgosWorld("FailureRecoveryContainer") as any;
    initializePrefabs(world);

    // Define a unique "open_*" affordance variant so recovery can infer the base affordance "open".
    // executeAffordance("open") will then select this variant automatically.
    worldSchema.defineAffordance({
      name: "open_drawer_test_recovery",
      requires: ["drawer_openable"],
      descriptionTemplate: "{actor.name} opens a drawer.",
      effects: [],
    });

    const room = createRoomEntity(world, { name: "Office" });
    const agent = createAgentEntity(world, { name: "Maya", role: "npc", systemPrompt: "x", roomId: room });

    createObjectEntity(world, { name: "Desk Drawer", roomId: room, portable: false, traits: ["drawer_openable"] });

    addPerception(world, agent, {
      type: "action_failed",
      source: "interaction",
      content: `🚨 CRITICAL - YOUR LAST ACTION FAILED
FAILED: You tried to take "Keycard" but it is not directly accessible here.
It appears to be inside "Desk Drawer".
⛔ DO NOT proceed as if this action succeeded.`,
      intensity: 1,
    });

    const rec = selectFailureRecoveryAction(world, agent);
    expect(rec).not.toBeNull();
    expect(rec?.type).toBe("interact");
    if (rec && rec.type === "interact") {
      expect(rec.target).toBe("Desk Drawer");
      expect(rec.content).toBe("open");
    }
  });

  test("escalates for the same failure: pickup hint first, then container open", () => {
    const world = createArgosWorld("FailureRecoveryEscalation") as any;
    initializePrefabs(world);

    worldSchema.defineAffordance({
      name: "open_drawer_test_recovery_escalation",
      requires: ["drawer_openable"],
      descriptionTemplate: "{actor.name} opens a drawer.",
      effects: [],
    });

    const room = createRoomEntity(world, { name: "Office" });
    const agent = createAgentEntity(world, { name: "Maya", role: "npc", systemPrompt: "x", roomId: room });

    createObjectEntity(world, { name: "Keycard", roomId: room, traits: ["takeable", "hasKeycard"] });
    createObjectEntity(world, { name: "Desk Drawer", roomId: room, portable: false, traits: ["drawer_openable"] });

    const msg = `🚨 CRITICAL - YOUR LAST ACTION FAILED
FAILED: You cannot unlock server door. Actor lacks trait: hasKeycard (you have no tool capabilities)
→ PICK UP "Keycard" first to gain hasKeycard
It appears to be inside "Desk Drawer".
⛔ DO NOT proceed as if this action succeeded.`;

    addPerception(world, agent, { type: "action_failed", source: "interaction", content: msg, intensity: 1 });

    const first = selectFailureRecoveryAction(world, agent);
    expect(first?.type).toBe("pickup");
    if (first && first.type === "pickup") expect(first.target).toBe("Keycard");

    // Same failure still present; next call should not repeat pickup, and should try opening the drawer.
    const second = selectFailureRecoveryAction(world, agent);
    expect(second?.type).toBe("interact");
    if (second && second.type === "interact") {
      expect(second.target).toBe("Desk Drawer");
      expect(second.content).toBe("open");
    }
  });

  test("stops recovering once a newer action_result exists", () => {
    const world = createArgosWorld("FailureRecoveryStopsOnSuccess") as any;
    initializePrefabs(world);

    const room = createRoomEntity(world, { name: "Room" });
    const agent = createAgentEntity(world, { name: "Morgan", role: "npc", systemPrompt: "x", roomId: room });

    addPerception(world, agent, {
      type: "action_failed",
      source: "interaction",
      content: `🚨 CRITICAL - YOUR LAST ACTION FAILED\nFAILED: Something.\n⛔ DO NOT proceed as if this action succeeded.`,
      intensity: 1,
    });

    const rec1 = selectFailureRecoveryAction(world, agent);
    expect(rec1).not.toBeNull();

    // Now a newer success should suppress recovery.
    addPerception(world, agent, {
      type: "action_result",
      source: "self",
      content: "✅ SUCCESS - You did something.",
      intensity: 0.5,
    });

    const rec2 = selectFailureRecoveryAction(world, agent);
    expect(rec2).toBeNull();
  });
});
