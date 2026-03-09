/**
 * Force Graph View - Interactive visualization of the simulation
 *
 * Uses react-force-graph-2d to render:
 * - Rooms as hub nodes
 * - Agents connected to rooms they occupy
 * - Stimulus sources in rooms
 * - God and spirits as special nodes
 *
 * Features:
 * - Click nodes to select and view details in sidebar
 * - Hover for quick tooltip preview
 * - Real-time event streaming for selected entities
 * - Navigate to full detail panels
 */

import { useRef, useCallback, useState, useEffect, useMemo, type ReactNode } from "react";
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from "react-force-graph-2d";
import {
  X,
  ExternalLink,
  Eye,
  Brain,
  MessageCircle,
  Activity,
  MapPin,
  Users,
  Sparkles,
  Radio,
  Clock,
  Ghost,
} from "lucide-react";
import { useSimulationStore } from "../../store/simulation";

// Node types for the graph
type NodeType = "god" | "spirit" | "room" | "agent" | "stimulus" | "entity";

interface GraphNode {
  id: string;
  name: string;
  type: NodeType;
  description?: string;
  room?: string | null;
  // For agents
  mind?: { mode: string; arousal: number; focus: string };
  // For rooms
  occupants?: string[];
  // For spirits
  domain?: string;
  rank?: string;
  // Visual properties
  color: string;
  size: number;
  // Original entity ID for navigation
  entityId?: number;
  // d3 simulation properties (added by force-graph)
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  type: "occupies" | "connected" | "oversees" | "broadcasts" | "serves";
  color: string;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// Color palette matching our theme
const COLORS = {
  god: "#fbbf24", // Gold
  spirit: "#a855f7", // Purple
  room: "#3b82f6", // Blue
  agent: "#22c55e", // Green
  stimulus: "#f97316", // Orange
  entity: "#94a3b8", // Gray
  link: {
    occupies: "rgba(34, 197, 94, 0.3)",
    connected: "rgba(59, 130, 246, 0.5)",
    oversees: "rgba(168, 85, 247, 0.3)",
    broadcasts: "rgba(249, 115, 22, 0.3)",
    serves: "rgba(168, 85, 247, 0.5)",
  },
};

// Force rebuild: v2
export function ForceGraphView() {
  const graphRef = useRef<ForceGraphMethods<NodeObject<GraphNode>> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Stable graph data reference - mutated in place to avoid reinitialization
  const graphDataRef = useRef<GraphData>({ nodes: [], links: [] });
  const [, forceUpdate] = useState(0);

  const {
    agents,
    entities,
    rooms,
    stimulusSources,
    spirits,
    daemons,
    tick,
    tension,
    events,
    godEvents,
    spiritEvents,
    agentEvents,
    roomEvents,
    setActivePanel,
    setSelectedAgent,
    setSelectedEntity,
    setSelectedRoom,
    setSelectedSpirit,
  } = useSimulationStore();

  // Update dimensions on resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  // Update graph data in place to preserve simulation state
  useEffect(() => {
    const data = graphDataRef.current;
    const newNodeIds = new Set<string>();
    const newLinkKeys = new Set<string>();

    // Helper to get link key
    const getLinkKey = (source: string, target: string) => `${source}->${target}`;

    // Helper to update or add node, preserving position
    const upsertNode = (node: Omit<GraphNode, "x" | "y" | "vx" | "vy">) => {
      newNodeIds.add(node.id);
      const existingIndex = data.nodes.findIndex((n) => n.id === node.id);
      if (existingIndex >= 0) {
        // Update existing node, preserve position
        const existing = data.nodes[existingIndex];
        Object.assign(existing, node, {
          x: existing.x,
          y: existing.y,
          vx: existing.vx,
          vy: existing.vy,
        });
      } else {
        // Add new node
        data.nodes.push(node as GraphNode);
      }
    };

    // Helper to add link
    const upsertLink = (source: string, target: string, type: GraphLink["type"], color: string) => {
      const key = getLinkKey(source, target);
      newLinkKeys.add(key);
      const existingIndex = data.links.findIndex((l) => {
        const srcId = typeof l.source === "string" ? l.source : l.source.id;
        const tgtId = typeof l.target === "string" ? l.target : l.target.id;
        return getLinkKey(srcId, tgtId) === key;
      });
      if (existingIndex < 0) {
        data.links.push({ source, target, type, color });
      }
    };

    // Add God node (always present)
    upsertNode({
      id: "god",
      name: "The Architect",
      type: "god",
      description: "The God AI overseeing the simulation",
      color: COLORS.god,
      size: 20,
    });

    // Add spirit nodes (connected to God)
    spirits.forEach((spirit) => {
      const nodeId = `spirit-${spirit.id}`;
      upsertNode({
        id: nodeId,
        name: spirit.name,
        type: "spirit",
        description: spirit.description,
        domain: spirit.domain,
        rank: spirit.rank,
        color: COLORS.spirit,
        size: 12,
        entityId: spirit.id,
      });

      // Connect spirit to God
      upsertLink(nodeId, "god", "serves", COLORS.link.serves);
    });

    // Add room nodes
    rooms.forEach((room) => {
      upsertNode({
        id: `room-${room.id}`,
        name: room.name,
        type: "room",
        description: room.description || room.ambience,
        occupants: room.occupants,
        color: COLORS.room,
        size: 15 + Math.min(room.occupants.length * 2, 10),
        entityId: room.id,
      });

      // Connect God to all rooms (oversees)
      upsertLink("god", `room-${room.id}`, "oversees", COLORS.link.oversees);
    });

    // Add agent nodes
    agents.forEach((agent) => {
      const nodeId = `agent-${agent.id}`;
      upsertNode({
        id: nodeId,
        name: agent.name,
        type: "agent",
        description: agent.description || agent.role,
        room: agent.room,
        mind: agent.mind,
        color: COLORS.agent,
        size: 10,
        entityId: agent.id,
      });

      // Connect agent to their room
      if (agent.room) {
        const roomNode = rooms.find((r) => r.name === agent.room);
        if (roomNode) {
          upsertLink(nodeId, `room-${roomNode.id}`, "occupies", COLORS.link.occupies);
        }
      }
    });

    // Add stimulus source nodes
    stimulusSources.forEach((source) => {
      const nodeId = `stimulus-${source.id}`;
      upsertNode({
        id: nodeId,
        name: source.name,
        type: "stimulus",
        description: source.description || source.type,
        room: source.room,
        color: COLORS.stimulus,
        size: 8,
        entityId: source.id,
      });

      // Connect stimulus to room
      if (source.room) {
        const roomNode = rooms.find((r) => r.name === source.room);
        if (roomNode) {
          upsertLink(nodeId, `room-${roomNode.id}`, "broadcasts", COLORS.link.broadcasts);
        }
      }
    });

    // Add non-agent dynamic entities
    entities.forEach((entity) => {
      const nodeId = `entity-${entity.id}`;
      upsertNode({
        id: nodeId,
        name: entity.name,
        type: "entity",
        description: entity.description || entity.type,
        room: entity.room,
        color: COLORS.entity,
        size: 8,
        entityId: entity.id,
      });

      if (entity.room) {
        const roomNode = rooms.find((r) => r.name === entity.room);
        if (roomNode) {
          upsertLink(nodeId, `room-${roomNode.id}`, "connected", COLORS.link.connected);
        }
      }
    });

    // Remove nodes that no longer exist
    data.nodes = data.nodes.filter((n) => newNodeIds.has(n.id));

    // Remove links that no longer exist or reference removed nodes
    data.links = data.links.filter((l) => {
      const srcId = typeof l.source === "string" ? l.source : l.source.id;
      const tgtId = typeof l.target === "string" ? l.target : l.target.id;
      return newNodeIds.has(srcId) && newNodeIds.has(tgtId) && newLinkKeys.has(getLinkKey(srcId, tgtId));
    });

    // Force component re-render without changing the data reference
    forceUpdate((n) => n + 1);
  }, [agents, entities, rooms, stimulusSources, spirits]);

  // Keep selected node id valid when graph updates.
  useEffect(() => {
    if (!selectedNodeId) return;
    const exists = graphDataRef.current.nodes.some((node) => node.id === selectedNodeId);
    if (!exists) setSelectedNodeId(null);
  }, [selectedNodeId, tick, agents.length, entities.length, rooms.length, spirits.length, stimulusSources.length]);

  const graphData = graphDataRef.current;
  const selectedNode = selectedNodeId
    ? graphData.nodes.find((node) => node.id === selectedNodeId) ?? null
    : null;

  // Handle node click - select node to show in sidebar
  // Using functional update to avoid stale closures (no deps = stable reference)
  const handleNodeClick = useCallback((node: GraphNode) => {
    // Toggle selection if clicking same node, using functional update
    setSelectedNodeId((current) => (current === node.id ? null : node.id));
  }, []);

  // Navigate to full detail panel for selected node
  const navigateToDetail = useCallback(() => {
    if (!selectedNode) return;

    switch (selectedNode.type) {
      case "agent":
        setSelectedAgent(selectedNode.name);
        setActivePanel("agents");
        break;
      case "entity":
        setSelectedEntity(selectedNode.name);
        setActivePanel("entities");
        break;
      case "room":
        setSelectedRoom(selectedNode.name);
        setActivePanel("rooms");
        break;
      case "stimulus":
        setSelectedRoom(selectedNode.room || null);
        setActivePanel("rooms");
        break;
      case "god":
        setActivePanel("logs");
        break;
      case "spirit":
        setSelectedSpirit(selectedNode.name);
        setActivePanel("spirits");
        break;
    }
  }, [selectedNode, setActivePanel, setSelectedAgent, setSelectedEntity, setSelectedRoom, setSelectedSpirit]);

  // Handle background click - deselect node
  const handleBackgroundClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // Handle node hover
  const handleNodeHover = useCallback(
    (node: GraphNode | null, event?: MouseEvent) => {
      setHoveredNode(node);
      if (node && event) {
        setTooltipPos({ x: event.clientX, y: event.clientY });
      }
    },
    []
  );

  // Stable hover handler for ForceGraph (avoids inline function recreations)
  const onNodeHoverHandler = useCallback(
    (node: any, _prevNode: any) => {
      const mouseEvent = window.event as MouseEvent | undefined;
      handleNodeHover(node as GraphNode | null, mouseEvent);
      // Change cursor to indicate clickable
      if (containerRef.current) {
        containerRef.current.style.cursor = node ? "pointer" : "default";
      }
    },
    [handleNodeHover]
  );

  // Custom node rendering
  const nodeCanvasObject = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = (node as any).x as number;
      const y = (node as any).y as number;
      const size = node.size;
      const isHovered = hoveredNode?.id === node.id;
      const isSelected = selectedNode?.id === node.id;

      // Draw selection ring for selected nodes
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(x, y, size + 8, 0, 2 * Math.PI);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        ctx.stroke();

        // Animated pulse effect
        const pulseSize = size + 12 + Math.sin(Date.now() / 200) * 3;
        ctx.beginPath();
        ctx.arc(x, y, pulseSize, 0, 2 * Math.PI);
        ctx.strokeStyle = `${node.color}60`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Draw glow for hovered nodes
      if (isHovered && !isSelected) {
        ctx.beginPath();
        ctx.arc(x, y, size + 4, 0, 2 * Math.PI);
        ctx.fillStyle = `${node.color}40`;
        ctx.fill();
      }

      // Draw node based on type
      ctx.beginPath();

      switch (node.type) {
        case "god":
          // Star shape for god
          drawStar(ctx, x, y, 5, size, size / 2);
          break;
        case "room":
          // Hexagon for rooms
          drawHexagon(ctx, x, y, size);
          break;
        case "agent":
          // Circle for agents
          ctx.arc(x, y, size, 0, 2 * Math.PI);
          break;
        case "stimulus":
          // Diamond for stimulus sources
          drawDiamond(ctx, x, y, size);
          break;
        case "spirit":
          // Triangle for spirits
          drawTriangle(ctx, x, y, size);
          break;
        default:
          ctx.arc(x, y, size, 0, 2 * Math.PI);
      }

      ctx.fillStyle = node.color;
      ctx.fill();

      // Draw border
      ctx.strokeStyle = isHovered ? "#fff" : `${node.color}80`;
      ctx.lineWidth = isHovered ? 2 : 1;
      ctx.stroke();

      // Draw label
      const fontSize = Math.max(10 / globalScale, 3);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = isSelected ? "#fff" : "#ffffffcc";
      ctx.fillText(node.name, x, y + size + 2);
    },
    [hoveredNode, selectedNode]
  );

  // Get filtered events for selected node
  const filteredEvents = useMemo(() => {
    if (!selectedNode) return [];

    switch (selectedNode.type) {
      case "god":
        return godEvents.slice(0, 20);
      case "spirit":
        return spiritEvents
          .filter((e: any) => e.spiritName === selectedNode.name || e.spirit === selectedNode.name)
          .slice(0, 20);
      case "agent":
        return agentEvents
          .filter((e: any) => e.agentName === selectedNode.name || e.agent === selectedNode.name)
          .slice(0, 20);
      case "room":
        return roomEvents
          .filter((e: any) => e.roomName === selectedNode.name || e.room === selectedNode.name)
          .slice(0, 20);
      default:
        return events.slice(0, 20);
    }
  }, [selectedNode, godEvents, spiritEvents, agentEvents, roomEvents, events]);

  // Get related entity data for selected node
  const selectedEntityData = useMemo(() => {
    if (!selectedNode) return null;

    switch (selectedNode.type) {
      case "agent":
        const agent = agents.find((a) => a.name === selectedNode.name);
        const daemon = daemons.find((d) => d.agentName === selectedNode.name);
        return { agent, daemon };
      case "entity":
        const entity = entities.find((e) => e.name === selectedNode.name);
        return { entity };
      case "room":
        const room = rooms.find((r) => r.name === selectedNode.name);
        const occupants = agents.filter((a) => a.room === selectedNode.name);
        return { room, occupants };
      case "spirit":
        const spirit = spirits.find((s) => s.name === selectedNode.name);
        return { spirit };
      case "god":
        return { tension, spiritCount: spirits.length, agentCount: agents.length };
      default:
        return null;
    }
  }, [selectedNode, agents, entities, rooms, spirits, daemons, tension]);

  // Check if we have any data to show (spirits always exist from startup)
  const isEmpty = agents.length === 0 && entities.length === 0 && rooms.length === 0 && spirits.length === 0;

  // Calculate graph dimensions accounting for sidebar
  const graphWidth = selectedNode ? dimensions.width - 400 : dimensions.width;

  return (
    <div ref={containerRef} className="relative w-full h-full bg-argos-bg-primary flex">
      {/* Graph Container */}
      <div
        className={`relative flex-1 ${selectedNode ? "border-r border-argos-border" : ""}`}
      >
        {isEmpty ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-argos-god/10 flex items-center justify-center">
                <svg
                  className="w-12 h-12 text-argos-god"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-argos-text-primary mb-2">
                Simulation Graph
              </h2>
              <p className="text-argos-text-muted max-w-sm">
                Create a simulation using the presets below or God commands to see the
                entity graph.
              </p>
            </div>
          </div>
        ) : (
          <ForceGraph2D
            ref={graphRef as any}
            width={graphWidth}
            height={dimensions.height}
            graphData={graphData}
            nodeCanvasObject={nodeCanvasObject}
            nodePointerAreaPaint={(node: any, color, ctx) => {
              ctx.beginPath();
              ctx.arc(node.x, node.y, node.size + 12, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.fill();
            }}
            enableNodeDrag={false}
            // Primary click handlers - use stable callbacks to avoid stale closures
            onNodeClick={handleNodeClick as any}
            onBackgroundClick={handleBackgroundClick}
            // Right-click also works for selection
            onNodeRightClick={handleNodeClick as any}
            onNodeHover={onNodeHoverHandler}
            linkColor={(link: any) => link.color}
            linkWidth={2}
            linkDirectionalParticles={2}
            linkDirectionalParticleWidth={2}
            linkDirectionalParticleSpeed={0.005}
            backgroundColor="transparent"
            cooldownTicks={100}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
            // Zoom and pan settings
            enableZoomInteraction={true}
            enablePanInteraction={true}
            minZoom={0.5}
            maxZoom={8}
          />
        )}

      {/* Tooltip */}
      {hoveredNode && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: tooltipPos.x + 15,
            top: tooltipPos.y - 10,
          }}
        >
          <NodeTooltip node={hoveredNode} />
        </div>
      )}

        {/* Legend - pointer-events-none so it doesn't block clicks */}
        <div className="absolute bottom-4 left-4 bg-argos-bg-secondary/90 backdrop-blur-sm rounded-lg p-3 border border-argos-border pointer-events-none">
          <div className="text-xs text-argos-text-muted mb-2">Legend</div>
          <div className="space-y-1">
            <LegendItem color={COLORS.god} label="God" shape="star" />
            <LegendItem color={COLORS.room} label="Rooms" shape="hexagon" />
            <LegendItem color={COLORS.agent} label="Agents" shape="circle" />
            <LegendItem color={COLORS.stimulus} label="Stimuli" shape="diamond" />
            <LegendItem color={COLORS.spirit} label="Spirits" shape="triangle" />
          </div>
        </div>

        {/* Tick indicator - pointer-events-none so it doesn't block clicks */}
        <div className="absolute top-4 right-4 bg-argos-bg-secondary/90 backdrop-blur-sm rounded-lg px-3 py-2 border border-argos-border pointer-events-none">
          <div className="text-xs text-argos-text-muted">Tick</div>
          <div className="text-lg font-mono text-argos-text-primary">{tick}</div>
        </div>
      </div>

      {/* Node Info Sidebar */}
      {selectedNode && (
        <NodeInfoSidebar
          node={selectedNode}
          entityData={selectedEntityData}
          events={filteredEvents}
          onClose={() => setSelectedNodeId(null)}
          onNavigate={navigateToDetail}
        />
      )}
    </div>
  );
}

