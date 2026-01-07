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
  Needs,
  Interactable,
  CurrentAction,
};

export type ComponentName = keyof typeof AllComponents;
