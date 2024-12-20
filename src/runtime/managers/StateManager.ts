import { World, query } from "bitecs";
import { WorldState, AgentState, RoomState, NetworkLink } from "../../types";
import {
  Agent,
  Room,
  Appearance,
  OccupiesRoom,
  Stimulus,
  AgentComponent,
  RoomComponent,
  AppearanceComponent,
  StimulusComponent,
  RecentActionsComponent,
  GoalComponent,
  PlanComponent,
  Memory,
  Perception,
  Action,
  Goal,
  ALL_COMPONENTS,
} from "../../components";
import { IStateManager } from "./IStateManager";
import { logger } from "../../utils/logger";
import { SimulationRuntime } from "../SimulationRuntime";
import { z } from "zod";
import { ComponentWithSchema } from "../../components/createComponent";
import { RelationWithSchema } from "../../components/createRelation";

export class StateManager implements IStateManager {
  private templates: Map<string, string>;
  private templateVariables: Record<string, any>;
  private components: Map<string, ComponentWithSchema<z.ZodObject<any>>>;
  private relations: Map<string, RelationWithSchema<z.ZodObject<any>>>;

  constructor(private world: World, private runtime: SimulationRuntime) {
    this.templates = new Map();
    this.templateVariables = {};
    this.components = new Map();
    this.relations = new Map();

    ALL_COMPONENTS.forEach((component) => {
      this.registerComponent(component);
    });
  }

  // Component Registry
  registerComponent(component: ComponentWithSchema<z.ZodObject<any>>): void {
    this.components.set(component.name, component);
    logger.system(`Registered component: ${component.name}`);
  }

  getComponent(
    name: string
  ): ComponentWithSchema<z.ZodObject<any>> | undefined {
    return this.components.get(name);
  }

  getComponents(): Record<string, ComponentWithSchema<z.ZodObject<any>>> {
    return Object.fromEntries(this.components);
  }

  // Relationship Registry
  registerRelation(relation: RelationWithSchema<z.ZodObject<any>>): void {
    this.relations.set(relation.name, relation);
    logger.system(`Registered relation: ${relation.name}`);
  }

  getRelation(name: string): RelationWithSchema<z.ZodObject<any>> | undefined {
    return this.relations.get(name);
  }

  getRelations(): Record<string, RelationWithSchema<z.ZodObject<any>>> {
    return Object.fromEntries(this.relations);
  }

  // Core state management
  getWorldState(): WorldState {
    const agentComponent = this.getComponent("Agent")!;
    const agents = query(this.world, [agentComponent.component])
      .filter(
        (eid) =>
          agentComponent.component.active[eid] === 1 &&
          agentComponent.component.name[eid]
      )
      .map((eid) => this.getAgentState(eid));

    const roomComponent = this.getComponent("Room")!;
    const rooms = query(this.world, [roomComponent.component]).map((roomId) =>
      this.getRoomState(roomId)
    );

    return {
      agents,
      rooms,
      relationships: this.getRelationships(),
      isRunning: this.runtime.isRunning,
      timestamp: Date.now(),
    };
  }

  getAgentState(eid: number): AgentState {
    const roomId = this.runtime.getRoomManager().getAgentRoom(eid);

    return {
      id: String(eid),
      name: Agent.name[eid],
      role: Agent.role[eid],
      systemPrompt: Agent.systemPrompt[eid],
      active: Agent.active[eid],
      platform: Agent.platform[eid],
      appearance: {
        description: Appearance.description[eid] || "",
        facialExpression: Appearance.facialExpression[eid] || "",
        bodyLanguage: Appearance.bodyLanguage[eid] || "",
        currentAction: Appearance.currentAction[eid] || "",
        socialCues: Appearance.socialCues[eid] || [],
      },
      attention: Agent.attention[eid],
      roomId: roomId ? Room.id[roomId] : null,
      lastUpdate: Appearance.lastUpdate[eid] || Date.now(),
      thoughtHistory: Memory.thoughts[eid] || [],
      perceptions: {
        narrative: Perception.summary[eid] || "",
        raw: Perception.currentStimuli[eid] || [],
      },
      lastAction: Action.lastActionResult[eid],
      timeSinceLastAction: Action.lastActionTime[eid]
        ? Date.now() - Action.lastActionTime[eid]
        : 0,
      experiences: Memory.experiences[eid] || [],
      availableTools: Action.availableTools[eid] || [],
      goals: Goal.current[eid] || [],
      completedGoals: Goal.completed[eid] || [],
    };
  }

