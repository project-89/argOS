/**
 * Cognitive Enhancements Integration Test
 *
 * Demonstrates the full cognitive stack working together:
 * 1. PLANNING SYSTEM - Goal decomposition into actionable steps
 * 2. REFLECTION SYSTEM - Higher-order thought synthesis from memories
 * 3. SCHEDULE SYSTEM - Time-based daily routines
 *
 * Tests that agents can:
 * - Generate and follow plans for goals
 * - Accumulate importance and trigger reflections
 * - Follow schedules and adapt to interruptions
 * - Integrate all systems in cognition
 */

import "dotenv/config";
import { createWorld, addEntity, addComponent, query, getRelationTargets } from "bitecs";
import {
  Name,
  Description,
  Agent,
  Mind,
  Room,
  Goal,
  Plan,
  Schedule,
  ReflectionState,
} from "../ecs/components";
import { OccupiesRoom, HasGoal, HasPlan, HasSchedule, HasReflectionState } from "../ecs/relations";
import { createSystemRegistry, type SystemRegistry } from "../ecs/dynamic-systems";

// Cognition imports
import {
  generatePlanForGoal,
  createPlanEntity,
  getCurrentStep,
  advancePlanStep,
  getAgentPlans,
  formatPlansForContext,
  type GeneratedPlan,
} from "../cognition/planning-system";

import {
  initializeReflectionState,
  accumulateImportance,
  shouldReflect,
  maybeReflect,
  getRecentInsights,
  formatInsightsForContext,
} from "../cognition/reflection-system";

import {
  initializeSchedule,
  getActivityForHour,
  getCurrentActivity,
  getNextActivity,
  createDefaultSchedule,
  formatScheduleForContext,
  canInterruptCurrentActivity,
  getScheduleFlexibility,
  type ScheduledActivity,
} from "../cognition/schedule-system";

import { addMemory, getAgentMemories } from "../cognition/knowledge-graph";

// =============================================================================
// TEST STATE
// =============================================================================

interface AgentState {
  eid: number;
  name: string;
  goalEid?: number;
  planEid?: number;
  scheduleEid?: number;
  reflectionStateEid?: number;
  memoryCount: number;
  reflectionCount: number;
  planStepsCompleted: number;
}

interface TestState {
  world: ReturnType<typeof createWorld>;
  systemRegistry: SystemRegistry;
  rooms: number[];
  agents: AgentState[];
  startTime: number;
}

// =============================================================================
// SETUP
// =============================================================================

function setupTest(): TestState {
  console.log("\n" + "=".repeat(70));
  console.log("COGNITIVE ENHANCEMENTS INTEGRATION TEST SETUP");
  console.log("=".repeat(70));

  const world = createWorld();
  const systemRegistry = createSystemRegistry();

  // ==========================================================================
  // CREATE ROOMS
  // ==========================================================================
  console.log("\n[Setup] Creating rooms...");
  const rooms: number[] = [];
  const roomConfigs = [
    { name: "Village Square", capacity: 20 },
    { name: "Blacksmith Workshop", capacity: 5 },
    { name: "Tavern", capacity: 15 },
    { name: "Market", capacity: 25 },
    { name: "Library", capacity: 10 },
  ];

  for (const config of roomConfigs) {
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Room);
    Name.value[eid] = config.name;
    Room.capacity[eid] = config.capacity;
    rooms.push(eid);
    console.log(`  Created room: ${config.name} (capacity: ${config.capacity})`);
  }

  // ==========================================================================
  // CREATE AGENTS
  // ==========================================================================
  console.log("\n[Setup] Creating agents with cognitive systems...");
  const agents: AgentState[] = [];

  const agentConfigs = [
    {
      name: "Elena",
      role: "blacksmith",
      room: 1,
      goal: "Craft a masterwork sword for the village hero",
      personality: "Diligent and perfectionist",
    },
    {
      name: "Marcus",
      role: "merchant",
      room: 3,
      goal: "Negotiate a profitable trade agreement with the caravan",
      personality: "Shrewd but fair",
    },
    {
      name: "Lyra",
      role: "scholar",
      room: 4,
      goal: "Research the ancient texts to find knowledge about the lost kingdom",
      personality: "Curious and methodical",
    },
    {
      name: "Gareth",
      role: "innkeeper",
      room: 2,
      goal: "Prepare the tavern for the harvest festival celebration",
      personality: "Jovial and hospitable",
    },
  ];

  for (const config of agentConfigs) {
    // Create agent entity
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    addComponent(world, eid, Description);
    addComponent(world, eid, Agent);
    addComponent(world, eid, Mind);
    addComponent(world, eid, OccupiesRoom(rooms[config.room]));

    Name.value[eid] = config.name;
    Description.value[eid] = `${config.name} is a ${config.role}. ${config.personality}.`;
    Agent.role[eid] = config.role;
    Agent.active[eid] = true;
    Mind.arousal[eid] = 0.5;
    Mind.mode[eid] = "normal";

    // Create goal
    const goalEid = addEntity(world);
    addComponent(world, goalEid, Goal);
    addComponent(world, eid, HasGoal(goalEid));
    Goal.description[goalEid] = config.goal;
    Goal.priority[goalEid] = 7;
    Goal.status[goalEid] = "active";
    Goal.progress[goalEid] = 0;

    // Initialize schedule with role-appropriate routine
    const schedule = createDefaultSchedule(config.role);
    const scheduleEid = initializeSchedule(world, eid, schedule, 0.6);

    // Initialize reflection state with lower threshold for faster testing
    const reflectionStateEid = initializeReflectionState(world, eid, 30);

    // Add initial memories
    addMemory(world, eid, {
      type: "episodic",
      content: `${config.name} woke up this morning feeling motivated about their goal: ${config.goal}`,
      importance: 5,
      emotionalValence: 0.6,
    });

    addMemory(world, eid, {
      type: "semantic",
      content: `${config.name} knows they are a ${config.role} in the village and takes pride in their work.`,
      importance: 6,
      emotionalValence: 0.4,
    });

    agents.push({
      eid,
      name: config.name,
      goalEid,
      scheduleEid,
      reflectionStateEid,
      memoryCount: 2,
      reflectionCount: 0,
      planStepsCompleted: 0,
    });

    console.log(`  Created agent: ${config.name} (${config.role})`);
    console.log(`    Goal: ${config.goal}`);
    console.log(`    Location: ${Name.value[rooms[config.room]]}`);
  }

  console.log("\n[Setup] Complete!");
  console.log(`  - ${rooms.length} rooms created`);
  console.log(`  - ${agents.length} agents with full cognitive stack`);

  return {
    world,
    systemRegistry,
    rooms,
    agents,
    startTime: Date.now(),
  };
}

