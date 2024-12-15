import { z } from "zod";
import { createComponent } from "./createComponent";

// Action schema and component
export const ActionSchema = z.object({
  pendingAction: z
    .object({
      tool: z.string(),
      parameters: z.any(),
    })
    .nullable(),
  lastActionTime: z.number(),
  lastActionResult: z
    .object({
      action: z.string(),
      success: z.boolean(),
      result: z.string(),
      timestamp: z.number(),
    })
    .nullable(),
  availableTools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      parameters: z.array(z.string()),
      schema: z.any(),
    })
  ),
});

export type ActionType = z.infer<typeof ActionSchema>;

export const ActionComponent = createComponent("Action", ActionSchema, {
  pendingAction: [] as ({
    tool: string;
    parameters: any;
  } | null)[],
  lastActionTime: [] as number[],
  lastActionResult: [] as ({
    action: string;
    success: boolean;
    result: string;
    timestamp: number;
    data: Record<string, any>;
  } | null)[],
  availableTools: [] as Array<{
    name: string;
    description: string;
    parameters: string[];
    schema: any;
  }>[],
});

export const Action = ActionComponent.component;
