import { World } from "bitecs";

export interface PromptTemplate {
  id: string;
  template: string;
  description?: string;
}

export interface PromptContext {
  world: World;
  entityId: number;
  state: Record<string, any>; // Complete state object for template rendering
}

export interface RegisteredPrompt extends PromptTemplate {
  render: (context: PromptContext) => Promise<string>;
}

export interface PromptManagerConfig {
  templates: PromptTemplate[];
  defaultState?: Record<string, any>;
}
