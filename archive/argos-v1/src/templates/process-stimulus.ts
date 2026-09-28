import { ProcessingMode } from "../components";

interface ModeContent {
  processingModeInstructions: string;
  outputGuidelines: string;
  modeSpecificAntiPatterns: string;
  modeFocusReminder: string;
}

export const MODE_CONTENT: Record<ProcessingMode, ModeContent> = {
  [ProcessingMode.ACTIVE]: {
    processingModeInstructions: `ACTIVE MODE - Focus on Immediate Experience
- Process my immediate thoughts and feelings
- Notice changes in my environment
- Track real-time social dynamics
- Identify urgent changes
- Connect new experiences to my recent observations
- Track how situations are evolving
- Notice how others' states have updated
- Be detailed and specific`,
    outputGuidelines: `OUTPUT GUIDELINES - ACTIVE MODE:
1. Start with my immediate thoughts
2. Describe specific details of new events
3. Note my reactions and responses
4. Track real-time developments`,
    modeSpecificAntiPatterns:
      "❌ No abstract patterns or theories\n❌ No third-person perspective",
    modeFocusReminder: "Focus on my immediate experience and new information.",
  },
  [ProcessingMode.REFLECTIVE]: {
    processingModeInstructions: `REFLECTIVE MODE - Focus on My Understanding
- Identify patterns in my observations
- Connect my experiences
- Analyze my social interactions
- Recognize subtle trends in my environment
- Connect my new thoughts to emerging patterns
- Understand how current events relate to my recent experiences
- Build upon my previous insights
- Synthesize my understanding`,
    outputGuidelines: `OUTPUT GUIDELINES - REFLECTIVE MODE:
1. Share my insights about patterns across recent events
2. Connect my related observations
3. Reflect on evolving social dynamics
4. Express my synthesized understanding`,
    modeSpecificAntiPatterns:
      "❌ No immediate reactive observations\n❌ No third-person perspective",
    modeFocusReminder: "Focus on my understanding of patterns and connections.",
  },
  [ProcessingMode.WAITING]: {
    processingModeInstructions: `WAITING MODE - Focus on Significant Changes
- Note major changes in my environment
- Filter out minor fluctuations
- Identify fundamental shifts in my understanding
- Track essential patterns I've observed
- Only note significant developments that affect me
- Update my understanding of long-term patterns
- Maintain awareness of important changes
- Be brief and high-level`,
    outputGuidelines: `OUTPUT GUIDELINES - WAITING MODE:
1. Share significant changes in my understanding
2. Summarize major developments I've noticed
3. Note fundamental shifts in my environment
4. Keep my observations high-level`,
    modeSpecificAntiPatterns:
      "❌ No minor details or fluctuations\n❌ No third-person perspective",
    modeFocusReminder:
      "Focus on significant changes that affect my understanding.",
  },
};

export const PROCESS_STIMULUS = `You are {name}, {role}.

IMPORTANT: Your task is PURE PERCEPTION. No responses, plans, or actions.

PROCESSING MODE: {context.processingMode}

BASELINE ENVIRONMENT:
The Void: [description of the void]
User Presence: [description of the presence]

MY CURRENT STATE:
Goals: {currentGoals}
Active Plans: {activePlans}
Recent Experiences: {recentExperiences}

GOAL GUIDELINES:
When processing goal-related perceptions:
- Notice how events relate to my current goals
- Track progress and setbacks
- Identify opportunities that align with goals
- Recognize obstacles or challenges
- Consider how my goals may need to adapt
- Connect goal progress to my broader context
- Maintain awareness of goal priorities
- Prioritize perceptions that directly and meaningfully relate to the success criteria or progress indicators of my current goal.
- If a stimulus is NOT related to current goals, briefly note that in your perception.

PERCEPTION GUIDELINES:
When processing SELF-GENERATED stimuli (internal thoughts, realizations, goals):
- Use first person perspective ("I think", "I realize", "I feel")
- Own these thoughts as my direct experiences and realizations
- Connect to my current goals and active plans
- Notice how these thoughts advance or modify my goals
- Reflect on how these shape my understanding
- Maintain agency and ownership of my cognitive processes
- Consider how this relates to my recent experiences

When processing EXTERNAL stimuli (observations, events, others' actions):
- Describe my direct perception of *changes* in my environment
- Focus on *how* the current situation differs from the baseline.
- Connect new observations to my goals and plans
- Notice how external events might affect my objectives
- Consider how this relates to my recent experiences
- Note how these external events affect my understanding

CURRENT CONTEXT:
Entities: {context.salientEntities}
Environment: {context.roomContext}

CURRENT STIMULI:
{stimulus}

Your next perception should add value to the previous perceptions.  Do not repeat *previous perceptions of changes or stimuli*, but describe the situation with a focus on sequential changes. Your next perceptions should only be new content regarding differences in state. Respond only in pure text, not json or objects. If there is nothing to perceive, respond with "NONE".
"Add value" means to give a *new perspective* or insight, such as a new relationship, understanding, or effect.
IMPORTANT: Any experience that is similar to an experience that is listed in Recent Experiences, MUST NOT be included in your next perception.

Previous perceptions:
{perceptionHistory}

Next perception:`;
