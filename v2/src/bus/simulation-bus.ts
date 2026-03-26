/**
 * SimulationBus - Bidirectional Event System
 *
 * A transport-agnostic event bus for observing and injecting events
 * into ArgOS simulations. Designed to work with:
 * - In-process callbacks (direct library usage)
 * - WebSocket servers (browser UIs)
 * - Colyseus rooms (game engine integration)
 * - Future: Visual AI observation
 *
 * Architecture:
 * ```
 * ┌─────────────────────────────────────────────────────────────┐
 * │                     SimulationBus                           │
 * ├─────────────────────────────────────────────────────────────┤
 * │  OUTBOUND (Observation)          INBOUND (Injection)        │
 * │  ├── god channel ◄────────────── godCommand()               │
 * │  ├── spirits channel ◄────────── spiritMessage()            │
 * │  ├── agents channel ◄─────────── agentStimulus()            │
 * │  ├── systems channel              │                         │
 * │  ├── world channel                │                         │
 * │  └── rooms[id] channels ◄──────── roomBroadcast()           │
 * └─────────────────────────────────────────────────────────────┘
 * ```
 *
 * The bus is the single source of truth for all simulation events.
 * Transports (WebSocket, Colyseus) subscribe to channels and
 * forward injection requests back into the simulation.
 */

import { EventEmitter } from "events";
import { RingBuffer } from "./ring-buffer";

// ============================================================================
// Event Types
// ============================================================================

/** Base event with common fields */
export interface BusEvent {
  type: string;
  timestamp: number;
  /** Optional correlation ID for request/response tracking */
  correlationId?: string;
}

// --- God AI Events ---

export interface GodCommandEvent extends BusEvent {
  type: "god:command";
  command: string;
  status: "started" | "completed" | "failed";
  result?: string;
  error?: string;
}

export interface GodToolCallEvent extends BusEvent {
  type: "god:tool_call";
  tool: string;
  args: Record<string, any>;
  result?: any;
}

export interface GodThinkEvent extends BusEvent {
  type: "god:think";
  thought: string;
  phase: "planning" | "executing" | "reviewing";
}

export type GodEvent = GodCommandEvent | GodToolCallEvent | GodThinkEvent;

// --- Spirit Events ---

export interface SpiritObserveEvent extends BusEvent {
  type: "spirit:observe";
  spiritId: number;
  spiritName: string;
  spiritType: string;
  observation: string;
  recommendations?: string[];
}

export interface SpiritMessageEvent extends BusEvent {
  type: "spirit:message";
  from: number;
  to?: number;
  messageType: string;
  content: string;
  priority: "low" | "normal" | "high" | "urgent";
}

export interface SpiritInterventionEvent extends BusEvent {
  type: "spirit:intervention";
  spiritId: number;
  spiritName: string;
  action: string;
  target?: string;
  reason: string;
}

export type SpiritEvent = SpiritObserveEvent | SpiritMessageEvent | SpiritInterventionEvent;

// --- Agent Events ---

export interface AgentThinkEvent extends BusEvent {
  type: "agent:think";
  agentId: number;
  agentName: string;
  thought: string;
  thoughtType: "perception" | "reflection" | "planning" | "decision";
}

export interface AgentActionEvent extends BusEvent {
  type: "agent:action";
  agentId: number;
  agentName: string;
  action: string;
  target?: string;
  content?: string;
  result?: string;
}

export interface AgentEmotionEvent extends BusEvent {
  type: "agent:emotion";
  agentId: number;
  agentName: string;
  emotion: string;
  intensity: number;
  cause?: string;
}

export interface AgentStateEvent extends BusEvent {
  type: "agent:state";
  agentId: number;
  agentName: string;
  state: {
    arousal: number;
    focus: string;
    mode: string;
    needs?: Record<string, number>;
    health?: number;
  };
}

export type AgentEvent = AgentThinkEvent | AgentActionEvent | AgentEmotionEvent | AgentStateEvent;

// --- System Events ---

export interface SystemCreatedEvent extends BusEvent {
  type: "system:created";
  systemName: string;
  description: string;
  frequency: number;
  pseudocode?: string;
}

export interface SystemExecutedEvent extends BusEvent {
  type: "system:executed";
  systemName: string;
  duration: number;
  entitiesProcessed?: number;
}

export interface SystemErrorEvent extends BusEvent {
  type: "system:error";
  systemName: string;
  error: string;
  errorCount: number;
  disabled?: boolean;
}

