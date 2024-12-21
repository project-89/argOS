import { World, query, setComponent } from "bitecs";
import { Agent, Goal, Memory, Perception } from "../components";
import { logger } from "../utils/logger";
import { createSystem, SystemConfig } from "./System";
import {
  extractExperiences,
  Experience,
  ExtractExperiencesState,
} from "../llm/agent-llm";
import { EventCategory } from "../types";
import { StimulusData } from "../types/stimulus";
import { processConcurrentAgents } from "../utils/system-utils";

// Valid experience types
const VALID_EXPERIENCE_TYPES = [
  "thought",
  "speech",
  "action",
  "observation",
] as const;
type ExperienceType = (typeof VALID_EXPERIENCE_TYPES)[number];

interface ExperienceState {
  name: string;
  role: string;
  systemPrompt: string;
  recentExperiences: Experience[];
  timestamp: number;
  stimuli: StimulusData[];
  context: {
    salientEntities: Array<{
      id: number;
      source: string;
      relevance: number;
    }>;
    roomContext: Record<
      string,
      {
        stimuliCount: number;
        lastUpdate: number;
        content: string;
      }
    >;
  };
}

// Time window for considering experiences as potentially duplicate (30 seconds)
const EXPERIENCE_TIME_WINDOW = 30000;

export const ExperienceSystem = createSystem<SystemConfig>(
  (runtime) => async (world: World) => {
    const agents = query(world, [Agent, Memory, Perception]);

    await processConcurrentAgents(
      world,
      agents,
      "ExperienceSystem",
      async (eid) => {
        if (!Agent.active[eid]) {
          logger.debug(`Agent ${Agent.name[eid]} is not active, skipping`);
          return;
        }

        // Get current perception state
        const currentStimuli = (Perception.currentStimuli[eid] ||
          []) as StimulusData[];
        const currentContext = Perception.context[eid];
        const currentExperiences = Memory.experiences[eid] || [];

        // Skip if no stimuli to process
        if (currentStimuli.length === 0) {
          return;
        }

        // Filter to recent experiences only (last 5 minutes)
        const recentTimeWindow = 5 * 60 * 1000;
        const recentExperiences = currentExperiences.filter(
          (exp: Experience) => Date.now() - exp.timestamp < recentTimeWindow
        );

        // Prepare state for experience extraction
        const agentState: ExtractExperiencesState = {
          name: Agent.name[eid],
          agentId: Agent.id[eid],
          role: Agent.role[eid],
          systemPrompt: Agent.systemPrompt[eid],
          recentExperiences: recentExperiences.filter(validateExperience),
          timestamp: Date.now(),
          perceptionSummary: Perception.summary[eid] || "",
          perceptionContext: Perception.context[eid] || [],
          stimulus: currentStimuli,
          goals: Goal.current[eid] || [],
        };

        logger.debug(`Processing experiences for ${Agent.name[eid]}`, {
          stimuliCount: currentStimuli.length,
          recentExperiencesCount: agentState.recentExperiences.length,
        });

        // Extract new experiences
        const experiences = await extractExperiences(agentState);
        const validExperiences = experiences.filter(validateExperience);

        logger.agent(
          eid,
          `Extracted ${validExperiences.length} experiences: ${JSON.stringify(
            validExperiences
          )}`
        );

        if (validExperiences.length > 0) {
          // Deduplicate and update experiences
          const newExperiences = deduplicateExperiences([
            ...currentExperiences,
            ...validExperiences,
          ]);

          // Update agent's memory
          setComponent(world, eid, Memory, {
            experiences: newExperiences,
            lastUpdate: Date.now(),
          });

          // Emit events for new experiences
          validExperiences.forEach((exp) => {
            runtime.eventBus.emitAgentEvent(
              eid,
              "experience",
              exp.type as EventCategory,
              exp
            );
          });

          logger.debug(
            `Updated experiences for ${Agent.name[eid]}: ${validExperiences.length} new, ${newExperiences.length} total`
          );

          return {
            newExperiencesCount: validExperiences.length,
            totalExperiencesCount: newExperiences.length,
          };
        }
        return {
          newExperiencesCount: 0,
          totalExperiencesCount: currentExperiences.length,
        };
      }
    );

    return world;
  }
);

function validateExperience(exp: Experience): boolean {
  if (!exp) return false;

  const isValid =
    VALID_EXPERIENCE_TYPES.includes(exp.type as ExperienceType) &&
    typeof exp.content === "string" &&
    exp.content.length > 0 &&
    typeof exp.timestamp === "number" &&
    exp.timestamp > 0;

  if (!isValid) {
    logger.error("Invalid experience:", {
      exp,
      hasValidType: VALID_EXPERIENCE_TYPES.includes(exp.type as ExperienceType),
      hasValidContent:
        typeof exp.content === "string" && exp.content.length > 0,
      hasValidTimestamp: typeof exp.timestamp === "number" && exp.timestamp > 0,
    });
  }

  return isValid;
}

function areSimilarExperiences(exp1: Experience, exp2: Experience): boolean {
  // Different thresholds based on type
  const similarityThreshold = exp1.type === "speech" ? 0.9 : 0.7;

  // Simple similarity check based on common words
  const words1 = new Set(exp1.content.toLowerCase().split(/\s+/));
  const words2 = new Set(exp2.content.toLowerCase().split(/\s+/));

  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size > similarityThreshold;
}

function deduplicateExperiences(experiences: Experience[]): Experience[] {
  const seen = new Map<string, Experience>();

  // Sort by timestamp to keep most recent
  const sortedExperiences = [...experiences].sort(
    (a, b) => b.timestamp - a.timestamp
  );

  return sortedExperiences.filter((exp) => {
    if (!validateExperience(exp)) return false;

    // Check for exact duplicates first
    const exactKey = `${exp.type}:${exp.content}`;
    if (seen.has(exactKey)) return false;

    // Check for semantic duplicates within time window
    for (const [_, existingExp] of seen.entries()) {
      if (
        exp.type === existingExp.type &&
        Math.abs(exp.timestamp - existingExp.timestamp) <
          EXPERIENCE_TIME_WINDOW &&
        areSimilarExperiences(exp, existingExp)
      ) {
        return false;
      }
    }

    seen.set(exactKey, exp);
    return true;
  });
}
