import { World, query, hasComponent, setComponent } from "bitecs";
import { Agent, Action, Appearance, Thought, Goal, Plan } from "../components";
import { generateThought } from "../llm/agent-llm";
import { logger } from "../utils/logger";
import { createSystem } from "./System";
import { processConcurrentAgents } from "../utils/system-utils";
import { ThoughtEntry } from "../components/Thought";
import { getActivePlans } from "../components/Plans";
import { getRoomInfo } from "../utils/queries";

export const ThinkingSystem2 = createSystem(
  (runtime) => async (world: World) => {
    // Query for agents with all required components
    const agents = query(world, [
      Agent,
      Action,
      Appearance,
      Thought,
      Goal,
      Plan,
    ]);

    await processConcurrentAgents(
      world,
      agents,
      "ThinkingSystem2",
      async (eid) => {
        if (!Agent.active[eid]) return;

        // Initialize Thought component if needed
        if (!hasComponent(world, eid, Thought)) {
          setComponent(world, eid, Thought, {
            entries: [],
            lastEntryId: 0,
            lastUpdate: Date.now(),
          });
        }

        // Get recent thought entries for context
        const recentEntries = (
          (Thought.entries[eid] || []) as ThoughtEntry[]
        ).slice(-10);

        // Get room information
        const roomInfo = getRoomInfo(world, eid);

        // Get current goals and plans
        const currentGoals = (Goal.current[eid] || []).map((goal) => ({
          id: goal.id,
          description: goal.description,
          type: goal.type,
          priority: goal.priority,
          progress: goal.progress,
          status: goal.status || "in_progress",
          success_criteria: goal.success_criteria || [],
          progress_indicators: goal.progress_indicators || [],
          created_at: goal.created_at || Date.now(),
        }));

        const currentPlans = Plan.plans[eid] || [];
        const activePlans = getActivePlans(currentPlans).map((plan) => ({
          id: plan.id,
          goalId: plan.goalId,
          steps: plan.steps.map((step) => ({
            id: step.id,
            description: step.description,
            status: (step.status === "in_progress"
              ? "in_progress"
              : step.status) as
              | "pending"
              | "in_progress"
              | "completed"
              | "failed",
            expectedOutcome:
              step.expectedOutcome || "Complete the step successfully",
            requiredTools: [] as string[],
          })),
          currentStepId: plan.currentStepId,
          status: "active" as const,
        }));

        try {
          // Generate thought with chain of thought context
          const thoughtResult = await generateThought({
            id: String(eid),
            name: Agent.name[eid],
            role: Agent.role[eid],
            systemPrompt: Agent.systemPrompt[eid],
            active: Boolean(Agent.active[eid]),
            platform: Agent.platform[eid],
            attention: Agent.attention[eid],
            perceptions: {
              narrative:
                recentEntries
                  .filter((entry) => entry.type === "perception")
                  .slice(-3)
                  .map((entry) => entry.content)
                  .join("\n") || "",
              raw: recentEntries
                .filter((entry) => entry.type === "perception")
                .slice(-3)
                .flatMap((entry) => entry.context?.metadata?.stimuli || []),
            },
            lastAction: Action.lastActionResult[eid],
            timeSinceLastAction: Action.lastActionTime[eid]
              ? Date.now() - Action.lastActionTime[eid]
              : 0,
            thoughtChain: recentEntries.map((entry) => ({
              type: entry.type,
              content: entry.content,
              timestamp: entry.timestamp,
            })),
            availableTools: runtime.getActionManager().getEntityTools(eid),
            goals: Goal.current[eid] || [],
            completedGoals: Goal.completed[eid] || [],
            activePlans: activePlans.map((plan) => ({
              ...plan,
              description: plan.steps[0]?.description || "Execute plan steps",
              priority: 1,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              steps: plan.steps.map((step, index) => ({
                ...step,
                order: index,
                estimatedDuration: 0,
                startTime: Date.now(),
                endTime: undefined,
              })),
            })),
            appearance: {
              description: Appearance.baseDescription[eid],
              facialExpression: Appearance.facialExpression[eid],
              bodyLanguage: Appearance.bodyLanguage[eid],
              currentAction: Appearance.currentAction[eid],
              socialCues: Appearance.socialCues[eid],
            },
          });

          // Create new thought entry
          const newEntry: ThoughtEntry = {
            id: Thought.lastEntryId[eid] + 1,
            timestamp: Date.now(),
            type: "thought",
            content: thoughtResult.thought,
            context: {
              roomId: roomInfo.id,
              metadata: {
                action: thoughtResult.action,
                appearance: thoughtResult.appearance,
                goals: currentGoals,
                activePlans: activePlans,
              },
            },
          };

          // Update Thought component
          const updatedEntries = [...(Thought.entries[eid] || []), newEntry];
          setComponent(world, eid, Thought, {
            entries: updatedEntries,
            lastEntryId: newEntry.id,
            lastUpdate: Date.now(),
          });

          // Handle action if present
          if (thoughtResult.action) {
            setComponent(world, eid, Action, {
              pendingAction: thoughtResult.action,
              lastActionTime: Date.now(),
              availableTools: Action.availableTools[eid],
            });
          }

          // Update appearance if present
          if (thoughtResult.appearance) {
            setComponent(world, eid, Appearance, {
              description:
                thoughtResult.appearance.description ||
                Appearance.description[eid],
              baseDescription: Appearance.baseDescription[eid],
              facialExpression:
                thoughtResult.appearance.facialExpression ||
                Appearance.facialExpression[eid],
              bodyLanguage:
                thoughtResult.appearance.bodyLanguage ||
                Appearance.bodyLanguage[eid],
              currentAction:
                thoughtResult.appearance.currentAction ||
                Appearance.currentAction[eid],
              socialCues:
                thoughtResult.appearance.socialCues ||
                Appearance.socialCues[eid],
              lastUpdate: Date.now(),
            });
          }

          // Emit thought event
          runtime.eventBus.emitAgentEvent(eid, "thought", "thought", {
            content: thoughtResult.thought,
            thoughtEntryId: newEntry.id,
            hasAction: !!thoughtResult.action,
            hasAppearanceChange: !!thoughtResult.appearance,
          });

          logger.debug(`Generated thought for agent ${Agent.name[eid]}:`, {
            thoughtId: newEntry.id,
            hasAction: !!thoughtResult.action,
            hasAppearanceChange: !!thoughtResult.appearance,
          });

          return {
            thoughtId: newEntry.id,
            hasAction: !!thoughtResult.action,
            hasAppearanceChange: !!thoughtResult.appearance,
          };
        } catch (error) {
          logger.error(
            `Error generating thought for agent ${Agent.name[eid]}:`,
            error
          );
        }
      }
    );

    return world;
  }
);
