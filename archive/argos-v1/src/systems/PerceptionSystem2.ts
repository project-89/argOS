import { World, query, hasComponent, setComponent } from "bitecs";
import { Agent, Perception, Thought, Goal, Plan } from "../components";
import { createSystem } from "./System";
import { logger } from "../utils/logger";
import { processPerceptions } from "../llm/agent-llm";
import {
  gatherStimuliForAgent,
  filterAndPrioritizeStimuli,
} from "../factories/perceptionFactory";
import { processConcurrentAgents } from "../utils/system-utils";
import { createHash } from "crypto";
import { ThoughtEntry } from "../components/Thought";
import { getActivePlans } from "../components/Plans";
import { getRoomInfo } from "../utils/queries";

// Helper to generate a hash of stimuli state for change detection
function generateStimuliHash(stimuli: any[]): string {
  const hash = createHash("sha256");
  const sortedStimuli = stimuli
    .map((s) => ({
      type: s.type,
      content: s.content,
      source: s.source,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  hash.update(JSON.stringify(sortedStimuli));
  return hash.digest("hex");
}

export const PerceptionSystem2 = createSystem(
  (runtime) => async (world: World) => {
    // Query for agents with all required components
    const agents = query(world, [Agent, Perception, Thought, Goal, Plan]);

    await processConcurrentAgents(
      world,
      agents,
      "PerceptionSystem2",
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

        // Gather and process stimuli
        const currentStimuli = gatherStimuliForAgent(world, eid);
        const filteredStimuli = filterAndPrioritizeStimuli(
          world,
          currentStimuli,
          0,
          eid
        );

        // Skip if no stimuli to process
        if (filteredStimuli.length === 0) return;

        // Get recent thought entries for context
        const recentEntries = (
          (Thought.entries[eid] || []) as ThoughtEntry[]
        ).slice(-5);
        const lastPerceptionEntry = [...recentEntries]
          .reverse()
          .find((entry) => entry.type === "perception");

        // Format entries for the perception state
        const recentThoughtChain = recentEntries.map((entry) => ({
          type: entry.type,
          content: entry.content,
          timestamp: entry.timestamp,
        }));

        // Generate hash of current stimuli state
        const currentHash = generateStimuliHash(filteredStimuli);
        const lastHash = lastPerceptionEntry?.context?.metadata?.stimuliHash;

        // Only process if stimuli have changed
        if (currentHash === lastHash) return;

        // Get room information
        const roomInfo = getRoomInfo(world, eid);

        // Get current goals and plans
        const currentGoals = (Goal.current[eid] || []).map((goal) => ({
          id: goal.id,
          description: goal.description,
          type: goal.type,
          priority: goal.priority,
          progress: goal.progress,
        }));

        const currentPlans = Plan.plans[eid] || [];
        const activePlans = getActivePlans(currentPlans).map((plan) => ({
          id: plan.id,
          goalId: plan.goalId,
          steps: plan.steps.map((step) => ({
            id: step.id,
            description: step.description,
            status: (step.status === "in_progress" ? "active" : step.status) as
              | "active"
              | "pending"
              | "completed"
              | "failed",
          })),
          status: "active" as const,
        }));

        try {
          // Process perceptions with full context
          const perceptionResult = await processPerceptions({
            name: Agent.name[eid],
            role: Agent.role[eid],
            systemPrompt: Agent.systemPrompt[eid],
            currentStimuli: filteredStimuli,
            recentThoughtChain: recentThoughtChain,
            context: {
              roomId: roomInfo.id,
              roomName: roomInfo.name,
              roomDescription: roomInfo.description,
              currentGoals,
              activePlans,
            },
          });

          // Create new thought entry for the perception
          const newEntry: ThoughtEntry = {
            id: Thought.lastEntryId[eid] + 1,
            timestamp: Date.now(),
            type: "perception",
            content: perceptionResult.summary,
            context: {
              roomId: roomInfo.id,
              metadata: {
                stimuliHash: currentHash,
                stimuliCount: filteredStimuli.length,
                significance: perceptionResult.significance,
                analysis: perceptionResult.analysis,
                relatedThoughts: perceptionResult.relatedThoughts,
                stimuli: filteredStimuli.map((s) => ({
                  type: s.type,
                  content: s.content,
                  source: s.source,
                })),
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

          // Keep Perception component updated for backward compatibility
          setComponent(world, eid, Perception, {
            currentStimuli: filteredStimuli,
            summary: perceptionResult.summary,
            lastUpdate: Date.now(),
          });

          // Emit perception event with enhanced data
          runtime.eventBus.emitAgentEvent(eid, "perception", "perception", {
            summary: perceptionResult.summary,
            thoughtEntryId: newEntry.id,
            significance: perceptionResult.significance,
            analysis: perceptionResult.analysis,
          });

          logger.debug(`Updated perception for agent ${Agent.name[eid]}:`, {
            stimuliCount: filteredStimuli.length,
            significance: perceptionResult.significance,
            observationCount: perceptionResult.analysis.keyObservations.length,
          });

          return {
            stimuliCount: filteredStimuli.length,
            newThoughtEntryId: newEntry.id,
            significance: perceptionResult.significance,
          };
        } catch (error) {
          logger.error(
            `Error processing stimuli for agent ${Agent.name[eid]}:`,
            error
          );
        }
      }
    );

    return world;
  }
);