// Tooltip component
function NodeTooltip({ node }: { node: GraphNode }) {
  const typeLabels: Record<NodeType, string> = {
    god: "God AI",
    spirit: "Spirit",
    room: "Room",
    agent: "Agent",
    stimulus: "Stimulus Source",
    entity: "Entity",
  };

  return (
    <div className="bg-argos-bg-secondary border border-argos-border rounded-lg shadow-xl p-3 max-w-xs">
      <div className="flex items-center gap-2 mb-1">
        <div
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: node.color }}
        />
        <span className="text-xs text-argos-text-muted">
          {typeLabels[node.type]}
        </span>
      </div>
      <div className="font-semibold text-argos-text-primary">{node.name}</div>
      {node.description && (
        <div className="text-sm text-argos-text-secondary mt-1 line-clamp-2">
          {node.description}
        </div>
      )}
      {node.type === "agent" && node.mind && (
        <div className="mt-2 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-argos-text-muted">Mode:</span>
            <span className="text-argos-text-primary capitalize">{node.mind.mode}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-argos-text-muted">Arousal:</span>
            <span className="text-argos-text-primary">
              {Math.round(node.mind.arousal * 100)}%
            </span>
          </div>
          {node.room && (
            <div className="flex justify-between">
              <span className="text-argos-text-muted">Location:</span>
              <span className="text-argos-text-primary">{node.room}</span>
            </div>
          )}
        </div>
      )}
      {node.type === "room" && node.occupants && (
        <div className="mt-2 text-xs">
          <span className="text-argos-text-muted">Occupants: </span>
          <span className="text-argos-text-primary">
            {node.occupants.length === 0
              ? "Empty"
              : node.occupants.join(", ")}
          </span>
        </div>
      )}
      {node.type === "spirit" && (
        <div className="mt-2 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-argos-text-muted">Domain:</span>
            <span className="text-argos-text-primary capitalize">{node.domain}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-argos-text-muted">Rank:</span>
            <span className="text-argos-text-primary capitalize">{node.rank}</span>
          </div>
        </div>
      )}
      <div className="text-xs text-argos-text-muted mt-2 italic">
        Click to view details
      </div>
    </div>
  );
}

