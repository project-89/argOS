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

CRITICAL RESPONSE REQUIREMENTS:
1. You MUST respond with ONLY a JSON object
2. Do NOT include any text before or after the JSON
3. Do NOT include any markdown formatting (no \`\`\`json)
4. Do NOT include any comments in the JSON
5. The JSON must EXACTLY match this structure:
{
  "evaluation": {
    "complete": false,
    "failed": false,
    "reason": "Explanation of the current status"
  }
}

RESPONSE RULES:
- "complete": Set to true ONLY if there is clear evidence the task is finished
- "failed": Set to true ONLY if there is clear evidence of failure
- "reason": Provide a clear, concise explanation of the current status
- The response must be valid, parseable JSON
- Do not include any additional fields
- Do not include any explanatory text
- Do not include any line numbers
- Do not include any formatting markers

Example of CORRECT response:
{
  "evaluation": {
    "complete": false,
    "failed": false,
    "reason": "Task is in progress - agent has started but not yet completed the required steps"
  }
}

Remember: Return ONLY the JSON object with no additional text or formatting.`;
