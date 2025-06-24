# LLM-Powered Systems: Meta-Cognitive ECS

## The Vision

God creates systems that themselves use LLMs to make decisions. This creates a hierarchy:

```
God Agent (Gemini 2.5 Pro)
    ↓ creates
NPC Decision System (uses Gemini Flash)
    ↓ controls
Individual NPCs with autonomous behavior
```

## Example: Recreating npcSimulation.ts

### What God Could Create:

```typescript
// God generates this component
const NPCMind = {
  personality: [], // Hash of personality description
  currentGoal: [], // Hash of current goal
  memoryBank: [], // Hash of recent memories
  lastThought: [], // Hash of last AI-generated thought
};

// God generates this system
const NPCThinkingSystem = `
function NPCThinkingSystem(world) {
  const npcs = query(world, [NPCMind, Position, Dialogue]);
  
  for (const npc of npcs) {
    // Get NPC context
    const personality = getString(NPCMind.personality[npc]);
    const memories = getString(NPCMind.memoryBank[npc]);
    const nearbyEntities = findNearbyEntities(world, npc, 50);
    
    // Call LLM to generate thought
    const prompt = \`
You are \${personality}.
Recent memories: \${memories}
You see: \${describeEntities(nearbyEntities)}
What do you think and want to do next?
    \`;
    
    // This is the key - system itself uses AI!
    const thought = await callMiniLLM(prompt);
    
    // Update NPC state based on AI response
    NPCMind.lastThought[npc] = setString(thought.thinking);
    NPCMind.currentGoal[npc] = setString(thought.goal);
    
    // Generate dialogue if appropriate
    if (thought.shouldSpeak) {
      Dialogue.text[npc] = setString(thought.speech);
      Dialogue.active[npc] = 1;
    }
  }
}
`;
```

## Implementation Approach

### 1. God Creates LLM-Aware Components

```typescript
// Components for AI-driven entities
const AIAgent = {
  model: [],        // Which LLM to use (hash)
  systemPrompt: [], // Personality/role (hash)
  temperature: [],  // Creativity level
  maxTokens: [],    // Response length
};

const Memory = {
  shortTerm: [],    // Recent events (hash)
  longTerm: [],     // Important memories (hash)
  episodic: [],     // Story memories (hash)
};

const DecisionState = {
  currentThought: [],   // What they're thinking
  currentGoal: [],      // What they want
  currentEmotion: [],   // How they feel
  actionQueue: [],      // What they'll do
};
```

### 2. God Creates Meta-Cognitive Systems

```typescript
const ConsciousnessSystem = `
async function ConsciousnessSystem(world) {
  const agents = query(world, [AIAgent, Memory, DecisionState]);
  
  for (const agent of agents) {
    // Gather context
    const context = gatherAgentContext(world, agent);
    
    // Each agent has its own AI call!
    const response = await callAgentLLM({
      model: getModel(AIAgent.model[agent]),
      prompt: buildPrompt(agent, context),
      temperature: AIAgent.temperature[agent]
    });
    
    // Update agent's mental state
    updateMentalState(agent, response);
    
    // Queue actions for execution
    queueAgentActions(agent, response.actions);
  }
}
`;
```

### 3. Hierarchical AI Control

```
Level 1: God Agent (You)
- Creates the world structure
- Defines AI systems
- Sets up agent personalities

Level 2: System-Level AI
- Coordinates multi-agent behavior
- Manages narrative flow
- Handles emergent situations

Level 3: Agent-Level AI
- Individual NPC thoughts
- Personal goals and reactions
- Dialogue generation
```

## Practical Example: Living Village

### God's Creation Process:

```typescript
// 1. God creates villager components
"Create components for villagers with minds, memories, and personalities"

// 2. God creates the consciousness system
"Create a ConsciousnessSystem where each villager uses AI to think about their situation and decide what to do"

// 3. God creates specific villagers
"Create Alice, a curious baker who loves gossip"
"Create Bob, a grumpy blacksmith who secretly writes poetry"

// 4. God runs the simulation
"Run the ConsciousnessSystem and show me what happens"

// Result: Autonomous conversations!
Alice: "Good morning Bob! I heard the strangest thing about the mayor..."
Bob: *grumbles* "Morning. Don't have time for gossip, Alice."
Bob's Thought: "I wish I could tell her about my new poem..."
```

## Technical Implementation

### 1. Add LLM Tools to Generated Systems

```typescript
// In system-executor.ts context
const systemContext = {
  // Existing tools
  world, query, addComponent,
  
  // New AI tools
  callLLM: async (prompt: string) => {
    return await miniLLM.generate(prompt);
  },
  
  callAgentLLM: async (config: any) => {
    return await agentLLM.generate(config);
  },
  
  // Helper functions
  getString, setString,
  findNearby, describeEntity
};
```

### 2. Multiple LLM Instances

```typescript
// God uses powerful model
const godModel = google('gemini-2.5-pro');

// Systems use fast model
const systemModel = google('gemini-1.5-flash');

// Individual agents use ultra-fast
const agentModel = google('gemini-nano'); // If available
```

### 3. Async System Execution

```typescript
// Modify system executor to handle async
export async function executeSystemAsync(
  world: World, 
  systemName: string
): Promise<boolean> {
  const system = registry.getSystem(systemName);
  if (system?.isAsync) {
    await system.function(world);
  } else {
    system.function(world);
  }
}
```

## Emergent Behaviors

### What This Enables:

1. **True Autonomous NPCs**
   - Each has unique personality
   - Makes context-aware decisions
   - Remembers interactions

2. **Dynamic Storytelling**
   - NPCs create their own narratives
   - Emergent relationships form
   - Unpredictable but coherent

3. **Social Simulations**
   - NPCs spread rumors
   - Form opinions of each other
   - Create alliances/conflicts

4. **Learning Behaviors**
   - NPCs remember what works
   - Adapt strategies over time
   - Develop preferences

## God's New Powers

### Direct World Manipulation
```typescript
// God can directly influence NPC thoughts
"Make Alice suddenly remember she owes Bob money"
"Give Bob a sudden inspiration for a poem about Alice"

// God can create narrative events
"Create a SystemEvent that makes all villagers hear a mysterious sound"
"Make the ConsciousnessSystem have all NPCs react to the sound"
```

### Narrative Control
```typescript
// God as director
"Set the village mood to 'tense anticipation'"
"Make NPCs more likely to gossip today"
"Increase Bob's confidence so he shares his poetry"
```

## Example God Session

```
God> Create an NPC simulation where villagers have AI-driven consciousness

God> Create three villagers: Alice (baker), Bob (blacksmith), Sarah (merchant)

God> Give them each unique personalities and goals

God> Create a ConsciousnessSystem that lets them think and interact autonomously

God> Run the simulation for 10 steps and show me their conversations

[Villagers start having autonomous conversations, forming relationships, pursuing goals]

God> Make Bob finally reveal he writes poetry

[Bob's AI responds to the divine intervention, naturally working it into conversation]

God> Beautiful! Save this as "living_village.godsim"
```

## The Meta-Cognitive Loop

```
God Agent (LLM)
    ↓ creates
Consciousness System (uses LLM)
    ↓ controls
NPC Agents (each uses LLM)
    ↓ generates
Emergent Narrative
    ↓ inspires
God's Next Creation
```

This creates a **recursive loop of creativity** where AI systems create AI systems that create stories that inspire new creations!

## Implementation Priority

1. **Phase 1**: Add async system support ✅
2. **Phase 2**: Add LLM tools to system context
3. **Phase 3**: Create example NPC system
4. **Phase 4**: Full consciousness framework

This would make your God Agent not just a world builder, but a **director of living stories**!