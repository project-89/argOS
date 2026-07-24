export const Name = { value: [] as string[] };

export const Description = { value: [] as string[] };

export const Position = {
  x: [] as number[],
  y: [] as number[],
  z: [] as number[],
};

export const Room = {
  capacity: [] as number[],
  ambience: [] as string[],
};

export const Agent = {
  role: [] as string[],
  systemPrompt: [] as string[],
  active: [] as boolean[],
};

export const Mind = {
  mode: [] as string[],
  arousal: [] as number[],
  focus: [] as string[],
  lastUpdate: [] as number[],
};

export const WorkingMemory = {
  capacity: [] as number[],
  currentLoad: [] as number[],
  decayRate: [] as number[],
};

export const Attention = {
  target: [] as string[],
  intensity: [] as number[],
  duration: [] as number[],
  lastShift: [] as number[],
};

export const Personality = {
  openness: [] as number[],
  conscientiousness: [] as number[],
  extraversion: [] as number[],
  agreeableness: [] as number[],
  neuroticism: [] as number[],
};

export const Thought = {
  content: [] as string[],
  type: [] as string[],
  salience: [] as number[],
  timestamp: [] as number[],
};

export const Perception = {
  type: [] as string[],
  content: [] as string[],
  source: [] as string[],
  intensity: [] as number[],
  timestamp: [] as number[],
};

export const ConversationTurn = {
  role: [] as string[],
  content: [] as string[],
  timestamp: [] as number[],
};

export const Stimulus = {
  type: [] as string[],
  content: [] as string[],
  source: [] as string[],
  salience: [] as number[],
  urgency: [] as number[],
  novelty: [] as number[],
  timestamp: [] as number[],
  duration: [] as number[],
  decay: [] as number[],
};

export const KnowledgeNode = {
  type: [] as string[],
  content: [] as string[],
  confidence: [] as number[],
  source: [] as string[],
  timestamp: [] as number[],
  lastAccessed: [] as number[],
  accessCount: [] as number[],
  protected: [] as boolean[],
};

export const Memory = {
  type: [] as string[],
  content: [] as string[],
  emotionalValence: [] as number[],
  importance: [] as number[],
  timestamp: [] as number[],
  lastRecalled: [] as number[],
  recallCount: [] as number[],
};

export const Belief = {
  subject: [] as string[],
  predicate: [] as string[],
  object: [] as string[],
  confidence: [] as number[],
  source: [] as string[],
  timestamp: [] as number[],
};

export const Goal = {
  description: [] as string[],
  // Typed goal contract (optional, backward-compatible with description-only goals)
  kind: [] as string[],        // e.g. "move_to_room", "use_affordance", "custom"
  paramsJson: [] as string[],  // stable JSON string (kind-specific parameters)
  successJson: [] as string[], // stable JSON string (success criteria)
  signature: [] as string[],   // stable identifier derived from kind+params+success
  priority: [] as number[],
  status: [] as string[],
  progress: [] as number[],
  deadline: [] as number[],
  createdAt: [] as number[],
};

export const LastAction = {
  type: [] as string[],
  target: [] as string[],
  content: [] as string[],
  success: [] as boolean[],
  timestamp: [] as number[],
};

export const LastToolResult = {
  toolId: [] as string[],
  command: [] as string[],
  ok: [] as boolean[],
  exitCode: [] as number[],
  summary: [] as string[],
  stdout: [] as string[],
  stderr: [] as string[],
  timestamp: [] as number[],
};

/**
 * Marks an in-flight async office tool job for an agent (non-blocking terminal/CLI work).
 *
 * - Prevents re-submitting the same command every tick.
 * - Allows job completion to advance the current plan step automatically.
 */
export const PendingToolJob = {
  jobId: [] as string[],
  toolId: [] as string[],
  command: [] as string[],
  startedAt: [] as number[],
  // Logging/throttling helpers (optional): avoid emitting "waiting..." stimuli every tick.
  lastNotifyAt: [] as number[],
  lastNotifyJobId: [] as string[],
};

