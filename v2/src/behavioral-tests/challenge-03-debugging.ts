/**
 * Challenge 03: Debugging Mode
 *
 * GOAL: Test GodAI's ability to diagnose and fix a broken simulation.
 * We deliberately create a flawed system and ask GodAI to identify and fix it.
 *
 * SUCCESS CRITERIA:
 * - GodAI can identify the bug from symptoms
 * - GodAI can propose a fix
 * - GodAI can implement the fix
 * - The simulation works correctly after the fix
 *
 * Run with: npx tsx src/behavioral-tests/challenge-03-debugging.ts
 */

import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, resetRoomPositionCounter } from "../ecs/prefabs";
import { createGodAgent, godThink, tickWorldAsync, type GodAgentState } from "../god/god-agent";
import { listDynamicComponents, createDynamicComponent, getDynamicComponent, saveComponentDefinition } from "../ecs/dynamic-components";
import { writeSystemFile, loadSystemFromFile } from "../systems/system-loader";
import { Name } from "../ecs/components";
import { query } from "bitecs";

// Create a deliberately broken system
async function setupBrokenSimulation(state: GodAgentState) {
  console.log("🔧 Setting up broken simulation...\n");

  // Create components
  const TankComponent = {
    name: "Tank",
    description: "A water tank with level tracking",
    properties: {
      level: "number" as const,
      capacity: "number" as const,
      leakRate: "number" as const,
    },
  };

  const PumpComponent = {
    name: "Pump",
    description: "A pump that fills tanks",
    properties: {
      targetTankId: "number" as const,
      flowRate: "number" as const,
      active: "number" as const, // 0 or 1
    },
  };

  createDynamicComponent(TankComponent);
  createDynamicComponent(PumpComponent);
  await saveComponentDefinition(TankComponent);
  await saveComponentDefinition(PumpComponent);

  // Create entities
  const tankResult = state.tools.createEntity({ name: "MainTank", description: "The main water storage tank" });
  const pumpResult = state.tools.createEntity({ name: "FillPump", description: "Pump that fills the main tank" });

  const tankEid = tankResult.result?.entityId as number;
  const pumpEid = pumpResult.result?.entityId as number;

  // Set initial values
  const Tank = getDynamicComponent("Tank")!;
  const Pump = getDynamicComponent("Pump")!;

  Tank.level[tankEid] = 50;
  Tank.capacity[tankEid] = 100;
  Tank.leakRate[tankEid] = 2; // Loses 2 units per tick

  Pump.targetTankId[pumpEid] = tankEid;
  Pump.flowRate[pumpEid] = 5; // Adds 5 units per tick when active
  Pump.active[pumpEid] = 1; // Pump is ON

  console.log("  Created Tank: level=50, capacity=100, leakRate=2");
  console.log("  Created Pump: flowRate=5, active=1 (ON)");

  // Create a BROKEN system - the bug is that it subtracts flowRate instead of adding it
  const brokenSystemCode = `
const Tank = ctx.getDynamic("Tank");
const Pump = ctx.getDynamic("Pump");
if (!Tank || !Pump) return;

const { Name } = ctx.components;

// Find all pumps
const pumps = Array.from(ctx.query(world, [Name])).filter(eid =>
  Pump.flowRate?.[eid] !== undefined
);

for (const pumpEid of pumps) {
  if (Pump.active[pumpEid] !== 1) continue;

  const targetTankId = Pump.targetTankId[pumpEid];
  const flowRate = Pump.flowRate[pumpEid];

  if (Tank.level?.[targetTankId] !== undefined) {
    // BUG: Subtracting instead of adding!
    Tank.level[targetTankId] -= flowRate;
    ctx.log(\`Pump filled tank, new level: \${Tank.level[targetTankId]}\`);
  }
}

// Apply leak to all tanks
const tanks = Array.from(ctx.query(world, [Name])).filter(eid =>
  Tank.level?.[eid] !== undefined
);

for (const tankEid of tanks) {
  const leakRate = Tank.leakRate[tankEid] || 0;
  Tank.level[tankEid] = Math.max(0, Tank.level[tankEid] - leakRate);
}
`;

  const filePath = await writeSystemFile({
    name: "TankPumpSystem",
    description: "Manages tank filling and leaking",
    frequency: 1,
    code: brokenSystemCode,
  });

  const loaded = await loadSystemFromFile(filePath);
  if (loaded) {
    loaded.active = true;
    state.fileSystems.push(loaded);
  }

  console.log("  Created TankPumpSystem (with deliberate bug)\n");
  console.log("  Expected behavior: Tank should fill up (pump adds 5, leak removes 2 = net +3/tick)");
  console.log("  Actual behavior: Tank empties rapidly (bug subtracts instead of adds)\n");

  return { tankEid, pumpEid };
}

function getTankLevel(state: GodAgentState, tankEid: number): number {
  const Tank = getDynamicComponent("Tank");
  return Tank?.level?.[tankEid] ?? 0;
}

const DEBUGGING_PROMPT = `
PROBLEM: The water tank simulation is broken!

EXPECTED BEHAVIOR:
- Tank starts at 50 units
- Pump adds 5 units per tick when active
- Tank leaks 2 units per tick
- Net change should be +3 units per tick
- Tank should fill up over time

ACTUAL BEHAVIOR:
- Tank is emptying instead of filling!
- After 10 ticks, the tank is nearly empty

YOUR TASK:
1. Examine the TankPumpSystem code to find the bug
2. Explain what the bug is
3. Fix the system so the tank fills correctly

Use getSystemCode to read the current system, then modifyFileSystem to fix it.
`;

