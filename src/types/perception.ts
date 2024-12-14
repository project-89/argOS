export interface PerceptionContext {
  salientEntities: Array<{
    id: number;
    type: string;
    relevance: number;
  }>;
  roomContext: Record<
    string,
    {
      stimuliCount: number;
      lastUpdate: number;
      content: string;
    }
  >;
  recentEvents: Array<{
    type: string;
    timestamp: number;
    description: string;
  }>;
  agentRole: string;
  agentPrompt: string;
  stats: {
    totalStimuli: number;
    processedTimestamp: number;
  };
}
