import * as React from "react";
import { SimulationEvent } from "../../../types";

interface InspectorProps {
  selectedAgent: string | null;
  selectedRoom: string | null;
  agents: any[];
  rooms: any[];
  logs: SimulationEvent[];
}

export function Inspector({
  selectedAgent,
  selectedRoom,
  agents,
  rooms,
  logs,
}: InspectorProps) {
  const agent = agents.find((a) => a.name === selectedAgent);
  const room = rooms.find((r) => r.id === selectedRoom);

  if (!agent && !room) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-2 h-8 flex items-center border-b border-cyan-900/30">
          <h2 className="text-emerald-400">
            <span className="text-gray-500">INS:</span> INSPECTOR
          </h2>
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          Select an agent or room to inspect
        </div>
      </div>
    );
  }

  if (room) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-2 h-8 flex items-center border-b border-cyan-900/30">
          <h2 className="text-emerald-400">
            <span className="text-gray-500">INS:</span> {room.name}
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* Room Details */}
          <div className="p-2 border-b border-cyan-900/30">
            <div className="text-xs text-gray-500 mb-1">Type</div>
            <div className="text-sm text-cyan-400">{room.type}</div>
          </div>

          {/* Room Description */}
          <div className="p-2 border-b border-cyan-900/30">
            <div className="text-xs text-gray-500 mb-1">Description</div>
            <div className="text-sm text-cyan-400">{room.description}</div>
          </div>

          {/* Occupants */}
          <div className="p-2 border-b border-cyan-900/30">
            <div className="text-xs text-gray-500 mb-1">Present Agents</div>
            <div className="space-y-1">
              {room.occupants?.map((agentId: number) => {
                const agent = agents.find((a) => a.id === agentId);
                return (
                  <div
                    key={agentId}
                    className="text-sm flex items-center gap-2"
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        agent?.active ? "bg-emerald-400" : "bg-red-400"
                      }`}
                    />
                    <span className="text-cyan-400">{agent?.name}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Activity */}
          <div className="p-2">
            <div className="text-xs text-gray-500 mb-1">Recent Activity</div>
            <div className="space-y-1">
              {logs
                .filter(
                  (log) =>
                    log.data.roomId === room.id &&
                    (log.type === "AGENT_ACTION" || log.type === "AGENT_STATE")
                )
                .slice(-5)
                .map((log, i) => (
                  <div key={i} className="text-sm text-gray-400">
                    {log.data.message || log.data.action}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-2 h-8 flex items-center border-b border-cyan-900/30">
        <h2 className="text-emerald-400">
          <span className="text-gray-500">INS:</span> {agent.name}
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        {/* Agent Details */}
        <div className="p-2 border-b border-cyan-900/30">
          <div className="text-xs text-gray-500 mb-1">Role</div>
          <div className="text-sm text-cyan-400">{agent.role}</div>
        </div>

        {/* Current State */}
        <div className="p-2 border-b border-cyan-900/30">
          <div className="text-xs text-gray-500 mb-1">State</div>
          <div className="text-sm">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  agent.active ? "bg-emerald-400" : "bg-red-400"
                }`}
              />
              <span className="text-cyan-400">
                {agent.active ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
        </div>

        {/* Last Thought */}
        <div className="p-2 border-b border-cyan-900/30">
          <div className="text-xs text-gray-500 mb-1">Last Thought</div>
          <div className="text-sm text-cyan-400">
            {agent.lastThought || "No thoughts yet"}
          </div>
        </div>

        {/* Recent Experiences */}
        <div className="p-2">
          <div className="text-xs text-gray-500 mb-1">Recent Experiences</div>
          <div className="space-y-1">
            {(agent.experiences || []).slice(-5).map((exp: any, i: number) => (
              <div key={i} className="text-sm text-gray-400">
                {exp.content}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
