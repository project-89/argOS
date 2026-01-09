/**
 * Spirit System Types
 *
 * Spirits are AI agents that observe and steer the ECS simulation.
 * They form a hierarchy with GodAI at the top, reporting observations
 * up and receiving directives down.
 */

import type { SensoryModality } from "../cognition/sensory-system";

// =============================================================================
// CORE SPIRIT TYPES
// =============================================================================

export type SpiritDomain =
  | "narrative"    // Story, plot, drama, pacing
  | "social"       // Relationships, factions, conflicts
  | "ecology"      // Environment, resources, weather, space
  | "economy"      // Trade, markets, resources
  | "guardian"     // Watches over specific NPCs
  | "locale";      // Manages specific locations

export type SpiritRank =
  | "archangel"    // Domain managers (Narrator, Sociologist, etc.)
  | "angel"        // Local/specific managers
  | "daemon";      // Minor task-specific spirits

export interface SpiritDefinition {
  name: string;
  domain: SpiritDomain;
  rank: SpiritRank;
  description: string;

  // What this spirit watches
  watchConfig: WatchConfig;

  // Intervention capabilities
  canInjectEvents: boolean;
  canModifyMood: boolean;
  canCreateEntities: boolean;
  canBakeSystems: boolean;

  // Cognition settings
  model: "flash" | "haiku" | "pro";
  systemPrompt: string;
  observationInterval: number;  // ms between observations
}

export interface WatchConfig {
  // ECS queries to run each cycle
  componentQueries: ComponentQueryConfig[];

  // Event types to listen for
  eventTypes: string[];

  // Specific entities to watch (by name)
  watchEntities?: string[];

  // Rooms/areas to focus on
  watchRooms?: string[];
}

export interface ComponentQueryConfig {
  name: string;
  components: string[];
  description: string;
}

// =============================================================================
// SPIRIT STATE
// =============================================================================

export interface SpiritState {
  eid: number;                      // Entity ID in ECS
  definition: SpiritDefinition;

  // Hierarchy
  superiorEid?: number;             // Who this spirit reports to
  subordinateEids: number[];        // Spirits that report to this one

  // Observations
  observations: Observation[];      // Recent observations (ring buffer)
  lastObservationTime: number;      // Timestamp of last observation cycle

  // Communication
  inbox: DivineMessage[];           // Messages from other spirits
  outbox: DivineMessage[];          // Messages to send
  pendingDirectives: Directive[];   // Instructions from superior

  // Narrative state (for Narrator)
  narrativeState?: NarrativeState;

  // Social state (for Sociologist)
  socialState?: SocialState;

  // Memory
  shortTermMemory: string[];        // Recent thoughts/conclusions
  significantEvents: SignificantEvent[];
}

// =============================================================================
// OBSERVATIONS
// =============================================================================

export interface Observation {
  id: string;
  timestamp: number;
  domain: SpiritDomain;
  type: ObservationType;
  content: string;
  entities: string[];               // Entity names involved
  location?: string;                // Room name if applicable
  significance: number;             // 0-1, how important
  metadata?: Record<string, any>;
}

export type ObservationType =
  | "action"           // An agent did something
  | "dialogue"         // Speech occurred
  | "movement"         // Entity moved
  | "state_change"     // Component/state changed
  | "conflict"         // Tension/fight detected
  | "relationship"     // Relationship changed
  | "environmental"    // Environment changed
  | "emergence"        // Unexpected pattern detected
  | "stagnation";      // Nothing happening

export interface SignificantEvent {
  id: string;
  timestamp: number;
  summary: string;
  participants: string[];
  narrativeWeight: number;          // How important to the story
  resolved: boolean;
  relatedEvents: string[];          // IDs of connected events
}

// =============================================================================
// DIVINE MESSAGES
// =============================================================================

export interface DivineMessage {
  id: string;
  timestamp: number;
  from: number;                     // Spirit entity ID
  to: number;                       // Target spirit entity ID
  type: MessageType;
  domain: SpiritDomain;
  priority: MessagePriority;

  // Content
  subject: string;
  content: string;
  data?: Record<string, any>;

  // Response handling
  requiresResponse: boolean;
  responseTo?: string;              // ID of message this responds to
  deadline?: number;                // When response is needed by
}

export type MessageType =
  | "report"           // Observation report to superior
  | "directive"        // Instruction from superior
  | "request"          // Request for information/action
  | "response"         // Response to a request
  | "alert"            // Urgent notification
  | "broadcast";       // To all spirits in domain

export type MessagePriority =
  | "low"              // Routine
  | "normal"           // Standard
  | "high"             // Important
  | "urgent";          // Immediate attention

// =============================================================================
// DIRECTIVES
// =============================================================================

export interface Directive {
  id: string;
  timestamp: number;
  from: number;                     // Superior spirit ID
  type: DirectiveType;
  description: string;

  // What to do
  action: DirectiveAction;

  // Constraints
  deadline?: number;
  constraints?: string[];

  // Status
  status: "pending" | "active" | "completed" | "failed";
  result?: string;
}

export type DirectiveType =
  | "observe"          // Watch something specific
  | "intervene"        // Take action
  | "report"           // Send information
  | "escalate"         // Pass to higher authority
  | "delegate"         // Pass to subordinate
  | "wait";            // Hold off on action

export interface DirectiveAction {
  type: "inject_event" | "modify_mood" | "create_entity" | "send_message" | "custom";
  target?: string;                  // Entity/room name
  parameters: Record<string, any>;
}