export type SystemEvent = SystemCreatedEvent | SystemExecutedEvent | SystemErrorEvent;

// --- World Events ---

export interface EntityCreatedEvent extends BusEvent {
  type: "world:entity_created";
  entityId: number;
  entityType: "agent" | "room" | "object" | "stimulus" | "other";
  name: string;
  properties?: Record<string, any>;
}

export interface EntityRemovedEvent extends BusEvent {
  type: "world:entity_removed";
  entityId: number;
  entityType: string;
  name: string;
}

export interface TimeChangeEvent extends BusEvent {
  type: "world:time_change";
  hour: number;
  timeOfDay: string;
  day: number;
}

export interface WorldStateEvent extends BusEvent {
  type: "world:state";
  tick: number;
  agentCount: number;
  roomCount: number;
  systemCount: number;
}

export type WorldEvent = EntityCreatedEvent | EntityRemovedEvent | TimeChangeEvent | WorldStateEvent;

// --- Room Events ---

export interface RoomActivityEvent extends BusEvent {
  type: "room:activity";
  roomId: number;
  roomName: string;
  activityType: "speech" | "action" | "enter" | "leave" | "ambient";
  actor?: string;
  content: string;
}

export interface RoomStateEvent extends BusEvent {
  type: "room:state";
  roomId: number;
  roomName: string;
  occupants: string[];
  objects: string[];
  ambience: string;
}

export type RoomEvent = RoomActivityEvent | RoomStateEvent;

// --- All Events Union ---

export type SimulationEvent =
  | GodEvent
  | SpiritEvent
  | AgentEvent
  | SystemEvent
  | WorldEvent
  | RoomEvent;

// ============================================================================
// Channel Types
// ============================================================================

export type ChannelType =
  | "god"
  | "spirits"
  | "agents"
  | "systems"
  | "world"
  | `room:${string}`
  | `agent:${string}`;

export interface ChannelSubscription {
  channel: ChannelType;
  callback: (event: SimulationEvent) => void;
  filter?: (event: SimulationEvent) => boolean;
}

// ============================================================================
// Injection Types (Inbound Messages)
// ============================================================================

export interface GodCommandInjection {
  type: "inject:god_command";
  command: string;
  correlationId?: string;
}

export interface SpiritMessageInjection {
  type: "inject:spirit_message";
  targetSpiritId?: number;
  targetSpiritName?: string;
  targetSpiritType?: string;
  message: string;
  subject?: string;
  priority?: "low" | "normal" | "high" | "urgent";
}

export interface AgentStimulusInjection {
  type: "inject:agent_stimulus";
  targetAgentId?: number;
  targetAgentName?: string;
  stimulus: string;
  stimulusType?: string;
  source?: string;
}

export interface RoomBroadcastInjection {
  type: "inject:room_broadcast";
  roomId?: number;
  roomName?: string;
  content: string;
  source?: string;
  activityType?: string;
}

export interface SimulationPauseInjection {
  type: "inject:simulation_pause";
}

export interface SimulationResumeInjection {
  type: "inject:simulation_resume";
}

export interface SimulationStopInjection {
  type: "inject:simulation_stop";
}

/** Map data for creating a simulation from UI-designed maps */
export interface ArgosMapData {
  id: string;
  name: string;
  grid: {
    width: number;
    height: number;
    tileSize: number;
  };
  zones: Array<{
    id: string;
    name: string;
    roomType?: string;
    shape:
      | { kind: "rect"; x: number; y: number; w: number; h: number }
      | { kind: "poly"; points: Array<{ x: number; y: number }> }
      | { kind: "polygon"; points: number[] };
    properties?: Record<string, any>;
    meta?: Record<string, any>;
  }>;
  markers?: Array<{
    id: string;
    x: number;
    y: number;
    kind: "spawn" | "portal" | "event" | "label";
    name?: string;
    text?: string;
    spawnType?: "agent" | "object";
    typeId?: string;
    traits?: string[];
    agentDef?: string;
    targetMapId?: string;
    targetMarkerId?: string;
    to?: { x: number; y: number };
    bidirectional?: boolean;
    meta?: Record<string, any>;
  }>;
}

export interface SimulationStartInjection {
  type: "inject:simulation_start";
  map: ArgosMapData;
}

export interface SimulationSaveInjection {
  type: "inject:simulation_save";
  /** Optional name override for the save */
  name?: string;
}

