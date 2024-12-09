import { create } from "zustand";
import {
  Room,
  ServerMessage,
  AgentState,
  RoomState,
  NetworkLink,
} from "../types";

interface SimulationState {
  agents: AgentState[];
  rooms: RoomState[];
  logs: ServerMessage[];
  relationships: NetworkLink[];
  selectedAgent: string | null;
  selectedRoom: string | null;
  isRunning: boolean;
  setSelectedAgent: (agent: string | null) => void;
  setSelectedRoom: (room: string | null) => void;
  setAgents: (
    agents: AgentState[] | ((prev: AgentState[]) => AgentState[])
  ) => void;
  setRooms: (rooms: RoomState[] | ((prev: RoomState[]) => RoomState[])) => void;
  setRelationships: (relationships: NetworkLink[]) => void;
  setIsRunning: (isRunning: boolean) => void;
  addLog: (log: ServerMessage) => void;
  clearLogs: () => void;
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  agents: [],
  rooms: [],
  logs: [],
  relationships: [],
  selectedAgent: null,
  selectedRoom: null,
  isRunning: false,
  setSelectedAgent: (agent) => set({ selectedAgent: agent }),
  setSelectedRoom: (room) => set({ selectedRoom: room }),
  setAgents: (agents) =>
    set({
      agents: typeof agents === "function" ? agents(get().agents) : agents,
    }),
  setRooms: (rooms) =>
    set({
      rooms: typeof rooms === "function" ? rooms(get().rooms || []) : rooms,
    }),
  setRelationships: (relationships) => set({ relationships }),
  setIsRunning: (isRunning) => set({ isRunning }),
  addLog: (log) => set((state) => ({ logs: [...state.logs, log] })),
  clearLogs: () => set({ logs: [] }),
}));
