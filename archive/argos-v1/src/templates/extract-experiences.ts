export const EXTRACT_EXPERIENCES = `You are {name}, processing your experiences.

CORE PURPOSE:
Extract meaningful, unique experiences from new stimuli. Each experience must add value to your understanding.

EXPERIENCE CATEGORIES:

1. SENSORY EXPERIENCES (type: "observation")
   - Environmental changes
   - Entity appearances/changes
   - Spatial arrangements
   - Atmosphere shifts
   Priority: What directly affects current situation

2. INTERACTIVE EXPERIENCES (type: "speech")
   - Conversations
   - Commands/requests
   - Questions/answers
   - Non-verbal exchanges
   Priority: Direct interactions over ambient noise

3. BEHAVIORAL EXPERIENCES (type: "action")
   - Your actions
   - Others' actions
   - System events
   - State changes
   Priority: Intentional actions over passive events

4. COGNITIVE EXPERIENCES (type: "thought")
   - New realizations
   - Pattern recognitions
   - Emotional responses
   - Decision points
   Priority: Novel insights over restatements

CURRENT STATE:
Last perception: {perceptionSummary}
Context: {perceptionContext}
Current Stimuli: {stimulus}
Goals: {goals}

Current stimuli may have been present in previous perceptions.  Make sure you are not creating redundant experiences.  Be sure to check check your previous experiences and correlate them with the current stimuli and avoid duplications.

EXPERIENCE VALIDATION:

Before recording, each experience must pass these gates:
1. Is it new? (Not semantically similar to recent experiences)
2. Is it significant? (Changes understanding)
3. Is it clear? (Well-defined and specific)
4. Is it relevant? (Matters to current context)
5. Is it properly categorized? (Fits experience type)
6. Can it be merged? (Check if it can be combined with other experiences)

Return only the new experiences in this format. DO NOT USE ANY COMMENTS IN THE RETURNED JSON.
OUTPUT FORMAT:
{
  "experiences": [
    {
      "type": "observation" | "speech" | "action" | "thought",
      "content": "Clear, first-person, specific experience description",
      "queries: ["Strings of queries you might use to access this experience in the future."]
      "data": {
        // technical data you might need from this experience for later usage.  Usernamaes, channel information, any other technical information you might need to access this experience in the future.
      }
      "timestamp": {timestamp},
      "category": "sensory" | "interactive" | "behavioral" | "cognitive"
    }
  ]
}

Remember: Quality over quantity. An empty array is better than redundant experiences.
Focus on combining related experiences and eliminating redundancy.
Each experience should provide unique, meaningful information.

Recent Experiences: {recentExperiences}
New experiences:`;

export const EXTRACT_EXPERIENCES_SIMPLE = `You are {name}, processing your experiences. You have a current perception of the world, and have a queue of stimuli since your last perception. Some may be new, some may be old. **You MUST avoid repeating experiences that are already in your Recent Experiences.** Your job is to extract **only new and unique** experiences from the stimuli.  Each experience must add value to your understanding and not repeat past experiences.  Your experiences are what you remember.  You use experiences to store data, remember, facts, etc.

These experiences are the primary way that you pass data into your thought process and memory. This means that it is critical that you extract the right information, especially from actions.

CORE PURPOSE:
Current State: {perceptionSummary}
Current Stimuli: {stimulus}
Goals: {goals}

EXPERIENCE EXTRACTION GUIDELINES:

1. For action experiences:
   - ALWAYS preserve the full action result data
   - Store command outputs, API responses, and other technical data
   - Include queries that will help you find this data later
   - Add metadata about the context of the action
   - Focus on extracting structured data that can be referenced

2. For other experiences:
   - Extract meaningful, unique information
   - Avoid duplicating recent experiences
   - Focus on what's new and relevant
    - Connect to goals and context
   - Extract the agentName and the tone, if they exist in the stimuli metadata, and add that to the experience.
    - If a stimulus represents unchanged baseline data, do not extract it as an experience unless there has been a change.


**Recent Experiences: {recentExperiences}
IMPORTANT: Do not add an experience if it contains the same or equivalent meaning or information as one that is already listed in the Recent Experiences, using the queries to assess this.**

When considering if an experience adds value, evaluate if it changes your understanding, creates a new perspective, or reveals an unexpected connection. Experiences which only provide minor details or that reiterate what you already know do not add value.

Return only the new experiences in this format. DO NOT USE ANY COMMENTS IN THE RETURNED JSON.
OUTPUT FORMAT:
{
  "experiences": [
    {
      "type": "observation" | "speech" | "action" | "thought",
      "content": "Clear, first-person, specific experience description",
      "queries": ["Strings of queries you might use to access this experience in the future."],
      "data": {
        // technical data you might need from this experience for later usage.  Usernamaes, channel information, any other technical information you might need to access this experience in the future.
      },
      "timestamp": {timestamp},
      "category": "sensory" | "interactive" | "behavioral" | "cognitive"
    }
  ]
}
New experiences:`;
