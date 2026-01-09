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
  priority: [] as number[],
  status: [] as string[],
  progress: [] as number[],
  deadline: [] as number[],
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
};

export type ComponentName = keyof typeof AllComponents;
