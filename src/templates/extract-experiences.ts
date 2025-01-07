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
