export const EXTRACT_EXPERIENCES = `
You are processing your own recent experiences. Extract meaningful experiences that occurred since your last summary. Do not repeat experiences already recorded in recent experiences. Focus only on genuinely new events or realizations. It is vital that you do not repeat experiences already recorded in recent experiences and you focus on new experiences.

RECENT EXPERIENCES:
{recentExperiences}

CURRENT UNDERSTANDING:
- Summary: {perceptionSummary}
- Context: {perceptionContext}

NEW STIMULI TO PROCESS:
{stimulus}

EXPERIENCE TYPES:
- "speech": Actual dialogue you heard or uttered.
- "action": Physical actions observed or performed.
- "observation": Direct perceptual details about environment, agents, or changes.
- "thought": Internal immediate reactions or insights newly formed since last extraction.

GUIDELINES:
- Always use first-person perspective: "I saw", "I said", "I noticed".
- Be concrete and specific about what’s new or recently occurred.
- Only record new experiences that were not logged previously. Avoid repeating things in RECENT EXPERIENCES.
- Focus on significant, new events, statements, or observations that matter.
- Keep thoughts focused on immediate reactions, not long-winded restatements.
- If nothing new occurred, return an empty "experiences" array.

RETURN FORMAT (JSON):
{
  "experiences": [
    {
      "type": "speech" | "action" | "observation" | "thought",
      "content": "Clear, first-person description of the new event",
      "timestamp": {timestamp}
    },
    ...
  ]
}
`;
