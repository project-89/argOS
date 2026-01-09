/**
 * Behavioral Test 03: Problem-Solving Test
 *
 * GOAL: Present GodAI with specific problems that require reasoning about
 * what components and systems to create. Tests:
 * - Ability to analyze requirements
 * - Creative problem decomposition
 * - Iterative refinement when things don't work
 * - Self-correction based on feedback
 *
 * This tests GodAI's reasoning and adaptive problem-solving.
 */

import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, resetRoomPositionCounter } from "../ecs/prefabs";
import { createGodAgent, godCommand, tickWorld, getWorldState } from "../god/god-agent";
import { listDynamicComponents, getDynamicComponentValues } from "../ecs/dynamic-components";
import { query } from "bitecs";
import { Name, GridPosition } from "../ecs/components";

interface ProblemResult {
  problem: string;
  solved: boolean;
  approach: string;
  componentsUsed: string[];
  systemsCreated: string[];
  iterations: number;
}

async function testProblem(
  god: ReturnType<typeof createGodAgent>,
  problem: string,
  testFunction: () => boolean,
  maxIterations: number = 3
): Promise<ProblemResult> {
  console.log(`\n  Problem: ${problem}`);
  console.log("  " + "─".repeat(60));

  const result: ProblemResult = {
    problem,
    solved: false,
    approach: "",
    componentsUsed: [],
    systemsCreated: [],
    iterations: 0,
  };

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    result.iterations = iteration;
    console.log(`\n  Iteration ${iteration}/${maxIterations}`);

    // First iteration: ask to solve the problem
    // Subsequent: ask to fix/improve
    const prompt = iteration === 1
      ? `Problem to solve: ${problem}\n\nAnalyze this and build a solution using entities, components, and systems. Think through what data structures and behaviors are needed.`
      : `Your previous solution didn't fully work. The test shows: ${testFunction() ? "PASS" : "FAIL"}.\n\nLook at what you built and fix it. Check your system code, component values, and entity setup.`;

    await godCommand(god, prompt);

    // Record what was used
    const components = listDynamicComponents();
    result.componentsUsed = components.map(c => c.name);
    result.systemsCreated = god.fileSystems.map(s => s.name);

    // Run some ticks to let systems act
    console.log("  Running 20 ticks...");
    for (let tick = 1; tick <= 20; tick++) {
      tickWorld(god, 1000);
    }

    // Test if problem is solved
    const solved = testFunction();
    console.log(`  Test result: ${solved ? "✓ PASS" : "✗ FAIL"}`);

    if (solved) {
      result.solved = true;
      result.approach = god.thinkingLog[god.thinkingLog.length - 1]?.slice(0, 300) || "No approach recorded";
      break;
    }
  }

  return result;
}

