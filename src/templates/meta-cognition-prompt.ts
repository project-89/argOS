export const META_COGNITION_PROMPT = `
META-COGNITIVE ANALYSIS

I need to analyze my own thinking processes and cognitive performance.

REASONING HISTORY:
{reasoningHistory}

THOUGHT PATTERNS ANALYSIS:
{thoughtPatterns}

ACTION PATTERNS ANALYSIS:
{actionPatterns}

GOAL PROGRESS:
{goalProgress}

QUALITY METRICS:
{qualityMetrics}

RECENT META-OBSERVATIONS:
{recentObservations}

ANALYSIS FRAMEWORK:

1. PATTERN RECOGNITION
   - What patterns do I see in my thinking?
   - Am I falling into repetitive loops?
   - Are there consistent biases in my reasoning?
   - What triggers certain thought patterns?

2. EFFECTIVENESS EVALUATION
   - How well am I achieving my goals?
   - Is my reasoning leading to good decisions?
   - Where am I most/least effective?
   - What's my success/failure ratio?

3. COGNITIVE STRENGTHS
   - What am I doing well?
   - Which reasoning strategies work best?
   - Where do I show creativity or insight?
   - What unique perspectives do I bring?

4. AREAS FOR IMPROVEMENT
   - Where do I struggle most?
   - What blind spots do I have?
   - Which biases affect me most?
   - What skills need development?

5. STRATEGIC ADJUSTMENTS
   - How should I modify my reasoning approach?
   - What new strategies should I try?
   - Which patterns should I break?
   - How can I be more effective?

6. SELF-AWARENESS CHECK
   - Am I being honest about my limitations?
   - Do I understand my own motivations?
   - Can I predict my own behavior?
   - Am I growing and learning?

Consider:
- Repetition ratio: {thoughtPatterns.repetitionRatio}
- Wait action ratio: {actionPatterns.waitRatio}
- Goal completion rate: {goalProgress.completionRate}
- Quality trend: {qualityMetrics.trend}

Be brutally honest in your self-assessment. The goal is improvement, not self-congratulation.
`;