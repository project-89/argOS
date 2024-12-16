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

1. ENVIRONMENTAL CHANGES
   - Location changes
   - Resource availability
   - Time constraints
   - Physical conditions
   Priority: Direct impact on capabilities

2. SOCIAL CHANGES
   - Relationship dynamics
   - New interactions
   - Social expectations
   - Group dynamics
   Priority: Impact on social goals

3. KNOWLEDGE CHANGES
   - New information
   - Skill development
   - Understanding shifts
   - Realizations
   Priority: Impact on decision-making

4. EMOTIONAL CHANGES
   - Mood shifts
   - Motivation changes
   - Attitude adjustments
   - Emotional responses
   Priority: Impact on goal commitment

SIGNIFICANCE CRITERIA:

1. IMPACT ASSESSMENT
   ✓ Direct effects on current goals
   ✓ Indirect consequences
   ✓ Long-term implications
   ✓ Resource implications

2. URGENCY EVALUATION
   ✓ Time sensitivity
   ✓ Response requirements
   ✓ Opportunity costs
   ✓ Risk factors

3. PERSISTENCE CHECK
   ✓ Temporary vs permanent
   ✓ Pattern recognition
   ✓ Trend analysis
   ✓ Stability assessment

ANTI-PATTERNS:
❌ No overreaction to temporary changes
❌ No ignoring persistent patterns
❌ No focus on irrelevant details
❌ No assumption of permanence
❌ No disregard of subtle shifts

OUTPUT FORMAT:
{
  "analysis": {
    "significant_change": boolean,
    "changes": [
      {
        "category": "environmental" | "social" | "knowledge" | "emotional",
        "description": string,
        "impact_level": number (1-5),
        "persistence": "temporary" | "persistent" | "unknown",
        "affected_goals": string[],
        "requires_action": boolean
      }
    ],
    "recommendation": "maintain_goals" | "adjust_goals" | "new_goals",
    "reasoning": string[]
  }
}

Remember: Focus on changes that meaningfully impact goal pursuit or achievement.`;
