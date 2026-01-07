import { createNodeId, createEdgeId } from "../core/ids";
import { getAgent, ArgosWorld } from "../core/ecs";
import type { KnowledgeNode, KnowledgeEdge, KnowledgeGraph } from "../core/types";

export function getKnowledgeGraph(world: ArgosWorld, eid: number): KnowledgeGraph {
  const agent = getAgent(world, eid);
  return agent?.knowledge ?? {
    nodes: {},
    edges: {},
    nodeTypes: {},
    edgeTypes: {},
  };
}

export function addNodeType(
  world: ArgosWorld,
  eid: number,
  typeName: string,
  schema: Record<string, string>
): void {
  const agent = getAgent(world, eid);
  if (!agent) return;
  agent.knowledge.nodeTypes[typeName] = { schema };
}

export function addEdgeType(
  world: ArgosWorld,
  eid: number,
  typeName: string,
  schema: Record<string, string>
): void {
  const agent = getAgent(world, eid);
  if (!agent) return;
  agent.knowledge.edgeTypes[typeName] = { schema };
}

export function addNode(
  world: ArgosWorld,
  eid: number,
  config: {
    type: string;
    content: any;
    confidence?: number;
    source?: string;
    metadata?: Record<string, any>;
  }
): KnowledgeNode | null {
  const agent = getAgent(world, eid);
  if (!agent) return null;
  
  const now = Date.now();
  const node: KnowledgeNode = {
    id: createNodeId(),
    type: config.type,
    content: config.content,
    confidence: config.confidence ?? 0.8,
    source: config.source ?? "inference",
    timestamp: now,
    lastAccessed: now,
    accessCount: 0,
    protected: false,
    metadata: config.metadata,
  };

  agent.knowledge.nodes[node.id] = node;
  return node;
}

export function addEdge(
  world: ArgosWorld,
  eid: number,
  config: {
    type: string;
    from: string;
    to: string;
    weight?: number;
    confidence?: number;
    metadata?: Record<string, any>;
  }
): KnowledgeEdge | null {
  const agent = getAgent(world, eid);
  if (!agent) return null;
  
  const graph = agent.knowledge;
  if (!graph.nodes[config.from] || !graph.nodes[config.to]) {
    return null;
  }

  const edge: KnowledgeEdge = {
    id: createEdgeId(),
    type: config.type,
    from: config.from,
    to: config.to,
    weight: config.weight ?? 1,
    confidence: config.confidence ?? 0.8,
    metadata: config.metadata,
  };

  graph.edges[edge.id] = edge;
  return edge;
}

export function getNode(world: ArgosWorld, eid: number, nodeId: string): KnowledgeNode | null {
  const agent = getAgent(world, eid);
  if (!agent) return null;
  
  const node = agent.knowledge.nodes[nodeId];
  if (node) {
    node.lastAccessed = Date.now();
    node.accessCount++;
  }
  return node ?? null;
}

export function queryNodes(
  world: ArgosWorld,
  eid: number,
  filter: Partial<{ type: string; contentMatch: string }>
): KnowledgeNode[] {
  const agent = getAgent(world, eid);
  if (!agent) return [];
  
  const now = Date.now();
  return Object.values(agent.knowledge.nodes).filter((node) => {
    if (filter.type && node.type !== filter.type) return false;
    if (filter.contentMatch) {
      const contentStr = JSON.stringify(node.content).toLowerCase();
      if (!contentStr.includes(filter.contentMatch.toLowerCase())) return false;
    }
    node.lastAccessed = now;
    node.accessCount++;
    return true;
  });
}

export function getConnectedNodes(
  world: ArgosWorld,
  eid: number,
  nodeId: string,
  edgeType?: string
): KnowledgeNode[] {
  const agent = getAgent(world, eid);
  if (!agent) return [];
  
  const graph = agent.knowledge;
  const connectedIds = new Set<string>();

  for (const edge of Object.values(graph.edges)) {
    if (edgeType && edge.type !== edgeType) continue;
    if (edge.from === nodeId) connectedIds.add(edge.to);
    if (edge.to === nodeId) connectedIds.add(edge.from);
  }

  return Array.from(connectedIds)
    .map((id) => graph.nodes[id])
    .filter(Boolean);
}

