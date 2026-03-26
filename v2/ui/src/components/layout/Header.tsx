/**
 * Header component with simulation stats and command input
 */

import { useState } from "react";
import {
  Activity,
  Users,
  MapPin,
  Cpu,
  Box,
  Send,
  Loader2,
  Play,
  Pause,
  Square,
  Wifi,
  WifiOff,
  Save,
  FolderOpen,
} from "lucide-react";
import { useSimulationStore } from "../../store/simulation";
import { useSimulationBusContext } from "../../contexts/SimulationBusContext";
import { useMapEditorStore } from "../../store/mapEditorStore";
import type { ArgosMapV1 } from "../../types/map";

interface HeaderProps {
  onSendCommand: (command: string) => void;
}

export function Header({ onSendCommand }: HeaderProps) {
  const {
    tick,
    agentCount,
    roomCount,
    systemCount,
    entityCount,
    status,
    simulationStatus,
    lastSavedAt,
    saves,
  } = useSimulationStore();
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const { map } = useMapEditorStore();
  const { connect, disconnect, inject } = useSimulationBusContext();
  const [command, setCommand] = useState("");
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || sending) return;

    setSending(true);
    try {
      onSendCommand(command);
      setCommand("");
    } finally {
      setSending(false);
    }
  };

  const buildSimulationMap = (mapData: ArgosMapV1) => {
    const simulationMarkers = (mapData.markers || []).filter((m) => m.kind !== "prefab");
    return {
      id: mapData.id,
      name: mapData.name,
      grid: mapData.grid,
      zones: mapData.zones,
      markers: simulationMarkers,
    };
  };

  const handlePlay = () => {
    if (status !== "connected") return;

    const hasWorldContent = agentCount > 0 || roomCount > 0;
    if (simulationStatus === "paused") {
      inject({ type: "inject:simulation_resume" });
      return;
    }

    if (!hasWorldContent && map) {
      inject({
        type: "inject:simulation_start",
        map: buildSimulationMap(map),
      } as any);
      return;
    }

    inject({ type: "inject:simulation_resume" });
  };

  const handlePause = () => {
    if (status !== "connected") return;
    inject({ type: "inject:simulation_pause" });
  };

  const handleStop = () => {
    if (status !== "connected") return;
    inject({ type: "inject:simulation_stop" });
  };

  const simulationStatusClass =
    simulationStatus === "running"
      ? "bg-green-500/20 text-green-400"
      : simulationStatus === "paused"
      ? "bg-yellow-500/20 text-yellow-400"
      : "bg-argos-bg-tertiary text-argos-text-muted";

  return (
    <header className="h-16 bg-argos-bg-secondary border-b border-argos-border flex items-center justify-between px-6">
      {/* Stats */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-argos-god" />
          <span className="text-sm text-argos-text-secondary">Tick</span>
          <span className="text-sm font-mono font-semibold text-argos-text-primary">
            {tick.toLocaleString()}
          </span>
        </div>

        <div className="h-4 w-px bg-argos-border" />

        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-argos-agent" />
          <span className="text-sm font-mono font-semibold text-argos-text-primary">
            {agentCount}
          </span>
          <span className="text-sm text-argos-text-secondary">agents</span>
        </div>

        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-argos-world" />
          <span className="text-sm font-mono font-semibold text-argos-text-primary">
            {roomCount}
          </span>
          <span className="text-sm text-argos-text-secondary">rooms</span>
        </div>

        <div className="flex items-center gap-2">
          <Box className="w-4 h-4 text-argos-system" />
          <span className="text-sm font-mono font-semibold text-argos-text-primary">
            {entityCount}
          </span>
          <span className="text-sm text-argos-text-secondary">entities</span>
        </div>

        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-argos-system" />
          <span className="text-sm font-mono font-semibold text-argos-text-primary">
            {systemCount}
          </span>
          <span className="text-sm text-argos-text-secondary">systems</span>
        </div>
      </div>

      {/* Global Simulation Controls */}
      <div className="flex items-center gap-2">
        {status === "connected" ? (
          <button
            onClick={disconnect}
            className="px-3 py-1.5 text-xs rounded bg-argos-bg-tertiary text-argos-text-secondary hover:text-argos-text-primary border border-argos-border flex items-center gap-1.5"
            title="Disconnect from simulation bus"
          >
            <WifiOff className="w-3.5 h-3.5" />
            Disconnect
          </button>
        ) : (
          <button
            onClick={connect}
            className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 flex items-center gap-1.5"
            title="Connect to simulation bus"
          >
            <Wifi className="w-3.5 h-3.5" />
            Connect
          </button>
        )}

        {simulationStatus !== "running" ? (
          <button
            onClick={handlePlay}
            disabled={status !== "connected"}
            className="px-3 py-1.5 text-xs rounded bg-green-600 text-white hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            title={simulationStatus === "paused" ? "Resume simulation" : "Play simulation"}
          >
            <Play className="w-3.5 h-3.5" />
            {simulationStatus === "paused" ? "Resume" : "Play"}
          </button>
        ) : (
          <button
            onClick={handlePause}
            disabled={status !== "connected"}
            className="px-3 py-1.5 text-xs rounded bg-yellow-600 text-white hover:bg-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            title="Pause simulation"
          >
            <Pause className="w-3.5 h-3.5" />
            Pause
          </button>
        )}

        {simulationStatus !== "stopped" && (
          <button
            onClick={handleStop}
            disabled={status !== "connected"}
            className="px-3 py-1.5 text-xs rounded bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            title="Stop simulation"
          >
            <Square className="w-3.5 h-3.5" />
            Stop
          </button>
        )}

        <div className="h-4 w-px bg-argos-border" />

        {/* Save */}
        <button
          onClick={() => inject({ type: "inject:simulation_save" })}
          disabled={status !== "connected" || simulationStatus === "stopped"}
          className="px-3 py-1.5 text-xs rounded bg-argos-bg-tertiary text-argos-text-secondary hover:text-argos-text-primary border border-argos-border disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          title={lastSavedAt ? `Last saved: ${new Date(lastSavedAt).toLocaleTimeString()}` : "Save simulation"}
        >
          <Save className="w-3.5 h-3.5" />
          Save
        </button>

        {/* Load */}
        <div className="relative">
          <button
            onClick={() => {
              inject({ type: "inject:simulation_list_saves" });
              setShowSaveMenu(!showSaveMenu);
            }}
            disabled={status !== "connected"}
            className="px-3 py-1.5 text-xs rounded bg-argos-bg-tertiary text-argos-text-secondary hover:text-argos-text-primary border border-argos-border disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            title="Load saved simulation"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Load
          </button>

          {showSaveMenu && (
            <div className="absolute right-0 top-full mt-1 w-72 bg-argos-bg-secondary border border-argos-border rounded-lg shadow-xl z-50 max-h-64 overflow-auto">
              {saves.length === 0 ? (
                <div className="p-3 text-xs text-argos-text-muted text-center">No saved simulations found</div>
              ) : (
                saves.map(save => (
                  <button
                    key={save.id}
                    onClick={() => {
                      inject({ type: "inject:simulation_load", simulationId: save.id });
                      setShowSaveMenu(false);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-argos-bg-tertiary border-b border-argos-border last:border-b-0"
                  >
                    <div className="text-xs font-medium text-argos-text-primary">{save.name}</div>
                    <div className="text-xs text-argos-text-muted">
                      Tick {save.currentTick} &middot; {new Date(save.lastSavedAt).toLocaleString()}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <span className={`text-xs px-2 py-1 rounded uppercase tracking-wide ${simulationStatusClass}`}>
          {simulationStatus}
        </span>
      </div>

      {/* Command Input */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="relative">
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="God command..."
            disabled={status !== "connected"}
            className="w-80 px-4 py-2 bg-argos-bg-tertiary border border-argos-border rounded-lg text-sm text-argos-text-primary placeholder-argos-text-muted focus:outline-none focus:ring-2 focus:ring-argos-god/50 focus:border-argos-god/50 disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={!command.trim() || sending || status !== "connected"}
          className="p-2 bg-argos-god text-black rounded-lg hover:bg-argos-god-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </button>
      </form>
    </header>
  );
}