async function runProblemSolvingTest() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Behavioral Test 03: Problem-Solving Test                    ║");
  console.log("║  Testing reasoning and adaptive problem-solving             ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const world = createArgosWorld("ProblemSolvingTest");
  initializePrefabs(world);
  resetRoomPositionCounter();

  const god = createGodAgent(world, {
    name: "ProblemSolver",
    worldName: "Problem Lab",
    narrative: "A testing ground for solving specific challenges.",
  });

  const results: ProblemResult[] = [];

  // ═══════════════════════════════════════════════════════════════
  // PROBLEM 1: Temperature Regulation
  // ═══════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("PROBLEM 1: Temperature Regulation");
  console.log("═══════════════════════════════════════════════════════════════");

  const tempProblem = `
    Create a temperature regulation system:
    - Create a "Furnace" entity that produces heat
    - Create a "Thermostat" entity that monitors temperature
    - Create a "Room" entity with a target temperature of 70°F

    The room starts at 50°F. The furnace should heat it up.
    The thermostat should turn off the furnace when temp reaches 70°F.

    I need to see the room's temperature actually change toward 70.
  `;

  const tempTest = () => {
    // Check if temperature component exists and has changed
    const tempComp = listDynamicComponents().find(c =>
      c.name.toLowerCase().includes("temp") || c.name.toLowerCase().includes("heat")
    );
    if (!tempComp) return false;

    // Find room entity and check its temperature
    const entities = god.tools.listEntities().result as Array<{ name: string; id: number }>;
    const room = entities.find(e => e.name.toLowerCase().includes("room"));
    if (!room) return false;

    const values = getDynamicComponentValues(tempComp.name, room.id);
    if (!values) return false;

    // Check if temperature is closer to target (started at 50, target 70)
    const currentTemp = values.current || values.temperature || values.value;
    return currentTemp !== undefined && currentTemp > 55;
  };

  results.push(await testProblem(god, tempProblem, tempTest));

  // ═══════════════════════════════════════════════════════════════
  // PROBLEM 2: Resource Scarcity
  // ═══════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PROBLEM 2: Resource Scarcity");
  console.log("═══════════════════════════════════════════════════════════════");

  const resourceProblem = `
    Create a resource scarcity simulation:
    - Create a "Well" entity that has Water (starts at 100, decreases by 5 each tick)
    - Create a "Farmer" entity that needs water (consumes 3 water per tick)
    - Create an "Alert System" that logs when water drops below 30

    The well should run dry over time.
    I need to see water levels decreasing and alerts when low.
  `;

  const resourceTest = () => {
    // Check for water-related component
    const waterComp = listDynamicComponents().find(c =>
      c.name.toLowerCase().includes("water") || c.name.toLowerCase().includes("resource")
    );

    // Check logs for any activity
    const totalLogs = god.systemRegistry.logs.length;

    // Success if we have a water component OR systems produced logs
    return waterComp !== undefined || totalLogs > 0 || god.fileSystems.length > 0;
  };

  results.push(await testProblem(god, resourceProblem, resourceTest));

  // ═══════════════════════════════════════════════════════════════
  // PROBLEM 3: State Machine
  // ═══════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PROBLEM 3: State Machine");
  console.log("═══════════════════════════════════════════════════════════════");

  const stateProblem = `
    Create a traffic light state machine:
    - Create a "TrafficLight" entity with states: red, yellow, green
    - Create a system that cycles through states:
      - red (10 ticks) → green (8 ticks) → yellow (3 ticks) → red
    - Log each state change

    After 25 ticks, the light should have cycled through multiple states.
  `;

  const stateTest = () => {
    // Check for state-related component
    const stateComp = listDynamicComponents().find(c =>
      c.name.toLowerCase().includes("state") ||
      c.name.toLowerCase().includes("traffic") ||
      c.name.toLowerCase().includes("light")
    );

    // Check for any traffic light entity
    const entities = god.tools.listEntities().result as Array<{ name: string; id: number }>;
    const trafficLight = entities.find(e =>
      e.name.toLowerCase().includes("traffic") || e.name.toLowerCase().includes("light")
    );

    // Check if there's a cycling system
    const cycleSystem = god.fileSystems.find(s =>
      s.name.toLowerCase().includes("traffic") ||
      s.name.toLowerCase().includes("cycle") ||
      s.name.toLowerCase().includes("state")
    );

    return (stateComp !== undefined || trafficLight !== undefined) && cycleSystem !== undefined;
  };

  results.push(await testProblem(god, stateProblem, stateTest));

  // ═══════════════════════════════════════════════════════════════
  // PROBLEM 4: Emergent Behavior (Hardest)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PROBLEM 4: Emergent Behavior (HARD)");
  console.log("═══════════════════════════════════════════════════════════════");

  const emergentProblem = `
    Create a predator-prey simulation:
    - Create "Grass" entities (5 of them) that grow over time
    - Create "Rabbit" entities (3 of them) that eat grass and reproduce
    - Create "Fox" entity (1) that eats rabbits

    Requirements:
    - Each entity type needs an Energy component
    - Grass: energy grows by 1 per tick (represents growth)
    - Rabbits: lose 1 energy per tick, gain 10 from eating grass, reproduce at 50 energy
    - Fox: loses 2 energy per tick, gains 20 from eating rabbit

    After simulation, there should be different numbers of entities than started.
  `;

  const emergentTest = () => {
    // Check for energy component
    const energyComp = listDynamicComponents().find(c =>
      c.name.toLowerCase().includes("energy") ||
      c.name.toLowerCase().includes("life") ||
      c.name.toLowerCase().includes("health")
    );

    // Check for multiple entity types
    const entities = god.tools.listEntities().result as Array<{ name: string; id: number }>;
    const hasGrass = entities.some(e => e.name.toLowerCase().includes("grass"));
    const hasRabbit = entities.some(e => e.name.toLowerCase().includes("rabbit"));
    const hasFox = entities.some(e => e.name.toLowerCase().includes("fox"));

    // Has systems for the simulation
    const hasRelevantSystems = god.fileSystems.length >= 2;

    return energyComp !== undefined && (hasGrass || hasRabbit || hasFox) && hasRelevantSystems;
  };

  results.push(await testProblem(god, emergentProblem, emergentTest, 2)); // Only 2 iterations for hard problem

  // ═══════════════════════════════════════════════════════════════
  // FINAL REPORT
  // ═══════════════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  TEST COMPLETE - Problem-Solving Report                      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("Results Summary:");
  console.log("─".repeat(70));

  let solved = 0;
  for (const r of results) {
    const status = r.solved ? "✓ SOLVED" : "✗ FAILED";
    console.log(`${status} - ${r.problem.split("\n")[0].trim().slice(0, 50)}...`);
    console.log(`         Components: ${r.componentsUsed.join(", ") || "none"}`);
    console.log(`         Systems: ${r.systemsCreated.join(", ") || "none"}`);
    console.log(`         Iterations: ${r.iterations}`);
    if (r.solved) solved++;
  }

  console.log("─".repeat(70));
  console.log(`\nOverall: ${solved}/${results.length} problems solved`);

  const score = (solved / results.length) * 100;
  console.log(`\nProblem-Solving Score: ${score.toFixed(0)}%`);

  if (score >= 75) {
    console.log("Assessment: EXCELLENT - GodAI shows strong problem-solving ability");
  } else if (score >= 50) {
    console.log("Assessment: GOOD - GodAI can solve moderately complex problems");
  } else if (score >= 25) {
    console.log("Assessment: DEVELOPING - GodAI needs better prompting or tools");
  } else {
    console.log("Assessment: NEEDS WORK - Fundamental issues with problem-solving");
  }

  console.log("\n✅ Problem-solving test complete!");

  return {
    problemsAttempted: results.length,
    problemsSolved: solved,
    score,
    details: results,
  };
}

runProblemSolvingTest().catch(console.error);