  getRoomState(eid: number): RoomState {
    const roomComponent = this.getComponent("Room")!;
    const agentComponent = this.getComponent("Agent")!;
    const stimulusComponent = this.getComponent("Stimulus")!;

    const occupants = query(this.world, [OccupiesRoom(eid)]).map((agentId) => ({
      id: String(agentId),
      name: agentComponent.component.name[agentId],
      attention: agentComponent.component.attention[agentId],
    }));

    const stimuli = query(this.world, [stimulusComponent.component])
      .filter((sid) => {
        try {
          const content = stimulusComponent.component.content[sid];
          if (!content) return false;
          const parsedContent = JSON.parse(content);
          return (
            parsedContent.metadata?.roomId === roomComponent.component.id[eid]
          );
        } catch (e) {
          return false;
        }
      })
      .map((sid) => ({
        type: stimulusComponent.component.type[sid],
        content: stimulusComponent.component.content[sid],
        source: stimulusComponent.component.source[sid],
        timestamp: stimulusComponent.component.timestamp[sid],
      }));

    return {
      id: roomComponent.component.id[eid],
      eid,
      name: roomComponent.component.name[eid],
      type: roomComponent.component.type[eid],
      description: roomComponent.component.description[eid],
      occupants,
      stimuli,
      lastUpdate: Date.now(),
    };
  }

  getRelationships(): NetworkLink[] {
    const relationships: NetworkLink[] = [];
    const roomComponent = this.getComponent("Room")!;
    const agentComponent = this.getComponent("Agent")!;
    const rooms = query(this.world, [roomComponent.component]);
    const roomManager = this.runtime.getRoomManager();

    // Add room occupancy relationships
    for (const roomId of rooms) {
      const occupants = roomManager.getRoomOccupants(roomId);

      // Add presence relationships (agent -> room)
      for (const agentId of occupants) {
        relationships.push({
          source: String(agentId),
          target: roomComponent.component.id[roomId],
          type: "presence",
          value: agentComponent.component.attention[agentId] || 1,
        });
      }

      // Add active interaction relationships
      for (const agentId of occupants) {
        for (const otherAgentId of occupants) {
          if (agentId >= otherAgentId) continue; // Skip self and duplicates

          if (
            this.runtime.hasRecentInteraction(
              String(agentId),
              String(otherAgentId)
            )
          ) {
            relationships.push({
              source: String(agentId),
              target: String(otherAgentId),
              type: "interaction",
              value: 1,
            });
          }
        }
      }
    }

    return relationships;
  }

  // Prompt Management
  registerPrompt(key: string, template: string): void {
    this.templates.set(key, template);
    logger.system(`Registered prompt template: ${key}`);
  }

  getPrompt(key: string): string | undefined {
    return this.templates.get(key);
  }

  hasPrompt(key: string): boolean {
    return this.templates.has(key);
  }

  composePrompts(keys: string[], variables?: Record<string, any>): string {
    const mergedVariables = { ...this.templateVariables, ...variables };

    return keys
      .map((key) => {
        const template = this.getPrompt(key);
        if (!template) {
          logger.warn(`Prompt template not found: ${key}`);
          return "";
        }
        return this.interpolateTemplate(template, mergedVariables);
      })
      .filter(Boolean)
      .join("\n\n");
  }

  // Template variables
  setTemplateVariable(key: string, value: any): void {
    this.templateVariables[key] = value;
  }

  getTemplateVariable(key: string): any {
    return this.templateVariables[key];
  }

  getTemplateVariables(): Record<string, any> {
    return { ...this.templateVariables };
  }

  // Cleanup
  cleanup(): void {
    this.templates.clear();
    this.templateVariables = {};
    this.components.clear();
    this.relations.clear();
  }

  // Private helper methods
  private interpolateTemplate(
    template: string,
    variables: Record<string, any>
  ): string {
    return template.replace(/\${(\w+)}/g, (_, key) => {
      if (key in variables) {
        return String(variables[key]);
      }
      logger.warn(`Template variable not found: ${key}`);
      return `\${${key}}`;
    });
  }
}
