import { create } from "zustand";
import { Room } from "../types";

interface SimulationState {
  agents: any[];
  rooms: Room[];
  selectedAgent: string | null;
  selectedRoom: string | null;
  isRunning: boolean;
  setSelectedAgent: (agent: string | null) => void;
  setSelectedRoom: (room: string | null) => void;
  setAgents: (agents: any[]) => void;
  setRooms: (rooms: Room[]) => void;
  setIsRunning: (isRunning: boolean) => void;
}

export const useSimulationStore = create<SimulationState>((set) => ({
  agents: [],
  rooms: [],
  selectedAgent: null,
  selectedRoom: null,
  isRunning: false,
  setSelectedAgent: (agent) => set({ selectedAgent: agent }),
  setSelectedRoom: (room) => set({ selectedRoom: room }),
  setAgents: (agents) => set({ agents }),
  setRooms: (rooms) => set({ rooms }),
  setIsRunning: (isRunning) => set({ isRunning }),
}));
