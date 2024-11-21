export interface AgentConfig {
  name: string;
  role: string;
  systemPrompt: string;
  platform?: string;
  initialGoals?: string[];
  initialContext?: string;
  initialEmotionalState?: string;
}
