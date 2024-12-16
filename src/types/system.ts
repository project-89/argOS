import { createWorld } from "bitecs";

// BitECS core types
export type World = ReturnType<typeof createWorld>;
export type Entity = number;
export type Component = Record<string, Array<any>>;

// System types
export interface SystemConfig {
  updateInterval?: number;
  priority?: number;
  enabled?: boolean;
}

export interface SystemResult {
  success: boolean;
  error?: Error;
  data?: any;
}

// Runtime types (moved from runtime.ts)
export interface RuntimeConfig {
  updateInterval?: number;
  systems?: ((world: World) => Promise<World>)[];
}