/**
 * Per-invocation tool evidence (append-only log via HasToolResult relation).
 *
 * Motivation:
 * - `LastToolResult` is a single slot and breaks multi-step goal contracts (a later tool call overwrites evidence).
 * - ToolResult entities let goal evaluation reason over multiple tool calls during a goal.
 */
export const ToolResult = {
  toolId: [] as string[],
  command: [] as string[],
  ok: [] as boolean[],
  exitCode: [] as number[],
  summary: [] as string[],
  stdout: [] as string[],
  stderr: [] as string[],
  timestamp: [] as number[],
  goalEid: [] as number[],
  deviceEid: [] as number[],
};

// -----------------------------------------------------------------------------
// Optional organization / coordination artifacts (used by office-style sims)
// -----------------------------------------------------------------------------

export const KanbanBoard = {
  project: [] as string[],
  createdAt: [] as number[],
};

export const KanbanColumn = {
  name: [] as string[],
  position: [] as number[],
  createdAt: [] as number[],
};

export const KanbanCard = {
  title: [] as string[],
  description: [] as string[],
  ownerEid: [] as number[],
  createdAt: [] as number[],
  updatedAt: [] as number[],
};

export const WikiDoc = {
  title: [] as string[],
  body: [] as string[],
  status: [] as string[],
  createdAt: [] as number[],
  updatedAt: [] as number[],
};

export const OrgGovernance = {
  enabled: [] as boolean[],
  requireTicketForWork: [] as boolean[],
  wipLimit: [] as number[],
  doneRequiresToolId: [] as string[],
  doneRequiresCommandIncludes: [] as string[],
  /** Optional: require a Review step before Done. */
  doneRequiresReview: [] as boolean[],
  /** Optional: which column counts as "review" for the Done gate. Defaults to "Review". */
  reviewColumnName: [] as string[],
};

/**
 * Optional staffing/delegation governor for "useful work" org simulations.
 *
 * If enabled, a deterministic system can:
 * - Observe kanban backlog
 * - Spawn/hire agents (up to maxAgents)
 * - Assign ticket ownership + create ticket goals/contracts
 *
 * This component is intentionally optional so other simulations can omit it entirely.
 */
export const OrgStaffingGovernor = {
  enabled: [] as boolean[],
  boardName: [] as string[],
  spawnRoomName: [] as string[],
  defaultRole: [] as string[],
  maxAgents: [] as number[],
  wipPerAgent: [] as number[],
  /** Optional prefix filter for cards this governor should claim (e.g. "[ENG]", "[QA]") */
  claimTitlePrefix: [] as string[],
};

// -----------------------------------------------------------------------------
// Optional repo/PR substrate (used by swarm "useful work" simulations)
// -----------------------------------------------------------------------------

/**
 * A shared repo service snapshot backed by a device sandbox directory.
 *
 * Agents typically:
 * - checkout repo → work in their own device sandbox
 * - submit PRs as patches
 * - integrator system tests + merges passing PRs back into this repo base
 */
export const Repo = {
  repoId: [] as string[],
  baseDeviceEid: [] as number[],
  fixtureId: [] as string[],
  ciCommand: [] as string[],
  createdAt: [] as number[],
  lastUpdatedAt: [] as number[],
};

/**
 * Pull request record (patch-based). Status is advanced by RepoIntegratorSystem.
 */
export const PullRequest = {
  repoEid: [] as number[],
  prId: [] as string[],
  title: [] as string[],
  description: [] as string[],
  authorEid: [] as number[],
  patch: [] as string[],
  status: [] as string[], // "open" | "applying" | "testing" | "merging" | "merged" | "failed" | "needs_rebase"
  workDir: [] as string[],
  pendingPhase: [] as string[], // "apply" | "ci" | "merge"
  pendingToolId: [] as string[],
  pendingJobId: [] as string[],
  pendingStartedAt: [] as number[],
  lastExitCode: [] as number[],
  lastStdout: [] as string[],
  lastStderr: [] as string[],
  createdAt: [] as number[],
  lastUpdatedAt: [] as number[],
};

