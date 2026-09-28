import { createArgosWorld } from "../../ecs/world";
import { createSimulation } from "../../index";
import { formatNativeRuntimeServices, getNativeRuntimeServices, registerNativeRuntimeServices } from "../native-services";
import { gatherArchitectContext } from "../../spirits/architect-spirit";
import { getWorldState } from "../../god/god-agent";

describe("native runtime inventory for world builders", () => {
  it("does not invent an installed runtime for an arbitrary or restored ECS world", () => {
    const world = createArgosWorld(); world.meta.aiEnabled = true;
    expect(getNativeRuntimeServices(world)).toEqual([]);
    expect(formatNativeRuntimeServices(world)).toContain("no installation manifest");
  });
  it("reports enabled and disabled services independently and is world-scoped", () => {
    const world = createArgosWorld();
    registerNativeRuntimeServices(world, { ai: true, planning: false, reflection: true, timedSpeech: true, timedActions: false });
    expect(getNativeRuntimeServices(world).find(s => s.id === "npc-dialogue")?.enabled).toBe(true);
    expect(getNativeRuntimeServices(world).find(s => s.id === "npc-planning")?.enabled).toBe(false);
    expect(getNativeRuntimeServices(createArgosWorld())).toEqual([]);
    const copy = getNativeRuntimeServices(world); copy[0].enabled = false;
    expect(getNativeRuntimeServices(world)[0].enabled).toBe(true);
  });
  it("the library exposes actual configuration to God and the architect, without fake generated systems", async () => {
    const sim = await createSimulation({ name: "Inventory fixture", preset: "minimal", enableAI: false, enableServer: false });
    try {
      const services = getNativeRuntimeServices(sim.world);
      expect(sim.getRuntimeServices()).toEqual(services);
      expect(services.find(s => s.id === "npc-cognition")?.enabled).toBe(false);
      expect(services.find(s => s.id === "timed-speech")?.enabled).toBe(true);
      expect(sim.god.systemRegistry.systems.has("npc-dialogue")).toBe(false);
      expect(getWorldState(sim.god)).toContain("npc-dialogue [disabled]");
      expect((await gatherArchitectContext(sim.world, sim.god.systemRegistry)).nativeServices).toContain("npc-dialogue [disabled]");
    } finally { sim.stop(); }
  });
});
