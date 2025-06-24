# Cognition Pipeline Issues - Code Examples

This document provides specific code examples demonstrating the issues identified in the cognition pipeline analysis.

## 1. Fragmented Chain of Thought

### Current Implementation
```typescript
// In PerceptionSystem.ts
Perception.summary[eid] = summary;
Perception.history[eid].push(summary);

// In ThinkingSystem.ts
Memory.thoughts[eid] = [...currentThoughts, thought.thought].slice(-150);

// In ActionSequenceSystem.ts
// Reflection stored separately
Thought.entries[eid] = [...currentEntries, newEntry];
```

### Problem Demonstration
An agent perceives danger, thinks about it, and acts, but these are disconnected:
```
Perception: "I notice a fire spreading in the room"
Thought: "I need to find an exit" // No reference to the fire perception
Action: {tool: "move", parameters: {direction: "north"}} // No link to why
Reflection: "I successfully moved" // No connection to the original danger
```

## 2. Mode Switching Without Context

### Current Implementation
```typescript
// PerceptionSystem.ts - Mechanical mode switching
if (stableStateCycles > 5) {
  ProcessingState.mode[eid] = ProcessingMode.REFLECTIVE;
}
```

### Problem Example
Agent dealing with a complex puzzle:
```
Cycle 1-4: ACTIVE - "I see puzzle pieces"
Cycle 5: Forced to REFLECTIVE - "I notice patterns" 
Cycle 10: Forced to WAITING - "Nothing significant"
// Agent stops deeply analyzing the puzzle due to arbitrary timing
```

## 3. Fixed Evaluation Intervals

### Current Implementation
```typescript
// GoalPlanningSystem.ts
const GOAL_EVALUATION_INTERVAL = 10000; // Always 10 seconds

if (currentTime - lastEvalTime < GOAL_EVALUATION_INTERVAL) {
  return; // Skip evaluation
}
```

### Problem Example
```
T+0s: Fire alarm goes off
T+5s: Agent perceives smoke
T+9s: Agent thinks "I should evacuate"
T+10s: Finally evaluates goals // 10 second delay for urgent situation!
```

## 4. Weak Perception-Action Integration

### Current Implementation
```typescript
// ThinkingSystem.ts - Only gets summary, not raw stimuli
const state: AgentState = {
  perceptions: {
    narrative: Perception.summary[eid] || "", // Lost detail
    raw: Perception.currentStimuli[eid] || [], // Often not used
  },
  // ...
};
```

### Problem Example
```
Raw Stimuli: [
  {type: "visual", content: "Red flashing light"},
  {type: "audio", content: "Alarm sound"},
  {type: "thermal", content: "Rising temperature"}
]

Summary: "I notice some environmental changes" // Lost critical details

Thought: "Something seems different" // Can't reason about specifics
Action: {tool: "wait"} // Poor decision due to information loss
```

## 5. Limited Reflection

### Current Implementation
```typescript
// ActionSequenceSystem.ts
const shouldCompleteSequence =
  currentSequence.actions.length >= 3 || // Arbitrary number
  lastActionResult.data?.completedGoals?.length > 0;
```

### Problem Example
```
Action 1: Move north (into danger)
Action 2: Move north (deeper into danger)
// No reflection yet - need 3 actions!
Action 3: Move north (critical danger)
Reflection: "I moved north three times" // Too late to course-correct
```

## 6. Memory Truncation

### Current Implementation
```typescript
// Simple slicing without semantic importance
Memory.thoughts[eid] = [...thoughts, newThought].slice(-150);
```

### Problem Example
```
Thoughts[0]: "I discovered the key is hidden under the mat" // Important!
... 149 more thoughts ...
Thoughts[150]: "The weather is nice today"

// After next thought, the key location is lost forever
Thoughts[1]: "The weather is nice today" 
// Thoughts[0] with critical information is gone
```

## 7. Circular Dependencies in Prompts

### From generate-thought.ts
```typescript
THOUGHT GENERATION FRAMEWORK:
Current State: {experiences} // References perceptions
MY GOALS: {goals} // References experiences  
MY PLANS: {activePlans} // References goals
// Circular: thought → goals → plans → experiences → thought
```

### Problem Example
```
Thought 1: "I need to achieve my goal"
Thought 2: "My goal is important because it's in my plans"
Thought 3: "My plans exist because I have goals"
Thought 4: "I need to achieve my goal" // Circular reasoning
```

## 8. No Meta-Cognition

### Current State
No system monitors thinking quality or effectiveness.

### Problem Example
```
Thought 1: "I should go north"
Action: Move north (blocked)
Thought 2: "I should go north" 
Action: Move north (still blocked)
Thought 3: "I should go north"
// No recognition of repeated failure pattern
```

## 9. Context Loss Between Systems

### Current Implementation
```typescript
// Each system gets different slices of information
// PerceptionSystem has full stimuli
// ThinkingSystem gets only summary
// ActionSystem gets only the decision
```

### Problem Example
```
PerceptionSystem sees:
- Fire (visual)
- Smoke (olfactory)  
- Heat (thermal)
- Alarm (audio)

ThinkingSystem gets:
"Environmental hazard detected"

ActionSystem receives:
{tool: "move", direction: "away"}

// Lost: What hazard? Why this direction? What sensory inputs?
```

## 10. Static Behavior Patterns

### Current Implementation
```typescript
// Tools are predefined and static
availableTools: runtime.getActionManager().getEntityTools(eid)
// No way to create new tools or modify behavior patterns
```

### Problem Example
```
Situation: Agent needs to signal for help
Available tools: ["move", "speak", "wait"]
Desired behavior: Flash lights, make noise pattern
Result: Cannot adapt - limited to speech only

Agent: "Help!" // Suboptimal for the situation
// Cannot develop new signaling behavior
```

## Proposed Solutions

### 1. Unified Cognitive Stream
```typescript
interface CognitiveEvent {
  id: string;
  timestamp: number;
  type: 'perception' | 'thought' | 'decision' | 'action' | 'reflection';
  content: any;
  causedBy?: string[]; // Links to previous events
  confidence?: number;
  importance?: number;
}

class UnifiedCognition {
  private stream: CognitiveEvent[] = [];
  
  addEvent(event: CognitiveEvent) {
    this.stream.push(event);
    this.consolidateIfNeeded();
  }
  
  getRelevantContext(eventType: string): CognitiveEvent[] {
    // Return causally linked events
  }
}
```

### 2. Adaptive Processing
```typescript
interface CognitiveLoad {
  urgency: number; // 0-1
  complexity: number; // 0-1
  uncertainty: number; // 0-1
}

class AdaptiveScheduler {
  getNextUpdateTime(load: CognitiveLoad): number {
    // High urgency = faster updates
    // High complexity = more time for processing
    // High uncertainty = more frequent re-evaluation
    return baseInterval * (1 - load.urgency) * (1 + load.complexity);
  }
}
```

### 3. Semantic Memory
```typescript
interface Memory {
  content: any;
  importance: number;
  lastAccessed: number;
  associations: string[]; // Links to related memories
  decayRate: number;
}

class SemanticMemory {
  consolidate() {
    // Merge similar memories
    // Strengthen important associations
    // Decay unimportant memories
  }
  
  retrieve(context: string): Memory[] {
    // Return memories by relevance, not just recency
  }
}
```

These examples demonstrate how the current architecture limits agent intelligence and adaptability. The proposed solutions would enable more sophisticated, emergent behaviors.