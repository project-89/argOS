import * as React from "react";
import { useEffect, useState, useMemo } from "react";
import { SimulationEvent, AgentColor } from "../types";

interface SimulationState {
  isRunning: boolean;
  agents: any[];
  logs: SimulationEvent[];
}

// Generate a unique color for each agent
const generateAgentColor = (id: number, name: string): AgentColor => {
  const colors = [
    "text-cyan-400",
    "text-emerald-400",
    "text-purple-400",
    "text-yellow-400",
    "text-pink-400",
    "text-blue-400",
  ];
  return {
    id,
    name,
    color: colors[id % colors.length],
  };
};

const LogEntry = ({
  log,
  agentColors,
}: {
  log: SimulationEvent;
  agentColors: AgentColor[];
}) => {
  const agentColor = log.agentId
    ? agentColors.find((a) => a.id === log.agentId)?.color
    : "text-gray-400";

  const getLogStyle = () => {
    if (!log.actionType) return "text-gray-400";

    switch (log.actionType) {
      case "SPEECH":
        return `${agentColor} font-bold`;
      case "THOUGHT":
        return `${agentColor} opacity-75`;
      case "WAIT":
        return `${agentColor} opacity-50`;
      case "SYSTEM":
        return "text-orange-400";
      default:
        return agentColor;
    }
  };

  return (
    <div className={`font-mono text-sm ${getLogStyle()} mb-1 log-entry`}>
      <span className="text-gray-500">
        {new Date(log.timestamp).toLocaleTimeString()} »
      </span>{" "}
      {log.agentName && <span className={agentColor}>[{log.agentName}] </span>}
      {JSON.stringify(log.data)}
    </div>
  );
};

