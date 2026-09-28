import { addComponent } from "bitecs";
import { StimulusSource, Traits } from "../../ecs/components";
import { createArgosWorld } from "../../ecs/world";
import { createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { isPublicVisualProp } from "../public-visual-props";

test("ambient sensory sources are not props, while physical emitters remain visible regardless of name", () => {
  const world = createArgosWorld(); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Hall" });
  const make = (name: string, traits: string[]) => {
    const id = createObjectEntity(world, { name, roomId: room });
    addComponent(world, id, Traits); Traits.active[id] = JSON.stringify(traits);
    addComponent(world, id, StimulusSource); StimulusSource.stimulusType[id] = "sound";
    return id;
  };
  expect(isPublicVisualProp(world, make("Rain outside", ["ambient", "stimulus_source"]))).toBe(false);
  expect(isPublicVisualProp(world, make("Coffee aroma", ["ambient", "stimulus_source"]))).toBe(false);
  expect(isPublicVisualProp(world, make("ambient_sound_lamp", ["lightSource", "stimulus_source"]))).toBe(true);
  expect(isPublicVisualProp(world, make("Phone", ["device", "communication", "stimulus_source"]))).toBe(true);
  expect(isPublicVisualProp(world, make("Hidden phone", ["device", "hidden"]))).toBe(false);
});
