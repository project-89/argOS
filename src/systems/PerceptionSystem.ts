import { World, addComponent, query, hasComponent, setComponent } from "bitecs";
import {
  Agent,
  Perception,
  WorkingMemory,
  ProcessingState,
  ProcessingMode,
  Plan,
  Goal,
  Memory,
} from "../components";
import { createSystem } from "./System";
import { logger } from "../utils/logger";
import { processStimulus } from "../llm/agent-llm";
import {
  gatherStimuliForAgent,
  filterAndPrioritizeStimuli,
  extractSalientEntities,
  buildRoomContext,
} from "../factories/perceptionFactory";
import { processConcurrentAgents } from "../utils/system-utils";
import { createHash } from "crypto";
import { MODE_CONTENT } from "../templates/process-stimulus";
import { getActivePlans } from "../components/Plans";

// Helper to generate a hash of stimuli state
function generateStimuliHash(stimuli: any[]): string {
  const hash = createHash("sha256");
  // Sort and stringify stimuli to ensure consistent hashing, excluding timestamp
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

// Helper to check if stimuli change is significant
function isSignificantChange(
  currentHash: string,
  lastHash: string,
  stableStateCycles: number
): boolean {
  if (currentHash !== lastHash) {
    // Always consider it significant if hashes don't match and we've been stable
    if (stableStateCycles > 0) return true;
    // Otherwise, we might add more complex logic here later
    return true;
  }
  return false;
}

export const PerceptionSystem = createSystem(
  (runtime) => async (world: World) => {
    const agents = query(world, [Agent, Perception, Plan]);

    await processConcurrentAgents(
      world,
      agents,
      "PerceptionSystem",
      async (eid) => {
        if (!Agent.active[eid]) return;

        // Initialize WorkingMemory if needed
        if (!hasComponent(world, eid, WorkingMemory)) {
          setComponent(world, eid, WorkingMemory, {
            lastStimuliHash: "",
            lastSignificantChange: Date.now(),
            stableStateCycles: 0,
          });
        }

        // Initialize ProcessingState if needed
        if (!hasComponent(world, eid, ProcessingState)) {
          setComponent(world, eid, ProcessingState, {
            mode: ProcessingMode.ACTIVE,
            duration: 0,
            lastModeChange: Date.now(),
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

        // Generate hash of current state
        const currentHash = generateStimuliHash(filteredStimuli);
        const lastHash = WorkingMemory.lastStimuliHash[eid];
        const stableStateCycles = WorkingMemory.stableStateCycles[eid];

        // Check for significant changes
        const hasSignificantChange = isSignificantChange(
          currentHash,
          lastHash,
          stableStateCycles
        );

        // Update working memory
        if (hasSignificantChange) {
          WorkingMemory.lastStimuliHash[eid] = currentHash;
          WorkingMemory.lastSignificantChange[eid] = Date.now();
          WorkingMemory.stableStateCycles[eid] = 0;

          // Update processing mode
          ProcessingState.mode[eid] = ProcessingMode.ACTIVE;
          ProcessingState.lastModeChange[eid] = Date.now();
          ProcessingState.duration[eid] = 0;
        } else {
          WorkingMemory.stableStateCycles[eid]++;
          ProcessingState.duration[eid] =
            Date.now() - ProcessingState.lastModeChange[eid];

          // Update processing mode based on stability
          if (stableStateCycles > 5) {
            // Threshold for REFLECTIVE mode
            if (ProcessingState.mode[eid] === ProcessingMode.ACTIVE) {
              ProcessingState.mode[eid] = ProcessingMode.REFLECTIVE;
              ProcessingState.lastModeChange[eid] = Date.now();
            }
          }
          if (stableStateCycles > 10) {
            // Threshold for WAITING mode
            if (ProcessingState.mode[eid] === ProcessingMode.REFLECTIVE) {
              ProcessingState.mode[eid] = ProcessingMode.WAITING;
              ProcessingState.lastModeChange[eid] = Date.now();
            }
          }
        }

        // Only process stimuli if we have any or if there's been a significant change
        if (filteredStimuli.length > 0 || hasSignificantChange) {
          const salientEntities = extractSalientEntities(
            world,
            filteredStimuli
          );
          const roomContext = buildRoomContext(filteredStimuli);
          const currentPlans = Plan.plans[eid] || [];
          const activePlans = getActivePlans(currentPlans);

          try {
            // Process stimuli with current mode context
            const mode = ProcessingState.mode[eid] as ProcessingMode;
            const modeContent = MODE_CONTENT[mode];

            const summary = await processStimulus({
              name: Agent.name[eid],
              role: Agent.role[eid],
              systemPrompt: Agent.systemPrompt[eid],
              recentPerceptions: Perception.summary[eid] || "",
              perceptionHistory: Perception.history[eid] || "",
              timeSinceLastPerception:
                Date.now() - (Perception.lastUpdate[eid] || Date.now()),
              currentTimestamp: Date.now(),
              currentGoals: Goal.current[eid],
              activePlans,
              recentExperiences: Memory.experiences[eid],
              stimulus: filteredStimuli,
              context: {
                salientEntities,
                roomContext,
                recentEvents: [],
                agentRole: Agent.role[eid],
                agentPrompt: Agent.systemPrompt[eid],
                processingMode: mode,
                stableStateCycles: WorkingMemory.stableStateCycles[eid],
              },
              ...modeContent,
            });

            // Update perception state
            Perception.currentStimuli[eid] = filteredStimuli;
            Perception.summary[eid] = summary;
            Perception.context[eid] = {
              salientEntities,
              roomContext,
            };
            Perception.lastUpdate[eid] = Date.now();

            // Add the summary to the history
            // Handle if history doesn't exist
            if (!Perception.history[eid]) {
              Perception.history[eid] = [];
            }
            Perception.history[eid].push(summary);

            // Emit perception update event
            runtime.eventBus.emitAgentEvent(eid, "perception", "perception", {
              summary,
              stimuli: filteredStimuli,
              context: {
                salientEntities,
                roomContext,
              },
            });

            logger.debug(
              `Updated perception for agent ${Agent.name[eid]}: ${filteredStimuli.length} stimuli`
            );
          } catch (error) {
            logger.error(
              `Error processing stimuli for agent ${Agent.name[eid]}:`,
              error
            );
          }
        }

        return {
          stimuliCount: filteredStimuli.length,
          hasSignificantChange,
          processingMode: ProcessingState.mode[eid],
          stableStateCycles: WorkingMemory.stableStateCycles[eid],
        };
      }
    );

    return world;
  }
);
