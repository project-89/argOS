export interface SimulationEvent {
  type:
    | "LOG"
    | "AGENT_STATE"
    | "SYSTEM_STATE"
    | "AGENT_ACTION"
    | "ERROR"
    | "PERCEPTION"
    | "WORLD_STATE"
    | "ROOM_UPDATE"
    | "NETWORK_UPDATE";
  category?: string;
  data: any;
  timestamp: number;
  agentId?: number;
  agentName?: string;
  actionType?: "SPEECH" | "THOUGHT" | "WAIT" | "MOVEMENT" | "SYSTEM";
}

export interface AgentColor {
  id: number;
  name: string;
  color: string;
}

export interface Room {
  id: string;
  name: string;
  description: string;
  type: "physical" | "discord" | "twitter" | "private";
  occupants: number[]; // entity IDs
  stimuli: number[]; // entity IDs of active stimuli
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

export interface WorldState {
  agents: any[];
  rooms: Room[];
  timestamp: number;
}

export interface ChatMessage {
  type: "CHAT";
  data: {
    message: string;
    target?: string | null;
    roomId?: string | null;
  };
}

export interface ControlMessage {
  type: "START" | "STOP" | "RESET";
}

export type ClientMessage = ChatMessage | ControlMessage;
export type ServerMessage = SimulationEvent | WorldState;
