import { RoomType } from "../components/agent/Agent";

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
    | "NETWORK_UPDATE"
    | "ROOM_STIMULUS";
  category?: "thought" | "experience" | "perception" | "system" | string;
  data: any;
  timestamp: number;
  agentId?: number;
  agentName?: string;
  actionType?:
    | "SPEECH"
    | "THOUGHT"
    | "WAIT"
    | "MOVEMENT"
    | "PERCEPTION"
    | "SYSTEM";
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

export type ClientMessage =
  | { type: "START" }
  | { type: "STOP" }
  | { type: "RESET" }
  | { type: "CHAT"; message: string }
  | { type: "SUBSCRIBE_ROOM"; roomId: string }
  | { type: "UNSUBSCRIBE_ROOM"; roomId: string }
  | { type: "SUBSCRIBE_AGENT"; agentId: string }
  | { type: "UNSUBSCRIBE_AGENT"; agentId: string };

export interface WorldState {
  agents: any[];
  rooms: Room[];
  relationships: Array<{
    source: string;
    target: string;
    type: string;
    value: number;
  }>;
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

export type ServerMessage = SimulationEvent | WorldState;
