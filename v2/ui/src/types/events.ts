/**
 * Event types for SimulationBus
 * These mirror the backend types in src/bus/simulation-bus.ts
 */

// Base event
export interface BusEvent {
  type: string;
  timestamp: number;
  correlationId?: string;
}

// God AI Events
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
  args: Record<string, unknown>;
  result?: unknown;
}

export interface GodThinkEvent extends BusEvent {
  type: "god:think";
  thought: string;
  phase: "planning" | "executing" | "reviewing";
}

export interface GodResponseEvent extends BusEvent {
  type: "god:response";
  command: string;
  thinking: string;
  actions: Array<{ tool: string; args: Record<string, unknown>; result?: unknown }>;
}

export interface GodErrorEvent extends BusEvent {
  type: "god:error";
  command: string;
  error: string;
}

export type GodEvent = GodCommandEvent | GodToolCallEvent | GodThinkEvent | GodResponseEvent | GodErrorEvent;

// Spirit Events
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

// Agent Events
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

// System Events
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
  logCount?: number;
  tick?: number;
}

export interface SystemErrorEvent extends BusEvent {
  type: "system:error";
  systemName: string;
  error: string;
  errorCount: number;
  disabled?: boolean;
}

export interface SystemLogEvent extends BusEvent {
  type: "system:log";
  systemName: string;
  message: string;
  tick?: number;
}

export type SystemEvent =
  | SystemCreatedEvent
  | SystemExecutedEvent
  | SystemErrorEvent
  | SystemLogEvent;

// World Events
export interface EntityCreatedEvent extends BusEvent {
  type: "world:entity_created";
  entityId: number;
  entityType: "agent" | "room" | "object" | "stimulus" | "other";
  name: string;
  properties?: Record<string, unknown>;
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
  spiritCount?: number;
  daemonCount?: number;
  tension?: number;
  agents?: Array<{
    id: number;
    name: string;
    description: string;
    role: string;
    room: string | null;
    gridPosition?: { x: number; y: number; facing?: string } | null;
    mind: { mode: string; arousal: number; focus: string };
    memories?: Array<{
      id: number;
      type: string;
      content: string;
      importance: number;
      emotionalValence: number;
      timestamp: number;
    }>;
    currentThought?: string | null;
  }>;
  rooms?: Array<{
    id: number;
    name: string;
    description: string;
    capacity: number;
    ambience: string;
    occupants: string[];
  }>;
  stimulusSources?: Array<{
    id: number;
    name: string;
    description: string;
    room: string | null;
    type: string;
  }>;
  entities?: Array<{
    id: number;
    name: string;
    description: string;
    room: string | null;
    type: string;
    gridPosition?: { x: number; y: number; facing?: string } | null;
  }>;
  systems?: Array<{
    name: string;
    description: string;
    frequency: number;
    active: boolean;
  }>;
  spirits?: Array<{
    id: number;
    name: string;
    domain: string;
    rank: string;
    description: string;
    observationInterval: number;
    lastObservation: number;
    inboxSize: number;
    observationsCount: number;
  }>;
  daemons?: Array<{
    agentEid: number;
    agentName: string;
    observationCount: number;
    whisperCount: number;
    reportCount: number;
    concernLevel: number;
    pendingNudges: number;
    memory: {
      thoughtCount: number;
      memoryCount: number;
      planCount: number;
      characterMoments: number;
      recentThoughts: Array<{
        focus: string;
        content: string;
        emotionalTone: string;
        timestamp: number;
      }>;
    };
    growthMetrics: {
      lastGoalChange: number;
      lastBeliefChange: number;
      lastRelationshipChange: number;
      stagnationScore: number;
    };
    latestPovStory?: string;
    arcStatus?: string;
    arcTension?: number;
    lastObservation: number;
    lastWhisper: number;
    lastReport: number;
    active: boolean;
  }>;
}

export type WorldEvent = EntityCreatedEvent | EntityRemovedEvent | TimeChangeEvent | WorldStateEvent;

// Room Events
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

// Daemon Events (Agent Guardians)
export interface DaemonObserveEvent extends BusEvent {
  type: "daemon:observe";
  agentId: number;
  agentName: string;
  observation: string;
  concerns?: Array<{ type: string; description: string; severity: "low" | "medium" | "high" }>;
}

export interface DaemonWhisperEvent extends BusEvent {
  type: "daemon:whisper";
  agentId: number;
  agentName: string;
  whisperType: "guidance" | "reminder" | "encouragement" | "challenge";
  content: string;
}

export interface DaemonReportEvent extends BusEvent {
  type: "daemon:report";
  agentId: number;
  agentName: string;
  subject: string;
  summary: string;
  urgency: "low" | "normal" | "high";
}

export interface DaemonNudgeEvent extends BusEvent {
  type: "daemon:nudge";
  agentId: number;
  agentName: string;
  nudgeType: "arrive" | "interact" | "resolve" | "escalate" | "reflect" | "change_goal";
  action: string;
  reason: string;
}

export type DaemonEvent = DaemonObserveEvent | DaemonWhisperEvent | DaemonReportEvent | DaemonNudgeEvent;

// Simulation Status Events
export interface SimulationStatusEvent extends BusEvent {
  type: "simulation:status";
  status: "running" | "paused" | "stopped";
  tick?: number;
}

export interface SimulationErrorEvent extends BusEvent {
  type: "simulation:error";
  error: string;
}

// All Events Union
export type SimulationEvent =
  | GodEvent
  | SpiritEvent
  | AgentEvent
  | SystemEvent
  | WorldEvent
  | RoomEvent
  | DaemonEvent
  | SimulationStatusEvent
  | SimulationErrorEvent;

// Channel types
export type ChannelType =
  | "god"
  | "spirits"
  | "agents"
  | "systems"
  | "world"
  | "daemons"
  | `room:${string}`
  | `agent:${string}`
  | `daemon:${string}`;

// WebSocket message types
export interface WebSocketClientMessage {
  type: "subscribe" | "unsubscribe" | "inject" | "ping";
  channel?: ChannelType | "*";
  injection?: InjectionMessage;
}

export interface WebSocketServerMessage {
  type: "event" | "subscribed" | "unsubscribed" | "error" | "pong" | "injected";
  channel?: ChannelType | "*";
  event?: SimulationEvent;
  error?: string;
  timestamp: number;
}

// Injection types
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

export interface SimulationStartInjection {
  type: "inject:simulation_start";
  map: {
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
      meta?: Record<string, unknown>;
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
      meta?: Record<string, unknown>;
    }>;
  };
}

export interface SimulationSaveInjection {
  type: "inject:simulation_save";
  name?: string;
}

export interface SimulationLoadInjection {
  type: "inject:simulation_load";
  simulationId: string;
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

// Helper to get event category
export function getEventCategory(event: SimulationEvent): "god" | "spirit" | "agent" | "system" | "world" | "room" | "daemon" {
  if (event.type.startsWith("god:")) return "god";
  if (event.type.startsWith("spirit:")) return "spirit";
  if (event.type.startsWith("agent:")) return "agent";
  if (event.type.startsWith("system:")) return "system";
  if (event.type.startsWith("room:")) return "room";
  if (event.type.startsWith("daemon:")) return "daemon";
  return "world";
}
