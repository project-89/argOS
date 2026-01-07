import { z } from 'zod/v3';

export const CognitiveEventTypeSchema = z.enum([
  "stimulus",
  "perception",
  "thought",
  "insight",
  "decision",
  "intention",
  "reflection",
  "memory",
]);
export type CognitiveEventType = z.infer<typeof CognitiveEventTypeSchema>;

export const CognitiveModeSchema = z.enum([
  "reactive",
  "deliberative",
  "reflective",
  "creative",
]);
export type CognitiveMode = z.infer<typeof CognitiveModeSchema>;

export const StimulusTypeSchema = z.enum([
  "visual",
  "auditory",
  "proprioceptive",
  "interoceptive",
  "social",
  "memory",
  "thought",
  "environmental",
]);
export type StimulusType = z.infer<typeof StimulusTypeSchema>;

export const CognitiveEventSchema = z.object({
  id: z.string(),
  type: CognitiveEventTypeSchema,
  content: z.string(),
  timestamp: z.number(),
  causedBy: z.array(z.string()),
  causes: z.array(z.string()),
  salience: z.number().min(0).max(1),
  relevance: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  metadata: z.record(z.any()),
});
export type CognitiveEvent = z.infer<typeof CognitiveEventSchema>;

export const StimulusSchema = z.object({
  id: z.string(),
  type: StimulusTypeSchema,
  source: z.string(),
  content: z.string(),
  timestamp: z.number(),
  duration: z.number(),
  decay: z.number().min(0).max(1),
  salience: z.number().min(0).max(1),
  urgency: z.number().min(0).max(1),
  novelty: z.number().min(0).max(1),
  processed: z.boolean(),
  suppressedUntil: z.number().optional(),
  metadata: z.record(z.any()).optional(),
});
export type Stimulus = z.infer<typeof StimulusSchema>;

export const AttentionStateSchema = z.object({
  focus: z.string().nullable(),
  filters: z.array(z.string()),
  capacity: z.number().min(1).max(20),
  saturation: z.number().min(0).max(1),
});
export type AttentionState = z.infer<typeof AttentionStateSchema>;

export const MindStateSchema = z.object({
  stream: z.array(CognitiveEventSchema),
  attention: AttentionStateSchema,
  arousal: z.number().min(0).max(1),
  mode: CognitiveModeSchema,
  lastUpdate: z.number(),
});
export type MindState = z.infer<typeof MindStateSchema>;

export const KnowledgeNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  content: z.any(),
  confidence: z.number().min(0).max(1),
  source: z.string(),
  timestamp: z.number(),
  lastAccessed: z.number(),
  accessCount: z.number(),
  protected: z.boolean(),
  metadata: z.record(z.any()).optional(),
});
export type KnowledgeNode = z.infer<typeof KnowledgeNodeSchema>;

export const KnowledgeEdgeSchema = z.object({
  id: z.string(),
  type: z.string(),
  from: z.string(),
  to: z.string(),
  weight: z.number(),
  confidence: z.number().min(0).max(1),
  metadata: z.record(z.any()).optional(),
});
export type KnowledgeEdge = z.infer<typeof KnowledgeEdgeSchema>;

export const KnowledgeGraphSchema = z.object({
  nodes: z.record(KnowledgeNodeSchema),
  edges: z.record(KnowledgeEdgeSchema),
  nodeTypes: z.record(z.any()),
  edgeTypes: z.record(z.any()),
});
export type KnowledgeGraph = z.infer<typeof KnowledgeGraphSchema>;

export const ActionStatusSchema = z.enum([
  "pending",
  "executing",
  "completed",
  "failed",
]);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

export const ActionSchema = z.object({
  id: z.string(),
  type: z.string(),
  parameters: z.record(z.any()),
  motivatedBy: z.array(z.string()),
  expectedOutcome: z.string(),
  status: ActionStatusSchema,
  result: z.any().optional(),
  actualOutcome: z.string().optional(),
  timestamp: z.number(),
});
export type Action = z.infer<typeof ActionSchema>;

export interface Agent {
  id: number;
  name: string;
  role: string;
  systemPrompt: string;
}

export interface World {
  agents: Map<number, Agent>;
  stimuli: Map<string, Stimulus>;
  rooms: Map<string, Room>;
}

export interface Room {
  id: string;
  name: string;
  description: string;
  agents: Set<number>;
  stimuli: Set<string>;
}
