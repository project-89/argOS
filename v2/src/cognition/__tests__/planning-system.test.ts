/**
 * Unit Tests for Planning System
 *
 * Tests:
 * - Plan creation and storage
 * - Step advancement
 * - Plan status transitions
 * - Context formatting
 */

import "dotenv/config";
import { addEntity, addComponent, query, hasComponent, getRelationTargets } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Name, Description, Agent, Mind, Goal, Plan, Room } from "../../ecs/components";
import { HasGoal, HasPlan, OccupiesRoom } from "../../ecs/relations";
import {
  generatePlanForGoal,
  createPlanEntity,
  getCurrentStep,
  advancePlanStep,
  failPlan,
  getPlanForGoal,
  getAgentPlans,
  getNextPlannedAction,
  formatPlansForContext,
  runPlanningSystem,
  type PlanStep,
  type GeneratedPlan,
} from "../planning-system";

// =============================================================================
// TEST HELPERS
// =============================================================================

function createTestWorld() {
  return createArgosWorld("Test World");
}

function createTestAgent(world: ReturnType<typeof createArgosWorld>, name: string, role: string = "villager") {
  const eid = addEntity(world);
  addComponent(world, eid, Name);
  addComponent(world, eid, Description);
  addComponent(world, eid, Agent);
  addComponent(world, eid, Mind);

  Name.value[eid] = name;
  Description.value[eid] = `A test agent named ${name}`;
  Agent.role[eid] = role;
  Agent.active[eid] = true;
  Mind.arousal[eid] = 0.5;
  Mind.mode[eid] = "normal";

  return eid;
}

function createTestGoal(world: ReturnType<typeof createArgosWorld>, agentEid: number, description: string, priority: number = 5) {
  const goalEid = addEntity(world);
  addComponent(world, goalEid, Goal);
  addComponent(world, agentEid, HasGoal(goalEid));

  Goal.description[goalEid] = description;
  Goal.priority[goalEid] = priority;
  Goal.status[goalEid] = "active";
  Goal.progress[goalEid] = 0;

  return goalEid;
}

function createTestRoom(world: ReturnType<typeof createArgosWorld>, name: string) {
  const eid = addEntity(world);
  addComponent(world, eid, Name);
  addComponent(world, eid, Room);
  Name.value[eid] = name;
  Room.capacity[eid] = 10;
  return eid;
}

// =============================================================================
// TESTS
// =============================================================================

