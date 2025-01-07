import * as React from "react";
import {
  ServerMessage,
  AgentState,
  RoomState,
  RoomUpdateMessage,
} from "../../../../types";

interface RoomInspectorProps {
  room: RoomState | undefined;
  agents: AgentState[];
  logs: ServerMessage[];
}

export function RoomInspector({ room, agents, logs }: RoomInspectorProps) {
  const activityStreamRef = React.useRef<HTMLDivElement>(null);
  const [selectedRoomAgent, setSelectedRoomAgent] = React.useState<
    string | null
  >(null);

  // Auto scroll activity stream to bottom when new messages arrive
  React.useEffect(() => {
    if (activityStreamRef.current) {
      const scrollContainer = activityStreamRef.current;
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }, [logs]);

  const renderContent = (content: any) => {
    if (typeof content === "string") {
      return content;
    }
    return JSON.stringify(content, null, 2);
  };

  const getRoomState = (roomId: string) => {
    const recentLogs = logs
      .filter((log): log is RoomUpdateMessage => log.type === "ROOM_UPDATE")
      .filter((log) => log.data.roomId === roomId)
      .slice(-10);

    return recentLogs.map((log) => ({
      type: log.data.type,
      content: log.data.content,
      timestamp: log.data.timestamp,
      agent:
        log.data.agentName ||
        (log.data.agentId
          ? agents.find((a) => a.id === log.data.agentId)?.name
          : null),
    }));
  };

  if (!room) return null;

  const recentActivity = getRoomState(room.id);
  const presentAgents = agents.filter((a) => a.roomId === room.id);

  // Get environmental stats
  const activityByType = recentActivity.reduce((acc, act) => {
    acc[act.type] = (acc[act.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Get selected agent details if any
  const selectedAgentDetails = selectedRoomAgent
    ? agents.find((a) => a.id === selectedRoomAgent)
    : null;

  return (
    <div className="h-full flex flex-col">
      <div className="px-2 h-8 flex items-center border-b border-cyan-900/30">
        <h2 className="text-emerald-400">
          <span className="text-gray-500">INS:</span> ROOM: {room.name}
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        {/* Room Details */}
        <div className="p-2 border-b border-cyan-900/30">
          <div className="text-xs text-gray-500 mb-1">Room Info</div>
          <div className="text-sm text-cyan-400 mb-2">{room.description}</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-gray-500">Type: </span>
              <span className="text-emerald-400">{room.type}</span>
            </div>
            <div>
              <span className="text-gray-500">Agents: </span>
              <span className="text-emerald-400">{presentAgents.length}</span>
            </div>
          </div>
        </div>

        {/* Present Agents */}
        <div className="p-2 border-b border-cyan-900/30">
          <div className="text-xs text-gray-500 mb-1">Present Agents</div>
          <div className="space-y-1">
            {presentAgents.map((agent) => (
              <div
                key={agent.id}
                className={`p-1 rounded cursor-pointer transition-colors ${
                  selectedRoomAgent === agent.id
                    ? "bg-cyan-900/30 text-cyan-400"
                    : "hover:bg-black/20 text-gray-400"
                }`}
                onClick={() =>
                  setSelectedRoomAgent(
                    selectedRoomAgent === agent.id ? null : agent.id
                  )
                }
              >
                <div className="flex items-center justify-between">
                  <span>{agent.name}</span>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-500">{agent.role}</span>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        agent.active ? "bg-emerald-400" : "bg-red-400"
                      }`}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Selected Agent Details (if any) */}
        {selectedAgentDetails && (
          <div className="p-2 border-b border-cyan-900/30">
            <div className="text-xs text-gray-500 mb-1">Agent Details</div>
            <div className="space-y-2">
              <div>
                <div className="text-xs text-gray-500">Current State</div>
                <div className="text-sm text-cyan-400">
                  {selectedAgentDetails.appearance.currentAction || "Idle"}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Appearance</div>
                <div className="text-sm text-cyan-400">
                  {selectedAgentDetails.appearance.description}
                </div>
              </div>
              {selectedAgentDetails.appearance.facialExpression && (
                <div>
                  <div className="text-xs text-gray-500">Expression</div>
                  <div className="text-sm text-cyan-400">
                    {selectedAgentDetails.appearance.facialExpression}
                  </div>
                </div>
              )}
              {selectedAgentDetails.appearance.bodyLanguage && (
                <div>
                  <div className="text-xs text-gray-500">Body Language</div>
                  <div className="text-sm text-cyan-400">
                    {selectedAgentDetails.appearance.bodyLanguage}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Goals & Plans for Selected Agent */}
        {selectedAgentDetails && selectedAgentDetails.goals && (
          <div className="p-2 border-b border-cyan-900/30">
            <div className="text-xs text-gray-500 mb-1">Goals & Plans</div>
            <div className="space-y-2">
              {selectedAgentDetails.goals.map((goal) => (
                <div key={goal.id} className="mb-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-emerald-400">{goal.description}</span>
                    <span
                      className={`text-xs ${
                        goal.status === "completed"
                          ? "text-green-400"
                          : goal.status === "failed"
                          ? "text-red-400"
                          : goal.status === "in_progress"
                          ? "text-yellow-400"
                          : "text-gray-400"
                      }`}
                    >
                      {goal.status} ({Math.round(goal.progress)}%)
                    </span>
                  </div>
                  {selectedAgentDetails.activePlans
                    ?.filter((plan) => plan.goalId === goal.id)
                    .map((plan) => (
                      <div key={plan.id} className="ml-4 mt-1">
                        <div className="text-xs text-cyan-400">
                          Plan: {plan.steps[0]?.description || "No description"}
                        </div>
                        <div className="space-y-1 ml-2">
                          {plan.steps.map((step) => (
                            <div key={step.id} className="text-xs">
                              <span
                                className={`${
                                  step.status === "completed"
                                    ? "text-green-400"
                                    : step.status === "failed"
                                    ? "text-red-400"
                                    : step.status === "in_progress"
                                    ? "text-yellow-400"
                                    : "text-gray-400"
                                }`}
                              >
                                • {step.description}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Room Activity Stats */}
        <div className="p-2 border-b border-cyan-900/30">
          <div className="text-xs text-gray-500 mb-1">Activity Stats</div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(activityByType).map(([type, count]) => (
              <div key={type} className="text-sm">
                <span className="text-emerald-400">{type}: </span>
                <span className="text-cyan-400">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity Stream */}
        <div className="p-2">
          <div className="text-xs text-gray-500 mb-1">Activity Stream</div>
          <div
            ref={activityStreamRef}
            className="space-y-2 max-h-[300px] overflow-y-auto pr-2"
          >
            {recentActivity.map((activity, i) => (
              <div key={i} className="text-sm">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>
                    {new Date(activity.timestamp).toLocaleTimeString()}
                  </span>
                  {activity.agent && (
                    <span
                      className={`text-cyan-400 cursor-pointer hover:underline`}
                      onClick={() => {
                        const agentId = agents.find(
                          (a) => a.name === activity.agent
                        )?.id;
                        if (agentId) setSelectedRoomAgent(agentId);
                      }}
                    >
                      {activity.agent}
                    </span>
                  )}
                  <span className="text-emerald-400">{activity.type}</span>
                </div>
                <div className="text-gray-400 mt-1">
                  {renderContent(activity.content)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
