import {
  World,
  hasComponent,
  observe,
  onAdd,
  onRemove,
  onSet,
  query,
} from "bitecs";
import { EventEmitter } from "events";
import {
  Agent,
  Room,
  OccupiesRoom,
  Memory,
  Appearance,
  Action,
  Perception,
  Stimulus,
} from "../components/agent/Agent";
import {
  AgentEventType,
  AgentEventData,
  AgentThoughtData,
  AgentPerceptionData,
  AgentExperienceData,
  AgentAppearanceData,
  AgentActionData,
  AgentStateData,
  AgentEventMessage,
  AgentEventDataType,
  AuditoryStimulusContent,
} from "../types";

export class ComponentEventBus {
  private world: World;
  private observers: (() => void)[] = [];
  private roomOccupants: Map<number, Set<number>> = new Map();
  private handlers = new Map<
    string,
    Set<(data: any, channel?: string) => void>
  >();

  constructor(world: World) {
    this.world = world;
    this.setupObservers();
  }

  private setupObservers() {
    // Room state changes
    this.observers.push(
      observe(this.world, onSet(Room), (roomId) => {
        this.roomOccupants.set(roomId, new Set());
        this.broadcast(`room:${Room.id[roomId] || String(roomId)}`, {
          type: "state",
          data: {
            id: Room.id[roomId] || String(roomId),
            name: Room.name[roomId],
            description: Room.description[roomId],
            type: Room.type[roomId],
          },
        });
      }),

      observe(this.world, onRemove(Room), (roomId) => {
        this.roomOccupants.delete(roomId);
        this.broadcast(`room:${Room.id[roomId] || String(roomId)}`, {
          type: "state",
          data: null,
        });
      })
    );

    // Agent state changes
    this.observers.push(
      observe(this.world, onSet(Agent), (eid: number, params) => {
        this.emitAgentUpdate(eid, "state", {
          category: "state",
          content: {
            id: params.id,
            name: params.name,
            role: params.role,
            systemPrompt: params.systemPrompt,
            active: params.active,
            platform: params.platform,
            appearance: params.appearance,
            attention: params.attention,
          },
          timestamp: Date.now(),
        });
      })
    );

    // Memory changes
    this.observers.push(
      observe(this.world, onSet(Memory), (eid: number, params) => {
        if (params.thoughts) {
          const thoughts = params.thoughts;
          const perceptions = params.perceptions;
          const experiences = params.experiences;

          if (params.lastThought) {
            const thoughtData: AgentThoughtData = {
              category: "thought",
              content: params.lastThought,
              timestamp: Date.now(),
            };
            this.emitAgentUpdate(eid, "thought", thoughtData);
          }

          if (perceptions?.length) {
            const perception = perceptions[perceptions.length - 1];
            const perceptionData: AgentPerceptionData = {
              category: "perception",
              content: {
                timestamp: Date.now(),
                content: perception,
              },
              timestamp: Date.now(),
            };
            this.emitAgentUpdate(eid, "perception", perceptionData);
          }

          if (experiences?.length) {
            const experience = experiences[experiences.length - 1];
            const experienceData: AgentExperienceData = {
              category: "experience",
              content: {
                type: "memory",
                content: experience.content,
                timestamp: experience.timestamp,
              },
              timestamp: Date.now(),
            };
            this.emitAgentUpdate(eid, "experience", experienceData);
          }
        }
      })
    );

    // Stimuli changes
    this.observers.push(
      observe(this.world, onSet(Stimulus), (eid: number, params) => {
        if (params.type === "AUDITORY") {
          const content = params.content
            ? (JSON.parse(params.content) as AuditoryStimulusContent)
            : null;

          if (content?.speech) {
            this.emitRoomUpdate(params.roomId, "speech", {
              type: "speech",
              agentId: params.sourceEntity,
              agentName: content.name,
              message: content.speech,
              tone: content.tone,
              timestamp: content.timestamp,
              metadata: content.metadata,
            });
          }
        }
      })
    );

    this.observers.push(
      observe(this.world, onSet(Action), (eid: number, params) => {
        if (!params.pendingAction) return;
        this.emitAgentUpdate(eid, "action", {
          category: "action",
          content: {
            tool: params.pendingAction.tool,
          },
          timestamp: Date.now(),
        });
      })
    );

    // Appearance changes
    this.observers.push(
      observe(this.world, onSet(Appearance), (eid: number, params) => {
        this.emitAgentUpdate(eid, "appearance", {
          category: "appearance",
          content: {
            baseDescription: params.baseDescription,
            facialExpression: params.facialExpression,
            bodyLanguage: params.bodyLanguage,
            currentAction: params.currentAction,
            socialCues: params.socialCues,
            lastUpdate: Date.now(),
          },
          timestamp: Date.now(),
        });
      })
    );
  }