// =============================================================================
// TEST PHASES
// =============================================================================

async function phase1_PlanGeneration(state: TestState): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("PHASE 1: PLAN GENERATION");
  console.log("=".repeat(70));
  console.log("\nTesting LLM-based plan generation for each agent's goal...\n");

  for (const agent of state.agents) {
    console.log(`\n[${agent.name}] Generating plan for goal...`);

    const plan = await generatePlanForGoal(state.world, agent.eid, agent.goalEid!);

    if (plan) {
      const planEid = createPlanEntity(state.world, agent.eid, agent.goalEid!, plan);
      agent.planEid = planEid;

      console.log(`  Generated ${plan.steps.length}-step plan:`);
      plan.steps.forEach((step, i) => {
        console.log(`    ${i + 1}. [${step.actionType}] ${step.description}`);
      });
      console.log(`  Estimated completion: ${plan.estimatedCompletion}`);
      console.log(`  Potential obstacles: ${plan.potentialObstacles.join(", ") || "None"}`);

      // Add memory about planning
      addMemory(state.world, agent.eid, {
        type: "episodic",
        content: `${agent.name} formulated a detailed plan to achieve their goal.`,
        importance: 7,
        emotionalValence: 0.5,
      });
      agent.memoryCount++;
      accumulateImportance(state.world, agent.eid, 7);
    } else {
      console.log(`  Failed to generate plan for ${agent.name}`);
    }
  }
}

async function phase2_ScheduleAwareness(state: TestState): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("PHASE 2: SCHEDULE AWARENESS");
  console.log("=".repeat(70));
  console.log("\nTesting that agents are aware of their daily schedules...\n");

  const currentHour = new Date().getHours();
  console.log(`Current hour: ${currentHour}:00`);

  for (const agent of state.agents) {
    console.log(`\n[${agent.name}]`);

    const current = getCurrentActivity(state.world, agent.eid);
    const next = getNextActivity(state.world, agent.eid);
    const canInterrupt = canInterruptCurrentActivity(state.world, agent.eid);
    const flexibility = getScheduleFlexibility(state.world, agent.eid);

    console.log(`  Current activity: ${current ? `${current.name} (priority: ${current.priority})` : "Free time"}`);
    console.log(`  Can interrupt: ${canInterrupt ? "Yes" : "No"}`);
    console.log(`  Schedule flexibility: ${(flexibility * 100).toFixed(0)}%`);

    if (next) {
      console.log(`  Next activity: ${next.activity.name} in ${next.hoursUntil} hours`);
    }

    // Format full schedule context
    const scheduleContext = formatScheduleForContext(state.world, agent.eid);
    if (scheduleContext) {
      console.log(`  [Schedule context available for cognition]`);
    }
  }
}

