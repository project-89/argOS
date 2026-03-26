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
  SimulationStatusEvent,
  WorldEvent,
  RoomEvent,
  DaemonEvent,
  ChannelType,
} from "../types/events";

// Connection status
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
export type SimulationRunStatus = "running" | "paused" | "stopped";

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

export interface EntitySummary {
  id: number;
  name: string;
  description: string;
  room: string | null;
  type: string;
  gridPosition?: {
    x: number;
    y: number;
    facing?: string;
  } | null;
}

export interface SystemSummary {
  name: string;
  description: string;
  frequency: number;
  active: boolean;
}

export interface SystemLogEntry {
  id: string;
  timestamp: number;
  type: "created" | "executed" | "error" | "log";
  message: string;
  duration?: number;
  entitiesProcessed?: number;
  tick?: number;
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
  latestPovStory?: string;
  arcStatus?: string;
  arcTension?: number;
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
  entityCount: number;
  roomCount: number;
  systemCount: number;
  spiritCount: number;
  daemonCount: number;
  tension: number;
  simulationStatus: SimulationRunStatus;
  simulationStatusUpdatedAt: number | null;

  // Entity data
  agents: AgentSummary[];
  entities: EntitySummary[];
  rooms: RoomSummary[];
  stimulusSources: StimulusSourceSummary[];
  systems: SystemSummary[];
  systemLogs: Record<string, SystemLogEntry[]>;
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
  selectedEntity: string | null;
  selectedRoom: string | null;
  selectedSystem: string | null;
  selectedSpirit: string | null;
  selectedDaemon: string | null;

  // Narrative log (story prose from The Narrator)
  narrativeLog: Array<{ content: string; timestamp: number }>;

  // Persistence state
  simulationId: string | null;
  simulationName: string | null;
  saves: Array<{
    id: string;
    name: string;
    description?: string;
    createdAt: number;
    lastSavedAt: number;
    currentTick: number;
  }>;
  lastSavedAt: number | null;

  // UI state
  sidebarOpen: boolean;
  activePanel: "dashboard" | "agents" | "entities" | "rooms" | "spirits" | "systems" | "timeline" | "logs" | "daemons" | "mapeditor";

  // Actions
  setStatus: (status: ConnectionStatus, error?: string) => void;
  addEvent: (event: SimulationEvent) => void;
  clearEvents: () => void;
  setSubscription: (channel: ChannelType | "*", active: boolean) => void;
  setSelectedAgent: (name: string | null) => void;
  setSelectedEntity: (name: string | null) => void;
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
  entityCount: 0,
  roomCount: 0,
  systemCount: 0,
  spiritCount: 0,
  daemonCount: 0,
  tension: 0,
  simulationStatus: "stopped",
  simulationStatusUpdatedAt: null,

  // Entity data
  agents: [],
  entities: [],
  rooms: [],
  stimulusSources: [],
  systems: [],
  systemLogs: {},
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

  narrativeLog: [],

  simulationId: null,
  simulationName: null,
  saves: [],
  lastSavedAt: null,

  subscriptions: [{ channel: "*", active: true }],

  selectedAgent: null,
  selectedEntity: null,
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
    const appendSystemLog = (
      systemName: string,
      entry: Omit<SystemLogEntry, "id">
    ) => {
      const sourceLogs = updates.systemLogs ?? state.systemLogs;
      const existing = sourceLogs[systemName] ?? [];
      const nextEntry: SystemLogEntry = {
        id: `${entry.timestamp}-${systemName}-${entry.type}-${existing.length}`,
        ...entry,
      };
      updates.systemLogs = {
        ...sourceLogs,
        [systemName]: [nextEntry, ...existing].slice(0, 200),
      };
    };

