/**
 * End-to-End Smoke Test
 *
 * Tests the full simulation pipeline:
 * 1. createSimulation() with config
 * 2. GodAI sets up world (rooms, agents, objects)
 * 3. Dual-loop runtime: fast ECS tick + async AI operations
 * 4. Agents perceive → think (LLM) → act
 * 5. Spirits observe and report
 * 6. Rules engine fires consequences
 * 7. Clean shutdown
 */

import "dotenv/config";
import { createSimulation } from "./index";

const DURATION_SEC = Number(process.env.DURATION || 60);

async function main() {
  console.log("=== ArgOS v2 End-to-End Smoke Test ===\n");

  const sim = await createSimulation({
    name: "The Crossroads Inn",
    narrative: `A mystical tavern at the crossroads of worlds. Strange travelers meet here.
    The fire whispers secrets. Time moves oddly. Bonds form fast.`,
    preset: "slice-of-life",
    enableAI: true,
    enableSpirits: true,
    enablePlanning: true,
    dualLoop: true,
    ecsTickRate: 0.2, // 1 tick per 5 seconds (slow for testing)
    ecsDeltaMs: 5000,
    godAutopilot: true,
    enableServer: true,
    serverPort: 3456,

    rooms: [
      { name: "Main Hall", description: "A warm tavern hall with a crackling hearth and wooden tables", roomType: "tavern" },
      { name: "Kitchen", description: "A busy kitchen with pots bubbling and herbs hanging from the rafters", roomType: "bakery" },
      { name: "Courtyard", description: "A quiet courtyard under open sky, with a stone well" },
    ],

    agents: [
      {
        name: "Vera",
        role: "fortune teller",
        description: "An elderly mystic with genuine prophetic sight. Speaks in riddles but is deeply kind.",
        startRoom: "Main Hall",
      },
      {
        name: "Kael",
        role: "runaway noble",
        description: "A young noble who fled his family's court. Naive but brave, wearing fine but worn clothes.",
        startRoom: "Main Hall",
      },
      {
        name: "Iron Jack",
        role: "bounty hunter",
        description: "A weathered tracker with a scarred face and few words. Has a strong moral code.",
        startRoom: "Courtyard",
      },
    ],

    objects: [
      { name: "Mystic Hearth", description: "A fire that occasionally whispers cryptic words", room: "Main Hall", traits: ["examinable"] },
      { name: "Worn Map", description: "A tattered map with strange symbols", room: "Main Hall", traits: ["examinable", "takeable"] },
      { name: "Iron Dagger", description: "A plain but well-maintained dagger", room: "Courtyard", traits: ["examinable", "takeable"] },
    ],
  });

  // Subscribe to events
  sim.onAgent((event) => {
    console.log(`  [AGENT] ${(event as any).agentName}: ${(event as any).action} ${(event as any).target || ""} ${(event as any).content ? `"${(event as any).content}"` : ""}`);
  });

  sim.onSpirit((event) => {
    console.log(`  [SPIRIT] ${JSON.stringify(event).slice(0, 120)}...`);
  });

  sim.onWorld((event) => {
    if ((event as any).tick % 5 === 0) {
      console.log(`  [WORLD] tick=${(event as any).tick} agents=${(event as any).agentCount} rooms=${(event as any).roomCount} systems=${(event as any).systemCount}`);
    }
  });

  console.log("\n--- Initial State ---");
  console.log(sim.getState());
  console.log(sim.getStats());

  // Start the simulation
  await sim.start();

  // After 10 seconds, inject a dramatic event
  setTimeout(() => {
    console.log("\n>>> Injecting dramatic event...\n");
    sim.broadcast("Main Hall", "A thunderclap shakes the building. The fire flares green for an instant.");
  }, 10_000);

  // After 20 seconds, give Kael a nudge
  setTimeout(() => {
    console.log("\n>>> Nudging Kael via daemon...\n");
    sim.stimulate("Kael", "You notice Vera staring at you with an odd expression. Something about her gaze feels urgent.");
  }, 20_000);

  // After 30 seconds, send a god command
  setTimeout(async () => {
    console.log("\n>>> God command: introducing a new character...\n");
    await sim.command("Create a mysterious hooded stranger who enters the Main Hall and sits alone in the corner, saying nothing.");
  }, 30_000);

  // Shut down after DURATION_SEC
  setTimeout(() => {
    console.log(`\n=== Shutting down after ${DURATION_SEC}s ===`);
    sim.stop();
    console.log("\nFinal stats:", sim.getStats());
    process.exit(0);
  }, DURATION_SEC * 1000);

  // Handle SIGINT
  process.on("SIGINT", () => {
    sim.stop();
    console.log("\nFinal stats:", sim.getStats());
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
