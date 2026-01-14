/**
 * Spirits Panel - View and chat with spirits in the simulation
 */

import { useState } from "react";
import { Sparkles, Eye, Clock, Inbox, Activity, Send, MessageSquare, AlertCircle, Users } from "lucide-react";
import { useSimulationStore, type SpiritSummary } from "../../store/simulation";
import { useSimulationBusContext } from "../../contexts/SimulationBusContext";

export function SpiritsPanel() {
  const { spirits, spiritEvents, selectedSpirit, setSelectedSpirit } = useSimulationStore();

  if (spirits.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Sparkles className="w-12 h-12 text-argos-text-muted mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-argos-text-primary mb-2">No Spirits</h2>
          <p className="text-argos-text-muted">
            Spirits will appear here when the simulation is running.
          </p>
        </div>
      </div>
    );
  }

  const selected = spirits.find(s => s.name === selectedSpirit);

  return (
    <div className="h-full flex">
      {/* Spirit List */}
      <div className="w-80 border-r border-argos-border overflow-auto">
        <div className="p-4 border-b border-argos-border bg-argos-bg-tertiary">
          <h2 className="font-semibold text-argos-text-primary flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-argos-spirit" />
            Spirits ({spirits.length})
          </h2>
        </div>
        <div className="p-2 space-y-1">
          {spirits.map((spirit) => (
            <SpiritListItem
              key={spirit.id}
              spirit={spirit}
              isSelected={spirit.name === selectedSpirit}
              onClick={() => setSelectedSpirit(spirit.name)}
            />
          ))}
        </div>
      </div>

      {/* Spirit Detail */}
      <div className="flex-1 overflow-auto">
        {selected ? (
          <SpiritDetail spirit={selected} events={spiritEvents} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-argos-text-muted">Select a spirit to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SpiritListItem({
  spirit,
  isSelected,
  onClick,
}: {
  spirit: SpiritSummary;
  isSelected: boolean;
  onClick: () => void;
}) {
  const rankEmoji = spirit.rank === "archangel" ? "👼" : spirit.rank === "angel" ? "😇" : "👻";

  return (
    <button
      onClick={onClick}
      className={`w-full p-3 rounded-lg text-left transition-all ${
        isSelected
          ? "bg-argos-spirit/20 border border-argos-spirit/40"
          : "bg-argos-bg-tertiary hover:bg-argos-bg-elevated border border-transparent"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{rankEmoji}</span>
          <span className="font-medium text-argos-text-primary">{spirit.name}</span>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-argos-spirit/20 text-argos-spirit">
          {spirit.domain}
        </span>
      </div>
      {spirit.description && (
        <p className="text-xs text-argos-text-muted mt-1 truncate">{spirit.description}</p>
      )}
    </button>
  );
}

function SpiritDetail({ spirit, events }: { spirit: SpiritSummary; events: any[] }) {
  const rankEmoji = spirit.rank === "archangel" ? "👼" : spirit.rank === "angel" ? "😇" : "👻";
  const timeSinceObservation = spirit.lastObservation > 0
    ? Math.round((Date.now() - spirit.lastObservation) / 1000)
    : null;
  const { sendSpiritMessage } = useSimulationBusContext();
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);

  // Filter events for this spirit
  const spiritEvents = events.filter((e: any) =>
    e.spiritName === spirit.name || e.spirit === spirit.name
  );

  const handleSendMessage = () => {
    if (!message.trim()) return;
    setIsSending(true);
    sendSpiritMessage(spirit.name, message.trim());
    setMessage("");
    setTimeout(() => setIsSending(false), 500);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-16 h-16 rounded-xl bg-argos-spirit/20 flex items-center justify-center text-3xl">
          {rankEmoji}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold text-argos-text-primary">{spirit.name}</h2>
            <span className="px-2 py-0.5 text-xs rounded-full bg-argos-spirit/20 text-argos-spirit capitalize">
              {spirit.rank}
            </span>
          </div>
          {spirit.description && (
            <p className="text-argos-text-secondary mt-2">{spirit.description}</p>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Eye className="w-5 h-5" />}
          label="Domain"
          value={spirit.domain}
          color="spirit"
        />
        <StatCard
          icon={<Clock className="w-5 h-5" />}
          label="Interval"
          value={formatInterval(spirit.observationInterval)}
          color="system"
        />
        <StatCard
          icon={<Inbox className="w-5 h-5" />}
          label="Inbox"
          value={String(spirit.inboxSize)}
          color="agent"
        />
        <StatCard
          icon={<Activity className="w-5 h-5" />}
          label="Observations"
          value={String(spirit.observationsCount)}
          color="room"
        />
      </div>

      {/* Chat with Spirit */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Send Message to Spirit
          </span>
        </div>
        <div className="panel-content">
          <div className="flex gap-2">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Send a message or directive to ${spirit.name}...`}
              className="flex-1 bg-argos-bg-tertiary border border-argos-border rounded-lg p-3 text-sm text-argos-text-primary placeholder:text-argos-text-muted resize-none focus:outline-none focus:ring-2 focus:ring-argos-spirit/50"
              rows={2}
            />
            <button
              onClick={handleSendMessage}
              disabled={!message.trim() || isSending}
              className="px-4 py-2 bg-argos-spirit hover:bg-argos-spirit/80 disabled:bg-argos-bg-tertiary disabled:text-argos-text-muted text-white rounded-lg transition-colors flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-argos-text-muted mt-2">
            Messages are added to the spirit's inbox and processed during their next observation cycle.
          </p>
        </div>
      </div>

      {/* Last Observation */}
      {timeSinceObservation !== null && (
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Last Observation</span>
          </div>
          <div className="panel-content">
            <p className="text-sm text-argos-text-secondary">
              {timeSinceObservation < 60
                ? `${timeSinceObservation} seconds ago`
                : `${Math.round(timeSinceObservation / 60)} minutes ago`}
            </p>
          </div>
        </div>
      )}

      {/* Activity Stream */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Activity Stream
          </span>
          <span className="text-xs text-argos-text-muted">{spiritEvents.length} events</span>
        </div>
        <div className="panel-content max-h-96 overflow-y-auto">
          {spiritEvents.length === 0 ? (
            <p className="text-sm text-argos-text-muted italic">
              No activity recorded yet. Spirit events will appear here as the simulation runs.
            </p>
          ) : (
            <div className="space-y-2">
              {spiritEvents.slice(0, 30).map((event: any, idx: number) => (
                <SpiritEventItem key={idx} event={event} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: "spirit" | "system" | "agent" | "room";
}) {
  const colorClasses = {
    spirit: "bg-argos-spirit/10 text-argos-spirit",
    system: "bg-argos-system/10 text-argos-system",
    agent: "bg-argos-agent/10 text-argos-agent",
    room: "bg-argos-world/10 text-argos-world",
  };

  return (
    <div className="panel">
      <div className="p-4">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${colorClasses[color]}`}>
          {icon}
        </div>
        <p className="text-xs text-argos-text-muted">{label}</p>
        <p className="text-lg font-semibold text-argos-text-primary capitalize">{value}</p>
      </div>
    </div>
  );
}

function formatInterval(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(0)}s`;
  } else {
    return `${(ms / 60000).toFixed(1)}m`;
  }
}

function SpiritEventItem({ event }: { event: any }) {
  const getEventTypeLabel = (type: string): string => {
    if (type === "spirit:observe") return "Observation";
    if (type === "spirit:message") return "Message";
    if (type === "spirit:intervention") return "Intervention";
    return type.split(":")[1]?.replace(/_/g, " ") || type;
  };

  const getEventIcon = () => {
    if (event.type === "spirit:observe") return <Eye className="w-3 h-3" />;
    if (event.type === "spirit:message") return <MessageSquare className="w-3 h-3" />;
    if (event.type === "spirit:intervention") return <AlertCircle className="w-3 h-3" />;
    return <Activity className="w-3 h-3" />;
  };

  const getEventColor = () => {
    if (event.type === "spirit:observe") return "border-argos-spirit/50 bg-argos-spirit/5";
    if (event.type === "spirit:message") return "border-blue-500/50 bg-blue-500/5";
    if (event.type === "spirit:intervention") return "border-yellow-500/50 bg-yellow-500/5";
    if (event.messageType === "error") return "border-red-500/50 bg-red-500/5";
    if (event.messageType === "received") return "border-green-500/50 bg-green-500/5";
    return "border-argos-spirit/30 bg-argos-bg-tertiary";
  };

  const getEventContent = (): string | null => {
    // Handle different event types
    if (event.content) return event.content;
    if (event.message) return event.message;
    if (event.thinking) return event.thinking.slice(0, 200) + "...";
    if (event.observation) return event.observation;
    if (event.subject) return event.subject;
    return null;
  };

  const content = getEventContent();
  const typeLabel = getEventTypeLabel(event.type);

  return (
    <div className={`text-sm border-l-2 pl-3 py-2 rounded-r ${getEventColor()}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 text-xs font-medium text-argos-spirit">
          {getEventIcon()}
          <span className="capitalize">{typeLabel}</span>
          {event.observationType && event.observationType !== "observation" && (
            <span className="text-argos-text-muted">({event.observationType})</span>
          )}
          {event.priority && event.priority !== "normal" && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${
              event.priority === "urgent" ? "bg-red-500/20 text-red-400" :
              event.priority === "high" ? "bg-yellow-500/20 text-yellow-400" :
              "bg-gray-500/20 text-gray-400"
            }`}>
              {event.priority}
            </span>
          )}
        </div>
        <span className="text-xs text-argos-text-muted">
          {event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : ""}
        </span>
      </div>
      {content ? (
        <p className="text-argos-text-secondary text-sm">{content}</p>
      ) : (
        <p className="text-argos-text-muted italic text-xs">
          {event.spiritName || event.spirit || "Spirit"} activity recorded
        </p>
      )}
      {/* Show entities if present */}
      {event.entities && event.entities.length > 0 && (
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          <Users className="w-3 h-3 text-argos-text-muted" />
          {event.entities.slice(0, 5).map((entity: string, idx: number) => (
            <span key={idx} className="text-xs px-1.5 py-0.5 bg-argos-agent/20 text-argos-agent rounded">
              {entity}
            </span>
          ))}
          {event.entities.length > 5 && (
            <span className="text-xs text-argos-text-muted">+{event.entities.length - 5} more</span>
          )}
        </div>
      )}
      {/* Show location if present */}
      {event.location && (
        <span className="text-xs text-argos-text-muted mt-1 inline-block">
          📍 {event.location}
        </span>
      )}
      {/* Show significance if notable */}
      {event.significance && event.significance > 0.7 && (
        <span className="text-xs text-yellow-400 mt-1 ml-2 inline-block">
          ⚡ High significance
        </span>
      )}
    </div>
  );
}
