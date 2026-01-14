/**
 * Rooms Panel - Full room insight with activity feed
 */

import { useState, useMemo } from "react";
import { MapPin, Users, Zap, Info, MessageSquare, Activity, Eye, Radio, User, ArrowRight, ArrowLeft } from "lucide-react";
import { useSimulationStore, type RoomSummary, type StimulusSourceSummary, type AgentSummary } from "../../store/simulation";
import type { RoomEvent, AgentEvent } from "../../types/events";

export function RoomsPanel() {
  const {
    rooms,
    stimulusSources,
    agents,
    selectedRoom,
    setSelectedRoom,
    roomEvents,
    agentEvents,
    events,
  } = useSimulationStore();

  if (rooms.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <MapPin className="w-12 h-12 text-argos-text-muted mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-argos-text-primary mb-2">No Rooms Yet</h2>
          <p className="text-argos-text-muted">
            Create a simulation using the presets or God commands to create rooms.
          </p>
        </div>
      </div>
    );
  }

  const selected = rooms.find(r => r.name === selectedRoom);
  const roomSources = selected
    ? stimulusSources.filter(s => s.room === selected.name)
    : [];
  const roomAgents = selected
    ? agents.filter(a => a.room === selected.name)
    : [];

  // Get activity for selected room - both room events and agent events in this room
  const roomActivity = useMemo(() => {
    if (!selected) return [];

    // Get room-specific events
    const roomSpecific = roomEvents.filter(
      (e: any) => e.roomName === selected.name || e.room === selected.name
    );

    // Get agent events for agents in this room
    const agentNames = new Set(roomAgents.map(a => a.name));
    const agentActivity = agentEvents.filter((e: any) => {
      // Only include speech and action events
      if (e.type !== "agent:action") return false;
      return agentNames.has(e.agentName) || agentNames.has(e.agent);
    });

    // Also check all events for any with room context
    const allRoomEvents = events.filter((e: any) => {
      if (e.roomName === selected.name || e.room === selected.name) return true;
      // Check if it's an agent action with speech/action in this room
      if (e.type === "agent:action" && e.action === "speak") {
        return agentNames.has(e.agentName);
      }
      return false;
    });

    // Combine and sort by timestamp, remove duplicates
    const combined = [...roomSpecific, ...agentActivity, ...allRoomEvents];
    const seen = new Set<string>();
    const deduped = combined.filter(e => {
      const key = `${e.type}-${e.timestamp}-${(e as any).content || (e as any).action || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return deduped
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 50);
  }, [selected, roomEvents, agentEvents, events, roomAgents]);

  return (
    <div className="h-full flex">
      {/* Room List */}
      <div className="w-80 border-r border-argos-border overflow-auto">
        <div className="p-4 border-b border-argos-border bg-argos-bg-tertiary">
          <h2 className="font-semibold text-argos-text-primary flex items-center gap-2">
            <MapPin className="w-5 h-5 text-argos-world" />
            Rooms ({rooms.length})
          </h2>
        </div>
        <div className="p-2 space-y-1">
          {rooms.map((room) => (
            <RoomListItem
              key={room.id}
              room={room}
              isSelected={room.name === selectedRoom}
              onClick={() => setSelectedRoom(room.name)}
            />
          ))}
        </div>

        {/* Stimulus Sources */}
        {stimulusSources.length > 0 && (
          <>
            <div className="p-4 border-t border-b border-argos-border bg-argos-bg-tertiary mt-2">
              <h3 className="font-semibold text-argos-text-primary flex items-center gap-2">
                <Zap className="w-4 h-4 text-argos-spirit" />
                Stimulus Sources ({stimulusSources.length})
              </h3>
            </div>
            <div className="p-2 space-y-1">
              {stimulusSources.map((source) => (
                <StimulusSourceItem key={source.id} source={source} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Room Detail */}
      <div className="flex-1 overflow-auto">
        {selected ? (
          <RoomDetail
            room={selected}
            sources={roomSources}
            occupants={roomAgents}
            activity={roomActivity}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-argos-text-muted">Select a room to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}

function RoomListItem({
  room,
  isSelected,
  onClick,
}: {
  room: RoomSummary;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full p-3 rounded-lg text-left transition-all ${
        isSelected
          ? "bg-argos-world/20 border border-argos-world/40"
          : "bg-argos-bg-tertiary hover:bg-argos-bg-elevated border border-transparent"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <span className="font-medium text-argos-text-primary truncate block">{room.name}</span>
          {room.ambience && (
            <p className="text-xs text-argos-text-muted mt-1 truncate">{room.ambience}</p>
          )}
        </div>
        <span className="text-xs text-argos-text-muted flex items-center gap-1">
          <Users className="w-3 h-3" />
          {room.occupants.length}
        </span>
      </div>
    </button>
  );
}

function StimulusSourceItem({ source }: { source: StimulusSourceSummary }) {
  return (
    <div className="p-3 rounded-lg bg-argos-bg-tertiary">
      <div className="flex items-center gap-2">
        <Zap className="w-4 h-4 text-argos-spirit" />
        <span className="font-medium text-argos-text-primary text-sm">{source.name}</span>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs text-argos-text-muted">{source.type}</span>
        {source.room && (
          <>
            <span className="text-xs text-argos-text-muted">•</span>
            <span className="text-xs text-argos-text-muted">{source.room}</span>
          </>
        )}
      </div>
    </div>
  );
}

function RoomDetail({
  room,
  sources,
  occupants,
  activity,
}: {
  room: RoomSummary;
  sources: StimulusSourceSummary[];
  occupants: AgentSummary[];
  activity: any[];
}) {
  const [viewMode, setViewMode] = useState<"overview" | "activity">("overview");

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-argos-border">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-xl bg-argos-world/20 flex items-center justify-center">
            <MapPin className="w-8 h-8 text-argos-world" />
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-semibold text-argos-text-primary">{room.name}</h2>
            {room.ambience && (
              <p className="text-argos-text-secondary mt-1">{room.ambience}</p>
            )}
            {room.description && (
              <p className="text-sm text-argos-text-muted mt-2">{room.description}</p>
            )}
          </div>
        </div>

        {/* View Toggle */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setViewMode("overview")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              viewMode === "overview"
                ? "bg-argos-world text-white"
                : "bg-argos-bg-tertiary text-argos-text-secondary hover:bg-argos-bg-elevated"
            }`}
          >
            <Eye className="w-4 h-4 inline-block mr-2" />
            Overview
          </button>
          <button
            onClick={() => setViewMode("activity")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              viewMode === "activity"
                ? "bg-argos-world text-white"
                : "bg-argos-bg-tertiary text-argos-text-secondary hover:bg-argos-bg-elevated"
            }`}
          >
            <Activity className="w-4 h-4 inline-block mr-2" />
            Activity ({activity.length})
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {viewMode === "overview" ? (
          <RoomOverview room={room} sources={sources} occupants={occupants} />
        ) : (
          <RoomActivityFeed activity={activity} roomName={room.name} />
        )}
      </div>
    </div>
  );
}

function RoomOverview({
  room,
  sources,
  occupants,
}: {
  room: RoomSummary;
  sources: StimulusSourceSummary[];
  occupants: AgentSummary[];
}) {
  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="panel">
          <div className="p-4">
            <div className="w-10 h-10 rounded-lg bg-argos-agent/10 text-argos-agent flex items-center justify-center mb-3">
              <Users className="w-5 h-5" />
            </div>
            <p className="text-xs text-argos-text-muted">Occupants</p>
            <p className="text-lg font-semibold text-argos-text-primary">{occupants.length}</p>
          </div>
        </div>
        <div className="panel">
          <div className="p-4">
            <div className="w-10 h-10 rounded-lg bg-argos-world/10 text-argos-world flex items-center justify-center mb-3">
              <Info className="w-5 h-5" />
            </div>
            <p className="text-xs text-argos-text-muted">Capacity</p>
            <p className="text-lg font-semibold text-argos-text-primary">{room.capacity}</p>
          </div>
        </div>
        <div className="panel">
          <div className="p-4">
            <div className="w-10 h-10 rounded-lg bg-argos-spirit/10 text-argos-spirit flex items-center justify-center mb-3">
              <Radio className="w-5 h-5" />
            </div>
            <p className="text-xs text-argos-text-muted">Stimuli</p>
            <p className="text-lg font-semibold text-argos-text-primary">{sources.length}</p>
          </div>
        </div>
      </div>

      {/* Occupants Detail */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title flex items-center gap-2">
            <Users className="w-4 h-4 text-argos-agent" />
            Entities in Room ({occupants.length})
          </span>
        </div>
        <div className="panel-content">
          {occupants.length === 0 ? (
            <p className="text-sm text-argos-text-muted italic">Room is empty</p>
          ) : (
            <div className="space-y-3">
              {occupants.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Stimulus Sources */}
      {sources.length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title flex items-center gap-2">
              <Radio className="w-4 h-4 text-argos-spirit" />
              Stimulus Sources
            </span>
          </div>
          <div className="panel-content space-y-2">
            {sources.map((source) => (
              <div key={source.id} className="flex items-start gap-3 p-3 bg-argos-bg-tertiary rounded-lg">
                <Zap className="w-5 h-5 text-argos-spirit flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-argos-text-primary">{source.name}</p>
                  <p className="text-xs text-argos-text-muted">{source.type}</p>
                  {source.description && (
                    <p className="text-xs text-argos-text-secondary mt-1">{source.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Entity ID */}
      <div className="text-xs text-argos-text-muted">
        Entity ID: {room.id}
      </div>
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentSummary }) {
  const modeColors: Record<string, string> = {
    idle: "bg-gray-500",
    thinking: "bg-argos-agent",
    acting: "bg-argos-god",
    sleeping: "bg-argos-spirit",
  };

  return (
    <div className="p-3 bg-argos-bg-tertiary rounded-lg border border-argos-border/50">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-argos-agent/20 flex items-center justify-center">
          <User className="w-5 h-5 text-argos-agent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${modeColors[agent.mind.mode] || modeColors.idle}`} />
            <span className="font-medium text-argos-text-primary">{agent.name}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-argos-agent/10 text-argos-agent capitalize">
              {agent.mind.mode}
            </span>
          </div>
          {agent.role && (
            <p className="text-xs text-argos-text-muted mt-1">{agent.role}</p>
          )}
          {agent.currentThought && (
            <p className="text-xs text-argos-text-secondary italic mt-2 line-clamp-2">
              "{agent.currentThought}"
            </p>
          )}
          <div className="flex items-center gap-4 mt-2 text-xs text-argos-text-muted">
            <span>Arousal: {Math.round(agent.mind.arousal * 100)}%</span>
            {agent.mind.focus && <span>Focus: {agent.mind.focus}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function RoomActivityFeed({ activity, roomName }: { activity: any[]; roomName: string }) {
  if (activity.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Activity className="w-12 h-12 text-argos-text-muted mx-auto mb-4" />
          <h3 className="text-lg font-medium text-argos-text-primary mb-2">No Activity Yet</h3>
          <p className="text-sm text-argos-text-muted">
            Actions, speech, and events in {roomName} will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activity.map((event, idx) => (
        <ActivityItem key={`${event.type}-${event.timestamp}-${idx}`} event={event} />
      ))}
    </div>
  );
}

function ActivityItem({ event }: { event: any }) {
  const getActivityIcon = () => {
    if (event.type === "room:activity") {
      switch (event.activityType) {
        case "speech":
          return <MessageSquare className="w-4 h-4 text-argos-agent" />;
        case "action":
          return <Activity className="w-4 h-4 text-argos-god" />;
        case "enter":
          return <ArrowRight className="w-4 h-4 text-green-400" />;
        case "leave":
          return <ArrowLeft className="w-4 h-4 text-red-400" />;
        case "ambient":
          return <Radio className="w-4 h-4 text-argos-spirit" />;
        default:
          return <Activity className="w-4 h-4 text-argos-text-muted" />;
      }
    }
    if (event.type === "agent:action") {
      if (event.action === "speak" || event.action === "say") {
        return <MessageSquare className="w-4 h-4 text-argos-agent" />;
      }
      return <Activity className="w-4 h-4 text-argos-god" />;
    }
    return <Activity className="w-4 h-4 text-argos-text-muted" />;
  };

  const getActivityColor = () => {
    if (event.type === "room:activity") {
      switch (event.activityType) {
        case "speech":
          return "border-argos-agent/30";
        case "action":
          return "border-argos-god/30";
        case "enter":
          return "border-green-400/30";
        case "leave":
          return "border-red-400/30";
        case "ambient":
          return "border-argos-spirit/30";
        default:
          return "border-argos-border";
      }
    }
    if (event.type === "agent:action") {
      if (event.action === "speak" || event.action === "say") {
        return "border-argos-agent/30";
      }
      return "border-argos-god/30";
    }
    return "border-argos-border";
  };

  const getContent = () => {
    if (event.type === "room:activity") {
      return event.content;
    }
    if (event.type === "agent:action") {
      const action = event.action || "unknown";
      const target = event.target ? ` → ${event.target}` : "";
      const content = event.content ? `: "${event.content}"` : "";
      return `${action}${target}${content}`;
    }
    return event.content || event.message || JSON.stringify(event).slice(0, 100);
  };

  const getActor = () => {
    return event.actor || event.agentName || event.agent || "Unknown";
  };

  const getActivityLabel = () => {
    if (event.type === "room:activity") {
      return event.activityType?.toUpperCase() || "ACTIVITY";
    }
    if (event.type === "agent:action") {
      return (event.action === "speak" || event.action === "say") ? "SPEECH" : "ACTION";
    }
    return event.type.split(":")[1]?.toUpperCase() || "EVENT";
  };

  return (
    <div className={`p-4 bg-argos-bg-tertiary rounded-lg border-l-4 ${getActivityColor()}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{getActivityIcon()}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-argos-text-primary">{getActor()}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-argos-bg-elevated text-argos-text-muted">
                {getActivityLabel()}
              </span>
            </div>
            <span className="text-xs text-argos-text-muted">
              {new Date(event.timestamp).toLocaleTimeString()}
            </span>
          </div>
          <p className="text-sm text-argos-text-secondary break-words">{getContent()}</p>
        </div>
      </div>
    </div>
  );
}
