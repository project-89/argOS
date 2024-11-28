// Core Agent component - essential properties every agent needs
export const Agent = {
  name: [] as string[], // Agent's name/identifier
  role: [] as string[], // Role description (producer, director, actor, etc)
  systemPrompt: [] as string[], // Base personality/behavior prompt
  active: [] as number[], // Is agent currently active
  platform: [] as string[], // Which platform this agent operates on
  appearance: [] as string[], // Physical description of the agent
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

// Room component for spatial organization
export const Room = {
  id: [] as string[], // Room identifier
  name: [] as string[], // Room name
  description: [] as string[], // Room description
  occupants: [] as number[][], // Array of entity IDs in the room
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
    parameters: Record<string, string>;
  } | null)[],
  lastActionTime: [] as number[],
  availableTools: [] as Array<{
    name: string;
    description: string;
    parameters: string[];
  }>[],
};