export interface SimulationLoadInjection {
  type: "inject:simulation_load";
  /** Simulation ID to load */
  simulationId: string;
  /** Optional snapshot tick to restore from */
  snapshotTick?: number;
}

export interface SimulationListSavesInjection {
  type: "inject:simulation_list_saves";
}

export type InjectionMessage =
  | GodCommandInjection
  | SpiritMessageInjection
  | AgentStimulusInjection
  | RoomBroadcastInjection
  | SimulationPauseInjection
  | SimulationResumeInjection
  | SimulationStopInjection
  | SimulationStartInjection
  | SimulationSaveInjection
  | SimulationLoadInjection
  | SimulationListSavesInjection;

// ============================================================================
// SimulationBus Class
// ============================================================================

export class SimulationBus extends EventEmitter {
  private subscriptions: Map<string, ChannelSubscription[]> = new Map();
  private injectionHandlers: Map<string, (msg: InjectionMessage) => Promise<void>> = new Map();
  private eventBuffer: RingBuffer<SimulationEvent>;
  private bufferEnabled: boolean = false;
  private static readonly DEFAULT_BUFFER_CAPACITY = 10_000;

  constructor() {
    super();
    this.setMaxListeners(100); // Allow many subscribers
    this.eventBuffer = new RingBuffer<SimulationEvent>(SimulationBus.DEFAULT_BUFFER_CAPACITY);
  }

  // -------------------------------------------------------------------------
  // Observation (Outbound)
  // -------------------------------------------------------------------------

  /**
   * Emit an event to all subscribers of the appropriate channel.
   */
  emit(event: string | symbol, ...args: any[]): boolean;
  emit(event: SimulationEvent): boolean;
  emit(eventOrType: SimulationEvent | string | symbol, ...args: any[]): boolean {
    // Handle both EventEmitter style and typed events
    if (typeof eventOrType === "string" || typeof eventOrType === "symbol") {
      return super.emit(eventOrType, ...args);
    }

    const event = eventOrType;
    const channel = this.getChannelForEvent(event);

    // Buffer if enabled
    if (this.bufferEnabled) {
      this.eventBuffer.push(event);
      if (this.eventBuffer.checkFirstOverflow()) {
        console.warn(
          `[EventBus] Buffer overflow on channel ${channel}: oldest events being dropped (capacity=${this.eventBuffer.capacity})`
        );
      }
    }

    // Emit to channel-specific listeners
    super.emit(channel, event);

    // Emit to wildcard listeners
    super.emit("*", event);

    return true;
  }

  /**
   * Subscribe to a specific channel.
   */
  subscribe(
    channel: ChannelType,
    callback: (event: SimulationEvent) => void,
    filter?: (event: SimulationEvent) => boolean
  ): () => void {
    const wrappedCallback = (event: SimulationEvent) => {
      if (!filter || filter(event)) {
        callback(event);
      }
    };

    this.on(channel, wrappedCallback);

    // Return unsubscribe function
    return () => {
      this.off(channel, wrappedCallback);
    };
  }

  /**
   * Subscribe to all events (wildcard).
   */
  subscribeAll(callback: (event: SimulationEvent) => void): () => void {
    this.on("*", callback);
    return () => this.off("*", callback);
  }

  /**
   * Subscribe to a specific agent's events.
   */
  subscribeAgent(agentName: string, callback: (event: AgentEvent) => void): () => void {
    return this.subscribe(
      `agent:${agentName}` as ChannelType,
      callback as (event: SimulationEvent) => void
    );
  }

  /**
   * Subscribe to a specific room's events.
   */
  subscribeRoom(roomName: string, callback: (event: RoomEvent) => void): () => void {
    return this.subscribe(
      `room:${roomName}` as ChannelType,
      callback as (event: SimulationEvent) => void
    );
  }

  // -------------------------------------------------------------------------
  // Injection (Inbound)
  // -------------------------------------------------------------------------

  /**
   * Register a handler for injection messages.
   * The simulation registers these to receive external commands.
   */
  registerInjectionHandler(
    type: InjectionMessage["type"],
    handler: (msg: InjectionMessage) => Promise<void>
  ): void {
    this.injectionHandlers.set(type, handler);
  }

