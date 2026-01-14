/**
 * Unit Tests for Sensory System
 *
 * Tests:
 * - Stimulus formatting for agent prompts
 * - Action feedback prominence (failures shown first)
 * - Inventory awareness
 * - Notable object state detection
 */

import "dotenv/config";
import { addEntity, addComponent, hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Name, Description, Agent, Mind, Room, Inventory, ObjectState, ObjectType, Traits } from "../../ecs/components";
import { OccupiesRoom, Contains } from "../../ecs/relations";
import {
  generateStimuliForAgent,
  formatStimuliForPrompt,
  type Stimulus,
  type SensoryModality,
} from "../sensory-system";

// =============================================================================
// TEST HELPERS
// =============================================================================

function createTestWorld() {
  return createArgosWorld("Test World");
}

function createTestAgent(world: ReturnType<typeof createArgosWorld>, name: string) {
  const eid = addEntity(world);
  addComponent(world, eid, Name);
  addComponent(world, eid, Description);
  addComponent(world, eid, Agent);
  addComponent(world, eid, Mind);
  addComponent(world, eid, Inventory);

  Name.value[eid] = name;
  Description.value[eid] = `A test agent named ${name}`;
  Agent.role[eid] = "tester";
  Agent.active[eid] = 1;
  Mind.arousal[eid] = 0.5;
  Mind.mode[eid] = "active";
  Inventory.items[eid] = JSON.stringify([]);
  Inventory.maxSlots[eid] = 10;
  Inventory.maxWeight[eid] = 100;

  return eid;
}

function createTestRoom(world: ReturnType<typeof createArgosWorld>, name: string) {
  const eid = addEntity(world);
  addComponent(world, eid, Room);
  addComponent(world, eid, Name);
  addComponent(world, eid, Description);

  Name.value[eid] = name;
  Description.value[eid] = `A test room called ${name}`;
  Room.ambience[eid] = "A plain room for testing.";

  return eid;
}

function placeAgentInRoom(world: ReturnType<typeof createArgosWorld>, agentEid: number, roomEid: number) {
  addComponent(world, agentEid, OccupiesRoom(roomEid));
  addComponent(world, roomEid, Contains(agentEid));
}

// =============================================================================
// TESTS
// =============================================================================

