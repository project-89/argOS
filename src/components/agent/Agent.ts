// Core Agent component - essential properties every agent needs
export const Agent = {
  name: [] as string[], // Agent's name/identifier
  role: [] as string[], // Role description (producer, director, actor, etc)
  systemPrompt: [] as string[], // Base personality/behavior prompt
  active: [] as number[], // Is agent currently active
  platform: [] as string[], // Which platform this agent operates on
  appearance: [] as string[], // Physical description of the agent
  attention: [] as number[], // Current attention/presence level (0-1)
};

// Memory component for storing thoughts and experiences
export const Memory = {
  thoughts: [] as string[][], // Array of thought history
  lastThought: [] as string[], // Most recent thought
  experiences: [] as Array<{
    type: string;
    content: string;
    timestamp: number;
  }>[],
};

export type RoomType = "physical" | "discord" | "twitter" | "private";

// Room component for spatial organization
export const Room = {
  id: [] as string[], // Room identifier
  name: [] as string[], // Room name
  description: [] as string[], // Room description
  occupants: [] as number[][], // Array of entity IDs in the room
  type: [] as RoomType[], // Room type (physical, discord, twitter, private)
};

// Perception component for storing what an agent perceives
export const Perception = {
  currentStimuli: [] as any[][], // Current perceptions/stimuli
  lastProcessedTime: [] as number[], // When we last processed perceptions
};

// Action component for handling agent actions and tool usage
export const Action = {
  pendingAction: [] as ({
    tool: string;
    parameters: any; // Using any since parameters vary by action type
  } | null)[],
  lastActionTime: [] as number[],
  availableTools: [] as Array<{
    name: string;
    description: string;
    parameters: string[];
    schema: any;
  }>[],
};

// Dynamic appearance component for handling physical state and social cues
export const Appearance = {
  baseDescription: [] as string[], // Static physical description
  facialExpression: [] as string[], // Current facial expression
  bodyLanguage: [] as string[], // Current body posture/gestures
  currentAction: [] as string[], // What the agent is visibly doing
  socialCues: [] as string[], // Social signals being displayed
  lastUpdate: [] as number[], // When appearance was last updated
};

// Stimulus component for broadcasting events in the environment
export const Stimulus = {
  type: [] as string[], // Type of stimulus (VISUAL, AUDITORY, etc)
  sourceEntity: [] as number[], // Entity ID of the source
  source: [] as string[], // System that generated the stimulus (ROOM, AGENT, etc)
  content: [] as string[], // The actual stimulus content
  timestamp: [] as number[], // When the stimulus was created
  decay: [] as number[], // Number of engine loops this stimulus will last
  roomId: [] as string[], // The room where this stimulus occurred
};
