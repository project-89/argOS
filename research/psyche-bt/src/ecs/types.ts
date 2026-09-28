/**
 * ECS Types — Shared type definitions for the person model.
 */

// =============================================================================
// HYPOTHESIS
// =============================================================================

export interface Hypothesis {
  id: string;
  domain: string;          // "work_style", "humor", "stress_pattern", etc.
  content: string;         // "Prefers direct communication over small talk"
  confidence: number;      // 0.0 - 1.0
  evidence: string[];      // Message IDs or descriptions that support this
  lastUpdated: number;     // Timestamp
  source: "observation" | "prediction" | "teacher" | "exploration";
}

// =============================================================================
// MEMORY
// =============================================================================

export interface MemoryEntry {
  id: string;
  type: "fact" | "event" | "plan" | "reference" | "observation" | "insight" | "summary";
  content: string;
  importance: number;      // 0.0 - 1.0
  topics: string[];
  connections: string[];   // IDs of related entries
  timestamp: number;
}

// =============================================================================
// ENTITY (people, places, projects the person mentions)
// =============================================================================

export interface KnownEntity {
  name: string;
  type: "person" | "place" | "project" | "organization" | "event" | "thing";
  mentionCount: number;
  lastMentioned: number;
  context: string;         // Brief description of what we know
}

// =============================================================================
// INTENTION (things the agent is doing FOR this person)
// =============================================================================

export interface Intention {
  id: string;
  claim: string;           // "Help with board presentation"
  scope: "immediate" | "short_term" | "ongoing";
  status: "forming" | "active" | "blocked" | "completed" | "abandoned";
  plan: PlanStep[];
  deliverables: string[];
  createdAt: number;
  lastUpdated: number;
}

export interface PlanStep {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "blocked";
  toolRequired?: string;
  output?: string;
}

// =============================================================================
// PREDICTION
// =============================================================================

export interface Prediction {
  id: string;
  content: string;         // "Will mention the gallery show next session"
  domain: string;
  confidence: number;
  deadline?: number;
  outcome?: "confirmed" | "wrong" | "partial" | "expired";
  resolvedAt?: number;
}

// =============================================================================
// CALIBRATION (per-domain accuracy tracking)
// =============================================================================

export interface DomainCalibration {
  domain: string;
  totalPredictions: number;
  correctPredictions: number;
  accuracy: number;        // Running accuracy
  recentTrend: "improving" | "stable" | "declining";
}

// =============================================================================
// STYLE (communication preferences)
// =============================================================================

export interface CommunicationStyle {
  formality: number;       // 0 (casual) - 1 (formal)
  humor: number;           // 0 (serious) - 1 (playful)
  messageLength: "terse" | "moderate" | "verbose";
  emojiFrequency: "never" | "rare" | "moderate" | "frequent";
  topicTransitionStyle: "abrupt" | "gradual";
  preferredGreeting?: string;
}

// =============================================================================
// CONVERSATION STATE
// =============================================================================

export interface ConversationState {
  recentMessages: Message[];
  currentTopics: string[];
  emotionalState: string;  // "neutral", "stressed", "excited", "frustrated", etc.
  sessionStart: number;
  turnsThisSession: number;
}

export interface Message {
  role: "user" | "agent";
  content: string;
  timestamp: number;
  topics?: string[];
  emotionalTone?: string;
}

// =============================================================================
// SKILL (compiled behavior sub-tree)
// =============================================================================

export interface Skill {
  name: string;
  description: string;
  tree: any;               // BehaviorNode (typed in bt/types.ts)
  origin: "compiled" | "composed" | "bootstrap" | "species";
  successRate: number;
  uses: number;
  compiledAt: number;
  lastUsed: number;
}

// =============================================================================
// BEHAVIOR POLICY
// =============================================================================

export interface BehaviorPolicyState {
  tree: any;               // BehaviorNode
  version: number;
  totalNodes: number;
  compiledBranches: number;
  lastCompiled: number;
  escalationCount: number;
  handledCount: number;
}

// =============================================================================
// FULL PERSON MODEL
// =============================================================================

export interface PersonModel {
  personId: string;
  createdAt: number;
  lastInteraction: number;

  // ECS Components
  hypotheses: Hypothesis[];
  memory: MemoryEntry[];
  entities: KnownEntity[];
  intentions: Intention[];
  predictions: Prediction[];
  calibration: DomainCalibration[];
  style: CommunicationStyle;
  conversation: ConversationState;
  skills: Skill[];
  policy: BehaviorPolicyState;

  // Metadata
  totalConversations: number;
  totalMessages: number;
  totalEscalations: number;
  totalBTHandled: number;
}
