/**
 * Daemons Panel - View agent guardian daemons
 */

import { Ghost, Eye, MessageCircle, AlertTriangle, Brain, Activity, Clock } from "lucide-react";
import { useSimulationStore, type DaemonSummary } from "../../store/simulation";

export function DaemonsPanel() {
  const { daemons, daemonEvents, tension, selectedDaemon, setSelectedDaemon } = useSimulationStore();

  if (daemons.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Ghost className="w-12 h-12 text-argos-text-muted mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-argos-text-primary mb-2">No Daemons</h2>
          <p className="text-argos-text-muted">
            Guardian daemons will appear here when the simulation is running.
          </p>
        </div>
      </div>
    );
  }

  const selected = daemons.find(d => d.agentName === selectedDaemon);

  return (
    <div className="h-full flex">
      {/* Daemon List */}
      <div className="w-80 border-r border-argos-border overflow-auto">
        <div className="p-4 border-b border-argos-border bg-argos-bg-tertiary">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-argos-text-primary flex items-center gap-2">
              <Ghost className="w-5 h-5 text-argos-agent" />
              Daemons ({daemons.length})
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-argos-text-muted">Tension:</span>
              <div className="w-16 h-2 bg-argos-bg-elevated rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500"
                  style={{ width: `${tension * 100}%` }}
                />
              </div>
              <span className="text-xs font-mono text-argos-text-secondary">
                {(tension * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        </div>
        <div className="p-2 space-y-1">
          {daemons.map((daemon) => (
            <DaemonListItem
              key={daemon.agentEid}
              daemon={daemon}
              isSelected={daemon.agentName === selectedDaemon}
              onClick={() => setSelectedDaemon(daemon.agentName)}
            />
          ))}
        </div>
      </div>

      {/* Daemon Detail */}
      <div className="flex-1 overflow-auto">
        {selected ? (
          <DaemonDetail daemon={selected} events={daemonEvents} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-argos-text-muted">Select a daemon to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DaemonListItem({
  daemon,
  isSelected,
  onClick,
}: {
  daemon: DaemonSummary;
  isSelected: boolean;
  onClick: () => void;
}) {
  const isHighConcern = daemon.concernLevel > 0.6;
  const isStagnating = daemon.growthMetrics?.stagnationScore > 0.5;
  const recentThought = daemon.memory?.recentThoughts?.[0];
  const povPreview = daemon.latestPovStory;

  return (
    <button
      onClick={onClick}
      className={`w-full p-3 rounded-lg text-left transition-all ${
        isSelected
          ? "bg-argos-agent/20 border border-argos-agent/40"
          : "bg-argos-bg-tertiary hover:bg-argos-bg-elevated border border-transparent"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Ghost className={`w-5 h-5 ${isHighConcern ? "text-yellow-500" : daemon.active ? "text-argos-agent" : "text-argos-text-muted"}`} />
          <span className="font-medium text-argos-text-primary">{daemon.agentName}</span>
        </div>
        <div className="flex items-center gap-1">
          {daemon.pendingNudges > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-argos-god/20 text-argos-god">
              {daemon.pendingNudges} nudge{daemon.pendingNudges !== 1 ? "s" : ""}
            </span>
          )}
          {isHighConcern && (
            <AlertTriangle className="w-4 h-4 text-yellow-500" />
          )}
          {isStagnating && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400">
              stagnant
            </span>
          )}
        </div>
      </div>
      {povPreview ? (
        <p className="text-xs text-argos-text-muted mt-1 truncate italic">
          {povPreview}
        </p>
      ) : recentThought ? (
        <p className="text-xs text-argos-text-muted mt-1 truncate italic">
          Thinking about: {recentThought.focus}
        </p>
      ) : null}
      <div className="flex items-center gap-2 mt-1 text-xs text-argos-text-muted">
        <span>{daemon.observationCount} obs</span>
        <span>{daemon.whisperCount} whispers</span>
        <span>{daemon.reportCount} reports</span>
      </div>
    </button>
  );
}

function DaemonDetail({ daemon, events }: { daemon: DaemonSummary; events: any[] }) {
  const timeSinceObservation = daemon.lastObservation > 0
    ? Math.round((Date.now() - daemon.lastObservation) / 1000)
    : null;

  // Filter events for this specific daemon's agent
  const filteredEvents = events.filter((e: any) =>
    e.agentName === daemon.agentName || e.daemonName === daemon.agentName
  ).slice(0, 20);

  // Determine concern level color
  const concernColor = daemon.concernLevel > 0.7
    ? "text-red-400"
    : daemon.concernLevel > 0.4
    ? "text-yellow-400"
    : "text-green-400";

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-16 h-16 rounded-xl bg-argos-agent/20 flex items-center justify-center">
          <Ghost className="w-8 h-8 text-argos-agent" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold text-argos-text-primary">
              Guardian of {daemon.agentName}
            </h2>
            {!daemon.active && (
              <span className="px-2 py-0.5 text-xs rounded bg-argos-text-muted/20 text-argos-text-muted">
                Inactive
              </span>
            )}
          </div>
          <p className="text-argos-text-secondary mt-2">
            Personal daemon watching over {daemon.agentName}, guiding their journey and reporting to the divine hierarchy.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Eye className="w-5 h-5" />}
          label="Observations"
          value={String(daemon.observationCount)}
          color="agent"
        />
        <StatCard
          icon={<MessageCircle className="w-5 h-5" />}
          label="Whispers"
          value={String(daemon.whisperCount)}
          color="spirit"
        />
        <StatCard
          icon={<Activity className="w-5 h-5" />}
          label="Reports"
          value={String(daemon.reportCount)}
          color="system"
        />
        <StatCard
          icon={<Brain className="w-5 h-5" />}
          label="Memories"
          value={String(daemon.memory?.memoryCount ?? 0)}
          color="god"
        />
      </div>

      {/* Concern Level */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Concern Level
          </span>
        </div>
        <div className="panel-content">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="h-3 bg-argos-bg-elevated rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    daemon.concernLevel > 0.7
                      ? "bg-red-500"
                      : daemon.concernLevel > 0.4
                      ? "bg-yellow-500"
                      : "bg-green-500"
                  }`}
                  style={{ width: `${daemon.concernLevel * 100}%` }}
                />
              </div>
            </div>
            <span className={`text-lg font-bold ${concernColor}`}>
              {(daemon.concernLevel * 100).toFixed(0)}%
            </span>
          </div>
          <p className="text-xs text-argos-text-muted mt-2">
            {daemon.concernLevel > 0.7
              ? "High concern - agent may need intervention"
              : daemon.concernLevel > 0.4
              ? "Moderate concern - watching closely"
              : "Low concern - agent is doing well"}
          </p>
        </div>
      </div>

      {/* Memory Summary */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title flex items-center gap-2">
            <Brain className="w-4 h-4" />
            Memory Bank
          </span>
        </div>
        <div className="panel-content">
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-argos-text-primary">{daemon.memory?.thoughtCount ?? 0}</p>
              <p className="text-xs text-argos-text-muted">Thoughts</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-argos-text-primary">{daemon.memory?.memoryCount ?? 0}</p>
              <p className="text-xs text-argos-text-muted">Memories</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-argos-text-primary">{daemon.memory?.planCount ?? 0}</p>
              <p className="text-xs text-argos-text-muted">Plans</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-argos-text-primary">{daemon.memory?.characterMoments ?? 0}</p>
              <p className="text-xs text-argos-text-muted">Moments</p>
            </div>
          </div>
        </div>
      </div>

      {/* Growth Metrics */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">Growth Metrics</span>
        </div>
        <div className="panel-content">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-argos-text-secondary">Stagnation Score</span>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-argos-bg-elevated rounded-full overflow-hidden">
                  <div
                    className={`h-full ${
                      (daemon.growthMetrics?.stagnationScore ?? 0) > 0.6
                        ? "bg-orange-500"
                        : (daemon.growthMetrics?.stagnationScore ?? 0) > 0.3
                        ? "bg-yellow-500"
                        : "bg-green-500"
                    }`}
                    style={{ width: `${(daemon.growthMetrics?.stagnationScore ?? 0) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-argos-text-muted">
                  {((daemon.growthMetrics?.stagnationScore ?? 0) * 100).toFixed(0)}%
                </span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center text-xs">
              <div>
                <p className="text-argos-text-muted">Last Goal Change</p>
                <p className="text-argos-text-secondary">
                  {(daemon.growthMetrics?.lastGoalChange ?? 0) > 0
                    ? formatTimeAgo(daemon.growthMetrics?.lastGoalChange)
                    : "Never"}
                </p>
              </div>
              <div>
                <p className="text-argos-text-muted">Last Belief Change</p>
                <p className="text-argos-text-secondary">
                  {(daemon.growthMetrics?.lastBeliefChange ?? 0) > 0
                    ? formatTimeAgo(daemon.growthMetrics?.lastBeliefChange)
                    : "Never"}
                </p>
              </div>
              <div>
                <p className="text-argos-text-muted">Last Relationship Change</p>
                <p className="text-argos-text-secondary">
                  {(daemon.growthMetrics?.lastRelationshipChange ?? 0) > 0
                    ? formatTimeAgo(daemon.growthMetrics?.lastRelationshipChange)
                    : "Never"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Thoughts */}
      {daemon.memory?.recentThoughts?.length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title flex items-center gap-2">
              <Brain className="w-4 h-4" />
              Recent Thoughts
            </span>
          </div>
          <div className="panel-content">
            <div className="space-y-3">
              {(daemon.memory?.recentThoughts ?? []).map((thought, idx) => (
                <div key={idx} className="border-l-2 border-argos-agent/30 pl-3 py-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-argos-agent">
                      {thought.focus}
                    </span>
                    <span className="text-xs text-argos-text-muted">
                      {new Date(thought.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-sm text-argos-text-secondary mt-1">
                    {thought.content}
                  </p>
                  <span className="text-xs text-argos-text-muted italic">
                    Mood: {thought.emotionalTone}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Daemon Activity Stream */}
      {daemon.latestPovStory && (
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title flex items-center gap-2">
              <MessageCircle className="w-4 h-4" />
              Daemon POV Narrative
            </span>
          </div>
          <div className="panel-content space-y-2">
            <p className="text-sm text-argos-text-secondary italic leading-relaxed">
              {daemon.latestPovStory}
            </p>
            <div className="text-xs text-argos-text-muted flex items-center gap-3">
              {daemon.arcStatus && <span>Arc: {daemon.arcStatus}</span>}
              {daemon.arcTension !== undefined && (
                <span>Tension: {(daemon.arcTension * 100).toFixed(0)}%</span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <span className="panel-title flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Daemon Activity
          </span>
        </div>
        <div className="panel-content">
          {filteredEvents.length === 0 ? (
            <p className="text-sm text-argos-text-muted italic">
              No daemon activity recorded yet.
            </p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {filteredEvents.map((event: any, idx: number) => (
                <div key={idx} className="p-2 bg-argos-bg-tertiary rounded text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-argos-agent capitalize">
                      {event.type.split(":")[1]?.replace(/_/g, " ") || event.type}
                    </span>
                    <span className="text-argos-text-muted">
                      {event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : ""}
                    </span>
                  </div>
                  {event.content && (
                    <p className="text-argos-text-secondary line-clamp-2">{event.content}</p>
                  )}
                  {event.thought && (
                    <p className="text-argos-text-secondary italic line-clamp-2">"{event.thought}"</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Last Observation */}
      {timeSinceObservation !== null && (
        <div className="text-center text-xs text-argos-text-muted">
          <Clock className="w-4 h-4 inline mr-1" />
          Last observed {timeSinceObservation < 60
            ? `${timeSinceObservation} seconds ago`
            : `${Math.round(timeSinceObservation / 60)} minutes ago`}
        </div>
      )}
    </div>
  );
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
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
  color: "spirit" | "system" | "agent" | "god";
}) {
  const colorClasses = {
    spirit: "bg-argos-spirit/10 text-argos-spirit",
    system: "bg-argos-system/10 text-argos-system",
    agent: "bg-argos-agent/10 text-argos-agent",
    god: "bg-argos-god/10 text-argos-god",
  };

  return (
    <div className="panel">
      <div className="p-4">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${colorClasses[color]}`}>
          {icon}
        </div>
        <p className="text-xs text-argos-text-muted">{label}</p>
        <p className="text-lg font-semibold text-argos-text-primary">{value}</p>
      </div>
    </div>
  );
}
