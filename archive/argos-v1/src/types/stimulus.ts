import { z } from "zod";

export enum StimulusType {
  VISUAL = "visual",
  AUDITORY = "auditory",
  COGNITIVE = "cognitive",
  TECHNICAL = "technical",
  ENVIRONMENTAL = "environmental",
}

export enum StimulusSource {
  AGENT = "agent",
  ROOM = "room",
  USER = "user",
  SYSTEM = "system",
  SELF = "self",
}

export interface StimulusMetadata {
  roomId?: string;
  targetId?: number;
  duration?: number;
  [key: string]: any;
}

export interface StimulusContent<T = any> {
  data: T;
  metadata?: StimulusMetadata;
}

export interface StimulusData {
  eid: number;
  type: StimulusType;
  source: StimulusSource;
  timestamp: number;
  content: string; // JSON stringified StimulusContent
  subtype?: string;
  intensity?: number;
  private?: boolean;
  decay?: number;
  priority?: number;
  metadata?: StimulusMetadata;
  perceived?: boolean;
}

// Type alias for backward compatibility
export type SourceType = StimulusSource;