  update() {
    // Get all rooms and agents
    const rooms = query(this.world, [Room]);
    const agents = query(this.world, [Agent]);

    // For each room, track which agents are in it
    for (const roomId of rooms) {
      const roomStringId = Room.id[roomId] || String(roomId);
      // Get all agents that have OccupiesRoom relationship with this room
      const currentOccupants = new Set(
        query(this.world, [OccupiesRoom(roomId)])
      );
      const previousOccupants = this.roomOccupants.get(roomId) || new Set();

      // Check for new occupants
      for (const eid of currentOccupants) {
        if (!previousOccupants.has(eid)) {
          const agentId = Agent.id[eid];
          this.broadcast(`room:${roomStringId}`, {
            type: "occupancy",
            data: { agentId, entered: true },
          });
        }
      }

      // Check for agents that left
      for (const eid of previousOccupants) {
        if (!currentOccupants.has(eid)) {
          const agentId = Agent.id[eid];
          this.broadcast(`room:${roomStringId}`, {
            type: "occupancy",
            data: { agentId, entered: false },
          });
        }
      }

      // Update occupants list
      this.roomOccupants.set(roomId, currentOccupants);
    }
  }

  private emitRoomUpdate(roomId: number, type: string, data: any) {
    const stringRoomId = Room.id[roomId] || String(roomId);
    this.broadcast(`room:${stringRoomId}`, {
      type,
      data,
      timestamp: Date.now(),
    });
  }

  private emitAgentUpdate(
    eid: number,
    type: AgentEventType,
    data: AgentEventDataType
  ) {
    const agentId = Agent.id[eid] || String(eid);
    let roomId = null;

    // Find room by querying OccupiesRoom relationship
    const rooms = query(this.world, [Room]);
    for (const roomEid of rooms) {
      if (hasComponent(this.world, eid, OccupiesRoom(roomEid))) {
        roomId = Room.id[roomEid] || String(roomEid);
        break;
      }
    }

    const eventMessage: AgentEventMessage = {
      type,
      data,
      timestamp: Date.now(),
    };

    // Emit on agent-specific channel
    this.broadcast(`agent:${agentId}`, eventMessage);

    // Also emit on room channel if agent is in a room
    if (roomId) {
      this.broadcast(`room:${roomId}`, {
        type: "agent",
        data: {
          agentId,
          ...eventMessage,
        },
        timestamp: Date.now(),
      });
    }
  }

  getRoomOccupants(roomId: number): number[] {
    return Array.from(this.roomOccupants.get(roomId) || []);
  }

  subscribe(channel: string, handler: (data: any, channel?: string) => void) {
    // Handle wildcard subscriptions
    if (channel.endsWith("*")) {
      const prefix = channel.slice(0, -1);
      if (!this.handlers.has(channel)) {
        this.handlers.set(channel, new Set());
      }
      const wildcardHandler = (data: any, channel?: string) => {
        if (channel?.startsWith(prefix)) {
          handler(data, channel);
        }
      };
      this.handlers.get(channel)?.add(wildcardHandler);
      return () => this.handlers.get(channel)?.delete(wildcardHandler);
    }

    // Regular channel subscription
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
    }
    this.handlers.get(channel)?.add(handler);
    return () => this.handlers.get(channel)?.delete(handler);
  }

  broadcast(channel: string, data: any) {
    // Handle regular subscribers
    this.handlers.get(channel)?.forEach((handler) => handler(data));

    // Handle wildcard subscribers
    this.handlers.forEach((handlers, pattern) => {
      if (pattern.endsWith("*")) {
        const prefix = pattern.slice(0, -1);
        if (channel.startsWith(prefix)) {
          handlers.forEach((handler) => handler(data, channel));
        }
      }
    });
  }

  cleanup() {
    this.observers.forEach((unobserve) => unobserve());
    this.observers = [];
    this.roomOccupants.clear();
    this.handlers.clear();
  }
}
