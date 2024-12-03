import * as React from "react";
import { SimulationEvent } from "../../../types";

interface InspectorProps {
  selectedAgent: string | null;
  agents: any[];
  logs: SimulationEvent[];
}

export function Inspector({ selectedAgent, agents, logs }: InspectorProps) {
  const agent = agents.find((a) => a.name === selectedAgent);

  if (!agent) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-2 h-8 flex items-center border-b border-cyan-900/30">
          <h2 className="text-emerald-400">
            <span className="text-gray-500">INS:</span> INSPECTOR
          </h2>
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          Select an agent to inspect
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
