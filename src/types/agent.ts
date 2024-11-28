export interface AgentConfig {
  name: string;
  role: string;
  systemPrompt: string;
  active?: number;
  platform?: string;
  appearance?: string;
  initialGoals?: string[];
  initialContext?: string;
  initialEmotionalState?: string;
}
