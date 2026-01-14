/**
 * Agents Panel - View all agents in the simulation
 */

import { Users, Brain, MapPin, Activity, MessageSquare, Lightbulb, Zap, BookOpen, Heart } from "lucide-react";
import { useSimulationStore, type AgentSummary, type MemorySummary } from "../../store/simulation";

export function AgentsPanel() {
  const { agents, selectedAgent, setSelectedAgent, events } = useSimulationStore();

  if (agents.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Users className="w-12 h-12 text-argos-text-muted mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-argos-text-primary mb-2">No Agents Yet</h2>
          <p className="text-argos-text-muted">
            Create a simulation using the presets or God commands to spawn agents.
          </p>
        </div>
      </div>
    );
  }

  const selected = agents.find(a => a.name === selectedAgent);

  return (
    <div className="h-full flex">
      {/* Agent List */}
      <div className="w-80 border-r border-argos-border overflow-auto">
        <div className="p-4 border-b border-argos-border bg-argos-bg-tertiary">
          <h2 className="font-semibold text-argos-text-primary flex items-center gap-2">
            <Users className="w-5 h-5 text-argos-agent" />
            Agents ({agents.length})
          </h2>
        </div>
        <div className="p-2 space-y-1">
          {agents.map((agent) => (
            <AgentListItem
              key={agent.id}
              agent={agent}
              isSelected={agent.name === selectedAgent}
              onClick={() => setSelectedAgent(agent.name)}
            />
          ))}
        </div>
      </div>

      {/* Agent Detail */}
      <div className="flex-1 overflow-auto">
        {selected ? (
          <AgentDetail agent={selected} events={events} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-argos-text-muted">Select an agent to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AgentListItem({
  agent,
  isSelected,
  onClick,
}: {
  agent: AgentSummary;
  isSelected: boolean;
  onClick: () => void;
}) {
  const modeColors: Record<string, string> = {
    idle: "bg-gray-500",
    thinking: "bg-argos-agent",
    acting: "bg-argos-god",
    sleeping: "bg-argos-spirit",
  };

  return (
    <button
      onClick={onClick}
      className={`w-full p-3 rounded-lg text-left transition-all ${
        isSelected
          ? "bg-argos-agent/20 border border-argos-agent/40"
          : "bg-argos-bg-tertiary hover:bg-argos-bg-elevated border border-transparent"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${modeColors[agent.mind.mode] || modeColors.idle}`} />
            <span className="font-medium text-argos-text-primary truncate">{agent.name}</span>
          </div>
          {agent.role && (
            <p className="text-xs text-argos-text-muted mt-1 truncate">{agent.role}</p>
          )}
        </div>
        {agent.room && (
          <span className="text-xs text-argos-text-muted flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {agent.room}
          </span>
        )}
      </div>
    </button>
  );
}

function AgentDetail({ agent, events }: { agent: AgentSummary; events: any[] }) {
  // Filter events for this specific agent - only agent-prefixed events
  const agentSpecificEvents = events.filter((e: any) => {
    // Only include agent-specific event types, not world:state
    if (!e.type.startsWith("agent:")) return false;
    // Match by agent name or agent ID
    return (
      e.agentName === agent.name ||
      e.agent === agent.name ||
      e.agentId === agent.id
    );
  }).slice(0, 30);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-16 h-16 rounded-xl bg-argos-agent/20 flex items-center justify-center">
          <Users className="w-8 h-8 text-argos-agent" />
        </div>
        <div className="flex-1">
          <h2 className="text-2xl font-semibold text-argos-text-primary">{agent.name}</h2>
          {agent.role && (
            <p className="text-argos-text-secondary mt-1">{agent.role}</p>
          )}
          {agent.description && (
            <p className="text-sm text-argos-text-muted mt-2">{agent.description}</p>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          icon={Brain}
          label="Mode"
          value={agent.mind.mode}
          color="agent"
        />
        <StatCard
          icon={Activity}
          label="Arousal"
          value={`${Math.round(agent.mind.arousal * 100)}%`}
          color="god"
        />
        <StatCard
          icon={MapPin}
          label="Location"
          value={agent.room || "Unknown"}
          color="world"
        />
      </div>

      {/* Current Thought */}
      {agent.currentThought && (
        <div className="panel border-l-4 border-l-argos-agent">
          <div className="panel-content">
            <div className="flex items-start gap-3">
              <Lightbulb className="w-5 h-5 text-argos-agent flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-argos-text-muted mb-1">Current Thought</p>
                <p className="text-sm text-argos-text-primary italic">{agent.currentThought}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mind State */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">Mind State</span>
        </div>
        <div className="panel-content space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-argos-text-secondary">Current Focus</span>
            <span className="text-sm text-argos-text-primary">{agent.mind.focus || "None"}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-argos-text-secondary">Arousal Level</span>
            <div className="flex items-center gap-2">
              <div className="w-24 h-2 bg-argos-bg-tertiary rounded-full overflow-hidden">
                <div
                  className="h-full bg-argos-agent rounded-full transition-all"
                  style={{ width: `${agent.mind.arousal * 100}%` }}
                />
              </div>
              <span className="text-xs text-argos-text-muted w-8">
                {Math.round(agent.mind.arousal * 100)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Memories */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-argos-spirit" />
            Memories ({agent.memories?.length || 0})
          </span>
        </div>
        <div className="panel-content">
          {(!agent.memories || agent.memories.length === 0) ? (
            <p className="text-sm text-argos-text-muted italic">
              No memories yet. Memories will form as the agent experiences the simulation.
            </p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {agent.memories.map((memory) => (
                <MemoryItem key={memory.id} memory={memory} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Activity Stream */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title flex items-center gap-2">
            <Zap className="w-4 h-4 text-argos-agent" />
            Activity Stream
          </span>
        </div>
        <div className="panel-content">
          {agentSpecificEvents.length === 0 ? (
            <p className="text-sm text-argos-text-muted italic">
              No activity recorded yet. Agent events will appear here as the simulation runs.
            </p>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {agentSpecificEvents.map((event: any, idx: number) => (
                <ActivityItem key={idx} event={event} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Entity ID */}
      <div className="text-xs text-argos-text-muted">
        Entity ID: {agent.id}
      </div>
    </div>
  );
}

function ActivityItem({ event }: { event: any }) {
  const getIcon = (type: string) => {
    if (type.includes("thought") || type.includes("think")) return <Lightbulb className="w-4 h-4" />;
    if (type.includes("speak") || type.includes("say")) return <MessageSquare className="w-4 h-4" />;
    if (type.includes("action") || type.includes("move")) return <Zap className="w-4 h-4" />;
    return <Activity className="w-4 h-4" />;
  };

  const getContent = (event: any) => {
    if (event.thought) return event.thought;
    if (event.message) return event.message;
    // For agent:action events, action is the action type string
    if (event.type === "agent:action") {
      const actionType = event.action || "unknown";
      const target = event.target ? ` → ${event.target}` : "";
      const content = event.content ? `: ${event.content.slice(0, 100)}` : "";
      return `${actionType}${target}${content}`;
    }
    if (event.content) return event.content;
    if (event.thinking) return event.thinking.slice(0, 150) + "...";
    return event.type;
  };

  return (
    <div className="flex gap-3 text-sm border-l-2 border-argos-agent/30 pl-3 py-1">
      <div className="text-argos-agent mt-0.5 flex-shrink-0">
        {getIcon(event.type)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-mono text-argos-agent">{event.type}</span>
          <span className="text-xs text-argos-text-muted">
            {new Date(event.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <p className="text-argos-text-secondary break-words">{getContent(event)}</p>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Brain;
  label: string;
  value: string;
  color: "agent" | "god" | "world" | "system" | "spirit";
}) {
  const colorClasses = {
    agent: "text-argos-agent bg-argos-agent/10",
    god: "text-argos-god bg-argos-god/10",
    world: "text-argos-world bg-argos-world/10",
    system: "text-argos-system bg-argos-system/10",
    spirit: "text-argos-spirit bg-argos-spirit/10",
  };

  return (
    <div className="panel">
      <div className="p-4">
        <div className={`w-10 h-10 rounded-lg ${colorClasses[color]} flex items-center justify-center mb-3`}>
          <Icon className="w-5 h-5" />
        </div>
        <p className="text-xs text-argos-text-muted">{label}</p>
        <p className="text-lg font-semibold text-argos-text-primary capitalize">{value}</p>
      </div>
    </div>
  );
}

function MemoryItem({ memory }: { memory: MemorySummary }) {
  // Color code emotional valence: negative = red, neutral = gray, positive = green
  const getEmotionColor = (valence: number) => {
    if (valence < -0.3) return "text-red-400";
    if (valence > 0.3) return "text-green-400";
    return "text-argos-text-muted";
  };

  // Importance indicator
  const getImportanceBar = (importance: number) => {
    const pct = Math.round(importance * 100);
    return (
      <div className="flex items-center gap-1">
        <div className="w-12 h-1 bg-argos-bg-tertiary rounded-full overflow-hidden">
          <div
            className="h-full bg-argos-spirit rounded-full"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs text-argos-text-muted">{pct}%</span>
      </div>
    );
  };

  const memoryTypeColors: Record<string, string> = {
    episodic: "bg-blue-500/20 text-blue-400",
    semantic: "bg-purple-500/20 text-purple-400",
    procedural: "bg-orange-500/20 text-orange-400",
    emotional: "bg-pink-500/20 text-pink-400",
    social: "bg-green-500/20 text-green-400",
    unknown: "bg-gray-500/20 text-gray-400",
  };

  return (
    <div className="p-2 bg-argos-bg-tertiary rounded-lg border border-argos-border/50">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className={`text-xs px-1.5 py-0.5 rounded ${memoryTypeColors[memory.type] || memoryTypeColors.unknown}`}>
          {memory.type}
        </span>
        <div className="flex items-center gap-2">
          <Heart className={`w-3 h-3 ${getEmotionColor(memory.emotionalValence)}`} />
          {getImportanceBar(memory.importance)}
        </div>
      </div>
      <p className="text-sm text-argos-text-secondary line-clamp-2">{memory.content}</p>
      <p className="text-xs text-argos-text-muted mt-1">
        {memory.timestamp ? new Date(memory.timestamp).toLocaleString() : "Unknown time"}
      </p>
    </div>
  );
}
