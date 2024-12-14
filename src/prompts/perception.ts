import { PromptTemplate } from "../types/prompts";

export const perceptionPrompt: PromptTemplate = {
  id: "perception",
  description: "Process agent's perception of current stimuli",
  template: `You are {components.agent.name}, {components.agent.role}.

IMPORTANT: This is ONLY for processing what you perceive. DO NOT produce responses, plans, or actions.

RECENT CONTEXT:
* Recent perceptions: {components.perception.summary}
* Current timestamp: {timestamp}
* Conversation Flow:
  {templates.conversation_state}

ENHANCED CONTEXT:
* Salient Entities: {components.perception.context.salientEntities}
* Room Context: {components.perception.context.roomContext}
* Recent Events: {components.perception.context.recentEvents}
* Your Role: {components.agent.role}
* Your Core Directive: {components.agent.systemPrompt}

Current Stimuli:
{components.perception.currentStimuli}

INSTRUCTIONS FOR PERCEPTION:
1. Focus on immediate observations
2. Consider context and relationships
3. Prioritize relevant information

STYLE:
- First-person, present tense
- Factual and descriptive
- Natural narrative flow

Now, describe your current perception based on all available context.`,
};
