/**
 * Zustand store for simulation state
 */

import { create } from "zustand";
import type {
  SimulationEvent,
  GodEvent,
  SpiritEvent,
  AgentEvent,
  SystemEvent,
  WorldEvent,
  RoomEvent,
  DaemonEvent,
  ChannelType,
} from "../types/events";

// Connection status
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

// Subscription state
export interface ChannelSubscription {
  channel: ChannelType | "*";
  active: boolean;
}

// Memory summary for agents
export interface MemorySummary {
  id: number;
  type: string;
  content: string;
  importance: number;
  emotionalValence: number;
  timestamp: number;
}

// Entity types for display
export interface AgentSummary {
  id: number;
  name: string;
  description: string;
  role: string;
  room: string | null;
  mind: {
    mode: string;
    arousal: number;
    focus: string;
  };
  memories?: MemorySummary[];
  currentThought?: string;
}

export interface RoomSummary {
  id: number;
  name: string;
  description: string;
  capacity: number;
  ambience: string;
  occupants: string[];
}

export interface StimulusSourceSummary {
  id: number;
  name: string;
  description: string;
  room: string | null;
  type: string;
}

export interface SystemSummary {
  name: string;
  description: string;
  frequency: number;
  active: boolean;
}

export interface SpiritSummary {
  id: number;
  name: string;
  domain: string;
  rank: string;
  description: string;
  observationInterval: number;
  lastObservation: number;
  inboxSize: number;
  observationsCount: number;
}

export interface DaemonSummary {
  agentEid: number;
  agentName: string;
  observationCount: number;
  whisperCount: number;
  reportCount: number;
  concernLevel: number;
  pendingNudges: number;
  memory: {
    thoughtCount: number;
    memoryCount: number;
    planCount: number;
    characterMoments: number;
    recentThoughts: Array<{
      focus: string;
      content: string;
      emotionalTone: string;
      timestamp: number;
    }>;
  };
  growthMetrics: {
    lastGoalChange: number;
    lastBeliefChange: number;
    lastRelationshipChange: number;
    stagnationScore: number;
  };
  lastObservation: number;
  lastWhisper: number;
  lastReport: number;
  active: boolean;
}

// Store state
export interface SimulationState {
  // Connection
  status: ConnectionStatus;
  error: string | null;
  lastPing: number | null;

  // Simulation info
  tick: number;
  agentCount: number;
  roomCount: number;
  systemCount: number;
  spiritCount: number;
  daemonCount: number;
  tension: number;

  // Entity data
  agents: AgentSummary[];
  rooms: RoomSummary[];
  stimulusSources: StimulusSourceSummary[];
  systems: SystemSummary[];
  spirits: SpiritSummary[];
  daemons: DaemonSummary[];

  // Events (recent history)
  events: SimulationEvent[];
  maxEvents: number;

  // Filtered events by category
  godEvents: GodEvent[];
  spiritEvents: SpiritEvent[];
  agentEvents: AgentEvent[];
  systemEvents: SystemEvent[];
  worldEvents: WorldEvent[];
  roomEvents: RoomEvent[];
  daemonEvents: DaemonEvent[];

  // Subscriptions
  subscriptions: ChannelSubscription[];

  // Selected items for detail views
  selectedAgent: string | null;
  selectedRoom: string | null;
  selectedSystem: string | null;
  selectedSpirit: string | null;
  selectedDaemon: string | null;

  // UI state
  sidebarOpen: boolean;
  activePanel: "dashboard" | "agents" | "rooms" | "spirits" | "systems" | "timeline" | "logs" | "daemons";

