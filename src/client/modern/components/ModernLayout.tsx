import * as React from "react";
import { AgentNetwork } from "./AgentNetwork";
import { AgentInspector } from "./AgentInspector";
import { AgentTimeline } from "./AgentTimeline";
import { AgentChat } from "./AgentChat";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useSimulationStore } from "../../../state/simulation";

export function ModernLayout() {
  const { agents, rooms, selectedAgent, setSelectedAgent } =
    useSimulationStore();

  return (
    <div className="h-full flex flex-col bg-gray-900 text-gray-300">
      <div className="flex-1 flex">
        <PanelGroup direction="horizontal">
          <Panel defaultSize={25} minSize={20}>
            <AgentNetwork
              agents={agents}
              rooms={rooms}
              selectedAgent={selectedAgent}
              onSelectAgent={setSelectedAgent}
            />
          </Panel>

          <PanelResizeHandle className="w-1 bg-cyan-900/30 hover:bg-cyan-500/50 transition-colors" />

          <Panel defaultSize={50} minSize={30}>
            <AgentChat selectedAgent={selectedAgent} />
          </Panel>

          <PanelResizeHandle className="w-1 bg-cyan-900/30 hover:bg-cyan-500/50 transition-colors" />

          <Panel defaultSize={25} minSize={20}>
            <AgentInspector selectedAgent={selectedAgent} />
          </Panel>
        </PanelGroup>
      </div>

      <PanelGroup direction="vertical">
        <Panel>
          <div className="h-48 border-t border-cyan-900/30">
            <AgentTimeline />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
