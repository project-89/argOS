import * as React from "react";
import { AgentNetwork } from "./AgentNetwork";
import { Inspector } from "./Inspector";
import { Timeline } from "./Timeline";
import { ChatInterface } from "./ChatInterface";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useSimulationStore } from "../../../state/simulation";

export function ModernLayout() {
  const {
    agents,
    rooms,
    selectedAgent,
    selectedRoom,
    setSelectedAgent,
    setSelectedRoom,
    relationships,
  } = useSimulationStore();

  return (
    <div className="h-full flex flex-col bg-gray-900 text-gray-300">
      <div className="flex-1 flex">
        <PanelGroup direction="horizontal">
          <Panel defaultSize={25} minSize={20}>
            <AgentNetwork
              agents={agents}
              rooms={rooms}
              relationships={relationships}
              selectedAgent={selectedAgent}
              selectedRoom={selectedRoom}
              onNodeSelect={(nodeType, id) => {
                if (nodeType === "agent") {
                  setSelectedAgent(id);
                  setSelectedRoom(null);
                } else if (nodeType === "room") {
                  setSelectedRoom(id);
                  setSelectedAgent(null);
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
      </div>

      <PanelGroup direction="vertical">
        <Panel>
          <div className="h-48 border-t border-cyan-900/30">
            <Timeline logs={[]} isRunning={false} />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
