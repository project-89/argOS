import { World, query, setComponent } from "bitecs";
import { Agent, Memory, Perceptions } from "../components/agent/Agent";
import { logger } from "../utils/logger";
import { createSystem, SystemConfig } from "./System";
import {
  extractExperiences,
  Experience,
  ExtractExperiencesState,
} from "../llm/agent-llm";
import { EventCategory } from "../types";

// System for managing agent experiences
export const ExperienceSystem = createSystem<SystemConfig>(
  (runtime) => async (world: World) => {
    const agents = query(world, [Agent, Memory, Perceptions]);
    logger.system(`ExperienceSystem processing ${agents.length} agents`);

    for (const eid of agents) {
      if (!Agent.active[eid]) {
        logger.debug(`Agent ${Agent.name[eid]} is not active, skipping`);
        continue;
      }

      const currentPerceptions = Perceptions.summary[eid];
      const currentPerceptionsContext = Perceptions.context[eid];
      const currentExperiences = Memory.experiences[eid] || [];

      const agentState: ExtractExperiencesState = {
        name: Agent.name[eid],
        role: Agent.role[eid],
        systemPrompt: Agent.systemPrompt[eid],
        recentExperiences: currentExperiences.filter((exp: any) =>
          ["thought", "speech", "action", "observation"].includes(exp.type)
        ) as Experience[],
        timestamp: Date.now(),
        stimulus: [
          {
            type: "perception",
            source: 0,
            data: currentPerceptions,
          },
        ],
      };

      const experiences = await extractExperiences(agentState);

      // Add experiences
      const oldExperiences = Memory.experiences[eid] || [];
      const newExperiences = [...oldExperiences, ...experiences];

      setComponent(world, eid, Memory, {
        experiences: newExperiences,
      });

      experiences.forEach((exp: Experience) => {
        runtime.eventBus.emitAgentEvent(
          eid,
          "experience",
          exp.type as EventCategory,
          exp
        );
      });
    }
    return world;
  }
);
