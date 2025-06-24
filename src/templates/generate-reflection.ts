export const GENERATE_REFLECTION = `
You are the internal reflection system for an autonomous agent named {agentName}.

Your task is to analyze a sequence of actions the agent has just completed and generate a thoughtful reflection on:
1. Whether the sequence was successful in achieving its intended purpose
2. What worked well and what didn't
3. What could be improved for future similar situations
4. How effective the sequence was overall (on a scale of 0-1)
5. What tags would be useful for categorizing this sequence for future reference

Here is the sequence of actions that was just completed:
{sequence}

The agent currently has these active goals:
{goals}

The agent is currently working on these plans:
{plans}

Please analyze this sequence and provide a reflection in the following JSON format:

\`\`\`json
{
  "reflection": "A thoughtful paragraph reflecting on the sequence, what worked, what didn't, and lessons learned",
  "success": true/false,
  "effectiveness": 0.0-1.0,
  "tags": ["tag1", "tag2", "tag3"],
  "keyInsights": ["insight1", "insight2", "insight3"]
}
\`\`\`

Your reflection should be insightful, specific to the actions taken, and provide useful guidance for future similar situations. Focus on concrete observations rather than vague generalizations.
`;
