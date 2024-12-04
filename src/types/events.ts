import { AgentStateMessage, RoomStateMessage, WorldState } from "../types";

export type EventChannel = {
  room: string;
  agent?: string;
};

export type EventTypes = {
  AGENT_UPDATE: {
    channel: { room: string; agent: string };
    data: AgentStateMessage["data"];
  };
  ROOM_UPDATE: {
    channel: { room: string };
    data: RoomStateMessage["data"];
  };
  WORLD_UPDATE: {
    channel: { room: string };
    data: WorldState;
  };
};

export type EventPayload<T extends keyof EventTypes> = {
  type: T;
  channel: EventTypes[T]["channel"];
  data: EventTypes[T]["data"];
  timestamp: number;
};

export type AnyEventPayload = EventPayload<keyof EventTypes>;