// Legend item component
function LegendItem({
  color,
  label,
  shape,
}: {
  color: string;
  label: string;
  shape: "circle" | "hexagon" | "star" | "diamond" | "triangle";
}) {
  return (
    <div className="flex items-center gap-2">
      <svg width="12" height="12" className="flex-shrink-0">
        {shape === "circle" && (
          <circle cx="6" cy="6" r="5" fill={color} />
        )}
        {shape === "hexagon" && (
          <polygon points="6,1 11,3.5 11,8.5 6,11 1,8.5 1,3.5" fill={color} />
        )}
        {shape === "star" && (
          <polygon points="6,1 7.5,4 11,4.5 8.5,7 9,11 6,9 3,11 3.5,7 1,4.5 4.5,4" fill={color} />
        )}
        {shape === "diamond" && (
          <polygon points="6,1 11,6 6,11 1,6" fill={color} />
        )}
        {shape === "triangle" && (
          <polygon points="6,1 11,10 1,10" fill={color} />
        )}
      </svg>
      <span className="text-xs text-argos-text-secondary">{label}</span>
    </div>
  );
}

// Helper functions for drawing shapes
function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  spikes: number,
  outerRadius: number,
  innerRadius: number
) {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;

  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(
      cx + Math.cos(rot) * outerRadius,
      cy + Math.sin(rot) * outerRadius
    );
    rot += step;
    ctx.lineTo(
      cx + Math.cos(rot) * innerRadius,
      cy + Math.sin(rot) * innerRadius
    );
    rot += step;
  }
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
}

