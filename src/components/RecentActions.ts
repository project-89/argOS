import { z } from "zod";
import { createComponent } from "./createComponent";

// Define the schema for the RecentActions component
export const RecentActionsSchema = z.object({
  actions: z.array(
    z.object({
      actionName: z.string(),
      parameters: z.any(),
      success: z.boolean(),
      message: z.string(),
      timestamp: z.number(),
      data: z.any().optional(),
    })
  ),
});

// TypeScript types for convenience
export type RecentActionsType = z.infer<typeof RecentActionsSchema>;

// Create the actual component with a name and schema
export const RecentActionsComponent = createComponent(
  "RecentActions",
  RecentActionsSchema,
  {
    actions: [] as Array<{
      actionName: string;
      parameters: any;
      success: boolean;
      message: string;
      timestamp: number;
      data: Record<string, any>;
    }>[],
  }
);

// Export the component
export const RecentActions = RecentActionsComponent.component;
