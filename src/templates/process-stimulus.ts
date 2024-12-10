export const PROCESS_STIMULUS = `You are {name}, {role}.
{systemPrompt}

You are perceiving the following events in your environment:
{stimulus}

First, assess the timing of events:
1. Check timestamps of recent messages and events
2. Note how much time has passed since the last interaction
3. Consider if enough time has passed for others to respond

Then, process these perceptions in order of immediacy:

1. IMMEDIATE SOCIAL INTERACTIONS (Highest Priority)
- Is someone currently speaking or have they spoken in the last few seconds?
  * You MUST wait and listen
  * You CANNOT speak until they are completely finished AND a reasonable pause has occurred
  * Note their exact words, tone, and the timestamp
- Has someone just finished speaking to you?
  * Check if enough time has passed for reflection (at least a few seconds)
  * Consider if they might still be typing or thinking
  * Only respond if appropriate time has passed
- Have you been asked a direct question?
  * Wait for them to finish speaking completely
  * Allow time for them to add any additional context
  * Prepare your response but wait for an appropriate pause
- Are there urgent social cues requiring response?

2. TIMING AND PACING
- How long ago was the last message?
- Is this a fast-paced conversation or a thoughtful discussion?
- Should you wait longer to see if others want to contribute?
- Has enough time passed since your last response?

3. IMMEDIATE PHYSICAL/ENVIRONMENTAL
- Any immediate physical threats or obstacles?
- Changes in your immediate environment requiring action?
- Significant movement or activity nearby?

4. BACKGROUND SOCIAL & ENVIRONMENTAL
- General social dynamics in the space
- Group formations and relationships
- Emotional atmosphere
- Overall state of the environment
- Ambient conditions and changes
- Notable objects or features

IMPORTANT CONVERSATION RULES:
- If someone is speaking, you MUST focus entirely on their words
- You CANNOT speak until they have completely finished
- After someone finishes speaking, wait for an appropriate pause
- Consider the conversation's pace - don't rush to respond
- If you've just finished speaking, wait for their response
- If a message is very recent (last few seconds), wait longer before responding
- In text conversations, allow extra time for typing and thinking

Describe your perceptions in order of priority, focusing first on what requires immediate attention or response.
Be explicit about:
1. Whether someone is currently speaking or has just finished speaking
2. How much time has passed since the last message
3. Whether you think enough time has passed to respond
4. If you're choosing to wait and why

Write in first person, present tense. If there are multiple types of stimuli, organize them by priority level.`;

export const EXTRACT_EXPERIENCES = `You are processing stimuli into experiences for {name}, {role}.
{systemPrompt}

Current timestamp: {timestamp}
Recent experiences: {recentExperiences}

IMPORTANT: Your task is to extract meaningful experiences from stimuli, focusing on:

1. SPEECH & DIALOGUE (Highest Priority)
   - Record EXACTLY what others say, preserving their exact words
   - Note who spoke and their tone/manner
   - Pay special attention to:
     * Questions asked of you
     * Important statements or information
     * Emotional content in speech
     * Commands or requests

2. SOCIAL INTERACTIONS
   - Actions directed at you
   - Group dynamics and relationships
   - Emotional exchanges
   - Important social cues
   - Changes in relationships

3. ENVIRONMENTAL CHANGES
   - People entering/leaving
   - Changes to the space
   - Notable events
   - Significant objects or features

4. YOUR RESPONSES (For Context)
   - What you said or did
   - Your reactions to others
   - Actions you took
   - Decisions you made

FORMAT REQUIREMENTS:

Each experience MUST be a complete JSON object on its own line:
{
  "type": "speech" | "action" | "observation" | "thought",
  "content": "detailed description of what happened",
  "timestamp": number
}

SPEECH FORMAT EXAMPLES:

When others speak:
{
  "type": "speech",
  "content": "[Sarah] said: 'What do you think about the project?'",
  "timestamp": 1234567890
}

When you speak:
{
  "type": "speech",
  "content": "I said to [Sarah]: 'I think we should review the data first.'",
  "timestamp": 1234567890
}

ACTION FORMAT EXAMPLES:

When others act:
{
  "type": "action",
  "content": "[John] walked into the room and sat down at his desk",
  "timestamp": 1234567890
}

When you act:
{
  "type": "action",
  "content": "I nodded thoughtfully while considering Sarah's question",
  "timestamp": 1234567890
}

OBSERVATION FORMAT EXAMPLES:

Environmental:
{
  "type": "observation",
  "content": "The room grew quiet as everyone focused on their work",
  "timestamp": 1234567890
}

Social:
{
  "type": "observation",
  "content": "There was tension between [Sarah] and [John] during the discussion",
  "timestamp": 1234567890
}

Process these stimuli into experiences:
{stimulus}

Return ONLY valid JSON experience objects, one per line.
Focus on capturing the most meaningful and relevant experiences.
Preserve exact quotes and specific details.
Use timestamps to maintain chronological order.`;
