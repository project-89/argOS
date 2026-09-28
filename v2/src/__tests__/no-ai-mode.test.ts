import "dotenv/config";
import { createSimulation } from "../index";

describe("No-AI deterministic mode", () => {
  test("createSimulation works without API key when enableAI:false", async () => {
    const prev = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    // Ensure it's absent for the test regardless of environment.
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    try {
      const sim = await createSimulation({
        name: "NoAI Test",
        enableAI: false,
        dualLoop: false,
        enableSpirits: false,
        preset: "minimal",
        rooms: [{ name: "Room" }],
        agents: [{ name: "Alice", role: "tester", startRoom: "Room" }],
      });

      const systemEvents: string[] = [];
      sim.onSystem((event) => systemEvents.push(event.type));
      await sim.step();
      const stats = sim.getStats();
      expect(stats.agentCount).toBe(1);
      expect(stats.roomCount).toBe(1);
      expect(stats.systemCount).toBeGreaterThan(0);
      expect(sim.getEvolutionStatus().enabled).toBe(false);
      expect(sim.getSystemHealth()).toHaveLength(stats.systemCount);
      expect(sim.getSystemHealth().every((system) => system.active)).toBe(true);
      expect(systemEvents).toContain("system:created");
      expect(systemEvents).toContain("system:executed");
      sim.stop();
    } finally {
      if (prev !== undefined) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prev;
    }
  }, 30000);
});
