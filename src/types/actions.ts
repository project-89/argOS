import { z } from "zod";
import { World } from "bitecs";
import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { EventBus } from "../runtime/EventBus";

// Action result type
export interface ActionResult {
  success: boolean;
  message: string;
  timestamp: number;
  actionName: string; // The action that was performed
  parameters: Record<string, any>; // The parameters used
  data: {
    entityId?: number; // Any created/affected entity ID
    content?: string; // Any content/message produced
    metadata?: Record<string, any>; // Additional action-specific data
  };
}

// Tool schemas for actions
export const toolSchemas = {
  speak: z.object({
    message: z.string(),
    tone: z.enum(["neutral", "gentle", "firm"]).optional(),
    target: z.string().optional(),
  }),
  listen: z.object({
    focus: z.string().optional(),
    duration: z.number().optional(),
  }),
  wait: z.object({
    reason: z.string(),
    duration: z.number().optional(),
  }),
};

export interface ActionModule {
  action: {
    name: string;
    description: string;
    parameters: string[];
    schema: any;
  };
  execute: (
    world: World,
    eid: number,
    parameters: any,
    eventBus: EventBus,
    runtime: SimulationRuntime
  ) => Promise<any>;
}
