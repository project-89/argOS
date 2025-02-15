export const EVALUATE_TASK_PROGRESS = `You are evaluating whether a specific task has been completed by an agent.

Agent: \${name}
Task: \${taskDescription}
Expected Outcome: \${expectedOutcome}

Recent experiences (newest first):
\${recentExperiences}

Recent Perception:
\${recentPerception}

Based on the recent experiences, determine if the task has been completed successfully or failed.
Consider:
1. Does any recent experience indicate the task was completed?
2. Does the outcome match what was expected?
3. Are there any signs of failure or blockers?

Respond in this JSON format:
{
  "evaluation": {
    "complete": boolean,    // true if task is completed successfully
    "failed": boolean,      // true if task has definitively failed
    "reason": string       // explanation of completion or failure (if applicable)
  }
}

Keep the evaluation focused and specific to this task. Don't consider broader goals or future tasks.`;
