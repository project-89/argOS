import * as React from "react";
import ForceGraph2D, { ForceGraphMethods } from "react-force-graph-2d";
import { AgentState, RoomState, NetworkLink } from "../../../types";

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
  agents: AgentState[];
  rooms: RoomState[];
  relationships: NetworkLink[];
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
  const graphRef = React.useRef<ForceGraphMethods<Node, Link> | undefined>();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = React.useState({ width: 0, height: 0 });
  const [graphData, setGraphData] = React.useState<GraphData>({
    nodes: [],
    links: [],
  });

  // Add refs to store stable data references
  const nodesRef = React.useRef<Node[]>([]);
  const linksRef = React.useRef<Link[]>([]);

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

  // Initialize graph data once
  React.useEffect(() => {
    if (!graphRef.current) return;

    // Initialize nodes
    nodesRef.current = [
      // Room nodes
      ...rooms.map((room) => ({
        id: `room-${room.id}`,
        name: room.name || "Unknown Room",
        type: "room" as const,
        color: "#22d3ee",
        val: 3,
      })),
      // Agent nodes
      ...agents.map((agent) => ({
        id: `agent-${agent.id}`,
        name: agent.name || "Unknown Agent",
        type: "agent" as const,
        color: "#f472b6",
        val: 2,
      })),
    ];

    // Initialize links
    linksRef.current = relationships.reduce<Link[]>((acc, rel) => {
      const sourceAgent = agents.find((a) => a.id === rel.source);
      const targetRoom = rooms.find((r) => r.id === rel.target);
      const targetAgent = agents.find((a) => a.id === rel.target);

      if (sourceAgent) {
        let targetId;
        if (targetRoom) {
          targetId = `room-${targetRoom.id}`;
        } else if (targetAgent) {
          targetId = `agent-${targetAgent.id}`;
        }

        if (targetId) {
          acc.push({
            source: `agent-${sourceAgent.id}`,
            target: targetId,
            type: rel.type as "presence" | "occupies",
            value: rel.value,
          });
        }
      }
      return acc;
    }, []);

    // Update graph data through state
    setGraphData({
      nodes: nodesRef.current,
      links: linksRef.current,
    });

    // Optionally reheat simulation
    graphRef.current?.d3ReheatSimulation();
  }, []);

  // Update graph data incrementally
  React.useEffect(() => {
    if (!graphRef.current) return;

    // Update nodes in-place
    const currentNodeIds = new Set(nodesRef.current.map((n) => n.id));

    // Remove nodes that no longer exist
    nodesRef.current = nodesRef.current.filter((node) => {
      if (node.type === "room") {
        return rooms.some((r) => `room-${r.id}` === node.id);
      } else {
        const exists = agents.some((a) => `agent-${a.id}` === node.id);
        // If node is being removed, trigger a reheat to adjust layout
        if (!exists && currentNodeIds.has(node.id)) {
          graphRef.current?.d3ReheatSimulation();
        }
        return exists;
      }
    });

    // Add new nodes
    rooms.forEach((room) => {
      const nodeId = `room-${room.id}`;
      if (!currentNodeIds.has(nodeId)) {
        nodesRef.current.push({
          id: nodeId,
          name: room.name || "Unknown Room",
          type: "room",
          color: "#22d3ee",
          val: 3,
        });
      }
    });

    agents.forEach((agent) => {
      const nodeId = `agent-${agent.id}`;
      if (!currentNodeIds.has(nodeId)) {
        nodesRef.current.push({
          id: nodeId,
          name: agent.name || "Unknown Agent",
          type: "agent",
          color: "#f472b6",
          val: 2,
        });
      }
    });

    // Update links in-place
    linksRef.current = relationships.reduce<Link[]>((acc, rel) => {
      const sourceAgent = agents.find((a) => a.id === rel.source);
      const targetRoom = rooms.find((r) => r.id === rel.target);
      const targetAgent = agents.find((a) => a.id === rel.target);

      if (sourceAgent) {
        let targetId;
        if (targetRoom) {
          targetId = `room-${targetRoom.id}`;
        } else if (targetAgent) {
          targetId = `agent-${targetAgent.id}`;
        }

        if (targetId) {
          acc.push({
            source: `agent-${sourceAgent.id}`,
            target: targetId,
            type: rel.type as "presence" | "occupies",
            value: rel.value,
          });
        }
      }
      return acc;
    }, []);

    // Update graph data through state
    setGraphData({
      nodes: nodesRef.current,
      links: linksRef.current,
    });

    // Optionally reheat simulation
    graphRef.current?.d3ReheatSimulation();
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
                (node.type === "agent" &&
                  node.id === `agent-${selectedAgent}`) ||
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
                onNodeSelect("agent", node.id.replace("agent-", ""));
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