export const Impression = {
  targetName: [] as string[],
  trait: [] as string[],
  valence: [] as number[],
  confidence: [] as number[],
  basis: [] as string[],
};

export const Action = {
  type: [] as string[],
  parameters: [] as string[],
  status: [] as string[],
  timestamp: [] as number[],
  result: [] as string[],
};

export const CognitiveEvent = {
  type: [] as string[],
  content: [] as string[],
  salience: [] as number[],
  confidence: [] as number[],
  timestamp: [] as number[],
};

export const PhysicalObject = {
  material: [] as string[],
  weight: [] as number[],
  portable: [] as boolean[],
};

export const StimulusSource = {
  stimulusType: [] as string[],
  template: [] as string[],
  interval: [] as number[],
  lastEmit: [] as number[],
};

export const GodAgent = {
  worldName: [] as string[],
  narrative: [] as string[],
  tick: [] as number[],
  // Monitoring & steering fields
  narrativeGoals: [] as string[],      // JSON array of narrative goals
  tension: [] as number[],             // Current narrative tension (0-1)
  lastObservation: [] as number[],     // Timestamp of last observation
  interventionCount: [] as number[],   // Track how often GodAI intervenes
  observationInterval: [] as number[], // How often to observe (ms)
  stagnationScore: [] as number[],     // Current stagnation level (0-1)
};

export const Visual = {
  shape: [] as string[],
  color: [] as string[],
  size: [] as number[],
  label: [] as string[],
  opacity: [] as number[],
  glow: [] as boolean[],
  pulseRate: [] as number[],
};

export const Connection = {
  targetId: [] as number[],
  color: [] as string[],
  width: [] as number[],
  style: [] as string[],
  animated: [] as boolean[],
};

export const GridPosition = {
  x: [] as number[],
  y: [] as number[],
  facing: [] as string[],
};

export const Sprite = {
  char: [] as string[],
  color: [] as string[],
  bgColor: [] as string[],
  zIndex: [] as number[],
};

export const Tile = {
  char: [] as string[],
  walkable: [] as boolean[],
  color: [] as string[],
  bgColor: [] as string[],
};

export const WorldMap = {
  width: [] as number[],
  height: [] as number[],
  tiles: [] as string[],
  name: [] as string[],
};

export const Removed = {};

// ============================================================================
// COMBAT SYSTEM COMPONENTS
// ============================================================================

/** Health for living entities */
export const Health = {
  current: [] as number[],
  max: [] as number[],
  regenRate: [] as number[],  // Health per second
  lastDamage: [] as number[], // Timestamp of last damage
};

/** Combat stats for entities that can fight */
export const CombatStats = {
  attack: [] as number[],
  defense: [] as number[],
  speed: [] as number[],      // Determines turn order
  accuracy: [] as number[],   // 0-1, chance to hit
};

/** Current combat state */
export const InCombat = {
  targetEid: [] as number[],  // Who are we fighting
  stance: [] as string[],     // "aggressive", "defensive", "fleeing"
  lastAction: [] as number[], // Timestamp of last combat action
};

/** Status effects from combat */
export const StatusEffect = {
  effectType: [] as string[], // "stunned", "poisoned", "bleeding", etc.
  duration: [] as number[],   // Remaining duration in ms
  intensity: [] as number[],  // Effect strength 0-1
  source: [] as number[],     // Entity that applied this
};

// ============================================================================
// INVENTORY SYSTEM COMPONENTS
// ============================================================================

/** Inventory for entities that can carry items */
export const Inventory = {
  items: [] as string[],      // JSON array of item entity IDs
  maxSlots: [] as number[],   // Maximum number of items
  weight: [] as number[],     // Current carried weight
  maxWeight: [] as number[],  // Maximum weight capacity
};

