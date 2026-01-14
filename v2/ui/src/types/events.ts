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
}

export interface SystemErrorEvent extends BusEvent {
  type: "system:error";
  systemName: string;
  error: string;
  errorCount: number;
  disabled?: boolean;
}

export type SystemEvent = SystemCreatedEvent | SystemExecutedEvent | SystemErrorEvent;

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

// All Events Union
export type SimulationEvent =
  | GodEvent
  | SpiritEvent
  | AgentEvent
  | SystemEvent
  | WorldEvent
  | RoomEvent
  | DaemonEvent;

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

export type InjectionMessage =
  | GodCommandInjection
  | SpiritMessageInjection
  | AgentStimulusInjection
  | RoomBroadcastInjection;

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
