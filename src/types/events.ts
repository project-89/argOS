import { AgentSchema } from "../components/Agent";
import { RoomSchema } from "../components/Room";
import { NetworkLink } from "./network";
import { z } from "zod";
import { AgentState } from "./state";

type AgentType = z.infer<typeof AgentSchema>;
type RoomType = z.infer<typeof RoomSchema>;

// Core Event Types
export type EventType =
  | "speech" // Agent speaking in room
  | "thought" // Agent internal thoughts
  | "perception" // What agent perceives
  | "action" // Physical actions
  | "appearance" // Appearance changes
  | "state" // State changes
  | "experience" // Memories/experiences
  | "agent"; // Agent-specific events

// Event Categories
export type EventCategory =
  | "thought"
  | "perception"
  | "action"
  | "appearance"
  | "engine"
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
export interface AgentEvent<T = EventType> {
  type: T;
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
}

// Event Content Types
export interface RoomEventContent {
  room?: RoomType;
  agent?: AgentType;
  relationships?: NetworkLink[];
}

export interface ActionContent {
  action: string;
  result: string;
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

// Event Channel
export type EventChannel = {
  room: string;
  agent?: string;
};

// Event Types for EventBus
export type EventTypes = {
  AGENT_UPDATE: {
    channel: { room: string; agent: string };
    data: AgentEvent;
  };
  ROOM_UPDATE: {
    channel: { room: string };
    data: RoomEvent;
  };
  WORLD_UPDATE: {
    channel: { room: string };
    data: {
      agents: AgentType[];
      rooms: RoomType[];
      relationships: NetworkLink[];
      isRunning: boolean;
      timestamp: number;
    };
  };
};

export type EventPayload<T extends keyof EventTypes> = {
  type: T;
  channel: EventTypes[T]["channel"];
  data: EventTypes[T]["data"];
  timestamp: number;
};

export type AnyEventPayload = EventPayload<keyof EventTypes>;
