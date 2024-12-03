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
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = React.useState({ width: 0, height: 0 });

  // Update dimensions when container size changes
  React.useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };

    // Initial size
    updateDimensions();

    // Add resize listener
    const observer = new ResizeObserver(updateDimensions);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Convert agents and rooms to graph data
  const graphData = React.useMemo(() => {
    const data: GraphData = {
      nodes: [],
      links: [],
    };

    // Add room nodes first
    rooms.forEach((room) => {
      data.nodes.push({
        id: `room-${room.id}`,
        name: room.name,
        type: "room",
        color: "#22d3ee", // cyan-400 - brighter for rooms
        val: 3, // Larger size for rooms
      });
    });

    // Add agent nodes and their connections
    agents.forEach((agent) => {
      data.nodes.push({
        id: `agent-${agent.name}`,
        name: agent.name,
        type: "agent",
        color: "#f472b6", // pink-400 - agents stand out
        val: 2,
      });

      // Connect to room if present
      if (agent.room?.id) {
        data.links.push({
          source: `agent-${agent.name}`,
          target: `room-${agent.room.id}`,
          type: "presence",
          value: agent.attention || 1,
        });
      }
    });

    return data;
  }, [agents, rooms]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-2 h-8 flex items-center border-b border-cyan-900/30">
        <h2 className="text-emerald-400">
          <span className="text-gray-500">NET:</span> AGENT NETWORK
        </h2>
      </div>
      <div ref={containerRef} className="flex-1 relative">
        {dimensions.width > 0 && dimensions.height > 0 && (
          <ForceGraph2D
            ref={graphRef}
            graphData={graphData}
            width={dimensions.width}
            height={dimensions.height}
            nodeCanvasObject={(node: any, ctx: any, globalScale: number) => {
              // Draw node circle
              const label = node.name;
              const fontSize = 12 / globalScale;
              ctx.font = `${fontSize}px Inter`;
              const textWidth = ctx.measureText(label).width;
              const nodeR = Math.sqrt(node.val) * 5;

              ctx.beginPath();
              ctx.arc(node.x, node.y, nodeR, 0, 2 * Math.PI);
              ctx.fillStyle = node.color;
              ctx.fill();

              // Draw label with background
              ctx.fillStyle = "rgba(0,0,0,0.8)";
              ctx.fillRect(
                node.x + nodeR + 2,
                node.y - fontSize / 2,
                textWidth + 4,
                fontSize + 2
              );

              ctx.textAlign = "left";
              ctx.textBaseline = "middle";
              ctx.fillStyle = node.type === "room" ? "#22d3ee" : "#f472b6";
              ctx.fillText(label, node.x + nodeR + 4, node.y);
            }}
            nodeLabel=""
            linkColor={() => "#1e293b"}
            linkWidth={(link: any) => link.value * 2}
            backgroundColor="transparent"
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
        )}
      </div>
    </div>
  );
}
