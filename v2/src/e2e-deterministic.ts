/**
 * Deterministic-only simulation test (no LLM calls)
 * Tests that behavior policies, needs systems, movement, and goals
 * all work without any AI.
 */
import "dotenv/config";
import { createSimulation } from "./index";

async function main() {
  console.log("=== Deterministic Simulation Test (no AI) ===\n");

  const sim = await createSimulation({
    name: "Deterministic Village",
    narrative: "A simple village for testing deterministic behavior",
    preset: "slice-of-life",
    enableAI: false,
    enableSpirits: false,
    enablePlanning: false,
    dualLoop: true,
    ecsTickRate: 2, // Fast ticking for testing
    ecsDeltaMs: 5000,

    rooms: [
      { name: "Tavern", description: "A warm tavern with food and drink" },
      { name: "Market", description: "A busy market square" },
      { name: "Barracks", description: "A guard outpost" },
    ],

    agents: [
      { name: "Martha", role: "innkeeper", description: "A cheerful innkeeper", startRoom: "Tavern" },
      { name: "Finn", role: "merchant", description: "A savvy trader", startRoom: "Market" },
      { name: "Greta", role: "guard", description: "A stern guard", startRoom: "Barracks" },
      { name: "Old Tom", role: "scholar", description: "A retired scholar", startRoom: "Tavern" },
    ],

    objects: [
      { name: "Bread Loaf", description: "Fresh bread", room: "Tavern", traits: ["food", "examinable", "takeable"] },
      { name: "Ale Mug", description: "A mug of ale", room: "Tavern", traits: ["drinkable", "examinable"] },
      { name: "Ancient Tome", description: "A dusty old book", room: "Market", traits: ["examinable", "takeable"] },
      { name: "Iron Sword", description: "A sturdy sword", room: "Barracks", traits: ["examinable", "takeable"] },
    ],
  });

  console.log("\n--- Initial State ---");
  console.log(sim.getStats());

  // Track actions
  const actionLog: string[] = [];
  sim.onAgent((event: any) => {
    const line = `[${event.agentName}] ${event.action} ${event.target || ""} ${event.content ? `"${event.content}"` : ""}`.trim();
    actionLog.push(line);
    console.log(`  ${line}`);
  });

  await sim.start();

  // Let it run for 60 seconds
  await new Promise(resolve => setTimeout(resolve, 60000));

  sim.stop();

  console.log("\n=== RESULTS ===");
  console.log(`Total actions: ${actionLog.length}`);
  console.log(`Final stats:`, sim.getStats());

  // Count action types
  const types: Record<string, number> = {};
  for (const line of actionLog) {
    const match = line.match(/\] (\w+)/);
    if (match) types[match[1]] = (types[match[1]] || 0) + 1;
  }
  console.log("Action breakdown:", types);

  // Count per-agent
  const agents: Record<string, number> = {};
  for (const line of actionLog) {
    const match = line.match(/\[(\w+)/);
    if (match) agents[match[1]] = (agents[match[1]] || 0) + 1;
  }
  console.log("Per-agent actions:", agents);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
