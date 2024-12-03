import * as React from "react";

interface AgentNetworkProps {
  agents: any[];
  selectedAgent: string | null;
  onSelectAgent: (agentId: string | null) => void;
}

export function AgentNetwork({
  agents,
  selectedAgent,
  onSelectAgent,
}: AgentNetworkProps) {
  return (
    <div className="h-full flex flex-col">
      <div className="px-2 h-8 flex items-center border-b border-cyan-900/30">
        <h2 className="text-emerald-400">
          <span className="text-gray-500">NET:</span> AGENT NETWORK
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {/* Placeholder for force-directed graph */}
        <div className="text-gray-500 text-sm">
          {agents.map((agent, i) => (
            <div
              key={i}
              className={`p-2 mb-2 border border-cyan-900/30 rounded cursor-pointer ${
                selectedAgent === agent.name ? "bg-cyan-900/30" : "bg-black/20"
              }`}
              onClick={() => onSelectAgent(agent.name)}
            >
              <div className="text-cyan-400">{agent.name}</div>
              <div className="text-xs text-gray-500">{agent.role}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