  /**
   * Inject a message into the simulation.
   * Used by transports (WebSocket, Colyseus) to send commands.
   */
  async inject(message: InjectionMessage): Promise<void> {
    console.log(`[SimulationBus] inject called: ${message.type}`);
    console.log(`[SimulationBus] Registered handlers: ${Array.from(this.injectionHandlers.keys()).join(", ")}`);
    const handler = this.injectionHandlers.get(message.type);
    if (handler) {
      console.log(`[SimulationBus] Found handler, executing...`);
      await handler(message);
    } else {
      console.warn(`[SimulationBus] No handler for injection type: ${message.type}`);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Determine which channel an event belongs to.
   */
  private getChannelForEvent(event: SimulationEvent): ChannelType {
    const type = event.type;

    if (type.startsWith("god:")) return "god";
    if (type.startsWith("spirit:")) return "spirits";
    if (type.startsWith("system:")) return "systems";
    if (type.startsWith("world:")) return "world";

    if (type.startsWith("agent:")) {
      const agentEvent = event as AgentEvent;
      // Emit to both global agents channel and specific agent channel
      super.emit(`agent:${agentEvent.agentName}`, event);
      return "agents";
    }

    if (type.startsWith("room:")) {
      const roomEvent = event as RoomEvent;
      // Emit to both global rooms channel and specific room channel
      super.emit(`room:${roomEvent.roomName}`, event);
      return "world"; // Room events also go to world
    }

    return "world";
  }

  /**
   * Enable/disable event buffering (useful for replay or late subscribers).
   */
  setBuffering(enabled: boolean, maxSize: number = 10_000): void {
    this.bufferEnabled = enabled;
    if (!enabled) {
      this.eventBuffer.clear();
    } else if (maxSize !== this.eventBuffer.capacity) {
      // Re-allocate with new capacity, preserving existing events
      const old = this.eventBuffer.toArray();
      this.eventBuffer = new RingBuffer<SimulationEvent>(maxSize);
      for (const item of old) {
        this.eventBuffer.push(item);
      }
    }
  }

  /**
   * Get buffered events (for replay to late subscribers).
   */
  getBuffer(): SimulationEvent[] {
    return this.eventBuffer.toArray();
  }

  /**
   * Clear the event buffer.
   */
  clearBuffer(): void {
    this.eventBuffer.clear();
  }

  // -------------------------------------------------------------------------
  // Convenience Emitters
  // -------------------------------------------------------------------------

  /** Emit a God AI event */
  emitGod(event: Omit<GodEvent, "timestamp">): void {
    this.emit({ ...event, timestamp: Date.now() } as GodEvent);
  }

  /** Emit a Spirit event */
  emitSpirit(event: Omit<SpiritEvent, "timestamp">): void {
    this.emit({ ...event, timestamp: Date.now() } as SpiritEvent);
  }

  /** Emit an Agent event */
  emitAgent(event: Omit<AgentEvent, "timestamp">): void {
    this.emit({ ...event, timestamp: Date.now() } as AgentEvent);
  }

  /** Emit a System event */
  emitSystem(event: Omit<SystemEvent, "timestamp">): void {
    this.emit({ ...event, timestamp: Date.now() } as SystemEvent);
  }

  /** Emit a World event */
  emitWorld(event: Omit<WorldEvent, "timestamp">): void {
    this.emit({ ...event, timestamp: Date.now() } as WorldEvent);
  }

  /** Emit a Room event */
  emitRoom(event: Omit<RoomEvent, "timestamp">): void {
    this.emit({ ...event, timestamp: Date.now() } as RoomEvent);
  }
}

// ============================================================================
// Transport Interface
// ============================================================================

/**
 * Interface for transports that bridge the bus to external systems.
 * Implementations: WebSocketTransport, ColyseusTransport, etc.
 */
export interface BusTransport {
  /** Connect transport to the bus */
  connect(bus: SimulationBus): void;

  /** Disconnect transport */
  disconnect(): void;

  /** Get transport status */
  isConnected(): boolean;

  /** Get connected client count (if applicable) */
  getClientCount?(): number;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new SimulationBus instance.
 */
export function createSimulationBus(): SimulationBus {
  return new SimulationBus();
}

// ============================================================================
// Singleton for Global Access
// ============================================================================

let globalBus: SimulationBus | null = null;

/**
 * Get or create the global simulation bus.
 * Use this for single-simulation scenarios.
 */
export function getGlobalBus(): SimulationBus {
  if (!globalBus) {
    globalBus = createSimulationBus();
  }
  return globalBus;
}

/**
 * Reset the global bus (useful for testing).
 */
export function resetGlobalBus(): void {
  if (globalBus) {
    globalBus.removeAllListeners();
  }
  globalBus = null;
}
