import * as React from "react";
import ForceGraph2D from "react-force-graph-2d";
import { getTailwindColor } from "../../../utils/colors";

interface Node {
  id: string;
  name: string;
  type: "room" | "agent";
  color?: string;
  val?: number;
}

interface Link {
  source: string;
  target: string;
  type: "presence";
  value: number;
}

interface GraphData {
  nodes: Node[];
  links: Link[];
}

interface AgentNetworkProps {
  agents: any[];
  rooms: any[];
  selectedAgent: string | null;
  onSelectAgent: (agentId: string | null) => void;
}

export function AgentNetwork({
  agents,
  rooms,
  selectedAgent,
  onSelectAgent,
}: AgentNetworkProps) {
  const graphRef = React.useRef<any>();

  // Convert agents and rooms to graph data
  const graphData = React.useMemo(() => {
    const data: GraphData = {
      nodes: [],
      links: [],
    };

    console.log("Rooms:", rooms);
    console.log("Agents:", agents);

    // Add room nodes first
    rooms.forEach((room) => {
      data.nodes.push({
        id: `room-${room.id}`,
        name: room.name,
        type: "room",
        color: "#0ea5e9", // cyan-500
        val: 2,
      });
    });

    // Add agent nodes and their connections
    agents.forEach((agent) => {
      console.log("Processing agent:", agent);
      data.nodes.push({
        id: `agent-${agent.name}`,
        name: agent.name,
        type: "agent",
        color: getTailwindColor(agent.name),
        val: 1,
      });

      // Connect to room if present
      if (agent.room?.id) {
        console.log(`Connecting agent ${agent.name} to room ${agent.room.id}`);
        data.links.push({
          source: `agent-${agent.name}`,
          target: `room-${agent.room.id}`,
          type: "presence",
          value: agent.attention || 1,
        });
      } else {
        console.log(`Agent ${agent.name} has no room assigned`);
      }
    });

    console.log("Graph data:", data);
    return data;
  }, [agents, rooms]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-2 h-8 flex items-center border-b border-cyan-900/30">
        <h2 className="text-emerald-400">
          <span className="text-gray-500">NET:</span> AGENT NETWORK
        </h2>
      </div>
      <div className="flex-1 relative">
        <ForceGraph2D
          ref={graphRef}
          graphData={graphData}
          nodeLabel="name"
          nodeColor={(node: any) => node.color}
          nodeVal={(node: any) => node.val}
          linkColor={() => "#1e293b"}
          linkWidth={(link: any) => link.value}
          backgroundColor="transparent"
          width={400}
          height={600}
          onNodeClick={(node: any) => {
            if (node.type === "agent") {
              onSelectAgent(node.name);
            }
          }}
          cooldownTicks={50}
          linkDirectionalParticles={2}
          linkDirectionalParticleWidth={2}
          linkDirectionalParticleSpeed={0.005}
        />
      </div>
    </div>
  );
}
