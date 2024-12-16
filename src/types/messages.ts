import { NetworkLink } from "./network";
import { AgentEvent, RoomEvent } from "./events";
import { EventCategory, EventType } from "./events";
import { AgentState, RoomState } from "./state";

// WebSocket Message Types
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

// World State Message
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

// Room Update Message
export interface RoomUpdateMessage extends BaseMessage {
  type: "ROOM_UPDATE";
  data: RoomEvent;
}

// Agent Update Message
export interface AgentUpdateMessage extends BaseMessage {
  type: "AGENT_UPDATE";
  channel: {
    room: string;
    agent: string;
  };
  data: {
    type: EventType;
    agentId: string;
    category: EventCategory;
    content: {
      agent?: AgentState & {
        facialExpression?: string;
        bodyLanguage?: string;
        currentAction?: string;
        socialCues?: string[];
      };
    };
    timestamp: number;
  };
}

// Connection Update Message
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
