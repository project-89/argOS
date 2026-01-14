/**
 * Deterministic Village Challenge
 *
 * A pure ECS simulation with NO AI/LLM involvement.
 * Tests emergent behavior from interacting deterministic systems.
 *
 * Philosophy: Like Dwarf Fortress, complex narratives emerge from
 * many simple rules interacting - not from scripted text.
 *
 * Success criteria:
 * - Agents move between locations autonomously
 * - Needs drive behavior (hunger → kitchen, tired → bedroom)
 * - Schedules create daily routines
 * - Goals are created, pursued, and completed
 * - Emergent social patterns from location sharing
 */

import { createWorld, addEntity, addComponent, removeEntity, query as bitecsQuery, hasComponent as bitecsHasComponent, getRelationTargets as bitecsGetRelationTargets } from "bitecs";
import {
  Agent, Mind, Name, Needs, Room, Schedule, Goal, Description,
  AllComponents
} from "../ecs/components";
import {
  OccupiesRoom, HasGoal, HasSchedule, AllRelations
} from "../ecs/relations";
import type { SystemContext } from "../ecs/dynamic-systems";
import {
  deterministicBehaviorSystems,
  DETERMINISTIC_SYSTEM_DEFINITIONS,
} from "../systems/deterministic-behavior-systems";
import * as fs from "fs";

// =============================================================================
// SIMULATION SETUP
// =============================================================================

interface VillagerConfig {
  name: string;
  role: string;
  startingRoom: string;
  schedule: Array<{ name: string; startHour: number; duration: number; location: string }>;
  personality: { extraversion: number; conscientiousness: number };
}

const VILLAGERS: VillagerConfig[] = [
  {
    name: "Ada the Baker",
    role: "baker",
    startingRoom: "Bakery",
    schedule: [
      { name: "Wake up", startHour: 5, duration: 1, location: "Home" },
      { name: "Bake bread", startHour: 6, duration: 4, location: "Bakery" },
      { name: "Sell goods", startHour: 10, duration: 3, location: "Market" },
      { name: "Lunch", startHour: 13, duration: 1, location: "Tavern" },
      { name: "More baking", startHour: 14, duration: 3, location: "Bakery" },
      { name: "Evening social", startHour: 17, duration: 2, location: "Square" },
      { name: "Dinner", startHour: 19, duration: 1, location: "Tavern" },
      { name: "Sleep", startHour: 20, duration: 9, location: "Home" },
    ],
    personality: { extraversion: 0.7, conscientiousness: 0.9 },
  },
  {
    name: "Bjorn the Smith",
    role: "blacksmith",
    startingRoom: "Forge",
    schedule: [
      { name: "Wake up", startHour: 6, duration: 1, location: "Home" },
      { name: "Forge work", startHour: 7, duration: 5, location: "Forge" },
      { name: "Lunch", startHour: 12, duration: 1, location: "Tavern" },
      { name: "More forging", startHour: 13, duration: 4, location: "Forge" },
      { name: "Evening drink", startHour: 17, duration: 2, location: "Tavern" },
      { name: "Dinner", startHour: 19, duration: 1, location: "Tavern" },
      { name: "Sleep", startHour: 20, duration: 10, location: "Home" },
    ],
    personality: { extraversion: 0.4, conscientiousness: 0.8 },
  },
  {
    name: "Clara the Healer",
    role: "healer",
    startingRoom: "Temple",
    schedule: [
      { name: "Morning prayer", startHour: 5, duration: 2, location: "Temple" },
      { name: "Healing", startHour: 7, duration: 4, location: "Temple" },
      { name: "Market visit", startHour: 11, duration: 2, location: "Market" },
      { name: "Lunch", startHour: 13, duration: 1, location: "Tavern" },
      { name: "Afternoon care", startHour: 14, duration: 3, location: "Temple" },
      { name: "Evening walk", startHour: 17, duration: 2, location: "Square" },
      { name: "Meditation", startHour: 19, duration: 2, location: "Temple" },
      { name: "Sleep", startHour: 21, duration: 8, location: "Home" },
    ],
    personality: { extraversion: 0.6, conscientiousness: 0.7 },
  },
  {
    name: "Dirk the Merchant",
    role: "merchant",
    startingRoom: "Market",
    schedule: [
      { name: "Wake up", startHour: 7, duration: 1, location: "Home" },
      { name: "Open shop", startHour: 8, duration: 4, location: "Market" },
      { name: "Lunch", startHour: 12, duration: 1, location: "Tavern" },
      { name: "Afternoon trade", startHour: 13, duration: 4, location: "Market" },
      { name: "Evening social", startHour: 17, duration: 3, location: "Tavern" },
      { name: "Dinner", startHour: 20, duration: 1, location: "Tavern" },
      { name: "Sleep", startHour: 21, duration: 10, location: "Home" },
    ],
    personality: { extraversion: 0.9, conscientiousness: 0.6 },
  },
  {
    name: "Elena the Scholar",
    role: "scholar",
    startingRoom: "Library",
    schedule: [
      { name: "Morning study", startHour: 6, duration: 3, location: "Library" },
      { name: "Breakfast", startHour: 9, duration: 1, location: "Home" },
      { name: "Research", startHour: 10, duration: 4, location: "Library" },
      { name: "Lunch", startHour: 14, duration: 1, location: "Tavern" },
      { name: "Teaching", startHour: 15, duration: 2, location: "Square" },
      { name: "Evening reading", startHour: 17, duration: 3, location: "Library" },
      { name: "Dinner", startHour: 20, duration: 1, location: "Home" },
      { name: "Sleep", startHour: 21, duration: 9, location: "Home" },
    ],
    personality: { extraversion: 0.3, conscientiousness: 0.95 },
  },
];