function drawHexagon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number
) {
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number
) {
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx + radius, cy);
  ctx.lineTo(cx, cy + radius);
  ctx.lineTo(cx - radius, cy);
  ctx.closePath();
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number
) {
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx + radius * 0.866, cy + radius * 0.5);
  ctx.lineTo(cx - radius * 0.866, cy + radius * 0.5);
  ctx.closePath();
}

// Node Info Sidebar Component
function NodeInfoSidebar({
  node,
  entityData,
  events,
  onClose,
  onNavigate,
}: {
  node: GraphNode;
  entityData: any;
  events: any[];
  onClose: () => void;
  onNavigate: () => void;
}) {
  const typeLabels: Record<NodeType, string> = {
    god: "God AI",
    spirit: "Spirit",
    room: "Room",
    agent: "Agent",
    stimulus: "Stimulus Source",
    entity: "Entity",
  };

  const typeIcons: Record<NodeType, ReactNode> = {
    god: <Sparkles className="w-5 h-5" />,
    spirit: <Sparkles className="w-5 h-5" />,
    room: <MapPin className="w-5 h-5" />,
    agent: <Users className="w-5 h-5" />,
    stimulus: <Radio className="w-5 h-5" />,
    entity: <Activity className="w-5 h-5" />,
  };

  return (
    <div className="w-[400px] h-full bg-argos-bg-secondary border-l border-argos-border flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-argos-border flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${node.color}20` }}
          >
            <span style={{ color: node.color }}>{typeIcons[node.type]}</span>
          </div>
          <div>
            <h3 className="font-semibold text-argos-text-primary">{node.name}</h3>
            <p className="text-xs text-argos-text-muted">{typeLabels[node.type]}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-argos-bg-tertiary text-argos-text-muted hover:text-argos-text-primary transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Description */}
        {node.description && (
          <div className="text-sm text-argos-text-secondary">{node.description}</div>
        )}

        {/* Entity-specific info */}
        {node.type === "agent" && entityData?.agent && (
          <AgentInfoSection agent={entityData.agent} daemon={entityData.daemon} />
        )}

        {node.type === "room" && entityData?.room && (
          <RoomInfoSection room={entityData.room} occupants={entityData.occupants} />
        )}

        {node.type === "spirit" && entityData?.spirit && (
          <SpiritInfoSection spirit={entityData.spirit} />
        )}

        {node.type === "god" && entityData && (
          <GodInfoSection data={entityData} />
        )}

        {/* Event Stream */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-argos-text-primary">
            <Activity className="w-4 h-4" />
            Recent Events
          </div>
          {events.length === 0 ? (
            <p className="text-xs text-argos-text-muted italic">No recent events for this entity</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {events.map((event, idx) => (
                <EventItem key={idx} event={event} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-argos-border">
        <button
          onClick={onNavigate}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-argos-god/20 hover:bg-argos-god/30 text-argos-god rounded-lg transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          View Full Details
        </button>
      </div>
    </div>
  );
}

// Agent Info Section
function AgentInfoSection({ agent, daemon }: { agent: any; daemon?: any }) {
  return (
    <div className="space-y-3">
      {/* Mind State */}
      {agent.mind && (
        <div className="panel">
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-argos-text-primary">
              <Brain className="w-4 h-4 text-argos-agent" />
              Mind State
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-argos-text-muted">Mode:</span>
                <span className="ml-2 text-argos-text-primary capitalize">{agent.mind.mode}</span>
              </div>
              <div>
                <span className="text-argos-text-muted">Arousal:</span>
                <span className="ml-2 text-argos-text-primary">{Math.round(agent.mind.arousal * 100)}%</span>
              </div>
            </div>
            {agent.mind.focus && (
              <div className="text-xs">
                <span className="text-argos-text-muted">Focus:</span>
                <span className="ml-2 text-argos-text-secondary italic">{agent.mind.focus}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Current Thought */}
      {agent.currentThought && (
        <div className="panel">
          <div className="p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-argos-text-primary mb-2">
              <MessageCircle className="w-4 h-4 text-argos-spirit" />
              Current Thought
            </div>
            <p className="text-xs text-argos-text-secondary italic">"{agent.currentThought}"</p>
          </div>
        </div>
      )}

      {/* Daemon Info */}
      {daemon && (
        <div className="panel">
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-argos-text-primary">
              <Ghost className="w-4 h-4 text-purple-400" />
              Guardian Daemon
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-argos-text-muted">Concern:</span>
                <span className={`ml-2 ${daemon.concernLevel > 0.6 ? "text-yellow-400" : "text-green-400"}`}>
                  {Math.round(daemon.concernLevel * 100)}%
                </span>
              </div>
              <div>
                <span className="text-argos-text-muted">Observations:</span>
                <span className="ml-2 text-argos-text-primary">{daemon.observationCount}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Location */}
      {agent.room && (
        <div className="text-xs flex items-center gap-2 text-argos-text-muted">
          <MapPin className="w-3 h-3" />
          Currently in: <span className="text-argos-text-secondary">{agent.room}</span>
        </div>
      )}
    </div>
  );
}

// Room Info Section
function RoomInfoSection({ room, occupants }: { room: any; occupants: any[] }) {
  return (
    <div className="space-y-3">
      <div className="panel">
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-argos-text-primary">
            <MapPin className="w-4 h-4 text-argos-world" />
            Room Details
          </div>
          <div className="text-xs space-y-1">
            <div>
              <span className="text-argos-text-muted">Capacity:</span>
              <span className="ml-2 text-argos-text-primary">{room.capacity}</span>
            </div>
            {room.ambience && (
              <div>
                <span className="text-argos-text-muted">Ambience:</span>
                <span className="ml-2 text-argos-text-secondary">{room.ambience}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Occupants */}
      <div className="panel">
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-argos-text-primary">
            <Users className="w-4 h-4 text-argos-agent" />
            Occupants ({occupants.length})
          </div>
          {occupants.length === 0 ? (
            <p className="text-xs text-argos-text-muted italic">Room is empty</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {occupants.map((agent) => (
                <span
                  key={agent.id}
                  className="text-xs px-2 py-0.5 bg-argos-agent/20 text-argos-agent rounded"
                >
                  {agent.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Spirit Info Section
function SpiritInfoSection({ spirit }: { spirit: any }) {
  return (
    <div className="space-y-3">
      <div className="panel">
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-argos-text-primary">
            <Sparkles className="w-4 h-4 text-argos-spirit" />
            Spirit Details
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-argos-text-muted">Domain:</span>
              <span className="ml-2 text-argos-text-primary capitalize">{spirit.domain}</span>
            </div>
            <div>
              <span className="text-argos-text-muted">Rank:</span>
              <span className="ml-2 text-argos-text-primary capitalize">{spirit.rank}</span>
            </div>
            <div>
              <span className="text-argos-text-muted">Observations:</span>
              <span className="ml-2 text-argos-text-primary">{spirit.observationsCount || 0}</span>
            </div>
            <div>
              <span className="text-argos-text-muted">Inbox:</span>
              <span className="ml-2 text-argos-text-primary">{spirit.inboxSize || 0}</span>
            </div>
          </div>
        </div>
      </div>

      {spirit.lastObservation > 0 && (
        <div className="text-xs flex items-center gap-2 text-argos-text-muted">
          <Clock className="w-3 h-3" />
          Last observation: {formatTimeAgo(spirit.lastObservation)}
        </div>
      )}
    </div>
  );
}

// God Info Section
function GodInfoSection({ data }: { data: any }) {
  return (
    <div className="space-y-3">
      <div className="panel">
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-argos-text-primary">
            <Eye className="w-4 h-4 text-argos-god" />
            Divine Overview
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-argos-text-muted">Tension:</span>
              <span className="ml-2 text-argos-text-primary">{Math.round(data.tension * 100)}%</span>
            </div>
            <div>
              <span className="text-argos-text-muted">Spirits:</span>
              <span className="ml-2 text-argos-text-primary">{data.spiritCount}</span>
            </div>
            <div>
              <span className="text-argos-text-muted">Agents:</span>
              <span className="ml-2 text-argos-text-primary">{data.agentCount}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Event Item Component
function EventItem({ event }: { event: any }) {
  const getEventColor = (type: string): string => {
    if (type.startsWith("god:")) return "text-argos-god";
    if (type.startsWith("spirit:")) return "text-argos-spirit";
    if (type.startsWith("agent:")) return "text-argos-agent";
    if (type.startsWith("room:")) return "text-argos-world";
    if (type.startsWith("daemon:")) return "text-purple-400";
    return "text-argos-text-secondary";
  };

  const formatEventType = (type: string): string => {
    return type.split(":")[1]?.replace(/_/g, " ") || type;
  };

  const getEventContent = () => {
    // Handle agent:action events - action is the type string, not an object
    if (event.type === "agent:action") {
      const actionType = event.action || "unknown";
      const target = event.target ? ` → ${event.target}` : "";
      const content = event.content ? `: ${event.content.slice(0, 80)}` : "";
      return `${actionType}${target}${content}`;
    }
    if (event.thought) return `"${event.thought}"`;
    if (event.content) return event.content;
    if (event.thinking) return event.thinking.slice(0, 100) + "...";
    if (event.command) return `Command: ${event.command}`;
    if (event.spiritName && event.type.includes("observe")) return `${event.spiritName} observing...`;
    return null;
  };

  const content = getEventContent();

  return (
    <div className="p-2 bg-argos-bg-tertiary rounded text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className={`font-medium capitalize ${getEventColor(event.type)}`}>
          {formatEventType(event.type)}
        </span>
        <span className="text-argos-text-muted">
          {event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : ""}
        </span>
      </div>
      {content && (
        <p className={`text-argos-text-secondary line-clamp-2 ${event.thought ? "italic" : ""}`}>
          {content}
        </p>
      )}
    </div>
  );
}

// Helper function
function formatTimeAgo(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}
