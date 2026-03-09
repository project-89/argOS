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

      await sim.step();
    } finally {
      if (prev !== undefined) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prev;
    }
  }, 30000);
});