const ROOMS = [
  { name: "Market", description: "The bustling heart of the village" },
  { name: "Square", description: "A peaceful gathering place" },
  { name: "Tavern", description: "Warm and welcoming inn" },
  { name: "Temple", description: "Place of healing and worship" },
  { name: "Bakery", description: "Smells of fresh bread" },
  { name: "Forge", description: "Hot from the furnace" },
  { name: "Library", description: "Quiet repository of knowledge" },
  { name: "Home", description: "Residential area" },
];

// =============================================================================
// WORLD SETUP
// =============================================================================

function setupWorld() {
  const world = createWorld();
  const entityRegistry = new Map<number, { name: string; type: string }>();
  const roomsByName = new Map<string, number>();

  // Create rooms
  for (const roomConfig of ROOMS) {
    const eid = addEntity(world);
    addComponent(world, eid, Room);
    addComponent(world, eid, Name);
    addComponent(world, eid, Description);

    Name.value[eid] = roomConfig.name;
    Description.value[eid] = roomConfig.description;
    Room.capacity[eid] = 20;
    Room.ambience[eid] = "peaceful";

    roomsByName.set(roomConfig.name.toLowerCase(), eid);
    entityRegistry.set(eid, { name: roomConfig.name, type: "room" });
  }

  // Create villagers
  for (const villager of VILLAGERS) {
    const eid = addEntity(world);
    addComponent(world, eid, Agent);
    addComponent(world, eid, Mind);
    addComponent(world, eid, Name);
    addComponent(world, eid, Needs);

    Name.value[eid] = villager.name;
    Agent.role[eid] = villager.role;
    Agent.active[eid] = true;
    Agent.systemPrompt[eid] = "";

    Mind.mode[eid] = "active";
    Mind.arousal[eid] = 0.5;
    Mind.focus[eid] = "starting day";
    Mind.lastUpdate[eid] = 0;

    // Initialize needs
    Needs.hunger[eid] = 0.2 + Math.random() * 0.3; // Start slightly hungry
    Needs.energy[eid] = 0.8 + Math.random() * 0.2; // Start with energy
    Needs.social[eid] = 0.3 + Math.random() * 0.4; // Varying social needs
    Needs.comfort[eid] = 0.7;

    // Create schedule
    const scheduleEid = addEntity(world);
    addComponent(world, scheduleEid, Schedule);
    addComponent(world, eid, HasSchedule(scheduleEid));
    Schedule.activities[scheduleEid] = JSON.stringify(villager.schedule);
    Schedule.currentActivity[scheduleEid] = villager.schedule[0]?.name || "";
    Schedule.nextTransition[scheduleEid] = 0;
    Schedule.flexibility[scheduleEid] = 0.3;
    Schedule.lastUpdated[scheduleEid] = 0;

    // Place in starting room
    const roomKey = villager.startingRoom.toLowerCase();
    const matchedRoom = Array.from(roomsByName.entries()).find(([key]) =>
      key.includes(roomKey) || roomKey.includes(key)
    );

    if (matchedRoom) {
      addComponent(world, eid, OccupiesRoom(matchedRoom[1]));
    }

    entityRegistry.set(eid, { name: villager.name, type: "agent" });
  }

  return { world, entityRegistry, roomsByName };
}

