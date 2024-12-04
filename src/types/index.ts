import { RoomType } from "../components/agent/Agent";

export type MessageType =
  | "WORLD_STATE"
  | "AGENT_STATE"
  | "ROOM_STATE"
  | "CONNECTION_STATE"
  | "SUBSCRIBE_ROOM"
  | "UNSUBSCRIBE_ROOM"
  | "SUBSCRIBE_AGENT"
  | "UNSUBSCRIBE_AGENT"
  | "CHAT"
  | "START"
  | "STOP"
  | "RESET";

export interface BaseMessage {
  type: MessageType;
  timestamp: number;
}

export interface WorldStateMessage extends BaseMessage {
  type: "WORLD_STATE";
  data: WorldState;
}

export interface AgentStateMessage extends BaseMessage {
  type: "AGENT_STATE";
  data: {
    agentId: string;
    agentName: string;
    category: "appearance" | "thought" | "action";
    appearance?: {
      facialExpression?: string;
      bodyLanguage?: string;
      currentAction?: string;
      socialCues?: string;
    };
    thought?: string;
    action?: {
      type: string;
      data: any;
    };
  };
}

export interface RoomStateMessage extends BaseMessage {
  type: "ROOM_STATE";
  data: {
    roomId: string;
    event: any; // TODO: Type this properly based on room events
  };
}

export interface ConnectionStateMessage extends BaseMessage {
  type: "CONNECTION_STATE";
  connected: boolean;
}

export interface SubscriptionMessage extends BaseMessage {
  type:
    | "SUBSCRIBE_ROOM"
    | "UNSUBSCRIBE_ROOM"
    | "SUBSCRIBE_AGENT"
    | "UNSUBSCRIBE_AGENT";
  roomId?: string;
  agentId?: string;
}

export interface ChatMessage extends BaseMessage {
  type: "CHAT";
  message: string;
  target?: string;
}

export interface ControlMessage extends BaseMessage {
  type: "START" | "STOP" | "RESET";
}

export type ServerMessage =
  | WorldStateMessage
  | AgentStateMessage
  | RoomStateMessage
  | ConnectionStateMessage;

export type ClientMessage = SubscriptionMessage | ChatMessage | ControlMessage;

export interface WorldState {
  agents: any[]; // TODO: Create proper Agent interface
  rooms: Room[];
  relationships: Array<{
    source: string;
    target: string;
    type: string;
    value: number;
  }>;
  timestamp: number;
}

export interface AgentColor {
  id: number;
  name: string;
  color: string;
}

export interface Room {
  id: string;
  eid: number;
  name: string;
  type: RoomType;
  description: string;
}

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
