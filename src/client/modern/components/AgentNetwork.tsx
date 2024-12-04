import * as React from "react";
import ForceGraph2D from "react-force-graph-2d";

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
  type: "presence" | "occupies";
  value: number;
}

interface GraphData {
  nodes: Node[];
  links: Link[];
}

interface AgentNetworkProps {
  agents: any[];
  rooms: any[];
  relationships: Array<{
    source: string;
    target: string;
    type: string;
    value: number;
  }>;
  selectedAgent: string | null;
  selectedRoom: string | null;
  onNodeSelect: (nodeType: "agent" | "room", id: string) => void;
}

export function AgentNetwork({
  agents,
  rooms,
  relationships,
  selectedAgent,
  selectedRoom,
  onNodeSelect,
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
      if (!room?.id) return;
      const nodeId = `room-${room.id}`;
      console.log("Adding room node:", nodeId);
      data.nodes.push({
        id: nodeId,
        name: room.name || "Unknown Room",
        type: "room",
        color: "#22d3ee",
        val: 3,
      });
    });

    // Add agent nodes
    agents.forEach((agent) => {
      if (!agent?.name) return;
      const nodeId = `agent-${agent.name}`;
      data.nodes.push({
        id: nodeId,
        name: agent.name,
        type: "agent",
        color: "#f472b6",
        val: 2,
      });
    });

    // Add relationship links
    relationships?.forEach((rel) => {
      const sourceAgent = agents.find((a) => a.id === rel.source);
      const targetRoom = rooms.find((r) => r.id === rel.target);

      if (sourceAgent && targetRoom) {
        const link = {
          source: `agent-${sourceAgent.name}`,
          target: `room-${targetRoom.id}`,
          type: "presence" as const,
          value: rel.value,
        };
        data.links.push(link);
      }
    });

    console.log("Final graph data:", data);
    return data;
  }, [agents, rooms, relationships]);

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
              if (
                (node.type === "agent" && node.name === selectedAgent) ||
                (node.type === "room" && node.id === `room-${selectedRoom}`)
              ) {
                ctx.strokeStyle = "#fff";
                ctx.lineWidth = 2;
                ctx.stroke();
              }
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
                onNodeSelect("agent", node.name);
              } else if (node.type === "room") {
                onNodeSelect("room", node.id.replace("room-", ""));
              }
            }}
            cooldownTicks={50}
            linkDirectionalParticles={2}
            linkDirectionalParticleWidth={2}
            linkDirectionalParticleSpeed={0.005}
            nodeRelSize={6}
          />
        )}
      </div>
    </div>
  );
}
