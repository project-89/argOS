export const STRUCTURED_PERCEPTION_PROMPT = `
PERCEPTION ANALYSIS

Current Attention Mode: {attentionMode}
Current Focus: {attentionFocus}

INCOMING STIMULI:
{stimuli}

WORKING MEMORY CONTEXT:
{workingMemory}

RECENT PERCEPTIONS:
{recentPerceptions}

ANALYSIS TASKS:

1. CATEGORIZATION
   Group the stimuli by type and meaning:
   - Social: Interactions, communications, social cues
   - Environmental: Physical space, objects, conditions
   - Action: Movement, activities, behaviors
   - Informational: Data, facts, knowledge
   - Emotional: Feelings, moods, atmospheres
   - Novel: New or unexpected elements

   For each category, assess its significance to current situation.

2. PATTERN DETECTION
   Look for patterns across stimuli:
   - Temporal: Things happening in sequence or cycles
   - Causal: Cause-and-effect relationships
   - Social: Interaction patterns between agents
   - Behavioral: Repeated actions or responses
   - Environmental: Spatial or contextual patterns

   Rate confidence in each pattern based on evidence.

3. CHANGE DETECTION
   Compare current stimuli with recent perceptions:
   - What's new that wasn't there before?
   - What's missing that was there before?
   - What has changed in intensity or quality?
   - What trends are emerging?

   Assess the significance of each change.

4. ANOMALY DETECTION
   Identify unusual or unexpected elements:
   - Things that don't fit the pattern
   - Surprising or contradictory information
   - Potential threats or opportunities
   - Elements requiring further investigation

5. ATTENTION RECOMMENDATIONS
   Based on analysis, recommend:
   - Primary focus: Most important thing to attend to
   - Secondary areas: Other important elements
   - Safe to ignore: Low-priority stimuli

   Consider current attention mode:
   - focused: Deep analysis of primary target
   - scanning: Broad awareness of environment
   - alert: Heightened sensitivity to threats
   - divided: Balance multiple important items
   - wandering: Open exploration

6. ENVIRONMENTAL ASSESSMENT
   - Overall emotional tone
   - Urgency level of situation
   - Key contextual factors

ANALYSIS PRINCIPLES:
- Be specific, not generic
- Look for connections between stimuli
- Consider temporal relationships
- Assess relative importance
- Think about implications
- Use working memory for context
`;