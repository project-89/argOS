import { z } from "zod";
import { createComponent } from "./index";

// Schema for attention focus item
const AttentionFocusSchema = z.object({
  target: z.string().describe("What is being attended to"),
  type: z.enum(["agent", "stimulus", "goal", "memory", "pattern", "environment"]),
  relevance: z.number().min(0).max(1).describe("How relevant this is (0-1)"),
  urgency: z.number().min(0).max(1).describe("How urgent this is (0-1)"),
  timestamp: z.number(),
  decay_rate: z.number().describe("How quickly this loses relevance"),
  metadata: z.record(z.any()).optional(),
});

// Schema for attention filter
const AttentionFilterSchema = z.object({
  include_types: z.array(z.string()).describe("Types to focus on"),
  exclude_types: z.array(z.string()).describe("Types to ignore"),
  min_relevance: z.number().min(0).max(1).describe("Minimum relevance threshold"),
  min_urgency: z.number().min(0).max(1).describe("Minimum urgency threshold"),
});

// Main attention component schema
const AttentionSchema = z.object({
  // Current attention focus stack (most important at top)
  focus_stack: z.array(AttentionFocusSchema).describe("Stack of attention focuses"),
  
  // Attention capacity (how many things can be attended to)
  capacity: z.number().min(1).max(10).describe("Maximum simultaneous attention items"),
  
  // Current attention filters
  filters: AttentionFilterSchema,
  
  // Attention mode
  mode: z.enum([
    "focused",      // Deep focus on single item
    "scanning",     // Scanning environment broadly
    "alert",        // Heightened awareness for threats/opportunities
    "divided",      // Splitting attention between multiple items
    "wandering",    // Unfocused, exploratory
  ]),
  
  // Attention history for pattern detection
  history: z.array(z.object({
    focus: AttentionFocusSchema,
    duration: z.number().describe("How long this was attended to (ms)"),
    outcome: z.enum(["useful", "irrelevant", "missed", "unknown"]).optional(),
  })),
  
  // Salience thresholds
  salience_thresholds: z.object({
    novelty: z.number().describe("Threshold for novel stimuli"),
    relevance: z.number().describe("Threshold for goal-relevant stimuli"),
    social: z.number().describe("Threshold for social stimuli"),
    threat: z.number().describe("Threshold for threatening stimuli"),
  }),
  
  // Performance metrics
  metrics: z.object({
    focus_switches: z.number().describe("How often attention switches"),
    average_focus_duration: z.number().describe("Average time spent on each focus"),
    missed_important: z.number().describe("Count of missed important items"),
    distraction_count: z.number().describe("Count of distractions"),
  }),
  
  last_update: z.number(),
});

export const AttentionComponent = createComponent(
  "Attention",
  AttentionSchema,
  {
    focus_stack: [],
    capacity: [],
    filters: [],
    mode: [],
    history: [],
    salience_thresholds: [],
    metrics: [],
    last_update: [],
  }
);

export const Attention = AttentionComponent.component;

export type AttentionFocus = z.infer<typeof AttentionFocusSchema>;
export type AttentionFilter = z.infer<typeof AttentionFilterSchema>;
export type AttentionType = z.infer<typeof AttentionSchema>;