async function runChallenge() {
  console.log("\n" + "═".repeat(70));
  console.log("  CHALLENGE 03: Debugging Mode");
  console.log("═".repeat(70) + "\n");

  const world = createArgosWorld("DebugTest");
  initializePrefabs(world);
  resetRoomPositionCounter();

  const state = createGodAgent(world, {
    name: "Debugger",
    worldName: "DebugTest",
    narrative: "A simulation with a bug that needs fixing",
  });

  // Setup the broken simulation
  const { tankEid, pumpEid } = await setupBrokenSimulation(state);

  // Run a few ticks to demonstrate the bug
  console.log("═".repeat(70));
  console.log("  PHASE 1: Demonstrating the Bug");
  console.log("═".repeat(70) + "\n");

  const initialLevel = getTankLevel(state, tankEid);
  console.log(`Initial tank level: ${initialLevel}`);

  for (let tick = 1; tick <= 10; tick++) {
    await tickWorldAsync(state, 1000);
    if (tick % 2 === 0) {
      const level = getTankLevel(state, tankEid);
      console.log(`Tick ${tick}: Tank level = ${level}`);
    }
  }

  const levelAfterBug = getTankLevel(state, tankEid);
  console.log(`\nAfter 10 ticks: ${levelAfterBug} (should be ~80, but is much lower due to bug)\n`);

  // Now ask GodAI to debug and fix
  console.log("═".repeat(70));
  console.log("  PHASE 2: GodAI Debugging");
  console.log("═".repeat(70) + "\n");

  const startTime = Date.now();
  const { thinking, actions } = await godThink(state, DEBUGGING_PROMPT);
  const debugTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n📝 GodAI's Analysis:");
  console.log("-".repeat(50));
  console.log(thinking.slice(0, 1500) + (thinking.length > 1500 ? "..." : ""));
  console.log("-".repeat(50));

  console.log(`\n⚡ Actions taken: ${actions.length}`);
  for (const action of actions) {
    console.log(`  ${action.success ? "✓" : "✗"} ${JSON.stringify(action.result || action.error).slice(0, 100)}`);
  }

  // Reset tank level and run again to test the fix
  console.log("\n" + "═".repeat(70));
  console.log("  PHASE 3: Testing the Fix");
  console.log("═".repeat(70) + "\n");

  // Reset tank
  const Tank = getDynamicComponent("Tank")!;
  Tank.level[tankEid] = 50;
  console.log("Reset tank level to 50");

  const levelsBefore: number[] = [];
  const levelsAfter: number[] = [];

  // Run 10 more ticks
  for (let tick = 1; tick <= 10; tick++) {
    await tickWorldAsync(state, 1000);
    const level = getTankLevel(state, tankEid);
    levelsAfter.push(level);
    if (tick % 2 === 0) {
      console.log(`Tick ${tick}: Tank level = ${level}`);
    }
  }

  const finalLevel = getTankLevel(state, tankEid);

  // Evaluate
  console.log("\n" + "═".repeat(70));
  console.log("  PHASE 4: Evaluation");
  console.log("═".repeat(70) + "\n");

  // Check if tank is now filling (level should increase)
  const isFilling = finalLevel > 50;
  const isCorrectRate = finalLevel >= 75 && finalLevel <= 85; // Should be around 80 (50 + 10*3)
  const identifiedBug = thinking.toLowerCase().includes("subtract") ||
                        thinking.toLowerCase().includes("-=") ||
                        thinking.toLowerCase().includes("minus");
  const proposedFix = thinking.toLowerCase().includes("+=") ||
                      thinking.toLowerCase().includes("add") ||
                      thinking.toLowerCase().includes("plus");
  const madeChanges = actions.some(a => a.success &&
    (JSON.stringify(a.result).includes("modified") || JSON.stringify(a.result).includes("System")));

  console.log("📊 SUCCESS CRITERIA:");
  console.log(`  ${identifiedBug ? "✅" : "❌"} Identified the bug (subtract instead of add)`);
  console.log(`  ${proposedFix ? "✅" : "❌"} Proposed correct fix (change to +=)`);
  console.log(`  ${madeChanges ? "✅" : "❌"} Made changes to the system`);
  console.log(`  ${isFilling ? "✅" : "❌"} Tank is now filling (level > 50)`);
  console.log(`  ${isCorrectRate ? "✅" : "❌"} Correct fill rate (~+3/tick, final ~80)`);

  const score = [identifiedBug, proposedFix, madeChanges, isFilling, isCorrectRate].filter(Boolean).length;
  console.log(`\n📈 SCORE: ${score}/5`);

  // Summary
  console.log("\n" + "═".repeat(70));
  console.log("  SUMMARY");
  console.log("═".repeat(70));
  console.log(`  Debug time: ${debugTime}s`);
  console.log(`  Actions taken: ${actions.length}`);
  console.log(`  Initial level: ${initialLevel}`);
  console.log(`  Level after bug: ${levelAfterBug}`);
  console.log(`  Final level after fix: ${finalLevel}`);
  console.log(`  Score: ${score}/5`);

  const passed = score >= 3;
  console.log(`\n  ${passed ? "🎉 CHALLENGE PASSED" : "💥 CHALLENGE FAILED"}`);
  console.log("═".repeat(70) + "\n");

  // Show tank level progression
  console.log("📈 TANK LEVEL PROGRESSION:");
  console.log("-".repeat(50));
  console.log(`Start: ${"█".repeat(Math.floor(initialLevel / 5))} ${initialLevel}`);
  console.log(`Bug:   ${"█".repeat(Math.floor(levelAfterBug / 5))} ${levelAfterBug}`);
  console.log(`Fixed: ${"█".repeat(Math.floor(finalLevel / 5))} ${finalLevel}`);
  console.log("-".repeat(50));

  return { passed, score, debugTime, finalLevel };
}

runChallenge().catch(console.error);
