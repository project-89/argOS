import { create } from "zustand";
import { Room } from "../types";

interface SimulationState {
  agents: any[];
  rooms: any[];
  relationships: Array<{
    source: string;
    target: string;
    type: string;
    value: number;
  }>;
  selectedAgent: string | null;
  selectedRoom: string | null;
  isRunning: boolean;
  setSelectedAgent: (agent: string | null) => void;
  setSelectedRoom: (room: string | null) => void;
  setAgents: (agents: any[] | ((prev: any[]) => any[])) => void;
  setRooms: (rooms: any[]) => void;
  setRelationships: (
    relationships: Array<{
      source: string;
      target: string;
      type: string;
      value: number;
    }>
  ) => void;
  setIsRunning: (isRunning: boolean) => void;
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  agents: [],
  rooms: [],
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
  setRooms: (rooms) => set({ rooms }),
  setRelationships: (relationships) => set({ relationships }),
  setIsRunning: (isRunning) => set({ isRunning }),
}));
