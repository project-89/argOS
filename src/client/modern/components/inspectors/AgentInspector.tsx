import * as React from "react";
import {
  ServerMessage,
  AgentState,
  AgentUpdateMessage,
} from "../../../../types";

interface AgentInspectorProps {
  agent: AgentState | undefined;
  logs: ServerMessage[];
}

export function AgentInspector({ agent, logs }: AgentInspectorProps) {
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

  if (!agent) return null;

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
                  <span>{new Date(state.timestamp).toLocaleTimeString()}</span>
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
