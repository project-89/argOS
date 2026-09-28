import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs } from "../../ecs/prefabs";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { deserializeWorld, serializeWorld } from "../world-persistence";
import {
  createStoryScaffoldEntity,
  getStoryScaffold,
  type StoryScaffoldData,
} from "../../nle/story-scaffold";

describe("story scaffold persistence", () => {
  test("survives a world serialize/deserialize cycle", () => {
    const source = createArgosWorld("Source");
    initializePrefabs(source);
    const registry = createSystemRegistry();
    const scaffold: StoryScaffoldData = {
      seed: "A lighthouse keeper hears a voice beneath the tide.",
      currentAct: "setup",
      adaptations: ["The storm arrived early"],
      tensions: [{
        id: "tide-voice",
        description: "The voice wants the lantern extinguished",
        status: "active",
        involvedNpcs: ["Mara"],
        beats: [{
          id: "first-whisper",
          description: "Mara hears her name from the sea",
          act: "setup",
          status: "pending",
          triggerCondition: "Mara enters the lantern room",
        }],
      }],
      npcRoles: [{
        name: "Mara",
        eid: 42,
        role: "protagonist",
        secrets: ["She has heard the voice before"],
      }],
    };
    createStoryScaffoldEntity(source, scaffold);

    const serialized = serializeWorld(source, registry);
    const restored = createArgosWorld("Restored");
    initializePrefabs(restored);
    deserializeWorld(restored, createSystemRegistry(), serialized);

    expect(getStoryScaffold(restored)).toEqual(scaffold);
  });
});
