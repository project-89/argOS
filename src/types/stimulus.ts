import { StimulusSchema, StimulusType } from "../components/Stimulus";
import { z } from "zod";

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
