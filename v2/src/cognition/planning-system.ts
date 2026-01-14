/**
 * Planning System
 *
 * Decomposes agent goals into actionable step-by-step plans.
 * Uses LLM to generate contextually appropriate plans based on:
 * - Agent's current situation and capabilities
 * - Goal description and priority
 * - Available actions and resources
 *
 * Plans are stored as Plan entities linked to goals via HasPlan relation.
 */

import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import type { World } from "../ecs/world";
import { addEntity, addComponent, query, getRelationTargets, hasComponent, removeEntity } from "bitecs";
import { Name, Description, Agent, Goal, Plan, Mind, Room } from "../ecs/components";
import { HasGoal, HasPlan, OccupiesRoom } from "../ecs/relations";
import { getKnowledgeSummary } from "./knowledge-graph";

const model = google("gemini-2.0-flash");

export interface PlanStep {
  description: string;
  actionType: "speak" | "move" | "interact" | "observe" | "think" | "wait";
  target?: string;
  content?: string;
  estimatedDuration?: string;
  prerequisites?: string[];
}

export interface GeneratedPlan {
  goalDescription: string;
  steps: PlanStep[];
  estimatedCompletion: string;
  potentialObstacles: string[];
  fallbackStrategy?: string;
}

/**
 * Get existing plan for a goal, if any
 */
export function getPlanForGoal(world: World, agentEid: number, goalEid: number): number | undefined {
  const planTargets = getRelationTargets(world, agentEid, HasPlan);
  for (const planEid of planTargets) {
    if (hasComponent(world, planEid, Plan) && Plan.goalEid[planEid] === goalEid) {
      return planEid;
    }
  }
  return undefined;
}

/**
 * Get all active plans for an agent
 */
export function getAgentPlans(world: World, agentEid: number): number[] {
  const planTargets = getRelationTargets(world, agentEid, HasPlan);
  return planTargets.filter(eid =>
    hasComponent(world, eid, Plan) && Plan.status[eid] === "active"
  );
}

/**
 * Build context for plan generation
 */
function buildPlanningContext(world: World, agentEid: number, goalEid: number): string {
  const agentName = Name.value[agentEid];
  const agentDesc = Description.value[agentEid];
  const agentRole = Agent.role[agentEid];
  const goalDesc = Goal.description[goalEid];
  const goalPriority = Goal.priority[goalEid];
  const goalProgress = Goal.progress[goalEid] || 0;

  // Get location
  const roomTargets = getRelationTargets(world, agentEid, OccupiesRoom);
  const roomName = roomTargets.length > 0 ? Name.value[roomTargets[0]] : "unknown location";

  // Get knowledge summary
  const knowledge = getKnowledgeSummary(world, agentEid);

  // Get other goals for context
  const goalTargets = getRelationTargets(world, agentEid, HasGoal);
  const otherGoals = goalTargets
    .filter(gid => gid !== goalEid && hasComponent(world, gid, Goal))
    .map(gid => `- ${Goal.description[gid]} (priority: ${Goal.priority[gid]})`)
    .slice(0, 3);

  return `You are creating a plan for an agent in a simulation.

AGENT:
- Name: ${agentName}
- Description: ${agentDesc}
- Role: ${agentRole}
- Current Location: ${roomName}
- Mental State: Arousal ${((Mind.arousal[agentEid] || 0.5) * 100).toFixed(0)}%

GOAL TO PLAN FOR:
- Description: ${goalDesc}
- Priority: ${goalPriority}/10
- Current Progress: ${goalProgress}%

${otherGoals.length > 0 ? `OTHER ACTIVE GOALS:\n${otherGoals.join("\n")}` : ""}

${knowledge ? `AGENT'S KNOWLEDGE:\n${knowledge}` : ""}

AVAILABLE ACTIONS:
- speak: Say something (requires content)
- move: Go to a location (requires target location name)
- interact: Physical interaction with object/person (requires target and content)
- observe: Pay attention to something (requires target)
- think: Internal reflection (requires content)
- wait: Do nothing for a moment`;
}

/**
 * Generate a plan for a goal using LLM
 */
export async function generatePlanForGoal(
  world: World,
  agentEid: number,
  goalEid: number
): Promise<GeneratedPlan | null> {
  const context = buildPlanningContext(world, agentEid, goalEid);
  const goalDesc = Goal.description[goalEid];

  const prompt = `Create a concrete, actionable plan to achieve this goal: "${goalDesc}"

The plan should:
1. Have 3-7 clear steps that can be executed by the agent
2. Each step should map to an available action type
3. Consider the agent's current location and knowledge
4. Be achievable given the simulation constraints

Respond with JSON only:
{
  "goalDescription": "restated goal",
  "steps": [
    {
      "description": "What to do in plain language",
      "actionType": "speak|move|interact|observe|think|wait",
      "target": "optional - who/what/where",
      "content": "optional - what to say/do",
      "estimatedDuration": "short|medium|long",
      "prerequisites": ["optional list of things that must be true first"]
    }
  ],
  "estimatedCompletion": "short|medium|long",
  "potentialObstacles": ["things that might prevent success"],
  "fallbackStrategy": "what to do if plan fails"
}`;

  try {
    const { text } = await generateText({
      model,
      system: context,
      prompt,
    });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[Planning] Failed to parse plan JSON");
      return null;
    }

    const plan = JSON.parse(jsonMatch[0]) as GeneratedPlan;
    console.log(`[Planning] Generated ${plan.steps.length}-step plan for "${goalDesc.slice(0, 40)}..."`);
    return plan;
  } catch (error) {
    console.error("[Planning] Error generating plan:", error);
    return null;
  }
}

/**
 * Create a Plan entity from a generated plan
 */
export function createPlanEntity(
  world: World,
  agentEid: number,
  goalEid: number,
  generatedPlan: GeneratedPlan
): number {
  const planEid = addEntity(world);
  addComponent(world, planEid, Plan);
  addComponent(world, agentEid, HasPlan(planEid));

  Plan.goalEid[planEid] = goalEid;
  Plan.steps[planEid] = JSON.stringify(generatedPlan.steps);
  Plan.currentStep[planEid] = 0;
  Plan.status[planEid] = "active";
  Plan.createdAt[planEid] = Date.now();
  Plan.lastUpdated[planEid] = Date.now();

  const agentName = Name.value[agentEid];
  console.log(`[Planning] Created plan for ${agentName}: ${generatedPlan.steps.length} steps`);

  return planEid;
}

/**
 * Get the current step of a plan
 */
export function getCurrentStep(planEid: number): PlanStep | null {
  const stepsJson = Plan.steps[planEid];
  if (!stepsJson) return null;

  try {
    const steps = JSON.parse(stepsJson) as PlanStep[];
    const currentIdx = Plan.currentStep[planEid] || 0;
    return steps[currentIdx] || null;
  } catch {
    return null;
  }
}

/**
 * Advance to the next step in a plan
 */
export function advancePlanStep(planEid: number): boolean {
  const stepsJson = Plan.steps[planEid];
  if (!stepsJson) return false;

  try {
    const steps = JSON.parse(stepsJson) as PlanStep[];
    const currentIdx = Plan.currentStep[planEid] || 0;

    if (currentIdx >= steps.length - 1) {
      // Plan complete
      Plan.status[planEid] = "completed";
      Plan.lastUpdated[planEid] = Date.now();
      return false;
    }

    Plan.currentStep[planEid] = currentIdx + 1;
    Plan.lastUpdated[planEid] = Date.now();
    return true;
  } catch {
    return false;
  }
}

/**
 * Mark a plan as failed
 */
export function failPlan(planEid: number, reason?: string): void {
  Plan.status[planEid] = "failed";
  Plan.lastUpdated[planEid] = Date.now();
  console.log(`[Planning] Plan ${planEid} failed${reason ? `: ${reason}` : ""}`);
}

/**
 * Check if all prerequisites for a step are met
 * (Simplified - in a full implementation, this would check world state)
 */
export function checkStepPrerequisites(world: World, agentEid: number, step: PlanStep): boolean {
  // For now, always return true - could be extended to check actual world state
  return true;
}

/**
 * Run the planning system for all agents
 * Creates plans for goals that don't have them
 */
export async function runPlanningSystem(world: World): Promise<void> {
  const agents = query(world, [Agent, Mind]);

  for (const agentEid of agents) {
    if (!Agent.active[agentEid]) continue;

    const agentName = Name.value[agentEid];
    const goalTargets = getRelationTargets(world, agentEid, HasGoal);

    for (const goalEid of goalTargets) {
      if (!hasComponent(world, goalEid, Goal)) continue;
      if (Goal.status[goalEid] !== "active") continue;

      // Check if goal already has an active plan
      const existingPlan = getPlanForGoal(world, agentEid, goalEid);
      if (existingPlan && Plan.status[existingPlan] === "active") {
        continue; // Already has a plan
      }

      // Generate a new plan
      console.log(`[Planning] Generating plan for ${agentName}'s goal: "${Goal.description[goalEid]?.slice(0, 40)}..."`);
      const generatedPlan = await generatePlanForGoal(world, agentEid, goalEid);

      if (generatedPlan) {
        createPlanEntity(world, agentEid, goalEid, generatedPlan);
      }
    }
  }
}

