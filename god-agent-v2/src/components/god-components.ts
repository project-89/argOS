/**
 * God Agent V2 Components
 * Using BitECS SoA (Structure of Arrays) pattern
 */

// Component for agents with god-like powers
export const GodMode = {
  enabled: [] as number[],        // 0 or 1
  level: [] as number[],          // 0-100: creation power level
  lastCreation: [] as number[],   // timestamp
  createdCount: [] as number[],   // number of things created
};

// Track dynamically created components
export const DynamicComponent = {
  nameHash: [] as number[],       // Hash of component name
  schemaHash: [] as number[],     // Hash of JSON schema
  creator: [] as number[],        // Entity ID of creator
  timestamp: [] as number[],      // Creation timestamp
  usageCount: [] as number[],     // How many entities use it
};

// Track dynamically created systems
export const DynamicSystem = {
  nameHash: [] as number[],       // Hash of system name
  descriptionHash: [] as number[], // Hash of description
  creator: [] as number[],        // Entity ID of creator
  timestamp: [] as number[],      // Creation timestamp
  executionCount: [] as number[], // Times executed
  enabled: [] as number[],        // 0 or 1
};

// Component for simulation blueprints
export const SimulationBlueprint = {
  nameHash: [] as number[],       // Hash of simulation name
  promptHash: [] as number[],     // Hash of original prompt
  creator: [] as number[],        // Entity ID of creator
  componentCount: [] as number[], // Number of components
  systemCount: [] as number[],    // Number of systems
  entityCount: [] as number[],    // Number of entities
  status: [] as number[],         // 0=draft, 1=active, 2=archived
};

// Basic agent component for god agents
export const Agent = {
  nameHash: [] as number[],       // Hash of agent name
  roleHash: [] as number[],       // Hash of agent role
  active: [] as number[],         // 0 or 1
};

// Component for tracking dynamically created relationships
export const DynamicRelation = {
  nameHash: [] as number[],        // Hash of relationship name
  descriptionHash: [] as number[], // Hash of description
  creator: [] as number[],         // Entity ID of creator god
  timestamp: [] as number[],       // Creation timestamp
  usageCount: [] as number[],      // How many instances exist
};

// Component for agent awareness/knowledge
export const AwareOf = {
  target: [] as number[],          // Entity being observed
  strength: [] as number[],        // Awareness strength (0-100)
  lastUpdate: [] as number[],      // When awareness was last updated
  context: [] as number[],         // Hash of contextual information
};

// Component for agent worlds (nested ECS for personal knowledge)
export const AgentWorld = {
  worldId: [] as number[],         // Unique world identifier
  entityCount: [] as number[],     // Number of entities in this world
  lastActivity: [] as number[],    // Last time world was updated
  owner: [] as number[],           // Entity that owns this world
};

// Component for knowledge nodes in agent worlds
export const KnowledgeNode = {
  typeHash: [] as number[],        // Type of knowledge (person, place, fact, etc.)
  contentHash: [] as number[],     // The actual knowledge content
  confidence: [] as number[],      // How confident the agent is (0-100)
  source: [] as number[],          // Where this knowledge came from
  lastAccessed: [] as number[],    // When this was last used
};

// Store string values separately (BitECS pattern for strings)
export const StringStore: Record<number, string> = {};

// Helper to store and retrieve strings
export function storeString(value: string): number {
  const hash = hashString(value);
  StringStore[hash] = value;
  return hash;
}

export function getString(hash: number): string {
  return StringStore[hash] || '';
}

// Simple string hashing function
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}