describe("Sensory System", () => {
  describe("formatStimuliForPrompt", () => {
    test("should show action failures FIRST and prominently", () => {
      const stimuli: Stimulus[] = [
        {
          modality: "visual",
          type: "room",
          content: "A small room with a table.",
          source: "environment",
          intensity: 0.8,
          timestamp: Date.now(),
        },
        {
          modality: "cognitive",
          type: "action_failed",
          content: "FAILED: You tried to take 'key' but it cannot be taken right now.",
          source: "inventory",
          intensity: 1,
          timestamp: Date.now(),
        },
      ];

      const formatted = formatStimuliForPrompt(stimuli);

      // Failure should appear BEFORE visual content
      const failureIndex = formatted.indexOf("CRITICAL");
      const visualIndex = formatted.indexOf("SIGHT");
      expect(failureIndex).toBeGreaterThan(-1);
      expect(failureIndex).toBeLessThan(visualIndex);

      // Check for prominent failure markers
      expect(formatted).toContain("🚨");
      expect(formatted).toContain("FAILED");
      expect(formatted).toContain("DO NOT proceed as if this action succeeded");
    });

    test("should show action successes with checkmark", () => {
      const stimuli: Stimulus[] = [
        {
          modality: "cognitive",
          type: "action_result",
          content: "You take the key. It is now in your inventory.",
          source: "self",
          intensity: 1,
          timestamp: Date.now(),
        },
      ];

      const formatted = formatStimuliForPrompt(stimuli);
      expect(formatted).toContain("✅");
      expect(formatted).toContain("SUCCEEDED");
    });

    test("should show multiple failures prominently", () => {
      const stimuli: Stimulus[] = [
        {
          modality: "cognitive",
          type: "action_failed",
          content: "FAILED: Cannot take key - hidden under floorboard",
          source: "inventory",
          intensity: 1,
          timestamp: Date.now(),
        },
        {
          modality: "cognitive",
          type: "action_failed",
          content: "FAILED: Cannot unlock - no key",
          source: "inventory",
          intensity: 1,
          timestamp: Date.now(),
        },
      ];

      const formatted = formatStimuliForPrompt(stimuli);
      expect(formatted).toContain("Cannot take key");
      expect(formatted).toContain("Cannot unlock");
      // Both failures should have the ❌ marker
      expect((formatted.match(/❌/g) || []).length).toBe(2);
    });

    test("should show failure before success when both present", () => {
      const stimuli: Stimulus[] = [
        {
          modality: "cognitive",
          type: "action_result",
          content: "SUCCESS: You examined the room.",
          source: "self",
          intensity: 1,
          timestamp: Date.now(),
        },
        {
          modality: "cognitive",
          type: "action_failed",
          content: "FAILED: You cannot take the locked chest.",
          source: "inventory",
          intensity: 1,
          timestamp: Date.now(),
        },
      ];

      const formatted = formatStimuliForPrompt(stimuli);

      // Failure section should come before success section
      const failureIndex = formatted.indexOf("CRITICAL");
      const successIndex = formatted.indexOf("SUCCEEDED");
      expect(failureIndex).toBeGreaterThan(-1);
      expect(successIndex).toBeGreaterThan(-1);
      expect(failureIndex).toBeLessThan(successIndex);
    });
  });

  describe("generateStimuliForAgent", () => {
    test("should include pending action_failed events in stimuli", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "TestAgent");
      const roomEid = createTestRoom(world, "TestRoom");
      placeAgentInRoom(world, agentEid, roomEid);

      const pendingEvents = [
        {
          modality: "cognitive" as SensoryModality,
          type: "action_failed",
          content: "FAILED: You tried to take 'key' but it cannot be taken right now.",
          source: "inventory",
          intensity: 1,
        },
      ];

      const stimuli = generateStimuliForAgent(world, agentEid, pendingEvents);

      const failures = stimuli.filter(s => s.type === "action_failed");
      expect(failures.length).toBe(1);
      expect(failures[0].content).toContain("FAILED");
      expect(failures[0].modality).toBe("cognitive");
    });

    test("should include pending action_result events in stimuli", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "TestAgent");
      const roomEid = createTestRoom(world, "TestRoom");
      placeAgentInRoom(world, agentEid, roomEid);

      const pendingEvents = [
        {
          modality: "cognitive" as SensoryModality,
          type: "action_result",
          content: "You examine the key. It is rusty and old.",
          source: "self",
          intensity: 1,
        },
      ];

      const stimuli = generateStimuliForAgent(world, agentEid, pendingEvents);

      const results = stimuli.filter(s => s.type === "action_result");
      expect(results.length).toBe(1);
      expect(results[0].content).toContain("examine");
    });

    test("should generate visual stimuli for room contents", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "TestAgent");
      const roomEid = createTestRoom(world, "TestRoom");
      placeAgentInRoom(world, agentEid, roomEid);

      const stimuli = generateStimuliForAgent(world, agentEid, []);

      const visualStimuli = stimuli.filter(s => s.modality === "visual");
      expect(visualStimuli.length).toBeGreaterThan(0);

      // Should include some visual content about the environment
      const hasEnvironmentInfo = visualStimuli.some(s =>
        s.type === "room" || s.type === "environment" || s.type === "location" || s.content.includes("room")
      );
      expect(hasEnvironmentInfo).toBe(true);
    });
  });

  describe("End-to-end formatting", () => {
    test("action failure should appear prominently in formatted prompt", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Viktor");
      const roomEid = createTestRoom(world, "Cellar");
      placeAgentInRoom(world, agentEid, roomEid);

      // Simulate a failed action stimulus
      const failureStimulus = {
        modality: "cognitive" as SensoryModality,
        type: "action_failed",
        content: "FAILED: You tried to take 'rusty_key' but it cannot be taken right now. You do NOT have the rusty_key. Check what conditions must be met first.",
        source: "inventory",
        intensity: 1,
      };

      // Generate all stimuli including the failure
      const allStimuli = generateStimuliForAgent(world, agentEid, [failureStimulus]);

      // Format for prompt
      const perceptionText = formatStimuliForPrompt(allStimuli, agentEid);

      // Verify failure is prominent
      expect(perceptionText).toContain("🚨🚨🚨 CRITICAL");
      expect(perceptionText).toContain("YOUR LAST ACTION FAILED");
      expect(perceptionText).toContain("rusty_key");
      expect(perceptionText).toContain("DO NOT proceed as if this action succeeded");

      // Verify inventory shows empty hands
      expect(perceptionText).toContain("NOT holding anything");
    });

    test("successful action should show confirmation in prompt", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Viktor");
      const roomEid = createTestRoom(world, "Cellar");
      placeAgentInRoom(world, agentEid, roomEid);

      const successStimulus = {
        modality: "cognitive" as SensoryModality,
        type: "action_result",
        content: "SUCCESS: You stack the crate against the wall. Now you can climb it!",
        source: "self",
        intensity: 1,
      };

      const allStimuli = generateStimuliForAgent(world, agentEid, [successStimulus]);
      const perceptionText = formatStimuliForPrompt(allStimuli, agentEid);

      expect(perceptionText).toContain("✅ YOUR LAST ACTION SUCCEEDED");
      expect(perceptionText).toContain("stack the crate");
    });
  });
});
