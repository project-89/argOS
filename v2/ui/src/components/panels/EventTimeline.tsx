/**
 * Event Timeline panel - detailed event stream
 */

import { useState } from "react";
import { Filter, Trash2, Download, ChevronDown, ChevronUp } from "lucide-react";
import { useSimulationStore } from "../../store/simulation";
import { getEventCategory, type SimulationEvent } from "../../types/events";

type FilterCategory = "all" | "god" | "spirit" | "agent" | "system" | "world" | "room";

export function EventTimeline() {
  const { events, clearEvents } = useSimulationStore();
  const [filter, setFilter] = useState<FilterCategory>("all");
  const [expandedEvent, setExpandedEvent] = useState<number | null>(null);

  // Filter events
  const filteredEvents =
    filter === "all"
      ? events
      : events.filter((event) => getEventCategory(event) === filter);

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-4 border-b border-argos-border bg-argos-bg-secondary">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-argos-text-muted" />
          <span className="text-sm text-argos-text-secondary">Filter:</span>
          <div className="flex gap-1">
            {(["all", "god", "spirit", "agent", "system", "world"] as FilterCategory[]).map(
              (cat) => (
                <button
                  key={cat}
                  onClick={() => setFilter(cat)}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    filter === cat
                      ? getCategoryButtonActive(cat)
                      : "bg-argos-bg-tertiary text-argos-text-secondary hover:text-argos-text-primary"
                  }`}
                >
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </button>
              )
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-argos-text-muted">
            {filteredEvents.length} events
          </span>
          <button
            onClick={clearEvents}
            className="p-2 text-argos-text-secondary hover:text-argos-status-error hover:bg-argos-bg-tertiary rounded transition-colors"
            title="Clear events"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => downloadEvents(filteredEvents)}
            className="p-2 text-argos-text-secondary hover:text-argos-text-primary hover:bg-argos-bg-tertiary rounded transition-colors"
            title="Export events"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Event List */}
      <div className="flex-1 overflow-auto">
        {filteredEvents.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-argos-text-muted">No events to display</p>
          </div>
        ) : (
          <div className="divide-y divide-argos-border">
            {filteredEvents.map((event, index) => (
              <EventRow
                key={`${event.timestamp}-${index}`}
                event={event}
                expanded={expandedEvent === index}
                onToggle={() =>
                  setExpandedEvent(expandedEvent === index ? null : index)
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Event row component
function EventRow({
  event,
  expanded,
  onToggle,
}: {
  event: SimulationEvent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const category = getEventCategory(event);
  const time = new Date(event.timestamp).toLocaleTimeString();
  const eventName = event.type.split(":")[1];

  return (
    <div className="bg-argos-bg-secondary hover:bg-argos-bg-tertiary transition-colors">
      {/* Main Row */}
      <div
        className="flex items-center gap-4 px-4 py-3 cursor-pointer"
        onClick={onToggle}
      >
        <span className={`badge ${getCategoryBadge(category)}`}>{category}</span>

        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-argos-text-primary">{eventName}</span>
          <EventSummary event={event} />
        </div>

        <span className="text-xs font-mono text-argos-text-muted">{time}</span>

        <button className="p-1 text-argos-text-muted hover:text-argos-text-primary">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="px-4 pb-4">
          <pre className="p-4 bg-argos-bg-primary rounded-lg text-xs font-mono text-argos-text-secondary overflow-auto">
            {JSON.stringify(event, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// Event summary based on type
function EventSummary({ event }: { event: SimulationEvent }) {
  let summary = "";

  switch (event.type) {
    case "god:command":
      summary = (event as any).command?.slice(0, 50);
      break;
    case "god:think":
      summary = (event as any).thought?.slice(0, 50);
      break;
    case "agent:action":
      const agentAction = event as any;
      summary = `${agentAction.agentName}: ${agentAction.action}${
        agentAction.target ? ` → ${agentAction.target}` : ""
      }`;
      break;
    case "agent:think":
      summary = `${(event as any).agentName}: ${(event as any).thought?.slice(0, 40)}`;
      break;
    case "spirit:observe":
      summary = `${(event as any).spiritName}: ${(event as any).observation?.slice(0, 40)}`;
      break;
    case "system:executed":
      summary = `${(event as any).systemName} (${(event as any).duration}ms)`;
      break;
    case "world:state":
      summary = `Tick ${(event as any).tick}, ${(event as any).agentCount} agents`;
      break;
    case "room:activity":
      summary = `${(event as any).roomName}: ${(event as any).content?.slice(0, 40)}`;
      break;
    default:
      summary = "";
  }

  if (!summary) return null;

  return (
    <p className="text-xs text-argos-text-muted truncate mt-0.5">{summary}</p>
  );
}

// Helper functions
function getCategoryBadge(category: string) {
  const badges: Record<string, string> = {
    god: "badge-god",
    spirit: "badge-spirit",
    agent: "badge-agent",
    system: "badge-system",
    world: "bg-argos-world/20 text-argos-world-light border border-argos-world/30",
    room: "bg-argos-world/20 text-argos-world-light border border-argos-world/30",
  };
  return badges[category] || badges.world;
}

function getCategoryButtonActive(category: FilterCategory) {
  const colors: Record<FilterCategory, string> = {
    all: "bg-argos-text-primary text-argos-bg-primary",
    god: "bg-argos-god text-black",
    spirit: "bg-argos-spirit text-white",
    agent: "bg-argos-agent text-black",
    system: "bg-argos-system text-black",
    world: "bg-argos-world text-white",
    room: "bg-argos-world text-white",
  };
  return colors[category];
}

function downloadEvents(events: SimulationEvent[]) {
  const blob = new Blob([JSON.stringify(events, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `argos-events-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