async function phase3_PlanExecution(state: TestState): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("PHASE 3: PLAN EXECUTION SIMULATION");
  console.log("=".repeat(70));
  console.log("\nSimulating agents executing their plans step by step...\n");

  // Simulate 3 rounds of plan execution
  for (let round = 1; round <= 3; round++) {
    console.log(`\n--- Round ${round} ---`);

    for (const agent of state.agents) {
      if (!agent.planEid) continue;

      const currentStep = getCurrentStep(agent.planEid);
      if (!currentStep) {
        console.log(`  [${agent.name}] Plan completed!`);
        continue;
      }

      console.log(`  [${agent.name}] Executing: ${currentStep.description}`);

      // Simulate completing the step
      const success = Math.random() > 0.2; // 80% success rate

      if (success) {
        const hasMoreSteps = advancePlanStep(agent.planEid);
        agent.planStepsCompleted++;

        // Add memory about completing step
        addMemory(state.world, agent.eid, {
          type: "episodic",
          content: `${agent.name} successfully completed: ${currentStep.description}`,
          importance: 5 + Math.random() * 3,
          emotionalValence: 0.4 + Math.random() * 0.4,
        });
        agent.memoryCount++;
        accumulateImportance(state.world, agent.eid, 5 + Math.random() * 3);

        console.log(`    -> Success! ${hasMoreSteps ? "Moving to next step" : "Plan complete!"}`);
      } else {
        console.log(`    -> Encountered obstacle, will retry`);

        // Add memory about obstacle
        addMemory(state.world, agent.eid, {
          type: "episodic",
          content: `${agent.name} encountered a setback while trying to: ${currentStep.description}`,
          importance: 6,
          emotionalValence: -0.3,
        });
        agent.memoryCount++;
        accumulateImportance(state.world, agent.eid, 6);
      }
    }
  }
}

async function phase4_ReflectionTrigger(state: TestState): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("PHASE 4: REFLECTION TRIGGERING");
  console.log("=".repeat(70));
  console.log("\nTesting reflection system with accumulated importance...\n");

  for (const agent of state.agents) {
    const reflectionStateEid = getRelationTargets(state.world, agent.eid, HasReflectionState)[0];
    if (!reflectionStateEid) continue;

    const accumImportance = ReflectionState.importanceAccum[reflectionStateEid];
    const threshold = ReflectionState.reflectionThreshold[reflectionStateEid];
    const needs = shouldReflect(state.world, agent.eid);

    console.log(`\n[${agent.name}]`);
    console.log(`  Accumulated importance: ${accumImportance?.toFixed(1)} / ${threshold}`);
    console.log(`  Memory count: ${agent.memoryCount}`);
    console.log(`  Needs reflection: ${needs ? "YES" : "No"}`);

    if (needs) {
      console.log(`  Triggering reflection...`);
      const reflected = await maybeReflect(state.world, agent.eid);

      if (reflected) {
        agent.reflectionCount++;
        const insights = getRecentInsights(state.world, agent.eid, 3);
        console.log(`  Generated ${insights.length} insights:`);
        for (const insight of insights) {
          console.log(`    - ${insight}`);
        }
      }
    } else {
      // Add more importance to trigger reflection
      console.log(`  Adding more experiences to trigger reflection...`);

      addMemory(state.world, agent.eid, {
        type: "episodic",
        content: `${agent.name} had an important realization about their progress today.`,
        importance: 15,
        emotionalValence: 0.7,
      });
      accumulateImportance(state.world, agent.eid, 15);
      agent.memoryCount++;

      // Try again
      const reflected = await maybeReflect(state.world, agent.eid);
      if (reflected) {
        agent.reflectionCount++;
        const insights = getRecentInsights(state.world, agent.eid, 3);
        console.log(`  Generated ${insights.length} insights:`);
        for (const insight of insights) {
          console.log(`    - ${insight}`);
        }
      }
    }
  }
}

