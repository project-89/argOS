import * as React from "react";
import { useState, useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { CommandBar } from "./components/CommandBar";
import { AgentNetwork } from "./components/AgentNetwork";
import { ChatInterface } from "./components/ChatInterface";
import { Inspector } from "./components/Inspector";
import { Timeline } from "./components/Timeline";
import { SimulationEvent } from "../../types";
import "./styles/panels.css";

interface SimulationState {
  isRunning: boolean;
  agents: any[];
  rooms: any[];
  logs: SimulationEvent[];
}

export function ModernUI() {
  const [state, setState] = useState<SimulationState>({
    isRunning: false,
    agents: [],
    rooms: [],
    logs: [],
  });
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);

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
              rooms: message.data.rooms || prev.rooms,
            };
          case "LOG":
          case "AGENT_ACTION":
          case "AGENT_STATE":
            // Add timestamp if not present
            const eventWithTimestamp = {
              ...message,
              timestamp: message.timestamp || Date.now(),
            };
            return {
              ...prev,
              logs: [...prev.logs, eventWithTimestamp].slice(-100),
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

  const handleChatMessage = (message: string) => {
    if (ws && isConnected) {
      ws.send(
        JSON.stringify({
          type: "CHAT",
          data: {
            message,
            target: selectedAgent,
            roomId: selectedRoom,
          },
        })
      );
    }
  };

  const handleNodeSelect = (nodeType: "agent" | "room", id: string) => {
    if (nodeType === "agent") {
      setSelectedAgent(id);
      setSelectedRoom(null);
    } else {
      setSelectedRoom(id);
      setSelectedAgent(null);
    }
  };

  // Filter logs based on selection
  const filteredLogs = state.logs.filter((log) => {
    if (selectedAgent) {
      return (
        log.agentName === selectedAgent || log.data.agentId === selectedAgent
      );
    }
    if (selectedRoom) {
      return log.data.roomId === selectedRoom;
    }
    return true;
  });

  return (
    <div className="h-screen flex flex-col">
      <CommandBar
        isRunning={state.isRunning}
        isConnected={isConnected}
        onCommand={sendCommand}
      />

      <PanelGroup direction="vertical" className="flex-1">
        <Panel defaultSize={85} minSize={50}>
          <PanelGroup direction="horizontal">
            <Panel defaultSize={25} minSize={20}>
              <AgentNetwork
                agents={state.agents}
                rooms={state.rooms}
                selectedAgent={selectedAgent}
                selectedRoom={selectedRoom}
                onNodeSelect={handleNodeSelect}
              />
            </Panel>

            <PanelResizeHandle className="w-1 bg-cyan-900/30 hover:bg-cyan-500/50 transition-colors" />

            <Panel defaultSize={50} minSize={30}>
              <ChatInterface
                selectedAgent={selectedAgent}
                selectedRoom={selectedRoom}
                agents={state.agents}
                rooms={state.rooms}
                logs={filteredLogs}
                onSendMessage={handleChatMessage}
              />
            </Panel>

            <PanelResizeHandle className="w-1 bg-cyan-900/30 hover:bg-cyan-500/50 transition-colors" />

            <Panel defaultSize={25} minSize={20}>
              <Inspector
                selectedAgent={selectedAgent}
                selectedRoom={selectedRoom}
                agents={state.agents}
                rooms={state.rooms}
                logs={filteredLogs}
              />
            </Panel>
          </PanelGroup>
        </Panel>

        <PanelResizeHandle className="h-1 bg-cyan-900/30 hover:bg-cyan-500/50 transition-colors" />

        <Panel defaultSize={15} minSize={10}>
          <Timeline logs={filteredLogs} isRunning={state.isRunning} />
        </Panel>
      </PanelGroup>
    </div>
  );
}
