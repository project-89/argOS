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

export const availableTools = [
  {
    name: "speak",
    description: "Say something to others in the room",
    parameters: ["message", "tone", "target"],
    schema: toolSchemas.speak,
  },
  {
    name: "listen",
    description: "Actively listen and pay attention to what's happening",
    parameters: ["focus", "duration"],
    schema: toolSchemas.listen,
  },
  {
    name: "wait",
    description: "Choose to wait and observe the situation",
    parameters: ["reason", "duration"],
    schema: toolSchemas.wait,
  },
];