/** Item properties for entities that can be picked up */
export const Item = {
  stackable: [] as boolean[], // Can stack multiple of this
  quantity: [] as number[],   // Current stack size
  maxStack: [] as number[],   // Max stack size
  weight: [] as number[],     // Weight per unit
  category: [] as string[],   // "weapon", "tool", "food", "resource", etc.
};

/** Equipment slots for equipped items */
export const EquipSlot = {
  slot: [] as string[],       // "mainHand", "offHand", "head", "body", etc.
  equippedBy: [] as number[], // Entity ID of who has this equipped
};

export const Needs = {
  hunger: [] as number[],
  energy: [] as number[],
  social: [] as number[],
  comfort: [] as number[],
};

// ============================================================================
// PLANNING & REFLECTION COMPONENTS
// ============================================================================

/** Plan for achieving a goal - breaks goals into actionable steps */
export const Plan = {
  goalEid: [] as number[],           // Links to Goal entity this plan is for
  steps: [] as string[],             // JSON array of step descriptions
  currentStep: [] as number[],       // Index of current step (0-based)
  status: [] as string[],            // "active", "completed", "failed", "paused"
  createdAt: [] as number[],         // When plan was created
  lastUpdated: [] as number[],       // Last time plan was updated
};

/** Daily/time-based schedule for an agent */
export const Schedule = {
  activities: [] as string[],        // JSON array of scheduled activities
  currentActivity: [] as string[],   // Current activity name
  nextTransition: [] as number[],    // When to switch to next activity (world time)
  flexibility: [] as number[],       // 0-1, how strictly agent follows schedule
  plannedDay: [] as number[],        // Simulation day this schedule was planned for
  lastUpdated: [] as number[],       // When schedule was last generated
};

/** Per-agent day-plan bookkeeping (used to seed queued scheduled activities once per day). */
export const DayPlanState = {
  plannedDay: [] as number[],        // Simulation day the day-plan was seeded for
  lastPlannedAt: [] as number[],     // Wall-clock timestamp
};

/** Scheduled activity within a Schedule */
export const ScheduledActivity = {
  name: [] as string[],              // Activity name (e.g., "sleep", "work", "socialize")
  startHour: [] as number[],         // Hour of day to start (0-23)
  duration: [] as number[],          // Duration in hours
  location: [] as string[],          // Preferred location for this activity
  priority: [] as number[],          // How important (can be skipped if low)
  interruptible: [] as boolean[],    // Can this be interrupted?
};

// ============================================================================
// WORLD CLOCK & EVENTS (Phase 3.2)
// ============================================================================

/**
 * World clock — attached to a single "clock" entity.
 * Systems advance the tick; period cycles: morning → midday → evening → night.
 * Agents and BTs read period to shape behavior (work in morning, socialize in evening).
 */
export const WorldClock = {
  period: [] as string[],            // "morning" | "midday" | "evening" | "night"
  tick: [] as number[],              // Current tick within the period
  ticksPerPeriod: [] as number[],    // How many ticks each period lasts
  day: [] as number[],               // Current simulation day (increments after night)
  totalTicks: [] as number[],        // Total ticks elapsed
};

/**
 * World event — attached to event entities that the God AI or designers create.
 * Active events override or bias agent behavior (festival → social, storm → shelter).
 * Events have a duration; systems or the God AI remove them when expired.
 */
export const WorldEvent = {
  name: [] as string[],              // "Harvest Festival", "Thunderstorm", "Plague"
  eventType: [] as string[],         // "festival" | "weather" | "crisis" | "ceremony" | "market" | "custom"
  description: [] as string[],       // What's happening (injected into agent context)
  priority: [] as number[],          // 0-100, higher overrides lower
  startTick: [] as number[],         // When the event started
  duration: [] as number[],          // How many ticks it lasts (0 = permanent until removed)
  affectsGoals: [] as string[],      // JSON: goal biases, e.g. {"social": 2, "survive": -1}
  location: [] as string[],          // Where it's happening (room name, or "" for global)
};

