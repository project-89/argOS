import { createArgosWorld } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";
import { createGodAgent } from "../god/god-agent";
import { worldSchema } from "../world/schema";

describe("GodAgent schema wiring", () => {
  it("uses the shared WorldSchema singleton (single source of truth)", () => {
    const world = createArgosWorld("TestWorld");
    initializePrefabs(world);

    const god = createGodAgent(world, {
      name: "God",
      worldName: "TestWorld",
      narrative: "",
    });

    expect(god.worldSchema).toBe(worldSchema);
  });
});

