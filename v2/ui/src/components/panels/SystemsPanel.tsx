/**
 * Systems Panel - View all systems in the simulation
 */

import { Cpu, Clock, Play, Pause } from "lucide-react";
import {
  useSimulationStore,
  type SystemSummary,
  type SystemLogEntry,
} from "../../store/simulation";

export function SystemsPanel() {
  const { systems, systemLogs, selectedSystem, setSelectedSystem, status } = useSimulationStore();

  if (systems.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Cpu className="w-12 h-12 text-argos-text-muted mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-argos-text-primary mb-2">No Systems</h2>
          <p className="text-argos-text-muted">
            {status !== "connected"
              ? "Connect to the simulation bus to see systems."
              : "Systems will appear here when the simulation is running."}
          </p>
          {status !== "connected" && (
            <p className="text-xs text-argos-status-error mt-2">
              WebSocket status: {status}
            </p>
          )}
        </div>
      </div>
    );
  }

  const selected = systems.find(s => s.name === selectedSystem);

  return (
    <div className="h-full flex">
      {/* System List */}
      <div className="w-80 border-r border-argos-border overflow-auto">
        <div className="p-4 border-b border-argos-border bg-argos-bg-tertiary">
          <h2 className="font-semibold text-argos-text-primary flex items-center gap-2">
            <Cpu className="w-5 h-5 text-argos-system" />
            Systems ({systems.length})
          </h2>
        </div>
        <div className="p-2 space-y-1">
          {systems.map((system) => (
            <SystemListItem
              key={system.name}
              system={system}
              isSelected={system.name === selectedSystem}
              onClick={() => setSelectedSystem(system.name)}
            />
          ))}
        </div>
      </div>

      {/* System Detail */}
      <div className="flex-1 overflow-auto">
        {selected ? (
          <SystemDetail system={selected} logs={systemLogs[selected.name] || []} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-argos-text-muted">Select a system to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SystemListItem({
  system,
  isSelected,
  onClick,
}: {
  system: SystemSummary;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full p-3 rounded-lg text-left transition-all ${
        isSelected
          ? "bg-argos-system/20 border border-argos-system/40"
          : "bg-argos-bg-tertiary hover:bg-argos-bg-elevated border border-transparent"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {system.active ? (
            <Play className="w-3 h-3 text-green-500 fill-green-500" />
          ) : (
            <Pause className="w-3 h-3 text-argos-text-muted" />
          )}
          <span className="font-medium text-argos-text-primary">{system.name}</span>
        </div>
        <span className="text-xs text-argos-text-muted">
          {formatFrequency(system.frequency)}
        </span>
      </div>
      {system.description && (
        <p className="text-xs text-argos-text-muted mt-1 truncate">{system.description}</p>
      )}
    </button>
  );
}

function SystemDetail({
  system,
  logs,
}: {
  system: SystemSummary;
  logs: SystemLogEntry[];
}) {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-16 h-16 rounded-xl bg-argos-system/20 flex items-center justify-center">
          <Cpu className="w-8 h-8 text-argos-system" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold text-argos-text-primary">{system.name}</h2>
            <span
              className={`px-2 py-0.5 text-xs rounded-full ${
                system.active
                  ? "bg-green-500/20 text-green-400"
                  : "bg-argos-bg-tertiary text-argos-text-muted"
              }`}
            >
              {system.active ? "Active" : "Inactive"}
            </span>
          </div>
          {system.description && (
            <p className="text-argos-text-secondary mt-2">{system.description}</p>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="panel">
          <div className="p-4">
            <div className="w-10 h-10 rounded-lg bg-argos-system/10 text-argos-system flex items-center justify-center mb-3">
              <Clock className="w-5 h-5" />
            </div>
            <p className="text-xs text-argos-text-muted">Frequency</p>
            <p className="text-lg font-semibold text-argos-text-primary">
              {formatFrequency(system.frequency)}
            </p>
          </div>
        </div>
        <div className="panel">
          <div className="p-4">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${
              system.active ? "bg-green-500/10 text-green-400" : "bg-argos-bg-tertiary text-argos-text-muted"
            }`}>
              {system.active ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
            </div>
            <p className="text-xs text-argos-text-muted">Status</p>
            <p className="text-lg font-semibold text-argos-text-primary">
              {system.active ? "Running" : "Paused"}
            </p>
          </div>
        </div>
      </div>

      {/* System Info */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">System Information</span>
        </div>
        <div className="panel-content space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-argos-text-secondary">Execution Rate</span>
            <span className="text-sm text-argos-text-primary">
              Every {system.frequency}ms
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-argos-text-secondary">Type</span>
            <span className="text-sm text-argos-text-primary">
              {system.frequency < 100 ? "Fast (Deterministic)" : "Slow (AI/Async)"}
            </span>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">Recent Logs</span>
        </div>
        <div className="panel-content">
          {logs.length === 0 ? (
            <p className="text-sm text-argos-text-muted italic">
              No logs yet. System execution and output will appear here.
            </p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {logs.slice(0, 60).map((log) => (
                <div
                  key={log.id}
                  className="p-2 rounded bg-argos-bg-tertiary border border-argos-border/40"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-argos-text-muted uppercase tracking-wide">
                      {log.type}
                    </span>
                    <span className="text-xs text-argos-text-muted">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-sm text-argos-text-secondary break-words mt-1">{log.message}</p>
                  {(log.duration !== undefined || log.entitiesProcessed !== undefined) && (
                    <div className="text-xs text-argos-text-muted mt-1 flex items-center gap-3">
                      {log.duration !== undefined && <span>{log.duration.toFixed(1)}ms</span>}
                      {log.entitiesProcessed !== undefined && (
                        <span>{log.entitiesProcessed} entities</span>
                      )}
                      {log.tick !== undefined && <span>tick {log.tick}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatFrequency(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    return `${(ms / 60000).toFixed(1)}m`;
  }
}