/** Reflection state - tracks when agent should reflect */
export const ReflectionState = {
  lastReflection: [] as number[],    // Timestamp of last reflection
  importanceAccum: [] as number[],   // Accumulated importance since last reflection
  reflectionThreshold: [] as number[], // Threshold to trigger reflection (default 100)
  reflectionCount: [] as number[],   // Total reflections performed
  insights: [] as string[],          // JSON array of recent insights
};

// ============================================================================
// NARRATIVE LOGIC ENGINE (Phase 3.5 — LSE NLE)
// ============================================================================

/**
 * Story Scaffold — attached to a single world entity.
 * The NLE's narrative plan: tensions, dramatic beats, NPC roles.
 * Generated at genesis, updated by the NarrativeDirector.
 * All fields are JSON strings for ECS SoA compatibility.
 */
export const StoryScaffold = {
  /** JSON: Array of narrative tensions, each with id, description, status, beats */
  tensions: [] as string[],
  /** JSON: NPC eid → narrative role mapping (protagonist, antagonist, catalyst, witness, ally) */
  npcRoles: [] as string[],
  /** Current narrative act: "setup" | "escalation" | "crisis" | "resolution" */
  currentAct: [] as string[],
  /** JSON: Log of narrative adaptations made by the director */
  adaptations: [] as string[],
  /** Seed phrase that generated this scaffold */
  seed: [] as string[],
};

/** Active procedural execution state for an agent (multi-step habits/macros). */
export const ProcedureState = {
  signature: [] as string[],         // ProceduralSkillV1.signature
  stepIndex: [] as number[],         // Current step index in skill.steps
  status: [] as string[],            // "active" | "completed" | "failed"
  startedAt: [] as number[],         // When execution began
  lastUpdatedAt: [] as number[],     // Last progress update time
};

/** Optional deterministic behavior policy (behavior tree / policy graph) for an agent. */
export const BehaviorPolicy = {
  enabled: [] as boolean[],
  treeJson: [] as string[],          // JSON-encoded behavior tree
  version: [] as number[],           // Bump when updated (helps debugging)
  lastUpdatedAt: [] as number[],
};

export const Interactable = {
  action: [] as string[],
  targetNeed: [] as string[],
  effectAmount: [] as number[],
  cooldown: [] as number[],
  lastUsed: [] as number[],
};

export const CurrentAction = {
  type: [] as string[],
  targetEid: [] as number[],
  startTick: [] as number[],
  duration: [] as number[],
};

export const CharacterRigConfig = {
  baseAtlas: [] as string[],
  idleAnimation: [] as string[],
  currentDirection: [] as string[],
};

// ============================================================================
// OBJECT SYSTEM COMPONENTS - For world objects with states and affordances
// ============================================================================

/** Links entity to its type definition in WorldSchema */
export const ObjectType = {
  typeId: [] as string[],      // Key into WorldSchema.objectTypes
  instanceName: [] as string[], // Unique instance name (e.g., "Old Wooden Chair")
};

/** Current state of an object */
export const ObjectState = {
  current: [] as string[],      // Current state key
  previous: [] as string[],     // Previous state (for transitions)
  lockedUntil: [] as number[],  // Tick when state can change again
};

/** Active traits on an entity (bitfield or string array) */
export const Traits = {
  active: [] as string[],       // JSON array of active trait strings
};

/** Object durability/health */
export const Durability = {
  current: [] as number[],
  max: [] as number[],
};

/** Fuel for things that burn (torches, fires, etc.) */
export const Fuel = {
  current: [] as number[],
  max: [] as number[],
  burnRate: [] as number[],
};

/** Container properties */
export const Container = {
  capacity: [] as number[],
  currentCount: [] as number[],
  allowedTypes: [] as string[],  // JSON array of allowed object types, empty = all
};

/** Surface properties (tables, shelves) */
export const Surface = {
  capacity: [] as number[],
  currentCount: [] as number[],
};

