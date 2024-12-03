import * as React from "react";
import { SimulationEvent } from "../../../types";

interface TimelineProps {
  logs: SimulationEvent[];
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

function getEventColor(type: string): string {
  switch (type) {
    case "AGENT_ACTION":
      return "emerald";
    case "AGENT_STATE":
      return "cyan";
    case "SYSTEM_STATE":
      return "orange";
    case "LOG":
      return "gray";
    default:
      return "gray";
  }
}

function formatEventContent(log: SimulationEvent): string {
  switch (log.type) {
    case "AGENT_ACTION":
      return `${log.data.agentName || ""} ${log.data.tool || ""} ${
        log.data.message || ""
      }`;
    case "AGENT_STATE":
      if (log.data.thought)
        return `${log.data.agentName || ""} thought: ${log.data.thought}`;
      if (log.data.appearance)
        return `${log.data.agentName || ""} appearance changed`;
      return JSON.stringify(log.data);
    case "SYSTEM_STATE":
      return `System state updated`;
    case "LOG":
      return log.data.message || "";
    default:
      return JSON.stringify(log.data);
  }
}
