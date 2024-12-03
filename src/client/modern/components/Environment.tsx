import * as React from "react";
import { SimulationEvent } from "../../../types";

interface EnvironmentProps {
  agents: any[];
  logs: SimulationEvent[];
}

export function Environment({ agents, logs }: EnvironmentProps) {
  return (
    <div className="h-full flex flex-col">
      <div className="px-2 h-8 flex items-center border-b border-cyan-900/30">
        <h2 className="text-emerald-400">
          <span className="text-gray-500">ENV:</span> ENVIRONMENT
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {/* Room Info */}
        <div className="mb-4">
          <h3 className="text-cyan-400 text-sm">
            {agents[0]?.room?.name || "Unknown Location"}
          </h3>
          <p className="text-emerald-400/80 text-xs">
            {agents[0]?.room?.description || "No description available"}
          </p>
        </div>

        {/* Activity Feed */}
        <div className="space-y-1">
          {logs
            .filter((log) => {
              if (log.type === "AGENT_ACTION") {
                return log.data.actionType === "SPEECH";
              }
              if (log.type === "AGENT_STATE") {
                return (
                  log.data.appearance || log.data.actionType === "APPEARANCE"
                );
              }
              return false;
            })
            .map((log, i) => (
              <div key={i} className="font-mono text-sm">
                <span className="text-gray-500">
                  {new Date(log.timestamp).toLocaleTimeString()} »
                </span>{" "}
                {log.data.agentName && (
                  <span className="text-cyan-400">[{log.data.agentName}] </span>
                )}
                <span className="text-gray-400">
                  {log.data.message ||
                    (log.data.appearance &&
                      Object.values(log.data.appearance)
                        .filter(Boolean)
                        .join("; "))}
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
