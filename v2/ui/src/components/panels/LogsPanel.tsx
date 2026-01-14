/**
 * Logs Panel - View and filter all simulation events
 */

import { useState, useMemo } from "react";
import { Search, Filter, Trash2, Download, ChevronDown } from "lucide-react";
import { useSimulationStore } from "../../store/simulation";
import type { SimulationEvent } from "../../types/events";

// Event type categories
const EVENT_CATEGORIES = [
  { id: "all", label: "All Events", prefix: "" },
  { id: "god", label: "God", prefix: "god:" },
  { id: "spirit", label: "Spirits", prefix: "spirit:" },
  { id: "agent", label: "Agents", prefix: "agent:" },
  { id: "room", label: "Rooms", prefix: "room:" },
  { id: "system", label: "Systems", prefix: "system:" },
  { id: "world", label: "World", prefix: "world:" },
];

export function LogsPanel() {
  const { events, clearEvents } = useSimulationStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  // Filter events based on category and search
  const filteredEvents = useMemo(() => {
    let filtered = events;

    // Filter by category
    if (selectedCategory !== "all") {
      const category = EVENT_CATEGORIES.find(c => c.id === selectedCategory);
      if (category) {
        filtered = filtered.filter(e => e.type.startsWith(category.prefix));
      }
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(e => {
        const eventStr = JSON.stringify(e).toLowerCase();
        return eventStr.includes(query);
      });
    }

    return filtered;
  }, [events, selectedCategory, searchQuery]);

  // Export logs as JSON
  const handleExport = () => {
    const data = JSON.stringify(filteredEvents, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `argos-logs-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-argos-border bg-argos-bg-tertiary">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-argos-text-primary">
            Event Logs ({filteredEvents.length})
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              className="p-2 rounded-lg hover:bg-argos-bg-elevated text-argos-text-muted hover:text-argos-text-primary transition-colors"
              title="Export logs"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={clearEvents}
              className="p-2 rounded-lg hover:bg-red-500/20 text-argos-text-muted hover:text-red-400 transition-colors"
              title="Clear logs"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-argos-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search logs..."
            className="w-full pl-10 pr-4 py-2 bg-argos-bg-elevated border border-argos-border rounded-lg text-sm text-argos-text-primary placeholder:text-argos-text-muted focus:outline-none focus:border-argos-spirit/50"
          />
        </div>

        {/* Category Filters */}
        <div className="flex flex-wrap gap-2 mt-3">
          {EVENT_CATEGORIES.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                selectedCategory === category.id
                  ? "bg-argos-spirit text-black"
                  : "bg-argos-bg-elevated text-argos-text-secondary hover:text-argos-text-primary"
              }`}
            >
              {category.label}
            </button>
          ))}
        </div>
      </div>

      {/* Log List */}
      <div className="flex-1 overflow-auto">
        {filteredEvents.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <Filter className="w-12 h-12 text-argos-text-muted mx-auto mb-4" />
              <p className="text-argos-text-muted">
                {events.length === 0
                  ? "No events recorded yet"
                  : "No events match your filters"}
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-argos-border">
            {filteredEvents.map((event, idx) => (
              <LogEntry key={`${event.timestamp}-${idx}`} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LogEntry({ event }: { event: SimulationEvent }) {
  const [expanded, setExpanded] = useState(false);

  // Get category color
  const getCategoryColor = (type: string) => {
    if (type.startsWith("god:")) return "text-argos-god border-argos-god/30";
    if (type.startsWith("spirit:")) return "text-argos-spirit border-argos-spirit/30";
    if (type.startsWith("agent:")) return "text-argos-agent border-argos-agent/30";
    if (type.startsWith("room:")) return "text-argos-world border-argos-world/30";
    if (type.startsWith("system:")) return "text-argos-system border-argos-system/30";
    if (type.startsWith("world:")) return "text-blue-400 border-blue-400/30";
    return "text-argos-text-muted border-argos-border";
  };

  // Extract summary from event
  const getSummary = (event: SimulationEvent) => {
    const e = event as any;
    if (e.message) return e.message;
    if (e.content) return e.content;
    if (e.command) return e.command;
    if (e.thinking) return e.thinking.slice(0, 100) + "...";
    if (e.agentCount !== undefined) {
      return `Tick ${e.tick}: ${e.agentCount} agents, ${e.roomCount} rooms`;
    }
    return event.type;
  };

  const colorClasses = getCategoryColor(event.type);

  return (
    <div className="px-4 py-3 hover:bg-argos-bg-tertiary/50 transition-colors">
      <div
        className="flex items-start gap-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-shrink-0 mt-1">
          <ChevronDown
            className={`w-4 h-4 text-argos-text-muted transition-transform ${
              expanded ? "rotate-0" : "-rotate-90"
            }`}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-mono px-2 py-0.5 rounded border ${colorClasses}`}>
              {event.type}
            </span>
            <span className="text-xs text-argos-text-muted">
              {new Date(event.timestamp).toLocaleTimeString()}
            </span>
          </div>
          <p className="text-sm text-argos-text-secondary truncate">
            {getSummary(event)}
          </p>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 ml-7 p-3 bg-argos-bg-primary rounded-lg border border-argos-border">
          <pre className="text-xs text-argos-text-secondary overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(event, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
