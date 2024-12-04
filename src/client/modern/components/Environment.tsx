import * as React from "react";
import {
  ServerMessage,
  AgentStateMessage,
  RoomStateMessage,
} from "../../../types";
import { getTailwindColor } from "../../../utils/colors";

interface EnvironmentProps {
  agents: any[];
  logs: ServerMessage[];
  selectedRoom?: string | null;
}

export function Environment({ agents, logs, selectedRoom }: EnvironmentProps) {
  // Filter logs for the selected room and relevant event types
  const roomLogs = React.useMemo(() => {
    if (!selectedRoom) return [];
    return logs.filter((log) => {
      if (log.type === "ROOM_STATE") {
        return log.data.roomId === selectedRoom;
      }
      if (log.type === "AGENT_STATE") {
        const agent = agents.find((a) => a.id === log.data.agentId);
        return agent?.room?.id === selectedRoom;
      }
      return false;
    });
  }, [logs, selectedRoom, agents]);

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
              {log.type === "AGENT_STATE" && (
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

function formatLogContent(log: ServerMessage): string {
  if (log.type === "AGENT_STATE") {
    const data = (log as AgentStateMessage).data;
    if (data.category === "appearance" && data.appearance) {
      return Object.values(data.appearance).filter(Boolean).join("; ");
    }
    if (data.category === "thought" && data.thought) {
      return `thinks: "${data.thought}"`;
    }
    if (data.category === "action" && data.action) {
      return `${data.action.type}: ${data.action.data || ""}`;
    }
  }
  if (log.type === "ROOM_STATE") {
    const data = (log as RoomStateMessage).data;
    return data.event?.message || "";
  }
  return "";
}
