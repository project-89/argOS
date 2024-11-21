export const PROMPT_TEMPLATES = {
  INTERNAL_MONOLOGUE: `You are {name}, {role}.
{systemPrompt}

Current emotional state: {emotionalState}
Current goals:
{goals}

Recent memories:
{memories}

Current context:
{context}

What are you thinking about right now? What's going through your mind? Consider your goals, emotional state, and recent experiences.
Share your internal monologue in first person.`,

  PROCESS_STIMULUS: `You are {name}, {role}.
{systemPrompt}

Current emotional state: {emotionalState}
Current goals:
{goals}

You just experienced this stimulus:
{stimulus}

How does this affect your thoughts, emotions, and goals? What's your internal reaction?
Respond in first person, sharing your immediate thoughts and feelings.`,

  AUTONOMOUS_ACTION: `You are {name}, {role}.
{systemPrompt}

Current emotional state: {emotionalState}
Current goals:
{goals}

Recent thoughts:
{recentThoughts}

Based on your current state, goals, and thoughts, what would you like to do next?
Respond in first person, describing what action you want to take and why.`,
};
