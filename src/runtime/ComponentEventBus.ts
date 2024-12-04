import { World, hasComponent, observe, onAdd, onRemove, query } from "bitecs";
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

export class ComponentEventBus {
  private world: World;
  private observers: (() => void)[] = [];
  private roomOccupants: Map<number, Set<number>> = new Map();
  private handlers = new Map<string, Set<(data: any) => void>>();

  constructor(world: World) {
    this.world = world;
    this.setupObservers();
  }

  private setupObservers() {
    // Room state changes
    this.observers.push(
      observe(this.world, onAdd(Room), (roomId) => {
        this.roomOccupants.set(roomId, new Set());
        this.broadcast(`room:${roomId}`, {
          type: "state",
          data: {
            id: roomId,
            name: Room.name[roomId],
            description: Room.description[roomId],
            type: Room.type[roomId],
          },
        });
      }),

      observe(this.world, onRemove(Room), (roomId) => {
        this.roomOccupants.delete(roomId);
        this.broadcast(`room:${roomId}`, {
          type: "state",
          data: null,
        });
      })
    );

    // Agent state changes
    this.observers.push(
      observe(this.world, onAdd(Agent), (eid: number) => {
        this.emitAgentUpdate(eid, "state", {
          id: Agent.id[eid],
          name: Agent.name[eid],
          role: Agent.role[eid],
          systemPrompt: Agent.systemPrompt[eid],
          active: Agent.active[eid],
          platform: Agent.platform[eid],
          appearance: Agent.appearance[eid],
          attention: Agent.attention[eid],
        });
      })
    );

    // Memory changes
    this.observers.push(
      observe(this.world, onAdd(Memory), (eid: number) => {
        this.emitAgentUpdate(eid, "thought", {
          thoughts: Memory.thoughts[eid],
          lastThought: Memory.lastThought[eid],
          perceptions: Memory.perceptions[eid],
          experiences: Memory.experiences[eid],
        });
      })
    );

    // Appearance changes
    this.observers.push(
      observe(this.world, onAdd(Appearance), (eid: number) => {
        this.emitAgentUpdate(eid, "appearance", {
          baseDescription: Appearance.baseDescription[eid],
          facialExpression: Appearance.facialExpression[eid],
          bodyLanguage: Appearance.bodyLanguage[eid],
          currentAction: Appearance.currentAction[eid],
          socialCues: Appearance.socialCues[eid],
          lastUpdate: Appearance.lastUpdate[eid],
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
      // Get all agents that have OccupiesRoom relationship with this room
      const currentOccupants = new Set(
        query(this.world, [OccupiesRoom(roomId)])
      );
      const previousOccupants = this.roomOccupants.get(roomId) || new Set();

      // Check for new occupants
      for (const eid of currentOccupants) {
        if (!previousOccupants.has(eid)) {
          const agentId = Agent.id[eid];
          this.broadcast(`room:${roomId}`, {
            type: "occupancy",
            data: { agentId, entered: true },
          });
        }
      }

      // Check for agents that left
      for (const eid of previousOccupants) {
        if (!currentOccupants.has(eid)) {
          const agentId = Agent.id[eid];
          this.broadcast(`room:${roomId}`, {
            type: "occupancy",
            data: { agentId, entered: false },
          });
        }
      }

      // Update occupants list
      this.roomOccupants.set(roomId, currentOccupants);
    }
  }

  private emitAgentUpdate(eid: number, type: string, data: any) {
    const agentId = Agent.id[eid];
    let roomId = null;

    // Find room by querying OccupiesRoom relationship
    const rooms = query(this.world, [Room]);
    for (const roomEid of rooms) {
      if (hasComponent(this.world, eid, OccupiesRoom(roomEid))) {
        roomId = Room.id[roomEid];
        break;
      }
    }

    // Emit on agent-specific channel
    this.broadcast(`agent:${agentId}`, {
      type,
      data,
      timestamp: Date.now(),
    });

    // Also emit on room channel if agent is in a room
    if (roomId) {
      this.broadcast(`room:${roomId}`, {
        type: "agent",
        data: {
          agentId,
          type,
          ...data,
        },
        timestamp: Date.now(),
      });
    }
  }

  getRoomOccupants(roomId: number): number[] {
    return Array.from(this.roomOccupants.get(roomId) || []);
  }

  subscribe(channel: string, handler: (data: any) => void) {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
    }
    this.handlers.get(channel)?.add(handler);
    return () => this.handlers.get(channel)?.delete(handler);
  }

  broadcast(channel: string, data: any) {
    this.handlers.get(channel)?.forEach((handler) => handler(data));
  }

  cleanup() {
    this.observers.forEach((unobserve) => unobserve());
    this.observers = [];
    this.roomOccupants.clear();
    this.handlers.clear();
  }
}
