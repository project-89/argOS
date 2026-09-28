import * as React from "react";
import { ServerMessage, AgentState, RoomState } from "../../../types";
import { RoomInspector } from "./inspectors/RoomInspector";
import { AgentInspector } from "./inspectors/AgentInspector";

interface InspectorProps {
  selectedAgent: string | null;
  selectedRoom: string | null;
  logs: ServerMessage[];
  agents: AgentState[];
  rooms: RoomState[];
}

export function Inspector({
  selectedAgent,
  selectedRoom,
  logs,
  agents,
  rooms,
}: InspectorProps) {
  // Default "no selection" view
  if (!selectedAgent && !selectedRoom) {
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

  // Room inspection view
  if (selectedRoom) {
    return (
      <RoomInspector
        room={rooms.find((r) => r.id === selectedRoom)}
        agents={agents}
        logs={logs}
      />
    );
  }

  // Agent inspection view
  if (selectedAgent) {
    return (
      <AgentInspector
        agent={agents.find(
          (a) => a.id === selectedAgent || a.name === selectedAgent
        )}
        logs={logs}
      />
    );
  }

  return null;
}
