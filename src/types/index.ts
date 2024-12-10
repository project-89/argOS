import { RoomType } from "../components/agent/Agent";
import { World } from "bitecs";
import { EventBus } from "../runtime/EventBus";

// Core Event Types - Used for event content classification
export type EventType =
  | "speech" // Agent speaking in room
  | "thought" // Agent internal thoughts
  | "perception" // What agent perceives
  | "action" // Physical actions
  | "appearance" // Appearance changes
  | "state" // State changes
  | "experience" // Memories/experiences
  | "agent"; // Agent-specific events

// Event Categories - Used for agent event processing
export type EventCategory =
  | "thought"
  | "perception"
  | "action"
  | "appearance"
  | "experience"
  | "speech"
  | "state";

// Base Event Structure
export interface BaseEvent<T = string> {
  type: EventType;
  content: T;
  timestamp: number;
}

// Room Event
export interface RoomEvent<T extends EventType = EventType>
  extends BaseEvent<
    T extends "state"
      ? RoomEventContent
      : T extends "action"
      ? ActionContent
      : T extends "experience"
      ? ExperienceContent
      : T extends "speech"
      ? SpeechContent
      : string
  > {
  roomId: string;
  agentId?: string;
  agentName?: string;
}

// Agent Event
export interface AgentEvent<T extends EventType = EventType>
  extends BaseEvent<T extends "state" ? { agent?: AgentState } : string> {
  agentId: string;
  category: EventCategory;
}

// WebSocket Message Types - Standardized to use UPDATE suffix
export type MessageType =
  | "WORLD_UPDATE"
  | "ROOM_UPDATE"
  | "AGENT_UPDATE"
  | "CHAT"
  | "START"
  | "STOP"
  | "RESET"
  | "SUBSCRIBE_ROOM"
  | "UNSUBSCRIBE_ROOM"
  | "SUBSCRIBE_AGENT"
  | "UNSUBSCRIBE_AGENT"
  | "CONNECTION_UPDATE";

// Base Message Structure
export interface BaseMessage {
  type: MessageType;
  timestamp: number;
}

// World State
export interface WorldState {
  agents: AgentState[];
  rooms: RoomState[];
  relationships: NetworkLink[];
  isRunning: boolean;
  timestamp: number;
}

export interface WorldUpdateMessage extends BaseMessage {
  type: "WORLD_UPDATE";
  data: WorldState;
}

// Room Update
export interface RoomUpdateMessage extends BaseMessage {
  type: "ROOM_UPDATE";
  data: RoomEvent;
}

// Agent Update
export interface AgentUpdateMessage extends BaseMessage {
  type: "AGENT_UPDATE";
  channel: {
    room: string;
    agent: string;
  };
  data: AgentEvent;
}

// Connection Update
export interface ConnectionUpdateMessage extends BaseMessage {
  type: "CONNECTION_UPDATE";
  connected: boolean;
}

// Chat Message
export interface ChatMessage extends BaseMessage {
  type: "CHAT";
  message: string;
  target?: string;
}

// Control Messages
export type ControlMessage = BaseMessage & {
  type: "START" | "STOP" | "RESET";
};

// Subscription Messages
export interface SubscriptionMessage extends BaseMessage {
  type:
    | "SUBSCRIBE_ROOM"
    | "UNSUBSCRIBE_ROOM"
    | "SUBSCRIBE_AGENT"
    | "UNSUBSCRIBE_AGENT";
  roomId?: string;
  agentId?: string;
}

// All Message Types
export type ServerMessage =
  | WorldUpdateMessage
  | RoomUpdateMessage
  | ChatMessage
  | ControlMessage
  | AgentUpdateMessage
  | ConnectionUpdateMessage;

export type ClientMessage = SubscriptionMessage | ChatMessage | ControlMessage;

// Entity Types
export interface Agent {
  id: string;
  eid: number;
  name: string;
  role: string;
  systemPrompt: string;
  active: boolean;
  platform: string;
  appearance: string;
  roomId: number | null;
}

export interface Room {
  id: string;
  eid: number;
  name: string;
  type: RoomType;
  description: string;
}

export interface Relationship {
  source: string;
  target: string;
  type: string;
  value: number;
}

// Network Graph Types
export interface NetworkPosition {
  x: number;
  y: number;
}

export interface NetworkNode {
  id: string;
  name: string;
  type: "room" | "agent";
  position?: NetworkPosition;
  color?: string;
  val?: number;
}

export interface NetworkLink {
  source: string;
  target: string;
  type: "presence" | "interaction" | "attention";
  value: number;
}

export interface NetworkState {
  nodes: NetworkNode[];
  links: NetworkLink[];
}

// Agent Event Data Types
export interface AgentEventMessage extends AgentUpdateMessage {
  data: AgentEvent;
}

export interface ActionModule {
  schema: any;
  action: {
    name: string;
    description: string;
    parameters: string[];
    schema: any;
  };
  execute: (
    world: World,
    eid: number,
    parameters: any,
    eventBus: EventBus
  ) => Promise<void>;
}

export type ActionModules = Record<string, ActionModule>;

// Room State
export interface RoomState {
  id: string;
  name: string;
  type: RoomType;
  description: string;
  occupants: Array<{
    id: string;
    name: string;
    attention: number;
  }>;
  stimuli: Array<{
    type: string;
    content: string;
    source?: string;
    timestamp: number;
  }>;
  lastUpdate: number;
}

export interface InternalRoomState extends RoomState {
  eid: number;
}

// Agent State
export interface AgentState {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  active: boolean;
  platform: string;
  appearance: string;
  attention: number;
  roomId: string | null;
  facialExpression?: string;
  bodyLanguage?: string;
  currentAction?: string;
  socialCues?: string;
  lastUpdate: number;
  emotionalState?: string;
  goals?: string[];
  memories?: string[];
  context?: string;
  recentThoughts?: string[];
}

interface RoomEventContent {
  room?: RoomState;
  agent?: AgentState;
  relationships?: NetworkLink[];
}

export interface ActionContent {
  action: string;
  reason: string;
  parameters?: Record<string, any>;
  agentName: string;
  context?: "room" | "private";
}

export interface ExperienceContent {
  type: EventType;
  content: string;
  timestamp: number;
}

export interface SpeechContent {
  message: string;
  tone?: string;
  target?: string;
  agentName: string;
}
