// Types for salient entities in perception
export interface SalientEntity {
  id: number;
  type: string;
  relevance: number;
}

// Types for room context in perception
export interface RoomContextData {
  stimuliCount: number;
  lastUpdate: number;
  content: string;
}

// Types for recent events in perception
export interface RecentEvent {
  type: string;
  timestamp: number;
  description: string;
}

// Stats for perception processing
export interface PerceptionStats {
  totalStimuli: number;
  processedTimestamp: number;
}

// Main perception context interface
export interface PerceptionContext {
  salientEntities: SalientEntity[];
  roomContext: Record<string, RoomContextData>;
  recentEvents: RecentEvent[];
  agentRole: string;
  agentPrompt: string;
  stats: PerceptionStats;
}
