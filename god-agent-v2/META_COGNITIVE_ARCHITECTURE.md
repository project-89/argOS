# Meta-Cognitive Architecture: LLM-Powered Systems

## Overview

The God Agent V2 now supports creating systems that themselves use Large Language Models for decision-making. This creates a hierarchical AI architecture where simulations can contain intelligent, adaptive entities that think and reason using AI.

## Architecture Hierarchy

```
Level 1: God Agent (Gemini 2.5 Pro)
├── Creates world structure
├── Defines components and systems
└── Orchestrates simulation

    ↓ creates

Level 2: LLM-Powered Systems (Gemini Flash)
├── NPC consciousness systems
├── Adaptive behavior systems
└── Meta-coordination systems

    ↓ controls

Level 3: Individual Entities
├── NPCs with AI-driven thoughts
├── Animals with adaptive behaviors
└── Emergent interactions
```

## How It Works

### 1. God Creates LLM-Aware Components

```typescript
// Example: NPCMind component for conscious entities
const NPCMind = {
  personality: [],      // Personality description
  currentGoal: [],      // Current objective
  memoryBank: [],       // Recent memories
  lastThought: [],      // Last AI-generated thought
  emotionalState: []    // Current emotions
};
```

### 2. God Generates Async Systems with AI Integration

```typescript
// Example: NPC Consciousness System
async function NPCConsciousnessSystem(world) {
  const npcs = query(world, [NPCMind, Position]);
  
  for (const npc of npcs) {
    // Gather context
    const personality = getString(NPCMind.personality[npc]);
    const memories = getString(NPCMind.memoryBank[npc]);
    const nearby = findNearby(world, npc, 100);
    
    // AI generates thoughts and decisions
    const prompt = `You are ${personality}...`;
    const response = await miniLLM(prompt);
    
    // Update NPC state based on AI
    const decision = JSON.parse(response);
    NPCMind.lastThought[npc] = setString(decision.thought);
  }
}
```

### 3. Entities Think and Act Autonomously

Each entity with AI components can:
- Analyze their current situation
- Generate contextual thoughts
- Make personality-driven decisions
- Form and update memories
- Interact naturally with others

## Use Cases

### 1. Living NPCs
Create villages, cities, or communities where each inhabitant has genuine AI-driven consciousness, making decisions based on personality, memory, and circumstances.

### 2. Adaptive Ecosystems
Build natural environments where animals exhibit realistic behaviors, learning from experiences and adapting to changes in their environment.

### 3. Emergent Narratives
Let stories unfold naturally from the interactions between AI-driven entities, creating unpredictable but coherent narratives.

### 4. Research Simulations
Model complex social phenomena, economic systems, or biological processes where agents need to exhibit intelligent, adaptive behavior.

## API Usage

### Creating an LLM-Powered System

```typescript
god.generateLLMSystem({
  description: "NPCs that think and converse naturally",
  requiredComponents: ["NPCMind", "Position", "Dialogue"],
  llmBehavior: "Analyze personality and situation to generate authentic responses",
  llmModel: "flash", // or "flash25", "pro"
  examples: ["greet others", "share gossip", "express emotions"]
});
```

### Available LLM Models

- `flash`: Gemini 1.5 Flash - Fast, efficient for simple decisions
- `flash25`: Gemini 2.0 Flash - Most intelligent flash model
- `pro`: Gemini 1.5 Pro - For complex reasoning

## System Context Tools

LLM-powered systems have access to special tools:

- `miniLLM(prompt)`: Make AI decisions
- `getString(hash)`: Retrieve string values
- `setString(value)`: Store string values
- `findNearby(world, eid, radius)`: Find nearby entities
- `describeEntities(entities)`: Generate descriptions

## Performance Considerations

1. **Model Selection**: Use faster models (flash) for frequent decisions
2. **Caching**: Reuse decisions when appropriate
3. **Batching**: Process multiple entities together when possible
4. **Async Execution**: Systems run asynchronously to prevent blocking

## Example: Complete Living Village

```typescript
// God creates conscious villagers
await god.processInput(`
  Create a village where each person has AI consciousness.
  
  Components needed:
  - NPCMind (personality, goals, memories)
  - Position (location in world)
  - Dialogue (what they say)
  - Relationships (connections to others)
  
  Create villagers with distinct personalities.
  
  Create NPCConsciousnessSystem that:
  - Lets NPCs think about their situation
  - Generate contextual dialogue
  - Form opinions about others
  - Pursue personal goals
`);

// Run the simulation
await god.processInput("Run NPCConsciousnessSystem for 10 steps");

// NPCs will autonomously:
// - Greet each other based on relationships
// - Share news and gossip
// - React to events emotionally
// - Form new relationships
// - Pursue individual goals
```

## Advanced Patterns

### 1. Hierarchical AI Control

Create meta-systems that coordinate multiple AI systems:

```typescript
// Director AI that orchestrates the narrative
async function StoryDirectorSystem(world) {
  // Monitor all AI-driven entities
  // Identify dramatic opportunities
  // Subtly influence behaviors
  // Ensure narrative coherence
}
```

### 2. Learning and Adaptation

Systems can modify their behavior based on outcomes:

```typescript
// Animals that learn from experience
async function AdaptiveAnimalSystem(world) {
  // Try behaviors
  // Evaluate success
  // Update decision patterns
  // Pass knowledge to offspring
}
```

### 3. Collective Intelligence

Multiple AI entities can form emergent group behaviors:

```typescript
// Flocking with individual AI decisions
async function IntelligentFlockingSystem(world) {
  // Each bird makes AI decisions
  // Considers flock cohesion
  // Balances individual and group needs
}
```

## Future Possibilities

1. **Nested Simulations**: AI entities that create their own sub-simulations
2. **Cross-Domain Intelligence**: Entities that reason across multiple domains
3. **Evolutionary AI**: Systems where AI behaviors evolve over generations
4. **Swarm Intelligence**: Large-scale collective AI behaviors
5. **Narrative AI**: Systems that understand and generate story structures

## Conclusion

LLM-powered systems represent a paradigm shift in simulation design. Instead of hard-coding behaviors, we can create truly autonomous entities that think, reason, and adapt using AI. This enables simulations of unprecedented complexity and realism, where emergent behaviors arise from genuine intelligence rather than scripted rules.

The meta-cognitive architecture allows us to extract not just static structures from LLM latent space, but living, thinking systems that can surprise us with their creativity and adaptability. This is the future of simulation: worlds populated by genuine artificial consciousness.