/**
 * Stress test: 10 agents, 5 rooms, lots of objects
 * Tests scaling, concurrent cognition, and system stability
 */
import "dotenv/config";
import { createSimulation } from "./index";

async function main() {
  console.log("=== Stress Test: 10 Agents, 5 Rooms ===\n");

  const sim = await createSimulation({
    name: "Busy Village",
    narrative: "A bustling medieval village with many residents going about their daily lives",
    preset: "slice-of-life",
    enableAI: true,
    enableSpirits: true,
    enablePlanning: true,
    dualLoop: true,
    ecsTickRate: 0.15, // ~1 tick per 7 seconds
    ecsDeltaMs: 5000,
    godAutopilot: true,
    enableServer: false, // No server for stress test

    rooms: [
      { name: "Town Square", description: "The central square with a fountain", roomType: "tavern" },
      { name: "Blacksmith", description: "A hot forge with sparks flying" },
      { name: "Library", description: "Quiet halls filled with ancient books" },
      { name: "Market", description: "Stalls selling food, cloth, and trinkets" },
      { name: "Temple", description: "A serene temple with incense burning" },
    ],

    agents: [
      { name: "Helena", role: "innkeeper", startRoom: "Town Square" },
      { name: "Boris", role: "blacksmith", startRoom: "Blacksmith" },
      { name: "Sage Elara", role: "scholar and mystic", startRoom: "Library" },
      { name: "Pip", role: "merchant", startRoom: "Market" },
      { name: "Brother Marcus", role: "monk and healer", startRoom: "Temple" },
      { name: "Raven", role: "thief and pickpocket", startRoom: "Market" },
      { name: "Captain Ada", role: "guard captain", startRoom: "Town Square" },
      { name: "Old Barnaby", role: "storyteller and drunk", startRoom: "Town Square" },
      { name: "Lyra", role: "traveling bard", startRoom: "Town Square" },
      { name: "Grim", role: "bounty hunter", startRoom: "Blacksmith" },
    ],

    objects: [
      { name: "Town Fountain", description: "A stone fountain with clear water", room: "Town Square", traits: ["examinable"] },
      { name: "Anvil", description: "A heavy iron anvil", room: "Blacksmith", traits: ["examinable", "workable"] },
      { name: "Spell Book", description: "A leather-bound grimoire", room: "Library", traits: ["examinable", "takeable"] },
      { name: "Gold Coins", description: "A pouch of gold coins", room: "Market", traits: ["examinable", "takeable"] },
      { name: "Prayer Beads", description: "Wooden prayer beads", room: "Temple", traits: ["examinable", "takeable"] },
    ],
  });

  const startTime = Date.now();
  const actionLog: { tick: number; agent: string; action: string; time: number }[] = [];
  let lastTick = 0;

  sim.onAgent((event: any) => {
    actionLog.push({
      tick: lastTick,
      agent: event.agentName || "?",
      action: `${event.action || "?"} ${event.target || ""} ${event.content ? '"' + String(event.content).slice(0, 50) + '"' : ""}`.trim(),
      time: Date.now() - startTime,
    });
  });

  sim.onWorld((event: any) => {
    if (event.tick) lastTick = event.tick;
  });

  console.log("Starting 90-second stress test...\n");
  await sim.start();

  // Let it run
  await new Promise(resolve => setTimeout(resolve, 90000));

  sim.stop();

  console.log("\n=== STRESS TEST RESULTS ===");
  console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log(`Total actions: ${actionLog.length}`);
  console.log(`Final stats:`, sim.getStats());

  // Action types
  const types: Record<string, number> = {};
  for (const a of actionLog) {
    const t = a.action.split(" ")[0];
    types[t] = (types[t] || 0) + 1;
  }
  console.log("\nAction type breakdown:", JSON.stringify(types, null, 2));

  // Per-agent
  const agents: Record<string, number> = {};
  for (const a of actionLog) {
    agents[a.agent] = (agents[a.agent] || 0) + 1;
  }
  console.log("\nPer-agent action count:", JSON.stringify(agents, null, 2));

  // Timing
  const actionTimes = actionLog.map(a => a.time);
  if (actionTimes.length > 1) {
    const gaps = actionTimes.slice(1).map((t, i) => t - actionTimes[i]);
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    console.log(`\nAvg time between actions: ${(avgGap / 1000).toFixed(1)}s`);
    console.log(`First action at: ${(actionTimes[0] / 1000).toFixed(1)}s`);
    console.log(`Last action at: ${(actionTimes[actionTimes.length - 1] / 1000).toFixed(1)}s`);
  }

  // Sample interesting actions
  console.log("\n--- Sample Actions ---");
  const speaks = actionLog.filter(a => a.action.startsWith("speak"));
  const interacts = actionLog.filter(a => a.action.startsWith("interact"));
  const moves = actionLog.filter(a => a.action.startsWith("move"));

  console.log(`\nSpeech (${speaks.length} total):`);
  for (const s of speaks.slice(0, 10)) {
    console.log(`  [${s.agent}] ${s.action}`);
  }

  console.log(`\nInteractions (${interacts.length} total):`);
  for (const s of interacts.slice(0, 10)) {
    console.log(`  [${s.agent}] ${s.action}`);
  }

  console.log(`\nMovement (${moves.length} total):`);
  for (const s of moves.slice(0, 10)) {
    console.log(`  [${s.agent}] ${s.action}`);
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