export function App() {
  const [state, setState] = useState<SimulationState>({
    isRunning: false,
    agents: [],
    logs: [],
  });

  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Generate and memoize agent colors
  const agentColors = useMemo(
    () =>
      state.agents.map((agent, index) =>
        generateAgentColor(agent.id || index, agent.name)
      ),
    [state.agents]
  );

  useEffect(() => {
    const socket = new WebSocket(`ws://${window.location.hostname}:3000/ws`);

    socket.onopen = () => {
      setIsConnected(true);
      console.log("WebSocket connected");
    };

    socket.onclose = () => {
      setIsConnected(false);
      console.log("WebSocket disconnected");
    };

    socket.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    socket.onmessage = (event) => {
      const message: SimulationEvent = JSON.parse(event.data);

      setState((prev) => {
        switch (message.type) {
          case "SYSTEM_STATE":
            return {
              ...prev,
              isRunning: message.data.isRunning,
              agents: message.data.agents || prev.agents,
            };
          case "LOG":
            if (message.data.message === "Stopping simulation runtime...") {
              return {
                ...prev,
                isRunning: false,
                logs: [...prev.logs, message].slice(-100),
              };
            }
            return {
              ...prev,
              logs: [...prev.logs, message].slice(-100),
            };
          case "AGENT_STATE":
          case "AGENT_ACTION":
            return {
              ...prev,
              logs: [...prev.logs, message].slice(-100),
            };
          default:
            return prev;
        }
      });
    };

    setWs(socket);
    return () => socket.close();
  }, []);

  const sendCommand = (type: string) => {
    if (ws && isConnected) {
      ws.send(JSON.stringify({ type }));
    }
  };

  return (
    <div className="min-h-screen bg-[#0B1221] text-gray-100 p-4 relative overflow-hidden font-mono flex flex-col">
      {/* Header Bar */}
      <div className="max-w-7xl mx-auto w-full mb-4 border-b border-cyan-900/30">
        <div className="flex justify-between items-center py-2">
          <div className="text-cyan-400">
            <span className="text-emerald-400">»</span> ArgOS v1.0{" "}
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                isConnected ? "bg-emerald-400 animate-pulse-slow" : "bg-red-500"
              }`}
            />
          </div>
          <div className="space-x-2">
            <button
              onClick={() => sendCommand(state.isRunning ? "PAUSE" : "START")}
              disabled={!isConnected}
              className={`px-4 py-1 rounded font-mono text-sm ${
                !isConnected
                  ? "bg-gray-800 text-gray-600"
                  : state.isRunning
                  ? "bg-black/30 text-yellow-400 border border-yellow-900/50"
                  : "bg-black/30 text-emerald-400 border border-emerald-900/50"
              }`}
            >
              {state.isRunning ? "■ PAUSE" : "► START"}
            </button>
            <button
              onClick={() => sendCommand("STOP")}
              disabled={!isConnected}
              className={`px-4 py-1 rounded font-mono text-sm ${
                !isConnected
                  ? "bg-gray-800 text-gray-600"
                  : "bg-black/30 text-red-400 border border-red-900/50"
              }`}
            >
              ◼ STOP
            </button>
            <button
              onClick={() => sendCommand("RESET")}
              disabled={!isConnected}
              className={`px-4 py-1 rounded font-mono text-sm ${
                !isConnected
                  ? "bg-gray-800 text-gray-600"
                  : "bg-black/30 text-orange-400 border border-orange-900/50"
              }`}
            >
              ⟲ RESET
            </button>
            <button
              onClick={() => setState((prev) => ({ ...prev, logs: [] }))}
              className="px-4 py-1 rounded font-mono text-sm bg-black/30 text-cyan-400 border border-cyan-900/50"
            >
              ⌫ CLEAR
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto w-full flex-1 flex flex-col min-h-0">
        {/* Upper Grid */}
        <div className="flex-1 grid grid-cols-12 gap-0 border border-cyan-900/30 rounded bg-black/20 mb-4">
          {/* Left Column - Agents */}
          <div className="col-span-4 border-r border-cyan-900/30">
            <div className="p-4 border-b border-cyan-900/30">
              <h2 className="text-emerald-400">
                <span className="text-gray-500">01:</span> AGENTS
              </h2>
            </div>
            <div className="p-4 space-y-4">
              {state.agents.map((agent, i) => (
                <div
                  key={i}
                  className="border border-cyan-900/30 rounded bg-black/20 p-4"
                >
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-cyan-400">{agent.name}</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-cyan-700">
                        {agent.role}
                      </span>
                      <span
                        className={`w-2 h-2 rounded-full ${
                          agent.active ? "bg-emerald-400" : "bg-red-400"
                        }`}
                      />
                    </div>
                  </div>

                  {/* Appearance */}
                  <div className="text-emerald-400/80 text-sm mb-4">
                    {agent.appearance}
                  </div>

                  {/* Current Thought */}
                  {agent.lastThought && (
                    <div className="border-t border-cyan-900/30 pt-2 mt-2 text-gray-400 text-xs">
                      <span className="text-purple-400">
                        » Current Thought:{" "}
                      </span>
                      {agent.lastThought}
                    </div>
                  )}

                  {/* Recent Experiences */}
                  {agent.experiences && agent.experiences.length > 0 && (
                    <div className="border-t border-cyan-900/30 pt-2 mt-2">
                      <span className="text-purple-400 text-xs">
                        » Recent Experiences:
                      </span>
                      <div className="text-gray-400 text-xs mt-1">
                        {agent.experiences.slice(-3).map(
                          (
                            exp: {
                              type: string;
                              content: string;
                              timestamp: number;
                            },
                            j: number
                          ) => (
                            <div key={j} className="opacity-75">
                              {exp.content}
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}

                  {/* Current Action */}
                  {agent.pendingAction && (
                    <div className="border-t border-cyan-900/30 pt-2 mt-2">
                      <span className="text-purple-400 text-xs">
                        » Current Action:
                      </span>
                      <div className="text-gray-400 text-xs mt-1">
                        {agent.pendingAction.tool}:{" "}
                        {JSON.stringify(agent.pendingAction.parameters)}
                      </div>
                    </div>
                  )}

                  {/* Current Perceptions */}
                  {agent.currentStimuli && agent.currentStimuli.length > 0 && (
                    <div className="border-t border-cyan-900/30 pt-2 mt-2">
                      <span className="text-purple-400 text-xs">
                        » Current Perceptions:
                      </span>
                      <div className="text-gray-400 text-xs mt-1">
                        {agent.currentStimuli
                          .slice(-2)
                          .map(
                            (
                              stim: { type: string; content: any },
                              j: number
                            ) => (
                              <div key={j} className="opacity-75">
                                {stim.type}: {JSON.stringify(stim.content)}
                              </div>
                            )
                          )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Middle Column - Room View */}
          <div className="col-span-5 border-r border-cyan-900/30">
            <div className="p-4 border-b border-cyan-900/30">
              <h2 className="text-emerald-400">
                <span className="text-gray-500">02:</span> ENVIRONMENT
              </h2>
            </div>
            <div className="p-4">
              <h3 className="text-cyan-400 mb-2">
                {state.agents[0]?.room?.name || "Unknown Location"}
              </h3>
              <p className="text-emerald-400/80 text-sm mb-4">
                {state.agents[0]?.room?.description ||
                  "No description available"}
              </p>
              <div className="h-[500px] overflow-y-auto">
                {state.logs
                  .filter(
                    (log) => log.type === "AGENT_ACTION" || log.type === "LOG"
                  )
                  .map((log, i) => {
                    // Parse message if it's JSON
                    let message = log.data.message;
                    try {
                      const parsed = JSON.parse(message);
                      if (parsed.message) {
                        message = parsed.message;
                      }
                    } catch (e) {
                      // Not JSON, use as is
                    }

                    // Find agent color if this is an agent message
                    const agentColor = log.data.agentName
                      ? agentColors.find((a) => a.name === log.data.agentName)
                          ?.color
                      : "text-gray-400";

                    return (
                      <div key={i} className="font-mono text-sm mb-1">
                        <span className="text-gray-500">
                          {new Date(log.timestamp).toLocaleTimeString()} »
                        </span>{" "}
                        {log.data.agentName && (
                          <span className={agentColor}>
                            [{log.data.agentName}]{" "}
                          </span>
                        )}
                        <span className={agentColor || "text-gray-400"}>
                          {message}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>

          {/* Right Column - Thought Stream */}
          <div className="col-span-3">
            <div className="p-4 border-b border-cyan-900/30">
              <h2 className="text-emerald-400">
                <span className="text-gray-500">03:</span> THOUGHT STREAM
              </h2>
            </div>
            <div className="p-4">
              <div className="h-[500px] overflow-y-auto">
                {state.logs
                  .filter((log) => log.type === "AGENT_STATE")
                  .map((log, i) => (
                    <LogEntry key={i} log={log} agentColors={agentColors} />
                  ))}
              </div>
            </div>
          </div>
        </div>

        {/* System Logs Panel */}
        <div className="h-48 border border-cyan-900/30 rounded bg-black/20">
          <div className="p-2 border-b border-cyan-900/30">
            <h2 className="text-orange-400">
              <span className="text-gray-500">SYS:</span> SYSTEM LOGS
            </h2>
          </div>
          <div className="p-2 h-[calc(100%-2.5rem)] overflow-y-auto">
            {state.logs
              .filter((log) => log.type === "LOG" || log.type === "ERROR")
              .map((log, i) => (
                <LogEntry
                  key={i}
                  log={{ ...log, actionType: "SYSTEM" }}
                  agentColors={agentColors}
                />
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
