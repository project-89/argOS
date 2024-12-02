import * as React from "react";
import { useEffect, useState, useRef } from "react";
import { SimulationEvent } from "../types";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { getTailwindColor } from "../utils/colors";

interface SimulationState {
  isRunning: boolean;
  agents: any[];
  logs: SimulationEvent[];
}

const LogMessage = ({
  log,
  showTimestamp = true,
}: {
  log: SimulationEvent;
  showTimestamp?: boolean;
}) => {
  const agentName = log.data.agentName;
  const agentColor = agentName ? getTailwindColor(agentName) : "text-gray-400";
  console.log(`Color for ${agentName}:`, agentColor);

  return (
    <div className="font-mono text-sm">
      {showTimestamp && (
        <span className="text-gray-500">
          {new Date(log.timestamp).toLocaleTimeString()} »
        </span>
      )}{" "}
      {agentName && <span className={agentColor}>[{agentName}] </span>}
      <span className={agentColor}>{log.data.message || log.data.thought}</span>
    </div>
  );
};

const ResizeHandle = ({ className = "" }) => (
  <PanelResizeHandle
    className={`hover:bg-cyan-700/50 transition-all duration-150 ${className}`}
  />
);

export function App() {
  const [state, setState] = useState<SimulationState>({
    isRunning: false,
    agents: [],
    logs: [],
  });

  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Refs for scroll containers
  const environmentRef = useRef<HTMLDivElement>(null);
  const thoughtStreamRef = useRef<HTMLDivElement>(null);

  // Auto-scroll effect
  useEffect(() => {
    const scrollToBottom = (ref: React.RefObject<HTMLDivElement>) => {
      if (ref.current) {
        ref.current.scrollTop = ref.current.scrollHeight;
      }
    };

    scrollToBottom(environmentRef);
    scrollToBottom(thoughtStreamRef);
  }, [state.logs]); // Scroll when logs update

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
      console.log("Received message:", message);

      setState((prev) => {
        switch (message.type) {
          case "SYSTEM_STATE":
            console.log("System state agents:", message.data.agents);
            return {
              ...prev,
              isRunning: message.data.isRunning,
              agents: message.data.agents || prev.agents,
            };
          case "LOG":
          case "AGENT_ACTION":
          case "AGENT_STATE":
            console.log(`${message.type} message:`, {
              agentName: message.data.agentName,
              agentId: message.data.agentId,
              data: message.data,
            });
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
    <div className="min-h-screen bg-[#0B1221] text-gray-100 relative overflow-hidden font-mono flex flex-col">
      {/* Header Bar */}
      <div className="border-b border-cyan-900/30 px-2">
        <div className="flex justify-between items-center h-10">
          <div className="text-cyan-400">
            <span className="text-emerald-400">»</span> ArgOS v1.0{" "}
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                isConnected ? "bg-emerald-400 animate-pulse-slow" : "bg-red-500"
              }`}
            />
          </div>
          <div className="space-x-1">
            <button
              onClick={() => sendCommand(state.isRunning ? "PAUSE" : "START")}
              disabled={!isConnected}
              className={`px-3 py-0.5 rounded font-mono text-sm ${
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
              className={`px-3 py-0.5 rounded font-mono text-sm ${
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
              className={`px-3 py-0.5 rounded font-mono text-sm ${
                !isConnected
                  ? "bg-gray-800 text-gray-600"
                  : "bg-black/30 text-orange-400 border border-orange-900/50"
              }`}
            >
              ⟲ RESET
            </button>
            <button
              onClick={() => setState((prev) => ({ ...prev, logs: [] }))}
              className="px-3 py-0.5 rounded font-mono text-sm bg-black/30 text-cyan-400 border border-cyan-900/50"
            >
              ⌫ CLEAR
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <PanelGroup direction="vertical" className="flex-1">
        <Panel defaultSize={80} minSize={50}>
          <PanelGroup direction="horizontal" className="h-full">
            {/* Left Column - Agents */}
            <Panel defaultSize={25} minSize={20}>
              <div className="h-full flex flex-col">
                <div className="px-2 h-8 flex items-center border-b border-cyan-900/30">
                  <h2 className="text-emerald-400">
                    <span className="text-gray-500">01:</span> AGENTS
                  </h2>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <div className="p-2 space-y-2">
                    {state.agents.map((agent, i) => (
                      <div
                        key={i}
                        className="border border-cyan-900/30 rounded bg-black/20 p-2"
                      >
                        <div className="flex justify-between items-start mb-1">
                          <h3 className="text-cyan-400">{agent.name}</h3>
                          <div className="flex items-center gap-1">
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
                        <div className="text-emerald-400/80 text-xs mb-2">
                          {agent.appearance}
                        </div>

                        {/* Current Thought */}
                        {agent.lastThought && (
                          <div className="border-t border-cyan-900/30 pt-1 mt-1 text-gray-400 text-xs">
                            <span className="text-purple-400">
                              » Current Thought:{" "}
                            </span>
                            {agent.lastThought}
                          </div>
                        )}

                        {/* Recent Experiences */}
                        {agent.experiences && agent.experiences.length > 0 && (
                          <div className="border-t border-cyan-900/30 pt-1 mt-1">
                            <span className="text-purple-400 text-xs">
                              » Recent:
                            </span>
                            <div className="text-gray-400 text-xs mt-0.5">
                              {agent.experiences.slice(-2).map(
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
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Panel>

            <ResizeHandle className="w-1 hover:w-1.5 bg-cyan-900/30 cursor-col-resize" />

            {/* Middle Column - Environment */}
            <Panel defaultSize={45} minSize={30}>
              <div className="h-full flex flex-col">
                <div className="px-2 h-8 flex items-center border-b border-cyan-900/30">
                  <h2 className="text-emerald-400">
                    <span className="text-gray-500">02:</span> ENVIRONMENT
                  </h2>
                </div>
                <div className="flex-1 overflow-y-auto" ref={environmentRef}>
                  <div className="p-2">
                    <h3 className="text-cyan-400 mb-1">
                      {state.agents[0]?.room?.name || "Unknown Location"}
                    </h3>
                    <p className="text-emerald-400/80 text-sm mb-2">
                      {state.agents[0]?.room?.description ||
                        "No description available"}
                    </p>
                    <div className="space-y-0.5">
                      {/* Debug logs outside JSX */}
                      {(() => {
                        console.log("All logs:", state.logs);
                        return null;
                      })()}
                      {state.logs
                        .filter((log) => {
                          console.log("Checking log:", log);
                          // Show only speech actions
                          if (log.type === "AGENT_ACTION") {
                            console.log(
                              "Action type:",
                              log.data.actionType,
                              "Tool:",
                              log.data.tool
                            );
                            return log.data.tool === "speak";
                          }
                          // Show appearance changes
                          if (
                            log.type === "AGENT_STATE" &&
                            log.data.appearance
                          ) {
                            return true;
                          }
                          return false;
                        })
                        .map((log, i) => {
                          console.log("Rendering log:", log);
                          const agentName = log.data.agentName;
                          const agentColor = agentName
                            ? getTailwindColor(agentName)
                            : "text-gray-400";
                          console.log(
                            `Environment - Color for ${agentName}:`,
                            agentColor
                          );

                          if (log.data.appearance) {
                            const appearance = log.data.appearance;
                            return (
                              <div key={i} className="font-mono text-sm italic">
                                <span className="text-gray-500">
                                  {new Date(log.timestamp).toLocaleTimeString()}{" "}
                                  »
                                </span>{" "}
                                {agentName && (
                                  <span className={agentColor}>
                                    [{agentName}]{" "}
                                  </span>
                                )}
                                <span className={agentColor}>
                                  {appearance.facialExpression &&
                                    `${appearance.facialExpression}; `}
                                  {appearance.bodyLanguage &&
                                    `${appearance.bodyLanguage}; `}
                                  {appearance.currentAction &&
                                    `${appearance.currentAction}; `}
                                  {appearance.socialCues &&
                                    appearance.socialCues}
                                </span>
                              </div>
                            );
                          }

                          return (
                            <div key={i} className="font-mono text-sm">
                              <span className="text-gray-500">
                                {new Date(log.timestamp).toLocaleTimeString()} »
                              </span>{" "}
                              {agentName && (
                                <span className={agentColor}>
                                  [{agentName}]{" "}
                                </span>
                              )}
                              <span className={agentColor}>
                                Says: {log.data.message}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>
              </div>
            </Panel>

            <ResizeHandle className="w-1 hover:w-1.5 bg-cyan-900/30 cursor-col-resize" />

            {/* Right Column - Thought Stream */}
            <Panel defaultSize={30} minSize={20}>
              <div className="h-full flex flex-col">
                <div className="px-2 h-8 flex items-center border-b border-cyan-900/30">
                  <h2 className="text-emerald-400">
                    <span className="text-gray-500">03:</span> THOUGHT STREAM
                  </h2>
                </div>
                <div className="flex-1 overflow-y-auto" ref={thoughtStreamRef}>
                  <div className="p-2 space-y-0.5">
                    {/* Thought Stream Content */}
                    <div className="p-2 space-y-0.5">
                      {state.logs
                        .filter(
                          (log) =>
                            log.type === "AGENT_STATE" &&
                            (log.data.thought || log.data.perception)
                        )
                        .map((log, i) => {
                          const agentName = log.data.agentName;
                          const agentColor = agentName
                            ? getTailwindColor(agentName)
                            : "text-gray-400";
                          console.log(
                            `Thought Stream - Color for ${agentName}:`,
                            agentColor
                          );

                          let content = "";
                          try {
                            if (typeof log.data.thought === "string") {
                              content = log.data.thought;
                            } else if (typeof log.data.thought === "object") {
                              if (log.data.thought.data?.thought) {
                                content = log.data.thought.data.thought;
                              } else if (log.data.thought.thought) {
                                content = log.data.thought.thought;
                              } else {
                                const parsed = JSON.parse(log.data.thought);
                                content =
                                  parsed.data?.thought ||
                                  parsed.thought ||
                                  JSON.stringify(log.data.thought);
                              }
                            }
                          } catch (e) {
                            content = log.data.thought;
                          }

                          return (
                            <div key={i} className="font-mono text-sm">
                              <span className="text-gray-500">
                                {new Date(log.timestamp).toLocaleTimeString()} »
                              </span>{" "}
                              {agentName && (
                                <span className={agentColor}>
                                  [{agentName}]{" "}
                                </span>
                              )}
                              <span className={agentColor}>{content}</span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>
              </div>
            </Panel>
          </PanelGroup>
        </Panel>

        <ResizeHandle className="h-1 hover:h-1.5 bg-cyan-900/30 cursor-row-resize" />

        {/* System Logs Panel */}
        <Panel defaultSize={20} minSize={10}>
          <div className="h-full flex flex-col border-t border-cyan-900/30">
            <div className="px-2 h-8 flex items-center border-b border-cyan-900/30">
              <span className="text-orange-400">SYS:</span>
              <span className="text-gray-500 ml-2">SYSTEM LOGS</span>
            </div>
            <div className="p-2 flex-1 overflow-auto space-y-0.5">
              {state.logs
                .filter(
                  (log) =>
                    log.type === "SYSTEM_STATE" || log.category === "system"
                )
                .map((log, i) => (
                  <div key={i} className="text-orange-400/70 text-sm">
                    <span className="text-gray-500">
                      {new Date(log.timestamp).toLocaleTimeString()} »
                    </span>{" "}
                    {log.data.message}
                  </div>
                ))}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
