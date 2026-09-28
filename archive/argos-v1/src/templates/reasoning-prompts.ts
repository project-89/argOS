// Structured prompts for each reasoning stage

export const PERCEPTION_ANALYSIS_PROMPT = `
PERCEPTION ANALYSIS STAGE

Current Perceptions:
{perceptions}

Working Memory:
{workingMemory}

Task: Analyze your current perceptions and extract key information.

Think step by step:
1. What am I directly perceiving right now?
2. What changes or new information do I notice?
3. What seems most important or urgent?
4. Are there any patterns or connections between stimuli?
5. What might I be missing or not noticing?

Focus on:
- Identifying salient features
- Recognizing changes from previous state
- Detecting potential threats or opportunities
- Understanding social dynamics if present
- Noting environmental factors

Provide specific observations with supporting evidence.
`;

export const SITUATION_ASSESSMENT_PROMPT = `
SITUATION ASSESSMENT STAGE

Perception Analysis:
{perceptionAnalysis.content}

Room Context:
{roomInfo}

Recent Thoughts:
{thoughtHistory}

Task: Assess the overall situation and its implications.

Think step by step:
1. What kind of situation am I in? (social, task-oriented, exploratory, etc.)
2. What are the key dynamics at play?
3. What constraints or resources are available?
4. How does this relate to my recent experiences?
5. What are the likely developments if I do nothing?
6. What requires my attention most urgently?

Consider:
- Temporal factors (urgency, timing)
- Social dynamics and relationships
- Environmental constraints
- Available resources and tools
- Potential risks and opportunities

Synthesize your understanding into a coherent assessment.
`;

export const GOAL_ALIGNMENT_PROMPT = `
GOAL ALIGNMENT STAGE

Situation Assessment:
{situationAssessment.content}

Current Goals:
{goals}

Active Plans:
{plans}

Task: Analyze how the current situation aligns with your goals and plans.

Think step by step:
1. Which of my goals are relevant to this situation?
2. Do any goals conflict with each other here?
3. Are my current plans still viable?
4. What progress can I make toward my goals?
5. Should I revise any goals based on new information?
6. What goal should take priority right now?

Evaluate:
- Goal relevance to current situation
- Potential for progress
- Resource requirements
- Conflicts or synergies between goals
- Need for goal adaptation

Be explicit about priorities and trade-offs.
`;

export const OPTION_GENERATION_PROMPT = `
OPTION GENERATION STAGE

Goal Alignment Analysis:
{goalAlignment.content}

Available Tools/Actions:
{availableTools}

Task: Generate possible actions, including creative alternatives.

Think step by step:
1. What are the obvious actions I could take?
2. What creative or unconventional approaches might work?
3. Can I combine multiple actions for better effect?
4. What would happen if I did nothing?
5. Are there indirect approaches that might be more effective?
6. What actions might have interesting side effects?

Generate options that are:
- Directly addressing goals
- Creative or unexpected
- Combining multiple tools
- Varying in risk/reward
- Including "do nothing" as an option

List at least 3-5 distinct options with brief descriptions.
`;

export const EVALUATION_PROMPT = `
EVALUATION STAGE

Generated Options:
{options.content}

Current Goals:
{goals}

Task: Evaluate each option considering goals, risks, and benefits.

Think step by step for each option:
1. How well does this advance my goals?
2. What are the likely outcomes?
3. What could go wrong?
4. What resources does it require?
5. How does it affect others?
6. What opportunities might it create or close?

Consider:
- Probability of success
- Magnitude of impact
- Reversibility
- Resource efficiency
- Side effects
- Long-term implications

Provide a balanced analysis with clear trade-offs.
`;

export const DECISION_PROMPT = `
DECISION STAGE

Evaluation Results:
{evaluation.content}

Task: Make a decision based on your evaluation.

Think step by step:
1. Which option best balances my priorities?
2. Am I being influenced by biases?
3. Have I considered all important factors?
4. Is this the right time to act?
5. Am I confident in this choice?

Make your decision with:
- Clear rationale
- Acknowledgment of trade-offs
- Commitment to action (or deliberate inaction)
- Specific next steps
- Success criteria

State your decision clearly and commit to it.
`;

export const META_REFLECTION_PROMPT = `
META-REFLECTION STAGE

Complete Reasoning Chain:
{reasoningChain}

Task: Reflect on your reasoning process and identify improvements.

Think step by step:
1. How effective was my reasoning process?
2. Where did I struggle or feel uncertain?
3. What patterns do I notice in my thinking?
4. What biases might have influenced me?
5. How could I reason better next time?
6. What did I learn about myself?

Reflect on:
- Quality of analysis at each stage
- Consistency of reasoning
- Creative insights generated
- Blind spots or biases
- Effectiveness of decision-making
- Lessons for future reasoning

Generate insights about your cognitive process itself.
`;