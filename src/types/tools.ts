import { z } from "zod";

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