// =============================================================================
// SIMULATION CONTEXT
// =============================================================================

function createSimulationContext(world: any, elapsed: number, delta: number): SystemContext {
  const events: Array<{ type: string; data: any; timestamp: number }> = [];
  const logs: string[] = [];

  return {
    tick: Math.floor(elapsed / 1000),
    delta,
    elapsed,
    emit: (type, data) => events.push({ type, data, timestamp: elapsed }),
    log: (msg) => logs.push(msg),
    query: (w, components) => bitecsQuery(w, components),
    hasComponent: (w, eid, comp) => bitecsHasComponent(w, eid, comp),
    getRelationTargets: (w, eid, rel) => bitecsGetRelationTargets(w, eid, rel),
    addEntity: (w) => addEntity(w),
    addComponent: (w, eid, comp) => addComponent(w, eid, comp),
    removeEntity: (w, eid) => removeEntity(w, eid),
    components: AllComponents,
    relations: AllRelations,
    ai: null as any, // NO AI in this challenge!
    grid: null as any,
    cognitive: null as any,
  };
}

// =============================================================================
// SIMULATION RUNNER
// =============================================================================

interface SimulationStats {
  totalMovements: number;
  goalsCreated: number;
  goalsCompleted: number;
  needsSatisfied: number;
  hourlySnapshots: Array<{
    hour: number;
    agentLocations: Record<string, string>;
    agentNeeds: Record<string, { hunger: number; energy: number; social: number }>;
  }>;
}

