import { z } from "zod";
import { createComponent } from "./createComponent";

// Appearance schema and component
export const AppearanceSchema = z.object({
  baseDescription: z.string(),
  description: z.string(),
  facialExpression: z.string(),
  bodyLanguage: z.string(),
  currentAction: z.string(),
  socialCues: z.string(),
  lastUpdate: z.number(),
});

export type AppearanceType = z.infer<typeof AppearanceSchema>;

export const AppearanceComponent = createComponent(
  "Appearance",
  AppearanceSchema,
  {
    baseDescription: [] as string[],
    description: [] as string[],
    facialExpression: [] as string[],
    bodyLanguage: [] as string[],
    currentAction: [] as string[],
    socialCues: [] as string[],
    lastUpdate: [] as number[],
  }
);

export const Appearance = AppearanceComponent.component;