describe("Planning System", () => {
  describe("Plan Entity Creation", () => {
    test("should create a plan entity with correct structure", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Alice");
      const goalEid = createTestGoal(world, agentEid, "Find food");

      const mockPlan: GeneratedPlan = {
        goalDescription: "Find food",
        steps: [
          { description: "Look around for food sources", actionType: "observe", target: "surroundings" },
          { description: "Go to the market", actionType: "move", target: "Market" },
          { description: "Buy some bread", actionType: "interact", target: "merchant", content: "buy bread" },
        ],
        estimatedCompletion: "short",
        potentialObstacles: ["No money", "Market closed"],
      };

      const planEid = createPlanEntity(world, agentEid, goalEid, mockPlan);

      expect(hasComponent(world, planEid, Plan)).toBe(true);
      expect(Plan.goalEid[planEid]).toBe(goalEid);
      expect(Plan.currentStep[planEid]).toBe(0);
      expect(Plan.status[planEid]).toBe("active");

      const steps = JSON.parse(Plan.steps[planEid]);
      expect(steps.length).toBe(3);
      expect(steps[0].actionType).toBe("observe");
    });

    test("should link plan to agent via HasPlan relation", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Bob");
      const goalEid = createTestGoal(world, agentEid, "Build a house");

      const mockPlan: GeneratedPlan = {
        goalDescription: "Build a house",
        steps: [{ description: "Gather wood", actionType: "interact", target: "forest" }],
        estimatedCompletion: "long",
        potentialObstacles: [],
      };

      createPlanEntity(world, agentEid, goalEid, mockPlan);

      const planTargets = getRelationTargets(world, agentEid, HasPlan);
      expect(planTargets.length).toBe(1);
    });
  });

  describe("Step Management", () => {
    test("should get current step correctly", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Charlie");
      const goalEid = createTestGoal(world, agentEid, "Test goal");

      const mockPlan: GeneratedPlan = {
        goalDescription: "Test goal",
        steps: [
          { description: "Step 1", actionType: "speak", content: "Hello" },
          { description: "Step 2", actionType: "move", target: "Home" },
        ],
        estimatedCompletion: "short",
        potentialObstacles: [],
      };

      const planEid = createPlanEntity(world, agentEid, goalEid, mockPlan);

      const currentStep = getCurrentStep(planEid);
      expect(currentStep).not.toBeNull();
      expect(currentStep!.description).toBe("Step 1");
      expect(currentStep!.actionType).toBe("speak");
    });

    test("should advance to next step", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Diana");
      const goalEid = createTestGoal(world, agentEid, "Multi-step goal");

      const mockPlan: GeneratedPlan = {
        goalDescription: "Multi-step goal",
        steps: [
          { description: "Step 1", actionType: "observe" },
          { description: "Step 2", actionType: "speak" },
          { description: "Step 3", actionType: "wait" },
        ],
        estimatedCompletion: "medium",
        potentialObstacles: [],
      };

      const planEid = createPlanEntity(world, agentEid, goalEid, mockPlan);

      expect(Plan.currentStep[planEid]).toBe(0);

      const advanced = advancePlanStep(planEid);
      expect(advanced).toBe(true);
      expect(Plan.currentStep[planEid]).toBe(1);

      const currentStep = getCurrentStep(planEid);
      expect(currentStep!.description).toBe("Step 2");
    });

    test("should complete plan when last step is advanced", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Eve");
      const goalEid = createTestGoal(world, agentEid, "Short goal");

      const mockPlan: GeneratedPlan = {
        goalDescription: "Short goal",
        steps: [{ description: "Only step", actionType: "think" }],
        estimatedCompletion: "short",
        potentialObstacles: [],
      };

      const planEid = createPlanEntity(world, agentEid, goalEid, mockPlan);

      const advanced = advancePlanStep(planEid);
      expect(advanced).toBe(false); // No more steps
      expect(Plan.status[planEid]).toBe("completed");
    });

    test("should fail plan when failPlan is called", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Frank");
      const goalEid = createTestGoal(world, agentEid, "Failing goal");

      const mockPlan: GeneratedPlan = {
        goalDescription: "Failing goal",
        steps: [{ description: "Step", actionType: "interact" }],
        estimatedCompletion: "short",
        potentialObstacles: [],
      };

      const planEid = createPlanEntity(world, agentEid, goalEid, mockPlan);

      failPlan(planEid, "Obstacle encountered");
      expect(Plan.status[planEid]).toBe("failed");
    });
  });

  describe("Plan Queries", () => {
    test("should get plan for specific goal", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Grace");
      const goal1Eid = createTestGoal(world, agentEid, "Goal 1");
      const goal2Eid = createTestGoal(world, agentEid, "Goal 2");

      const mockPlan1: GeneratedPlan = {
        goalDescription: "Goal 1",
        steps: [{ description: "Plan 1 step", actionType: "speak" }],
        estimatedCompletion: "short",
        potentialObstacles: [],
      };

      const mockPlan2: GeneratedPlan = {
        goalDescription: "Goal 2",
        steps: [{ description: "Plan 2 step", actionType: "move" }],
        estimatedCompletion: "short",
        potentialObstacles: [],
      };

      const plan1Eid = createPlanEntity(world, agentEid, goal1Eid, mockPlan1);
      const plan2Eid = createPlanEntity(world, agentEid, goal2Eid, mockPlan2);

      expect(getPlanForGoal(world, agentEid, goal1Eid)).toBe(plan1Eid);
      expect(getPlanForGoal(world, agentEid, goal2Eid)).toBe(plan2Eid);
    });

    test("should get all active plans for agent", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Henry");
      const goal1Eid = createTestGoal(world, agentEid, "Active Goal 1");
      const goal2Eid = createTestGoal(world, agentEid, "Active Goal 2");

      const mockPlan: GeneratedPlan = {
        goalDescription: "Plan",
        steps: [{ description: "Step", actionType: "wait" }],
        estimatedCompletion: "short",
        potentialObstacles: [],
      };

      createPlanEntity(world, agentEid, goal1Eid, mockPlan);
      const plan2Eid = createPlanEntity(world, agentEid, goal2Eid, mockPlan);

      // Complete one plan
      Plan.status[plan2Eid] = "completed";

      const activePlans = getAgentPlans(world, agentEid);
      expect(activePlans.length).toBe(1);
    });

    test("should get next planned action from highest priority goal", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Ivy");
      const lowPriorityGoal = createTestGoal(world, agentEid, "Low priority", 3);
      const highPriorityGoal = createTestGoal(world, agentEid, "High priority", 8);

      const lowPlan: GeneratedPlan = {
        goalDescription: "Low priority",
        steps: [{ description: "Low step", actionType: "wait" }],
        estimatedCompletion: "short",
        potentialObstacles: [],
      };

      const highPlan: GeneratedPlan = {
        goalDescription: "High priority",
        steps: [{ description: "High step", actionType: "speak", content: "Important!" }],
        estimatedCompletion: "short",
        potentialObstacles: [],
      };

      createPlanEntity(world, agentEid, lowPriorityGoal, lowPlan);
      createPlanEntity(world, agentEid, highPriorityGoal, highPlan);

      const nextAction = getNextPlannedAction(world, agentEid);
      expect(nextAction).not.toBeNull();
      expect(nextAction!.description).toBe("High step");
    });
  });

  describe("Context Formatting", () => {
    test("should format plans for context correctly", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Jack");
      const goalEid = createTestGoal(world, agentEid, "Test formatting");

      const mockPlan: GeneratedPlan = {
        goalDescription: "Test formatting",
        steps: [
          { description: "First step", actionType: "observe" },
          { description: "Second step", actionType: "speak" },
        ],
        estimatedCompletion: "short",
        potentialObstacles: [],
      };

      createPlanEntity(world, agentEid, goalEid, mockPlan);

      const context = formatPlansForContext(world, agentEid);
      expect(context).toContain("ACTIVE PLANS");
      expect(context).toContain("Test formatting");
      expect(context).toContain("Step 1/2");
      expect(context).toContain("Current: First step");
      expect(context).toContain("Next: Second step");
    });

    test("should return empty string when no plans", () => {
      const world = createTestWorld();
      const agentEid = createTestAgent(world, "Kate");

      const context = formatPlansForContext(world, agentEid);
      expect(context).toBe("");
    });
  });

  describe("LLM Plan Generation", () => {
    test("should generate plan for goal via LLM", async () => {
      const world = createTestWorld();
      const roomEid = createTestRoom(world, "Village Square");
      const agentEid = createTestAgent(world, "Luna", "merchant");
      addComponent(world, agentEid, OccupiesRoom(roomEid));

      const goalEid = createTestGoal(world, agentEid, "Sell goods at the market");

      const plan = await generatePlanForGoal(world, agentEid, goalEid);

      expect(plan).not.toBeNull();
      expect(plan!.steps.length).toBeGreaterThanOrEqual(1);
      expect(plan!.steps.length).toBeLessThanOrEqual(7);

      // Each step should have valid action type
      for (const step of plan!.steps) {
        expect(["speak", "move", "interact", "observe", "think", "wait"]).toContain(step.actionType);
      }
    }, 30000); // 30s timeout for LLM call

    test("should run planning system for all agents", async () => {
      const world = createTestWorld();
      const roomEid = createTestRoom(world, "Town Hall");

      // Create agents with goals
      const agent1 = createTestAgent(world, "Agent1");
      const agent2 = createTestAgent(world, "Agent2");
      addComponent(world, agent1, OccupiesRoom(roomEid));
      addComponent(world, agent2, OccupiesRoom(roomEid));

      createTestGoal(world, agent1, "Find a job");
      createTestGoal(world, agent2, "Make friends");

      // Run planning system
      await runPlanningSystem(world);

      // Both agents should have plans now
      const agent1Plans = getAgentPlans(world, agent1);
      const agent2Plans = getAgentPlans(world, agent2);

      expect(agent1Plans.length).toBe(1);
      expect(agent2Plans.length).toBe(1);
    }, 60000); // 60s timeout for multiple LLM calls
  });
});