async function runSimulation(durationHours: number = 24): Promise<SimulationStats> {
  console.log("\n" + "=".repeat(60));
  console.log("  DETERMINISTIC VILLAGE SIMULATION");
  console.log("  No AI - Pure ECS Rule-Based Emergent Behavior");
  console.log("=".repeat(60));

  const { world, entityRegistry, roomsByName } = setupWorld();

  const stats: SimulationStats = {
    totalMovements: 0,
    goalsCreated: 0,
    goalsCompleted: 0,
    needsSatisfied: 0,
    hourlySnapshots: [],
  };

  // Simulation parameters
  const MS_PER_HOUR = 1000 * 60 * 60; // Real hour in ms
  const SIMULATION_SPEED = 60; // 1 real second = 1 sim minute
  const TICK_INTERVAL = 1000; // 1 second ticks
  const totalTicks = (durationHours * 60 * 60) / SIMULATION_SPEED;

  let elapsed = 5 * MS_PER_HOUR; // Start at 5 AM
  let lastHour = -1;

  const allEvents: Array<{ type: string; data: any; timestamp: number }> = [];

  console.log(`\nSimulating ${durationHours} hours of village life...`);
  console.log(`Starting at hour 5 (5:00 AM)\n`);

  for (let tick = 0; tick < totalTicks; tick++) {
    const currentHour = Math.floor((elapsed / MS_PER_HOUR) % 24);

    // Create context for this tick
    const ctx = createSimulationContext(world, elapsed, TICK_INTERVAL * SIMULATION_SPEED);
    const eventsThisTick: typeof allEvents = [];

    // Override emit to capture events
    ctx.emit = (type, data) => {
      const event = { type, data, timestamp: elapsed };
      eventsThisTick.push(event);
      allEvents.push(event);

      // Update stats
      if (type === "movement") stats.totalMovements++;
      if (type === "goal_created") stats.goalsCreated++;
      if (type === "goal_completed") stats.goalsCompleted++;
      if (type === "need_satisfied") stats.needsSatisfied++;
    };

    // Run all deterministic systems
    for (const systemDef of DETERMINISTIC_SYSTEM_DEFINITIONS) {
      // Check if system should run based on frequency
      const systemInterval = systemDef.frequency / SIMULATION_SPEED;
      if (tick % Math.max(1, Math.floor(systemInterval / TICK_INTERVAL)) === 0) {
        try {
          systemDef.run(world, ctx);
        } catch (error) {
          console.error(`Error in ${systemDef.name}:`, error);
        }
      }
    }

    // Hourly snapshot
    if (currentHour !== lastHour) {
      lastHour = currentHour;

      const snapshot: (typeof stats.hourlySnapshots)[0] = {
        hour: currentHour,
        agentLocations: {},
        agentNeeds: {},
      };

      // Collect agent states
      const agents = Array.from(ctx.query(world, [Agent, Name, Needs]));
      for (const eid of agents) {
        const name = Name.value[eid];
        const roomTargets = ctx.getRelationTargets(world, eid, OccupiesRoom);
        const roomName = roomTargets.length > 0 ? Name.value[roomTargets[0]] : "Unknown";

        snapshot.agentLocations[name] = roomName;
        snapshot.agentNeeds[name] = {
          hunger: Needs.hunger[eid],
          energy: Needs.energy[eid],
          social: Needs.social[eid],
        };
      }

      stats.hourlySnapshots.push(snapshot);

      // Log hourly summary
      console.log(`\n--- Hour ${currentHour.toString().padStart(2, "0")}:00 ---`);
      for (const [name, location] of Object.entries(snapshot.agentLocations)) {
        const needs = snapshot.agentNeeds[name];
        const needsStr = `H:${needs.hunger.toFixed(2)} E:${needs.energy.toFixed(2)} S:${needs.social.toFixed(2)}`;
        console.log(`  ${name.padEnd(20)} @ ${location.padEnd(15)} [${needsStr}]`);
      }

      // Log events this hour
      const hourEvents = eventsThisTick.filter(e =>
        ["movement", "goal_created", "goal_completed", "need_satisfied"].includes(e.type)
      );
      if (hourEvents.length > 0) {
        console.log(`  Events: ${hourEvents.map(e => e.type).join(", ")}`);
      }
    }

    elapsed += TICK_INTERVAL * SIMULATION_SPEED;
  }

  return stats;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  try {
    const stats = await runSimulation(24); // Simulate 24 hours

    console.log("\n" + "=".repeat(60));
    console.log("  SIMULATION COMPLETE");
    console.log("=".repeat(60));
    console.log(`\nStatistics:`);
    console.log(`  Total movements: ${stats.totalMovements}`);
    console.log(`  Goals created: ${stats.goalsCreated}`);
    console.log(`  Goals completed: ${stats.goalsCompleted}`);
    console.log(`  Needs satisfied: ${stats.needsSatisfied}`);

    // Determine success
    const success =
      stats.totalMovements >= 20 &&
      stats.goalsCreated >= 10 &&
      stats.goalsCompleted >= 5;

    console.log(`\n${success ? "✓ SUCCESS" : "✗ NEEDS IMPROVEMENT"}: Emergent behavior ${success ? "achieved" : "insufficient"}`);

    if (!success) {
      console.log("\nExpected:");
      console.log("  - At least 20 movements (got " + stats.totalMovements + ")");
      console.log("  - At least 10 goals created (got " + stats.goalsCreated + ")");
      console.log("  - At least 5 goals completed (got " + stats.goalsCompleted + ")");
    }

    // Write detailed log
    const logPath = "./deterministic-village-log.txt";
    const logContent = [
      "DETERMINISTIC VILLAGE SIMULATION LOG",
      "=" .repeat(60),
      "",
      "Statistics:",
      `  Total movements: ${stats.totalMovements}`,
      `  Goals created: ${stats.goalsCreated}`,
      `  Goals completed: ${stats.goalsCompleted}`,
      `  Needs satisfied: ${stats.needsSatisfied}`,
      "",
      "Hourly Snapshots:",
      ...stats.hourlySnapshots.flatMap(s => [
        `\nHour ${s.hour}:`,
        ...Object.entries(s.agentLocations).map(([name, loc]) => {
          const needs = s.agentNeeds[name];
          return `  ${name}: ${loc} [H:${needs.hunger.toFixed(2)} E:${needs.energy.toFixed(2)} S:${needs.social.toFixed(2)}]`;
        }),
      ]),
    ].join("\n");

    fs.writeFileSync(logPath, logContent);
    console.log(`\nDetailed log written to: ${logPath}`);

  } catch (error) {
    console.error("Simulation failed:", error);
    process.exit(1);
  }
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}

export { runSimulation, setupWorld };