  // Actions
  setStatus: (status: ConnectionStatus, error?: string) => void;
  addEvent: (event: SimulationEvent) => void;
  clearEvents: () => void;
  setSubscription: (channel: ChannelType | "*", active: boolean) => void;
  setSelectedAgent: (name: string | null) => void;
  setSelectedRoom: (name: string | null) => void;
  setSelectedSystem: (name: string | null) => void;
  setSelectedSpirit: (name: string | null) => void;
  setSelectedDaemon: (name: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  setActivePanel: (panel: SimulationState["activePanel"]) => void;
  updateFromWorldState: (state: WorldEvent) => void;
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  // Initial state
  status: "disconnected",
  error: null,
  lastPing: null,

  tick: 0,
  agentCount: 0,
  roomCount: 0,
  systemCount: 0,
  spiritCount: 0,
  daemonCount: 0,
  tension: 0,

  // Entity data
  agents: [],
  rooms: [],
  stimulusSources: [],
  systems: [],
  spirits: [],
  daemons: [],

  events: [],
  maxEvents: 500,

  godEvents: [],
  spiritEvents: [],
  agentEvents: [],
  systemEvents: [],
  worldEvents: [],
  roomEvents: [],
  daemonEvents: [],

  subscriptions: [{ channel: "*", active: true }],

  selectedAgent: null,
  selectedRoom: null,
  selectedSystem: null,
  selectedSpirit: null,
  selectedDaemon: null,

  sidebarOpen: true,
  activePanel: "dashboard",

  // Actions
  setStatus: (status, error) => set({ status, error: error || null }),

  addEvent: (event) => {
    const state = get();
    const newEvents = [event, ...state.events].slice(0, state.maxEvents);

    // Categorize event
    const updates: Partial<SimulationState> = { events: newEvents };

    if (event.type.startsWith("god:")) {
      updates.godEvents = [event as GodEvent, ...state.godEvents].slice(0, 100);
    } else if (event.type.startsWith("spirit:")) {
      updates.spiritEvents = [event as SpiritEvent, ...state.spiritEvents].slice(0, 100);
    } else if (event.type.startsWith("agent:")) {
      updates.agentEvents = [event as AgentEvent, ...state.agentEvents].slice(0, 100);
    } else if (event.type.startsWith("system:")) {
      updates.systemEvents = [event as SystemEvent, ...state.systemEvents].slice(0, 100);
    } else if (event.type.startsWith("room:")) {
      updates.roomEvents = [event as RoomEvent, ...state.roomEvents].slice(0, 100);
    } else if (event.type.startsWith("daemon:")) {
      updates.daemonEvents = [event as DaemonEvent, ...state.daemonEvents].slice(0, 100);
    } else if (event.type.startsWith("world:")) {
      updates.worldEvents = [event as WorldEvent, ...state.worldEvents].slice(0, 100);

      // Update simulation stats and entity data from world:state events
      if (event.type === "world:state") {
        const worldState = event as WorldEvent & {
          tick: number;
          agentCount: number;
          roomCount: number;
          systemCount: number;
          spiritCount?: number;
          daemonCount?: number;
          tension?: number;
          agents?: AgentSummary[];
          rooms?: RoomSummary[];
          stimulusSources?: StimulusSourceSummary[];
          systems?: SystemSummary[];
          spirits?: SpiritSummary[];
          daemons?: DaemonSummary[];
        };
        updates.tick = worldState.tick;
        updates.agentCount = worldState.agentCount;
        updates.roomCount = worldState.roomCount;
        updates.systemCount = worldState.systemCount;
        if (worldState.spiritCount !== undefined) updates.spiritCount = worldState.spiritCount;
        if (worldState.daemonCount !== undefined) updates.daemonCount = worldState.daemonCount;
        if (worldState.tension !== undefined) updates.tension = worldState.tension;

        // Update entity data if present
        if (worldState.agents) updates.agents = worldState.agents;
        if (worldState.rooms) updates.rooms = worldState.rooms;
        if (worldState.stimulusSources) updates.stimulusSources = worldState.stimulusSources;
        if (worldState.systems) updates.systems = worldState.systems;
        if (worldState.spirits) updates.spirits = worldState.spirits;
        if (worldState.daemons) updates.daemons = worldState.daemons;
      }
    }

    set(updates);
  },

  clearEvents: () =>
    set({
      events: [],
      godEvents: [],
      spiritEvents: [],
      agentEvents: [],
      systemEvents: [],
      worldEvents: [],
      roomEvents: [],
      daemonEvents: [],
    }),

  setSubscription: (channel, active) => {
    const state = get();
    const existing = state.subscriptions.find((s) => s.channel === channel);

    if (existing) {
      set({
        subscriptions: state.subscriptions.map((s) =>
          s.channel === channel ? { ...s, active } : s
        ),
      });
    } else {
      set({
        subscriptions: [...state.subscriptions, { channel, active }],
      });
    }
  },

  setSelectedAgent: (name) => set({ selectedAgent: name }),
  setSelectedRoom: (name) => set({ selectedRoom: name }),
  setSelectedSystem: (name) => set({ selectedSystem: name }),
  setSelectedSpirit: (name) => set({ selectedSpirit: name }),
  setSelectedDaemon: (name) => set({ selectedDaemon: name }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setActivePanel: (panel) => set({ activePanel: panel }),

  updateFromWorldState: (state) => {
    if (state.type === "world:state") {
      const worldState = state as WorldEvent & { tick: number; agentCount: number; roomCount: number; systemCount: number };
      set({
        tick: worldState.tick,
        agentCount: worldState.agentCount,
        roomCount: worldState.roomCount,
        systemCount: worldState.systemCount,
      });
    }
  },
}));
