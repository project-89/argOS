import * as React from "react";
import { useState, useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { CommandBar } from "./components/CommandBar";
import { AgentNetwork } from "./components/AgentNetwork";
import { ChatInterface } from "./components/ChatInterface";
import { Inspector } from "./components/Inspector";
import { Timeline } from "./components/Timeline";
import {
  AgentState,
  AgentUpdateMessage,
  WorldState,
  RoomState,
} from "../../types";
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
    isRunning,
    setRelationships,
    logs,
  } = useSimulationStore();

  // Initialize WebSocket service
  useEffect(() => {
    const ws = new WebSocketService(`ws://${window.location.hostname}:3000/ws`);
    wsRef.current = ws;

    const unsubscribe = ws.subscribe((message) => {
      if (message.type === "CONNECTION_UPDATE") {
        setIsConnected(message.connected);
      } else if (message.type === "WORLD_UPDATE") {
        const worldState = message.data;
        setAgents(worldState.agents);
        setRooms(worldState.rooms);
        setRelationships(worldState.relationships);
        setIsRunning(worldState.isRunning);
      } else if (message.type === "AGENT_UPDATE") {
        // Add to logs for all agent updates
        useSimulationStore.getState().addLog(message);

        // Special handling for appearance updates
        if (message.data.category === "appearance") {
          setAgents((prev: AgentState[]) =>
            prev.map((agent) => {
              if (agent.id === message.data.agentId) {
                const newState = {
                  ...agent,
                  lastUpdate: Date.now(),
                };

                if (
                  message.data.type === "state" &&
                  typeof message.data.content === "object" &&
                  message.data.content?.agent
                ) {
                  const agentUpdate = message.data.content.agent;
                  Object.assign(newState, {
                    facialExpression: agentUpdate.facialExpression,
                    bodyLanguage: agentUpdate.bodyLanguage,
                    currentAction: agentUpdate.currentAction,
                    socialCues: agentUpdate.socialCues,
                  });
                }

                return newState;
              }
              return agent;
            })
          );
        }
      } else if (message.type === "ROOM_UPDATE") {
        // Add to logs for all room updates
        useSimulationStore.getState().addLog(message);
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

    // Subscribe to agents in the room
    const roomAgents = agents.filter((a) => a.roomId === selectedRoom);
    roomAgents.forEach((agent) => {
      wsRef.current?.subscribeToRoomAgent(agent.id, selectedRoom);
    });

    return () => {
      wsRef.current?.unsubscribeFromRoom(selectedRoom);
    };
  }, [selectedRoom]);

  // Handle agent subscriptions
  useEffect(() => {
    if (!selectedAgent || !wsRef.current) return;
    const selectedRoom = useSimulationStore.getState().selectedRoom;
    wsRef.current.subscribeToAgent(selectedAgent, selectedRoom || "main");
    return () => {
      wsRef.current?.unsubscribeFromAgent(selectedAgent);
    };
  }, [selectedAgent]);

  const sendCommand = (type: string) => {
    if (wsRef.current && isConnected) {
      switch (type) {
        case "START":
          wsRef.current.startSimulation();
          setIsRunning(true);
          break;
        case "STOP":
          wsRef.current.stopSimulation();
          setIsRunning(false);
          break;
        case "RESET":
          wsRef.current.resetSimulation();
          setIsRunning(false);
          break;
      }
    }
  };

  return (
    <div className="h-screen flex flex-col">
      <CommandBar
        isRunning={isRunning}
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
                relationships={
                  useSimulationStore.getState().relationships || []
                }
                selectedAgent={selectedAgent}
                selectedRoom={selectedRoom}
                onNodeSelect={(nodeType, id) => {
                  if (nodeType === "agent") {
                    useSimulationStore.getState().setSelectedAgent(id);
                    useSimulationStore.getState().setSelectedRoom(null);
                  } else {
                    useSimulationStore.getState().setSelectedRoom(id);
                    useSimulationStore.getState().setSelectedAgent(null);
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
                logs={logs}
                onSendMessage={(message, room) =>
                  wsRef.current?.sendChat(message, room)
                }
              />
            </Panel>

            <PanelResizeHandle className="w-1 bg-cyan-900/30 hover:bg-cyan-500/50 transition-colors" />

            <Panel defaultSize={25} minSize={20}>
              <Inspector
                selectedAgent={selectedAgent}
                selectedRoom={selectedRoom}
                agents={agents}
                rooms={rooms}
                logs={logs}
              />
            </Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>
    </div>
  );
}
