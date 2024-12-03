import * as React from "react";
import { SimulationEvent } from "../../../types";
import { getTailwindColor } from "../../../utils/colors";

interface EnvironmentProps {
  agents: any[];
  logs: SimulationEvent[];
  selectedRoom?: string | null;
}

export function Environment({ agents, logs, selectedRoom }: EnvironmentProps) {
  // Filter logs for the selected room and relevant event types
  const roomLogs = React.useMemo(() => {
    if (!selectedRoom) return [];
    return logs.filter((log) => {
      // Include room-specific events
      if (log.data.roomId === selectedRoom) return true;

      // Include agent actions in this room
      if (log.type === "AGENT_ACTION" && log.data.roomId === selectedRoom)
        return true;

      // Include agent state changes in this room
      if (log.type === "AGENT_STATE" && log.data.roomId === selectedRoom)
        return true;

      // Include room stimuli
      if (log.type === "ROOM_STIMULUS" && log.data.roomId === selectedRoom)
        return true;

      return false;
    });
  }, [logs, selectedRoom]);

  // Get current room info
  const currentRoom = React.useMemo(() => {
    if (!selectedRoom || !agents.length) return null;
    return agents[0]?.room;
  }, [agents, selectedRoom]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-2 h-8 flex items-center border-b border-cyan-900/30">
        <h2 className="text-emerald-400">
          <span className="text-gray-500">ENV:</span>{" "}
          {currentRoom?.name || "Select a room"}
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {/* Room Info */}
        {currentRoom && (
          <div className="mb-4">
            <h3 className="text-cyan-400 text-sm">{currentRoom.name}</h3>
            <p className="text-emerald-400/80 text-xs">
              {currentRoom.description || "No description available"}
            </p>
          </div>
        )}

        {/* Activity Feed */}
        <div className="space-y-1">
          {roomLogs.map((log, i) => (
            <div key={i} className="font-mono text-xs animate-fade-in">
              <span className="text-gray-500">
                {new Date(log.timestamp).toLocaleTimeString()} »
              </span>{" "}
              {log.data.agentName && (
                <span className={getTailwindColor(log.data.agentName)}>
                  [{log.data.agentName}]
                </span>
              )}{" "}
              <span className="text-gray-400">{formatLogContent(log)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatLogContent(log: SimulationEvent): string {
  switch (log.type) {
    case "AGENT_ACTION":
      if (log.data.actionType === "SPEECH") {
        return `says: "${log.data.message}"`;
      }
      if (log.data.actionType === "WAIT") {
        return log.data.isThinking
          ? `is thinking: ${log.data.reason}`
          : `is waiting: ${log.data.reason}`;
      }
      return log.data.message || JSON.stringify(log.data);

    case "AGENT_STATE":
      if (log.data.appearance) {
        return Object.values(log.data.appearance).filter(Boolean).join("; ");
      }
      if (log.data.thought) {
        return `thinks: "${log.data.thought}"`;
      }
      return "";

    case "ROOM_STIMULUS":
      if (log.data.content?.action) {
        return `${log.data.content.action}: ${log.data.content.reason || ""}`;
      }
      return log.data.content?.message || "";

    default:
      return "";
  }
}
