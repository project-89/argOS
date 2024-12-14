import { query, World } from "bitecs";
import {
  Agent,
  Memory,
  Action,
  Perception,
  Appearance,
  RecentActions,
  Room,
} from "../../components/agent/Agent";
import {
  PromptTemplate,
  PromptContext,
  RegisteredPrompt,
  PromptManagerConfig,
} from "../../types/prompts";
import { RuntimeState, EntityComponentState } from "../../types/state";
import { logger } from "../../utils/logger";
import { getAgentRooms } from "../../utils/queries";
import { SimulationRuntime } from "../SimulationRuntime";
import { IActionManager } from "./IActionManager";
import { IStateManager } from "./IStateManager";

export class PromptManager {
  private templates: Map<string, RegisteredPrompt> = new Map();
  private defaultState: Partial<RuntimeState>;
  private templateCache: Map<string, string> = new Map();
  private actionManager: IActionManager;
  private stateManager: IStateManager;

  constructor(config: PromptManagerConfig, private runtime: SimulationRuntime) {
    this.defaultState = config.defaultState || {};
    config.templates.forEach((template) => this.registerTemplate(template));
    this.actionManager = this.runtime.getActionManager();
    this.stateManager = this.runtime.getStateManager();
  }

  registerTemplate(template: PromptTemplate) {
    const registeredPrompt: RegisteredPrompt = {
      ...template,
      render: async (context: PromptContext) => {
        return this.renderTemplate(template, context);
      },
    };
    this.templates.set(template.id, registeredPrompt);
  }

  getTemplate(id: string): RegisteredPrompt | undefined {
    return this.templates.get(id);
  }

  private async renderTemplate(
    template: PromptTemplate,
    context: PromptContext
  ): Promise<string> {
    try {
      // Get entity state
      const entityState = await this.getEntityState(
        context.world,
        context.entityId
      );

      // Get global state
      const globalState = await this.getGlobalState(context.world);

      // Get engine state
      const engineState = {
        availableTools: this.actionManager.getAvailableTools(),
        registeredComponents: this.stateManager.getComponents(),
        registeredRelations: this.stateManager.getRelations(),
      };

      // Build complete runtime state
      const state: RuntimeState = {
        timestamp: Date.now(),
        entityId: context.entityId,
        components: entityState,
        templates: {},
        global: globalState,
        engine: engineState,
        ...context.state,
      };

      // Render referenced templates first
      const renderedTemplates = new Map<string, string>();
      for (const [id, prompt] of Array.from(this.templates.entries())) {
        if (id !== template.id) {
          // Prevent recursive rendering
          // Check cache first
          const cacheKey = `${id}:${context.entityId}:${state.timestamp}`;
          let rendered = this.templateCache.get(cacheKey);

          if (!rendered) {
            rendered = await prompt.render({
              ...context,
              state: {
                ...state,
                templates: Object.fromEntries(renderedTemplates), // Pass already rendered templates
              },
            });
            this.templateCache.set(cacheKey, rendered);
          }

          renderedTemplates.set(id, rendered);
        }
      }

      // Add rendered templates to state
      state.templates = Object.fromEntries(renderedTemplates);

      return this.replaceVariables(template.template, state);
    } catch (error) {
      logger.error(`Error rendering template ${template.id}`, error);
      throw error;
    }
  }

  private replaceVariables(template: string, state: RuntimeState): string {
    return template.replace(/\{([^}]+)\}/g, (match, path) => {
      const value = path
        .split(".")
        .reduce((obj: any, key: string) => obj?.[key], state);

      if (value === undefined) {
        logger.warn(`Variable ${path} not found in template`);
        return match;
      }

      return typeof value === "object"
        ? JSON.stringify(value, null, 2)
        : String(value);
    });
  }

  private async getEntityState(
    world: World,
    entityId: number
  ): Promise<EntityComponentState> {
    // Get rooms the agent occupies
    const occupiedRoomIds = getAgentRooms(world, entityId);

    const rooms = occupiedRoomIds.map((roomId) => ({
      id: Room.id[roomId],
      name: Room.name[roomId],
      description: Room.description[roomId],
      type: Room.type[roomId],
    }));

    return {
      agent: {
        id: Agent.id[entityId],
        name: Agent.name[entityId],
        role: Agent.role[entityId],
        systemPrompt: Agent.systemPrompt[entityId],
        active: Agent.active[entityId],
        platform: Agent.platform[entityId],
        appearance: Agent.appearance[entityId],
        attention: Agent.attention[entityId],
      },
      memory: {
        thoughts: Memory.thoughts[entityId] || [],
        lastThought: Memory.lastThought[entityId],
        lastUpdate: Memory.lastUpdate[entityId],
        perceptions: Memory.perceptions[entityId] || [],
        experiences: Memory.experiences[entityId] || [],
      },
      action: {
        pendingAction: Action.pendingAction[entityId],
        lastActionTime: Action.lastActionTime[entityId],
        lastActionResult: Action.lastActionResult[entityId],
        availableTools: Action.availableTools[entityId] || [],
      },
      perception: {
        currentStimuli: Perception.currentStimuli[entityId],
        lastProcessedTime: Perception.lastProcessedTime[entityId],
        summary: Perception.summary[entityId],
        context: Perception.context[entityId],
      },
      appearance: {
        baseDescription: Appearance.baseDescription[entityId],
        description: Appearance.description[entityId],
        facialExpression: Appearance.facialExpression[entityId],
        bodyLanguage: Appearance.bodyLanguage[entityId],
        currentAction: Appearance.currentAction[entityId],
        socialCues: Appearance.socialCues[entityId],
        lastUpdate: Appearance.lastUpdate[entityId],
      },
      recentActions: {
        actions: RecentActions.actions[entityId] || [],
      },
      interactions: {}, // Will be populated with active interactions
      rooms, // Now returns array of rooms
    };
  }

  private async getGlobalState(world: World) {
    const activeAgents = query(world, [Agent])
      .filter((eid) => Agent.active[eid])
      .map((eid) => {
        return {
          id: Agent.id[eid],
          name: Agent.name[eid],
          role: Agent.role[eid],
        };
      });

    const rooms = query(world, [Room]).reduce(
      (acc, roomId) => ({
        ...acc,
        [Room.id[roomId]]: {
          id: Room.id[roomId],
          name: Room.name[roomId],
          description: Room.description[roomId],
          type: Room.type[roomId],
        },
      }),
      {}
    );

    return {
      activeAgents,
      rooms,
      stimuli: {}, // Could be populated with global stimuli if needed
    };
  }

  clearCache() {
    this.templateCache.clear();
  }
}
