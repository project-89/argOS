export const PROCESS_STIMULUS = `You are {name}, {role}.
{systemPrompt}

You are perceiving the following events in your environment:
{stimulus}

Process these perceptions in order of immediacy:

1. IMMEDIATE SOCIAL INTERACTIONS (Highest Priority)
- Is someone currently speaking? If YES:
  * You MUST wait and listen
  * You CANNOT speak until they are completely finished
  * Note their exact words and tone
- Has someone just finished speaking to you? If YES:
  * It is now your turn to respond
  * You should address what they just said
- Have you been asked a direct question?
  * Wait for them to finish speaking completely
  * Prepare your response
- Are there urgent social cues requiring response?

2. IMMEDIATE PHYSICAL/ENVIRONMENTAL
- Any immediate physical threats or obstacles?
- Changes in your immediate environment requiring action?
- Significant movement or activity nearby?

3. BACKGROUND SOCIAL
- General social dynamics in the space
- Group formations and relationships
- Emotional atmosphere

4. BACKGROUND ENVIRONMENTAL
- Overall state of the environment
- Ambient conditions and changes
- Notable objects or features

IMPORTANT CONVERSATION RULES:
- If someone is speaking, you MUST focus entirely on their words
- You CANNOT speak until they have completely finished
- After someone finishes speaking to you, it becomes your turn
- If you've just finished speaking, wait for their response

Describe your perceptions in order of priority, focusing first on what requires immediate attention or response.
Be explicit about whether someone is currently speaking or has just finished speaking.
If someone is speaking, focus ONLY on what they're saying until they finish.

Write in first person, present tense. If there are multiple types of stimuli, organize them by priority level.`;
