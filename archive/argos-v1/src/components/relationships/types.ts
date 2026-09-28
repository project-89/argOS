import { z } from "zod";
import { Relation } from "bitecs";

// Base types
export interface RelationWithSchema<T extends z.ZodObject<any>> {
  name: string;
  schema: T;
  relation: Relation<Record<string, any[]>>;
  type: z.infer<T>;
}

export interface RelationMetadata {
  timestamp: number;
  strength?: number;
  metadata?: Record<string, any>;
}

// Stimulus relationship types
export interface StimulusInRoomStore {
  timestamp: number[];
  intensity: number[];
  metadata: Record<string, any>[];
}

export interface StimulusSourceStore {
  timestamp: number[];
  strength: number[];
  metadata: Record<string, any>[];
}

export interface StimulusRoomMetadata {
  timestamp: number;
  intensity: number;
  metadata?: Record<string, any>;
}

export interface StimulusSourceMetadata {
  timestamp: number;
  strength: number;
  metadata?: Record<string, any>;
}

// Agent relationship types
export interface InteractionStore {
  type: string[];
  strength: number[];
  lastUpdate: number[];
  metadata: Record<string, any>[];
}

export interface InteractionMetadata {
  type: string;
  strength: number;
  lastUpdate: number;
  metadata?: Record<string, any>;
}

export interface InteractionUpdateData {
  type?: string;
  strength?: number;
  lastUpdate?: number;
  metadata?: Record<string, any>;
}