// =============================================================================
// NARRATIVE STATE (for Narrator spirit)
// =============================================================================

export interface NarrativeState {
  // Current story state
  currentAct: number;               // 1, 2, 3 (three-act structure)
  currentPhase: NarrativePhase;
  tension: number;                  // 0-1

  // Plot tracking
  plotThreads: PlotThread[];
  activeThreads: string[];          // IDs of threads in focus

  // Character tracking
  characterArcs: CharacterArc[];
  protagonists: string[];           // Entity names
  antagonists: string[];

  // Scene tracking
  currentScene?: SceneState;
  sceneHistory: SceneState[];

  // Planned beats
  plannedBeats: StoryBeat[];
  completedBeats: string[];
}

export type NarrativePhase =
  | "exposition"       // Setting up
  | "inciting"         // Catalyst event
  | "rising"           // Building tension
  | "crisis"           // Major decision point
  | "climax"           // Peak tension
  | "falling"          // Resolution beginning
  | "resolution"       // Wrapping up
  | "denouement";      // Final state

export interface PlotThread {
  id: string;
  name: string;
  description: string;
  participants: string[];
  status: "setup" | "active" | "climax" | "resolved" | "abandoned";
  tension: number;
  events: string[];                 // Event IDs
  startedAt: number;
  resolvedAt?: number;
}

export interface CharacterArc {
  entityName: string;
  arcType: "growth" | "fall" | "flat" | "transformation";
  startingState: string;
  currentState: string;
  desiredEndState?: string;
  keyMoments: string[];             // Event IDs
}

export interface SceneState {
  id: string;
  location: string;
  participants: string[];
  startedAt: number;
  endedAt?: number;
  purpose: string;
  outcome?: string;
  tension: number;
  keyDialogue: string[];
  keyActions: string[];
}

export interface StoryBeat {
  id: string;
  description: string;
  type: "plot" | "character" | "thematic";
  targetPhase: NarrativePhase;
  prerequisites: string[];          // Beat IDs that must happen first
  triggered: boolean;
  triggerCondition?: string;
}

// =============================================================================
// SOCIAL STATE (for Sociologist spirit)
// =============================================================================

export interface SocialState {
  // Relationship graph
  relationships: RelationshipEdge[];

  // Faction tracking
  factions: Faction[];
  factionRelations: FactionRelation[];

  // Conflict tracking
  activeConflicts: SocialConflict[];
  resolvedConflicts: SocialConflict[];

  // Social dynamics
  influencers: string[];            // High-influence entity names
  isolates: string[];               // Disconnected entities
  cliques: string[][];              // Groups that cluster together
}

export interface RelationshipEdge {
  from: string;                     // Entity name
  to: string;
  type: "friendship" | "rivalry" | "romance" | "family" | "professional" | "neutral";
  strength: number;                 // -1 to 1
  history: string[];                // Event IDs
  lastInteraction: number;
}

export interface Faction {
  id: string;
  name: string;
  members: string[];
  leader?: string;
  values: string[];
  goals: string[];
  influence: number;                // 0-1
}

export interface FactionRelation {
  factionA: string;
  factionB: string;
  status: "allied" | "neutral" | "rival" | "war";
  tension: number;
}

export interface SocialConflict {
  id: string;
  parties: string[];                // Entity or faction names
  nature: string;
  cause: string;
  intensity: number;
  startedAt: number;
  resolvedAt?: number;
  resolution?: string;
}

// =============================================================================
// INTERVENTION TYPES
// =============================================================================

export interface Intervention {
  id: string;
  spiritEid: number;
  timestamp: number;
  type: InterventionType;
  target: InterventionTarget;
  content: string;
  reason: string;
  result?: string;
}

export type InterventionType =
  | "inject_stimulus"
  | "modify_mood"
  | "spawn_npc"
  | "trigger_event"
  | "modify_environment";

export interface InterventionTarget {
  type: "agent" | "room" | "broadcast";
  name?: string;
  eid?: number;
}

// =============================================================================
// COGNITION TYPES
// =============================================================================

export interface SpiritCognitionInput {
  spirit: SpiritState;
  ecsSnapshot: EcsSnapshot;
  recentEvents: Observation[];
  incomingMessages: DivineMessage[];
  activeDirectives: Directive[];
}

export interface SpiritCognitionOutput {
  thoughts: string;                 // Internal reasoning
  observations: Observation[];      // New observations
  reports: DivineMessage[];         // Messages to send
  interventions: Intervention[];    // Actions to take
  directiveResponses: DirectiveResponse[];
  updatedNarrativeState?: Partial<NarrativeState>;
  updatedSocialState?: Partial<SocialState>;
  storyProse?: string;              // Engaging narrative prose from Narrator
}

export interface DirectiveResponse {
  directiveId: string;
  status: "completed" | "failed" | "in_progress";
  result: string;
}

export interface EcsSnapshot {
  tick: number;
  agents: AgentSnapshot[];
  rooms: RoomSnapshot[];
  recentActions: ActionSnapshot[];
}

export interface AgentSnapshot {
  eid: number;
  name: string;
  location: string;
  mood: string;
  arousal: number;
  focus: string;
  active: boolean;
  recentThoughts: string[];
}

export interface RoomSnapshot {
  eid: number;
  name: string;
  description: string;
  occupants: string[];
  objects: string[];
  ambience: string;
}

export interface ActionSnapshot {
  timestamp: number;
  actor: string;
  type: string;
  target?: string;
  content: string;
}
