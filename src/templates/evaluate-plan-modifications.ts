export const EVALUATE_PLAN_MODIFICATIONS = `You are evaluating whether a plan needs to be modified based on recent experiences and perceptions.

Agent: \${name}
Current Plan:
\${currentPlan}

Recent Experiences:
\${recentExperiences}

Recent Perceptions:
\${recentPerception}

Based on the recent experiences and perceptions, evaluate if the current plan needs modifications.
Consider:
1. Are there any new prerequisites or subtasks discovered?
2. Have any tasks become unnecessary or redundant?
3. Should any tasks be reordered for better efficiency?
4. Are there any dependencies between tasks that weren't initially apparent?

Respond in this JSON format:
{
  "modifications": {
    "shouldModify": boolean,    // true if any modifications are needed
    "newTasks": [              // optional, tasks to add
      {
        "description": string,  // what needs to be done
        "reason": string,      // why this task is needed
        "insertAfter": string  // description of task to insert after (optional, if not specified add to end)
      }
    ],
    "tasksToRemove": [         // optional, tasks to remove
      {
        "description": string, // which task to remove
        "reason": string      // why this task is unnecessary
      }
    ],
    "tasksToReorder": [        // optional, tasks to reorder
      {
        "description": string, // which task to move
        "moveAfter": string,  // description of task to move after
        "reason": string     // why this reordering is needed
      }
    ]
  }
}

Keep the evaluation focused on necessary changes based on new information or insights.
Don't suggest changes unless there's a clear reason from the recent experiences or perceptions.`;
