import { World, query } from "bitecs";
import { WorldState, AgentState, RoomState, NetworkLink } from "../../types";
import {
  Agent,
  Room,
  Appearance,
  OccupiesRoom,
  Stimulus,
} from "../../components/agent/Agent";
import { IStateManager } from "./IStateManager";
import { logger } from "../../utils/logger";
import { SimulationRuntime } from "../SimulationRuntime";

export class StateManager implements IStateManager {
  private templates: Map<string, string>;
  private globalState: Record<string, any>;

  constructor(private world: World, private runtime: SimulationRuntime) {
    this.templates = new Map();
    this.globalState = {};
  }

  // Core state management
  getWorldState(): WorldState {
    const agents = query(this.world, [Agent])
      .filter((eid) => Agent.active[eid] === 1 && Agent.name[eid])
      .map((eid) => this.getAgentState(eid));

    const rooms = query(this.world, [Room]).map((roomId) =>
      this.getRoomState(roomId)
    );

    return {
      agents,
      rooms,
      relationships: this.getRelationships(),
      isRunning: true,
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
      active: Agent.active[eid] === 1,
      platform: Agent.platform[eid],
      appearance: Agent.appearance[eid],
      attention: Agent.attention[eid],
      roomId: roomId ? Room.id[roomId] : null,
      facialExpression: Appearance.facialExpression[eid],
      bodyLanguage: Appearance.bodyLanguage[eid],
      currentAction: Appearance.currentAction[eid],
      socialCues: Appearance.socialCues[eid],
      lastUpdate: Appearance.lastUpdate[eid] || Date.now(),
    };
  }

  getRoomState(roomId: number): RoomState {
    const roomManager = this.runtime.getRoomManager();
    return {
      id: Room.id[roomId] || String(roomId),
      eid: roomId,
      name: Room.name[roomId],
      description: Room.description[roomId],
      type: Room.type[roomId],
      occupants: roomManager.getRoomOccupants(roomId).map((eid) => ({
        id: String(eid),
        name: Agent.name[eid],
        attention: Agent.attention[eid],
      })),
      stimuli: roomManager.getRoomStimuli(roomId).map((eid) => ({
        type: Stimulus.type[eid],
        content: Stimulus.content[eid],
        source: String(Stimulus.sourceEntity[eid]),
        timestamp: Stimulus.timestamp[eid],
      })),
      lastUpdate: Date.now(),
    };
  }

  // Global state and prompt management
  registerPromptTemplate(key: string, template: string): void {
    this.templates.set(key, template);
    logger.system(`Registered prompt template: ${key}`);
  }

  getPromptTemplate(key: string): string | undefined {
    return this.templates.get(key);
  }

  getGlobalState(): Record<string, any> {
    return {
      ...this.globalState,
      components: this.getComponentRegistry(),
      relations: this.getRelationRegistry(),
    };
  }

  updateGlobalState(updates: Record<string, any>): void {
    this.globalState = {
      ...this.globalState,
      ...updates,
    };
  }

  // State composition
  composeState(localState: Record<string, any>): Record<string, any> {
    return {
      ...this.getGlobalState(),
      ...localState,
      templates: Object.fromEntries(this.templates),
    };
  }

  // Private helpers
  private getComponentRegistry(): Record<string, any> {
    // TODO: Implement component schema extraction
    return {};
  }

  private getRelationRegistry(): Record<string, any> {
    // TODO: Implement relation schema extraction
    return {};
  }

  private getRelationships(): NetworkLink[] {
    const relationships: NetworkLink[] = [];
    const rooms = query(this.world, [Room]);
    const roomManager = this.runtime.getRoomManager();

    // Add room occupancy relationships
    for (const roomId of rooms) {
      const occupants = roomManager.getRoomOccupants(roomId);

      // Add presence relationships (agent -> room)
      for (const agentId of occupants) {
        relationships.push({
          source: String(agentId),
          target: Room.id[roomId],
          type: "presence",
          value: Agent.attention[agentId] || 1,
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
}
