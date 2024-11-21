import { createWorld } from "bitecs";

// Export the World type from BitECS
export type World = ReturnType<typeof createWorld>;

// Export any other BitECS types we might need
export type Entity = number;
export type Component = Record<string, Array<any>>;