async function phase5_IntegratedContext(state: TestState): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("PHASE 5: INTEGRATED COGNITION CONTEXT");
  console.log("=".repeat(70));
  console.log("\nVerifying all systems provide context for agent cognition...\n");

  for (const agent of state.agents) {
    console.log(`\n[${agent.name}] Context Integration:`);

    // Check plans context
    const plansContext = formatPlansForContext(state.world, agent.eid);
    console.log(`  Plans context: ${plansContext ? `${plansContext.length} chars` : "None"}`);

    // Check schedule context
    const scheduleContext = formatScheduleForContext(state.world, agent.eid);
    console.log(`  Schedule context: ${scheduleContext ? `${scheduleContext.length} chars` : "None"}`);

    // Check insights context
    const insightsContext = formatInsightsForContext(state.world, agent.eid);
    console.log(`  Insights context: ${insightsContext ? `${insightsContext.length} chars` : "None"}`);

    // Sample the combined context that would go to LLM
    const combinedContextLength =
      (plansContext?.length || 0) +
      (scheduleContext?.length || 0) +
      (insightsContext?.length || 0);
    console.log(`  Total cognitive context: ${combinedContextLength} chars`);

    // Verify active plans
    const activePlans = getAgentPlans(state.world, agent.eid);
    console.log(`  Active plans: ${activePlans.length}`);

    // Verify memories
    const memories = getAgentMemories(state.world, agent.eid).slice(0, 5);
    console.log(`  Recent memories: ${memories.length}`);
  }
}

// =============================================================================
// FINAL REPORT
// =============================================================================

function generateReport(state: TestState): void {
  console.log("\n" + "=".repeat(70));
  console.log("FINAL REPORT");
  console.log("=".repeat(70));

  const runtime = (Date.now() - state.startTime) / 1000;
  console.log(`\nTest runtime: ${runtime.toFixed(1)} seconds`);

  console.log("\n📊 AGENT STATISTICS:");
  console.log("-".repeat(50));

  let totalPlansGenerated = 0;
  let totalStepsCompleted = 0;
  let totalReflections = 0;
  let totalMemories = 0;

  for (const agent of state.agents) {
    const hasPlans = agent.planEid ? 1 : 0;
    totalPlansGenerated += hasPlans;
    totalStepsCompleted += agent.planStepsCompleted;
    totalReflections += agent.reflectionCount;
    totalMemories += agent.memoryCount;

    const planStatus = agent.planEid ? Plan.status[agent.planEid] : "none";

    console.log(`\n  ${agent.name}:`);
    console.log(`    Plans: ${hasPlans > 0 ? `1 (${planStatus})` : "None"}`);
    console.log(`    Steps completed: ${agent.planStepsCompleted}`);
    console.log(`    Reflections: ${agent.reflectionCount}`);
    console.log(`    Memories: ${agent.memoryCount}`);
  }

  console.log("\n" + "-".repeat(50));
  console.log("TOTALS:");
  console.log(`  Plans generated: ${totalPlansGenerated}/${state.agents.length}`);
  console.log(`  Steps completed: ${totalStepsCompleted}`);
  console.log(`  Reflections triggered: ${totalReflections}`);
  console.log(`  Memories created: ${totalMemories}`);

  // Validation
  console.log("\n✅ VALIDATION:");
  const checks = [
    { name: "Plans generated for all agents", pass: totalPlansGenerated === state.agents.length },
    { name: "Some plan steps completed", pass: totalStepsCompleted > 0 },
    { name: "At least one reflection occurred", pass: totalReflections > 0 },
    { name: "Memories accumulated", pass: totalMemories > state.agents.length * 2 },
  ];

  let allPassed = true;
  for (const check of checks) {
    console.log(`  ${check.pass ? "✓" : "✗"} ${check.name}`);
    if (!check.pass) allPassed = false;
  }

  console.log("\n" + "=".repeat(70));
  console.log(allPassed ? "TEST PASSED" : "TEST FAILED - Some validations did not pass");
  console.log("=".repeat(70));
}

// =============================================================================
// RUN TEST
// =============================================================================

async function runTest(): Promise<void> {
  console.log("╔═══════════════════════════════════════════════════════════════════════╗");
  console.log("║        COGNITIVE ENHANCEMENTS INTEGRATION TEST                        ║");
  console.log("║        Planning + Reflection + Schedule Systems                       ║");
  console.log("╚═══════════════════════════════════════════════════════════════════════╝");

  const state = setupTest();

  try {
    // Phase 1: Generate plans using LLM
    await phase1_PlanGeneration(state);

    // Phase 2: Test schedule awareness
    await phase2_ScheduleAwareness(state);

    // Phase 3: Simulate plan execution
    await phase3_PlanExecution(state);

    // Phase 4: Trigger reflections
    await phase4_ReflectionTrigger(state);

    // Phase 5: Verify integrated context
    await phase5_IntegratedContext(state);

    // Final report
    generateReport(state);
  } catch (error) {
    console.error("\n❌ TEST ERROR:", error);
    throw error;
  }
}

// Run the test
runTest().catch(console.error);