/**
 * Get the next action suggestion from an agent's active plans
 * Returns the current step of the highest priority goal's plan
 */
export function getNextPlannedAction(world: World, agentEid: number): PlanStep | null {
  const goalTargets = getRelationTargets(world, agentEid, HasGoal);

  // Sort by priority
  const activeGoals = goalTargets
    .filter(gid => hasComponent(world, gid, Goal) && Goal.status[gid] === "active")
    .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0));

  for (const goalEid of activeGoals) {
    const planEid = getPlanForGoal(world, agentEid, goalEid);
    if (planEid && Plan.status[planEid] === "active") {
      const step = getCurrentStep(planEid);
      if (step && checkStepPrerequisites(world, agentEid, step)) {
        return step;
      }
    }
  }

  return null;
}

/**
 * Format plans for inclusion in agent context
 */
export function formatPlansForContext(world: World, agentEid: number): string {
  const planTargets = getRelationTargets(world, agentEid, HasPlan);
  const activePlans = planTargets.filter(eid =>
    hasComponent(world, eid, Plan) && Plan.status[eid] === "active"
  );

  if (activePlans.length === 0) {
    return "";
  }

  const lines: string[] = ["ACTIVE PLANS:"];

  for (const planEid of activePlans) {
    const goalEid = Plan.goalEid[planEid];
    const goalDesc = Goal.description[goalEid] || "Unknown goal";
    const stepsJson = Plan.steps[planEid];
    const currentIdx = Plan.currentStep[planEid] || 0;

    try {
      const steps = JSON.parse(stepsJson) as PlanStep[];
      lines.push(`\nGoal: ${goalDesc}`);
      lines.push(`Progress: Step ${currentIdx + 1}/${steps.length}`);

      // Show current and next steps
      const currentStep = steps[currentIdx];
      if (currentStep) {
        lines.push(`Current: ${currentStep.description}`);
      }

      const nextStep = steps[currentIdx + 1];
      if (nextStep) {
        lines.push(`Next: ${nextStep.description}`);
      }
    } catch {
      continue;
    }
  }

  return lines.join("\n");
}
