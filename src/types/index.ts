import { RoomType } from "../components/agent/Agent";

export type MessageType =
  | "WORLD_STATE"
  | "AGENT_STATE"
  | "ROOM_STATE"
  | "CONNECTION_STATE"
  | "AGENT_UPDATE"
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
    category: "appearance" | "thought" | "action" | "perception" | "experience";
    appearance?: {
      facialExpression?: string;
      bodyLanguage?: string;
      currentAction?: string;
      socialCues?: string;
    };
    thought?: string;
    perception?: {
      timestamp: number;
      content: string;
    };
    experience?: {
      type: string;
      content: string;
      timestamp: number;
    };
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

export interface AgentUpdateMessage extends BaseMessage {
  type: "AGENT_UPDATE";
  channel: {
    room: string;
    agent: string;
  };
  data: AgentEventMessage;
}

export type ServerMessage =
  | WorldStateMessage
  | AgentStateMessage
  | RoomStateMessage
  | ConnectionStateMessage
  | AgentUpdateMessage;

export type ClientMessage = SubscriptionMessage | ChatMessage | ControlMessage;

export interface WorldState {
  agents: any[]; // TODO: Create proper Agent interface
  rooms: Room[];
  isRunning: boolean;
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

// Event Types
export type AgentEventType =
  | "thought"
  | "perception"
  | "experience"
  | "action"
  | "appearance"
  | "state"
  | "stimulus";

export interface AgentEventData {
  category: string;
  content: any;
  timestamp: number;
}

export interface AgentThoughtData extends AgentEventData {
  category: "thought";
  content: string;
}

export interface AgentPerceptionData extends AgentEventData {
  category: "perception";
  content: {
    timestamp: number;
    content: string;
  };
}

export interface AgentExperienceData extends AgentEventData {
  category: "experience";
  content: {
    type: string;
    content: string;
    timestamp: number;
  };
}

export interface AgentAppearanceData extends AgentEventData {
  category: "appearance";
  content: {
    baseDescription?: string;
    facialExpression?: string;
    bodyLanguage?: string;
    currentAction?: string;
    socialCues?: string;
    lastUpdate?: number;
  };
}

export interface AgentActionData extends AgentEventData {
  category: "action";
  content: {
    tool: string;
  };
}

export interface AgentStateData extends AgentEventData {
  category: "state";
  content: {
    id: string;
    name: string;
    role: string;
    systemPrompt: string;
    active: boolean;
    platform: string;
    appearance: string;
    attention: any;
  };
}

export type AgentEventDataType =
  | AgentThoughtData
  | AgentPerceptionData
  | AgentExperienceData
  | AgentAppearanceData
  | AgentActionData
  | AgentStateData;

// Message Types
export interface AgentEventMessage {
  type: AgentEventType;
  data: AgentEventDataType;
  timestamp: number;
}

// Stimulus Types
export type StimulusType =
  | "VISUAL"
  | "AUDITORY"
  | "COGNITIVE"
  | "TECHNICAL"
  | "ENVIRONMENTAL";

export interface StimulusMetadata {
  sourceName: string;
  sourceRole: string;
  roomName: string;
  decay: number;
  [key: string]: any;
}

export interface BaseStimulus {
  name: string;
  role: string;
  timestamp: number;
  category: string;
  metadata: StimulusMetadata;
}

export interface AuditoryStimulusContent extends BaseStimulus {
  speech: string;
  tone?: string;
  metadata: StimulusMetadata & {
    isDirected: boolean;
    targetName?: string;
    targetRole?: string;
  };
}

export interface VisualStimulusContent extends BaseStimulus {
  appearance?: string;
  action?: string;
  metadata: StimulusMetadata & {
    hasAppearance: boolean;
    roomContext: string;
  };
}
