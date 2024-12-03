import * as React from "react";
import { useState, useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { CommandBar } from "./components/CommandBar";
import { AgentNetwork } from "./components/AgentNetwork";
import { ChatInterface } from "./components/ChatInterface";
import { Inspector } from "./components/Inspector";
import { Timeline } from "./components/Timeline";
import { SimulationEvent, WorldState } from "../../types";
import { useSimulationStore } from "../../state/simulation";
import { setupSingleAgent } from "../../examples/single-agent-setup";
import "./styles/panels.css";

interface RoomSubscription {
  unsubscribe: () => void;
  agentUnsubscribes: Map<number, () => void>;
}

export function ModernUI() {
  const [isConnected, setIsConnected] = useState(false);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const {
    agents,
    rooms,
    selectedAgent,
    selectedRoom,
    setAgents,
    setRooms,
    setIsRunning,
  } = useSimulationStore();

  // Initialize runtime and WebSocket
  useEffect(() => {
    const { runtime } = setupSingleAgent();
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
      const message = JSON.parse(event.data);
      if (message.type === "WORLD_STATE") {
        const worldState = message.data as WorldState;
        setAgents(worldState.agents);
        setRooms(worldState.rooms);
      }
    };

    setWs(socket);

    return () => {
      socket.close();
    };
  }, []);

  // Handle room subscriptions
  useEffect(() => {
    if (!selectedRoom) return;

    const { runtime } = setupSingleAgent();
    const agentUnsubscribes = new Map<number, () => void>();

    // Subscribe to room
    const unsubRoom = runtime.subscribeToRoom(selectedRoom, (event) => {
      console.log("Room event:", event);

      // Handle room state updates
      if (event.type === "ROOM_STATE") {
        // Subscribe to all agents in room
        event.data.occupants.forEach((agentId: number) => {
          if (!agentUnsubscribes.has(agentId)) {
            const unsubAgent = runtime.subscribeToAgent(
              agentId,
              (agentEvent) => {
                console.log("Agent event:", agentEvent);
              }
            );
            agentUnsubscribes.set(agentId, unsubAgent);
          }
        });
      }
    });

    return () => {
      unsubRoom();
      agentUnsubscribes.forEach((unsub) => unsub());
    };
  }, [selectedRoom]);

  // Handle agent subscriptions
  useEffect(() => {
    if (!selectedAgent) return;

    const { runtime } = setupSingleAgent();
    const unsubAgent = runtime.subscribeToAgent(
      Number(selectedAgent),
      (event) => {
        console.log("Agent event:", event);
      }
    );

    return () => {
      unsubAgent();
    };
  }, [selectedAgent]);

  const sendCommand = (type: string) => {
    if (ws && isConnected) {
      ws.send(JSON.stringify({ type }));
    }
  };

  return (
    <div className="h-screen flex flex-col">
      <CommandBar
        isRunning={false}
        isConnected={isConnected}
        onCommand={sendCommand}
      />

      <PanelGroup direction="vertical" className="flex-1">
        <Panel defaultSize={85} minSize={50}>
          <PanelGroup direction="horizontal">
            <Panel defaultSize={25} minSize={20}>
              <AgentNetwork
                agents={agents}
                rooms={rooms}
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
                onSendMessage={() => {}}
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

        <PanelResizeHandle className="h-1 bg-cyan-900/30 hover:bg-cyan-500/50 transition-colors" />

        <Panel defaultSize={15} minSize={10}>
          <Timeline logs={[]} isRunning={false} />
        </Panel>
      </PanelGroup>
    </div>
  );
}
