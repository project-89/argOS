// Network Graph Types
export interface NetworkPosition {
  x: number;
  y: number;
}

export interface NetworkNode {
  id: string;
  name: string;
  type: "room" | "agent";
  position?: NetworkPosition;
  color?: string;
  val?: number;
}

export interface NetworkLink {
  source: string;
  target: string;
  type: "presence" | "interaction" | "attention";
  value: number;
}

export interface NetworkState {
  nodes: NetworkNode[];
  links: NetworkLink[];
}

// Relationship type (used for network connections)
export interface Relationship {
  source: string;
  target: string;
  type: string;
  value: number;
}
