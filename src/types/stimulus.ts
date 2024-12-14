import { z } from "zod";
import { StimulusSchema } from "../components/agent/Agent";

// Core stimulus types
export const StimulusTypes = {
  VISUAL: "VISUAL",
  AUDITORY: "AUDITORY",
  COGNITIVE: "COGNITIVE",
  TECHNICAL: "TECHNICAL",
  ENVIRONMENTAL: "ENVIRONMENTAL",
} as const;

export type StimulusType = (typeof StimulusTypes)[keyof typeof StimulusTypes];

// Source types for stimuli
export const SourceTypes = {
  AGENT: "AGENT",
  ROOM: "ROOM",
  USER: "USER",
  SYSTEM: "SYSTEM",
} as const;

export type SourceType = (typeof SourceTypes)[keyof typeof SourceTypes];

// Use the schema type instead of a separate interface
export type StimulusData = z.infer<typeof StimulusSchema>;

// Helper function to validate stimulus data
export function isValidStimulusData(data: any): data is StimulusData {
  try {
    StimulusSchema.parse(data);
    return true;
  } catch (error) {
    return false;
  }
}

// Simple content validation - just check if it's valid JSON
export function validateStimulusContent(
  type: StimulusType,
  content: any
): boolean {
  try {
    if (typeof content === "string") {
      JSON.parse(content);
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}