    if (event.type.startsWith("god:")) {
      updates.godEvents = [event as GodEvent, ...state.godEvents].slice(0, 100);
    } else if (event.type.startsWith("spirit:")) {
      updates.spiritEvents = [event as SpiritEvent, ...state.spiritEvents].slice(0, 100);
      // Capture narrative prose from The Narrator
      const spiritMsg = event as any;
      if (spiritMsg.messageType === "story" && spiritMsg.content) {
        updates.narrativeLog = [
          ...state.narrativeLog,
          { content: spiritMsg.content, timestamp: event.timestamp },
        ].slice(-200); // Keep last 200 entries
      }
    } else if (event.type.startsWith("agent:")) {
      updates.agentEvents = [event as AgentEvent, ...state.agentEvents].slice(0, 100);
    } else if (event.type.startsWith("system:")) {
      updates.systemEvents = [event as SystemEvent, ...state.systemEvents].slice(0, 100);
      const systemEvent = event as SystemEvent & {
        systemName?: string;
        message?: string;
        tick?: number;
        duration?: number;
        entitiesProcessed?: number;
        description?: string;
        frequency?: number;
        error?: string;
      };
      const systemName = systemEvent.systemName || "System";
      const timestamp = event.timestamp || Date.now();
      if (event.type === "system:created") {
        const nextSystems = [...state.systems];
        const existingIndex = nextSystems.findIndex((s) => s.name === systemName);
        const nextSummary: SystemSummary = {
          name: systemName,
          description: systemEvent.description || "",
          frequency: systemEvent.frequency || 1000,
          active: true,
        };
        if (existingIndex >= 0) {
          nextSystems[existingIndex] = {
            ...nextSystems[existingIndex],
            ...nextSummary,
          };
        } else {
          nextSystems.push(nextSummary);
        }
        updates.systems = nextSystems;
        appendSystemLog(systemName, {
          timestamp,
          type: "created",
          message: `System created (${nextSummary.frequency}ms)`,
          tick: systemEvent.tick,
        });
      } else if (event.type === "system:executed") {
        appendSystemLog(systemName, {
          timestamp,
          type: "executed",
          message:
            systemEvent.duration !== undefined
              ? `Executed in ${systemEvent.duration.toFixed(1)}ms`
              : "Executed",
          duration: systemEvent.duration,
          entitiesProcessed: systemEvent.entitiesProcessed,
          tick: systemEvent.tick,
        });
      } else if (event.type === "system:error") {
        appendSystemLog(systemName, {
          timestamp,
          type: "error",
          message: systemEvent.error || "System error",
          tick: systemEvent.tick,
        });
      } else if (event.type === "system:log") {
        appendSystemLog(systemName, {
          timestamp,
          type: "log",
          message: systemEvent.message || "",
          tick: systemEvent.tick,
        });
      }
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
          entities?: EntitySummary[];
          rooms?: RoomSummary[];
          stimulusSources?: StimulusSourceSummary[];
          systems?: SystemSummary[];
          spirits?: SpiritSummary[];
          daemons?: DaemonSummary[];
        };
        updates.tick = worldState.tick;
        updates.agentCount = worldState.agentCount;
        updates.entityCount = worldState.entities?.length ?? state.entityCount;
        updates.roomCount = worldState.roomCount;
        updates.systemCount = worldState.systemCount;
        if (worldState.spiritCount !== undefined) updates.spiritCount = worldState.spiritCount;
        if (worldState.daemonCount !== undefined) updates.daemonCount = worldState.daemonCount;
        if (worldState.tension !== undefined) updates.tension = worldState.tension;

        // Update entity data if present
        if (worldState.agents) updates.agents = worldState.agents;
        if (worldState.entities) updates.entities = worldState.entities;
        if (worldState.rooms) updates.rooms = worldState.rooms;
        if (worldState.stimulusSources) updates.stimulusSources = worldState.stimulusSources;
        if (worldState.systems) updates.systems = worldState.systems;
        if (worldState.spirits) updates.spirits = worldState.spirits;
        if (worldState.daemons) updates.daemons = worldState.daemons;
      }
    } else if (event.type === "simulation:status") {
      const simStatus = event as SimulationStatusEvent;
      updates.simulationStatus = simStatus.status;
      updates.simulationStatusUpdatedAt = simStatus.timestamp;
      if (simStatus.tick !== undefined) {
        updates.tick = simStatus.tick;
      }
    } else if (event.type === "simulation:error") {
      const simError = event as { error?: string };
      updates.error = simError.error || state.error;
    } else if (event.type === "simulation:saved") {
      const saved = event as any;
      updates.simulationId = saved.simulationId;
      updates.simulationName = saved.simulationName;
      updates.lastSavedAt = event.timestamp;
    } else if (event.type === "simulation:loaded") {
      const loaded = event as any;
      updates.simulationId = loaded.simulationId;
      updates.simulationName = loaded.simulationName;
      updates.lastSavedAt = event.timestamp;
      // Clear narrative log on load - fresh start
      updates.narrativeLog = [];
    } else if (event.type === "simulation:saves_list") {
      const list = event as any;
      updates.saves = list.saves || [];
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
      systemLogs: {},
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
  setSelectedEntity: (name) => set({ selectedEntity: name }),
  setSelectedRoom: (name) => set({ selectedRoom: name }),
  setSelectedSystem: (name) => set({ selectedSystem: name }),
  setSelectedSpirit: (name) => set({ selectedSpirit: name }),
  setSelectedDaemon: (name) => set({ selectedDaemon: name }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setActivePanel: (panel) => set({ activePanel: panel }),

  updateFromWorldState: (state) => {
    if (state.type === "world:state") {
      const worldState = state as WorldEvent & {
        tick: number;
        agentCount: number;
        roomCount: number;
        systemCount: number;
        entities?: EntitySummary[];
      };
      set({
        tick: worldState.tick,
        agentCount: worldState.agentCount,
        entityCount: worldState.entities?.length ?? get().entityCount,
        roomCount: worldState.roomCount,
        systemCount: worldState.systemCount,
      });
    }
  },
}));
