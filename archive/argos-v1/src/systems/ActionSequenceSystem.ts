import { World, query, hasComponent, addComponent, setComponent } from "bitecs";
import {
  Agent,
  Action,
  ActionMemory,
  Goal,
  Plan,
  Thought,
  ActionResultType,
} from "../components";
import {
  ActionSequence,
  startNewSequence,
  addActionToSequence,
  completeSequence,
  findSimilarSequences,
} from "../components/ActionMemory";
import { generateReflection } from "../llm/agent-llm";
import { logger } from "../utils/logger";
import { createSystem } from "./System";
import { getActivePlans } from "../components/Plans";

/**
 * ActionSequenceSystem handles:
 * 1. Tracking sequences of actions
 * 2. Generating reflections on completed sequences
 * 3. Associating sequences with goals and plans
 * 4. Providing relevant past sequences for future planning
 */
export const ActionSequenceSystem = createSystem(
  (runtime) => async (world: World) => {
    // Query for agents with required components
    const agents = query(world, [Agent, Action, Goal, Plan]);

    for (const eid of agents) {
      if (!Agent.active[eid]) continue;

      // Initialize ActionMemory component if needed
      if (!hasComponent(world, eid, ActionMemory)) {
        addComponent(world, eid, ActionMemory);
        setComponent(world, eid, ActionMemory, {
          sequences: [],
          currentSequence: undefined,
          lastUpdate: Date.now(),
        });
      }

      // Get the last action result
      const lastActionResult = Action.lastActionResult[eid] as ActionResultType;

      // Skip if no action has been performed yet
      if (!lastActionResult) continue;

      // Get current sequence or create a new one
      let currentSequence = ActionMemory.currentSequence[eid] as
        | ActionSequence
        | undefined;

      // Get active goals and plans for context
      const activeGoals = Goal.current[eid] || [];
      const activePlans = getActivePlans(Plan.plans[eid] || []);

      // If no current sequence, start a new one
      if (!currentSequence) {
        // Find the active goal with highest priority
        const primaryGoal = [...activeGoals].sort(
          (a, b) => b.priority - a.priority
        )[0];

        // Find active plan for the primary goal
        const relatedPlan = activePlans.find(
          (plan) => primaryGoal && plan.goalId === primaryGoal.id
        );

        const description = relatedPlan
          ? `Executing plan: ${relatedPlan.description}`
          : primaryGoal
          ? `Working toward goal: ${primaryGoal.description}`
          : "Performing actions";

        currentSequence = startNewSequence(
          description,
          activeGoals.map((g) => g.id),
          activePlans.map((p) => p.id)
        );
      }

      // Add the last action to the sequence
      currentSequence = addActionToSequence(
        currentSequence,
        lastActionResult.action,
        lastActionResult.data || {},
        {
          success: lastActionResult.success,
          result: lastActionResult.result,
          timestamp: lastActionResult.timestamp,
        }
      );

      // Update the current sequence in the component
      setComponent(world, eid, ActionMemory, {
        sequences: ActionMemory.sequences[eid] || [],
        currentSequence,
        lastUpdate: Date.now(),
      });

      // Check if we should complete the sequence
      // We'll consider a sequence complete if:
      // 1. It has at least 3 actions, or
      // 2. A goal has been completed, or
      // 3. A plan has been completed
      const shouldCompleteSequence =
        currentSequence.actions.length >= 3 ||
        // Check if any goals were just completed
        lastActionResult.data?.completedGoals?.length > 0 ||
        // Check if any plans were just completed
        lastActionResult.data?.completedPlans?.length > 0;

      if (shouldCompleteSequence) {
        try {
          // Generate a reflection on the sequence
          const reflection = await generateReflection({
            agentId: String(eid),
            agentName: Agent.name[eid],
            sequence: currentSequence,
            goals: activeGoals,
            plans: activePlans,
          });

          // Complete the sequence with reflection
          const completedSequence = completeSequence(
            currentSequence,
            reflection.success,
            reflection.reflection
          );

          // Add effectiveness rating if provided
          if (reflection.effectiveness !== undefined) {
            completedSequence.effectiveness = reflection.effectiveness;
          }

          // Add tags if provided
          if (reflection.tags && reflection.tags.length > 0) {
            completedSequence.tags = reflection.tags;
          }

          // Update the ActionMemory component
          setComponent(world, eid, ActionMemory, {
            sequences: [
              ...(ActionMemory.sequences[eid] || []),
              completedSequence,
            ],
            currentSequence: undefined, // Reset current sequence
            lastUpdate: Date.now(),
          });

          // Add reflection to thought chain if available
          if (hasComponent(world, eid, Thought) && reflection.reflection) {
            const currentEntries = Thought.entries[eid] || [];
            const newEntry = {
              id: Thought.lastEntryId[eid] + 1,
              timestamp: Date.now(),
              type: "reflection",
              content: reflection.reflection,
              context: {
                roomId: "internal", // Reflections are internal
                metadata: {
                  sequence: completedSequence,
                  success: reflection.success,
                  effectiveness: reflection.effectiveness,
                },
              },
            };

            setComponent(world, eid, Thought, {
              entries: [...currentEntries, newEntry],
              lastEntryId: newEntry.id,
              lastUpdate: Date.now(),
            });
          }

          logger.agent(
            eid,
            `Completed action sequence: ${completedSequence.description}`,
            Agent.name[eid]
          );

          // Emit event for sequence completion
          runtime.eventBus.emitAgentEvent(eid, "sequence", "completed", {
            sequence: completedSequence,
            reflection: reflection.reflection,
            success: reflection.success,
          });
        } catch (error) {
          logger.error(
            `Error generating reflection for agent ${Agent.name[eid]}:`,
            error
          );

          // Still complete the sequence but without reflection
          const completedSequence = completeSequence(
            currentSequence,
            undefined // We don't know if it was successful
          );

          // Update the ActionMemory component
          setComponent(world, eid, ActionMemory, {
            sequences: [
              ...(ActionMemory.sequences[eid] || []),
              completedSequence,
            ],
            currentSequence: undefined, // Reset current sequence
            lastUpdate: Date.now(),
          });
        }
      }
    }

    return world;
  }
);