export function strengthenEdge(world: ArgosWorld, eid: number, edgeId: string, amount: number): void {
  const agent = getAgent(world, eid);
  if (!agent) return;
  
  const edge = agent.knowledge.edges[edgeId];
  if (edge) {
    edge.weight = Math.min(edge.weight + amount, 10);
    edge.confidence = Math.min(edge.confidence + amount * 0.1, 1);
  }
}

export function weakenEdge(world: ArgosWorld, eid: number, edgeId: string, amount: number): void {
  const agent = getAgent(world, eid);
  if (!agent) return;
  
  const edge = agent.knowledge.edges[edgeId];
  if (edge) {
    edge.weight = Math.max(edge.weight - amount, 0);
    edge.confidence = Math.max(edge.confidence - amount * 0.1, 0);

    if (edge.weight <= 0) {
      delete agent.knowledge.edges[edgeId];
    }
  }
}

export function protectNode(world: ArgosWorld, eid: number, nodeId: string): void {
  const agent = getAgent(world, eid);
  if (!agent) return;
  
  const node = agent.knowledge.nodes[nodeId];
  if (node) {
    node.protected = true;
  }
}

export function decayKnowledge(world: ArgosWorld, eid: number, decayRate: number = 0.01): void {
  const agent = getAgent(world, eid);
  if (!agent) return;
  
  const graph = agent.knowledge;
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  const nodesToRemove: string[] = [];

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (node.protected) continue;

    const age = now - node.lastAccessed;
    const daysSinceAccess = age / DAY;

    const accessBonus = Math.log(node.accessCount + 1) * 0.1;
    const decay = decayRate * daysSinceAccess * (1 - accessBonus);

    node.confidence = Math.max(node.confidence - decay, 0);

    if (node.confidence <= 0) {
      nodesToRemove.push(nodeId);
    }
  }

  for (const nodeId of nodesToRemove) {
    delete graph.nodes[nodeId];

    for (const [edgeId, edge] of Object.entries(graph.edges)) {
      if (edge.from === nodeId || edge.to === nodeId) {
        delete graph.edges[edgeId];
      }
    }
  }
}

export function getKnowledgeStats(world: ArgosWorld, eid: number): {
  nodeCount: number;
  edgeCount: number;
  nodeTypes: string[];
  edgeTypes: string[];
} {
  const graph = getKnowledgeGraph(world, eid);
  return {
    nodeCount: Object.keys(graph.nodes).length,
    edgeCount: Object.keys(graph.edges).length,
    nodeTypes: Object.keys(graph.nodeTypes),
    edgeTypes: Object.keys(graph.edgeTypes),
  };
}

export function serializeKnowledgeForLLM(world: ArgosWorld, eid: number, maxNodes: number = 20): string {
  const graph = getKnowledgeGraph(world, eid);

  const recentNodes = Object.values(graph.nodes)
    .sort((a, b) => b.lastAccessed - a.lastAccessed)
    .slice(0, maxNodes);

  const relevantEdges = Object.values(graph.edges).filter(
    (edge) =>
      recentNodes.some((n) => n.id === edge.from) &&
      recentNodes.some((n) => n.id === edge.to)
  );

  if (recentNodes.length === 0) {
    return "KNOWLEDGE GRAPH: Empty";
  }

  const lines: string[] = ["KNOWLEDGE GRAPH:"];

  lines.push("\nNodes:");
  for (const node of recentNodes) {
    const contentStr =
      typeof node.content === "string"
        ? node.content
        : JSON.stringify(node.content);
    lines.push(`  [${node.type}] ${contentStr} (confidence: ${node.confidence.toFixed(2)})`);
  }

  if (relevantEdges.length > 0) {
    lines.push("\nRelationships:");
    for (const edge of relevantEdges) {
      const from = graph.nodes[edge.from];
      const to = graph.nodes[edge.to];
      if (from && to) {
        const fromStr = typeof from.content === "string" ? from.content : JSON.stringify(from.content);
        const toStr = typeof to.content === "string" ? to.content : JSON.stringify(to.content);
        lines.push(`  ${fromStr} --[${edge.type}]--> ${toStr}`);
      }
    }
  }

  return lines.join("\n");
}
