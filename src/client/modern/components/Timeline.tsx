import * as React from "react";
import { ServerMessage } from "../../../types";

interface TimelineProps {
  logs: ServerMessage[];
  isRunning: boolean;
}

export function Timeline({ logs, isRunning }: TimelineProps) {
  return (
    <div className="h-full flex flex-col">
      <div className="px-2 h-8 flex items-center border-b border-cyan-900/30">
        <h2 className="text-emerald-400">
          <span className="text-gray-500">TL:</span> TIMELINE
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {logs.map((log, i) => (
            <div key={i} className="font-mono text-xs">
              <span className="text-gray-500">
                {new Date(log.timestamp).toLocaleTimeString()} »
              </span>{" "}
              <span className={`text-${getEventColor(log.type)}-400`}>
                {log.type}
              </span>{" "}
              <span className="text-gray-400">{formatEventContent(log)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function getEventColor(type: ServerMessage["type"]): string {
  switch (type) {
    case "AGENT_UPDATE":
      return "cyan";
    case "ROOM_UPDATE":
      return "emerald";
    case "WORLD_UPDATE":
      return "orange";
    case "CONNECTION_UPDATE":
      return "gray";
    default:
      return "gray";
  }
}

function formatEventContent(log: ServerMessage): string {
  if (log.type === "AGENT_UPDATE") {
    const data = log.data;
    if (data.category === "thought")
      return `${data.agentId} thought: ${data.content}`;
    if (data.category === "appearance")
      return `${data.agentId} appearance changed`;
    if (data.category === "action")
      return `${data.agentId} ${data.content || ""}`;
    return JSON.stringify(data);
  }
  if (log.type === "ROOM_UPDATE") {
    return log.data.message || "Room updated";
  }
  if (log.type === "WORLD_UPDATE") {
    return "World state updated";
  }
  if (log.type === "CONNECTION_UPDATE") {
    return log.connected ? "Connected" : "Disconnected";
  }
  return "";
}
