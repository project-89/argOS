import * as React from "react";
import { ServerMessage, AgentStateMessage } from "../../../types";

interface InspectorProps {
  selectedAgent: string | null;
  selectedRoom: string | null;
  agents: any[];
  rooms: any[];
  logs: ServerMessage[];
}

export function Inspector({
  selectedAgent,
  selectedRoom,
  agents,
  rooms,
  logs,
}: InspectorProps) {
  const agent = agents.find(
    (a) => a.id === selectedAgent || a.name === selectedAgent
  );
  const room = rooms.find((r) => r.id === selectedRoom);

  const getAgentState = (agentId: string) => {
    const recentLogs = logs
      .filter((log): log is AgentStateMessage => log.type === "AGENT_STATE")
      .filter(
        (log) => log.data.agentId === agentId || log.data.agentName === agentId
      )
      .reverse();

    const lastThought = recentLogs.find(
      (log) => log.data.category === "thought"
    )?.data.thought;
    const lastPerception = recentLogs.find(
      (log) => log.data.category === "perception"
    )?.data.perception;
    const lastExperience = recentLogs.find(
      (log) => log.data.category === "experience"
    )?.data.experience;
    const appearance = recentLogs.find(
      (log) => log.data.category === "appearance"
    )?.data.appearance;

    return {
      lastThought,
      lastPerception,
      lastExperience,
      ...appearance,
    };
  };

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

  if (agent) {
    const agentState = getAgentState(agent.id);
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

          {/* Agent Description */}
          <div className="p-2 border-b border-cyan-900/30">
            <div className="text-xs text-gray-500 mb-1">Description</div>
            <div className="text-sm text-cyan-400">
              {agent.description || "No description available"}
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
            <div className="text-sm text-cyan-400 space-y-2">
              {agent.appearance && <div>{agent.appearance}</div>}
              {agent.facialExpression && (
                <div className="flex items-start gap-2">
                  <span className="text-gray-500 text-xs">Expression:</span>
                  <span className="flex-1">{agent.facialExpression}</span>
                </div>
              )}
              {agent.bodyLanguage && (
                <div className="flex items-start gap-2">
                  <span className="text-gray-500 text-xs">Body Language:</span>
                  <span className="flex-1">{agent.bodyLanguage}</span>
                </div>
              )}
              {agent.currentAction && (
                <div className="flex items-start gap-2">
                  <span className="text-gray-500 text-xs">Action:</span>
                  <span className="flex-1">{agent.currentAction}</span>
                </div>
              )}
              {agent.socialCues && (
                <div className="flex items-start gap-2">
                  <span className="text-gray-500 text-xs">Social Cues:</span>
                  <span className="flex-1">{agent.socialCues}</span>
                </div>
              )}
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

          {/* Last Thought */}
          <div className="p-2 border-b border-cyan-900/30">
            <div className="text-xs text-gray-500 mb-1">Last Thought</div>
            <div className="text-sm text-cyan-400">
              {agentState.lastThought || "No thoughts yet"}
            </div>
          </div>

          {/* Last Perception */}
          <div className="p-2 border-b border-cyan-900/30">
            <div className="text-xs text-gray-500 mb-1">Last Perception</div>
            <div className="text-sm text-cyan-400">
              {agentState.lastPerception?.content || "No recent perceptions"}
            </div>
          </div>

          {/* Last Experience */}
          <div className="p-2 border-b border-cyan-900/30">
            <div className="text-xs text-gray-500 mb-1">Last Experience</div>
            <div className="text-sm text-cyan-400">
              {agentState.lastExperience?.content || "No recent experiences"}
            </div>
          </div>

          {/* Recent Activity */}
          <div className="p-2">
            <div className="text-xs text-gray-500 mb-1">Recent Activity</div>
            <div className="space-y-1">
              {logs
                .filter(
                  (log) =>
                    log.type === "AGENT_STATE" && log.data.agentId === agent.id
                )
                .slice(-5)
                .map((log, i) => (
                  <div key={i} className="text-sm text-gray-400">
                    {log.type === "AGENT_STATE" &&
                      (log.data.thought ||
                        log.data.perception?.content ||
                        log.data.experience?.content ||
                        log.data.action?.type)}
                  </div>
                ))}
            </div>
          </div>
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
              {agents
                .map((agent) => {
                  return agent;
                })
                .filter((agent) => agent?.room === room.eid)
                .map((agent) => (
                  <div
                    key={agent.id}
                    className="text-sm flex items-center gap-2"
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        agent?.active ? "bg-emerald-400" : "bg-red-400"
                      }`}
                    />
                    <span className="text-cyan-400">{agent.name}</span>
                  </div>
                ))}
            </div>
          </div>

          {/* Recent Activity */}
          <div className="p-2">
            <div className="text-xs text-gray-500 mb-1">Recent Activity</div>
            <div className="space-y-1">
              {logs
                .filter((log) => {
                  if (log.type !== "AGENT_STATE" && log.type !== "ROOM_STATE")
                    return false;
                  if (log.type === "ROOM_STATE")
                    return log.data.roomId === room.id;
                  return log.data.agentId === selectedAgent;
                })
                .slice(-5)
                .map((log, i) => {
                  if (log.type === "AGENT_STATE") {
                    return (
                      <div key={i} className="text-sm text-gray-400">
                        {log.data.thought || log.data.action?.type}
                      </div>
                    );
                  }
                  if (log.type === "ROOM_STATE") {
                    return (
                      <div key={i} className="text-sm text-gray-400">
                        {log.data.event}
                      </div>
                    );
                  }
                  return null;
                })}
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

        {/* Agent Description */}
        <div className="p-2 border-b border-cyan-900/30">
          <div className="text-xs text-gray-500 mb-1">Description</div>
          <div className="text-sm text-cyan-400">
            {agent.description || "No description available"}
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
          <div className="text-sm text-cyan-400 space-y-2">
            {agent.appearance && <div>{agent.appearance}</div>}
            {agent.facialExpression && (
              <div className="flex items-start gap-2">
                <span className="text-gray-500 text-xs">Expression:</span>
                <span className="flex-1">{agent.facialExpression}</span>
              </div>
            )}
            {agent.bodyLanguage && (
              <div className="flex items-start gap-2">
                <span className="text-gray-500 text-xs">Body Language:</span>
                <span className="flex-1">{agent.bodyLanguage}</span>
              </div>
            )}
            {agent.currentAction && (
              <div className="flex items-start gap-2">
                <span className="text-gray-500 text-xs">Action:</span>
                <span className="flex-1">{agent.currentAction}</span>
              </div>
            )}
            {agent.socialCues && (
              <div className="flex items-start gap-2">
                <span className="text-gray-500 text-xs">Social Cues:</span>
                <span className="flex-1">{agent.socialCues}</span>
              </div>
            )}
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

        {/* Last Thought */}
        <div className="p-2 border-b border-cyan-900/30">
          <div className="text-xs text-gray-500 mb-1">Last Thought</div>
          <div className="text-sm text-cyan-400">
            {agent.lastThought || "No thoughts yet"}
          </div>
        </div>

        {/* Last Perception */}
        <div className="p-2 border-b border-cyan-900/30">
          <div className="text-xs text-gray-500 mb-1">Last Perception</div>
          <div className="text-sm text-cyan-400">
            {agent.lastPerception?.content || "No recent perceptions"}
          </div>
        </div>

        {/* Last Experience */}
        <div className="p-2 border-b border-cyan-900/30">
          <div className="text-xs text-gray-500 mb-1">Last Experience</div>
          <div className="text-sm text-cyan-400">
            {agent.lastExperience?.content || "No recent experiences"}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="p-2">
          <div className="text-xs text-gray-500 mb-1">Recent Activity</div>
          <div className="space-y-1">
            {logs
              .filter(
                (log) =>
                  log.type === "AGENT_STATE" && log.data.agentId === agent.id
              )
              .slice(-5)
              .map((log, i) => (
                <div key={i} className="text-sm text-gray-400">
                  {log.type === "AGENT_STATE" &&
                    (log.data.thought ||
                      log.data.perception?.content ||
                      log.data.experience?.content ||
                      log.data.action?.type)}
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
