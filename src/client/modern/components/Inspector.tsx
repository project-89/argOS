import * as React from "react";
import {
  ServerMessage,
  AgentUpdateMessage,
  RoomUpdateMessage,
  AgentState,
  RoomState,
  Agent,
  Room,
} from "../../../types";

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
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // Auto scroll to bottom when new messages arrive
  React.useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const renderContent = (content: any) => {
    if (typeof content === "string") {
      return content;
    }
    return JSON.stringify(content, null, 2);
  };

  const getAgentState = (agentId: string) => {
    const recentLogs = logs
      .filter((log): log is AgentUpdateMessage => log.type === "AGENT_UPDATE")
      .filter((log) => log.channel.agent === agentId)
      .slice(-10);

    return recentLogs.map((log) => ({
      type: log.data.category,
      content: log.data.content,
      timestamp: log.timestamp,
    }));
  };

  const getRoomState = (roomId: string) => {
    const recentLogs = logs
      .filter((log): log is RoomUpdateMessage => log.type === "ROOM_UPDATE")
      .filter((log) => log.data.roomId === roomId)
      .slice(-10);

    return recentLogs.map((log) => ({
      type: log.data.type,
      content: log.data.content,
      timestamp: log.timestamp,
      agent:
        log.data.agentName ||
        (log.data.agentId
          ? agents.find((a) => a.id === log.data.agentId)?.name
          : null),
    }));
  };

  // Room inspection view
  if (selectedRoom) {
    const room = rooms.find((r) => r.id === selectedRoom);
    const recentActivity = getRoomState(selectedRoom);

    return (
      <div className="h-full flex flex-col">
        <div className="px-2 h-8 flex items-center border-b border-cyan-900/30">
          <h2 className="text-emerald-400">
            <span className="text-gray-500">INS:</span> ROOM: {room?.name}
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* Room Details */}
          <div className="p-2 border-b border-cyan-900/30">
            <div className="text-xs text-gray-500 mb-1">Description</div>
            <div className="text-sm text-cyan-400">{room?.description}</div>
          </div>

          {/* Recent Activity Stream */}
          <div className="p-2 flex-1 overflow-y-auto">
            <div className="text-xs text-gray-500 mb-1">Activity Stream</div>
            <div className="space-y-2">
              {recentActivity.map((activity, i) => (
                <div key={i} className="text-sm">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>
                      {new Date(activity.timestamp).toLocaleTimeString()}
                    </span>
                    {activity.agent && (
                      <span className="text-cyan-400">{activity.agent}</span>
                    )}
                    <span className="text-emerald-400">{activity.type}</span>
                  </div>
                  <div className="text-gray-400 mt-1">
                    {renderContent(activity.content)}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>
      </div>
    );
  }

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

  // Agent inspection view
  const agent = agents.find(
    (a) => a.id === selectedAgent || a.name === selectedAgent
  );

  if (agent) {
    const recentStates = getAgentState(agent.id);
    const latestAppearance = recentStates.find(
      (state) => state.type === "appearance"
    )?.content;

    return (
      <div className="h-full flex flex-col">
        <div className="px-2 h-8 flex items-center border-b border-cyan-900/30">
          <h2 className="text-emerald-400">
            <span className="text-gray-500">INS:</span> AGENT: {agent.name}
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* Agent Details */}
          <div className="p-2 border-b border-cyan-900/30">
            <div className="text-xs text-gray-500 mb-1">Role</div>
            <div className="text-sm text-cyan-400">{agent.role}</div>
          </div>

          {/* Agent Description */}
          <div className="p-2 border-b border-cyan-900/30">
            <div className="text-xs text-gray-500 mb-1">Description</div>
            <div className="text-sm text-cyan-400">
              {agent.appearance || "No description available"}
            </div>
          </div>

          {/* Agent Appearance */}
          <div className="p-2 border-b border-cyan-900/30">
            <div className="text-xs text-gray-500 mb-1 flex items-center justify-between">
              <span>Appearance</span>
              {agent.lastUpdate && (
                <span className="text-emerald-400 text-[10px]">
                  {Math.round((Date.now() - agent.lastUpdate) / 1000)}s ago
                </span>
              )}
            </div>
            <div className="text-sm text-cyan-400">
              {latestAppearance && <div>{renderContent(latestAppearance)}</div>}
            </div>
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

          {/* Recent Activity */}
          <div className="p-2">
            <div className="text-xs text-gray-500 mb-1">Recent Activity</div>
            <div className="space-y-2">
              {recentStates.map((state, i) => (
                <div key={i} className="text-sm">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>
                      {new Date(state.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="text-emerald-400">{state.type}</span>
                  </div>
                  <div className="text-gray-400 mt-1">
                    {renderContent(state.content)}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
