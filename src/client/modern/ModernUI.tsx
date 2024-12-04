import * as React from "react";
import { useState, useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { CommandBar } from "./components/CommandBar";
import { AgentNetwork } from "./components/AgentNetwork";
import { ChatInterface } from "./components/ChatInterface";
import { Inspector } from "./components/Inspector";
import { Timeline } from "./components/Timeline";
import { WorldState } from "../../types";
import { useSimulationStore } from "../../state/simulation";
import { WebSocketService } from "../services/websocket";
import "./styles/panels.css";

export function ModernUI() {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = React.useRef<WebSocketService>();
  const {
    agents,
    rooms,
    selectedAgent,
    selectedRoom,
    setAgents,
    setRooms,
    setIsRunning,
  } = useSimulationStore();

  // Initialize WebSocket service
  useEffect(() => {
    const ws = new WebSocketService(`ws://${window.location.hostname}:3000/ws`);
    wsRef.current = ws;

    const unsubscribe = ws.subscribe((message) => {
      if (message.type === "CONNECTION_STATE") {
        setIsConnected(message.connected);
      } else if (message.type === "WORLD_STATE") {
        const worldState = message.data as WorldState;
        setAgents(worldState.agents);
        setRooms(worldState.rooms);
      }
    });

    ws.connect();

    return () => {
      unsubscribe();
      ws.disconnect();
    };
  }, []);

  // Handle room subscriptions
  useEffect(() => {
    if (!selectedRoom || !wsRef.current) return;

    wsRef.current.subscribeToRoom(selectedRoom);
    return () => {
      wsRef.current?.unsubscribeFromRoom(selectedRoom);
    };
  }, [selectedRoom]);

  // Handle agent subscriptions
  useEffect(() => {
    if (!selectedAgent || !wsRef.current) return;

    wsRef.current.subscribeToAgent(selectedAgent);
    return () => {
      wsRef.current?.unsubscribeFromAgent(selectedAgent);
    };
  }, [selectedAgent]);

  const sendCommand = (type: string) => {
    if (wsRef.current && isConnected) {
      switch (type) {
        case "START":
          wsRef.current.startSimulation();
          break;
        case "STOP":
          wsRef.current.stopSimulation();
          break;
        case "RESET":
          wsRef.current.resetSimulation();
          break;
      }
    }
  };

  return (
    <div className="h-screen flex flex-col">
      <CommandBar
        isRunning={false}
        isConnected={isConnected}
        onCommand={sendCommand}
        agents={agents}
      />

      <PanelGroup direction="vertical" className="flex-1">
        <Panel defaultSize={85} minSize={50}>
          <PanelGroup direction="horizontal">
            <Panel defaultSize={25} minSize={20}>
              <AgentNetwork
                agents={agents}
                rooms={rooms}
                relationships={useSimulationStore.getState().relationships}
                selectedAgent={selectedAgent}
                selectedRoom={selectedRoom}
                onNodeSelect={(nodeType, id) => {
                  if (nodeType === "agent") {
                    useSimulationStore.getState().setSelectedAgent(id);
                  } else {
                    useSimulationStore.getState().setSelectedRoom(id);
                  }
                }}
              />
            </Panel>

            <PanelResizeHandle className="w-1 bg-cyan-900/30 hover:bg-cyan-500/50 transition-colors" />

            <Panel defaultSize={50} minSize={30}>
              <ChatInterface
                selectedAgent={selectedAgent}
                selectedRoom={selectedRoom}
                agents={agents}
                rooms={rooms}
                logs={[]}
                onSendMessage={(message) => wsRef.current?.sendChat(message)}
              />
            </Panel>

            <PanelResizeHandle className="w-1 bg-cyan-900/30 hover:bg-cyan-500/50 transition-colors" />

            <Panel defaultSize={25} minSize={20}>
              <Inspector
                selectedAgent={selectedAgent}
                selectedRoom={selectedRoom}
                agents={agents}
                rooms={rooms}
                logs={[]}
              />
            </Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>
    </div>
  );
}
