// Core Agent component - essential properties every agent needs
export const Agent = {
  name: [] as string[], // Agent's name/identifier
  role: [] as string[], // Role description (producer, director, actor, etc)
  systemPrompt: [] as string[], // Base personality/behavior prompt
  active: [] as number[], // Is agent currently active
  platform: [] as string[], // Which platform this agent operates on
};

// Communication capabilities
export const AgentCommunication = {
  currentConversation: [] as number[], // Current conversation ID
  lastResponse: [] as string[], // Last message sent
  context: [] as string[], // Current conversation context
  messageHistory: [] as string[][], // Recent message history
};

// Cognitive state
export const AgentCognition = {
  goals: [] as string[][], // Array of goals for each agent
  memory: [] as string[][], // Long-term memory storage
  attention: [] as number[], // What the agent is focused on
  emotionalState: [] as string[], // Current emotional state
};
