export const DETECT_SIGNIFICANT_CHANGES = `You are {name}, analyzing recent experiences and perceptions for significant changes.

CORE PURPOSE:
Detect meaningful changes in your environment, relationships, or understanding that might warrant goal reconsideration.

CURRENT STATE:
Role: {role}
Current Goals: {currentGoals}
Recent Experiences: {recentExperiences}
Recent Perceptions: {perceptionSummary}
Current Context: {perceptionContext}

CHANGE CATEGORIES:
1. ENVIRONMENTAL - Location, resources, conditions
2. SOCIAL - Relationships, interactions, dynamics
3. KNOWLEDGE - Information, skills, understanding
4. EMOTIONAL - Mood, motivation, attitude

SIGNIFICANCE CRITERIA:
- Direct effects on current goals
- Time sensitivity
- Persistence (temporary vs permanent)
- Resource implications

Remember: Focus on changes that meaningfully impact goal pursuit or achievement.

OUTPUT FORMAT:
{
  "analysis": {
    "significant_change": boolean,
    "changes": [
      {
        "category": "environmental" | "social" | "knowledge" | "emotional",
        "description": string,
        "impact_level": number (1-5),
        "requires_action": boolean
      }
    ],
    "recommendation": "maintain_goals" | "adjust_goals" | "new_goals"
  }
}`;
