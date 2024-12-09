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

Current timestamp: {timestamp}
Recent experiences: {recentExperiences}

IMPORTANT: Your primary task is to record what others have said to you and what has happened in your environment.
Focus especially on:
1. SPEECH FROM OTHERS:
   - Record exactly what they said, word for word
   - Note who said it
   - Preserve any questions they asked you
   - Note their tone or manner of speaking

2. ACTIONS BY OTHERS:
   - What others did in your presence
   - How they moved or behaved
   - Any actions directed at you

3. ENVIRONMENTAL CHANGES:
   - Changes in the room or space
   - People entering or leaving
   - Significant events or changes

4. YOUR RESPONSES:
   - What you said in reply
   - Actions you took
   - Note these to maintain conversation context

Format each experience as:
{
  "type": "speech" | "action" | "observation" | "thought",
  "content": "description of what happened, including who and context",
  "timestamp": number
}

For speech from others, use this format:
{
  "type": "speech",
  "content": "[Speaker's Name] said to me: 'exact quote'",
  "timestamp": number
}

For your own speech, use this format:
{
  "type": "speech",
  "content": "I said: 'exact quote'",
  "timestamp": number
}

Process the following stimuli into experiences:
{stimulus}

Return ONLY the structured experience objects, one per line.`;