/** Portal properties (doors, gates, passages) */
export const Portal = {
  destinationRoom: [] as number[], // Entity ID of destination room
  bidirectional: [] as boolean[],
};

/** Light source properties */
export const LightSource = {
  intensity: [] as number[],
  radius: [] as number[],
  color: [] as string[],
};

/** Marks entity for state transition */
export const StateTransition = {
  targetState: [] as string[],
  triggeredBy: [] as string[],   // What caused this transition
  timestamp: [] as number[],
};

/** Custom dynamic description (overrides type default) */
export const DynamicDescription = {
  text: [] as string[],
  lastUpdated: [] as number[],
  updatedBy: [] as string[],     // "system" or "godai"
};

/** Properties for template substitution in descriptions */
export const ObjectProperties = {
  adjective: [] as string[],
  material: [] as string[],
  color: [] as string[],
  size: [] as string[],
  custom: [] as string[],        // JSON object for extra properties
};

/**
 * Physical Appearance Component
 * Defines how an NPC looks to others - both stable traits and dynamic state.
 * This gets broadcast as visual stimuli to nearby NPCs.
 */
export const Appearance = {
  // Stable physical traits (rarely change)
  height: [] as string[],           // "tall", "short", "average", "towering"
  build: [] as string[],            // "muscular", "slender", "stocky", "frail"
  hairColor: [] as string[],        // "brown", "blonde", "gray", "bald"
  hairStyle: [] as string[],        // "long", "short", "braided", "messy"
  eyeColor: [] as string[],         // "blue", "brown", "green", "gray"
  skinTone: [] as string[],         // "pale", "tan", "dark", "weathered"
  age: [] as string[],              // "young", "middle-aged", "elderly", "ancient"
  distinguishing: [] as string[],   // "scar on cheek", "missing finger", "tattoo on arm"

  // Dynamic state (changes frequently)
  expression: [] as string[],       // "smiling", "frowning", "worried", "angry", "neutral"
  posture: [] as string[],          // "upright", "slouched", "tense", "relaxed", "defensive"
  clothing: [] as string[],         // "worn farmer's clothes", "fine merchant robes", "leather armor"
  accessories: [] as string[],      // "wide-brimmed hat", "silver necklace", "tool belt"
  condition: [] as string[],        // "clean", "dusty", "muddy", "bloody", "sweaty", "wet"

  // What's visibly in their hands (synced from inventory + current action)
  visiblyHolding: [] as string[],   // "iron plow", "wooden staff", "loaf of bread"

  // Timestamp for change detection
  lastUpdate: [] as number[],
};

export const AllComponents = {
  Name,
  Description,
  Position,
  Room,
  Agent,
  Mind,
  WorkingMemory,
  Attention,
  Personality,
  Thought,
  Perception,
  ConversationTurn,
  Stimulus,
  KnowledgeNode,
  Memory,
  Belief,
  Goal,
  LastAction,
  LastToolResult,
  Impression,
  Action,
  CognitiveEvent,
  PhysicalObject,
  StimulusSource,
  GodAgent,
  Visual,
  Connection,
  GridPosition,
  Sprite,
  Tile,
  WorldMap,
  Removed,
  // Combat system components
  Health,
  CombatStats,
  InCombat,
  StatusEffect,
  // Inventory system components
  Inventory,
  Item,
  EquipSlot,
  // Needs and behavior
  Needs,
  Interactable,
  CurrentAction,
  CharacterRigConfig,
  // Planning & reflection
  Plan,
  Schedule,
  DayPlanState,
	  ScheduledActivity,
	  ReflectionState,
	  ProcedureState,
	  BehaviorPolicy,
	  // Object system components
	  ObjectType,
	  ObjectState,
	  Traits,
  Durability,
  Fuel,
  Container,
  Surface,
  Portal,
  LightSource,
  StateTransition,
  DynamicDescription,
  ObjectProperties,
  // NPC appearance system
  Appearance,
};

export type ComponentName = keyof typeof AllComponents;
