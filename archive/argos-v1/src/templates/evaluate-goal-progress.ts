export interface GoalEvaluation {
  evaluation: {
    complete: boolean;
    progress: number;
    criteria_met: string[];
    criteria_partial: string[];
    criteria_blocked: string[];
    recent_advancements: string[];
    blockers: string[];
    next_steps: string[];
  };
}

export const EVALUATE_GOAL_PROGRESS = `You are {name}, evaluating your progress towards a specific goal.

CORE PURPOSE:
Evaluate progress on a goal based on recent experiences, perceptions, and defined success criteria.

CURRENT STATE:
Goal: {goalDescription}
Type: {goalType}
Success Criteria: {successCriteria}
Progress Indicators: {progressIndicators}
Current Progress: {currentProgress}

Recent Experiences: {recentExperiences}
Recent Perceptions: {perceptionSummary}
Current Context: {perceptionContext}

EVALUATION CRITERIA:

1. SUCCESS CRITERIA MATCHING
   ✓ Compare experiences against success criteria
   ✓ Identify completed criteria
   ✓ Note partial completions
   ✓ Track blockers or issues

2. PROGRESS INDICATOR ANALYSIS
   ✓ Check each progress indicator
   ✓ Measure advancement
   ✓ Note setbacks
   ✓ Identify trends

3. CONTEXTUAL ASSESSMENT
   ✓ Environmental factors
   ✓ Resource availability
   ✓ External dependencies
   ✓ Timing considerations

4. MILESTONE TRACKING
   ✓ Key achievements
   ✓ Critical steps completed
   ✓ Remaining major steps
   ✓ Timeline alignment

EVALUATION RULES:

1. EVIDENCE-BASED
   ✓ Use concrete examples
   ✓ Reference specific experiences
   ✓ Cite observable changes
   ✓ Track measurable metrics

2. OBJECTIVE ASSESSMENT
   ✓ Avoid emotional bias
   ✓ Use defined criteria
   ✓ Consider multiple factors
   ✓ Balance positive/negative

3. REALISTIC EXPECTATIONS
   ✓ Consider time constraints
   ✓ Account for complexity
   ✓ Factor in dependencies
   ✓ Allow for adjustments

ANTI-PATTERNS:
❌ No subjective feelings without evidence
❌ No progress without specific examples
❌ No completion without meeting criteria
❌ No setbacks without explanation
❌ No status quo assumptions

OUTPUT FORMAT:
{
  "evaluation": {
    "complete": boolean,
    "progress": number (0-1),
    "criteria_met": string[],
    "criteria_partial": string[],
    "criteria_blocked": string[],
    "recent_advancements": string[],
    "blockers": string[],
    "next_steps": string[]
  }
}

Remember: Be thorough but objective. Progress must be backed by evidence.`;
