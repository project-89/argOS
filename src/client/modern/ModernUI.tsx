import * as React from "react";
import { useState, useEffect } from "react";
import { CommandBar } from "./components/CommandBar";
import { AgentNetwork } from "./components/AgentNetwork";
import { Environment } from "./components/Environment";
import { Inspector } from "./components/Inspector";
import { Timeline } from "./components/Timeline";
import { SimulationEvent } from "../../types";

interface SimulationState {
  isRunning: boolean;
  agents: any[];
  logs: SimulationEvent[];
}

export function ModernUI() {
  const [state, setState] = useState<SimulationState>({
    isRunning: false,
    agents: [],
    logs: [],
  });
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  // WebSocket setup
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
          case "AGENT_ACTION":
          case "AGENT_STATE":
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
    <div className="h-screen flex flex-col">
      {/* Command Bar */}
      <CommandBar
        isRunning={state.isRunning}
        isConnected={isConnected}
        onCommand={sendCommand}
      />

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Agent Network */}
        <div className="w-1/4 border-r border-cyan-900/30">
          <AgentNetwork
            agents={state.agents}
            selectedAgent={selectedAgent}
            onSelectAgent={setSelectedAgent}
          />
        </div>

        {/* Environment */}
        <div className="flex-1 border-r border-cyan-900/30">
          <Environment agents={state.agents} logs={state.logs} />
        </div>

        {/* Inspector */}
        <div className="w-1/4">
          <Inspector
            selectedAgent={selectedAgent}
            agents={state.agents}
            logs={state.logs}
          />
        </div>
      </div>

      {/* Timeline */}
      <div className="h-32 border-t border-cyan-900/30">
        <Timeline logs={state.logs} isRunning={state.isRunning} />
      </div>
    </div>
  );
}
